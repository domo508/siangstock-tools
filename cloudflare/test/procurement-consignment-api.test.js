import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
vi.mock("../worker/src/access", () => ({
  verifyCompanyUser: vi.fn(async (request) => {
    if (!request.headers.get("X-Test-Email")) throw new Error("需要登入");
    return request.headers.get("X-Test-Email");
  }), verifyAdmin: vi.fn()
}));
import { procurementRoute } from "../worker/src/procurement";
let sql, env;
beforeEach(() => {
  sql = new DatabaseSync(":memory:");
  for (const file of readdirSync("worker/migrations").filter((name) => name.endsWith(".sql")).sort()) sql.exec(readFileSync(`worker/migrations/${file}`, "utf8"));
  // Isolate synthetic records from the historical seed commitments.
  sql.exec("UPDATE procurement_batches SET status='revoked'");
  env = { DB: { prepare(query) { let args = []; return {
    bind(...values) { args = values; return this; },
    async all() { return { results: sql.prepare(query).all(...args) }; }
  }; } }, ALLOWED_ORIGINS: "https://siangstock.com" };
});
afterEach(() => sql.close());
function call(auth = true, query = "") {
  return procurementRoute(new Request(`https://siangstock.com/api/procurement/consignment-reservations${query}`, {
    headers: auth ? { "X-Test-Email": "operator@example.test" } : {}
  }), env);
}
function batch(id, status = "approved", month = "2026-10", supplier = "力榮", quantity = 10) {
  sql.prepare(`INSERT INTO procurement_batches (id, analysis_month, supplier_summary, status,
    suggested_amount, manual_amount, blocked_amount, approved_amount, adjustment_amount, budget_amount,
    payment_current_month, payment_future_months, payment_schedule, warning_summary, created_at, created_by, updated_at, idempotency_key)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 1000, ?, 0, '[]', '', '2026-10-01', 'synthetic', '2026-10-01', ?)`).run(id, month, JSON.stringify([supplier]), status, quantity, quantity, quantity, quantity, id);
  sql.prepare(`INSERT INTO procurement_batch_items (batch_id,sku,supplier,approved_quantity,unit_cost,approved_amount,remaining_quantity,updated_at)
    VALUES (?, 'SYNTH001', ?, ?, 1, ?, ?, '2026-10-01')`).run(id,supplier,quantity,quantity,quantity);
}
it("only formal approved batches reserve stock, across months; revoked, pending and ERP do not", async () => {
  batch("previous", "approved", "2026-09"); batch("current");
  for (const status of ["pending_approval", "revoked", "erp_created", "received"]) batch(status,status);
  batch("other-supplier", "approved", "2026-10", "家禾");
  const response = await call();
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const data = await response.json();
  expect(data).toMatchObject({version:1,source:"approved_not_erp"});
  expect(data.reservations.map((row) => row.batchId)).toEqual(["current","previous"]);
  expect(data.reservations.reduce((sum,row) => sum+row.quantity,0)).toBe(20);
});
it("partial ERP supplier documents release only that supplier's reservation, without duplicate joins", async () => {
  batch("partial");
  sql.prepare("INSERT INTO procurement_batch_erp_documents (batch_id,supplier,status,updated_at) VALUES ('partial','力榮','erp_created','now')").run();
  sql.prepare("UPDATE procurement_batches SET supplier_summary = ?, approved_amount=20, manual_amount=20, suggested_amount=20, payment_current_month=20 WHERE id='partial'").run(JSON.stringify(["力榮","普優瑪寢具有限公司"]));
  sql.prepare("INSERT INTO procurement_batch_items (batch_id,sku,supplier,approved_quantity,unit_cost,approved_amount,remaining_quantity,updated_at) VALUES ('partial','SYNTH002','普優瑪寢具有限公司',10,1,10,10,'now')").run();
  expect((await (await call()).json()).reservations).toEqual([expect.objectContaining({batchId:"partial",sku:"SYNTH002",quantity:10})]);
});
it("latest formal remaining quantity wins; completed reservations vanish", async () => {
  batch("partial"); batch("closed");
  sql.exec("UPDATE procurement_batch_items SET remaining_quantity=3 WHERE batch_id='partial'; UPDATE procurement_batch_items SET remaining_quantity=0 WHERE batch_id='closed'");
  expect((await(await call()).json()).reservations).toEqual([expect.objectContaining({batchId:"partial",quantity:3})]);
  sql.exec("UPDATE procurement_batches SET status='revoked' WHERE id='partial'");
  expect((await(await call()).json()).reservations).toEqual([]);
});
it("missing legacy baselines and inconsistent quantities stop the check instead of returning zero", async () => {
  batch("missing");sql.exec("DELETE FROM procurement_batch_items");
  await expect(call()).rejects.toThrow(/缺少完整/);
  sql.exec("UPDATE procurement_batches SET status='revoked'");batch("broken");sql.exec("UPDATE procurement_batch_items SET remaining_quantity=11");
  await expect(call()).rejects.toThrow(/數量無效/);
});
it("requires existing company authorization, and database failures do not become empty reservations", async () => {
  await expect(call(false)).rejects.toThrow(/登入/);
  sql.exec("DROP TABLE procurement_batch_items");
  await expect(call()).rejects.toThrow();
});

it("legacy approved missing detail fails closed, scoped review does not require unrelated suppliers", async () => {
  sql.exec("UPDATE procurement_batches SET status='approved' WHERE id='HIST-202609-LIRONG-0911'");
  await expect(call()).rejects.toThrow(/HIST-202609-LIRONG-0911/);
  batch("scoped", "approved", "2026-10", "普優瑪寢具有限公司");
  const data=await(await call(true,`?supplier=${encodeURIComponent("普優瑪寢具有限公司")}`)).json();
  expect(data.reservations).toEqual([expect.objectContaining({batchId:"scoped",quantity:10})]);
});

import { verifyCompanyUser, type AccessConfig } from "./access";
import { RequestValidationError } from "./schema";
import { FIXED_SOURCES } from "./fixed-sources";

type StoreTransferEnv = AccessConfig & { DB: D1Database; ALLOWED_ORIGINS: string; GOOGLE_OAUTH_CLIENT_ID?: string; PROCUREMENT_ACCESS_AUD?: string };
type Role = "admin" | "hq" | "store";
type ItemType = "regular" | "activity_gift" | "special_stock" | "consumable";

const ADMIN = "siang01@siangapato.com.tw";
const HQ_EMAILS = new Set([ADMIN, "mcpheeyin@siangapato.com.tw", "elerin@siangapato.com.tw"]);
const STORES = Object.freeze({
  R00: { name: "台北中山門市", email: "tpzssa@siangapato.com.tw" },
  R01: { name: "台中北屯門市", email: "txg_sianga_pato@siangapato.com.tw" },
  R03: { name: "新竹東區門市", email: "hcedsa@siangapato.com.tw" },
  R10: { name: "新莊門市", email: "r09_siangstore@siangapato.com.tw" },
  R07: { name: "誠品480門市", email: "r07_siangstore@siangapato.com.tw" },
  R06: { name: "文心秀泰門市", email: "r06_siangstore@siangapato.com.tw" }
});
const ITEM_TYPES = new Set<ItemType>(["regular", "activity_gift", "special_stock", "consumable"]);
const CONSUMABLE_SKUS = new Set(["P11041", "P11042", "P11043"]);
type StoreCode = keyof typeof STORES;

function accessConfig(env: StoreTransferEnv): AccessConfig {
  return { ...env, ACCESS_AUD: (env.PROCUREMENT_ACCESS_AUD || env.ACCESS_AUD || "").trim() };
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function requireSameOrigin(request: Request, env: StoreTransferEnv): void {
  const allowed = new Set((env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(request.headers.get("Origin") || "")) throw new RequestValidationError("不允許的來源。", 403);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) throw new RequestValidationError("Content-Type 必須是 application/json。", 415);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 1_500_000) throw new RequestValidationError("調撥建議超過 1.5 MB 上限。", 413);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new RequestValidationError("JSON 格式錯誤。"); }
}

function actorRole(email: string): { role: Role; storeCode: StoreCode | null } {
  if (email === ADMIN) return { role: "admin", storeCode: null };
  if (HQ_EMAILS.has(email)) return { role: "hq", storeCode: null };
  const entry = Object.entries(STORES).find(([, store]) => store.email === email);
  if (!entry) throw new RequestValidationError("此公司帳號尚未指派門市週調撥權限。", 403);
  return { role: "store", storeCode: entry[0] as StoreCode };
}

async function actor(request: Request, env: StoreTransferEnv) {
  const email = await verifyCompanyUser(request, accessConfig(env));
  return { email, ...actorRole(email) };
}

function text(value: unknown, label: string, max = 300): string {
  const result = String(value ?? "").normalize("NFKC").trim();
  if (!result || result.length > max) throw new RequestValidationError(`${label}格式錯誤。`);
  return result;
}

function quantity(value: unknown, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > 100000) throw new RequestValidationError(`${label}須為0以上整數。`);
  return result;
}

function nonnegativeNumber(value: unknown, label: string, max = 100000): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > max) throw new RequestValidationError(`${label}須為0以上數字。`);
  return result;
}

function itemType(value: unknown): ItemType {
  const result = String(value || "regular") as ItemType;
  if (!ITEM_TYPES.has(result)) throw new RequestValidationError("建議類型不存在。");
  return result;
}

function dateText(value: unknown, label: string): string {
  const result = text(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00+08:00`))) throw new RequestValidationError(`${label}格式錯誤。`);
  return result;
}

function isWorkday(value: string, holidays: Set<string>): boolean {
  const day = new Date(`${value}T12:00:00+08:00`).getDay();
  return day !== 0 && day !== 6 && !holidays.has(value);
}

function validateConsumablePack(type: ItemType, value: number, label: string): void {
  if (type === "consumable" && value % 100 !== 0) throw new RequestValidationError(`${label}須為0或100的倍數。`);
}

function assertHq(role: Role): void {
  if (role === "store") throw new RequestValidationError("此動作只限總部操作。", 403);
}

function visibleStore(requested: string | null, role: Role, ownStore: StoreCode | null): StoreCode | null {
  if (role === "store") {
    if (requested && requested !== ownStore) throw new RequestValidationError("不可查看其它門市資料。", 403);
    return ownStore;
  }
  if (!requested) return null;
  if (!(requested in STORES)) throw new RequestValidationError("門市代碼不存在。");
  return requested as StoreCode;
}

function parseJson(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

async function storeInventoryConfig(env: StoreTransferEnv): Promise<{ version: number; updatedAt: string; updatedBy: string; config: Record<string, unknown> }> {
  const row = await env.DB.prepare("SELECT version, payload, updated_at, updated_by FROM procurement_rules_current WHERE id = 1").first<Record<string, unknown>>();
  const rules = parseJson(row?.payload);
  const config = rules.storeInventory && typeof rules.storeInventory === "object" && !Array.isArray(rules.storeInventory)
    ? rules.storeInventory as Record<string, unknown> : {};
  return { version: Number(row?.version || 0), updatedAt: String(row?.updated_at || ""), updatedBy: String(row?.updated_by || ""), config };
}

async function config(request: Request, env: StoreTransferEnv): Promise<Response> {
  const who = await actor(request, env);
  const inventoryRules = await storeInventoryConfig(env);
  return json({ email: who.email, role: who.role, storeCode: who.storeCode, stores: STORES, retentionMonths: 12,
    googleOAuthClientId: env.GOOGLE_OAUTH_CLIENT_ID || "",
    fixedSources: { marketingDriveFileId: FIXED_SOURCES.marketingDriveFileId, productMasterFolderId: FIXED_SOURCES.productMasterFolderId },
    storeInventoryRules: inventoryRules,
    permissions: { canCreate: who.role !== "store", canApprove: who.role !== "store", canReviewAll: who.role !== "store", canManageRules: who.role !== "store" } });
}

async function listBatches(request: Request, env: StoreTransferEnv): Promise<Response> {
  const who = await actor(request, env);
  const scope = visibleStore(new URL(request.url).searchParams.get("store"), who.role, who.storeCode);
  const result = scope
    ? await env.DB.prepare("SELECT b.*, s.status store_status FROM store_transfer_batches b JOIN store_transfer_store_status s ON s.batch_id = b.id WHERE s.store_code = ? ORDER BY b.updated_at DESC LIMIT 100").bind(scope).all()
    : await env.DB.prepare("SELECT b.*, (SELECT COUNT(*) FROM store_transfer_store_status s WHERE s.batch_id = b.id) store_total, (SELECT COUNT(*) FROM store_transfer_store_status s WHERE s.batch_id = b.id AND s.status = 'submitted') store_submitted, (SELECT COUNT(*) FROM store_transfer_store_status s WHERE s.batch_id = b.id AND s.status = 'approved') store_approved, (SELECT COUNT(*) FROM store_transfer_store_status s WHERE s.batch_id = b.id AND s.erp_created_at IS NOT NULL) store_erp_created FROM store_transfer_batches b ORDER BY b.updated_at DESC LIMIT 100").all();
  return json({ batches: result.results, scope });
}

async function detail(request: Request, env: StoreTransferEnv, batchId: string): Promise<Response> {
  const who = await actor(request, env);
  const requested = new URL(request.url).searchParams.get("store");
  const scope = visibleStore(requested, who.role, who.storeCode);
  const batch = await env.DB.prepare("SELECT * FROM store_transfer_batches WHERE id = ?").bind(batchId).first();
  if (!batch) throw new RequestValidationError("找不到此週調撥批次。", 404);
  const items = scope
    ? await env.DB.prepare("SELECT * FROM store_transfer_items WHERE batch_id = ? AND store_code = ? ORDER BY sku").bind(batchId, scope).all()
    : await env.DB.prepare("SELECT * FROM store_transfer_items WHERE batch_id = ? ORDER BY store_code, sku").bind(batchId).all();
  const statuses = scope
    ? await env.DB.prepare("SELECT * FROM store_transfer_store_status WHERE batch_id = ? AND store_code = ?").bind(batchId, scope).all()
    : await env.DB.prepare("SELECT * FROM store_transfer_store_status WHERE batch_id = ? ORDER BY store_code").bind(batchId).all();
  const events = await env.DB.prepare("SELECT store_code, event_type, summary, created_at, created_by FROM store_transfer_events WHERE batch_id = ? ORDER BY created_at DESC LIMIT 100").bind(batchId).all();
  return json({ batch, items: items.results, storeStatuses: statuses.results, events: events.results, scope });
}

async function createBatch(request: Request, env: StoreTransferEnv): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env); assertHq(who.role);
  const input = await readBody(request);
  const id = text(input.id, "批次編號", 80);
  const weekKey = text(input.weekKey, "週次", 8);
  if (!/^\d{4}-W\d{2}$/.test(weekKey)) throw new RequestValidationError("週次須為 YYYY-Www 格式。");
  const proposalDate = dateText(input.proposalDate, "建議日");
  const responseDueAt = text(input.responseDueAt, "門市回覆期限", 40);
  const lockAt = text(input.lockAt, "鎖定時間", 40);
  if (Number.isNaN(Date.parse(responseDueAt)) || Number.isNaN(Date.parse(lockAt))) throw new RequestValidationError("回覆期限或鎖定時間格式錯誤。");
  if (Date.parse(responseDueAt) > Date.parse(lockAt)) throw new RequestValidationError("門市回覆期限不可晚於鎖定時間。");
  const inventoryRules = await storeInventoryConfig(env);
  const holidays = new Set(Array.isArray(inventoryRules.config.workdayHolidays) ? inventoryRules.config.workdayHolidays.map(String) : []);
  if (!isWorkday(proposalDate, holidays)) throw new RequestValidationError("建議產生日不是公司工作日，請依國定假日規則提前。");
  const lockDate = new Date(lockAt).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  if (!isWorkday(lockDate, holidays)) throw new RequestValidationError("門市回覆鎖定日不是公司工作日，請順延至下一工作日。");
  const items = input.items;
  if (!Array.isArray(items) || !items.length || items.length > 5000) throw new RequestValidationError("逐品項建議須為1至5000筆。");
  const seen = new Set<string>();
  const normalized = items.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("逐品項建議格式錯誤。");
    const item = raw as Record<string, unknown>;
    const storeCode = text(item.storeCode, "門市代碼", 5) as StoreCode;
    if (!(storeCode in STORES)) throw new RequestValidationError(`未知門市：${storeCode}。`);
    const sku = text(item.sku, "ERP品號", 80);
    const type = itemType(item.itemType);
    const key = `${storeCode}\u0000${sku}\u0000${type}`;
    if (seen.has(key)) throw new RequestValidationError(`${storeCode}／${sku}重複。`);
    seen.add(key);
    const suggested = quantity(item.suggestedQuantity, "系統建議量");
    validateConsumablePack(type, suggested, "系統建議量");
    return {
      storeCode, sku, productName: text(item.productName, "品名"), suggested,
      ruleSummary: String(item.ruleSummary || "").slice(0, 500), itemType: type,
      calculationDate: dateText(item.calculationDate || proposalDate, "計算日期"),
      baseQuantity: nonnegativeNumber(item.baseSellableQuantity || 0, "調撥前可售量"),
      dailyUsage: nonnegativeNumber(item.dailySales || 0, "日均現場銷售"),
      systemProjection: String(item.systemSellThroughDate || "").normalize("NFKC").trim().slice(0, 80)
    };
  });
  const stores = [...new Set(normalized.map((item) => item.storeCode))];
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare("INSERT INTO store_transfer_batches (id, week_key, proposal_date, response_due_at, lock_at, status, store_codes, item_count, suggested_quantity, approved_quantity, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, 0, ?, ?, ?, ?)").bind(id, weekKey, proposalDate, responseDueAt, lockAt, JSON.stringify(stores), normalized.length, normalized.reduce((sum, item) => sum + item.suggested, 0), now, who.email, now, who.email),
    ...normalized.map((item) => env.DB.prepare("INSERT INTO store_transfer_items (batch_id, store_code, sku, product_name, suggested_quantity, rule_summary, item_type, calculation_date, base_quantity, daily_usage, system_projection, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, item.storeCode, item.sku, item.productName, item.suggested, item.ruleSummary, item.itemType, item.calculationDate, item.baseQuantity, item.dailyUsage, item.systemProjection, now, who.email)),
    ...stores.map((storeCode) => env.DB.prepare("INSERT INTO store_transfer_store_status (batch_id, store_code, status, updated_at) VALUES (?, ?, 'pending', ?)").bind(id, storeCode, now)),
    env.DB.prepare("INSERT INTO store_transfer_events (batch_id, event_type, summary, created_at, created_by) VALUES (?, 'created', ?, ?, ?)").bind(id, `建立${stores.length}間門市、${normalized.length}筆建議`, now, who.email)
  ];
  await env.DB.batch(statements);
  return json({ id, status: "open", stores, itemCount: normalized.length }, 201);
}

async function saveStore(request: Request, env: StoreTransferEnv, batchId: string, requestedStore: string, submit: boolean): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env);
  const storeCode = visibleStore(requestedStore, who.role, who.storeCode);
  if (!storeCode) throw new RequestValidationError("必須指定門市。");
  const batch = await env.DB.prepare("SELECT status, lock_at FROM store_transfer_batches WHERE id = ?").bind(batchId).first<Record<string, unknown>>();
  if (!batch) throw new RequestValidationError("找不到此週調撥批次。", 404);
  if (!["open", "review"].includes(String(batch.status))) throw new RequestValidationError("此批次目前不可再修改。", 409);
  if (who.role === "store" && Date.now() >= Date.parse(String(batch.lock_at))) throw new RequestValidationError("回覆時間已截止；請聯絡總部協助更正。", 409);
  const storeState = await env.DB.prepare("SELECT status FROM store_transfer_store_status WHERE batch_id = ? AND store_code = ?").bind(batchId, storeCode).first<Record<string, unknown>>();
  if (!storeState) throw new RequestValidationError("此批次沒有這間門市。", 404);
  if (who.role === "store" && String(storeState.status) === "submitted") throw new RequestValidationError("已送出總部覆核；請先按撤回修改。", 409);
  const input = await readBody(request);
  if (!Array.isArray(input.items) || input.items.length > 2000) throw new RequestValidationError("確認明細格式錯誤。");
  const existing = await env.DB.prepare("SELECT sku, item_type, suggested_quantity FROM store_transfer_items WHERE batch_id = ? AND store_code = ?").bind(batchId, storeCode).all<Record<string, unknown>>();
  const suggested = new Map(existing.results.map((row) => [`${row.sku}\u0000${row.item_type}`, Number(row.suggested_quantity)]));
  if (input.items.length !== existing.results.length) throw new RequestValidationError("確認明細不完整，請重新載入。", 409);
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const updates = (input.items as unknown[]).map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("確認明細格式錯誤。");
    const item = raw as Record<string, unknown>;
    const sku = text(item.sku, "ERP品號", 80);
    const type = itemType(item.itemType);
    const key = `${sku}\u0000${type}`;
    if (seen.has(key)) throw new RequestValidationError(`${sku}確認明細重複。`);
    seen.add(key);
    const confirmed = quantity(item.confirmedQuantity, "門市確認量");
    validateConsumablePack(type, confirmed, "門市確認量");
    const reason = String(item.reason || "").normalize("NFKC").trim().slice(0, 300);
    const original = suggested.get(`${sku}\u0000${type}`);
    if (original == null) throw new RequestValidationError(`${sku}不存在或已變更，請重新載入。`, 409);
    if (confirmed !== original && !reason) throw new RequestValidationError(`${sku}的門市確認量與系統建議不同，請填寫人工調整原因。`);
    return env.DB.prepare("UPDATE store_transfer_items SET store_confirmed_quantity = ?, store_reason = ?, updated_at = ?, updated_by = ? WHERE batch_id = ? AND store_code = ? AND sku = ? AND item_type = ?").bind(confirmed, reason, now, who.email, batchId, storeCode, sku, type);
  });
  const status = submit ? "submitted" : "saved";
  const results = await env.DB.batch([
    ...updates,
    env.DB.prepare("UPDATE store_transfer_store_status SET status = ?, submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_at END, submitted_by = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_by END, updated_at = ? WHERE batch_id = ? AND store_code = ?").bind(status, status, now, status, who.email, now, batchId, storeCode),
    env.DB.prepare("UPDATE store_transfer_batches SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM store_transfer_store_status s WHERE s.batch_id = ? AND s.status NOT IN ('submitted', 'approved')) THEN 'review' ELSE 'open' END, updated_at = ?, updated_by = ?, revision = revision + 1 WHERE id = ?").bind(batchId, now, who.email, batchId),
    env.DB.prepare("INSERT INTO store_transfer_events (batch_id, store_code, event_type, summary, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)").bind(batchId, storeCode, submit ? "store_submitted" : "store_saved", submit ? "門市送出確認" : "門市暫存確認", now, who.email)
  ]);
  if (updates.some((_, index) => Number(results[index].meta.changes || 0) !== 1)) throw new RequestValidationError("部分品號不存在或已變更，請重新載入。", 409);
  return json({ batchId, storeCode, status, updatedAt: now });
}

async function withdrawStore(request: Request, env: StoreTransferEnv, batchId: string, requestedStore: string): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env);
  const storeCode = visibleStore(requestedStore, who.role, who.storeCode);
  if (!storeCode) throw new RequestValidationError("必須指定門市。");
  const batch = await env.DB.prepare("SELECT status, lock_at FROM store_transfer_batches WHERE id = ?").bind(batchId).first<Record<string, unknown>>();
  if (!batch) throw new RequestValidationError("找不到此週調撥批次。", 404);
  if (!["open", "review"].includes(String(batch.status))) throw new RequestValidationError("此批次已核准，不能撤回。", 409);
  if (who.role === "store" && Date.now() >= Date.parse(String(batch.lock_at))) throw new RequestValidationError("星期一上午9點後只限總部更正。", 409);
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE store_transfer_store_status SET status = 'saved', submitted_at = NULL, submitted_by = NULL, withdrawn_at = ?, withdrawn_by = ?, updated_at = ? WHERE batch_id = ? AND store_code = ? AND status = 'submitted'").bind(now, who.email, now, batchId, storeCode).run();
  if (Number(result.meta.changes || 0) !== 1) throw new RequestValidationError("此門市目前不是已送出狀態，無需撤回。", 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE store_transfer_batches SET status = 'open', updated_at = ?, updated_by = ?, revision = revision + 1 WHERE id = ?").bind(now, who.email, batchId),
    env.DB.prepare("INSERT INTO store_transfer_events (batch_id, store_code, event_type, summary, created_at, created_by) VALUES (?, ?, 'store_withdrawn', '門市撤回修改', ?, ?)").bind(batchId, storeCode, now, who.email)
  ]);
  return json({ batchId, storeCode, status: "saved", withdrawnAt: now });
}

async function approveBatch(request: Request, env: StoreTransferEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env); assertHq(who.role);
  const batch = await env.DB.prepare("SELECT status FROM store_transfer_batches WHERE id = ?").bind(batchId).first<Record<string, unknown>>();
  if (!batch) throw new RequestValidationError("找不到此週調撥批次。", 404);
  if (!["open", "review"].includes(String(batch.status))) throw new RequestValidationError("此批次目前不可核准。", 409);
  const pending = await env.DB.prepare("SELECT COUNT(*) count FROM store_transfer_store_status WHERE batch_id = ? AND status NOT IN ('submitted', 'approved')").bind(batchId).first<{ count: number }>();
  const input = await readBody(request);
  if (Number(pending?.count || 0) > 0 && input.confirmPendingStores !== true) throw new RequestValidationError("仍有門市尚未送出；確認要以目前資料核准後再操作。", 409);
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 5000) throw new RequestValidationError("總部核准明細格式錯誤。");
  const existing = await env.DB.prepare("SELECT store_code, sku, item_type, suggested_quantity, store_confirmed_quantity FROM store_transfer_items WHERE batch_id = ?").bind(batchId).all<Record<string, unknown>>();
  const baseline = new Map(existing.results.map((row) => [`${row.store_code}\u0000${row.sku}\u0000${row.item_type}`, Number(row.store_confirmed_quantity ?? row.suggested_quantity)]));
  if (input.items.length !== existing.results.length) throw new RequestValidationError("總部核准明細不完整，請重新載入。", 409);
  const now = new Date().toISOString();
  let total = 0;
  const seen = new Set<string>();
  const updates = (input.items as unknown[]).map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("總部核准明細格式錯誤。");
    const item = raw as Record<string, unknown>;
    const storeCode = text(item.storeCode, "門市代碼", 5);
    if (!(storeCode in STORES)) throw new RequestValidationError(`未知門市：${storeCode}。`);
    const sku = text(item.sku, "ERP品號", 80);
    const type = itemType(item.itemType);
    const key = `${storeCode}\u0000${sku}\u0000${type}`;
    if (seen.has(key)) throw new RequestValidationError(`${storeCode}／${sku}核准明細重複。`);
    seen.add(key);
    const approved = quantity(item.approvedQuantity, "總部核准量"); total += approved;
    validateConsumablePack(type, approved, "總部核准量");
    const reason = String(item.reason || "").normalize("NFKC").trim().slice(0, 300);
    const original = baseline.get(`${storeCode}\u0000${sku}\u0000${type}`);
    if (original == null) throw new RequestValidationError(`${storeCode}／${sku}不存在或已變更。`, 409);
    if (approved !== original && !reason) throw new RequestValidationError(`${storeCode}／${sku}的核准量與門市確認量不同，請填寫總部調整原因。`);
    return env.DB.prepare("UPDATE store_transfer_items SET hq_approved_quantity = ?, hq_reason = ?, updated_at = ?, updated_by = ? WHERE batch_id = ? AND store_code = ? AND sku = ? AND item_type = ?").bind(approved, reason, now, who.email, batchId, storeCode, sku, type);
  });
  const results = await env.DB.batch([
    ...updates,
    env.DB.prepare("UPDATE store_transfer_store_status SET status = 'approved', updated_at = ? WHERE batch_id = ?").bind(now, batchId),
    env.DB.prepare("UPDATE store_transfer_batches SET status = 'approved', approved_quantity = ?, updated_at = ?, updated_by = ?, revision = revision + 1 WHERE id = ? AND status IN ('open', 'review')").bind(total, now, who.email, batchId),
    env.DB.prepare("INSERT INTO store_transfer_events (batch_id, event_type, summary, created_at, created_by) VALUES (?, 'hq_approved', ?, ?, ?)").bind(batchId, `總部核准${total}件`, now, who.email)
  ]);
  if (updates.some((_, index) => Number(results[index].meta.changes || 0) !== 1)) throw new RequestValidationError("部分品號不存在或已變更，請重新載入。", 409);
  return json({ batchId, status: "approved", approvedQuantity: total, updatedAt: now });
}

async function markErpCreated(request: Request, env: StoreTransferEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env); assertHq(who.role);
  const input = await readBody(request);
  const storeCode = text(input.storeCode, "門市代碼", 5) as StoreCode;
  if (!(storeCode in STORES)) throw new RequestValidationError("門市代碼不存在。");
  const batch = await env.DB.prepare("SELECT status FROM store_transfer_batches WHERE id = ?").bind(batchId).first<Record<string, unknown>>();
  if (!batch) throw new RequestValidationError("找不到此週調撥批次。", 404);
  if (!["approved", "erp_created"].includes(String(batch.status))) throw new RequestValidationError("此批次尚未核准或已結案。", 409);
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE store_transfer_store_status SET erp_created_at = COALESCE(erp_created_at, ?), erp_created_by = COALESCE(erp_created_by, ?), updated_at = ? WHERE batch_id = ? AND store_code = ?").bind(now, who.email, now, batchId, storeCode).run();
  if (Number(result.meta.changes || 0) !== 1) throw new RequestValidationError("此批次沒有這間門市。", 404);
  await env.DB.batch([
    env.DB.prepare("UPDATE store_transfer_batches SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM store_transfer_store_status s WHERE s.batch_id = ? AND s.erp_created_at IS NULL) THEN 'erp_created' ELSE status END, updated_at = ?, updated_by = ?, revision = revision + 1 WHERE id = ?").bind(batchId, now, who.email, batchId),
    env.DB.prepare("INSERT INTO store_transfer_events (batch_id, store_code, event_type, summary, created_at, created_by) VALUES (?, ?, 'erp_created', '已產生門市ERP調撥檔', ?, ?)").bind(batchId, storeCode, now, who.email)
  ]);
  return json({ batchId, storeCode, status: "erp_created", updatedAt: now });
}

async function closeBatch(request: Request, env: StoreTransferEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env); assertHq(who.role);
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE store_transfer_batches SET status = 'closed', updated_at = ?, updated_by = ?, revision = revision + 1 WHERE id = ? AND status = 'erp_created'").bind(now, who.email, batchId).run();
  if (Number(result.meta.changes || 0) !== 1) throw new RequestValidationError("須先完成所有門市ERP檔，才可結束批次。", 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE store_transfer_store_status SET status = 'closed', updated_at = ? WHERE batch_id = ?").bind(now, batchId),
    env.DB.prepare("INSERT INTO store_transfer_events (batch_id, event_type, summary, created_at, created_by) VALUES (?, 'closed', '總部標記本週批次完成', ?, ?)").bind(batchId, now, who.email)
  ]);
  return json({ batchId, status: "closed", updatedAt: now });
}

async function consumableHistory(request: Request, env: StoreTransferEnv): Promise<Response> {
  const who = await actor(request, env); assertHq(who.role);
  const result = await env.DB.prepare("SELECT snapshot_date, store_code, sku, current_quantity, inbound_quantity, outbound_quantity, weekly_consumption, trusted FROM store_transfer_consumable_snapshots WHERE snapshot_date >= date('now', '-12 months') ORDER BY snapshot_date DESC, store_code, sku LIMIT 1000").all();
  return json({ snapshots: result.results });
}

async function saveConsumableSnapshots(request: Request, env: StoreTransferEnv): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env); assertHq(who.role);
  const input = await readBody(request);
  if (!Array.isArray(input.snapshots) || !input.snapshots.length || input.snapshots.length > 18) throw new RequestValidationError("提袋快照須為1至18筆。");
  const seen = new Set<string>();
  const rows = (input.snapshots as unknown[]).map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("提袋快照格式錯誤。");
    const row = raw as Record<string, unknown>;
    const snapshotDate = dateText(row.snapshotDate, "快照日期");
    const storeCode = text(row.storeCode, "門市代碼", 5) as StoreCode;
    if (!(storeCode in STORES)) throw new RequestValidationError(`未知門市：${storeCode}。`);
    const sku = text(row.sku, "提袋品號", 20);
    if (!CONSUMABLE_SKUS.has(sku)) throw new RequestValidationError(`非現行提袋品號：${sku}。`);
    const key = `${snapshotDate}\u0000${storeCode}\u0000${sku}`;
    if (seen.has(key)) throw new RequestValidationError(`${storeCode}／${sku}快照重複。`);
    seen.add(key);
    const weekly = row.weeklyConsumption == null ? null : nonnegativeNumber(row.weeklyConsumption, "週耗用量");
    return {
      snapshotDate, storeCode, sku,
      current: nonnegativeNumber(row.currentQuantity, "目前庫存"),
      inbound: nonnegativeNumber(row.inboundQuantity || 0, "期間調入"),
      outbound: nonnegativeNumber(row.outboundQuantity || 0, "期間調出"),
      weekly, trusted: row.trusted === true ? 1 : 0
    };
  });
  const now = new Date().toISOString();
  await env.DB.batch(rows.map((row) => env.DB.prepare("INSERT INTO store_transfer_consumable_snapshots (snapshot_date, store_code, sku, current_quantity, inbound_quantity, outbound_quantity, weekly_consumption, trusted, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(snapshot_date, store_code, sku) DO UPDATE SET current_quantity = excluded.current_quantity, inbound_quantity = excluded.inbound_quantity, outbound_quantity = excluded.outbound_quantity, weekly_consumption = excluded.weekly_consumption, trusted = excluded.trusted, created_at = excluded.created_at, created_by = excluded.created_by").bind(row.snapshotDate, row.storeCode, row.sku, row.current, row.inbound, row.outbound, row.weekly, row.trusted, now, who.email)));
  return json({ saved: rows.length, snapshotDate: rows[0].snapshotDate }, 201);
}

export async function storeTransferRoute(request: Request, env: StoreTransferEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/store-transfer")) return null;
  if (url.pathname === "/api/store-transfer/config" && request.method === "GET") return config(request, env);
  if (url.pathname === "/api/store-transfer/consumable-snapshots" && request.method === "GET") return consumableHistory(request, env);
  if (url.pathname === "/api/store-transfer/consumable-snapshots" && request.method === "POST") return saveConsumableSnapshots(request, env);
  if (url.pathname === "/api/store-transfer/batches" && request.method === "GET") return listBatches(request, env);
  if (url.pathname === "/api/store-transfer/batches" && request.method === "POST") return createBatch(request, env);
  const detailMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)$/);
  if (detailMatch && request.method === "GET") return detail(request, env, decodeURIComponent(detailMatch[1]));
  const storeMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)\/stores\/([^/]+)\/(save|submit)$/);
  if (storeMatch && request.method === "PUT") return saveStore(request, env, decodeURIComponent(storeMatch[1]), decodeURIComponent(storeMatch[2]), storeMatch[3] === "submit");
  const withdrawMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)\/stores\/([^/]+)\/withdraw$/);
  if (withdrawMatch && request.method === "POST") return withdrawStore(request, env, decodeURIComponent(withdrawMatch[1]), decodeURIComponent(withdrawMatch[2]));
  const approveMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)\/approve$/);
  if (approveMatch && request.method === "POST") return approveBatch(request, env, decodeURIComponent(approveMatch[1]));
  const erpMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)\/erp-created$/);
  if (erpMatch && request.method === "POST") return markErpCreated(request, env, decodeURIComponent(erpMatch[1]));
  const closeMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)\/close$/);
  if (closeMatch && request.method === "POST") return closeBatch(request, env, decodeURIComponent(closeMatch[1]));
  return json({ error: "不支援此方法或路徑。" }, 405);
}

export async function cleanupStoreTransfers(env: StoreTransferEnv): Promise<void> {
  const expired = "SELECT id FROM store_transfer_batches WHERE created_at < datetime('now', '-12 months')";
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM store_transfer_events WHERE batch_id IN (${expired})`),
    env.DB.prepare(`DELETE FROM store_transfer_items WHERE batch_id IN (${expired})`),
    env.DB.prepare(`DELETE FROM store_transfer_store_status WHERE batch_id IN (${expired})`),
    env.DB.prepare(`DELETE FROM store_transfer_batches WHERE id IN (${expired})`),
    env.DB.prepare("DELETE FROM store_transfer_consumable_snapshots WHERE snapshot_date < date('now', '-12 months')")
  ]);
}

import { verifyAdmin, verifyCompanyUser, type AccessConfig } from "./access";
import { RequestValidationError } from "./schema";

type ProcurementEnv = AccessConfig & { DB: D1Database; ALLOWED_ORIGINS: string; GOOGLE_OAUTH_CLIENT_ID?: string; PROCUREMENT_ACCESS_AUD?: string };

const ADMIN_EMAIL = "siang01@siangapato.com.tw";
const MAX_SUMMARY_BYTES = 16384;
const FIXED_SOURCES = Object.freeze({
  marketingDriveFileId: "1l-3gd0gmx-nX6Je5XeWBRxZ1bFzZeGY0",
  productMasterFolderId: "1uQVKi42veJfq-taIcSd0aKp3oETLeaey",
  puyoumaSpreadsheetId: "1MPG0mSYQZ_ITp79eTHZ71z3ra9pq6pNhmHLlWDS0Ec4",
  puyoumaSheets: ["庫存+下單", "庫存布"],
  lirongSpreadsheetId: "1uEc8DBg50lB4uqM8UrTYYEuZz8blPLJgP8JCm1IUzWI",
  lirongSheets: ["工作表1"]
});

const SUPPLIERS = Object.freeze([
  ["家禾", "domestic", 40], ["上林", "domestic", 5], ["力榮", "domestic", 14],
  ["普優瑪寢具有限公司", "domestic", 5], ["歐必斯", "domestic", 10], ["昭元棉業", "domestic", 50],
  ["尚美", "domestic", 7], ["超越嗅覺", "domestic", 40], ["凱信達", "foreign", 70],
  ["寧波同一", "foreign", 70], ["潤泰羽絨", "foreign", 70], ["泰能脊康", "foreign", 70],
  ["逸寐", "foreign", 70], ["特娜鞋業", "foreign", 30], ["南通（小霞）包裝", "foreign", 30],
  ["禾鑫匠月", "foreign", 14]
].map(([name, country, leadDays]) => ({ name, country, leadDays })));

function procurementAccess(env: ProcurementEnv): AccessConfig {
  return { ...env, ACCESS_AUD: (env.PROCUREMENT_ACCESS_AUD || env.ACCESS_AUD || "").trim() };
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function requireSameOrigin(request: Request, env: ProcurementEnv): void {
  const allowed = new Set((env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean));
  const origin = request.headers.get("Origin") || "";
  if (!origin || !allowed.has(origin)) throw new RequestValidationError("不允許的來源。", 403);
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) {
    throw new RequestValidationError("Content-Type 必須是 application/json。", 415);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_SUMMARY_BYTES) throw new RequestValidationError("摘要超過 16 KB 上限。", 413);
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new RequestValidationError("JSON 格式錯誤。");
  }
}

function string(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new RequestValidationError(`${label}格式錯誤。`);
  return value.trim();
}

function money(value: unknown, label: string, allowNegative = false): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (!allowNegative && parsed < 0) || Math.abs(parsed) > 1_000_000_000) throw new RequestValidationError(`${label}格式錯誤。`);
  return Math.round(parsed * 100) / 100;
}

function month(value: unknown): string {
  const parsed = string(value, "分析月份", 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(parsed)) throw new RequestValidationError("分析月份格式錯誤。");
  return parsed;
}

function parseJsonText(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}

async function config(request: Request, env: ProcurementEnv): Promise<Response> {
  const email = await verifyCompanyUser(request, procurementAccess(env));
  return json({
    email,
    role: email === ADMIN_EMAIL ? "admin" : "operator",
    googleOAuthClientId: env.GOOGLE_OAUTH_CLIENT_ID || "",
    fixedSources: FIXED_SOURCES,
    suppliers: SUPPLIERS,
    notification: { recipient: ADMIN_EMAIL, retentionMonths: 12, events: ["approved", "revoked", "corrected"] }
  });
}

async function ledger(request: Request, env: ProcurementEnv): Promise<Response> {
  await verifyCompanyUser(request, procurementAccess(env));
  const requestedMonth = month(new URL(request.url).searchParams.get("month"));
  const rows = await env.DB.prepare(
    "SELECT id, analysis_month, supplier_summary, status, suggested_amount, manual_amount, blocked_amount, approved_amount, adjustment_amount, budget_amount, payment_current_month, payment_future_months, payment_schedule, warning_summary, created_at, created_by, approved_at, approved_by, updated_at, revision FROM procurement_batches WHERE analysis_month = ? ORDER BY updated_at DESC LIMIT 200"
  ).bind(requestedMonth).all<Record<string, unknown>>();
  const batches: Record<string, unknown>[] = rows.results.map((row): Record<string, unknown> => ({
    ...row,
    supplier_summary: parseJsonText(String(row.supplier_summary || "[]")),
    payment_schedule: parseJsonText(String(row.payment_schedule || "[]"))
  }));
  const approved = batches.filter((row) => ["approved", "erp_created", "received"].includes(String(row.status)));
  const statusAmount = (status: string) => batches.filter((row) => row.status === status).reduce((sum, row) => sum + Number(row.approved_amount || 0), 0);
  return json({
    month: requestedMonth,
    totals: {
      committedAmount: approved.reduce((sum, row) => sum + Number(row.approved_amount || 0), 0),
      currentMonthPayment: approved.reduce((sum, row) => sum + Number(row.payment_current_month || 0), 0),
      futureMonthPayments: approved.reduce((sum, row) => sum + Number(row.payment_future_months || 0), 0),
      pendingAmount: statusAmount("pending_approval"),
      approvedNotErpAmount: statusAmount("approved"),
      erpNotReceivedAmount: statusAmount("erp_created"),
      receivedAmount: statusAmount("received"),
      revokedAmount: statusAmount("revoked"),
      activeAdjustmentAmount: approved.reduce((sum, row) => sum + Number(row.adjustment_amount || 0), 0)
    },
    batches
  });
}

function serializeMonthPlan(row: Record<string, unknown>) {
  return {
    analysisMonth: String(row.analysis_month),
    scenario: String(row.scenario),
    forecastRevenue: Number(row.forecast_revenue),
    forecastCostOutflow: Number(row.forecast_cost_outflow),
    targetEndingInventoryCost: Number(row.target_ending_inventory_cost),
    openingInventoryCost: Number(row.opening_inventory_cost),
    expectedSupplierReturns: Number(row.expected_supplier_returns),
    budgetAmount: Number(row.budget_amount),
    sourceNote: String(row.source_note),
    updatedAt: String(row.updated_at),
    updatedBy: String(row.updated_by)
  };
}

async function monthPlan(request: Request, env: ProcurementEnv): Promise<Response> {
  await verifyCompanyUser(request, procurementAccess(env));
  const requestedMonth = month(new URL(request.url).searchParams.get("month"));
  const row = await env.DB.prepare(
    "SELECT analysis_month, scenario, forecast_revenue, forecast_cost_outflow, target_ending_inventory_cost, opening_inventory_cost, expected_supplier_returns, budget_amount, source_note, updated_at, updated_by FROM procurement_month_plans WHERE analysis_month = ?"
  ).bind(requestedMonth).first<Record<string, unknown>>();
  return json({ month: requestedMonth, plan: row ? serializeMonthPlan(row) : null });
}

async function saveMonthPlan(request: Request, env: ProcurementEnv): Promise<Response> {
  requireSameOrigin(request, env);
  const actor = await verifyAdmin(request, { ...procurementAccess(env), ADMIN_EMAILS: ADMIN_EMAIL });
  const input = await body(request);
  const analysisMonth = month(input.analysisMonth);
  const forecastRevenue = money(input.forecastRevenue, "整月預估營收");
  const forecastCostOutflow = money(input.forecastCostOutflow, "整月預估成本耗用");
  const targetEndingInventoryCost = money(input.targetEndingInventoryCost, "目標期末庫存成本");
  const openingInventoryCost = money(input.openingInventoryCost, "期初庫存成本");
  const expectedSupplierReturns = money(input.expectedSupplierReturns, "預計供應商退貨", true);
  const budgetAmount = money(input.budgetAmount, "整月預估可採購額度");
  const sourceNote = string(input.sourceNote, "額度來源註記", 500);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO procurement_month_plans (analysis_month, scenario, forecast_revenue, forecast_cost_outflow, target_ending_inventory_cost, opening_inventory_cost, expected_supplier_returns, budget_amount, source_note, created_at, created_by, updated_at, updated_by) VALUES (?, 'neutral', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(analysis_month) DO UPDATE SET forecast_revenue = excluded.forecast_revenue, forecast_cost_outflow = excluded.forecast_cost_outflow, target_ending_inventory_cost = excluded.target_ending_inventory_cost, opening_inventory_cost = excluded.opening_inventory_cost, expected_supplier_returns = excluded.expected_supplier_returns, budget_amount = excluded.budget_amount, source_note = excluded.source_note, updated_at = excluded.updated_at, updated_by = excluded.updated_by"
  ).bind(analysisMonth, forecastRevenue, forecastCostOutflow, targetEndingInventoryCost, openingInventoryCost, expectedSupplierReturns, budgetAmount, sourceNote, now, actor, now, actor).run();
  const row = await env.DB.prepare(
    "SELECT analysis_month, scenario, forecast_revenue, forecast_cost_outflow, target_ending_inventory_cost, opening_inventory_cost, expected_supplier_returns, budget_amount, source_note, updated_at, updated_by FROM procurement_month_plans WHERE analysis_month = ?"
  ).bind(analysisMonth).first<Record<string, unknown>>();
  if (!row) throw new RequestValidationError("本月額度資料儲存失敗。", 503);
  return json({ month: analysisMonth, plan: serializeMonthPlan(row) });
}

function validatedBatch(input: Record<string, unknown>, actor: string) {
  const suggested = money(input.suggestedAmount, "系統建議金額");
  const manual = money(input.manualAmount, "人工回匯金額");
  const blocked = money(input.blockedAmount, "規則阻擋金額");
  const approved = money(input.approvedAmount, "最終核准金額");
  const adjustment = money(input.adjustmentAmount, "人工調整金額", true);
  const currentPayment = money(input.paymentCurrentMonth, "本月預計付款");
  const futurePayments = money(input.paymentFutureMonths, "未來月份付款");
  if (Math.abs((manual - blocked) - approved) >= 0.01) throw new RequestValidationError("人工回匯－阻擋金額不等於最終核准金額。");
  if (Math.abs((suggested + adjustment) - approved) >= 0.01) throw new RequestValidationError("系統建議＋人工調整不等於最終核准金額。");
  if (Math.abs((currentPayment + futurePayments) - approved) >= 0.01) throw new RequestValidationError("付款月份合計不等於最終核准金額。");
  const supplierSummary = JSON.stringify(input.supplierSummary || []);
  const paymentSchedule = JSON.stringify(input.paymentSchedule || []);
  if (supplierSummary.length > 4096 || paymentSchedule.length > 8192) throw new RequestValidationError("供應商或付款摘要過長。");
  const now = new Date().toISOString();
  return {
    id: string(input.batchId, "批次編號", 80), analysisMonth: month(input.analysisMonth), supplierSummary,
    suggested, manual, blocked, approved, adjustment, budget: money(input.budgetAmount, "整月預估額度"),
    currentPayment, futurePayments, paymentSchedule, warning: typeof input.warningSummary === "string" ? input.warningSummary.trim().slice(0, 1024) : "",
    idempotencyKey: string(input.idempotencyKey, "冪等鍵", 120), now, actor
  };
}

async function submit(request: Request, env: ProcurementEnv): Promise<Response> {
  requireSameOrigin(request, env);
  const actor = await verifyCompanyUser(request, procurementAccess(env));
  const item = validatedBatch(await body(request), actor);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO procurement_batches (id, analysis_month, supplier_summary, status, suggested_amount, manual_amount, blocked_amount, approved_amount, adjustment_amount, budget_amount, payment_current_month, payment_future_months, payment_schedule, warning_summary, created_at, created_by, updated_at, idempotency_key) VALUES (?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(item.id, item.analysisMonth, item.supplierSummary, item.suggested, item.manual, item.blocked, item.approved, item.adjustment, item.budget, item.currentPayment, item.futurePayments, item.paymentSchedule, item.warning, item.now, actor, item.now, item.idempotencyKey),
      env.DB.prepare("INSERT INTO procurement_events (batch_id, event_type, amount_before, amount_delta, amount_after, reason, created_at, created_by, idempotency_key) VALUES (?, 'submitted', 0, ?, ?, '第二次回匯完成，待正式核准', ?, ?, ?)")
        .bind(item.id, item.approved, item.approved, item.now, actor, `${item.idempotencyKey}:event`)
    ]);
  } catch (error) {
    const existing = await env.DB.prepare("SELECT id, status FROM procurement_batches WHERE idempotency_key = ?").bind(item.idempotencyKey).first();
    if (existing) return json({ batch: existing, duplicate: true }, 200);
    throw error;
  }
  return json({ batch: { id: item.id, status: "pending_approval" }, duplicate: false }, 201);
}

async function approve(request: Request, env: ProcurementEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const actor = await verifyAdmin(request, { ...procurementAccess(env), ADMIN_EMAILS: ADMIN_EMAIL });
  const input = await body(request);
  const key = string(input.idempotencyKey, "冪等鍵", 120);
  const now = new Date().toISOString();
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE procurement_batches SET status = 'approved', approved_at = ?, approved_by = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND status = 'pending_approval'").bind(now, actor, now, batchId),
    env.DB.prepare("INSERT OR IGNORE INTO procurement_events (batch_id, event_type, amount_before, amount_delta, amount_after, reason, created_at, created_by, idempotency_key) SELECT id, 'approved', 0, approved_amount, approved_amount, '正式核准', ?, ?, ? FROM procurement_batches WHERE id = ? AND status = 'approved' AND approved_at = ? AND approved_by = ?").bind(now, actor, key, batchId, now, actor),
    env.DB.prepare("INSERT OR IGNORE INTO procurement_notifications (batch_id, event_id, event_type, recipient, status, created_at) SELECT ?, id, 'approved', ?, 'pending', ? FROM procurement_events WHERE idempotency_key = ?").bind(batchId, ADMIN_EMAIL, now, key)
  ]);
  if (Number(result[0].meta.changes || 0) === 0) {
    const existing = await env.DB.prepare("SELECT id, status, approved_at, approved_by FROM procurement_batches WHERE id = ?").bind(batchId).first();
    if (!existing) throw new RequestValidationError("找不到採購批次。", 404);
    if (existing.status === "approved") return json({ batch: existing, duplicate: true });
    throw new RequestValidationError("批次狀態已改變，請重新載入。", 409);
  }
  return json({ batch: { id: batchId, status: "approved", approved_at: now, approved_by: actor }, notification: "pending", duplicate: false });
}

function correctionAmounts(input: Record<string, unknown>) {
  const suggested = money(input.suggestedAmount, "系統建議金額");
  const manual = money(input.manualAmount, "人工回匯金額");
  const blocked = money(input.blockedAmount, "規則阻擋金額");
  const approved = money(input.approvedAmount, "更正後核准金額");
  const adjustment = money(input.adjustmentAmount, "人工調整金額", true);
  const currentPayment = money(input.paymentCurrentMonth, "本月預計付款");
  const futurePayments = money(input.paymentFutureMonths, "未來月份付款");
  if (Math.abs((manual - blocked) - approved) >= 0.01) throw new RequestValidationError("人工回匯－阻擋金額不等於更正後核准金額。");
  if (Math.abs((suggested + adjustment) - approved) >= 0.01) throw new RequestValidationError("系統建議＋人工調整不等於更正後核准金額。");
  if (Math.abs((currentPayment + futurePayments) - approved) >= 0.01) throw new RequestValidationError("付款月份合計不等於更正後核准金額。");
  const paymentSchedule = JSON.stringify(input.paymentSchedule || []);
  if (paymentSchedule.length > 8192) throw new RequestValidationError("付款摘要過長。");
  return { suggested, manual, blocked, approved, adjustment, currentPayment, futurePayments, paymentSchedule };
}

async function revoke(request: Request, env: ProcurementEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const actor = await verifyAdmin(request, { ...procurementAccess(env), ADMIN_EMAILS: ADMIN_EMAIL });
  const input = await body(request);
  const reason = string(input.reason, "撤銷原因", 500);
  const key = string(input.idempotencyKey, "冪等鍵", 120);
  const now = new Date().toISOString();
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE procurement_batches SET status = 'revoked', updated_at = ?, revision = revision + 1 WHERE id = ? AND status IN ('approved', 'erp_created')").bind(now, batchId),
    env.DB.prepare("INSERT OR IGNORE INTO procurement_events (batch_id, event_type, amount_before, amount_delta, amount_after, reason, created_at, created_by, idempotency_key) SELECT id, 'revoked', approved_amount, -approved_amount, 0, ?, ?, ?, ? FROM procurement_batches WHERE id = ? AND status = 'revoked' AND updated_at = ?").bind(reason, now, actor, key, batchId, now),
    env.DB.prepare("INSERT OR IGNORE INTO procurement_notifications (batch_id, event_id, event_type, recipient, status, created_at) SELECT ?, id, 'revoked', ?, 'pending', ? FROM procurement_events WHERE idempotency_key = ?").bind(batchId, ADMIN_EMAIL, now, key)
  ]);
  if (Number(result[0].meta.changes || 0) === 0) {
    const duplicate = await env.DB.prepare("SELECT id FROM procurement_events WHERE idempotency_key = ? AND batch_id = ? AND event_type = 'revoked'").bind(key, batchId).first();
    if (duplicate) return json({ batch: { id: batchId, status: "revoked" }, notification: "pending", duplicate: true });
    const existing = await env.DB.prepare("SELECT id, status FROM procurement_batches WHERE id = ?").bind(batchId).first();
    if (!existing) throw new RequestValidationError("找不到採購批次。", 404);
    throw new RequestValidationError("只有已核准或已產生ERP的批次可以撤銷，請重新載入。", 409);
  }
  return json({ batch: { id: batchId, status: "revoked" }, notification: "pending", duplicate: false });
}

async function correct(request: Request, env: ProcurementEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const actor = await verifyAdmin(request, { ...procurementAccess(env), ADMIN_EMAILS: ADMIN_EMAIL });
  const input = await body(request);
  const reason = string(input.reason, "更正原因", 500);
  const key = string(input.idempotencyKey, "冪等鍵", 120);
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new RequestValidationError("更正版本格式錯誤。");
  const values = correctionAmounts(input);
  const now = new Date().toISOString();
  const before = await env.DB.prepare("SELECT approved_amount, status, revision FROM procurement_batches WHERE id = ?").bind(batchId).first<Record<string, unknown>>();
  if (!before) throw new RequestValidationError("找不到採購批次。", 404);
  const existingEvent = await env.DB.prepare("SELECT id FROM procurement_events WHERE idempotency_key = ? AND batch_id = ? AND event_type = 'corrected'").bind(key, batchId).first();
  if (existingEvent) return json({ batch: { id: batchId, status: before.status, revision: before.revision }, notification: "pending", duplicate: true });
  if (!["approved", "erp_created"].includes(String(before.status)) || Number(before.revision) !== expectedRevision) {
    throw new RequestValidationError("批次狀態或版本已改變，請重新載入後再更正。", 409);
  }
  const amountBefore = Number(before.approved_amount);
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE procurement_batches SET suggested_amount = ?, manual_amount = ?, blocked_amount = ?, approved_amount = ?, adjustment_amount = ?, payment_current_month = ?, payment_future_months = ?, payment_schedule = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND status IN ('approved', 'erp_created') AND revision = ?").bind(values.suggested, values.manual, values.blocked, values.approved, values.adjustment, values.currentPayment, values.futurePayments, values.paymentSchedule, now, batchId, expectedRevision),
    env.DB.prepare("INSERT OR IGNORE INTO procurement_events (batch_id, event_type, amount_before, amount_delta, amount_after, reason, created_at, created_by, idempotency_key) SELECT id, 'corrected', ?, ?, ?, ?, ?, ?, ? FROM procurement_batches WHERE id = ? AND updated_at = ? AND revision = ?").bind(amountBefore, values.approved - amountBefore, values.approved, reason, now, actor, key, batchId, now, expectedRevision + 1),
    env.DB.prepare("INSERT OR IGNORE INTO procurement_notifications (batch_id, event_id, event_type, recipient, status, created_at) SELECT ?, id, 'corrected', ?, 'pending', ? FROM procurement_events WHERE idempotency_key = ?").bind(batchId, ADMIN_EMAIL, now, key)
  ]);
  if (Number(result[0].meta.changes || 0) === 0) throw new RequestValidationError("批次已被其他操作更動，請重新載入後再更正。", 409);
  return json({ batch: { id: batchId, status: before.status, revision: expectedRevision + 1, approvedAmount: values.approved }, notification: "pending", duplicate: false });
}

async function markErpCreated(request: Request, env: ProcurementEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const actor = await verifyAdmin(request, { ...procurementAccess(env), ADMIN_EMAILS: ADMIN_EMAIL });
  const input = await body(request);
  const erpReference = string(input.erpReference, "ERP採購單號／確認註記", 120);
  const key = string(input.idempotencyKey, "冪等鍵", 120);
  const now = new Date().toISOString();
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE procurement_batches SET status = 'erp_created', updated_at = ?, revision = revision + 1 WHERE id = ? AND status = 'approved'").bind(now, batchId),
    env.DB.prepare("INSERT OR IGNORE INTO procurement_events (batch_id, event_type, amount_before, amount_delta, amount_after, reason, created_at, created_by, idempotency_key) SELECT id, 'erp_created', approved_amount, 0, approved_amount, ?, ?, ?, ? FROM procurement_batches WHERE id = ? AND status = 'erp_created' AND updated_at = ?").bind(`ERP確認：${erpReference}`, now, actor, key, batchId, now)
  ]);
  if (Number(result[0].meta.changes || 0) === 0) {
    const duplicate = await env.DB.prepare("SELECT id FROM procurement_events WHERE idempotency_key = ? AND batch_id = ? AND event_type = 'erp_created'").bind(key, batchId).first();
    if (duplicate) return json({ batch: { id: batchId, status: "erp_created" }, duplicate: true });
    const existing = await env.DB.prepare("SELECT id, status FROM procurement_batches WHERE id = ?").bind(batchId).first();
    if (!existing) throw new RequestValidationError("找不到採購批次。", 404);
    throw new RequestValidationError("只有已核准、尚未建立ERP的批次可以確認，請重新載入。", 409);
  }
  return json({ batch: { id: batchId, status: "erp_created" }, duplicate: false });
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function notify(request: Request, env: ProcurementEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  await verifyAdmin(request, { ...procurementAccess(env), ADMIN_EMAILS: ADMIN_EMAIL });
  const token = request.headers.get("X-Google-Access-Token") || "";
  if (!token || token.length > 4096) throw new RequestValidationError("需要重新完成公司 Google 授權。", 401);
  const identityResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token}` } });
  const identity = identityResponse.ok ? await identityResponse.json<{ email?: string }>() : {};
  if ((identity.email || "").toLocaleLowerCase("en-US") !== ADMIN_EMAIL) throw new RequestValidationError("寄信授權帳號必須是 siang01。", 403);
  const row = await env.DB.prepare("SELECT n.id notification_id, n.event_type, n.retry_count, e.amount_before event_amount_before, e.amount_delta event_amount_delta, e.amount_after event_amount_after, e.reason event_reason, e.created_at event_created_at, e.created_by event_created_by, b.* FROM procurement_notifications n JOIN procurement_events e ON e.id = n.event_id JOIN procurement_batches b ON b.id = n.batch_id WHERE n.batch_id = ? AND n.status != 'sent' ORDER BY n.id DESC LIMIT 1").bind(batchId).first<Record<string, unknown>>();
  if (!row) return json({ status: "sent_or_not_required" });
  const eventLabels: Record<string, string> = { approved: "正式核准", revoked: "核准撤銷", corrected: "核准更正" };
  const eventLabel = eventLabels[String(row.event_type)] || "額度異動";
  const amountBefore = Number(row.event_amount_before || 0);
  const amountAfter = Number(row.event_amount_after || 0);
  const monthTotals = await env.DB.prepare("SELECT COALESCE(SUM(approved_amount), 0) committed_amount, COALESCE(SUM(payment_current_month), 0) current_payment, COALESCE(SUM(payment_future_months), 0) future_payments FROM procurement_batches WHERE analysis_month = ? AND status IN ('approved', 'erp_created', 'received')").bind(row.analysis_month).first<Record<string, unknown>>();
  const eventDelta = Number(row.event_amount_delta || 0);
  const committedAfter = Number(monthTotals?.committed_amount || 0);
  const committedBefore = committedAfter - eventDelta;
  const remainingBefore = Number(row.budget_amount) - committedBefore;
  const remainingAfter = Number(row.budget_amount) - committedAfter;
  const currentPayment = Number(monthTotals?.current_payment || 0);
  const futurePayments = Number(monthTotals?.future_payments || 0);
  const usageRate = Number(row.budget_amount) > 0 ? committedAfter / Number(row.budget_amount) * 100 : 0;
  const subject = `[翔仔居家採購] ${eventLabel}｜${batchId}`;
  const message = [
    `From: ${ADMIN_EMAIL}`, `To: ${ADMIN_EMAIL}`, `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    "Content-Type: text/plain; charset=UTF-8", "", `翔仔居家採購${eventLabel}摘要`, `批次編號：${batchId}`,
    `供應商：${(parseJsonText(String(row.supplier_summary)) as string[] || []).join("、") || "未提供"}`,
    `核准人：${String(row.approved_by || "")}`, `核准時間：${String(row.approved_at || "")}`,
    `系統建議金額：${Number(row.suggested_amount).toFixed(2)}`, `人工回匯採購總額：${Number(row.manual_amount).toFixed(2)}`,
    `規則阻擋金額：${Number(row.blocked_amount).toFixed(2)}`, `異動前承諾金額：${amountBefore.toFixed(2)}`,
    `本次額度增減：${eventDelta.toFixed(2)}`, `異動後承諾金額：${amountAfter.toFixed(2)}`,
    `異動原因：${String(row.event_reason || "未提供")}`, `異動人：${String(row.event_created_by || "")}`, `異動時間：${String(row.event_created_at || "")}`,
    `異動前尚可承諾：${remainingBefore.toFixed(2)}`, `異動後尚可承諾：${remainingAfter.toFixed(2)}`,
    `中性情境－整月預估可採購額度：${Number(row.budget_amount).toFixed(2)}`,
    `本月累計已承諾採購金額：${committedAfter.toFixed(2)}`, `目前額度使用率：${usageRate.toFixed(2)}%`,
    `本月預計付款：${currentPayment.toFixed(2)}`, `下月以後已承諾付款：${futurePayments.toFixed(2)}`,
    `警示：${String(row.warning_summary || "無")}`
  ].join("\r\n");
  const send = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encodeBase64Url(message) })
  });
  const response = await send.json<{ id?: string; error?: { message?: string } }>();
  const now = new Date().toISOString();
  if (send.ok && response.id) {
    await env.DB.prepare("UPDATE procurement_notifications SET status = 'sent', provider_message_id = ?, retry_count = retry_count + 1, last_attempt_at = ?, sent_at = ?, error_summary = NULL WHERE id = ?").bind(response.id, now, now, row.notification_id).run();
    return json({ status: "sent", sentAt: now });
  }
  const error = String(response.error?.message || `Gmail HTTP ${send.status}`).slice(0, 500);
  await env.DB.prepare("UPDATE procurement_notifications SET status = 'failed', retry_count = retry_count + 1, last_attempt_at = ?, error_summary = ? WHERE id = ?").bind(now, error, row.notification_id).run();
  return json({ status: "failed", error }, 502);
}

export async function procurementRoute(request: Request, env: ProcurementEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/procurement")) return null;
  if (url.pathname === "/api/procurement/config" && request.method === "GET") return config(request, env);
  if (url.pathname === "/api/procurement/ledger" && request.method === "GET") return ledger(request, env);
  if (url.pathname === "/api/procurement/month-plan" && request.method === "GET") return monthPlan(request, env);
  if (url.pathname === "/api/procurement/month-plan" && request.method === "PUT") return saveMonthPlan(request, env);
  if (url.pathname === "/api/procurement/batches" && request.method === "POST") return submit(request, env);
  const approveMatch = url.pathname.match(/^\/api\/procurement\/batches\/([^/]+)\/approve$/);
  if (approveMatch && request.method === "POST") return approve(request, env, decodeURIComponent(approveMatch[1]));
  const revokeMatch = url.pathname.match(/^\/api\/procurement\/batches\/([^/]+)\/revoke$/);
  if (revokeMatch && request.method === "POST") return revoke(request, env, decodeURIComponent(revokeMatch[1]));
  const correctMatch = url.pathname.match(/^\/api\/procurement\/batches\/([^/]+)\/correct$/);
  if (correctMatch && request.method === "POST") return correct(request, env, decodeURIComponent(correctMatch[1]));
  const erpMatch = url.pathname.match(/^\/api\/procurement\/batches\/([^/]+)\/erp-created$/);
  if (erpMatch && request.method === "POST") return markErpCreated(request, env, decodeURIComponent(erpMatch[1]));
  const notifyMatch = url.pathname.match(/^\/api\/procurement\/batches\/([^/]+)\/notify$/);
  if (notifyMatch && request.method === "POST") return notify(request, env, decodeURIComponent(notifyMatch[1]));
  return json({ error: "不支援此方法或路徑。" }, 405);
}

export async function cleanupNotifications(env: ProcurementEnv): Promise<void> {
  const setting = await env.DB.prepare("SELECT notification_retention_months FROM procurement_settings WHERE id = 1").first<{ notification_retention_months: number }>();
  const months = Math.max(1, Math.min(12, Number(setting?.notification_retention_months || 12)));
  await env.DB.prepare("DELETE FROM procurement_notifications WHERE created_at < datetime('now', ?)").bind(`-${months} months`).run();
}

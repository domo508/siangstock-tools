import { verifyAdmin, verifyCompanyUser, type AccessConfig } from "./access";
import { RequestValidationError } from "./schema";
import { FIXED_SOURCES } from "./fixed-sources";

type ProcurementEnv = AccessConfig & { DB: D1Database; ALLOWED_ORIGINS: string; GOOGLE_OAUTH_CLIENT_ID?: string; PROCUREMENT_ACCESS_AUD?: string };

const ADMIN_EMAIL = "siang01@siangapato.com.tw";
const MAX_SUMMARY_BYTES = 16384;
const SUPPLIERS = Object.freeze([
  ["家禾", "domestic", 40], ["上林", "domestic", 5], ["力榮", "domestic", 14],
  ["普優瑪寢具有限公司", "domestic", 5], ["歐必斯", "domestic", 10], ["昭元棉業", "domestic", 50],
  ["尚美", "domestic", 7], ["超越嗅覺", "domestic", 40], ["凱信達", "foreign", 70],
  ["寧波同一", "foreign", 70], ["潤泰羽絨", "foreign", 70], ["泰能脊康", "foreign", 70],
  ["逸寐", "foreign", 70], ["特娜鞋業", "foreign", 30], ["南通（小霞）包裝", "foreign", 30],
  ["禾鑫匠月", "foreign", 14]
].map(([name, country, leadDays]) => ({ name, country, leadDays })));

type ProcurementRole = "admin" | "approver" | "operator";

type ProcurementSettings = {
  notificationRecipient: string;
  retentionMonths: number;
  approverEmails: string[];
  notificationEvents: string[];
};

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

function normalizedCompanyEmails(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) throw new RequestValidationError("帳號清單格式錯誤。");
  const emails = value.map((item) => String(item || "").trim().toLocaleLowerCase("en-US"));
  if (emails.some((email) => !/^[^@\s]+@siangapato\.com\.tw$/.test(email))) throw new RequestValidationError("帳號必須是 siangapato.com.tw 公司信箱。");
  return [...new Set(emails)];
}

async function readProcurementSettings(env: ProcurementEnv): Promise<ProcurementSettings> {
  const row = await env.DB.prepare("SELECT notification_recipient, notification_retention_months, approver_emails, notification_events FROM procurement_settings WHERE id = 1").first<Record<string, unknown>>();
  const approvers = parseJsonText(String(row?.approver_emails || "[]"));
  const events = parseJsonText(String(row?.notification_events || "[]"));
  return {
    notificationRecipient: String(row?.notification_recipient || ADMIN_EMAIL).toLocaleLowerCase("en-US"),
    retentionMonths: Math.max(1, Math.min(12, Number(row?.notification_retention_months || 12))),
    approverEmails: Array.isArray(approvers) ? approvers.map(String).map((email) => email.toLocaleLowerCase("en-US")) : [],
    notificationEvents: Array.isArray(events) ? events.map(String) : ["approved", "revoked", "corrected"]
  };
}

function roleFor(email: string, settings: ProcurementSettings): ProcurementRole {
  if (email === ADMIN_EMAIL) return "admin";
  if (settings.approverEmails.includes(email)) return "approver";
  return "operator";
}

async function verifyApprover(request: Request, env: ProcurementEnv): Promise<{ email: string; role: ProcurementRole; settings: ProcurementSettings }> {
  const email = await verifyCompanyUser(request, procurementAccess(env));
  const settings = await readProcurementSettings(env);
  const role = roleFor(email, settings);
  if (role === "operator") throw new RequestValidationError("此帳號沒有核准或規則管理權限。", 403);
  return { email, role, settings };
}

function validateProcurementRules(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestValidationError("採購規則必須是物件。");
  const rules = value as Record<string, unknown>;
  if (rules.springFestival == null) rules.springFestival = { enabled: true, closureStart: "2027-01-16", recoveryDate: "2027-02-28", extraDays: 53 };
  const allowed = ["suppliers", "featuredSuppliers", "consignment", "purchaseUnits", "storeInventory", "blacklist", "springFestival"];
  const extras = Object.keys(rules).filter((key) => !allowed.includes(key));
  if (extras.length) throw new RequestValidationError(`採購規則含未知欄位：${extras.join("、")}。`);
  if (!Array.isArray(rules.suppliers) || rules.suppliers.length > 100) throw new RequestValidationError("供應商規則格式錯誤。");
  if (!Array.isArray(rules.featuredSuppliers) || rules.featuredSuppliers.length > 20) throw new RequestValidationError("主要供應商顯示名單格式錯誤。");
  if (!Array.isArray(rules.purchaseUnits) || rules.purchaseUnits.length > 300) throw new RequestValidationError("採購單位規則格式錯誤。");
  if (!Array.isArray(rules.blacklist) || rules.blacklist.length > 1000) throw new RequestValidationError("黑名單格式錯誤。");
  if (!rules.consignment || typeof rules.consignment !== "object" || Array.isArray(rules.consignment)) throw new RequestValidationError("寄庫規則格式錯誤。");
  if (!rules.storeInventory || typeof rules.storeInventory !== "object" || Array.isArray(rules.storeInventory)) throw new RequestValidationError("門市庫存規則格式錯誤。");
  if (!rules.springFestival || typeof rules.springFestival !== "object" || Array.isArray(rules.springFestival)) throw new RequestValidationError("國外供應商春節備貨規則格式錯誤。");
  const springFestival = rules.springFestival as Record<string, unknown>;
  if (typeof springFestival.enabled !== "boolean") throw new RequestValidationError("春節備貨啟用狀態格式錯誤。");
  const validDate = (date: unknown) => {
    const text = String(date || "");
    const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : Number.NaN;
    return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text;
  };
  if (!validDate(springFestival.closureStart) || !validDate(springFestival.recoveryDate)) throw new RequestValidationError("春節停工與恢復出貨日須為有效日期。");
  if (String(springFestival.closureStart) > String(springFestival.recoveryDate)) throw new RequestValidationError("春節停工開始日不可晚於恢復出貨日。");
  if (!Number.isInteger(Number(springFestival.extraDays)) || Number(springFestival.extraDays) < 45 || Number(springFestival.extraDays) > 60) throw new RequestValidationError("春節額外備貨天數須為45至60天的整數。");
  for (const supplier of rules.suppliers as Record<string, unknown>[]) {
    if (!supplier || typeof supplier !== "object" || !String(supplier.name || "").trim()) throw new RequestValidationError("供應商名稱不可空白。");
    if (!["國內", "國外"].includes(String(supplier.country))) throw new RequestValidationError("供應商國別只能是國內或國外。");
    if (!Number.isFinite(Number(supplier.leadDays)) || Number(supplier.leadDays) < 0 || Number(supplier.leadDays) > 365) throw new RequestValidationError("平均採購週期必須介於0至365天。");
    const reviewText = String(supplier.reviewDays ?? "").trim();
    const reviewRange = reviewText.match(/^(\d+(?:\.\d+)?)\s*[-～~]\s*(\d+(?:\.\d+)?)$/);
    const reviewValid = reviewRange
      ? Number(reviewRange[1]) >= 0 && Number(reviewRange[2]) >= Number(reviewRange[1]) && Number(reviewRange[2]) <= 365
      : Number.isFinite(Number(reviewText)) && Number(reviewText) >= 0 && Number(reviewText) <= 365;
    if (!reviewValid) throw new RequestValidationError("檢視期須為0至365天，或有效區間（例如90-120）。");
  }
  const supplierNames = new Set((rules.suppliers as Record<string, unknown>[]).map((supplier) => String(supplier.name || "").trim()));
  const featuredSuppliers = (rules.featuredSuppliers as unknown[]).map((supplier) => String(supplier || "").trim());
  if (featuredSuppliers.some((supplier) => !supplier || !supplierNames.has(supplier))) throw new RequestValidationError("主要供應商顯示名單只能選擇已建立的供應商。");
  if (new Set(featuredSuppliers).size !== featuredSuppliers.length) throw new RequestValidationError("主要供應商顯示名單不可重複。");
  rules.featuredSuppliers = featuredSuppliers;
  for (const unit of rules.purchaseUnits as Record<string, unknown>[]) {
    if (!String(unit.supplier || "").trim() || !String(unit.ruleName || "").trim()) throw new RequestValidationError("採購單位的供應商與規則名稱不可空白。");
    if (unit.quantity !== null && unit.quantity !== "" && (!Number.isInteger(Number(unit.quantity)) || Number(unit.quantity) < 1 || Number(unit.quantity) > 10000)) throw new RequestValidationError("箱入／採購單位須留白或填1至10000的整數。");
  }
  const encoded = JSON.stringify(rules);
  if (new TextEncoder().encode(encoded).byteLength > 60000) throw new RequestValidationError("採購規則超過60 KB上限。", 413);
  return JSON.parse(encoded) as Record<string, unknown>;
}

async function config(request: Request, env: ProcurementEnv): Promise<Response> {
  const email = await verifyCompanyUser(request, procurementAccess(env));
  const settings = await readProcurementSettings(env);
  const role = roleFor(email, settings);
  return json({
    email,
    role,
    googleOAuthClientId: env.GOOGLE_OAUTH_CLIENT_ID || "",
    fixedSources: FIXED_SOURCES,
    suppliers: SUPPLIERS,
    notification: role === "admin"
      ? { recipient: settings.notificationRecipient, retentionMonths: settings.retentionMonths, events: settings.notificationEvents }
      : { enabled: true, recipient: settings.notificationRecipient },
    permissions: { canApprove: role === "admin" || role === "approver", canManageRules: role === "admin" || role === "approver", canManageAccess: role === "admin", canManageBudget: role === "admin" }
  });
}

async function procurementRules(request: Request, env: ProcurementEnv): Promise<Response> {
  await verifyCompanyUser(request, procurementAccess(env));
  const row = await env.DB.prepare("SELECT version, payload, updated_at, updated_by FROM procurement_rules_current WHERE id = 1").first<Record<string, unknown>>();
  if (!row) throw new RequestValidationError("採購規則尚未初始化。", 503);
  return json({ version: Number(row.version), updatedAt: String(row.updated_at), updatedBy: String(row.updated_by), rules: validateProcurementRules(parseJsonText(String(row.payload))) });
}

async function saveProcurementRules(request: Request, env: ProcurementEnv): Promise<Response> {
  requireSameOrigin(request, env);
  const { email } = await verifyApprover(request, env);
  const input = await body(request);
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new RequestValidationError("規則版本格式錯誤。");
  const changeReason = string(input.changeReason, "修改原因", 500);
  const rules = validateProcurementRules(input.rules);
  const payload = JSON.stringify(rules);
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE procurement_rules_current SET version = version + 1, payload = ?, updated_at = ?, updated_by = ? WHERE id = 1 AND version = ? RETURNING version").bind(payload, now, email, expectedVersion).first<{ version: number }>();
  if (!result) throw new RequestValidationError("規則已被其他同事更新，請重新載入最新版。", 409);
  await env.DB.prepare("INSERT INTO procurement_rules_history (version, payload, change_reason, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)").bind(result.version, payload, changeReason, now, email).run();
  return json({ version: result.version, updatedAt: now, updatedBy: email, rules });
}

async function accessSettings(request: Request, env: ProcurementEnv): Promise<Response> {
  const actor = await verifyAdmin(request, { ...procurementAccess(env), ADMIN_EMAILS: ADMIN_EMAIL });
  const settings = await readProcurementSettings(env);
  return json({ ...settings, adminEmail: ADMIN_EMAIL, updatedBy: actor });
}

async function saveAccessSettings(request: Request, env: ProcurementEnv): Promise<Response> {
  requireSameOrigin(request, env);
  const actor = await verifyAdmin(request, { ...procurementAccess(env), ADMIN_EMAILS: ADMIN_EMAIL });
  const input = await body(request);
  const approverEmails = normalizedCompanyEmails(input.approverEmails);
  const recipient = normalizedCompanyEmails([input.notificationRecipient])[0];
  const retentionMonths = Number(input.retentionMonths);
  if (!Number.isInteger(retentionMonths) || retentionMonths < 1 || retentionMonths > 12) throw new RequestValidationError("通知紀錄保留月數須介於1至12個月。");
  const events = Array.isArray(input.notificationEvents) ? input.notificationEvents.map(String) : [];
  if (events.some((event) => !["approved", "revoked", "corrected"].includes(event))) throw new RequestValidationError("通知事件格式錯誤。");
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE procurement_settings SET notification_recipient = ?, notification_retention_months = ?, approver_emails = ?, notification_events = ?, updated_at = ?, updated_by = ? WHERE id = 1").bind(recipient, retentionMonths, JSON.stringify(approverEmails), JSON.stringify([...new Set(events)]), now, actor).run();
  return json({ notificationRecipient: recipient, retentionMonths, approverEmails, notificationEvents: [...new Set(events)], adminEmail: ADMIN_EMAIL, updatedAt: now, updatedBy: actor });
}

async function ledger(request: Request, env: ProcurementEnv): Promise<Response> {
  await verifyCompanyUser(request, procurementAccess(env));
  const requestedMonth = month(new URL(request.url).searchParams.get("month"));
  const rows = await env.DB.prepare(
    "SELECT id, analysis_month, workflow_type, erp_reference, supplier_summary, status, suggested_amount, manual_amount, blocked_amount, approved_amount, adjustment_amount, budget_amount, payment_current_month, payment_future_months, payment_schedule, warning_summary, created_at, created_by, approved_at, approved_by, updated_at, revision FROM procurement_batches WHERE analysis_month = ? ORDER BY updated_at DESC LIMIT 200"
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
  const revenueChannels = parseJsonText(String(row.revenue_channels || "[]")) || [];
  const terminalForecastRevenue = Array.isArray(revenueChannels)
    ? revenueChannels.reduce((sum, item) => sum + Number(item && typeof item === "object" ? (item as Record<string, unknown>).amount || 0 : 0), 0)
    : 0;
  return {
    analysisMonth: String(row.analysis_month),
    scenario: String(row.scenario),
    forecastRevenue: Number(row.forecast_revenue),
    forecastCostOutflow: Number(row.forecast_cost_outflow),
    targetEndingInventoryCost: Number(row.target_ending_inventory_cost),
    openingInventoryCost: Number(row.opening_inventory_cost),
    expectedSupplierReturns: Number(row.expected_supplier_returns),
    fullBudgetAmount: Number(row.full_budget_amount),
    releasedBudgetAmount: Number(row.budget_amount),
    budgetAmount: Number(row.budget_amount),
    terminalForecastRevenue: Math.round(terminalForecastRevenue * 100) / 100,
    revenueChannels,
    sourceNote: String(row.source_note),
    updatedAt: String(row.updated_at),
    updatedBy: String(row.updated_by)
  };
}

async function monthPlan(request: Request, env: ProcurementEnv): Promise<Response> {
  await verifyCompanyUser(request, procurementAccess(env));
  const requestedMonth = month(new URL(request.url).searchParams.get("month"));
  const row = await env.DB.prepare(
    "SELECT analysis_month, scenario, forecast_revenue, forecast_cost_outflow, target_ending_inventory_cost, opening_inventory_cost, expected_supplier_returns, budget_amount, full_budget_amount, revenue_channels, source_note, updated_at, updated_by FROM procurement_month_plans WHERE analysis_month = ?"
  ).bind(requestedMonth).first<Record<string, unknown>>();
  return json({ month: requestedMonth, plan: row ? serializeMonthPlan(row) : null });
}

async function saveMonthPlan(request: Request, env: ProcurementEnv): Promise<Response> {
  requireSameOrigin(request, env);
  const actor = await verifyAdmin(request, { ...procurementAccess(env), ADMIN_EMAILS: ADMIN_EMAIL });
  const input = await body(request);
  const analysisMonth = month(input.analysisMonth);
  const revenueChannels = Array.isArray(input.revenueChannels) ? input.revenueChannels : [];
  if (revenueChannels.length > 100) throw new RequestValidationError("通路營收明細最多100列。");
  const normalizedChannels = revenueChannels.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new RequestValidationError("通路營收明細格式錯誤。");
    const item = row as Record<string, unknown>;
    const company = string(item.company, "公司", 20);
    if (!["寬承", "寬沐"].includes(company)) throw new RequestValidationError("公司只能選寬承或寬沐。");
    return { company, channel: string(item.channel, "通路名稱", 80), amount: money(item.amount, "通路預估營收") };
  });
  const forecastRevenue = money(input.forecastRevenue, "寬承預估認列營收");
  const forecastCostOutflow = money(input.forecastCostOutflow, "整月預估成本耗用");
  const targetEndingInventoryCost = money(input.targetEndingInventoryCost, "目標期末庫存成本");
  const openingInventoryCost = money(input.openingInventoryCost, "期初庫存成本");
  const expectedSupplierReturns = money(input.expectedSupplierReturns, "預計供應商退貨", true);
  const fullBudgetAmount = money(input.fullBudgetAmount, "整月預估可採購額度");
  const releasedBudgetAmount = money(input.releasedBudgetAmount, "目前已釋放可採購額度");
  const sourceNote = string(input.sourceNote, "額度來源註記", 500);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO procurement_month_plans (analysis_month, scenario, forecast_revenue, forecast_cost_outflow, target_ending_inventory_cost, opening_inventory_cost, expected_supplier_returns, budget_amount, full_budget_amount, revenue_channels, source_note, created_at, created_by, updated_at, updated_by) VALUES (?, 'neutral', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(analysis_month) DO UPDATE SET forecast_revenue = excluded.forecast_revenue, forecast_cost_outflow = excluded.forecast_cost_outflow, target_ending_inventory_cost = excluded.target_ending_inventory_cost, opening_inventory_cost = excluded.opening_inventory_cost, expected_supplier_returns = excluded.expected_supplier_returns, budget_amount = excluded.budget_amount, full_budget_amount = excluded.full_budget_amount, revenue_channels = excluded.revenue_channels, source_note = excluded.source_note, updated_at = excluded.updated_at, updated_by = excluded.updated_by"
  ).bind(analysisMonth, forecastRevenue, forecastCostOutflow, targetEndingInventoryCost, openingInventoryCost, expectedSupplierReturns, releasedBudgetAmount, fullBudgetAmount, JSON.stringify(normalizedChannels), sourceNote, now, actor, now, actor).run();
  const row = await env.DB.prepare(
    "SELECT analysis_month, scenario, forecast_revenue, forecast_cost_outflow, target_ending_inventory_cost, opening_inventory_cost, expected_supplier_returns, budget_amount, full_budget_amount, revenue_channels, source_note, updated_at, updated_by FROM procurement_month_plans WHERE analysis_month = ?"
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
  const workflowType = typeof input.workflowType === "string" ? input.workflowType.trim() : "system_recommendation";
  if (!["system_recommendation", "new_product", "manual_draft", "manual_posted", "customer_custom"].includes(workflowType)) throw new RequestValidationError("採購流程類型錯誤。");
  return {
    id: string(input.batchId, "批次編號", 80), analysisMonth: month(input.analysisMonth), supplierSummary,
    suggested, manual, blocked, approved, adjustment, budget: money(input.budgetAmount, "整月預估額度"),
    currentPayment, futurePayments, paymentSchedule, warning: typeof input.warningSummary === "string" ? input.warningSummary.trim().slice(0, 1024) : "",
    idempotencyKey: string(input.idempotencyKey, "冪等鍵", 120), workflowType, now, actor
  };
}

async function submit(request: Request, env: ProcurementEnv): Promise<Response> {
  requireSameOrigin(request, env);
  const actor = await verifyCompanyUser(request, procurementAccess(env));
  const item = validatedBatch(await body(request), actor);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO procurement_batches (id, analysis_month, workflow_type, supplier_summary, status, suggested_amount, manual_amount, blocked_amount, approved_amount, adjustment_amount, budget_amount, payment_current_month, payment_future_months, payment_schedule, warning_summary, created_at, created_by, updated_at, idempotency_key) VALUES (?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(item.id, item.analysisMonth, item.workflowType, item.supplierSummary, item.suggested, item.manual, item.blocked, item.approved, item.adjustment, item.budget, item.currentPayment, item.futurePayments, item.paymentSchedule, item.warning, item.now, actor, item.now, item.idempotencyKey),
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

async function importManualOrder(request: Request, env: ProcurementEnv): Promise<Response> {
  requireSameOrigin(request, env);
  const access = await verifyApprover(request, env);
  const input = await body(request);
  const item = validatedBatch(input, access.email);
  if (!["manual_posted", "customer_custom"].includes(item.workflowType)) throw new RequestValidationError("補登流程類型錯誤。");
  const erpReference = string(input.erpReference, "ERP採購單號", 120);
  const existing = await env.DB.prepare("SELECT id, status, workflow_type, erp_reference FROM procurement_batches WHERE erp_reference = ? OR idempotency_key = ?").bind(erpReference, item.idempotencyKey).first<Record<string, unknown>>();
  if (existing) return json({ batch: existing, duplicate: true, notification: "sent_or_not_required" });
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO procurement_batches (id, analysis_month, workflow_type, erp_reference, supplier_summary, status, suggested_amount, manual_amount, blocked_amount, approved_amount, adjustment_amount, budget_amount, payment_current_month, payment_future_months, payment_schedule, warning_summary, created_at, created_by, approved_at, approved_by, updated_at, revision, idempotency_key) VALUES (?, ?, ?, ?, ?, 'erp_created', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?)")
        .bind(item.id, item.analysisMonth, item.workflowType, erpReference, item.supplierSummary, item.suggested, item.manual, item.blocked, item.approved, item.adjustment, item.budget, item.currentPayment, item.futurePayments, item.paymentSchedule, item.warning, item.now, access.email, item.now, access.email, item.now, item.idempotencyKey),
      env.DB.prepare("INSERT INTO procurement_events (batch_id, event_type, amount_before, amount_delta, amount_after, reason, created_at, created_by, idempotency_key) VALUES (?, 'approved', 0, ?, ?, ?, ?, ?, ?)")
        .bind(item.id, item.approved, item.approved, item.workflowType === "customer_custom" ? "未到貨清單自動辨識客製採購並補登" : "補登已建立ERP採購單", item.now, access.email, `${item.idempotencyKey}:approved`),
      env.DB.prepare("INSERT INTO procurement_events (batch_id, event_type, amount_before, amount_delta, amount_after, reason, created_at, created_by, idempotency_key) VALUES (?, 'erp_created', ?, 0, ?, ?, ?, ?, ?)")
        .bind(item.id, item.approved, item.approved, `ERP確認：${erpReference}`, item.now, access.email, `${item.idempotencyKey}:erp`),
      env.DB.prepare("INSERT INTO procurement_notifications (batch_id, event_id, event_type, recipient, status, created_at) SELECT ?, id, 'approved', ?, 'pending', ? FROM procurement_events WHERE idempotency_key = ?")
        .bind(item.id, access.settings.notificationRecipient, item.now, `${item.idempotencyKey}:approved`)
    ]);
  } catch (error) {
    const duplicate = await env.DB.prepare("SELECT id, status, workflow_type, erp_reference FROM procurement_batches WHERE erp_reference = ? OR idempotency_key = ?").bind(erpReference, item.idempotencyKey).first<Record<string, unknown>>();
    if (duplicate) return json({ batch: duplicate, duplicate: true, notification: "sent_or_not_required" });
    throw error;
  }
  return json({ batch: { id: item.id, status: "erp_created", workflow_type: item.workflowType, erp_reference: erpReference }, duplicate: false, notification: "pending" }, 201);
}

async function approve(request: Request, env: ProcurementEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const access = await verifyApprover(request, env);
  const actor = access.email;
  const input = await body(request);
  const key = string(input.idempotencyKey, "冪等鍵", 120);
  const now = new Date().toISOString();
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE procurement_batches SET status = 'approved', approved_at = ?, approved_by = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND status = 'pending_approval'").bind(now, actor, now, batchId),
    env.DB.prepare("INSERT OR IGNORE INTO procurement_events (batch_id, event_type, amount_before, amount_delta, amount_after, reason, created_at, created_by, idempotency_key) SELECT id, 'approved', 0, approved_amount, approved_amount, '正式核准', ?, ?, ? FROM procurement_batches WHERE id = ? AND status = 'approved' AND approved_at = ? AND approved_by = ?").bind(now, actor, key, batchId, now, actor),
    env.DB.prepare("INSERT OR IGNORE INTO procurement_notifications (batch_id, event_id, event_type, recipient, status, created_at) SELECT ?, id, 'approved', ?, 'pending', ? FROM procurement_events WHERE idempotency_key = ?").bind(batchId, access.settings.notificationRecipient, now, key)
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
  const settings = await readProcurementSettings(env);
  const input = await body(request);
  const reason = string(input.reason, "撤銷原因", 500);
  const key = string(input.idempotencyKey, "冪等鍵", 120);
  const now = new Date().toISOString();
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE procurement_batches SET status = 'revoked', updated_at = ?, revision = revision + 1 WHERE id = ? AND status IN ('approved', 'erp_created')").bind(now, batchId),
    env.DB.prepare("INSERT OR IGNORE INTO procurement_events (batch_id, event_type, amount_before, amount_delta, amount_after, reason, created_at, created_by, idempotency_key) SELECT id, 'revoked', approved_amount, -approved_amount, 0, ?, ?, ?, ? FROM procurement_batches WHERE id = ? AND status = 'revoked' AND updated_at = ?").bind(reason, now, actor, key, batchId, now),
    env.DB.prepare("INSERT OR IGNORE INTO procurement_notifications (batch_id, event_id, event_type, recipient, status, created_at) SELECT ?, id, 'revoked', ?, 'pending', ? FROM procurement_events WHERE idempotency_key = ?").bind(batchId, settings.notificationRecipient, now, key)
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
  const settings = await readProcurementSettings(env);
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
    env.DB.prepare("INSERT OR IGNORE INTO procurement_notifications (batch_id, event_id, event_type, recipient, status, created_at) SELECT ?, id, 'corrected', ?, 'pending', ? FROM procurement_events WHERE idempotency_key = ?").bind(batchId, settings.notificationRecipient, now, key)
  ]);
  if (Number(result[0].meta.changes || 0) === 0) throw new RequestValidationError("批次已被其他操作更動，請重新載入後再更正。", 409);
  return json({ batch: { id: batchId, status: before.status, revision: expectedRevision + 1, approvedAmount: values.approved }, notification: "pending", duplicate: false });
}

async function markErpCreated(request: Request, env: ProcurementEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const { email: actor } = await verifyApprover(request, env);
  const input = await body(request);
  const erpReference = string(input.erpReference, "ERP採購單號／確認註記", 120);
  const duplicateReference = await env.DB.prepare("SELECT id, status FROM procurement_batches WHERE erp_reference = ? AND id != ?").bind(erpReference, batchId).first<Record<string, unknown>>();
  if (duplicateReference) throw new RequestValidationError(`ERP採購單號已由批次${String(duplicateReference.id)}登錄，禁止重複占額。`, 409);
  const key = string(input.idempotencyKey, "冪等鍵", 120);
  const now = new Date().toISOString();
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE procurement_batches SET status = 'erp_created', erp_reference = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND status = 'approved'").bind(erpReference, now, batchId),
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
  const access = await verifyApprover(request, env);
  const token = request.headers.get("X-Google-Access-Token") || "";
  if (!token || token.length > 4096) throw new RequestValidationError("需要重新完成公司 Google 授權。", 401);
  const identityResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token}` } });
  const identity = identityResponse.ok ? await identityResponse.json<{ email?: string }>() : {};
  const sender = (identity.email || "").toLocaleLowerCase("en-US");
  if (sender !== access.email) throw new RequestValidationError("Google 授權帳號必須與目前公司登入帳號相同。", 403);
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
    `From: ${sender}`, `To: ${String(row.recipient || access.settings.notificationRecipient)}`, `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    "Content-Type: text/plain; charset=UTF-8", "", `翔仔居家採購${eventLabel}摘要`, `批次編號：${batchId}`,
    `供應商：${(parseJsonText(String(row.supplier_summary)) as string[] || []).join("、") || "未提供"}`,
    `核准人：${String(row.approved_by || "")}`, `核准時間：${String(row.approved_at || "")}`,
    `系統建議金額：${Number(row.suggested_amount).toFixed(2)}`, `人工回匯採購總額：${Number(row.manual_amount).toFixed(2)}`,
    `規則阻擋金額：${Number(row.blocked_amount).toFixed(2)}`, `異動前承諾金額：${amountBefore.toFixed(2)}`,
    `本次額度增減：${eventDelta.toFixed(2)}`, `異動後承諾金額：${amountAfter.toFixed(2)}`,
    `異動原因：${String(row.event_reason || "未提供")}`, `異動人：${String(row.event_created_by || "")}`, `異動時間：${String(row.event_created_at || "")}`,
    `異動前尚可承諾：${remainingBefore.toFixed(2)}`, `異動後尚可承諾：${remainingAfter.toFixed(2)}`,
    `目前已釋放可採購額度：${Number(row.budget_amount).toFixed(2)}`,
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
  if (url.pathname === "/api/procurement/rules" && request.method === "GET") return procurementRules(request, env);
  if (url.pathname === "/api/procurement/rules" && request.method === "PUT") return saveProcurementRules(request, env);
  if (url.pathname === "/api/procurement/access-settings" && request.method === "GET") return accessSettings(request, env);
  if (url.pathname === "/api/procurement/access-settings" && request.method === "PUT") return saveAccessSettings(request, env);
  if (url.pathname === "/api/procurement/ledger" && request.method === "GET") return ledger(request, env);
  if (url.pathname === "/api/procurement/month-plan" && request.method === "GET") return monthPlan(request, env);
  if (url.pathname === "/api/procurement/month-plan" && request.method === "PUT") return saveMonthPlan(request, env);
  if (url.pathname === "/api/procurement/batches" && request.method === "POST") return submit(request, env);
  if (url.pathname === "/api/procurement/manual-orders" && request.method === "POST") return importManualOrder(request, env);
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

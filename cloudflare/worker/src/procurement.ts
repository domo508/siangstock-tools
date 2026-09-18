import { verifyAdmin, verifyCompanyUser, type AccessConfig } from "./access";
import { RequestValidationError } from "./schema";
import { FIXED_SOURCES } from "./fixed-sources";

type ProcurementEnv = AccessConfig & { DB: D1Database; ALLOWED_ORIGINS: string; GOOGLE_OAUTH_CLIENT_ID?: string; PROCUREMENT_ACCESS_AUD?: string };

const ADMIN_EMAIL = "siang01@siangapato.com.tw";
const MAX_SUMMARY_BYTES = 524288;
const MAX_COLLABORATION_DRAFT_BYTES = 7 * 1024 * 1024;
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

async function collaborationBody(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) {
    throw new RequestValidationError("Content-Type 必須是 application/json。", 415);
  }
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_COLLABORATION_DRAFT_BYTES) throw new RequestValidationError("協作草稿超過 7 MB 上限；請重新產生較小的分批審核草稿。", 413);
  if (!request.body) throw new RequestValidationError("缺少協作草稿內容。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_COLLABORATION_DRAFT_BYTES) {
      await reader.cancel();
      throw new RequestValidationError("協作草稿超過 7 MB 上限；請重新產生較小的分批審核草稿。", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new RequestValidationError("協作草稿必須使用 UTF-8 編碼。"); }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new RequestValidationError("協作草稿 JSON 格式錯誤。");
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

function isoDate(value: unknown, label: string): string {
  const parsed = string(value, label, 10);
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(parsed) ? Date.parse(`${parsed}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== parsed) throw new RequestValidationError(`${label}格式錯誤。`);
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

async function storeShortageNeeds(request: Request, env: ProcurementEnv): Promise<Response> {
  const email = await verifyCompanyUser(request, procurementAccess(env));
  const settings = await readProcurementSettings(env);
  const role = roleFor(email, settings);
  const rows = await env.DB.prepare("SELECT store_code, sku, product_name, source_batch_id, approved_demand_quantity, allocated_quantity, unfilled_quantity, covered_quantity, fulfilled_quantity, needed_by, reason, handling_mode, status, resolution_note, resolved_at, resolved_by, updated_at FROM store_transfer_procurement_needs WHERE unfilled_quantity > 0 AND status NOT IN ('resolved', 'cancelled') ORDER BY needed_by, store_code, sku").all();
  return json({ rows: rows.results, permissions: { canDecide: role !== "operator" } });
}

async function decideStoreShortageNeed(request: Request, env: ProcurementEnv, storeCode: string, sku: string): Promise<Response> {
  requireSameOrigin(request, env);
  const access = await verifyApprover(request, env);
  const input = await body(request);
  const mode = String(input.handlingMode || "");
  if (!['merge_next', 'new_order'].includes(mode)) throw new RequestValidationError("處理方式只能是併入下一張採購單或建立門市不足補採新單。");
  const status = mode === 'merge_next' ? 'waiting_merge' : 'new_order';
  const now = new Date().toISOString();
  const source = await env.DB.prepare("SELECT source_batch_id FROM store_transfer_procurement_needs WHERE store_code = ? AND sku = ? AND unfilled_quantity > 0").bind(storeCode, sku).first<{ source_batch_id: string }>();
  if (!source) throw new RequestValidationError("找不到這筆待處理門市未配需求。", 404);
  const label = mode === 'merge_next' ? '等待併入下一張採購單' : '建立門市不足補採新單';
  await env.DB.batch([
    env.DB.prepare("UPDATE store_transfer_procurement_needs SET handling_mode = ?, status = ?, updated_at = ?, updated_by = ? WHERE store_code = ? AND sku = ? AND unfilled_quantity > 0").bind(mode, status, now, access.email, storeCode, sku),
    env.DB.prepare("UPDATE store_transfer_shortages SET follow_up_status = ?, updated_at = ? WHERE batch_id = ? AND store_code = ? AND sku = ?").bind(label, now, source.source_batch_id, storeCode, sku)
  ]);
  return json({ storeCode, sku, handlingMode: mode, status, updatedAt: now });
}

async function closeStoreShortageNeed(request: Request, env: ProcurementEnv, storeCode: string, sku: string): Promise<Response> {
  requireSameOrigin(request, env);
  const access = await verifyApprover(request, env);
  const input = await body(request);
  const resolutionType = String(input.resolutionType || "");
  if (!["resolved", "cancelled"].includes(resolutionType)) throw new RequestValidationError("結案方式只能是已補配結案或取消需求。");
  const reason = string(input.reason, "結案原因", 500);
  const current = await env.DB.prepare("SELECT source_batch_id, status, unfilled_quantity, fulfilled_quantity FROM store_transfer_procurement_needs WHERE store_code = ? AND sku = ? AND status NOT IN ('resolved', 'cancelled')").bind(storeCode, sku).first<Record<string, unknown>>();
  if (!current) throw new RequestValidationError("找不到可結案的門市未配需求。", 404);
  const now = new Date().toISOString();
  const eventType = resolutionType === "resolved" ? "manual_resolved" : "manual_cancelled";
  const label = resolutionType === "resolved" ? "人工確認已補配結案" : "已取消或人工結案";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO store_transfer_procurement_need_events (store_code, sku, source_batch_id, event_type, quantity, status_before, status_after, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(storeCode, sku, String(current.source_batch_id), eventType, resolutionType === "resolved" ? Math.max(0, Number(current.unfilled_quantity || 0) - Number(current.fulfilled_quantity || 0)) : 0, String(current.status), resolutionType, reason, now, access.email),
    env.DB.prepare("UPDATE store_transfer_procurement_needs SET status = ?, fulfilled_quantity = CASE WHEN ? = 'resolved' THEN unfilled_quantity ELSE fulfilled_quantity END, covered_quantity = 0, resolution_note = ?, resolved_at = ?, resolved_by = ?, updated_at = ?, updated_by = ? WHERE store_code = ? AND sku = ? AND status NOT IN ('resolved', 'cancelled')").bind(resolutionType, resolutionType, reason, now, access.email, now, access.email, storeCode, sku),
    env.DB.prepare("UPDATE store_transfer_shortages SET follow_up_status = ?, updated_at = ? WHERE batch_id = ? AND store_code = ? AND sku = ?").bind(label, now, String(current.source_batch_id), storeCode, sku)
  ]);
  return json({ storeCode, sku, status: resolutionType, reason, resolvedAt: now, resolvedBy: access.email });
}

async function savePendingPurchaseSnapshot(request: Request, env: ProcurementEnv): Promise<Response> {
  requireSameOrigin(request, env);
  const email = await verifyCompanyUser(request, procurementAccess(env));
  const input = await body(request);
  if (!Array.isArray(input.rows) || input.rows.length > 5000) throw new RequestValidationError("未到貨摘要格式錯誤。");
  const sourceDate = string(input.sourceDate, "未到貨清單截止日", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) throw new RequestValidationError("未到貨清單截止日格式錯誤。");
  const now = new Date().toISOString();
  const statements = [env.DB.prepare("DELETE FROM procurement_pending_purchase_snapshot")];
  for (const raw of input.rows as unknown[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("未到貨摘要格式錯誤。");
    const row = raw as Record<string, unknown>;
    const sku = string(row.sku, "ERP品號", 80);
    const name = String(row.productName || "").normalize("NFKC").trim().slice(0, 300);
    const qty = money(row.pendingQuantity, "未到貨量");
    const expected = String(row.expectedDeliveryDate || "").trim();
    if (expected && !/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw new RequestValidationError(`${sku}預計到貨日格式錯誤。`);
    statements.push(env.DB.prepare("INSERT INTO procurement_pending_purchase_snapshot (sku, product_name, pending_quantity, expected_delivery_date, source_date, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(sku, name, qty, expected || null, sourceDate, now, email));
  }
  statements.push(
    env.DB.prepare("INSERT INTO procurement_pending_purchase_runs (id, source_date, updated_at, updated_by) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source_date = excluded.source_date, updated_at = excluded.updated_at, updated_by = excluded.updated_by").bind(sourceDate, now, email),
    env.DB.prepare("INSERT INTO store_transfer_procurement_need_events (store_code, sku, source_batch_id, event_type, quantity, status_before, status_after, reason, created_at, created_by) SELECT n.store_code, n.sku, n.source_batch_id, 'arrival_detected', n.covered_quantity, n.status, 'arrived', '最新版完整未到貨清單已無此品號，且ERP採購建立日在清單截止日前，轉為已到貨待下次調撥', ?, ? FROM store_transfer_procurement_needs n WHERE n.status = 'covered_waiting' AND n.covered_quantity > 0 AND NOT EXISTS (SELECT 1 FROM procurement_pending_purchase_snapshot p WHERE p.sku = n.sku AND p.pending_quantity > 0) AND EXISTS (SELECT 1 FROM procurement_batch_store_needs x JOIN procurement_batches b ON b.id = x.batch_id WHERE x.store_code = n.store_code AND x.sku = n.sku AND b.status = 'erp_created' AND date(b.updated_at) < date(?))").bind(now, email, sourceDate),
    env.DB.prepare("UPDATE store_transfer_shortages SET follow_up_status = '已到貨待下次調撥', updated_at = ? WHERE EXISTS (SELECT 1 FROM store_transfer_procurement_needs n WHERE n.source_batch_id = store_transfer_shortages.batch_id AND n.store_code = store_transfer_shortages.store_code AND n.sku = store_transfer_shortages.sku AND n.status = 'covered_waiting' AND n.covered_quantity > 0 AND NOT EXISTS (SELECT 1 FROM procurement_pending_purchase_snapshot p WHERE p.sku = n.sku AND p.pending_quantity > 0) AND EXISTS (SELECT 1 FROM procurement_batch_store_needs x JOIN procurement_batches b ON b.id = x.batch_id WHERE x.store_code = n.store_code AND x.sku = n.sku AND b.status = 'erp_created' AND date(b.updated_at) < date(?)))").bind(now, sourceDate),
    env.DB.prepare("UPDATE store_transfer_procurement_needs SET status = 'arrived', resolution_note = '最新版完整未到貨清單已無此品號，等待下次門市調撥補配', updated_at = ?, updated_by = ? WHERE status = 'covered_waiting' AND covered_quantity > 0 AND NOT EXISTS (SELECT 1 FROM procurement_pending_purchase_snapshot p WHERE p.sku = store_transfer_procurement_needs.sku AND p.pending_quantity > 0) AND EXISTS (SELECT 1 FROM procurement_batch_store_needs x JOIN procurement_batches b ON b.id = x.batch_id WHERE x.store_code = store_transfer_procurement_needs.store_code AND x.sku = store_transfer_procurement_needs.sku AND b.status = 'erp_created' AND date(b.updated_at) < date(?))").bind(now, email, sourceDate)
  );
  await env.DB.batch(statements);
  return json({ saved: input.rows.length, sourceDate, updatedAt: now });
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
  const storeInventory = rules.storeInventory as Record<string, unknown>;
  if (!Array.isArray(storeInventory.rules) || storeInventory.rules.length > 100) throw new RequestValidationError("門市庫存規則清單格式錯誤。");
  const holidays = storeInventory.workdayHolidays == null ? [] : storeInventory.workdayHolidays;
  if (!Array.isArray(holidays) || holidays.length > 100 || holidays.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) throw new RequestValidationError("公司不作業日須為有效 YYYY-MM-DD 日期。");
  storeInventory.workdayHolidays = [...new Set(holidays.map(String))].sort();
  const arrivalWeekdays = storeInventory.arrivalWeekdayByStore == null ? {} : storeInventory.arrivalWeekdayByStore;
  if (!arrivalWeekdays || typeof arrivalWeekdays !== "object" || Array.isArray(arrivalWeekdays)) throw new RequestValidationError("門市到店日設定格式錯誤。");
  const allowedStores = new Set(["R00", "R01", "R03", "R10", "R07", "R06"]);
  for (const [storeCode, weekday] of Object.entries(arrivalWeekdays as Record<string, unknown>)) {
    if (!allowedStores.has(storeCode) || ![3, 4].includes(Number(weekday))) throw new RequestValidationError("門市到店日只能設定為星期三或星期四。");
  }
  storeInventory.arrivalWeekdayByStore = Object.fromEntries(Object.entries(arrivalWeekdays as Record<string, unknown>).map(([storeCode, weekday]) => [storeCode, Number(weekday)]));
  for (const rule of storeInventory.rules as Record<string, unknown>[]) {
    if (!rule || typeof rule !== "object" || !String(rule.name || "").trim()) throw new RequestValidationError("門市庫存規則名稱不可空白。");
    if (!["不可售展示", "可售最低庫存", "可售特殊備貨", "排除規則"].includes(String(rule.inventoryRole))) throw new RequestValidationError("門市庫存角色格式錯誤。");
    if (!Number.isInteger(Number(rule.quantity)) || Number(rule.quantity) < 0 || Number(rule.quantity) > 100) throw new RequestValidationError("門市庫存規則數量須為0至100的整數。");
    if (!Number.isInteger(Number(rule.priority)) || Number(rule.priority) < 0 || Number(rule.priority) > 1000) throw new RequestValidationError("門市庫存規則優先序須為0至1000的整數。");
    if (rule.conditionMode != null) {
      if (rule.conditionMode !== "structured") throw new RequestValidationError("門市庫存規則的判斷模式錯誤。");
      const productCategory = String(rule.productCategory || "").trim();
      const sizeAttribute = String(rule.sizeAttribute || "").trim();
      const itemTypeKeywords = String(rule.itemTypeKeywords || "").trim();
      if (productCategory.length > 50 || itemTypeKeywords.length > 200) throw new RequestValidationError("門市庫存規則的分類或品項關鍵字過長。");
      if (sizeAttribute && !["全部", "有尺寸", "無尺寸"].includes(sizeAttribute)) throw new RequestValidationError("門市庫存規則的尺寸屬性錯誤。");
      if (rule.enabled !== false && (!productCategory || productCategory === "全部") && (!sizeAttribute || sizeAttribute === "全部") && !itemTypeKeywords) throw new RequestValidationError("已啟用的自訂門市規則至少須設定一個商品判斷條件。");
    }
  }
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

const COLLABORATION_STAGES = new Set(["analysis", "downloaded", "first_reviewed", "second_reviewed", "pending_approval", "approved", "erp_created"]);
const COLLABORATION_ENCODINGS = new Set(["gzip-base64", "json"]);

function serializeCollaborationDraft(row: Record<string, unknown>, includePayload = false): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: String(row.id),
    analysisMonth: String(row.analysis_month),
    checkpoint: String(row.checkpoint),
    workflowType: String(row.workflow_type),
    stage: String(row.stage),
    workUnitLabel: String(row.work_unit_label || ""),
    supplierSummary: parseJsonText(String(row.supplier_summary || "[]")) || [],
    amount: Number(row.amount || 0),
    revision: Number(row.revision || 1),
    createdAt: String(row.created_at),
    createdBy: String(row.created_by),
    updatedAt: String(row.updated_at),
    updatedBy: String(row.updated_by)
  };
  if (includePayload) {
    result.payloadEncoding = String(row.payload_encoding);
    result.payload = String(row.payload);
    result.payloadSha256 = String(row.payload_sha256);
  }
  return result;
}

async function listCollaborationDrafts(request: Request, env: ProcurementEnv): Promise<Response> {
  await verifyCompanyUser(request, procurementAccess(env));
  const requestedMonth = month(new URL(request.url).searchParams.get("month"));
  const rows = await env.DB.prepare(
    "SELECT id, analysis_month, checkpoint, workflow_type, stage, work_unit_label, supplier_summary, amount, revision, created_at, created_by, updated_at, updated_by FROM procurement_collaboration_drafts WHERE analysis_month = ? AND stage != 'erp_created' ORDER BY updated_at DESC LIMIT 100"
  ).bind(requestedMonth).all<Record<string, unknown>>();
  return json({ month: requestedMonth, drafts: rows.results.map((row) => serializeCollaborationDraft(row)) });
}

async function getCollaborationDraft(request: Request, env: ProcurementEnv, draftId: string): Promise<Response> {
  await verifyCompanyUser(request, procurementAccess(env));
  const id = string(draftId, "協作草稿編號", 100);
  const row = await env.DB.prepare(
    "SELECT id, analysis_month, checkpoint, workflow_type, stage, work_unit_label, supplier_summary, amount, payload_encoding, payload, payload_sha256, revision, created_at, created_by, updated_at, updated_by FROM procurement_collaboration_drafts WHERE id = ?"
  ).bind(id).first<Record<string, unknown>>();
  if (!row) throw new RequestValidationError("找不到這筆公司共用協作草稿。", 404);
  return json({ draft: serializeCollaborationDraft(row, true) });
}

async function saveCollaborationDraft(request: Request, env: ProcurementEnv, draftId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const actor = await verifyCompanyUser(request, procurementAccess(env));
  const input = await collaborationBody(request);
  const id = string(draftId, "協作草稿編號", 100);
  const analysisMonth = month(input.analysisMonth);
  const checkpoint = string(input.checkpoint, "使用時點", 20);
  if (!["month-start", "mid-month", "month-end"].includes(checkpoint)) throw new RequestValidationError("使用時點格式錯誤。");
  const workflowType = string(input.workflowType, "採購流程", 40);
  const stage = string(input.stage, "草稿階段", 30);
  if (!COLLABORATION_STAGES.has(stage)) throw new RequestValidationError("草稿階段格式錯誤。");
  const workUnitLabel = String(input.workUnitLabel || "").normalize("NFKC").trim();
  if (workUnitLabel.length > 300) throw new RequestValidationError("審核單位名稱過長。");
  const suppliers = input.supplierSummary == null ? [] : input.supplierSummary;
  if (!Array.isArray(suppliers) || suppliers.length > 100 || suppliers.some((value) => typeof value !== "string" || !value.trim() || value.trim().length > 120)) {
    throw new RequestValidationError("供應商摘要格式錯誤。");
  }
  const amount = money(input.amount, "草稿採購金額");
  const payloadEncoding = string(input.payloadEncoding, "草稿壓縮格式", 20);
  if (!COLLABORATION_ENCODINGS.has(payloadEncoding)) throw new RequestValidationError("草稿壓縮格式錯誤。");
  const payload = string(input.payload, "協作草稿內容", 6 * 1024 * 1024);
  if (payloadEncoding === "gzip-base64" && !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) throw new RequestValidationError("協作草稿壓縮內容格式錯誤。");
  if (payloadEncoding === "json") {
    try { JSON.parse(payload); } catch { throw new RequestValidationError("協作草稿內容不是有效 JSON。"); }
  }
  const payloadSha256 = string(input.payloadSha256, "草稿雜湊", 64).toLocaleLowerCase("en-US");
  if (!/^[a-f0-9]{64}$/.test(payloadSha256)) throw new RequestValidationError("草稿雜湊格式錯誤。");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const actualSha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actualSha256 !== payloadSha256) throw new RequestValidationError("協作草稿內容檢核失敗，請重新發布。");
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new RequestValidationError("協作草稿版本格式錯誤。");
  const supplierSummary = JSON.stringify([...new Set(suppliers.map((value) => value.trim()))]);
  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT revision FROM procurement_collaboration_drafts WHERE id = ?").bind(id).first<{ revision: number }>();
  if (!existing) {
    if (expectedRevision !== 0) throw new RequestValidationError("協作草稿已不存在或版本已改變，請重新整理。", 409);
    await env.DB.prepare(
      "INSERT INTO procurement_collaboration_drafts (id, analysis_month, checkpoint, workflow_type, stage, work_unit_label, supplier_summary, amount, payload_encoding, payload, payload_sha256, revision, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)"
    ).bind(id, analysisMonth, checkpoint, workflowType, stage, workUnitLabel, supplierSummary, amount, payloadEncoding, payload, payloadSha256, now, actor, now, actor).run();
  } else {
    if (Number(existing.revision) !== expectedRevision) throw new RequestValidationError("這筆協作草稿已由其他同事更新，為避免覆蓋，請重新開啟公司共用最新版。", 409);
    const updated = await env.DB.prepare(
      "UPDATE procurement_collaboration_drafts SET analysis_month = ?, checkpoint = ?, workflow_type = ?, stage = ?, work_unit_label = ?, supplier_summary = ?, amount = ?, payload_encoding = ?, payload = ?, payload_sha256 = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?"
    ).bind(analysisMonth, checkpoint, workflowType, stage, workUnitLabel, supplierSummary, amount, payloadEncoding, payload, payloadSha256, now, actor, id, expectedRevision).run();
    if (Number(updated.meta.changes || 0) !== 1) throw new RequestValidationError("這筆協作草稿已由其他同事更新，為避免覆蓋，請重新開啟公司共用最新版。", 409);
  }
  const saved = await env.DB.prepare(
    "SELECT id, analysis_month, checkpoint, workflow_type, stage, work_unit_label, supplier_summary, amount, revision, created_at, created_by, updated_at, updated_by FROM procurement_collaboration_drafts WHERE id = ?"
  ).bind(id).first<Record<string, unknown>>();
  return json({ draft: serializeCollaborationDraft(saved || {}) }, existing ? 200 : 201);
}

function serializeCostSnapshot(row: Record<string, unknown>) {
  return {
    analysisMonth: String(row.analysis_month),
    checkpoint: String(row.checkpoint),
    dataAsOfDate: String(row.data_as_of_date),
    inventoryDate: String(row.inventory_date),
    pendingDate: String(row.pending_date),
    transferDate: String(row.transfer_date),
    salesDate: String(row.sales_date),
    forecastCost: Number(row.forecast_cost),
    managementCostToDate: Number(row.management_cost_to_date),
    actualReceiptCost: Number(row.actual_receipt_cost),
    directCost: Number(row.direct_cost),
    kuanmuBaseCost: Number(row.kuanmu_base_cost),
    kuanmuIntercompanyRevenue: Number(row.kuanmu_intercompany_revenue),
    currentInventoryCost: Number(row.current_inventory_cost),
    inventoryBridgeCost: row.inventory_bridge_cost == null ? null : Number(row.inventory_bridge_cost),
    source: String(row.source),
    maxSalesDate: row.max_sales_date == null ? "" : String(row.max_sales_date),
    transferReceivedCount: Number(row.transfer_received_count),
    b3MatchedCount: Number(row.b3_matched_count),
    warnings: parseJsonText(String(row.warnings || "[]")) || [],
    sourceHashes: parseJsonText(String(row.source_hashes || "{}")) || {},
    calculationVersion: String(row.calculation_version),
    updatedAt: String(row.updated_at),
    updatedBy: String(row.updated_by)
  };
}

const COST_SNAPSHOT_COLUMNS = "analysis_month, checkpoint, data_as_of_date, inventory_date, pending_date, transfer_date, sales_date, forecast_cost, management_cost_to_date, actual_receipt_cost, direct_cost, kuanmu_base_cost, kuanmu_intercompany_revenue, current_inventory_cost, inventory_bridge_cost, source, max_sales_date, transfer_received_count, b3_matched_count, warnings, source_hashes, calculation_version, updated_at, updated_by";

async function costSnapshot(request: Request, env: ProcurementEnv): Promise<Response> {
  await verifyCompanyUser(request, procurementAccess(env));
  const requestedMonth = month(new URL(request.url).searchParams.get("month"));
  const row = await env.DB.prepare(`SELECT ${COST_SNAPSHOT_COLUMNS} FROM procurement_cost_snapshots WHERE analysis_month = ?`).bind(requestedMonth).first<Record<string, unknown>>();
  return json({ month: requestedMonth, snapshot: row ? serializeCostSnapshot(row) : null });
}

async function saveCostSnapshot(request: Request, env: ProcurementEnv): Promise<Response> {
  requireSameOrigin(request, env);
  const { email: actor } = await verifyApprover(request, env);
  const input = await body(request);
  const analysisMonth = month(input.analysisMonth);
  const checkpoint = string(input.checkpoint, "使用時點", 20);
  if (!["month-start", "mid-month", "month-end"].includes(checkpoint)) throw new RequestValidationError("使用時點格式錯誤。");
  const inventoryDate = isoDate(input.inventoryDate, "庫存截止日");
  const pendingDate = isoDate(input.pendingDate, "採購單截止日");
  const transferDate = isoDate(input.transferDate, "調撥單截止日");
  const salesDate = isoDate(input.salesDate, "銷售截止日");
  const dataAsOfDate = isoDate(input.dataAsOfDate, "資料截止日");
  const warnings = Array.isArray(input.warnings) ? input.warnings.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (warnings.length > 30 || warnings.some((item) => item.length > 300)) throw new RequestValidationError("成本摘要警示格式錯誤。");
  const sourceHashesInput = input.sourceHashes && typeof input.sourceHashes === "object" && !Array.isArray(input.sourceHashes) ? input.sourceHashes as Record<string, unknown> : {};
  const sourceHashes = Object.fromEntries(Object.entries(sourceHashesInput).map(([key, value]) => [String(key).slice(0, 40), String(value || "").slice(0, 128)]));
  if (Object.keys(sourceHashes).length > 20) throw new RequestValidationError("來源摘要格式錯誤。");
  const values = {
    forecastCost: money(input.forecastCost, "預估整月成本耗用"),
    managementCostToDate: money(input.managementCostToDate, "本月至今成本耗用"),
    actualReceiptCost: money(input.actualReceiptCost, "實際收貨成本"),
    directCost: money(input.directCost, "寬承直接成本"),
    kuanmuBaseCost: money(input.kuanmuBaseCost, "寬沐供貨原始成本"),
    kuanmuIntercompanyRevenue: money(input.kuanmuIntercompanyRevenue, "寬承對寬沐計價參考"),
    currentInventoryCost: money(input.currentInventoryCost, "寬承體系庫存成本"),
    inventoryBridgeCost: input.inventoryBridgeCost == null ? null : money(input.inventoryBridgeCost, "庫存公式驗證", true),
    transferReceivedCount: Number(input.transferReceivedCount),
    b3MatchedCount: Number(input.b3MatchedCount)
  };
  if (![values.transferReceivedCount, values.b3MatchedCount].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000)) throw new RequestValidationError("成本摘要筆數格式錯誤。");
  const source = string(input.source, "成本摘要來源", 40);
  const maxSalesDate = input.maxSalesDate ? isoDate(input.maxSalesDate, "銷售資料最新日期") : null;
  const calculationVersion = string(input.calculationVersion, "計算版本", 80);
  const now = new Date().toISOString();
  const snapshotJson = JSON.stringify({ analysisMonth, checkpoint, dataAsOfDate, inventoryDate, pendingDate, transferDate, salesDate, ...values, source, maxSalesDate, warnings, sourceHashes, calculationVersion });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO procurement_cost_snapshot_history (analysis_month, checkpoint, data_as_of_date, snapshot, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)").bind(analysisMonth, checkpoint, dataAsOfDate, snapshotJson, now, actor),
    env.DB.prepare(`INSERT INTO procurement_cost_snapshots (${COST_SNAPSHOT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(analysis_month) DO UPDATE SET checkpoint = excluded.checkpoint, data_as_of_date = excluded.data_as_of_date, inventory_date = excluded.inventory_date, pending_date = excluded.pending_date, transfer_date = excluded.transfer_date, sales_date = excluded.sales_date, forecast_cost = excluded.forecast_cost, management_cost_to_date = excluded.management_cost_to_date, actual_receipt_cost = excluded.actual_receipt_cost, direct_cost = excluded.direct_cost, kuanmu_base_cost = excluded.kuanmu_base_cost, kuanmu_intercompany_revenue = excluded.kuanmu_intercompany_revenue, current_inventory_cost = excluded.current_inventory_cost, inventory_bridge_cost = excluded.inventory_bridge_cost, source = excluded.source, max_sales_date = excluded.max_sales_date, transfer_received_count = excluded.transfer_received_count, b3_matched_count = excluded.b3_matched_count, warnings = excluded.warnings, source_hashes = excluded.source_hashes, calculation_version = excluded.calculation_version, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(analysisMonth, checkpoint, dataAsOfDate, inventoryDate, pendingDate, transferDate, salesDate, values.forecastCost, values.managementCostToDate, values.actualReceiptCost, values.directCost, values.kuanmuBaseCost, values.kuanmuIntercompanyRevenue, values.currentInventoryCost, values.inventoryBridgeCost, source, maxSalesDate, values.transferReceivedCount, values.b3MatchedCount, JSON.stringify(warnings), JSON.stringify(sourceHashes), calculationVersion, now, actor)
  ]);
  const row = await env.DB.prepare(`SELECT ${COST_SNAPSHOT_COLUMNS} FROM procurement_cost_snapshots WHERE analysis_month = ?`).bind(analysisMonth).first<Record<string, unknown>>();
  if (!row) throw new RequestValidationError("公司共用成本快照儲存失敗。", 503);
  return json({ month: analysisMonth, snapshot: serializeCostSnapshot(row) });
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
    "INSERT INTO procurement_month_plans (analysis_month, scenario, forecast_revenue, forecast_cost_outflow, target_ending_inventory_cost, opening_inventory_cost, expected_supplier_returns, budget_amount, full_budget_amount, revenue_channels, source_note, created_at, created_by, updated_at, updated_by) VALUES (?, 'neutral', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(analysis_month) DO UPDATE SET forecast_revenue = excluded.forecast_revenue, forecast_cost_outflow = excluded.forecast_cost_outflow, target_ending_inventory_cost = excluded.target_ending_inventory_cost, opening_inventory_cost = excluded.opening_inventory_cost, expected_supplier_returns = excluded.expected_supplier_returns, budget_amount = excluded.budget_amount, full_budget_amount = excluded.full_budget_amount, revenue_channels = excluded.revenue_channels, source_note = excluded.source_note, updated_at = excluded.updated_at, updated_by = excluded.updated_by"
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
  if (!["system_recommendation", "store_shortage_replenishment", "new_product", "manual_draft", "manual_posted", "customer_custom"].includes(workflowType)) throw new RequestValidationError("採購流程類型錯誤。");
  const storeNeeds = input.storeShortageNeeds == null ? [] : input.storeShortageNeeds;
  if (!Array.isArray(storeNeeds) || storeNeeds.length > 5000) throw new RequestValidationError("門市未配需求來源格式錯誤。");
  const normalizedStoreNeeds = storeNeeds.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("門市未配需求來源格式錯誤。");
    const row = raw as Record<string, unknown>;
    return { storeCode: string(row.storeCode, "門市代碼", 5), sku: string(row.sku, "ERP品號", 80), quantity: Math.round(money(row.quantity, "門市未配量")) };
  });
  return {
    id: string(input.batchId, "批次編號", 80), analysisMonth: month(input.analysisMonth), supplierSummary,
    suggested, manual, blocked, approved, adjustment, budget: money(input.budgetAmount, "整月預估額度"),
    currentPayment, futurePayments, paymentSchedule, warning: typeof input.warningSummary === "string" ? input.warningSummary.trim().slice(0, 1024) : "",
    idempotencyKey: string(input.idempotencyKey, "冪等鍵", 120), workflowType, storeNeeds: normalizedStoreNeeds, now, actor
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
        .bind(item.id, item.approved, item.approved, item.now, actor, `${item.idempotencyKey}:event`),
      ...item.storeNeeds.map((row) => env.DB.prepare("INSERT INTO procurement_batch_store_needs (batch_id, store_code, sku, covered_quantity, created_at) VALUES (?, ?, ?, ?, ?)").bind(item.id, row.storeCode, row.sku, row.quantity, item.now))
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
    env.DB.prepare("INSERT OR IGNORE INTO procurement_notifications (batch_id, event_id, event_type, recipient, status, created_at) SELECT ?, id, 'approved', ?, 'pending', ? FROM procurement_events WHERE idempotency_key = ?").bind(batchId, access.settings.notificationRecipient, now, key),
    env.DB.prepare("UPDATE store_transfer_procurement_needs SET status = CASE WHEN covered_quantity + (SELECT x.covered_quantity FROM procurement_batch_store_needs x WHERE x.batch_id = ? AND x.store_code = store_transfer_procurement_needs.store_code AND x.sku = store_transfer_procurement_needs.sku) >= unfilled_quantity THEN 'covered_waiting' WHEN handling_mode = 'new_order' THEN 'new_order' ELSE 'waiting_merge' END, covered_quantity = MIN(unfilled_quantity, covered_quantity + (SELECT x.covered_quantity FROM procurement_batch_store_needs x WHERE x.batch_id = ? AND x.store_code = store_transfer_procurement_needs.store_code AND x.sku = store_transfer_procurement_needs.sku)), updated_at = ?, updated_by = ? WHERE EXISTS (SELECT 1 FROM procurement_batch_store_needs x WHERE x.batch_id = ? AND x.store_code = store_transfer_procurement_needs.store_code AND x.sku = store_transfer_procurement_needs.sku)").bind(batchId, batchId, now, actor, batchId),
    env.DB.prepare("UPDATE store_transfer_shortages SET follow_up_status = '已由採購覆蓋待到貨', updated_at = ? WHERE EXISTS (SELECT 1 FROM procurement_batch_store_needs x WHERE x.batch_id = ? AND x.store_code = store_transfer_shortages.store_code AND x.sku = store_transfer_shortages.sku) AND batch_id = (SELECT source_batch_id FROM store_transfer_procurement_needs n WHERE n.store_code = store_transfer_shortages.store_code AND n.sku = store_transfer_shortages.sku)").bind(now, batchId)
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
    env.DB.prepare("INSERT OR IGNORE INTO procurement_notifications (batch_id, event_id, event_type, recipient, status, created_at) SELECT ?, id, 'revoked', ?, 'pending', ? FROM procurement_events WHERE idempotency_key = ?").bind(batchId, settings.notificationRecipient, now, key),
    env.DB.prepare("UPDATE store_transfer_procurement_needs SET covered_quantity = MAX(0, covered_quantity - (SELECT x.covered_quantity FROM procurement_batch_store_needs x WHERE x.batch_id = ? AND x.store_code = store_transfer_procurement_needs.store_code AND x.sku = store_transfer_procurement_needs.sku)), status = CASE handling_mode WHEN 'new_order' THEN 'new_order' ELSE 'waiting_merge' END, updated_at = ?, updated_by = ? WHERE EXISTS (SELECT 1 FROM procurement_batch_store_needs x WHERE x.batch_id = ? AND x.store_code = store_transfer_procurement_needs.store_code AND x.sku = store_transfer_procurement_needs.sku)").bind(batchId, now, actor, batchId)
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
  if (url.pathname === "/api/procurement/collaboration-drafts" && request.method === "GET") return listCollaborationDrafts(request, env);
  const collaborationDraftMatch = url.pathname.match(/^\/api\/procurement\/collaboration-drafts\/([^/]+)$/);
  if (collaborationDraftMatch && request.method === "GET") return getCollaborationDraft(request, env, decodeURIComponent(collaborationDraftMatch[1]));
  if (collaborationDraftMatch && request.method === "PUT") return saveCollaborationDraft(request, env, decodeURIComponent(collaborationDraftMatch[1]));
  if (url.pathname === "/api/procurement/store-shortages" && request.method === "GET") return storeShortageNeeds(request, env);
  if (url.pathname === "/api/procurement/pending-purchase-snapshot" && request.method === "PUT") return savePendingPurchaseSnapshot(request, env);
  const shortageDecisionMatch = url.pathname.match(/^\/api\/procurement\/store-shortages\/([^/]+)\/([^/]+)$/);
  if (shortageDecisionMatch && request.method === "PUT") return decideStoreShortageNeed(request, env, decodeURIComponent(shortageDecisionMatch[1]), decodeURIComponent(shortageDecisionMatch[2]));
  const shortageCloseMatch = url.pathname.match(/^\/api\/procurement\/store-shortages\/([^/]+)\/([^/]+)\/close$/);
  if (shortageCloseMatch && request.method === "POST") return closeStoreShortageNeed(request, env, decodeURIComponent(shortageCloseMatch[1]), decodeURIComponent(shortageCloseMatch[2]));
  if (url.pathname === "/api/procurement/month-plan" && request.method === "GET") return monthPlan(request, env);
  if (url.pathname === "/api/procurement/month-plan" && request.method === "PUT") return saveMonthPlan(request, env);
  if (url.pathname === "/api/procurement/cost-snapshot" && request.method === "GET") return costSnapshot(request, env);
  if (url.pathname === "/api/procurement/cost-snapshot" && request.method === "PUT") return saveCostSnapshot(request, env);
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
  await env.DB.prepare("DELETE FROM procurement_collaboration_drafts WHERE updated_at < datetime('now', '-12 months')").run();
}

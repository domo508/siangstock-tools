import { verifyCompanyUser, type AccessConfig } from "./access";
import { RequestValidationError } from "./schema";
import { FIXED_SOURCES } from "./fixed-sources";

type StoreTransferEnv = AccessConfig & { DB: D1Database; ALLOWED_ORIGINS: string; GOOGLE_OAUTH_CLIENT_ID?: string; PROCUREMENT_ACCESS_AUD?: string };
type Role = "admin" | "hq" | "store";
type ItemType = "regular" | "activity_gift" | "special_stock" | "consumable";

const ADMIN = "siang01@siangapato.com.tw";
const COLLABORATION_FINALIZERS = new Set([ADMIN, "service1@siangapato.com.tw"]);
const STORES = Object.freeze({
  R00: { name: "台北中山門市", email: "tpzssa@siangapato.com.tw", company: "寬承", relationship: "直營" },
  R01: { name: "台中北屯門市", email: "txg_sianga_pato@siangapato.com.tw", company: "寬承", relationship: "直營" },
  R03: { name: "新竹東區門市", email: "hcedsa@siangapato.com.tw", company: "寬沐", relationship: "加盟" },
  R10: { name: "新莊門市", email: "r09_siangstore@siangapato.com.tw", company: "寬沐", relationship: "加盟" },
  R07: { name: "誠品480門市", email: "r07_siangstore@siangapato.com.tw", company: "寬沐", relationship: "加盟" },
  R06: { name: "文心秀泰門市", email: "r06_siangstore@siangapato.com.tw", company: "寬沐", relationship: "加盟" }
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

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function requireSameOrigin(request: Request, env: StoreTransferEnv): void {
  const allowed = new Set((env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(request.headers.get("Origin") || "")) throw new RequestValidationError("不允許的來源。", 403);
}

async function readBody(request: Request, maxBytes = 1_500_000): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) throw new RequestValidationError("Content-Type 必須是 application/json。", 415);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new RequestValidationError("調撥建議超過允許的資料大小。", 413);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new RequestValidationError("JSON 格式錯誤。"); }
}

function actorRole(email: string, hqEmails: Set<string>): { role: Role; storeCode: StoreCode | null } {
  if (email === ADMIN) return { role: "admin", storeCode: null };
  if (hqEmails.has(email)) return { role: "hq", storeCode: null };
  const entry = Object.entries(STORES).find(([, store]) => store.email === email);
  if (!entry) throw new RequestValidationError("此公司帳號尚未指派門市週調撥權限。", 403);
  return { role: "store", storeCode: entry[0] as StoreCode };
}

async function actor(request: Request, env: StoreTransferEnv) {
  const email = await verifyCompanyUser(request, accessConfig(env));
  const row = await env.DB.prepare("SELECT store_transfer_hq_emails FROM procurement_settings WHERE id = 1").first<{ store_transfer_hq_emails: string }>();
  let configured: unknown;
  try { configured = JSON.parse(String(row?.store_transfer_hq_emails || "[]")); } catch { configured = []; }
  const hqEmails = new Set(Array.isArray(configured) ? configured.map((item) => String(item).trim().toLocaleLowerCase("en-US")) : []);
  return { email, ...actorRole(email, hqEmails) };
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

function chunks<T>(rows: T[], size = 750): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

function assertHq(role: Role): void {
  if (role === "store") throw new RequestValidationError("此動作只限總部操作。", 403);
}

function assertCollaborationFinalizer(email: string): void {
  if (!COLLABORATION_FINALIZERS.has(email)) throw new RequestValidationError("此帳號可以協作，但只有 siang01 與 service1 可以轉成正式批次。", 403);
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

function storeFacingReason(value: unknown, suggested = 0): string {
  const reason = String(value || "").normalize("NFKC").trim();
  if (!reason) return Number(suggested || 0) > 0 ? "本輪系統建議需求已滿足" : "本批次依現行規則未形成補貨需求";
  if (/總[倉部]|安全庫存|可釋出|可供應|14[／/]42[／/]84|最高日速|部分供應|未供應/.test(reason)) return "受本輪供應條件限制，系統未建議追加";
  if (/系統已足額建議/.test(reason)) return "本輪系統建議需求已滿足";
  return reason;
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

function validateTransferRulePayload(input: Record<string, unknown>): { transferExclusions: Record<string, unknown>[]; applicabilityRules: Record<string, unknown>[] } {
  const exclusions = Array.isArray(input.transferExclusions) ? input.transferExclusions : [];
  if (exclusions.length > 500) throw new RequestValidationError("排除周調撥品號不可超過500筆。");
  const seenSkus = new Set<string>();
  const transferExclusions = exclusions.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new RequestValidationError("排除周調撥品號格式錯誤。");
    const item = entry as Record<string, unknown>;
    const sku = String(item.sku || "").normalize("NFKC").trim().toUpperCase();
    const productName = String(item.productName || "").trim();
    if (!/^[A-Z0-9][A-Z0-9._/-]{0,79}$/.test(sku) || !productName || productName.length > 300) throw new RequestValidationError("排除周調撥品號或品名格式錯誤。");
    if (seenSkus.has(sku)) throw new RequestValidationError(`排除周調撥品號 ${sku} 重複。`);
    seenSkus.add(sku);
    return { sku, productName, enabled: item.enabled !== false };
  });

  const rules = Array.isArray(input.applicabilityRules) ? input.applicabilityRules : [];
  if (rules.length > 300) throw new RequestValidationError("周調撥適用規則不可超過300筆。");
  const storeCodes = new Set(Object.keys(STORES));
  const seenIds = new Set<string>();
  const applicabilityRules = rules.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new RequestValidationError("周調撥適用規則格式錯誤。");
    const item = entry as Record<string, unknown>;
    const id = String(item.id || "").trim();
    const name = String(item.name || "").trim();
    const matchType = String(item.matchType || "");
    const sku = String(item.sku || "").normalize("NFKC").trim().toUpperCase();
    const productName = String(item.productName || "").trim();
    const keywords = (Array.isArray(item.keywords) ? item.keywords : []).map((keyword) => String(keyword || "").normalize("NFKC").trim()).filter(Boolean);
    const keywordMode = String(item.keywordMode || "any");
    const action = String(item.action || "");
    const storeScope = String(item.storeScope || "all");
    const stores = (Array.isArray(item.stores) ? item.stores : []).map(String);
    const scheduleMode = String(item.scheduleMode || "always");
    const startDate = String(item.startDate || "");
    const endDate = String(item.endDate || "");
    const startMonthDay = String(item.startMonthDay || "");
    const endMonthDay = String(item.endMonthDay || "");
    const campaignId = String(item.campaignId || "").trim();
    const campaignName = String(item.campaignName || "").trim();
    const priority = Number(item.priority || 0);
    const reasonType = String(item.reasonType || "").trim();
    const reasonNote = String(item.reasonNote || "").trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id) || seenIds.has(id)) throw new RequestValidationError("周調撥適用規則編號格式錯誤或重複。");
    seenIds.add(id);
    if (!name || name.length > 100) throw new RequestValidationError("規則名稱不可空白或超過100字。");
    if (!["sku", "keyword"].includes(matchType)) throw new RequestValidationError(`規則「${name}」的命中方式錯誤。`);
    if (matchType === "sku" && (!/^[A-Z0-9][A-Z0-9._/-]{0,79}$/.test(sku) || !productName || productName.length > 300)) throw new RequestValidationError(`規則「${name}」須包含有效ERP品號與商品品名。`);
    if (matchType === "keyword" && (!keywords.length || keywords.length > 10 || keywords.some((keyword) => keyword.length > 50))) throw new RequestValidationError(`規則「${name}」須包含1至10個品名關鍵字。`);
    if (!["any", "all"].includes(keywordMode) || !["exclude", "allow", "include_period"].includes(action)) throw new RequestValidationError(`規則「${name}」的比對或動作格式錯誤。`);
    if (!["all", "selected"].includes(storeScope) || stores.some((store) => !storeCodes.has(store)) || (storeScope === "selected" && !stores.length)) throw new RequestValidationError(`規則「${name}」的適用門市錯誤。`);
    if (!["always", "date_range", "annual", "campaign"].includes(scheduleMode)) throw new RequestValidationError(`規則「${name}」的生效方式錯誤。`);
    if (["date_range", "campaign"].includes(scheduleMode) && (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate)) throw new RequestValidationError(`規則「${name}」的生效日期錯誤。`);
    if (scheduleMode === "annual" && (!/^\d{2}-\d{2}$/.test(startMonthDay) || !/^\d{2}-\d{2}$/.test(endMonthDay))) throw new RequestValidationError(`規則「${name}」的每年固定期間錯誤。`);
    if (!Number.isInteger(priority) || priority < 0 || priority > 1000) throw new RequestValidationError(`規則「${name}」的優先序須為0至1000的整數。`);
    if (!reasonType || reasonType.length > 50 || reasonNote.length > 300 || campaignId.length > 100 || campaignName.length > 200) throw new RequestValidationError(`規則「${name}」的原因或活動資料格式錯誤。`);
    return { id, name, enabled: item.enabled !== false, matchType, sku: matchType === "sku" ? sku : "", productName: matchType === "sku" ? productName : "", keywords: matchType === "keyword" ? [...new Set(keywords)] : [], keywordMode, action, storeScope, stores: storeScope === "selected" ? [...new Set(stores)] : [], scheduleMode, startDate, endDate, startMonthDay, endMonthDay, campaignId, campaignName, priority, reasonType, reasonNote };
  });
  return { transferExclusions, applicabilityRules };
}

async function transferApplicabilityRules(request: Request, env: StoreTransferEnv): Promise<Response> {
  const who = await actor(request, env);
  assertHq(who.role);
  const inventory = await storeInventoryConfig(env);
  return json({ version: inventory.version, updatedAt: inventory.updatedAt, updatedBy: inventory.updatedBy,
    transferExclusions: Array.isArray(inventory.config.transferExclusions) ? inventory.config.transferExclusions : [],
    applicabilityRules: Array.isArray(inventory.config.applicabilityRules) ? inventory.config.applicabilityRules : [] });
}

async function saveTransferApplicabilityRules(request: Request, env: StoreTransferEnv): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env);
  assertHq(who.role);
  const input = await readBody(request, 250_000);
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new RequestValidationError("規則版本格式錯誤。");
  const changeReason = text(input.changeReason, "修改原因", 500);
  const validated = validateTransferRulePayload(input);
  const row = await env.DB.prepare("SELECT version, payload FROM procurement_rules_current WHERE id = 1").first<Record<string, unknown>>();
  if (!row || Number(row.version) !== expectedVersion) throw new RequestValidationError("規則已被其他同事更新，請重新載入最新版。", 409);
  const rules = parseJson(row.payload);
  const storeInventory = rules.storeInventory && typeof rules.storeInventory === "object" && !Array.isArray(rules.storeInventory) ? rules.storeInventory as Record<string, unknown> : {};
  storeInventory.transferExclusions = validated.transferExclusions;
  storeInventory.applicabilityRules = validated.applicabilityRules;
  rules.storeInventory = storeInventory;
  const payload = JSON.stringify(rules);
  if (new TextEncoder().encode(payload).byteLength > 60000) throw new RequestValidationError("公司共用規則超過60 KB上限。", 413);
  const now = new Date().toISOString();
  const updated = await env.DB.prepare("UPDATE procurement_rules_current SET version = version + 1, payload = ?, updated_at = ?, updated_by = ? WHERE id = 1 AND version = ? RETURNING version")
    .bind(payload, now, who.email, expectedVersion).first<{ version: number }>();
  if (!updated) throw new RequestValidationError("規則已被其他同事更新，請重新載入最新版。", 409);
  await env.DB.prepare("INSERT INTO procurement_rules_history (version, payload, change_reason, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)")
    .bind(updated.version, payload, changeReason, now, who.email).run();
  return json({ version: updated.version, updatedAt: now, updatedBy: who.email, ...validated });
}

function displayExceptionSummary(row: Record<string, unknown>): Record<string, unknown> {
  return {
    storeCode: String(row.store_code), sku: String(row.sku), displayQuantity: Number(row.display_quantity || 0),
    reason: String(row.reason || ""), enabled: Number(row.enabled) === 1, revision: Number(row.revision || 1),
    createdAt: String(row.created_at || ""), createdBy: String(row.created_by || ""),
    updatedAt: String(row.updated_at || ""), updatedBy: String(row.updated_by || "")
  };
}

async function visibleDisplayExceptions(env: StoreTransferEnv, storeCode: StoreCode | null): Promise<Record<string, unknown>[]> {
  const rows = storeCode
    ? await env.DB.prepare("SELECT * FROM store_transfer_display_exceptions WHERE store_code = ? ORDER BY enabled DESC, sku").bind(storeCode).all<Record<string, unknown>>()
    : await env.DB.prepare("SELECT * FROM store_transfer_display_exceptions ORDER BY store_code, enabled DESC, sku").all<Record<string, unknown>>();
  return rows.results.map(displayExceptionSummary);
}

async function config(request: Request, env: StoreTransferEnv): Promise<Response> {
  const who = await actor(request, env);
  const inventoryRules = await storeInventoryConfig(env);
  const displayExceptions = await visibleDisplayExceptions(env, who.role === "store" ? who.storeCode : null);
  return json({ email: who.email, role: who.role, storeCode: who.storeCode, stores: STORES, retentionMonths: 12,
    googleOAuthClientId: env.GOOGLE_OAUTH_CLIENT_ID || "",
    fixedSources: { marketingDriveFileId: FIXED_SOURCES.marketingDriveFileId, productMasterFolderId: FIXED_SOURCES.productMasterFolderId },
    storeInventoryRules: inventoryRules, displayExceptions,
    permissions: { canCreate: who.role !== "store", canApprove: who.role !== "store", canReviewAll: who.role !== "store", canManageRules: who.role !== "store", canManageDisplayExceptions: who.role === "store", canDeleteBatch: who.role !== "store", canDeleteCollaboration: who.role !== "store", canCollaborate: who.role !== "store", canFinalizeCollaboration: COLLABORATION_FINALIZERS.has(who.email) } });
}

async function listDisplayExceptions(request: Request, env: StoreTransferEnv): Promise<Response> {
  const who = await actor(request, env);
  const requested = new URL(request.url).searchParams.get("store");
  const scope = visibleStore(requested, who.role, who.storeCode);
  return json({ exceptions: await visibleDisplayExceptions(env, scope), visibleTo: who.role === "store" ? who.storeCode : "hq" });
}

async function saveDisplayException(request: Request, env: StoreTransferEnv, requestedStore: string, requestedSku: string): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env);
  if (who.role !== "store") throw new RequestValidationError("本店展示例外只能由對應門市帳號維護；總部通用規則請至規則管理頁修改。", 403);
  const storeCode = visibleStore(requestedStore, who.role, who.storeCode);
  if (!storeCode) throw new RequestValidationError("必須指定門市。");
  const sku = text(requestedSku, "ERP品號", 80).toLocaleUpperCase("en-US");
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,79}$/.test(sku)) throw new RequestValidationError("ERP品號格式錯誤；請輸入單一完整貨號，不要以逗號串接。");
  const input = await readBody(request, 4096);
  const displayQuantity = quantity(input.displayQuantity, "本店展示最低量");
  if (displayQuantity > 100) throw new RequestValidationError("本店展示最低量不得超過100。");
  const reason = text(input.reason, "設定原因", 300);
  const enabled = input.enabled !== false ? 1 : 0;
  const expectedRevision = Number(input.expectedRevision || 0);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new RequestValidationError("規則版本格式錯誤。");
  const existing = await env.DB.prepare("SELECT * FROM store_transfer_display_exceptions WHERE store_code = ? AND sku = ?").bind(storeCode, sku).first<Record<string, unknown>>();
  const now = new Date().toISOString();
  let action = "created";
  if (!existing) {
    if (expectedRevision !== 0) throw new RequestValidationError("這筆展示例外已變更，請重新整理後再試。", 409);
    await env.DB.prepare("INSERT INTO store_transfer_display_exceptions (store_code, sku, display_quantity, reason, enabled, revision, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)")
      .bind(storeCode, sku, displayQuantity, reason, enabled, now, who.email, now, who.email).run();
  } else {
    if (Number(existing.revision) !== expectedRevision) throw new RequestValidationError("這筆展示例外已被更新，請重新整理後再試。", 409);
    action = Number(existing.enabled) !== enabled ? (enabled ? "enabled" : "disabled") : "updated";
    const updated = await env.DB.prepare("UPDATE store_transfer_display_exceptions SET display_quantity = ?, reason = ?, enabled = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE store_code = ? AND sku = ? AND revision = ?")
      .bind(displayQuantity, reason, enabled, now, who.email, storeCode, sku, expectedRevision).run();
    if (Number(updated.meta.changes || 0) !== 1) throw new RequestValidationError("這筆展示例外已被更新，請重新整理後再試。", 409);
  }
  await env.DB.prepare("INSERT INTO store_transfer_display_exception_events (store_code, sku, display_quantity, reason, enabled, action, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(storeCode, sku, displayQuantity, reason, enabled, action, now, who.email).run();
  const saved = await env.DB.prepare("SELECT * FROM store_transfer_display_exceptions WHERE store_code = ? AND sku = ?").bind(storeCode, sku).first<Record<string, unknown>>();
  return json({ exception: displayExceptionSummary(saved || {}) }, existing ? 200 : 201);
}

function collaborationSummary(row: Record<string, unknown>, includePayload = false): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: String(row.id), weekKey: String(row.week_key), proposalDate: String(row.proposal_date), status: String(row.status),
    storeCodes: JSON.parse(String(row.store_codes || "[]")), itemCount: Number(row.item_count || 0), differenceCount: Number(row.difference_count || 0),
    revision: Number(row.revision || 1), finalizedBatchId: row.finalized_batch_id ? String(row.finalized_batch_id) : "",
    createdAt: String(row.created_at), createdBy: String(row.created_by), updatedAt: String(row.updated_at), updatedBy: String(row.updated_by)
  };
  if (includePayload) { result.payload = String(row.payload); result.payloadSha256 = String(row.payload_sha256); }
  return result;
}

function collaborationPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestValidationError("協作內容格式錯誤。");
  const input = value as Record<string, unknown>;
  if (Number(input.version) !== 1) throw new RequestValidationError("協作內容版本不相容。");
  if (!Array.isArray(input.comparisonReports) || input.comparisonReports.length < 1 || input.comparisonReports.length > 6) throw new RequestValidationError("A/B門市比較內容格式錯誤。");
  const reports = input.comparisonReports.map((rawReport) => {
    if (!rawReport || typeof rawReport !== "object" || Array.isArray(rawReport)) throw new RequestValidationError("A/B門市比較內容格式錯誤。");
    const report = rawReport as Record<string, unknown>;
    const storeCode = text(report.storeCode, "門市代碼", 5) as StoreCode;
    if (!(storeCode in STORES)) throw new RequestValidationError(`未知門市：${storeCode}。`);
    if (!Array.isArray(report.rows) || report.rows.length > 5000) throw new RequestValidationError("A/B比較品項過多。");
    const rows = report.rows.map((rawRow) => {
      if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) throw new RequestValidationError("A/B比較品項格式錯誤。");
      const row = rawRow as Record<string, unknown>;
      const decision = String(row.decision || "accept_formal");
      if (!new Set(["accept_formal", "no_new", "custom"]).has(decision)) throw new RequestValidationError("協作決議格式錯誤。");
      const difference = Number(row.difference || 0);
      if (!Number.isSafeInteger(difference) || Math.abs(difference) > 100000) throw new RequestValidationError("A/B差異量格式錯誤。");
      return {
        section: text(row.section, "比較區塊", 20), sku: text(row.sku, "ERP品號", 80), productName: text(row.productName, "品名"),
        physicalInventory: nonnegativeNumber(row.physicalInventory || 0, "門市庫存"), hqInventory: nonnegativeNumber(row.hqInventory || 0, "總倉庫存"),
        displayQuantity: nonnegativeNumber(row.displayQuantity || 0, "展示量"), pendingQuantity: nonnegativeNumber(row.pendingQuantity || 0, "未完成調入量"),
        localSales42: nonnegativeNumber(row.localSales42 || 0, "近42天銷售"), aQuantity: quantity(row.aQuantity || 0, "系統建議量"), bQuantity: quantity(row.bQuantity || 0, "人工調撥量"),
        difference, formalSuggestedQuantity: quantity(row.formalSuggestedQuantity || 0, "正式新增建議量"),
        aProjection: String(row.aProjection || "").slice(0, 80), bProjection: String(row.bProjection || "").slice(0, 80), itemType: itemType(row.itemType), analysis: String(row.analysis || "").slice(0, 700),
        decision, agreedQuantity: quantity(row.agreedQuantity ?? row.formalSuggestedQuantity ?? 0, "協作決議量"), note: String(row.note || "").normalize("NFKC").trim().slice(0, 500)
      };
    });
    return { storeCode, storeName: String(report.storeName || STORES[storeCode].name).slice(0, 80), rows };
  });
  const formalInput = input.formal;
  if (!formalInput || typeof formalInput !== "object" || Array.isArray(formalInput)) throw new RequestValidationError("正式建議快照格式錯誤。");
  const formal = formalInput as Record<string, unknown>;
  if (!Array.isArray(formal.rows) || formal.rows.length > 5000 || !Array.isArray(formal.shortages) || formal.shortages.length > 5000) throw new RequestValidationError("正式建議快照筆數錯誤。");
  const formalRows = formal.rows.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("正式建議快照格式錯誤。");
    const row = raw as Record<string, unknown>;
    const storeCode = text(row.storeCode, "門市代碼", 5) as StoreCode;
    if (!(storeCode in STORES)) throw new RequestValidationError(`未知門市：${storeCode}。`);
    return {
      storeCode, sku: text(row.sku, "ERP品號", 80), productName: text(row.productName, "品名"),
      suggestedQuantity: quantity(row.suggestedQuantity || 0, "系統建議量"), itemType: itemType(row.itemType),
      calculationDate: dateText(row.calculationDate || input.proposalDate, "計算日期"),
      baseSellableQuantity: nonnegativeNumber(row.baseSellableQuantity || 0, "調撥前可售量"), displayGap: quantity(row.displayGap || 0, "不可售展示缺口"),
      dailySales: nonnegativeNumber(row.dailySales || 0, "日均現場銷售"), systemSellThroughDate: String(row.systemSellThroughDate || "").normalize("NFKC").trim().slice(0, 80),
      systemDecisionReason: String(row.systemDecisionReason || "").normalize("NFKC").trim().slice(0, 500),
      ruleSummary: String(row.ruleSummary || "").normalize("NFKC").trim().slice(0, 500)
    };
  });
  const formalShortages = formal.shortages.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("正式缺貨快照格式錯誤。");
    const row = raw as Record<string, unknown>;
    const storeCode = text(row.storeCode, "門市代碼", 5) as StoreCode;
    if (!(storeCode in STORES)) throw new RequestValidationError(`未知門市：${storeCode}。`);
    return {
      storeCode, sku: text(row.sku, "ERP品號", 80), productName: text(row.productName, "品名"), itemType: itemType(row.itemType),
      demandQuantity: quantity(row.demandQuantity || 0, "需求量"), allocatedQuantity: quantity(row.allocatedQuantity || 0, "已配量"), unfilledQuantity: quantity(row.unfilledQuantity || 0, "未配量"),
      reason: text(row.reason, "未配原因", 500), followUpStatus: String(row.followUpStatus || "待回拋主採購").slice(0, 80),
      currentArrivalDate: row.currentArrivalDate ? dateText(row.currentArrivalDate, "本批到店日") : null,
      nextArrivalDate: row.nextArrivalDate ? dateText(row.nextArrivalDate, "下一輪到店日") : null
    };
  });
  const formalManualFactsInput = formal.manualItemFacts == null ? [] : formal.manualItemFacts;
  const formalManualCatalogInput = formal.manualItemCatalog == null ? [] : formal.manualItemCatalog;
  if (!Array.isArray(formalManualFactsInput) || formalManualFactsInput.length > 20000) throw new RequestValidationError("正式人工新增推估基準筆數錯誤。");
  if (!Array.isArray(formalManualCatalogInput) || formalManualCatalogInput.length > 30000) throw new RequestValidationError("正式人工新增商品目錄筆數錯誤。");
  const formalManualFacts = formalManualFactsInput.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("正式人工新增推估基準格式錯誤。");
    const row = raw as Record<string, unknown>;
    const storeCode = text(row.storeCode, "門市代碼", 5) as StoreCode;
    if (!(storeCode in STORES)) throw new RequestValidationError(`未知門市：${storeCode}。`);
    return {
      storeCode, sku: text(row.sku, "ERP品號", 80).toLocaleUpperCase("en-US"), productName: text(row.productName, "品名"),
      calculationDate: dateText(row.calculationDate || input.proposalDate, "計算日期"),
      baseQuantity: nonnegativeNumber(row.baseQuantity || 0, "調撥前可售量"), displayGap: quantity(row.displayGap || 0, "不可售展示缺口"),
      dailyUsage: nonnegativeNumber(row.dailyUsage || 0, "日均現場銷售"), systemProjection: String(row.systemProjection || "").normalize("NFKC").trim().slice(0, 80),
      systemReason: String(row.systemReason || "").normalize("NFKC").trim().slice(0, 500)
    };
  });
  const formalManualCatalog = formalManualCatalogInput.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("正式人工新增商品目錄格式錯誤。");
    const row = raw as Record<string, unknown>;
    return { sku: text(row.sku, "ERP品號", 80).toLocaleUpperCase("en-US"), productName: text(row.productName, "品名") };
  });
  const scheduleByStore = formal.scheduleByStore && typeof formal.scheduleByStore === "object" && !Array.isArray(formal.scheduleByStore) ? formal.scheduleByStore : {};
  if (JSON.stringify(scheduleByStore).length > 5000) throw new RequestValidationError("到店日快照內容過長。");
  return {
    version: 1, weekKey: text(input.weekKey, "週次", 8), proposalDate: dateText(input.proposalDate, "建議日"),
    responseDueAt: text(input.responseDueAt, "門市回覆期限", 40), lockAt: text(input.lockAt, "鎖定時間", 40),
    comparisonReports: reports,
    formal: { rows: formalRows, shortages: formalShortages, manualItemFacts: formalManualFacts, manualItemCatalog: formalManualCatalog, scheduleByStore }
  };
}

async function listCollaborationDrafts(request: Request, env: StoreTransferEnv): Promise<Response> {
  const who = await actor(request, env); assertHq(who.role);
  const rows = await env.DB.prepare("SELECT id, week_key, proposal_date, status, store_codes, item_count, difference_count, revision, finalized_batch_id, created_at, created_by, updated_at, updated_by FROM store_transfer_collaboration_drafts WHERE removed_at IS NULL ORDER BY updated_at DESC LIMIT 100").all<Record<string, unknown>>();
  return json({ drafts: rows.results.map((row) => collaborationSummary(row)) });
}

async function getCollaborationDraft(request: Request, env: StoreTransferEnv, draftId: string): Promise<Response> {
  const who = await actor(request, env); assertHq(who.role);
  const id = text(draftId, "協作批次編號", 100);
  const row = await env.DB.prepare("SELECT * FROM store_transfer_collaboration_drafts WHERE id = ? AND removed_at IS NULL").bind(id).first<Record<string, unknown>>();
  if (!row) throw new RequestValidationError("找不到此A/B協作批次。", 404);
  return json({ draft: collaborationSummary(row, true) });
}

async function saveCollaborationDraft(request: Request, env: StoreTransferEnv, draftId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env); assertHq(who.role);
  const input = await readBody(request, 2_500_000);
  const id = text(draftId, "協作批次編號", 100);
  const weekKey = text(input.weekKey, "週次", 8);
  if (!/^\d{4}-W\d{2}$/.test(weekKey)) throw new RequestValidationError("週次須為 YYYY-Www 格式。");
  const proposalDate = dateText(input.proposalDate, "建議日");
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new RequestValidationError("協作批次版本格式錯誤。");
  const payloadText = String(input.payload || "");
  const payloadBytes = new TextEncoder().encode(payloadText).byteLength;
  if (!payloadText || payloadBytes > 1_572_864) throw new RequestValidationError("協作內容格式錯誤或超過 1.5 MB 上限。", payloadBytes > 1_572_864 ? 413 : 400);
  const suppliedHash = text(input.payloadSha256, "協作內容雜湊", 64).toLocaleLowerCase("en-US");
  if (!/^[a-f0-9]{64}$/.test(suppliedHash)) throw new RequestValidationError("協作內容雜湊格式錯誤。");
  const suppliedDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payloadText));
  const actualSuppliedHash = [...new Uint8Array(suppliedDigest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (actualSuppliedHash !== suppliedHash) throw new RequestValidationError("協作內容檢核失敗，請重新發布。");
  let parsed: unknown;
  try { parsed = JSON.parse(payloadText); } catch { throw new RequestValidationError("協作內容不是有效JSON。"); }
  const normalizedPayload = collaborationPayload(parsed);
  if (normalizedPayload.weekKey !== weekKey || normalizedPayload.proposalDate !== proposalDate) throw new RequestValidationError("協作內容的週次或建議日不一致。");
  const storedPayload = JSON.stringify(normalizedPayload);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(storedPayload));
  const payloadSha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  const reports = normalizedPayload.comparisonReports as Array<Record<string, unknown>>;
  const storeCodes = reports.map((report) => String(report.storeCode));
  const rows = reports.flatMap((report) => report.rows as unknown[]);
  const differenceCount = rows.filter((row) => Number((row as Record<string, unknown>).difference || 0) !== 0).length;
  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT revision, status, removed_at FROM store_transfer_collaboration_drafts WHERE id = ?").bind(id).first<Record<string, unknown>>();
  const otherActive = await env.DB.prepare("SELECT id FROM store_transfer_collaboration_drafts WHERE week_key = ? AND status = 'draft' AND removed_at IS NULL AND id <> ?").bind(weekKey, id).first();
  if (otherActive) throw new RequestValidationError("本週已有進行中的A/B協作批次，請開啟最新版接續，不要重複建立。", 409);
  if (!existing) {
    if (expectedRevision !== 0) throw new RequestValidationError("協作批次版本已改變，請重新整理。", 409);
    await env.DB.prepare("INSERT INTO store_transfer_collaboration_drafts (id, week_key, proposal_date, status, store_codes, item_count, difference_count, payload, payload_sha256, revision, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)")
      .bind(id, weekKey, proposalDate, JSON.stringify(storeCodes), rows.length, differenceCount, storedPayload, payloadSha256, now, who.email, now, who.email).run();
  } else {
    if (existing.removed_at) throw new RequestValidationError("此A/B協作批次已由總部移出前台；如需重新協作，請發布新的批次。", 409);
    if (String(existing.status) !== "draft") throw new RequestValidationError("此協作批次已轉為正式批次，不能再修改。", 409);
    if (Number(existing.revision) !== expectedRevision) throw new RequestValidationError("這筆協作批次已由其他同事更新，請重新開啟最新版，避免覆蓋。", 409);
    const updated = await env.DB.prepare("UPDATE store_transfer_collaboration_drafts SET proposal_date = ?, store_codes = ?, item_count = ?, difference_count = ?, payload = ?, payload_sha256 = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND status = 'draft' AND revision = ? AND removed_at IS NULL")
      .bind(proposalDate, JSON.stringify(storeCodes), rows.length, differenceCount, storedPayload, payloadSha256, now, who.email, id, expectedRevision).run();
    if (Number(updated.meta.changes || 0) !== 1) throw new RequestValidationError("這筆協作批次已由其他同事更新，請重新開啟最新版，避免覆蓋。", 409);
  }
  const saved = await env.DB.prepare("SELECT id, week_key, proposal_date, status, store_codes, item_count, difference_count, revision, finalized_batch_id, created_at, created_by, updated_at, updated_by FROM store_transfer_collaboration_drafts WHERE id = ? AND removed_at IS NULL").bind(id).first<Record<string, unknown>>();
  return json({ draft: collaborationSummary(saved || {}) }, existing ? 200 : 201);
}

async function deleteCollaborationDraft(request: Request, env: StoreTransferEnv, draftId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env); assertHq(who.role);
  const id = text(draftId, "協作批次編號", 100);
  const draft = await env.DB.prepare("SELECT status, week_key, revision, finalized_batch_id FROM store_transfer_collaboration_drafts WHERE id = ? AND removed_at IS NULL").bind(id).first<Record<string, unknown>>();
  if (!draft) throw new RequestValidationError("找不到此A/B協作批次，可能已由其他同事刪除。", 404);
  if (String(draft.status) !== "draft" || draft.finalized_batch_id) throw new RequestValidationError("已轉為正式批次的A/B協作紀錄不能刪除。", 409);
  const now = new Date().toISOString();
  const removed = await env.DB.prepare("UPDATE store_transfer_collaboration_drafts SET removed_at = ?, removed_by = ?, updated_at = ?, updated_by = ?, revision = revision + 1 WHERE id = ? AND status = 'draft' AND finalized_batch_id IS NULL AND revision = ? AND removed_at IS NULL")
    .bind(now, who.email, now, who.email, id, Number(draft.revision)).run();
  if (Number(removed.meta.changes || 0) !== 1) throw new RequestValidationError("此A/B協作批次已由其他同事更新，請重新整理後再試。", 409);
  return json({ id, weekKey: String(draft.week_key), deleted: true, retainedMonths: 12 });
}

async function pendingPurchases(request: Request, env: StoreTransferEnv): Promise<Response> {
  const who = await actor(request, env);
  const rows = await env.DB.prepare("SELECT sku, product_name, pending_quantity, expected_delivery_date, source_date, updated_at FROM procurement_pending_purchase_snapshot WHERE pending_quantity > 0 ORDER BY sku LIMIT 3000").all();
  return json({ rows: rows.results, visibleTo: who.role === "store" ? who.storeCode : "hq" });
}

async function listBatches(request: Request, env: StoreTransferEnv): Promise<Response> {
  const who = await actor(request, env);
  const scope = visibleStore(new URL(request.url).searchParams.get("store"), who.role, who.storeCode);
  const result = scope
    ? await env.DB.prepare("SELECT b.*, s.status store_status, (SELECT COUNT(*) FROM store_transfer_shortages x WHERE x.batch_id = b.id AND x.store_code = s.store_code AND x.unfilled_quantity > 0) shortage_count, (SELECT COALESCE(SUM(x.unfilled_quantity), 0) FROM store_transfer_shortages x WHERE x.batch_id = b.id AND x.store_code = s.store_code) unfilled_quantity FROM store_transfer_batches b JOIN store_transfer_store_status s ON s.batch_id = b.id WHERE s.store_code = ? AND b.deleted_at IS NULL ORDER BY b.updated_at DESC, b.created_at DESC LIMIT 100").bind(scope).all()
    : await env.DB.prepare("SELECT b.*, (SELECT COUNT(*) FROM store_transfer_store_status s WHERE s.batch_id = b.id) store_total, (SELECT COUNT(*) FROM store_transfer_store_status s WHERE s.batch_id = b.id AND s.status = 'submitted') store_submitted, (SELECT COUNT(*) FROM store_transfer_store_status s WHERE s.batch_id = b.id AND s.status = 'approved') store_approved, (SELECT COUNT(*) FROM store_transfer_store_status s WHERE s.batch_id = b.id AND s.erp_created_at IS NOT NULL) store_erp_created, (SELECT COUNT(*) FROM store_transfer_shortages x WHERE x.batch_id = b.id AND x.unfilled_quantity > 0) shortage_count, (SELECT COALESCE(SUM(x.unfilled_quantity), 0) FROM store_transfer_shortages x WHERE x.batch_id = b.id) unfilled_quantity, (SELECT COUNT(*) FROM store_transfer_notifications n WHERE n.batch_id = b.id) notification_total, (SELECT COUNT(*) FROM store_transfer_notifications n WHERE n.batch_id = b.id AND n.status = 'sent') notification_sent, (SELECT COUNT(*) FROM store_transfer_notifications n WHERE n.batch_id = b.id AND n.status = 'failed') notification_failed FROM store_transfer_batches b WHERE b.deleted_at IS NULL ORDER BY b.updated_at DESC, b.created_at DESC LIMIT 100").all();
  return json({ batches: result.results, scope });
}

async function detail(request: Request, env: StoreTransferEnv, batchId: string): Promise<Response> {
  const who = await actor(request, env);
  const requested = new URL(request.url).searchParams.get("store");
  const scope = visibleStore(requested, who.role, who.storeCode);
  const batch = await env.DB.prepare("SELECT * FROM store_transfer_batches WHERE id = ? AND deleted_at IS NULL").bind(batchId).first();
  if (!batch) throw new RequestValidationError("找不到此週調撥批次。", 404);
  const items = scope
    ? await env.DB.prepare("SELECT * FROM store_transfer_items WHERE batch_id = ? AND store_code = ? ORDER BY sku").bind(batchId, scope).all()
    : await env.DB.prepare("SELECT * FROM store_transfer_items WHERE batch_id = ? ORDER BY store_code, sku").bind(batchId).all();
  const statuses = scope
    ? await env.DB.prepare("SELECT * FROM store_transfer_store_status WHERE batch_id = ? AND store_code = ?").bind(batchId, scope).all()
    : await env.DB.prepare("SELECT * FROM store_transfer_store_status WHERE batch_id = ? ORDER BY store_code").bind(batchId).all();
  const shortages = scope
    ? await env.DB.prepare("SELECT * FROM store_transfer_shortages WHERE batch_id = ? AND store_code = ? ORDER BY sku").bind(batchId, scope).all()
    : await env.DB.prepare("SELECT * FROM store_transfer_shortages WHERE batch_id = ? ORDER BY store_code, sku").bind(batchId).all();
  const events = await env.DB.prepare("SELECT store_code, event_type, summary, created_at, created_by FROM store_transfer_events WHERE batch_id = ? ORDER BY created_at DESC LIMIT 100").bind(batchId).all();
  const supplyRows = await env.DB.prepare("SELECT store_code, sku, COALESCE(store_confirmed_quantity, suggested_quantity) quantity FROM store_transfer_items WHERE batch_id = ?").bind(batchId).all<Record<string, unknown>>();
  const supplyUsage = new Map<string, { currentAllocated: number; otherAllocated: number }>();
  supplyRows.results.forEach((row) => {
    const sku = String(row.sku), current = supplyUsage.get(sku) || { currentAllocated: 0, otherAllocated: 0 }, value = Number(row.quantity || 0);
    current.currentAllocated += value;
    if (scope && String(row.store_code) !== scope) current.otherAllocated += value;
    supplyUsage.set(sku, current);
  });
  const visibleItems = who.role === "store" ? items.results.map((row) => ({
    ...row,
    rule_summary: /人工新增/.test(String(row.rule_summary || "")) ? String(row.rule_summary) : "門市週調撥系統判斷",
    system_reason: storeFacingReason(row.system_reason || row.rule_summary, Number(row.suggested_quantity || 0))
  })) : items.results;
  const visibleShortages = who.role === "store" ? shortages.results.map((row) => ({ ...row, reason: storeFacingReason(row.reason, Number(row.allocated_quantity || 0)) })) : shortages.results;
  return json({ batch, items: visibleItems, shortages: visibleShortages, storeStatuses: statuses.results, events: events.results, scope, supplyUsage: Object.fromEntries(supplyUsage) });
}

async function manualItemFact(request: Request, env: StoreTransferEnv, batchId: string): Promise<Response> {
  const who = await actor(request, env);
  const url = new URL(request.url);
  const scope = visibleStore(url.searchParams.get("store"), who.role, who.storeCode);
  if (!scope) throw new RequestValidationError("必須指定門市。");
  const sku = text(url.searchParams.get("sku"), "ERP品號", 80).toLocaleUpperCase("en-US");
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,79}$/.test(sku)) throw new RequestValidationError("ERP品號格式錯誤。");
  const batchStore = await env.DB.prepare("SELECT b.proposal_date, b.arrival_schedule FROM store_transfer_store_status s JOIN store_transfer_batches b ON b.id = s.batch_id WHERE s.batch_id = ? AND s.store_code = ? AND b.deleted_at IS NULL").bind(batchId, scope).first<Record<string, unknown>>();
  if (!batchStore) throw new RequestValidationError("此批次沒有這間門市。", 404);
  const row = await env.DB.prepare("SELECT store_code, sku, product_name, calculation_date, base_quantity, display_gap, daily_usage, system_projection, system_reason, hq_available, hq_reserve, hq_releasable FROM store_transfer_manual_item_facts WHERE batch_id = ? AND store_code = ? AND sku = ?").bind(batchId, scope, sku).first<Record<string, unknown>>();
  const allocated = await env.DB.prepare("SELECT COALESCE(SUM(COALESCE(store_confirmed_quantity, suggested_quantity)), 0) quantity FROM store_transfer_items WHERE batch_id = ? AND sku = ? AND store_code <> ?").bind(batchId, sku, scope).first<Record<string, unknown>>();
  const otherAllocated = Number(allocated?.quantity || 0);
  if (!row) {
    const catalog = await env.DB.prepare("SELECT product_name, hq_available, hq_reserve, hq_releasable FROM store_transfer_batch_product_catalog WHERE batch_id = ? AND sku = ?").bind(batchId, sku).first<Record<string, unknown>>();
    if (!catalog) throw new RequestValidationError("此品號不在本批次建立時的商品主檔，請確認ERP品號。", 404);
    const schedule = parseJson(batchStore.arrival_schedule);
    const storeSchedule = schedule[scope] && typeof schedule[scope] === "object" && !Array.isArray(schedule[scope]) ? schedule[scope] as Record<string, unknown> : {};
    return json({ storeCode: scope, sku, productName: String(catalog.product_name), calculationDate: String(storeSchedule.currentArrivalDate || batchStore.proposal_date), baseQuantity: 0, displayGap: 0, dailyUsage: 0, systemProjection: "近期無現場銷售", systemReason: "本批次沒有此品號的門市庫存、近期銷售、待發貨或在途紀錄；依現行規則未形成補貨需求", hqAvailable: Number(catalog.hq_available || 0), hqReserve: Number(catalog.hq_reserve || 0), hqReleasable: Number(catalog.hq_releasable || 0), supplyKnown: catalog.hq_releasable != null, otherAllocated });
  }
  return json({
    storeCode: String(row.store_code), sku: String(row.sku), productName: String(row.product_name),
    calculationDate: String(row.calculation_date), baseQuantity: Number(row.base_quantity || 0),
    displayGap: Number(row.display_gap || 0), dailyUsage: Number(row.daily_usage || 0), systemProjection: String(row.system_projection || ""),
    systemReason: who.role === "store" ? storeFacingReason(row.system_reason, 0) : String(row.system_reason || ""), hqAvailable: Number(row.hq_available || 0),
    hqReserve: Number(row.hq_reserve || 0), hqReleasable: Number(row.hq_releasable || 0), supplyKnown: row.hq_releasable != null, otherAllocated
  });
}

async function createBatch(request: Request, env: StoreTransferEnv): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env); assertHq(who.role);
  const input = await readBody(request, 10_000_000);
  const collaborationId = String(input.collaborationId || "").normalize("NFKC").trim();
  const collaborationRevision = Number(input.collaborationRevision || 0);
  let collaboration: Record<string, unknown> | null = null;
  if (collaborationId) {
    assertCollaborationFinalizer(who.email);
    if (collaborationId.length > 100 || !Number.isInteger(collaborationRevision) || collaborationRevision < 1) throw new RequestValidationError("A/B協作批次版本格式錯誤。");
    collaboration = await env.DB.prepare("SELECT id, week_key, status, revision, finalized_batch_id FROM store_transfer_collaboration_drafts WHERE id = ? AND removed_at IS NULL").bind(collaborationId).first<Record<string, unknown>>();
    if (!collaboration) throw new RequestValidationError("找不到此A/B協作批次。", 404);
    if (String(collaboration.status) !== "draft" || collaboration.finalized_batch_id) throw new RequestValidationError("此A/B協作批次已轉成正式批次，不能重複建立。", 409);
    if (Number(collaboration.revision) !== collaborationRevision) throw new RequestValidationError("A/B協作批次已由其他同事更新，請重新開啟最新版。", 409);
  }
  const id = text(input.id, "批次編號", 80);
  const weekKey = text(input.weekKey, "週次", 8);
  if (!/^\d{4}-W\d{2}$/.test(weekKey)) throw new RequestValidationError("週次須為 YYYY-Www 格式。");
  if (collaboration && String(collaboration.week_key) !== weekKey) throw new RequestValidationError("A/B協作批次與正式批次週次不一致。");
  const proposalDate = dateText(input.proposalDate, "建議日");
  const responseDueAt = text(input.responseDueAt, "門市回覆期限", 40);
  const lockAt = text(input.lockAt, "鎖定時間", 40);
  if (Number.isNaN(Date.parse(responseDueAt)) || Number.isNaN(Date.parse(lockAt))) throw new RequestValidationError("回覆期限或鎖定時間格式錯誤。");
  if (Date.parse(responseDueAt) > Date.parse(lockAt)) throw new RequestValidationError("門市回覆期限不可晚於鎖定時間。");
  const inventoryRules = await storeInventoryConfig(env);
  const holidays = new Set(Array.isArray(inventoryRules.config.workdayHolidays) ? inventoryRules.config.workdayHolidays.map(String) : []);
  // 建議日以實際執行日為準，允許臨時於週末補跑；標準週次仍由前台依假日規則帶入。
  const lockDate = new Date(lockAt).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  if (!isWorkday(lockDate, holidays)) throw new RequestValidationError("門市回覆鎖定日不是公司工作日，請順延至下一工作日。");
  const items = input.items;
  const shortages = input.shortages == null ? [] : input.shortages;
  const manualItemFacts = input.manualItemFacts == null ? [] : input.manualItemFacts;
  const manualItemCatalog = input.manualItemCatalog == null ? [] : input.manualItemCatalog;
  if (!Array.isArray(items) || items.length > 5000) throw new RequestValidationError("逐品項建議須為0至5000筆。");
  if (!Array.isArray(shortages) || shortages.length > 5000) throw new RequestValidationError("缺貨未配明細須為0至5000筆。");
  if (!Array.isArray(manualItemFacts) || manualItemFacts.length > 20000) throw new RequestValidationError("人工新增品項推估基準須為0至20000筆。");
  if (!Array.isArray(manualItemCatalog) || manualItemCatalog.length > 30000) throw new RequestValidationError("人工新增品項目錄須為0至30000筆。");
  if (!items.length && !shortages.length) throw new RequestValidationError("本批沒有可保存的調撥建議或缺貨未配資料。");
  const seen = new Set<string>();
  const normalized = items.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("逐品項建議格式錯誤。");
    const item = raw as Record<string, unknown>;
    const storeCode = text(item.storeCode, "門市代碼", 5) as StoreCode;
    if (!(storeCode in STORES)) throw new RequestValidationError(`未知門市：${storeCode}。`);
    const sku = text(item.sku, "ERP品號", 80).toLocaleUpperCase("en-US");
    const type = itemType(item.itemType);
    const key = `${storeCode}\u0000${sku}\u0000${type}`;
    if (seen.has(key)) throw new RequestValidationError(`${storeCode}／${sku}重複。`);
    seen.add(key);
    const suggested = quantity(item.suggestedQuantity, "系統建議量");
    validateConsumablePack(type, suggested, "系統建議量");
    const rawSnapshot = item.decisionSnapshot && typeof item.decisionSnapshot === "object" && !Array.isArray(item.decisionSnapshot)
      ? item.decisionSnapshot as Record<string, unknown> : {};
    const decisionSnapshot = JSON.stringify({
      localSales42: nonnegativeNumber(rawSnapshot.localSales42 || 0, "近42天現場銷售"),
      b3Sales42: nonnegativeNumber(rawSnapshot.b3Sales42 || 0, "近42天B3銷售"),
      physicalInventory: nonnegativeNumber(rawSnapshot.physicalInventory || 0, "現有實體庫存"),
      pendingSubmittedQuantity: nonnegativeNumber(rawSnapshot.pendingSubmittedQuantity || 0, "待發貨量"),
      inTransitQuantity: nonnegativeNumber(rawSnapshot.inTransitQuantity || 0, "在途量"),
      targetQuantity: nonnegativeNumber(rawSnapshot.targetQuantity || 0, "目標量"),
      displayQuantity: nonnegativeNumber(rawSnapshot.displayQuantity || 0, "不可售展示量"),
      currentArrivalDate: rawSnapshot.currentArrivalDate ? dateText(rawSnapshot.currentArrivalDate, "本批到店日") : "",
      nextArrivalDate: rawSnapshot.nextArrivalDate ? dateText(rawSnapshot.nextArrivalDate, "下一輪到店日") : "",
      preArrivalStockoutRisk: Boolean(rawSnapshot.preArrivalStockoutRisk),
      hqAvailable: quantity(rawSnapshot.hqAvailable || 0, "總倉可用量"),
      hqReserve: quantity(rawSnapshot.hqReserve || 0, "總部保留量"),
      hqReleasable: quantity(rawSnapshot.hqReleasable || 0, "總倉可釋出量"),
      hqSupplyCeiling: quantity(rawSnapshot.hqSupplyCeiling ?? rawSnapshot.hqReleasable ?? rawSnapshot.hqAvailable ?? 0, "本批供應上限")
    });
    return {
      storeCode, sku, productName: text(item.productName, "品名"), suggested,
      ruleSummary: String(item.ruleSummary || "").slice(0, 500), itemType: type,
      calculationDate: dateText(item.calculationDate || proposalDate, "計算日期"),
      baseQuantity: nonnegativeNumber(item.baseSellableQuantity || 0, "調撥前可售量"),
      displayGap: quantity(item.displayGap || 0, "不可售展示缺口"),
      dailyUsage: nonnegativeNumber(item.dailySales || 0, "日均現場銷售"),
      systemProjection: String(item.systemSellThroughDate || "").normalize("NFKC").trim().slice(0, 80),
      systemReason: String(item.systemDecisionReason || "").normalize("NFKC").trim().slice(0, 500),
      decisionSnapshot
    };
  });
  const shortageSeen = new Set<string>();
  const normalizedShortages = shortages.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("缺貨未配明細格式錯誤。");
    const row = raw as Record<string, unknown>;
    const storeCode = text(row.storeCode, "門市代碼", 5) as StoreCode;
    if (!(storeCode in STORES)) throw new RequestValidationError(`未知門市：${storeCode}。`);
    const sku = text(row.sku, "ERP品號", 80);
    const type = itemType(row.itemType);
    const key = `${storeCode}\u0000${sku}\u0000${type}`;
    if (shortageSeen.has(key)) throw new RequestValidationError(`${storeCode}／${sku}缺貨未配重複。`);
    shortageSeen.add(key);
    const demand = quantity(row.demandQuantity, "需求量");
    const allocated = quantity(row.allocatedQuantity, "已配量");
    const unfilled = quantity(row.unfilledQuantity, "未配量");
    if (allocated + unfilled !== demand) throw new RequestValidationError(`${storeCode}／${sku}需求量不等於已配量加未配量。`);
    return { storeCode, sku, type, productName: text(row.productName, "品名"), demand, allocated, unfilled,
      reason: text(row.reason, "未配原因", 500), followUpStatus: String(row.followUpStatus || "待回拋主採購").slice(0, 80),
      currentArrivalDate: row.currentArrivalDate ? dateText(row.currentArrivalDate, "本批到店日") : null,
      nextArrivalDate: row.nextArrivalDate ? dateText(row.nextArrivalDate, "下一輪到店日") : null };
  });
  const stores = [...new Set([...normalized.map((item) => item.storeCode), ...normalizedShortages.map((item) => item.storeCode)])];
  const factSeen = new Set<string>();
  const normalizedManualItemFacts = manualItemFacts.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("人工新增品項推估基準格式錯誤。");
    const row = raw as Record<string, unknown>;
    const storeCode = text(row.storeCode, "門市代碼", 5) as StoreCode;
    if (!(storeCode in STORES)) throw new RequestValidationError(`人工新增品項推估基準含未知門市：${storeCode}。`);
    const sku = text(row.sku, "ERP品號", 80).toLocaleUpperCase("en-US");
    const key = `${storeCode}\u0000${sku}`;
    if (factSeen.has(key)) throw new RequestValidationError(`${storeCode}／${sku}人工新增品項推估基準重複。`);
    factSeen.add(key);
    return {
      storeCode, sku, productName: text(row.productName, "品名"),
      calculationDate: dateText(row.calculationDate || proposalDate, "計算日期"),
      baseQuantity: nonnegativeNumber(row.baseQuantity || 0, "調撥前可售量"),
      displayGap: quantity(row.displayGap || 0, "不可售展示缺口"),
      dailyUsage: nonnegativeNumber(row.dailyUsage || 0, "日均現場銷售"),
      systemProjection: String(row.systemProjection || "").normalize("NFKC").trim().slice(0, 80),
      systemReason: String(row.systemReason || "").normalize("NFKC").trim().slice(0, 500),
      hqAvailable: quantity(row.hqAvailable || 0, "總倉可用量"),
      hqReserve: quantity(row.hqReserve || 0, "總部保留量"),
      hqReleasable: quantity(row.hqReleasable || 0, "總倉可釋出量")
    };
  }).filter((row) => stores.includes(row.storeCode));
  const catalogSeen = new Set<string>();
  const normalizedManualItemCatalog = manualItemCatalog.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("人工新增品項目錄格式錯誤。");
    const row = raw as Record<string, unknown>;
    const sku = text(row.sku, "ERP品號", 80).toLocaleUpperCase("en-US");
    if (catalogSeen.has(sku)) throw new RequestValidationError(`${sku}人工新增品項目錄重複。`);
    catalogSeen.add(sku);
    return { sku, productName: text(row.productName, "品名"), hqAvailable: quantity(row.hqAvailable || 0, "總倉可用量"), hqReserve: quantity(row.hqReserve || 0, "總部保留量"), hqReleasable: quantity(row.hqReleasable || 0, "總倉可釋出量") };
  });
  const arrivalSchedule = input.arrivalSchedule && typeof input.arrivalSchedule === "object" && !Array.isArray(input.arrivalSchedule) ? JSON.stringify(input.arrivalSchedule) : "{}";
  if (arrivalSchedule.length > 5000) throw new RequestValidationError("到店日快照內容過長。");
  const now = new Date().toISOString();
  const itemInsertSql = `INSERT INTO store_transfer_items (batch_id, store_code, sku, product_name, suggested_quantity, rule_summary, item_type, calculation_date, base_quantity, display_gap, daily_usage, system_projection, system_reason, decision_snapshot, updated_at, updated_by)
    SELECT ?1, json_extract(value, '$.storeCode'), json_extract(value, '$.sku'), json_extract(value, '$.productName'), json_extract(value, '$.suggested'), json_extract(value, '$.ruleSummary'), json_extract(value, '$.itemType'), json_extract(value, '$.calculationDate'), json_extract(value, '$.baseQuantity'), json_extract(value, '$.displayGap'), json_extract(value, '$.dailyUsage'), json_extract(value, '$.systemProjection'), json_extract(value, '$.systemReason'), json_extract(value, '$.decisionSnapshot'), ?3, ?4 FROM json_each(?2)`;
  const shortageInsertSql = `INSERT INTO store_transfer_shortages (batch_id, store_code, sku, product_name, item_type, demand_quantity, allocated_quantity, unfilled_quantity, reason, follow_up_status, current_arrival_date, next_arrival_date, created_at, updated_at)
    SELECT ?1, json_extract(value, '$.storeCode'), json_extract(value, '$.sku'), json_extract(value, '$.productName'), json_extract(value, '$.type'), json_extract(value, '$.demand'), json_extract(value, '$.allocated'), json_extract(value, '$.unfilled'), json_extract(value, '$.reason'), json_extract(value, '$.followUpStatus'), json_extract(value, '$.currentArrivalDate'), json_extract(value, '$.nextArrivalDate'), ?3, ?3 FROM json_each(?2)`;
  const manualItemFactInsertSql = `INSERT INTO store_transfer_manual_item_facts (batch_id, store_code, sku, product_name, calculation_date, base_quantity, display_gap, daily_usage, system_projection, system_reason, hq_available, hq_reserve, hq_releasable, created_at)
    SELECT ?1, json_extract(value, '$.storeCode'), json_extract(value, '$.sku'), json_extract(value, '$.productName'), json_extract(value, '$.calculationDate'), json_extract(value, '$.baseQuantity'), json_extract(value, '$.displayGap'), json_extract(value, '$.dailyUsage'), json_extract(value, '$.systemProjection'), json_extract(value, '$.systemReason'), json_extract(value, '$.hqAvailable'), json_extract(value, '$.hqReserve'), json_extract(value, '$.hqReleasable'), ?3 FROM json_each(?2)`;
  const manualItemCatalogInsertSql = `INSERT INTO store_transfer_batch_product_catalog (batch_id, sku, product_name, hq_available, hq_reserve, hq_releasable, created_at)
    SELECT ?1, json_extract(value, '$.sku'), json_extract(value, '$.productName'), json_extract(value, '$.hqAvailable'), json_extract(value, '$.hqReserve'), json_extract(value, '$.hqReleasable'), ?3 FROM json_each(?2)`;
  const batchInsert = collaborationId
    ? env.DB.prepare("INSERT INTO store_transfer_batches (id, week_key, proposal_date, response_due_at, lock_at, status, store_codes, item_count, suggested_quantity, approved_quantity, arrival_schedule, source_collaboration_id, created_at, created_by, updated_at, updated_by) SELECT ?, ?, ?, ?, ?, 'open', ?, ?, ?, 0, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM store_transfer_collaboration_drafts WHERE id = ? AND status = 'draft' AND revision = ? AND removed_at IS NULL)")
      .bind(id, weekKey, proposalDate, responseDueAt, lockAt, JSON.stringify(stores), normalized.length, normalized.reduce((sum, item) => sum + item.suggested, 0), arrivalSchedule, collaborationId, now, who.email, now, who.email, collaborationId, collaborationRevision)
    : env.DB.prepare("INSERT INTO store_transfer_batches (id, week_key, proposal_date, response_due_at, lock_at, status, store_codes, item_count, suggested_quantity, approved_quantity, arrival_schedule, source_collaboration_id, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, 0, ?, NULL, ?, ?, ?, ?)")
      .bind(id, weekKey, proposalDate, responseDueAt, lockAt, JSON.stringify(stores), normalized.length, normalized.reduce((sum, item) => sum + item.suggested, 0), arrivalSchedule, now, who.email, now, who.email);
  const statements = [
    env.DB.prepare("INSERT INTO store_transfer_events (batch_id, event_type, summary, created_at, created_by) SELECT id, 'cancelled', ?, ?, ? FROM store_transfer_batches WHERE week_key = ? AND status IN ('open', 'review') AND deleted_at IS NULL AND id <> ?").bind(`已由新版批次${id}取代，僅供查閱`, now, who.email, weekKey, id),
    env.DB.prepare("UPDATE store_transfer_batches SET status = 'cancelled', updated_at = ?, updated_by = ?, revision = revision + 1 WHERE week_key = ? AND status IN ('open', 'review') AND deleted_at IS NULL AND id <> ?").bind(now, who.email, weekKey, id),
    batchInsert,
    ...(collaborationId ? [env.DB.prepare("UPDATE store_transfer_collaboration_drafts SET status = 'finalized', finalized_batch_id = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND status = 'draft' AND revision = ? AND removed_at IS NULL").bind(id, now, who.email, collaborationId, collaborationRevision)] : []),
    ...chunks(normalized).map((rows) => env.DB.prepare(itemInsertSql).bind(id, JSON.stringify(rows), now, who.email)),
    ...chunks(normalizedShortages).map((rows) => env.DB.prepare(shortageInsertSql).bind(id, JSON.stringify(rows), now)),
    ...chunks(normalizedManualItemFacts).map((rows) => env.DB.prepare(manualItemFactInsertSql).bind(id, JSON.stringify(rows), now)),
    ...chunks(normalizedManualItemCatalog).map((rows) => env.DB.prepare(manualItemCatalogInsertSql).bind(id, JSON.stringify(rows), now)),
    ...stores.map((storeCode) => env.DB.prepare("INSERT INTO store_transfer_store_status (batch_id, store_code, status, updated_at) VALUES (?, ?, 'pending', ?)").bind(id, storeCode, now)),
    ...stores.map((storeCode) => env.DB.prepare("INSERT INTO store_transfer_notifications (batch_id, store_code, recipient, status, created_at) VALUES (?, ?, ?, 'pending', ?)").bind(id, storeCode, STORES[storeCode].email, now)),
    env.DB.prepare("INSERT INTO store_transfer_events (batch_id, event_type, summary, created_at, created_by) VALUES (?, 'created', ?, ?, ?)").bind(id, `建立${stores.length}間門市、${normalized.length}筆建議、${normalizedShortages.length}筆缺貨未配`, now, who.email)
  ];
  await env.DB.batch(statements);
  return json({ id, status: "open", stores, itemCount: normalized.length, shortageCount: normalizedShortages.length }, 201);
}

async function sendBatchNotifications(request: Request, env: StoreTransferEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env); assertHq(who.role);
  const batch = await env.DB.prepare("SELECT id, week_key, proposal_date, response_due_at, created_by FROM store_transfer_batches WHERE id = ? AND deleted_at IS NULL").bind(batchId).first<Record<string, unknown>>();
  if (!batch) throw new RequestValidationError("找不到此週調撥批次。", 404);
  const notifications = await env.DB.prepare("SELECT id, store_code, recipient, status FROM store_transfer_notifications WHERE batch_id = ? AND status != 'sent' ORDER BY store_code").bind(batchId).all<Record<string, unknown>>();
  if (!notifications.results.length) return json({ status: "sent", sent: 0, failed: 0, remaining: 0 });

  const failAll = async (stage: string, message: string, status: number) => {
    const now = new Date().toISOString();
    const error = `${stage}：${message}`.slice(0, 500);
    await env.DB.prepare("UPDATE store_transfer_notifications SET status = 'failed', retry_count = retry_count + 1, last_attempt_at = ?, error_summary = ? WHERE batch_id = ? AND status != 'sent'").bind(now, error, batchId).run();
    return json({ status: "failed", stage, error, sent: 0, failed: notifications.results.length, remaining: notifications.results.length }, status);
  };
  const token = request.headers.get("X-Google-Access-Token") || "";
  if (!token || token.length > 4096) return failAll("Google授權檢查", "授權資料不存在或已失效，請重新完成公司 Google 授權。", 401);
  let identityResponse: Response;
  try {
    identityResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    return failAll("Google授權檢查", `無法連線至Google帳號驗證服務（${error instanceof Error ? error.message : "連線失敗"}）。`, 502);
  }
  if (!identityResponse.ok) return failAll("Google授權檢查", identityResponse.status === 401 ? "授權已過期，請重新完成公司 Google 授權。" : `Google帳號驗證失敗（HTTP ${identityResponse.status}）。`, identityResponse.status === 401 ? 401 : 502);
  const identity: { email?: string } = await identityResponse.json<{ email?: string }>().catch(() => ({}));
  const sender = String(identity.email || "").toLocaleLowerCase("en-US");
  if (sender !== who.email) return failAll("Google授權檢查", "Google授權帳號必須與目前公司登入帳號相同。", 403);

  const totals = await env.DB.prepare("SELECT s.store_code, COUNT(i.id) item_count, COALESCE(SUM(i.suggested_quantity), 0) suggested_quantity, (SELECT COUNT(*) FROM store_transfer_shortages x WHERE x.batch_id = s.batch_id AND x.store_code = s.store_code AND x.unfilled_quantity > 0) shortage_count, (SELECT COALESCE(SUM(x.unfilled_quantity), 0) FROM store_transfer_shortages x WHERE x.batch_id = s.batch_id AND x.store_code = s.store_code) unfilled_quantity FROM store_transfer_store_status s LEFT JOIN store_transfer_items i ON i.batch_id = s.batch_id AND i.store_code = s.store_code WHERE s.batch_id = ? GROUP BY s.batch_id, s.store_code").bind(batchId).all<Record<string, unknown>>();
  const totalsByStore = new Map(totals.results.map((row) => [String(row.store_code), row]));
  const due = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }).format(new Date(String(batch.response_due_at)));
  const toolUrl = `${new URL(request.url).origin}/store-transfer/`;
  let sent = 0;
  let failed = 0;
  for (const notification of notifications.results) {
    const storeCode = String(notification.store_code) as StoreCode;
    const store = STORES[storeCode];
    const summary = totalsByStore.get(storeCode) || {};
    const subject = `【翔仔居家】${String(batch.week_key)}門市週調撥待確認｜${store.name}`;
    const message = [
      `From: ${sender}`,
      `To: ${String(notification.recipient)}`,
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      `${store.name}您好：`,
      "",
      "總部已建立本週正式補貨批次，請登入門市週補貨與調撥工具確認數量並送出。",
      `週次：${String(batch.week_key)}`,
      `建議產生日：${String(batch.proposal_date)}`,
      `門市回覆期限：${due}`,
      `本店建議：${Number(summary.item_count || 0)}項／${Number(summary.suggested_quantity || 0)}件`,
      `缺貨未配：${Number(summary.shortage_count || 0)}項／${Number(summary.unfilled_quantity || 0)}件`,
      `操作網址：${toolUrl}`,
      `登入帳號：${String(notification.recipient)}`,
      "",
      `批次編號：${String(batch.id)}`,
      `建立者：${String(batch.created_by)}`,
      "此信只提供批次摘要；實際品項與數量請以工具內的最新版為準。"
    ].join("\r\n");
    const now = new Date().toISOString();
    try {
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: encodeBase64Url(message) })
      });
      const payload: { id?: string; error?: { message?: string } } = await response.json<{ id?: string; error?: { message?: string } }>().catch(() => ({}));
      if (!response.ok || !payload.id) throw new Error(payload.error?.message || `Gmail HTTP ${response.status}`);
      await env.DB.prepare("UPDATE store_transfer_notifications SET status = 'sent', provider_message_id = ?, retry_count = retry_count + 1, last_attempt_at = ?, sent_at = ?, error_summary = NULL WHERE id = ?").bind(payload.id, now, now, notification.id).run();
      sent += 1;
    } catch (error) {
      const message = `Gmail寄送：${error instanceof Error ? error.message : "寄送失敗"}`.slice(0, 500);
      await env.DB.prepare("UPDATE store_transfer_notifications SET status = 'failed', retry_count = retry_count + 1, last_attempt_at = ?, error_summary = ? WHERE id = ?").bind(now, message, notification.id).run();
      failed += 1;
    }
  }
  return json({ status: failed ? (sent ? "partial" : "failed") : "sent", sent, failed, remaining: failed });
}

async function deleteBatch(request: Request, env: StoreTransferEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env); assertHq(who.role);
  const batch = await env.DB.prepare("SELECT status, week_key, revision, (SELECT COUNT(*) FROM store_transfer_store_status s WHERE s.batch_id = store_transfer_batches.id AND s.status = 'approved') approved_store_count FROM store_transfer_batches WHERE id = ? AND deleted_at IS NULL").bind(batchId).first<Record<string, unknown>>();
  if (!batch) throw new RequestValidationError("找不到此週調撥批次。", 404);
  const status = String(batch.status);
  const waitingForStores = status === "open" && Number(batch.approved_store_count || 0) === 0;
  if (status !== "cancelled" && !waitingForStores) throw new RequestValidationError("只能刪除已取代／已取消批次，或仍在等待門市且尚無任何門市核准的批次。", 409);
  const now = new Date().toISOString();
  const summary = waitingForStores ? `總部刪除${String(batch.week_key)}等待門市批次；尚無門市核准，資料保留12個月` : `總部將${String(batch.week_key)}批次移出前台清單；資料保留12個月`;
  const result = await env.DB.batch([
    env.DB.prepare("INSERT INTO store_transfer_events (batch_id, event_type, summary, created_at, created_by) VALUES (?, 'cancelled', ?, ?, ?)").bind(batchId, summary, now, who.email),
    env.DB.prepare("UPDATE store_transfer_batches SET deleted_at = ?, deleted_by = ?, updated_at = ?, updated_by = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL AND (status = 'cancelled' OR (status = 'open' AND NOT EXISTS (SELECT 1 FROM store_transfer_store_status s WHERE s.batch_id = store_transfer_batches.id AND s.status = 'approved')))").bind(now, who.email, now, who.email, batchId, Number(batch.revision))
  ]);
  if (Number(result[1].meta.changes || 0) !== 1) throw new RequestValidationError("批次狀態已由其他同事更新，請重新整理後再試。", 409);
  return json({ id: batchId, deleted: true, retainedMonths: 12 });
}

async function saveStore(request: Request, env: StoreTransferEnv, batchId: string, requestedStore: string, submit: boolean): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env);
  const storeCode = visibleStore(requestedStore, who.role, who.storeCode);
  if (!storeCode) throw new RequestValidationError("必須指定門市。");
  const batch = await env.DB.prepare("SELECT status, lock_at, proposal_date, arrival_schedule FROM store_transfer_batches WHERE id = ?").bind(batchId).first<Record<string, unknown>>();
  if (!batch) throw new RequestValidationError("找不到此週調撥批次。", 404);
  if (!["open", "review"].includes(String(batch.status))) throw new RequestValidationError("此批次目前不可再修改。", 409);
  const storeState = await env.DB.prepare("SELECT status, correction_mode FROM store_transfer_store_status WHERE batch_id = ? AND store_code = ?").bind(batchId, storeCode).first<Record<string, unknown>>();
  if (!storeState) throw new RequestValidationError("此批次沒有這間門市。", 404);
  const returnedForStoreEdit = String(storeState.correction_mode || "") === "store";
  if (who.role === "store" && Date.now() >= Date.parse(String(batch.lock_at)) && !returnedForStoreEdit) throw new RequestValidationError("回覆時間已截止；請聯絡總部協助更正。", 409);
  if (who.role === "store" && String(storeState.status) === "submitted") throw new RequestValidationError("已送出總部覆核；請先按撤回修改。", 409);
  const input = await readBody(request);
  if (!Array.isArray(input.items) || input.items.length > 2000) throw new RequestValidationError("確認明細格式錯誤。");
  const allExisting = await env.DB.prepare("SELECT store_code, sku, item_type, suggested_quantity, store_confirmed_quantity, rule_summary, decision_snapshot FROM store_transfer_items WHERE batch_id = ?").bind(batchId).all<Record<string, unknown>>();
  const existing = { results: allExisting.results.filter((row) => String(row.store_code) === storeCode) };
  const manualFactsResult = await env.DB.prepare("SELECT * FROM store_transfer_manual_item_facts WHERE batch_id = ? AND store_code = ?").bind(batchId, storeCode).all<Record<string, unknown>>();
  const manualFacts = new Map(manualFactsResult.results.map((row) => [String(row.sku), row]));
  const catalogResult = await env.DB.prepare("SELECT sku, product_name, hq_available, hq_reserve, hq_releasable FROM store_transfer_batch_product_catalog WHERE batch_id = ?").bind(batchId).all<Record<string, unknown>>();
  const manualCatalog = new Map(catalogResult.results.map((row) => [String(row.sku), row]));
  const schedule = parseJson(batch.arrival_schedule);
  const currentArrivalDate = String((schedule[storeCode] as Record<string, unknown> | undefined)?.currentArrivalDate || batch.proposal_date);
  const suggested = new Map(existing.results.map((row) => [`${row.sku}\u0000${row.item_type}`, {
    suggested: Number(row.suggested_quantity), current: Number(row.store_confirmed_quantity ?? row.suggested_quantity), manual: /人工新增/.test(String(row.rule_summary || "")), snapshot: parseJson(row.decision_snapshot)
  }]));
  if (input.items.length < existing.results.length) throw new RequestValidationError("確認明細不完整；移除品項請使用移除按鈕，系統會保留稽核紀錄。", 409);
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const requestedBySku = new Map<string, number>();
  const supplyCeilingBySku = new Map<string, number>();
  const otherStoreAllocationBySku = new Map<string, number>();
  allExisting.results.filter((row) => String(row.store_code) !== storeCode).forEach((row) => {
    const sku = String(row.sku);
    otherStoreAllocationBySku.set(sku, (otherStoreAllocationBySku.get(sku) || 0) + Number(row.store_confirmed_quantity ?? row.suggested_quantity));
    const snapshot = parseJson(row.decision_snapshot);
    if (Object.prototype.hasOwnProperty.call(snapshot, "hqSupplyCeiling")) supplyCeilingBySku.set(sku, Math.max(supplyCeilingBySku.get(sku) || 0, Number(snapshot.hqSupplyCeiling || 0)));
  });
  let addedCount = 0;
  let removedCount = 0;
  const updates = (input.items as unknown[]).map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("確認明細格式錯誤。");
    const item = raw as Record<string, unknown>;
    const sku = text(item.sku, "ERP品號", 80).toLocaleUpperCase("en-US");
    const type = itemType(item.itemType);
    const key = `${sku}\u0000${type}`;
    if (seen.has(key)) throw new RequestValidationError(`${sku}確認明細重複。`);
    seen.add(key);
    const confirmed = quantity(item.confirmedQuantity, "門市確認量");
    requestedBySku.set(sku, (requestedBySku.get(sku) || 0) + confirmed);
    validateConsumablePack(type, confirmed, "門市確認量");
    const reason = String(item.reason || "").normalize("NFKC").trim().slice(0, 300);
    const original = suggested.get(`${sku}\u0000${type}`);
    if (!original) {
      const catalog = manualCatalog.get(sku);
      const fact = manualFacts.get(sku) || (catalog ? { product_name: catalog.product_name, calculation_date: currentArrivalDate, base_quantity: 0, display_gap: 0, daily_usage: 0, system_projection: "近期無現場銷售", system_reason: "本批次沒有此品號的門市庫存、近期銷售、待發貨或在途紀錄；依現行規則未形成補貨需求", hq_available: catalog.hq_available, hq_reserve: catalog.hq_reserve, hq_releasable: catalog.hq_releasable } : null);
      if (!fact) throw new RequestValidationError(`${sku}缺少本批次的庫存與銷售推估基準，無法人工新增。`);
      const productName = text(fact.product_name, "人工新增品名");
      if (confirmed === 0) throw new RequestValidationError(`${sku}為人工新增品項，確認量須大於0。`);
      if (!reason) throw new RequestValidationError(`${sku}為人工新增品項，請填寫新增原因。`);
      if (fact.hq_releasable != null) supplyCeilingBySku.set(sku, Number(fact.hq_releasable));
      addedCount += 1;
      const snapshot = JSON.stringify({ hqAvailable: Number(fact.hq_available || 0), hqReserve: Number(fact.hq_reserve || 0), hqReleasable: Number(fact.hq_releasable || 0), hqSupplyCeiling: Number(fact.hq_releasable || 0) });
      return env.DB.prepare("INSERT INTO store_transfer_items (batch_id, store_code, sku, product_name, suggested_quantity, store_confirmed_quantity, store_reason, rule_summary, item_type, calculation_date, base_quantity, display_gap, daily_usage, system_projection, system_reason, decision_snapshot, updated_at, updated_by) VALUES (?, ?, ?, ?, 0, ?, ?, '門市人工新增；沿用批次建立時的庫存與近42天銷售基準', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(batchId, storeCode, sku, productName, confirmed, reason, type, fact.calculation_date, fact.base_quantity, fact.display_gap, fact.daily_usage, fact.system_projection, String(fact.system_reason || ""), snapshot, now, who.email);
    }
    if (Object.prototype.hasOwnProperty.call(original.snapshot, "hqSupplyCeiling")) supplyCeilingBySku.set(sku, Math.max(supplyCeilingBySku.get(sku) || 0, Number(original.snapshot.hqSupplyCeiling || 0)));
    if ((confirmed !== original.suggested || original.manual) && !reason) throw new RequestValidationError(`${sku}的門市確認量與系統建議不同，請填寫人工調整原因。`);
    if (original.current > 0 && confirmed === 0) removedCount += 1;
    return env.DB.prepare("UPDATE store_transfer_items SET store_confirmed_quantity = ?, store_reason = ?, updated_at = ?, updated_by = ? WHERE batch_id = ? AND store_code = ? AND sku = ? AND item_type = ?").bind(confirmed, reason, now, who.email, batchId, storeCode, sku, type);
  });
  for (const [sku, requested] of requestedBySku) {
    if (!supplyCeilingBySku.has(sku)) continue;
    const ceiling = Number(supplyCeilingBySku.get(sku) || 0);
    const occupied = Number(otherStoreAllocationBySku.get(sku) || 0);
    if (occupied + requested > ceiling) {
      const message = who.role === "store"
        ? `${sku}總倉供應量不足，無法以目前申請量送出；請降低數量後重試。`
        : `${sku}總倉本批可供應${ceiling}件，其他門市已占用${occupied}件，本店最多可申請${Math.max(0, ceiling - occupied)}件；請修改數量後再送出。`;
      throw new RequestValidationError(message, 409);
    }
  }
  for (const key of suggested.keys()) if (!seen.has(key)) throw new RequestValidationError("確認明細不完整；移除品項請使用移除按鈕，系統會保留稽核紀錄。", 409);
  const status = submit ? "submitted" : "saved";
  const summary = `${submit ? "門市送出確認" : "門市暫存確認"}；人工新增${addedCount}項、移除${removedCount}項`;
  const results = await env.DB.batch([
    ...updates,
    env.DB.prepare("UPDATE store_transfer_store_status SET status = ?, submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_at END, submitted_by = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_by END, updated_at = ? WHERE batch_id = ? AND store_code = ?").bind(status, status, now, status, who.email, now, batchId, storeCode),
    env.DB.prepare("UPDATE store_transfer_batches SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM store_transfer_store_status s WHERE s.batch_id = ? AND s.status NOT IN ('submitted', 'approved')) THEN 'review' ELSE 'open' END, item_count = (SELECT COUNT(*) FROM store_transfer_items WHERE batch_id = ? AND COALESCE(store_confirmed_quantity, suggested_quantity) > 0), updated_at = ?, updated_by = ?, revision = revision + 1 WHERE id = ?").bind(batchId, batchId, now, who.email, batchId),
    env.DB.prepare("INSERT INTO store_transfer_events (batch_id, store_code, event_type, summary, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)").bind(batchId, storeCode, submit ? "store_submitted" : "store_saved", summary, now, who.email)
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
  if (who.role === "store" && Date.now() >= Date.parse(String(batch.lock_at))) throw new RequestValidationError("門市回覆鎖定時間後只限總部更正。", 409);
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE store_transfer_store_status SET status = 'saved', submitted_at = NULL, submitted_by = NULL, withdrawn_at = ?, withdrawn_by = ?, updated_at = ? WHERE batch_id = ? AND store_code = ? AND status = 'submitted'").bind(now, who.email, now, batchId, storeCode).run();
  if (Number(result.meta.changes || 0) !== 1) throw new RequestValidationError("此門市目前不是已送出狀態，無需撤回。", 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE store_transfer_batches SET status = 'open', updated_at = ?, updated_by = ?, revision = revision + 1 WHERE id = ?").bind(now, who.email, batchId),
    env.DB.prepare("INSERT INTO store_transfer_events (batch_id, store_code, event_type, summary, created_at, created_by) VALUES (?, ?, 'store_withdrawn', '門市撤回修改', ?, ?)").bind(batchId, storeCode, now, who.email)
  ]);
  return json({ batchId, storeCode, status: "saved", withdrawnAt: now });
}

async function openApprovedCorrection(request: Request, env: StoreTransferEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env); assertHq(who.role);
  const input = await readBody(request, 8192);
  const storeCode = text(input.storeCode, "門市代碼", 5) as StoreCode;
  if (!(storeCode in STORES)) throw new RequestValidationError("門市代碼不存在。");
  const mode = String(input.mode || "");
  if (!new Set(["hq", "store"]).has(mode)) throw new RequestValidationError("更正方式不存在。");
  const reason = text(input.reason, "更正原因", 300);
  const batch = await env.DB.prepare("SELECT status, revision FROM store_transfer_batches WHERE id = ? AND deleted_at IS NULL").bind(batchId).first<Record<string, unknown>>();
  if (!batch) throw new RequestValidationError("找不到此週調撥批次。", 404);
  if (String(batch.status) !== "approved") throw new RequestValidationError("只有尚未產生ERP的已核准批次可以開啟更正。", 409);
  const storeState = await env.DB.prepare("SELECT status, erp_created_at, correction_revision FROM store_transfer_store_status WHERE batch_id = ? AND store_code = ?").bind(batchId, storeCode).first<Record<string, unknown>>();
  if (!storeState) throw new RequestValidationError("此批次沒有這間門市。", 404);
  if (String(storeState.status) !== "approved") throw new RequestValidationError("此門市目前不是已核准狀態。", 409);
  if (storeState.erp_created_at) throw new RequestValidationError("此門市已產生ERP檔，不能直接退回；請改走ERP作廢、補調或沖銷流程。", 409);
  const priorFulfillment = await env.DB.prepare("SELECT 1 found FROM store_transfer_items i JOIN store_transfer_procurement_needs n ON n.store_code = i.store_code AND n.sku = i.sku AND n.source_batch_id <> i.batch_id WHERE i.batch_id = ? AND i.store_code = ? AND n.fulfilled_quantity > 0 LIMIT 1").bind(batchId, storeCode).first<Record<string, unknown>>();
  if (priorFulfillment) throw new RequestValidationError("此門市核准量已用於補配先前缺貨需求，不能直接退回；請由總部另開補調或沖銷並保留來源紀錄。", 409);
  const items = await env.DB.prepare("SELECT sku, product_name, item_type, suggested_quantity, store_confirmed_quantity, store_reason, hq_approved_quantity, hq_reason FROM store_transfer_items WHERE batch_id = ? AND store_code = ? ORDER BY sku, item_type").bind(batchId, storeCode).all<Record<string, unknown>>();
  const correctionRevision = Number(storeState.correction_revision || 0) + 1;
  const snapshot = JSON.stringify(items.results);
  const now = new Date().toISOString();
  const targetStoreStatus = mode === "store" ? "saved" : "submitted";
  const targetBatchStatus = mode === "store" ? "open" : "review";
  const eventType = mode === "store" ? "store_returned" : "hq_correction_opened";
  const summary = `${mode === "store" ? "總部退回門市修改" : "總部開啟核准更正"}（第${correctionRevision}版）：${reason}`;
  const results = await env.DB.batch([
    env.DB.prepare("INSERT INTO store_transfer_corrections (batch_id, store_code, correction_revision, mode, reason, item_snapshot, status, opened_at, opened_by) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)").bind(batchId, storeCode, correctionRevision, mode, reason, snapshot, now, who.email),
    env.DB.prepare("UPDATE store_transfer_store_status SET status = ?, correction_mode = ?, correction_reason = ?, correction_opened_at = ?, correction_opened_by = ?, correction_revision = ?, submitted_at = CASE WHEN ? = 'store' THEN NULL ELSE submitted_at END, submitted_by = CASE WHEN ? = 'store' THEN NULL ELSE submitted_by END, updated_at = ? WHERE batch_id = ? AND store_code = ? AND status = 'approved' AND erp_created_at IS NULL").bind(targetStoreStatus, mode, reason, now, who.email, correctionRevision, mode, mode, now, batchId, storeCode),
    env.DB.prepare("UPDATE store_transfer_batches SET status = ?, updated_at = ?, updated_by = ?, revision = revision + 1 WHERE id = ? AND status = 'approved' AND revision = ?").bind(targetBatchStatus, now, who.email, batchId, Number(batch.revision)),
    env.DB.prepare("INSERT INTO store_transfer_events (batch_id, store_code, event_type, summary, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)").bind(batchId, storeCode, eventType, summary, now, who.email)
  ]);
  if (Number(results[1].meta.changes || 0) !== 1 || Number(results[2].meta.changes || 0) !== 1) throw new RequestValidationError("批次已由其他同事更新，請重新整理後再試。", 409);
  return json({ batchId, storeCode, mode, status: targetBatchStatus, storeStatus: targetStoreStatus, correctionRevision, openedAt: now });
}

async function approveBatch(request: Request, env: StoreTransferEnv, batchId: string): Promise<Response> {
  requireSameOrigin(request, env);
  const who = await actor(request, env); assertHq(who.role);
  const batch = await env.DB.prepare("SELECT status, proposal_date, arrival_schedule FROM store_transfer_batches WHERE id = ?").bind(batchId).first<Record<string, unknown>>();
  if (!batch) throw new RequestValidationError("找不到此週調撥批次。", 404);
  if (!["open", "review"].includes(String(batch.status))) throw new RequestValidationError("此批次目前不可核准。", 409);
  const pending = await env.DB.prepare("SELECT COUNT(*) count FROM store_transfer_store_status WHERE batch_id = ? AND status NOT IN ('submitted', 'approved')").bind(batchId).first<{ count: number }>();
  const correctionRows = await env.DB.prepare("SELECT store_code, status, correction_mode, correction_revision FROM store_transfer_store_status WHERE batch_id = ? AND correction_mode IS NOT NULL").bind(batchId).all<Record<string, unknown>>();
  const input = await readBody(request);
  if (correctionRows.results.some((row) => String(row.correction_mode) === "store" && !["submitted", "approved"].includes(String((row as Record<string, unknown>).status || "")))) {
    throw new RequestValidationError("退回門市修改的內容尚未重新送出，不能略過門市直接核准。", 409);
  }
  if (Number(pending?.count || 0) > 0 && input.confirmPendingStores !== true) throw new RequestValidationError("仍有門市尚未送出；確認要以目前資料核准後再操作。", 409);
  if (!Array.isArray(input.items) || input.items.length > 5000) throw new RequestValidationError("總部核准明細格式錯誤。");
  const existing = await env.DB.prepare("SELECT store_code, sku, item_type, suggested_quantity, store_confirmed_quantity, hq_approved_quantity, hq_reason, decision_snapshot FROM store_transfer_items WHERE batch_id = ?").bind(batchId).all<Record<string, unknown>>();
  const allowedStores = await env.DB.prepare("SELECT store_code FROM store_transfer_store_status WHERE batch_id = ?").bind(batchId).all<Record<string, unknown>>();
  const allowedStoreCodes = new Set(allowedStores.results.map((row) => String(row.store_code)));
  const baseline = new Map(existing.results.map((row) => [`${row.store_code}\u0000${row.sku}\u0000${row.item_type}`, { quantity: Number(row.store_confirmed_quantity ?? row.suggested_quantity), previousApproved: Number(row.hq_approved_quantity ?? row.store_confirmed_quantity ?? row.suggested_quantity), previousReason: String(row.hq_reason || ""), snapshot: parseJson(row.decision_snapshot) }]));
  const correctionStoreCodes = new Set(correctionRows.results.map((row) => String(row.store_code)));
  const manualFactsResult = await env.DB.prepare("SELECT * FROM store_transfer_manual_item_facts WHERE batch_id = ?").bind(batchId).all<Record<string, unknown>>();
  const manualFacts = new Map(manualFactsResult.results.map((row) => [`${row.store_code}\u0000${row.sku}`, row]));
  const catalogResult = await env.DB.prepare("SELECT sku, product_name, hq_available, hq_reserve, hq_releasable FROM store_transfer_batch_product_catalog WHERE batch_id = ?").bind(batchId).all<Record<string, unknown>>();
  const manualCatalog = new Map(catalogResult.results.map((row) => [String(row.sku), row]));
  const schedule = parseJson(batch.arrival_schedule);
  if (input.items.length < existing.results.length) throw new RequestValidationError("總部核准明細不完整；移除品項請使用移除按鈕，系統會保留稽核紀錄。", 409);
  const now = new Date().toISOString();
  let total = 0;
  let addedCount = 0;
  let removedCount = 0;
  const seen = new Set<string>();
  const approvedBySku = new Map<string, number>();
  const supplyCeilingBySku = new Map<string, number>();
  const updates = (input.items as unknown[]).map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RequestValidationError("總部核准明細格式錯誤。");
    const item = raw as Record<string, unknown>;
    const storeCode = text(item.storeCode, "門市代碼", 5);
    if (!(storeCode in STORES) || !allowedStoreCodes.has(storeCode)) throw new RequestValidationError(`此批次沒有門市：${storeCode}。`);
    const sku = text(item.sku, "ERP品號", 80).toLocaleUpperCase("en-US");
    const type = itemType(item.itemType);
    const key = `${storeCode}\u0000${sku}\u0000${type}`;
    if (seen.has(key)) throw new RequestValidationError(`${storeCode}／${sku}核准明細重複。`);
    seen.add(key);
    const approved = quantity(item.approvedQuantity, "總部核准量"); total += approved;
    approvedBySku.set(sku, (approvedBySku.get(sku) || 0) + approved);
    validateConsumablePack(type, approved, "總部核准量");
    const reason = String(item.reason || "").normalize("NFKC").trim().slice(0, 300);
    const original = baseline.get(`${storeCode}\u0000${sku}\u0000${type}`);
    if (original == null) {
      if (correctionRows.results.length && !correctionStoreCodes.has(storeCode)) throw new RequestValidationError(`更正期間只能修改指定門市；${storeCode}不可新增品項。`, 409);
      const currentArrivalDate = String(((schedule[storeCode] as Record<string, unknown> | undefined)?.currentArrivalDate) || batch.proposal_date);
      const catalog = manualCatalog.get(sku);
      const fact = manualFacts.get(`${storeCode}\u0000${sku}`) || (catalog ? { product_name: catalog.product_name, calculation_date: currentArrivalDate, base_quantity: 0, display_gap: 0, daily_usage: 0, system_projection: "近期無現場銷售", system_reason: "本批次沒有此品號的門市庫存、近期銷售、待發貨或在途紀錄；依現行規則未形成補貨需求", hq_available: catalog.hq_available, hq_reserve: catalog.hq_reserve, hq_releasable: catalog.hq_releasable } : null);
      if (!fact) throw new RequestValidationError(`${storeCode}／${sku}缺少本批次的庫存與銷售推估基準，無法人工新增。`);
      const productName = text(fact.product_name, "人工新增品名");
      if (approved === 0) throw new RequestValidationError(`${storeCode}／${sku}為人工新增品項，核准量須大於0。`);
      if (!reason) throw new RequestValidationError(`${storeCode}／${sku}為人工新增品項，請填寫新增原因。`);
      if (fact.hq_releasable != null) supplyCeilingBySku.set(sku, Number(fact.hq_releasable));
      addedCount += 1;
      const snapshot = JSON.stringify({ hqAvailable: Number(fact.hq_available || 0), hqReserve: Number(fact.hq_reserve || 0), hqReleasable: Number(fact.hq_releasable || 0), hqSupplyCeiling: Number(fact.hq_releasable || 0) });
      return env.DB.prepare("INSERT INTO store_transfer_items (batch_id, store_code, sku, product_name, suggested_quantity, store_confirmed_quantity, store_reason, hq_approved_quantity, hq_reason, rule_summary, item_type, calculation_date, base_quantity, display_gap, daily_usage, system_projection, system_reason, decision_snapshot, updated_at, updated_by) VALUES (?, ?, ?, ?, 0, 0, '', ?, ?, '總部人工新增；沿用批次建立時的庫存與近42天銷售基準', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(batchId, storeCode, sku, productName, approved, reason, type, fact.calculation_date, fact.base_quantity, fact.display_gap, fact.daily_usage, fact.system_projection, String(fact.system_reason || ""), snapshot, now, who.email);
    }
    if (correctionRows.results.length && !correctionStoreCodes.has(storeCode) && (approved !== original.previousApproved || reason !== original.previousReason)) {
      throw new RequestValidationError(`更正期間只能修改指定門市；${storeCode}的原核准內容不可變更。`, 409);
    }
    if (Object.prototype.hasOwnProperty.call(original.snapshot, "hqSupplyCeiling")) supplyCeilingBySku.set(sku, Math.max(supplyCeilingBySku.get(sku) || 0, Number(original.snapshot.hqSupplyCeiling || 0)));
    if (approved !== original.quantity && !reason) throw new RequestValidationError(`${storeCode}／${sku}的核准量與門市確認量不同，請填寫總部調整原因。`);
    if (original.quantity > 0 && approved === 0) removedCount += 1;
    return env.DB.prepare("UPDATE store_transfer_items SET hq_approved_quantity = ?, hq_reason = ?, updated_at = ?, updated_by = ? WHERE batch_id = ? AND store_code = ? AND sku = ? AND item_type = ?").bind(approved, reason, now, who.email, batchId, storeCode, sku, type);
  });
  for (const [sku, approved] of approvedBySku) {
    if (!supplyCeilingBySku.has(sku)) continue;
    const ceiling = Number(supplyCeilingBySku.get(sku) || 0);
    if (approved > ceiling) throw new RequestValidationError(`${sku}總倉本批可供應${ceiling}件，各門市合計核准${approved}件；請調整後再核准。`, 409);
  }
  for (const key of baseline.keys()) if (!seen.has(key)) throw new RequestValidationError("總部核准明細不完整；移除品項請使用移除按鈕，系統會保留稽核紀錄。", 409);
  const results = await env.DB.batch([
    ...updates,
    env.DB.prepare("UPDATE store_transfer_store_status SET status = 'approved', updated_at = ? WHERE batch_id = ?").bind(now, batchId),
    env.DB.prepare("UPDATE store_transfer_batches SET status = 'approved', item_count = (SELECT COUNT(*) FROM store_transfer_items WHERE batch_id = ? AND COALESCE(hq_approved_quantity, store_confirmed_quantity, suggested_quantity) > 0), approved_quantity = ?, updated_at = ?, updated_by = ?, revision = revision + 1 WHERE id = ? AND status IN ('open', 'review')").bind(batchId, total, now, who.email, batchId),
    env.DB.prepare("UPDATE store_transfer_shortages SET allocated_quantity = MIN(demand_quantity, COALESCE((SELECT COALESCE(i.hq_approved_quantity, i.store_confirmed_quantity, i.suggested_quantity) FROM store_transfer_items i WHERE i.batch_id = store_transfer_shortages.batch_id AND i.store_code = store_transfer_shortages.store_code AND i.sku = store_transfer_shortages.sku AND i.item_type = store_transfer_shortages.item_type), 0)), unfilled_quantity = demand_quantity - MIN(demand_quantity, COALESCE((SELECT COALESCE(i.hq_approved_quantity, i.store_confirmed_quantity, i.suggested_quantity) FROM store_transfer_items i WHERE i.batch_id = store_transfer_shortages.batch_id AND i.store_code = store_transfer_shortages.store_code AND i.sku = store_transfer_shortages.sku AND i.item_type = store_transfer_shortages.item_type), 0)), follow_up_status = CASE WHEN COALESCE((SELECT COALESCE(i.hq_approved_quantity, i.store_confirmed_quantity, i.suggested_quantity) FROM store_transfer_items i WHERE i.batch_id = store_transfer_shortages.batch_id AND i.store_code = store_transfer_shortages.store_code AND i.sku = store_transfer_shortages.sku AND i.item_type = store_transfer_shortages.item_type), 0) >= demand_quantity THEN '已於本批補配' ELSE '待回拋主採購' END, updated_at = ? WHERE batch_id = ?").bind(now, batchId),
    env.DB.prepare("INSERT INTO store_transfer_events (batch_id, event_type, summary, created_at, created_by) VALUES (?, 'hq_approved', ?, ?, ?)").bind(batchId, `總部核准${total}件；人工新增${addedCount}項、移除${removedCount}項`, now, who.email)
  ]);
  if (updates.some((_, index) => Number(results[index].meta.changes || 0) !== 1)) throw new RequestValidationError("部分品號不存在或已變更，請重新載入。", 409);
  if (correctionRows.results.length) {
    const correctionStatements = correctionRows.results.flatMap((row) => {
      const storeCode = String(row.store_code);
      const revision = Number(row.correction_revision || 0);
      const modeLabel = String(row.correction_mode) === "store" ? "門市退回修改" : "總部更正";
      return [
        env.DB.prepare("UPDATE store_transfer_corrections SET status = 'approved', approved_at = ?, approved_by = ? WHERE batch_id = ? AND store_code = ? AND correction_revision = ? AND status = 'open'").bind(now, who.email, batchId, storeCode, revision),
        env.DB.prepare("UPDATE store_transfer_store_status SET correction_mode = NULL, correction_reason = NULL, correction_opened_at = NULL, correction_opened_by = NULL, updated_at = ? WHERE batch_id = ? AND store_code = ?").bind(now, batchId, storeCode),
        env.DB.prepare("INSERT INTO store_transfer_events (batch_id, store_code, event_type, summary, created_at, created_by) VALUES (?, ?, 'correction_approved', ?, ?, ?)").bind(batchId, storeCode, `${modeLabel}第${revision}版已重新核准`, now, who.email)
      ];
    });
    await env.DB.batch(correctionStatements);
  } else await env.DB.batch([
    env.DB.prepare("INSERT INTO store_transfer_procurement_need_events (store_code, sku, source_batch_id, event_type, quantity, status_before, status_after, reason, created_at, created_by) SELECT n.store_code, n.sku, n.source_batch_id, 'later_transfer_fulfilled', MIN(n.unfilled_quantity - n.fulfilled_quantity, COALESCE(i.hq_approved_quantity, i.store_confirmed_quantity, i.suggested_quantity)), n.status, CASE WHEN n.fulfilled_quantity + COALESCE(i.hq_approved_quantity, i.store_confirmed_quantity, i.suggested_quantity) >= n.unfilled_quantity THEN 'resolved' ELSE 'arrived' END, '後續週調撥已核准補配', ?, ? FROM store_transfer_procurement_needs n JOIN store_transfer_items i ON i.batch_id = ? AND i.store_code = n.store_code AND i.sku = n.sku WHERE n.status = 'arrived' AND n.fulfilled_quantity < n.unfilled_quantity AND COALESCE(i.hq_approved_quantity, i.store_confirmed_quantity, i.suggested_quantity) > 0").bind(now, who.email, batchId),
    env.DB.prepare("UPDATE store_transfer_procurement_needs SET covered_quantity = MAX(0, covered_quantity - MIN(unfilled_quantity - fulfilled_quantity, COALESCE((SELECT COALESCE(i.hq_approved_quantity, i.store_confirmed_quantity, i.suggested_quantity) FROM store_transfer_items i WHERE i.batch_id = ? AND i.store_code = store_transfer_procurement_needs.store_code AND i.sku = store_transfer_procurement_needs.sku), 0))), fulfilled_quantity = MIN(unfilled_quantity, fulfilled_quantity + COALESCE((SELECT COALESCE(i.hq_approved_quantity, i.store_confirmed_quantity, i.suggested_quantity) FROM store_transfer_items i WHERE i.batch_id = ? AND i.store_code = store_transfer_procurement_needs.store_code AND i.sku = store_transfer_procurement_needs.sku), 0)), status = CASE WHEN fulfilled_quantity + COALESCE((SELECT COALESCE(i.hq_approved_quantity, i.store_confirmed_quantity, i.suggested_quantity) FROM store_transfer_items i WHERE i.batch_id = ? AND i.store_code = store_transfer_procurement_needs.store_code AND i.sku = store_transfer_procurement_needs.sku), 0) >= unfilled_quantity THEN 'resolved' ELSE 'arrived' END, resolution_note = CASE WHEN fulfilled_quantity + COALESCE((SELECT COALESCE(i.hq_approved_quantity, i.store_confirmed_quantity, i.suggested_quantity) FROM store_transfer_items i WHERE i.batch_id = ? AND i.store_code = store_transfer_procurement_needs.store_code AND i.sku = store_transfer_procurement_needs.sku), 0) >= unfilled_quantity THEN '已於後續週調撥補配完成' ELSE '已於後續週調撥部分補配' END, resolved_at = CASE WHEN fulfilled_quantity + COALESCE((SELECT COALESCE(i.hq_approved_quantity, i.store_confirmed_quantity, i.suggested_quantity) FROM store_transfer_items i WHERE i.batch_id = ? AND i.store_code = store_transfer_procurement_needs.store_code AND i.sku = store_transfer_procurement_needs.sku), 0) >= unfilled_quantity THEN ? ELSE NULL END, resolved_by = CASE WHEN fulfilled_quantity + COALESCE((SELECT COALESCE(i.hq_approved_quantity, i.store_confirmed_quantity, i.suggested_quantity) FROM store_transfer_items i WHERE i.batch_id = ? AND i.store_code = store_transfer_procurement_needs.store_code AND i.sku = store_transfer_procurement_needs.sku), 0) >= unfilled_quantity THEN ? ELSE NULL END, updated_at = ?, updated_by = ? WHERE status = 'arrived' AND EXISTS (SELECT 1 FROM store_transfer_items i WHERE i.batch_id = ? AND i.store_code = store_transfer_procurement_needs.store_code AND i.sku = store_transfer_procurement_needs.sku AND COALESCE(i.hq_approved_quantity, i.store_confirmed_quantity, i.suggested_quantity) > 0)").bind(batchId, batchId, batchId, batchId, batchId, now, batchId, who.email, now, who.email, batchId),
    env.DB.prepare("UPDATE store_transfer_shortages SET follow_up_status = CASE WHEN (SELECT n.status FROM store_transfer_procurement_needs n WHERE n.source_batch_id = store_transfer_shortages.batch_id AND n.store_code = store_transfer_shortages.store_code AND n.sku = store_transfer_shortages.sku) = 'resolved' THEN '已於後續批次補配' ELSE '已到貨，後續批次部分補配' END, updated_at = ? WHERE EXISTS (SELECT 1 FROM store_transfer_procurement_needs n WHERE n.source_batch_id = store_transfer_shortages.batch_id AND n.store_code = store_transfer_shortages.store_code AND n.sku = store_transfer_shortages.sku AND n.status IN ('arrived', 'resolved') AND n.fulfilled_quantity > 0)").bind(now)
  ]);
  const approvedShortages = await env.DB.prepare("SELECT store_code, sku, product_name, demand_quantity, allocated_quantity, unfilled_quantity, reason, next_arrival_date FROM store_transfer_shortages WHERE batch_id = ? ORDER BY store_code, sku").bind(batchId).all<Record<string, unknown>>();
  if (approvedShortages.results.length) {
    const bridge = approvedShortages.results.flatMap((row) => {
      const storeCode = String(row.store_code);
      const sku = String(row.sku);
      const unfilled = Number(row.unfilled_quantity || 0);
      const status = unfilled > 0 ? "awaiting_decision" : "resolved";
      return [
        env.DB.prepare("INSERT OR IGNORE INTO store_transfer_procurement_need_history (batch_id, store_code, sku, product_name, approved_demand_quantity, allocated_quantity, unfilled_quantity, needed_by, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(batchId, storeCode, sku, String(row.product_name), Number(row.demand_quantity), Number(row.allocated_quantity), unfilled, row.next_arrival_date, String(row.reason), now, who.email),
        env.DB.prepare("INSERT INTO store_transfer_procurement_needs (store_code, sku, product_name, source_batch_id, approved_demand_quantity, allocated_quantity, unfilled_quantity, needed_by, reason, handling_mode, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_decision', ?, ?, ?, ?) ON CONFLICT(store_code, sku) DO UPDATE SET product_name = excluded.product_name, source_batch_id = excluded.source_batch_id, approved_demand_quantity = excluded.approved_demand_quantity, allocated_quantity = excluded.allocated_quantity, unfilled_quantity = excluded.unfilled_quantity, fulfilled_quantity = CASE WHEN store_transfer_procurement_needs.source_batch_id = excluded.source_batch_id THEN store_transfer_procurement_needs.fulfilled_quantity ELSE 0 END, needed_by = excluded.needed_by, reason = excluded.reason, handling_mode = store_transfer_procurement_needs.handling_mode, status = CASE WHEN excluded.unfilled_quantity = 0 THEN 'resolved' WHEN store_transfer_procurement_needs.covered_quantity >= excluded.unfilled_quantity THEN 'covered_waiting' WHEN store_transfer_procurement_needs.status IN ('waiting_merge', 'new_order') THEN store_transfer_procurement_needs.status ELSE 'awaiting_decision' END, resolution_note = CASE WHEN store_transfer_procurement_needs.source_batch_id = excluded.source_batch_id THEN store_transfer_procurement_needs.resolution_note ELSE NULL END, resolved_at = CASE WHEN store_transfer_procurement_needs.source_batch_id = excluded.source_batch_id THEN store_transfer_procurement_needs.resolved_at ELSE NULL END, resolved_by = CASE WHEN store_transfer_procurement_needs.source_batch_id = excluded.source_batch_id THEN store_transfer_procurement_needs.resolved_by ELSE NULL END, updated_at = excluded.updated_at, updated_by = excluded.updated_by").bind(storeCode, sku, String(row.product_name), batchId, Number(row.demand_quantity), Number(row.allocated_quantity), unfilled, row.next_arrival_date, String(row.reason), status, now, now, who.email)
      ];
    });
    await env.DB.batch(bridge);
  }
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
  if (url.pathname === "/api/store-transfer/applicability-rules" && request.method === "GET") return transferApplicabilityRules(request, env);
  if (url.pathname === "/api/store-transfer/applicability-rules" && request.method === "PUT") return saveTransferApplicabilityRules(request, env);
  if (url.pathname === "/api/store-transfer/display-exceptions" && request.method === "GET") return listDisplayExceptions(request, env);
  const displayExceptionMatch = url.pathname.match(/^\/api\/store-transfer\/display-exceptions\/([^/]+)\/([^/]+)$/);
  if (displayExceptionMatch && request.method === "PUT") return saveDisplayException(request, env, decodeURIComponent(displayExceptionMatch[1]), decodeURIComponent(displayExceptionMatch[2]));
  if (url.pathname === "/api/store-transfer/pending-purchases" && request.method === "GET") return pendingPurchases(request, env);
  if (url.pathname === "/api/store-transfer/consumable-snapshots" && request.method === "GET") return consumableHistory(request, env);
  if (url.pathname === "/api/store-transfer/consumable-snapshots" && request.method === "POST") return saveConsumableSnapshots(request, env);
  if (url.pathname === "/api/store-transfer/collaboration-drafts" && request.method === "GET") return listCollaborationDrafts(request, env);
  const collaborationMatch = url.pathname.match(/^\/api\/store-transfer\/collaboration-drafts\/([^/]+)$/);
  if (collaborationMatch && request.method === "GET") return getCollaborationDraft(request, env, decodeURIComponent(collaborationMatch[1]));
  if (collaborationMatch && request.method === "PUT") return saveCollaborationDraft(request, env, decodeURIComponent(collaborationMatch[1]));
  if (collaborationMatch && request.method === "DELETE") return deleteCollaborationDraft(request, env, decodeURIComponent(collaborationMatch[1]));
  if (url.pathname === "/api/store-transfer/batches" && request.method === "GET") return listBatches(request, env);
  if (url.pathname === "/api/store-transfer/batches" && request.method === "POST") return createBatch(request, env);
  const manualItemFactMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)\/manual-item-fact$/);
  if (manualItemFactMatch && request.method === "GET") return manualItemFact(request, env, decodeURIComponent(manualItemFactMatch[1]));
  const detailMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)$/);
  if (detailMatch && request.method === "GET") return detail(request, env, decodeURIComponent(detailMatch[1]));
  if (detailMatch && request.method === "DELETE") return deleteBatch(request, env, decodeURIComponent(detailMatch[1]));
  const storeMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)\/stores\/([^/]+)\/(save|submit)$/);
  if (storeMatch && request.method === "PUT") return saveStore(request, env, decodeURIComponent(storeMatch[1]), decodeURIComponent(storeMatch[2]), storeMatch[3] === "submit");
  const withdrawMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)\/stores\/([^/]+)\/withdraw$/);
  if (withdrawMatch && request.method === "POST") return withdrawStore(request, env, decodeURIComponent(withdrawMatch[1]), decodeURIComponent(withdrawMatch[2]));
  const notificationMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)\/notifications\/send$/);
  if (notificationMatch && request.method === "POST") return sendBatchNotifications(request, env, decodeURIComponent(notificationMatch[1]));
  const approveMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)\/approve$/);
  if (approveMatch && request.method === "POST") return approveBatch(request, env, decodeURIComponent(approveMatch[1]));
  const correctionMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)\/corrections\/open$/);
  if (correctionMatch && request.method === "POST") return openApprovedCorrection(request, env, decodeURIComponent(correctionMatch[1]));
  const erpMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)\/erp-created$/);
  if (erpMatch && request.method === "POST") return markErpCreated(request, env, decodeURIComponent(erpMatch[1]));
  const closeMatch = url.pathname.match(/^\/api\/store-transfer\/batches\/([^/]+)\/close$/);
  if (closeMatch && request.method === "POST") return closeBatch(request, env, decodeURIComponent(closeMatch[1]));
  return json({ error: "不支援此方法或路徑。" }, 405);
}

export async function cleanupStoreTransfers(env: StoreTransferEnv): Promise<void> {
  const expired = "SELECT id FROM store_transfer_batches WHERE created_at < datetime('now', '-12 months')";
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM store_transfer_notifications WHERE batch_id IN (${expired})`),
    env.DB.prepare(`DELETE FROM store_transfer_events WHERE batch_id IN (${expired})`),
    env.DB.prepare(`DELETE FROM store_transfer_corrections WHERE batch_id IN (${expired})`),
    env.DB.prepare(`DELETE FROM store_transfer_shortages WHERE batch_id IN (${expired})`),
    env.DB.prepare("DELETE FROM store_transfer_procurement_need_history WHERE created_at < datetime('now', '-12 months')"),
    env.DB.prepare("DELETE FROM store_transfer_procurement_need_events WHERE created_at < datetime('now', '-12 months')"),
    env.DB.prepare(`DELETE FROM store_transfer_manual_item_facts WHERE batch_id IN (${expired})`),
    env.DB.prepare(`DELETE FROM store_transfer_batch_product_catalog WHERE batch_id IN (${expired})`),
    env.DB.prepare(`DELETE FROM store_transfer_items WHERE batch_id IN (${expired})`),
    env.DB.prepare(`DELETE FROM store_transfer_store_status WHERE batch_id IN (${expired})`),
    env.DB.prepare(`DELETE FROM store_transfer_batches WHERE id IN (${expired})`),
    env.DB.prepare("DELETE FROM store_transfer_collaboration_drafts WHERE created_at < datetime('now', '-12 months')"),
    env.DB.prepare("DELETE FROM store_transfer_consumable_snapshots WHERE snapshot_date < date('now', '-12 months')"),
    env.DB.prepare("DELETE FROM store_transfer_display_exception_events WHERE created_at < datetime('now', '-12 months')")
  ]);
}

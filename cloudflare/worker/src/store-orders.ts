import {recognitionResponse} from './store-order-stream';
import {STORE_ORDER_SUPER_ADMIN,readHQAccess,updateHQAccess,HQAccessError} from "./store-order-hq-access";
import {ownerStorageSetupRoute} from "./store-order-setup";
import {ownerDriveToken,OwnerError,type OwnerEnv} from "./store-order-owner";
import {issueGuestInvite,redeemGuestInvite,verifyGuest,logoutGuest,GuestError} from "./store-order-guests";
import {recognizeStoreOrder,RecognitionError,ORDER_AI_MODEL} from "./store-order-recognition";
import {resolvedERPPrices} from "../../../store-orders/bundle-pricing.js";
import { SignJWT, importPKCS8 } from "jose";
import { verifyCompanyUser, type AccessConfig } from "./access";
import { VERSION, STORES, validStoreCode, validateOrder, settlementSummary, text, validDate } from "../../../store-orders/core.js";
import { FIXED_SOURCES } from "./fixed-sources";

export type OrdersEnv = AccessConfig & OwnerEnv & {
  DB: D1Database; ALLOWED_ORIGINS: string; OPENAI_API_KEY?:string; STORE_ORDERS_PRODUCTION_EXPORT?:string; STORE_ORDERS_GUEST_KEY?:string; GOOGLE_OAUTH_CLIENT_ID?: string; PROCUREMENT_ACCESS_AUD?: string;
  STORE_ORDERS_CONFIG?: string; STORE_ORDERS_SERVICE_ACCOUNT?: string; STORE_ORDERS_SETUP?:string; STORE_ORDERS_ACCESS_AUD?: string;
};
type Config = { storageType?:"shared_drive"|"company_account";rootFolderId?:string;ownerEmail?:string;catalogFolderId?:string; sharedDriveId?: string; settledFolderId: string; recycleFolderId: string; hqEmails: string[]; stores: Record<string, { pendingFolderId: string; emails: string[] }> };
type Actor = { email: string; role: "hq" | "store"; storeCode: string | null; guest?:boolean; sessionId?:string };
type IndexRow = { id: string; store_code: string; business_date: string; status: string; version: number; drive_id: string | null; content_hash: string | null; batch_id: string | null; operation_id: string | null; operation_hash: string | null; lock_until: string | null; updated_at: string; erp_number: string | null; erp_created_at: string | null; recycled_at: string | null; created_actor:string };
const JSON_HEADERS = { "Cache-Control": "no-store, max-age=0, must-revalidate", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const MIME = new Set(["image/jpeg", "image/png", "image/heic", "image/heif", "application/pdf"]);
class OrderError extends Error { restartSettlement = false; constructor(message: string, public status = 400) { super(message); } }
const fail = (message: string, status = 400): never => { throw new OrderError(message, status); };
const response = (data: unknown, status = 200) => Response.json(data, { status, headers: JSON_HEADERS });
const now = () => new Date().toISOString();
const uuid = (v: unknown) => /^[a-zA-Z0-9-]{8,80}$/.test(String(v || "")) ? String(v) : fail("操作或訂單識別格式錯誤");
const folderId = (v: unknown) => /^[a-zA-Z0-9_-]{8,200}$/.test(String(v || "")) ? String(v) : fail("雲端資料夾尚未設定", 503);
const emailList = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string" && /^[^\s@]+@siangapato\.com\.tw$/.test(x)) ? v as string[] : fail("帳號對照設定錯誤", 503);
async function configuration(env: OrdersEnv): Promise<Config> {
  let c: Config; try { c = JSON.parse(env.STORE_ORDERS_CONFIG || await env.STORE_ORDERS_VAULT?.get("configuration") || ""); } catch { return fail("門市訂單雲端尚未設定，目前只能使用本機測試，不能交接或結算", 503); }
  [c.settledFolderId, c.recycleFolderId].forEach(folderId); emailList(c.hqEmails);
  if(c.storageType==="company_account"&&c.ownerEmail===STORE_ORDER_SUPER_ADMIN){const access=await readHQAccess(env.DB);c.hqEmails=[STORE_ORDER_SUPER_ADMIN,...access.emails];}
  if(c.storageType==="company_account"){folderId(c.rootFolderId);if(!c.ownerEmail||!c.hqEmails.includes(c.ownerEmail))fail("資料夾擁有者必須具有總部權限",503);}else folderId(c.sharedDriveId);
  if (!c.hqEmails.length || !c.stores || !Object.keys(c.stores).length) fail("角色與資料夾尚未設定", 503);
  const folders = [c.settledFolderId, c.recycleFolderId,...(c.catalogFolderId?[folderId(c.catalogFolderId)]:[])], assigned = new Set<string>();
  for (const [store, entry] of Object.entries(c.stores)) {
    if (!validStoreCode(store)) fail("門市設定錯誤", 503);
    folders.push(folderId(entry.pendingFolderId)); emailList(entry.emails);
    for (const e of entry.emails) { if (assigned.has(e) || c.hqEmails.includes(e)) fail("帳號角色不得重疊", 503); assigned.add(e); }
  }
  if (new Set(folders).size !== folders.length) fail("待處理、結算及回收資料夾必須分開", 503);
  return c;
}
async function actor(request: Request, env: OrdersEnv, c: Config): Promise<Actor> {
  if(new URL(request.url).pathname.startsWith("/api/store-orders-guest/"))return verifyGuest(request,env);
  const email = await verifyCompanyUser(request, { ...env, ACCESS_AUD: env.STORE_ORDERS_ACCESS_AUD || env.PROCUREMENT_ACCESS_AUD || env.ACCESS_AUD });
  if (c.hqEmails.includes(email)) return { email, role: "hq", storeCode: null };
  const storeCode = Object.keys(c.stores).find(k => c.stores[k].emails.includes(email));
  return storeCode ? { email, role: "store", storeCode } : fail("此帳號尚未指派門市訂單權限", 403);
}
function storeFor(who: Actor, store: unknown, c: Config): string {
  const s = String(store || who.storeCode || "");
  if (!Object.hasOwn(c.stores,s) || (who.role === "store" && who.storeCode !== s)) fail("無權存取此門市", 403);
  return s;
}
function hq(who: Actor) { if (who.role !== "hq") fail("此操作只限總部", 403); }
async function bounded(request: Request, max = 250000): Promise<any> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) fail("請以JSON傳送資料", 415);
  if (!request.body) fail("缺少內容");
  const reader = request.body!.getReader(), chunks: Uint8Array[] = []; let length = 0;
  while (true) { const r = await reader.read(); if (r.done) break; length += r.value.length; if (length > max) { await reader.cancel(); fail("訂單資料過大", 413); } chunks.push(r.value); }
  const bytes = new Uint8Array(length); let p = 0; for (const chunk of chunks) { bytes.set(chunk, p); p += chunk.length; }
  try { const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); if (!value || Array.isArray(value) || typeof value !== "object") throw Error(); return value; } catch { return fail("JSON格式錯誤"); }
}
export async function orderHash(value: string | ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", typeof value === "string" ? new TextEncoder().encode(value) : value);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
}
export class OrderDrive {
  private accessToken = "";
  serviceEmail!: string;
  private account!: { client_email: string; private_key: string };
  constructor(private env: OrdersEnv, private c: Config) {
    if(c.storageType==="company_account"){this.serviceEmail=c.ownerEmail!;return;}
    try { this.account = JSON.parse(env.STORE_ORDERS_SERVICE_ACCOUNT || ""); } catch { return fail("專用雲端服務身分尚未設定", 503); }
    if (!this.account.client_email?.endsWith(".gserviceaccount.com") || !this.account.private_key) fail("專用雲端服務設定錯誤", 503);
    this.serviceEmail = this.account.client_email;
  }
  async token() {
    if (this.accessToken) return this.accessToken;
    if(this.c.storageType==="company_account")return this.accessToken=await ownerDriveToken(this.env,this.c.ownerEmail!,this.c.rootFolderId!);
    const key = await importPKCS8(this.account.private_key, "RS256");
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/drive" }).setProtectedHeader({ alg: "RS256" }).setIssuer(this.serviceEmail).setAudience("https://oauth2.googleapis.com/token").setIssuedAt().setExpirationTime("5m").sign(key);
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
    if (!r.ok) fail("公司雲端授權失敗，請聯絡管理者", 503);
    const result = await r.json() as { access_token?: string };
    if (!result.access_token) fail("公司雲端授權失敗", 503);
    return this.accessToken = result.access_token!;
  }
  async request(path: string, init: RequestInit = {}, upload = false): Promise<any> {
    const r = await fetch(`https://www.googleapis.com/${upload ? "upload/" : ""}drive/v3/${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await this.token()}` } });
    if (!r.ok) fail(r.status === 429 ? "公司雲端額度或流量已滿，請稍後重試" : "公司雲端操作失敗，資料尚未完成交接", 503);
    return r.status === 204 ? {} : r.json();
  }
  async meta(id: string) { return this.request(`files/${folderId(id)}?supportsAllDrives=true&fields=id,mimeType,parents,driveId,size,trashed,createdTime,appProperties,version,md5Checksum`); }
  async checkFolder(id: string, allowed: string[]) {
    const meta = await this.meta(id);
    if (meta.trashed || (this.c.storageType==="company_account"?!!meta.driveId||!meta.parents?.includes(this.c.rootFolderId):meta.driveId !== this.c.sharedDriveId) || meta.mimeType !== "application/vnd.google-apps.folder") fail("資料夾不在指定公司儲存位置", 503);
    await this.checkPermissions(id, allowed);
  }
  async checkPermissions(id: string, allowed: string[]) {
    const result = await this.request(`files/${folderId(id)}/permissions?supportsAllDrives=true&fields=nextPageToken,permissions(type,emailAddress,deleted)&pageSize=100`);
    if (result.nextPageToken || !result.permissions?.length || result.permissions.some((p: any) => !p.deleted && (p.type !== "user" || ![...allowed, this.serviceEmail].includes(String(p.emailAddress || "").toLowerCase())))) fail("雲端權限含未授權帳號或無法確認的群組，已停止交接", 403);
  }
  async owned(id: string, folder: string) { const m = await this.meta(id); if (m.trashed || (this.c.storageType==="company_account"?!!m.driveId:m.driveId !== this.c.sharedDriveId) || !m.parents?.includes(folder)) fail("檔案不在授權資料夾", 403); const entry=Object.values(this.c.stores).find(s=>s.pendingFolderId===folder);await this.checkPermissions(id,[...this.c.hqEmails,...(entry?.emails||[])]);return m; }
  async list(folder: string, imagesOnly = false) {
    const files: any[] = []; let page = "";
    do {
      const q = `'${folderId(folder)}' in parents and trashed = false` + (imagesOnly ? " and (mimeType = 'image/jpeg' or mimeType = 'image/png' or mimeType = 'image/heic' or mimeType = 'image/heif' or mimeType = 'application/pdf')" : "");
      const result = await this.request(`files?${new URLSearchParams({ q, supportsAllDrives: "true", includeItemsFromAllDrives: "true", ...(this.c.storageType==="company_account"?{corpora:"user"}:{corpora:"drive",driveId:this.c.sharedDriveId!}), pageSize: "100", fields: "nextPageToken,files(id,mimeType,size,createdTime,appProperties)", ...(page ? { pageToken: page } : {}) })}`);
      files.push(...(result.files || [])); page = result.nextPageToken || "";
      if (files.length > 1000) fail("待處理資料超過1000筆，請先整理", 413);
    } while (page);
    return files;
  }
  async read(id: string, max = 250000): Promise<ArrayBuffer> {
    const meta = await this.meta(id); if (Number(meta.size) > max) fail("檔案超過允許大小", 413);
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId(id)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${await this.token()}` } });
    if (!r.ok || Number(r.headers.get("Content-Length")) > max) fail("無法取得公司雲端檔案", 503);
    const bytes = await r.arrayBuffer(); if (bytes.byteLength > max) fail("檔案超過允許大小", 413); return bytes;
  }
  async json(id: string,max=250000) { return JSON.parse(new TextDecoder().decode(await this.read(id,max))); }
  async write(folder: string, name: string, data: unknown, operation: string) {
    const existing = (await this.list(folder)).filter(f => f.appProperties?.soOperation === operation);
    if (existing.length > 1) fail("雲端操作紀錄重複，請聯絡總部", 409);
    if (existing.length) return existing[0].id as string;
    const boundary = `so_${crypto.randomUUID()}`;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder], mimeType: "application/json", appProperties: { soOperation: operation, soKind: "snapshot" } })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
    const created = await this.request("files?uploadType=multipart&supportsAllDrives=true&fields=id", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body }, true);
    return created.id as string;
  }
  async move(id: string, from: string, to: string, allowed: string[]) {
    const m = await this.meta(id);
    if (m.parents?.includes(from)) await this.request(`files/${folderId(id)}?supportsAllDrives=true&removeParents=${folderId(from)}&addParents=${folderId(to)}&fields=id`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
    await this.owned(id, to); await this.checkPermissions(id, allowed);
  }
}
async function index(env: OrdersEnv, id: string): Promise<IndexRow> { return await env.DB.prepare("SELECT * FROM store_orders WHERE id = ?").bind(id).first<IndexRow>() || fail("找不到訂單", 404); }
function visible(who: Actor, row: IndexRow, c: Config) { storeFor(who, row.store_code, c); if(who.guest&&row.created_actor!==who.email)fail("無權存取其他訪客的訂單",403); if (who.role === "store" && row.batch_id) fail("結算內容只限總部查看", 403); if (row.recycled_at) fail("此訂單已移入受限回收區", 410); }
async function event(env: OrdersEnv, who: Actor, name: string, order: string | null = null, batch: string | null = null) { await env.DB.prepare("INSERT INTO store_order_events (id,order_id,batch_id,actor,event,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), order, batch, who.email, name, now()).run(); }
async function snapshot(env: OrdersEnv, drive: OrderDrive, row: IndexRow) {
  if (!row.drive_id) fail("訂單尚未保存", 409);
  const o = await drive.json(row.drive_id!);
  if (!row.content_hash || await orderHash(JSON.stringify(o)) !== row.content_hash || o.id !== row.id || o.storeCode !== row.store_code || o.businessDate !== row.business_date) fail("雲端訂單內容已被直接修改，請聯絡總部核對原始版本", 409);
  o.version = row.version; o.status = row.status; o.batchId=row.batch_id||null; o.erpNumber=row.erp_number || ""; return o;
}
async function unchangedSource(env: OrdersEnv, drive: OrderDrive, id: string) {
  const source = await env.DB.prepare("SELECT digest,source_md5 FROM store_order_sources WHERE file_id=?").bind(id).first<{digest:string;source_md5:string|null}>();
  const meta = await drive.meta(id);
  if (!source || (source.source_md5 ? meta.md5Checksum !== source.source_md5 : await orderHash(await drive.read(id,20000000)) !== source.digest)) fail("原圖已被改動，請重新收單確認",409);
}
async function ensureNoSettlement(env: OrdersEnv, store: string, date: string) { if (await env.DB.prepare("SELECT id FROM store_order_batches WHERE store_code = ? AND business_date = ? AND status = 'preparing'").bind(store, date).first()) fail("此門市日期正在結算，請稍後重試", 409); }
async function saveOrder(request: Request, env: OrdersEnv, who: Actor, c: Config, drive: OrderDrive) {
  const body = await bounded(request), operation = uuid(body.operationId), id = uuid(body.order?.id), expected = body.expectedVersion;
  if (!Number.isSafeInteger(expected) || expected < 0) fail("缺少資料版本");
  const order = body.order, store = storeFor(who, order.storeCode, c);
  if (!validDate(order.businessDate) || order.schemaVersion !== 1 || !Array.isArray(order.items) || order.items.length > 100 || !Array.isArray(order.sources) || order.sources.length > 30 || !order.customer) fail("訂單結構錯誤");
  if(who.guest&&order.items.some((i:any)=>i?.costSnapshot!=null))fail("組合成本僅由總部商品主檔帶入，訪客不可提交成本",403);
  if (!["pending", "reviewed", "needs_info", "cancelled"].includes(order.status)) fail("不允許的訂單狀態");
  if (["needs_info", "cancelled"].includes(order.status) && !text(order.exceptionReason)) fail("補件或取消需填原因");
  if (order.status === "reviewed") { const v = validateOrder(order, { complete: true }); if (v.errors.length) fail(v.errors.join("；")); }
  const digest = await orderHash(JSON.stringify(order)), paperHash = text(order.paperNumber) ? await orderHash(`${store}:${text(order.paperNumber)}`) : null;
  if (paperHash && order.status !== "cancelled" && await env.DB.prepare("SELECT id FROM store_orders WHERE store_code=? AND paper_hash=? AND id!=? AND status!='cancelled'").bind(store,paperHash,id).first()) fail("紙本單號已存在，請先核對重傳或續頁",409);
  await ensureNoSettlement(env, store, order.businessDate);
  const folder = c.stores[store].pendingFolderId;
  await drive.checkFolder(folder, [...c.hqEmails, ...c.stores[store].emails]);
  await env.DB.prepare("INSERT OR IGNORE INTO store_orders (id,store_code,business_date,updated_at,updated_by,created_actor) VALUES (?,?,?,?,?,?)").bind(id, store, order.businessDate, now(), who.email,who.email).run();
  const current = await index(env, id); visible(who, current, c);
  if (current.store_code !== store) fail("不能變更所屬門市", 403);
  if (current.operation_id === operation && current.operation_hash !== digest) fail("同一操作不得使用不同內容", 409);
  if (current.operation_id === operation && current.operation_hash === digest && !current.lock_until) return response({ id, version: current.version, status: current.status, saved: true });
  if (current.version !== expected || current.batch_id || (current.lock_until && current.lock_until > now())) fail("訂單已更新或正在保存，請重新載入最新版", 409);
  const leaseUntil=new Date(Date.now()+15*60000).toISOString();
  const lock = await env.DB.prepare("UPDATE store_orders SET operation_id=?,operation_hash=?,lock_until=? WHERE id=? AND version=? AND batch_id IS NULL AND (lock_until IS NULL OR lock_until <= ?) AND NOT EXISTS (SELECT 1 FROM store_order_batches WHERE store_code=store_orders.store_code AND business_date=store_orders.business_date AND status='preparing')").bind(operation, digest, leaseUntil, id, expected, now()).run();
  if (!lock.meta.changes) fail("其他同仁正在保存，請稍後重試", 409);
  try {
    for (const s of order.sources) {
      const source = await env.DB.prepare("SELECT order_id FROM store_order_sources WHERE file_id=? AND store_code=?").bind(folderId(s.fileId), store).first<{ order_id: string | null }>();
      if (!source || (source.order_id && source.order_id !== id)) fail("來源未登記或已屬於另一張訂單", 409);
      const sourceMeta=await drive.owned(s.fileId, folder);if(who.guest&&sourceMeta.appProperties?.soActor!==who.email)fail("不能使用其他訪客的來源圖",403);
      await unchangedSource(env,drive,s.fileId);
      const claim = await env.DB.prepare("UPDATE store_order_sources SET order_id=? WHERE file_id=? AND (order_id IS NULL OR order_id=?)").bind(id, s.fileId, id).run();
      if (!claim.meta.changes) fail("來源已被其他訂單使用", 409);
    }
    const priorSources = await env.DB.prepare("SELECT file_id FROM store_order_sources WHERE order_id=?").bind(id).all<{file_id:string}>();
    if (priorSources.results.some(s => !order.sources.some((o: any) => o.fileId === s.file_id))) fail("已保存來源不可移除；請另行取消或更正", 409);
    const document = { ...order, version: expected + 1, savedBy: who.email };
    const file = await drive.write(folder, `${id}-v${expected + 1}.json`, document, operation);
    await drive.owned(file, folder);
    const savedDocument=await drive.json(file);
    if(JSON.stringify(savedDocument)!==JSON.stringify(document)) fail("雲端快照與本次保存內容不同，請聯絡總部",409);
    const contentHash=await orderHash(JSON.stringify(savedDocument));
    const saved = await env.DB.prepare("UPDATE store_orders SET drive_id=?,content_hash=?,paper_hash=?,status=?,business_date=?,version=version+1,updated_at=?,updated_by=?,lock_until=NULL WHERE id=? AND operation_id=? AND version=?").bind(file, contentHash, paperHash, order.status, order.businessDate, now(), who.email, id, operation, expected).run();
    if (!saved.meta.changes) fail("版本衝突，保存尚未確認", 409);
    await event(env, who, "saved", id);
    return response({ id, version: expected + 1, status: order.status, saved: true });
  } finally { await env.DB.prepare("UPDATE store_orders SET lock_until=NULL WHERE id=? AND operation_id=? AND lock_until=?").bind(id, operation,leaseUntil).run(); }
}

async function settle(request: Request, env: OrdersEnv, who: Actor, c: Config, drive: OrderDrive) {
  const body = await bounded(request), store = storeFor(who, body.storeCode, c), date = body.businessDate, op = uuid(body.operationId);
  if (!validDate(date) || !Array.isArray(body.orders) || body.orders.length > 100 || !body.confirmed || (!body.orders.length && !body.noOrders)) fail("請確認結算清單，無單日需明確勾選今日無單");
  const selected = body.orders as { id: string; version: number }[];
  if (new Set(selected.map(o => o.id)).size !== selected.length) fail("結算清單重複");
  const hash = await orderHash(JSON.stringify({ store, date, selected, noOrders: body.noOrders === true }));
  let batch = await env.DB.prepare("SELECT * FROM store_order_batches WHERE operation_id=?").bind(op).first<any>();
  if (batch && (batch.operation_hash !== hash || batch.store_code !== store)) fail("結算操作內容不一致", 409);
  if (batch?.status === "settled") return response({ batchId: batch.id, settled: true });
  if (batch?.status === "aborted") {const error=new OrderError("結算尚未開始交接，請重新核對清單後再次結算",409);error.restartSettlement=true;throw error;}
  if (!batch) {
    const id = crypto.randomUUID(), previous = await env.DB.prepare("SELECT id FROM store_order_batches WHERE store_code=? AND business_date=? AND status='settled' ORDER BY created_at DESC LIMIT 1").bind(store, date).first<{id:string}>();
    try { await env.DB.prepare("INSERT INTO store_order_batches (id,store_code,business_date,operation_id,operation_hash,previous_batch_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)").bind(id, store, date, op, hash, previous?.id || null, now(), who.email).run(); }
    catch { fail("其他同仁正在結算；失敗批次請使用原操作重試", 409); }
    batch = await env.DB.prepare("SELECT * FROM store_order_batches WHERE id=?").bind(id).first<any>();
  }
  const leaseUntil=new Date(Date.now()+15*60000).toISOString();
  const lease = await env.DB.prepare("UPDATE store_order_batches SET lock_until=? WHERE id=? AND status='preparing' AND (lock_until IS NULL OR lock_until <= ?)").bind(leaseUntil, batch.id, now()).run();
  if (!lease.meta.changes) fail("結算進行中，請稍後使用原操作重試", 409);
  let manifestWritten = false;
  try {
    const folder = c.stores[store].pendingFolderId;
    await drive.checkFolder(folder, [...c.hqEmails, ...c.stores[store].emails]);
    await drive.checkFolder(c.settledFolderId, c.hqEmails);
    // Rescan immediately before freezing. Every visible source must be assigned to a saved order.
    const incoming = await drive.list(folder, true);
    for (const f of incoming) {
      const source = await env.DB.prepare("SELECT order_id,duplicate_of FROM store_order_sources WHERE file_id=? AND store_code=?").bind(f.id, store).first<{order_id:string|null;duplicate_of:string|null}>();
      if (source?.duplicate_of) { await drive.checkFolder(c.recycleFolderId,c.hqEmails); await drive.move(f.id,folder,c.recycleFolderId,c.hqEmails); continue; }
      if (!source?.order_id) fail("尚有新進照片未建立或保存訂單，請更新清單後再結算", 409);
    }
    const queue = await env.DB.prepare("SELECT * FROM store_orders WHERE store_code=? AND business_date=? AND batch_id IS NULL").bind(store, date).all<IndexRow>();
    if (queue.results.some(r => r.lock_until && r.lock_until > now())) fail("有訂單正在保存，請稍後結算", 409);
    if (queue.results.length !== selected.length || queue.results.some(r => !selected.some(s => s.id === r.id && s.version === r.version))) fail("結算清單有新增或版本不同，請重新確認", 409);
    const orders: any[] = [], exceptions: any[] = [];
    for (const r of queue.results) { const o = await snapshot(env, drive, r); (r.status === "reviewed" ? orders : exceptions).push(o); }
    let summary:Record<string,number>;
    try {summary=settlementSummary(orders, exceptions);} catch(error) {return fail(error instanceof Error?error.message:"結算資料檢查未通過");}
    const manifest = { schemaVersion: 1, batchId: batch.id, storeCode: store, businessDate: date, previousBatchId: batch.previous_batch_id, summary, orders, exceptions, settledBy: who.email, settledAt: batch.created_at };
    const manifestId = await drive.write(c.settledFolderId, `${batch.id}.json`, manifest, op);
    manifestWritten = true;
    const readback = await drive.json(manifestId);
    if (JSON.stringify(readback) !== JSON.stringify(manifest)) fail("結算快照核對失敗", 503);
    // Move every revision and source, so former customer content cannot remain visible to stores.
    const revisions = await drive.list(folder);
    const ids = new Set(queue.results.filter(r => r.status !== "needs_info").map(r => r.id));
    for (const f of revisions) {
      // Only JSON revisions whose content identifies a closing order are moved.
      if (f.mimeType === "application/json") { const value = await drive.json(f.id); if (ids.has(value.id)) await drive.move(f.id, folder, c.settledFolderId, c.hqEmails); }
    }
    for (const o of [...orders, ...exceptions.filter(o => o.status === "cancelled")]) for (const s of o.sources) { await unchangedSource(env,drive,s.fileId); await drive.move(s.fileId, folder, c.settledFolderId, c.hqEmails); }
    await drive.checkPermissions(manifestId, c.hqEmails);
    const statements = queue.results.filter(r => r.status !== "needs_info").map(r => env.DB.prepare("UPDATE store_orders SET batch_id=?,status=CASE WHEN status='cancelled' THEN 'cancelled' ELSE 'settled' END,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?").bind(batch.id, now(), who.email, r.id, r.version));
    statements.push(env.DB.prepare("UPDATE store_order_batches SET status='settled',manifest_id=?,manifest_hash=?,lock_until=NULL WHERE id=? AND status='preparing'").bind(manifestId, await orderHash(JSON.stringify(manifest)), batch.id));
    statements.push(env.DB.prepare("INSERT INTO store_order_events (id,batch_id,actor,event,created_at) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), batch.id, who.email, "settled", now()));
    await env.DB.batch(statements);
    return response({ batchId: batch.id, settled: true, summary, exceptionCount: exceptions.length });
  } catch(error) {
    if(!manifestWritten) {
      await env.DB.prepare("UPDATE store_order_batches SET status='aborted',lock_until=NULL WHERE id=? AND status='preparing'").bind(batch.id).run();
      if(error instanceof OrderError) error.restartSettlement=true;
    }
    throw error;
  } finally { await env.DB.prepare("UPDATE store_order_batches SET lock_until=NULL WHERE id=? AND lock_until=?").bind(batch.id,leaseUntil).run(); }
}

async function recycleOrders(env:OrdersEnv,c:Config,drive:OrderDrive) {
      await drive.checkFolder(c.recycleFolderId, c.hqEmails);
      const rows = await env.DB.prepare("SELECT * FROM store_orders WHERE status='erp_created' AND recycled_at IS NULL AND erp_created_at < ? LIMIT 50").bind(new Date(Date.now()-90*86400000).toISOString()).all<IndexRow>();
      let moved = 0; const processed=new Set<string>();
      for (const row of rows.results) {
        if(!row.batch_id||processed.has(row.batch_id))continue;
        processed.add(row.batch_id);
        // Batch manifests may include other unresolved orders; do not move partial batches.
        const unresolved = await env.DB.prepare("SELECT id FROM store_orders WHERE batch_id=? AND (status!='erp_created' OR erp_created_at >= ?) LIMIT 1").bind(row.batch_id, new Date(Date.now()-90*86400000).toISOString()).first();
        if (unresolved) continue;
        const batch = await env.DB.prepare("SELECT manifest_id,manifest_hash FROM store_order_batches WHERE id=?").bind(row.batch_id).first<{manifest_id:string;manifest_hash:string}>();
        if (!batch?.manifest_id) continue;
        const manifest = await drive.json(batch.manifest_id);
        if(await orderHash(JSON.stringify(manifest))!==batch.manifest_hash)fail("結算快照內容已改動，停止回收並請總部核對",409);
        const ids = new Set([...manifest.orders, ...manifest.exceptions].map((o:any)=>o.id));
        let stillNeeded=false;
        for(const id of ids){const current=await index(env,String(id));if(current.status!=="erp_created"||!current.erp_created_at||current.erp_created_at>=new Date(Date.now()-90*86400000).toISOString())stillNeeded=true;}
        if(stillNeeded)continue;
        const files = await drive.list(c.settledFolderId);
        for (const f of files) {
          if (f.id === batch.manifest_id) await drive.move(f.id, c.settledFolderId, c.recycleFolderId, c.hqEmails);
          else if (f.mimeType === "application/json") { const data = await drive.json(f.id); if (ids.has(data.id || data.orderId)) await drive.move(f.id, c.settledFolderId, c.recycleFolderId, c.hqEmails); }
        }
        for (const o of [...manifest.orders, ...manifest.exceptions]) for (const s of o.sources) await drive.move(s.fileId, c.settledFolderId, c.recycleFolderId, c.hqEmails);
        await env.DB.prepare("UPDATE store_orders SET recycled_at=? WHERE batch_id=?").bind(now(), row.batch_id).run(); moved++;
      }
      await env.DB.prepare("DELETE FROM store_order_events WHERE created_at < ?").bind(new Date(Date.now()-365*86400000).toISOString()).run();
      return { recycledBatches: moved, permanentlyDeleted: false };
}

export async function cleanupStoreOrders(env:OrdersEnv):Promise<void> {
  if(!env.STORE_ORDERS_CONFIG&&!env.STORE_ORDERS_VAULT)return;
  let result="retention_completed";
  try {const cutoff=new Date(Date.now()-86400000).toISOString();await env.DB.prepare("DELETE FROM store_order_guest_limits WHERE created_at<?").bind(cutoff).run();await env.DB.prepare("DELETE FROM store_order_guest_sessions WHERE expires_at<?").bind(new Date(Date.now()-365*86400000).toISOString()).run();await env.DB.prepare("DELETE FROM store_order_recognitions WHERE created_at<?").bind(new Date(Date.now()-365*86400000).toISOString()).run();}catch{/* Maintenance never bypasses live authorization. */}
  try {const c=await configuration(env);await recycleOrders(env,c,new OrderDrive(env,c));} catch {result="retention_failed";}
  try {await env.DB.prepare("INSERT INTO store_order_events(id,actor,event,created_at) VALUES (?,?,?,?)").bind(crypto.randomUUID(),"system",result,now()).run();} catch { /* No credential, file or customer details are logged. */ }
}

export async function storeOrdersRoute(request: Request, env: OrdersEnv): Promise<Response | null> {
  const url = new URL(request.url),guestPath=url.pathname.startsWith("/api/store-orders-guest/"),prefix=guestPath?"/api/store-orders-guest":"/api/store-orders"; if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+"/"))return null;
  try {
    if (!["GET", "POST", "PUT"].includes(request.method)) fail("不支援此操作", 405);
    if (request.method !== "GET") {
      if (!(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).includes(request.headers.get("Origin") || "")) fail("不允許的來源", 403);
      if (request.headers.get("X-Store-Orders-Version") !== VERSION) fail("重新載入最新版後再操作", 409);
    }
    const setupResponse=await ownerStorageSetupRoute(request,env);if(setupResponse)return setupResponse;
    const c = await configuration(env),action=url.pathname.slice(prefix.length);
    if(guestPath&&action==="/redeem"&&request.method==="POST"){const result=await redeemGuestInvite(request,env,await bounded(request,1000),Object.keys(c.stores));return Response.json(result.body,{headers:{...JSON_HEADERS,"Set-Cookie":result.setCookie}});}
    const who = await actor(request, env, c);
    if(guestPath&&action==="/logout"&&request.method==="POST"){await bounded(request,1000);return Response.json({loggedOut:true},{headers:{...JSON_HEADERS,"Set-Cookie":await logoutGuest(env,who.sessionId!)}});}
    if(action==="/hq-access"){
      if(guestPath||who.email!==STORE_ORDER_SUPER_ADMIN)fail("只有最高權限帳號可管理總部權限",403);
      if(request.method==="GET")return response(await readHQAccess(env.DB));
      if(request.method==="PUT")return response(await updateHQAccess(env.DB,who.email,await bounded(request,20000),Object.values(c.stores).flatMap(s=>s.emails)));
      fail("不支援的帳號管理操作",405);
    }
    if(action==="/guest-invites"){hq(who);if(request.method==="GET")return response({invites:(await env.DB.prepare("SELECT id,store_code,expires_at,max_uses,uses,created_at,revoked_at,version FROM store_order_invites ORDER BY created_at DESC LIMIT 100").all()).results});if(request.method==="POST"){const b=await bounded(request,1000),store=storeFor(who,b.storeCode,c);return response(await issueGuestInvite(env,who.email,store,{hours:b.hours,maxUses:b.maxUses}));}}
    const revoke=action.match(/^\/guest-invites\/([A-Za-z0-9-]{8,80})\/revoke$/);if(revoke&&request.method==="POST"){hq(who);const b=await bounded(request,1000),r=await env.DB.prepare("UPDATE store_order_invites SET revoked_at=?,version=version+1 WHERE id=? AND version=? AND revoked_at IS NULL").bind(now(),revoke[1],b.expectedVersion).run();if(!r.meta.changes)fail("邀請碼已更新或停用，請重新整理",409);return response({revoked:true});}

    if (action === "/session" && request.method === "GET") return response({ ...who, canManageHQ: !who.guest&&who.email===STORE_ORDER_SUPER_ADMIN, version: VERSION, guest:!!who.guest, googleClientId: who.guest?undefined:env.GOOGLE_OAUTH_CLIENT_ID, masterFolderId: who.guest?undefined:FIXED_SOURCES.productMasterFolderId, cloudReady: c.storageType==="company_account"?!!env.STORE_ORDERS_VAULT:!!env.STORE_ORDERS_SERVICE_ACCOUNT, productionExportEnabled: env.STORE_ORDERS_PRODUCTION_EXPORT==="approved-20261030", recognitionReady:!!env.OPENAI_API_KEY, recognitionModel:ORDER_AI_MODEL, stores: Object.fromEntries(Object.entries(c.stores).filter(([k]) => who.role === "hq" || who.storeCode === k).map(([k, v]) => [k, { name: STORES[k] || k, pendingFolderId: who.guest?undefined:v.pendingFolderId }])) });
    const drive = new OrderDrive(env, c);
    if(action==="/catalog"){
      const catalogFolder=c.catalogFolderId;if(!catalogFolder)throw new OrderError("門市商品查詢尚未設定",503);
      const current=await env.DB.prepare("SELECT * FROM store_order_settings WHERE key='catalog'").first<any>();
      if(request.method==="GET"){if(!current)fail("總部尚未同步商品查詢，可先人工輸入",503);await drive.owned(current.file_id,catalogFolder);const value=await drive.json(current.file_id,5000000);if(await orderHash(JSON.stringify(value))!==current.content_hash)fail("商品查詢內容已變動，請總部重新同步",409);return response(value);}
      if(request.method==="POST"){hq(who);const b=await bounded(request,5000000),allowed=["sku","name","color","colorCode","size","sizeCode","discontinued"];
        if(typeof b.version!=="string"||!b.version||b.version.length>200||!Array.isArray(b.records)||!b.records.length||b.records.length>20000||b.records.some((r:any)=>!r||Object.keys(r).some(k=>!allowed.includes(k))||allowed.filter(k=>k!=="discontinued").some(k=>typeof r[k]!=="string"||r[k].length>200)||typeof r.discontinued!=="boolean"))fail("商品查詢僅能包含貨號、品名及規格，不得含成本或其他內容");
        const value={version:b.version,records:b.records},hash=await orderHash(JSON.stringify(value));if(current?.source_version===b.version){if(current.content_hash!==hash)fail("相同主檔版本的內容不同，請重新讀取來源",409);return response({saved:true,version:current.version});}
        await drive.checkFolder(catalogFolder,c.hqEmails);const op=crypto.randomUUID(),file=await drive.write(catalogFolder,`catalog-${op}.json`,value,op);if(await orderHash(JSON.stringify(await drive.json(file,5000000)))!==hash)fail("商品查詢保存尚未確認",503);
        const result=current?await env.DB.prepare("UPDATE store_order_settings SET file_id=?,content_hash=?,source_version=?,version=version+1,updated_at=?,updated_by=? WHERE key='catalog' AND version=?").bind(file,hash,b.version,now(),who.email,current.version).run():await env.DB.prepare("INSERT OR IGNORE INTO store_order_settings(key,file_id,content_hash,source_version,version,updated_at,updated_by) VALUES ('catalog',?,?,?,1,?,?)").bind(file,hash,b.version,now(),who.email).run();if(!result.meta.changes)fail("其他總部同仁已同步主檔，請重新讀取",409);return response({saved:true,version:(current?.version||0)+1});
      }
    }
    const guestFile=action.match(/^\/file\/([A-Za-z0-9_-]{8,200})$/);
    if(guestPath&&guestFile&&request.method==="GET"){const folder=c.stores[who.storeCode!].pendingFolderId,meta=await drive.owned(guestFile[1],folder);if(meta.appProperties?.soActor!==who.email||!MIME.has(meta.mimeType))fail("無權取得此原圖",403);return new Response(await drive.read(guestFile[1],20000000),{headers:{...JSON_HEADERS,"Content-Type":meta.mimeType}});}
    if(!guestPath&&guestFile&&request.method==="GET"){
      hq(who);const id=guestFile[1],source=await env.DB.prepare("SELECT order_id,store_code FROM store_order_sources WHERE file_id=?").bind(id).first<{order_id:string|null;store_code:string}>();
      let folder:string;
      if(source?.order_id){const row=await index(env,source.order_id);visible(who,row,c);folder=row.batch_id?c.settledFolderId:c.stores[row.store_code].pendingFolderId;}
      else {const meta=await drive.meta(id),entry=Object.values(c.stores).find(s=>meta.parents?.includes(s.pendingFolderId));if(!entry)fail("無權取得此原圖",403);folder=entry!.pendingFolderId;}
      const meta=await drive.owned(id,folder);if(!MIME.has(meta.mimeType))fail("只能讀取授權訂單原圖",403);if(source)await unchangedSource(env,drive,id);
      return new Response(await drive.read(id,20000000),{headers:{...JSON_HEADERS,"Content-Type":meta.mimeType,"Content-Disposition":"inline"}});
    }
    if(action==="/recognize"&&request.method==="POST"){
      const b=await bounded(request,23000000),store=storeFor(who,b.storeCode,c),fileId=folderId(b.fileId);
      return recognitionResponse(()=>recognizeStoreOrder(env,b,{actor:who.email,storeCode:store,fileId,validateSource:async()=>{const registered=await env.DB.prepare("SELECT file_id FROM store_order_sources WHERE file_id=? AND store_code=? AND duplicate_of IS NULL").bind(fileId,store).first();if(!registered)fail("請先登記本店來源原圖",403);const meta=await drive.owned(fileId,c.stores[store].pendingFolderId);if(who.guest&&meta.appProperties?.soActor!==who.email)fail("無權辨識其他人的原圖",403);await unchangedSource(env,drive,fileId);}}),error=>({error:error instanceof RecognitionError||error instanceof OrderError?error.message:"辨識結果未確認收到，請先檢查狀態，勿重複送出",status:error instanceof RecognitionError||error instanceof OrderError?error.status:503}));
    }
    if(action==="/attention"&&request.method==="GET") {
      hq(who);
      const overdue=await env.DB.prepare("SELECT id,store_code,business_date,status,updated_at FROM store_orders WHERE status NOT IN ('erp_created','cancelled') AND business_date < ? ORDER BY business_date LIMIT 100").bind(new Date(Date.now()-30*86400000).toISOString().slice(0,10)).all();
      const maintenance=await env.DB.prepare("SELECT event,created_at FROM store_order_events WHERE event IN ('retention_completed','retention_failed') ORDER BY created_at DESC LIMIT 1").first();
      return response({orders:overdue.results,maintenance});
    }
    if (["/upload-session","/upload-confirm"].includes(action) && request.method === "POST") {
      const b=await bounded(request),store=storeFor(who,b.storeCode,c),op=uuid(b.operationId),folder=c.stores[store].pendingFolderId;
      if(!MIME.has(b.mimeType)||!Number.isSafeInteger(b.size)||b.size<1||b.size>20000000) fail("檔案格式或大小錯誤，每檔最多20MB");
      await drive.checkFolder(folder,[...c.hqEmails,...c.stores[store].emails]);
      const matches=(await drive.list(folder,true)).filter(f=>f.appProperties?.soUpload===op);
      if(matches.length>1)fail("同一上傳出現多個檔案，請先核對新單清單",409);
      const existing=matches[0];
      if(existing){
        if(existing.appProperties?.soActor!==who.email)fail("上傳操作不屬於目前登入者",403);
        const meta=await drive.owned(existing.id,folder);
        if(meta.appProperties?.soUpload!==op||meta.appProperties?.soActor!==who.email||meta.mimeType!==b.mimeType||Number(meta.size)!==b.size||!meta.md5Checksum)fail("雲端檔案尚未完整確認，請先核對新單清單",409);
        return response({fileId:existing.id,completed:true});
      }
      if(action==="/upload-confirm")return response({completed:false});
      const started=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id",{method:"POST",headers:{Authorization:`Bearer ${await drive.token()}`,Origin:request.headers.get("Origin")!,"Content-Type":"application/json","X-Upload-Content-Type":b.mimeType,"X-Upload-Content-Length":String(b.size)},body:JSON.stringify({name:`${crypto.randomUUID()}.${b.mimeType==="application/pdf"?"pdf":"image"}`,parents:[folder],mimeType:b.mimeType,appProperties:{soUpload:op,soActor:who.email}})});
      const uploadUrl=started.headers.get("Location");
      if(!started.ok||!uploadUrl||new URL(uploadUrl).protocol!=="https:"||new URL(uploadUrl).hostname!=="www.googleapis.com") fail("公司雲端尚未建立上傳工作階段",503);
      return response({uploadUrl,completed:false});
    }
    if (action === "/queue" && request.method === "GET") {
      const store = storeFor(who, url.searchParams.get("store"), c);
      const date = url.searchParams.get("date"); if (!validDate(date || "")) fail("請選擇業務日期");
      const rows = await env.DB.prepare(`SELECT id,store_code,business_date,status,version,batch_id,updated_at,erp_created_at FROM store_orders WHERE store_code=? AND business_date=? ${who.role === "store" ? "AND batch_id IS NULL" : ""} ${who.guest?"AND created_actor=?":""} ORDER BY updated_at`).bind(...(who.guest?[store,date,who.email]:[store,date])).all();
      const batches = who.guest?{results:[]}:await env.DB.prepare("SELECT id,business_date,status,previous_batch_id,created_at FROM store_order_batches WHERE store_code=? AND business_date=? ORDER BY created_at").bind(store, date).all();
      return response({ orders: rows.results, batches: batches.results });
    }
    if (action === "/scan" && request.method === "GET") {
      const store = storeFor(who, url.searchParams.get("store"), c), folder = c.stores[store].pendingFolderId;
      await drive.checkFolder(folder, [...c.hqEmails, ...c.stores[store].emails]);
      const sources = await drive.list(folder, true), registered = await env.DB.prepare("SELECT file_id,order_id FROM store_order_sources WHERE store_code=?").bind(store).all<{file_id:string;order_id:string|null}>();
      return response({ files: sources.filter(f=>!who.guest||f.appProperties?.soActor===who.email).map(f => ({ id: f.id, mimeType: f.mimeType, size: f.size, createdTime: f.createdTime, orderId: registered.results.find(r => r.file_id === f.id)?.order_id || null })) });
    }
    if (action === "/sources" && request.method === "POST") {
      const b = await bounded(request), store = storeFor(who, b.storeCode, c), fileId = folderId(b.fileId), meta = await drive.owned(fileId, c.stores[store].pendingFolderId);
      if(who.guest&&meta.appProperties?.soActor!==who.email)fail("無權登記其他人的原圖",403);
      if (!MIME.has(meta.mimeType)) fail("不支援的單據格式");
      const digest = await orderHash(await drive.read(fileId, 20000000));
      const registered=await env.DB.prepare("SELECT digest FROM store_order_sources WHERE file_id=?").bind(fileId).first<{digest:string}>();
      if(registered&&registered.digest!==digest)fail("此原圖已被改動，請另傳新檔並由總部核對",409);
      const duplicate = await env.DB.prepare("SELECT file_id,order_id FROM store_order_sources WHERE store_code=? AND digest=?").bind(store, digest).first<any>();
      if (duplicate) {
        if (duplicate.file_id !== fileId) await env.DB.prepare("INSERT OR IGNORE INTO store_order_sources(file_id,store_code,digest,order_id,created_at,duplicate_of) VALUES (?,?,?,?,?,?)").bind(fileId,store,digest,duplicate.order_id,now(),duplicate.file_id).run();
        if(who.guest&&duplicate.file_id!==fileId)fail("此照片已有來源紀錄，請由總部核對重傳",409);
        return response({ fileId: duplicate.file_id, orderId: duplicate.order_id, duplicate: duplicate.file_id !== fileId });
      }
      await env.DB.prepare("INSERT INTO store_order_sources(file_id,store_code,digest,created_at,source_md5) VALUES (?,?,?,?,?)").bind(fileId, store, digest, now(),meta.md5Checksum || null).run();
      return response({ fileId, duplicate: false });
    }
    if (action === "/orders" && request.method === "POST") return await saveOrder(request, env, who, c, drive);
    if(who.guest&&action==="/settle")fail("訪客只能上傳與覆核，結算由總部執行",403);
    if (action === "/settle" && request.method === "POST") return await settle(request, env, who, c, drive);
    const match = action.match(/^\/orders\/([a-zA-Z0-9-]{8,80})(?:\/(export|result|correct))?$/);
    if (match) {
      const row = await index(env, match[1]); visible(who, row, c);
      if (request.method === "GET" && !match[2]) {const order=await snapshot(env,drive,row);if(who.guest){order.items.forEach((i:any)=>i.costSnapshot=null);order.reviewEdits=(order.reviewEdits||[]).filter((e:any)=>!String(e.path||" ").toLowerCase().includes("cost"));}return response({order});}
      hq(who);
      const b = await bounded(request);
      if (row.lock_until && row.lock_until > now()) fail("訂單正在更新", 409);
      if (b.expectedVersion !== row.version) fail("版本衝突，請重新載入最新版", 409);
      if (match[2] === "export") {
        const production=b.mode==="production";
        if(!["test","production"].includes(b.mode)||production&&env.STORE_ORDERS_PRODUCTION_EXPORT!=="approved-20261030")fail("正式ERP產檔尚未啟用",403);
        if (!["settled", "import_failed"].includes(row.status)) fail("此單已產檔或結果不明，禁止重複產檔", 409);
        const order = await snapshot(env, drive, row);
        const validation = validateOrder(order, { complete: true }); if (validation.errors.length) fail(validation.errors.join("；"));
        if(production){try{resolvedERPPrices(order);}catch(error){fail(error instanceof Error?error.message:"組合價格未通過");}}
        const r = await env.DB.prepare("UPDATE store_orders SET status='exported',version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=? AND status IN ('settled','import_failed')").bind(now(), who.email, row.id, row.version).run();
        if (!r.meta.changes) fail("其他同仁已產檔，請重新載入", 409);
        await event(env, who, production?"production_export_reserved":"test_export_reserved", row.id);
        return response({ order, version: row.version + 1, testOnly: !production });
      }
      if (match[2] === "result") {
        if (!["exported", "import_unknown", "import_failed"].includes(row.status)) fail("訂單目前不能登記匯入結果", 409);
        if (!["erp_created", "import_failed", "import_unknown"].includes(b.status) || !text(b.reason)) fail("請選結果並填寫確認說明");
        if (b.status === "erp_created" && !/^[A-Za-z0-9_-]{1,80}$/.test(String(b.erpNumber || ""))) fail("請填ERP單號");
        const order = await snapshot(env, drive, row), op = uuid(b.operationId);
        await drive.write(c.settledFolderId, `${row.id}-result-${op}.json`, { orderId: row.id, result: b.status, reason: text(b.reason), erpNumber: text(b.erpNumber), actor: who.email, at: now(), orderVersion: row.version }, op);
        const r = await env.DB.prepare("UPDATE store_orders SET status=?,erp_number=?,erp_created_at=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?").bind(b.status, b.status === "erp_created" ? b.erpNumber : null, b.status === "erp_created" ? now() : null, now(), who.email, row.id, row.version).run();
        if (!r.meta.changes) fail("版本衝突，請重新讀取", 409);
        await event(env, who, b.status, row.id); return response({ saved: true, version: row.version + 1 });
      }
      if (match[2] === "correct") {
        if (!["settled", "import_failed"].includes(row.status) || !text(b.reason)) fail("只有已結算或確認匯入失敗的單可更正，並須填原因", 409);
        const order = b.order;
        if (order?.id !== row.id || order.storeCode !== row.store_code || order.businessDate !== row.business_date) fail("更正不得變更訂單、門市或日期");
        const v = validateOrder(order, { complete: true }); if (v.errors.length) fail(v.errors.join("；"));
        const prior = await snapshot(env, drive, row); if (JSON.stringify(order.sources) !== JSON.stringify(prior.sources)) fail("更正不得替換來源圖，請另開補交單");
        const paperHash=await orderHash(`${row.store_code}:${text(order.paperNumber)}`);
        if(await env.DB.prepare("SELECT id FROM store_orders WHERE store_code=? AND paper_hash=? AND id!=? AND status!='cancelled'").bind(row.store_code,paperHash,row.id).first())fail("更正後紙本單號已屬於另一張單",409);
        const op = uuid(b.operationId);
        const file = await drive.write(c.settledFolderId, `${row.id}-correction-${op}.json`, { ...order, correctionReason: text(b.reason), correctedBy: who.email, previousDriveId: row.drive_id, correctedAt: now() }, op);
        await drive.checkPermissions(file, c.hqEmails);
        const contentHash=await orderHash(JSON.stringify(await drive.json(file)));
        const r = await env.DB.prepare("UPDATE store_orders SET drive_id=?,content_hash=?,paper_hash=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=? AND status IN ('settled','import_failed')").bind(file, contentHash,paperHash, now(), who.email, row.id, row.version).run();
        if (!r.meta.changes) fail("版本衝突，請重新讀取", 409);
        await event(env, who, "corrected", row.id); return response({ saved: true, version: row.version+1 });
      }
    }
    if (action === "/retention" && request.method === "POST") {
      hq(who); await bounded(request);
      return response(await recycleOrders(env,c,drive));
    }
    return response({ error: "找不到此操作" }, 404);
  } catch (error) {
    if(error instanceof HQAccessError)return response({error:error.message},error.status);
    if(error instanceof OwnerError)return response({error:error.message},error.status);
    if(error instanceof GuestError)return response({error:error.message},error.status);
    if(error instanceof RecognitionError)return response({error:error.message},error.status);
    if (error instanceof OrderError) return response({ error: error.message, ...(error.restartSettlement ? {code:"settlement_reconfirm"}: {}) }, error.status);
    if (error instanceof Response) return response({ error: await error.text() }, error.status);
    // Never log request bodies, Drive errors, file names, credentials, or customer content.
    return response({ error: "門市訂單服務暫時無法使用；操作未確認成功，請更新清單後重試" }, 503);
  }
}

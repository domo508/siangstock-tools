import { verifyAdmin, verifyCompanyUser, type AccessConfig } from "./access";
import { RequestValidationError } from "./schema";

type DirectoryEnv = AccessConfig & { DB: D1Database; ALLOWED_ORIGINS: string; PROCUREMENT_ACCESS_AUD?: string };
export type DepartmentAssignment = { toolId: string; primary: string; collaborators: string[]; displayName?: string };
type Row = { version: number; payload: string; updated_at: string };
export const HOMEPAGE_RUNTIME_VERSION = "20261027-activity-entry-r5";
const DEPARTMENTS = new Set(["admin", "merch", "ops", "design", "store"]);
const API_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0, must-revalidate", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: API_HEADERS }); }
function exact(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestValidationError("部門設定格式不正確。");
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some(key => !keys.includes(key) && !optional.includes(key)) || keys.some(key => !Object.hasOwn(object, key))) throw new RequestValidationError("部門設定欄位不符。");
  return object;
}
function assignment(value: unknown): DepartmentAssignment {
  const row = exact(value, ["toolId", "primary", "collaborators"], ["displayName"]);
  if (Object.hasOwn(row, "displayName") && (typeof row.displayName !== "string" || !row.displayName.trim() || [...row.displayName.trim()].length > 80 || /[\u0000-\u001f\u007f-\u009f]/u.test(row.displayName))) throw new RequestValidationError("工具名稱請填入1至80個字，且不可含換行或控制字元。");
  if (typeof row.toolId !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(row.toolId)) throw new RequestValidationError("工具識別碼不正確。");
  if (typeof row.primary !== "string" || !DEPARTMENTS.has(row.primary)) throw new RequestValidationError("請選擇有效的主責部門。");
  if (!Array.isArray(row.collaborators) || row.collaborators.length > 4 || row.collaborators.some(id => typeof id !== "string" || !DEPARTMENTS.has(id) || id === row.primary) || new Set(row.collaborators).size !== row.collaborators.length) throw new RequestValidationError("協作部門重複、無效或與主責部門相同。");
  return { toolId: row.toolId, primary: row.primary, collaborators: [...row.collaborators] as string[], ...(typeof row.displayName === "string" ? { displayName: row.displayName.trim() } : {}) };
}
export function validateAssignments(value: unknown): DepartmentAssignment[] {
  if (!Array.isArray(value) || value.length > 200) throw new RequestValidationError("工具部門清單格式不正確。");
  const result = value.map(assignment);
  if (new Set(result.map(row => row.toolId)).size !== result.length) throw new RequestValidationError("工具識別碼重複。");
  return result;
}
export function validateDepartmentUpdate(value: unknown): DepartmentAssignment & { expectedVersion: number } {
  const body = exact(value, ["expectedVersion", "toolId", "primary", "collaborators"], ["displayName"]);
  if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw new RequestValidationError("設定版本不正確，請重新讀取。");
  return { ...assignment({ toolId: body.toolId, primary: body.primary, collaborators: body.collaborators, ...(Object.hasOwn(body, "displayName") ? { displayName: body.displayName } : {}) }), expectedVersion: Number(body.expectedVersion) };
}
async function readBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) throw new RequestValidationError("Content-Type 必須是 application/json。", 415);
  if (Number(request.headers.get("Content-Length") || 0) > 16384) throw new RequestValidationError("部門設定內容超過上限。", 413);
  if (!request.body) throw new RequestValidationError("缺少設定內容。");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > 16384) { await reader.cancel(); throw new RequestValidationError("部門設定內容超過上限。", 413); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new RequestValidationError("部門設定必須為有效的 UTF-8 JSON。"); }
}
function sameOrigin(request: Request, env: DirectoryEnv): void {
  const origin = request.headers.get("Origin");
  const allowed = new Set((env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean));
  if (!origin || !allowed.has(origin) || origin !== new URL(request.url).origin) throw new RequestValidationError("不允許的來源。", 403);
}
function access(env: DirectoryEnv): AccessConfig { return { ...env, ACCESS_AUD: (env.PROCUREMENT_ACCESS_AUD || "").trim() }; }
async function current(env: DirectoryEnv): Promise<Row> {
  const row = await env.DB.prepare("SELECT version, payload, updated_at FROM homepage_departments WHERE id = 1").first<Row>();
  if (!row) throw new RequestValidationError("公司部門設定尚未初始化，停止編輯與儲存。", 503);
  if (!Number.isSafeInteger(row.version) || row.version < 1) throw new RequestValidationError("公司部門設定版本不正確。", 503);
  return row;
}
function result(row: Row, canManage: boolean) { return { version: row.version, updatedAt: row.updated_at, runtimeVersion: HOMEPAGE_RUNTIME_VERSION, canManage, assignments: validateAssignments(JSON.parse(row.payload)) }; }

export async function homepageDepartmentsRoute(request: Request, env: DirectoryEnv): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/rules/homepage") return null;
  try {
    if (request.method === "GET") {
      const email = await verifyCompanyUser(request, access(env));
      const allowed = new Set((env.ADMIN_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
      return json(result(await current(env), allowed.has(email)));
    }
    if (request.method === "PUT") {
      sameOrigin(request, env);
      const email = await verifyAdmin(request, access(env));
      if (request.headers.get("X-Homepage-Version") !== HOMEPAGE_RUNTIME_VERSION) return json({ error: "首頁已更新，請重新載入最新版後再儲存。" }, 409);
      const body = validateDepartmentUpdate(await readBody(request));
      const before = await current(env);
      if (before.version !== body.expectedVersion) return json({ error: "部門設定已被其他管理者更新，本次未儲存；請重新開啟並核對最新版。" }, 409);
      const assignments = validateAssignments(JSON.parse(before.payload));
      const index = assignments.findIndex(row => row.toolId === body.toolId);
      // Department-only updates preserve any existing shared display name. Legacy rows remain readable.
      const changed: DepartmentAssignment = { ...assignments[index], toolId: body.toolId, primary: body.primary, collaborators: body.collaborators, ...(body.displayName !== undefined ? { displayName: body.displayName } : {}) };
      if (index < 0) { if (assignments.length >= 200) throw new RequestValidationError("工具數量已達上限。"); assignments.push(changed); } else assignments[index] = changed;
      const payload = JSON.stringify(assignments);
      if (new TextEncoder().encode(payload).byteLength > 32768) throw new RequestValidationError("設定內容超過上限。", 413);
      // One CAS write and its history trigger are a single atomic SQLite statement.
      const saved = await env.DB.prepare("UPDATE homepage_departments SET version = version + 1, payload = ?, updated_at = ?, updated_by = ? WHERE id = 1 AND version = ? RETURNING version, payload, updated_at")
        .bind(payload, new Date().toISOString(), email, body.expectedVersion).first<Row>();
      if (!saved) return json({ error: "部門設定已被其他管理者更新，本次未儲存；請重新開啟並核對最新版。" }, 409);
      return json(result(saved, true));
    }
    return json({ error: "不支援此方法。" }, 405);
  } catch (error) {
    if (error instanceof Response) return json({ error: await error.text() }, error.status);
    if (error instanceof RequestValidationError) return json({ error: error.message }, error.status);
    // Never log request bodies or silently write browser-local replacements.
    return json({ error: "公司部門設定服務暫時無法使用；本次未確認儲存，請重新開啟核對後再試。" }, 503);
  }
}

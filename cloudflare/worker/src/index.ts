import { verifyAdmin } from "./access";
import { RequestValidationError, validateRules, validateUpdateBody } from "./schema";

const API_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};
const MAX_BODY_BYTES = 65536;

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...API_HEADERS, "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

async function readCurrent(env: Env): Promise<{ version: number; payload: string; updated_at: string } | null> {
  return env.DB.prepare("SELECT version, payload, updated_at FROM rules_current WHERE id = 1").first();
}

async function publicRules(request: Request, env: Env): Promise<Response> {
  const current = await readCurrent(env);
  if (!current) return errorResponse("集中規則尚未初始化。", 503);
  const headers = { ETag: `\"rules-v${current.version}\"`, "X-Rules-Version": String(current.version) };
  if (request.method === "HEAD") return new Response(null, { status: 200, headers: { ...API_HEADERS, ...headers } });
  const rules = validateRules(JSON.parse(current.payload));
  return json({ version: current.version, updatedAt: current.updated_at, rules }, 200, headers);
}

function requireSameOrigin(request: Request, env: Env): void {
  const allowed = new Set((env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean));
  const origin = request.headers.get("Origin") || "";
  if (!origin || !allowed.has(origin)) throw new RequestValidationError("不允許的來源。", 403);
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new RequestValidationError("Content-Type 必須是 application/json。", 415);
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BODY_BYTES) throw new RequestValidationError("規則內容超過 64 KB 上限。", 413);
  if (!request.body) throw new RequestValidationError("缺少 JSON 內容。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RequestValidationError("規則內容超過 64 KB 上限。", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new RequestValidationError("JSON 必須使用 UTF-8 編碼。"); }
  try { return JSON.parse(text); } catch { throw new RequestValidationError("JSON 格式錯誤。"); }
}

async function updateRules(request: Request, env: Env): Promise<Response> {
  requireSameOrigin(request, env);
  const adminEmail = await verifyAdmin(request, env);
  const body = validateUpdateBody(await readJsonBody(request));
  const payload = JSON.stringify(body.rules);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE rules_current SET version = version + 1, payload = ?, updated_at = ?, updated_by = ? WHERE id = 1 AND version = ? RETURNING version, updated_at"
  ).bind(payload, now, adminEmail, body.expectedVersion).first<{ version: number; updated_at: string }>();
  if (!result) return errorResponse("規則已被其他管理者更新，請重新載入最新版後再試。", 409);
  return json({ version: result.version, updatedAt: result.updated_at, rules: body.rules });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/rules" && (request.method === "GET" || request.method === "HEAD")) return await publicRules(request, env);
      if (url.pathname === "/api/rules/admin" && request.method === "PUT") return await updateRules(request, env);
      if (url.pathname.startsWith("/api/rules")) return errorResponse("不支援此方法或路徑。", 405);
      return errorResponse("找不到此 API。", 404);
    } catch (error) {
      if (error instanceof Response) return new Response(error.body, { status: error.status, headers: API_HEADERS });
      if (error instanceof RequestValidationError) return errorResponse(error.message, error.status);
      return errorResponse("規則服務暫時無法使用。", 503);
    }
  }
} satisfies ExportedHandler<Env>;

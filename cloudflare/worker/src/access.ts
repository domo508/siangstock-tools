import { createRemoteJWKSet, jwtVerify } from "jose";

export type AccessConfig = { ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; ADMIN_EMAILS: string };

function normalizedTeamDomain(value: string): string {
  return value.trim().replace(/^https:\/\//, "").replace(/\/$/, "");
}

export async function verifyAdmin(request: Request, env: AccessConfig): Promise<string> {
  const teamDomain = normalizedTeamDomain(env.ACCESS_TEAM_DOMAIN || "");
  const audience = (env.ACCESS_AUD || "").trim();
  if (!teamDomain || !audience) throw new Response("管理登入尚未啟用。", { status: 503 });
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new Response("需要 Cloudflare Access 管理者登入。", { status: 401 });
  const issuer = `https://${teamDomain}`;
  try {
    const { payload } = await jwtVerify(token, createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)), {
      issuer,
      audience
    });
    const email = typeof payload.email === "string" ? payload.email.trim().toLocaleLowerCase("en-US") : "";
    const allowed = new Set((env.ADMIN_EMAILS || "").split(",").map((item) => item.trim().toLocaleLowerCase("en-US")).filter(Boolean));
    if (!email || !allowed.has(email)) throw new Response("此帳號沒有規則管理權限。", { status: 403 });
    return email;
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response("管理登入驗證失敗。", { status: 401 });
  }
}

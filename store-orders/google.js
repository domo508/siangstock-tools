// Tokens live only in this module's memory; no refresh tokens or persistent credentials.
let token = "", client = null;
export function configure(clientId) {
  if (!clientId || !globalThis.google?.accounts?.oauth2) throw Error("Google 授權元件尚未就緒，請稍後重試");
  client = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: "openid email https://www.googleapis.com/auth/drive.readonly", include_granted_scopes: false, callback: () => {} });
}
export async function authorize() {
  if (!client) throw Error("請先完成公司工具登入");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error("Google 授權逾時，請重試")), 120000);
    client.callback = r => { clearTimeout(timeout); if (r.error || !r.access_token) return reject(Error("Google 授權失敗")); token = r.access_token; resolve(); };
    client.error_callback = () => { clearTimeout(timeout); reject(Error("Google 授權已取消，請重試")); };
    client.requestAccessToken({ prompt: token ? "" : "select_account", hd: "siangapato.com.tw" });
  });
}
export function clear() { token = ""; client = null; }
async function request(path, options = {}, upload = false) {
  if (!token) throw Error("請先按「授權公司雲端硬碟」");
  const r = await fetch(`https://www.googleapis.com/${upload ? "upload/" : ""}drive/v3/${path}`, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  if (r.status === 401) { token = ""; throw Error("Google 授權已過期，請重新授權"); }
  if (!r.ok) throw Error("公司雲端操作未成功，請確認帳號、權限或額度後重試");
  return r;
}
export async function verifyIdentity(expected) {
  const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok || (await r.json()).email?.toLowerCase() !== expected.toLowerCase()) { clear(); throw Error("雲端帳號與公司工具登入帳號不同，請重新登入"); }
}
export async function upload(file, session) {
  if(session.completed) return {id:session.fileId};
  const url=new URL(session.uploadUrl);
  if(url.protocol!=="https:"||url.hostname!=="www.googleapis.com")throw Error("上傳位置不正確，已停止");
  const r=await fetch(url.href,{method:"PUT",headers:{"Content-Type":file.type},body:file});
  if(!r.ok)throw Error("照片上傳未確認成功，請更新新單清單後再重試");
  return r.json();
}
export async function download(id) { return (await request(`files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`)).blob(); }
export async function latestMaster(folderId) {
  const files = []; let page = "";
  do {
    const query = new URLSearchParams({ q: `'${folderId}' in parents and trashed=false and mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`, supportsAllDrives: "true", includeItemsFromAllDrives: "true", fields: "nextPageToken,files(id,name,modifiedTime)", pageSize: "100", ...(page ? { pageToken: page } : {}) });
    const data = await (await request(`files?${query}`)).json(); files.push(...(data.files || [])); page = data.nextPageToken || "";
  } while (page);
  files.sort((a,b)=>b.modifiedTime.localeCompare(a.modifiedTime));
  if (!files.length || files[0].modifiedTime === files[1]?.modifiedTime) throw Error("商品主檔沒有唯一的最新檔，請確認資料夾");
  return { blob: await download(files[0].id), version: `${files[0].id}:${files[0].modifiedTime}` };
}

// Fixed tool owner; other company administrators do not inherit this permission.
export const STORE_ORDER_SUPER_ADMIN='siang01@siangapato.com.tw';
export class HQAccessError extends Error {constructor(message:string,public status=400){super(message);}}
function normalize(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>50||value.some(e=>typeof e!=='string'||e.length>254))throw new HQAccessError('請提供最多50個公司帳號');
 const emails=value.map(e=>e.trim().toLowerCase());
 if(emails.some(e=>!(/^[a-z0-9][a-z0-9._+-]*@siangapato\.com\.tw$/).test(e)||e===STORE_ORDER_SUPER_ADMIN)||new Set(emails).size!==emails.length)throw new HQAccessError('請填不重複的公司email；最高權限帳號固定保留，不列入增減名單');
 return emails.sort();
}
export async function readHQAccess(db:D1Database){
 const row=await db.prepare('SELECT emails,version,updated_at,updated_by FROM store_order_hq_access WHERE id=1').first<{emails:string;version:number;updated_at:string;updated_by:string}>();
 if(!row||!Number.isSafeInteger(row.version))throw new HQAccessError('總部帳號管理尚未設定',503);
 let emails:string[];try{emails=normalize(JSON.parse(row.emails));}catch{throw new HQAccessError('總部帳號設定無法驗證，已停止存取',503);}
 return {emails,version:row.version,updatedAt:row.updated_at,updatedBy:row.updated_by,ownerEmail:STORE_ORDER_SUPER_ADMIN};
}
export async function updateHQAccess(db:D1Database,actor:string,body:any,storeEmails:string[]=[]){
 if(actor!==STORE_ORDER_SUPER_ADMIN)throw new HQAccessError('只有最高權限帳號可管理總部權限',403);
 if(!body||Object.keys(body).some(k=>!['emails','expectedVersion'].includes(k))||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0)throw new HQAccessError('請重新讀取總部帳號版本',409);
 const emails=normalize(body.emails);if(emails.some(e=>storeEmails.includes(e)))throw new HQAccessError('此帳號已有門市角色，不能同時指派總部');
 const result=await db.prepare('UPDATE store_order_hq_access SET emails=?,version=version+1,updated_at=?,updated_by=? WHERE id=1 AND version=?').bind(JSON.stringify(emails),new Date().toISOString(),actor,body.expectedVersion).run();
 if(!result.meta.changes)throw new HQAccessError('總部名單已由其他分頁更新，請重新讀取再操作',409);
 return readHQAccess(db);
}

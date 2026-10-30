import {SignJWT,jwtVerify} from 'jose';
export type GuestEnv={DB:D1Database;STORE_ORDERS_GUEST_KEY?:string};
export class GuestError extends Error {constructor(message:string,public status=400){super(message);}}
const fail=(m:string,s=400):never=>{throw new GuestError(m,s);};
const digest=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(v=>v.toString(16).padStart(2,'0')).join('');
function key(env:GuestEnv){if(!env.STORE_ORDERS_GUEST_KEY||env.STORE_ORDERS_GUEST_KEY.length<43)fail('訪客驗證尚未啟用',503);return new TextEncoder().encode(env.STORE_ORDERS_GUEST_KEY);}
const cookie=(token:string,seconds:number)=>`__Secure-so_guest=${token}; Path=/api/store-orders-guest/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
export async function issueGuestInvite(env:GuestEnv,actor:string,storeCode:string,{hours=12,maxUses=3}:{hours?:number;maxUses?:number}={}){
 key(env);if(!Number.isSafeInteger(hours)||hours<1||hours>168||!Number.isSafeInteger(maxUses)||maxUses<1||maxUses>10)fail('邀請期限須1至168小時，最多1至10次使用');
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',code=[...crypto.getRandomValues(new Uint8Array(20))].map(v=>alphabet[v&31]).join(''),id=crypto.randomUUID(),at=new Date().toISOString(),expires=new Date(Date.now()+hours*3600000).toISOString();
 await env.DB.prepare('INSERT INTO store_order_invites(id,store_code,code_hash,expires_at,max_uses,uses,created_at,created_by,version) VALUES (?,?,?,?,?,0,?,?,1)').bind(id,storeCode,await digest(code),expires,maxUses,at,actor).run();
 return {id,code:code.match(/.{5}/g)!.join('-'),storeCode,expiresAt:expires,maxUses,version:1};
}
export async function redeemGuestInvite(request:Request,env:GuestEnv,body:any,validStores:string[]){
 const secret=key(env),ip=request.headers.get('CF-Connecting-IP');if(!ip)fail('無法確認來源網路，請從公司正式訪客入口操作',403);
 const bucket=Math.floor(Date.now()/60000),ipHash=await digest(`${env.STORE_ORDERS_GUEST_KEY}:${bucket}:${ip}`);
 const rate=await env.DB.prepare('INSERT INTO store_order_guest_limits(bucket,attempts,created_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 WHERE attempts<10').bind(ipHash,new Date().toISOString()).run();if(!rate.meta.changes)fail('驗證次數過多，請稍後再試',429);
 const code=typeof body?.code==='string'?body.code.replace(/[\s-]/g,'').toUpperCase():'';
 if(!/^[A-HJ-NP-Z2-9]{20}$/.test(code))fail('邀請碼無效、已到期或已停用',403);
 const at=new Date().toISOString(),invite=await env.DB.prepare('SELECT * FROM store_order_invites WHERE code_hash=? AND revoked_at IS NULL AND expires_at>? AND uses<max_uses').bind(await digest(code),at).first<any>();
 if(!invite||!validStores.includes(invite.store_code))fail('邀請碼無效、已到期或已停用',403);
 const sid=crypto.randomUUID(),expires=new Date(Math.min(Date.parse(invite.expires_at),Date.now()+12*3600000)).toISOString();
 await env.DB.batch([
  env.DB.prepare('UPDATE store_order_invites SET uses=uses+1 WHERE id=? AND revoked_at IS NULL AND expires_at>? AND uses<max_uses').bind(invite.id,at),
  env.DB.prepare('INSERT INTO store_order_guest_sessions(id,invite_id,store_code,expires_at,created_at) SELECT ?,?,?,?,? WHERE changes()=1').bind(sid,invite.id,invite.store_code,expires,at)
 ]);
 if(!await env.DB.prepare('SELECT id FROM store_order_guest_sessions WHERE id=?').bind(sid).first())fail('邀請碼已使用完畢，請向總部取得新碼',403);
 const seconds=Math.floor((Date.parse(expires)-Date.now())/1000),token=await new SignJWT({sid,store:invite.store_code}).setProtectedHeader({alg:'HS256'}).setIssuer('siangstock-store-orders').setAudience('store-orders-guest').setSubject('guest-'+sid).setIssuedAt().setExpirationTime(Math.floor(Date.parse(expires)/1000)).sign(secret);
 return {body:{storeCode:invite.store_code,expiresAt:expires},setCookie:cookie(token,seconds)};
}
export async function verifyGuest(request:Request,env:GuestEnv){
 const parts=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith('__Secure-so_guest='));if(parts.length!==1)fail('請先使用總部提供的邀請碼登入',401);
 let payload;try{payload=(await jwtVerify(parts[0].slice('__Secure-so_guest='.length),key(env),{algorithms:['HS256'],issuer:'siangstock-store-orders',audience:'store-orders-guest'})).payload;}catch{fail('訪客登入已到期，請重新取得邀請碼',401);}
 const at=new Date().toISOString(),row=await env.DB.prepare('SELECT s.id,s.store_code FROM store_order_guest_sessions s JOIN store_order_invites i ON i.id=s.invite_id WHERE s.id=? AND s.revoked_at IS NULL AND s.expires_at>? AND i.revoked_at IS NULL AND i.expires_at>?').bind(payload!.sid,at,at).first<any>();
 if(!row||row.store_code!==payload!.store||payload!.sub!=='guest-'+row.id)fail('訪客權限已到期或已撤銷',401);
 return {email:'guest-'+row.id,role:'store' as const,storeCode:row.store_code as string,guest:true,sessionId:row.id as string};
}
export async function logoutGuest(env:GuestEnv,sid:string){await env.DB.prepare('UPDATE store_order_guest_sessions SET revoked_at=? WHERE id=?').bind(new Date().toISOString(),sid).run();return cookie('',0);}

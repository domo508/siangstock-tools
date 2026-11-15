import { RequestValidationError } from './schema';
import { STORES } from './store-transfer-stores';
type Env={DB:D1Database};
export function newProductNoticeStatements(env:Env,batchId:string,now:string){
 return [env.DB.prepare(`INSERT OR IGNORE INTO new_product_notifications(plan_id,store_code,recipient)
 SELECT s.plan_id,s.store_code,CASE s.store_code ${Object.entries(STORES).map(([code,v])=>`WHEN '${code}' THEN '${v.email}'`).join(' ')} END
 FROM new_product_store_status s JOIN new_product_plans p ON p.id=s.plan_id
 JOIN procurement_batches b ON b.id=p.procurement_batch_id
 WHERE p.procurement_batch_id=? AND p.status='store_confirmation' AND b.status='approved' AND p.updated_at=?`).bind(batchId,now)];
}
export async function sendNewProductNotices(request:Request,env:Env,planId:string,email:string){
 const plan=await env.DB.prepare(`SELECT p.id,p.procurement_batch_id,b.status FROM new_product_plans p JOIN procurement_batches b ON b.id=p.procurement_batch_id WHERE p.id=?`).bind(planId).first<Record<string,unknown>>();
 if(!plan||!['approved','erp_created','received'].includes(String(plan.status)))throw new RequestValidationError('找不到已核准新品首配。',409);
 await env.DB.prepare("UPDATE new_product_notifications SET status='not_required',error_summary='門市已送出首配確認，無需再通知' WHERE plan_id=? AND status IN ('pending','failed') AND EXISTS(SELECT 1 FROM new_product_store_status s WHERE s.plan_id=new_product_notifications.plan_id AND s.store_code=new_product_notifications.store_code AND s.status='submitted')").bind(planId).run();
 const jobs=await env.DB.prepare("SELECT * FROM new_product_notifications WHERE plan_id=? AND status NOT IN ('sent','not_required') ORDER BY store_code").bind(planId).all<Record<string,unknown>>();
 if(!jobs.results.length)return {sent:0,remaining:0,total:0};
 const token=request.headers.get('X-Google-Access-Token')||'';
 if(!token||token.length>4096)throw new RequestValidationError('新品門市通知待寄：請重新完成公司Google寄信授權；採購核准及首配已保留。',401);
 let identity:Response;try{identity=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${token}`}});}catch{throw new RequestValidationError('新品通知帳號驗證暫時失敗，請重試；核准資料已保留。',502);}
 const user=await identity.json<{email?:string}>().catch(()=>({email:''}));
 if(!identity.ok||String(user.email||'').toLowerCase()!==email.toLowerCase())throw new RequestValidationError('新品通知Google授權須與公司登入帳號相同，請重新授權。',403);
 let sent=0;const errors:string[]=[];
 for(const job of jobs.results){
  if(['sending','unknown'].includes(String(job.status))){errors.push(`${job.store_code}寄送結果待查證，已停止重寄避免重複通知`);continue;}
  const now=new Date().toISOString();
  const claim=await env.DB.prepare("UPDATE new_product_notifications SET status='sending',attempts=attempts+1,last_attempt_at=?,error_summary=NULL WHERE plan_id=? AND store_code=? AND status IN ('pending','failed')").bind(now,planId,job.store_code).run();
  if(!Number(claim.meta.changes))continue;
  const facts=await env.DB.prepare('SELECT COUNT(*) n FROM new_product_plan_rows WHERE plan_id=? AND store_code=?').bind(planId,job.store_code).first<{n:number}>();
  const subject=`[翔仔居家] 新品首配待確認｜${plan.procurement_batch_id}`;
  const text=[`From: ${email}`,`To: ${job.recipient}`,`Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','',`${job.store_code} ${STORES[String(job.store_code) as keyof typeof STORES]?.name||''}`,`新品採購已核准，本店有${facts?.n||0}項新品首配待確認。`,`採購批次：${plan.procurement_batch_id}`,`請開啟 ${new URL(request.url).origin}/store-transfer/`,'展開使用步驟下方「新品首配與待到貨進度」，核對本店數量；有異動請填原因，再送出總部覆核。','這次是到貨前需求確認，尚未安排出貨；到貨後由總部覆核實際出貨量，不需門市重複確認。'].join('\r\n');
  let response:Response;let state='failed',error='';let messageId='';
  try{
   response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw:btoa(unescape(encodeURIComponent(text))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')})});
   const result=await response.json<{id?:string}>().catch(()=>({id:''}));
   if(response.ok&&result.id){state='sent';messageId=result.id;sent++;}
   else if(response.ok||response.status>=500){state='unknown';error='Gmail回應不明，請先查證寄件備份，避免重複寄送。';}
   else error=`Gmail拒絕寄送（HTTP ${response.status}），請確認授權後重試。`;
  }catch{state='unknown';error='寄送連線中斷，結果待查證；請先核對寄件備份，不自動重寄。';}
  await env.DB.prepare('UPDATE new_product_notifications SET status=?,provider_message_id=?,sent_at=?,error_summary=? WHERE plan_id=? AND store_code=? AND status=\'sending\'').bind(state,messageId||null,state==='sent'?now:null,error||null,planId,job.store_code).run();
  if(error)errors.push(`${job.store_code}：${error}`);
 }
 const remaining=await env.DB.prepare("SELECT COUNT(*) n FROM new_product_notifications WHERE plan_id=? AND status NOT IN ('sent','not_required')").bind(planId).first<{n:number}>();
 return {sent,remaining:remaining?.n||0,total:jobs.results.length,errors};
}

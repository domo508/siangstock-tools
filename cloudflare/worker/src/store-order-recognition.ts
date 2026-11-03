import { FULL_EXTRACTION_SCHEMA, FULL_EXTRACTION_PROMPT, CODED_GROUP_PROMPT, validateExtraction } from '../../../store-orders/recognition.js';
import { inspectInputs, MULTIVIEW_PROMPT, recognitionRecord } from '../../scripts/store-orders-image-request.mjs';
import { taipeiDate, VERSION } from '../../../store-orders/core.js';
export const ORDER_AI_MODEL='gpt-6.1-sol';
type AIEnv={DB:D1Database;OPENAI_API_KEY?:string};
export type RecognitionStorage={save:(id:string,result:unknown)=>Promise<{id:string;hash:string}>;load:(id:string)=>Promise<unknown>};
type Context={actor:string;storeCode:string;fileId:string;validateSource:()=>Promise<void>;storage:RecognitionStorage};
type Job={id:string;actor:string;store_code:string;file_id:string;page_index:number;status:string;request_hash:string;created_at:string;deadline_at:string|null;upstream_id:string|null;result_drive_id:string|null;result_file_hash:string|null;error_code:string|null};
export const RECOGNITION_LIMIT_MS=300000;
const errors:Record<string,string>={timeout:'辨識等待已超過5分鐘上限，未採用部分結果；可人工填寫，或確認費用後重新辨識',submission_unknown:'辨識提交結果未確認，未自動重送；請稍後檢查狀態，或改為人工填寫',upstream:'AI服務未完成辨識，未採用部分結果；可人工填寫',format:'AI回傳內容不完整，未採用部分結果；可人工填寫',timeout_unconfirmed:'辨識等待已超過5分鐘，停止上游處理尚未確認；未採用結果，不會自動重送，請改人工填寫或先由總部確認',expired:'舊辨識沒有可取回結果，請人工填寫或明確重新辨識'};
const jobView=(j:Job)=>({id:j.id,fileId:j.file_id,pageIndex:j.page_index,status:j.status,createdAt:j.created_at,deadlineAt:j.deadline_at,error:j.error_code?errors[j.error_code]||errors.upstream:null});
export class RecognitionError extends Error {constructor(message:string,public status=400){super(message);}}
const fail=(m:string,s=400):never=>{throw new RecognitionError(m,s);};
export function orderRecognitionPayload(image:string,detailImages:string[]){
 const prompt=FULL_EXTRACTION_PROMPT.replace('本次僅處理使用者確認全為虛構個資的測試單。','本次處理由公司授權的完整訂購單。').replace('測試客戶姓名電話地址','客戶姓名電話地址')+CODED_GROUP_PROMPT+MULTIVIEW_PROMPT;
 return {model:ORDER_AI_MODEL,store:false,max_output_tokens:16000,reasoning:{effort:'high'},input:[{role:'system',content:prompt},{role:'user',content:[{type:'input_text',text:'逐欄抄錄這張已由公司授權的完整訂購單。'},...[image,...detailImages].map(image_url=>({type:'input_image',image_url,detail:'original'}))]}],text:{format:{type:'json_schema',name:'store_order_full',strict:true,schema:FULL_EXTRACTION_SCHEMA}}};
}
export function parseOrderRecognition(data:any){
 if(data?.status!=='completed')fail(data?.incomplete_details?.reason==='max_output_tokens'?'AI未完成辨識，未採用部分結果；請重拍或改為人工輸入':'AI辨識中止，未採用部分結果',502);
 const content=(data.output||[]).filter((m:any)=>m.type==='message').flatMap((m:any)=>m.content||[]);
 if(content.some((c:any)=>c.type==='refusal'))fail('AI無法辨識，請改為人工輸入',502);
 let extraction;try{extraction=validateExtraction(JSON.parse(content.filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('')));}catch{fail('AI回傳資料不完整，未採用部分結果',502);}
 if(!extraction?.header)fail('AI完整單缺少表頭，未採用部分結果',502);return extraction;
}
const hash=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
// Start at most once. A lost submission acknowledgement never causes an automatic POST retry.
export async function recognizeStoreOrder(env:AIEnv,body:any,context:Context){
 if(!env.OPENAI_API_KEY)fail('公司辨識服務尚未設定',503);
 const page=body.pageIndex??0;
 if(body?.consent!==true||body?.mode!=='full'||!Array.isArray(body.detailImages)||body.detailImages.length!==3||!Number.isSafeInteger(page)||page<0||page>29||!(/^[A-Za-z0-9-]{8,80}$/).test(body.operationId||'')||Object.keys(body).some(k=>!['storeCode','fileId','operationId','pageIndex','mode','consent','image','detailImages'].includes(k)))fail('請確認完整單預覽與公司資料傳送授權後再辨識');
 try{inspectInputs(body.image,body.detailImages,{mode:'full'});}catch{fail('圖片格式或尺寸不符，請重新產生完整單預覽');}await context.validateSource();
 const requestHash=await hash(JSON.stringify({fileId:context.fileId,store:context.storeCode,page,image:body.image,details:body.detailImages,model:ORDER_AI_MODEL})),at=new Date().toISOString();
 const prior=await env.DB.prepare('SELECT * FROM store_order_recognitions WHERE id=?').bind(body.operationId).first<Job>();
 if(prior){if(prior.request_hash!==requestHash||prior.actor!==context.actor||prior.store_code!==context.storeCode)fail('辨識操作識別已使用，請重新開啟訂單',409);return {version:VERSION,job:jobView(prior)};}
 const deadline=new Date(Date.now()+RECOGNITION_LIMIT_MS).toISOString();
 const admitted=await env.DB.prepare(`INSERT OR IGNORE INTO store_order_recognitions(id,store_code,file_id,actor,request_hash,status,business_day,created_at,updated_at,lock_until,deadline_at,page_index) SELECT ?,?,?,?,?,'processing',?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM store_order_recognitions WHERE store_code=? AND business_day=?)<60 AND NOT EXISTS(SELECT 1 FROM store_order_recognitions WHERE (store_code=? OR actor=?) AND status='processing' AND lock_until>?)`).bind(body.operationId,context.storeCode,context.fileId,context.actor,requestHash,taipeiDate(),at,at,new Date(Date.now()+360000).toISOString(),deadline,page,context.storeCode,taipeiDate(),context.storeCode,context.actor,at).run();
 if(!admitted.meta.changes)fail('此門市正在辨識或已達每日辨識額度，請先檢查辨識狀態',429);
 try{
  const payload={...orderRecognitionPayload(body.image,body.detailImages),background:true};
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.OPENAI_API_KEY}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
  if(!response.ok){await response.body?.cancel();fail(response.status===429?'公司AI額度或流量不足，請稍後重試':'公司AI服務未接受辨識，請人工填寫或稍後明確重試',503);}
  const data:any=await response.json();
  if(!/^resp_[A-Za-z0-9_-]{1,200}$/.test(data?.id||''))fail('辨識提交回應不完整，未自動重送；請人工填寫',502);
  await env.DB.prepare("UPDATE store_order_recognitions SET upstream_id=?,updated_at=? WHERE id=? AND status='processing'").bind(data.id,new Date().toISOString(),body.operationId).run();
  return {version:VERSION,job:{id:body.operationId,fileId:context.fileId,pageIndex:page,status:'processing',createdAt:at,deadlineAt:deadline,error:null}};
 }catch(error){
  await env.DB.prepare("UPDATE store_order_recognitions SET status='failed',error_code='submission_unknown',updated_at=?,lock_until=NULL WHERE id=? AND status='processing' AND upstream_id IS NULL").bind(new Date().toISOString(),body.operationId).run();
  if(error instanceof RecognitionError)throw error;fail(errors.submission_unknown,503);
 }
}
export async function advanceRecognition(env:AIEnv,id:string,storage:RecognitionStorage){
 let job=await env.DB.prepare('SELECT * FROM store_order_recognitions WHERE id=?').bind(id).first<Job>();
 if(!job||job.status!=='processing')return;
 const at=new Date().toISOString();
 if(!job.upstream_id){if(Date.now()-Date.parse(job.created_at)>40000)await env.DB.prepare("UPDATE store_order_recognitions SET status='failed',error_code='submission_unknown',lock_until=NULL,updated_at=? WHERE id=? AND status='processing' AND upstream_id IS NULL").bind(at,id).run();return;}
 const lease=await env.DB.prepare("UPDATE store_order_recognitions SET poll_until=? WHERE id=? AND status='processing' AND (poll_until IS NULL OR poll_until<?)").bind(new Date(Date.now()+45000).toISOString(),id,at).run();
 if(!lease.meta.changes)return;
 try{
  const r=await fetch('https://api.openai.com/v1/responses/'+encodeURIComponent(job.upstream_id),{headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(10000)});
  if(!r.ok){await r.body?.cancel();if(r.status===404&&Date.now()-Date.parse(job.created_at)>600000)await failed('expired');return;}
  const data:any=await r.json();
  if(data.id!==job.upstream_id)fail('辨識回應識別不同，未採用結果',502);
  if(['queued','in_progress'].includes(data.status)){
   if(Date.now()>=Date.parse(job.deadline_at||job.created_at)){
    let cancelled=false;try{const cancel=await fetch('https://api.openai.com/v1/responses/'+encodeURIComponent(job.upstream_id)+'/cancel',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(10000)});cancelled=cancel.ok;await cancel.body?.cancel();}catch{/* Cancellation is best effort; never claim upstream stopped without acknowledgement. */}
    await failed(cancelled?'timeout':'timeout_unconfirmed');
   }
   return;
  }
  if(data.status==='completed'&&Number(data.completed_at)>0&&Number(data.completed_at)*1000>Date.parse(job.deadline_at||job.created_at)){await failed('timeout');return;}
  if(data.status!=='completed'){await failed('upstream');return;}
  let extraction;try{extraction=parseOrderRecognition(data);}catch{await failed('format');return;}
  // Preserve the model/prompt/settings used by this deployment; no source image enters D1.
  const payload=orderRecognitionPayload('',[]),result={version:VERSION,model:ORDER_AI_MODEL,extraction,recognition:{...recognitionRecord(payload,data,{}),mode:'full',authorization:'company-approved-full-order',jobId:id,background:true,at:job.created_at}};
  const saved=await storage.save(id,result);
  await env.DB.prepare("UPDATE store_order_recognitions SET status='completed',result_drive_id=?,result_file_hash=?,result_hash=?,updated_at=?,lock_until=NULL,error_code=NULL WHERE id=? AND status='processing'").bind(saved.id,saved.hash,await hash(JSON.stringify(extraction)),new Date().toISOString(),id).run();
 }finally{await env.DB.prepare('UPDATE store_order_recognitions SET poll_until=NULL WHERE id=?').bind(id).run();}
 async function failed(code:string){await env.DB.prepare("UPDATE store_order_recognitions SET status='failed',error_code=?,updated_at=?,lock_until=NULL WHERE id=? AND status='processing'").bind(code,new Date().toISOString(),id).run();}
}
export async function recognitionStatus(env:AIEnv,id:string,context:Context){
 const job=await env.DB.prepare('SELECT * FROM store_order_recognitions WHERE id=?').bind(id).first<Job>();
 if(!job||job.actor!==context.actor||job.store_code!==context.storeCode||job.file_id!==context.fileId)fail('無權讀取此辨識作業',403);
 await context.validateSource();
 await advanceRecognition(env,id,context.storage);
 const latest=(await env.DB.prepare('SELECT * FROM store_order_recognitions WHERE id=?').bind(id).first<Job>())!;
 let result:any;
 if(latest.status==='completed'){
  if(!latest.result_drive_id||!latest.result_file_hash)return {version:VERSION,job:{...jobView(latest),status:'failed',error:errors.expired}};
  result=await context.storage.load(latest.result_drive_id);
  if(await hash(JSON.stringify(result))!==latest.result_file_hash||result.recognition?.jobId!==id)fail('雲端辨識結果無法驗證，未套用資料，請由總部核對',409);
  validateExtraction(result.extraction);
 }
 return {version:VERSION,job:jobView(latest),...(result?{result}:{} )};
}

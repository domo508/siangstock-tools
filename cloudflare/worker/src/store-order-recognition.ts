import { FULL_EXTRACTION_SCHEMA, FULL_EXTRACTION_PROMPT, CODED_GROUP_PROMPT, validateExtraction } from '../../../store-orders/recognition.js';
import { inspectInputs, MULTIVIEW_PROMPT, recognitionRecord } from '../../scripts/store-orders-image-request.mjs';
import { taipeiDate, VERSION } from '../../../store-orders/core.js';
export const ORDER_AI_MODEL='gpt-6.1-sol';
type AIEnv={DB:D1Database;OPENAI_API_KEY?:string};
type Context={actor:string;storeCode:string;fileId:string;validateSource:()=>Promise<void>};
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
export async function recognizeStoreOrder(env:AIEnv,body:any,context:Context){
 if(!env.OPENAI_API_KEY)fail('公司辨識服務尚未設定',503);
 if(body?.consent!==true||body?.mode!=='full'||!Array.isArray(body.detailImages)||body.detailImages.length!==3||!(/^[A-Za-z0-9-]{8,80}$/).test(body.operationId||'')||Object.keys(body).some(k=>!['storeCode','fileId','operationId','mode','consent','image','detailImages'].includes(k)))fail('請確認完整單預覽與公司資料傳送授權後再辨識');
 let inputs;try{inputs=inspectInputs(body.image,body.detailImages,{mode:'full'});}catch{fail('圖片格式或尺寸不符，請重新產生完整單預覽');}await context.validateSource();
 const requestHash=await hash(JSON.stringify({fileId:context.fileId,store:context.storeCode,image:body.image,details:body.detailImages,model:ORDER_AI_MODEL})),at=new Date().toISOString();
 const prior=await env.DB.prepare('SELECT request_hash,actor,status FROM store_order_recognitions WHERE id=?').bind(body.operationId).first<{request_hash:string;actor:string;status:string}>();
 if(prior){if(prior.request_hash!==requestHash||prior.actor!==context.actor)fail('辨識操作識別已使用，請重新開啟訂單',409);fail(prior.status==='processing'?'辨識仍在處理，請勿重複傳送':'本次辨識已執行，請先檢查覆核內容；如需再辨識請明確建立新操作，會另計API費用',409);}
 const admitted=await env.DB.prepare(`INSERT OR IGNORE INTO store_order_recognitions(id,store_code,file_id,actor,request_hash,status,business_day,created_at,updated_at,lock_until) SELECT ?,?,?,?,?,'processing',?,?,?,? WHERE (SELECT COUNT(*) FROM store_order_recognitions WHERE store_code=? AND business_day=?)<60 AND NOT EXISTS(SELECT 1 FROM store_order_recognitions WHERE (store_code=? OR actor=?) AND status='processing' AND lock_until>?)`).bind(body.operationId,context.storeCode,context.fileId,context.actor,requestHash,taipeiDate(),at,at,new Date(Date.now()+240000).toISOString(),context.storeCode,taipeiDate(),context.storeCode,context.actor,at).run();
 if(!admitted.meta.changes)fail('此門市正在辨識或已達每日辨識額度，請稍後或改由人工覆核',429);
 try{
  const payload=orderRecognitionPayload(body.image,body.detailImages),response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.OPENAI_API_KEY}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(180000)});
  if(!response.ok){await response.body?.cancel();fail(response.status===429?'公司AI額度或流量不足，請稍後重試':'公司AI服務暫時無法完成辨識，請改由人工覆核',503);}
  const data:any=await response.json(),extraction=parseOrderRecognition(data),record={...recognitionRecord(payload,data,inputs),mode:'full',authorization:'company-approved-full-order',jobId:body.operationId};
  await env.DB.prepare("UPDATE store_order_recognitions SET status='completed',result_hash=?,updated_at=?,lock_until=NULL WHERE id=? AND status='processing'").bind(await hash(JSON.stringify(extraction)),new Date().toISOString(),body.operationId).run();
  return {version:VERSION,model:ORDER_AI_MODEL,extraction,recognition:record};
 }catch(error){await env.DB.prepare("UPDATE store_order_recognitions SET status='failed',updated_at=?,lock_until=NULL WHERE id=? AND status='processing'").bind(new Date().toISOString(),body.operationId).run();if(error instanceof RecognitionError)throw error;fail('辨識未確認完成，未自動重送；請先檢查覆核內容後再決定是否重新辨識',503);}
}

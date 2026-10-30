// Local-only deidentified image evaluation. Never deployed with the Worker.
import http from "node:http";
import {readFile,realpath} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {VERSION} from "../../store-orders/core.js";
import {EXTRACTION_SCHEMA,EXTRACTION_PROMPT,FULL_EXTRACTION_SCHEMA,FULL_EXTRACTION_PROMPT,CODED_GROUP_PROMPT,validateExtraction} from "../../store-orders/recognition.js";
import {MULTIVIEW_PROMPT,inspectInputs,recognitionRecord} from "./store-orders-image-request.mjs";
export function responsePayload(image,model,{mode="table",detailImages=[]}={}){return {model,store:false,max_output_tokens:16000,...(["gpt-5.4","gpt-6.1-sol"].includes(model)?{reasoning:{effort:"high"}}:{}),input:[{role:"system",content:(mode==="full"?FULL_EXTRACTION_PROMPT:EXTRACTION_PROMPT)+CODED_GROUP_PROMPT+(detailImages.length?MULTIVIEW_PROMPT:"之後仍須人工核對。")},{role:"user",content:[{type:"input_text",text:mode==="full"?"抄錄這張全為虛構個資的完整測試單。":"抄錄這一張已由使用者檢查去識別化的商品表格。"},{type:"input_image",image_url:image,detail:["gpt-5.4","gpt-6.1-sol"].includes(model)?"original":"high"},...detailImages.map((image_url,i)=>({type:"input_image",image_url,detail:["gpt-5.4","gpt-6.1-sol"].includes(model)?"original":"high"}))]}],text:{format:{type:"json_schema",name:mode==="full"?"synthetic_full_order":"store_order_table",strict:true,schema:mode==="full"?FULL_EXTRACTION_SCHEMA:EXTRACTION_SCHEMA}}};}
export function parseAIResponse(body,{mode="table"}={}){if(body.status!=="completed"){
 const reason=body.incomplete_details?.reason;
 const error=Error(reason==="max_output_tokens"?"AI辨識用完本次輸出額度，結果尚未完整；未採用部分結果。請縮小商品區或拆成較少列後再試。":reason==="content_filter"?"AI辨識受到內容限制而中止，未採用部分結果；請檢查商品區或改由人工輸入。":"AI回應尚未完成或已中止，未採用部分結果；請稍後再試。");
 error.code=reason==="max_output_tokens"?"ai_output_limit":reason==="content_filter"?"ai_content_filter":"ai_incomplete";throw error;
 }const content=(body.output||[]).filter(x=>x.type==="message").flatMap(x=>x.content||[]);if(content.some(x=>x.type==="refusal"))throw Error("AI拒絕處理，請人工輸入");const result=content.filter(x=>x.type==="output_text").map(x=>x.text).join("");const parsed=validateExtraction(JSON.parse(result));if((mode==="full")!==Object.hasOwn(parsed,"header"))throw Error("辨識回傳模式不符，未採用結果");return parsed;}
export function createValidationServer({key=process.env.OPENAI_API_KEY,model=process.env.STORE_ORDERS_AI_MODEL,port=8770,fetcher=fetch}={}){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");let busy=false;
 return http.createServer(async(req,res)=>{
  const origin=`http://127.0.0.1:${port}`;const send=(status,data)=>{res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(JSON.stringify(data));};
  if(req.headers.host!==`127.0.0.1:${port}`){send(403,{error:"只接受本機連線"});return;}
  const url=new URL(req.url,origin);
  if(url.pathname==="/api/store-orders-validation/config"&&req.method==="GET"){send(200,{version:VERSION,ready:!!key&&!!model,model:model||"",provider:"OpenAI"});return;}
  if(url.pathname==="/api/store-orders-validation/recognize"&&req.method==="POST"){
   if(req.headers.origin!==origin||!/^application\/json(?:;|$)/.test(req.headers["content-type"]||"")){send(403,{error:"僅接受本機驗證頁送出"});return;}
   if(req.headers["x-store-orders-version"]!==VERSION){send(409,{error:"請重新載入最新版"});return;}
   if(!key||!model){send(503,{error:"本機尚未設定OpenAI金鑰與辨識模型"});return;}
   if(busy){send(409,{error:"已有辨識進行中，請勿重複送出"});return;}
   busy=true;
   try{
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>24000000)throw Error("圖片過大，請重拍或降低相片尺寸");chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks));
    const mode=body.mode||"table";
    if(!["table","full"].includes(mode)||Object.keys(body).some(k=>!["image","mode","deidentifiedConfirmed","syntheticHeaderConfirmed","detailImages"].includes(k))||(mode==="full"?body.syntheticHeaderConfirmed!==true:body.deidentifiedConfirmed!==true)||typeof body.image!=="string")throw Error("請先確認商品區去識別化，或確認完整測試單所有個資均為虛構，再送出");
    const inputs=inspectInputs(body.image,body.detailImages,{mode});
    const payload=responsePayload(body.image,model,{mode,detailImages:body.detailImages});
    const response=await fetcher("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(240000)});
    if(!response.ok){send(502,{error:`OpenAI辨識未成功（HTTP ${response.status}），請確認模型、額度與權限；未自動重試`});return;}
    const data=await response.json();send(200,{extraction:parseAIResponse(data,{mode}),model,recognition:recognitionRecord(payload,data,inputs),usage:data.usage?{input_tokens:data.usage.input_tokens,output_tokens:data.usage.output_tokens}:null});
   }catch(e){send(e.code?.startsWith("ai_")?502:400,{...(e.code?.startsWith("ai_")?{code:e.code}:{}),error:e.name==="TimeoutError"?"辨識逾時，請先確認使用紀錄再重試":/^(請|圖片|辨識|AI)/.test(e.message)?e.message:"辨識未完成或格式錯誤，未採用結果"});}finally{busy=false;}return;
  }
  if(req.method!=="GET"&&req.method!=="HEAD"){send(405,{error:"不支援此操作"});return;}
  let name;try{name=decodeURIComponent(url.pathname);}catch{send(400,{error:"網址格式錯誤"});return;}
  if(name==="/")name="/store-orders/validation.html";
  if(name.endsWith("/"))name+="index.html";
  const allowed=name==="/site.css"||name==="/inventory/assets/xlsx.full.min.js"||name.startsWith("/store-orders/");
  const types={".html":"text/html; charset=utf-8",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",".json":"application/json",".wasm":"application/wasm",".png":"image/png",".gz":"application/gzip",".traineddata":"application/octet-stream",".bcmap":"application/octet-stream",".pfb":"application/octet-stream",".ttf":"font/ttf"};
  if(!allowed||!types[path.extname(name)]){send(404,{error:"無此測試資源"});return;}
  try{const target=await realpath(path.join(root,name));if(!target.startsWith(root+path.sep)||name.includes(".."))throw Error();const bytes=await readFile(target);res.writeHead(200,{"Content-Type":types[path.extname(name)],"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com; connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://openidconnect.googleapis.com https://www.googleapis.com; img-src 'self' blob: data:; style-src 'self'; worker-src 'self' blob:; frame-src https://accounts.google.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});res.end(req.method==="HEAD"?undefined:bytes);}catch{send(404,{error:"無此測試資源"});}
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const server=createValidationServer();server.listen(8770,"127.0.0.1",()=>console.log("去識別化驗證：http://127.0.0.1:8770/store-orders/validation.html（金鑰只讀取本機環境，未設定時不呼叫API）"));}

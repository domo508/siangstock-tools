import { RequestValidationError } from './schema';
export const CANDIDATE_VERSION='20261123-prepurchase-r4';
type Env={DB:D1Database};
// Exclude one-off custom SA/SB and every O-prefixed combination SKU; retain history.
export function isCustomCandidateSku(value:unknown){return /^(?:SA|SB|O)/.test(String(value??'').normalize('NFKC').trim().toUpperCase());}
function fail(message:string,status=400):never{throw new RequestValidationError(message,status);}
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))fail('新品候選資料格式錯誤。');return v as Record<string,unknown>;}
function text(v:unknown,max:number){if(typeof v!=='string'||!v.trim()||v.length>max)fail('新品候選文字格式錯誤。');return v.normalize('NFKC').trim();}
function date(v:unknown,optional=false){if(optional&&v==='')return '';const s=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s||s<'1900-01-01')fail('新增日期無效。');return s;}
function rows(v:unknown,baseline=false){if(!Array.isArray(v)||v.length>30000||!v.length)fail('商品主檔須有1至30000筆完整品號。');const seen=new Set<string>();return v.map(x=>{const r=obj(x),sku=text(r.sku,80).toUpperCase();if(seen.has(sku))fail(sku+'主檔重複，請修正後再比對。');seen.add(sku);return baseline?{sku,createdDate:''}:{sku,name:text(r.name,300),createdDate:date(r.createdDate,true)};});}
export async function candidateRoute(request:Request,env:Env,who:{role:string;email:string}){
 if(!['hq','admin'].includes(who.role))fail('只有總部可以查看或確認下採前新品候選。',403);
 const state=await env.DB.prepare('SELECT * FROM new_product_master_state WHERE id=1').first<{revision:number;source_hash:string;source_at:string}>();if(!state)fail('新品候選設定尚未完成。',503);
 const read=async()=>{const stored=(await env.DB.prepare(`SELECT c.*,
 CASE WHEN EXISTS(SELECT 1 FROM new_product_registry g WHERE g.sku=c.sku) THEN 'procurement'
 WHEN c.first_stock_date IS NOT NULL OR EXISTS(SELECT 1 FROM procurement_batch_items i WHERE i.sku=c.sku AND i.received_quantity>0) THEN 'arrived' ELSE c.status END effective_status
 FROM new_product_candidates c ORDER BY c.created_date DESC,c.sku`).all<Record<string,unknown>>()).results;
 return {version:CANDIDATE_VERSION,revision:state.revision,sourceAt:state.source_at,excludedCustomCount:stored.filter(r=>isCustomCandidateSku(r.sku)).length,rows:stored.filter(r=>!isCustomCandidateSku(r.sku))};};
 if(request.method==='GET')return Response.json(await read(),{headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')fail('新品候選操作不存在。',404);
 if(request.headers.get('X-New-Candidate-Version')!==CANDIDATE_VERSION)fail('新品候選已有新版，請重新載入最新版。',409);
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))fail('請使用JSON資料。',415);
 const raw=await request.text();if(new TextEncoder().encode(raw).length>5000000)fail('主檔衍生資料過大。',413);
 let body:Record<string,unknown>;try{body=obj(JSON.parse(raw));}catch{fail('新品候選JSON無效。');}
 const revision=body.expectedRevision;if(!Number.isSafeInteger(revision)||revision!==state.revision)fail('新品候選已由其他同仁更新，請保留選擇並重新讀取比對。',409);
 const now=new Date().toISOString(),today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}),stmts:D1PreparedStatement[]=[];
 // A CHECK failure rolls the entire D1 batch back, including the audit event.
 stmts.push(env.DB.prepare('UPDATE new_product_master_state SET revision=CASE WHEN revision=? THEN revision+1 ELSE 0 END,updated_at=? WHERE id=1').bind(revision,now));
 if(body.action==='scan'){
 const current=rows(body.current),baseline=rows(body.baseline,true),hash=text(body.sourceHash,64),sourceAt=text(body.sourceAt,30);
 if(!/^[a-f0-9]{64}$/.test(hash)||!Number.isFinite(Date.parse(sourceAt))||Date.parse(sourceAt)>Date.now())fail('主檔版本無效。');
 if(state.source_at&&Date.parse(sourceAt)<Date.parse(state.source_at))fail('主檔比已比對的版本舊，請重新取得最新主檔。',409);
 if(hash===state.source_hash)return Response.json({unchanged:true,revision:state.revision});
 if(state.source_at&&sourceAt===state.source_at)fail('相同來源時間但內容不同，請重新確認主檔版本。',409);
 const floor=new Date(Date.parse(today+'T00:00:00Z')-90*86400000).toISOString().slice(0,10);
 const input=JSON.stringify(current),eligibleInput=JSON.stringify(current.filter(r=>!isCustomCandidateSku(r.sku))),old=JSON.stringify(baseline);
 stmts.push(env.DB.prepare(`INSERT INTO new_product_master_seen SELECT json_extract(value,'$.sku'),'',? FROM json_each(?) WHERE 1 ON CONFLICT(sku) DO NOTHING`).bind(now,old));
 stmts.push(env.DB.prepare(`INSERT INTO new_product_candidates(sku,name,created_date,updated_at,updated_by)
 SELECT json_extract(j.value,'$.sku'),json_extract(j.value,'$.name'),json_extract(j.value,'$.createdDate'),?,? FROM json_each(?) j
 WHERE json_extract(j.value,'$.createdDate') BETWEEN ? AND ? AND NOT EXISTS(SELECT 1 FROM new_product_master_seen s WHERE s.sku=json_extract(j.value,'$.sku'))
 AND NOT EXISTS(SELECT 1 FROM new_product_registry g WHERE g.sku=json_extract(j.value,'$.sku'))
 AND NOT EXISTS(SELECT 1 FROM procurement_batch_items i WHERE i.sku=json_extract(j.value,'$.sku') AND i.received_quantity>0)
 ON CONFLICT(sku) DO NOTHING`).bind(now,who.email,eligibleInput,floor,today));
 // Defer the candidate FK until transaction end via inserting seen first is not possible:
 // candidates reference new SKUs, so migration uses a deferred FK.
 stmts.push(env.DB.prepare(`INSERT INTO new_product_master_seen SELECT json_extract(value,'$.sku'),json_extract(value,'$.createdDate'),? FROM json_each(?) WHERE 1 ON CONFLICT(sku) DO NOTHING`).bind(now,input));
 stmts.push(env.DB.prepare('UPDATE new_product_master_state SET source_hash=?,source_at=? WHERE id=1').bind(hash,sourceAt));
 stmts.push(env.DB.prepare("INSERT INTO new_product_candidate_events(action,payload,created_at,created_by) VALUES('scan',?,?,?)").bind(JSON.stringify({sourceHash:hash,sourceAt,current:current.length,baseline:baseline.length}),now,who.email));
 }else if(body.action==='decide'){
 if(!['prelaunch','ordinary'].includes(String(body.status)))fail('請選待上市／尚未首到或一般商品。');
 if(!Array.isArray(body.skus)||!body.skus.length||body.skus.length>1000)fail('請選1至1000個新品候選。');
 const skus=body.skus.map(s=>text(s,80).toUpperCase());if(skus.some(isCustomCandidateSku))fail('SA／SB開頭客製品號及O開頭組合貨號不列新品候選，整批未保存。');if(new Set(skus).size!==skus.length)fail('新品候選重複。');
 const selected=await env.DB.prepare(`SELECT c.* FROM new_product_candidates c WHERE c.sku IN(SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM new_product_registry g WHERE g.sku=c.sku) AND c.first_stock_date IS NULL AND NOT EXISTS(SELECT 1 FROM procurement_batch_items i WHERE i.sku=c.sku AND i.received_quantity>0)`).bind(JSON.stringify(skus)).all();
 if(selected.results.length!==skus.length)fail('候選已到貨或已由採購流程接手，請重新讀取；未變更任何品項。',409);
 stmts.push(env.DB.prepare('UPDATE new_product_candidates SET status=?,updated_at=?,updated_by=? WHERE sku IN(SELECT value FROM json_each(?))').bind(body.status,now,who.email,JSON.stringify(skus)));
 stmts.push(env.DB.prepare("INSERT INTO new_product_candidate_events(action,payload,created_at,created_by) VALUES('decide',?,?,?)").bind(JSON.stringify({status:body.status,skus}),now,who.email));
 }else fail('新品候選操作無效。');
 try{await env.DB.batch(stmts);}catch(e){if(/CHECK constraint|candidate_lifecycle_conflict/.test(String(e)))fail('新品候選已更新，請重新讀取比對。',409);throw e;}
 return Response.json({revision:Number(revision)+1},{headers:{'Cache-Control':'no-store'}});
}

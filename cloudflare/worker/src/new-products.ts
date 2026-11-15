import { newProductNoticeStatements, sendNewProductNotices } from './new-product-notifications';
import { RequestValidationError } from './schema';
type Env = { DB:D1Database };
type Who = {email:string;role:string;storeCode:string|null};
export const NEW_PRODUCT_VERSION='20261116-new-product-allocation-r3';
export const NEW_PRODUCT_STORES=['R00','R01','R03','R06','R07','R10'];
function fail(message:string,status=400):never{throw new RequestValidationError(message,status);}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))fail('新品首配資料格式錯誤。');return v as Record<string,unknown>;}
function str(v:unknown,label:string,max=300){const s=String(v??'').normalize('NFKC').trim();if(!s||s.length>max)fail(`${label}格式錯誤。`);return s;}
function qty(v:unknown){if(v===null||v===''||typeof v==='boolean')fail('新品數量須為0以上整數。');const n=Number(v);if(!Number.isSafeInteger(n)||n<0||n>100000)fail('新品數量須為0以上整數。');return n;}
function date(v:unknown){const s=str(v,'新品上市日',10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||(!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s))fail('新品上市日格式錯誤。');return s;}
function reply(v:unknown,status=200){return Response.json(v,{status,headers:{'Cache-Control':'no-store'}});}
export function newProductSeedStatements(env:Env,batchId:string,value:unknown,approvedItems:{sku:string;quantity:number}[],actor:string,now:string){
 if(value==null)return [];
 if(!Array.isArray(value)||value.length>1000)fail('新品首配來源筆數錯誤。');
 const seen=new Set<string>(),statements:D1PreparedStatement[]=[];
 const normalized=value.map(raw=>{const r=object(raw),sku=str(r.sku,'ERP品號',80).toUpperCase();if(seen.has(sku))fail(`${sku}新品來源重複。`);seen.add(sku);if(!approvedItems.some(i=>i.sku===sku))fail(`${sku}不在本批核准採購品項。`);
 const stores=object(r.stores),keys=Object.keys(stores);if(keys.some(k=>!NEW_PRODUCT_STORES.includes(k)))fail('新品指定門市無效。');
 return {sku,name:str(r.name,'新品品名'),listedDate:date(r.listedDate),evidence:str(r.evidence,'首配估算依據',500),stores:Object.fromEntries(keys.map(k=>[k,qty(stores[k])])),dailyByStore:Object.fromEntries(keys.map(k=>{const v=Number(r.dailyByStore==null?0:object(r.dailyByStore)[k]||0);if(!Number.isFinite(v)||v<0||v>100000)fail("新品日需求參考格式錯誤。");return [k,v];}))};});
 const rows=normalized.flatMap(r=>Object.entries(r.stores).map(([storeCode,quantity])=>({...r,storeCode,quantity,referenceDaily:r.dailyByStore[storeCode]})));
 if(!rows.length)return [];
 const id=`NP-${batchId}`;
 const payload=JSON.stringify(rows);
 statements.push(env.DB.prepare(`INSERT INTO new_product_plans(id,procurement_batch_id,created_at,updated_at,updated_by)
 SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM new_product_plan_rows r WHERE r.sku=json_extract(j.value,'$.sku') AND r.store_code=json_extract(j.value,'$.storeCode')))` ).bind(id,batchId,now,now,actor,payload));
 statements.push(env.DB.prepare(`INSERT INTO new_product_registry(sku,name,listed_date,registered_at,registered_by)
 SELECT json_extract(value,'$.sku'),json_extract(value,'$.name'),json_extract(value,'$.listedDate'),?,? FROM json_each(?) WHERE 1 ON CONFLICT(sku) DO NOTHING`).bind(now,actor,JSON.stringify(normalized)));
 statements.push(env.DB.prepare(`INSERT INTO new_product_plan_rows(plan_id,store_code,sku,name,suggested_quantity,evidence,reference_daily)
 SELECT ?,json_extract(j.value,'$.storeCode'),json_extract(j.value,'$.sku'),json_extract(j.value,'$.name'),json_extract(j.value,'$.quantity'),json_extract(j.value,'$.evidence'),json_extract(j.value,'$.referenceDaily') FROM json_each(?) j
 WHERE EXISTS(SELECT 1 FROM new_product_plans WHERE id=?) AND NOT EXISTS(SELECT 1 FROM new_product_plan_rows r WHERE r.sku=json_extract(j.value,'$.sku') AND r.store_code=json_extract(j.value,'$.storeCode'))`).bind(id,payload,id));
 statements.push(env.DB.prepare('INSERT INTO new_product_store_status(plan_id,store_code) SELECT DISTINCT plan_id,store_code FROM new_product_plan_rows WHERE plan_id=?').bind(id));
 statements.push(env.DB.prepare("INSERT INTO new_product_events(plan_id,action,payload,created_at,created_by) SELECT ?,'seed',?,?,? WHERE EXISTS(SELECT 1 FROM new_product_plans WHERE id=?)").bind(id,JSON.stringify(normalized),now,actor,id));return statements;
}

export function activateNewProductStatements(env:Env,batchId:string,actor:string,now:string){return [env.DB.prepare("UPDATE new_product_plans SET status='store_confirmation',updated_at=?,updated_by=?,revision=revision+1 WHERE procurement_batch_id=? AND status='pending_purchase' AND EXISTS(SELECT 1 FROM procurement_batches WHERE id=? AND status='approved')").bind(now,actor,batchId,batchId),...newProductNoticeStatements(env,batchId,now)];}
export async function newProductCalculationState(env:Env){
 const rows=await env.DB.prepare(`SELECT r.*,p.revision,p.status,p.updated_at approved_at,b.status purchase_status,g.listed_date,g.first_stock_date,
 r.archived_dispatched_quantity + COALESCE((SELECT SUM(u.quantity) FROM new_product_claim_usage u WHERE u.plan_id=r.plan_id AND u.store_code=r.store_code AND u.sku=r.sku),0) committed_quantity,
 r.archived_dispatched_quantity + COALESCE((SELECT SUM(u.quantity) FROM new_product_claim_usage u WHERE u.plan_id=r.plan_id AND u.store_code=r.store_code AND u.sku=r.sku AND u.erp_created=1),0) dispatched_quantity
 FROM new_product_plan_rows r JOIN new_product_plans p ON p.id=r.plan_id JOIN procurement_batches b ON b.id=p.procurement_batch_id
 JOIN new_product_registry g ON g.sku=r.sku WHERE b.status IN ('pending_approval','approved','erp_created','received')`).all<Record<string,unknown>>();
 const registry=await env.DB.prepare(`SELECT g.sku,g.listed_date,g.first_stock_date FROM new_product_registry g WHERE NOT EXISTS(SELECT 1 FROM new_product_plan_rows r WHERE r.sku=g.sku) OR EXISTS(SELECT 1 FROM new_product_plan_rows r JOIN new_product_plans p ON p.id=r.plan_id JOIN procurement_batches b ON b.id=p.procurement_batch_id WHERE r.sku=g.sku AND b.status IN ('pending_approval','approved','erp_created','received'))`).all<Record<string,unknown>>();
 return {rows:rows.results,registry:registry.results};
}
export async function newProductRoute(request:Request,env:Env,who:Who):Promise<Response>{
 const url=new URL(request.url),path=url.pathname.replace('/api/store-transfer/new-products','');
 if(request.method==='GET'&&path==='/calculation'){if(who.role==='store')fail('僅總部可讀取新品計算資料。',403);return reply(await newProductCalculationState(env));}
 if(request.method==='GET'&&(path===''||path==='/')){
 const rows=await env.DB.prepare(`SELECT p.id,p.revision,p.status,p.procurement_batch_id,p.updated_at,s.store_code,s.status store_status,
 (SELECT COUNT(*) FROM new_product_notifications n WHERE n.plan_id=p.id) notice_total, (SELECT COUNT(*) FROM new_product_notifications n WHERE n.plan_id=p.id AND n.status IN ('sent','not_required')) notice_sent,
 r.sku,r.name,r.suggested_quantity,r.confirmed_quantity,r.approved_quantity,r.store_reason,r.hq_reason,r.evidence,
 (r.archived_dispatched_quantity + (SELECT COALESCE(SUM(u.quantity),0) FROM new_product_claim_usage u WHERE u.plan_id=r.plan_id AND u.store_code=r.store_code AND u.sku=r.sku)) committed_quantity,
 (r.archived_dispatched_quantity + (SELECT COALESCE(SUM(u.quantity),0) FROM new_product_claim_usage u WHERE u.plan_id=r.plan_id AND u.store_code=r.store_code AND u.sku=r.sku AND u.erp_created=1)) dispatched_quantity
 FROM new_product_plans p JOIN procurement_batches b ON b.id=p.procurement_batch_id JOIN new_product_store_status s ON s.plan_id=p.id
 JOIN new_product_plan_rows r ON r.plan_id=p.id AND r.store_code=s.store_code
 WHERE b.status IN ('approved','erp_created','received') AND (?='' OR r.store_code=?) AND (?=0 OR p.status='store_confirmation') ORDER BY p.created_at DESC,p.id,r.store_code,r.sku`).bind(who.storeCode||'',who.storeCode||'',who.role==='store'?1:0).all();return reply({rows:rows.results});}
 if(!['PUT','POST'].includes(request.method))fail('新品操作不存在。',404);
 if(request.headers.get('X-New-Product-Version')!==NEW_PRODUCT_VERSION)fail('新品首配已有新版，請重新載入最新版。',409);
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))fail('Content-Type 必須是 application/json。',415);
 const raw=await request.text();if(new TextEncoder().encode(raw).length>500000)fail('新品首配資料過大。',413);let body:Record<string,unknown>;try{body=object(JSON.parse(raw));}catch{fail('新品首配JSON格式錯誤。');}
 if(path==='/register'||path==='/observe'){if(who.role==='store')fail('只有總部可維護新品來源。',403);return registerNewProducts(env,body,who.email,path==='/observe');}
 const notice=path.match(/^\/([^/]+)\/notifications\/send$/);if(notice){if(who.role==='store')fail('只有總部可重送新品門市通知。',403);const result=await sendNewProductNotices(request,env,decodeURIComponent(notice[1]),who.email);return reply({...result,...(result.remaining?{error:result.errors?.join('；')||'仍有未寄送門市'}:{})},result.remaining?502:200);}
 const match=path.match(/^\/([^/]+)\/(save|submit|approve)$/);if(!match)fail('新品操作不存在。',404);
 const id=decodeURIComponent(match[1]),action=match[2],revision=qty(body.expectedRevision);
 const plan=await env.DB.prepare('SELECT p.*,b.status purchase_status FROM new_product_plans p JOIN procurement_batches b ON b.id=p.procurement_batch_id WHERE p.id=?').bind(id).first<Record<string,unknown>>();
 if(!plan)fail('找不到新品首配批次。',404);if(plan.status!=='store_confirmation'||!['approved','erp_created','received'].includes(String(plan.purchase_status)))fail('本批次不是待覆核的新品需求。',409);if(Number(plan.revision)!==revision)fail('新品首配已由其他同仁更新，請保留輸入並重新讀取比對。',409);
 if(action==='approve'&&who.role==='store')fail('只有總部可以核定新品首配。',403);
 const store=action==='approve'?'':who.storeCode||str(body.storeCode||'','指定門市',5);
 if(action!=='approve'&&!NEW_PRODUCT_STORES.includes(store))fail('新品門市無效。');
 const current=await env.DB.prepare('SELECT * FROM new_product_plan_rows WHERE plan_id=? AND (?=\'\' OR store_code=?)').bind(id,action==='approve'?'':store,action==='approve'?'':store).all<Record<string,unknown>>();
 if(!current.results.length)fail('本店不在指定新品上市門市。',403);
 if(action!=='approve'){const st=await env.DB.prepare('SELECT status FROM new_product_store_status WHERE plan_id=? AND store_code=?').bind(id,store).first<{status:string}>();if(st?.status==='submitted')fail('本店已送出，請由總部處理覆核。',409);}
 if(action==='approve'){const pending=await env.DB.prepare("SELECT COUNT(*) n FROM new_product_store_status WHERE plan_id=? AND status!='submitted'").bind(id).first<{n:number}>();if(pending?.n)fail('仍有門市尚未送出新品確認。',409);}
 if(!Array.isArray(body.items)||body.items.length!==current.results.length)fail('新品完整明細不符；篩選不可縮減送出範圍。');
 const seen=new Set<string>(),updates=body.items.map(raw=>{const r=object(raw),sku=str(r.sku,'ERP品號',80).toUpperCase(),sc=action==='approve'?str(r.storeCode,'門市',5):store,key=`${sc}|${sku}`;if(seen.has(key))fail('新品明細重複。');seen.add(key);const old=current.results.find(x=>x.sku===sku&&x.store_code===sc);if(!old)fail('新品清單包含非指定門市或品項。',403);const n=qty(r.quantity),reason=String(r.reason??'').normalize('NFKC').trim();if(reason.length>500)fail('調整原因過長。');const baseline=Number(action==='approve'?old.confirmed_quantity??old.suggested_quantity:old.suggested_quantity);if(n!==baseline&&!reason)fail(`${sc}／${sku}調整數量需填原因。`);return {sku,storeCode:sc,quantity:n,reason};});
 const now=new Date().toISOString(),stmts=[env.DB.prepare("UPDATE new_product_plans SET revision=CASE WHEN revision=? AND status='store_confirmation' AND EXISTS(SELECT 1 FROM procurement_batches b WHERE b.id=new_product_plans.procurement_batch_id AND b.status IN ('approved','erp_created','received')) THEN revision+1 ELSE 0 END,updated_at=?,updated_by=? WHERE id=?").bind(revision,now,who.email,id)];
 for(const r of updates)stmts.push(env.DB.prepare(`UPDATE new_product_plan_rows SET ${action==='approve'?'approved_quantity=?,hq_reason=?':'confirmed_quantity=?,store_reason=?'} WHERE plan_id=? AND store_code=? AND sku=?`).bind(r.quantity,r.reason,id,r.storeCode,r.sku));
 if(action==='approve')stmts.push(env.DB.prepare("UPDATE new_product_plans SET status='waiting_stock' WHERE id=?").bind(id));
 else stmts.push(env.DB.prepare('UPDATE new_product_store_status SET status=? WHERE plan_id=? AND store_code=?').bind(action==='submit'?'submitted':'saved',id,store));
 if(action==='submit')stmts.push(env.DB.prepare("UPDATE new_product_notifications SET status='not_required',error_summary='門市已完成確認，無需再通知' WHERE plan_id=? AND store_code=? AND status IN ('pending','failed')").bind(id,store));
 stmts.push(env.DB.prepare('INSERT INTO new_product_events(plan_id,action,payload,created_at,created_by) VALUES(?,?,?,?,?)').bind(id,action,JSON.stringify(updates),now,who.email));
 try{await env.DB.batch(stmts);}catch(e){if(/CHECK constraint/.test(String(e)))fail('新品首配已更新，請重新讀取比對，原輸入尚未送出。',409);throw e;}
 return reply({id,revision:revision+1,status:action==='approve'?'waiting_stock':'store_confirmation'});
}
export async function newProductClaimStatements(env:Env,batchId:string,claims:unknown,normalized:{storeCode:string;sku:string;suggested:number;itemType:string}[],reconfirmed=false){
 if(claims==null)claims=[];if(!Array.isArray(claims)||claims.length>5000)fail('新品出貨來源錯誤。');
 const live=await env.DB.prepare(`SELECT p.revision,r.plan_id,r.store_code,r.sku,r.approved_quantity,r.archived_dispatched_quantity,
 (r.archived_dispatched_quantity+(SELECT COALESCE(SUM(u.quantity),0) FROM new_product_claim_usage u WHERE u.plan_id=r.plan_id AND u.store_code=r.store_code AND u.sku=r.sku AND u.erp_created=1)) dispatched,
 (SELECT COALESCE(SUM(u.quantity),0) FROM new_product_claim_usage u WHERE u.plan_id=r.plan_id AND u.store_code=r.store_code AND u.sku=r.sku) used
 FROM new_product_plan_rows r JOIN new_product_plans p ON p.id=r.plan_id JOIN procurement_batches b ON b.id=p.procurement_batch_id
 WHERE p.status='waiting_stock' AND b.status IN ('approved','erp_created','received')`).all<Record<string,unknown>>();
 for(const r of live.results){if(Number(r.approved_quantity)<=Number(r.used)+Number(r.archived_dispatched_quantity))continue;
 const item=normalized.find(i=>i.itemType==='regular'&&i.storeCode===r.store_code&&i.sku===r.sku&&i.suggested>0);
 if(item && !claims.some(c=>{const v=object(c);return v.planId===r.plan_id&&v.storeCode===r.store_code&&v.sku===r.sku&&Number(v.quantity)>0;}))fail(`${r.store_code}／${r.sku}缺少新品首配來源，請以最新版正式補貨重新計算。`,409);
 }

 const seen=new Set<string>(),out:D1PreparedStatement[]=[];
 for(const raw of claims){const r=object(raw),id=str(r.planId,'新品首配批次',100),sc=str(r.storeCode,'門市',5),sku=str(r.sku,'ERP品號',80).toUpperCase(),n=qty(r.quantity),key=`${sc}|${sku}`;if(seen.has(key))fail('新品首配來源重複。');seen.add(key);
 const item=normalized.find(i=>i.storeCode===sc&&i.sku===sku&&i.itemType==='regular');if(!n||!item||n>item.suggested)fail(`${sc}／${sku}新品配量與本次建議不符。`);
 const p=await env.DB.prepare("SELECT p.revision,p.updated_at,r.approved_quantity FROM new_product_plans p JOIN new_product_plan_rows r ON r.plan_id=p.id WHERE p.id=? AND r.store_code=? AND r.sku=? AND p.status='waiting_stock'").bind(id,sc,sku).first<Record<string,unknown>>();if(!p||Number(p.revision)!==Number(r.revision))fail('新品首配來源已變更，請重新計算。',409);
 if(Date.now()-Date.parse(String(p.updated_at))>=14*86400000&&!reconfirmed)fail('新品首配核定已超過14天，請核對本週庫存、銷售及待配量後勾選重新確認。',409);
 out.push(env.DB.prepare("UPDATE new_product_plans SET revision=CASE WHEN revision=? AND status='waiting_stock' THEN revision ELSE 0 END WHERE id=?").bind(p.revision,id));
 out.push(env.DB.prepare('INSERT INTO new_product_transfer_claims(batch_id,plan_id,store_code,sku,quantity) VALUES(?,?,?,?,?)').bind(batchId,id,sc,sku,n));
 }
 // Separate presentation ownership from first-allocation usage: weekly demand above
 // the remaining allocation is still HQ-only, but never enlarges the first pool.
 for(const r of live.results){
  if(Number(r.approved_quantity)<=Number(r.dispatched))continue;
  if(!normalized.some(i=>i.itemType==='regular'&&i.storeCode===r.store_code&&i.sku===r.sku))continue;
  out.push(env.DB.prepare("UPDATE new_product_plans SET revision=CASE WHEN revision=? AND status='waiting_stock' AND EXISTS(SELECT 1 FROM procurement_batches b WHERE b.id=new_product_plans.procurement_batch_id AND b.status IN ('approved','erp_created','received')) THEN revision ELSE 0 END WHERE id=?").bind(r.revision,r.plan_id));
  out.push(env.DB.prepare('INSERT INTO new_product_weekly_items(batch_id,store_code,sku,plan_id,first_approved_quantity,remaining_quantity) VALUES(?,?,?,?,?,?)').bind(batchId,r.store_code,r.sku,r.plan_id,r.approved_quantity,Math.max(0,Number(r.approved_quantity)-Number(r.used)-Number(r.archived_dispatched_quantity))));
 }
 return out;
}

async function registerNewProducts(env:Env,body:Record<string,unknown>,email:string,observe=false){
 if(!Array.isArray(body.items)||body.items.length>1000)fail('新品來源筆數錯誤。');
  const now=new Date().toISOString(),statements:D1PreparedStatement[]=[];
  const seen=new Set<string>();
  const items=body.items.map(raw=>{const r=object(raw),sku=str(r.sku,'新品品號',80).toUpperCase();if(seen.has(sku))fail('新品來源重複。');seen.add(sku);return !observe?{sku,name:str(r.name,'新品品名'),listedDate:date(r.listedDate)}:{sku};});
  if(!observe)statements.push(env.DB.prepare(`INSERT INTO new_product_registry(sku,name,listed_date,registered_at,registered_by) SELECT json_extract(value,'$.sku'),json_extract(value,'$.name'),json_extract(value,'$.listedDate'),?,? FROM json_each(?) WHERE 1 ON CONFLICT(sku) DO NOTHING`).bind(now,email,JSON.stringify(items)));
  else {const observedOn=date(body.observedOn);if(observedOn>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}))fail('庫存觀察日期不可在未來。');statements.push(env.DB.prepare(`UPDATE new_product_registry SET first_stock_seen_at=?,first_stock_date=? WHERE first_stock_seen_at IS NULL AND sku IN(SELECT json_extract(value,'$.sku') FROM json_each(?))`).bind(now,observedOn,JSON.stringify(items)));}
  if(statements.length)await env.DB.batch(statements);return reply({count:statements.length});
}
export async function newProductProcurementSetup(request:Request,env:Env,email:string){
 if(request.method==='GET'){
  const rules=await env.DB.prepare('SELECT payload FROM procurement_rules_current WHERE id=1').first<{payload:string}>();
  if(!rules)fail('新品展示規則尚未取得，請重新讀取。',503);
  const parsed=JSON.parse(rules.payload);if(!parsed.storeInventory)fail('新品展示規則尚未取得。',503);
  const exceptions=await env.DB.prepare('SELECT store_code,sku,display_quantity,enabled FROM store_transfer_display_exceptions WHERE enabled=1').all();
  return reply({storeInventory:parsed.storeInventory,displayExceptions:exceptions.results});
 }
 if(request.headers.get('X-New-Product-Version')!==NEW_PRODUCT_VERSION)fail('新品首配已有新版，請重新載入最新版。',409);
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))fail('Content-Type 必須是 application/json。',415);
 const raw=await request.text();if(new TextEncoder().encode(raw).length>500000)fail('新品來源資料過大。',413);
 let body:Record<string,unknown>;try{body=object(JSON.parse(raw));}catch{fail('新品來源JSON格式錯誤。');}
 return registerNewProducts(env,body,email);
}

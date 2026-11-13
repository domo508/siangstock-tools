import { RequestValidationError } from './schema';
export const ACTIVITY_VERSION = '20261113-procurement-overreceipt-r1';
type Env = { DB: D1Database };
type Hooks = { read: () => Promise<unknown>; write: () => Promise<{email:string}>; origin: () => void; body: () => Promise<Record<string,unknown>> };
const scopes=new Set(['all','puyouma-tencel','puyouma-long-staple','puyouma-no-size','supplier-lirong','supplier-shanglin','supplier-runtai','supplier-taineng']);
function fail(s:string,status=400):never{throw new RequestValidationError(s,status);}
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail('活動設定格式錯誤。');
const text=(v:unknown,n:number)=>typeof v==='string'&&v.trim()&&v.trim().length<=n?v.trim():fail('活動文字欄位不可空白或過長。');
const date=(v:unknown)=>{const s=String(v||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)fail('活動日期無效。');return s;};
const taipei=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
export function activitySettings(raw:unknown,active=false){
 const s=object(raw),name=text(s.name,80),startDate=date(s.startDate),endDate=date(s.endDate),scope=String(s.scope||'all');
 if(endDate<startDate||!scopes.has(scope)||(Date.parse(endDate)-Date.parse(startDate))/86400000>366)fail('活動期間或適用品項範圍無效。');
 if(active&&(endDate<=taipei()||(Date.parse(endDate)-Date.parse(taipei()))/86400000>366))fail('活動須尚未結束，且在未來366天內。');
 const targets=object(s.monthlyTargets),monthlyTargets:Record<string,{amount:number;retailAmount:number|null}>= {};
 for(let m=startDate.slice(0,7);m<=endDate.slice(0,7);){const t=object(targets[m]);if(typeof t.amount!=='number'||!Number.isFinite(t.amount)||t.amount<=0||t.amount>1e12)fail(`${m}整月目標須為正數。`);const retail=t.retailAmount==null?null:t.retailAmount;if(retail!==null&&(typeof retail!=='number'||!Number.isFinite(retail)||retail<0||retail>t.amount))fail(`${m}六店目標不可超過全通路目標。`);monthlyTargets[m]={amount:t.amount,retailAmount:retail as number|null};const d=new Date(m+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);m=d.toISOString().slice(0,7);}
 if(Object.keys(targets).some(k=>!Object.hasOwn(monthlyTargets,k)))fail('活動目標包含期間外月份。');
 return {enabled:true,name,method:'monthly-target',startDate,endDate,scope,monthlyTargets};
}
function record(row:Record<string,unknown>){return {id:String(row.id),revision:Number(row.revision),settings:JSON.parse(String(row.settings)),originParentId:row.origin_parent_id||'',originMonth:row.origin_month||'',transferPlanId:row.transfer_plan_id||'',updatedAt:row.updated_at,updatedBy:row.updated_by,reason:row.change_reason};}
async function legacy(env:Env,row:Record<string,unknown>){
 let bytes:Uint8Array=new Uint8Array();if(row.payload_encoding==='gzip-base64'){const raw=String(row.payload);if(raw.length>10*1024*1024)fail('舊母批次過大，請由原批次確認活動。');bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));const stream=new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));const reader=stream.getReader(),parts:Uint8Array[]=[];let size=0;while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>32*1024*1024){await reader.cancel();fail('舊母批次解壓縮超過限制。');}parts.push(chunk.value);}bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}}
 else if(row.payload_encoding==='json'||row.payload_encoding==='plain-json'||!row.payload_encoding)bytes=new TextEncoder().encode(String(row.payload));else fail('舊母批次編碼不支援。');
 const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(row.payload))))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(row.payload_sha256&&sha!==row.payload_sha256)fail('舊母批次內容驗證失敗。');
 const p=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(p.activeWorkUnit||p.id!==row.id)fail('不是完整母批次。');
 const a=p.baseAnalysis||p.analysis,old=a?.appliedRules?.activityDemand;if(old?.enabled===false||old?.method!=='monthly-target'||old.activityId)return null;
 const s={...old,monthlyTargets:structuredClone(old.monthlyTargets)},draft=p.transferActivityDraft;
 if(draft){s.startDate=draft.startDate;s.endDate=draft.endDate;for(const m of draft.months||[])if(s.monthlyTargets[m.month])s.monthlyTargets[m.month].retailAmount=m.retailTarget;}
 const settings=activitySettings(s);
 const plans=await env.DB.prepare("SELECT id FROM store_transfer_activity_plans WHERE json_extract(source,'$.name')=? AND json_extract(source,'$.scope')=? AND ((json_extract(source,'$.startDate')=? AND json_extract(source,'$.endDate')=?) OR (json_extract(source,'$.startDate')=? AND json_extract(source,'$.endDate')=?))").bind(settings.name,settings.scope,settings.startDate,settings.endDate,old.startDate,old.endDate).all<{id:string}>();
 return {id:`legacy:${row.id}`,revision:0,settings,originParentId:String(row.id),originMonth:String(row.analysis_month),originRevision:Number(row.revision),transferPlanId:plans.results.length===1?plans.results[0].id:'',ambiguousTransfer:plans.results.length>1,updatedAt:row.updated_at,reason:'舊母批次活動，首次保存後成為共用活動'};
}
export async function activityRegistryRoute(request:Request,env:Env,hooks:Hooks):Promise<Response|null>{
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/procurement\/activities(?:\/([^/]+))?$/);if(!match)return null;
 const id=match[1]?decodeURIComponent(match[1]):'';const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(request.method==='GET'){
  await hooks.read();if(id){const row=await env.DB.prepare('SELECT * FROM procurement_activities WHERE id=?').bind(id).first<Record<string,unknown>>();if(!row)fail('找不到共用活動，請重新讀取。',404);const missing=await env.DB.prepare("SELECT COUNT(*) n FROM procurement_batches b WHERE (b.parent_batch_id=? OR EXISTS(SELECT 1 FROM procurement_activity_batches ab WHERE ab.batch_id=b.id AND ab.activity_id=?)) AND b.status='approved' AND (b.erp_reference IS NULL OR b.erp_reference='') AND EXISTS(SELECT 1 FROM procurement_batch_items i WHERE i.batch_id=b.id AND i.approved_quantity>0 AND NOT EXISTS(SELECT 1 FROM procurement_batch_erp_documents d WHERE d.batch_id=b.id AND d.supplier=i.supplier AND d.erp_reference!='' AND d.status='erp_created'))").bind(row.origin_parent_id||"",row.id).first<{n:number}>();const history=await env.DB.prepare('SELECT revision,settings,change_reason,updated_at,updated_by FROM procurement_activity_history WHERE activity_id=? ORDER BY revision DESC LIMIT 20').bind(id).all<Record<string,unknown>>();return reply({activity:{...record(row),unlinkedApprovals:Number(missing?.n||0)},history:history.results.map(h=>({...h,settings:JSON.parse(String(h.settings))}))});}
  const saved=await env.DB.prepare('SELECT * FROM procurement_activities ORDER BY updated_at DESC LIMIT 200').all<Record<string,unknown>>();
  const rows=await env.DB.prepare("SELECT id,analysis_month,payload,payload_encoding,payload_sha256,revision,updated_at FROM procurement_collaboration_drafts WHERE removed_at IS NULL AND (parent_batch_id=id OR parent_batch_id IS NULL OR parent_batch_id='') AND (work_unit_ids='[]' OR work_unit_ids='' OR work_unit_ids IS NULL) AND NOT EXISTS(SELECT 1 FROM procurement_activities a WHERE a.origin_parent_id=procurement_collaboration_drafts.id) ORDER BY updated_at DESC LIMIT 51").all<Record<string,unknown>>();
  const activities:unknown[]=saved.results.map(record),warnings:string[]=[];for(const row of rows.results.slice(0,50)){try{const old=await legacy(env,row);if(old&&!saved.results.some(savedRow=>{const current=JSON.parse(String(savedRow.settings));return current.name===old.settings.name&&current.scope===old.settings.scope&&current.startDate.slice(0,4)===old.settings.startDate.slice(0,4);}))activities.push(old);}catch{warnings.push(`${row.id}舊活動無法驗證，請查看原母批次。`);}}
  return reply({activities,warnings,truncated:rows.results.length>50||saved.results.length===200});
 }
 if(!['POST','PUT'].includes(request.method))return reply({error:'不支援此操作。'},405);
 hooks.origin();const who=await hooks.write();if(request.headers.get('X-Procurement-Version')!==ACTIVITY_VERSION)fail('活動功能已有新版，請重新載入最新版。',409);
 const b=await hooks.body();if(Object.keys(b).some(k=>!['settings','expectedRevision','expectedOriginRevision','reason'].includes(k)))fail('活動請求包含不支援欄位。');const settings=activitySettings(b.settings,true),reason=text(b.reason,300),now=new Date().toISOString();
 if(!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<0)fail('缺少活動版本，請重新讀取。');
 if((request.method==='POST'&&id)||(request.method==='PUT'&&!id))fail('活動操作路徑錯誤。');
 if(request.method==='POST'||id.startsWith('legacy:')){
  if(b.expectedRevision!==0)fail('新增活動版本錯誤。');let originParentId:string|null=null,originMonth=taipei().slice(0,7),planId:string|null=null;
  if(id){originParentId=id.slice(7);const row=await env.DB.prepare('SELECT id,analysis_month,payload,payload_encoding,payload_sha256,revision,updated_at FROM procurement_collaboration_drafts WHERE id=? AND removed_at IS NULL').bind(originParentId).first<Record<string,unknown>>();if(!row)fail('原母批次不存在。',404);if(b.expectedOriginRevision!==row!.revision)fail('原母批次已更新，請重新讀取活動。',409);const old=await legacy(env,row!);if(!old)fail('母批次沒有活動。');if(old!.ambiguousTransfer)fail('原活動對應多筆週調撥，請先確認活動身分。',409);originMonth=old!.originMonth;planId=old!.transferPlanId||null;
   const existing=await env.DB.prepare('SELECT id FROM procurement_activities WHERE origin_parent_id=?').bind(originParentId).first();if(existing)fail('此舊活動已由同仁保存，請重新讀取。',409);
  }
  const same=await env.DB.prepare("SELECT id FROM procurement_activities WHERE json_extract(settings,'$.name')=? AND json_extract(settings,'$.scope')=? AND substr(json_extract(settings,'$.startDate'),1,4)=?").bind(settings.name,settings.scope,settings.startDate.slice(0,4)).first();if(same)fail('同年度已有同名同範圍活動，請沿用既有活動。',409);
  const newId='ACT-'+crypto.randomUUID();try{await env.DB.prepare('INSERT INTO procurement_activities(id,revision,settings,origin_parent_id,origin_month,transfer_plan_id,change_reason,created_at,created_by,updated_at,updated_by) VALUES (?,1,?,?,?,?,?,?,?,?,?)').bind(newId,JSON.stringify(settings),originParentId,originMonth,planId,reason,now,who.email,now,who.email).run();}catch(e){if(/unique/i.test(String(e)))fail('活動已存在或被同仁更新，請重新讀取。',409);throw e;}
  const row=await env.DB.prepare('SELECT * FROM procurement_activities WHERE id=?').bind(newId).first<Record<string,unknown>>();return reply({activity:record(row!)},201);
 }
 const row=await env.DB.prepare('SELECT * FROM procurement_activities WHERE id=?').bind(id).first<Record<string,unknown>>();if(!row)fail('找不到活動。',404);if(row!.revision!==b.expectedRevision)fail('活動已由其他同仁更新，請重新讀取；未覆蓋其設定。',409);
 if(JSON.stringify(settings)===String(row!.settings))return reply({activity:record(row!),unchanged:true});
 const r=await env.DB.prepare('UPDATE procurement_activities SET settings=?,change_reason=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=?').bind(JSON.stringify(settings),reason,now,who.email,id,b.expectedRevision).run();if(Number(r.meta.changes)!==1)fail('活動版本衝突，請重新讀取。',409);
 return reply({activity:record((await env.DB.prepare('SELECT * FROM procurement_activities WHERE id=?').bind(id).first<Record<string,unknown>>())!)});
}
export async function assertCurrentActivity(env:Env,source:Record<string,unknown>){
 if(!source.activityId)return;
 const row=await env.DB.prepare('SELECT * FROM procurement_activities WHERE id=?').bind(source.activityId).first<Record<string,unknown>>();if(!row||row.revision!==source.activityRevision)fail('活動設定已更新，請以最新版重新產生採購及門市草稿。',409);
 const s=JSON.parse(String(row!.settings));if(s.name!==source.name||s.startDate!==source.startDate||s.endDate!==source.endDate||s.scope!==source.scope)fail('活動來源與共用設定不符。',409);
 for(const raw of source.months as Record<string,unknown>[]||[]){const target=s.monthlyTargets[String(raw.month)];if(!target||Math.abs(Number(raw.retailTarget)+Number(raw.onlineAndOtherTarget)-target.amount)>0.01||(target.retailAmount!=null&&Math.abs(Number(raw.retailTarget)-target.retailAmount)>0.01))fail('門市草稿目標與共用活動不符，請重新產生。',409);}
 return row!;
}

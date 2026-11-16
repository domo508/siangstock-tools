import { RequestValidationError } from './schema';
import { STORES } from './store-transfer-stores';

type Obj=Record<string,unknown>;
const obj=(r:unknown):Obj=>{if(!r||typeof r!=='object'||Array.isArray(r))throw new RequestValidationError('成效摘要格式錯誤。');return r as Obj;};
const number=(v:unknown,nullable=false,signed=false):number|null=>{if(nullable&&v===null)return null;if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12||(!signed&&v<0))throw new RequestValidationError('成效摘要數值無效。');return v;};
function date(v:unknown):string{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new RequestValidationError('成效摘要日期無效。');return v;}
export function performanceStatements(db:D1Database,batchId:string,raw:unknown,_stores:string[],proposalDate:string,now:string):D1PreparedStatement[]{
 if(raw==null)return[];
 const r=obj(raw);if(r.schemaVersion!==1||r.costBasis!=='snapshot-master-estimate')throw new RequestValidationError('成效摘要版本不符，請重新計算。');
 const inventoryDate=date(r.inventoryDate),salesStart=date(r.salesStart),salesEnd=date(r.salesEnd),remarkSince=date(r.remarkSince);
 const count=Math.round((Date.parse(salesEnd)-Date.parse(salesStart))/86400000)+1;
 if(inventoryDate>proposalDate||salesEnd>inventoryDate||remarkSince>salesEnd||count<1||count>400||!Array.isArray(r.stores)||r.stores.length>6)throw new RequestValidationError('成效摘要日期或門市範圍錯誤。');
 const seen=new Set<string>();
 return r.stores.map(value=>{
  const s=obj(value),storeCode=String(s.storeCode);if(!(storeCode in STORES)||seen.has(storeCode))throw new RequestValidationError('成效摘要門市不符或重複。');seen.add(storeCode);
  const demandSkus=number(s.demandSkus)!,stockoutSkus=number(s.stockoutSkus)!,unmatchedCount=number(s.unmatchedCount)!;
  if(!Number.isInteger(demandSkus)||!Number.isInteger(stockoutSkus)||stockoutSkus>demandSkus||!Number.isInteger(unmatchedCount)||!Array.isArray(s.daily)||s.daily.length!==count)throw new RequestValidationError('成效摘要日數或品項數不符。');
  const daily=s.daily.map((value,index)=>{const d=obj(value),day=date(d.date),expected=new Date(Date.parse(salesStart)+index*86400000).toISOString().slice(0,10);if(day!==expected||typeof d.localCostKnown!=='boolean'||(day<remarkSince)!==(d.warehouseStockoutQty===null))throw new RequestValidationError('成效摘要每日日期或備註基準不連續。');
   return{date:day,localQty:number(d.localQty,false,true),localCost:number(d.localCost,true,true),localCostKnown:d.localCostKnown,warehouseStockoutQty:number(d.warehouseStockoutQty,true,true),warehouseServiceQty:number(d.warehouseServiceQty,false,true)};});
  const inventoryValue=number(s.inventoryValue,true),sellableValue=number(s.sellableValue,true),stagnantValue=number(s.stagnantValue,true);
  if((inventoryValue===null)!==(sellableValue===null)||(sellableValue===null)!==(stagnantValue===null)||(inventoryValue!==null&&sellableValue!>inventoryValue)||(sellableValue!==null&&stagnantValue!>sellableValue)||daily.some(d=>(d.localCost===null)===d.localCostKnown))throw new RequestValidationError('成效摘要成本覆蓋不一致。');
  const payload={storeCode,inventoryValue,sellableValue,stagnantValue,demandSkus,stockoutSkus,unmatchedCount,daily};
  return db.prepare('INSERT INTO store_transfer_performance_snapshots(batch_id,store_code,inventory_date,sales_start,sales_end,remark_since,payload,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(batchId,storeCode,inventoryDate,salesStart,salesEnd,remarkSince,JSON.stringify(payload),now);
 });
}
export async function readPerformance(db:D1Database,who:{role:string;storeCode?:string|null;storeCodes?:readonly string[]}){
 const scope=who.role==='supervisor'?(who.storeCodes||[]):who.role==='store'?[String(who.storeCode)]:Object.keys(STORES);
 if(!scope.length||scope.some(s=>!(s in STORES)))throw new RequestValidationError('未設定可查看的區域門市。',403);
 const scopedStores=JSON.stringify(scope);
 // Same-week re-runs are replacement versions. Cancelled/deleted/test drafts never count.
 const canonical=`WITH ranked AS (SELECT b.*,s.store_code,s.status AS store_status,ROW_NUMBER() OVER(PARTITION BY b.week_key,s.store_code ORDER BY b.created_at DESC,b.id DESC) AS rank FROM store_transfer_batches b JOIN store_transfer_store_status s ON s.batch_id=b.id WHERE b.deleted_at IS NULL AND b.status IN ('open','review','approved','erp_created','closed') AND s.store_code IN(SELECT value FROM json_each(?))), valid AS (SELECT * FROM ranked WHERE rank=1)`;
 const points=await db.prepare(`WITH ranked AS (SELECT p.*,ROW_NUMBER() OVER(PARTITION BY b.week_key,p.store_code ORDER BY b.created_at DESC,b.id DESC) AS rank FROM store_transfer_performance_snapshots p JOIN store_transfer_batches b ON b.id=p.batch_id WHERE b.deleted_at IS NULL AND b.status IN ('open','review','approved','erp_created','closed') AND p.store_code IN(SELECT value FROM json_each(?))) SELECT * FROM ranked WHERE rank=1 ORDER BY created_at,batch_id LIMIT 10001`).bind(scopedStores).all<Obj>();
 if(points.results.length>10000)throw new RequestValidationError('成效資料超出一次讀取範圍，請聯繫總部。',413);
 const summaries=await db.prepare(`${canonical}, demand AS (SELECT batch_id,store_code,sku,item_type,MAX(need) AS need FROM (SELECT batch_id,store_code,sku,item_type,suggested_quantity AS need FROM store_transfer_items UNION ALL SELECT batch_id,store_code,sku,item_type,demand_quantity AS need FROM store_transfer_shortages) GROUP BY batch_id,store_code,sku,item_type) SELECT b.id,b.week_key,b.proposal_date,b.store_code,b.store_status,SUM(d.need) AS need,SUM(MIN(d.need,COALESCE(i.hq_approved_quantity,i.store_confirmed_quantity,i.suggested_quantity,0))) AS covered FROM valid b JOIN demand d ON d.batch_id=b.id AND d.store_code=b.store_code LEFT JOIN store_transfer_items i ON i.batch_id=d.batch_id AND i.store_code=d.store_code AND i.sku=d.sku AND i.item_type=d.item_type GROUP BY b.id,b.store_code ORDER BY b.proposal_date,b.id LIMIT 10001`).bind(scopedStores).all<Obj>();
 if(summaries.results.length>10000)throw new RequestValidationError('成效批次超出一次讀取範圍，請聯繫總部。',413);
 const sales=await db.prepare(`SELECT p.id,p.created_at,json_extract(p.payload,'$.salesStart') sales_start,json_extract(p.payload,'$.salesEnd') sales_end,j.value store_payload FROM store_transfer_sales_performance p JOIN json_each(p.payload,'$.stores') j WHERE json_extract(j.value,'$.storeCode') IN(SELECT value FROM json_each(?)) AND (p.batch_id IS NULL OR EXISTS(SELECT 1 FROM store_transfer_batches b WHERE b.id=p.batch_id AND b.deleted_at IS NULL AND b.status IN('open','review','approved','erp_created','closed'))) ORDER BY p.created_at,p.id LIMIT 10001`).bind(scopedStores).all<Obj>();
 if(sales.results.length>10000)throw new RequestValidationError('銷售成效資料過多，請聯繫總部。',413);
 return{snapshots:points.results.map(r=>({schemaVersion:1,batchId:r.batch_id,createdAt:r.created_at,inventoryDate:r.inventory_date,salesStart:r.sales_start,salesEnd:r.sales_end,remarkSince:r.remark_since,costBasis:'snapshot-master-estimate',stores:[JSON.parse(String(r.payload))]})).concat(sales.results.map(r=>({schemaVersion:1,batchId:r.id,createdAt:r.created_at,inventoryDate:r.sales_end,salesStart:r.sales_start,salesEnd:r.sales_end,inventoryAvailable:false,remarkSince:null,costBasis:'sales-only',stores:[JSON.parse(String(r.store_payload))]}))),supply:summaries.results.map(r=>({batchId:r.id,weekKey:r.week_key,date:r.proposal_date,storeCode:r.store_code,approved:r.store_status==='approved',need:Number(r.need),covered:Number(r.covered)}))};
}

export async function salesPerformanceContext(db:D1Database,batchId:string){
 const batch=await db.prepare("SELECT id,week_key,proposal_date FROM store_transfer_batches WHERE id=? AND deleted_at IS NULL AND status IN('open','review','approved','erp_created','closed')").bind(batchId).first<Obj>();
 if(!batch)throw new RequestValidationError('找不到可補匯的正式批次。',404);
 const catalog=await db.prepare('SELECT sku,auto_exclusions FROM store_transfer_batch_product_catalog WHERE batch_id=? ORDER BY sku').bind(batchId).all<Obj>();
 if(!catalog.results.length)throw new RequestValidationError('此批次缺少商品範圍快照，不能猜測歷史適用品項。',409);
 const stores=await db.prepare('SELECT store_code FROM store_transfer_store_status WHERE batch_id=? ORDER BY store_code').bind(batchId).all<Obj>();
 return{batch,stores:stores.results.map(r=>r.store_code),catalog:catalog.results.map(r=>({sku:r.sku,autoExclusions:JSON.parse(String(r.auto_exclusions||'{}'))}))};
}
export async function saveSalesPerformance(db:D1Database,raw:unknown,email:string){
 const r=obj(raw);if(r.schemaVersion!==1||!Array.isArray(r.stores)||!r.stores.length||r.stores.length>6||typeof r.complete!=='boolean')throw new RequestValidationError('銷售成效摘要格式錯誤。');
 const start=date(r.salesStart),end=date(r.salesEnd),remarkSince=date(r.remarkSince);
 const count=(Date.parse(end)-Date.parse(start))/86400000+1;
 if(count<1||count>400||end>new Date().toISOString().slice(0,10))throw new RequestValidationError('銷售摘要日期超出範圍。');
 const batchId=r.batchId==null?null:String(r.batchId);let permitted:string[]=Object.keys(STORES);
 if(batchId){const context=await salesPerformanceContext(db,batchId);permitted=context.stores.map(String);}
 const seen=new Set<string>();
 const stores=r.stores.map(value=>{const s=obj(value),code=String(s.storeCode);if(!permitted.includes(code)||seen.has(code)||!Array.isArray(s.daily)||s.daily.length>400)throw new RequestValidationError('銷售摘要門市或日數錯誤。');seen.add(code);const days=new Set<string>();
 const daily=s.daily.map(value=>{const d=obj(value),day=date(d.date);if(day<start||day>end||days.has(day)||typeof d.localCostKnown!=='boolean')throw new RequestValidationError('銷售摘要日期重複或越界。');days.add(day);const localCost=number(d.localCost,true,true);if((localCost===null)===d.localCostKnown||(day<remarkSince&&d.warehouseStockoutQty!==null))throw new RequestValidationError('銷售摘要成本或備註基準錯誤。');return{date:day,localQty:number(d.localQty,false,true),localCost,localCostKnown:d.localCostKnown,warehouseStockoutQty:number(d.warehouseStockoutQty,true,true),warehouseServiceQty:number(d.warehouseServiceQty,false,true)};}).sort((a,b)=>a.date.localeCompare(b.date));
 if(!Number.isInteger(s.unmatchedCount)||Number(s.unmatchedCount)<0)throw new RequestValidationError('未配對筆數無效。');
 if(r.complete&&daily.length!==count)throw new RequestValidationError('完整銷售摘要缺少日期。');
 return{storeCode:code,unmatchedCount:number(s.unmatchedCount),inventoryValue:null,sellableValue:null,stagnantValue:null,demandSkus:0,stockoutSkus:0,daily};}).sort((a,b)=>a.storeCode.localeCompare(b.storeCode));
 const payload=JSON.stringify({schemaVersion:1,salesStart:start,salesEnd:end,remarkSince,complete:r.complete,stores});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([batchId,payload])));const id=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
 await db.prepare('INSERT OR IGNORE INTO store_transfer_sales_performance(id,batch_id,payload,created_at,created_by) VALUES(?,?,?,?,?)').bind(id,batchId,payload,new Date().toISOString(),email).run();
 return{id,stores:stores.length,days:stores.reduce((n,s)=>n+s.daily.length,0),complete:r.complete};
}

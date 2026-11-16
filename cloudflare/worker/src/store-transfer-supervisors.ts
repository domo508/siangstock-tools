// Read-only regional performance access. This list does not grant HQ workflow rights.
const SCOPES: Readonly<Record<string,readonly string[]>> = Object.freeze({
 'oliver@siangapato.com.tw':Object.freeze(['R00','R10','R03']),
 'xyz11619@siangapato.com.tw':Object.freeze(['R01','R07','R06'])
});
export function supervisorStores(email:string):readonly string[]|null {
 return SCOPES[email.trim().toLocaleLowerCase('en-US')] || null;
}

import {RequestValidationError} from './schema';
type Row=Record<string,unknown>;
export async function supervisorBatches(db:D1Database,scope:readonly string[],requested:string|null,batchId:string|null,sanitize:(value:unknown,suggested?:number)=>string){
 if(!scope.length)throw new RequestValidationError('未設定區域門市。',403);
 if(requested && requested!=='all'&&!scope.includes(requested))throw new RequestValidationError('不可查看其他區域門市資料。',403);
 const selected=requested&&requested!=='all'?[requested]:scope,scoped=JSON.stringify(selected);
 if(!batchId){
  const result=await db.prepare(`SELECT b.id,b.week_key,b.proposal_date,b.status,b.updated_at,s.store_code,s.status AS store_status,s.erp_created_at,
   (SELECT COUNT(*) FROM store_transfer_items i WHERE i.batch_id=b.id AND i.store_code=s.store_code) AS item_count,
   (SELECT COALESCE(SUM(COALESCE(i.hq_approved_quantity,i.store_confirmed_quantity,i.suggested_quantity)),0) FROM store_transfer_items i WHERE i.batch_id=b.id AND i.store_code=s.store_code) AS effective_quantity
   FROM store_transfer_batches b JOIN store_transfer_store_status s ON s.batch_id=b.id WHERE b.deleted_at IS NULL AND s.store_code IN(SELECT value FROM json_each(?)) ORDER BY b.updated_at DESC,b.id,s.store_code LIMIT 1501`).bind(scoped).all<Row>();
  if(result.results.length>1500)throw new RequestValidationError('區域批次過多，請聯繫總部縮小查詢期間。',413);
  const batches=new Map<string,Row>();
  for(const r of result.results){const id=String(r.id);if(!batches.has(id))batches.set(id,{id,week_key:r.week_key,proposal_date:r.proposal_date,status:r.status,updated_at:r.updated_at,stores:[],item_count:0,effective_quantity:0});const b=batches.get(id)!;(b.stores as Row[]).push({store_code:r.store_code,status:r.store_status,erp_created_at:r.erp_created_at,item_count:Number(r.item_count),effective_quantity:Number(r.effective_quantity)});b.item_count=Number(b.item_count)+Number(r.item_count);b.effective_quantity=Number(b.effective_quantity)+Number(r.effective_quantity);}
  return{batches:[...batches.values()],readOnly:true,storeCodes:selected};
 }
 const batch=await db.prepare(`SELECT b.id,b.week_key,b.proposal_date,b.status,b.updated_at FROM store_transfer_batches b WHERE b.id=? AND b.deleted_at IS NULL AND EXISTS(SELECT 1 FROM store_transfer_store_status s WHERE s.batch_id=b.id AND s.store_code IN(SELECT value FROM json_each(?)))`).bind(batchId,scoped).first<Row>();
 if(!batch)throw new RequestValidationError('找不到可查看的區域批次。',404);
 const items=await db.prepare(`SELECT store_code,sku,product_name,item_type,suggested_quantity,store_confirmed_quantity,hq_approved_quantity,store_reason,hq_reason,system_projection,system_reason,decision_snapshot FROM store_transfer_items WHERE batch_id=? AND store_code IN(SELECT value FROM json_each(?)) ORDER BY store_code,sku,item_type`).bind(batchId,scoped).all<Row>();
 const shortages=await db.prepare(`SELECT store_code,sku,product_name,item_type,demand_quantity,allocated_quantity,unfilled_quantity,reason FROM store_transfer_shortages WHERE batch_id=? AND store_code IN(SELECT value FROM json_each(?)) ORDER BY store_code,sku,item_type`).bind(batchId,scoped).all<Row>();
 const statuses=await db.prepare(`SELECT store_code,status,erp_created_at FROM store_transfer_store_status WHERE batch_id=? AND store_code IN(SELECT value FROM json_each(?)) ORDER BY store_code`).bind(batchId,scoped).all<Row>();
 const safeKeys=['inventoryEvidenceVersion','salesBasisVersion','physicalInventory','displayQuantity','localSales42','warehouseDemandSales42','replenishmentSales42'];
 const rows:Row[]=items.results.map(row=>{let snap:Row={};try{snap=JSON.parse(String(row.decision_snapshot||'{}'));}catch{/* Missing legacy evidence is unknown. */}return{...row,system_reason:sanitize(row.system_reason,Number(row.suggested_quantity)),hq_reason:String(row.hq_reason||'').trim()?sanitize(row.hq_reason,Number(row.hq_approved_quantity)):'',decision_snapshot:Object.fromEntries(safeKeys.filter(k=>typeof snap?.[k]==='number').map(k=>[k,snap[k]]))};});
 return{batch:{...batch,item_count:rows.length,effective_quantity:rows.reduce((n,r)=>n+Number(r.hq_approved_quantity??r.store_confirmed_quantity??r.suggested_quantity),0)},items:rows,shortages:shortages.results.map(r=>({...r,reason:sanitize(r.reason,Number(r.allocated_quantity))})),storeStatuses:statuses.results,readOnly:true,storeCodes:selected};
}

export async function supervisorNewProducts(db:D1Database,scope:readonly string[],requested:string|null,sanitize:(value:unknown,suggested?:number)=>string){
 if(!scope.length)throw new RequestValidationError('未設定區域門市。',403);
 if(requested&&requested!=='all'&&!scope.includes(requested))throw new RequestValidationError('不可查看其他區域新品分配。',403);
 const selected=requested&&requested!=='all'?[requested]:scope;
 const result=await db.prepare(`SELECT p.id AS plan_id,p.status,p.updated_at,s.store_code,s.status AS store_status,r.sku,r.name,r.suggested_quantity,r.confirmed_quantity,r.approved_quantity,r.store_reason,r.hq_reason,g.first_stock_date,
  (r.archived_dispatched_quantity+(SELECT COALESCE(SUM(u.quantity),0) FROM new_product_claim_usage u WHERE u.plan_id=r.plan_id AND u.store_code=r.store_code AND u.sku=r.sku)) AS committed_quantity,
  (r.archived_dispatched_quantity+(SELECT COALESCE(SUM(u.quantity),0) FROM new_product_claim_usage u WHERE u.plan_id=r.plan_id AND u.store_code=r.store_code AND u.sku=r.sku AND u.erp_created=1)) AS dispatched_quantity
  FROM new_product_plans p JOIN procurement_batches b ON b.id=p.procurement_batch_id JOIN new_product_store_status s ON s.plan_id=p.id JOIN new_product_plan_rows r ON r.plan_id=p.id AND r.store_code=s.store_code JOIN new_product_registry g ON g.sku=r.sku
  WHERE b.status IN('approved','erp_created','received') AND r.store_code IN(SELECT value FROM json_each(?)) ORDER BY p.created_at DESC,p.id,r.store_code,r.sku LIMIT 10001`).bind(JSON.stringify(selected)).all<Row>();
 if(result.results.length>10000)throw new RequestValidationError('新品分配資料過多，請選擇單一門市。',413);
 const rows=result.results.map(r=>({...r,hq_reason:String(r.hq_reason||'').trim()?sanitize(r.hq_reason,Number(r.approved_quantity)):'',remaining_quantity:r.approved_quantity==null?null:Math.max(0,Number(r.approved_quantity)-Number(r.committed_quantity))}));
 return{rows,readOnly:true,storeCodes:selected};
}

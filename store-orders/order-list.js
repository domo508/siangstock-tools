import * as C from './core.js?v=20261031-store-orders-r38';

// Cache only display metadata in memory. Never cache customer data or full snapshots.
export async function listSummaries(rows,{storeCode,businessDate,actor,cache,read}){
 const out=[];
 for(let i=0;i<rows.length;i+=3){out.push(...await Promise.all(rows.slice(i,i+3).map(async row=>{
  const key=JSON.stringify([actor,storeCode,businessDate,row.id,row.version,row.status,row.batch_id||null]);
  if(cache.has(key))return cache.get(key);
  try{
   const o=await read(row.id);
   if(o.id!==row.id||o.version!==row.version||o.status!==row.status||o.storeCode!==storeCode||o.businessDate!==businessDate||(o.batchId||null)!==(row.batch_id||null))throw Error('資料版本已變動');
   let amountCents=null;try{amountCents=o.items.length?C.totals(o).amountCents:null;}catch{/* Incomplete drafts have no trustworthy amount. */}
   const summary={id:row.id,paperNumber:C.text(o.paperNumber),amountCents};cache.set(key,summary);return summary;
  }catch{return {id:row.id,error:'單號與金額摘要未能確認，請更新清單或開啟原單核對。'};}
 })));}
 // Keep the cache bounded and limit it to the current visible scope and versions.
 const keys=new Set(rows.map(row=>JSON.stringify([actor,storeCode,businessDate,row.id,row.version,row.status,row.batch_id||null])));
 for(const key of cache.keys())if(!keys.has(key))cache.delete(key);
 return out;
}
export function canVoidOrder(order){return !!order&&Number.isSafeInteger(order.version)&&order.version>0&&!order.batchId&&['pending','needs_info','reviewed'].includes(order.status);}
export function voidSavedOrder(order,reason){
 if(!canVoidOrder(order))throw Error('只有尚未結算的已保存訂單可作廢');
 if(!C.text(reason)||C.text(reason).length>1000)throw Error('請填寫1000字內的作廢原因');
 return {...structuredClone(order),status:'cancelled',exceptionReason:C.text(reason)};
}

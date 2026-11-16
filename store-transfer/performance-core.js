/* Aggregates only; no customer/order/remark text is retained or transmitted. */
(function(root,factory){const api=factory();root.StoreTransferPerformance=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
'use strict';
const VERSION='20261116-transfer-store-names-r1', SCHEMA=1;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const add=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const days=(a,b)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000)+1;
function dates(a,b){if(!validDate(a)||!validDate(b)||a>b||days(a,b)>400)throw Error('資料期間須為有效日期，且不超過400日。');return Array.from({length:days(a,b)},(_,i)=>add(a,i));}
function periods(mode,latest,start='',end=''){
 if(!validDate(latest))throw Error('尚無可比較的資料截止日。');let a,b;
 if(mode==='wow'){const weekday=(new Date(latest+'T00:00:00Z').getUTCDay()+6)%7;b=weekday===6?latest:add(latest,-weekday-1);a=add(b,-6);}
 else if(mode==='mom'){b=add(latest.slice(0,7)+'-01',-1);a=b.slice(0,7)+'-01';const pEnd=add(a,-1);return{current:[a,b],previous:[pEnd.slice(0,7)+'-01',pEnd]};}
 else if(mode==='mtd'){a=latest.slice(0,7)+'-01';b=latest;const pEnd=add(a,-1),pStart=pEnd.slice(0,7)+'-01';return{current:[a,b],previous:[pStart,add(pStart,Math.min(days(a,b),days(pStart,pEnd))-1)]};}
 else if(mode==='4w'||mode==='8w'){b=latest;a=add(b,-(mode==='4w'?27:55));}
 else if(mode==='custom'){a=start;b=end;dates(a,b);}else throw Error('請選擇比較區間。');
 return{current:[a,b],previous:[add(a,-days(a,b)),add(a,-1)]};
}
function buildSnapshot(input,calculation,meta,core=rootCore()){
 const {inventoryDate,salesStart,salesEnd,remarkSince}=meta;
 dates(salesStart,salesEnd);
 if(!validDate(inventoryDate)||inventoryDate>input.proposalDate||salesEnd>inventoryDate||!validDate(remarkSince)||remarkSince>salesEnd)throw Error('請確認庫存快照日、完整銷售起迄日及備註口徑啟用日；銷售截止不可晚於庫存日，庫存日不可晚於開單日。');
 if(meta.complete!==true)throw Error('請確認所選門市與銷售期間資料完整。');
 if(input.sales.some(r=>r.hasRemarkColumn!==true))throw Error('成效指標需要每份銷售檔皆有備註欄。');
 if(input.sales.some(r=>Number(r.excluded?.['缺品號或日期']||0)>0))throw Error('銷售檔有缺品號或日期列，請先補齊後再保存成效。');
 const waiting=input.newProducts&&globalThis.NewProductAllocation?globalThis.NewProductAllocation.context(input.newProducts,input.inventory,input.storeCodes||core.STORE_ORDER).waiting:new Set();
 const evidence=core.salesEvidence(input.sales), key=r=>`${r.warehouseCode}|${r.sourceOrder||r.posOrder||r.pickupOrder||''}|${r.sku}`;
 const allHQ=new Set([...evidence.matchedTakeSales,...evidence.primarySales.filter(r=>r.shipWarehouseCode==='T00'&&['銷貨','退貨'].includes(r.saleType)&&!evidence.representedOrderItems.has(key(r)))]);
 const stores=(input.storeCodes||core.STORE_ORDER).map(storeCode=>{
  const facts=(calculation.manualItemFacts||[]).filter(r=>r.storeCode===storeCode&&!r.autoExcluded&&!waiting.has(r.sku));
  const catalog=calculation.manualItemCatalog||[];
  const eligible=new Set(catalog.filter(r=>!r.autoExclusions?.[storeCode]&&!waiting.has(r.sku)).map(r=>r.sku));
  if(!catalog.length)for(const f of facts)eligible.add(f.sku);
  const active=facts.filter(r=>Number(r.targetQuantity)>Number(r.displayQuantity)||Number(r.replenishmentSales42??r.localSales42)>0);
  let inventoryValue=0,sellableValue=0,stagnantValue=0,valuationComplete=true;
  for(const f of facts){const physical=Math.max(0,Number(f.physicalInventory||0)),sellable=Math.max(0,physical-Number(f.displayQuantity||0)),cost=Number(input.master.bySku.get(f.sku)?.unitCost);
   if(physical>0&&(!Number.isFinite(cost)||cost<=0)){valuationComplete=false;continue;}
   if(physical>0){inventoryValue+=physical*cost;sellableValue+=sellable*cost;if(Number(f.localSales42)===0)stagnantValue+=sellable*cost;}
  }
  const daily=new Map(dates(salesStart,salesEnd).map(date=>[date,{date,localQty:0,localCost:0,localCostKnown:true,warehouseStockoutQty:date>=remarkSince?0:null,warehouseServiceQty:0}]));
  for(const row of evidence.sales){if(row.warehouseCode!==storeCode||!daily.has(row.date)||!eligible.has(row.sku))continue;
   const d=daily.get(row.date),qty=Number(row.deductQuantity||row.quantity||0),cost=Number(input.master.bySku.get(row.sku)?.unitCost);
   if(!Number.isFinite(qty))throw Error('銷售數量無效，不能建立成效快照。');
   if(row.shipWarehouseCode===storeCode&&!(row.saleType==='訂貨'&&evidence.representedOrderItems.has(key(row)))){d.localQty+=qty;if(Number.isFinite(cost)&&cost>0)d.localCost+=qty*cost;else if(qty)d.localCostKnown=false;}
   else if(allHQ.has(row)) {if(evidence.eligibleWarehouseRows.has(row)){if(d.warehouseStockoutQty!==null)d.warehouseStockoutQty+=qty;}else d.warehouseServiceQty+=qty;}
  }
  const unmatchedCount=evidence.b3PendingRows.filter(r=>r.storeCode===storeCode).length;
  // All unmatched pickups invalidate HQ-rate coverage; never silently count them as zero.
  return{storeCode,inventoryValue:valuationComplete?inventoryValue:null,sellableValue:valuationComplete?sellableValue:null,stagnantValue:valuationComplete?stagnantValue:null,demandSkus:active.length,stockoutSkus:active.filter(f=>Number(f.physicalInventory)<=Number(f.displayQuantity)).length,unmatchedCount,daily:[...daily.values()].map(d=>({...d,localCost:d.localCostKnown?d.localCost:null}))};
 });
 return{schemaVersion:SCHEMA,inventoryDate,salesStart,salesEnd,remarkSince,costBasis:'snapshot-master-estimate',stores};
}
function buildSalesSummary(reports,catalog,storeCodes,meta={},master=null,core=rootCore()){
 if(!reports.length||reports.some(r=>Number(r.excluded?.['缺品號或日期']||0)>0))throw Error('銷售檔有缺品號或日期列，請修正後重試；尚未保存。');
 const evidence=core.salesEvidence(reports),key=r=>`${r.warehouseCode}|${r.sourceOrder||r.posOrder||r.pickupOrder||''}|${r.sku}`;
 const sourceDates=[...new Set([...reports.flatMap(r=>[...(r.records||[]),...(r.takeRecords||[])])].map(r=>r.date).filter(validDate))].sort();
 if(!sourceDates.length)throw Error('銷售檔沒有有效日期，不能保存摘要。');
 const salesStart=meta.salesStart||sourceDates[0],salesEnd=meta.salesEnd||sourceDates.at(-1),complete=meta.complete===true,remarkSince=meta.remarkSince||'2026-11-11';dates(salesStart,salesEnd);
 const hq=new Set([...evidence.matchedTakeSales,...evidence.primarySales.filter(r=>r.shipWarehouseCode==='T00'&&['銷貨','退貨'].includes(r.saleType)&&!evidence.representedOrderItems.has(key(r)))]);
 const stores=storeCodes.map(storeCode=>{const eligible=new Set(catalog.filter(r=>!r.autoExclusions?.[storeCode]).map(r=>r.sku));
 const covered=complete?dates(salesStart,salesEnd):[...new Set(reports.flatMap(r=>[...(r.records||[]),...(r.takeRecords||[])]).filter(r=>r.warehouseCode===storeCode).map(r=>r.date))].filter(d=>validDate(d)&&d>=salesStart&&d<=salesEnd).sort();
 const daily=new Map(covered.map(date=>[date,{date,localQty:0,localCost:0,localCostKnown:true,warehouseStockoutQty:date>=remarkSince?0:null,warehouseServiceQty:0}]));
 for(const r of evidence.sales){if(r.warehouseCode!==storeCode||!eligible.has(r.sku)||!daily.has(r.date))continue;const d=daily.get(r.date),qty=Number(r.deductQuantity||r.quantity||0),cost=Number(master?.bySku?.get(r.sku)?.unitCost);if(!Number.isFinite(qty))throw Error('銷售數量無效。');
 if(r.shipWarehouseCode===storeCode&&!(r.saleType==='訂貨'&&evidence.representedOrderItems.has(key(r)))){d.localQty+=qty;if(Number.isFinite(cost)&&cost>0)d.localCost+=qty*cost;else if(qty)d.localCostKnown=false;}
 else if(hq.has(r)){if(!reports.every(r=>r.hasRemarkColumn===true)){d.warehouseStockoutQty=null;}else if(evidence.eligibleWarehouseRows.has(r)){if(d.warehouseStockoutQty!==null)d.warehouseStockoutQty+=qty;}else d.warehouseServiceQty+=qty;}}
 return{storeCode,unmatchedCount:evidence.b3PendingRows.filter(r=>r.storeCode===storeCode).length,daily:[...daily.values()].map(d=>({...d,localCost:d.localCostKnown?d.localCost:null}))};});
 return{schemaVersion:1,batchId:meta.batchId||null,salesStart,salesEnd,remarkSince,complete,stores};
}
function rootCore(){return globalThis.StoreTransferCore;}
const ratio=(a,b)=>b>0?a/b:null;
function measure(snapshots,supply,storeCodes,range){
 const [start,end]=range,calendar=dates(start,end),selected=new Set(storeCodes),byStore=new Map(storeCodes.map(s=>[s,{points:new Map(),daily:new Map()}]));
 // API orders oldest to newest. Updated source for the same date replaces, never adds.
 for(const snapshot of [...snapshots].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.batchId).localeCompare(String(b.batchId))))for(const s of snapshot.stores){if(!selected.has(s.storeCode))continue;const bucket=byStore.get(s.storeCode);if(snapshot.inventoryAvailable!==false)bucket.points.set(snapshot.inventoryDate,s);for(const d of s.daily)bucket.daily.set(d.date,{...d,unmatchedCount:s.unmatchedCount});}
 let inv=0,pointCount=0,stagnant=0,sellable=0,demand=0,stockouts=0,local=0,hq=0,service=0,cost=0;
 let salesComplete=true,remarkComplete=true,costComplete=true,inventoryComplete=true,turnoverComplete=true;const quality=[];
 for(const [store,bucket] of byStore){const points=[...bucket.points].filter(([date])=>date>=start&&date<=end).sort(([a],[b])=>a.localeCompare(b));
  if(points.length<1||days(start,points[0]?.[0]||end)>8||days(points.at(-1)?.[0]||start,end)>8||points.some(([date],i)=>i>0&&days(points[i-1][0],date)>9))inventoryComplete=false;
  if(points.length<2)turnoverComplete=false;
  const valid=points.filter(([,p])=>p.inventoryValue!==null);if(valid.length!==points.length)costComplete=false;
  inv+=valid.length?valid.reduce((n,[,p])=>n+p.inventoryValue,0)/valid.length:0;pointCount+=points.length;
  for(const [,p]of points){stagnant+=(p.stagnantValue||0)/points.length;sellable+=(p.sellableValue||0)/points.length;demand+=p.demandSkus/points.length;stockouts+=p.stockoutSkus/points.length;}
  for(const date of calendar){const d=bucket.daily.get(date);if(!d){salesComplete=false;remarkComplete=false;costComplete=false;continue;}local+=d.localQty;service+=d.warehouseServiceQty;if(d.warehouseStockoutQty===null||d.unmatchedCount)remarkComplete=false;else hq+=d.warehouseStockoutQty;if(d.localCost===null)costComplete=false;else cost+=d.localCost;}
 }
 if(!turnoverComplete)quality.push('週轉估算需至少2個庫存快照');if(!salesComplete)quality.push('銷售日期覆蓋不足');if(!inventoryComplete)quality.push('庫存快照不足或間隔過長');if(!remarkComplete)quality.push('備註口徑尚未啟用或有未配對取貨');if(!costComplete)quality.push('估值成本資料不足');
 const relevant=supply.filter(r=>selected.has(r.storeCode)&&r.date>=start&&r.date<=end);let need=0,covered=0;const pending=relevant.some(r=>!r.approved);
 for(const r of relevant){need+=r.need;covered+=r.covered;}
 return{turnover:turnoverComplete&&inventoryComplete&&salesComplete&&costComplete&&cost>0?inv/cost*calendar.length:null,stockout:pointCount&&inventoryComplete?ratio(stockouts,demand):null,warehouse:remarkComplete&&salesComplete?ratio(Math.max(0,hq),Math.max(0,local)+Math.max(0,hq)+Math.max(0,service)):null,stagnant:pointCount&&inventoryComplete&&costComplete?ratio(stagnant,sellable):null,fill:relevant.length&&!pending?ratio(covered,need):null,need:need,covered:covered,points:pointCount,salesDays:calendar.length,quality:[...quality,...(pending?['仍有門市尚未核准']:[]),...(!relevant.length?['本期間無有效批次']:[])],localQty:salesComplete?local:null,warehouseQty:remarkComplete&&salesComplete?hq:null};
}
function delta(current,previous,rate=false){if(current==null||previous==null)return{value:null,text:'無完整比較基準'};if(rate)return{value:(current-previous)*100,text:`${(current-previous)*100>=0?'+':''}${((current-previous)*100).toFixed(1)} 個百分點`};if(previous===0)return{value:null,text:current===0?'與前期相同':'前期為0，不計增減率'};const v=(current-previous)/Math.abs(previous)*100;return{value:v,text:`${v>=0?'+':''}${v.toFixed(1)}%`};}
return{VERSION,SCHEMA,validDate,add,days,dates,periods,buildSnapshot,buildSalesSummary,measure,delta};
});

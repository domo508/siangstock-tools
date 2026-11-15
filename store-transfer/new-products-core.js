(function(root){
 'use strict';
 const STORES=['R00','R01','R03','R06','R07','R10'];
 const ALIASES={R00:['台北中山','中山'],R01:['台中北屯','北屯'],R03:['新竹東區','新竹'],R06:['文心秀泰','文心'],R07:['誠品480','誠品'],R10:['新莊']};
 function intendedStores(value){const text=String(value||'').normalize('NFKC');const explicit=STORES.filter(s=>text.toUpperCase().includes(s)||ALIASES[s].some(n=>text.includes(n)));if(explicit.length)return explicit;if(/全部通路|全通路|全部門市|所有門市|六店|六間門市|門市/.test(text))return [...STORES];if(/官網|線上|MOMO|蝦皮|電商/i.test(text))return [];throw Error('新品販售門市無法辨識，請填門市代碼或全部門市。');}
 function quantity(v){const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw Error('新品首配量須為0以上整數。');return n;}
 function draft(row,peers,storeRules,exceptions){
  const stores=intendedStores(row.plannedChannels),C=root.StoreTransferCore;
  if(!C)throw Error('新品首配元件尚未載入。');
  const reference=row.newProductSystemReference||{};
  const candidates=Number(reference.sampleCount||0);
  const raw={};for(const store of stores) raw[store]=Math.max(0,Number(reference.storeDailyByCode?.[store]||0)*14);
  const sum=Object.values(raw).reduce((a,b)=>a+b,0),pool=Math.max(0,Number(reference.firstMonthDemandQty||0)*14/30);
  const comparableTotal=Math.max(sum,Number(reference.daily||0)*14);
  const ratio=comparableTotal>0?Math.min(1,pool/comparableTotal):0;
  const master={...row,name:row.name};
  const portions=Object.fromEntries(stores.map(s=>[s,Math.floor(raw[s]*ratio)]));
  let remainder=Math.ceil(sum*ratio-1e-9)-Object.values(portions).reduce((a,b)=>a+b,0);
  for(const s of [...stores].sort((a,b)=>(raw[b]*ratio-portions[b])-(raw[a]*ratio-portions[a])||STORES.indexOf(a)-STORES.indexOf(b))){if(remainder<=0)break;portions[s]++;remainder--;}
  const result={};for(const s of stores){const rule=C.storeDisplayException(s,row.sku,exceptions)||C.stockRule(master,storeRules);const scope=String(rule?.scope||'');const codes=scope.match(/R\d{2}/g)||[];const applicable=!codes.length||codes.includes(s);const floor=applicable&&['不可售展示','可售最低庫存'].includes(rule?.role)?Number(rule.quantity||0):0;result[s]=rule?.role==='不可售展示'&&applicable?portions[s]+Math.ceil(floor):Math.max(portions[s],Math.ceil(floor));}
  return {sku:row.sku,name:row.name,listedDate:row.listedDate,stores:result,dailyByStore:Object.fromEntries(stores.map(s=>[s,raw[s]*ratio/14])),evidence:candidates?`同材質／品類／尺寸${candidates}個相似商品近況估14天試銷，受新品共用需求池限制；再套用指定門市展示／最低庫存。`:'無可信同類門市樣本；僅提出展示／最低庫存量（未命中則0），請人工確認。'};
 }
 function context(payload,inventory,selectedStores,latest=""){
  const records=inventory.records||[],registered=new Map((payload.registry||[]).map(r=>[r.sku,r]));
  const balances=new Map();for(const r of records.filter(r=>r.warehouseCode==='T00'))balances.set(r.sku,(balances.get(r.sku)||0)+Number(r.quantity||0));
  const hasStock=new Set([...balances].filter(([,q])=>q>0).map(([sku])=>sku));
  const controlled=new Set(registered.keys()),approved=new Map(),held=new Map(),pending=new Set(),zeroed=new Set(),eligible=new Map(),active=new Set(),facts=new Map(),rows=[];
  for(const r of payload.rows||[]){facts.set(`${r.store_code}|${r.sku}`,r);if(!eligible.has(r.sku))eligible.set(r.sku,new Set());eligible.get(r.sku).add(r.store_code);if(r.approved_quantity===0)zeroed.add(`${r.store_code}|${r.sku}`);if(r.status!=='waiting_stock')pending.add(`${r.store_code}|${r.sku}`);if(r.status!=='waiting_stock'||Number(r.approved_quantity||0)>Number(r.dispatched_quantity||0))active.add(r.sku);}
  for(const r of payload.rows||[]){if(!selectedStores.includes(r.store_code))continue;held.set(`${r.store_code}|${r.sku}`,Math.max(0,Number(r.committed_quantity||0)-Number(r.dispatched_quantity||0)));const remaining=Math.max(0,Number(r.approved_quantity||0)-Number(r.committed_quantity||0));if(r.status==='waiting_stock'&&remaining>0){const key=`${r.store_code}|${r.sku}`;if(approved.has(key))throw Error(`${key}有重複新品首配來源，請總部核對。`);approved.set(key,{...r,remaining});rows.push(r);}}
  const waiting=new Set([...registered].filter(([sku,r])=>!r.first_stock_date&&!hasStock.has(sku)).map(([sku])=>sku));
  return {controlled,waiting,approved,held,pending,zeroed,eligible,active,facts,latest,hasStock,registry:registered,rows};
 }
 function need(ctx,store,sku,ordinary,daily=0){if(!ctx.controlled.has(sku))return ordinary;if(ctx.active.has(sku)&&!ctx.eligible.get(sku)?.has(store))return 0;if(ctx.pending.has(`${store}|${sku}`)||(ctx.zeroed.has(`${store}|${sku}`)&&!(daily>0)))return 0;const key=`${store}|${sku}`,r=ctx.approved.get(key),netOrdinary=Math.max(0,ordinary-(ctx.held.get(key)||0));if(r)return Math.max(netOrdinary,r.remaining);return ctx.waiting.has(sku)?0:netOrdinary;}
 function claims(ctx,rows){return rows.filter(r=>r.itemType==='regular'&&ctx.approved.has(`${r.storeCode}|${r.sku}`)).map(r=>{const p=ctx.approved.get(`${r.storeCode}|${r.sku}`);return {planId:p.plan_id,revision:p.revision,storeCode:r.storeCode,sku:r.sku,quantity:Math.min(p.remaining,r.suggestedQuantity)};}).filter(r=>r.quantity>0);}
 function weeklyDaily(ctx,store,sku,sales42){
  const ordinary=Math.max(0,sales42)/42,r=ctx.facts.get(`${store}|${sku}`);
  if(!r||!(Number(r.committed_quantity)>0)||!r.first_stock_date||!/^\d{4}-\d{2}-\d{2}$/.test(ctx.latest))return ordinary;
  const days=Math.max(1,Math.min(42,Math.floor((Date.parse(ctx.latest+'T00:00:00Z')-Date.parse(r.first_stock_date+'T00:00:00Z'))/86400000)+1));
  const actual=Math.max(0,sales42)/days,reference=Math.max(0,Number(r.reference_daily||0));
  if(days>=14||!reference)return actual;
  const weight=days/14;return actual*weight+reference*(1-weight);
 }
 function projectionReference(ctx,store,sku,daily){
  const r=ctx.facts.get(`${store}|${sku}`);if(!r||r.status!=='waiting_stock'||Number(r.approved_quantity)<=Number(r.dispatched_quantity))return null;
  const days=r.first_stock_date&&ctx.latest?Math.max(1,(Date.parse(ctx.latest)-Date.parse(r.first_stock_date))/86400000+1):0;
  const reference=Math.max(0,Number(r.reference_daily||0));
  if(daily>0)return {daily,basis:reference&&days<14?'依新品實銷／相似商品綜合估算':'依新品實銷估算'};
  return reference&&(!Number(r.committed_quantity)||days<14)?{daily:reference,basis:'依相似商品估算'}:{daily:0,basis:'資料不足，暫無法推估'};
 }
 function changed(row){return Number(row.confirmed_quantity??row.suggested_quantity)!==Number(row.suggested_quantity)||Number(row.approved_quantity??row.confirmed_quantity??row.suggested_quantity)!==Number(row.confirmed_quantity??row.suggested_quantity)||Boolean(String(row.store_reason||'').trim()||String(row.hq_reason||'').trim());}
 root.NewProductAllocation={STORES,intendedStores,quantity,draft,context,need,claims,weeklyDaily,projectionReference,changed};
})(globalThis);

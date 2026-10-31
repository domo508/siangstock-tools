import * as C from './core.js?v=20261031-store-orders-r37';

const counted=new Set(['reviewed','settled','exported','import_unknown','import_failed','erp_created']);
const excluded=new Set(['pending','needs_info','cancelled']);
const signature=rows=>JSON.stringify(rows.map(r=>[r.id,r.version,r.status,r.batch_id||null,r.store_code,r.business_date]).sort((a,b)=>a[0].localeCompare(b[0])));
function scope(rows,storeCode,businessDate){
 if(!Array.isArray(rows)||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('每日清單格式錯誤或有重複訂單，未產生總表');
 for(const r of rows)if(!/^[a-zA-Z0-9-]{8,80}$/.test(r.id)||!Number.isSafeInteger(r.version)||r.version<1||r.store_code!==storeCode||r.business_date!==businessDate||(!counted.has(r.status)&&!excluded.has(r.status)))throw Error('每日清單的範圍、版本或狀態無效，未產生總表');
}
// Read-only, all-or-nothing collection using the existing authorized order endpoints.
// Never export a partial report after an unreadable order or concurrent update.
export async function collectDailyReport({storeCode,businessDate,queue,read,scan}){
 if(!C.validStoreCode(storeCode)||!C.validDate(businessDate))throw Error('請選擇有效門市與業務日期');
 const before=await queue();scope(before.orders,storeCode,businessDate);
 if(!Array.isArray(before.batches)||before.batches.some(b=>b.status==='preparing'))throw Error('本日仍有交接未完成，請接續交接後再下載每日總表');
 const orders=[];
 // Bound concurrency to avoid overloading Drive; any failure rejects the complete report.
 for(let i=0;i<before.orders.length;i+=3){const batch=await Promise.all(before.orders.slice(i,i+3).map(async r=>{
  let o;try{o=await read(r.id);}catch{throw Error(`訂單 ${r.id} 無法讀取，請確認權限、保存期限與連線；未產生部分總表`);}
  if(!o||o.id!==r.id||o.version!==r.version||o.status!==r.status||o.storeCode!==storeCode||o.businessDate!==businessDate||(o.batchId||null)!==(r.batch_id||null))throw Error('讀取期間訂單已變動，請重新下載每日總表');
  return o;
 }));orders.push(...batch);}
 const sources=await scan(),after=await queue();scope(after.orders,storeCode,businessDate);
 if(signature(before.orders)!==signature(after.orders)||JSON.stringify(before.batches)!==JSON.stringify(after.batches))throw Error('讀取期間本日清單或交接批次已變動，請重新下載每日總表');
 if(!Array.isArray(sources.files))throw Error('無法確認待歸單原圖，未產生每日總表');
 return dailyReport(orders,{storeCode,businessDate,pendingSources:sources.files.filter(f=>!f.orderId).length});
}
export function dailyReport(orders,{storeCode,businessDate,pendingSources=0,generatedAt=new Date().toISOString()}){
 if(!C.validStoreCode(storeCode)||!C.validDate(businessDate)||!Number.isSafeInteger(pendingSources)||pendingSources<0)throw Error('每日總表範圍無效');
 const result={storeCode,businessDate,generatedAt,pendingSources,orders:[],excluded:[],totals:{orders:0,rows:0,quantity:0,amountCents:0,paidCents:0,unpaidCents:0},payments:Object.fromEntries(C.PAYMENTS.map(k=>[k,0]))},ids=new Set(),numbers=new Set();
 for(const o of orders){
  if(!o||ids.has(o.id)||o.storeCode!==storeCode||o.businessDate!==businessDate||(!counted.has(o.status)&&!excluded.has(o.status)))throw Error('每日訂單重複、狀態或範圍不符');
  ids.add(o.id);
  if(excluded.has(o.status)){result.excluded.push({id:o.id,paperNumber:C.text(o.paperNumber),status:o.status});continue;}
  const errors=C.validateOrder(o,{complete:true}).errors;
  if(errors.length)throw Error(`訂單 ${o.paperNumber||o.id} 尚有資料錯誤：${errors.join('；')}；未產生部分總表`);
  const number=C.text(o.paperNumber);if(numbers.has(number))throw Error(`紙本單號 ${number} 重複，請確認後再下載每日總表`);numbers.add(number);
  const t=C.totals(o);for(const k of Object.keys(result.totals)){result.totals[k]+=t[k];if(!Number.isSafeInteger(result.totals[k]))throw Error('每日合計超過允許範圍');}
  for(const k of C.PAYMENTS){result.payments[k]+=C.cents(o.payments[k]);if(!Number.isSafeInteger(result.payments[k]))throw Error('每日付款合計超過允許範圍');}
  // Explicit projection: no customer fields, notes, original extraction or costs in the report.
  result.orders.push({id:o.id,paperNumber:number,status:o.status,version:o.version,totals:t,payments:Object.fromEntries(C.PAYMENTS.map(k=>[k,C.cents(o.payments[k])])),items:o.items.map((item,i)=>({row:i+1,sku:item.sku,name:item.name,color:item.color,size:item.size,quantity:item.quantity,saleType:item.saleType,warehouses:C.warehouses(storeCode,item.saleType),groupId:item.priceGroupId||'',amountCents:C.totalOnlyGroup(o,item)?null:C.lineAmountCents(o,item)})),groups:(o.priceGroups||[]).filter(g=>g.pricingMode==='total_only').map(g=>({id:g.id,code:g.paperCode||g.id,rows:o.items.flatMap((item,i)=>item.priceGroupId===g.id?[i+1]:[]),amountCents:C.cents(g.amount)}))});
 }
 result.orders.sort((a,b)=>a.paperNumber.localeCompare(b.paperNumber));
 if(result.totals.amountCents!==result.totals.paidCents+result.totals.unpaidCents||Object.values(result.payments).reduce((a,b)=>a+b,0)!==result.totals.paidCents)throw Error('每日商品與付款不守恆，未產生總表');
 return result;
}
export function dailyWorkbook(report,XLSX){
 const {totals:t}=report,book=XLSX.utils.book_new(),money=n=>n/100;
 function sheet(name,rows){const s=XLSX.utils.aoa_to_sheet(rows);for(const [key,c] of Object.entries(s))if(!key.startsWith('!')&&typeof c.v==='string'){c.t='s';delete c.f;c.z='@';}s['!cols']=Array.from({length:Math.max(...rows.map(r=>r.length))},(_,i)=>({wch:i===0?24:20}));XLSX.utils.book_append_sheet(book,s,name);}
 sheet('每日帳款總表',[
  ['翔仔居家｜每日帳款核對總表（不可匯入ERP）'],['門市',report.storeCode],['業務日期',report.businessDate],['資料取得時間（台灣）',new Date(report.generatedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})],
  ['口徑','目前雲端保存版本；已覆核及其後續狀態納入，包含未結算單；不代表紙本已全數收齊或實際款項已入帳'],
  ['納入訂單數',t.orders],['商品列數',t.rows],['商品件數',t.quantity],['商品成交總額',money(t.amountCents)],
  ['付款方式','系統收款合計','實際收款（自行核對）'],...C.PAYMENTS.map(k=>[k,money(report.payments[k]),'']),
  ['付款合計',money(t.paidCents)],['歷史未收金額',money(t.unpaidCents)],['商品－付款－歷史未收差額',money(t.amountCents-t.paidCents-t.unpaidCents)],
  ['未納入訂單數',report.excluded.length],['本店待歸單原圖數（日期尚未確認）',report.pendingSources],
  ['完整性提醒',report.pendingSources?'本店尚有未歸單原圖，請確認是否屬於本日；本表不可視為完整日結':'仍請與當日紙本、收銀紀錄逐項核對；未上傳單據不在本表'],
  ['說明','商品明細的組合列不重複列金額；整組總價在組合總價表只計一次。下載不更動訂單或ERP狀態。']
 ]);
 sheet('逐單帳款',[
  ['紙本單號','狀態','版本','商品列數','商品件數','成交總額',...C.PAYMENTS,'付款合計','歷史未收','核對差額','訂單識別'],
  ...report.orders.map(o=>[o.paperNumber,C.STATUS[o.status],o.version,o.totals.rows,o.totals.quantity,money(o.totals.amountCents),...C.PAYMENTS.map(k=>money(o.payments[k])),money(o.totals.paidCents),money(o.totals.unpaidCents),money(o.totals.amountCents-o.totals.paidCents-o.totals.unpaidCents),o.id])
 ]);
 sheet('商品明細',[
  ['紙本單號','列號','貨號','品名','顏色','尺碼','數量','本列總金額（組合見另表）','銷別','開單倉庫','出貨倉庫','取貨倉庫','組合識別'],
  ...report.orders.flatMap(o=>o.items.map(i=>[o.paperNumber,i.row,i.sku,i.name,i.color,i.size,i.quantity,i.amountCents===null?'含於整組總價':money(i.amountCents),i.saleType,...i.warehouses,i.groupId]))
 ]);
 sheet('組合總價',[
  ['紙本單號','組合代號','商品列號','整組總金額（只計一次）'],
  ...report.orders.flatMap(o=>o.groups.map(g=>[o.paperNumber,g.code,g.rows.join('、'),money(g.amountCents)]))
 ]);
 sheet('未納入帳款',[
  ['紙本單號','狀態','原因','訂單識別'],...report.excluded.map(o=>[o.paperNumber,C.STATUS[o.status],o.status==='cancelled'?'已取消，不計入帳款':'尚未完成覆核，不計入帳款；請確認是否須補件或續作',o.id])
 ]);
 return book;
}

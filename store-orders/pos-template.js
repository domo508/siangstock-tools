import {resolvedERPPrices} from "./bundle-pricing.js?v=20261031-store-orders-r35";
// Revised ERP template: explicit columns, never copy sample orders or infer payment semantics.
import * as C from './core.js?v=20261031-store-orders-r35';
export const BASE_HEADERS=Object.freeze(['單號','結帳日期','開單倉庫','出貨倉庫','取貨倉庫','會員編號','姓名','電話','地址','備註','中信信用卡','現金','百貨現金卷','LinePay','銷別','貨號','數量','顏色','色號','尺碼','碼號','贈品','導購','實收率']);
const PRICE_HEADERS=['價格'];
export const FINAL_HEADERS=Object.freeze([...BASE_HEADERS.slice(0,17),'價格',...BASE_HEADERS.slice(17)]);
export const TEMPLATE_WRITE_OPTIONS=Object.freeze({bookType:'xlsx',type:'array'});
export function readPOSTemplate(wb,XLSX){
 if(wb.SheetNames.length!==1||wb.SheetNames[0]!=='Sheet1')throw Error('POS範本需為單一Sheet1工作表');
 const ws=wb.Sheets.Sheet1,rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''}),headers=(rows[1]||[]).map(C.text);
 const prices=headers.filter(h=>PRICE_HEADERS.includes(h));
 if(JSON.stringify(headers)!==JSON.stringify(FINAL_HEADERS))throw Error('POS範本欄位與最終25欄格式不符，R欄須為價格，請使用工程師確認版');
 if(headers.some((h,c)=>ws[XLSX.utils.encode_cell({r:1,c})]?.f))throw Error('POS範本欄名不得使用公式');
 const cells=[];for(let r=0;r<2;r++)for(let c=0;c<headers.length;c++){const cell=ws[XLSX.utils.encode_cell({r,c})];if(cell?.f)throw Error('POS範本表頭不得使用公式');if(cell)cells.push({r,c,value:cell.v??'',style:cell.s?structuredClone(cell.s):null,format:cell.z||null});}
 return {headers,priceHeader:prices[0]||'',cells,merges:structuredClone(ws['!merges']||[]).filter(m=>m.s.r===0&&m.e.r===0&&m.e.c<headers.length),format:'20261030-final'};
}
export function revisedPOSErrors(orders,{template,paymentMappingConfirmed=false}={}){
 const errors=[];
 if(!template)errors.push('請載入含每列單價的最終POS範本');
 else if(JSON.stringify(template.headers)!==JSON.stringify(FINAL_HEADERS)||template.priceHeader!=='價格')errors.push('請重新載入R欄為價格的最終25欄POS範本');
 if(!paymentMappingConfirmed)errors.push('付款欄位對照尚未確認，請核對四種付款方式');
 for(const o of orders)try{resolvedERPPrices(o);}catch(e){errors.push(e.message);}
 return errors;
}
export function revisedPOSRows(orders,profile={}){
 const errors=revisedPOSErrors(orders,profile);if(errors.length)throw Error(errors.join('；'));
 const numbers=new Set();
 return orders.flatMap(order=>{
  const check=C.validateOrder(order,{complete:true});if(check.errors.length)throw Error(check.errors.join('；'));
  if(numbers.has(order.paperNumber))throw Error('紙本單號重複，已停止產檔');numbers.add(order.paperNumber);
  const resolved=resolvedERPPrices(order);
  return order.items.map((item,i)=>{
   const [billing,shipping,pickup]=C.warehouses(order.storeCode,item.saleType);
   const value={'單號':order.paperNumber,'結帳日期':order.businessDate.replaceAll('-','/'),'開單倉庫':billing,'出貨倉庫':shipping,'取貨倉庫':pickup,'會員編號':String(order.memberNumber??''),'姓名':String(order.customer?.name??''),'電話':String(order.customer?.phone??''),'地址':String(order.customer?.address??''),'備註':String(order.note??''),'中信信用卡':i===0?C.cents(order.payments['中信信用卡'])/100:'','現金':i===0?C.cents(order.payments['現金'])/100:'','百貨現金卷':i===0?C.cents(order.payments['百貨現金卷'])/100:'','LinePay':i===0?C.cents(order.payments.LinePay)/100:'','銷別':item.saleType,'貨號':C.text(item.sku),'數量':item.quantity,'顏色':C.text(item.color),'色號':C.text(item.colorCode),'尺碼':C.text(item.size),'碼號':C.text(item.sizeCode),'贈品':'','導購':'','實收率':100,[profile.template.priceHeader]:resolved.prices.get(i)};
   return profile.template.headers.map(h=>value[h]);
  });
 });
}
export function assertRevisedPOSConservation(orders,rows,headers){
 const col=h=>headers.indexOf(h),expectedRows=orders.reduce((n,o)=>n+o.items.length,0);
 if(rows.length!==expectedRows||rows.some(r=>r.length!==headers.length))throw Error('新版POS列數或欄數不守恆');
 for(const o of orders){const actual=rows.filter(r=>r[col('單號')]===o.paperNumber),t=C.totals(o);let qty=0,amount=0,paid=0;
  if(actual.length!==o.items.length)throw Error('新版POS品項列數不守恆');
  const priceCol=headers.findIndex(h=>PRICE_HEADERS.includes(h)),resolved=resolvedERPPrices(o);
  for(const [i,r] of actual.entries()){const item=o.items[i];if(r[col('會員編號')]!==String(o.memberNumber??''))throw Error('POS會員編號與覆核內容不一致');if(r[col('貨號')]!==C.text(item.sku)||r[col('數量')]!==item.quantity||r[priceCol]!==resolved.prices.get(i)||r[col('銷別')]!==item.saleType||JSON.stringify(['開單倉庫','出貨倉庫','取貨倉庫'].map(h=>r[col(h)]))!==JSON.stringify(C.warehouses(o.storeCode,item.saleType)))throw Error('新版POS貨號、數量、價格或倉庫不守恆');qty+=r[col('數量')];amount+=r[col('數量')]*C.cents(r[priceCol]);paid+=['中信信用卡','現金','百貨現金卷','LinePay'].reduce((n,h)=>n+C.cents(r[col(h)]===''?0:r[col(h)]),0);}
  if(qty!==t.quantity||amount!==t.amountCents||paid!==t.paidCents)throw Error('新版POS件數、成交金額或付款不守恆');
  for(const [header,key] of [['中信信用卡','中信信用卡'],['現金','現金'],['百貨現金卷','百貨現金卷'],['LinePay','LinePay']]){const sum=actual.reduce((n,r)=>n+C.cents(r[col(header)]===''?0:r[col(header)]),0);if(sum!==C.cents(o.payments[key]))throw Error('新版POS付款方式對照或各項金額不守恆');}
 }
}
export function buildRevisedPOS(orders,XLSX,profile={}){
 const rows=revisedPOSRows(orders,profile),t=profile.template;assertRevisedPOSConservation(orders,rows,t.headers);
 const ws=XLSX.utils.aoa_to_sheet([[],t.headers,...rows]);for(const cell of t.cells){const k=XLSX.utils.encode_cell({r:cell.r,c:cell.c});ws[k]={t:typeof cell.value==='number'?'n':'s',v:cell.value,...(cell.style?{s:structuredClone(cell.style)}:{}),...(cell.format?{z:cell.format}:{})};}
 ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length+1,c:t.headers.length-1}});ws['!merges']=structuredClone(t.merges);
 let start=2;for(const order of orders){const end=start+order.items.length-1;for(let c=0;c<14;c++){let first=start;for(let r=start+1;r<=end+1;r++){const same=r<=end&&(c>=10||rows[r-2][c]===rows[first-2][c]);if(same)continue;if(r-first>1){ws['!merges'].push({s:{r:first,c},e:{r:r-1,c}});for(let covered=first+1;covered<r;covered++)delete ws[XLSX.utils.encode_cell({r:covered,c})];}first=r;}}start=end+1;}
 rows.forEach((row,r)=>row.forEach((v,c)=>{const cell=ws[XLSX.utils.encode_cell({r:r+2,c})];if(cell&&typeof v==='string'){cell.t='s';delete cell.f;cell.z='@';}}));
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Sheet1');
 const roundtrip=XLSX.read(XLSX.write(wb,TEMPLATE_WRITE_OPTIONS),C.READ_OPTIONS);assertMergedPOSConservation(orders,roundtrip,XLSX,t.headers);return wb;
}

// Expand shared order cells only; payment is recorded once at its merge anchor.
export function assertMergedPOSConservation(orders,wb,XLSX,headers){
 const ws=wb.Sheets.Sheet1,rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''}).slice(2);
 const expected=revisedPOSRows(orders,{template:{headers,priceHeader:'價格'},paymentMappingConfirmed:true});
 const boundaries=[];let at=2;for(const o of orders){boundaries.push({start:at,end:at+o.items.length-1});at+=o.items.length;}
 const covered=new Set();for(const m of ws['!merges']||[]){if(m.s.r===0&&m.e.r===0)continue;
  if(!Number.isInteger(m.s.r)||!Number.isInteger(m.e.r)||m.e.r<=m.s.r||m.s.c!==m.e.c||m.s.c<0||m.s.c>=14||!boundaries.some(b=>m.s.r>=b.start&&m.e.r<=b.end))throw Error('POS合併範圍跨單或覆蓋商品明細');
  for(let r=m.s.r;r<=m.e.r;r++){const key=r+':'+m.s.c;if(covered.has(key))throw Error('POS合併範圍重疊');covered.add(key);if(r===m.s.r)continue;const value=rows[r-2]?.[m.s.c];if(value!==''&&value!==undefined)throw Error('POS合併範圍含隱藏資料');if(m.s.c<10){if(expected[r-2][m.s.c]!==expected[m.s.r-2][m.s.c])throw Error('POS合併範圍含不同倉庫或訂單資訊');rows[r-2][m.s.c]=rows[m.s.r-2][m.s.c];}}
 }
 if(JSON.stringify(rows)!==JSON.stringify(expected))throw Error('POS合併後資訊與覆核內容不一致');
 assertRevisedPOSConservation(orders,rows,headers);return rows;
}

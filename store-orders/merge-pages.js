import {validateExtraction,normalizePaperDate} from './recognition.js?v=20261030-store-orders-r26';
import {text} from './core.js?v=20261030-store-orders-r26';
// The source pages remain immutable evidence. Never sum repeated order-level payments.
export function mergeFullPages(input){
 if(!Array.isArray(input)||!input.length||input.length>30)throw Error('請收齊1至30頁來源');
 const pages=input.map(p=>validateExtraction(p));if(pages.some(p=>!p.header))throw Error('來源缺少完整表頭');
 const numbers=new Set(pages.map(p=>text(p.header.paperNumber)).filter(Boolean));if(numbers.size>1)throw Error('來源訂單編號不同，不能合併為同一張訂單');
 const stores=new Set(pages.map(p=>text(p.header.storeCode).toUpperCase()).filter(Boolean));if(stores.size>1)throw Error('來源門市不同，不能合併');
 const bases=new Set(pages.map(p=>p.priceBasis||'unit'));if(bases.size>1)throw Error('來源價格填法不同，不能自動合併');
 const lineTotals=pages[0].priceBasis==='line_total';
 const known=pages.map(p=>p.header.pageNumber).filter(n=>n!==null);if(new Set(known).size!==known.length)throw Error('來源頁碼重複，請核對是否重傳');
 const sorted=[...pages].sort((a,b)=>(a.header.pageNumber??31)-(b.header.pageNumber??31));
 const out=structuredClone(sorted[0]);out.rows=[];out.sharedPrices=[];out.warnings=pages.flatMap(p=>p.warnings);out.header.uncertainFields=[...new Set(pages.flatMap(p=>p.header.uncertainFields))];
 const uncertain=k=>{if(!out.header.uncertainFields.includes(k))out.header.uncertainFields.push(k);out.warnings.push(`多頁${k}不一致或未填，請對照所有原圖修正`);};
 function select(values,key,empty=''){const usable=[...new Set(values.filter(v=>v!==null&&v!==''&&v!==undefined))];if(usable.length>1){uncertain(key);return empty;}return usable[0]??empty;}
 for(const k of ['paperNumber','storeCode','clerk','note','memberNumber'])out.header[k]=select(pages.map(p=>p.header[k]),k);
 out.header.businessDate=select(pages.map(p=>normalizePaperDate(p.header.businessDate)),'businessDate');
 for(const k of ['name','phone','address'])out.header.customer[k]=select(pages.map(p=>p.header.customer[k]),'customer.'+k);
 for(const k of ['paperRowCount','pageCount'])out.header[k]=select(pages.map(p=>p.header[k]),k,null);
 if(!lineTotals&&(known.length!==pages.length||known.some(n=>n>pages.length)||out.header.pageCount!==pages.length)){uncertain('pageCount');}
 out.header.pageNumber=1;
 out.paperTotal=select(pages.map(p=>p.paperTotal),'paperTotal',null);
 for(const k of Object.keys(out.payments)){const values=pages.map(p=>p.payments[k]),nonzero=values.filter(v=>v!==0&&v!==null);out.payments[k]=nonzero.length?select(nonzero,'payments.'+k,null):values.some(v=>v===null)?null:0;}
 for(const page of sorted){const map=new Map();for(const r of page.rows){const row=out.rows.length+1;map.set(r.row,row);out.rows.push({...r,row});}for(const g of page.sharedPrices)out.sharedPrices.push({...g,rows:g.rows.map(n=>map.get(n))});}
 // Same explicit combination code across pages is still one combination.
 const codes=new Set(out.rows.map(r=>r.groupCode).filter(Boolean));
 for(const code of codes){const ids=out.rows.filter(r=>r.groupCode===code).map(r=>r.row),groups=out.sharedPrices.filter(g=>g.rows.some(n=>ids.includes(n)));if(groups.some(g=>g.rows.some(n=>!ids.includes(n))))throw Error('跨頁組合代號與括號範圍不一致，請人工輸入');const amounts=[...new Set(groups.map(g=>g.amount).filter(v=>v!==null))];out.sharedPrices=out.sharedPrices.filter(g=>!groups.includes(g));out.sharedPrices.push({rows:ids,amount:amounts.length===1?amounts[0]:null});if(amounts.length>1)out.warnings.push(`組合${code}跨頁總價不一致，請人工修正`);}
 if(lineTotals){out.header.pageCount=pages.length;out.header.paperRowCount=out.rows.length;}
 // Old payloads keep their exact header shape for strict backup compatibility.
 if(!pages.some(p=>Object.hasOwn(p.header,'memberNumber')))delete out.header.memberNumber;
 return validateExtraction(out);
}

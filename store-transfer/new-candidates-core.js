(function(root){
 'use strict';
 const VERSION='20261123-prepurchase-r4';
 function normalize(v){return String(v??'').normalize('NFKC').trim();}
 function isCustomSku(value){return /^(?:SA|SB|O)/.test(normalize(value).toUpperCase());}
 function createdDate(value,X){
  if(Object.prototype.toString.call(value)==='[object Date]'&&Number.isFinite(value.getTime()))value=`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  if(typeof value==='number'){const d=X.SSF.parse_date_code(value);value=d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:'';}
  const s=normalize(value).replace(/\//g,'-'),m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);if(!m)return '';
  const date=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  if(date<'1900-01-01'||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)return '';return date;
 }
 function parse(workbook,X,baseline=false){
  const sheets=workbook.SheetNames.map(name=>({name,rows:X.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:'',raw:true})}));
  const hits=[];for(const sheet of sheets)for(let i=0;i<Math.min(20,sheet.rows.length);i++){const h=sheet.rows[i].map(normalize);if(h.includes('貨號')&&h.includes('品名'))hits.push({...sheet,index:i,h});}
  if(hits.length!==1)throw Error('商品主檔須有唯一含「貨號、品名」的表頭。');
  const {rows,index,h}=hits[0],skuAt=h.indexOf('貨號'),nameAt=h.indexOf('品名'),dateAt=h.indexOf('新增日期');
  if(!baseline&&dateAt<0)throw Error('最新主檔缺少「新增日期」，未更新候選名單。');
  for(const label of ['貨號','品名',...(!baseline?['新增日期']:[])])if(h.filter(x=>x===label).length!==1)throw Error('主檔欄位重複：'+label);
  const result=[],seen=new Set(),invalid=[];
  for(let i=index+1;i<rows.length;i++){const r=rows[i];if(r.every(v=>normalize(v)===''))continue;const sku=normalize(r[skuAt]).toUpperCase(),name=normalize(r[nameAt]);if(!sku||!name)throw Error(`商品主檔第${i+1}列缺少貨號或品名，未更新候選。`);if(seen.has(sku))throw Error(`商品主檔第${i+1}列品號${sku}重複，未更新候選。`);seen.add(sku);
   const date=baseline?'':createdDate(r[dateAt],X);if(!baseline&&!date)invalid.push({row:i+1,sku});result.push(baseline?{sku}:{sku,name,createdDate:date});}
  if(!result.length)throw Error('商品主檔沒有有效商品，未更新候選。');if(!baseline&&invalid.length===result.length)throw Error('所有新增日期都無效，未更新候選；請先補正主檔。');return {rows:result,invalid};
 }
 function versions(files){const sorted=[...files].sort((a,b)=>Date.parse(b.modifiedTime)-Date.parse(a.modifiedTime));if(sorted.length<2||sorted.some(f=>!Number.isFinite(Date.parse(f.modifiedTime))))throw Error('需保留至少兩份有版本時間的主檔，首次不會把整份主檔當新品。');if(sorted[0].modifiedTime===sorted[1].modifiedTime)throw Error('最新主檔時間相同，請確認唯一最新版本。');return sorted;}
 function age(date,today){return Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000);}
 root.NewProductCandidates={VERSION,isCustomSku,createdDate,parse,versions,age};
})(globalThis);

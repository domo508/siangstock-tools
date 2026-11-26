// UI-only version: never change parser/source fingerprints or existing approvals.
const MS_NAV_VERSION='20261105-marketing-batch-nav-r3';
function marketingNavigationTitle_(row){return String(row[2]||row[1]||'未命名活動').split('\n')[0].split('｜').pop().trim();}
function marketingNavigationRows_(s,id,run){
  if(s.getLastRow()<2)return [];
  return s.getRange(2,1,s.getLastRow()-1,12).getValues().map((values,i)=>({values,row:i+2})).filter(x=>x.values[7]===id&&x.values[8]===run);
}
function marketingNavigationLink_(text,url){return SpreadsheetApp.newRichTextValue().setText(text).setLinkUrl(url).build();}
function marketingNavigationLabels_(o,items){
  const title=marketingNavigationTitle_(o.values),count=items.filter(x=>x.values[1]).length;
  return {main:'查看'+count+'個品號\n'+title,back:title+'（'+count+'候選）\n↩ '+o.sheet.getName()+'第'+o.row+'列',
    note:'活動：'+o.values[1]+'\n優惠：'+o.values[2]+'\n期間：'+o.values[3]+'～'+o.values[4]+'\n通路：'+o.values[5]+'／'+o.values[6]+'\n'+o.values[8]};
}
function refreshMarketingNavigation_(ss,run){
  const details=ss.getSheetByName('活動商品明細'),all=details.getLastRow()>1?details.getRange(2,1,details.getLastRow()-1,12).getValues():[],offers=new Map(),plans=[];
  ['活動案型','贈品／加價購案型'].forEach(name=>{
    const sheet=ss.getSheetByName(name),h=MS_TABLES[name];if(sheet.getLastRow()<2)return;
    sheet.getRange(2,1,sheet.getLastRow()-1,h.length).getValues().forEach((values,i)=>{
      if(values[h.indexOf('同步版本')]!==run)return;const id=values[h.indexOf('案型識別碼')];if(offers.has(id))throw new Error('案型識別碼重複，不更新導覽。');offers.set(id,{sheet,row:i+2,values});
    });
  });
  const grouped=new Map();all.forEach((values,i)=>{if(values[8]!==run)return;if(!offers.has(values[7]))throw new Error('商品明細缺少唯一主表，不更新導覽。');if(!grouped.has(values[7]))grouped.set(values[7],[]);grouped.get(values[7]).push({values,row:i+2});});
  // Plan all positions before writing. Canonical values, Booleans and decisions
  // stay untouched; column G and final navigation cells are excluded from hashes.
  offers.forEach((o,id)=>{const items=grouped.get(id)||[],labels=marketingNavigationLabels_(o,items);plans.push({o,items,labels});});
  plans.forEach(({o,items,labels})=>{
    if(!items.length&&o.sheet.getName()==='活動案型'&&marketingWholeStoreOffer_(o.values)){
      const h=MS_TABLES[o.sheet.getName()];o.sheet.getRange(o.row,h.length).setValue('').setNote('');
      o.sheet.getRange(o.row,h.indexOf('商品命中摘要')+1).setValue('');return;
    }
    const h=MS_TABLES[o.sheet.getName()],range=items.length?'A'+items[0].row+':G'+items[items.length-1].row:'A1';
    o.sheet.getRange(o.row,h.length).setRichTextValue(marketingNavigationLink_(labels.main,'#gid='+details.getSheetId()+'&range='+range)).setNote('點選此格會自動定位；若沒有切換，使用「行銷同步（測試）→查看本活動商品明細」。\n'+labels.note);
    for(let i=0;i<items.length;){let end=i+1;while(end<items.length&&items[end].row===items[end-1].row+1)end++;
      const r=details.getRange(items[i].row,7,end-i,1);
      r.setRichTextValues(items.slice(i,end).map(()=>[marketingNavigationLink_(labels.back,'#gid='+o.sheet.getSheetId()+'&range=A'+o.row)])).setNote(labels.note);i=end;
    }
  });
  details.setColumnWidth(7,270);SpreadsheetApp.flush();
  const after=details.getLastRow()>1?details.getRange(2,1,details.getLastRow()-1,12).getValues():[];
  if(after.length!==all.length||all.some((r,i)=>r.some((v,j)=>j!==6&&v!==after[i][j])))throw new Error('導覽更新影響商品資料，停止驗收。');
  return {offers:plans.length,details:all.filter(r=>r[8]===run).length};
}
function upgradeMarketingNavigation(){
  const ss=assertMarketingBook_(),lock=LockService.getDocumentLock();if(!lock.tryLock(1000))throw new Error('目前有同步或覆核作業處理中，尚未更新導覽。請稍候再試；與在線人數無關。');
  try{const c=ss.getSheetByName(MS_CONTROL),label=c.getRange('A14').getDisplayValue();if(label&&label!=='商品比對導覽')throw new Error('控制台A14已有其它內容，停止更新。');
    const result=refreshMarketingNavigation_(ss,c.getRange('B7').getDisplayValue());c.getRange('A14:B14').setValues([['商品比對導覽',MS_NAV_VERSION]]);SpreadsheetApp.flush();return result;
  }finally{lock.releaseLock();}
}
function returnMarketingOffer(){
  const ss=assertMarketingBook_(),o=marketingSelectedOffer_(ss);ss.setActiveSheet(o.sheet);ss.setActiveRange(o.sheet.getRange(o.row,2));ss.toast('已返回：'+marketingNavigationTitle_(o.values),'對應活動',6);
}
function onSelectionChange(e){
  if(!e?.range||e.source.getId()!==MS_ID)return;const r=e.range,name=r.getSheet().getName();if(r.getRow()<2)return;
  const main=['活動案型','贈品／加價購案型'].includes(name)&&r.getColumn()===MS_TABLES[name].length&&r.getNumRows()===1;
  // Native hyperlinks may land under a previous offer's filter. The A:G target
  // is distinguishable from ordinary checkbox/name clicks, which must not move.
  const target=name==='活動商品明細'&&r.getColumn()===1&&r.getNumColumns()===7;
  if(!main&&!target)return;
  try{const o=marketingOfferAtRange_(e.source,r);if(main&&o.sheet.getName()==='活動案型'&&marketingWholeStoreOffer_(o.values))return;openMarketingProducts_(e.source,o);}catch(error){e.source.toast('無法自動定位：'+error.message+' 可使用選單「查看本活動商品明細」。','商品比對',10);}
}

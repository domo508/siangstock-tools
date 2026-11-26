function marketingProductKey_(run,id){return 'marketing-products:'+run+':'+id;}
function linkMarketingProducts_(ss,writes,snapshots,master){
  const detail=ss.getSheetByName('活動商品明細'),dw=writes.find(w=>w.n==='活動商品明細');
  const props=PropertiesService.getDocumentProperties(),parents=new Map();
  snapshots.forEach(snapshot=>{const w=writes.find(w=>w.n===snapshot.name),h=MS_TABLES[w.n],i=w.rows.findIndex(r=>r[h.indexOf('案型識別碼')]===snapshot.id);if(i<0||parents.has(snapshot.id))throw new Error('主表對應不唯一。');parents.set(snapshot.id,{w,r:w.r+i});});
  // Preserved manual rows are physically at the end, not beside their offer.
  // Resolve every real row by stable ID + generation, never a running cursor.
  let actual=[];
  if(dw){
    actual=detail.getRange(dw.r,1,dw.rows.length,12).getValues();
    actual.forEach(row=>{const p=parents.get(row[7]);if(!p||row[8]!==snapshots[0].run||row[10]!==p.w.n)throw new Error('明細缺少唯一主表，不啟用新版本。');row[11]=p.r;});
    detail.getRange(dw.r,12,actual.length,1).setValues(actual.map(row=>[row[11]]));SpreadsheetApp.flush();
    const readback=detail.getRange(dw.r,1,actual.length,12).getValues();if(JSON.stringify(readback)!==JSON.stringify(actual))throw new Error('主表列號回讀不一致，不啟用新版本。');
  }
  const pending=[];
  snapshots.forEach(snapshot=>{
    const {r}=parents.get(snapshot.id);
    snapshot.details.forEach(row=>row[11]=r);
    const rows=actual.filter(x=>x[7]===snapshot.id&&x[8]===snapshot.run);
    if(rows.length!==snapshot.details.length||marketingDetailHash_(rows,true)!==marketingDetailHash_(snapshot.details,true))throw new Error('完整明細／勾選與快照不一致，不啟用新版本。');
    pending.push([marketingProductKey_(snapshot.run,snapshot.id),JSON.stringify({offerHash:snapshot.offerHash,matchHash:snapshot.matchHash,detailHash:marketingDetailHash_(snapshot.details,false),master:master.fingerprint,count:snapshot.details.length,notApplicable:snapshot.notApplicable,decisionHash:snapshot.carry?marketingDetailHash_(snapshot.details,true):'',...(snapshot.carry?{carry:snapshot.carry,confirmedSkus:snapshot.confirmedSkus}:{} )})]);
  });
  pending.forEach(([key,value])=>marketingSaveSnapshot_(key,JSON.parse(value)));
  refreshMarketingNavigation_(ss,snapshots[0]?.run||'');SpreadsheetApp.flush();
}

// One-time narrowly verified r9 repair. Never re-sign arbitrary edited rows.
function repairMarketingDetailMapping(){
 const ss=assertMarketingBook_(),lock=LockService.getDocumentLock();if(!lock.tryLock(1000))throw new Error('目前有同步或覆核作業處理中，本次尚未送出。請稍候再試；與在線人數無關。');
 try{
  const c=ss.getSheetByName(MS_CONTROL),run=c.getRange('B7').getDisplayValue();
  if(c.getRange('B15').getDisplayValue()!=='20261105-whole-store-blank-r9')throw new Error('僅限已確認的r9明細列號修復。');
  const sourceBefore=JSON.stringify(readMarketingSource_(ss,c)),s=ss.getSheetByName('活動商品明細'),index=s.getRange(2,8,s.getLastRow()-1,2).getValues(),positions=index.flatMap((r,i)=>r[1]===run?[i+2]:[]),plans=[],grouped=new Map();
  if(!positions.length)throw new Error('沒有當期明細，不進行修復。');
  const start=positions[0],count=positions.at(-1)-start+1,all=s.getRange(start,1,count,12).getValues();
  all.forEach((values,i)=>{if(values[8]!==run)return;if(!grouped.has(values[7]))grouped.set(values[7],[]);grouped.get(values[7]).push({values,row:start+i});});
  const offers=marketingCurrentOffers_(ss,run),ids=new Set(offers.map(marketingReviewId_));if([...grouped.keys()].some(id=>!ids.has(id)))throw new Error('明細缺少對應活動。');
  offers.forEach(o=>{
   const snap=marketingSnapshot_(run,marketingReviewId_(o)),items=grouped.get(marketingReviewId_(o))||[],normalized=items.map(x=>{const v=x.values.slice();v[11]=o.row;return v;});
   // Only restore L if all immutable original fields, including the original
   // master fingerprint, match the original snapshot exactly. No re-signing.
   if(!snap||items.length!==snap.count||marketingDetailHash_(normalized,false)!==snap.detailHash||items.some(x=>x.values[10]!==o.sheet.getName()||x.values[9]!==snap.master))throw new Error('非單純列號錯位，停止修復：'+marketingReviewId_(o));
   items.forEach(x=>{if(x.values[11]!==o.row)plans.push({row:x.row,expected:o.row});});
  });
  console.log(JSON.stringify({stage:'原快照逐項核對通過',offers:offers.length,repair:plans.length}));
  if(JSON.stringify(readMarketingSource_(ss,c))!==sourceBefore||c.getRange('B7').getDisplayValue()!==run||JSON.stringify(s.getRange(start,1,count,12).getValues())!==JSON.stringify(all))throw new Error('修復前來源或明細已變動。');
  const expected=new Map(plans.map(p=>[p.row,p.expected]));if(plans.length)s.getRange(start,12,count,1).setValues(all.map((r,i)=>[expected.has(start+i)?expected.get(start+i):r[11]]));SpreadsheetApp.flush();
  const after=s.getRange(start,1,count,12).getValues();
  if(after.length!==all.length||all.some((r,i)=>r.some((v,j)=>after[i][j]!== (j===11&&expected.has(start+i)?expected.get(start+i):v))))throw new Error('修復回讀不一致，停止後續操作。');
  const result={run,repaired:plans.length,rows:all.filter(r=>r[8]===run).length,conservation:true};console.log(JSON.stringify(result));return result;
 }finally{lock.releaseLock();}
}
function marketingSelectedOffer_(ss){
  return marketingOfferAtRange_(ss,ss.getActiveSheet().getActiveRange());
}
function marketingOfferAtRange_(ss,range){
  const sheet=range.getSheet(),r=range.getRow(),name=sheet.getName();if(r<2)throw new Error('請先點選一筆活動或商品明細。');
  if(name==='活動商品明細'){
    const row=sheet.getRange(r,1,1,MS_TABLES[name].length).getValues()[0],target=ss.getSheetByName(String(row[10])),headers=target&&MS_TABLES[target.getName()];
    if(!target||!headers||target.getLastRow()<2)throw new Error('明細缺少主表連結。');
    const matches=target.getRange(2,1,target.getLastRow()-1,headers.length).getValues().map((v,i)=>({values:v,row:i+2})).filter(x=>x.values[headers.indexOf('案型識別碼')]===row[7]&&x.values[headers.indexOf('同步版本')]===row[8]);
    if(matches.length!==1)throw new Error('明細對應主表不唯一，停止確認。');return {sheet:target,...matches[0]};
  }
  if(!['活動案型','贈品／加價購案型'].includes(name))throw new Error('請先在活動主表或商品明細選取一筆資料。');
  return {sheet,row:r,values:sheet.getRange(r,1,1,MS_TABLES[name].length).getValues()[0]};
}
function marketingOfferDetails_(ss,id,run){
  const sheet=ss.getSheetByName('活動商品明細');if(sheet.getLastRow()<2)return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,MS_TABLES['活動商品明細'].length).getValues().filter(r=>r[7]===id&&r[8]===run);
}
function showMarketingProducts(){
  const ss=assertMarketingBook_();return openMarketingProducts_(ss,marketingSelectedOffer_(ss));
}
function openMarketingProducts_(ss,o){
  const h=MS_TABLES[o.sheet.getName()],id=o.values[h.indexOf('案型識別碼')],run=o.values[h.indexOf('同步版本')],s=ss.getSheetByName('活動商品明細');
  if(ss.getSheetByName(MS_CONTROL).getRange('B14').getDisplayValue()!==MS_NAV_VERSION)throw new Error('商品導覽版本不同，請更新比對導覽後重新載入。');
  const matches=marketingNavigationRows_(s,id,run);if(!matches.length){ss.setActiveSheet(o.sheet);ss.setActiveRange(o.sheet.getRange(o.row,h.indexOf('商品命中摘要')+1));ss.toast('本活動沒有候選明細；請查看商品命中摘要，抽獎資格不配發實體商品。','沒有商品明細',8);return;}
  if(s.getFilter())s.getFilter().remove();const f=s.getDataRange().createFilter();
  f.setColumnFilterCriteria(8,SpreadsheetApp.newFilterCriteria().whenTextEqualTo(id).build());f.setColumnFilterCriteria(9,SpreadsheetApp.newFilterCriteria().whenTextEqualTo(run).build());
  ss.setActiveSheet(s);ss.setActiveRange(s.getRange(matches[0].row,2));SpreadsheetApp.flush();
  ss.toast('正在比對：'+marketingNavigationTitle_(o.values)+'｜候選'+matches.filter(x=>x.values[1]).length+'個品號｜'+o.values[3]+'～'+o.values[4],'本活動商品',10);
}
function marketingProductDecision_(row,details,snapshot,masterFingerprint,allowReviewEdits){
  if(!snapshot||snapshot.master!==masterFingerprint||snapshot.offerHash!==marketingOfferHash_(row)&&!(allowReviewEdits&&snapshot.matchHash===marketingMatchHash_(row)))throw new Error('商品條件或商品主檔已變動，請補正來源後重新同步比對。');
  if(details.length!==snapshot.count||marketingDetailHash_(details,false)!==snapshot.detailHash)throw new Error('商品明細已被刪除或改寫，請重新同步，不可直接確認。');
  if(snapshot.notApplicable)return {count:0,decisionHash:marketingDetailHash_(details,true)};
  if(!details.length||!details.some(r=>r[1])||details.some(r=>r[0]===true&&(!r[1]||/主檔無此品號/.test(r[3]))))throw new Error('尚有已選商品未命中／主檔無品號，請取消無效選項或人工加入有效品號。');
  if(details.some(r=>typeof r[0]!=='boolean'))throw new Error('納入活動欄位必須使用勾選框。');
  const count=details.filter(r=>r[0]).length;if(!count)throw new Error('未勾選任何商品，不可確認空集合；若不適用請在主表標示。');
  return {count,decisionHash:marketingDetailHash_(details,true)};
}
function confirmMarketingProducts(){return previewMarketingSelected();}
function commitMarketingOffer_(ss,o,master){
 if(PropertiesService.getDocumentProperties().getProperty('marketing-batch-pending'))throw new Error('批次回寫尚待對帳，暫停覆核。');
 marketingAssertActiveOffer_(ss,o,o.values[MS_TABLES[o.sheet.getName()].indexOf('同步版本')]);
  const c=ss.getSheetByName(MS_CONTROL),h=MS_TABLES[o.sheet.getName()],run=o.values[h.indexOf('同步版本')],id=o.values[h.indexOf('案型識別碼')];
  if(c.getRange('B1').getDisplayValue()!==MS_VERSION||run!==c.getRange('B7').getDisplayValue())throw new Error('請使用最新成功同步版本。');
  const props=PropertiesService.getDocumentProperties(),key=marketingProductKey_(run,id),snapshot=marketingSnapshot_(run,id),details=marketingOfferDetails_(ss,id,run);
  const result=marketingProductDecision_(o.values,details,snapshot,master.fingerprint,true);
  for(const d of details.filter(d=>d[0]===true)){
    const p=master.products.find(p=>p.sku===d[1]);
    if(p&&marketingProductExclusion_(p))throw new Error(d[1]+'不列活動商品：'+marketingProductExclusion_(p)+'。');
  }
  SpreadsheetApp.flush();
  const current=o.sheet.getRange(o.row,1,1,h.length).getValues()[0],currentDetails=marketingOfferDetails_(ss,id,run);
  if(marketingOfferHash_(current)!==marketingOfferHash_(o.values)||marketingDetailHash_(currentDetails,true)!==result.decisionHash||latestMarketingMaster_().identity!==master.identity||marketingHash_({source:readMarketingSource_(ss,c),master:master.fingerprint})!==c.getRange('B8').getDisplayValue())throw new Error('確認期間資料被更動，請重新檢查。');
  if(o.sheet.getName()==='贈品／加價購案型'&&!snapshot.notApplicable){current[11]=currentDetails.filter(r=>r[0]).map(r=>r[1]).join('、');o.sheet.getRange(o.row,12).setValue(current[11]);}
  // Mark unconfirmed until every write and readback succeeds; failures never
  // leave an old approved flag valid against a partially updated snapshot.
  o.sheet.getRange(o.row,h.indexOf('商品確認狀態')+1).setValue('需重新確認');
  snapshot.offerHash=marketingOfferHash_(current);snapshot.matchHash=marketingMatchHash_(current);snapshot.decisionHash='';
  snapshot.confirmedSkus=marketingSelectedSkus_(currentDetails);snapshot.confirmedAt=new Date().toISOString();
  marketingSaveSnapshot_(key,snapshot);
  const detailSheet=ss.getSheetByName('活動商品明細'),all=detailSheet.getLastRow()>1?detailSheet.getRange(2,8,detailSheet.getLastRow()-1,2).getValues():[];
  const positions=all.map((v,i)=>v[0]===id&&v[1]===run?i+2:0).filter(Boolean);
  for(let i=0;i<positions.length;){let end=i+1;while(end<positions.length&&positions[end]===positions[end-1]+1)end++;detailSheet.getRange(positions[i],6,end-i,1).setValue('已確認');i=end;}
  SpreadsheetApp.flush();
  if(marketingDetailHash_(marketingOfferDetails_(ss,id,run),true)!==result.decisionHash)throw new Error('確認回讀不一致，未完成確認。');
  snapshot.decisionHash=result.decisionHash;marketingSaveSnapshot_(key,snapshot);
  o.sheet.getRange(o.row,h.indexOf('商品確認狀態')+1).setValue(snapshot.notApplicable?'不適用（免逐品號確認）':'已確認');
  marketingRefreshSummary_(ss,o);SpreadsheetApp.flush();return result;
}
function marketingConfirmedProductsValid_(ss,name,rowNumber,row,master,allDetails){
  const h=MS_TABLES[name],id=row[h.indexOf('案型識別碼')],run=row[h.indexOf('同步版本')];
  const snapshot=marketingSnapshot_(run,id);
  try{const details=allDetails?allDetails.filter(r=>r[7]===id&&r[8]===run):marketingOfferDetails_(ss,id,run),decision=marketingProductDecision_(row,details,snapshot,master.fingerprint);return snapshot?.notApplicable?true:Boolean(snapshot.decisionHash&&snapshot.decisionHash===decision.decisionHash&&/^已確認(?:・沿用上月)?$/.test(row[h.indexOf('商品確認狀態')]));}catch(_){return false;}
}
function onEdit(e){
 if(!e||!e.range||!e.source||e.source.getId()!==MS_ID||e.range.getRow()+e.range.getNumRows()-1<2)return;
 const lock=LockService.getDocumentLock();
 if(!lock.tryLock(5000)){e.source.toast('目前有保存或覆核作業；剛才的表格修改仍保留，請稍後重新讀取並核對活動狀態。','活動修改',10);return;}
 try{return marketingOnEditLocked_(e);}finally{lock.releaseLock();}
}
function marketingOnEditLocked_(e){
  if(!e||!e.range)return;const ss=e.source;if(ss.getId()!==MS_ID)return;
  const s=e.range.getSheet(),name=s.getName(),first=e.range.getRow(),last=first+e.range.getNumRows()-1;
  if(last<2)return;
  if(marketingUnifiedEnabled_()){
    const sourceName=ss.getSheetByName(MS_CONTROL)?.getRange('B2').getDisplayValue(),run=ss.getSheetByName(MS_CONTROL).getRange('B7').getDisplayValue();
    if(name===sourceName||name==='活動商品明細'&&e.range.getNumRows()>500){marketingCurrentOffers_(ss,run).forEach(o=>invalidateMarketingUnified_(ss,o));return;}
    if(name==='活動商品明細'){
      const seen=new Set();for(let r=Math.max(2,first);r<=last;r++){const o=marketingOfferAtRange_(ss,s.getRange(r,1)),id=marketingReviewId_(o);if(!seen.has(id)){invalidateMarketingUnified_(ss,o);seen.add(id);}}return;
    }
    if(['活動案型','贈品／加價購案型'].includes(name)&&e.range.getColumn()<=MS_TABLES[name].length-3){
      for(let r=Math.max(2,first);r<=last;r++)invalidateMarketingUnified_(ss,{sheet:s,row:r,values:s.getRange(r,1,1,MS_TABLES[name].length).getValues()[0]});return;
    }
  }
  const source=ss.getSheetByName(MS_CONTROL)?.getRange('B2').getDisplayValue();
  if(name===source||name==='活動商品明細'&&e.range.getNumRows()>500){
    ['活動案型','贈品／加價購案型'].forEach(n=>{const main=ss.getSheetByName(n);if(main&&main.getLastRow()>1)main.getRange(2,MS_TABLES[n].indexOf('商品確認狀態')+1,main.getLastRow()-1,1).setValue('需重新確認');});return;
  }
  if(name==='活動商品明細'){
    for(let r=Math.max(2,first);r<=last;r++){
      const v=s.getRange(r,1,1,MS_TABLES[name].length).getValues()[0],main=ss.getSheetByName(String(v[10])),row=Number(v[11]);
      s.getRange(r,6).setValue('需重新確認');
      if(main&&row>=2&&MS_TABLES[main.getName()]){const o=marketingOfferAtRange_(ss,s.getRange(r,1)),h=MS_TABLES[o.sheet.getName()];o.sheet.getRange(o.row,h.indexOf('商品確認狀態')+1).setValue('需重新確認');marketingRefreshSummary_(ss,o);}
    }
  }else if(['活動案型','贈品／加價購案型'].includes(name)&&e.range.getColumn()<=(name==='贈品／加價購案型'?15:10)){
    s.getRange(Math.max(2,first),MS_TABLES[name].indexOf('商品確認狀態')+1,last-Math.max(2,first)+1,1).setValue('需重新確認');
  }
}

// Single review workflow. Preserve parser-version hashes and all legacy columns.
function marketingUnifiedEnabled_(){return PropertiesService.getDocumentProperties().getProperty('marketing-unified-review')==='r7';}
function marketingPeriodLabel_(r){return r[3]==='長期有效'&&!r[4]?'長期有效':r[3]&&r[4]?r[3]+'～'+r[4]:'活動期間待確認';}
function marketingUnifiedIssues_(o,details){
 const r=o.values,errors=r[10]==='已取消'?['此活動已取消，不可再覆核']:[],long=r[3]==='長期有效'&&!r[4];
 if(!r[1]||!r[2])errors.push('活動名稱／完整優惠內容未填');
 if(!long){const a=String(r[3]),b=String(r[4]);if(!/^\d{4}-\d{2}-\d{2}/.test(a)||!/^\d{4}-\d{2}-\d{2}/.test(b)||!Number.isFinite(Date.parse(a))||!Number.isFinite(Date.parse(b))||Date.parse(a)>Date.parse(b))errors.push('活動期間待確認');}
 if(!r[5]||!r[6]||/待確認|請確認|未明載/.test(r[5]+r[6]))errors.push('通路／適用門市待確認');
 if(!r[8]||/待確認|請確認|未明載/.test(r[8]))errors.push('排除條件待確認');
 if(o.sheet.getName()==='贈品／加價購案型'){
  if(!/^[1-9]\d*$/.test(String(r[12]))||!r[13]||!r[14]||/待確認|請確認|未明載/.test(r[13]+r[14]))errors.push('贈品／加價購數量、門檻或並贈關係待確認');
 }
 return errors;
}
function marketingUnifiedHash_(row,decision){return marketingHash_(['unified-r7',row.slice(0,10),row.length>=23?row.slice(11,15):[],decision]);}
function marketingUnifiedValid_(ss,o,master,allDetails){
 try{marketingAssertActiveOffer_(ss,o,o.values[MS_TABLES[o.sheet.getName()].indexOf('同步版本')]);const h=MS_TABLES[o.sheet.getName()],id=marketingReviewId_(o),run=o.values[h.indexOf('同步版本')],d=allDetails?allDetails.filter(x=>x[7]===id&&x[8]===run):marketingOfferDetails_(ss,id,run),snap=marketingSnapshot_(run,id);
  const decision=marketingProductDecision_(o.values,d,snap,master.fingerprint,false);
  return o.values[10]==='已覆核'&&!marketingUnifiedIssues_(o,d).length&&!!snap.unifiedHash&&snap.unifiedHash===marketingUnifiedHash_(o.values,decision.decisionHash);
 }catch(_){return false;}
}
function validateMarketingUnified_(){
 const ss=assertMarketingBook_(),ctx=marketingReviewContext_(ss),s=ss.getSheetByName('活動商品明細'),all=s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,12).getValues():[],errors=[];
 marketingCurrentOffers_(ss,ctx.run).filter(o=>o.values[10]!=='已取消').forEach(o=>{if(!marketingUnifiedValid_(ss,o,ctx.master,all))errors.push(o.sheet.getName()+'第'+o.row+'列（'+o.values[1]+'）：'+(marketingUnifiedIssues_(o,[]).join('；')||'尚未完成統一覆核或資料已變更'));});
 SpreadsheetApp.getUi().alert(errors.length?'尚有'+errors.length+'個活動未完成：\n'+errors.slice(0,10).join('\n'):'全部活動基本覆核完成；未發布至採購／週調撥。');
 return {total:marketingCurrentOffers_(ss,ctx.run).filter(o=>o.values[10]!=='已取消').length,cancelled:marketingCurrentOffers_(ss,ctx.run).filter(o=>o.values[10]==='已取消').length,pending:errors.length};
}
function invalidateMarketingUnified_(ss,o){
 const cancellationRun=o.values[MS_TABLES[o.sheet.getName()].indexOf('同步版本')];if(marketingCancelMap_(ss,cancellationRun)[marketingReviewId_(o)]){o.sheet.getRange(o.row,11).setValue('已取消');return;}
 const h=MS_TABLES[o.sheet.getName()],id=marketingReviewId_(o),run=o.values[h.indexOf('同步版本')],snap=marketingSnapshot_(run,id);
 o.sheet.getRange(o.row,11).setValue('待覆核');o.sheet.getRange(o.row,h.indexOf('商品確認狀態')+1).setValue('需重新確認');
 if(snap){snap.unifiedHash='';marketingSaveSnapshot_(marketingProductKey_(run,id),snap);}
 marketingRefreshSummary_(ss,{...o,values:o.sheet.getRange(o.row,1,1,h.length).getValues()[0]});
}
function commitMarketingUnified_(ss,o,master){
 const h=MS_TABLES[o.sheet.getName()],id=marketingReviewId_(o),run=o.values[h.indexOf('同步版本')],d=marketingOfferDetails_(ss,id,run),issues=marketingUnifiedIssues_(o,d);
 if(issues.length)throw new Error(issues.join('；'));
 // Existing commit performs concurrent-source/master checks and full readback.
 commitMarketingOffer_(ss,o,master);
 const current=o.sheet.getRange(o.row,1,1,h.length).getValues()[0],snap=marketingSnapshot_(run,id);
 const after=marketingOfferDetails_(ss,id,run),decision=marketingProductDecision_(current,after,snap,master.fingerprint,false);
 // One action also resolves its review checklist; original issue text is kept.
 const q=ss.getSheetByName('覆核待辦');if(q.getLastRow()>1){const rows=q.getRange(2,1,q.getLastRow()-1,7).getValues();rows.forEach((v,i)=>{if(v[0]===run&&v[2]===id)q.getRange(i+2,6,1,2).setValues([['已確認',v[6]||'統一覆核：已核對活動條件及商品清單']]);});}
 snap.unifiedHash=marketingUnifiedHash_(current,decision.decisionHash);snap.unifiedAt=new Date().toISOString();
 if(current[3]==='長期有效'&&!current[4]){const source=readMarketingSource_(ss,ss.getSheetByName(MS_CONTROL));snap.period={type:'long',month:source.year+'-'+String(source.month).padStart(2,'0'),basis:snap.period?.basis||'人工覆核期間'};}
 marketingSaveSnapshot_(marketingProductKey_(run,id),snap);
 o.sheet.getRange(o.row,11).setValue('已覆核');SpreadsheetApp.flush();
 const fresh={...o,values:o.sheet.getRange(o.row,1,1,h.length).getValues()[0]};
 if(!marketingUnifiedValid_(ss,fresh,master))throw new Error('統一覆核回讀不一致，請重新檢視。');
 marketingRefreshSummary_(ss,fresh);
}
function prepareMarketingUnifiedDraft_(ss,draft,snapshots,source,master){
 const priorRun=ss.getSheetByName(MS_CONTROL).getRange('B7').getDisplayValue(),prior=priorRun?marketingCurrentOffers_(ss,priorRun):[];
 const details=ss.getSheetByName('活動商品明細'),all=details.getLastRow()>1?details.getRange(2,1,details.getLastRow()-1,12).getValues():[];
 const prevMonth=new Date(Date.UTC(source.year,source.month-2,1)).toISOString().slice(0,7);
 snapshots.forEach(snap=>{
  const h=MS_TABLES[snap.name],r=draft[snap.name].find(x=>x[h.indexOf('案型識別碼')]===snap.id);
  if(!r[3]&&!r[4]){
   if(source.year===2026&&source.month===11){r[3]='長期有效';snap.period={type:'long',basis:'2026年11月未明載日期特例'};}
   else{
    const candidates=prior.filter(o=>o.sheet.getName()===snap.name&&o.values[3]==='長期有效'&&marketingCarryKey_(o.values)===marketingCarryKey_(r)).filter(o=>{
     const old=marketingSnapshot_(priorRun,marketingReviewId_(o));return old?.period?.month===prevMonth&&marketingUnifiedValid_(ss,o,master,all);
    });
    if(candidates.length===1){const o=candidates[0],old=marketingSnapshot_(priorRun,marketingReviewId_(o)),selected=old.confirmedSkus||[];
     const oldRows=all.filter(x=>x[7]===marketingReviewId_(o)&&x[8]===priorRun),oldSkus=oldRows.filter(x=>x[1]).map(x=>x[1]).sort(),newSkus=snap.details.filter(x=>x[1]).map(x=>x[1]).sort();
     if(JSON.stringify(oldSkus)===JSON.stringify(newSkus)&&selected.every(sku=>newSkus.includes(sku))){
      r[3]='長期有效';r[10]='已覆核';snap.details.forEach(x=>{x[0]=selected.includes(x[1]);x[5]='已確認・沿用上月';});
      if(snap.name==='贈品／加價購案型')r[11]=selected.join('、');
      snap.carry={run:priorRun,id:marketingReviewId_(o),month:prevMonth};snap.confirmedSkus=selected;snap.period={type:'long',basis:'沿用上月已覆核活動'};
     }
    }
   }
  }
  if(snap.period){snap.period.month=source.year+'-'+String(source.month).padStart(2,'0');}
  snap.offerHash=marketingOfferHash_(r);snap.matchHash=marketingMatchHash_(r);
 });
}
function finishMarketingUnifiedDraft_(ss,writes,snapshots){
 const props=PropertiesService.getDocumentProperties();snapshots.forEach(s=>{
  const w=writes.find(w=>w.n===s.name),h=MS_TABLES[s.name],i=w.rows.findIndex(r=>r[h.indexOf('案型識別碼')]===s.id),row=w.s.getRange(w.r+i,1,1,h.length).getValues()[0],key=marketingProductKey_(s.run,s.id),snap=marketingSnapshot_(s.run,s.id);
  if(s.period)snap.period=s.period;
  if(s.carry){snap.unifiedHash=marketingUnifiedHash_(row,snap.decisionHash);snap.unifiedAt=new Date().toISOString();}
  marketingSaveSnapshot_(key,snap);
 });
}
function upgradeMarketingUnifiedReview(){
 const ss=assertMarketingBook_(),lock=LockService.getDocumentLock();if(!lock.tryLock(1000))throw new Error('目前有同步或覆核作業處理中，本次尚未送出。請稍候再試；與在線人數無關。');
 try{
  const c=ss.getSheetByName(MS_CONTROL),run=c.getRange('B7').getDisplayValue(),ctx=marketingReviewContext_(ss),props=PropertiesService.getDocumentProperties();
  const offers=marketingCurrentOffers_(ss,run),d=ss.getSheetByName('活動商品明細'),all=d.getLastRow()>1?d.getRange(2,1,d.getLastRow()-1,12).getValues():[];
  const stable=items=>JSON.stringify(items.map(o=>[o.sheet.getName(),o.row,o.values.filter((_,i)=>![3,4,10,MS_TABLES[o.sheet.getName()].length-3].includes(i))]));
  const before=stable(offers),detailBefore=JSON.stringify(all),sourceBefore=marketingHash_(readMarketingSource_(ss,c));
  let long=0,kept=0;
  offers.forEach(o=>{
   if(marketingCancelMap_(ss,run)[marketingReviewId_(o)]){o.sheet.getRange(o.row,11).setValue('已取消');return;}
   const h=MS_TABLES[o.sheet.getName()],id=marketingReviewId_(o),snap=marketingSnapshot_(run,id),before=o.values.slice();
   const wasValid=marketingUnifiedEnabled_()?marketingUnifiedValid_(ss,o,ctx.master,all):before[10]==='已覆核'&&marketingConfirmedProductsValid_(ss,o.sheet.getName(),o.row,before,ctx.master,all)&&!marketingUnifiedIssues_(o,[]).length;
   const trustworthy=snap&&snap.master===ctx.master.fingerprint&&snap.offerHash===marketingOfferHash_(before)&&snap.detailHash===marketingDetailHash_(all.filter(x=>x[7]===id&&x[8]===run),false);
   if(!before[3]&&!before[4]&&ctx.source.year===2026&&ctx.source.month===11){o.values[3]='長期有效';o.sheet.getRange(o.row,4).setValue('長期有效');long++;
    if(trustworthy){snap.offerHash=marketingOfferHash_(o.values);snap.matchHash=marketingMatchHash_(o.values);snap.period={type:'long',month:'2026-11',basis:'2026年11月未明載日期特例'};}
   }
   if(snap){if(wasValid){snap.unifiedHash=marketingUnifiedHash_(o.values,snap.decisionHash);kept++;}else snap.unifiedHash='';marketingSaveSnapshot_(marketingProductKey_(run,id),snap);}
   o.sheet.getRange(o.row,11).setValue(wasValid?'已覆核':'待覆核');
  });
  ['活動案型','贈品／加價購案型'].forEach(n=>{const s=ss.getSheetByName(n),h=MS_TABLES[n];s.hideColumns(h.indexOf('商品確認狀態')+1);});
  ss.getSheetByName('活動商品明細').hideColumns(6);
  if(stable(marketingCurrentOffers_(ss,run))!==before||JSON.stringify(d.getLastRow()>1?d.getRange(2,1,d.getLastRow()-1,12).getValues():[])!==detailBefore||marketingHash_(readMarketingSource_(ss,c))!==sourceBefore||c.getRange('B7').getDisplayValue()!==run||latestMarketingMaster_().identity!==ctx.master.identity)throw new Error('升級守恆或來源核對未通過，停止啟用新版。');
  props.setProperty('marketing-unified-review','r7');
  offers.forEach(o=>marketingRefreshSummary_(ss,{...o,values:o.sheet.getRange(o.row,1,1,MS_TABLES[o.sheet.getName()].length).getValues()[0]}));
  c.getRange('A15:B15').setValues([['活動覆核介面',MS_REVIEW_VERSION]]);
  c.getRange('B5').setValue('行銷同步（測試）→覆核本活動／批次覆核活動。一次核對條件與商品；人工新增可連續輸入，最後統一覆核。');
  SpreadsheetApp.flush();const result={version:MS_REVIEW_VERSION,offers:offers.length,long,kept,run,conservation:true};console.log(JSON.stringify(result));return result;
 }finally{lock.releaseLock();}
}

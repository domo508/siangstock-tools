// Resume existing rows only; never parse, append, approve or publish.
const MS_MONTH_RESUME_VERSION='20261118-marketing-month-resume-r1';
function marketingSavedMonths_(ss,c){
 const log=ss.getSheetByName('同步紀錄'),latest={};if(!log||log.getLastRow()<2)return [];
 const offers={};['活動案型','贈品／加價購案型','排除紀錄'].forEach(name=>{
  const s=ss.getSheetByName(name),h=MS_TABLES[name];if(!s||s.getLastRow()<2)return;
  s.getRange(2,1,s.getLastRow()-1,h.length).getDisplayValues().forEach(r=>{
   const run=r[h.indexOf('同步版本')],m=String(r[h.indexOf('案型識別碼')]).match(/^M(20\d{2}|2100)(\d{2})-/);if(!m)return;
   (offers[run]||(offers[run]=new Set())).add(m[1]+'-'+m[2]);
  });
 });
 log.getRange(2,1,log.getLastRow()-1,MS_TABLES['同步紀錄'].length).getDisplayValues().forEach(r=>{
  if(r[1]!==MS_VERSION||r[8]!=='草稿完成；未發布'||!r[3]||offers[r[2]]?.size!==1)return;
  const period=[...offers[r[2]]][0],parts=period.split('-').map(Number);if(parts[1]<1||parts[1]>12)return;
  const meta=marketingWorkflowRecord_(ss,'run:'+r[2]),effectiveHash=meta&&(meta.batchWriteback||meta.writeback)&&meta.source&&meta.master?marketingHash_({source:meta.source,master:meta.master}):r[3];
  latest[period]={period,year:parts[0],month:parts[1],run:r[2],hash:effectiveHash};
 });
 const choices=marketingSyncPeriodChoices_(ss,c);
 return Object.values(latest).map(p=>({...p,source:choices.find(y=>y.year===p.year&&y.months.includes(p.month))?.source||''})).sort((a,b)=>a.period.localeCompare(b.period));
}
function loadMarketingSavedMonths(){
 const ss=assertMarketingBook_(),c=ss.getSheetByName(MS_CONTROL);
 if(!c||c.getRange('B1').getDisplayValue()!==MS_VERSION)throw new Error('版本不同，請先聯絡管理者。');
 return {version:MS_MONTH_RESUME_VERSION,expected:marketingSyncPeriodToken_(c),months:marketingSavedMonths_(ss,c),current:c.getRange('B7').getDisplayValue()};
}
function resumeMarketingMonth(request){
 if(!request||request.version!==MS_MONTH_RESUME_VERSION)throw new Error('接續視窗已有新版，請重新開啟。');
 const ss=assertMarketingBook_(),c=ss.getSheetByName(MS_CONTROL),lock=LockService.getDocumentLock();
 if(!lock.tryLock(1000))throw new Error('目前有同步或覆核作業處理中，尚未切換月份。請稍候再試；與在線人數無關。');
 try{
  if(PropertiesService.getDocumentProperties().getProperty('marketing-batch-pending'))throw new Error('批次回寫尚待對帳，暫停切換月份；請先核對部分完成結果。');
  if(c.getRange('B1').getDisplayValue()!==MS_VERSION||request.expected!==marketingSyncPeriodToken_(c))throw new Error('共用月份或版本已變更，尚未切換。請關閉舊視窗後重新開啟。');
  const target=marketingSavedMonths_(ss,c).find(p=>p.period===request.period);
  if(!target||!target.source)throw new Error('找不到該月份成功草稿或唯一來源，尚未切換。');
  if(request.run!==target.run)throw new Error('該月份已有更新草稿，請重新開啟接續月份。');
  const old=c.getRange('B2:B8').getValues(),oldRun=c.getRange('B7').getDisplayValue(),names=['活動案型','贈品／加價購案型','活動商品明細','覆核待辦','排除紀錄'];
  // Source/master drift is handled by the unchanged review and rebuild guards.
  const message='已接續'+target.period+'既有草稿；原勾選、人工新增與覆核狀態保留，未重新同步／核准／發布。下一步：選取活動後開啟覆核；若提示來源或主檔已變動，請重新同步該月份。共用表單已切換，其他同仁請關閉舊覆核視窗後重新開啟。';
  try{
   names.forEach(n=>{const s=ss.getSheetByName(n);if(s&&s.getLastRow()>1)filterMarketingRun_(s,n,target.run);});
   c.getRange('B2:B4').setValues([[target.source],[target.year],[target.month]]);
   c.getRange('B7:B8').setValues([[target.run],[target.hash]]);c.getRange('B6').setValue(message);SpreadsheetApp.flush();
   if(c.getRange('B7').getDisplayValue()!==target.run||c.getRange('B8').getDisplayValue()!==target.hash)throw new Error('接續回讀不一致');
  }catch(e){
   c.getRange('B2:B8').setValues(old);names.forEach(n=>{const s=ss.getSheetByName(n);if(s&&s.getLastRow()>1&&oldRun)filterMarketingRun_(s,n,oldRun);});SpreadsheetApp.flush();throw e;
  }
  ss.setActiveSheet(ss.getSheetByName('活動案型'));return {version:MS_MONTH_RESUME_VERSION,run:target.run,message};
 }finally{lock.releaseLock();}
}
function resumeMarketingMonthNative(){
 try{
  const seed=loadMarketingSavedMonths(),ui=SpreadsheetApp.getUi();if(!seed.months.length){marketingSyncNotice_('尚無可接續的成功月份，請先立即同步。');return {cancelled:true};}
  const response=ui.prompt('接續既有月份（不重新同步）','可接續：'+seed.months.map(p=>p.period).join('、')+'。\n請輸入 YYYY-MM。原勾選、人工新增及覆核狀態保留。\n這會切換共用表單顯示月份；請先完成並關閉目前覆核視窗，再按確定。取消不更動資料。',ui.ButtonSet.OK_CANCEL);
  if(response.getSelectedButton()!==ui.Button.OK)return {cancelled:true};
  const value=String(response.getResponseText()).trim(),m=value.match(/^(20\d{2}|2100)[-\/](0?[1-9]|1[0-2])$/);
  const period=m?m[1]+'-'+m[2].padStart(2,'0'):'',target=seed.months.find(p=>p.period===period);if(!target)throw new Error('請輸入清單內已有成功草稿的年月；本次未切換。');
  const result=resumeMarketingMonth({...seed,period,run:target.run});marketingSyncNotice_(result.message);return result;
 }catch(e){marketingSyncNotice_('接續未完成：'+e.message);throw e;}
}

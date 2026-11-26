// Bound-sheet only. No publishing, networking, approval or cloud-file mutation.
// Independent UI version: do not invalidate parser hashes or rebuild activity drafts.
const MS_REVIEW_VERSION='20261105-marketing-select-all-r11';
function marketingWholeStoreOffer_(row){
  const text=String(row[2]||row[1]||'').split(/不額外|不同享|不與|排除|不適用|除外/)[0].trim();
  if(/贈|加價購|買一送一|抽獎/.test(row[0]))return false;
  if(/(?:全館|全店|全站|全品項)\s*(?:不限金額|滿[\s\d,$元件]+)?\s*(?:享|現折)?\s*(?:\d+(?:\.\d+)?\s*折|折價[券卷]|折扣|優惠[券卷])/.test(text)&&!/(?:全館|全店|全站)(?:優惠|活動|折扣)?(?:除外|不適用)/.test(String(row[2]||'')))return true;
  // A coupon without an explicit product scope must not manufacture a catalogue.
  if(row[0]==='折扣碼'){
    const name=String(row[1]||'').split(/不額外|不同享|不與|排除/)[0];
    const scope=/床包|床裙|被套|枕套|枕頭|抱枕|枕墊|床墊|蓋毯|四季被|棉被|涼被|浴巾|毛巾|髮帶|零錢包|冷墊|暖墊|麻糬被|洗衣膠囊|搓澡球|擦澡球|日好眠枕|天絲|純棉|華爾紗|雙層紗|水洗棉|印花樂|Pingu|SEMO|Sybil|Second\s*Morning|PRIMARIO/i;
    if(!scope.test(name)&&!marketingSkus_(name).length&&!/(?:^|[^A-Z0-9])[A-Z]{1,2}\d{3,}(?:-[A-Z0-9]+)?\b/.test(name))return true;
  }
  // A bare order-total threshold is all-store; named categories/SKUs are not.
  return /^(?:單筆消費|消費|全單)?滿\s*\$?\s*[\d,]+\s*(?:元|件)?\s*(?:現折|折|享\s*\d.*折)/.test(text);
}
function marketingReviewContext_(ss){
  if(PropertiesService.getDocumentProperties().getProperty('marketing-batch-pending'))throw new Error('批次回寫尚待對帳，已停止寫入；請回到活動同步與覆核核對部分完成結果，不要重新同步。');
  const c=ss.getSheetByName(MS_CONTROL),run=c.getRange('B7').getDisplayValue();
  if(marketingUnifiedEnabled_()&&c.getRange('B15').getDisplayValue()!==MS_REVIEW_VERSION)throw new Error('覆核介面版本不同，請關閉視窗並重新整理表單；若仍不一致，請聯絡管理者完成介面升級。原活動與歷史保留，不需因此重新同步。');
  if(c.getRange('B1').getDisplayValue()!==MS_VERSION||!run)throw new Error('版本不同或尚未同步，請先重新同步。');
  const source=readMarketingSource_(ss,c),master=readMarketingMaster_();
  if(marketingHash_({source,master:master.fingerprint})!==c.getRange('B8').getDisplayValue())throw new Error('來源或商品主檔已變動，請先同步。');
  return {c,run,source,master};
}
function marketingCurrentOffers_(ss,run){
  const out=[];
  ['活動案型','贈品／加價購案型'].forEach(name=>{const s=ss.getSheetByName(name),h=MS_TABLES[name];
    if(s.getLastRow()<2)return;
    s.getRange(2,1,s.getLastRow()-1,h.length).getValues().forEach((values,i)=>{if(values[h.indexOf('同步版本')]===run)out.push({sheet:s,row:i+2,values});});
  });return out;
}
function marketingReviewId_(o){return o.values[MS_TABLES[o.sheet.getName()].indexOf('案型識別碼')];}
function marketingReadSnapshotLegacy_(key){
 const props=PropertiesService.getDocumentProperties(),value=JSON.parse(props.getProperty(key)||'null');if(value?.storage!=='marketing-snapshot-parts-r11')return value;
 if(!Number.isInteger(value.parts)||value.parts<1||value.parts>2000||typeof value.prefix!=='string'||!value.prefix.startsWith(key+':parts:'))throw new Error('商品快照索引無效，停止操作。');
 let text='';for(let i=0;i<value.parts;i++){const part=props.getProperty(value.prefix+i);if(part===null)throw new Error('商品快照儲存不完整，停止操作。');text+=part;}
 if(marketingHash_(text)!==value.hash)throw new Error('商品快照回讀不一致，停止操作。');return JSON.parse(text);
}
function marketingSaveSnapshotLegacy_(key,snapshot){
 const props=PropertiesService.getDocumentProperties(),text=JSON.stringify(snapshot),previousRaw=props.getProperty(key),previous=JSON.parse(previousRaw||'null'),parts=[],prefix=key+':parts:'+Utilities.getUuid()+':';let committed=false,publishedRaw=null;
 try{
  if(text.length<=2000){publishedRaw=text;props.setProperty(key,text);}else{
   for(let at=0;at<text.length;at+=2000){const k=prefix+parts.length;props.setProperty(k,text.slice(at,at+2000));parts.push(k);}
   if(parts.map(k=>props.getProperty(k)).join('')!==text)throw new Error('商品快照分段回讀失敗。');
   publishedRaw=JSON.stringify({storage:'marketing-snapshot-parts-r11',prefix,parts:parts.length,hash:marketingHash_(text)});props.setProperty(key,publishedRaw);
  }
  if(JSON.stringify(marketingReadSnapshot_(key))!==text)throw new Error('商品快照保存回讀失敗。');committed=true;
 }catch(error){
  try{if(publishedRaw&&props.getProperty(key)===publishedRaw){if(previousRaw===null)props.deleteProperty(key);else props.setProperty(key,previousRaw);}}catch(_){}throw error;
 }finally{
  // Publish the verified index last; old snapshots remain readable on a failed
  // staging write. Retired metadata chunks are removed only after commit.
  let rootSafe=false;try{rootSafe=props.getProperty(key)!==publishedRaw;}catch(_){}
  const cleanup=committed&&previous?.storage==='marketing-snapshot-parts-r11'?Array.from({length:previous.parts},(_,i)=>previous.prefix+i):!committed&&rootSafe?parts:[];
  cleanup.forEach(k=>{try{props.deleteProperty(k);}catch(_){}});
 }
}
function marketingSnapshot_(run,id){return marketingReadSnapshot_(marketingProductKey_(run,id));}
function marketingSelectedSkus_(details){return details.filter(d=>d[0]===true&&d[1]).map(d=>String(d[1])).sort();}
function marketingRefreshSummary_(ss,o){
  const h=MS_TABLES[o.sheet.getName()],d=marketingOfferDetails_(ss,marketingReviewId_(o),o.values[h.indexOf('同步版本')]),status=o.sheet.getRange(o.row,marketingUnifiedEnabled_()?11:h.indexOf('商品確認狀態')+1).getDisplayValue();
  const snapshot=marketingSnapshot_(o.values[h.indexOf('同步版本')],marketingReviewId_(o));
  const text=snapshot?.notApplicable?'':'候選'+d.filter(x=>x[1]).length+'筆｜已選'+marketingSelectedSkus_(d).length+'筆｜'+status;
  o.sheet.getRange(o.row,h.indexOf('商品命中摘要')+1).setValue(text).setWrap(true);
}
function marketingPreviewOffer_(ss,o,ctx){
  const id=marketingReviewId_(o),d=ctx.details?ctx.details.filter(x=>x[7]===id&&x[8]===ctx.run):marketingOfferDetails_(ss,id,ctx.run),snap=marketingSnapshot_(ctx.run,id);
  let error='';try{marketingAssertActiveOffer_(ss,o,ctx.run);marketingProductDecision_(o.values,d,snap,ctx.master.fingerprint,true);}catch(e){error=e.message;}
  if(marketingUnifiedEnabled_())error=[...marketingUnifiedIssues_(o,d),error].filter(Boolean).join('；');
  const blocked=d.filter(x=>x[0]===true).map(x=>{const p=ctx.master.products.find(p=>p.sku===x[1]);return p&&marketingProductExclusion_(p)?x[1]+'：'+marketingProductExclusion_(p):'';}).filter(Boolean);
  if(blocked.length)error=[error,'已選商品屬排除品項，請取消勾選：'+blocked.join('、')].filter(Boolean).join('；');
  const selected=marketingSelectedSkus_(d),before=snap?.confirmedSkus||[],rows=d.filter(x=>x[1]);
  return {id,name:o.values[1],sheet:o.sheet.getName(),row:o.row,count:rows.length,selected:selected.length,
    added:selected.filter(x=>!before.includes(x)),removed:before.filter(x=>!selected.includes(x)),
    hasPrevious:Array.isArray(snap?.confirmedSkus),noProductList:Boolean(snap?.notApplicable),status:marketingUnifiedEnabled_()?o.values[10]:o.values.at(-2),period:marketingPeriodLabel_(o.values),conditions:o.values[2],scope:o.values[5]+'／'+o.values[6],exclusions:o.values[8],error,
    fingerprint:marketingHash_([o.values.slice(0,-3),marketingDetailHash_(d,true),snap]),
    products:rows.map(x=>({sku:x[1],name:x[2],selected:x[0]===true,manual:String(x[3]).startsWith('人工新增：')}))};
}
function previewMarketingSelected(){showMarketingReviewDialog_('selected');}
function previewMarketingAll(){showMarketingReviewDialog_('all');}
function manualMarketingProductPanel(){showMarketingReviewDialog_('manual');}
function showMarketingReviewDialog_(mode){
  const ss=assertMarketingBook_(),selected=mode==='all'?null:marketingSelectedOffer_(ss);
  ss.toast('正在開啟覆核視窗；若持續空白，請關閉後另開無痕視窗，僅登入公司Google帳號再試。已保存活動不變。','行銷覆核',20);
  const t=HtmlService.createTemplate(MS_REVIEW_HTML);
  t.mode=mode;t.offerId=selected?marketingReviewId_(selected):'';t.reviewVersion=MS_REVIEW_VERSION;
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(960).setHeight(680),'活動覆核（條件與商品一次完成）');
}
function loadMarketingReview(mode,id,reviewVersion){
  if(marketingUnifiedEnabled_()&&reviewVersion!==MS_REVIEW_VERSION)throw new Error('介面版本已更新，請關閉視窗並重新開啟最新版。');
  const ss=assertMarketingBook_(),lock=LockService.getDocumentLock();if(!lock.tryLock(1000))throw new Error('目前有同步或覆核作業處理中，尚未讀取。請稍候重新讀取；與在線人數無關。');
  try{
    const ctx=marketingReviewContext_(ss),all=marketingCurrentOffers_(ss,ctx.run).filter(o=>o.values[10]!=='已取消'),offers=mode==='all'?all:all.filter(o=>marketingReviewId_(o)===id);
    const d=ss.getSheetByName('活動商品明細');ctx.details=d.getLastRow()>1?d.getRange(2,1,d.getLastRow()-1,12).getValues():[];
    if(!offers.length)throw new Error('指定活動不在最新成功版本。');
    const token=Utilities.getUuid(),props=PropertiesService.getDocumentProperties();
    const list=offers.map(o=>marketingPreviewOffer_(ss,o,ctx));
    // Each activity has its own small token record, avoiding property-size limits.
    marketingSavePreview_(token,ctx.run,list);
    return {version:MS_VERSION,run:ctx.run,token,offers:list};
  }finally{lock.releaseLock();}
}
function confirmMarketingReview(token,ids,reviewVersion){
  if(marketingUnifiedEnabled_()&&reviewVersion!==MS_REVIEW_VERSION)throw new Error('介面版本已更新，請關閉視窗並重新開啟最新版。');
  const ss=assertMarketingBook_(),lock=LockService.getDocumentLock();if(!lock.tryLock(1000))throw new Error('目前有同步或覆核作業處理中，本次尚未送出。請稍候再試；與在線人數無關。');
  try{
    if(!Array.isArray(ids)||!ids.length||ids.length>300||new Set(ids).size!==ids.length)throw new Error('請勾選本次要確認的活動。');
    const ctx=marketingReviewContext_(ss),offers=marketingCurrentOffers_(ss,ctx.run),props=PropertiesService.getDocumentProperties(),results=[];
    ids.forEach(id=>{
      try{
        const saved=marketingLoadPreview_(token,id),matches=offers.filter(o=>marketingReviewId_(o)===id);
        if(!saved||saved.run!==ctx.run||Date.now()-saved.at>15*60*1000||matches.length!==1)throw new Error('預覽已失效，請重新載入預覽。');
        const o=matches[0],preview=marketingPreviewOffer_(ss,o,ctx);
        if(preview.fingerprint!==saved.fingerprint)throw new Error('預覽後資料已變更，請重新載入並核對。');
        if(preview.error)throw new Error(preview.error);
        if(marketingUnifiedEnabled_())commitMarketingUnified_(ss,o,ctx.master);else commitMarketingOffer_(ss,o,ctx.master);
        // Consume the token; a second click cannot repeat a commit.
        marketingConsumePreview_(token,id);
        results.push({id,name:o.values[1],success:true,message:marketingUnifiedEnabled_()?'已覆核活動條件與商品清單；未發布':'已確認商品集合；未發布'});
      }catch(e){results.push({id,success:false,message:e.message});}
    });
    return {results,success:results.filter(x=>x.success).length,failed:results.filter(x=>!x.success).length};
  }finally{lock.releaseLock();}
}
function addMarketingProduct(id,run,sku,reviewVersion){
  return marketingAddProducts_(id,run,[sku],reviewVersion,true);
}
function addMarketingProducts(id,run,skus,reviewVersion){
  return marketingAddProducts_(id,run,skus,reviewVersion,false);
}
function searchMarketingProducts(id,run,query,kind,offset,reviewVersion,selectAll=false){
 if(reviewVersion!==MS_REVIEW_VERSION)throw new Error('介面版本已更新，請關閉後重新開啟。');
 const ss=assertMarketingBook_(),ctx=marketingReviewContext_(ss);if(ctx.run!==run)throw new Error('同步版本已變更，請重新開啟。');
 const matches=marketingCurrentOffers_(ss,run).filter(o=>marketingReviewId_(o)===id);if(matches.length!==1)throw new Error('活動對應不唯一。');
 const o=matches[0],snap=marketingSnapshot_(run,id),d=marketingOfferDetails_(ss,id,run);marketingAssertActiveOffer_(ss,o,run);
 if(!snap||snap.notApplicable)throw new Error('此活動不需商品集合，不能搜尋加入。');
 if(d.length!==snap.count||marketingDetailHash_(d,false)!==snap.detailHash)throw new Error('商品明細與快照不一致，停止搜尋加入；請交由管理者修復。');
 query=String(query||'').normalize('NFKC').trim();if(!query||query.length>500||!['sku','name'].includes(kind)||!Number.isInteger(offset)||offset<0||typeof selectAll!=='boolean')throw new Error('請輸入正確搜尋方式與內容。');
 let products;
 if(kind==='sku'){
  const skus=[...new Set(query.toUpperCase().split(/[\s,，、;；]+/).filter(Boolean))];if(skus.length>100||skus.some(s=>!/^[A-Z0-9][A-Z0-9._/-]*$/.test(s)))throw new Error('每次最多100個有效品號，請以逗號或換行分隔。');
  products=skus.map(sku=>ctx.master.products.find(p=>p.sku===sku)||{sku,name:'商品主檔查無此品號',missing:true});
 }else{
  const terms=query.split(/\s+/).map(marketingNorm_).filter(Boolean);if(terms.join('').length<2)throw new Error('品名請至少輸入2個字。');
  products=ctx.master.products.filter(p=>terms.every(t=>marketingNorm_(p.name).includes(t)));
 }
 const existing=new Set(d.filter(x=>x[1]).map(x=>x[1]));products.sort((a,b)=>a.sku<b.sku?-1:a.sku>b.sku?1:0);
 const counts={available:0,existing:0,excluded:0,missing:0},eligibleSkus=[];
 const evaluated=products.map(p=>{const exclusion=p.missing?'商品主檔查無此品號':marketingProductExclusion_(p),inActivity=existing.has(p.sku),available=!exclusion&&!inActivity;
  counts[p.missing?'missing':exclusion?'excluded':inActivity?'existing':'available']++;if(available&&selectAll)eligibleSkus.push(p.sku);
  return {sku:p.sku,name:p.name,size:p.size||'',existing:inActivity,reason:exclusion||(inActivity?'已在本活動':''),available};});
 return {id,run,query,kind,offset,total:products.length,hasMore:offset+50<products.length,rows:evaluated.slice(offset,offset+50),counts,...(selectAll?{eligibleSkus}: {})};
}
function marketingAddProducts_(id,run,skus,reviewVersion,strictDuplicate){
  if(reviewVersion!==MS_REVIEW_VERSION)throw new Error('介面版本已更新，請關閉此視窗，再從選單重新開啟最新版。');
  const ss=assertMarketingBook_(),lock=LockService.getDocumentLock();if(!lock.tryLock(1000))throw new Error('目前有同步或覆核作業處理中，本次尚未送出。請稍候再試；與在線人數無關。');
  try{
    const ctx=marketingReviewContext_(ss);if(run!==ctx.run)throw new Error('同步版本已變更，請重新開啟。');
    if(!Array.isArray(skus)||!skus.length)throw new Error('請至少勾選1個商品。');
    skus=[...new Set(skus.map(s=>String(s||'').normalize('NFKC').trim().toUpperCase()))];
    if(skus.length>ctx.master.products.length)throw new Error('所選數量超過目前商品主檔，請重新查詢。');
    if(skus.some(s=>!/^[A-Z0-9][A-Z0-9._/-]*$/.test(s)))throw new Error('請填正確ERP品號。');
    const matches=marketingCurrentOffers_(ss,run).filter(o=>marketingReviewId_(o)===id);if(matches.length!==1)throw new Error('活動對應不唯一。');
    const o=matches[0],h=MS_TABLES[o.sheet.getName()],snap=marketingSnapshot_(run,id),d=marketingOfferDetails_(ss,id,run);marketingAssertActiveOffer_(ss,o,run);
    if(!snap||snap.notApplicable)throw new Error('全館或不需商品集合的活動不能加入候選。');
    if(d.length!==snap.count||marketingDetailHash_(d,false)!==snap.detailHash)throw new Error('明細已遭改寫，請先重新同步。');
    const existing=new Set(d.map(x=>x[1])),duplicates=skus.filter(s=>existing.has(s));if(strictDuplicate&&duplicates.length)throw new Error('本活動已有此品號，請至明細勾選。');
    // Preflight the entire request before the first write. No partial invalid batch.
    const products=skus.map(sku=>{const p=ctx.master.products.find(x=>x.sku===sku);if(!p)throw new Error(sku+'商品主檔查無此品號。');const excluded=marketingProductExclusion_(p);if(excluded)throw new Error(sku+'不列活動商品：'+excluded+'；本次未新增。');return p;}).filter(p=>!existing.has(p.sku));
    if(latestMarketingMaster_().identity!==ctx.master.identity||marketingHash_({source:readMarketingSource_(ss,ctx.c),master:ctx.master.fingerprint})!==ctx.c.getRange('B8').getDisplayValue())throw new Error('加入前來源或主檔已變更，請重新讀取。');
    const s=ss.getSheetByName('活動商品明細'),rows=products.map(p=>[true,p.sku,p.name,'人工新增：手動加入活動商品',o.sheet.getName()==='活動案型'?'優惠商品':o.values[0]==='加價購'?'加價購品':'贈品','需重新確認','返回主表',id,run,ctx.master.fingerprint,o.sheet.getName(),o.row]);
    const at=s.getLastRow()+1;if(rows.length){if(at+rows.length-1>s.getMaxRows())s.insertRowsAfter(s.getMaxRows(),at+rows.length-1-s.getMaxRows());
    s.getRange(at,1,rows.length,1).setNumberFormat('General');s.getRange(at,1,rows.length,12).setValues(rows.map(row=>row.map(safeMarketingText_))).setWrap(true);
    s.getRange(at,1,rows.length,1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build());SpreadsheetApp.flush();}
    const after=marketingOfferDetails_(ss,id,run);
    if(after.length!==d.length+rows.length||marketingDetailHash_(after,true)!==marketingDetailHash_(d.concat(rows),true))throw new Error('人工新增回讀失敗，未更新確認；請交由管理者核對，勿重覆送出。');
    if(rows.length){
    snap.count=after.length;snap.detailHash=marketingDetailHash_(after,false);snap.decisionHash='';
    marketingSaveSnapshot_(marketingProductKey_(run,id),snap);
    o.sheet.getRange(o.row,h.indexOf('商品確認狀態')+1).setValue('需重新確認');
    if(marketingUnifiedEnabled_()){o.sheet.getRange(o.row,11).setValue('待覆核');snap.unifiedHash='';marketingSaveSnapshot_(marketingProductKey_(run,id),snap);}
    marketingRefreshSummary_(ss,o);refreshMarketingNavigation_(ss,run);SpreadsheetApp.flush();
    }
    // Return a fresh, unconfirmed preview in this same request. No extra master
    // download, manual reload or automatic approval is needed between additions.
    const current={sheet:o.sheet,row:o.row,values:o.sheet.getRange(o.row,1,1,h.length).getValues()[0]};
    ctx.details=s.getRange(2,1,s.getLastRow()-1,12).getValues();
    const preview=marketingPreviewOffer_(ss,current,ctx),token=Utilities.getUuid(),props=PropertiesService.getDocumentProperties();
    // The batch-mode UI keeps the other cards; refresh their tokens too so a
    // manual addition does not silently invalidate unrelated selected offers.
    marketingSavePreview_(token,run,marketingCurrentOffers_(ss,run).map(offer=>marketingReviewId_(offer)===id?preview:marketingPreviewOffer_(ss,offer,ctx)));
    return {sku:products[0]?.sku||skus[0],name:products[0]?.name||'',added:products.map(p=>({sku:p.sku,name:p.name})),addedCount:products.length,alreadyCount:duplicates.length,message:'已加入'+products.length+'筆，略過已在活動'+duplicates.length+'筆；可繼續搜尋新增，全部完成後再統一覆核，未發布。',preview:{version:MS_VERSION,run,token,offers:[preview]}};
  }finally{lock.releaseLock();}
}
// Carry only a verified previous calendar month, never a name-only match.
function marketingCarryKey_(row){return marketingHash_([row[0],row[2],row[5],row[6],row[8],row[9],...(row.length>=23?row.slice(12,15):[])]);}
function preserveMarketingSelections_(ss,draft,snapshots,master){
  const oldRun=ss.getSheetByName(MS_CONTROL).getRange('B7').getDisplayValue();if(!oldRun)return;
  const oldOffers=marketingCurrentOffers_(ss,oldRun);
  snapshots.forEach(snap=>{
    if(snap.notApplicable)return;
    const row=draft[snap.name].find(x=>x[MS_TABLES[snap.name].indexOf('案型識別碼')]===snap.id);
    const matches=oldOffers.filter(o=>o.sheet.getName()===snap.name&&marketingCarryKey_(o.values)===marketingCarryKey_(row));
    if(matches.length!==1)return;const old=matches[0],id=marketingReviewId_(old),baseline=marketingSnapshot_(oldRun,id),d=marketingOfferDetails_(ss,id,oldRun);
    if(!baseline||baseline.master!==master.fingerprint||d.length!==baseline.count||marketingDetailHash_(d,false)!==baseline.detailHash)return;
    const selected=new Set(marketingSelectedSkus_(d));snap.details.forEach(x=>{if(x[1])x[0]=selected.has(x[1]);});
    d.filter(x=>x[1]&&String(x[3]).startsWith('人工新增：')&&!snap.details.some(n=>n[1]===x[1])&&!marketingProductExclusion_(master.products.find(p=>p.sku===x[1])||{})).forEach(x=>{
      const copy=x.slice();copy[5]='需重新確認';copy[7]=snap.id;copy[8]=snap.run;copy[9]=master.fingerprint;copy[11]=0;
      snap.details.push(copy);draft['活動商品明細'].push(copy);
    });
    row[MS_TABLES[snap.name].indexOf('商品命中摘要')]='候選'+snap.details.filter(d=>d[1]).length+'筆｜已選'+marketingSelectedSkus_(snap.details).length+'筆｜待確認（保留原選擇）';
  });
}
function carryMarketingPriorMonth_(ss,draft,snapshots,master,source){
  const previous=new Date(Date.UTC(source.year,source.month-2,1)),month=previous.toISOString().slice(0,7),props=PropertiesService.getDocumentProperties();
  const priorRun=ss.getSheetByName(MS_CONTROL).getRange('B7').getDisplayValue();
  snapshots.forEach(snap=>{
    if(snap.name!=='贈品／加價購案型'||snap.notApplicable)return;
    const row=draft[snap.name].find(x=>x[MS_TABLES[snap.name].indexOf('案型識別碼')]===snap.id);
    if(row[3]||row[4]||/待確認|請確認|未明載/.test(row[5]+row[6]+row[8])||!row[12]||!row[13]||!row[14])return;
    const sheet=ss.getSheetByName(snap.name),h=MS_TABLES[snap.name];if(sheet.getLastRow()<2)return;
    const candidates=sheet.getRange(2,1,sheet.getLastRow()-1,h.length).getValues().filter(old=>old[h.indexOf('同步版本')]===priorRun&&String(old[3]).startsWith(month)&&String(old[4]).startsWith(month)&&old[10]==='已覆核'&&marketingCarryKey_(old)===marketingCarryKey_(row));
    const valid=candidates.filter(old=>{const oldRun=old[h.indexOf('同步版本')],oldId=old[h.indexOf('案型識別碼')];return marketingConfirmedProductsValid_(ss,snap.name,0,old,master)&&Array.isArray(marketingSnapshot_(oldRun,oldId)?.confirmedSkus);});
    if(!valid.length)return;
    const decisions=valid.map(old=>marketingSnapshot_(old[h.indexOf('同步版本')],old[h.indexOf('案型識別碼')]));
    if(new Set(decisions.map(x=>JSON.stringify(x.confirmedSkus))).size!==1)return;
    const old=valid.at(-1),selected=decisions.at(-1).confirmedSkus;
    // Carry cannot invent a missing match, expand changed candidates or accept a changed master.
    if(!selected.length||selected.some(sku=>!snap.details.some(d=>d[1]===sku&&d[0]===true)))return;
    const first=source.year+'-'+String(source.month).padStart(2,'0')+'-01',last=new Date(Date.UTC(source.year,source.month,0)).toISOString().slice(0,10);
    row[3]=first+' 00:00';row[4]=last+' 23:59';row[10]='已覆核';
    row[11]=selected.join('、');row[h.indexOf('商品確認狀態')]='已確認・沿用上月';
    row[h.indexOf('商品命中摘要')]='候選'+snap.details.filter(d=>d[1]).length+'筆｜已選'+selected.length+'筆｜已確認・沿用上月';
    snap.details.forEach(d=>{d[0]=selected.includes(d[1]);d[5]='已確認・沿用上月';});
    snap.carry={run:old[h.indexOf('同步版本')],id:old[h.indexOf('案型識別碼')],month};snap.confirmedSkus=selected;
    snap.offerHash=marketingOfferHash_(row);snap.matchHash=marketingMatchHash_(row);
    // Date-only issues are resolved by the explicit source-month boundary; all other issues stay.
    draft['覆核待辦']=draft['覆核待辦'].filter(q=>{if(q[2]!==snap.id)return true;const issues=String(q[4]).split('；').filter(x=>!['活動起訖未明載或日期無效，請確認','缺ERP品號，請核對主檔'].includes(x));q[4]=issues.join('；');return !!q[4];});
  });
}

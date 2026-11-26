// New workflow is append-only and opt-in from its menu. Installation does not
// synchronize, migrate, approve, or rewrite any existing business record.
const MS_WORKFLOW_LOG='行銷流程版本紀錄';
const MS_WORKFLOW_ENDPOINT='https://siangstock.com/api/procurement/marketing-ai';
// Scoped Access credentials are administrator-managed script settings. They are
// sent only to the pinned company endpoint, never returned to UI, logs, or AI.
function marketingWorkflowServiceHeaders_(){
 const props=PropertiesService.getScriptProperties(),id=props.getProperty('MARKETING_ACCESS_CLIENT_ID'),secret=props.getProperty('MARKETING_ACCESS_CLIENT_SECRET');
 if(!id||!secret)throw new Error('公司AI路徑的機器連線尚未設定，未送出解析；請由管理者完成限定路徑的Access授權。');
 return {'CF-Access-Client-Id':id,'CF-Access-Client-Secret':secret};
}
function marketingReadSnapshot_(key){const ss=SpreadsheetApp.getActive(),record=ss&&marketingWorkflowRecord_(ss,'snapshot:'+key);return record===null?marketingReadSnapshotLegacy_(key):record;}
function marketingSaveSnapshot_(key,snapshot){const run=String(key).match(/^marketing-products:([^:]+):/)?.[1],ss=SpreadsheetApp.getActive();if(run&&MS_WORKFLOW_READ_VERSIONS.includes(marketingWorkflowRecord_(ss,'run:'+run)?.version))return marketingWorkflowRecord_(ss,'snapshot:'+key,snapshot);return marketingSaveSnapshotLegacy_(key,snapshot);}
function marketingWorkflowActor_(){const email=Session.getActiveUser().getEmail();if(!/@siangapato\.com\.tw$/.test(email))throw new Error('請使用公司Google帳號。');return email.toLowerCase();}
function marketingWorkflowLocked_(fn,allowPending=false){const l=LockService.getDocumentLock();if(!l.tryLock(1000))throw new Error('目前有同步、修改或覆核作業，請稍後再試；與在線人數無關。');try{if(!allowPending&&PropertiesService.getDocumentProperties().getProperty('marketing-batch-pending'))throw new Error('批次回寫尚待對帳，已停止寫入；請核對部分完成結果，不要重新同步。');return fn();}finally{l.releaseLock();}}
const MS_WORKFLOW_STORAGE_VERSION='20261126-marketing-record-r1';
function marketingWorkflowRecord_(ss,key,value){
 let s=ss.getSheetByName(MS_WORKFLOW_LOG);
 if(value===undefined){if(!s||s.getLastRow()<2)return null;const rows=s.getRange(2,1,s.getLastRow()-1,7).getValues();for(let i=rows.length-1;i>=0;i--){const r=rows[i];if(r[0]!==key||r[6]!=='complete')continue;const parts=rows.filter(x=>x[0]===key&&x[1]===r[1]&&x[6]==='part').sort((a,b)=>a[2]-b[2]);if(parts.length!==Number(r[3])||parts.some((x,j)=>Number(x[2])!==j||!String(x[5]).startsWith('~')))throw new Error('流程歷史儲存不完整。');const text=parts.map(x=>String(x[5]).slice(1)).join('');if(marketingHash_(text)!==r[4])throw new Error('流程歷史回讀不一致。');return JSON.parse(text);}return null;}
 // Every writer, including direct-edit triggers and analysis journals, shares
 // this lock. Business entry points may already hold the document lock.
 const lock=LockService.getScriptLock();
 if(!lock.tryLock(5000))throw new Error('流程歷史正在保存，本次尚未寫入；請稍後重新讀取，不要重複送出。');
 try{
  s=ss.getSheetByName(MS_WORKFLOW_LOG);
  if(!s){s=ss.insertSheet(MS_WORKFLOW_LOG);s.getRange(1,1,1,7).setValues([['紀錄鍵','儲存版本','分段','段數','校驗','內容','狀態']]);s.hideSheet();}
  const text=JSON.stringify(value),id=Utilities.getUuid(),hash=marketingHash_(text),parts=[];
  for(let i=0;i<text.length;i+=30000)parts.push([key,id,parts.length,0,hash,'~'+text.slice(i,i+30000),'part']);
  if(parts.length>100)throw new Error('單次流程紀錄超過上限。');
  const rows=parts.concat([[key,id,-1,parts.length,hash,'','complete']]),at=s.getLastRow()+1;
  if(at+rows.length-1>s.getMaxRows())s.insertRowsAfter(s.getMaxRows(),at+rows.length-1-s.getMaxRows());
  // A single range write prevents an interleaving completion marker from
  // overwriting another writer's content row. Never publish completion alone.
  s.getRange(at,1,rows.length,7).setValues(rows);SpreadsheetApp.flush();
  if(JSON.stringify(s.getRange(at,1,rows.length,7).getValues())!==JSON.stringify(rows))throw new Error('流程歷史保存回讀不一致，停止後續操作；請交由管理者核對，勿重送。');
  if(JSON.stringify(marketingWorkflowRecord_(ss,key))!==text)throw new Error('流程索引回讀失敗。');return value;
 }finally{lock.releaseLock();}
}
function marketingWorkflowToken_(kind,data){const token=Utilities.getUuid(),actor=marketingWorkflowActor_(),v={kind,data,actor,version:MS_WORKFLOW_VERSION,expires:Date.now()+900000};marketingPreviewCache_().put('mw:'+token,JSON.stringify(v),900);if(!marketingPreviewCache_().get('mw:'+token))throw new Error('預覽憑據暫時無法保存。');return token;}
function marketingWorkflowUse_(token,kind){const value=marketingPreviewCache_().get('mw:'+token);if(!value)throw new Error('預覽已失效，請重新讀取；尚未重送或寫入。');const p=JSON.parse(value);if(p.kind!==kind||p.version!==MS_WORKFLOW_VERSION||p.actor!==marketingWorkflowActor_()||Date.now()>p.expires)throw new Error('預覽帳號／版本／期限不符。');return p.data;}
function marketingWorkflowConsume_(token){marketingPreviewCache_().remove('mw:'+token);}
function marketingWorkflowAllDetails_(ss,run){const s=ss.getSheetByName('活動商品明細');return s&&s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,12).getValues().filter(x=>x[8]===run):[];}
function marketingWorkflowPrior_(ss,year,month){
 const prefix='M'+year+String(month).padStart(2,'0')+'-',current=ss.getSheetByName(MS_CONTROL).getRange('B7').getDisplayValue(),logs=ss.getSheetByName('同步紀錄'),runs=logs&&logs.getLastRow()>1?logs.getRange(2,1,logs.getLastRow()-1,9).getDisplayValues().filter(r=>r[8]==='草稿完成；未發布').map(r=>r[2]).reverse():[];
 for(const run of [...new Set([current,...runs])]){if(!run)continue;const offers=marketingCurrentOffers_(ss,run);if(offers.some(o=>String(marketingReviewId_(o)).startsWith(prefix))){let meta=marketingWorkflowRecord_(ss,'run:'+run);if(!meta){const groups=new Map();offers.forEach(o=>{const h=MS_TABLES[o.sheet.getName()],r=o.values,key=marketingHash_([r[h.indexOf('來源位置')],r[2]]);if(!groups.has(key))groups.set(key,{sid:prefix+'A'+key.slice(0,16),cell:String(r[h.indexOf('來源位置')]).split('!').pop(),evidence:r[2],name:r[1],ids:[],series:[],variants:[],legacyRaw:r[h.indexOf('來源原文')]});const g=groups.get(key),gift=o.sheet.getName()==='贈品／加價購案型',id=marketingReviewId_(o);g.ids.push(id);g.series.push('');g.variants.push({id,key:marketingWorkflowVariantKey_(r[0],r[5],gift?String(r[11]).split(/[、,，\s]+/).filter(Boolean):[]),parsed:r.slice(0,10)});});meta={legacy:true,activities:[...groups.values()]};}return {run,offers,details:marketingWorkflowAllDetails_(ss,run),meta};}}
 return {run:'',offers:[],details:[],meta:null};
}
function marketingWorkflowStamp_(ss,prior){return marketingHash_([marketingSyncPeriodToken_(ss.getSheetByName(MS_CONTROL)),prior.run,marketingCurrentOffers_(ss,prior.run).map(o=>[o.sheet.getName(),o.row,o.values]),marketingWorkflowAllDetails_(ss,prior.run)]);}
function marketingWorkflowSource_(ss,year,month){const c=ss.getSheetByName(MS_CONTROL),choice=marketingSyncPeriodChoices_(ss,c).find(x=>x.year===year);if(!choice||!choice.months.includes(month))throw new Error('來源年度或月份不唯一。');return readMarketingSource_(ss,{getRange:k=>({getValue:()=>({B2:choice.source,B3:year,B4:month})[k]})});}
function loadMarketingWorkflow(){
 const ss=assertMarketingBook_();marketingWorkflowActor_();const seed=loadMarketingSyncPeriod(),c=ss.getSheetByName(MS_CONTROL),run=c.getRange('B7').getDisplayValue(),meta=marketingWorkflowRecord_(ss,'run:'+run);
 return {version:MS_WORKFLOW_VERSION,actionVersion:MS_BATCH_VERSION,pendingBatch:PropertiesService.getDocumentProperties().getProperty('marketing-batch-pending')||'',years:seed.years,year:seed.year,month:seed.month,run,meta:meta?{year:meta.source.year,month:meta.source.month,writeback:meta.writeback||null}:null,offers:marketingCurrentOffers_(ss,run).map(o=>({id:marketingReviewId_(o),name:o.values[1],status:o.values[10],sheet:o.sheet.getName()}))};
}
function prepareMarketingWorkflow(request){return marketingWorkflowLocked_(()=>{
 const ss=assertMarketingBook_();if(request?.version!==MS_WORKFLOW_VERSION)throw new Error('請重新載入最新版。');const source=marketingWorkflowSource_(ss,request.year,request.month),prior=marketingWorkflowPrior_(ss,request.year,request.month),master=readMarketingMaster_();
 if((prior.meta?.activities||[]).some(a=>a.cancelled&&!a.cancelled.writeback))throw new Error('尚有已取消活動未回寫原企劃，請先到第3區完成取消回寫；未執行AI解析或重建草稿。');
 const pending=prior.offers.filter(o=>o.values[10]!=='已取消'&&!marketingUnifiedValid_(ss,o,master,prior.details));
 const data={year:request.year,month:request.month,sourceHash:marketingHash_(source),stamp:marketingWorkflowStamp_(ss,prior),master:master.fingerprint,operationId:Utilities.getUuid(),priorRun:prior.run};
 return {token:marketingWorkflowToken_('sync-prepare',data),pending:pending.map(o=>({id:marketingReviewId_(o),name:o.values[1]})),manual:prior.details.filter(x=>String(x[3]).startsWith('人工新增：')).length,message:pending.length?'本月有'+pending.length+'個未完成有效覆核的活動；其中人工新增／修改與勾選不帶入重建草稿。新版本成功才切換，取消或失敗保留原資料。':'本月沒有未完成覆核活動。重新同步會依來源比對差異，原核准與歷史保留。'};
 });}
function analyzeMarketingWorkflow(token,confirmed){
 const p=marketingWorkflowUse_(token,'sync-prepare');if(confirmed!==true)throw new Error('請先確認重新同步提醒。');const ss=assertMarketingBook_(),source=marketingWorkflowSource_(ss,p.year,p.month),prior=marketingWorkflowPrior_(ss,p.year,p.month);
 if(marketingHash_(source)!==p.sourceHash||marketingWorkflowStamp_(ss,prior)!==p.stamp||readMarketingMaster_().fingerprint!==p.master)throw new Error('來源、主檔或同仁修改已變動，請重新讀取提醒。');
 const serviceHeaders=marketingWorkflowServiceHeaders_();
 marketingWorkflowLocked_(()=>{if(marketingWorkflowRecord_(ss,'ai:'+p.operationId))throw new Error('此解析已送出，不重複呼叫AI。');marketingWorkflowRecord_(ss,'ai:'+p.operationId,{status:'started',sourceHash:p.sourceHash,at:new Date().toISOString()});});
 const cancelledContexts=[];const activeSource={...source,cells:source.cells.map(c=>{let raw=c.raw;(prior.meta?.activities||[]).filter(a=>a.cancelled&&a.cell===c.ref).forEach(a=>{if(a.evidence&&raw.includes(a.evidence)){cancelledContexts.push({cell:c.ref,text:a.evidence,reason:'已取消活動，不重新建立優惠'});raw=marketingWorkflowPatchText_(raw,a.evidence,'');}});return {...c,raw};}).filter(c=>c.raw.trim())};if(!activeSource.cells.length)throw new Error('本月活動已全部取消，不需重新AI同步。');
 let extraction;
 try{
  const identity=ScriptApp.getIdentityToken();if(!identity)throw new Error('請先完成公司帳號AI解析授權。');
  const response=UrlFetchApp.fetch(MS_WORKFLOW_ENDPOINT,{method:'post',contentType:'application/json',headers:{...serviceHeaders,Authorization:'Bearer '+identity},payload:JSON.stringify({version:MS_WORKFLOW_VERSION,spreadsheetId:ss.getId(),operationId:p.operationId,year:p.year,month:p.month,cells:activeSource.cells.map(x=>({ref:x.ref,raw:x.raw}))}),muteHttpExceptions:true,followRedirects:false});
  const code=response.getResponseCode();if([301,302,303,307,308].includes(code))throw new Error('公司AI服務尚未完成機器身分驗證，未啟用新草稿；請由管理者核對Access連線設定。');
  let data;try{data=JSON.parse(response.getContentText());}catch(_){throw new Error('公司AI服務回應格式不符，未啟用新草稿；請交由管理者核對。');}
  if(code!==200||data.version!==MS_WORKFLOW_VERSION)throw new Error(typeof data.error==='string'?data.error.slice(0,500):'AI服務版本不符。');extraction=data.extraction;
  extraction.context.push(...cancelledContexts);const activities=marketingWorkflowValidate_(source,extraction),old=prior.meta?.activities||[];
  const resolved=marketingWorkflowResolve_(activities,old,String(p.year)+String(p.month).padStart(2,'0'),{},()=>Utilities.getUuid());
  const key='analysis:'+p.operationId;marketingWorkflowRecord_(ss,key,{...p,source,activities:activities.map((activity,i)=>Object.assign({},activity,resolved[i].reason==='首次建立'?{allocatedSid:resolved[i].sid}:{})),model:data.model,usage:data.usage,status:'ready'});
  marketingWorkflowRecord_(ss,'ai:'+p.operationId,{status:'completed',sourceHash:p.sourceHash,at:new Date().toISOString()});marketingWorkflowConsume_(token);
  return {token:marketingWorkflowToken_('sync-analysis',{key}),activities:resolved.map(a=>({index:a.index,name:a.variants.map(v=>v.name).join('／'),sid:a.sid,reason:a.reason,options:a.options||[],questions:a.variants.flatMap(v=>v.questions)})),message:'AI解析完成；尚未切換版本、覆核或回寫原企劃。請確認活動對應後建立草稿。'};
 }catch(error){marketingWorkflowRecord_(ss,'ai:'+p.operationId,{status:'failed',sourceHash:p.sourceHash,at:new Date().toISOString()});throw new Error(error.message+' 原草稿與歷史保留，未自動重送。');}
}
function marketingWorkflowBuild_(source,activities,run,master,prior,ss){
 const draft={'活動案型':[],'贈品／加價購案型':[],'活動商品明細':[],'覆核待辦':[],'排除紀錄':[]},snapshots=[],records=(prior.meta?.activities||[]).filter(a=>a.cancelled).map(a=>JSON.parse(JSON.stringify(a)));let q=0;
 activities.forEach(a=>{if(records.some(r=>r.sid===a.sid&&r.cancelled))return;const ids=[],variantRecords=[],oldMeta=prior.meta?.activities.find(x=>x.sid===a.sid),variantKeys=marketingWorkflowVariantKeys_(a.variants);a.variants.forEach((v,i)=>{
  const variantKey=variantKeys[i],oldVariants=(oldMeta?.variants||[]).filter(x=>x.key===variantKey);if(oldVariants.length>1||variantRecords.some(x=>x.key===variantKey))throw new Error('同活動的通路／贈品變體不唯一，請拆分或確認對應。');
  const id=oldVariants[0]?.id||a.sid+'-V'+variantKey.slice(0,10),gift=['加價購','滿額／滿件贈','購物贈','買一送一'].includes(v.type)&&!['whole','none'].includes(v.mode),name=gift?'贈品／加價購案型':'活動案型',loc=source.cells.find(c=>c.ref===a.cell).sheet+'!'+a.cell;
  if(v.type==='抽獎資格'){draft['排除紀錄'].push([run,id,loc,v.content,'純抽獎資格不建立配發商品']);return;}
  const base=[v.type,v.name,v.content,v.start,v.end,v.channel||'待確認',v.stores||'待確認',v.series||v.queries.map(x=>x.join('＋')).join('／')||'請依完整內容確認商品集合',v.exclusions||'未明載，請確認',v.restrictions,'待覆核'];
  const row=base.concat(gift?[v.skus.join('、'),String(v.quantity).match(/^([1-9]\d*)\s*(?:組|個|件|份|入|條|顆|支|只)?$/)?.[1]||v.quantity,v.threshold,v.relationship]:[],[a.sid,id,run,loc,a.evidence]),m=marketingWorkflowCandidates_(v,master.products);
  let details=m.candidates.map(c=>[!!c.include,c.product.sku,c.product.name,c.basis,m.role,'待確認','返回主表',id,run,master.fingerprint,name,0]);
  if(!details.length&&!m.notApplicable)details=[[false,'','未找到可確認的商品，請補明確條件或人工加入','未命中；不可當成空集合已確認',m.role,'待確認','返回主表',id,run,master.fingerprint,name,0]];
  row.push(m.notApplicable?'':'候選'+m.candidates.length+'筆｜已選'+details.filter(x=>x[0]).length+'筆｜待覆核',m.notApplicable?'不適用（免逐品號確認）':'待確認',m.notApplicable?'':'查看品項明細');
  const parsed=row.slice(0,10);variantRecords.push({id,key:variantKey,parsed,series:v.series,mode:v.mode});const old=prior.offers.find(o=>marketingReviewId_(o)===id&&o.sheet.getName()===name);
  let carry=false;
  if(old&&oldMeta&&marketingUnifiedValid_(ss,old,master,prior.details)){
   const oldDetails=prior.details.filter(d=>d[7]===id),oldKeys=oldDetails.filter(d=>d[1]).map(d=>d[1]).sort(),newKeys=details.filter(d=>d[1]).map(d=>d[1]).sort();
   const sameSource=marketingWorkflowNormalize_(oldMeta.evidence)===marketingWorkflowNormalize_(a.evidence),sameParsed=oldVariants[0]?.parsed&&marketingWorkflowNormalize_(JSON.stringify(oldVariants[0].parsed))===marketingWorkflowNormalize_(JSON.stringify(parsed)),sameLegacy=oldMeta.legacyRaw===source.cells.find(c=>c.ref===a.cell).raw;
   if(sameSource&&(sameParsed||sameLegacy)){
    // A previously reviewed manual edit remains authoritative until explicit
    // source changes; only pending work is discarded by confirmed rebuild.
    for(let k=0;k<11;k++)row[k]=old.values[k];if(gift)for(let k=11;k<15;k++)row[k]=old.values[k];
    details=oldDetails.map(d=>{const x=d.slice();x[8]=run;x[11]=0;return x;});carry=true;
   }
  }
  draft[name].push(row);draft['活動商品明細'].push(...details);ids.push(id);
  const snapshot={id,run,name,notApplicable:m.notApplicable,offerHash:marketingOfferHash_(row),matchHash:marketingMatchHash_(row),details};if(carry){snapshot.carry={run:prior.run,id};snapshot.confirmedSkus=marketingSelectedSkus_(details);}
  snapshots.push(snapshot);
  const questions=[...v.questions,...marketingUnifiedIssues_({values:row,sheet:{getName:()=>name}},details)];if(questions.length)draft['覆核待辦'].push([run,run+'-Q'+(++q),id,loc,[...new Set(questions)].join('；'),'待確認','']);
 });records.push({sid:a.sid,cell:a.cell,evidence:a.evidence,support:a.support,name:a.variants[0].name,ids,series:variantRecords.map(v=>v.series),modes:variantRecords.map(v=>v.mode),variants:variantRecords});});return {draft,snapshots,records};
}
function commitMarketingWorkflow(token,mapping){return marketingWorkflowLocked_(()=>{
 const ss=assertMarketingBook_(),c=ss.getSheetByName(MS_CONTROL),before=c.getRange('B2:B8').getValues();let run='',logRow=0,controlTouched=false,writes=[];
 try{
 const p=marketingWorkflowUse_(token,'sync-analysis'),a=marketingWorkflowRecord_(ss,p.key);if(!a||a.status!=='ready')throw new Error('解析預覽不存在。');
 const source=marketingWorkflowSource_(ss,a.year,a.month),prior=marketingWorkflowPrior_(ss,a.year,a.month),master=readMarketingMaster_();if(marketingHash_(source)!==a.sourceHash||marketingWorkflowStamp_(ss,prior)!==a.stamp||master.fingerprint!==a.master)throw new Error('來源、商品主檔或同仁修改已變更；未捨棄原資料，請重新讀取。');
 const activities=marketingWorkflowResolve_(a.activities,prior.meta?.activities||[],String(a.year)+String(a.month).padStart(2,'0'),mapping||{},()=>Utilities.getUuid());if(activities.some(x=>!x.sid))throw new Error('請先確認每個活動的固定碼對應。');
 run=Utilities.formatDate(new Date(),'Asia/Taipei','yyyyMMdd-HHmmss')+'-'+Utilities.getUuid().slice(0,8);const built=marketingWorkflowBuild_(source,activities,run,master,prior,ss);
 if(!built.snapshots.length)throw new Error('本月沒有可建立的活動，不切換目前版本。');
 Object.keys(built.draft).forEach(n=>{const rows=built.draft[n];ensureMarketingTable_(ss,n);if(!rows.length)return;const sheet=ss.getSheetByName(n),r=sheet.getLastRow()+1;if(r+rows.length-1>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),r+rows.length-1-sheet.getMaxRows());sheet.getRange(r,1,rows.length,MS_TABLES[n].length).setNumberFormat('@');if(n==='活動商品明細')sheet.getRange(r,1,rows.length,1).setNumberFormat('General');sheet.getRange(r,1,rows.length,MS_TABLES[n].length).setValues(rows).setWrap(true);if(n==='活動商品明細')sheet.getRange(r,1,rows.length,1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build());writes.push({s:sheet,n,r,rows});});
 SpreadsheetApp.flush();writes.forEach(w=>{if(JSON.stringify(w.s.getRange(w.r,1,w.rows.length,MS_TABLES[w.n].length).getValues())!==JSON.stringify(w.rows))throw new Error('新草稿回讀不一致，原成功版本保留。');});
 marketingWorkflowRecord_(ss,'run:'+run,{version:MS_WORKFLOW_VERSION,state:'staging',source,activities:built.records,master:master.fingerprint,parent:prior.run});
 linkMarketingProducts_(ss,writes,built.snapshots,master);finishMarketingUnifiedDraft_(ss,writes,built.snapshots);
 const meta={version:MS_WORKFLOW_VERSION,source,activities:built.records,master:master.fingerprint,parent:prior.run,model:a.model,usage:a.usage,createdAt:new Date().toISOString()};marketingWorkflowRecord_(ss,'run:'+run,meta);
 if(marketingHash_(marketingWorkflowSource_(ss,a.year,a.month))!==a.sourceHash||marketingWorkflowStamp_(ss,prior)!==a.stamp||latestMarketingMaster_().identity!==master.identity)throw new Error('同步期間資料有變更，新版本未啟用。');
 const hash=marketingHash_({source,master:master.fingerprint}),log=ss.getSheetByName('同步紀錄');logRow=log.getLastRow()+1;log.appendRow([Utilities.formatDate(new Date(),'Asia/Taipei','yyyy-MM-dd HH:mm:ss'),MS_VERSION,run,hash,source.cells.length,built.draft['活動案型'].length,built.draft['贈品／加價購案型'].length,built.draft['覆核待辦'].length,'AI草稿待啟用']);
 controlTouched=true;c.getRange('B2:B4').setValues([[source.cells[0].sheet],[a.year],[a.month]]);writes.forEach(w=>filterMarketingRun_(w.s,w.n,run));c.getRange('B7:B8').setValues([[run],[hash]]);c.getRange('B6').setValue('AI同步完成；待覆核，未回寫原企劃。');SpreadsheetApp.flush();if(c.getRange('B7').getDisplayValue()!==run||c.getRange('B8').getDisplayValue()!==hash)throw new Error('成功版本切換回讀失敗。');log.getRange(logRow,9).setValue('草稿完成；未發布');marketingWorkflowConsume_(token);return {run,message:'AI草稿建立成功。未覆核修改未帶入，舊版與覆核紀錄保留；尚未回寫原企劃。'};
 }catch(error){
  if(controlTouched){try{if(c.getRange('B7').getDisplayValue()===run)c.getRange('B7:B8').setValues([[before[5][0]],[before[6][0]]]);if(c.getRange('B7').getDisplayValue()===String(before[5][0])){c.getRange('B2:B4').setValues(before.slice(0,3));c.getRange('B6').setValue(before[4][0]);writes.forEach(w=>{if(before[5][0])filterMarketingRun_(w.s,w.n,String(before[5][0]));else if(w.s.getFilter())w.s.getFilter().remove();});}}catch(_){} }
  if(logRow)try{ss.getSheetByName('同步紀錄').getRange(logRow,9).setValue('新版本未啟用，請核對；原成功版本保留');}catch(_){}
  throw error;
 }
 });}

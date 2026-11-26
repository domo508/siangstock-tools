// Independent action version: AI protocol and all existing review hashes remain unchanged.
const MS_BATCH_VERSION='20261123-marketing-cancel-batch-r1';
function marketingCancelMap_(ss,run){return marketingWorkflowRecord_(ss,'cancellations:'+run)||{};}
function marketingAssertActiveOffer_(ss,o,run){if(o.values[10]==='已取消'||marketingCancelMap_(ss,run)[marketingReviewId_(o)])throw new Error('此活動已取消；原商品勾選及覆核紀錄保留，不可再修改或覆核。');}
function marketingActionHash_(value){return marketingHash_(encodeURIComponent(JSON.stringify(value)));}
function marketingActionContext_(ss){
 const base=marketingReviewContext_(ss),offers=marketingCurrentOffers_(ss,base.run),details=marketingWorkflowAllDetails_(ss,base.run);let meta=marketingWorkflowRecord_(ss,'run:'+base.run);
 if(meta&&!MS_WORKFLOW_READ_VERSIONS.includes(meta.version))throw new Error('流程版本不符，請重新載入最新版。');
 if(!meta){
  const groups=new Map(),prefix='M'+base.source.year+String(base.source.month).padStart(2,'0')+'-A';
  offers.forEach(o=>{const h=MS_TABLES[o.sheet.getName()],ref=String(o.values[h.indexOf('來源位置')]).split('!').pop(),content=String(o.values[2]),key=marketingActionHash_([ref,content]);let a=groups.get(key);if(!a){const cell=base.source.cells.find(x=>x.ref===ref),raw=cell?.raw||'',at=raw.indexOf(content),unique=!!content&&at>=0&&raw.indexOf(content,at+1)<0;let evidence=content;if(unique&&at>0&&raw[at-1]==='*')evidence='*'+content;
   a={sid:prefix+key.slice(0,16),cell:ref,evidence,name:o.values[1],ids:[],series:[],variants:[],legacyRaw:raw,legacy:true,mappingError:unique?'':'舊活動無法唯一對應原企劃段落；本次不自動回寫，請交由管理者核對。'};groups.set(key,a);}
   a.ids.push(marketingReviewId_(o));a.series.push('');a.variants.push({id:marketingReviewId_(o),key:marketingWorkflowVariantKey_(o.values[0],o.values[5],o.sheet.getName()==='贈品／加價購案型'?String(o.values[11]).split(/[、,，\s]+/).filter(Boolean):[]),parsed:o.values.slice(0,10)});
  });meta={version:MS_WORKFLOW_VERSION,legacy:true,source:base.source,activities:[...groups.values()],master:base.master.fingerprint};
 }
 if(marketingActionHash_(meta.source)!==marketingActionHash_(base.source))throw new Error('原企劃版本已變動，請先核對來源，未寫入。');
 const cancels=marketingCancelMap_(ss,base.run);meta.activities.forEach(a=>{const cancelled=a.ids.map(id=>cancels[id]).find(Boolean);if(cancelled)a.cancelled={...cancelled,writeback:!!a.cancelled?.writeback};});
 return {...base,offers,details,meta};
}
function marketingActionGroup_(ctx,id){const a=ctx.meta.activities.find(a=>a.ids.includes(id));if(!a)throw new Error('找不到固定活動對應。');if(a.mappingError)throw new Error(a.mappingError);return a;}
function marketingBatchBusinessHash_(ss,run){return marketingActionHash_([marketingCurrentOffers_(ss,run).map(o=>[o.sheet.getName(),o.row,o.values]),marketingWorkflowAllDetails_(ss,run)]);}
function marketingActionStamp_(ctx){return marketingActionHash_([ctx.run,ctx.source,ctx.master.fingerprint,ctx.offers.map(o=>[o.sheet.getName(),o.row,o.values]),ctx.details,ctx.meta]);}
function marketingActionItems_(ss,ctx,a){
 const offers=ctx.offers.filter(o=>a.ids.includes(marketingReviewId_(o)));if(offers.length!==a.ids.length)throw new Error('活動變體不完整，停止操作。');
 return offers.map(o=>({id:marketingReviewId_(o),name:o.values[1],channel:o.values[5],stores:o.values[6],status:o.values[10],selected:ctx.details.filter(d=>d[7]===marketingReviewId_(o)&&d[0]===true&&d[1]).map(d=>({sku:d[1],name:d[2]}))}));
}
function previewMarketingCancellation(request){return marketingWorkflowLocked_(()=>{
 if(request?.version!==MS_BATCH_VERSION)throw new Error('請重新載入最新版。');const ss=assertMarketingBook_(),ctx=marketingActionContext_(ss),a=marketingActionGroup_(ctx,request.id);if(a.cancelled)throw new Error('此活動已取消，不重複取消。');
 const reason=String(request.reason||'').trim();if(!reason||reason.length>500||/^[=+@]/.test(reason))throw new Error('請填寫500字以內的取消原因。');
 const data={run:ctx.run,sid:a.sid,ids:a.ids,reason,stamp:marketingActionStamp_(ctx),operationId:Utilities.getUuid()};
 return {token:marketingWorkflowToken_('cancel-activity',data),name:[...new Set(ctx.offers.filter(o=>a.ids.includes(marketingReviewId_(o))).map(o=>o.values[1]))].join('／'),sid:a.sid,reason,items:marketingActionItems_(ss,ctx,a),message:'將取消此來源活動的全部通路／贈品版本。保留人工內容、商品勾選及原覆核紀錄；尚未回寫原企劃。'};
 });}
function commitMarketingCancellation(token){return marketingWorkflowLocked_(()=>{
 const p=marketingWorkflowUse_(token,'cancel-activity'),ss=assertMarketingBook_(),ctx=marketingActionContext_(ss),a=ctx.meta.activities.find(a=>a.sid===p.sid);if(!a||ctx.run!==p.run||marketingActionStamp_(ctx)!==p.stamp||a.cancelled)throw new Error('活動或同仁修改已變動，請重新預覽取消。');
 const key='cancel:'+p.operationId;if(marketingWorkflowRecord_(ss,key))throw new Error('此取消作業已送出，不重複執行。');
 const offers=ctx.offers.filter(o=>p.ids.includes(marketingReviewId_(o))),record={operationId:p.operationId,run:ctx.run,sid:p.sid,ids:p.ids,reason:p.reason,actor:marketingWorkflowActor_(),at:new Date().toISOString(),status:'cancelled',writeback:false,before:offers.map(o=>({id:marketingReviewId_(o),sheet:o.sheet.getName(),row:o.row,values:o.values,details:ctx.details.filter(d=>d[7]===marketingReviewId_(o)),snapshot:marketingSnapshot_(ctx.run,marketingReviewId_(o))}))};
 // Publish durable cancellation guard before changing display status. Never clear products or approval snapshots.
 marketingWorkflowRecord_(ss,key,record);const map=marketingCancelMap_(ss,ctx.run);p.ids.forEach(id=>map[id]={operationId:p.operationId,sid:p.sid,reason:p.reason,actor:record.actor,at:record.at,writeback:false});marketingWorkflowRecord_(ss,'cancellations:'+ctx.run,map);marketingWorkflowConsume_(token);
 a.name=[...new Set(offers.map(o=>o.values[1]))].join('／');a.cancelled=map[p.ids[0]];marketingWorkflowRecord_(ss,'run:'+ctx.run,ctx.meta);offers.forEach(o=>{o.sheet.getRange(o.row,11).setValue('已取消');marketingRefreshSummary_(ss,o);});[...new Set(offers.map(o=>o.sheet))].forEach(s=>{const f=s.getFilter();if(f)f.setColumnFilterCriteria(11,SpreadsheetApp.newFilterCriteria().setHiddenValues(['已取消']).build());});SpreadsheetApp.flush();
 if(offers.some(o=>o.sheet.getRange(o.row,11).getDisplayValue()!=='已取消'))throw new Error('取消已記錄，但顯示回讀未完成；不可重送，請重新讀取狀態。');
 return {message:'活動已取消，人工內容、商品勾選及原覆核快照保留。請前往第3區預覽並確認取消回寫；不需AI同步。',sid:p.sid,ids:p.ids};
 });}
function loadMarketingWritebackChoices(version){return marketingWorkflowLocked_(()=>{
 if(version!==MS_BATCH_VERSION)throw new Error('請重新載入最新版。');const ss=assertMarketingBook_(),ctx=marketingActionContext_(ss);
 return {version:MS_BATCH_VERSION,run:ctx.run,groups:ctx.meta.activities.filter(a=>!a.cancelled?.writeback).map(a=>{let reason=a.mappingError||'';const offers=ctx.offers.filter(o=>a.ids.includes(marketingReviewId_(o)));if(!reason&&!a.cancelled&&(offers.length!==a.ids.length||offers.some(o=>!marketingUnifiedValid_(ss,o,ctx.master,ctx.details))))reason='同一來源活動的通路／贈品版本尚未全部有效覆核';return {id:a.ids[0],sid:a.sid,name:[...new Set(offers.map(o=>o.values[1]))].join('／'),cancelled:!!a.cancelled,reason,available:!reason,items:marketingActionItems_(ss,ctx,a)};})};
 });}
function marketingBatchReplacement_(ss,ctx,a){
 if(a.cancelled)return '〔活動已取消:'+a.sid+'〕 '+String(a.name).replace(/[\r\n]/g,' ')+'｜原因：'+String(a.cancelled.reason).replace(/[\r\n]/g,' ');
 const offers=ctx.offers.filter(o=>a.ids.includes(marketingReviewId_(o)));if(offers.length!==a.ids.length||offers.some(o=>!marketingUnifiedValid_(ss,o,ctx.master,ctx.details)))throw new Error('同一來源活動的各通路／贈品版本須全部完成有效覆核。');
 return marketingWorkflowSourceText_(a.sid,offers.map(o=>({values:o.values,gift:o.sheet.getName()==='贈品／加價購案型',series:a.series[a.ids.indexOf(marketingReviewId_(o))]||'',products:ctx.details.filter(d=>d[7]===marketingReviewId_(o)&&d[0]===true&&d[1]).map(d=>({sku:d[1],name:d[2]}))})));
}
function previewMarketingWritebackBatch(request){return marketingWorkflowLocked_(()=>{
 if(request?.version!==MS_BATCH_VERSION||!Array.isArray(request.ids)||!request.ids.length||request.ids.length>20)throw new Error('請重新載入最新版，並選取1～20個活動。');const ss=assertMarketingBook_(),ctx=marketingActionContext_(ss),groups=[...new Set(request.ids.map(id=>marketingActionGroup_(ctx,id).sid))].map(sid=>ctx.meta.activities.find(a=>a.sid===sid)),cells=new Map();
 const items=groups.map(a=>{const c=ctx.source.cells.find(c=>c.ref===a.cell);if(!c)throw new Error('來源位置不存在。');const range=ss.getSheetByName(c.sheet).getRange(c.ref);if(range.getFormula())throw new Error('來源為公式，不直接覆蓋。');const before=range.getDisplayValue(),at=before.indexOf(a.evidence),replacement=marketingBatchReplacement_(ss,ctx,a);if(!a.evidence||at<0||before.indexOf(a.evidence,at+1)>=0)throw new Error('原活動段落已變更或不唯一：'+a.name);const k=c.sheet+'!'+c.ref,list=cells.get(k)||[];if(list.some(x=>at<x.end&&at+a.evidence.length>x.at))throw new Error('活動段落互相重疊，請交由管理者核對。');list.push({at,end:at+a.evidence.length});cells.set(k,list);return {sid:a.sid,ids:a.ids,name:a.name,sheet:c.sheet,ref:c.ref,beforeCell:before,before:a.evidence,after:replacement,cancelled:!!a.cancelled,items:marketingActionItems_(ss,ctx,a)};});
 const data={run:ctx.run,stamp:marketingActionStamp_(ctx),master:ctx.master.fingerprint,masterIdentity:ctx.master.identity,businessHash:marketingBatchBusinessHash_(ss,ctx.run),source:ctx.source,meta:ctx.meta,items,operationId:Utilities.getUuid(),actor:marketingWorkflowActor_()};if(encodeURIComponent(JSON.stringify(data)).length>240000)throw new Error('預覽內容較多，請減少本批活動數量後再試。');
 // Large snapshots stay in the existing chunked private audit store; token contains only its key.
 const key='batch-preview:'+data.operationId;marketingWorkflowRecord_(ss,key,data);
 return {token:marketingWorkflowToken_('writeback-batch',{key}),operationId:data.operationId,items:items.map(({beforeCell,...item})=>item),message:'已逐筆預覽；尚未回寫。確認後僅寫入這'+items.length+'個來源活動，同一活動不會重複寫入。'};
 });}
function marketingBatchFinalize_(ss,job){
 if(latestMarketingMaster_().identity!==job.masterIdentity||marketingBatchBusinessHash_(ss,job.run)!==job.businessHash)throw new Error('回寫期間商品主檔、勾選或覆核資料已變更，需人工對帳。');
 const source=readMarketingSource_(ss,ss.getSheetByName(MS_CONTROL)),expected=JSON.parse(JSON.stringify(job.source));
 job.cells.forEach(c=>{const actual=ss.getSheetByName(c.sheet).getRange(c.ref).getDisplayValue();if(actual!==c.current)throw new Error('回寫後又有來源異動，需人工對帳。');expected.cells.find(x=>x.ref===c.ref&&x.sheet===c.sheet).raw=c.current.trim();});
 if(marketingActionHash_(source)!==marketingActionHash_(expected))throw new Error('其它原企劃內容已變動，停止版本對帳。');
 const currentMeta=marketingWorkflowRecord_(ss,'run:'+job.run);if(currentMeta&&marketingActionHash_(currentMeta)!==marketingActionHash_(job.meta)&&currentMeta.batchWriteback!==job.operationId)throw new Error('流程紀錄已變更，停止版本對帳。');
 const meta=JSON.parse(JSON.stringify(job.meta));job.items.forEach(item=>{if(!job.completed.includes(item.sid))return;const a=meta.activities.find(a=>a.sid===item.sid);a.evidence=item.after;if(a.cancelled)a.cancelled.writeback=true;});meta.source=source;meta.batchWriteback=job.operationId;
 marketingWorkflowRecord_(ss,'run:'+job.run,meta);const c=ss.getSheetByName(MS_CONTROL),hash=marketingHash_({source,master:job.master});c.getRange('B8').setValue(hash);SpreadsheetApp.flush();if(c.getRange('B8').getDisplayValue()!==hash)throw new Error('版本對帳回讀失敗。');
 PropertiesService.getDocumentProperties().deleteProperty('marketing-batch-pending');job.status=job.completed.length===job.items.length?'completed':'partial';marketingWorkflowRecord_(ss,'batch-writeback:'+job.operationId,job);
 return {operationId:job.operationId,status:job.status,completed:job.completed.length,total:job.items.length,items:job.items.map(i=>({name:i.name,sid:i.sid,success:job.completed.includes(i.sid),cancelled:i.cancelled})),message:job.status==='completed'?'全部回寫完成並核對一致，不需再次AI同步。':'僅部分活動回寫完成，已停止且未自動重送；請查看逐筆結果，未完成項目需重新預覽。'};
}
function commitMarketingWritebackBatch(token){return marketingWorkflowLocked_(()=>{
 const p=marketingWorkflowUse_(token,'writeback-batch'),ss=assertMarketingBook_(),plan=marketingWorkflowRecord_(ss,p.key),ctx=marketingActionContext_(ss);if(!plan||plan.actor!==marketingWorkflowActor_()||plan.run!==ctx.run||plan.stamp!==marketingActionStamp_(ctx))throw new Error('來源、主檔、活動或同仁修改已變動；整批尚未寫入，請重新預覽。');
 if(marketingWorkflowRecord_(ss,'batch-writeback:'+plan.operationId))throw new Error('此批已送出，不重複回寫。');
 plan.items.forEach(item=>{const r=ss.getSheetByName(item.sheet).getRange(item.ref);if(r.getFormula()||r.getDisplayValue()!==item.beforeCell)throw new Error('原企劃已改動，整批尚未寫入。');});
 const cells=[...new Map(plan.items.map(i=>[i.sheet+'!'+i.ref,{sheet:i.sheet,ref:i.ref,current:i.beforeCell}])).values()],job={...plan,cells,completed:[],status:'prepared',at:new Date().toISOString()};
 marketingWorkflowRecord_(ss,'batch-writeback:'+job.operationId,job);PropertiesService.getDocumentProperties().setProperty('marketing-batch-pending',job.operationId);marketingWorkflowConsume_(token);
 try{
  for(const item of job.items){if(latestMarketingMaster_().identity!==job.masterIdentity||marketingBatchBusinessHash_(ss,job.run)!==job.businessHash)throw new Error('回寫期間主檔或覆核已變更，已停止。');const cell=job.cells.find(c=>c.sheet===item.sheet&&c.ref===item.ref),r=ss.getSheetByName(item.sheet).getRange(item.ref);if(r.getFormula()||r.getDisplayValue()!==cell.current)throw new Error('回寫期間原企劃被改動，已停止。');const after=marketingWorkflowPatchText_(cell.current,item.before,item.after),n=r.createTextFinder(item.before).matchEntireCell(false).matchCase(true).useRegularExpression(false).replaceAllWith(item.after);SpreadsheetApp.flush();if(n!==1||r.getDisplayValue()!==after)throw new Error('單筆回寫回讀未完成，請核對，不重送。');cell.current=after;job.completed.push(item.sid);marketingWorkflowRecord_(ss,'batch-writeback:'+job.operationId,{...job,status:'writing'});}
  return marketingBatchFinalize_(ss,job);
 }catch(error){
  job.error=error.message;try{return {...marketingBatchFinalize_(ss,job),error:error.message};}catch(reconcile){job.status='needs-reconcile';PropertiesService.getDocumentProperties().setProperty('marketing-batch-pending',job.operationId);job.error+='；'+reconcile.message;try{marketingWorkflowRecord_(ss,'batch-writeback:'+job.operationId,job);}catch(_){}return {operationId:job.operationId,status:'needs-reconcile',completed:job.completed.length,total:job.items.length,items:job.items.map(i=>({name:i.name,sid:i.sid,success:job.completed.includes(i.sid)})),message:'回寫未完成版本對帳，已停止其它寫入；請保留作業編號並按「核對部分完成結果」，不會重送原企劃。',error:job.error};}
 }
 });}
function reconcileMarketingWritebackBatch(operationId){return marketingWorkflowLocked_(()=>{
 const ss=assertMarketingBook_(),job=marketingWorkflowRecord_(ss,'batch-writeback:'+operationId),c=ss.getSheetByName(MS_CONTROL);if(!job||job.actor!==marketingWorkflowActor_()||job.run!==c.getRange('B7').getDisplayValue())throw new Error('作業不存在、帳號或工作版本不同，請交由管理者核對。');if(!['needs-reconcile','writing','prepared'].includes(job.status))throw new Error('此作業已完成對帳，不重送。');
 // Recover only exact planned cell states. Never issue another source write.
 job.completed=[];job.cells.forEach(cell=>{const items=job.items.filter(i=>i.sheet===cell.sheet&&i.ref===cell.ref),actual=ss.getSheetByName(cell.sheet).getRange(cell.ref).getDisplayValue();let value=items[0].beforeCell,matched=actual===value,done=[];for(const item of items){value=marketingWorkflowPatchText_(value,item.before,item.after);done.push(item.sid);if(actual===value){matched=true;job.completed.push(...done);break;}}if(!matched)throw new Error('原企劃不是可驗證的回寫狀態，未對帳、未重送；請交由管理者核對。');cell.current=actual;});return marketingBatchFinalize_(ss,job);
 },true);}

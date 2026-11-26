function marketingWorkflowContext_(ss){const ctx=marketingReviewContext_(ss),meta=marketingWorkflowRecord_(ss,'run:'+ctx.run);if(!meta||!MS_WORKFLOW_READ_VERSIONS.includes(meta.version))throw new Error('此版本尚未建立固定活動對應。請先完成新版AI同步；舊版資料與覆核紀錄保留。');if(marketingHash_(meta.source)!==marketingHash_(ctx.source))throw new Error('原企劃版本已變動，請先同步比對。');return {...ctx,meta,offers:marketingCurrentOffers_(ss,ctx.run),details:marketingWorkflowAllDetails_(ss,ctx.run)};}
function marketingWorkflowOfferToken_(o,ctx){return marketingHash_([o.values,ctx.details.filter(d=>d[7]===marketingReviewId_(o)),ctx.meta]);}
function loadMarketingWorkflowOffer(id){return marketingWorkflowLocked_(()=>{
 const ss=assertMarketingBook_(),ctx=marketingWorkflowContext_(ss),o=ctx.offers.find(o=>marketingReviewId_(o)===id);if(!o)throw new Error('指定活動不在目前版本。');const group=ctx.meta.activities.find(a=>a.ids.includes(id)),variant=group.ids.indexOf(id),d=ctx.details.filter(x=>x[7]===id);
 return {version:MS_WORKFLOW_VERSION,id,sid:group.sid,run:ctx.run,fields:o.values.slice(0,o.sheet.getName()==='活動案型'?11:15),gift:o.sheet.getName()==='贈品／加價購案型',series:group.series[variant]||'',selected:marketingSelectedSkus_(d),products:d.filter(x=>x[1]).map(x=>({sku:x[1],name:x[2],selected:x[0]===true})),expected:marketingWorkflowOfferToken_(o,ctx),notApplicable:!!marketingSnapshot_(ctx.run,id)?.notApplicable,source:group.evidence,preview:marketingPreviewOffer_(ss,o,ctx)};
 });}
function saveMarketingWorkflowOffer(request){return marketingWorkflowLocked_(()=>{
 const ss=assertMarketingBook_(),ctx=marketingWorkflowContext_(ss),o=ctx.offers.find(o=>marketingReviewId_(o)===request?.id);if(request?.version!==MS_WORKFLOW_VERSION||!o||request.run!==ctx.run||request.expected!==marketingWorkflowOfferToken_(o,ctx))throw new Error('版本或同仁修改已變更，未覆蓋，請重新讀取。');
 marketingAssertActiveOffer_(ss,o,ctx.run);const n=o.sheet.getName()==='活動案型'?10:15,fields=request.fields;if(!Array.isArray(fields)||fields.length!==n||fields.some(x=>typeof x!=='string'||x.length>8000||/^\s*[=+@]/.test(x))||!fields[1].trim()||!fields[2].trim()||!Array.isArray(request.selected)||request.selected.some(x=>typeof x!=='string')||typeof request.series!=='string'||request.series.length>200)throw new Error('活動欄位格式不正確。');
 if(n===15&&fields[10]!=='待覆核')throw new Error('儲存不能代替覆核。');
 const selected=[...new Set(request.selected)],old=ctx.details.filter(x=>x[7]===request.id),snap=marketingSnapshot_(ctx.run,request.id);if(!snap||snap.master!==ctx.master.fingerprint||snap.count!==old.length||snap.detailHash!==marketingDetailHash_(old,false)||(snap.offerHash!==marketingOfferHash_(o.values)&&snap.matchHash!==marketingMatchHash_(o.values)))throw new Error('既有商品條件或明細已被改寫，停止重新簽認；請重新同步或交由管理者核對。');if(snap.notApplicable&&selected.length)throw new Error('非商品型活動不接受品號。');
 const items=selected.map(sku=>{const p=ctx.master.products.find(p=>p.sku===sku);if(!p||marketingProductExclusion_(p))throw new Error('無效或排除品號：'+sku);return p;});
 const oldIds=new Set(old.map(x=>x[1])),append=items.filter(p=>!oldIds.has(p.sku)).map(p=>[true,p.sku,p.name,'人工新增：新版活動編輯',o.sheet.getName()==='活動案型'?'優惠商品':fields[0]==='加價購'?'加價購品':'贈品','需重新確認','返回主表',request.id,ctx.run,ctx.master.fingerprint,o.sheet.getName(),o.row]);
 const row=o.values.slice();fields.forEach((v,i)=>row[i]=v);row[10]='待覆核';
 const sheet=ss.getSheetByName('活動商品明細'),physical=sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,12).getValues():[];
 // Stage an audit snapshot before touching mutable draft rows. This is not an
 // approval. Existing confirmed snapshots and prior runs remain append-only.
 const audit='edit:'+Utilities.getUuid();marketingWorkflowRecord_(ss,audit,{run:ctx.run,id:request.id,before:o.values,details:old,series:ctx.meta.activities.find(a=>a.ids.includes(request.id)).series,at:new Date().toISOString()});
 const fresh=marketingWorkflowContext_(ss),freshOffer=fresh.offers.find(x=>marketingReviewId_(x)===request.id);if(!freshOffer||marketingWorkflowOfferToken_(freshOffer,fresh)!==request.expected)throw new Error('保存前同仁已修改，停止覆蓋。');
 o.sheet.getRange(o.row,1,1,row.length).setValues([row]);physical.forEach((d,i)=>{if(d[7]===request.id&&d[8]===ctx.run){sheet.getRange(i+2,1).setValue(selected.includes(d[1]));sheet.getRange(i+2,6).setValue('需重新確認');}});
 if(append.length){const at=sheet.getLastRow()+1;sheet.getRange(at,1,append.length,1).setNumberFormat('General');sheet.getRange(at,1,append.length,12).setValues(append);sheet.getRange(at,1,append.length,1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build());}
 SpreadsheetApp.flush();const after=marketingOfferDetails_(ss,request.id,ctx.run),expectedDetails=old.map(d=>{const x=d.slice();x[0]=selected.includes(x[1]);x[5]='需重新確認';return x;}).concat(append);
 if(marketingDetailHash_(after,true)!==marketingDetailHash_(expectedDetails,true)||JSON.stringify(o.sheet.getRange(o.row,1,1,row.length).getValues()[0])!==JSON.stringify(row))throw new Error('保存回讀未完成，請查看操作紀錄，不要重複送出。');
 const group=ctx.meta.activities.find(a=>a.ids.includes(request.id));group.series[group.ids.indexOf(request.id)]=request.series;
 marketingWorkflowRecord_(ss,'run:'+ctx.run,ctx.meta);snap.offerHash=marketingOfferHash_(row);snap.matchHash=marketingMatchHash_(row);snap.detailHash=marketingDetailHash_(after,false);snap.count=after.length;snap.unifiedHash='';snap.decisionHash='';marketingSaveSnapshot_(marketingProductKey_(ctx.run,request.id),snap);marketingRefreshSummary_(ss,{...o,values:row});
 return {message:'草稿已保存，需重新覆核；原企劃未修改。',id:request.id};
 });}
function reviewMarketingWorkflowOffer(request){return marketingWorkflowLocked_(()=>{
 const ss=assertMarketingBook_(),ctx=marketingWorkflowContext_(ss),o=ctx.offers.find(o=>marketingReviewId_(o)===request?.id);if(request?.version!==MS_WORKFLOW_VERSION||!o||request.run!==ctx.run||request.expected!==marketingWorkflowOfferToken_(o,ctx))throw new Error('覆核預覽已變動，請重新讀取。');
 commitMarketingUnified_(ss,o,ctx.master);return {message:'活動已完成覆核，尚未回寫原企劃；請另行預覽回寫。'};
 });}
function previewMarketingWriteback(id){return marketingWorkflowLocked_(()=>{
 const ss=assertMarketingBook_(),ctx=marketingWorkflowContext_(ss),a=ctx.meta.activities.find(a=>a.ids.includes(id));if(!a)throw new Error('沒有固定活動對應。');const offers=ctx.offers.filter(o=>a.ids.includes(marketingReviewId_(o)));
 if(offers.length!==a.ids.length||offers.some(o=>!marketingUnifiedValid_(ss,o,ctx.master,ctx.details)))throw new Error('同一來源活動的各通路／贈品變體須全部完成有效覆核，才能回寫，避免覆蓋另一個未覆核變體。');
 if(a.cancelled)throw new Error('已取消活動請使用第3區批次回寫預覽，不能回寫原優惠內容。');const c=ctx.source.cells.find(c=>c.ref===a.cell),range=ss.getSheetByName(c.sheet).getRange(c.ref);if(range.getFormula())throw new Error('來源是公式，不直接覆蓋。');
 const variants=offers.map(o=>({values:o.values,gift:o.sheet.getName()==='贈品／加價購案型',series:a.series[a.ids.indexOf(marketingReviewId_(o))],products:ctx.details.filter(d=>d[7]===marketingReviewId_(o)&&d[0]&&d[1]).map(d=>({sku:d[1],name:d[2]}))}));
 const before=range.getDisplayValue(),replacement=marketingWorkflowSourceText_(a.sid,variants),after=marketingWorkflowPatchText_(before,a.evidence,replacement),data={run:ctx.run,sid:a.sid,sheet:c.sheet,ref:c.ref,before,evidence:a.evidence,after,replacement,sourceHash:marketingHash_(ctx.source),master:ctx.master.fingerprint,expected:marketingHash_(offers.map(o=>marketingWorkflowOfferToken_(o,ctx))),operationId:Utilities.getUuid()};
 return {token:marketingWorkflowToken_('writeback',data),sid:a.sid,before:a.evidence,after:replacement,location:c.sheet+'!'+c.ref,message:'只更新此活動段落；不覆蓋同格其它活動。確認回寫前會再次核對原文與覆核版本。'};
 });}
function commitMarketingWriteback(token){return marketingWorkflowLocked_(()=>{
 const ss=assertMarketingBook_(),p=marketingWorkflowUse_(token,'writeback'),ctx=marketingWorkflowContext_(ss),a=ctx.meta.activities.find(x=>x.sid===p.sid),offers=ctx.offers.filter(o=>a?.ids.includes(marketingReviewId_(o)));
 if(!a||ctx.run!==p.run||ctx.master.fingerprint!==p.master||marketingHash_(ctx.source)!==p.sourceHash||marketingHash_(offers.map(o=>marketingWorkflowOfferToken_(o,ctx)))!==p.expected||offers.some(o=>!marketingUnifiedValid_(ss,o,ctx.master,ctx.details)))throw new Error('來源、主檔或覆核結果已變更，停止回寫；請重新讀取差異。');
 if(a.cancelled)throw new Error('活動已取消，舊預覽失效。');const range=ss.getSheetByName(p.sheet).getRange(p.ref);if(range.getFormula()||range.getDisplayValue()!==p.before)throw new Error('原企劃在預覽後已變更，未回寫。');
 const journal={...p,status:'prepared',actor:marketingWorkflowActor_(),at:new Date().toISOString()};marketingWorkflowRecord_(ss,'writeback:'+p.operationId,journal);
 // Replace only the unique activity substring at the service operation. Do not
 // rewrite neighboring activity text or rich-text runs with a blind setValue.
 const changed=range.createTextFinder(p.evidence).matchEntireCell(false).matchCase(true).useRegularExpression(false).replaceAllWith(p.replacement);
 if(changed!==1)throw new Error('來源已變更，條件式回寫未執行；已保留預覽與原紀錄。');
 SpreadsheetApp.flush();if(range.getDisplayValue()!==p.after){marketingWorkflowRecord_(ss,'writeback:'+p.operationId,{...journal,status:'needs-reconcile'});throw new Error('原企劃回讀不一致，請由管理者依回寫紀錄核對，不要重送。');}
 const expectedSource=JSON.parse(JSON.stringify(ctx.source));expectedSource.cells.find(c=>c.ref===p.ref).raw=p.after.trim();
 const actual=readMarketingSource_(ss,ctx.c);if(marketingHash_(actual)!==marketingHash_(expectedSource)){marketingWorkflowRecord_(ss,'writeback:'+p.operationId,{...journal,status:'needs-reconcile'});throw new Error('此活動已回寫，但其它來源同時變更，版本對帳未完成。請保留畫面交由管理者核對，不要重送。');}
 ctx.meta.source=actual;a.evidence=p.replacement;ctx.meta.writeback={operationId:p.operationId,sid:p.sid,at:new Date().toISOString()};marketingWorkflowRecord_(ss,'run:'+ctx.run,ctx.meta);
 ctx.c.getRange('B8').setValue(marketingHash_({source:actual,master:ctx.master.fingerprint}));SpreadsheetApp.flush();if(ctx.c.getRange('B8').getDisplayValue()!==marketingHash_({source:readMarketingSource_(ss,ctx.c),master:ctx.master.fingerprint}))throw new Error('回寫後版本核對失敗，請交由管理者核對，不重送。');
 marketingWorkflowRecord_(ss,'writeback:'+p.operationId,{...journal,status:'completed'});marketingWorkflowConsume_(token);return {message:'原企劃已回寫並核對一致，不需再次同步。既有覆核、品號快照與歷史保留，未發布至採購／週調撥。'};
 });}

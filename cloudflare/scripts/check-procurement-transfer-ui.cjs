// Isolated synthetic browser test. The runtime hook exists only in the intercepted
// local response, never in production app.js. No requests leave this process.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
process.chdir(path.join(root,'cloudflare'));
const test=fs.readFileSync('test/activity-planning.test.js','utf8');
const fixtureCode=test.slice(test.indexOf('const context ='),test.indexOf('describe("跨月活動'));
const fixtureResult=new Function('readFileSync','vm',fixtureCode+';return {analysis:run({activityDemand:{...fixture.activityDemand,endDate:"2026-11-11",monthlyTargets:{"2026-11":{amount:10000000}}}}),history:fixture.activityHistory};')(fs.readFileSync,vm);
const {analysis,history}=fixtureResult;
analysis.validation={dateCheck:{status:'PASS',message:'合成日期通過'}};
const original=JSON.stringify(analysis);
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];let posted,savedDraft;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname!=='siangstock.test'){await route.abort();return;}
  if(url.pathname==='/api/store-transfer/activity-plans' && req.method()==='POST'){posted=req.postDataJSON();await route.fulfill({json:{id:'synthetic-plan'}});return;}
  if(url.pathname==='/api/procurement/collaboration-drafts/QA' && req.method()==='PUT'){savedDraft=req.postDataJSON();await route.fulfill({json:{draft:{id:'QA',revision:2}}});return;}
  if(url.pathname.startsWith('/api/')){await route.fulfill({json:{email:'qa@siangapato.com.tw',permissions:{canApprove:true},months:[],batches:[],openOrders:[],drafts:[],rows:[],rules:{}}});return;}
  let file=path.join(root,decodeURIComponent(url.pathname));if(url.pathname.endsWith('/'))file=path.join(file,'index.html');
  if(!fs.existsSync(file)){await route.fulfill({status:404,body:''});return;}
  let body=fs.readFileSync(file);if(url.pathname==='/procurement-planning/app.js')body=body.toString().replace(/\}\)\(\);\s*$/,`globalThis.__qa={restore:restoreWorkflowDraft,getAnalysis:()=>JSON.stringify(state.analysis),getShareableAnalysis:()=>JSON.parse(sharedSnapshotJson(workflowSnapshot())).analysis,setHistory:h=>{loadActivityHistory=async()=>h;}};})();`);
  await route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html'});
 });
 await page.goto('https://siangstock.test/procurement-planning/');
 await page.waitForFunction(()=>!!globalThis.__qa);
 await page.evaluate(a=>globalThis.__qa.restore({id:'QA',sharedDraftId:'QA',sharedDraftRevision:1,parentBatchId:'QA',stage:'analysis',analysis:a,baseAnalysis:a,selectedSuppliers:[],controls:{month:'2026-10',checkpoint:'mid-month',activityDemand:a.appliedRules.activityDemand},consignmentStyleAudit:{pinkDetected:false,pinkCells:0}}),analysis);
 await page.evaluate(h=>globalThis.__qa.setHistory(h),history);
 assert(await page.locator('#result-panel #publish-transfer-activity').isVisible());
 assert.equal(await page.locator('#activity-demand-card #publish-transfer-activity').count(),0);
 assert.equal(await page.evaluate(()=>globalThis.__qa.getAnalysis()),original);
 await page.locator('#activity-transfer-backfill summary').click();
 assert(await page.locator('#build-transfer-activity-draft').isDisabled());
 assert(await page.locator('#save-transfer-activity-draft').isDisabled());
 const initialRetail=await page.locator('[data-backfill-month="2026-11"]').inputValue();
 await page.locator('[data-backfill-month="2026-11"]').fill('3600000');
 assert(await page.locator('#build-transfer-activity-draft').isEnabled());
 assert(await page.locator('#save-transfer-activity-draft').isDisabled());
 await page.locator('[data-backfill-month="2026-11"]').fill(initialRetail);
 assert(await page.locator('#build-transfer-activity-draft').isDisabled());
 await page.locator('[data-backfill-month="2026-11"]').fill('3500000');
 await page.locator('#activity-correction-end').fill('2026-11-15');
 await page.locator('#activity-correction-reason').fill('合成測試：同仁原日期誤填');
 assert(await page.locator('#publish-transfer-activity').isDisabled());
 await page.locator('#build-transfer-activity-draft').click();
 await page.getByText(/門市草稿已重建，請展開核對/).waitFor();
 assert(await page.locator('#build-transfer-activity-draft').isDisabled());
 assert(await page.locator('#save-transfer-activity-draft').isEnabled());
 assert.match(await page.locator('#activity-transfer-summary').innerText(),/3,500,000/);
 assert.equal(await page.evaluate(()=>globalThis.__qa.getAnalysis()),original);
 await page.locator('#save-transfer-activity-draft').click();await page.getByText(/已儲存至原母批次第2版/).waitFor();assert.equal(savedDraft.expectedRevision,1);
 const payload=JSON.parse(savedDraft.payloadEncoding==='gzip-base64'?require('node:zlib').gunzipSync(Buffer.from(savedDraft.payload,'base64')).toString():savedDraft.payload);
 assert(await page.locator('#save-transfer-activity-draft').isDisabled());
 assert(await page.locator('#build-transfer-activity-draft').isDisabled());
 assert.deepEqual(payload.analysis,await page.evaluate(()=>globalThis.__qa.getShareableAnalysis()));assert.equal(payload.transferActivityDraft.endDate,'2026-11-15');assert.equal(payload.transferActivityCorrection.originalEndDate,'2026-11-11');
 await page.locator('#publish-transfer-activity').click();await page.getByText(/已發布活動草稿 synthetic-plan/).waitFor();
 assert.equal(posted.source.months[0].retailTarget,3500000);assert.equal(posted.source.months[0].onlineAndOtherTarget,6500000);assert.equal(posted.source.endDate,'2026-11-15');
 assert.equal(await page.evaluate(()=>globalThis.__qa.getAnalysis()),original);
 for(const width of [1280,375,320]){
  await page.setViewportSize({width,height:900});
  const b=await page.locator('#activity-transfer-result').evaluate(el=>({w:el.clientWidth,s:el.scrollWidth}));assert(b.s<=b.w+1,`card overflow ${width}`);
  const steps=await page.locator('.activity-draft-step').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:el.clientWidth,s:el.scrollWidth};}));
  assert(steps.every(s=>s.s<=s.w+1),`step overflow ${width}`);
  assert(width>760?steps[1].x-steps[0].right>=23:steps[1].y-steps[0].bottom>=15,`separate steps ${width}`);
  for(const id of ['build-transfer-activity-help','save-transfer-activity-help'])assert(await page.locator('#'+id).isVisible());
  if(width===1280){await page.locator('.activity-draft-steps').screenshot({path:'/private/tmp/activity-draft-buttons-desktop.png'});}
  if(width===375){await page.locator('.activity-draft-steps').screenshot({path:'/private/tmp/activity-draft-buttons-mobile.png'});}
 }
 await page.evaluate(p=>globalThis.__qa.restore(p),payload);
 assert(await page.locator('#save-transfer-activity-draft').isDisabled());
 assert(await page.locator('#build-transfer-activity-draft').isDisabled());
 await page.locator('#activity-transfer-backfill summary').click();
 await page.locator('#activity-correction-end').fill('2026-11-14');
 assert(await page.locator('#build-transfer-activity-draft').isEnabled());
 assert(await page.locator('#save-transfer-activity-draft').isDisabled());
 await page.locator('#activity-correction-end').fill('2026-11-15');
 assert(await page.locator('#build-transfer-activity-draft').isDisabled());
 const legacy=structuredClone(payload);delete legacy.transferActivityDraft;delete legacy.analysis.activityTransferSource;if(legacy.baseAnalysis)delete legacy.baseAnalysis.activityTransferSource;
 await page.evaluate(p=>globalThis.__qa.restore(p),legacy);
 assert(await page.locator('#build-transfer-activity-draft').isEnabled());
 assert(await page.locator('#save-transfer-activity-draft').isDisabled());
 assert.deepEqual(errors,[]);console.log('PASS: unchanged/reverted/restore controls locked, legacy first build allowed, build then save gating, original analysis conservation, publish flow, 1280/375/320 layout');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

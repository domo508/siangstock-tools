// Isolated synthetic browser test. The runtime hook exists only in the intercepted
// local response, never in production app.js. No requests leave this process.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
process.chdir(path.join(root,'cloudflare'));
const test=fs.readFileSync('test/activity-planning.test.js','utf8');
const fixtureCode=test.slice(test.indexOf('const context ='),test.indexOf('describe("跨月活動'));
const analysis=new Function('readFileSync','vm',fixtureCode+';return run({activityDemand:{...fixture.activityDemand,monthlyTargets:{"2026-11":{amount:10000000}}}});')(fs.readFileSync,vm);
analysis.validation={dateCheck:{status:'PASS',message:'合成日期通過'}};
const original=JSON.stringify(analysis);
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];let posted;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname!=='siangstock.test'){await route.abort();return;}
  if(url.pathname==='/api/store-transfer/activity-plans' && req.method()==='POST'){posted=req.postDataJSON();await route.fulfill({json:{id:'synthetic-plan'}});return;}
  if(url.pathname.startsWith('/api/')){await route.fulfill({json:{email:'qa@siangapato.com.tw',permissions:{canApprove:true},months:[],batches:[],openOrders:[],drafts:[],rows:[],rules:{}}});return;}
  let file=path.join(root,decodeURIComponent(url.pathname));if(url.pathname.endsWith('/'))file=path.join(file,'index.html');
  if(!fs.existsSync(file)){await route.fulfill({status:404,body:''});return;}
  let body=fs.readFileSync(file);if(url.pathname==='/procurement-planning/app.js')body=body.toString().replace(/\}\)\(\);\s*$/,`globalThis.__qa={restore:restoreWorkflowDraft,getAnalysis:()=>JSON.stringify(state.analysis)};})();`);
  await route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html'});
 });
 await page.goto('https://siangstock.test/procurement-planning/');
 await page.waitForFunction(()=>!!globalThis.__qa);
 await page.evaluate(a=>globalThis.__qa.restore({id:'QA',stage:'suggested',analysis:a,baseAnalysis:a,selectedSuppliers:[],controls:{activityDemand:a.appliedRules.activityDemand},consignmentStyleAudit:{pinkDetected:false,pinkCells:0}}),analysis);
 assert(await page.locator('#result-panel #publish-transfer-activity').isVisible());
 assert.equal(await page.locator('#activity-demand-card #publish-transfer-activity').count(),0);
 assert.equal(await page.evaluate(()=>globalThis.__qa.getAnalysis()),original);
 await page.locator('#activity-transfer-backfill summary').click();
 await page.locator('[data-backfill-month="2026-11"]').fill('3500000');
 assert(await page.locator('#publish-transfer-activity').isDisabled());
 await page.locator('#build-transfer-activity-draft').click();
 await page.getByText(/門市草稿已補建，請展開核對/).waitFor();
 assert.match(await page.locator('#activity-transfer-summary').innerText(),/3,500,000/);
 assert.equal(await page.evaluate(()=>globalThis.__qa.getAnalysis()),original);
 await page.locator('#publish-transfer-activity').click();await page.getByText(/已發布活動草稿 synthetic-plan/).waitFor();
 assert.equal(posted.source.months[0].retailTarget,3500000);assert.equal(posted.source.months[0].onlineAndOtherTarget,6500000);
 assert.equal(await page.evaluate(()=>globalThis.__qa.getAnalysis()),original);
 for(const width of [1280,375,320]){await page.setViewportSize({width,height:900});const b=await page.locator('#activity-transfer-result').evaluate(el=>({w:el.clientWidth,s:el.scrollWidth}));assert(b.s<=b.w+1,`card overflow ${width}`);}
 assert.deepEqual(errors,[]);console.log('PASS: original 10m analysis unchanged, 3.5m backfill, result-area publish, API payload 3.5m/6.5m, stale-target blocking, 1280/375/320 card layout');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

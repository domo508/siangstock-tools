const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://accounts.google.com/**',r=>r.abort());
  const stores=Object.fromEntries(['R00','R01','R03','R10','R07','R06'].map(s=>[s,{name:s+'合成門市'}]));
  let plan={id:'qa-activity',revision:1,status:'draft',config:{},source:{version:1,name:'合成雙11',scope:'all',asOfDate:'2026-10-31',startDate:'2026-11-11',endDate:'2026-11-15',months:[{month:'2026-11',retailTarget:3000,onlineAndOtherTarget:7000,targets:Object.fromEntries(Object.keys(stores).map(s=>[s,s==='R00'?3000:0])),weights:Object.fromEntries(Object.keys(stores).map(s=>[s,Array(30).fill(1/30)]))}],rows:[{storeCode:'R00',sku:'A001',quantities:{'2026-11':30}}]}};
  await page.route('**/api/store-transfer/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(req.method()==='PUT' && path.endsWith('/qa-activity')) {const b=req.postDataJSON();plan={...plan,config:b.config,status:b.status,revision:2};await route.fulfill({json:{id:plan.id,revision:2}});return;}
   const payload=path.endsWith('/config')?{role:'admin',email:'qa@siangapato.com.tw',stores,permissions:{},storeInventoryRules:{config:{}}}:path.endsWith('/activity-plans')?{plans:[{id:plan.id,name:plan.source.name,startDate:plan.source.startDate,endDate:plan.source.endDate,status:plan.status,revision:plan.revision}]}:path.endsWith('/qa-activity')?{plan}:path.endsWith('/batches')?{batches:[]}:path.endsWith('/pending-purchases')?{rows:[]}:{drafts:[]};
   await route.fulfill({json:payload});
  });
  await page.goto('http://127.0.0.1:8876/store-transfer/');
  await page.locator('#refresh-activity-plans').click();await page.locator('#activity-plan-select').selectOption('qa-activity');
  await page.locator('#activity-start-proposal').waitFor();assert.equal(await page.locator('#activity-start-proposal').inputValue(),'2026-11-02');
  assert.match(await page.locator('#activity-week-preview').innerText(),/2026-11-05到店＋2日緩衝至2026-11-07/);
  assert.match(await page.locator('#activity-week-preview').innerText(),/2026-11-12到店＋2日緩衝至2026-11-14/);
  await page.locator('#activity-confirm-reason').fill('合成總部共同確認');await page.locator('#confirm-activity-plan').click();await page.getByText(/總部已確認，可勾選納入本次正式補貨/).waitFor();
  assert.equal(plan.revision,2);assert.equal(plan.config.targets['2026-11'].R00,3000);
  for(const width of [1280,375,320]) {
   await page.setViewportSize({width,height:900});
   const bounds=await page.locator('#activity-plan-panel').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,inner:el.scrollWidth,width:el.clientWidth}));
   assert(bounds.left>=0 && bounds.right<=width+1 && bounds.inner<=bounds.width+1,`overflow at ${width}: ${JSON.stringify(bounds)}`);
  }
  assert.deepEqual(errors,[]);console.log('UI PASS: desktop 1280, mobile 375/320; W45/W46 buffer; HQ confirmation; no page errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

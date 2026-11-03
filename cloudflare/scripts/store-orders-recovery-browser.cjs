// Browser acceptance with synthetic responses only; no real API or paid AI.
const {chromium}=require(require('node:os').homedir()+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const origin=process.env.STORE_ORDERS_ORIGIN||'http://127.0.0.1:8794';
(async()=>{const {VERSION}=await import('../../store-orders/core.js'),{syntheticFullOrder}=await import('../../store-orders/synthetic-form.js');const raw=syntheticFullOrder();raw.header.storeCode='R14';const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [390,320,1280]){
  const c=await browser.newContext({viewport:{width,height:900}}),p=await c.newPage();p.setDefaultTimeout(12000);const errors=[];p.on('pageerror',e=>errors.push(e.message));let image,jobs=new Map(),starts=0,drop=true;
  await c.route(origin+'/api/**',async r=>{const req=r.request(),u=new URL(req.url()),a=u.pathname.slice('/api/store-orders-guest'.length);let data;
   if(a==='/session')data={email:'guest:synthetic',role:'store',guest:true,storeCode:'R14',version:VERSION,recognitionReady:true,stores:{R14:{name:'R14'}}};
   else if(a==='/catalog')data={version:'synthetic',records:[['SAMPLE01','測試床包'],['SAMPLE02','測試被套'],['GIFT01','測試噴霧']].map(([sku,name])=>({sku,name,color:'白',colorCode:'01',size:'測試',sizeCode:'01'}))};
   else if(a==='/queue')data={orders:[],batches:[]};
   else if(a==='/scan')data={files:[1,2].map(n=>({id:'synthetic-photo-00'+n,createdTime:'2026-11-03T09:42:00Z',mimeType:'image/png',sourceVersion:0}))};
   else if(a==='/sources')data={fileId:req.postDataJSON().fileId,duplicate:false};
   else if(a.startsWith('/file/'))return r.fulfill({contentType:'image/png',body:image});
   else if(a==='/recognize'){const b=req.postDataJSON();starts++;jobs.set(b.fileId,{id:b.operationId,status:'completed',createdAt:new Date().toISOString(),fileId:b.fileId,pageIndex:b.pageIndex});data={job:{...jobs.get(b.fileId),status:'processing'}};}
   else if(a==='/recognitions'){const j=jobs.get(u.searchParams.get('fileId'));if(j&&drop){drop=false;return r.abort('failed');}data={job:j||null,...(j?{result:{extraction:raw,recognition:{jobId:j.id,requestedModel:'gpt-6.1-sol'}}}:{})};}
   else if(a==='/source-actions')data={records:[]};
   else throw Error('Unexpected API '+a);return r.fulfill({json:data});
  });
  await p.goto(origin+'/store-orders/guest/');await p.getByRole('button',{name:'開啟為新訂單',exact:true}).first().waitFor();
  image=Buffer.from(await p.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1400;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1000,1400);ctx.fillStyle='#000';ctx.font='30px sans-serif';ctx.fillText('SYNTHETIC ORDER',100,100);return canvas.toDataURL('image/png').split(',')[1];}),'base64');
  await p.getByRole('button',{name:'開啟為新訂單',exact:true}).first().click();await p.locator('#cloud-ai-consent').check();await p.locator('#cloud-ai').click();await p.locator('#cloud-ai-status').filter({hasText:'辨識連線中斷'}).waitFor();assert.equal(starts,1);assert.equal(await p.locator('[data-review-field="items.0.sku"]').count(),0);
  p.once('dialog',d=>d.dismiss());await p.locator('#cloud-ai-recover').click();await p.locator('#cloud-ai-status').filter({hasText:'已取消'}).waitFor();assert.equal(starts,1);assert.equal(await p.locator('[data-review-field="items.0.sku"]').count(),0);
  p.once('dialog',d=>d.accept());await p.locator('#cloud-ai-recover').click();await p.locator('[data-review-field="items.0.sku"]').waitFor();assert.equal(await p.locator('[data-review-field="paperNumber"]').inputValue(),raw.header.paperNumber);assert.equal(starts,1);
  await p.locator('[data-review-field="clerk"]').fill('人工修改保留');p.once('dialog',d=>d.dismiss());await p.locator('#cloud-ai-recover').click();await p.locator('#cloud-ai-status').filter({hasText:'已取消'}).waitFor();assert.equal(await p.locator('[data-review-field="clerk"]').inputValue(),'人工修改保留');
  // Refresh loses the unsaved form, but reopening the same source can retrieve its job.
  p.once('dialog',d=>d.accept());await p.reload();await p.getByRole('button',{name:'開啟為新訂單',exact:true}).first().click();p.once('dialog',d=>d.accept());await p.locator('#cloud-ai-recover').click();await p.locator('[data-review-field="items.0.sku"]').waitFor();assert.equal(starts,1);
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.locator('#cloud-ai-zone').scrollIntoViewIfNeeded();fs.mkdirSync('/private/tmp/store-orders-recovery',{recursive:true});await p.screenshot({path:`/private/tmp/store-orders-recovery/${width}.png`});assert.deepEqual(errors,[]);await c.close();
 }
 console.log(JSON.stringify({passed:true,widths:[390,320,1280],checks:['disconnect keeps blank draft','same job recovery without paid submission','cancel preserves edits','refresh/reopen recovers result','no horizontal overflow'],productionWrites:0,paidAI:0}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

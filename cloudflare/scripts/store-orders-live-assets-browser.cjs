// Public production assets only; every business API is mocked. No live writes or paid AI.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),origin=process.env.STORE_ORDERS_ORIGIN||'https://siangstock.com';
const {chromium}=require(path.join(require('node:os').homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
(async()=>{
 const C=await import(root+'/store-orders/core.js'),R=await import(root+'/store-orders/recognition.js'),S=await import(root+'/store-orders/synthetic-form.js');
 const x={console,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder};x.globalThis=x;vm.createContext(x);vm.runInContext(fs.readFileSync(root+'/inventory/assets/xlsx.full.min.js','utf8'),x);const X=x.XLSX;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const scenario of ['unchanged','edited','split','split-edited']){
 const edited=scenario.includes('edited'),split=scenario.startsWith('split'),rowCount=split?8:6,perOrder=rowCount/2;
 const ctx=await browser.newContext({viewport:{width:1500,height:1000},timezoneId:'Asia/Taipei',acceptDownloads:true}),p=await ctx.newPage();p.setDefaultTimeout(20000);let exports=0;const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const date=C.taipeiDate(),raw=S.syntheticFullOrder();raw.priceBasis='line_total';raw.header.storeCode='R14';raw.rows[2].sku='GIFT01';raw.rows.forEach(r=>r.unitPrice*=r.quantity);
 if(split){raw.rows[0].unitPrice=401;raw.rows[1].unitPrice=299;}
 const catalog=['SAMPLE01','SAMPLE02','GIFT01'].map((sku,i)=>({sku,name:['合成床包','合成被套','合成贈品'][i],color:'白',size:'均碼'}));const master={version:'synthetic-only',bySku:new Map(catalog.map(r=>[r.sku,[r]]))};
 const orders=[1,2].map(n=>{const o=R.extractionOrder(raw,master);Object.assign(o,{id:'synthetic-order-000'+n,paperNumber:'SYNTHETIC-000'+n,businessDate:date,status:'settled',version:2,batchId:'synthetic-batch-0001',reviewed:true,reviewedAt:new Date().toISOString(),pageCount:1,sources:[{fileId:'synthetic-source-000'+n,pages:1,verified:true}]});o.headerRecognition.confirmed=true;o.items.forEach(i=>{if(Number(i.unitPrice)===0)i.zeroConfirmed=true;});assert.deepEqual(C.validateOrder(o,{complete:true}).errors,[]);return o;});
 if(edited){orders[1].items[0].unitPrice+=50;orders[1].paperTotal=750;orders[1].payments['中信信用卡']=550;}
 const total=edited?1450:1400;
 await ctx.route(origin+'/api/**',async r=>{const req=r.request(),u=new URL(req.url()),a=u.pathname.slice('/api/store-orders-guest'.length);const b=req.method()==='POST'?req.postDataJSON():null;let data;
 if(a==='/session')data={email:'synthetic-hq@siangapato.com.tw',role:'hq',guest:false,version:C.VERSION,recognitionReady:true,productionExportEnabled:true,stores:{R14:{name:'R14'}}};
 else if(a==='/catalog')data={version:'synthetic-only',records:catalog};
 else if(a==='/guest-invites')data={invites:[]};
 else if(a==='/queue')data={orders:orders.map(o=>({id:o.id,store_code:o.storeCode,business_date:o.businessDate,status:o.status,version:o.version,batch_id:o.batchId})),batches:[{id:'synthetic-batch-0001',business_date:date,status:'settled'}]};
 else if(a==='/scan')data={files:[]};
 else if(a.startsWith('/orders/')){const o=orders.find(o=>o.id===a.slice(8));assert(o);data={order:o};}
 else if(a==='/batches/synthetic-batch-0001')data={batch:{id:'synthetic-batch-0001',storeCode:'R14',businessDate:date},orders,summary:C.settlementSummary(orders.map(o=>({...o,status:'reviewed'}))),excludedCount:0,downloaded:orders.every(o=>o.status==='exported')};
 else if(a==='/batches/synthetic-batch-0001/export'){assert.deepEqual(b.orders,orders.map(o=>({id:o.id,version:o.version})));if(exports)assert.equal(b.redownloadConfirmed,true);else orders.forEach(o=>{o.status='exported';o.version++;});exports++;data={saved:true,versions:orders.map(o=>({id:o.id,version:o.version}))};}
 else throw Error('Unexpected business API (blocked): '+u.pathname);
 return r.fulfill({json:data});});
 try{
 await p.goto(origin+'/store-orders/guest/?deploy='+C.VERSION);await p.locator('#cloud-pos-summary').filter({hasText:`2筆訂單／原單6列／POS ${rowCount}列／8件`}).waitFor();
 assert.equal(await p.locator('#pos-template-file').count(),0);assert.equal(await p.locator('#cloud-result-save').count(),0);assert.equal(await p.locator('#cloud-order').isVisible(),false);assert(await p.locator('#cloud-export').isEnabled());
 for(const width of [900,1200,1500]){await p.setViewportSize({width,height:1000});await p.locator('#cloud-pos').scrollIntoViewIfNeeded();assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const guide=await p.locator('#cloud-next-step').boundingBox();assert(guide.y>=10&&guide.y<=14);}
 await p.screenshot({path:'/private/tmp/store-orders-r46-live-'+scenario+'.png'});
 let pending=p.waitForEvent('download');await p.locator('#cloud-export').click();let download=await pending;const out='/private/tmp/store-orders-r46-live-'+scenario+'.xlsx';await download.saveAs(out);await p.locator('#cloud-pos-status').filter({hasText:'整批POS已下載'}).waitFor();assert.equal(exports,1);assert(await p.locator('#cloud-export').isDisabled());
 const w=X.read(new Uint8Array(fs.readFileSync(out)),C.READ_OPTIONS),rows=JSON.parse(JSON.stringify(X.utils.sheet_to_json(w.Sheets.Sheet1,{header:1,raw:true,defval:''}).slice(2)));assert.equal(rows.length,rowCount);assert.equal(rows.reduce((n,r)=>n+r[16],0),8);assert.equal(rows.reduce((n,r)=>n+r[16]*r[17],0),total);assert.deepEqual(rows.map(r=>r[10]),split?[500,'','','',edited?550:500,'','','']:[500,'','',edited?550:500,'','']);assert.deepEqual(rows.map(r=>r[11]),split?[200,'','','',200,'','','']:[200,'','',200,'','']);assert((w.Sheets.Sheet1['!merges']||[]).filter(m=>m.s.r>1).every(m=>m.e.r<2+perOrder||m.s.r>=2+perOrder));
 await p.locator('#cloud-pos-redownload').check();pending=p.waitForEvent('download');await p.locator('#cloud-export').click();download=await pending;await download.saveAs(out+'.again.xlsx');await p.locator('#cloud-pos-status').filter({hasText:'整批POS已下載'}).waitFor();assert.equal(exports,2);assert(fs.readFileSync(out).equals(fs.readFileSync(out+'.again.xlsx')));assert(orders.every(o=>o.version===3));
 await p.setViewportSize({width:390,height:844});await p.locator('#cloud-pos').scrollIntoViewIfNeeded();assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:'/private/tmp/store-orders-r46-live-mobile-'+scenario+'.png'});assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,actualPublicAssets:true,version:C.VERSION,scenario,orders:2,paperRows:6,posRows:rowCount,quantity:8,amount:total,payments:[edited?1050:1000,400],noSingleOrderOpening:true,noTemplateUpload:true,noERPResults:true,redownloadIdentical:true,realAPIWrites:0,paidAI:0}));
 }finally{await ctx.close();}
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

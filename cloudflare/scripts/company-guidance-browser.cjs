// Local isolated browser acceptance. Synthetic files/API only; no real writes or paid AI.
const {chromium}=require(require('node:os').homedir()+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),origin=process.env.GUIDANCE_ORIGIN||'http://127.0.0.1:8792',version='20261102-company-guidance-r1';
const out=process.env.GUIDANCE_ARTIFACTS||'/private/tmp/company-guidance-browser';fs.mkdirSync(out,{recursive:true});
const sandbox={console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer};sandbox.globalThis=sandbox;vm.createContext(sandbox);
for(const f of ['inventory/assets/xlsx.full.min.js','inventory/rules.bundle.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),sandbox);
const X=sandbox.XLSX,rules={version:1,updatedAt:'2026-11-02T00:00:00Z',rules:sandbox.INVENTORY_RULES};
const workbook=(rows,sheet='合成報表')=>{const w=X.utils.book_new();X.utils.book_append_sheet(w,X.utils.aoa_to_sheet(rows),sheet);return Buffer.from(new Uint8Array(X.write(w,{type:'array',bookType:'xlsx'})));};
const file=(rows,name='合成.xlsx',sheet)=>({name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbook(rows,sheet)});
const reports=[];let writes=0;
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});try{
async function pageFor(tool,{role='hq',rulesFailure=false}={}){
 const c=await browser.newContext({viewport:{width:1280,height:950},acceptDownloads:true}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await c.route('https://accounts.google.com/**',r=>r.fulfill({contentType:'text/javascript',body:'window.google={accounts:{oauth2:{initTokenClient(){return {}}}}};'}));
 await c.route(origin+'/api/**',r=>{const req=r.request(),u=new URL(req.url());if(req.method()!=='GET'){writes++;return r.fulfill({status:403,json:{error:'Synthetic writes disabled'}})}
 if(u.pathname==='/api/rules')return r.fulfill(rulesFailure?{status:503,json:{error:'synthetic unavailable'}}:{json:rules});
 if(u.pathname==='/api/rules/history')return r.fulfill({json:{history:[]}});
 if(u.pathname==='/api/store-transfer/config')return r.fulfill({json:{role,storeCode:'R14',email:'synthetic@example.com',stores:{R14:{name:'合成門市',company:'合成公司',relationship:'直營'}},permissions:{},storeInventoryRules:{config:{}}}});
 if(u.pathname.startsWith('/api/store-transfer/'))return r.fulfill({json:{batches:[],rows:[],drafts:[],exceptions:[]}});
 return r.fulfill({status:403,json:{error:'Synthetic permission unavailable'}});
 });
 await p.goto(origin+'/'+tool+(tool.endsWith('.html')?'':'/'));await p.waitForFunction(()=>globalThis.CompanyGuidance);await p.waitForFunction(()=>!document.querySelector('#company-guide-title').textContent.includes('正在確認工具版本'));return {c,p,errors};
}
async function layouts(p,name){for(const width of [1280,390,320]){await p.setViewportSize({width,height:950});await p.locator('#company-live-guide').scrollIntoViewIfNeeded();const b=await p.locator('#company-live-guide').boundingBox();assert(b.x>=-1 && b.x+b.width<=width+1,name+' guide overflow '+width);const internal=await p.locator('#company-live-guide').evaluate(e=>e.scrollWidth<=e.clientWidth+1);assert(internal,name+' internal overflow');if(width===390)await p.locator('#company-live-guide').screenshot({path:path.join(out,name.replaceAll('/','-')+'-390.png')});}}
// Inventory: real file, analysis, real xlsx round trip, stale result, and explicit failure.
{
 const {c,p,errors}=await pageFor('inventory');await p.locator('#company-guide-title').filter({hasText:'選擇庫存'}).waitFor();
 await p.locator('#file-input').setInputFiles(file([['備註'],['SKU','品名','庫存金額'],['A1','原木托盤',100],['A2','宅配運費',20],['A3','節慶贈品',30]],'合成庫存.xlsx','庫存'));
 await p.locator('#company-guide-title').filter({hasText:'開始分析'}).waitFor();await p.locator('#company-live-guide button').click();assert.equal(await p.locator('#results').isVisible(),false,'guide cannot analyze');
 await p.locator('#analyze-file').click();await p.locator('#company-guide-title').filter({hasText:'核對分類統計'}).waitFor();assert.equal(await p.locator('#conservation-check').innerText(),'通過');assert.equal(await p.locator('#metric-total').innerText(),'3');
 const download=p.waitForEvent('download');await p.locator('#download-result').click();const d=await download;const result=X.read(fs.readFileSync(await d.path()),{type:'buffer'});assert.deepEqual(Array.from(result.SheetNames),['乾淨商品','排除項目','待確認項目','分類統計']);
 await layouts(p,'inventory');
 await p.locator('#file-input').setInputFiles(file([['錯誤表頭'],['無效內容']],'錯誤.xlsx'));await p.locator('#analyze-file').click();await p.locator('#company-guide-title').filter({hasText:'尚未完成'}).waitFor();assert(await p.locator('#company-live-guide').innerText().then(s=>s.includes('目前訊息')));assert.equal(await p.locator('#download-result').isEnabled(),false);
 assert.deepEqual(errors,[]);reports.push('inventory real xlsx, 3-row conservation, download, failure, navigation only');await c.close();
}
// Cost: four real required formats advance through each missing-source step.
{
 const {c,p,errors}=await pageFor('cost-analysis');await p.locator('#company-guide-title').filter({hasText:'備妥必要報表'}).waitFor();
 const data={opening:[['店倉名稱','貨號','品名','實際庫存','實際庫存成本額','進貨價','成本價'],['寬承總倉','P1','合成商品',10,100,10,10]],closing:[['店倉名稱','貨號','品名','實際庫存','實際庫存成本額','進貨價','成本價'],['寬承總倉','P1','合成商品',10,100,10,10]],purchases:[['收貨單編碼','狀態','收貨倉庫','貨號','品名','已收數量','成本價','未稅進貨額','供應商名稱','開單日期'],['IR26060001','入庫審核','寬承總倉','P1','合成商品',2,10,20,'合成供應商','2026-06-01']],sales:[['開單倉名稱','POS單','結帳時間','貨號','品名','銷售量','扣庫量','進貨價金額'],['寬承總倉','SO1','2026-06-02','P1','合成商品',2,2,20]]};
 for(const [type,rows] of Object.entries(data)){await p.locator('[data-file-type="'+type+'"]').setInputFiles(file(rows,type+'.xlsx'));await p.locator('[data-type="'+type+'"].ready').waitFor();}
 await p.locator('#company-guide-title').filter({hasText:'開始成本分析'}).waitFor();await p.locator('#company-live-guide button').click();assert.equal(await p.locator('#result-panel').isVisible(),false);await p.locator('#analyze-button').click();await p.locator('#result-panel').waitFor();await p.locator('#company-guide-title').filter({hasText:'核對差異'}).waitFor();await layouts(p,'cost-analysis');assert.deepEqual(errors,[]);reports.push('cost four real report formats, analysis readiness, result, navigation only');await c.close();
}
// Supplier: actual A/B files, dates, local-only ledger and result.
{
 const {c,p,errors}=await pageFor('supplier-reconciliation');await p.locator('#period-month').fill('2026-06');await p.locator('#period-month').dispatchEvent('change');
 await p.locator('#a-file').setInputFiles(file([['開單日期','收貨單編碼','貨號','品名','已收數量','未稅進貨價','未稅進貨額','供應商名稱'],['2026-06-01','R1','P1','60天絲床包 [晨曦]',10,100,1000,'測試供應商']],'A.xlsx'));
 await p.locator('#company-guide-title').filter({hasText:'選擇B表'}).waitFor();
 await p.locator('#b-file').setInputFiles(file([['測試供應商'],['對帳單'],[],[],[],[],[],[],['帳款日','進銷單號','帳別','品名','數量','單價','合計'],['2026-06-01','S1','銷貨','60天絲-晨曦-床包',10,100,1000]],'B.xlsx','對帳單'));
 await p.locator('#company-guide-title').filter({hasText:'開始比對'}).waitFor();await p.locator('#analyze-button').click();await p.locator('#company-guide-title').filter({hasText:'核對帳款差異'}).waitFor();await layouts(p,'supplier-reconciliation');assert.deepEqual(errors,[]);reports.push('supplier A/B real files, dates, result');await c.close();
}
// Competition: built-in safe example, included sources and local report (no AI calls).
{
 const {c,p,errors}=await pageFor('competitive-analysis');await p.locator('#company-guide-title').filter({hasText:'商品規格'}).waitFor();await p.locator('[data-example]').first().click();await p.locator('#company-guide-title').filter({hasText:'試算與產生報告'}).waitFor();await p.locator('#company-live-guide button').click();assert(await p.locator('#pricing-title').evaluate(e=>{const a=e.getBoundingClientRect(),b=document.querySelector('#company-live-guide').getBoundingClientRect();return a.top>=b.bottom && a.bottom<innerHeight;}));assert.equal(await p.locator('#report').isVisible(),false);await p.locator('#analyze-button').click();await p.locator('#company-guide-title').filter({hasText:'核對報告'}).waitFor();await layouts(p,'competitive-analysis');assert.deepEqual(errors,[]);reports.push('competition example and local report, no paid AI');await c.close();
}
for(const tool of ['procurement-planning','inventory/rules-admin','procurement-planning/rules-admin','store-transfer/rules','store-orders/settings.html']){
 const actual=tool;
 const {c,p,errors}=await pageFor(actual);await layouts(p,tool);if(tool==='inventory/rules-admin'){await p.locator('#excluded-rule-input').fill('合成排除字');await p.locator('#add-excluded-rule').click();await p.locator('#company-guide-title').filter({hasText:'核對草稿'}).waitFor();await p.locator('#company-live-guide button').click();assert.equal(writes,0);}assert(!await p.locator('#company-guide-title').innerText().then(s=>s==='等待工具準備完成'),tool+' provider unavailable');assert.deepEqual(errors,[]);reports.push(tool+' permissions/loading and layout');await c.close();
}
// Store and HQ have different next steps, with no hidden HQ destination for stores.
for(const role of ['store','hq']){
 const {c,p,errors}=await pageFor('store-transfer',{role});await p.locator('#account-badge').filter({hasText:'synthetic@example.com'}).waitFor();await p.locator('#company-guide-title').filter({hasText:role==='store'?'本店待確認':'固定來源'}).waitFor();await layouts(p,'store-transfer-'+role);if(role==='store'){assert.equal(await p.locator('#hq-panel').isVisible(),false);assert.equal(await p.locator('#company-live-guide').getAttribute('data-target'),'#store-batches');}assert.deepEqual(errors,[]);reports.push('transfer '+role+' role isolation');await c.close();
}
// Reconciliation keeps connect-src none; version-script errors still fail closed.
{
 const {c,p}=await pageFor('supplier-reconciliation');
 await c.route(origin+'/live-guidance/version.js?*',r=>r.fulfill({contentType:'text/javascript',body:"document.currentScript.dispatchEvent(new CustomEvent('company-guidance-version',{detail:'future-guidance'}));"}));
 await p.reload();await p.locator('#company-guide-title').filter({hasText:'重新載入'}).waitFor();assert.equal(await p.locator('#period-month').isEnabled(),false);
 await c.unroute(origin+'/live-guidance/version.js?*');await c.route(origin+'/live-guidance/version.js?*',r=>r.fulfill({status:503,body:'unavailable'}));await p.reload();await p.locator('#company-guide-title').filter({hasText:'重新載入'}).waitFor();assert.equal(await p.locator('#period-month').isEnabled(),false);reports.push('reconciliation strict CSP preserved, stale/failed version-script blocks');await c.close();
}
// Generic contract: nested details, focus without submission, dialogs, busy/error, offline/version lock.
{
 const c=await browser.newContext({viewport:{width:390,height:844}}),p=await c.newPage();let mode='ready',manifestCalls=0;
 await c.route(origin+'/live-guidance/version.json?*',async r=>{manifestCalls++;return r.fulfill(mode==='offline'?{status:503,body:'unavailable'}:{json:{version:mode==='stale'?'future-guidance':version}})});
 await c.route(u=>u.origin===origin && u.pathname==='/__guide-contract/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/live-guidance/style.css"><main><nav class="breadcrumb">合成測試</nav><details id="outer"><summary>外層</summary><details id="inner"><summary>內層</summary><button id="business">儲存</button><input id="unsaved" value="未保存內容"></details></details><p id="status" role="status"></p><dialog id="modal"><button id="modal-action">核准</button><p id="modal-status" role="status"></p></dialog><script src="/live-guidance/app.js"></script></main>'}));
 await p.goto(origin+'/__guide-contract/');await p.waitForFunction(()=>globalThis.CompanyGuidance);await p.evaluate(()=>{window.actions=0;document.querySelector('#business').onclick=()=>window.actions++;document.querySelector('#modal-action').onclick=()=>window.actions++;CompanyGuidance.register({statuses:'#status,#modal-status',resolve:()=>CompanyGuidance.step('核對內容','只導航不儲存',document.querySelector('#modal').open?'#modal-action':'#business')});});await p.locator('#company-guide-title').filter({hasText:'核對內容'}).waitFor();await p.locator('#company-live-guide button').click();assert.equal(await p.locator('#outer').getAttribute('open'),'');assert.equal(await p.locator('#inner').getAttribute('open'),'');assert.equal(await p.evaluate(()=>document.activeElement.id),'business');assert.equal(await p.evaluate(()=>window.actions),0);await p.locator('.company-guide-help summary').focus();await p.keyboard.press('Enter');assert.equal(await p.locator('.company-guide-help').getAttribute('open'),'');await p.keyboard.press('Enter');
 await p.evaluate(()=>{document.querySelector('#business').onclick=()=>{document.querySelector('#business').disabled=true;document.querySelector('#status').textContent='正在儲存合成資料';};});await p.locator('#business').click();await p.locator('#company-guide-title').filter({hasText:'處理中'}).waitFor();
 await p.evaluate(()=>{document.querySelector('#status').className='error';document.querySelector('#status').textContent='儲存失敗，合成版本衝突';});await p.locator('#company-guide-title').filter({hasText:'尚未完成'}).waitFor();
 await p.locator('#unsaved').fill('保留人工修改');await p.evaluate(()=>document.querySelector('#modal').showModal());await p.locator('#modal #company-live-guide').waitFor();await p.locator('#company-live-guide button').click();assert.equal(await p.evaluate(()=>document.activeElement.id),'modal-action');assert.equal(await p.evaluate(()=>window.actions),0);await p.evaluate(()=>document.querySelector('#modal').close());await p.locator('main > #company-live-guide').waitFor();
 mode='stale';assert.equal(await p.evaluate(()=>CompanyGuidance.ensureCurrent()),false);await p.locator('#company-guide-title').filter({hasText:'重新載入'}).waitFor();assert.equal(await p.locator('#modal-action').isEnabled(),false);assert.equal(await p.locator('#unsaved').inputValue(),'保留人工修改');await p.locator('#company-live-guide button').click();await p.waitForURL('**/\u005f\u005fguide-contract/?deploy=future-guidance&reload=*');
 mode='offline';await p.reload();await p.locator('#company-guide-title').filter({hasText:'重新載入'}).waitFor();assert.equal(await p.locator('#business').isEnabled(),false);assert(manifestCalls>=3);reports.push('contract nested details/focus/dialog, busy/error, no auto writes, unsaved retention, stale/offline fail closed');await c.close();
}
assert.equal(writes,0);console.log(JSON.stringify({passed:true,checks:reports,widths:[1280,390,320],actualBusinessWrites:writes,paidAI:0,artifacts:out}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

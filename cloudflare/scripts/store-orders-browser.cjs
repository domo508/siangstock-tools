// Local synthetic browser acceptance; never uses company customer files or live OAuth.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const path = require("node:path");
const bundled=process.env.CODEX_WORKSPACE_NODE_MODULES || path.join(require("node:os").homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(process.env.CODEX_BROWSER_MODULE || path.join(bundled,"playwright"));
const origin = process.env.STORE_ORDERS_TEST_ORIGIN || "http://127.0.0.1:8768";
const root = path.resolve(__dirname,"../..");
const out = process.env.STORE_ORDERS_TEST_OUTPUT || "/private/tmp/store-orders-browser";
fs.mkdirSync(out,{recursive:true});
const blocks=fs.readFileSync(path.join(root,"_headers"),"utf8").split(/\n\s*\n/).map(block=>{const lines=block.split("\n"),pattern=lines.shift();return {pattern,headers:Object.fromEntries(lines.filter(l=>/^\s+[^:]+:/.test(l)).map(l=>{const i=l.indexOf(":");return [l.slice(0,i).trim().toLowerCase(),l.slice(i+1).trim()];}))};});
function headersFor(url){let headers={};const name=new URL(url).pathname;for(const b of blocks){if(!b.pattern?.startsWith("/"))continue;const re=new RegExp("^"+b.pattern.replace(/[.+?^${}()|[\]\\]/g,"\\$&").replaceAll("*",".*")+"$");if(re.test(name))headers={...headers,...b.headers};}return headers;}
async function main(){
 const browser=await chromium.launch({headless:true,channel:"chrome"});
 const context=await browser.newContext({viewport:{width:1365,height:960},acceptDownloads:true});
 await context.route(`${origin}/**`,async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),...headersFor(route.request().url())}});});
 // No live account/network dependency in a local workflow test.
 await context.route("https://accounts.google.com/**",route=>route.fulfill({contentType:"text/javascript",body:""}));
 const page=await context.newPage(),errors=[],remote=[];
 page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith("blob:")&&!r.url().startsWith("data:")&&!r.url().startsWith("https://accounts.google.com/"))remote.push(r.url());});
 page.on("dialog",d=>d.accept());
 try{
  await context.route(`${origin}/store-orders/`,r=>r.fulfill({contentType:"text/html",body:fs.readFileSync(path.join(root,"cloudflare/test/fixtures/store-orders/legacy-index.html"),"utf8")}));
  await page.goto(`${origin}/store-orders/`);await page.getByRole("button",{name:"本機測試（不會交接）"}).click();await page.getByText("已載入合成範例",{exact:false}).waitFor();
  const masterBytes=await page.evaluate(()=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([["貨號","品名","顏色","尺碼"],["TEST01","Harmony天絲雙人床包組","白","5尺"],["TEST09","Harmony天絲床包組","藍","6尺"]]),"主檔");return [...new Uint8Array(XLSX.write(w,{type:"array",bookType:"xlsx"}))];});
  await page.locator("#master-file").setInputFiles({name:"synthetic-master.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from(masterBytes)});await page.getByText("主檔 2 個貨號",{exact:false}).waitFor();
  let item=page.locator("#items .item").first();await item.locator('[data-key="sku"]').fill("TEST-UNKNOWN");await item.locator('[data-key="sku"]').press("Tab");item=page.locator("#items .item").first();await item.locator('[data-key="sku"]').fill("TEST01");await item.locator('[data-key="sku"]').press("Tab");item=page.locator("#items .item").first();
  await item.locator('[data-key="paperName"]').fill("床包");assert.equal(await item.locator('[data-key="name"]').inputValue(),"Harmony天絲雙人床包組");
  await item.locator('[data-key="paperName"]').fill("枕頭");assert.equal(await item.locator('[data-role="name-confirm"]').isVisible(),true);await item.locator('[data-key="nameHintAcknowledged"]').check();
  await item.locator('[data-key="paperName"]').fill("天絲床包");await item.getByRole("button",{name:"依簡寫品名／規格找候選"}).click();await item.locator('[data-role="candidates"] button').first().waitFor();assert.equal(await item.locator('[data-role="candidates"] button').count(),2);await item.locator('[data-role="candidates"] button').filter({hasText:"TEST01"}).click();item=page.locator("#items .item").first();assert.equal(await item.locator('[data-key="quantity"]').inputValue(),"2");assert.equal(await item.locator('[data-key="unitPrice"]').inputValue(),"100");
  await page.screenshot({path:path.join(out,"desktop.png"),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"desktop overflow");
  await page.getByRole("button",{name:"本機辨識目前原圖",exact:true}).click();await page.getByText("本機辨識完成",{exact:false}).waitFor({timeout:120000});
  const ocr=await page.locator("#ocr-text").inputValue();assert.match(ocr,/TEST[O0][12]/,"local OCR runs; ambiguous O/0 remains for human review");
  const {PDFDocument}=require(path.join(bundled,"pdf-lib"));const pdf=await PDFDocument.create();pdf.addPage([300,200]).drawText("SYNTHETIC PAGE ONE");pdf.addPage([300,200]).drawText("SYNTHETIC PAGE TWO");const pdfBytes=await pdf.save();
  const rendered=await page.evaluate(async base64=>{const {pagesFor}=await import("/store-orders/media.js?v=20261031-store-orders-r28");return (await pagesFor(new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:"application/pdf"}))).length;},Buffer.from(pdfBytes).toString("base64"));assert.equal(rendered,2,"local multi-page PDF");
  const synthetic=await page.evaluate(()=>{const c=document.createElement("canvas");c.width=300;c.height=180;const x=c.getContext("2d");x.fillStyle="white";x.fillRect(0,0,300,180);x.fillStyle="black";x.font="24px sans-serif";x.fillText("SYNTHETIC",20,80);return c.toDataURL("image/png").split(",")[1];});
  fs.writeFileSync(path.join(out,"synthetic.png"),Buffer.from(synthetic,"base64"));require("node:child_process").execFileSync("/usr/bin/sips",["-s","format","heic",path.join(out,"synthetic.png"),"--out",path.join(out,"synthetic.heic")],{stdio:"pipe"});
  const heicResult=await page.evaluate(async base64=>{const {pagesFor}=await import("/store-orders/media.js?v=20261031-store-orders-r28");const pages=await pagesFor(new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:"image/heic"}));return {pages:pages.length,type:pages[0].type};},fs.readFileSync(path.join(out,"synthetic.heic")).toString("base64"));assert.deepEqual(heicResult,{pages:1,type:"image/jpeg"},"local CSP-compatible HEIC conversion");
  await page.locator("#reviewed").check();await page.locator("#order-status").selectOption("reviewed");await page.getByRole("button",{name:"保存訂單",exact:true}).click();await page.getByText("已保存在本機測試清單",{exact:false}).waitFor();
  await page.locator("#settlement-confirmed").check();await page.getByRole("button",{name:"整日結算",exact:true}).click();await page.getByText("本機模擬結算 1單／3件／250元",{exact:false}).waitFor();
  await page.getByRole("button",{name:"查看／續作",exact:true}).click();await page.locator("#order-title").filter({hasText:"已結算"}).waitFor();
  await page.locator("#pos-format").selectOption("legacy");
  const downloaded=page.waitForEvent("download");await page.getByRole("button",{name:"下載目前訂單 POS 測試檔",exact:true}).click();const download=await downloaded;await download.saveAs(path.join(out,"synthetic-POS.xls"));
  assert.match(download.suggestedFilename(),/測試勿正式匯入/);
  await page.locator("#erp-reason").fill("合成測試結果不明");await page.getByRole("button",{name:"登記目前訂單匯入結果",exact:true}).click();await page.getByText("匯入結果已登記",{exact:false}).waitFor();assert.equal(await page.locator("#export-test").isDisabled(),true);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"mobile overflow");await page.screenshot({path:path.join(out,"mobile.png"),fullPage:true});
  // A newer deployment blocks all critical operations without replacing the user's page.
  await context.route(`${origin}/store-orders/version.json*`,route=>route.fulfill({json:{version:"new-deployment"}}));await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await page.locator("#version-warning").waitFor({state:"visible"});assert.equal(await page.locator("#settle").isDisabled(),true);
  await context.unroute(`${origin}/store-orders/version.json*`);
  await context.route(`${origin}/store-orders/`,r=>r.fulfill({contentType:"text/html",body:fs.readFileSync(path.join(root,"cloudflare/test/fixtures/store-orders/legacy-index.html"),"utf8")}));
  await page.goto(`${origin}/store-orders/`);await page.getByRole("button",{name:"本機測試（不會交接）"}).click();await page.getByText("已載入合成範例",{exact:false}).waitFor();
  await page.locator("#store").selectOption("__other__");await page.locator("#store-other").waitFor({state:"visible"});await page.locator("#new-order").click();await page.getByText("請填入門市代號",{exact:false}).waitFor();
  await page.locator("#store-other").fill("test-99");await page.locator("#store-other").press("Tab");await page.locator("#new-order").click();await page.waitForFunction(()=>document.getElementById("workspace").hidden===false);
  assert.equal(await page.locator("#capture").getAttribute("multiple"),"");assert.equal(await page.locator("#capture").getAttribute("capture"),null);
  const image={name:"synthetic-a.png",mimeType:"image/png",buffer:Buffer.from(synthetic,"base64")};
  await page.locator("#capture").setInputFiles([image,{name:"broken.png",mimeType:"image/png",buffer:Buffer.from("not an image")},{...image,name:"synthetic-b.png"}]);
  await page.getByText("匯入完成：成功 2 個、失敗 1 個",{exact:false}).waitFor();assert.equal(await page.locator("#import-results li").count(),3);assert.equal(await page.locator("#page-count").inputValue(),"2");assert.equal(await page.locator("#capture").inputValue(),"");
  await page.locator("#capture").setInputFiles([image]);await page.getByText("匯入完成：成功 1 個、失敗 0 個",{exact:false}).waitFor();assert.equal(await page.locator("#page-count").inputValue(),"3");
  await page.locator("#paper-number").fill("CUSTOM-STORE-TEST");assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem("store-orders:local-demo")).order.storeCode),"TEST-99");
  await page.locator("#store").selectOption("R00");await page.getByText("請先保存目前修改再切換",{exact:false}).waitFor();assert.equal(await page.locator("#store").inputValue(),"__other__");assert.equal(await page.locator("#store-other").inputValue(),"TEST-99");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"custom store mobile overflow");await page.screenshot({path:path.join(out,"custom-store-mobile.png"),fullPage:true});
  await page.goto(`${origin}/store-orders/paper.html`);assert.equal(await page.locator("#serial").count(),0);assert.equal(await page.locator("#next").count(),0);assert.equal(await page.locator("tbody tr").count(),14);await page.emulateMedia({media:"print"});await page.pdf({path:path.join(out,"synthetic-paper.pdf"),format:"A4",preferCSSPageSize:true});
  assert.deepEqual(errors,[],"no uncaught page errors");assert.deepEqual(remote,[],"no remote OCR, PDF, image or other data requests");
  console.log(JSON.stringify({passed:true,ocr:ocr.trim(),screenshots:out,checks:["desktop","mobile","local OCR","local 2-page PDF","local HEIC conversion","review-settle-export","BIFF8 download","unknown-result lock","old-tab version lock","paper manual number","print PDF","no external data request"]},null,2));
 }catch(error){console.error(JSON.stringify({activity:await page.locator("#activity").textContent().catch(()=>""),errors,remote,url:page.url()},null,2));await page.screenshot({path:path.join(out,"failure.png"),fullPage:true});throw error;}finally{await context.close();await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

// Read-only history: no filter, control, properties, status or business-data writes.
const MS_HISTORY_VERSION='20261119-marketing-history-r1';
function marketingHistoryCatalog_(ss){
 const offers={};['活動案型','贈品／加價購案型','排除紀錄'].forEach(name=>{
  const s=ss.getSheetByName(name),h=MS_TABLES[name];if(!s||s.getLastRow()<2)return;
  s.getRange(2,1,s.getLastRow()-1,h.length).getDisplayValues().forEach(r=>{
   const run=r[h.indexOf('同步版本')],m=String(r[h.indexOf('案型識別碼')]).match(/^M(20\d{2}|2100)(\d{2})-/);if(!run||!m)return;
   const o=offers[run]||(offers[run]={periods:new Set(),activities:0,gifts:0,excluded:0,reviewed:0});o.periods.add(m[1]+'-'+m[2]);o[name==='活動案型'?'activities':name==='贈品／加價購案型'?'gifts':'excluded']++;if(name!=='排除紀錄'&&r[10]==='已覆核')o.reviewed++;
  });
 });
 const log=ss.getSheetByName('同步紀錄'),out=[],seen=new Set();if(!log||log.getLastRow()<2)return [];
 log.getRange(2,1,log.getLastRow()-1,MS_TABLES['同步紀錄'].length).getDisplayValues().forEach(r=>{
  const o=offers[r[2]];if(r[8]!=='草稿完成；未發布'||!o||o.periods.size!==1)return;
  if(seen.has(r[2]))throw new Error('同步紀錄版本重複，請交由管理者核對；未改動資料。');seen.add(r[2]);
  out.push({run:r[2],period:[...o.periods][0],time:r[0],parser:r[1],sourceHash:r[3],activities:o.activities,gifts:o.gifts,excluded:o.excluded,reviewed:o.reviewed});
 });return out.reverse();
}
function loadMarketingHistoryCatalog(version){
 if(version!==MS_HISTORY_VERSION)throw new Error('歷史查詢已有新版，請關閉後重新開啟。');
 const ss=assertMarketingBook_();return {version:MS_HISTORY_VERSION,current:ss.getSheetByName(MS_CONTROL).getRange('B7').getDisplayValue(),entries:marketingHistoryCatalog_(ss)};
}
function marketingHistoryRequest_(request){
 if(!request||request.version!==MS_HISTORY_VERSION)throw new Error('歷史查詢已有新版，請重新開啟。');
 const ss=assertMarketingBook_(),entry=marketingHistoryCatalog_(ss).find(x=>x.run===request.run);
 if(!entry)throw new Error('找不到已成功保存的歷史版本。');
 if(!Number.isInteger(request.offset)||request.offset<0)throw new Error('頁碼不正確。');return {ss,entry};
}
function loadMarketingHistory(request){
 const {ss,entry}=marketingHistoryRequest_(request);
 if(!['all','活動案型','贈品／加價購案型'].includes(request.type))throw new Error('請選擇有效案型。');
 const offers=marketingCurrentOffers_(ss,entry.run).filter(o=>request.type==='all'||o.sheet.getName()===request.type),page=offers.slice(request.offset,request.offset+20);
 const d=ss.getSheetByName('活動商品明細'),all=d&&d.getLastRow()>1?d.getRange(2,1,d.getLastRow()-1,12).getValues():[];
 return {version:MS_HISTORY_VERSION,entry,offset:request.offset,total:offers.length,hasMore:request.offset+20<offers.length,readOnly:true,offers:page.map(o=>{
  const id=marketingReviewId_(o),details=all.filter(r=>r[7]===id&&r[8]===entry.run);
  let warning='';try{const snap=marketingSnapshot_(entry.run,id);if(!snap)warning='歷史商品快照未保存，僅呈現目前保存的明細。';else if(snap.count!==details.length)warning='歷史商品明細與保存快照筆數不同，僅呈現現存內容，請交由管理者核對。';}catch(e){warning='歷史商品快照無法完整讀取，僅呈現現存明細；'+e.message;}
  return {id,sheet:o.sheet.getName(),name:o.values[1],conditions:o.values[2],period:marketingPeriodLabel_(o.values),scope:o.values[5]+'／'+o.values[6],exclusions:o.values[8],notes:o.values[9],status:marketingCancelMap_(ss,entry.run)[id]?'已取消（原覆核／商品快照保留）':o.values[10],warning:warning+(marketingCancelMap_(ss,entry.run)[id]?' 取消原因：'+marketingCancelMap_(ss,entry.run)[id].reason:''),count:details.filter(d=>d[1]).length,selected:details.filter(d=>d[0]===true&&d[1]).length};
 })};
}
function loadMarketingHistoryProducts(request){
 const {ss,entry}=marketingHistoryRequest_(request),matches=marketingCurrentOffers_(ss,entry.run).filter(o=>marketingReviewId_(o)===request.id);
 if(matches.length!==1)throw new Error('歷史活動對應不唯一。');
 const rows=marketingOfferDetails_(ss,request.id,entry.run).filter(r=>r[1]);
 return {version:MS_HISTORY_VERSION,run:entry.run,id:request.id,offset:request.offset,total:rows.length,hasMore:request.offset+100<rows.length,readOnly:true,rows:rows.slice(request.offset,request.offset+100).map(r=>({selected:r[0]===true,sku:r[1],name:r[2],basis:r[3],role:r[4],status:r[5]}))};
}
function showMarketingHistory(){
 const t=HtmlService.createTemplate(MS_HISTORY_HTML);t.seedJson=JSON.stringify(loadMarketingHistoryCatalog(MS_HISTORY_VERSION)).replace(/</g,'\\u003c');
 SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(960).setHeight(680),'行銷活動歷史查詢（唯讀）');
}
function upgradeMarketingSelectHistory(){
 const ss=assertMarketingBook_(),c=ss.getSheetByName(MS_CONTROL),lock=LockService.getDocumentLock();if(!lock.tryLock(1000))throw new Error('有作業處理中，尚未升級。');
 try{
  if(c.getRange('B1').getDisplayValue()!==MS_VERSION||!['20261105-marketing-batch-r10',MS_REVIEW_VERSION].includes(c.getRange('B15').getDisplayValue()))throw new Error('來源或介面版本不同，停止升級。');
  // UI-only marker change. Never run the old status/date migration here.
  const run=c.getRange('B7:B8').getValues();c.getRange('B15').setValue(MS_REVIEW_VERSION);SpreadsheetApp.flush();
  if(JSON.stringify(c.getRange('B7:B8').getValues())!==JSON.stringify(run)||c.getRange('B15').getDisplayValue()!==MS_REVIEW_VERSION)throw new Error('介面版本回讀不一致。');
  const result={reviewVersion:MS_REVIEW_VERSION,historyVersion:MS_HISTORY_VERSION,businessRowsUnchanged:true};console.log(JSON.stringify(result));return result;
 }finally{lock.releaseLock();}
}


const MS_HISTORY_HTML="<!doctype html><html lang=\"zh-Hant\"><head><base target=\"_top\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>\n*{box-sizing:border-box}body{margin:0;background:#fbf8f1;color:#17324d;font:15px/1.6 -apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang TC\",sans-serif}main{padding:18px;overflow-wrap:anywhere}h1{font-size:22px;margin:0 0 10px}h2{font-size:18px;margin:0}.guide,.card{padding:16px;border:1px solid #d8e4e8;border-radius:14px;background:white;margin:12px 0}.guide{background:#edf6f8}.fields{display:grid;grid-template-columns:150px minmax(0,1fr) 160px;gap:12px}.fields label{min-width:0}select,button{font:inherit;max-width:100%;padding:10px;border:1px solid #b5ccd5;border-radius:9px}select{width:100%;display:block;background:white;color:inherit}button{background:#176b87;color:white;cursor:pointer}button.secondary{background:white;color:#153f63}button:disabled{opacity:.5;cursor:default}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}.muted,small{color:#64778a}#status{white-space:pre-wrap}details{margin:8px 0}summary{cursor:pointer}li{margin:8px 0}.products{max-height:300px;overflow:auto}.error{color:#993c29}button:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #176b87;outline-offset:2px}@media(max-width:620px){.fields{grid-template-columns:1fr}main{padding:10px}.actions button{flex:1}}\n</style></head><body><main><h1>行銷活動歷史查詢</h1><div class=\"guide\"><strong>唯讀查看歷史，日常工作月份保持不變</strong><p>選擇月份與同步版本後按「查詢」。舊活動、商品勾選與覆核狀態依保存內容顯示；不重新同步、不變更勾選、不覆核或發布。</p><p>要繼續處理某月份，請關閉後使用「接續既有月份（保留覆核）」。</p></div><div class=\"fields\"><label>月份<select id=\"period\"></select></label><label>同步版本<select id=\"run\"></select></label><label>案型<select id=\"type\"><option value=\"all\">全部案型</option><option>活動案型</option><option>贈品／加價購案型</option></select></label></div><div class=\"actions\"><button id=\"query\">查詢</button><button id=\"close\" class=\"secondary\">關閉</button></div><p id=\"status\" role=\"status\" aria-live=\"polite\">選擇後查詢，尚未讀取活動明細。</p><p id=\"summary\"></p><section id=\"offers\"></section><div class=\"actions\"><button id=\"prev\" class=\"secondary\" disabled>上一頁活動</button><button id=\"next\" class=\"secondary\" disabled>下一頁活動</button></div><script type=\"application/json\" id=\"seed\"><?!= seedJson ?></script><script>\nconst seed=JSON.parse(document.getElementById('seed').textContent),$=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n};let busy=false,data=null;\nfunction options(){const period=$('period').value;$('run').replaceChildren();seed.entries.filter(e=>e.period===period).forEach(e=>{const o=el('option',e.time+'｜'+e.run+(e.run===seed.current?'（目前工作版本）':''));o.value=e.run;$('run').append(o)});$('query').disabled=!$('run').value;}\n[...new Set(seed.entries.map(e=>e.period))].sort().reverse().forEach(p=>{const o=el('option',p);o.value=p;$('period').append(o)});options();\nfunction lock(v){busy=v;['period','run','type','query','prev','next'].forEach(id=>$(id).disabled=v);if(!v){$('query').disabled=!$('run').value;$('prev').disabled=!data||!data.offset;$('next').disabled=!data?.hasMore;}}\nfunction fail(e){lock(false);$('status').className='error';$('status').textContent='查詢未完成：'+(e.message||String(e))+'。原資料與目前工作月份未變更。';}\nfunction productPage(parent,id,offset){if(busy)return;busy=true;parent.replaceChildren(el('p','正在讀取保存的商品明細…'));google.script.run.withSuccessHandler(r=>{busy=false;parent.replaceChildren();const ul=el('ul');ul.className='products';r.rows.forEach(p=>ul.append(el('li',(p.selected?'已選':'未選')+'｜'+p.sku+'｜'+p.name+'｜'+p.status)));parent.append(el('p','商品'+r.total+'筆；本頁第'+(r.total?offset+1:0)+'～'+(offset+r.rows.length)+'筆'),ul);const actions=el('div');actions.className='actions';for(const [label,next,disabled] of [['上一頁商品',Math.max(0,offset-100),!offset],['下一頁商品',offset+100,!r.hasMore]]){const b=el('button',label);b.className='secondary';b.disabled=disabled;b.onclick=()=>productPage(parent,id,next);actions.append(b)}parent.append(actions)}).withFailureHandler(e=>{busy=false;parent.replaceChildren(el('p','商品明細未取得：'+(e.message||e)));}).loadMarketingHistoryProducts({version:seed.version,run:data.entry.run,id,offset});}\nfunction render(r){data=r;lock(false);$('offers').replaceChildren();$('status').className='';$('status').textContent='查詢完成（唯讀）：'+r.entry.period+'；共'+r.total+'個活動，本頁'+r.offers.length+'個。';$('summary').textContent='保存時間：'+r.entry.time+'；版本：'+r.entry.run+'；來源解析：'+r.entry.parser+'。歷史狀態不代表目前仍適用。';r.offers.forEach(o=>{const c=el('article');c.className='card';c.append(el('h2',o.name+'｜'+o.id),el('p',o.sheet+'｜'+o.status+'｜候選'+o.count+'筆／已選'+o.selected+'筆'),el('p','期間：'+o.period),el('p','適用：'+o.scope));if(o.warning){const warning=el('p',o.warning);warning.className='error';c.append(warning)}const terms=el('details');terms.append(el('summary','查看優惠內容與限制'),el('p',o.conditions),el('p','排除：'+o.exclusions),el('p','備註：'+o.notes));c.append(terms);if(o.count){const d=el('details'),p=el('div');let opened=false;d.append(el('summary','查看歷史商品明細（唯讀）'),p);d.ontoggle=()=>{if(d.open&&!opened){if(busy){p.textContent='另一項查詢處理中，請收合後再開啟。';return;}opened=true;productPage(p,o.id,0)}};c.append(d)}$('offers').append(c)})}\nfunction load(offset=0){if(busy||!$('run').value)return;lock(true);$('status').className='';$('status').textContent='正在讀取歷史版本；不更動目前工作月份…';google.script.run.withSuccessHandler(render).withFailureHandler(fail).loadMarketingHistory({version:seed.version,run:$('run').value,type:$('type').value,offset})}\n$('period').onchange=()=>{data=null;options();$('offers').replaceChildren();$('prev').disabled=true;$('next').disabled=true};$('run').onchange=$('type').onchange=()=>{data=null;$('prev').disabled=true;$('next').disabled=true};$('query').onclick=()=>load();$('prev').onclick=()=>load(Math.max(0,data.offset-20));$('next').onclick=()=>load(data.offset+20);$('close').onclick=()=>google.script.host.close();\n</script></main></body></html>\n";

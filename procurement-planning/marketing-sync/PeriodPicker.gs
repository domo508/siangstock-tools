// Period picker is UI-only: parser/review policy versions remain unchanged.
const MS_PERIOD_PICKER_VERSION='20261118-marketing-period-picker-r1';
function marketingSyncPeriodToken_(c){return JSON.stringify(['B1','B2','B3','B4','B7','B8'].map(a=>c.getRange(a).getDisplayValue()));}
function marketingSyncPeriodChoices_(ss,c){
  const configured=String(c.getRange('B2').getValue()),year=Number(c.getRange('B3').getValue()),byYear={};
  ss.getSheets().forEach(s=>{
    const name=s.getName();let y=name===configured?year:0;
    if(!y&&/整體行銷策略.*官網.*平台/.test(name)){const m=name.match(/^「?(\d{2,4})["”年]/);if(m)y=m[1].length===2?2000+Number(m[1]):Number(m[1]);}
    if(!Number.isInteger(y)||y<2026||y>2100||/舊版|案型|控制台/.test(name)||!name.includes(String(y).slice(-2)))return;
    (byYear[y]||(byYear[y]=[])).push(s);
  });
  return Object.keys(byYear).map(Number).sort().filter(y=>byYear[y].length===1).map(y=>{
    const s=byYear[y][0],rows=s.getRange(1,1,Math.min(5,Math.max(1,s.getLastRow())),Math.min(60,Math.max(1,s.getLastColumn()))).getDisplayValues(),counts={};
    rows.forEach(r=>r.forEach(v=>{const m=String(v).trim().match(/^(\d{1,2})月$/);if(m){const n=Number(m[1]);counts[n]=(counts[n]||0)+1;}}));
    return {year:y,source:s.getName(),months:Array.from({length:12},(_,i)=>i+1).filter(m=>counts[m]===1)};
  });
}
function marketingLastSuccessfulPeriod_(ss,c){
  const run=c.getRange('B7').getDisplayValue(),found={};if(!run)return null;
  ['活動案型','贈品／加價購案型','排除紀錄'].forEach(n=>{
    const s=ss.getSheetByName(n),h=MS_TABLES[n];if(!s||s.getLastRow()<2)return;
    const version=h.indexOf('同步版本'),id=h.indexOf('案型識別碼');
    s.getRange(2,Math.min(version,id)+1,s.getLastRow()-1,Math.abs(version-id)+1).getDisplayValues().forEach(r=>{
      const offset=Math.min(version,id);if(r[version-offset]!==run)return;const m=String(r[id-offset]).match(/^M(\d{4})(\d{2})-/);if(m)found[m[1]+'-'+m[2]]={year:Number(m[1]),month:Number(m[2])};
    });
  });const values=Object.values(found);return values.length===1?values[0]:null;
}
function loadMarketingSyncPeriod(){
  const ss=assertMarketingBook_(),c=ss.getSheetByName(MS_CONTROL);if(!c||c.getRange('B1').getDisplayValue()!==MS_VERSION)throw new Error('版本不同或尚未配置，請先聯絡管理者。');
  const last=marketingLastSuccessfulPeriod_(ss,c),selected=last||{year:Number(c.getRange('B3').getValue()),month:Number(c.getRange('B4').getValue())};
  return {version:MS_PERIOD_PICKER_VERSION,expected:marketingSyncPeriodToken_(c),years:marketingSyncPeriodChoices_(ss,c),year:selected.year,month:selected.month,defaultLabel:last?'上次成功同步月份':'目前控制台設定（尚無可辨識的成功月份）'};
}
function prepareMarketingSyncPeriod_(ss,c,request){
  if(!request||request.version!==MS_PERIOD_PICKER_VERSION)throw new Error('同步視窗已有新版，請關閉後從行銷同步選單重新開啟。');
  if(request.expected!==marketingSyncPeriodToken_(c))throw new Error('同步設定或目前版本已變更。此次未開始同步，請關閉視窗後重新開啟確認。');
  if(!Number.isInteger(request.year)||request.year<2026||request.year>2100||!Number.isInteger(request.month)||request.month<1||request.month>12)throw new Error('請選擇有效的年度與月份。');
  const choice=marketingSyncPeriodChoices_(ss,c).find(y=>y.year===request.year);if(!choice||!choice.months.includes(request.month))throw new Error('該年度來源或月份欄位不存在／不唯一，請先確認原企劃。');
  const values={B2:choice.source,B3:request.year,B4:request.month};
  // Validate a real source month before changing the control cells.
  readMarketingSource_(ss,{getRange:a=>({getValue:()=>values[a]})});
  c.getRange('B2:B4').setValues([[choice.source],[request.year],[request.month]]);SpreadsheetApp.flush();
}
function submitMarketingSyncPeriod(request){
  if(!request||typeof request!=='object')throw new Error('請從最新版年月選擇視窗開始同步。');
  const result=syncMarketingFromPanel(request);
  return {version:MS_PERIOD_PICKER_VERSION,year:request.year,month:request.month,message:request.year+'年'+request.month+'月同步完成：'+result.message};
}
function showMarketingSyncPeriod_(){
  const t=HtmlService.createTemplate(MS_PERIOD_PICKER_HTML);t.seedJson=JSON.stringify(loadMarketingSyncPeriod()).replace(/</g,String.fromCharCode(92)+'u003c');
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(520).setHeight(480),'選擇行銷同步年月');
}

const MS_PERIOD_PICKER_HTML="<!doctype html><html lang=\"zh-Hant\"><head><base target=\"_top\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>\n*{box-sizing:border-box}body{margin:0;padding:20px;font:15px/1.65 -apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang TC\",sans-serif;color:#17324d;background:#fbf8f1}h2{font-size:21px;margin:0 0 12px}.hint{background:#edf6f8;border:1px solid #d8e4e8;border-radius:12px;padding:12px;margin:0 0 16px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{font-weight:600}select{display:block;width:100%;margin:5px 0 0;padding:10px;border:1px solid #b9cfd7;border-radius:9px;background:white;font:inherit;color:inherit}.actions{display:flex;gap:12px;margin:18px 0 12px;flex-wrap:wrap}button{font:inherit;padding:10px 18px;border-radius:9px;border:1px solid #b9cfd7;background:white;color:#17324d;cursor:pointer}#go{background:#176b87;color:white;border-color:#176b87}button:disabled,select:disabled{opacity:.6;cursor:default}#status{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}small{display:block;color:#64778a;overflow-wrap:anywhere}button:focus-visible,select:focus-visible{outline:3px solid #8bc1d3;outline-offset:2px}@media(max-width:360px){body{padding:14px}.fields{grid-template-columns:1fr;gap:10px}}\n</style></head><body><h2>選擇要同步的活動月份</h2><p class=\"hint\" id=\"default\">讀取同步設定中…</p><div class=\"fields\"><label for=\"year\">年度<select id=\"year\"></select></label><label for=\"month\">月份<select id=\"month\"></select></label></div><div class=\"actions\"><button id=\"go\" type=\"button\">開始同步</button><button id=\"close\" type=\"button\">關閉</button></div><p id=\"status\" role=\"status\" aria-live=\"polite\">選好年月後按「開始同步」。尚未執行同步。</p><small>同步只建立或更新草稿，不核准或發布至採購／週調撥。執行中請勿重複點擊；關閉視窗不會取消已開始的作業。結果也會保留在「同步控制台」執行狀態。</small><script type=\"application/json\" id=\"seed\"><?!= seedJson ?></script><script>\nconst seed=JSON.parse(document.getElementById('seed').textContent),year=document.getElementById('year'),month=document.getElementById('month'),go=document.getElementById('go'),status=document.getElementById('status');let busy=false,completed=false;\nyear.innerHTML='<option value=\"\">請選擇年度</option>'+seed.years.map(y=>'<option value=\"'+y.year+'\">'+y.year+'年</option>').join('');year.value=String(seed.year);\ndocument.getElementById('default').textContent=seed.defaultLabel+'：'+seed.year+'年'+seed.month+'月。可改選其他月份；按開始後才會更新同步設定。';\nfunction updateMonths(preferred){const choice=seed.years.find(y=>y.year===Number(year.value));month.innerHTML='<option value=\"\">請選擇月份</option>'+(choice?choice.months:[]).map(m=>'<option value=\"'+m+'\">'+m+'月</option>').join('');month.value=choice&&choice.months.includes(Number(preferred))?String(preferred):'';go.disabled=busy||completed||!year.value||!month.value;}\nyear.addEventListener('change',()=>updateMonths(''));month.addEventListener('change',()=>{go.disabled=busy||completed||!year.value||!month.value;});document.getElementById('close').addEventListener('click',()=>google.script.host.close());\ngo.addEventListener('click',()=>{if(busy||completed||!year.value||!month.value)return;busy=true;go.disabled=true;year.disabled=true;month.disabled=true;const y=Number(year.value),m=Number(month.value);status.textContent='正在同步'+y+'年'+m+'月，讀取原企劃及商品主檔中，請稍候…';google.script.run.withSuccessHandler(result=>{busy=false;completed=true;go.textContent='同步完成';status.textContent=result.message;}).withFailureHandler(error=>{busy=false;year.disabled=false;month.disabled=false;go.disabled=false;status.textContent='同步未完成：'+error.message+'\\n已保留選擇；如提示設定或版本已變更，請關閉後重新開啟。';}).submitMarketingSyncPeriod({version:seed.version,expected:seed.expected,year:y,month:m});});\nupdateMonths(seed.month);\n</script></body></html>\n";

function syncMarketingCurrentPeriod(){try{const r=syncMarketingFromPanel();SpreadsheetApp.flush();marketingSyncNotice_(r.message);return r;}catch(e){marketingSyncNotice_('同步未完成：'+e.message);throw e;}}
function syncMarketingPeriodNative(){
  const seed=loadMarketingSyncPeriod(),ui=SpreadsheetApp.getUi();
  const response=ui.prompt('輸入要同步的年月',seed.defaultLabel+'：'+seed.year+'年'+seed.month+'月。\n直接按「確定」沿用此月份並開始同步；要換月份請輸入 YYYY-MM，例如 2026-12。按「取消」不更動資料。',ui.ButtonSet.OK_CANCEL);
  if(response.getSelectedButton()!==ui.Button.OK)return {cancelled:true};
  const input=String(response.getResponseText()).trim()||(seed.year+'-'+String(seed.month).padStart(2,'0'));
  const match=input.match(/^(20\d{2}|2100)[-\/](0?[1-9]|1[0-2])$/);
  if(!match){marketingSyncNotice_('尚未開始同步：請重新開啟，輸入有效年月，例如 2026-12。');return {cancelled:true};}
  try{const result=submitMarketingSyncPeriod({version:seed.version,expected:seed.expected,year:Number(match[1]),month:Number(match[2])});marketingSyncNotice_(result.message);return result;}
  catch(e){marketingSyncNotice_('同步未完成：'+e.message);throw e;}
}

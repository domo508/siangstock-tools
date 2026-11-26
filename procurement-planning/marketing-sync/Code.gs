/** @OnlyCurrentDoc */
// Bound to the separate native marketing test workbook. No network or publishing APIs.
const MS_VERSION = '20261027-marketing-sync-test-r1';
const MS_CONTROL = '同步控制台';
const MS_TABLES = {
  '活動主檔': ['同步版本','活動識別碼','來源位置','活動類別','活動名稱／原文摘要','開始時間（人工覆核）','結束時間（人工覆核）','通路／門市（人工覆核）','覆核狀態','來源原文'],
  '活動條件': ['同步版本','條件識別碼','活動識別碼','來源位置','條件類型','條件原文','商品範圍（人工覆核）','排除條件（人工覆核）','搭配限制（人工覆核）','覆核狀態'],
  '贈品／加價購': ['同步版本','規則識別碼','活動識別碼','來源位置','類型','ERP品號（原文擷取）','條件原文','每次數量（人工覆核）','門檻／適用商品（人工覆核）','累贈／並贈（人工覆核）','覆核狀態'],
  '覆核待辦': ['同步版本','待辦識別碼','活動識別碼','來源位置','待確認事項','處理狀態','覆核說明'],
  '同步紀錄': ['時間（台北）','程式版本','同步版本','來源指紋','來源儲存格數','活動筆數','條件筆數','贈品／加價購筆數','待辦筆數','結果']
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('行銷同步（測試）')
    .addItem('開啟立即同步面板', 'openMarketingSync')
    .addItem('立即同步', 'syncMarketingNow')
    .addItem('驗證覆核資料（不發布）', 'validateMarketingReview')
    .addToUi();
}

function setupMarketingSync() {
  const ss = SpreadsheetApp.getActive();
  if (ss.getId() !== '1eOXzJB_r01FLsibHhGxUnu7cXPzg7_DotB6caN81sMM') throw new Error('此測試程式只允許在指定測試副本執行。');
  let control = ss.getSheetByName(MS_CONTROL);
  if (!control) {
    control = ss.insertSheet(MS_CONTROL, 0);
    const source = ss.getSheets().filter(s => /26.*整體行銷策略/.test(s.getName()));
    if (source.length !== 1) throw new Error('無法唯一確認2026企劃工作表，請先核對。');
    const rows = [
      ['行銷立即同步｜測試控制台', MS_VERSION],
      ['來源工作表', source[0].getName()],
      ['活動年度', 2026], ['月份', 11],
      ['操作方式', '上方「行銷同步（測試）」→「開啟立即同步面板」；在面板按立即同步。'],
      ['執行狀態', '尚未同步'], ['目前同步版本', ''], ['來源指紋', ''],
      ['安全範圍', '僅寫入本測試表的結構化草稿；不改原企劃，不連外、不發布、不寄信。'],
      ['覆核步驟', '活動主檔補時間／通路；條件與贈品補完整；覆核待辦填結論，再執行驗證。'],
      ['版本保留', '企劃變更建立新同步版本；同內容重按不重複。上一版與人工覆核保留。'],
      ['注意', '為保留完整語意，每個原文段落先建立草稿；不確定的商品集合、贈品關係必須人工覆核。'],
      ['正式工具', '採購／週調撥仍讀原Excel；本測試結果不會自動生效。']
    ];
    control.getRange(1,1,rows.length,2).setValues(rows).setWrap(true).setVerticalAlignment('top');
    control.setColumnWidth(1,210); control.setColumnWidth(2,680); control.setFrozenRows(1);
    control.getRange('A1:B1').setBackground('#153f63').setFontColor('#ffffff').setFontWeight('bold');
    control.getRange('B3').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(2026,2100).setAllowInvalid(false).build());
    control.getRange('B4').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1,12).setAllowInvalid(false).build());
    control.getRange('A9:B13').setBackground('#f1f8f4');
  }
  Object.keys(MS_TABLES).forEach(name => ensureMarketingTable_(ss, name));
  onOpen(); ss.setActiveSheet(control);
  ss.toast('設定完成。請開啟上方「行銷同步（測試）」的立即同步面板。', '測試版', 8);
}

function ensureMarketingTable_(ss, name) {
  let sheet = ss.getSheetByName(name);
  const headers = MS_TABLES[name];
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1,1,1,headers.length).setValues([headers]).setBackground('#153f63').setFontColor('#ffffff').setFontWeight('bold').setWrap(true);
    sheet.setFrozenRows(1); sheet.setTabColor('#176b87');
    sheet.setColumnWidths(1, headers.length, 180);
    headers.forEach((h,i) => { if (/原文|摘要|說明|事項/.test(h)) sheet.setColumnWidth(i+1,380); });
  } else {
    const actual = sheet.getRange(1,1,1,headers.length).getDisplayValues()[0];
    if (JSON.stringify(actual) !== JSON.stringify(headers)) throw new Error(name+'欄位與程式版本不一致，停止寫入。');
  }
  return sheet;
}

function openMarketingSync() {
  const html = '<!doctype html><html lang="zh-Hant"><head><base target="_top"><style>body{font:15px/1.7 system-ui,sans-serif;color:#17324d;padding:18px;background:#fbf8f1}h2{font-size:19px}button{font:inherit;padding:12px 18px;border:0;border-radius:9px;background:#153f63;color:white;width:100%}button:disabled{opacity:.5}p{overflow-wrap:anywhere}small{color:#536c7f}</style></head><body><h2>行銷立即同步</h2><p>讀取控制台選定月份，整理結構化草稿。</p><button id="go" onclick="run()">立即同步</button><p id="result" role="status">準備就緒</p><small>測試版：不改原企劃，不發布採購／週調撥。相同內容不重複新增；新版保留舊版。同步期間請勿編輯原企劃。</small><script>function run(){const b=document.getElementById("go"),r=document.getElementById("result");b.disabled=true;r.textContent="同步中，請稍候…";google.script.run.withSuccessHandler(function(x){r.textContent=x.message;b.disabled=false;}).withFailureHandler(function(e){r.textContent="同步未完成："+e.message;b.disabled=false;}).syncMarketingFromPanel();}</script></body></html>';
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutput(html).setTitle('行銷立即同步（測試）'));
}

function syncMarketingNow() {
  try { const r=syncMarketingFromPanel(); SpreadsheetApp.getUi().alert(r.message); }
  catch(e) { SpreadsheetApp.getUi().alert('同步未完成：'+e.message); throw e; }
}

function readMarketingSource_(ss, control) {
  const name=String(control.getRange('B2').getValue());
  const year=Number(control.getRange('B3').getValue()), month=Number(control.getRange('B4').getValue());
  if (!Number.isInteger(year)||year<2026||year>2100||!Number.isInteger(month)||month<1||month>12) throw new Error('年度或月份不正確。');
  const sheet=ss.getSheetByName(name);
  if (!sheet||MS_TABLES[name]||name===MS_CONTROL) throw new Error('來源工作表不存在或選到了輸出頁籤。');
  if (!sheet.getName().includes(String(year).slice(-2))) throw new Error('來源工作表名稱與活動年度不符，請確認年度。');
  if (sheet.getLastColumn()>60||sheet.getLastRow()>3000) throw new Error('來源格式超出已驗證範圍，停止同步。');
  const data=sheet.getDataRange().getDisplayValues();
  const matches=[];
  data.slice(0,5).forEach((row,r)=>row.forEach((v,c)=>{if(String(v).trim()===month+'月')matches.push({r,c});}));
  if(matches.length!==1) throw new Error('月份欄位不是唯一，請檢查前5列月份標頭。');
  const pos=matches[0], cells=[];
  for(let r=pos.r+1;r<data.length;r++) {
    const raw=String(data[r][pos.c]||'').trim(); if(!raw)continue;
    const category=String(data[r][0]||'未標分類').trim();
    cells.push({sheet:name,ref:columnLabel_(pos.c+1)+(r+1),category,raw});
  }
  if(!cells.length)throw new Error('選定月份沒有活動內容；不以空資料取代上一版。');
  return {year,month,cells};
}

function columnLabel_(n) { let out='';while(n){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);}return out; }
function marketingHash_(value) {return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(value)).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function safeMarketingText_(x) {return typeof x==='string'&&/^[=+\-@]/.test(x)?"'"+x:x;}

function parseMarketingDraft_(source, run) {
  const out={'活動主檔':[],'活動條件':[],'贈品／加價購':[],'覆核待辦':[]};
  let seq=0, cs=0, gs=0, qs=0;
  function issue(id,location,message){out['覆核待辦'].push([run,run+'-Q'+(++qs),id,location,message,'待確認','']);}
  source.cells.forEach(cell=>{
    const segments=cell.raw.split(/\n\s*[-─－]{5,}\s*\n/).map(s=>s.trim()).filter(Boolean);
    segments.forEach(segment=>{
      const id='M'+source.year+String(source.month).padStart(2,'0')+'-'+String(++seq).padStart(3,'0');
      const location=cell.sheet+'!'+cell.ref;
      const lines=segment.split(/\n/).map(s=>s.trim()).filter(Boolean);
      const title=lines.find(s=>!/^\s*(門市|官網)[：:]/.test(s))||cell.category;
      const channel=/蝦皮|平台/.test(cell.category)?'平台（待覆核，不預設門市）':/門市/.test(segment)&&/官網/.test(segment)?'門市＋官網（期間分別覆核）':/門市/.test(segment)?'門市（範圍待覆核）':'待確認';
      out['活動主檔'].push([run,id,location,cell.category,title.slice(0,120),'','',channel,'待覆核',segment]);
      issue(id,location,'確認活動起訖、各通路期間及門市範圍；不得只按月份補整月或永久有效。');
      issue(id,location,'確認原文段落是否包含多個活動／不同期間；必要時拆成獨立活動並保留原文。');
      lines.forEach((line,i)=>{
        const type=/抽獎|抽Acer|抽.*行李箱/.test(line)?'抽獎資格':/加價購|加購價/.test(line)||/加價購/.test(cell.category)?'加價購':/贈|送/.test(line)?'贈品條件':/門市|官網/.test(line)&&/\d\s*\//.test(line)?'通路期間':/折|優惠價|現折/.test(line)?'優惠條件':'原文待分類';
        out['活動條件'].push([run,run+'-C'+(++cs),id,location+'／段內第'+(i+1)+'行',type,line,'','','','待覆核']);
        const skuMarker=/((?:贈品|加價購|加購)(?:貨號|品號)|(?:ERP)?(?:貨號|品號))[：:]\s*/g;
        let marker;
        while((marker=skuMarker.exec(line))!==null){
          const tail=line.slice(marker.index+marker[0].length);
          const skuMatch=tail.match(/^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)?(?:\s*[、,，]\s*[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)?)*)/i);
          if(!skuMatch){issue(id,location,'品號標記後無法解析ERP品號：'+line);continue;}
          const skus=skuMatch[1].toUpperCase().split(/\s*[、,，]\s*/);
          skus.forEach(sku=>{
            // Do not invent quantities, scopes or thresholds from a neighbouring gift.
            out['贈品／加價購'].push([run,run+'-G'+(++gs),id,location,type==='抽獎資格'?'抽獎資格':/加價購|加購/.test(marker[1])||/加價購/.test(cell.category)?'加價購':'贈品',sku,line,'','','','待覆核']);
          });
          skuMarker.lastIndex=marker.index+marker[0].length+skuMatch[1].length;
        }
        if(type==='贈品條件'&&!/(?:貨號|品號)/.test(line))issue(id,location,'贈品條件缺同列品號或與前後行共用條件，須人工對應：'+line);
        if(type==='抽獎資格')issue(id,location,'抽獎資格不等於每筆訂單配發實體贈品，不直接估算調撥：'+line);
      });
      if(/贈|加價購|送/.test(segment))issue(id,location,'確認每次數量、門檻計算基礎、級距互斥、累贈／並贈與贈完為止；不得把第一個門檻套給所有品號。');
    });
  });
  return out;
}

function syncMarketingFromPanel() {
  const lock=LockService.getDocumentLock();
  if(!lock.tryLock(1000))throw new Error('另一位同仁正在同步，請稍後重試。');
  const ss=SpreadsheetApp.getActive(), control=ss.getSheetByName(MS_CONTROL);
  if(!control){lock.releaseLock();throw new Error('請先執行初次設定。');}
  const appended=[];
  try {
    if(ss.getId()!=='1eOXzJB_r01FLsibHhGxUnu7cXPzg7_DotB6caN81sMM')throw new Error('非指定測試副本。');
    Object.keys(MS_TABLES).forEach(n=>ensureMarketingTable_(ss,n));
    const source=readMarketingSource_(ss,control), hash=marketingHash_(source);
    if(String(control.getRange('B8').getValue())===hash){
      const message='來源內容未變更，不重複新增；既有人工覆核保留。尚未發布至正式工具。';
      control.getRange('B6').setValue(message);return {message};
    }
    control.getRange('B6').setValue('同步中；完成前仍以上一同步版本為準。');
    const run=Utilities.formatDate(new Date(),'Asia/Taipei','yyyyMMdd-HHmmss')+'-'+Utilities.getUuid().slice(0,8);
    const draft=parseMarketingDraft_(source,run);
    if(!draft['活動主檔'].length)throw new Error('沒有可辨識的草稿。');
    if(marketingHash_(readMarketingSource_(ss,control))!==hash)throw new Error('來源在同步中已改動，請重試。');
    Object.keys(draft).forEach(name=>{
      const rows=draft[name];if(!rows.length)return;
      const sheet=ss.getSheetByName(name),start=sheet.getLastRow()+1;
      if(start+rows.length-1>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),start+rows.length-1-sheet.getMaxRows());
      const range=sheet.getRange(start,1,rows.length,MS_TABLES[name].length);
      appended.push({sheet,start,count:rows.length});
      range.setNumberFormat('@').setValues(rows.map(r=>r.map(safeMarketingText_))).setWrap(true).setVerticalAlignment('top');
      const statusCol=name==='活動主檔'?9:name==='活動條件'?10:name==='贈品／加價購'?11:6;
      const choices=name==='覆核待辦'?['待確認','已確認','不適用']:['待覆核','已覆核','不適用'];
      sheet.getRange(start,statusCol,rows.length,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(choices,true).setAllowInvalid(false).build());
      const rule=SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(choices[0]).setBackground('#fff3d4').setRanges([sheet.getRange(start,statusCol,rows.length,1)]).build();
      sheet.setConditionalFormatRules(sheet.getConditionalFormatRules().concat([rule]));
      if(sheet.getFilter())sheet.getFilter().remove();
      sheet.getRange(1,1,sheet.getLastRow(),MS_TABLES[name].length).createFilter();
    });
    SpreadsheetApp.flush();
    Object.keys(draft).forEach(name=>{
      const own=appended.find(x=>x.sheet.getName()===name);
      if(own&&own.sheet.getRange(own.start,1,own.count,1).getDisplayValues().some(r=>r[0]!==run))throw new Error('寫入核對失敗：'+name);
    });
    if(marketingHash_(readMarketingSource_(ss,control))!==hash)throw new Error('來源在寫入期間已變更，新版尚未啟用；請重試。');
    const counts=Object.keys(draft).map(n=>draft[n].length);
    ss.getSheetByName('同步紀錄').appendRow([Utilities.formatDate(new Date(),'Asia/Taipei','yyyy-MM-dd HH:mm:ss'),MS_VERSION,run,hash,source.cells.length].concat(counts,['草稿完成；未發布']));
    // Commit marker comes last. Incomplete generations are never promoted.
    control.getRange('B7:B8').setValues([[run],[hash]]);
    const message='同步完成：'+source.cells.length+'個來源儲存格，'+counts[0]+'段活動、'+counts[1]+'條條件、'+counts[2]+'筆品號規則、'+counts[3]+'項待確認。全部為待覆核草稿，未發布。';
    control.getRange('B6').setValue(message);return {message,run,counts};
  } catch(e) {
    control.getRange('B6').setValue('同步失敗，未啟用新版本：'+e.message+'。請以B7最後成功版本為準。');
    throw e;
  } finally {lock.releaseLock();}
}

function validateMarketingReview() {
  const ss=SpreadsheetApp.getActive(),control=ss.getSheetByName(MS_CONTROL);
  if(!control)throw new Error('尚未設定。');
  const run=String(control.getRange('B7').getValue());if(!run)throw new Error('請先立即同步。');
  if(marketingHash_(readMarketingSource_(ss,control))!==String(control.getRange('B8').getValue()))throw new Error('原企劃已變更，請先同步最新內容。');
  const errors=[];
  Object.keys(MS_TABLES).filter(n=>n!=='同步紀錄').forEach(name=>{
    const sheet=ss.getSheetByName(name);if(!sheet||sheet.getLastRow()<2)return;
    sheet.getRange(2,1,sheet.getLastRow()-1,MS_TABLES[name].length).getDisplayValues().forEach((r,i)=>{
      if(r[0]!==run)return;
      const status=r[name==='活動主檔'?8:name==='活動條件'?9:name==='贈品／加價購'?10:5];
      const label=name+'第'+(i+2)+'列';
      if(!['已覆核','已確認','不適用'].includes(status))errors.push(label+'尚未覆核');
      if(status==='不適用'&&name!=='覆核待辦')return;
      if(name==='活動主檔'&&(!r[5]||!r[6]||!r[7]||/待確認|待覆核/.test(r[7])))errors.push(label+'缺明確期間／通路');
      if(name==='活動條件'&&status==='已覆核'&&r.slice(6,9).some(v=>!v))errors.push(label+'缺範圍／排除／搭配說明（無限制也請明填）');
      if(name==='贈品／加價購'&&status==='已覆核'&&(!/^\d+(\.\d+)?$/.test(r[7])||Number(r[7])<=0||!r[8]||!r[9]))errors.push(label+'缺有效數量／門檻／累贈關係');
      if(name==='覆核待辦'&&status!=='待確認'&&!r[6].trim())errors.push(label+'缺覆核說明');
    });
  });
  SpreadsheetApp.getUi().alert(errors.length?'尚有'+errors.length+'項未完成：\n'+errors.slice(0,12).join('\n'):'已完成基本欄位檢查；這是測試資料，未發布至採購／週調撥。商品集合、活動拆分及供需估算仍須驗收。');
}

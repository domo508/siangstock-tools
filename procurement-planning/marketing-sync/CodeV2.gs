/** @OnlyCurrentDoc */
const MS_VERSION='20261104-marketing-review-r5';
const MS_ID='1eOXzJB_r01FLsibHhGxUnu7cXPzg7_DotB6caN81sMM';
const MS_CONTROL='同步控制台';
const MS_BASE=['案型類型','案型名稱','完整優惠內容','開始時間','結束時間','通路','適用門市','適用商品／範圍','排除條件','搭配限制／備註','覆核狀態'];
const MS_TAIL=['共同檔期編號','案型識別碼','同步版本','來源位置','來源原文'];
const MS_PRODUCT_SUMMARY=['商品命中摘要','商品確認狀態','查看品項明細'];
const MS_TABLES={
  '活動案型':MS_BASE.concat(MS_TAIL,MS_PRODUCT_SUMMARY),
  '贈品／加價購案型':MS_BASE.concat(['ERP品號','每次數量','門檻／購買前提','累贈／並贈關係'],MS_TAIL,MS_PRODUCT_SUMMARY),
  '活動商品明細':['納入活動','ERP品號','商品品名','命中依據／待確認事項','商品角色','確認狀態','返回主表','案型識別碼','同步版本','主檔指紋','主表頁籤','主表列號'],
  '覆核待辦':['同步版本','待辦識別碼','案型識別碼','來源位置','待確認事項','處理狀態','覆核說明'],
  '同步紀錄':['時間（台北）','程式版本','同步版本','來源指紋','來源儲存格數','活動案型筆數','贈品／加價購案型筆數','待辦筆數','結果'],
  '排除紀錄':['同步版本','案型識別碼','來源位置','活動內容','排除原因']
};
function onOpen(){SpreadsheetApp.getUi().createMenu('行銷同步（測試）').addItem('活動同步與覆核','showMarketingWorkflow').addItem('歷史查詢（唯讀）','showMarketingHistory').addItem('接續既有月份（保留覆核）','resumeMarketingMonthNative').addItem('查看本活動商品明細','showMarketingProducts').addItem('返回對應活動','returnMarketingOffer').addItem('覆核本活動（條件與商品一次完成）','previewMarketingSelected').addItem('批次覆核活動','previewMarketingAll').addItem('人工加入本活動商品','manualMarketingProductPanel').addItem('驗證覆核資料（不發布）','validateMarketingReview').addToUi();}
function assertMarketingBook_(){const ss=SpreadsheetApp.getActive();if(ss.getId()!==MS_ID)throw new Error('僅限指定測試副本。');return ss;}
function setupMarketingSync(){
  const ss=assertMarketingBook_(),control=ss.getSheetByName(MS_CONTROL);if(!control)throw new Error('缺少原控制台，停止升級。');
  // Rename and hide, never delete or overwrite old drafts or review notes.
  ['活動主檔','活動條件','贈品／加價購'].forEach(n=>{const s=ss.getSheetByName(n);if(s){if(ss.getSheetByName('舊版r1_'+n))throw new Error('舊版封存名稱衝突：'+n);s.setName('舊版r1_'+n).hideSheet();}});
  ['覆核待辦','同步紀錄'].forEach(n=>{const s=ss.getSheetByName(n);if(s&&s.getRange(1,1,1,s.getLastColumn()).getDisplayValues()[0].join('|')!==MS_TABLES[n].join('|')){if(ss.getSheetByName('舊版r1_'+n))throw new Error('舊版封存衝突');s.setName('舊版r1_'+n).hideSheet();}});
  Object.keys(MS_TABLES).forEach(n=>ensureMarketingTable_(ss,n));
  ['同步控制台','活動案型','贈品／加價購案型','活動商品明細','覆核待辦','同步紀錄'].forEach((n,i)=>{ss.setActiveSheet(ss.getSheetByName(n));ss.moveActiveSheet(i+1);});
  control.getRange('B1').setValue(MS_VERSION);
  control.getRange('B5').setValue('行銷同步（測試）→立即同步／重新比對主檔。主表只看摘要，品號到活動商品明細勾選，再確認本活動商品。');
  control.getRange('B10:B12').setValues([['兩個主要頁籤直接覆核名稱、優惠內容、期間、通路、範圍與限制；缺漏見覆核待辦。'],['重按不新增；來源或解析版本改變另建版本。舊版及人工覆核保留；篩選預設顯示最後成功版本。'],['沒有明確日期／品號／數量不猜測。共同檔期編號只用於連結，沒有活動主檔。']]);
  control.getRange('A1:B13').setWrap(true).setVerticalAlignment('top');
  // Editor runs may lack an active Sheets UI. onOpen rebuilds the menu on reload.
  ss.setActiveSheet(control);SpreadsheetApp.flush();ss.toast('兩案型版本已配置，請重新載入後立即同步。','測試版',6);
}
function ensureMarketingTable_(ss,name){
  let s=ss.getSheetByName(name);const h=MS_TABLES[name];
  if(s){const old=s.getRange(1,1,1,s.getLastColumn()).getDisplayValues()[0];
    if(JSON.stringify(old)!==JSON.stringify(h)){
      if(!['活動案型','贈品／加價購案型'].includes(name)||JSON.stringify(old)!==JSON.stringify(h.slice(0,-MS_PRODUCT_SUMMARY.length)))throw new Error(name+'欄位版本不同。');
      if(s.getMaxColumns()<h.length)s.insertColumnsAfter(s.getMaxColumns(),h.length-s.getMaxColumns());
      s.getRange(1,old.length+1,1,MS_PRODUCT_SUMMARY.length).setValues([MS_PRODUCT_SUMMARY]).setBackground('#153f63').setFontColor('#ffffff').setFontWeight('bold').setWrap(true);
    }
    if(['活動案型','贈品／加價購案型'].includes(name)){s.hideColumns(h.indexOf('共同檔期編號')+1,MS_TAIL.length);styleMarketingSummary_(s,h);}
    return s;}
  s=ss.insertSheet(name);s.getRange(1,1,1,h.length).setValues([h]).setBackground('#153f63').setFontColor('#ffffff').setFontWeight('bold').setWrap(true);s.setFrozenRows(1);s.setTabColor('#176b87');s.setColumnWidths(1,h.length,160);
  h.forEach((v,i)=>{if(/內容|備註|原文|事項|說明/.test(v))s.setColumnWidth(i+1,380);if(/名稱/.test(v))s.setColumnWidth(i+1,270);});
  if(h.includes('來源原文'))s.hideColumns(h.indexOf('來源原文')+1);
  if(['活動案型','贈品／加價購案型'].includes(name)){s.hideColumns(h.indexOf('共同檔期編號')+1,MS_TAIL.length);styleMarketingSummary_(s,h);}
  if(name==='活動商品明細'){s.setColumnWidth(1,95);s.setColumnWidth(2,140);s.setColumnWidth(3,360);s.setColumnWidth(4,320);s.hideColumns(8,5);}
  return s;
}
function styleMarketingSummary_(s,h){s.setColumnWidth(h.indexOf('商品命中摘要')+1,260);s.setColumnWidth(h.indexOf('商品確認狀態')+1,160);s.setColumnWidth(h.indexOf('查看品項明細')+1,160);if(marketingUnifiedEnabled_())s.hideColumns(h.indexOf('商品確認狀態')+1);}
function columnLabel_(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
function readMarketingSource_(ss,c){
  const name=String(c.getRange('B2').getValue()),year=Number(c.getRange('B3').getValue()),month=Number(c.getRange('B4').getValue());
  if(!Number.isInteger(year)||year<2026||year>2100||!Number.isInteger(month)||month<1||month>12)throw new Error('年度／月份不正確。');
  const s=ss.getSheetByName(name);if(!s||!name.includes(String(year).slice(-2))||/舊版|案型|控制台/.test(name))throw new Error('來源工作表與年度不符。');
  if(s.getLastRow()>3000||s.getLastColumn()>60)throw new Error('來源超出驗證範圍。');
  const data=s.getDataRange().getDisplayValues(),matches=[];data.slice(0,5).forEach((r,i)=>r.forEach((v,j)=>{if(v.trim()===month+'月')matches.push([i,j]);}));
  if(matches.length!==1)throw new Error('月份欄位不是唯一。');const [r0,col]=matches[0],cells=[];
  for(let r=r0+1;r<data.length;r++){const raw=String(data[r][col]||'').trim();if(raw)cells.push({sheet:name,ref:columnLabel_(col+1)+(r+1),category:String(data[r][0]||'未標分類'),raw});}
  if(!cells.length)throw new Error('月份無內容，不以空資料取代上一版。');return {year,month,cells};
}
function marketingHash_(s){const payload={parser:MS_VERSION,source:s};if(s&&typeof s==='object'&&s.source&&typeof s.master==='string')payload.productPolicy=MS_PRODUCT_POLICY;return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(payload)).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function safeMarketingText_(v){return typeof v==='string'&&/^[=+\-@]/.test(v)?"'"+v:v;}
function marketingDate_(year,month,day,time){
  const d=new Date(Date.UTC(year,month-1,day));if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return '';
  if(time&&!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time))return '';
  return year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0')+(time?' '+time.padStart(5,'0'):'');
}
function marketingPeriod_(line,year){
  const m=line.match(/^(門市|官網)\s*[：:]\s*(\d{1,2})\/(\d{1,2})\s*(\d{1,2}:\d{2})?\s*[-－–~～至]\s*(\d{1,2})\/(\d{1,2})\s*(\d{1,2}:\d{2})?/);
  if(!m)return null;const endYear=Number(m[5])<Number(m[2])?year+1:year;
  return {channel:m[1],start:marketingDate_(year,+m[2],+m[3],m[4]),end:marketingDate_(endYear,+m[5],+m[6],m[7]),raw:line};
}
function marketingType_(text,category){
  if(/抽獎|抽Acer|抽.*行李箱/.test(text)&&!/(?:贈|即送|就送|加價購|加購價)/.test(text.replace(/抽獎贈品/g,'抽獎')))return '抽獎資格';
  if(/加價購|加購價|加價購貨號/.test(text)||/加價購/.test(category))return '加價購';
  if(/買一送一/.test(text))return '買一送一';
  if(/贈|即送|就送/.test(text))return /滿/.test(text)?'滿額／滿件贈':'購物贈';
  return /折扣碼/.test(text)?'折扣碼':/優惠價|限時\$|售價變/.test(text)?'限定價':/滿.*折/.test(text)?'滿額優惠':'折扣／商品優惠';
}
function marketingSkus_(text){
  const skus=[];const re=/(?:贈品|加價購|加購|ERP)?(?:貨號|品號)\s*[：:]\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)?(?:\s*[、,，]\s*[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)?)*)/gi;
  let m;while((m=re.exec(text)))m[1].split(/\s*[、,，]\s*/).forEach(s=>{s=s.toUpperCase();if(!skus.includes(s))skus.push(s);});return skus;
}
function marketingBlocks_(segment,year){
  const blocks=[];segment.split(/\n\s*\n+/).forEach(raw=>{
    const lines=raw.split('\n').map(t=>t.trim()).filter(Boolean);if(!lines.length)return;
    const dates=lines.filter(l=>/^(門市|官網)\s*[：:]/.test(l)),body=lines.filter(l=>!dates.includes(l));
    if(!body.length&&blocks.length){blocks[blocks.length-1].dates.push(...dates);return;}
    blocks.push({body,dates});
  });
  return blocks;
}
function splitMarketingGiftClauses_(item){
  const parts=item.text.split(/\n/),clauses=parts[0].split(/[，,]\s*(?=(?:消費)?滿[^，,\n]*再贈)/);
  if(clauses.length!==2)return [item];
  const markers=[...item.text.matchAll(/[｜|]\s*([^｜|\n]*?)贈品貨號\s*[：:]\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)?)/gi)];
  if(markers.length!==2)return [item];
  const used=[];const result=clauses.map(clause=>{
    const matches=markers.filter(m=>m[1].trim()&&clause.includes(m[1].trim()));
    if(matches.length!==1)return null;used.push(matches[0][2]);
    return Object.assign({},item,{text:clause+'｜'+matches[0][1]+'贈品貨號：'+matches[0][2],giftRelation:'同原活動含任購贈與滿額再贈；並贈關係待覆核'});
  });
  return result.every(Boolean)&&new Set(used).size===2?result:[item];
}
function parseMarketingDraft_(source,run){
  const out={'活動案型':[],'贈品／加價購案型':[],'覆核待辦':[],'排除紀錄':[]};let seq=0,qs=0;const audit=[];
  const issue=(id,loc,notes)=>{if(notes.length)out['覆核待辦'].push([run,run+'-Q'+(++qs),id,loc,[...new Set(notes)].join('；'),'待確認','']);};
  source.cells.forEach(cell=>{
    const loc=cell.sheet+'!'+cell.ref;
    const segments=cell.raw.split(/\n\s*[-─－]{5,}\s*\n/).map(t=>t.trim()).filter(Boolean);
    segments.forEach((segment,si)=>{
      const blocks=marketingBlocks_(segment,source.year),items=[];let defaultDates=[],heading='';
      const exclusions=segment.split('\n').filter(l=>/^\s*⚠.*排除/.test(l)).join('\n');
      const segmentNotes=segment.split('\n').filter(l=>/^\s*活動備註[：:]/.test(l)).join('\n');
      blocks.forEach(b=>{
        if(!b.body.length){defaultDates=b.dates;return;}
        const local=[];let numberedHeading='',current=null;
        b.body.forEach((line,li)=>{
          if(/^活動備註[：:]/.test(line)||/^⚠.*排除/.test(line))return;
          if(/^【.*】$/.test(line)){heading=line;return;}
          if(/^折扣碼[：:]/.test(line)&&current){current.text+='\n'+line;return;}
          const isBullet=/^[*＊√]/.test(line),isNumber=/^\d+[、.．]/.test(line);
          const cleaned=line.replace(/^[*＊√]\s*|^\d+[、.．]\s*/,'').trim();
          const hasOffer=/折|贈|送|優惠|限時\$|現折|滿\s*\$?\s*[\d,]+/.test(cleaned);
          if(isBullet&&/當日限定/.test(cleaned)&&!/(?:貨號|品號)/.test(cleaned)){numberedHeading=cleaned;current=null;return;}
          if(!hasOffer&&!isBullet&&!isNumber&&!current){heading=cleaned;return;}
          if(isNumber&&!hasOffer&&/系列活動$/.test(cleaned)){heading=cleaned;return;}
          if(isBullet||isNumber||hasOffer&&!/^[｜|]/.test(line)){
            current={text:(isNumber&&numberedHeading?numberedHeading+'｜':'')+cleaned,heading,dates:b.dates.length?b.dates:defaultDates};local.push(current);
          }else if(current){current.text+='\n'+line;}else if(li>=0){
            // Unknown narrative is retained as a meaningful draft, never silently discarded.
            current={text:cleaned,heading,dates:b.dates.length?b.dates:defaultDates,unknown:true};local.push(current);
          }
        });
        // A price-list heading without numbered entries is not silently dropped.
        if(numberedHeading&&!local.some(x=>x.text.includes(numberedHeading)))local.push({text:numberedHeading,heading,dates:b.dates.length?b.dates:defaultDates});
        items.push(...local);
      });
      // Tier notes are real gift offers, not standalone date/reason rows.
      segmentNotes.split(/[，,]/).forEach(part=>{
        const text=part.replace(/^活動備註[：:]\s*/,'').trim();if(!/滿.*贈/.test(text))return;
        const amount=text.match(/滿\s*\$?\s*([\d,]+)/)?.[1]?.replace(/,/g,'');
        if(items.some(x=>/贈/.test(x.text)&&amount&&x.text.replace(/,/g,'').match(new RegExp('滿\\s*\\$?\\s*'+amount))))return;
        const firstDated=blocks.find(b=>b.dates.length&&b.body.length);
        items.push({text,heading:heading||'滿額贈級距',dates:firstDated?firstDated.dates:defaultDates,noteTier:true});
      });
      if(!items.length){
        if(segment.split('\n').filter(t=>t.trim()).every(t=>/^(門市|官網)\s*[：:]/.test(t.trim()))){issue('未配對期間',loc,['只有日期，找不到優惠內容；不建立案型']);return;}
        items.push({text:segment,heading:cell.category,dates:defaultDates,unknown:true});
      }
      items.flatMap(splitMarketingGiftClauses_).forEach(item=>{
        const periods=item.dates.map(l=>marketingPeriod_(l,source.year)).filter(Boolean);
        const unique=periods.filter((p,i)=>periods.findIndex(q=>q.channel===p.channel&&q.start===p.start&&q.end===p.end)===i);
        let variants=[];
        if(unique.length&&unique.every(p=>p.start===unique[0].start&&p.end===unique[0].end))variants=[{channel:unique.map(p=>p.channel).join('＋'),start:unique[0].start,end:unique[0].end}];
        else if(unique.length)variants=unique;
        else variants=[{channel:/蝦皮/.test(cell.category)?'蝦皮':/門市限定/.test(item.text)?'門市':'待確認',start:'',end:''}];
        variants.forEach((p,vi)=>{
          const notes=[];const type=marketingType_(item.text,cell.category),gift=/贈|加價購|買一送一|抽獎/.test(type);
          const id='M'+source.year+String(source.month).padStart(2,'0')+'-'+String(++seq).padStart(3,'0');
          if(type==='抽獎資格'){
            const special=/獎品[^\n]*(?:採購|備貨)|(?:採購|備貨)[^\n]*獎品/.test(item.text);
            out['排除紀錄'].push([run,id,loc,item.text,special?'抽獎不自動計量；獎品需另行採購／備貨，請人工處理':'純抽獎不配發商品，不建立候選或補貨需求']);return;
          }
          const campaign='P'+source.year+String(source.month).padStart(2,'0')+'-'+cell.ref+'-'+(si+1);
          let start=p.start,end=p.end,channel=p.channel;
          if(!start&&!end&&channel==='蝦皮'){
            const d=item.text.match(/^(\d{1,2})\/(\d{1,2})\s/);if(d)start=end=marketingDate_(source.year,+d[1],+d[2]);
          }
          if(/新竹購物節.*台中|新竹.*台中購物節/.test(item.heading))channel='門市';
          if(!start||!end)notes.push('活動起訖未明載或日期無效，請確認');
          if(channel==='待確認')notes.push('適用通路未明載');
          const stores=marketingStoreScope_(channel,item.heading+'\n'+item.text);
          if(stores.includes('待確認'))notes.push('指定門市描述尚未對應，請確認');
          // A negative stacking clause mentioning 全館／全站 is not the offer's scope.
          const scope=item.text.match(/^(全館|全站|全系列)/)?.[1]||item.text.match(/^([^，。\n｜|]+?)(?:\s*\d{1,2}\s*折|單件現折|系列滿)/)?.[1]?.trim()||'請依完整內容確認商品集合';
          const ownExclusions=item.text.match(/排除[^\n]+/g)||[];
          const excluded=[exclusions,...ownExclusions].filter(Boolean).join('\n')||'未明載，請確認';
          const limits=[segmentNotes,item.giftRelation||'',/抽獎/.test(type)?'抽獎資格，不代表每單配發實體贈品':'',/平台|蝦皮/.test(channel)?'非門市活動，不帶入週調撥':'',/大福/.test(item.text)?'活動優惠不解除接單客製／週調撥排除規則':''].filter(Boolean).join('\n');
          const name=(item.heading?item.heading+'｜':'')+item.text.split('\n')[0];
          const base=[type,name.slice(0,160),item.text,start,end,channel,stores,scope,excluded,limits,'待覆核'];
          const skus=marketingSkus_(item.text);const qtyMatch=item.text.match(/(?:贈|送)[^｜|\n]*?(\d+|乙|一)\s*(入|組|張|包|份|顆|雙|罐)/);
          let qty=qtyMatch?(qtyMatch[1]==='乙'||qtyMatch[1]==='一'?'1':qtyMatch[1]):'';
          if(skus.length>1)qty='';
          const threshold=item.text.match(/滿\s*\$?\s*[\d,]+(?:\s*[-－～]\s*\$?[\d,]+)?(?:以上|元|件)?/)?.[0]||(/任購|購買|買一送一/.test(item.text)?item.text.split(/[｜|]/)[0]:'');
          const relation=[/不累贈/.test(item.text)?'不累贈':/可累贈/.test(item.text)?'可累贈':'',/再贈/.test(item.text)?'含再贈／加贈，需確認各品項關係':'',/不挑款|隨機/.test(item.text)?'不挑款／隨機':''].filter(Boolean).join('；');
          const tail=[campaign,id,run,loc,segment];
          if(gift){
            if(!skus.length&&type!=='抽獎資格')notes.push('缺ERP品號，請核對主檔');
            if(!qty&&type!=='抽獎資格')notes.push(skus.length>1?'多品號需確認擇一／並贈與各品數量':'每次數量未明載');
            if(type==='加價購'&&!threshold)notes.push('加價購購買前提未明載');
            if(item.noteTier)notes.push('級距備註需確認對應品號與每次數量');
            if(/紙膠帶/.test(item.text)&&/襪子/.test(item.text))notes.push('包含任購贈與滿額再贈，請確認兩個條件；不得共用第一個門檻');
            out['贈品／加價購案型'].push(base.concat([skus.join('、'),qty,threshold,relation],tail));
          }else out['活動案型'].push(base.concat(tail));
          if(item.unknown)notes.push('原文需確認是否為獨立優惠或補充說明');
          issue(id,loc,notes);audit.push({id,loc,text:item.text,variant:vi});
        });
      });
    });
  });
  // Audit stays in memory; no separate master sheet or duplicate offer rows.
  return out;
}
function syncMarketingNow(){return showMarketingWorkflow();}
function syncMarketingFromPanel(request){
  if(PropertiesService.getDocumentProperties().getProperty('marketing-workflow-enabled'))throw new Error('同步流程已更新，請關閉舊視窗並重新載入最新版，再從「活動同步與覆核」開始；本次未同步或捨棄修改。');
  const ss=assertMarketingBook_(),c=ss.getSheetByName(MS_CONTROL),lock=LockService.getDocumentLock();if(!lock.tryLock(1000))throw new Error('目前無法取得作業鎖，前次同步或覆核可能尚未結束。可能是同一帳號重複點擊，也可能有其他作業處理中，與表單在線人數無關。請先關閉舊提示，稍候再試；若持續發生，請由管理者檢查執行紀錄。本次尚未開始同步，資料未變更。');
  let validatingPeriod=request!==undefined;
  try{
    if(c.getRange('B1').getDisplayValue()!==MS_VERSION)throw new Error('版本不同，請先執行新版配置並重新載入試算表。');
    if(request!==undefined)prepareMarketingSyncPeriod_(ss,c,request);
    validatingPeriod=false;
    Object.keys(MS_TABLES).forEach(n=>ensureMarketingTable_(ss,n));
    c.getRange('B6').setValue('同步中：讀取來源與商品主檔；B7仍為最後成功版本。');SpreadsheetApp.flush();
    const source=readMarketingSource_(ss,c),master=readMarketingMaster_(),hash=marketingHash_({source,master:master.fingerprint});
    if(c.getRange('B8').getDisplayValue()===hash){const message='來源與解析版本未變更，不重複新增；人工覆核保留。未發布。';c.getRange('B6').setValue(message);return {message};}
    const run=Utilities.formatDate(new Date(),'Asia/Taipei','yyyyMMdd-HHmmss')+'-'+Utilities.getUuid().slice(0,8),draft=parseMarketingDraft_(source,run),writes=[];
    if(!draft['活動案型'].length&&!draft['贈品／加價購案型'].length&&!draft['排除紀錄'].length)throw new Error('沒有優惠案型。');
    const productSnapshots=enrichMarketingProducts_(draft,master,run);
    preserveMarketingSelections_(ss,draft,productSnapshots,master);
    if(marketingUnifiedEnabled_())prepareMarketingUnifiedDraft_(ss,draft,productSnapshots,source,master);else carryMarketingPriorMonth_(ss,draft,productSnapshots,master,source);
    c.getRange('B6').setValue('同步中；最後成功版本仍見B7。');
    Object.keys(draft).forEach(n=>{const rows=draft[n],s=ss.getSheetByName(n);if(!rows.length)return;const r=s.getLastRow()+1;
      if(r+rows.length-1>s.getMaxRows())s.insertRowsAfter(s.getMaxRows(),r+rows.length-1-s.getMaxRows());
      const output=s.getRange(r,1,rows.length,MS_TABLES[n].length);output.setNumberFormat('@');
      // Google Sheets coerces booleans to text when written into Plain text.
      // Restore checkbox format BEFORE setValues, not after the coercion.
      if(n==='活動商品明細')s.getRange(r,1,rows.length,1).setNumberFormat('General');
      output.setValues(rows.map(x=>x.map(safeMarketingText_))).setWrap(true).setVerticalAlignment('top');
      const rawCol=MS_TABLES[n].indexOf('來源原文')+1;if(rawCol)s.getRange(r,rawCol,rows.length,1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
      if(n==='活動商品明細'){
        s.getRange(r,1,rows.length,1).setNumberFormat('General').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build());
      }else if(n!=='排除紀錄'){
        const col=n==='覆核待辦'?6:11,options=n==='覆核待辦'?['待確認','已確認','不適用']:['待覆核','已覆核','不適用'];
        s.getRange(r,col,rows.length,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(options,true).setAllowInvalid(false).build());
        s.setConditionalFormatRules(s.getConditionalFormatRules().concat([SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(options[0]).setBackground('#fff3d4').setRanges([s.getRange(r,col,rows.length,1)]).build()]));
      }
      writes.push({s,r,rows,n});
    });
    SpreadsheetApp.flush();
    writes.forEach(w=>{const values=w.s.getRange(w.r,1,w.rows.length,MS_TABLES[w.n].length).getValues();if(JSON.stringify(values)!==JSON.stringify(w.rows))throw new Error('完整內容回讀核對失敗：'+w.n);});
    if(marketingHash_({source:readMarketingSource_(ss,c),master:master.fingerprint})!==hash||latestMarketingMaster_().identity!==master.identity)throw new Error('同步中原企劃或主檔已改動，新版本未啟用，請重試。');
    linkMarketingProducts_(ss,writes,productSnapshots,master);
    if(marketingUnifiedEnabled_())finishMarketingUnifiedDraft_(ss,writes,productSnapshots);
    const counts=['活動案型','贈品／加價購案型','覆核待辦'].map(n=>draft[n].length);
    ss.getSheetByName('同步紀錄').appendRow([Utilities.formatDate(new Date(),'Asia/Taipei','yyyy-MM-dd HH:mm:ss'),MS_VERSION,run,hash,source.cells.length,...counts,'草稿完成；未發布']);
    writes.forEach(w=>filterMarketingRun_(w.s,w.n,run));
    // Only promote a fully verified generation. Old review rows remain untouched.
    c.getRange('B7:B8').setValues([[run],[hash]]);
    c.getRange('A14:B14').setValues([['商品比對導覽',MS_NAV_VERSION]]);
    if(marketingUnifiedEnabled_()){c.getRange('A15:B15').setValues([['活動覆核介面',MS_REVIEW_VERSION]]);c.getRange('B5').setValue('行銷同步（測試）→覆核本活動／批次覆核活動。一次核對條件與商品；客製／特殊規格及已下架商品不列候選。');}
    const message='同步完成：活動案型'+counts[0]+'筆、贈品／加價購案型'+counts[1]+'筆、商品明細'+draft['活動商品明細'].length+'筆、待確認'+counts[2]+'項、抽獎排除'+draft['排除紀錄'].length+'筆。請核對各列確認狀態；未發布。';c.getRange('B6').setValue(message);SpreadsheetApp.flush();return {message,run,counts};
  }catch(e){
    if(validatingPeriod)throw e;
    // A filter/update error must not leave an unpromoted generation looking active.
    try{const last=c.getRange('B7').getDisplayValue();if(last)['活動案型','贈品／加價購案型','活動商品明細','覆核待辦'].forEach(n=>{const s=ss.getSheetByName(n);if(s&&s.getLastRow()>1)filterMarketingRun_(s,n,last);});}catch(_){}
    try{c.getRange('B6').setValue('同步未完成：'+e.message+'；以B7最後成功版本為準。');SpreadsheetApp.flush();}catch(_){}throw e;
  }finally{lock.releaseLock();}
}
function filterMarketingRun_(s,name,run){if(s.getFilter())s.getFilter().remove();const f=s.getRange(1,1,s.getLastRow(),MS_TABLES[name].length).createFilter();f.setColumnFilterCriteria(MS_TABLES[name].indexOf('同步版本')+1,SpreadsheetApp.newFilterCriteria().whenTextEqualTo(run).build());if(['活動案型','贈品／加價購案型'].includes(name))f.setColumnFilterCriteria(11,SpreadsheetApp.newFilterCriteria().setHiddenValues(['已取消']).build());}
function validateMarketingReview(){
  if(marketingUnifiedEnabled_())return validateMarketingUnified_();
  const ss=assertMarketingBook_(),c=ss.getSheetByName(MS_CONTROL),run=c.getRange('B7').getDisplayValue(),errors=[];
  if(c.getRange('B1').getDisplayValue()!==MS_VERSION||!run)throw new Error('請先同步新版。');
  const master=readMarketingMaster_();
  if(marketingHash_({source:readMarketingSource_(ss,c),master:master.fingerprint})!==c.getRange('B8').getDisplayValue())throw new Error('來源、主檔或解析版本已變更，請先同步。');
  const detailSheet=ss.getSheetByName('活動商品明細'),allDetails=detailSheet.getLastRow()>1?detailSheet.getRange(2,1,detailSheet.getLastRow()-1,MS_TABLES['活動商品明細'].length).getValues():[];
  ['活動案型','贈品／加價購案型','覆核待辦'].forEach(n=>{const s=ss.getSheetByName(n),h=MS_TABLES[n];if(s.getLastRow()<2)return;
    s.getRange(2,1,s.getLastRow()-1,h.length).getDisplayValues().forEach((r,i)=>{if(r[h.indexOf('同步版本')]!==run)return;const status=r[n==='覆核待辦'?5:10],label=n+'第'+(i+2)+'列';
      if(!['已覆核','已確認','不適用'].includes(status))errors.push(label+'尚未覆核');
      if(n==='覆核待辦'){if(status!=='待確認'&&!r[6].trim())errors.push(label+'缺覆核說明');return;}
      if(status==='不適用')return;if(!r[2]||!r[3]||!r[4]||/待確認/.test(r[5]+r[6]+r[7]+r[8]))errors.push(label+'期間／適用範圍／排除仍未確認');
      if(!marketingConfirmedProductsValid_(ss,n,i+2,r,master,allDetails))errors.push(label+'商品集合未確認或已變動');
      if(n==='贈品／加價購案型'&&r[0]!=='抽獎資格'&&(!r[11]||!/^\d+$/.test(r[12])||Number(r[12])<=0||!r[13]||!r[14]))errors.push(label+'品號／數量／門檻／並贈未確認');
    });
  });
  SpreadsheetApp.getUi().alert(errors.length?'尚有'+errors.length+'項未完成：\n'+errors.slice(0,10).join('\n'):'基本覆核欄位完成；測試版不發布至採購／週調撥。');
}

// UI-only recovery release. Parser/source fingerprint and existing drafts stay unchanged.
const MS_SYNC_UI_VERSION='20261118-marketing-sync-status-r1';
function marketingSyncNotice_(message){assertMarketingBook_().toast(String(message),'行銷同步狀態',20);}
function checkMarketingSyncStatus(){
  assertMarketingBook_();
  const lock=LockService.getDocumentLock();let available=false;
  try{available=lock.tryLock(1000);}finally{if(available)lock.releaseLock();}
  const result={version:MS_SYNC_UI_VERSION,available:available,message:available?'同步作業鎖可用，目前可執行一次立即同步。此次僅檢查，未讀取主檔、重跑同步或修改資料。':'目前同步作業鎖仍被使用中。無法由此判斷操作者；與表單在線人數無關。請先關閉舊提示並由管理者查看執行紀錄。此次僅檢查，未修改資料。'};
  console.log(JSON.stringify(result));marketingSyncNotice_(result.message);return result;
}

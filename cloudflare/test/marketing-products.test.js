import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {xml2js} from 'xml-js';

// Adapt the real XML parser to the documented Apps Script XmlService surface.
import {xmlService,runtime,spreadsheetFixture} from './helpers/marketing-runtime.js';
const header=['貨號','品名','主類別','款式類別','尺碼','系列','品牌','貨品狀態','已下架'];
const rows=[header,['A1','華爾紗兩用被套 雙人','被套','華爾紗','6x7','','','','否'],['A2','華爾紗兩用被套 單人','被套','華爾紗','單人','','','','否'],['A3','埃及棉浴巾','浴巾','埃及棉','','','','','否'],['A4','特賣天絲床包','床包','天絲','','','','','否'],['A5','天絲床包','床包','天絲','','','','停產','是'],['N1','贈品-Sybil抱枕套','抱枕套','','','Sybil','','','否']];
function offer(text,gift=false){return [gift?'滿額／滿件贈':'折扣／商品優惠','測試',text,'2026-11-11','2026-11-15','門市','全部門市','請依完整內容確認商品集合','排除特賣品','','待覆核',...(gift?['','','滿3500','不累贈']:[]),'campaign','offer','run','source','raw'];}
function decisionFixture(){const c=runtime(),d={'活動案型':[offer('華爾紗兩用被套85折')],'贈品／加價購案型':[]},snap=c.enrichMarketingProducts_(d,{products:c.marketingMasterRows_(rows),fingerprint:'master'},'run')[0];snap.details.forEach(r=>r[11]=2);return {c,row:d['活動案型'][0],details:snap.details,snapshot:{master:'master',offerHash:snap.offerHash,detailHash:c.marketingDetailHash_(snap.details,false),count:snap.details.length,notApplicable:false}};}
describe('marketing product matching and native review',()=>{
  it('defaults store channel to all stores while respecting named and restricted stores',()=>{
    const c=runtime();expect(c.marketingStoreScope_('門市＋官網','全館85折')).toBe('全部門市');expect(c.marketingStoreScope_('門市','本活動門市限定')).toBe('全部門市');expect(c.marketingStoreScope_('門市','門市限定')).toBe('全部門市');expect(c.marketingStoreScope_('門市 R06','優惠')).toBe('R06文心秀泰');
    expect(c.marketingStoreScope_('門市','文心秀泰限定')).toBe('R06文心秀泰');expect(c.marketingStoreScope_('門市','台中北屯、新竹門市')).toBe('R01台中北屯、R03新竹東區');
    for(const s of ['部分門市','指定門市','排除新莊門市','排除文心','僅限淡水門市','淡水門市','文心、淡水門市','淡水店限定'])expect(c.marketingStoreScope_('門市',s)).toContain('待確認');
    expect(c.marketingStoreScope_('門市','品號R06001')).toBe('全部門市');
    expect(c.marketingStoreScope_('官網','文心門市不適用')).toContain('非門市');
  });
  it('combines material, category and size; does not broaden unmatched category',()=>{
    const c=runtime(),p=c.marketingMasterRows_(rows),match=t=>c.marketingProductCandidates_(offer(t),p,false).candidates.map(x=>x.product.sku);
    expect(match('華爾紗兩用被套(單人／雙人)85折')).toEqual(['A1','A2']);expect(match('埃及棉浴巾85折')).toEqual(['A3']);expect(match('天絲床包85折')).toEqual(['A4']);expect(match('華爾紗枕墊85折')).toEqual([]);
    expect(match('熊暖墊單件現折200 - 不額外跟全館折扣活動')).toEqual([]);
  });
  it('omits off-shelf merchandise while keeping campaign exclusions unchecked',()=>{
    const c=runtime(),a=c.marketingProductCandidates_(offer('天絲床包85折'),c.marketingMasterRows_(rows),false).candidates;
    expect(a.every(x=>!x.include)).toBe(true);expect(a[0].basis).toContain('活動排除：特賣');expect(a).toHaveLength(1);
  });
  it('matches explicit SKUs and missing SKUs without substituting another product',()=>{
    const c=runtime(),r=offer('滿3500贈Sybil抱枕套',true);r[11]='N1、N404';const a=c.marketingProductCandidates_(r,c.marketingMasterRows_(rows),true);
    expect(a.role).toBe('贈品');expect(a.candidates.map(x=>x.product.sku)).toEqual(['N1','N404']);expect(a.candidates[1].missing).toBe(true);expect(a.candidates[1].include).toBe(false);
  });
  it('matches named gifts without treating purchase qualifier as the gift',()=>{
    const c=runtime(),a=c.marketingProductCandidates_(offer('天絲滿3500贈Sybil抱枕套乙組(不累贈)',true),c.marketingMasterRows_(rows),true);
    expect(a.candidates.map(x=>x.product.sku)).toEqual(['N1']);expect(a.candidates[0].basis).toContain('不是購買資格');
  });
  it('appends compact summaries without changing existing offer count or raw text',()=>{
    const c=runtime(),r=offer('華爾紗兩用被套85折'),before=JSON.parse(JSON.stringify(r)),d={'活動案型':[r],'贈品／加價購案型':[]},s=c.enrichMarketingProducts_(d,{products:c.marketingMasterRows_(rows),fingerprint:'master'},'run');
    before[7]='華爾紗兩用被套';expect(d['活動案型']).toHaveLength(1);expect(r.slice(0,-3)).toEqual(before);expect(r.at(-2)).toBe('待確認');expect(s[0].details).toHaveLength(2);expect(d['活動商品明細'].every(r=>typeof r[0]==='boolean')).toBe(true);
  });
  it('does not silently approve zero matches or lottery gifts',()=>{
    const c=runtime(),r=offer('不存在產品優惠'),g=offer('滿5000抽行李箱',true);g[0]='抽獎資格';const d={'活動案型':[r],'贈品／加價購案型':[g]};const s=c.enrichMarketingProducts_(d,{products:c.marketingMasterRows_(rows),fingerprint:'master'},'run');
    expect(s[0].details[0][0]).toBe(false);expect(s[0].details[0][1]).toBe('');expect(s[1].details).toHaveLength(0);expect(g.at(-2)).toContain('不適用');
  });
  it('fails closed on missing, duplicate or conflicting master headers and SKU rows',()=>{
    const c=runtime();expect(()=>c.marketingMasterRows_([['無資料']])).toThrow();expect(()=>c.marketingMasterRows_([header])).toThrow();expect(()=>c.marketingMasterRows_([...rows,rows[1]])).toThrow(/重複/);expect(()=>c.marketingMasterRows_([['貨號','品號','品名'],['A1','A2','name']])).toThrow(/衝突/);
  });
  it('allows checkbox edits but guards deletion, product rewriting and source/master changes',()=>{
    const {c,row,details,snapshot}=decisionFixture();const first=c.marketingProductDecision_(row,details,snapshot,'master');expect(first.count).toBe(2);
    details[0][0]=false;const second=c.marketingProductDecision_(row,details,snapshot,'master');expect(second.count).toBe(1);expect(second.decisionHash).not.toBe(first.decisionHash);
    expect(()=>c.marketingProductDecision_(row,details.slice(1),snapshot,'master')).toThrow(/刪除/);details[0][1]='OTHER';expect(()=>c.marketingProductDecision_(row,details,snapshot,'master')).toThrow(/改寫/);
    expect(()=>c.marketingProductDecision_(row,details,snapshot,'new-master')).toThrow(/變動/);row[2]='changed';expect(()=>c.marketingProductDecision_(row,details,snapshot,'master')).toThrow(/變動/);
  });
  it('rejects zero selection and non-boolean cells instead of approving empty products',()=>{
    const {c,row,details,snapshot}=decisionFixture();details.forEach(r=>r[0]=false);expect(()=>c.marketingProductDecision_(row,details,snapshot,'master')).toThrow(/未勾選/);details[0][0]='TRUE';expect(()=>c.marketingProductDecision_(row,details,snapshot,'master')).toThrow(/勾選框/);
  });
  it('sorting complete detail rows is harmless; deleting or rewriting them is not',()=>{
    const {c,row,details,snapshot}=decisionFixture();const before=c.marketingProductDecision_(row,details,snapshot,'master');details.reverse();expect(c.marketingProductDecision_(row,details,snapshot,'master')).toEqual(before);
  });
  it('requires reconfirmation of review corrections but requires rematching changed product conditions',()=>{
    const {c,row,details,snapshot}=decisionFixture();snapshot.matchHash=c.marketingMatchHash_(row);row[6]='R06文心秀泰';
    expect(()=>c.marketingProductDecision_(row,details,snapshot,'master')).toThrow();expect(c.marketingProductDecision_(row,details,snapshot,'master',true).count).toBe(2);
    row[7]='天絲床包';expect(()=>c.marketingProductDecision_(row,details,snapshot,'master',true)).toThrow(/商品條件/);
  });
  it('scopes master reading to the fixed folder; rejects tied newest and oversized files',()=>{
    const folder='1wzVoxLUXb9CEJK-cWrH8AMPxO5NVpTeC',iter=a=>{let i=0;return {hasNext:()=>i<a.length,next:()=>a[i++]};},file=(id,time,size=100,parent=folder)=>({getId:()=>id,getLastUpdated:()=>new Date(time),getSize:()=>size,getMimeType:()=> 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',isTrashed:()=>false,getParents:()=>iter([{getId:()=>parent}])});
    let files=[file('old',1),file('new',2),file('wrong-parent',3,100,'other')];const c=runtime({DriveApp:{getFolderById:id=>{expect(id).toBe(folder);return {getFiles:()=>iter(files)};}}});
    expect(c.latestMarketingMaster_().id).toBe('new');files.push(file('tie',2));expect(()=>c.latestMarketingMaster_()).toThrow(/唯一/);files=[file('large',2,10000001)];expect(()=>c.latestMarketingMaster_()).toThrow(/10MB/);
  });
  it('requests read-only Drive scope and contains no Drive mutation, networking or downstream publishing',()=>{
    const base=new URL('../../procurement-planning/marketing-sync/',import.meta.url),code=['CodeV2','ProductMatch','MasterReader','ProductsReview'].map(n=>fs.readFileSync(new URL(n+'.gs',base),'utf8')).join('\n');
    const manifest=JSON.parse(fs.readFileSync(new URL('appsscript.products-test.json',base),'utf8'));expect(manifest.oauthScopes).toEqual(['https://www.googleapis.com/auth/spreadsheets.currentonly','https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/script.container.ui']);
    expect(code).not.toMatch(/UrlFetchApp|MailApp|GmailApp|createFile|makeCopy|setTrashed|deleteSheet|setSharing|openById/);
  });
  it('limits approved Google-hosted Excel processing to the explicitly named test workbook',()=>{
    let called=false;const c=runtime({SpreadsheetApp:{getActive:()=>({getId:()=> 'unapproved-workbook'})},DriveApp:{getFolderById:()=>{called=true;throw new Error('should not read');}}});expect(()=>c.readMarketingMaster_()).toThrow(/僅限指定測試副本/);expect(called).toBe(false);
  });
});

function parts(xmlOverrides={}){const values={'xl/workbook.xml':'<workbook xmlns="main" xmlns:r="rel"><sheets><sheet name="主檔" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':'<worksheet xmlns="main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>貨號</t></is></c><c r="B1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>A1</t></is></c><c r="B2" t="s"><v>1</v></c><c r="AA2"><v>12</v></c></row></sheetData></worksheet>','xl/sharedStrings.xml':'<sst><si><t>品名</t></si><si><r><t>枕套</t></r><r><t>&amp;天絲</t></r></si></sst>',...xmlOverrides};return Object.entries(values).map(([name,value])=>({getName:()=>name,getBytes:()=>Buffer.from(value),getDataAsString:()=>value}));}
describe('real XML-based XLSX reader',()=>{
  it('streams strict namespace XML, chunked entities and CDATA; rejects malformed XML',()=>{
    const c=runtime();expect(c.marketingWorksheetRows_('<m:worksheet xmlns:m="main"><m:sheetData><m:row><m:c r="A1" t="inlineStr"><m:is><m:r><m:t>A&amp;B</m:t></m:r><m:t><![CDATA[<商品>]]></m:t></m:is></m:c></m:row></m:sheetData></m:worksheet>',[])).toEqual([['A&B<商品>']]);
    for(const x of ['<worksheet><sheetData><row></sheetData></worksheet>','<worksheet><sheetData><row><c r="A1"><v>&unknown;</v></c></row></sheetData></worksheet>','<worksheet><sheetData/><sheetData/></worksheet>','<worksheet><sheetData><row><c r="A1"/><c r="A1"/></row></sheetData></worksheet>'])expect(()=>c.marketingWorksheetRows_(x,[])).toThrow();
  });
  it('reads inline, shared, rich strings, escaped text and multi-letter columns',()=>{const c=runtime(),r=c.marketingXlsxRows_(parts());expect(r[0]).toEqual(['貨號','品名']);expect(r[1][1]).toBe('枕套&天絲');expect(r[1][26]).toBe('12');expect(c.marketingMasterRows_(r)[0].sku).toBe('A1');});
  it('rejects multiple worksheets, external entities, missing paths and formula/error cells',()=>{
    const c=runtime();expect(()=>c.marketingXlsxRows_(parts({'xl/workbook.xml':'<workbook><sheets><sheet/><sheet/></sheets></workbook>'}))).toThrow(/單一/);
    for(const xml of ['<!DOCTYPE x [<!ENTITY test "unsafe">]><worksheet/>','<worksheet><sheetData><row><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>','<worksheet><sheetData><row><c r="A1" t="e"><v>ERROR</v></c></row></sheetData></worksheet>'])expect(()=>c.marketingXlsxRows_(parts({'xl/worksheets/sheet1.xml':xml}))).toThrow();
    expect(()=>c.marketingXlsxRows_(parts({'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="../outside.xml"/></Relationships>'}))).toThrow(/路徑/);
  });
});

// In-memory implementation of native cell types, filters, properties and locks.
// This exercises the actual sync/review entry points, not reimplemented business logic.
describe('sync to native-cell review lifecycle',()=>{
  it('upgrades navigation without changing source versions, checkbox values or confirmed decisions',()=>{
    const {c,ss,control,props}=spreadsheetFixture();c.setupMarketingSync();c.syncMarketingFromPanel();const main=ss.getSheetByName('活動案型'),d=ss.getSheetByName('活動商品明細');ss.setActiveSheet(main);c.confirmMarketingProducts();
    const before=JSON.stringify(main.rows[1].slice(0,18)),checks=d.rows.slice(1).map(r=>r[0]),run=control.getRange('B7:B8').getValues(),key=c.marketingProductKey_(run[0][0],main.rows[1][12]),decision=props.getProperty(key);
    c.upgradeMarketingNavigation();expect(JSON.stringify(main.rows[1].slice(0,18))).toBe(before);expect(d.rows.slice(1).map(r=>r[0])).toEqual(checks);expect(control.getRange('B7:B8').getValues()).toEqual(run);expect(props.getProperty(key)).toBe(decision);expect(d.rows[1][6]).toContain('華爾紗兩用被套');expect(main.rows[1][18]).toContain('查看2個品號');
  });
  it('replaces an old offer filter and focuses the first matching SKU for main-cell and range links',()=>{
    const {c,ss,source}=spreadsheetFixture();source.rows[1][1]='*華爾紗兩用被套85折\n*埃及棉浴巾85折\n門市：11/11 00:00 - 11/15 23:59';c.setupMarketingSync();c.syncMarketingFromPanel();c.upgradeMarketingNavigation();const main=ss.getSheetByName('活動案型'),d=ss.getSheetByName('活動商品明細');ss.setActiveSheet(main);c.showMarketingProducts();expect(d.selected).toBe(2);
    c.onSelectionChange({source:ss,range:main.getRange(3,19)});expect(ss.getActiveSheet()).toBe(d);expect(d.selected).toBe(4);expect(d.filter.criteria[8].lastCall).toEqual(['whenTextEqualTo',[main.rows[2][12]]]);
    c.onSelectionChange({source:ss,range:d.getRange(2,1,2,7)});expect(d.selected).toBe(2);expect(d.filter.criteria[8].lastCall).toEqual(['whenTextEqualTo',[main.rows[1][12]]]);
  });
  it('ordinary checkbox and name clicks do not redirect or alter the selected products',()=>{
    const {c,ss}=spreadsheetFixture();c.setupMarketingSync();c.syncMarketingFromPanel();c.upgradeMarketingNavigation();const d=ss.getSheetByName('活動商品明細');ss.setActiveSheet(d);d.selected=3;const before=JSON.stringify(d.rows);c.onSelectionChange({source:ss,range:d.getRange(2,1)});c.onSelectionChange({source:ss,range:d.getRange(2,3)});expect(d.selected).toBe(3);expect(JSON.stringify(d.rows)).toBe(before);
  });
  it('returns to the corresponding activity by stable ID after main rows are sorted',()=>{
    const {c,ss,source}=spreadsheetFixture();source.rows[1][1]='*華爾紗兩用被套85折\n*埃及棉浴巾85折\n門市：11/11 00:00 - 11/15 23:59';c.setupMarketingSync();c.syncMarketingFromPanel();c.upgradeMarketingNavigation();const main=ss.getSheetByName('活動案型'),d=ss.getSheetByName('活動商品明細');[main.rows[1],main.rows[2]]=[main.rows[2],main.rows[1]];ss.setActiveSheet(d);d.selected=2;c.returnMarketingOffer();expect(ss.getActiveSheet()).toBe(main);expect(main.selected).toBe(3);
  });
  it('rejects an inconsistent navigation version; a lottery without details stays on its source',()=>{
    const {c,ss,control,source}=spreadsheetFixture();source.rows[1][1]='*滿5000抽行李箱\n門市：11/11 00:00 - 11/15 23:59';c.setupMarketingSync();c.syncMarketingFromPanel();const g=ss.getSheetByName('排除紀錄');expect(g.rows).toHaveLength(2);expect(control.getRange('B7').getValue()).not.toBe('');
  });
  it('writes native checkbox Booleans before applying strict validation, not plain-text true/false',()=>{
    const {c,ss}=spreadsheetFixture();c.setupMarketingSync();c.syncMarketingFromPanel();const d=ss.getSheetByName('活動商品明細');expect(typeof d.rows[1][0]).toBe('boolean');expect(d.getRange(2,1).getValue()).toBe(true);
  });
  it('migrates old headers additively, syncs, confirms, rejects changed selection, preserves history and blocks failed promotion',()=>{
    const {c,ss,control,source,fail}=spreadsheetFixture(),old=ss.insertSheet('活動案型');const h=vm.runInContext('MS_TABLES["活動案型"]',c);old.rows=[Array.from(h.slice(0,-3)),offer('舊活動')];const historical=JSON.stringify(old.rows[1]);
    c.setupMarketingSync();expect(JSON.stringify(old.rows[1])).toBe(historical);expect(old.rows[0]).toHaveLength(19);
    const first=c.syncMarketingFromPanel(),run=control.getRange('B7').getValue();expect(first.counts[0]).toBe(1);expect(old.rows).toHaveLength(3);
    ss.setActiveSheet(old);old.selected=3;c.confirmMarketingProducts();expect(old.rows[2][17]).toBe('已確認');expect(c.marketingConfirmedProductsValid_(ss,'活動案型',3,old.rows[2],{fingerprint:'master'})).toBe(true);
    const detail=ss.getSheetByName('活動商品明細');expect(detail.rows[1][5]).toBe('已確認');detail.getRange(2,1).setValue(false);c.onEdit({source:ss,range:detail.getRange(2,1)});expect(old.rows[2][17]).toBe('需重新確認');expect(c.marketingConfirmedProductsValid_(ss,'活動案型',3,old.rows[2],{fingerprint:'master'})).toBe(false);
    c.confirmMarketingProducts();expect(old.rows[2][16]).toContain('已選1筆');c.syncMarketingFromPanel();expect(old.rows).toHaveLength(3);expect(control.getRange('B7').getValue()).toBe(run);
    source.rows[1][1]='*埃及棉浴巾85折\n門市：11/11 00:00 - 11/15 23:59';c.syncMarketingFromPanel();expect(old.rows).toHaveLength(4);expect(JSON.stringify(old.rows[1])).toBe(historical);expect(old.rows[2][17]).toBe('已確認');expect(old.rows[3][17]).toBe('待確認');
    const success=control.getRange('B7:B8').getValues();source.rows[1][1]='*天絲床包85折';fail();expect(()=>c.syncMarketingFromPanel()).toThrow(/injected/);expect(control.getRange('B7:B8').getValues()).toEqual(success);
  });
  it('a changed master requires a new generation and original review decisions remain intact',()=>{
    const {c,ss,control,setMaster}=spreadsheetFixture();c.setupMarketingSync();c.syncMarketingFromPanel();const oldRun=control.getRange('B7').getValue(),main=ss.getSheetByName('活動案型');ss.setActiveSheet(main);c.confirmMarketingProducts();setMaster('new-master');expect(()=>c.confirmMarketingProducts()).toThrow(/同步/);c.syncMarketingFromPanel();expect(control.getRange('B7').getValue()).not.toBe(oldRun);expect(main.rows[1][17]).toBe('已確認');expect(main.rows[2][17]).toBe('待確認');
  });
  it('restores the last successful version filter when promotion fails after writing and linking',()=>{
    const {c,ss,control,source,failPromotion}=spreadsheetFixture();c.setupMarketingSync();c.syncMarketingFromPanel();const run=control.getRange('B7').getValue();source.rows[1][1]='*埃及棉浴巾85折';failPromotion();expect(()=>c.syncMarketingFromPanel()).toThrow(/promotion failure/);expect(control.getRange('B7').getValue()).toBe(run);expect(ss.getSheetByName('活動案型').filter.criteria[14].lastCall).toEqual(['whenTextEqualTo',[run]]);
  });
  it('validation rejects unreviewed offers and accepts explicitly reviewed confirmed products without publishing',()=>{
    const {c,ss,alerts}=spreadsheetFixture();c.setupMarketingSync();c.syncMarketingFromPanel();const main=ss.getSheetByName('活動案型');ss.setActiveSheet(main);c.validateMarketingReview();expect(alerts.at(-1)).toContain('未完成');c.confirmMarketingProducts();main.getRange(2,11).setValue('已覆核');c.validateMarketingReview();expect(alerts.at(-1)).toContain('基本覆核欄位完成');expect(alerts.at(-1)).toContain('不發布');
    ss.getSheetByName('活動商品明細').getRange(2,1).setValue(false);c.validateMarketingReview();expect(alerts.at(-1)).toContain('商品集合未確認或已變動');
  });
  it('resolves a selected detail by stable offer ID and run, not a stale parent row after sorting',()=>{
    const {c,ss,source}=spreadsheetFixture();source.rows[1][1]='*華爾紗兩用被套85折\n*埃及棉浴巾85折\n門市：11/11 00:00 - 11/15 23:59';c.setupMarketingSync();c.syncMarketingFromPanel();const main=ss.getSheetByName('活動案型'),detail=ss.getSheetByName('活動商品明細');[main.rows[1],main.rows[2]]=[main.rows[2],main.rows[1]];ss.setActiveSheet(detail);detail.selected=2;expect(c.marketingSelectedOffer_(ss).row).toBe(3);c.confirmMarketingProducts();expect(main.rows[2][17]).toBe('已確認');expect(main.rows[1][17]).toBe('待確認');
  });
  it('confirms a named gift into ERP codes; manual quantity corrections are reconfirmable and SKU rewrites are blocked',()=>{
    const {c,ss,source}=spreadsheetFixture();source.rows[1][1]='*滿3500贈Sybil抱枕套乙組(不累贈)\n門市：11/11 00:00 - 11/15 23:59';c.setupMarketingSync();c.syncMarketingFromPanel();const g=ss.getSheetByName('贈品／加價購案型');ss.setActiveSheet(g);c.confirmMarketingProducts();expect(g.rows[1][11]).toBe('N1');expect(c.marketingConfirmedProductsValid_(ss,g.name,2,g.rows[1],{fingerprint:'master'})).toBe(true);
    g.getRange(2,13).setValue(2);c.onEdit({source:ss,range:g.getRange(2,13)});expect(g.rows[1][21]).toBe('需重新確認');c.confirmMarketingProducts();const displayRow=g.getRange(2,1,1,23).getDisplayValues()[0];expect(c.marketingConfirmedProductsValid_(ss,g.name,2,displayRow,{fingerprint:'master'})).toBe(true);
    g.getRange(2,12).setValue('A1');expect(()=>c.confirmMarketingProducts()).toThrow(/商品條件/);
  });
});

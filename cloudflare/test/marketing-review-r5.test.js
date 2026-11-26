import {describe,it,expect} from 'vitest';
import {runtime,spreadsheetFixture} from './helpers/marketing-runtime.js';
const add=(c,id,run,sku)=>c.addMarketingProduct(id,run,sku,'20261105-marketing-select-all-r11');
const status=(c,s)=>c.marketingCurrentOffers_(s,s.getSheetByName('同步控制台').getRange('B7').getValue());
function setup(text){const f=spreadsheetFixture();if(text)f.source.rows[1][1]=text;f.c.setupMarketingSync();f.c.syncMarketingFromPanel();return f;}
describe('r5 explicit preview, additions and partial batch result',()=>{
 it('previews the selected offer, not the current cursor at confirmation time',()=>{
  const {c,ss}=setup('*華爾紗兩用被套85折\n*埃及棉浴巾85折\n門市：11/11 00:00 - 11/15 23:59'),o=status(c,ss),p=c.loadMarketingReview('selected',c.marketingReviewId_(o[0]));
  ss.setActiveSheet(o[1].sheet);o[1].sheet.selected=o[1].row;
  const r=c.confirmMarketingReview(p.token,[p.offers[0].id]);expect(r.success).toBe(1);expect(o[0].sheet.rows[o[0].row-1][17]).toBe('已確認');expect(o[1].sheet.rows[o[1].row-1][17]).toBe('待確認');
 });
 it('shows added/removed SKUs and updates selected count without deleting candidates',()=>{
  const {c,ss}=setup(),o=status(c,ss)[0];ss.setActiveSheet(o.sheet);c.confirmMarketingProducts();const d=ss.getSheetByName('活動商品明細');d.getRange(2,1).setValue(false);c.onEdit({source:ss,range:d.getRange(2,1)});
  const p=c.loadMarketingReview('all','');expect(p.offers[0].count).toBe(2);expect(p.offers[0].selected).toBe(1);expect(p.offers[0].removed).toEqual(['A1']);expect(o.sheet.rows[1][16]).toContain('候選2筆｜已選1筆');expect(d.rows.length).toBe(3);
 });
 it('rejects edits after preview and consumes a successfully used token',()=>{
  const {c,ss}=setup(),p=c.loadMarketingReview('all',''),id=p.offers[0].id;ss.getSheetByName('活動商品明細').getRange(2,1).setValue(false);
  expect(c.confirmMarketingReview(p.token,[id]).results[0].message).toContain('預覽後');const q=c.loadMarketingReview('all','');expect(c.confirmMarketingReview(q.token,[id]).success).toBe(1);expect(c.confirmMarketingReview(q.token,[id]).failed).toBe(1);
 });
 it('reports a mixed batch per offer and never claims all completed',()=>{
  const {c,ss}=setup('*華爾紗兩用被套85折\n*不存在商品85折\n門市：11/11 00:00 - 11/15 23:59'),p=c.loadMarketingReview('all','');expect(p.offers[1].error).not.toBe('');const r=c.confirmMarketingReview(p.token,p.offers.map(x=>x.id));expect(r.success).toBe(1);expect(r.failed).toBe(1);expect(r.results[1].success).toBe(false);
 });
 it('adds a validated manual SKU without a reason, rejects duplicates and unknown SKU',()=>{
  const {c,ss}=setup('*不存在商品85折\n門市：11/11 00:00 - 11/15 23:59'),p=c.loadMarketingReview('all',''),id=p.offers[0].id;
  expect(()=>add(c,id,p.run,'')).toThrow(/品號/);expect(()=>add(c,id,p.run,'BAD')).toThrow(/查無/);
  const added=add(c,id,p.run,'a3');expect(added.name).toBe('埃及棉浴巾');expect(()=>add(c,id,p.run,'A3')).toThrow(/已有/);
  const q=c.loadMarketingReview('all','');expect(q.offers[0].selected).toBe(1);expect(q.offers[0].products[0].manual).toBe(true);expect(c.confirmMarketingReview(q.token,[id]).success).toBe(1);
 });
 it('preserves checkbox choices and sanctioned manual rows after unrelated source change',()=>{
  const {c,ss,source}=setup(),o=status(c,ss)[0],id=c.marketingReviewId_(o),run=ss.getSheetByName('同步控制台').getRange('B7').getValue();
  add(c,id,run,'A3');ss.getSheetByName('活動商品明細').getRange(2,1).setValue(false);
  source.rows[1][1]+='\n*天絲床包85折';c.syncMarketingFromPanel();const current=status(c,ss).find(x=>x.values[2].includes('華爾紗')),d=c.marketingOfferDetails_(ss,c.marketingReviewId_(current),ss.getSheetByName('同步控制台').getRange('B7').getValue());
  expect(d.find(x=>x[1]==='A1')[0]).toBe(false);expect(d.find(x=>x[1]==='A3')[3]).toContain('人工新增');expect(current.values[17]).toBe('待確認');
 });
 it('does not trust direct row edits even through the manual-add API',()=>{const {c,ss}=setup(),p=c.loadMarketingReview('all','');ss.getSheetByName('活動商品明細').rows[1][1]='A99';expect(()=>add(c,p.offers[0].id,p.run,'A3')).toThrow(/改寫/);});
 it('continues adding and confirms the refreshed set once without another load',()=>{
  const {c,ss}=setup('*不存在商品85折\n門市：11/11 00:00 - 11/15 23:59'),p=c.loadMarketingReview('all',''),id=p.offers[0].id;
  const first=add(c,id,p.run,'A1'),second=add(c,id,first.preview.run,'A2');
  expect(first.preview.offers[0].count).toBe(1);expect(second.preview.offers[0].count).toBe(2);expect(second.preview.offers[0].selected).toBe(2);
  expect(second.preview.offers[0].products.map(x=>x.sku)).toEqual(['A1','A2']);expect(second.preview.offers[0].status).toBe('需重新確認');
  expect(c.confirmMarketingReview(first.preview.token,[id]).failed).toBe(1);
  expect(c.confirmMarketingReview(second.preview.token,[id]).success).toBe(1);
  expect(ss.getSheetByName('活動案型').rows[1][17]).toBe('已確認');
 });
 it('blocks old manual windows and preserves saved rows on failed/duplicate additions',()=>{
  const {c,ss}=setup(),p=c.loadMarketingReview('all',''),id=p.offers[0].id;
  expect(()=>c.addMarketingProduct(id,p.run,'A3','舊版原因')).toThrow(/介面版本/);
  const first=add(c,id,p.run,'A3'),before=JSON.stringify(ss.getSheetByName('活動商品明細').rows);
  expect(()=>add(c,id,p.run,'A3')).toThrow(/已有/);expect(()=>add(c,id,p.run,'BAD')).toThrow(/查無/);
  expect(JSON.stringify(ss.getSheetByName('活動商品明細').rows)).toBe(before);
  expect(c.confirmMarketingReview(first.preview.token,[id]).success).toBe(1);
 });
 it('does not treat sorting the main sheet as a different activity',()=>{const {c,ss}=setup('*華爾紗兩用被套85折\n*埃及棉浴巾85折\n門市：11/11 00:00 - 11/15 23:59'),p=c.loadMarketingReview('all',''),s=ss.getSheetByName('活動案型');[s.rows[1],s.rows[2]]=[s.rows[2],s.rows[1]];const r=c.confirmMarketingReview(p.token,[p.offers[0].id]);expect(r.success).toBe(1);expect(s.rows[2][17]).toBe('已確認');});
});
describe('scope exceptions and precise matching',()=>{
 it('does not create candidate lists for all-store discounts/coupons/thresholds',()=>{const c=runtime();for(const text of ['全館85折','全館折價券300元','滿3500折300','滿3件享85折']){const f=setup('*'+text+'\n門市：11/1 00:00 - 11/30 23:59');expect(f.ss.getSheetByName('活動商品明細').getLastRow()).toBe(1);const o=status(f.c,f.ss)[0];expect(f.c.marketingConfirmedProductsValid_(f.ss,o.sheet.name,o.row,o.values,{fingerprint:'master'})).toBe(true);}expect(c.marketingWholeStoreOffer_(['折扣','','天絲滿3500折300'])).toBe(false);});
 it('retains category discounts despite a negative stacking clause',()=>{const {c,ss}=setup('*華爾紗兩用被套85折（不同享全館折扣）\n門市：11/1 00:00 - 11/30 23:59');expect(ss.getSheetByName('活動商品明細').getLastRow()).toBeGreaterThan(1);});
 it('excludes pure lottery but retains a real gift in a combined offer',()=>{const {ss}=setup('*滿5000抽Acer行李箱\n*滿3500贈Sybil抱枕套乙組，另享抽獎\n門市：11/1 00:00 - 11/30 23:59');expect(ss.getSheetByName('排除紀錄').getLastRow()).toBe(2);expect(ss.getSheetByName('贈品／加價購案型').getLastRow()).toBe(2);expect(ss.getSheetByName('活動商品明細').rows[1][1]).toBe('N1');});
 it('rejects pillowcases, gift aliases and O bundles in pillow-only matching',()=>{const c=runtime(),p=c.marketingMasterRows_([['貨號','品名'],['P1','日好眠枕'],['P2','日好眠枕套'],['O1','日好眠枕組合'],['N1','贈品-日好眠枕']]);const r=['折扣','','日好眠枕 - $1680'];expect(c.marketingProductCandidates_(r,p,false).candidates.map(x=>x.product.sku)).toEqual(['P1']);});
});
describe('verified monthly carry',()=>{
 function prior(){const f=spreadsheetFixture();f.control.getRange('B4').setValue(10);f.source.rows=[['分類','10月','11月'],['常態','⚠ 排除特賣品\n*滿3500贈Sybil抱枕套乙組(不累贈)\n門市限定\n門市：10/1 00:00 - 10/31 23:59','⚠ 排除特賣品\n*滿3500贈Sybil抱枕套乙組(不累贈)\n門市限定']];f.c.setupMarketingSync();f.c.syncMarketingFromPanel();const s=f.ss.getSheetByName('贈品／加價購案型');f.ss.setActiveSheet(s);f.c.confirmMarketingProducts();s.getRange(2,11).setValue('已覆核');return f;}
 it('carries only verified identical prior-month gifts and bounds dates to this month',()=>{const {c,ss,control}=prior();control.getRange('B4').setValue(11);c.syncMarketingFromPanel();const o=status(c,ss)[0];expect(o.values[3]).toBe('2026-11-01 00:00');expect(o.values[4]).toBe('2026-11-30 23:59');expect(o.values[10]).toBe('已覆核');expect(o.values[21]).toBe('已確認・沿用上月');expect(c.marketingConfirmedProductsValid_(ss,o.sheet.name,o.row,o.values,{fingerprint:'master'})).toBe(true);});
 it('does not carry changed thresholds, unreviewed source conditions or a changed master',()=>{for(const kind of ['threshold','unreviewed','master']){const f=prior();if(kind==='threshold')f.source.rows[1][2]=f.source.rows[1][2].replace('3500','4500');if(kind==='unreviewed')f.ss.getSheetByName('贈品／加價購案型').getRange(2,11).setValue('待覆核');if(kind==='master')f.setMaster('changed');f.control.getRange('B4').setValue(11);f.c.syncMarketingFromPanel();expect(status(f.c,f.ss)[0].values[21]).not.toContain('沿用');}});
});

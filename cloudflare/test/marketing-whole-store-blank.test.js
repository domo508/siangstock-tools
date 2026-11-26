import {describe,it,expect} from 'vitest';
import {spreadsheetFixture} from './helpers/marketing-runtime.js';
const V='20261105-marketing-select-all-r11';
function setup(){const f=spreadsheetFixture();f.source.rows[1][1]='⚠ 排除特賣品\n*全館85折\n*滿3500折300\n*滿3件享85折\n*華爾紗兩用被套85折\n*全館滿3500贈Sybil抱枕套乙組（不累贈）\n門市：11/11 00:00 - 11/15 23:59';f.c.setupMarketingSync();f.c.syncMarketingFromPanel();return f;}
describe('whole-store offers have no product list entry',()=>{
 it('leaves summary and detail-link cells blank while retaining category and gift candidates',()=>{
  const {c,ss}=setup(),main=ss.getSheetByName('活動案型');
  for(const r of main.rows.slice(1,4)){expect(r[16]).toBe('');expect(r[18]).toBe('');expect(r[10]).toBe('待覆核');}
  expect(main.rows[4][16]).toContain('候選2');expect(main.rows[4][18]).toContain('查看2個');
  const gift=ss.getSheetByName('贈品／加價購案型');expect(gift.rows[1][20]).toContain('候選1');expect(gift.rows[1][22]).toContain('查看1個');
 });
 it('navigation refresh clears old whole-store links without changing activities, decisions or generation',()=>{
  const {c,ss,control,props}=setup(),main=ss.getSheetByName('活動案型');
  main.getRange(2,17).setValue('全館優惠，不需逐品號確認');main.getRange(2,19).setValue('查看0個品號');
  const before=main.rows.slice(1).map(r=>JSON.stringify(r.slice(0,16))),run=control.getRange('B7:B8').getValues(),snapshots=[...propsKeys(props,c,ss)];
  c.upgradeMarketingNavigation();expect(main.rows[1][16]).toBe('');expect(main.rows[1][18]).toBe('');
  expect(main.rows.slice(1).map(r=>JSON.stringify(r.slice(0,16)))).toEqual(before);expect(control.getRange('B7:B8').getValues()).toEqual(run);expect(propsKeys(props,c,ss)).toEqual(snapshots);
 });
 it('clicking blank whole-store cells does not navigate, while a category link still navigates',()=>{
  const {c,ss}=setup(),main=ss.getSheetByName('活動案型');c.upgradeMarketingNavigation();ss.setActiveSheet(main);
  c.onSelectionChange({source:ss,range:main.getRange(2,19)});expect(ss.getActiveSheet()).toBe(main);
  c.onSelectionChange({source:ss,range:main.getRange(5,19)});expect(ss.getActiveSheet().getName()).toBe('活動商品明細');
 });
 it('whole-store offers can still complete unified review once, without creating product demand',()=>{
  const {c,ss}=setup();c.upgradeMarketingUnifiedReview();const p=c.loadMarketingReview('all','',V),o=p.offers[0];
  expect(o.noProductList).toBe(true);expect(o.products).toEqual([]);expect(o.count).toBe(0);
  const result=c.confirmMarketingReview(p.token,[o.id],V);expect(result.success).toBe(1);
  const main=ss.getSheetByName('活動案型');expect(main.rows[1][10]).toBe('已覆核');expect(main.rows[1][16]).toBe('');expect(main.rows[1][18]).toBe('');
 });
 it('a successful new sync promotes the matching navigation version, not an obsolete B14',()=>{
  const {c,ss,control,source}=setup();control.getRange('B14').setValue('20261029-marketing-navigation-r1');source.rows[1][1]+='\n*埃及棉浴巾85折';c.syncMarketingFromPanel();
  expect(control.getRange('B14').getValue()).toBe('20261105-marketing-batch-nav-r3');
  const main=ss.getSheetByName('活動案型'),run=control.getRange('B7').getValue(),o=c.marketingCurrentOffers_(ss,run).find(o=>o.values[2].startsWith('華爾紗'));
  c.openMarketingProducts_(ss,o);expect(ss.getActiveSheet().getName()).toBe('活動商品明細');
 });
});
function propsKeys(props,c,ss){const run=ss.getSheetByName('同步控制台').getRange('B7').getValue();return c.marketingCurrentOffers_(ss,run).map(o=>props.getProperty(c.marketingProductKey_(run,c.marketingReviewId_(o))));}

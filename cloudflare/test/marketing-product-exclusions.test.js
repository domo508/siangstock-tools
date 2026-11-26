import {describe,it,expect} from 'vitest';
import {runtime,spreadsheetFixture} from './helpers/marketing-runtime.js';
import crypto from 'node:crypto';
const version='20261105-marketing-select-all-r11';
describe('activity hard product exclusions',()=>{
 it('normalizes the four prefixes without excluding embedded or other O/S prefixes',()=>{
  const c=runtime();for(const sku of ['SA001','sb001',' ＯＡ００１ ','OB1'])expect(c.marketingProductExclusion_({sku})).toContain('客製');
  for(const sku of ['XSA001','OC001','S001','O001'])expect(c.marketingProductExclusion_({sku})).toBe('');
 });
 it('accepts explicit off-shelf flags, not negative flags or blank status',()=>{
  const c=runtime();for(const off of [true,1,'是',' TRUE ','已下架','Yes'])expect(c.marketingProductExclusion_({off})).toContain('下架');
  for(const off of [false,0,'否','false','未下架','','不是'])expect(c.marketingProductExclusion_({off,status:''})).toBe('');
 });
 it('does not guess that normal three-dimensional merchandise is custom',()=>{
  const c=runtime();expect(c.marketingProductExclusion_({name:'枕頭 60×40×12cm'})).toBe('');
  expect(c.marketingProductExclusion_({name:'訂製床包 153×191×32cm'})).toContain('訂製');
 });
 it('excludes confirmed special IDs and master-labelled nonstandard bedding, not all C products',()=>{
  const c=runtime();for(const sku of ['C41879','C41888','C41889','C41891','C41892','C41894','C41899','C41904','C41909','C41910','C41918','C41921','C41922'])expect(c.marketingProductExclusion_({sku,name:'合成商品'})).toContain('特殊規格');
  expect(c.marketingProductExclusion_({sku:'C00001',name:'合成床包123×187×38cm',size:'其它尺寸'})).toContain('疑似客製');
  expect(c.marketingProductExclusion_({sku:'C00001',name:'合成5尺床包'})).toBe('');
  expect(c.marketingProductExclusion_({sku:'C00002',name:'枕頭60×40×12cm',size:'其它尺寸'})).toBe('');
  expect(c.marketingProductExclusion_({sku:'C00003',name:'床包152×188×35cm',size:'5尺'})).toBe('');
 });
 it('omits excluded products for fuzzy and precise gift matching, preserving normal merchandise and master rows',()=>{
  const c=runtime(),p=c.marketingMasterRows_([['貨號','品名','已下架'],['A1','天絲床包','否'],['SA1','天絲床包','否'],['SB1','天絲床包','否'],['OA1','天絲床包','否'],['OB1','天絲床包','否'],['A2','天絲床包','是'],['A3','客製天絲床包','否']]),before=JSON.stringify(p);
  expect(c.marketingProductCandidates_(['折扣','','天絲床包85折'],p,false).candidates.map(x=>x.product.sku)).toEqual(['A1']);
  const row=['贈品','','天絲床包'];row[11]='A1、SA1、A2、N404';
  const out=c.marketingProductCandidates_(row,p,true);expect(out.candidates.map(x=>x.product.sku)).toEqual(['A1','N404']);expect(out.candidates[1].missing).toBe(true);expect(JSON.stringify(p)).toBe(before);
 });
 it('blocks manual additions without any detail writes',()=>{
  const {c,ss}=spreadsheetFixture();c.setupMarketingSync();c.syncMarketingFromPanel();
  const p=c.loadMarketingReview('all',''),read=c.readMarketingMaster_,base=read();
  for(const product of [{sku:'SA1',name:'床包'},{sku:'Q1',name:'床包',off:'是'},{sku:'Q2',name:'客製床包'}]){
   c.readMarketingMaster_=()=>({...base,products:[...base.products,product]});
   const before=JSON.stringify(ss.getSheetByName('活動商品明細').rows);
   expect(()=>c.addMarketingProduct(p.offers[0].id,p.run,product.sku,version)).toThrow(/不列活動商品/);
   expect(JSON.stringify(ss.getSheetByName('活動商品明細').rows)).toBe(before);
  }
 });
 it('blocks stale selected off-shelf merchandise in previews and direct confirmation',()=>{
  const {c,ss}=spreadsheetFixture();c.setupMarketingSync();c.syncMarketingFromPanel();
  const base=c.readMarketingMaster_();c.readMarketingMaster_=()=>({...base,products:base.products.map(p=>p.sku==='A1'?{...p,off:'是'}:p)});
  expect(c.loadMarketingReview('all','').offers[0].error).toContain('A1：商品主檔已下架');
  const o=c.marketingCurrentOffers_(ss,ss.getSheetByName('同步控制台').getRange('B7').getValue())[0];
  expect(()=>c.commitMarketingOffer_(ss,o,c.readMarketingMaster_())).toThrow(/不列活動商品/);
 });
 it('policy refresh creates a filtered generation without deleting history or resetting normal choices',()=>{
  const f=spreadsheetFixture(),{c,ss,control}=f,base=c.readMarketingMaster_();
  c.readMarketingMaster_=()=>({...base,products:[...base.products,{sku:'C41899',name:'合成特殊床包',search:'合成特殊床包'}]});
  const exclusion=c.marketingProductExclusion_;c.marketingProductExclusion_=()=>'';
  c.setupMarketingSync();c.syncMarketingFromPanel();let p=c.loadMarketingReview('all','');c.addMarketingProduct(p.offers[0].id,p.run,'C41899',version);
  const detail=ss.getSheetByName('活動商品明細');detail.getRange(2,1).setValue(false);const prior=JSON.stringify(detail.rows),run=control.getRange('B7').getValue();
  // Emulate the deployed r7 root hash; detail/snapshot hashes intentionally remain compatible.
  const source=c.readMarketingSource_(ss,control),old=crypto.createHash('sha256').update(JSON.stringify({parser:'20261104-marketing-review-r5',source:{source,master:base.fingerprint}})).digest('hex');control.getRange('B8').setValue(old);
  c.marketingProductExclusion_=exclusion;c.syncMarketingFromPanel();
  expect(control.getRange('B7').getValue()).not.toBe(run);
  expect(JSON.stringify(detail.rows.slice(0,JSON.parse(prior).length))).toBe(prior);
  const current=c.marketingOfferDetails_(ss,p.offers[0].id,control.getRange('B7').getValue());
  expect(current.some(x=>x[1]==='C41899')).toBe(false);expect(current.find(x=>x[1]==='A1')[0]).toBe(false);expect(current.find(x=>x[1]==='A2')[0]).toBe(true);
 });
});

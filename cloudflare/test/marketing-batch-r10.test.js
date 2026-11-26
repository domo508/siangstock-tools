import {it,expect} from 'vitest';
import {spreadsheetFixture,runtime} from './helpers/marketing-runtime.js';
const V='20261105-marketing-select-all-r11';
function setup(){const f=spreadsheetFixture();f.source.rows[1][1]='⚠ 排除特賣品\n*不存在商品85折\n*華爾紗兩用被套85折\n*埃及棉浴巾85折\n門市：11/11 00:00 - 11/15 23:59';f.c.setupMarketingSync();f.c.syncMarketingFromPanel();f.c.upgradeMarketingUnifiedReview();return f;}
function current(f){const run=f.control.getRange('B7').getValue();return {run,offers:f.c.marketingCurrentOffers_(f.ss,run)};}
it('recognizes embedded all-store discounts but not exclusion clauses or product-scoped coupons',()=>{
 const c=runtime();for(const text of ['11/11 最強購物節 全館85折(每人限用一次)','11/18 會員日 滿$1500 全館9折','11/25 商城狂購節 滿$1500 全館92折','全館85折（限定商品除外）'])expect(c.marketingWholeStoreOffer_(['優惠',text,text])).toBe(true);
 for(const text of ['華爾紗85折（不同享全館折扣）','天絲優惠（全館活動除外）','排除全館優惠，床包85折'])expect(c.marketingWholeStoreOffer_(['優惠',text,text])).toBe(false);
 expect(c.marketingWholeStoreOffer_(['折扣碼','11月會員折扣碼 VIP300','折扣碼：VIP300'])).toBe(true);
 for(const text of ['天絲床包折扣碼','日好眠枕折扣碼','品號：A102067折扣碼'])expect(c.marketingWholeStoreOffer_(['折扣碼',text,text])).toBe(false);
});
it('a manual batch refreshes usable confirmation tokens for untouched cards too',()=>{
 const f=setup(),{run,offers}=current(f),id=f.c.marketingReviewId_(offers[0]);f.c.loadMarketingReview('all','',V);
 const r=f.c.addMarketingProducts(id,run,['A1'],V),result=f.c.confirmMarketingReview(r.preview.token,offers.map(o=>f.c.marketingReviewId_(o)),V);expect(result.failed).toBe(0);expect(result.success).toBe(3);
});
it('name-search pagination is bounded and deterministic; empty and oversized requests fail',()=>{
 const f=setup(),{run,offers}=current(f),id=f.c.marketingReviewId_(offers[0]),base=f.c.readMarketingMaster_(),products=Array.from({length:101},(_,i)=>({sku:'P'+String(i).padStart(3,'0'),name:'合成測試枕墊',size:'標準'}));f.c.readMarketingMaster_=()=>({...base,products});
 const a=f.c.searchMarketingProducts(id,run,'測試 枕墊','name',0,V),b=f.c.searchMarketingProducts(id,run,'測試 枕墊','name',50,V);expect(a.rows).toHaveLength(50);expect(b.rows[0].sku).toBe('P050');expect(a.hasMore).toBe(true);
 expect(()=>f.c.searchMarketingProducts(id,run,'枕','name',0,V)).toThrow(/2個/);expect(()=>f.c.addMarketingProducts(id,run,[...products.map(p=>p.sku),'EXTRA'],V)).toThrow(/主檔/);
});
it('retains non-contiguous manual rows across sync and then supports another add plus complete review',()=>{
 const f=setup(),old=current(f),id=f.c.marketingReviewId_(old.offers[0]);f.c.addMarketingProducts(id,old.run,['A1','A3'],V);
 f.ss.getSheetByName('活動商品明細').getRange(3,1).setValue(false);f.source.rows[1][1]+='\n*滿3500折300';f.c.syncMarketingFromPanel();
 const next=current(f),o=next.offers.find(o=>f.c.marketingReviewId_(o)===id),d=f.c.marketingOfferDetails_(f.ss,id,next.run);
 expect(d.filter(r=>String(r[3]).startsWith('人工新增：'))).toHaveLength(2);expect(d.every(r=>r[11]===o.row)).toBe(true);
 const all=f.c.loadMarketingReview('all','',V);expect(all.offers.some(o=>/改寫|刪除/.test(o.error))).toBe(false);
 const added=f.c.addMarketingProduct(id,next.run,'A2',V);expect(added.preview.offers[0].selected).toBe(3);expect(f.c.confirmMarketingReview(added.preview.token,[id],V).success).toBe(1);
 for(const offer of next.offers){const ds=f.c.marketingOfferDetails_(f.ss,f.c.marketingReviewId_(offer),next.run);expect(ds.every(r=>r[11]===offer.row)).toBe(true);}
});
it('repairs only trusted r9 parent-column drift and refuses any other mutation without writes',()=>{
 for(const corrupt of [false,true]){const f=setup(),{run,offers}=current(f),o=offers[0],id=f.c.marketingReviewId_(o);f.c.addMarketingProducts(id,run,['A1','A2'],V);
  f.control.getRange('B15').setValue(['20261105','whole-store-blank','r9'].join('-'));f.c.latestMarketingMaster_=()=>({identity:'master'});
  const s=f.ss.getSheetByName('活動商品明細');s.rows.slice(1).forEach(r=>r[11]+=7);if(corrupt)s.rows[1][2]='擅改商品名稱';const before=JSON.stringify(s.rows),props=f.props.getProperty(f.c.marketingProductKey_(run,id));
  if(corrupt){expect(()=>f.c.repairMarketingDetailMapping()).toThrow(/非單純/);expect(JSON.stringify(s.rows)).toBe(before);}else{const r=f.c.repairMarketingDetailMapping();expect(r.repaired).toBe(s.rows.length-1);expect(r.conservation).toBe(true);expect(f.props.getProperty(f.c.marketingProductKey_(run,id))).toBe(props);}
 }
});
it('searches names or exact multi-SKUs; marks duplicates, exclusions and missing without writes',()=>{
 const f=setup(),{run,offers}=current(f),id=f.c.marketingReviewId_(offers[0]),before=JSON.stringify(f.ss.getSheetByName('活動商品明細').rows);
 const r=f.c.searchMarketingProducts(id,run,'華爾紗 被套','name',0,V);expect(r.rows.map(r=>r.sku)).toEqual(['A1','A2']);expect(r.rows.every(r=>r.available)).toBe(true);
 const q=f.c.searchMarketingProducts(id,run,'A1,A1,A5,BAD','sku',0,V);expect(q.total).toBe(3);expect(q.rows.find(p=>p.sku==='A5').reason).toContain('下架');expect(q.rows.find(p=>p.sku==='BAD').available).toBe(false);expect(JSON.stringify(f.ss.getSheetByName('活動商品明細').rows)).toBe(before);
 f.c.addMarketingProducts(id,run,['A1','A2','A1'],V);expect(f.c.searchMarketingProducts(id,run,'A1','sku',0,V).rows[0].existing).toBe(true);
});
it('preflights a complete batch, skips existing without changing selection, and preserves protections',()=>{
 const f=setup(),{run,offers}=current(f),id=f.c.marketingReviewId_(offers[0]),s=f.ss.getSheetByName('活動商品明細'),before=JSON.stringify(s.rows);
 expect(()=>f.c.addMarketingProducts(id,run,['A1','A5'],V)).toThrow(/下架/);expect(JSON.stringify(s.rows)).toBe(before);
 expect(()=>f.c.addMarketingProducts(id,run,['A1','BAD'],V)).toThrow(/查無/);expect(JSON.stringify(s.rows)).toBe(before);
 const r=f.c.addMarketingProducts(id,run,['A1','A2','A1'],V);expect(r.addedCount).toBe(2);s.rows.find(r=>r[1]==='A1'&&r[7]===id)[0]=false;
 const repeat=f.c.addMarketingProducts(id,run,['A1','A2'],V);expect(repeat.addedCount).toBe(0);expect(repeat.alreadyCount).toBe(2);expect(s.rows.find(r=>r[1]==='A1'&&r[7]===id)[0]).toBe(false);
 expect(()=>f.c.addMarketingProducts(id,run,['A3'],'old')).toThrow(/版本/);expect(()=>f.c.addMarketingProducts(id,'old',['A3'],V)).toThrow(/版本/);
 s.rows.find(r=>r[7]===id)[2]='污染';expect(()=>f.c.addMarketingProducts(id,run,['A3'],V)).toThrow(/改寫/);
});

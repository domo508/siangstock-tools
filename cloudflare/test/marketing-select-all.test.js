import {it,expect} from 'vitest';
import {spreadsheetFixture} from './helpers/marketing-runtime.js';
const V='20261105-marketing-select-all-r11';
function setup(){const f=spreadsheetFixture();f.source.rows[1][1]='⚠ 排除特賣品\n*不存在商品85折\n門市：11/11 00:00 - 11/15 23:59';f.c.setupMarketingSync();f.c.syncMarketingFromPanel();f.c.upgradeMarketingUnifiedReview();const run=f.control.getRange('B7').getValue(),offer=f.c.marketingCurrentOffers_(f.ss,run)[0],id=f.c.marketingReviewId_(offer);return {...f,run,offer,id};}
it('selects all eligible matches across pages, with disjoint skip counts and no sheet writes',()=>{
 const f=setup(),base=f.c.readMarketingMaster_(),items=Array.from({length:1205},(_,i)=>({sku:'P'+String(i).padStart(4,'0'),name:'測試大類 枕墊 '+i,size:'標準'}));items[1].sku='SA0001';items[2].off=true;
 f.c.readMarketingMaster_=()=>({...base,products:[...base.products,...items]});
 f.c.addMarketingProducts(f.id,f.run,['P0000'],V);const s=f.ss.getSheetByName('活動商品明細'),before=JSON.stringify(s.rows);
 const page=f.c.searchMarketingProducts(f.id,f.run,'測試大類','name',0,V),all=f.c.searchMarketingProducts(f.id,f.run,'測試大類','name',50,V,true);
 expect(page.rows).toHaveLength(50);expect(page).not.toHaveProperty('eligibleSkus');expect(all.rows).toHaveLength(50);expect(all.eligibleSkus).toHaveLength(1202);expect(all.counts).toEqual({available:1202,existing:1,excluded:2,missing:0});expect(all.eligibleSkus).not.toContain('SA0001');expect(all.eligibleSkus).not.toContain('P0000');expect(JSON.stringify(s.rows)).toBe(before);
 const r=f.c.addMarketingProducts(f.id,f.run,all.eligibleSkus,V);expect(r.addedCount).toBe(1202);expect(r.preview.offers[0].selected).toBe(1203);expect(f.c.marketingOfferDetails_(f.ss,f.id,f.run).every(r=>r[11]===f.offer.row)).toBe(true);expect(f.offer.sheet.getRange(f.offer.row,11).getValue()).toBe('待覆核');
 const again=f.c.searchMarketingProducts(f.id,f.run,'測試大類','name',0,V,true);expect(again.eligibleSkus).toEqual([]);expect(again.counts.existing).toBe(1203);expect(again.counts.excluded).toBe(2);
 expect(f.c.confirmMarketingReview(r.preview.token,[f.id],V).success).toBe(1);
});
it('all-results selection preserves version, run, query, and immutable-detail protection',()=>{
 const f=setup(),s=f.ss.getSheetByName('活動商品明細'),before=JSON.stringify(s.rows);
 expect(()=>f.c.searchMarketingProducts(f.id,f.run,'華爾紗','name',0,'old',true)).toThrow(/版本/);
 expect(()=>f.c.searchMarketingProducts(f.id,'old','華爾紗','name',0,V,true)).toThrow(/版本/);
 expect(()=>f.c.searchMarketingProducts(f.id,f.run,'','name',0,V,true)).toThrow(/內容/);
 expect(()=>f.c.searchMarketingProducts(f.id,f.run,'華爾紗','name',0,V,'yes')).toThrow(/內容/);
 expect(JSON.stringify(s.rows)).toBe(before);s.rows[1][2]='遭修改';expect(()=>f.c.searchMarketingProducts(f.id,f.run,'華爾紗','name',0,V,true)).toThrow(/不一致/);
});
it('round-trips large confirmed selections within Google property byte limits and rejects missing or altered chunks',()=>{
 const f=setup(),key=f.c.marketingProductKey_(f.run,f.id),snapshot={confirmedSkus:Array.from({length:1500},(_,i)=>'SKU'+i),note:'測試'.repeat(5000)};
 f.c.marketingSaveSnapshot_(key,snapshot);expect(f.c.marketingReadSnapshot_(key)).toEqual(snapshot);expect(Object.values(f.props.getProperties()).every(v=>Buffer.byteLength(v,'utf8')<=9*1024)).toBe(true);
 const marker=JSON.parse(f.props.getProperty(key)),first=marker.prefix+'0',original=f.props.getProperty(first);f.props.setProperty(first,'遭改寫');expect(()=>f.c.marketingReadSnapshot_(key)).toThrow(/不一致/);f.props.setProperty(first,original);f.props.deleteProperty(first);expect(()=>f.c.marketingReadSnapshot_(key)).toThrow(/不完整/);f.props.setProperty(first,original);
 f.c.marketingSaveSnapshot_(key,{count:3});expect(f.c.marketingReadSnapshot_(key)).toEqual({count:3});expect(Object.keys(f.props.getProperties()).some(k=>k.startsWith(marker.prefix))).toBe(false);
});
it('failed chunk or root publication leaves the prior trusted snapshot readable',()=>{
 for(const failRoot of [false,true]){const f=setup(),key=f.c.marketingProductKey_(f.run,f.id),prior={count:7};f.c.marketingSaveSnapshot_(key,prior);const original=f.props.setProperty;
  f.props.setProperty=(k,v)=>{if((failRoot&&k===key)||(!failRoot&&k.endsWith(':1')))throw new Error('injected quota failure');return original(k,v);};
  expect(()=>f.c.marketingSaveSnapshot_(key,{confirmedSkus:Array.from({length:1500},(_,i)=>'SKU'+i)})).toThrow(/quota/);expect(f.c.marketingReadSnapshot_(key)).toEqual(prior);expect(Object.keys(f.props.getProperties()).some(k=>k.startsWith(key+':parts:'))).toBe(false);
 }
});

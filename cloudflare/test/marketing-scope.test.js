import {it,expect} from 'vitest';
import {runtime} from './helpers/marketing-runtime.js';
import {marketingScopeAnalyze_,marketingScopeApply_,marketingScopeProduct_} from '../../procurement-planning/marketing-sync/ScopeRules.js';
const evidence='冬季被胎（羊毛、石墨烯、鴨絨、鵝絨）9折\n商品名稱：示範純羊毛冬被';
const variant={name:'冬季被胎9折',type:'折扣／商品優惠',content:evidence,start:'',end:'',channel:'門市',stores:'全部門市',exclusions:'',restrictions:'',quantity:'',threshold:'',relationship:'',mode:'keywords',series:'',skus:[],queries:[['示範純羊毛冬被']],needsConfirmation:false,questions:[]};
const p=(sku,name,category='被胎')=>({sku,name,category,search:name,off:'否',status:''});
it('supplemental single names preserve all enumerated materials, irrespective of AI narrowing',()=>{
 const r=marketingScopeApply_(evidence,variant);expect(r.queries).toEqual([['羊毛'],['石墨烯'],['鴨絨'],['鵝絨']]);expect(variant.queries).toEqual([['示範純羊毛冬被']]);
 expect(marketingScopeApply_(evidence,{...variant,skus:['DEMO1'],mode:'sku',series:'示範'})).toMatchObject({skus:[],series:'',mode:'keywords'});
});
it.each(['商品名稱：僅限示範純羊毛冬被','僅限以下商品：示範純羊毛冬被','實際參加品號：DEMO1','實際納入商品：DEMO1｜示範冬被','以下以參加名單為準'])('preserves explicit final narrowing: %s',line=>{
 const text=evidence.split('\n')[0]+'\n'+line;expect(marketingScopeAnalyze_(text)).toBeNull();expect(marketingScopeApply_(text,variant).queries).toEqual(variant.queries);
});
it('does not expand gifts from qualifying purchases or mix unrelated exclusions and activity notes',()=>{
 expect(marketingScopeApply_(evidence,{...variant,type:'滿額／滿件贈',skus:['GIFT1'],mode:'sku'}).skus).toEqual(['GIFT1']);
 expect(marketingScopeAnalyze_('冬季被胎9折\n排除：羊毛、鴨絨\n商品名稱：示範羊毛冬被')).toBeNull();
 expect(marketingScopeAnalyze_('天絲、純棉新品床寢9折')).toBeNull();expect(marketingScopeAnalyze_('天絲、純棉床寢出清')).toBeNull();
});
it('shared product-category AND guard rejects wrong categories and summer items while retaining uncertain candidates',()=>{
 const s=marketingScopeAnalyze_(evidence);
 for(const item of [p('1','羊毛冬被外袋','輔料'),p('2','羊毛床褥墊','床墊'),p('3','鵝絨枕','枕頭'),p('4','鵝絨夏季被'),p('5','鵝絨夏季涼被'),p('6','鵝絨四季被')])expect(marketingScopeProduct_(item,s).eligible).toBe(false);
 expect(marketingScopeProduct_(p('7','鴨絨冬被'),s)).toMatchObject({eligible:true,uncertain:false});
 expect(marketingScopeProduct_(p('8','石墨烯機能被'),s)).toMatchObject({eligible:true,uncertain:true});
 expect(marketingScopeProduct_(p('9','石墨烯被(大量採購用)'),s)).toMatchObject({eligible:true,uncertain:true});
});
it('pure Apps Script validation and matching use the same guards; explicit restrictions and gift roles remain unchanged',()=>{
 const c=runtime(),source={year:2026,month:12,cells:[{ref:'B2',raw:evidence,sheet:'26來源'}]},a=c.marketingWorkflowValidate_(source,{activities:[{cell:'B2',evidence,support:[],variants:[variant]}],context:[]})[0];
 const products=[p('W','示範純羊毛冬被'),p('G','石墨烯機能被'),p('D','鴨絨冬被'),p('H','鵝絨冬被'),p('S','鵝絨夏季被'),p('P','鵝絨枕','枕頭'),p('OFF','羊毛冬被')];products.at(-1).off='是';
 const m=c.marketingWorkflowCandidates_(a.variants[0],products);expect(m.candidates.map(x=>x.product.sku)).toEqual(['W','G','D','H']);expect(m.candidates.find(x=>x.product.sku==='G').include).toBe(false);
 expect(m.candidates.filter(x=>x.include).map(x=>x.product.sku)).toEqual(['W','D','H']);
});
it('applies material OR plus fitted-sheet / bedding categories without dropping unrelated product constraints',()=>{
 const scoped=marketingScopeAnalyze_('純棉、天絲床包9折\n補充品名：示範純棉床包');expect(scoped.kind).toBe('fitted-sheet');
 expect(marketingScopeProduct_(p('1','天絲床包','床包'),scoped).eligible).toBe(true);expect(marketingScopeProduct_(p('2','天絲枕套','枕套'),scoped).eligible).toBe(false);
 expect(marketingScopeAnalyze_('商品名稱：純棉、天絲冬被')).toBeNull();
});
it('generated Apps Script copy remains byte-equivalent to the canonical shared rules',()=>{
 return import('node:fs').then(fs=>{const js=fs.readFileSync(new URL('../../procurement-planning/marketing-sync/ScopeRules.js',import.meta.url),'utf8'),gs=fs.readFileSync(new URL('../../procurement-planning/marketing-sync/ScopeRules.gs',import.meta.url),'utf8');expect(gs).toBe(js.replaceAll('export ',''));});
});
it('preserves separately enumerated nested material names and exact material exclusions',()=>{
 const scope=marketingScopeAnalyze_('純棉、精梳純棉、天絲床包9折\n不含精梳純棉');expect(scope.materials).toEqual(['純棉','精梳純棉','天絲']);expect(scope.excludedMaterials).toEqual(['精梳純棉']);
 expect(marketingScopeProduct_(p('1','純棉床包','床包'),scope).eligible).toBe(true);expect(marketingScopeProduct_(p('2','精梳純棉床包','床包'),scope).eligible).toBe(false);
});
it('OR expansion never removes explicit exclusions or silently preselects unresolved constraints',()=>{
 const v=marketingScopeApply_(evidence+'\n排除：鴨絨',variant);expect(v.needsConfirmation).toBe(true);expect(marketingScopeProduct_(p('1','鴨絨冬被'),v.scopeGuard).eligible).toBe(false);expect(marketingScopeProduct_(p('2','羊毛冬被'),v.scopeGuard).eligible).toBe(true);
});

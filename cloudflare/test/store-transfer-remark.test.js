import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {beforeAll,describe,it,expect} from 'vitest';
let core,parser,XLSX;
beforeAll(async()=>{
 await import('../../store-transfer/core.js');await import('../../procurement-planning/core.js');core=globalThis.StoreTransferCore;parser=globalThis.ProcurementPlanningCore;
 const c={};vm.createContext(c);vm.runInContext(readFileSync('../inventory/assets/xlsx.full.min.js','utf8'),c);XLSX=c.XLSX;
});
function report(note='',orderNote='',{column=65,missing=false,duplicate=false}={}){
 const headers=['銷別','開單倉編號','出貨倉編號','來源單號','取貨單號','結帳時間','貨號','銷售量','扣庫量','實收金額'];
 if(!missing)headers[column]='備註';
 const order=['訂貨','R00','R00','S-1','','2026-11-09 10:00:00','A001',42,0,4200];if(!missing)order[column]=orderNote;
 const pickup=['取貨','R00','T00','S-1','PU-1','2026-11-09 10:01:00','A001',42,42,4200];if(!missing)pickup[column]=note;
 const sheet=XLSX.utils.aoa_to_sheet([headers,order,pickup,...(duplicate?[pickup]:[])]),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'工作表1');
 // True XLSX bytes and the exact production read options used by workbook().
 const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
 const reread=XLSX.read(bytes,{type:'array',cellDates:true,cellStyles:false,dense:true,nodim:true});
 return parser.parseSalesWorkbook(reread,XLSX,{fileName:'合成銷售.xlsx'});
}
function input(sales){return {storeCodes:['R00'],proposalDate:'2026-11-09',approvalDate:'2026-11-10',master:{bySku:new Map([['A001',{sku:'A001',name:'一般商品'}]])},inventory:{records:[{warehouseCode:'T00',sku:'A001',quantity:1000}]},transfer:{records:[]},sales:[sales]};}
function run(r){return core.buildSuggestions(input(r));}
describe('備註開頭@與週補貨需求',()=>{
 for(const column of [65,80])it(`真實格式備註在${column}欄仍解析，訂貨取貨只認一次`,()=>{
  const r=report('一般備註','',{column,duplicate:true});expect(r.hasRemarkColumn).toBe(true);expect(r.takeRecords[0].remark).toBe('一般備註');
  const result=run(r),row=result.regularRows[0];expect(row.localSales42).toBe(0);expect(row.warehouseDemandSales42).toBe(42);expect(row.replenishmentSales42).toBe(42);expect(row.dailySales).toBe(1);expect(row.rawNeed).toBe(10);
  expect(result.manualItemFacts[0].dailyUsage).toBe(1);expect(result.b3Audit.matchedCount).toBe(1);
 });
 for(const note of ['@','@，其他備註','  @顧客不想帶走'])it(`${JSON.stringify(note)}排除需求但保留總倉耗用與B3`,()=>{
  const result=run(report(note));expect(result.regularRows).toHaveLength(0);expect(result.b3Audit.matchedCount).toBe(1);expect(result.manualItemFacts[0].dailyUsage).toBe(0);
 });
 for(const note of ['', '一般備註','其它文字@'])it(`${JSON.stringify(note)}納入`,()=>{expect(run(report(note)).regularRows[0].dailySales).toBe(1);});
 it('訂單備註@傳遞至配對取貨，跨店同單號不能錯配',()=>{
  expect(run(report('','@其他事項')).regularRows).toHaveLength(0);
  const r=report();r.records[0].warehouseCode='R01';const x=run(r);expect(x.b3Audit).toMatchObject({matchedCount:0,pendingCount:1});expect(x.regularRows).toHaveLength(0);
 });
 it('缺備註欄明確阻擋，不能當作全部空白',()=>{expect(()=>run(report('','',{missing:true}))).toThrow('缺少「備註」欄');});
 it('現場銷售備註@不排除；直接總倉銷貨亦納入，退貨抵減',()=>{
  const r=report('@');r.records=[{...r.records[0],saleType:'銷貨',sourceOrder:'SITE',shipWarehouseCode:'R00',quantity:4,deductQuantity:4,remark:'@現場'}];r.takeRecords=[];
  expect(run(r).regularRows[0].localSales42).toBe(4);
  r.records.push({...r.records[0],sourceOrder:'DIRECT',shipWarehouseCode:'T00',quantity:42,deductQuantity:42,remark:''});
  r.records.push({...r.records[1],saleType:'退貨',sourceOrder:'RET',quantity:-2,deductQuantity:-2});
  const row=run(r).regularRows[0];expect(row.replenishmentSales42).toBe(44);expect(row.warehouseDemandSales42).toBe(40);
 });
 it('相同取貨訂單的銷貨副本不再次加量，@副本不因去重順序遺失',()=>{
  const r=report();r.records.push({...r.takeRecords[0],saleType:'銷貨'});expect(run(r).regularRows[0].replenishmentSales42).toBe(42);
  r.takeRecords.push({...r.takeRecords[0],remark:'@不攜帶'});expect(run(r).regularRows).toHaveLength(0);
 });
 it('總倉安全保留與實際成本不因@被抹除',()=>{
  const a=report(''),b=report('@');for(const r of [a,b]){r.records[0].warehouseCode='R03';r.takeRecords[0].warehouseCode='R03';}
  const x=input(a),y=input(b);x.storeCodes=['R03'];y.storeCodes=['R03'];x.master.bySku.get('A001').sellThroughStop=true;y.master.bySku.get('A001').sellThroughStop=true;x.master.bySku.get('A001').unitCost=5;y.master.bySku.get('A001').unitCost=5;
  const one=core.buildSuggestions(x),two=core.buildSuggestions(y);expect(one.companyImpact).toEqual(two.companyImpact);expect(one.companyImpact.kuanmuB3BaseCost).toBe(210);
  expect(one.manualItemFacts[0].hqReserve).toBe(two.manualItemFacts[0].hqReserve);
 });
 it('新需求在實際正式報表與ERP往返後件數一致，取消仍不匯出',()=>{
  const c=run(report('')),row=c.regularRows[0],formal=core.buildFormalWorkbook(c,XLSX,'R00','合成門市');
  const fb=XLSX.read(XLSX.write(formal,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});expect(fb.Sheets['本次調撥建議'].J6.v).toBe(row.suggestedQuantity);
  const items=[{store_code:'R00',sku:'A001',product_name:'合成',suggested_quantity:row.suggestedQuantity,store_confirmed_quantity:row.suggestedQuantity,hq_approved_quantity:row.suggestedQuantity,item_type:'regular'},{store_code:'R00',sku:'CANCEL',product_name:'合成取消',suggested_quantity:2,store_confirmed_quantity:0,hq_approved_quantity:0,item_type:'regular'}];
  const eb=core.buildErpWorkbook(items,XLSX,'R00'),back=XLSX.read(XLSX.write(eb,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}),out=XLSX.utils.sheet_to_json(back.Sheets['通用貨品數量']);expect(out).toHaveLength(1);expect(out[0].數量).toBe(row.suggestedQuantity);
 });
 it('全館主採購原需求records與取貨分流不改，@原文不進新快照',()=>{
  const a=report(''),b=report('@');const strip=r=>r.records.map(({remark,...x})=>x);expect(strip(a)).toEqual(strip(b));
  expect(JSON.stringify(run(a).regularRows)).not.toContain('一般備註');
 });
});

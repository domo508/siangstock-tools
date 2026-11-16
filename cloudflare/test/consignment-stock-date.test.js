import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describe,it,expect} from 'vitest';
const c={console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer};c.globalThis=c;vm.createContext(c);
for(const f of ['../procurement-planning/assets/xlsx-js-style.bundle.js','../procurement-planning/xlsx-style-runtime.js','../inventory/assets/xlsx.full.min.js','../procurement-planning/core.js'])vm.runInContext(readFileSync(f,'utf8'),c);
const X=c.XLSX,C=c.ProcurementPlanningCore,W=c.ProcurementXlsxWriter;
const rt=book=>X.read(W.write(book,{type:'array',bookType:'xlsx',compression:true}),{type:'array',cellDates:true,cellStyles:true,nodim:true});
function book(headers,values=[20,0]){const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.aoa_to_sheet([['貨號','品名',...headers],['SYNTH1','合成床包(S)',...values]]),'下單');return rt(b);}
const parse=(b,asOfDate='2026-11-16')=>C.parseLirongConsignmentWorkbook(b,X,{asOfDate});
describe('dated consignment stock selection',()=>{
 it.each(['1112總庫存','11/12庫存','11月12日庫存','2026/11/12最新庫存','20261112總庫存','最新庫存11-12'])('chooses newest dated balance including zero: %s',header=>{const p=parse(book(['10/28庫存','1103出',header],[20,20,0]));expect(p.currentHeader).toBe(header);expect(p.currentStockDate).toBe('2026-11-12');expect(p.records[0].currentQty).toBe(0);expect(p.records[0].scheduledQty).toBe(0);});
 it('compares dates instead of using rightmost or leftmost column',()=>expect(parse(book(['1112總庫存','10/28庫存'],[0,20])).records[0].currentQty).toBe(0));
 it('resolves yearless December in previous year during January',()=>expect(parse(book(['12/31庫存','0102總庫存'],[20,0]),'2027-01-03').currentStockDate).toBe('2027-01-02'));
 it.each([['10/28庫存','1118總庫存'],['1112庫存','11/12總庫存'],['10/28庫存','最新庫存'],['10/28庫存','11/31總庫存'],['10/28庫存','盤點後總庫存'],['10/28庫存','112總庫存']])('rejects future, same-date or ambiguous headers: %s %s',(...headers)=>expect(()=>parse(book(headers))).toThrow(/庫存欄位待確認/));
 it('keeps a single undated current stock and explicit production schedule compatible',()=>{const p=parse(book(['剩餘庫存','11/1新增預計11/20完工'],[2,7]));expect(p.records[0]).toMatchObject({currentQty:2,scheduledQty:7});});
 it('does not use earlier value when latest balance is malformed',()=>expect(()=>parse(book(['10/28庫存','1112總庫存'],[20,'待確認']))).toThrow(/現貨數量/));
 it('does not mutate workbook and retains separate SKU balances',()=>{const b=book(['10/28庫存','1112總庫存']);const before=JSON.stringify(b);parse(b);expect(JSON.stringify(b)).toBe(before);});
 it('Puyouma retains explicit latest header and pink production semantics',()=>{const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.aoa_to_sheet([['產品編號','編號','商品名稱','最新庫存11/12','10/28寄庫'],['V1','SYNTH1','合成',0,20]]),'庫存+下單');const p=C.parseConsignmentWorkbook(rt(b),X,{asOfDate:'2026-11-16'});expect(p.records[0].currentQty).toBe(0);expect(p.currentStockDate).toBe('2026-11-12');});
});

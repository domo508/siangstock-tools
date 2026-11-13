import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describe,it,expect} from 'vitest';
const c=vm.createContext({console,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder});c.globalThis=c;
for(const p of ['../procurement-planning/assets/xlsx-js-style.bundle.js','../inventory/assets/xlsx.full.min.js','../procurement-planning/core.js'])vm.runInContext(readFileSync(new URL('../'+p,import.meta.url),'utf8'),c);
const X=c.XLSX,C=c.ProcurementPlanningCore;
const headers=['採購單編碼','狀態','貨號','品名','採購數量','交貨數量','未交數量','待交數量','未稅採購價','採購額','供應商名稱','單據是否關閉'];
function parse(rows){const w=X.utils.book_new();X.utils.book_append_sheet(w,X.utils.aoa_to_sheet([headers,...rows]),'工作表1');return C.parsePendingPurchaseWorkbook(X.read(X.write(w,{type:'array',bookType:'xlsx',compression:true}),{type:'array',cellDates:true,cellStyles:true,nodim:true}),X);}
const row=(o=20,d=24,r=-4,closed='否',id='SYNTH')=>[id,'部分到貨','SYNTH1','合成床包',o,d,r,0,100,2000,'合成供應商',closed];
describe('ERP verified overreceipt real XLSX roundtrip',()=>{
 it.each(['否','是'])('floors outstanding without hiding actual receipt: closed %s',closed=>{const p=parse([row(20,24,-4,closed)]),r=p.records[0];expect(r.orderedQuantity).toBe(20);expect(r.deliveredQuantity).toBe(24);expect(r.quantity).toBe(0);expect(r.remainingQuantity).toBe(0);expect(r.sourceRemainingQuantity).toBe(-4);expect(r.overReceivedQuantity).toBe(4);expect(C.aggregatePendingReports([p]).bySku.size).toBe(0);});
 it.each([[20,24,-3],[20,19,-1],[20,'',-4],[20,'未知',-4],[20,-24,-4],[20,24,'未知']])('rejects inconsistent or invalid amounts %s/%s/%s',(o,d,r)=>expect(()=>parse([row(o,d,r)])).toThrow());
 it('does not mask a bad row in a mixed file',()=>expect(()=>parse([row(),row(20,24,-2,'否','BAD')])).toThrow(/第3列/));
 it('keeps other live purchase outstanding and deduplicates reports',()=>{const p=parse([row(),row(20,5,15,'否','LIVE')]);const a=C.aggregatePendingReports([p,p]);expect(a.records.length).toBe(2);expect(a.bySku.get('SYNTH1').quantity).toBe(15);});
});

import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {describe,it,expect} from 'vitest';
const c={console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,setTimeout,clearTimeout};c.globalThis=c;vm.createContext(c);
for(const f of ['procurement-planning/assets/xlsx-js-style.bundle.js','procurement-planning/xlsx-style-runtime.js','inventory/assets/xlsx.full.min.js','procurement-planning/core.js','procurement-planning/puyouma-order.js'])vm.runInContext(readFileSync('../'+f,'utf8'),c);
const X=c.XLSX,W=c.ProcurementXlsxWriter,C=c.ProcurementPlanningCore,P=c.PuyoumaOrder;
const app=readFileSync('../procurement-planning/app.js','utf8');
const readStart=app.indexOf('  async function readWorkbook('),readEnd=app.indexOf('\n  }',readStart)+4;
vm.runInContext(app.slice(readStart,readEnd)+';this.readActual=readWorkbook;',c);
async function rt(wb,bookType='xlsx'){const data=W.write(wb,{type:'array',bookType,cellStyles:true});return c.readActual({arrayBuffer:async()=>data});}
function book(headers=['產品編號','編號','商品名稱','成品價','11/27\n庫存'],rows=[['SYNTH-V1','SYNTH1','合成商品',965,10]],offset={r:0,c:0},title='庫存+下單'){
 const wb=X.utils.book_new(),s=X.utils.aoa_to_sheet([]);X.utils.sheet_add_aoa(s,[headers,...rows],{origin:offset});X.utils.book_append_sheet(wb,s,title);return wb;
}
const parse=b=>C.parseConsignmentWorkbook(b,X,{asOfDate:'2026-11-27'});
describe('主檔及四類ERP來源欄名相容盤點',()=>{
 const sources=[
 ['master',['貨號','品名','供應商簡稱','進貨價'],['SYNTH1','合成','上林',100]],
 ['inventory',['店倉編號','貨號','品名','實際庫存'],['T00','SYNTH1','合成',0]],
 ['pending',['單據編碼','狀態','貨號','採購數量','未交數量'],['SYNTH-PR','主管審核','SYNTH1',10,0]],
 ['transfer',['單據編碼','狀態','調出倉庫名','調入倉庫名','貨號','數量'],['SYNTH-AT','提交','寬承總倉','合成門市','SYNTH1',2]],
 ['sales',['銷別','結帳時間','貨號','銷售量','實收金額'],['銷貨','2026-11-26 12:00:00','SYNTH1',2,200]]];
 it.each(sources)('%s換行、不可見字元與標題列維持正確對應',async(schema,headers,row)=>{
 const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['合成標題'],[],headers.map(h=>'\uFEFF'+h.split('').join('\n')+'\u200B'),row]),'合成來源');
 const result=C.inspectWorkbook(await rt(wb),X,schema).sheets[0];expect(result.headerRowIndex).toBe(2);expect(result.validation.valid).toBe(true);
 });
});
const payload={batch:{id:'SYNTH',status:'erp_created',revision:4,approved_amount:6755},items:[{sku:'SYNTH1',supplier:'普優瑪',approved_quantity:7,erp_quantity:0,approved_amount:6755}]};
describe('來源格式與匯出守恆',()=>{
 it.each(['11/27\n庫存','最新\n庫存\n11/27','1127總庫存','１１／２７ 庫\n存','2026年11月27日現貨','20261127庫存','最新庫存11–27','\uFEFF11/27\u200B庫存'])('正式讀檔辨識%s',async header=>{const p=parse(await rt(book(['產品編號','編號','商品名稱','成品價',header])));expect(p.currentStockDate).toBe('2026-11-27');expect(p.records[0].currentQty).toBe(10);});
 it.each(['xlsx','biff8'])('%s真實往返保留欄名換行、全形、位移、粉紅排程及核准量',async format=>{
  const b=book(['供應商\n貨號','ＥＲＰ品號','商 品 名 稱','採購價','11/27\n庫存'],[['SYNTH-V1','SYNTH1','合成商品','９６５','１０']],{r:3,c:2},' 庫存＋下單 '),s=b.Sheets[b.SheetNames[0]];
  X.utils.sheet_add_aoa(s,[[5]],{origin:{r:4,c:7}});s.H5.s={fill:{fgColor:{rgb:'FFFFC7CE'}}};const raw=await rt(b,format),before=JSON.stringify(raw),p=P.parseSource(raw,X,C);expect(p.records[0]).toMatchObject({sku:'SYNTH1',currentQty:10,scheduledQty:format==='xlsx'?5:0,unitCost:965,sourceRow:5});
  const out=P.buildOrder(payload,p,W,{shipmentDate:'2026-11-27'}),reopened=await rt(out.workbook);expect(X.utils.sheet_to_json(reopened.Sheets['普'],{header:1}).slice(1)).toEqual([['SYNTH-V1','SYNTH1','合成商品',965,10,7,1]]);expect(JSON.stringify(raw)).toBe(before);expect(payload.items[0].approved_quantity).toBe(7);
 });
 it('最新零不回退舊庫存或使用預計入庫',async()=>{const p=parse(await rt(book(['產品編號','編號','商品名稱','成品價','11/27庫存','11/20庫存','11/28預計入庫'],[['SYNTH-V1','SYNTH1','合成',1,0,20,50]])));expect(p.records[0].currentQty).toBe(0);});
 it.each([['11/28庫存'],['11/31庫存'],['11/27庫存','1127總庫存'],['11/27庫存','最新庫存'],['盤點後庫存'],['112庫存']])('衝突日期%s停止不回退',async(...headers)=>{await expect(rt(book(['產品編號','編號','商品名稱','成品價',...headers],[])).then(parse)).rejects.toThrow(/庫存欄位待確認/);});
 it('缺ERP編號不把產品編號當ERP品號',()=>expect(()=>parse(book(['產品編號','商品名稱','成品價','11/27庫存'],[]))).toThrow(/找不到/));
 it('重複欄名或多個完整區塊停止',()=>{expect(()=>parse(book(['產品編號','編號','ERP品號','商品名稱','庫存'],[]))).toThrow(/重複/);const b=book(undefined,undefined,undefined,'原資料');X.utils.book_append_sheet(b,X.utils.aoa_to_sheet([['產品編號','編號','商品名稱','庫存'],['V2','SYNTH2','合成2',0]]),'新版');expect(()=>parse(b)).toThrow(/多個完整資料區塊/);});
 it.each(['','待確認','#N/A',-1])('匯出庫存%s不能當0',async value=>{const p=P.parseSource(await rt(book(undefined,[['SYNTH-V1','SYNTH1','合成',965,value]])),X,C);expect(()=>P.buildOrder(payload,p,W,{shipmentDate:'2026-11-27'})).toThrow(/有效最新庫存/);});
 it('力榮換行全形與排程分開',async()=>{const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.aoa_to_sheet([['ＥＲＰ品號','品\n名','１１／２７\n庫\n存','11/28預計入庫'],['SYNTH1','合成',0,10]]),'下單');expect(C.parseLirongConsignmentWorkbook(await rt(b),X,{asOfDate:'2026-11-27'}).records[0]).toMatchObject({sku:'SYNTH1',currentQty:0,scheduledQty:10});});
 it('數字相容保留零負數、未知不轉0',()=>{for(const [input,expected] of [['１，２３４',1234],['（１２）',-12],['０',0],['0',0],['12件',null],['--',null],['',null],['#DIV/0!',null]])expect(C.parseNumber(input)).toBe(expected);});
});
async function googleFixture({titles=[' 庫存＋下單 ','庫存布'],grids,error=false}={}){
 const calls=[];let client;const val=x=>({effectiveValue:typeof x==='number'?{numberValue:x}:{stringValue:x}});
 const sandbox={console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URLSearchParams,crypto:webcrypto,setTimeout,clearTimeout,google:{accounts:{oauth2:{initTokenClient:()=>{client={requestAccessToken:()=>client.callback({access_token:'synthetic'})};return client;}}}},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>new URL(url).searchParams.has('includeGridData')?{sheets:[{properties:{title:titles[0]},data:grids??[{startRow:2,startColumn:1,rowData:[{values:['產品編號','編號','商品名稱','成品價','11/27庫存'].map(val)},{values:['SYNTH-V1','SYNTH1','合成',965,0].map((x,i)=>error&&i===4?{effectiveValue:{errorValue:{type:'DIVIDE_BY_ZERO'}}}:val(x))}]}]}]}:{sheets:titles.map(title=>({properties:{title}}))}};}};
 vm.createContext(sandbox);vm.runInContext(readFileSync('../procurement-planning/google-sources.js','utf8'),sandbox);const G=sandbox.ProcurementGoogleSources;G.initialize('synthetic');await G.authorize();return{G,calls,load:()=>G.loadPuyoumaConsignment({fixedSources:{puyoumaSpreadsheetId:'synthetic'}},X)};
}
describe('Google共用來源',()=>{
 it('API偏移與零值、頁籤已知格式、禁止快取',async()=>{const f=await googleFixture(),r=await f.load();expect(r.workbook.Sheets[' 庫存＋下單 '].B3.v).toBe('產品編號');expect(P.parseSource(r.workbook,X,C).records[0]).toMatchObject({sourceRow:4,currentQty:0});expect(f.calls.every(x=>x.options.cache==='no-store'&&(!x.options.method||x.options.method==='GET'))).toBe(true);});
 it('多段API資料及粉紅樣式保留原位',async()=>{const val=x=>({effectiveValue:typeof x==='number'?{numberValue:x}:{stringValue:x}}),f=await googleFixture({grids:[{startRow:1,startColumn:1,rowData:[{values:['產品編號','編號','商品名稱','成品價','11/27庫存','製作'].map(val)}]},{startRow:2,startColumn:1,rowData:[{values:['SYNTH-V1','SYNTH1','合成',965,10,5].map((x,i)=>i===5?{...val(x),effectiveFormat:{backgroundColor:{red:1,green:199/255,blue:206/255}}}:val(x))}]}]});expect(P.parseSource((await f.load()).workbook,X,C).records[0]).toMatchObject({sourceRow:3,currentQty:10,scheduledQty:5});});
 it('無關輔助公式錯誤保留但不封鎖採購欄',async()=>{const val=x=>({effectiveValue:typeof x==='number'?{numberValue:x}:{stringValue:x}}),f=await googleFixture({grids:[{rowData:[{values:['產品編號','編號','商品名稱','成品價','11/27庫存','輔助計算'].map(val)},{values:[...['SYNTH-V1','SYNTH1','合成',965,10].map(val),{effectiveValue:{errorValue:{type:'REF'}},formattedValue:'#REF!'}]}]}]});const b=(await f.load()).workbook;expect(b.Sheets[' 庫存＋下單 '].F2.t).toBe('e');expect(P.parseSource(b,X,C).records[0].currentQty).toBe(10);});
 it('公式錯誤明列座標、不變空白0',async()=>{const f=await googleFixture({error:true});const r=await f.load();expect(()=>P.parseSource(r.workbook,X,C)).toThrow(/F4.*公式錯誤/);});
 it.each([[[]],[['任意新名稱']],[['庫存+下單',' 庫存＋下單 ']]])('不明重複頁籤%s停止',async titles=>{const f=await googleFixture({titles});await expect(f.load()).rejects.toThrow(/頁籤/);expect(f.calls).toHaveLength(1);});
});

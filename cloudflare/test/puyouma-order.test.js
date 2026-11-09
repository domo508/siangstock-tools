import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
vi.mock('../worker/src/access',()=>({verifyCompanyUser:vi.fn(async r=>{if(!r.headers.get('X-Test-Email'))throw new Error('需要登入');return r.headers.get('X-Test-Email');}),verifyAdmin:vi.fn()}));
import { procurementRoute } from '../worker/src/procurement';
const ctx={console,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder};vm.createContext(ctx);
vm.runInContext(readFileSync('../procurement-planning/assets/xlsx-js-style.bundle.js','utf8'),ctx);const W=ctx.XLSX;
for(const path of ['../inventory/assets/xlsx.full.min.js','../procurement-planning/core.js','../procurement-planning/puyouma-order.js'])vm.runInContext(readFileSync(path,'utf8'),ctx);
const R=ctx.XLSX,api=ctx.PuyoumaOrder,core=ctx.ProcurementPlanningCore;
const roundtrip=wb=>R.read(W.write(wb,{type:'array',bookType:'xlsx',cellStyles:true}),{type:'array',cellDates:true,cellStyles:true,nodim:true});
function source(data=[['V2','B2','供應商名稱二',200,0],['V1','B1','供應商名稱一',100,20]]){
 const wb=W.utils.book_new();W.utils.book_append_sheet(wb,W.utils.aoa_to_sheet([['產品編號','編號','商品名稱','成品價','最新\n庫存\n11/9'],...data]),'庫存+下單');return api.parseSource(roundtrip(wb),R,core);
}
const item=(sku='B1',quantity=3,supplier='普優瑪寢具有限公司')=>({sku,supplier,approved_quantity:quantity,erp_quantity:null,approved_amount:300,name:'ERP名稱不同'});
function payload(items=[item(),{...item('B2',5),approved_amount:1000}]){return {batch:{id:'SYNTH-PUY',status:'approved',revision:2,approved_amount:items.reduce((s,r)=>s+r.approved_amount,0)},items};}
describe('普優瑪專屬格式',()=>{
 it('7欄與範例一致、日期動態、來源價/庫存/名稱正確、依寄庫表排序且不改原始資料',()=>{
  const p=payload(),s=source(),before=JSON.stringify([p,s]);const result=api.buildOrder(p,s,W,{shipmentDate:'2026-11-06'}),out=roundtrip(result.workbook),rows=R.utils.sheet_to_json(out.Sheets['普'],{header:1,defval:''});
  expect(out.SheetNames).toEqual(['普']);expect(rows).toEqual([['產品編號','編號','商品名稱','成品價','最新\n庫存\n11/9','11/6出貨','排序'],['V2','B2','供應商名稱二',200,0,5,1],['V1','B1','供應商名稱一',100,20,3,2]]);
  expect(result.quantity).toBe(8);expect(JSON.stringify([p,s])).toBe(before);expect(out.Sheets['普'].E1.s.fgColor.rgb).toBe('FFCC99');expect(out.Sheets['普']['!cols'][2].wch).toBeGreaterThan(50);
 });
 it.each(['','2026-02-30','2026-13-01','11/6','2026-11-06junk'])('空白或無效日期%s阻擋',date=>expect(()=>api.buildOrder(payload(),source(),W,{shipmentDate:date})).toThrow(/日期/));
 it('只用確認採購量，ERP預設0不誤判取消；確認0不回退，其他供應商不混入',()=>{
  const p=payload([{...item('B1',0),erp_quantity:3},{...item('B2',5),erp_quantity:0},{...item('OTHER',20,'上林'),approved_amount:100}]);const result=api.buildOrder(p,source(),W,{shipmentDate:'2026-11-09'});expect(result.rows.map(r=>[r.sku,r.quantity])).toEqual([['B2',5]]);expect(result.quantity).toBe(5);
 });
 it.each(['pending_approval','revoked','unknown'])('狀態%s不允許',status=>expect(()=>api.buildOrder({...payload(),batch:{...payload().batch,status}},source(),W,{shipmentDate:'2026-11-09'})).toThrow(/已確認/));
 it('空明細、金額不符、全0、非普優瑪及重複品號皆不能部分匯出',()=>{
  for(const p of [payload([]),{...payload(),batch:{...payload().batch,approved_amount:1}},payload([item('B1',0)]),payload([item('B1',3,'上林')]),payload([item(),item()])])expect(()=>api.buildOrder(p,source(),W,{shipmentDate:'2026-11-09'})).toThrow();
 });
 it('缺商品、重複商品、缺成品價、空/壞/負庫存不猜0，明確0仍有效',()=>{
  for(const data of [[['V1','NO','商品',100,20]],[['V1','B1','商品',100,20],['V2','B1','商品',100,20]],[['V1','B1','商品',null,20]],[['V1','B1','商品',100,null]],[['V1','B1','商品',100,'資料未取得']],[['V1','B1','商品',100,-1]]])expect(()=>api.buildOrder(payload([item()]),source(data),W,{shipmentDate:'2026-11-09'})).toThrow(/B1/);
  expect(api.buildOrder(payload([item()]),source([['V1','B1','商品',0,0]]),W,{shipmentDate:'2026-11-09'}).rows[0].values.slice(3,5)).toEqual([0,0]);
 });
 it('缺欄及混合異常來源不能掩蓋缺漏商品',()=>{
  const wb=W.utils.book_new();W.utils.book_append_sheet(wb,W.utils.aoa_to_sheet([['產品編號','編號','商品名稱'],['V1','B1','商品']]),'庫存+下單');expect(()=>api.parseSource(roundtrip(wb),R,core)).toThrow(/最新庫存/);
  expect(()=>api.buildOrder(payload(),source([['V1','B1','商品',100,20],['V2','B2','商品',null,20]]),W,{shipmentDate:'2026-11-09'})).toThrow('B2');
 });
 it('數量加量與歸零保持單一解析口徑，輸出件數逐SKU核對',()=>{
  for(const q of [1,9,0]){const p=payload([{...item('B1',q),erp_quantity:0},item('B2',5)]);const result=api.buildOrder(p,source(),W,{shipmentDate:'2026-11-09'});const rows=R.utils.sheet_to_json(roundtrip(result.workbook).Sheets['普'],{header:1}).slice(1);expect(rows.reduce((s,r)=>s+r[5],0)).toBe(q+5);expect(rows.find(r=>r[1]==='B1')?.[5]??0).toBe(q);}
 });
});
let sql,env;
beforeEach(()=>{sql=new DatabaseSync(':memory:');for(const f of readdirSync('worker/migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('worker/migrations/'+f,'utf8'));env={DB:{prepare(q){let args=[];return {bind(...a){args=a;return this;},async all(){return {results:sql.prepare(q).all(...args)};}};}},ALLOWED_ORIGINS:'https://siangstock.com'};});
afterEach(()=>sql.close());
const call=(auth=true,method='GET')=>procurementRoute(new Request('https://siangstock.com/api/procurement/batches/SYNTH-PUY/supplier-order',{method,headers:auth?{'X-Test-Email':'operator@example.test'}:{}}),env);
it('公司操作員唯讀取得已確認明細，無摘要通知或業務寫入；ERP量0保留',async()=>{
 sql.exec("INSERT INTO procurement_batches(id,analysis_month,supplier_summary,status,suggested_amount,manual_amount,blocked_amount,approved_amount,adjustment_amount,budget_amount,payment_current_month,payment_future_months,payment_schedule,warning_summary,created_at,created_by,updated_at,idempotency_key) VALUES('SYNTH-PUY','2026-11','[\"普優瑪\"]','erp_created',300,300,0,300,0,1000,300,0,'[]','','2026-11-05','test','2026-11-05','puy-test')");
 sql.exec("INSERT INTO procurement_batch_items(batch_id,sku,name,supplier,approved_quantity,unit_cost,approved_amount,erp_quantity,remaining_quantity,updated_at) VALUES('SYNTH-PUY','B1','合成','普優瑪',3,100,300,0,0,'2026-11-05')");
 const before=sql.prepare('SELECT total_changes() n').get().n,response=await call(),result=await response.json();expect(response.headers.get('Cache-Control')).toBe('no-store');expect(result).toMatchObject({batch:{id:'SYNTH-PUY',status:'erp_created',approved_amount:300},items:[{sku:'B1',approved_quantity:3,erp_quantity:0}]});expect(sql.prepare('SELECT total_changes() n').get().n).toBe(before);expect((await call(true,'POST')).status).toBe(405);
 sql.exec("UPDATE procurement_batches SET status='revoked' WHERE id='SYNTH-PUY'");await expect(call()).rejects.toThrow(/未撤銷/);
});
it('登入失效與不存在批次均不能取得資料',async()=>{await expect(call(false)).rejects.toThrow('需要登入');await expect(call()).rejects.toThrow('找不到');});

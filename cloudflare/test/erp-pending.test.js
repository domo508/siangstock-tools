import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
vi.mock('../worker/src/access',()=>({verifyCompanyUser:vi.fn(async r=>{if(!r.headers.get('X-Test-Email'))throw new Error('登入失效');return r.headers.get('X-Test-Email');}),verifyAdmin:vi.fn()}));
import { procurementRoute } from '../worker/src/procurement';
import { readPendingPurchaseSnapshot, validatePendingOrders } from '../worker/src/pending-purchases';
const ctx={console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer};vm.createContext(ctx);
for(const f of ['../inventory/assets/xlsx.full.min.js','../procurement-planning/core.js','../procurement-planning/shortage-batch.js'])vm.runInContext(readFileSync(f,'utf8'),ctx);
const X=ctx.XLSX,c=ctx.ProcurementPlanningCore,h=ctx.ProcurementShortageBatch;
function parse(rows){const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(rows),'ERP');return c.parsePendingPurchaseWorkbook(X.read(X.write(wb,{type:'array',bookType:'xlsx'}),{type:'array',cellDates:true,cellStyles:true,nodim:true}),X);}
let sql,env;
beforeEach(()=>{
 sql=new DatabaseSync(':memory:');for(const f of readdirSync('worker/migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('worker/migrations/'+f,'utf8'));
 env={ALLOWED_ORIGINS:'https://siangstock.com',DB:{prepare(q){let args=[];return {bind(...a){args=a;return this;},async first(){return sql.prepare(q).get(...args)||null;},async all(){return {results:sql.prepare(q).all(...args)};},async run(){return {meta:{changes:Number(sql.prepare(q).run(...args).changes)}};}};},async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}}};
});
afterEach(()=>sql.close());
const save=(rows,version='20261113-procurement-overreceipt-r1')=>procurementRoute(new Request('https://siangstock.com/api/procurement/pending-purchase-snapshot',{method:'PUT',headers:{Origin:'https://siangstock.com','Content-Type':'application/json','X-Test-Email':'operator@example.test','X-Procurement-Version':version},body:JSON.stringify({sourceDate:'2026-11-06',rows})}),env);
it('正式XLSX往返：草稿、取消、結案、全到排除，部分到貨只算剩餘，沒有單號保留商品總量',async()=>{
 const report=parse([['採購單號','狀態','貨號','品名','採購數量','已交數量','未交數量','預計交貨日期'],['PO1','主管審核','N1','合成',20,5,15,'2026-11-09'],['PO2','部分到貨','N1','合成',10,5,5,'2026-11-16'],['','主管審核','N2','無單號',8,0,8,''],...['新單','草稿','已取消','作廢','已結案','全部到貨'].map((status,i)=>['DROP'+i,status,'N1','不列入',99,0,99,'2026-11-09'])]);
 const agg=c.aggregatePendingReports([report,report]);expect(agg.bySku.get('N1').quantity).toBe(20);expect(agg.bySku.get('N2').quantity).toBe(8);
 const rows=[...agg.bySku.values()].map(row=>({sku:row.sku,productName:row.name,pendingQuantity:row.quantity,orders:row.orders}));
 expect((await save(rows)).ok).toBe(true);const snap=await readPendingPurchaseSnapshot(env.DB);expect(snap.available).toBe(true);
 const n1=h.pendingInfo('N1',snap);expect(n1.total).toBe(20);expect(n1.orders.map(x=>x.documentCode)).toEqual(['PO1','PO2']);expect(n1.earliest).toBe('2026-11-09');expect(h.pendingInfo('N2',snap).orders[0].documentCode).toBe('');
});
it('只有商品未交量的實際XLSX可解析，不要求原訂購數或單號',()=>{
 const report=parse([['ERP品號','品名','採購未交量'],['N1','合成',50],['ZERO','合成零',0]]);expect(report.records[0]).toMatchObject({sku:'N1',quantity:50,documentCode:''});expect(c.aggregatePendingReports([report]).bySku.get('N1').quantity).toBe(50);
});
it('缺欄、混合錯誤及全列數量錯誤不能悄悄少算未交量',()=>{
 expect(()=>parse([['貨號','品名'],['N1','合成']])).toThrow('缺少');
 for(const records of [[['N1',20],['N2','錯誤']],[['N1','錯誤']],[['N1',-1]]])expect(()=>parse([['貨號','未交數量'],...records])).toThrow('數量格式錯誤');
});
it('未知與完整空清單的0不同；舊商品摘要不虛構單號與逐批量',async()=>{
 expect(h.pendingInfo('N1',await readPendingPurchaseSnapshot(env.DB)).total).toBe(null);
 await save([]);expect(h.pendingInfo('N1',await readPendingPurchaseSnapshot(env.DB)).total).toBe(0);
 await save([{sku:'N1',pendingQuantity:50,expectedDeliveryDate:'2026-11-09'}]);const info=h.pendingInfo('N1',await readPendingPurchaseSnapshot(env.DB));expect(info).toMatchObject({total:50,orders:null,earliest:'2026-11-09'});
});
it('明細與總量不符、重複品號及舊版本拒絕，完整摘要原子保留',async()=>{
 await save([{sku:'KEEP',pendingQuantity:7}]);
 await expect(save([{sku:'N1',pendingQuantity:5,orders:[{quantity:4}]}])).rejects.toThrow('不一致');
 await expect(save([{sku:'N1',pendingQuantity:5},{sku:'N1',pendingQuantity:5}])).rejects.toThrow('重複');
 await expect(save([],'old')).rejects.toThrow('最新版');
 expect((await readPendingPurchaseSnapshot(env.DB)).rows.map(r=>r.sku)).toEqual(['KEEP']);
});
it('同品號多店需求不被工具採購關聯抵扣；已實際補配才扣，ERP總量顯示一次',()=>{
 const needs=[{store_code:'R01',sku:'N1',unfilled_quantity:18,covered_quantity:10,fulfilled_quantity:3},{store_code:'R03',sku:'N1',unfilled_quantity:12,covered_quantity:50,fulfilled_quantity:0}];
 expect(needs.reduce((sum,row)=>sum+h.remainingNeed(row),0)).toBe(27);
 const grouped=h.groupProducts(needs);expect(grouped).toHaveLength(1);expect(grouped[0].transferRemaining).toBe(27);
 const html=h.renderPendingInfo('N1',{available:true,sourceDate:'2026-11-06',rows:[{sku:'N1',pending_quantity:50}]},s=>String(s).replaceAll('<','&lt;'));
 expect(html.match(/50件/g)).toHaveLength(1);expect(html).toContain('未提供採購單號明細');expect(html).not.toContain('已採購覆蓋');
});
it('摘要消失不會改寫需求到貨狀態、核准也不產生未交量',async()=>{
 sql.exec("INSERT INTO store_transfer_procurement_needs(store_code,sku,product_name,source_batch_id,approved_demand_quantity,allocated_quantity,unfilled_quantity,covered_quantity,status,reason,created_at,updated_at,updated_by) VALUES('R01','N1','合成','TEST',30,0,30,10,'covered_waiting','','2026-11-01','2026-11-01','test')");
 await save([]);expect(sql.prepare("SELECT status,covered_quantity FROM store_transfer_procurement_needs WHERE sku='N1'").get()).toMatchObject({status:'covered_waiting',covered_quantity:10});expect(sql.prepare('SELECT COUNT(*) AS n FROM store_transfer_procurement_need_events').get().n).toBe(0);
 const source=readFileSync('worker/src/procurement.ts','utf8');const approve=source.slice(source.indexOf('async function approve('),source.indexOf('async function markErp'));
 expect(approve).not.toContain('covered_quantity +');
});
it('錯誤明細日期/負數、無限大不接受；畫面保留缺日期與安全文字',()=>{
 for(const row of [{quantity:-1},{quantity:Infinity},{quantity:1,deliveryDate:'2026-02-30'},{quantity:1,deliveryDate:'bad'}])expect(()=>validatePendingOrders([row],1,'N1')).toThrow();
 const esc=s=>String(s).replaceAll('<','&lt;');const html=h.renderPendingInfo('N1',{available:true,rows:[{sku:'N1',pending_quantity:1,order_details:JSON.stringify([{quantity:1,documentCode:'<script>',deliveryDate:null}])}]},esc);expect(html).toContain('&lt;script>');expect(html).toContain('預計到貨：未提供');
});
it('實際核准API保留批次承諾與摘要通知，但不把關聯數量當成ERP未交',async()=>{
 sql.exec("INSERT INTO store_transfer_procurement_needs(store_code,sku,product_name,source_batch_id,approved_demand_quantity,allocated_quantity,unfilled_quantity,status,reason,created_at,updated_at,updated_by) VALUES('R01','N1','合成','TEST',30,0,30,'waiting_merge','','2026-11-01','2026-11-01','test')");
 sql.exec("INSERT INTO procurement_batches(id,analysis_month,supplier_summary,status,suggested_amount,manual_amount,blocked_amount,approved_amount,adjustment_amount,budget_amount,payment_current_month,payment_future_months,payment_schedule,warning_summary,created_at,created_by,updated_at,idempotency_key) VALUES('SYNTH-APPROVE','2026-11','[]','pending_approval',10,10,0,10,0,100,10,0,'[]','','2026-11-06','test','2026-11-06','erp-pending-approve')");
 sql.exec("INSERT INTO procurement_batch_store_needs(batch_id,store_code,sku,covered_quantity,created_at) VALUES('SYNTH-APPROVE','R01','N1',10,'2026-11-06')");
 const response=await procurementRoute(new Request('https://siangstock.com/api/procurement/batches/SYNTH-APPROVE/approve',{method:'POST',headers:{Origin:'https://siangstock.com','Content-Type':'application/json','X-Test-Email':'siang01@siangapato.com.tw'},body:JSON.stringify({idempotencyKey:'erp-pending-approval-test'})}),env);
 expect(response.ok).toBe(true);expect((await response.json()).batch.status).toBe('approved');
 expect(sql.prepare("SELECT covered_quantity,status FROM store_transfer_procurement_needs WHERE sku='N1'").get()).toMatchObject({covered_quantity:0,status:'waiting_merge'});
 expect((await readPendingPurchaseSnapshot(env.DB)).available).toBe(false);
 expect(sql.prepare("SELECT COUNT(*) n FROM procurement_notifications WHERE batch_id='SYNTH-APPROVE'").get().n).toBe(1);
});

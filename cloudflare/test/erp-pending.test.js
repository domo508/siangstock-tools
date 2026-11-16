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
const save=(rows,version='20261116-procurement-transfer-performance-r2')=>procurementRoute(new Request('https://siangstock.com/api/procurement/pending-purchase-snapshot',{method:'PUT',headers:{Origin:'https://siangstock.com','Content-Type':'application/json','X-Test-Email':'operator@example.test','X-Procurement-Version':version},body:JSON.stringify({sourceDate:'2026-11-06',rows})}),env);
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

const receiptHeaders=['採購單號','狀態','貨號','品名','採購數量','交貨數量','未交數量','未稅採購價','採購額','全都到貨日期','收貨單開單日','單據是否關閉','全部到貨'];
function seedCrossMonth(id='CROSS',month='2026-10',status='erp_created',ref='PO-CROSS'){
 sql.prepare(`INSERT INTO procurement_batches(id,analysis_month,supplier_summary,payment_schedule,warning_summary,blocked_amount,status,suggested_amount,manual_amount,approved_amount,adjustment_amount,budget_amount,payment_current_month,payment_future_months,created_at,created_by,updated_at,idempotency_key,erp_reference) VALUES(?,?, '["合成供應商"]','[]','',0,?,100,100,100,0,100,100,0,'2026-10-25','test','2026-10-25',?,?)`).run(id,month,status,id,ref);
 sql.prepare("INSERT INTO procurement_batch_items(batch_id,sku,name,supplier,approved_quantity,unit_cost,approved_amount,erp_quantity,received_quantity,remaining_quantity,lifecycle_status,updated_at) VALUES(?,'N1','合成新品','合成供應商',10,10,100,10,0,10,'等待到貨','2026-10-25')").run(id);
}
const requestProc=(path,method='GET',data)=>procurementRoute(new Request('https://siangstock.com/api/procurement'+path,{method,headers:{Origin:'https://siangstock.com','Content-Type':'application/json','X-Test-Email':'operator@example.test'},...(data?{body:JSON.stringify(data)}:{})}),env);
it('同時有全到日期與收貨日期的實際XLSX，優先收貨單日期，不受欄位順序或0影響',()=>{
 const rows=parse([receiptHeaders,['PO-CROSS','部分到貨','N1','合成新品',10,8,2,10,100,0,'2026-11-02','是','否'],['PO-FULL','已全部到貨','N2','全到',10,10,0,10,100,'2026-11-05','2026-11-03','否','是'],['PO-FALLBACK','已全部到貨','N3','舊格式',10,10,0,10,100,'2026-11-04','','否','是'],['PO-NODATE','部分到貨','N4','缺日期',10,8,2,10,100,0,0,'否','否']]).records;
 expect(rows.map(r=>r.receiptDate)).toEqual(['2026-11-02','2026-11-03','2026-11-04','']);
 expect(rows[0]).toMatchObject({documentClosed:true,deliveredQuantity:8,remainingQuantity:2,quantity:0});
});
it('跨月份收貨參照含舊月份及供應商子單，不混入未建ERP或撤銷批次，月台帳範圍不變',async()=>{
 seedCrossMonth();seedCrossMonth('NOV','2026-11','erp_created','PO-NOV');seedCrossMonth('OLD','2026-09','received','PO-OLD');seedCrossMonth('VOID','2026-10','revoked','PO-VOID');seedCrossMonth('APPROVED','2026-10','approved','PO-NOERP');
 sql.exec("INSERT INTO procurement_batch_erp_documents(batch_id,supplier,erp_reference,status,updated_at) VALUES('CROSS','子供應商','PO-SUB','erp_created','2026-10-25')");
 const references=(await(await requestProc('/erp-reconciliation-references')).json()).references;
 expect(references).toEqual(['PO-CROSS','PO-NOV','PO-OLD','PO-SUB']);
 const ledger=await(await requestProc('/ledger?month=2026-11')).json();expect(ledger.batches.map(r=>r.id)).toEqual(['NOV']);
});
it('10月採購11月收貨：真實XLSX解析接續實際API，關閉短收不冒充全數收齊，付款按收貨日且重試不重複',async()=>{
 seedCrossMonth();const report=parse([receiptHeaders,['PO-CROSS','部分到貨','N1','合成新品',10,8,2,10,100,0,'2026-11-02','是','否']]);
 const refs=(await(await requestProc('/erp-reconciliation-references')).json()).references;
 const orders=c.buildErpReconciliationOrders([report,report],refs);expect(orders).toHaveLength(1);expect(orders[0].items[0]).toMatchObject({orderedQuantity:10,deliveredQuantity:8,remainingQuantity:2,receiptDate:'2026-11-02'});
 const before=sql.prepare('SELECT approved_amount FROM procurement_batches').get().approved_amount;
 expect((await requestProc('/erp-reconciliations','POST',{orders})).ok).toBe(true);
 expect(sql.prepare('SELECT status,approved_amount FROM procurement_batches').get()).toMatchObject({status:'received',approved_amount:before});
 expect(sql.prepare('SELECT received_quantity,remaining_quantity FROM procurement_batch_items').get()).toMatchObject({received_quantity:8,remaining_quantity:2});
 expect(sql.prepare('SELECT receipt_date,quantity_delta,payment_amount FROM procurement_receipt_events').get()).toMatchObject({receipt_date:'2026-11-02',quantity_delta:8,payment_amount:80});
 await requestProc('/erp-reconciliations','POST',{orders});expect(sql.prepare('SELECT COUNT(*) n FROM procurement_receipt_events').get().n).toBe(1);
 expect(sql.prepare('SELECT COUNT(*) n FROM procurement_payment_events').get().n).toBe(1);
});
it('未關閉混合全到及部分到貨仍等待餘量，不因一列全到就關閉整張單',async()=>{
 seedCrossMonth();sql.exec("INSERT INTO procurement_batch_items(batch_id,sku,name,supplier,approved_quantity,unit_cost,approved_amount,updated_at) VALUES('CROSS','N2','合成','合成供應商',10,10,100,'2026-10-25')");
 const report=parse([receiptHeaders,['PO-CROSS','部分到貨','N1','合成新品',10,8,2,10,100,0,'2026-11-02','否','否'],['PO-CROSS','部分到貨','N2','合成',10,10,0,10,100,'2026-11-02','2026-11-02','否','是']]);const orders=c.buildErpReconciliationOrders([report],['PO-CROSS']);expect(orders[0].fullyReceived).toBe(false);
 await requestProc('/erp-reconciliations','POST',{orders});expect(sql.prepare('SELECT status FROM procurement_batches').get().status).toBe('erp_created');
});
it('沒有有效日期仍保留未知，不製造收貨付款事件；數量價格差異仍待人工確認',async()=>{
 seedCrossMonth();let orders=c.buildErpReconciliationOrders([parse([receiptHeaders,['PO-CROSS','部分到貨','N1','合成新品',10,8,2,10,100,0,0,'否','否']])],['PO-CROSS']);
 const result=await(await requestProc('/erp-reconciliations','POST',{orders})).json();expect(result.results[0].missingReceiptDates).toEqual(['N1']);expect(sql.prepare('SELECT COUNT(*) n FROM procurement_payment_events').get().n).toBe(0);
 orders[0].items[0].orderedQuantity=11;await requestProc('/erp-reconciliations','POST',{orders});expect(sql.prepare("SELECT COUNT(*) n FROM procurement_erp_reconciliations WHERE status='pending'").get().n).toBe(1);
});

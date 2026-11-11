import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
vi.mock('../worker/src/access', () => ({ verifyCompanyUser: vi.fn(async r => r.headers.get('X-Test-Email')) }));
import { storeTransferRoute } from '../worker/src/store-transfer';
const browser = { console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer };
vm.createContext(browser);
for (const file of ['../procurement-planning/assets/xlsx-js-style.bundle.js', '../store-transfer/core.js', '../store-transfer/workflow.js']) vm.runInContext(readFileSync(file, 'utf8'), browser);
let sql, env, beforeTransaction;
const id = 'TR-PER-STORE';
const hq = 'siang01@siangapato.com.tw';
const email = { R00: 'tpzssa@siangapato.com.tw', R01: 'txg_sianga_pato@siangapato.com.tw' };
async function call(path, method = 'GET', body, actor = hq) {
  return storeTransferRoute(new Request(`https://siangstock.com/api/store-transfer${path}`, { method, headers: { Origin: 'https://siangstock.com', 'Content-Type': 'application/json', 'X-Test-Email': actor, 'X-Store-Transfer-Version': '20261111-transfer-change-filter-r1' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
}
const detail = async () => (await call(`/batches/${id}`)).json();
const items = store => ['PASS', 'EDIT', 'ZERO'].map(sku => ({storeCode:store,sku,productName:`合成${sku}`,suggestedQuantity:2,itemType:'regular',calculationDate:'2026-11-04',decisionSnapshot:{hqAvailable:20,hqReleasable:20,hqSupplyCeiling:20,...(sku==='PASS'?{salesBasisVersion:2,warehouseDemandSales42:42,replenishmentSales42:46}:{} )}}));
const storeRows = store => items(store).map(item => ({...item,confirmedQuantity:2,reason:''}));
async function submit(store) { return call(`/batches/${id}/stores/${store}/submit`, 'PUT', {items:storeRows(store)}, email[store]); }
async function approve(store, changed=false) {
  const p=await detail();
  return call(`/batches/${id}/stores/${store}/approve`, 'POST', {expectedRevision:p.batch.revision,items:p.items.filter(i=>i.store_code===store).map(i=>({storeCode:store,sku:i.sku,itemType:i.item_type,approvedQuantity:changed?(i.sku==='ZERO'?0:i.sku==='EDIT'?3:2):2,reason:changed?'合成覆核':''}))});
}
beforeEach(async () => {
  vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(new Date('2026-11-02T02:00:00Z'));
  sql=new DatabaseSync(':memory:');
  for(const file of readdirSync('worker/migrations').filter(f=>f.endsWith('.sql')).sort()) sql.exec(readFileSync(`worker/migrations/${file}`,'utf8'));
  beforeTransaction=null;
  env={ALLOWED_ORIGINS:'https://siangstock.com',DB:{prepare(query){let args=[];return {bind(...a){args=a;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}};},async batch(statements){if(beforeTransaction){const hook=beforeTransaction;beforeTransaction=null;hook();}sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}}};
  const arrivalSchedule=Object.fromEntries(['R00','R01'].map(store=>[store,{storeCode:store,currentArrivalDate:'2026-11-04',nextArrivalDate:'2026-11-11'}]));
  const response=await call('/batches','POST',{id,weekKey:'2026-W45',proposalDate:'2026-11-02',responseDueAt:'2026-11-03T01:00:00Z',lockAt:'2026-11-03T01:00:00Z',arrivalSchedule,items:[...items('R00'),...items('R01')],manualItemFacts:[{storeCode:'R00',sku:'ADD',productName:'合成人工新增',hqAvailable:20,hqReleasable:20,calculationDate:'2026-11-04'}]});
  expect(response.status).toBe(201);
});
afterEach(()=>{vi.useRealTimers();sql.close();});

function activityFixture(expectedDate = '2026-11-03') {
  sql.prepare("INSERT INTO store_transfer_activity_plans(id,revision,status,source,config,created_at,created_by,updated_at,updated_by) VALUES('SYNTH-ACTIVITY',2,'confirmed','{}','{}','2026-11-02',?,'2026-11-02',?)").run(hq,hq);
  const schedule=Object.fromEntries(['R00','R01'].map(store=>[store,{storeCode:store,currentArrivalDate:'2026-11-05',nextArrivalDate:'2026-11-12',activityPlanId:'SYNTH-ACTIVITY',activityPlanRevision:2,activityApprovalDate:expectedDate,activityBufferDays:2}]));
  sql.prepare('UPDATE store_transfer_batches SET arrival_schedule=? WHERE id=?').run(JSON.stringify(schedule),id);
  return schedule;
}
async function extend(store='R00', deadlineAt='2026-11-03T10:00:00.000Z', reason='合成延長確認', actor=hq, revision) {
  const p=await detail();
  return call(`/batches/${id}/stores/${store}/reply-deadline`,'POST',{deadlineAt,reason,expectedRevision:revision ?? p.batch.revision},actor);
}
it('總部延長指定門市後原批次可接續人工增減、送審及逐店ERP，其他門市保持截止',async()=>{
  const before=await detail();
  vi.setSystemTime(new Date('2026-11-03T02:00:00Z'));
  await expect(submit('R00')).rejects.toThrow(/截止/);
  expect((await extend()).status).toBe(200);
  const extended=await detail();
  expect(extended.batch.lock_at).toBe(before.batch.lock_at);
  expect(extended.batch.arrival_schedule).toBe(before.batch.arrival_schedule);
  expect(extended.items).toEqual(before.items);
  expect(extended.storeStatuses.find(s=>s.store_code==='R01')).toEqual(before.storeStatuses.find(s=>s.store_code==='R01'));
  expect(extended.storeStatuses.find(s=>s.store_code==='R00')).toMatchObject({status:'pending',reply_deadline_at:'2026-11-03T10:00:00.000Z'});
  expect(extended.replyExtensions).toHaveLength(1);
  const own=await (await call(`/batches/${id}`, 'GET',undefined,email.R01)).json();
  expect(own.replyExtensions).toEqual([]);
  await expect(submit('R01')).rejects.toThrow(/截止/);
  const changed=storeRows('R00').map(i=>({...i,confirmedQuantity:i.sku==='ZERO'?0:i.sku==='EDIT'?3:2,reason:i.sku==='PASS'?'':'合成門市改量'}));
  expect((await call(`/batches/${id}/stores/R00/save`,'PUT',{items:changed},email.R00)).status).toBe(200);
  expect((await call(`/batches/${id}/stores/R00/submit`,'PUT',{items:changed},email.R00)).status).toBe(200);
  expect((await approve('R00',true)).status).toBe(200);
  const approved=await detail();
  const file=browser.StoreTransferWorkflow.prepareExports(approved,['R00'],browser.StoreTransferCore,browser.XLSX)[0];
  const wb=browser.XLSX.read(browser.XLSX.write(file.workbook,{type:'array',bookType:'xlsx'}),{type:'array',cellDates:true,cellStyles:true,nodim:true});
  expect(Object.fromEntries(browser.XLSX.utils.sheet_to_json(wb.Sheets['通用貨品數量']).map(r=>[r.貨號,r.數量]))).toEqual({PASS:2,EDIT:3});
  expect((await call(`/batches/${id}/erp-created`,'POST',{storeCodes:['R00'],expectedRevision:approved.batch.revision})).status).toBe(200);
  await expect(extend()).rejects.toThrow(/已核准|ERP/);
});
it('已送出者延長不自動撤回，可於期限內自行撤回，18點後仍鎖定',async()=>{
  await submit('R00');vi.setSystemTime(new Date('2026-11-03T02:00:00Z'));
  expect((await extend()).status).toBe(200);
  expect((await detail()).storeStatuses.find(s=>s.store_code==='R00').status).toBe('submitted');
  await expect(submit('R00')).rejects.toThrow(/撤回/);
  expect((await call(`/batches/${id}/stores/R00/withdraw`,'POST',{},email.R00)).status).toBe(200);
  expect((await submit('R00')).status).toBe(200);
  vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
  await expect(call(`/batches/${id}/stores/R00/withdraw`,'POST',{},email.R00)).rejects.toThrow(/截止/);
});
it('僅總部可延長，空原因、舊版本、過期／無效時間、縮短與衝突均無副作用',async()=>{
  const before=await detail();
  await expect(extend('R00',undefined,undefined,email.R00)).rejects.toThrow(/總部/);
  await expect(extend('R00',undefined,'')).rejects.toThrow(/原因/);
  await expect(extend('R00','2026-11-01T10:00:00.000Z')).rejects.toThrow(/未來/);
  await expect(extend('R00','invalid')).rejects.toThrow(/未來/);
  await expect(extend('R00','2026-11-03T00:00:00.000Z')).rejects.toThrow(/只能延長/);
  await expect(extend('R00',undefined,undefined,hq,999)).rejects.toThrow(/更新/);
  await expect(call(`/batches/${id}/stores/R99/reply-deadline`,'POST',{deadlineAt:'2026-11-03T10:00:00.000Z',reason:'test',expectedRevision:before.batch.revision})).rejects.toThrow(/門市代碼/);
  await expect(storeTransferRoute(new Request(`https://siangstock.com/api/store-transfer/batches/${id}/stores/R00/reply-deadline`,{method:'POST',headers:{Origin:'https://siangstock.com','Content-Type':'application/json','X-Test-Email':hq,'X-Store-Transfer-Version':'old'},body:'{}'}),env)).rejects.toThrow(/重新載入/);
  expect(await detail()).toEqual(before);
  expect(sql.prepare('SELECT COUNT(*) n FROM store_transfer_reply_extensions').get().n).toBe(0);
});
it('延長與其他人核准競爭時整筆回滾，不留下新期限或假紀錄',async()=>{
  const before=await detail();
  beforeTransaction=()=>sql.prepare('UPDATE store_transfer_batches SET revision=revision+1 WHERE id=?').run(id);
  await expect(extend()).rejects.toThrow(/其他同事更新/);
  const after=await detail();
  expect(after.storeStatuses).toEqual(before.storeStatuses);
  expect(after.items).toEqual(before.items);
  expect(after.replyExtensions).toEqual([]);
});
it('同店再次延長只往後、不縮短，舊畫面儲存仍受版本衝突保護',async()=>{
  const old=await detail();
  expect((await extend()).status).toBe(200);
  await expect(call(`/batches/${id}/stores/R00/save`,'PUT',{expectedRevision:old.batch.revision,items:storeRows('R00')},email.R00)).rejects.toThrow(/其他同事更新/);
  await expect(extend('R00','2026-11-03T09:00:00.000Z')).rejects.toThrow(/只能延長/);
  expect((await extend('R00','2026-11-03T11:00:00.000Z')).status).toBe(200);
  const p=await detail();expect(p.replyExtensions).toHaveLength(2);
  expect(p.replyExtensions[0].previous_deadline_at).toBe('2026-11-03T10:00:00.000Z');
});
it('已核准未產ERP、總部更正中與不存在門市也不能被延長重開',async()=>{
  await submit('R00');expect((await approve('R00')).status).toBe(200);
  const before=await detail();await expect(extend()).rejects.toThrow(/已核准/);expect(await detail()).toEqual(before);
  sql.prepare("UPDATE store_transfer_store_status SET status='saved',correction_mode='hq' WHERE batch_id=? AND store_code='R00'").run(id);
  await expect(extend()).rejects.toThrow(/總部更正/);
  await expect(extend('R06')).rejects.toThrow(/沒有這間門市/);
});
for(const status of ['approved','closed','cancelled','erp_created']) it(`${status}批次不能延長重開`,async()=>{
  sql.prepare('UPDATE store_transfer_batches SET status=? WHERE id=?').run(status,id);
  const before=await detail();await expect(extend()).rejects.toThrow(/待處理/);expect(await detail()).toEqual(before);
});
it('逐店延長不改活動核准日，跨日後活動過期仍阻擋核准',async()=>{
  activityFixture();await submit('R00');
  expect((await extend('R00','2026-11-04T10:00:00.000Z')).status).toBe(200);
  vi.setSystemTime(new Date('2026-11-04T02:00:00Z'));
  await expect(approve('R00')).rejects.toThrow(/實際核准日/);
});
it('原9點批次延至18點後可修改及送出，18點仍截止且不改到貨日',async()=>{
  sql.prepare("UPDATE store_transfer_batches SET lock_at='2099-01-01T01:00:00.000Z',response_due_at='2099-01-01T01:00:00.000Z' WHERE id=?").run(id);
  const schedule=(await detail()).batch.arrival_schedule;
  vi.setSystemTime(new Date('2099-01-01T02:00:00Z'));
  await expect(submit('R00')).rejects.toThrow(/截止/);
  sql.exec('DROP TABLE store_transfer_deadline_adjustments');
  sql.exec(readFileSync('worker/migrations/0050_store_transfer_reply_1800.sql','utf8'));
  const changed=storeRows('R00').map(i=>({...i,confirmedQuantity:i.sku==='ZERO'?0:3,reason:'合成調整'}));
  expect((await call(`/batches/${id}/stores/R00/save`,'PUT',{items:changed},email.R00)).status).toBe(200);
  expect((await call(`/batches/${id}/stores/R00/submit`,'PUT',{items:changed},email.R00)).status).toBe(200);
  expect((await detail()).batch.arrival_schedule).toBe(schedule);
  vi.setSystemTime(new Date('2099-01-01T10:00:00Z'));
  await expect(submit('R01')).rejects.toThrow(/截止/);
});
for (const day of ['2026-11-02','2026-11-03']) it(`活動單店可於${day}核准並匯出，預估日／緩衝／其他店不改`,async()=>{
  const schedule=activityFixture();await submit('R00');const before=await detail();
  vi.setSystemTime(new Date(`${day}T02:00:00Z`));
  expect((await approve('R00',true)).status).toBe(200);
  const p=await detail(),saved=JSON.parse(p.batch.arrival_schedule);
  expect(saved.R00.activityApprovalDate).toBe('2026-11-03');expect(saved.R00.activityBufferDays).toBe(2);
  expect(saved.R00.currentArrivalDate).toBe(day==='2026-11-02'?'2026-11-04':'2026-11-05');
  expect(saved.R01).toEqual(schedule.R01);expect(p.batch.lock_at).toBe(before.batch.lock_at);
  expect(p.items.filter(i=>i.store_code==='R01')).toEqual(before.items.filter(i=>i.store_code==='R01'));
  const file=browser.StoreTransferWorkflow.prepareExports(p,['R00'],browser.StoreTransferCore,browser.XLSX)[0];
  const bytes=browser.XLSX.write(file.workbook,{type:'array',bookType:'xlsx'});
  const wb=browser.XLSX.read(bytes,{type:'array',cellDates:true,cellStyles:true,nodim:true});
  expect(Object.fromEntries(browser.XLSX.utils.sheet_to_json(wb.Sheets['通用貨品數量']).map(r=>[r.貨號,r.數量]))).toEqual({PASS:2,EDIT:3});
  expect((await call(`/batches/${id}/erp-created`,'POST',{storeCodes:['R00'],expectedRevision:p.batch.revision})).status).toBe(200);
  expect((await detail()).storeStatuses.find(s=>s.store_code==='R01').erp_created_at).toBe(null);
});
for(const expected of ['2026-11-03','',null])it(`其他日期或缺預估日${expected}仍阻擋，無核准／ERP副作用`,async()=>{
  activityFixture(expected);await submit('R00');const before=await detail();
  vi.setSystemTime(new Date(`${expected==='2026-11-03'?'2026-11-04':'2026-11-02'}T02:00:00Z`));
  await expect(approve('R00')).rejects.toThrow(/實際核准日/);
  const p=await detail();expect(p.items).toEqual(before.items);expect(p.events).toEqual(before.events);expect(p.batch).toEqual(before.batch);
});
it('活動開單當日整批核准可用，活動改版／取消仍拒絕單店核准',async()=>{
  activityFixture();await submit('R00');
  sql.exec("UPDATE store_transfer_activity_plans SET status='cancelled' WHERE id='SYNTH-ACTIVITY'");
  await expect(approve('R00')).rejects.toThrow(/修改或取消/);
  sql.exec("UPDATE store_transfer_activity_plans SET status='confirmed',revision=3 WHERE id='SYNTH-ACTIVITY'");
  await expect(approve('R00')).rejects.toThrow(/修改或取消/);
  sql.exec("UPDATE store_transfer_activity_plans SET revision=2 WHERE id='SYNTH-ACTIVITY'");
  await submit('R01');const p=await detail();
  const rows=p.items.map(i=>({storeCode:i.store_code,sku:i.sku,itemType:i.item_type,approvedQuantity:2,reason:''}));
  expect((await call(`/batches/${id}/approve`,'POST',{expectedRevision:p.batch.revision,items:rows})).status).toBe(200);
  expect((await detail()).batch.approved_quantity).toBe(12);
});

for (const changed of [false,true]) it(`逐店流程${changed?'含改量與明確歸零':'未改量'}：一家核准匯出、另一家仍可送審，最後整批完成`,async()=>{
  await submit('R00'); const before=await detail();
  expect(browser.StoreTransferWorkflow.approvalStores(before).map(s=>s.store_code)).toEqual(['R00']);
  const other=JSON.stringify(before.items.filter(i=>i.store_code==='R01'));
  expect((await approve('R00',changed)).status).toBe(200);
  let p=await detail();
  expect(p.batch.status).toBe('open');
  expect(p.storeStatuses.find(s=>s.store_code==='R01').status).toBe('pending');
  expect(JSON.stringify(p.items.filter(i=>i.store_code==='R01'))).toBe(other);
  expect(p.batch.approved_quantity).toBe(changed?5:6);
  expect(browser.StoreTransferWorkflow.exportStores(p).map(s=>s.store_code)).toEqual(['R00']);
  const file=browser.StoreTransferWorkflow.prepareExports(p,['R00'],browser.StoreTransferCore,browser.XLSX)[0];
  const bytes=browser.XLSX.write(file.workbook,{type:'array',bookType:'xlsx'});
  const loaded=browser.XLSX.read(bytes,{type:'array',cellStyles:true,cellDates:true});
  const rows=browser.XLSX.utils.sheet_to_json(loaded.Sheets['通用貨品數量']);
  expect(Object.fromEntries(rows.map(r=>[r.貨號,r.數量]))).toEqual(changed?{PASS:2,EDIT:3}:{PASS:2,EDIT:2,ZERO:2});
  expect((await call(`/batches/${id}/erp-created`,'POST',{storeCode:'R00',expectedRevision:p.batch.revision})).status).toBe(200);
  const exported=JSON.stringify((await detail()).items.filter(i=>i.store_code==='R00'));
  vi.setSystemTime(new Date('2026-11-03T02:00:00Z'));
  // HQ can assist after the store deadline, without changing the first store.
  expect((await call(`/batches/${id}/stores/R01/submit`,'PUT',{items:storeRows('R01')})).status).toBe(200);
  expect((await detail()).batch.item_count).toBe(changed?5:6);
  expect((await approve('R01')).status).toBe(200); p=await detail();
  expect(p.batch.status).toBe('approved');
  expect(JSON.stringify(p.items.filter(i=>i.store_code==='R00'))).toBe(exported);
  const schedule=JSON.parse(p.batch.arrival_schedule);
  expect(schedule.R00.currentArrivalDate).toBe('2026-11-04');expect(schedule.R01.currentArrivalDate).toBe('2026-11-05');
  const files=browser.StoreTransferWorkflow.prepareExports(p,['R00','R01'],browser.StoreTransferCore,browser.XLSX);
  expect(files.map(f=>f.filename)).toEqual(['2026-W45_R00_ERP調撥單.xlsx','2026-W45_R01_ERP調撥單.xlsx']);
  await call(`/batches/${id}/erp-created`,'POST',{storeCodes:['R00','R01'],expectedRevision:p.batch.revision});
  expect((await detail()).batch.status).toBe('erp_created');
  expect((await call(`/batches/${id}/close`,'POST',{})).status).toBe(200);
});

it('不能核准未送出門市、不能含別店明細、不能略過角色與版本',async()=>{
  await expect(approve('R00')).rejects.toThrow(/尚未送出/);
  await submit('R00');const p=await detail();
  const body={expectedRevision:p.batch.revision,items:items('R01').map(i=>({...i,approvedQuantity:2}))};
  await expect(call(`/batches/${id}/stores/R00/approve`,'POST',body)).rejects.toThrow(/其它門市/);
  await expect(call(`/batches/${id}/stores/R00/approve`,'POST',body,email.R00)).rejects.toThrow(/總部/);
  await expect(call(`/batches/${id}/stores/R00/approve`,'POST',{...body,expectedRevision:0})).rejects.toThrow(/其他同事/);
});
it('未核准／混合下載、重複選店、過期匯出全部阻擋而不記錄部分成功',async()=>{
  await submit('R00');await approve('R00');const p=await detail();
  expect(()=>browser.StoreTransferWorkflow.prepareExports(p,['R00','R01'],browser.StoreTransferCore,browser.XLSX)).toThrow(/尚未核准/);
  for(const body of [{storeCodes:['R00','R01']},{storeCodes:['R00','R00']},{storeCode:'R00',expectedRevision:1}]) await expect(call(`/batches/${id}/erp-created`,'POST',body)).rejects.toThrow();
  expect((await detail()).storeStatuses.every(s=>!s.erp_created_at)).toBe(true);
});
it('已核准門市不再允許門市或整批覆核直接改量，重複核准不再寫入',async()=>{
  await submit('R00');await approve('R00');
  await expect(approve('R00')).rejects.toThrow(/已核准/);
  await expect(call(`/batches/${id}/stores/R00/save`,'PUT',{items:storeRows('R00')},email.R00)).rejects.toThrow(/已核准/);
  const p=await detail(),rows=p.items.map(i=>({storeCode:i.store_code,sku:i.sku,itemType:i.item_type,approvedQuantity:i.store_code==='R00'?3:2,reason:'不得改已核准'}));
  await expect(call(`/batches/${id}/hq-save`,'PUT',{items:rows})).rejects.toThrow(/已核准/);
});
it('第一店已核准後，原整批核准仍可處理剩餘門市且保留第一店日期與內容',async()=>{
  await submit('R00');await approve('R00');await submit('R01');
  vi.setSystemTime(new Date('2026-11-03T02:00:00Z'));
  const p=await detail(),before=JSON.stringify(p.items.filter(i=>i.store_code==='R00'));
  const rows=p.items.map(i=>({storeCode:i.store_code,sku:i.sku,itemType:i.item_type,approvedQuantity:i.hq_approved_quantity??i.store_confirmed_quantity??i.suggested_quantity,reason:i.hq_reason||''}));
  expect((await call(`/batches/${id}/approve`,'POST',{items:rows})).status).toBe(200);
  const after=await detail();expect(after.batch.status).toBe('approved');expect(after.batch.approved_quantity).toBe(12);
  expect(JSON.stringify(after.items.filter(i=>i.store_code==='R00'))).toBe(before);
});
it('逐店核准原子衝突回滾，不寫任何品項、狀態、事件或缺貨台帳',async()=>{
  await submit('R00');const before=await detail();
  beforeTransaction=()=>sql.prepare('UPDATE store_transfer_batches SET revision=revision+1 WHERE id=?').run(id);
  await expect(approve('R00',true)).rejects.toThrow(/其他同事/);
  const after=await detail();expect(after.items).toEqual(before.items);expect(after.storeStatuses).toEqual(before.storeStatuses);expect(after.events).toEqual(before.events);
  expect(sql.prepare('SELECT COUNT(*) n FROM store_transfer_procurement_need_history').get().n).toBe(0);
});
it('已核准供應量仍占用且明確零釋出，後店不可超配',async()=>{
  await submit('R00');await approve('R00',true);
  // Force a tight original supply ceiling, then attempt an increase by store 2.
  sql.exec(`UPDATE store_transfer_items SET decision_snapshot=json_set(decision_snapshot,'$.hqSupplyCeiling',4)`);
  const rows=storeRows('R01');rows.find(r=>r.sku==='EDIT').confirmedQuantity=2;
  await expect(call(`/batches/${id}/stores/R01/submit`,'PUT',{items:rows},email.R01)).rejects.toThrow(/供應量不足/);
  const p=await detail();expect(p.supplyUsage.EDIT.currentAllocated).toBe(5);expect(p.supplyUsage.ZERO.currentAllocated).toBe(2);
});
it('部分完成批次可開啟未匯出店更正，匯出過的店不受影響；更正中不允許下載',async()=>{
  await submit('R00');await approve('R00');
  await call(`/batches/${id}/corrections/open`,'POST',{storeCode:'R00',mode:'hq',reason:'合成更正'});
  let p=await detail();expect(browser.StoreTransferWorkflow.exportStores(p)).toHaveLength(0);
  await expect(call(`/batches/${id}/erp-created`,'POST',{storeCode:'R00'})).rejects.toThrow(/更正中/);
  await approve('R00');p=await detail();expect(p.storeStatuses.find(s=>s.store_code==='R00').correction_mode).toBe(null);
  await call(`/batches/${id}/erp-created`,'POST',{storeCode:'R00'});
  await expect(call(`/batches/${id}/corrections/open`,'POST',{storeCode:'R00',mode:'hq',reason:'不可再更正'})).rejects.toThrow(/已產生ERP/);
});
it('ERP輸出守恆不符時零產檔，核准0與舊資料未設定值不混淆',async()=>{
  await submit('R00');await approve('R00',true);const p=await detail();
  const broken={buildErpWorkbook(...args){const wb=browser.StoreTransferCore.buildErpWorkbook(...args);wb.Sheets['通用貨品數量']=browser.XLSX.utils.aoa_to_sheet([['貨號','數量'],['PASS',99]]);return wb;}};
  expect(()=>browser.StoreTransferWorkflow.prepareExports(p,['R00'],broken,browser.XLSX)).toThrow(/不一致/);
  expect((await detail()).storeStatuses.every(s=>!s.erp_created_at)).toBe(true);
});

it('逐店總部人工新增與移除保留理由，ERP只含選定店最終核准量',async()=>{
  await submit('R00');const p=await detail();
  const rows=p.items.filter(i=>i.store_code==='R00').map(i=>({storeCode:'R00',sku:i.sku,itemType:i.item_type,approvedQuantity:i.sku==='ZERO'?0:2,reason:i.sku==='ZERO'?'合成移除':''}));
  rows.push({storeCode:'R00',sku:'ADD',itemType:'regular',approvedQuantity:1,reason:'合成人工新增'});
  await call(`/batches/${id}/stores/R00/approve`,'POST',{expectedRevision:p.batch.revision,items:rows});
  const after=await detail();const file=browser.StoreTransferWorkflow.prepareExports(after,['R00'],browser.StoreTransferCore,browser.XLSX)[0];
  const output=browser.XLSX.utils.sheet_to_json(file.workbook.Sheets['通用貨品數量']);
  expect(Object.fromEntries(output.map(r=>[r.貨號,r.數量]))).toEqual({PASS:2,EDIT:2,ADD:1});
  expect(after.items.find(i=>i.sku==='ADD').hq_reason).toBe('合成人工新增');
});
it('逐店核准僅回拋該店缺貨，尚未核准店台帳不被提前建立',async()=>{
  for(const store of ['R00','R01']) sql.prepare("INSERT INTO store_transfer_shortages(batch_id,store_code,sku,product_name,item_type,demand_quantity,allocated_quantity,unfilled_quantity,reason,follow_up_status,created_at,updated_at) VALUES(?,?,?,?,?,5,2,3,?,?,'2026-11-02T02:00:00Z','2026-11-02T02:00:00Z')").run(id,store,'PASS','合成品','regular','合成缺貨','待回拋主採購');
  await submit('R00');await approve('R00');
  expect(sql.prepare('SELECT store_code,unfilled_quantity FROM store_transfer_procurement_needs').all()).toEqual([{store_code:'R00',unfilled_quantity:3}]);
  expect(sql.prepare('SELECT COUNT(*) n FROM store_transfer_procurement_need_history').get().n).toBe(1);
  await submit('R01');await approve('R01');
  expect(sql.prepare('SELECT COUNT(*) n FROM store_transfer_procurement_need_history').get().n).toBe(2);
});
it('匯出前遇更正或新版，整批產檔記錄原子回滾',async()=>{
  await submit('R00');await approve('R00');const p=await detail();
  beforeTransaction=()=>sql.prepare('UPDATE store_transfer_batches SET revision=revision+1 WHERE id=?').run(id);
  await expect(call(`/batches/${id}/erp-created`,'POST',{storeCode:'R00',expectedRevision:p.batch.revision})).rejects.toThrow(/其他同事/);
  expect((await detail()).storeStatuses.every(s=>!s.erp_created_at)).toBe(true);
});
it('同週重建不可取消部分核准批次，原門市與ERP紀錄不變',async()=>{
  await submit('R00');await approve('R00');const p=await detail();
  await expect(call('/batches','POST',{id:'TR-NEW',weekKey:'2026-W45',proposalDate:'2026-11-02',responseDueAt:'2026-11-03T01:00:00Z',lockAt:'2026-11-03T01:00:00Z',items:items('R01')})).rejects.toThrow(/不能直接取代/);
  const after=await detail();expect(after.batch).toEqual(p.batch);expect(after.storeStatuses).toEqual(p.storeStatuses);expect(after.events).toEqual(p.events);
  expect(sql.prepare("SELECT COUNT(*) n FROM store_transfer_batches WHERE id='TR-NEW'").get().n).toBe(0);
});

it('新補貨銷售快照經正式API保存後仍保留數字，不保存備註原文',async()=>{const p=await detail(),snap=JSON.parse(p.items.find(i=>i.sku==='PASS').decision_snapshot);expect(snap).toMatchObject({salesBasisVersion:2,warehouseDemandSales42:42,replenishmentSales42:46});expect(snap.remark).toBeUndefined();});

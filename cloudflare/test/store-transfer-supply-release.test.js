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
  return storeTransferRoute(new Request(`https://siangstock.com/api/store-transfer${path}`, { method, headers: { Origin: 'https://siangstock.com', 'Content-Type': 'application/json', 'X-Test-Email': actor, 'X-Store-Transfer-Version': '20261109-transfer-supply-release-r1' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
}
const detail = async () => (await call(`/batches/${id}`)).json();
const items = store => ['PASS', 'EDIT', 'ZERO'].map(sku => ({storeCode:store,sku,productName:`合成${sku}`,suggestedQuantity:2,itemType:'regular',calculationDate:'2026-11-04',decisionSnapshot:{hqAvailable:20,hqReleasable:20,hqSupplyCeiling:20}}));
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


function quotaFixture() {
  sql.prepare("INSERT INTO store_transfer_batch_product_catalog(batch_id,sku,product_name,hq_available,hq_reserve,hq_releasable,created_at) VALUES(?,'RELEASE','合成安全保留商品',59,59,0,'2026-11-02')").run(id);
  for(const store of ['R00','R01']) sql.prepare("INSERT INTO store_transfer_manual_item_facts(batch_id,store_code,sku,product_name,calculation_date,hq_available,hq_reserve,hq_releasable,created_at) VALUES(?,?,'RELEASE','合成安全保留商品','2026-11-04',59,59,0,'2026-11-02')").run(id,store);
}
async function release(n=3,reason='合成補貨延遲支援門市',actor=hq,revision) {
 const q=await (await call(`/batches/${id}/supply-release?sku=RELEASE`)).json();
 return call(`/batches/${id}/supply-release?sku=RELEASE`,'PUT',{extraQuantity:n,reason,expectedRevision:revision ?? q.expectedRevision},actor);
}
async function add(store,n,submit=false){
 const p=await detail();
 const rows=p.items.filter(i=>i.store_code===store).map(i=>({sku:i.sku,itemType:i.item_type,confirmedQuantity:i.sku==='RELEASE'?n:i.store_confirmed_quantity ?? i.suggested_quantity,reason:i.sku==='RELEASE'?'合成顧客需求':i.store_reason}));
 if(!rows.some(r=>r.sku==='RELEASE'))rows.push({sku:'RELEASE',itemType:'regular',confirmedQuantity:n,reason:'合成顧客需求'});
 return call(`/batches/${id}/stores/${store}/${submit?'submit':'save'}`,'PUT',{items:rows,expectedRevision:p.batch.revision},email[store]);
}
it('原批次零可供應，開放後六店共用：暫存占用／取消退回／送出不重扣／核准及ERP守恆',async()=>{
 quotaFixture();const before=await detail();
 await expect(add('R00',2)).rejects.toThrow(/供應量不足/);
 expect((await release()).status).toBe(200);
 const opened=await detail();expect(opened.items).toEqual(before.items);expect(opened.batch.suggested_quantity).toBe(before.batch.suggested_quantity);
 expect((await add('R00',2)).status).toBe(200);
 const fact=await (await call(`/batches/${id}/manual-item-fact?store=R01&sku=RELEASE`,'GET',undefined,email.R01)).json();expect(fact).toMatchObject({hqReleasable:3,otherAllocated:2,supplyReleaseOpen:true});
 await expect(add('R01',2)).rejects.toThrow(/供應量不足/);
 expect((await add('R01',1)).status).toBe(200);
 await expect(release(2)).rejects.toThrow(/低於/);
 expect((await add('R00',0)).status).toBe(200);
 expect((await release(1)).status).toBe(200);
 expect((await add('R00',0,true)).status).toBe(200);
 expect((await add('R01',1,true)).status).toBe(200);
 const p=await detail();
 const response=await call(`/batches/${id}/approve`,'POST',{expectedRevision:p.batch.revision,items:p.items.map(i=>({storeCode:i.store_code,sku:i.sku,itemType:i.item_type,approvedQuantity:i.store_confirmed_quantity ?? i.suggested_quantity,reason:'合成總部覆核'}))});expect(response.status).toBe(200);
 const approved=await detail();const files=browser.StoreTransferWorkflow.prepareExports(approved,['R00','R01'],browser.StoreTransferCore,browser.XLSX);
 for(const f of files){const wb=browser.XLSX.read(browser.XLSX.write(f.workbook,{type:'array',bookType:'xlsx'}),{type:'array',cellDates:true,cellStyles:true,nodim:true});const rows=browser.XLSX.utils.sheet_to_json(wb.Sheets['通用貨品數量']);expect(rows.reduce((s,r)=>s+Number(r.數量),0)).toBe(f.filename.includes('_R00_')?6:7);}
 expect(sql.prepare('SELECT COUNT(*) n FROM store_transfer_supply_release_events').get().n).toBe(2);
});
it('僅總部可開放；未知供應、超實體、空原因、負值、小數、舊版本皆拒絕且不改業務量',async()=>{
 quotaFixture();const before=await detail();
 await expect(call(`/batches/${id}/supply-release?sku=RELEASE`,'GET',undefined,email.R00)).rejects.toThrow(/總部/);
 for(const n of [-1,1.5,60]) await expect(release(n)).rejects.toThrow();
 await expect(release(2,'')).rejects.toThrow(/原因/);
 await expect(release(2,undefined,hq,999)).rejects.toThrow(/更新/);
 sql.prepare("UPDATE store_transfer_batch_product_catalog SET hq_available=NULL WHERE sku='RELEASE'").run();
 await expect(release()).rejects.toThrow(/未知/);
 expect((await detail()).items).toEqual(before.items);expect(sql.prepare('SELECT COUNT(*) n FROM store_transfer_supply_releases').get().n).toBe(0);
});
it('競爭開放／暫存以批次CAS整批回滾，稽核不留半套；額度不跨批次沿用',async()=>{
 quotaFixture();beforeTransaction=()=>sql.prepare('UPDATE store_transfer_batches SET revision=revision+1 WHERE id=?').run(id);
 await expect(release()).rejects.toThrow(/更新/);expect(sql.prepare('SELECT COUNT(*) n FROM store_transfer_supply_release_events').get().n).toBe(0);
 await release(3);
 beforeTransaction=()=>{sql.prepare('UPDATE store_transfer_batches SET revision=revision+1 WHERE id=?').run(id);};
 await expect(add('R00',2)).rejects.toThrow(/更新/);expect(sql.prepare("SELECT COUNT(*) n FROM store_transfer_items WHERE sku='RELEASE'").get().n).toBe(0);
 expect((await (await call(`/batches/${id}/manual-item-fact?store=R00&sku=RELEASE`)).json()).otherAllocated).toBe(0);
 expect(sql.prepare('SELECT DISTINCT batch_id FROM store_transfer_supply_releases').all()).toEqual([{batch_id:id}]);
});
it('既有列加量及總部人工新增都採有效額度；歸零不以預設值回填，原快照不改寫',async()=>{
 quotaFixture();await release(3);await add('R00',2);
 const raw=sql.prepare("SELECT decision_snapshot FROM store_transfer_items WHERE sku='RELEASE'").get();expect(JSON.parse(raw.decision_snapshot).hqSupplyCeiling).toBe(0);
 const p=await detail();expect(JSON.parse(p.items.find(i=>i.sku==='RELEASE').decision_snapshot).hqSupplyCeiling).toBe(3);
 const rows=p.items.map(i=>({storeCode:i.store_code,sku:i.sku,itemType:i.item_type,approvedQuantity:i.store_confirmed_quantity ?? i.suggested_quantity,reason:'合成覆核'}));
 rows.push({storeCode:'R01',sku:'RELEASE',itemType:'regular',approvedQuantity:2,reason:'合成新增'});
 await expect(call(`/batches/${id}/hq-save`,'PUT',{items:rows,expectedRevision:p.batch.revision})).rejects.toThrow(/可供應/);
 rows.at(-1).approvedQuantity=1;expect((await call(`/batches/${id}/hq-save`,'PUT',{items:rows,expectedRevision:p.batch.revision})).status).toBe(200);
 await expect(add('R00',3)).rejects.toThrow(/供應/);
});

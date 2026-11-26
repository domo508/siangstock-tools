import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('../worker/src/access',()=>({verifyCompanyUser:vi.fn(async r=>r.headers.get('X-Test-Email')||'siang01@siangapato.com.tw')}));
import {storeTransferRoute} from '../worker/src/store-transfer';
import {newProductSeedStatements,activateNewProductStatements,newProductCalculationState} from '../worker/src/new-products';
const browser={console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer};vm.createContext(browser);
for(const f of ['../inventory/assets/xlsx.full.min.js','../store-transfer/new-candidates-core.js','../store-transfer/new-products-core.js'])vm.runInContext(readFileSync(f,'utf8'),browser);
const C=browser.NewProductCandidates,N=browser.NewProductAllocation;let sql,env;
beforeEach(()=>{sql=new DatabaseSync(':memory:');for(const f of readdirSync('worker/migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('worker/migrations/'+f,'utf8'));
const DB={prepare(q){let a=[];return {bind(...args){a=args;return this;},async first(){return sql.prepare(q).get(...a)||null;},async all(){return {results:sql.prepare(q).all(...a)};},async run(){return {meta:{changes:Number(sql.prepare(q).run(...a).changes)}};}};},async batch(stmts){sql.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};env={DB,ALLOWED_ORIGINS:'https://siangstock.com'};vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-23T02:00:00Z'));});
afterEach(()=>{sql.close();vi.useRealTimers();});
async function call(body,email='siang01@siangapato.com.tw',extra={}){const response=await storeTransferRoute(new Request('https://siangstock.com/api/store-transfer/new-products/candidates',{method:body?'POST':'GET',headers:{Origin:'https://siangstock.com','Content-Type':'application/json','X-Test-Email':email,'X-New-Candidate-Version':C.VERSION,...extra},...(body?{body:JSON.stringify(body)}:{})}),env);return response.json();}
const row=(sku,date='2026-11-01')=>({sku,name:'合成 '+sku,createdDate:date});
const scan=(current=[row('N1')],baseline=[{sku:'OLD'}],extra={})=>({action:'scan',expectedRevision:1,sourceHash:'a'.repeat(64),sourceAt:'2026-11-13T00:00:00Z',current,baseline,...extra});
const decide=(skus=['N1'],status='prelaunch',expectedRevision=2)=>call({action:'decide',expectedRevision,skus,status});
const facts=()=>Object.fromEntries(['procurement_batches','procurement_batch_items','store_transfer_batches','store_transfer_items','new_product_plans','new_product_plan_rows','new_product_notifications'].map(t=>[t,sql.prepare('SELECT * FROM '+t).all()]));
it('首次用舊主檔建立基準，僅新增90天內全新品號；重跑／名稱變更／重現不重複',async()=>{await call(scan([row('OLD'),row('N1'),row('STALE','2026-01-01'),row('FUTURE','2027-01-01')]));expect((await call()).rows.map(r=>r.sku)).toEqual(['N1']);expect((await call(scan([row('N1')],[{sku:'OLD'}],{expectedRevision:2}))).unchanged).toBe(true);await call(scan([row('N1'),row('OLD'),row('STALE')],[{sku:'N1'}],{expectedRevision:2,sourceHash:'b'.repeat(64),sourceAt:'2026-11-20T00:00:00Z'}));expect((await call()).rows).toHaveLength(1);});
it('90天邊界含當日，超過與未來不猜測；只用新增日期',async()=>{await call(scan([row('D0','2026-11-23'),row('D90','2026-08-25'),row('D91','2026-08-24'),row('F','2026-11-24'),row('EMPTY','')]));expect(new Set((await call()).rows.map(r=>r.sku))).toEqual(new Set(['D0','D90']));});
it('待確認不控制缺貨；確認待上市才控制，且不建立採購／門市首配／寄信',async()=>{const before=facts();await call(scan());expect((await newProductCalculationState(env)).registry).toHaveLength(0);await decide();const state=await newProductCalculationState(env);expect(state.registry.map(r=>r.sku)).toEqual(['N1']);expect(N.need(N.context(state,{records:[]},['R00']),'R00','N1',3)).toBe(0);expect(facts()).toEqual(before);});
it('一般商品不反覆提示，可修正尚未到貨分類；不追溯舊批次',async()=>{await call(scan());await decide(['N1'],'ordinary');expect((await newProductCalculationState(env)).registry).toHaveLength(0);await decide(['N1'],'prelaunch',3);expect((await call()).rows[0].effective_status).toBe('prelaunch');await decide(['N1'],'ordinary',4);expect((await newProductCalculationState(env)).registry).toHaveLength(0);});
it('待上市超過90天不失效；有門市實體現貨立即回一般，正式觀察後零庫存也不倒退',async()=>{await call(scan());await decide();vi.setSystemTime(new Date('2027-03-01T02:00:00Z'));let state=await newProductCalculationState(env);expect(N.context(state,{records:[]},['R00']).waiting.has('N1')).toBe(true);const stock={records:[{sku:'N1',warehouseCode:'R00',quantity:1}]};expect(N.need(N.context(state,stock,['R00']),'R00','N1',3)).toBe(3);
await storeTransferRoute(new Request('https://siangstock.com/api/store-transfer/new-products/observe',{method:'POST',headers:{Origin:'https://siangstock.com','Content-Type':'application/json','X-New-Product-Version':'20261116-new-product-allocation-r3'},body:JSON.stringify({observedOn:'2027-03-01',items:[{sku:'N1'}]})}),env);state=await newProductCalculationState(env);expect(N.need(N.context(state,{records:[]},['R00']),'R00','N1',3)).toBe(3);expect((await call()).rows[0].effective_status).toBe('arrived');await expect(decide(['N1'],'prelaunch',3)).rejects.toThrow(/到貨|接手/);});
it('存量負數不可與其他倉正數相抵，非實體倉不當到貨；原首配仍只看T00',()=>{const payload={registry:[{sku:'N',prepurchase:1},{sku:'EXIST'}],rows:[]},inventory={records:[{sku:'N',warehouseCode:'R00',quantity:2},{sku:'N',warehouseCode:'T00',quantity:-2},{sku:'EXIST',warehouseCode:'R00',quantity:2}]};const ctx=N.context(payload,inventory,['R00']);expect(ctx.hasStock.has('N')).toBe(true);expect(ctx.hasStock.has('EXIST')).toBe(false);expect(N.context(payload,{records:[{sku:'N',warehouseCode:'B3',quantity:2}]},['R00']).hasStock.has('N')).toBe(false);});
async function purchase(sku='N1'){sql.exec(`INSERT INTO procurement_batches(id,analysis_month,supplier_summary,payment_schedule,warning_summary,blocked_amount,workflow_type,status,suggested_amount,manual_amount,approved_amount,adjustment_amount,budget_amount,payment_current_month,payment_future_months,created_at,created_by,updated_at,idempotency_key) VALUES('P','2026-11','[]','[]','',0,'new_product','pending_approval',100,100,100,0,100,100,0,'2026-11-23','hq','2026-11-23','K');`);await env.DB.batch(newProductSeedStatements(env,'P',[{sku,name:'合成新品',listedDate:'2026-12-01',stores:{R00:2},evidence:'14天'}],[{sku,quantity:2}],'hq','2026-11-23'));}
it('下採銜接既有流程，同品號不重建候選或首配、不重寄；確認不能越過採購接手',async()=>{await call(scan());await decide();await purchase();expect((await call()).rows[0].effective_status).toBe('procurement');await expect(decide(['N1'],'ordinary',3)).rejects.toThrow(/接手/);expect((await newProductCalculationState(env)).registry).toHaveLength(1);sql.exec("UPDATE procurement_batches SET status='approved' WHERE id='P'");await env.DB.batch(activateNewProductStatements(env,'P','hq','2026-11-23'));expect(sql.prepare('SELECT COUNT(*) n FROM new_product_plans').get().n).toBe(1);expect(sql.prepare('SELECT COUNT(*) n FROM new_product_plan_rows').get().n).toBe(1);expect(sql.prepare('SELECT COUNT(*) n FROM new_product_notifications').get().n).toBe(1);});
it('候選到貨紀錄銜接主採購不遺失',async()=>{await call(scan());await decide();sql.exec("UPDATE new_product_candidates SET first_stock_date='2026-11-20'");await purchase();expect((await newProductCalculationState(env)).registry[0].first_stock_date).toBe('2026-11-20');});
it.each(['tpzssa@siangapato.com.tw','oliver@siangapato.com.tw','xyz11619@siangapato.com.tw'])('門市與督導不得讀取或寫入候選 %s',async email=>{await expect(call(null,email)).rejects.toThrow();await expect(call(scan(),email)).rejects.toThrow();expect(sql.prepare('SELECT COUNT(*) n FROM new_product_candidates').get().n).toBe(0);});
it('跨來源、過期版、CAS與批次重複全數拒絕不半寫',async()=>{await expect(call(scan(),undefined,{Origin:'https://evil.example'})).rejects.toThrow();await expect(call(scan(),undefined,{'X-New-Candidate-Version':'old'})).rejects.toThrow(/新版/);await expect(call(scan([row('N1'),row('N1')]))).rejects.toThrow(/重複/);expect((await call()).revision).toBe(1);await call(scan());await expect(decide(['N1','NO'])).rejects.toThrow(/候選/);expect((await call()).rows[0].status).toBe('pending');await decide();await expect(decide()).rejects.toThrow(/其他同仁/);});
it('同時間不同內容與倒退版本阻擋、無效日期拒絕',async()=>{await expect(call(scan([row('BAD','2026-02-30')]))).rejects.toThrow(/日期/);await call(scan());await expect(call(scan(undefined,undefined,{expectedRevision:2,sourceHash:'b'.repeat(64)}))).rejects.toThrow(/相同來源/);await expect(call(scan(undefined,undefined,{expectedRevision:2,sourceHash:'b'.repeat(64),sourceAt:'2026-10-01T00:00:00Z'}))).rejects.toThrow(/版本舊/);});
function workbook(rows){const X=browser.XLSX,w=X.utils.book_new();X.utils.book_append_sheet(w,X.utils.aoa_to_sheet(rows),'工作表1');return X.read(X.write(w,{type:'array',bookType:'xlsx'}),{type:'array',dense:true,cellStyles:false,cellDates:true,nodim:true});}
it('實際XLSX往返：建立日期與更新／上市日期分離，數字日期與時間不偏移',()=>{const w=workbook([['貨號','品名','新增日期','更新日期','上市日期'],['N','新品','2026-09-01 23:59:59','2026-11-23','2026-12-01'],['E','數字',46349,'','']]);const r=C.parse(w,browser.XLSX);expect(r.rows[0].createdDate).toBe('2026-09-01');expect(r.rows[1].createdDate).toMatch(/^2026-/);expect(C.createdDate('1753-01-01',browser.XLSX)).toBe('');expect(C.createdDate('2026-02-30',browser.XLSX)).toBe('');});
it.each([[['貨號','品名'],['N','新品']],[['貨號','品名','新增日期'],['N','新品','2026-11-01'],['N','重複','2026-11-02']],[['貨號','品名','新增日期'],['N','','2026-11-01']],[['貨號','品名','新增日期']]].map(rows=>[rows]))('真實格式缺欄／重複／缺值／全空阻擋 %#',rows=>{expect(()=>C.parse(workbook(rows),browser.XLSX)).toThrow();});
it('舊主檔只需品號與品名，新增日期未知不猜；版本缺漏與同時最新拒絕',()=>{expect(C.parse(workbook([['貨號','品名'],['OLD','舊品']]),browser.XLSX,true).rows).toEqual([{sku:'OLD'}]);expect(()=>C.parse(workbook([['貨號','品名','新增日期'],['N','新品','???']]),browser.XLSX)).toThrow(/所有新增日期/);expect(C.parse(workbook([['貨號','品名','新增日期'],['N','新品','???'],['OK','正常','2026-11-01']]),browser.XLSX).invalid).toEqual([{row:2,sku:'N'}]);expect(()=>C.versions([])).toThrow();expect(()=>C.versions([{modifiedTime:'2026-11-01'},{modifiedTime:'2026-11-01'}])).toThrow();});

it('資料庫互斥檢查失敗整批回滾，不留下半批候選或稽核',async()=>{await call(scan());const before=sql.prepare('SELECT revision FROM new_product_master_state').get().revision;sql.exec("CREATE TRIGGER synthetic_lifecycle_race BEFORE UPDATE OF status ON new_product_candidates BEGIN SELECT RAISE(ABORT,'new_product_candidate_lifecycle_conflict'); END;");await expect(decide()).rejects.toThrow(/更新/);expect(sql.prepare('SELECT revision FROM new_product_master_state').get().revision).toBe(before);expect(sql.prepare('SELECT status FROM new_product_candidates').get().status).toBe('pending');expect(sql.prepare("SELECT COUNT(*) n FROM new_product_candidate_events WHERE action='decide'").get().n).toBe(0);});

it.each(['SA','SB','OA','OB'])('客製%s開頭不新建候選，大小寫／全形同口徑，保留曾出現品號',async prefix=>{
 const full=[...prefix].map(c=>String.fromCharCode(c.charCodeAt(0)+0xfee0)).join('');
 await call(scan([row(prefix+'-UPPER'),row(prefix.toLowerCase()+'-lower'),row(full+'-FULL'),row('NORMAL'),row('XZ1'),row('AS1')]));
 expect((await call()).rows.map(r=>r.sku).sort()).toEqual(['AS1','NORMAL','XZ1']);
 expect(sql.prepare('SELECT COUNT(*) n FROM new_product_master_seen').get().n).toBe(7);
 for(const sku of [prefix+'1',prefix.toLowerCase()+'1',full+'1'])expect(C.isCustomSku(sku)).toBe(true);
 expect(C.isCustomSku('X'+prefix+'1')).toBe(false);
});
function legacyCandidate(sku,status='pending'){
 sql.prepare("INSERT INTO new_product_master_seen VALUES(?,'2026-11-01','2026-11-23')").run(sku);
 sql.prepare("INSERT INTO new_product_candidates(sku,name,created_date,status,updated_at,updated_by) VALUES(?,'合成既有候選','2026-11-01',?,'2026-11-23','test')").run(sku,status);
}
it('已存在的客製候選即時排除查詢與全選資料，保留原分類及稽核，不必重新匯主檔',async()=>{
 legacyCandidate('SA-OLD');legacyCandidate('oa-old');legacyCandidate('ＳＢ-FULL');legacyCandidate('KEEP');
 sql.exec("INSERT INTO new_product_candidate_events(action,payload,created_at,created_by) VALUES('scan','{}','2026-11-23','test')");
 const before=facts(),result=await call();expect(result.rows.map(r=>r.sku)).toEqual(['KEEP']);expect(result.excludedCustomCount).toBe(3);
 expect(sql.prepare('SELECT COUNT(*) n FROM new_product_candidates').get().n).toBe(4);
 expect(sql.prepare('SELECT COUNT(*) n FROM new_product_candidate_events').get().n).toBe(1);expect(facts()).toEqual(before);
});
it('混合批次包含客製品號整批阻擋，保留一般候選與確認歷史',async()=>{
 legacyCandidate('SB-OLD');legacyCandidate('KEEP');
 await expect(decide(['KEEP','ＳＢ-OLD'],'prelaunch',1)).rejects.toThrow(/客製品號/);
 expect(sql.prepare("SELECT COUNT(*) n FROM new_product_candidates WHERE status='pending'").get().n).toBe(2);
 expect(sql.prepare('SELECT revision FROM new_product_master_state').get().revision).toBe(1);
 expect(sql.prepare('SELECT COUNT(*) n FROM new_product_candidate_events').get().n).toBe(0);
});
it('已確認待上市的客製候選不再控制補貨，歷史不刪；既有正式採購與首配仍保留',async()=>{
 legacyCandidate('OB-OLD','prelaunch');legacyCandidate('KEEP','prelaunch');
 let state=await newProductCalculationState(env);expect(state.registry.map(r=>r.sku)).toEqual(['KEEP']);
 expect(sql.prepare("SELECT status FROM new_product_candidates WHERE sku='OB-OLD'").get().status).toBe('prelaunch');
 await purchase('OA-PURCHASED');const before=facts();state=await newProductCalculationState(env);
 expect(state.registry.some(r=>r.sku==='OA-PURCHASED')).toBe(true);expect(facts()).toEqual(before);
});


it.each(['O','OC','OD','O1','O9','OZ','o','Ｏ'])('所有O開頭組合貨號%s不列候選，正常AO／XO不誤排',async prefix=>{
 await call(scan([row(prefix+'-BUNDLE'),row('AO1'),row('XO1'),row('SX1')]));
 expect((await call()).rows.map(r=>r.sku).sort()).toEqual(['AO1','SX1','XO1']);
 expect(C.isCustomSku(prefix+'-BUNDLE')).toBe(true);
 expect(sql.prepare('SELECT COUNT(*) n FROM new_product_master_seen').get().n).toBe(5);
});
it('既有O組合候選排除且不刪歷史；混合確認被擋，正式組合採購不受影響',async()=>{
 legacyCandidate('OC-OLD','prelaunch');legacyCandidate('o9-old');legacyCandidate('Ｏ-FULL');legacyCandidate('AO1');
 const result=await call();expect(result.rows.map(r=>r.sku)).toEqual(['AO1']);expect(result.excludedCustomCount).toBe(3);
 await expect(decide(['AO1','OC-OLD'],'prelaunch',1)).rejects.toThrow(/組合貨號/);
 const state=await newProductCalculationState(env);expect(state.registry.some(r=>r.sku==='OC-OLD')).toBe(false);
 expect(sql.prepare('SELECT COUNT(*) n FROM new_product_candidates').get().n).toBe(4);
 await purchase('O1-PURCHASED');const before=facts();expect((await newProductCalculationState(env)).registry.some(r=>r.sku==='O1-PURCHASED')).toBe(true);expect(facts()).toEqual(before);
});

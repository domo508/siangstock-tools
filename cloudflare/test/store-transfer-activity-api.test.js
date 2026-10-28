import {DatabaseSync} from "node:sqlite";
import vm from "node:vm";
import {readFileSync,readdirSync} from "node:fs";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
vi.mock("../worker/src/access",()=>({verifyCompanyUser:vi.fn(async r=>{const email=r.headers.get("X-Test-Email");if(!email)throw Error("需要登入");return email;})}));
import {storeTransferRoute} from "../worker/src/store-transfer";
let sql,env;
const stores=["R00","R01","R03","R10","R07","R06"];
const browser = { console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer };
vm.createContext(browser);
for (const path of ["../procurement-planning/assets/xlsx-js-style.bundle.js", "../store-transfer/core.js"]) vm.runInContext(readFileSync(path,"utf8"),browser);
function source(){return {version:1,name:"合成活動",scope:"all",asOfDate:"2026-10-31",startDate:"2026-11-11",endDate:"2026-11-15",months:[{month:"2026-11",retailTarget:1000,onlineAndOtherTarget:3000,targets:Object.fromEntries(stores.map(s=>[s,s==="R00"?1000:0])),weights:Object.fromEntries(stores.map(s=>[s,Array(30).fill(1/30)]))}],rows:[{storeCode:"R00",sku:"A001",quantities:{"2026-11":20}}]};}
function config(){return {startProposalDate:"2026-11-02",reason:"同仁共同確認分配",targets:{"2026-11":source().months[0].targets}};}
beforeEach(()=>{sql=new DatabaseSync(":memory:");sql.exec("CREATE TABLE procurement_settings(id INTEGER,store_transfer_hq_emails TEXT); INSERT INTO procurement_settings VALUES(1,'[\"hq@siangapato.com.tw\"]');");sql.exec(readFileSync("worker/migrations/0043_store_transfer_activity_plans.sql","utf8"));const db={prepare(query){let args=[];return {bind(...a){args=a;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){const result=sql.prepare(query).run(...args);return {meta:{changes:Number(result.changes)}};}};}};env={DB:db,ALLOWED_ORIGINS:"https://siangstock.com"};});
afterEach(()=>{vi.useRealTimers();sql.close();});
async function call(path="",method="GET",body,email="hq@siangapato.com.tw",headers={}){const r=new Request(`https://siangstock.com/api/store-transfer/activity-plans${path}`,{method,headers:{Origin:"https://siangstock.com","Content-Type":"application/json","X-Store-Transfer-Version":"20261028-transfer-sources-r1","X-Test-Email":email,...headers},...(body?{body:JSON.stringify(body)}:{})});return storeTransferRoute(r,env);}
it("主採購提供草稿→總部確認→共同讀取→新版衝突不覆蓋，歷史與設定原子一致",async()=>{const response=await call("","POST",{source:source()});const created=await response.json();expect(response.status).toBe(201);expect((await (await call()).json()).plans).toHaveLength(1);expect((await (await call(`/${created.id}`)).json()).plan.status).toBe("draft");const updated=await call(`/${created.id}`,"PUT",{expectedRevision:1,status:"confirmed",config:config()});expect(updated.status).toBe(200);const plan=(await(await call(`/${created.id}`)).json()).plan;expect(plan).toMatchObject({revision:2,status:"confirmed",config:{startProposalDate:"2026-11-02"}});expect(sql.prepare("SELECT COUNT(*) n FROM store_transfer_activity_plan_history").get().n).toBe(2);await expect(call(`/${created.id}`,"PUT",{expectedRevision:1,status:"confirmed",config:config()})).rejects.toThrow(/其他同仁/);expect(sql.prepare("SELECT revision FROM store_transfer_activity_plans").get().revision).toBe(2);});
it("門市／非指派帳號無法讀寫全店分配，跨來源與舊版寫入拒絕",async()=>{for(const email of ["tpzssa@siangapato.com.tw","nobody@siangapato.com.tw"])await expect(call("","GET",undefined,email)).rejects.toThrow(/總部|尚未指派/);await expect(call("","POST",{source:source()},undefined,{Origin:"https://evil.example"})).rejects.toThrow(/不允許/);await expect(call("","POST",{source:source()},undefined,{"X-Store-Transfer-Version":"old"})).rejects.toThrow(/新版/);});
it("來源與確認的目標不守恆、每日權重異常、重複品號皆無法繞過前台",async()=>{const s=source();s.months[0].retailTarget=999;await expect(call("","POST",{source:s})).rejects.toThrow(/守恆/);s.months[0].retailTarget=1000;s.months[0].weights.R00[0]=2;await expect(call("","POST",{source:s})).rejects.toThrow();const duplicate=source();duplicate.rows.push(duplicate.rows[0]);await expect(call("","POST",{source:duplicate})).rejects.toThrow(/重複/);const{id}=await(await call("","POST",{source:source()})).json();const c=config();c.targets["2026-11"].R00=0;await expect(call(`/${id}`,"PUT",{expectedRevision:1,status:"confirmed",config:c})).rejects.toThrow(/守恆/);expect(sql.prepare("SELECT COUNT(*) n FROM store_transfer_activity_plan_history").get().n).toBe(1);});
it("取消與人工歸零分配保留歷史；未知欄位／檔名／交易資料不保存",async()=>{const s=source();s.fileName="不可保存.xlsx";s.customer="不得保存";const{id}=await(await call("","POST",{source:s})).json();expect(sql.prepare("SELECT source FROM store_transfer_activity_plans").get().source).not.toContain("不可保存");const r=await call(`/${id}`,"PUT",{expectedRevision:1,status:"cancelled",config:config()});expect(r.status).toBe(200);expect((await(await call(`/${id}`)).json()).plan.status).toBe("cancelled");});
it("相同來源重試不重複活動，更新來源需明確版本並重新確認分配",async()=>{const first=await(await call("","POST",{source:source()})).json();const retry=await(await call("","POST",{source:source()})).json();expect(retry.id).toBe(first.id);const s=source();s.rows[0].quantities['2026-11']=30;const conflict=await call("","POST",{source:s});expect(conflict.status).toBe(409);const r=await call("","POST",{source:s,expectedRevision:1});expect(r.status).toBe(200);const p=(await(await call(`/${first.id}`)).json()).plan;expect(p).toMatchObject({status:'draft',revision:2,config:{}});expect(sql.prepare('SELECT COUNT(*) n FROM store_transfer_activity_plans').get().n).toBe(1);});
it("完整活動流程：建立→門市暫存及送出→總部核准→ERP紀錄；後週須核對前批",async()=>{
 sql.exec('DROP TABLE procurement_settings');
 for(const file of readdirSync('worker/migrations').filter(f=>f.endsWith('.sql')).sort()) sql.exec(readFileSync(`worker/migrations/${file}`,'utf8'));
 env.DB.batch=async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}};
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-02T02:00:00Z'));
 const email='siang01@siangapato.com.tw';
 const{id}=await(await call('','POST',{source:source()},email)).json();await call(`/${id}`,'PUT',{expectedRevision:1,status:'confirmed',config:config()},email);
 async function batchCall(path,method,body,who=email){return storeTransferRoute(new Request(`https://siangstock.com/api/store-transfer${path}`,{method,headers:{Origin:'https://siangstock.com','Content-Type':'application/json','X-Test-Email':who},...(body?{body:JSON.stringify(body)}:{})}),env);}
 const item={storeCode:'R00',sku:'A001',productName:'合成活動品',suggestedQuantity:3,itemType:'regular',calculationDate:'2026-11-05',ruleSummary:'合成活動',baseSellableQuantity:0,displayGap:0,dailySales:1,decisionSnapshot:{hqAvailable:100,hqReleasable:100,hqSupplyCeiling:100,activityDemandSchedule:[['2026-11-11',1],['2026-11-12',2]]}};
 const arrival={R00:{storeCode:'R00',currentArrivalDate:'2026-11-05',nextArrivalDate:'2026-11-12',activityPlanId:id,activityPlanRevision:2,activityApprovalDate:'2026-11-03',activityBufferDays:2}};
 const created=await batchCall('/batches','POST',{id:'TR-SYNTH-W45',weekKey:'2026-W45',proposalDate:'2026-11-02',responseDueAt:'2026-11-03T01:00:00Z',lockAt:'2026-11-03T01:00:00Z',items:[item],arrivalSchedule:arrival});expect(created.status).toBe(201);
 const storeItems=[{storeCode:'R00',sku:'A001',productName:'合成活動品',itemType:'regular',confirmedQuantity:3,reason:''}];
 expect((await batchCall('/batches/TR-SYNTH-W45/stores/R00/save','PUT',{items:storeItems},'tpzssa@siangapato.com.tw')).status).toBe(200);
 expect((await batchCall('/batches/TR-SYNTH-W45/stores/R00/submit','PUT',{items:storeItems},'tpzssa@siangapato.com.tw')).status).toBe(200);
 const approvedItems=[{...storeItems[0],approvedQuantity:3}];
 await expect(batchCall('/batches/TR-SYNTH-W45/approve','POST',{items:approvedItems})).rejects.toThrow(/實際核准日/);
 vi.setSystemTime(new Date('2026-11-03T02:00:00Z'));
 expect((await batchCall('/batches/TR-SYNTH-W45/approve','POST',{items:approvedItems})).status).toBe(200);
 let commitments=await(await call(`/${id}/commitments?week=2026-W46`,'GET',undefined,email)).json();expect(commitments.batches[0].all_exported).toBe(0);
 expect((await batchCall('/batches/TR-SYNTH-W45/erp-created','POST',{storeCode:'R00'})).status).toBe(200);
 commitments=await(await call(`/${id}/commitments?week=2026-W46`,'GET',undefined,email)).json();expect(commitments.batches[0].all_exported).toBe(1);
 const detail=await(await batchCall('/batches/TR-SYNTH-W45','GET')).json();expect(detail.items[0].hq_approved_quantity??detail.items[0].store_confirmed_quantity??detail.items[0].suggested_quantity).toBe(3);
 expect(JSON.parse(detail.items[0].decision_snapshot).activityDemandSchedule).toEqual([['2026-11-11',1],['2026-11-12',2]]);
});

for(const changed of [false,true]) it(`正式補貨端到端：${changed?'門市增減、總部增減':'完全未修改'}→暫存→送審→核准→真實XLSX重讀守恆`,async()=>{
 sql.exec('DROP TABLE procurement_settings');
 for(const file of readdirSync('worker/migrations').filter(f=>f.endsWith('.sql')).sort()) sql.exec(readFileSync(`worker/migrations/${file}`,'utf8'));
 env.DB.batch=async statements=>{sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}};
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-02T02:00:00Z'));
 async function request(path,method,body,email='siang01@siangapato.com.tw') {
  return storeTransferRoute(new Request(`https://siangstock.com/api/store-transfer${path}`,{method,headers:{Origin:'https://siangstock.com','Content-Type':'application/json','X-Test-Email':email},...(body?{body:JSON.stringify(body)}:{})}),env);
 }
 const items=['PASS','STORE-REMOVE','HQ-REMOVE','ADJUST'].map(sku=>({storeCode:'R00',sku,productName:`合成${sku}`,suggestedQuantity:2,itemType:'regular',calculationDate:'2026-11-04',baseSellableQuantity:0,displayGap:0,dailySales:1,decisionSnapshot:{hqAvailable:100,hqReleasable:100,hqSupplyCeiling:100}}));
 const manualItemFacts=['STORE-ADD','HQ-ADD'].map(sku=>({storeCode:'R00',sku,productName:`合成${sku}`,hqAvailable:100,hqReleasable:100,calculationDate:'2026-11-04'}));
 const id=changed?'TR-SYNTH-EDIT':'TR-SYNTH-PASS';
 const created=await request('/batches','POST',{id,weekKey:'2026-W45',proposalDate:'2026-11-02',responseDueAt:'2026-11-03T01:00:00Z',lockAt:'2026-11-03T01:00:00Z',items,manualItemFacts});
 expect(created.status).toBe(201);
 const storeItems=items.map(i=>({...i,confirmedQuantity:changed?(i.sku==='STORE-REMOVE'?0:i.sku==='ADJUST'?3:2):2,reason:changed?'合成門市調整':''}));
 if(changed) storeItems.push({storeCode:'R00',sku:'STORE-ADD',itemType:'regular',confirmedQuantity:2,reason:'合成門市新增'});
 const store='tpzssa@siangapato.com.tw';
 expect((await request(`/batches/${id}/stores/R00/save`,'PUT',{items:storeItems},store)).status).toBe(200);
 expect((await request(`/batches/${id}/stores/R00/submit`,'PUT',{items:storeItems},store)).status).toBe(200);
 const approved=storeItems.map(i=>({...i,approvedQuantity:changed?(i.sku==='HQ-REMOVE'?0:i.sku==='ADJUST'?4:i.confirmedQuantity):i.confirmedQuantity,reason:changed?'合成總部調整':''}));
 if(changed) approved.push({storeCode:'R00',sku:'HQ-ADD',itemType:'regular',approvedQuantity:1,reason:'合成總部新增'});
 expect((await request(`/batches/${id}/approve`,'POST',{items:approved})).status).toBe(200);
 const detail=await(await request(`/batches/${id}`,'GET')).json();
 const expected=changed?{PASS:2,ADJUST:4,'STORE-ADD':2,'HQ-ADD':1}:{PASS:2,'STORE-REMOVE':2,'HQ-REMOVE':2,ADJUST:2};
 const workbook=browser.StoreTransferCore.buildErpWorkbook(detail.items,browser.XLSX,'R00');
 const bytes=browser.XLSX.write(workbook,{type:'array',bookType:'xlsx'});
 const reread=browser.XLSX.read(bytes,{type:'array',cellStyles:true,cellDates:true});
 const rows=browser.XLSX.utils.sheet_to_json(reread.Sheets['通用貨品數量']);
 expect(Object.fromEntries(rows.map(r=>[r.貨號,r.數量]))).toEqual(expected);
 expect(rows.reduce((n,r)=>n+r.數量,0)).toBe(changed?9:8);
 expect((await request(`/batches/${id}/erp-created`,'POST',{storeCode:'R00'})).status).toBe(200);
 expect(sql.prepare('SELECT erp_created_at FROM store_transfer_store_status WHERE batch_id=?').get(id).erp_created_at).toBeTruthy();
});

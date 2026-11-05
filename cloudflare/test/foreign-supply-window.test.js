import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {describe,it,expect} from 'vitest';
const ctx={console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer};ctx.globalThis=ctx;vm.createContext(ctx);
for(const f of ['inventory/assets/xlsx.full.min.js','procurement-planning/core.js','store-transfer/core.js','procurement-planning/activity-planning.js'])vm.runInContext(readFileSync('../'+f,'utf8'),ctx);
const c=ctx.ProcurementPlanningCore,X=ctx.XLSX;
const rule={enabled:true,mode:'supply-window-v1',closureStart:'2027-01-06',lastArrivalDate:'2027-01-23',recoveryDate:'2027-02-21',extraDays:0};
const dates=(orderDate,overrides={})=>c.resolveForeignSupplyDates({asOfDate:orderDate,orderDate,leadDays:70,reviewDays:105,rule,...overrides});
const daily=()=>({hq:2,stores:{R01:1}});
const simulate=(overrides={})=>c.planForeignSupplyWindow({asOfDate:'2027-01-01',arrivalDate:'2027-01-05',endDate:'2027-01-10',inventoryQty:3,storeInventory:{R01:2},dailyDemand:daily,safetyQty:2,...overrides});
function workbook(rows){const w=X.utils.book_new();X.utils.book_append_sheet(w,X.utils.aoa_to_sheet(rows),'工作表1');return X.read(X.write(w,{type:'array',bookType:'xlsx'}),{type:'array',cellDates:true,cellStyles:true,nodim:true});}
function source(){
 const master=c.parseProductMasterWorkbook(workbook([['貨號','品名','供應商貨號','供應商簡稱','進貨價','最小配貨數','貨品狀態','已下架'],['N001','合成水洗枕','N001','逸寐',100,1,'尚可追加','否'],['N002','合成國內商品','N002','上林',100,1,'尚可追加','否']]),X);
 const inv=c.parseInventoryWorkbook(workbook([['店倉編號','店倉名稱','貨號','品名','實際庫存','實際庫存成本額'],['T00','總倉','N001','合成水洗枕',10,1000],['R01','合成店','N001','合成水洗枕',2,200],['T00','總倉','N002','合成國內商品',10,1000]]),X);
 const sales=[['銷別','結帳時間','貨號','品名','銷售量','實收金額','開單倉編號','開單倉名稱']];
 for(let i=0;i<84;i++){const d=new Date(Date.UTC(2026,10,2)-i*86400000).toISOString().slice(0,10);for(const sku of ['N001','N002'])sales.push(['銷貨',d+' 12:00:00',sku,'合成商品',3,300,'T00','總倉']);sales.push(['銷貨',d+' 12:00:00','N001','合成水洗枕',1,100,'R01','合成店']);}
 return {master,inventory:inv,salesReports:[c.parseSalesWorkbook(workbook(sales),X)],pendingReports:[],transferReports:[],blacklist:[],asOfDate:'2026-11-02',orderDate:'2026-11-02',checkpoint:'month-start',supplierRules:c.SUPPLIER_RULES,springFestivalRule:rule,backordersConfirmed:true};
}
describe('國外供應空窗日期',()=>{
 it('年前最後到貨減70天，期限前／當日可年前供貨，逾期等復工後70天',()=>{
  expect(dates('2026-11-02')).toMatchObject({nominalLastOrderDate:'2026-11-14',arrival:'2027-01-11',postFestivalArrival:'2027-05-02',missesYearEnd:false});
  expect(dates('2026-11-14').arrival).toBe('2027-01-23');expect(dates('2026-11-15').arrival).toBe('2027-05-02');
 });
 it('停工期間與復工後分開處理，不另加兩週船運',()=>{expect(dates('2027-02-01').arrival).toBe('2027-05-02');expect(dates('2027-02-22').arrival).toBe('2027-05-03');});
 it('復工改一天影響首批到貨一天，國外不同交期不硬編70',()=>{expect(dates('2026-11-15',{rule:{...rule,recoveryDate:'2027-02-22'}}).postFestivalArrival).toBe('2027-05-03');expect(dates('2026-12-31',{leadDays:30}).postFestivalArrival).toBe('2027-03-23');});
 it('公司假日可能讓名目期限前的訂單也趕不上，仍須等年後',()=>{expect(dates('2026-11-14',{storeInventoryRules:{workdayHolidays:['2026-12-25']}}).arrival).toBe('2027-05-02');});
 it('日期缺漏、無效日期、順序顛倒及下單早於資料日須阻擋',()=>{
  for(const bad of [{lastArrivalDate:''},{lastArrivalDate:'2027-02-30'},{lastArrivalDate:'2027-03-01'},{closureStart:'2027-13-01'}])expect(()=>dates('2026-11-02',{rule:{...rule,...bad}})).toThrow(/春節供應日期/);
  expect(()=>dates('2026-11-01',{asOfDate:'2026-11-02'})).toThrow(/下單日/);
 });
});
describe('缺貨流失與有效欠單分離',()=>{
 it('到貨前耗用庫存僅一次、未成交缺口不遞延，到貨後仍保障同一截止',()=>{
  const r=simulate();expect(r.firstShortageDate).toBe('2027-01-03');expect(r.lostQty).toBe(4);expect(r.soldBeforeArrival).toBe(5);expect(r.rawNeed).toBe(17);expect(r.forecastAfterArrival).toBe(15);expect(r.endDate).toBe('2027-01-10');
 });
 it('明確有效欠單要加回，不把所有流失量當欠單',()=>{expect(simulate({backorderQty:4}).rawNeed-simulate().rawNeed).toBe(4);expect(simulate({backorderQty:0}).rawNeed).toBe(17);});
 it('無缺貨的到貨時剩餘庫存正確抵扣，不因日期切段多買',()=>{const r=simulate({inventoryQty:100});expect(r.lostQty).toBe(0);expect(r.rawNeed).toBe(0);expect(r.stockAtArrival.hq).toBe(93);});
 it('晚到的其他訂單不能抵掉較早的缺口，分批到貨依日期計算',()=>{
  const late=simulate({deliveries:[{quantity:100,deliveryDate:'2027-01-09'}]});expect(late.rawNeed).toBe(12);
  const timely=simulate({deliveries:[{quantity:100,deliveryDate:'2027-01-05'}]});expect(timely.rawNeed).toBe(0);
  expect(simulate({deliveries:[{quantity:5,deliveryDate:'2027-01-03'},{quantity:10,deliveryDate:'2027-01-07'}]}).lostQty).toBe(0);
 });
 it('無到貨日的未到貨是未知，不當作0件或當作及時供應',()=>{const r=simulate({deliveries:[{quantity:100,deliveryDate:null}]});expect(r.undatedPendingQty).toBe(100);expect(r.rawNeed).toBe(17);});
 it('不同店安全量不得用其他店多餘現貨抵銷',()=>{const r=simulate({inventoryQty:0,storeInventory:{R01:0,R03:100},dailyDemand:()=>({hq:0,stores:{R01:1}}),safetyByStore:{R01:2,R03:0},hqSafetyQty:0});expect(r.rawNeed).toBe(7);});
 it('期末邊界、零需求與數量格式不製造訂單',()=>{expect(simulate({dailyDemand:()=>({hq:0,stores:{}}),safetyQty:0}).rawNeed).toBe(0);expect(()=>simulate({inventoryQty:NaN})).toThrow();expect(()=>simulate({backorderQty:-1})).toThrow();expect(()=>simulate({dailyDemand:()=>({hq:NaN,stores:{}})})).toThrow();});
 it('需求尖峰只出現在缺貨前段時不會變成後段備貨，仍記錄流失',()=>{const base=simulate({inventoryQty:0,storeInventory:{}});const spike=simulate({inventoryQty:0,storeInventory:{},dailyDemand:d=>d<'2027-01-05'?{hq:100,stores:{}}:daily()});expect(spike.rawNeed).toBe(base.rawNeed);expect(spike.lostQty).toBeGreaterThan(base.lostQty);});
});
describe('正式核心、Excel與原資料相容',()=>{
 it('一般月初釋出不壓低春節完整保障，國內原量保持不變，欠單未知明確揭露',()=>{
  const input=source(),original=JSON.stringify(input.inventory.records);const result=c.buildProcurementRecommendations(input);const foreign=result.rows.find(r=>r.sku==='N001');
  expect(foreign.supplyWindow).toBeTruthy();expect(foreign.springFestivalExtraDays).toBe(0);expect(foreign.suggestedPurchaseQty).toBeGreaterThan(foreign.standardSuggestedPurchaseQty);expect(foreign.supplyWindow.protectionEnd).toBe('2027-05-02');expect(foreign.supplyWindow.lostQty).toBeGreaterThan(0);
  const legacy=c.buildProcurementRecommendations({...input,springFestivalRule:{...rule,enabled:false,mode:'legacy',extraDays:53}});
  expect(result.rows.find(r=>r.sku==='N002').suggestedPurchaseQty).toBe(legacy.rows.find(r=>r.sku==='N002').suggestedPurchaseQty);expect(JSON.stringify(input.inventory.records)).toBe(original);
  expect(c.buildProcurementRecommendations({...input,backordersConfirmed:false}).rows.find(r=>r.sku==='N001').supplyWindow.backlogStatus).toMatch(/未提供/);
 });
 it('實際XLSX往返：未改量、人工改量、歸零與新增檢查頁不重複讀入',()=>{
  const result=c.buildProcurementRecommendations(source());const output=c.buildRecommendationWorkbook(result,X);const bytes=X.write(output,{type:'array',bookType:'xlsx'});const returned=X.read(bytes,{type:'array',cellDates:true,cellStyles:true,nodim:true});expect(returned.SheetNames).toContain('11_供應空窗檢查');
  const baseline=new Map(result.rows.map(r=>[r.sku,r]));const options={baselineBySku:baseline,allowedSkuSet:new Set(result.rows.map(r=>r.sku))};
  const review=c.reviewReturnedWorkbook(returned,X,options);expect(review.errors).toHaveLength(0);expect(review.rows.length).toBe(result.suggestedRows.length);expect(review.rows.reduce((a,r)=>a+r.confirmedQty,0)).toBe(result.totals.suggestedPurchaseQty);
 });
 it('包裝整數與總量／金額共用最終值',()=>{const input=source();input.purchaseUnitRules=[{supplier:'逸寐',conditionMode:'structured',productCategory:'其它品項',sizeOption:'全部規格',quantity:10,enabled:true}];const r=c.buildProcurementRecommendations(input);expect(r.rows.find(x=>x.sku==='N001').suggestedPurchaseQty%10).toBe(0);expect(r.totals.suggestedPurchaseQty).toBe(r.suggestedRows.reduce((a,x)=>a+x.suggestedPurchaseQty,0));expect(r.totals.suggestedPurchaseAmount).toBe(r.suggestedRows.reduce((a,x)=>a+x.suggestedPurchaseAmount,0));});
 it('0055僅更新年度規則及稽核，重跑不改其他規則或歷史',()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE procurement_rules_current(id INTEGER PRIMARY KEY,version INTEGER,payload TEXT,updated_at TEXT,updated_by TEXT); CREATE TABLE procurement_rules_history(version INTEGER UNIQUE,payload TEXT,change_reason TEXT,changed_at TEXT,changed_by TEXT);');
  const payload={suppliers:[{name:'合成供應商',leadDays:70}],springFestival:{enabled:true,closureStart:'2027-01-16',recoveryDate:'2027-02-28',extraDays:53}};
  db.prepare('INSERT INTO procurement_rules_current VALUES(1,3,?,?,?)').run(JSON.stringify(payload),'old','old');const sql=readFileSync('worker/migrations/0055_foreign_supply_window_policy.sql','utf8');db.exec(sql);db.exec(sql);const row=db.prepare('SELECT * FROM procurement_rules_current').get();expect(row.version).toBe(4);const saved=JSON.parse(row.payload);expect(saved.suppliers).toEqual(payload.suppliers);expect(saved.springFestival).toMatchObject(rule);expect(db.prepare('SELECT count(*) n FROM procurement_rules_history').get().n).toBe(1);db.close();
 });
});

describe('新供應規則覆核與ERP端到端',()=>{
 for(const scenario of ['未改量','人工增加','明確歸零'])it(`${scenario}：建議、兩次覆核、ERP數量金額守恆且保留供應依據`,()=>{
  const input=source(),result=c.buildProcurementRecommendations(input),row=result.rows.find(r=>r.sku==='N001');
  const w=c.buildRecommendationWorkbook(result,X,{selectedSuppliers:['逸寐']});const sh=w.Sheets['03D_其它供應商'];const headers=X.utils.sheet_to_json(sh,{header:1})[0];
  const final=scenario==='未改量'?row.suggestedPurchaseQty:scenario==='人工增加'?row.suggestedPurchaseQty+1:0;
  if(scenario!=='未改量'){sh[X.utils.encode_cell({r:1,c:headers.indexOf('人工確認採購量')})]={t:'n',v:final};sh[X.utils.encode_cell({r:1,c:headers.indexOf('人工調整原因類別')})]={t:'s',v:scenario==='人工增加'?'需求增加，人工提高數量':'本次不採購'};}
  const read=w=>X.read(X.write(w,{type:'array',bookType:'xlsx'}),{type:'array',cellDates:true,cellStyles:true,nodim:true});
  const first=c.reviewReturnedWorkbook(read(w),X,{asOfDate:input.asOfDate,orderDate:input.orderDate,baselineBySku:new Map(result.rows.map(r=>[r.sku,r])),allowedSkuSet:new Set(['N001'])});expect(first.errors).toHaveLength(0);expect(first.rows).toHaveLength(1);expect(first.rows[0].finalQty).toBe(final);expect(first.rows[0].supplyWindow.policy).toBe('supply-window-v1');
  if(scenario==='未改量')expect(first.rows[0].availableTo).toMatch(/^到貨後：/);else expect(first.rows[0].availableTo).toMatch(/人工量已變更/);
  const second=c.buildSecondReviewWorkbook(first,X,{batchId:'SYNTHETIC-SUPPLY'});const approved=c.reviewSecondApprovalWorkbook(read(second),X,{asOfDate:input.asOfDate,orderDate:input.orderDate,baselineBySku:new Map(first.rows.map(r=>[r.sku,r]))});expect(approved.errors).toHaveLength(0);expect(approved.rows[0].finalQty).toBe(final);expect(approved.rows[0].approvedAmount).toBe(final*100);
  if(final===0){expect(()=>c.buildErpPurchaseWorkbook(approved,X,{approved:true,batchId:'SYNTHETIC-SUPPLY'})).toThrow(/沒有核准數量大於0/);}else{const erp=c.buildErpPurchaseWorkbook(approved,X,{approved:true,batchId:'SYNTHETIC-SUPPLY'});const exported=X.utils.sheet_to_json(read(erp).Sheets['通用貨品數量'],{header:1,defval:''});const column=exported[0].indexOf('數量');expect(column).toBeGreaterThanOrEqual(0);expect(exported.slice(1).reduce((a,r)=>a+Number(r[column]||0),0)).toBe(final);}
 });
 it('跨下一年度不可沿用過期春節設定',()=>{expect(()=>dates('2027-11-02')).toThrow(/下一年度/);});
});

it('規則稽核寫入失敗時不留下僅升版的規則',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE procurement_rules_current(id INTEGER PRIMARY KEY,version INTEGER,payload TEXT,updated_at TEXT,updated_by TEXT);CREATE TABLE procurement_rules_history(version INTEGER UNIQUE,payload TEXT,change_reason TEXT,changed_at TEXT,changed_by TEXT);');
 const payload=JSON.stringify({springFestival:{enabled:true,closureStart:'2027-01-16',recoveryDate:'2027-02-28',extraDays:53}});
 db.prepare('INSERT INTO procurement_rules_current VALUES(1,3,?,?,?)').run(payload,'old','old');db.prepare('INSERT INTO procurement_rules_history VALUES(4,?,?,?,?)').run('{}','synthetic conflict','old','old');
 expect(()=>db.exec(readFileSync('worker/migrations/0055_foreign_supply_window_policy.sql','utf8'))).toThrow();expect(db.prepare('SELECT version,payload FROM procurement_rules_current').get()).toEqual({version:3,payload});db.close();
});

it('公司規則讀取失敗／缺版本時停止採用，不把上次快取當成新規則',async()=>{
 const app=readFileSync('../procurement-planning/app.js','utf8');const match=app.match(/  async function loadProcurementRules\([\s\S]*?\n  \}/);expect(match).toBeTruthy();
 const state={procurementRules:{old:true},procurementRulesVersion:3};const sandbox={state,fetch:async()=>({ok:true,json:async()=>({rules:{springFestival:rule}})})};vm.createContext(sandbox);vm.runInContext(match[0],sandbox);
 await expect(sandbox.loadProcurementRules()).rejects.toThrow(/回應不完整/);expect(state.procurementRulesVersion).toBe(3);
 sandbox.fetch=async()=>({ok:false,status:503,json:async()=>({error:'規則服務暫時失敗'})});await expect(sandbox.loadProcurementRules()).rejects.toThrow(/暫時失敗/);
 sandbox.fetch=async()=>({ok:true,json:async()=>({version:4,rules:{springFestival:rule}})});await sandbox.loadProcurementRules();expect(state.procurementRulesVersion).toBe(4);expect(state.procurementRules.springFestival.mode).toBe('supply-window-v1');
});

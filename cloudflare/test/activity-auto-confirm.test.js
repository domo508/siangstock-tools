import {readFileSync} from "node:fs";
import vm from "node:vm";
import {describe,it,expect,vi} from "vitest";
const ctx={console,setTimeout,clearTimeout};ctx.globalThis=ctx;vm.createContext(ctx);
for(const f of ["../store-transfer/core.js","../store-transfer/activity.js"])vm.runInContext(readFileSync(f,"utf8"),ctx);
const a=ctx.StoreTransferActivity,app=readFileSync("../store-transfer/app.js","utf8");
const section=app.slice(app.indexOf("  function activityMessage("),app.indexOf("  function updateReady()"));
const factory=vm.runInContext(`(function(state,$,api,calculationMode,renderStub,escapeHtml){${section};renderActivityPlan=renderStub;return {loadActivityPlans,currentActivityPlan,saveActivityPlan};})`,ctx);
function plan(){const targets=Object.fromEntries(a.STORES.map(s=>[s,s==="R00"?4200000:0]));return {id:"test-plan",revision:3,status:"confirmed",source:{version:1,name:"合成雙11",asOfDate:"2026-11-02",startDate:"2026-11-11",endDate:"2026-11-15",months:[{month:"2026-11",retailTarget:4200000,onlineAndOtherTarget:6430000,targets,weights:Object.fromEntries(a.STORES.map(s=>[s,Array(30).fill(1/30)]))}],rows:[{storeCode:"R00",sku:"TEST",quantities:{"2026-11":100}}]},config:{startProposalDate:"2026-11-02",reason:"已確認分配",targets:{"2026-11":{...targets}}}};}
const summary=p=>({id:p.id,revision:p.revision,status:p.status,name:p.source.name,startDate:p.source.startDate,endDate:p.source.endDate,startProposalDate:p.config.startProposalDate||"",settingsOutdated:p.settingsOutdated});
function harness(database=[plan()]){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:"",textContent:"",hidden:false,checked:false,disabled:false,dataset:{},isConnected:true,innerHTML:""});return nodes.get(id);};
 const fields=a.STORES.map(s=>({value:s==="R00"?"4,200,000":"0",dataset:{month:"2026-11",store:s},disabled:false,isConnected:true}));
 node("activity-plan-editor").querySelectorAll=selector=>selector==="[data-activity-target]"?fields:[...fields,node("activity-confirm-reason"),node("activity-start-proposal"),node("confirm-activity-plan"),node("cancel-activity-plan")];
 node("proposal-date").value="2026-11-02";node("lock-at").value="2026-11-03T09:00";node("activity-start-proposal").value="2026-11-02";node("activity-confirm-reason").value="已確認分配";
 const state={config:{role:"admin",stores:{}},mode:"formal"},calls=[];
 const api=vi.fn(async(path,opts)=>{calls.push({path,opts});if(path==="/activity-plans")return {plans:database.map(summary)};const p=database.find(p=>path.endsWith('/'+p.id));if(!p)throw Error("找不到活動");if(opts?.method==="PUT"){p.config=structuredClone(opts.body.config);p.status=opts.body.status;p.revision++;return {id:p.id,revision:p.revision};}return {plan:structuredClone(p)};});
 const render=()=>{state.activityPlanDirty=false;const p=state.activityPlan;node("activity-confirm-reason").value=p.config.reason;node("activity-start-proposal").value=p.config.startProposalDate;for(const f of fields)f.value=a.formatTarget(p.config.targets[f.dataset.month][f.dataset.store]);};
 const funcs=factory(state,node,api,()=>state.mode,render,x=>String(x));
 return {state,node,fields,api,calls,database,...funcs};
}
describe("已確認活動跨同仁自動帶入與儲存回饋",()=>{
 it("11/2與11/9自動帶入v3、不重存，11/16停止；另一位同仁沿用共用確認",async()=>{
  const h=harness();expect((await h.loadActivityPlans()).revision).toBe(3);expect(h.node("use-activity-plan").checked).toBe(true);
  h.node("proposal-date").value="2026-11-09";h.node("lock-at").value="2026-11-10T09:00";expect((await h.currentActivityPlan()).id).toBe("test-plan");
  const other=harness(h.database);expect((await other.loadActivityPlans()).revision).toBe(3);
  h.node("proposal-date").value="2026-11-16";h.node("lock-at").value="2026-11-17T09:00";expect(await h.currentActivityPlan()).toBe(null);expect(h.node("use-activity-plan").checked).toBe(false);
  expect(h.calls.filter(c=>c.opts?.method==="PUT")).toHaveLength(0);
 });
 it("活動取消、尚未開始、過期與A/B均不誤套，切回正式自動恢復",async()=>{
  const p=summary(plan());expect(a.choosePlanForDate([p],"2026-10-26",{})).toBe(null);
  expect(a.choosePlanForDate([{...p,status:"cancelled"}],"2026-11-02",{})).toBe(null);
  const h=harness();h.state.mode="comparison";expect(await h.loadActivityPlans()).toBe(null);h.state.mode="formal";expect((await h.loadActivityPlans()).revision).toBe(3);
  const unavailable=harness();unavailable.state.mode="comparison";unavailable.api.mockRejectedValue(Error("活動服務暫時失敗"));expect(await unavailable.currentActivityPlan()).toBe(null);expect(unavailable.api).not.toHaveBeenCalled();
 });
 it("清單截斷及回讀版本衝突皆停止，不可套用舊活動",async()=>{
  const h=harness();h.api.mockResolvedValueOnce({plans:[],hasMore:true});await expect(h.currentActivityPlan()).rejects.toThrow(/不完整/);
  const other=harness(),normal=other.api.getMockImplementation();other.api.mockImplementation(async(path,opts)=>{const result=await normal(path,opts);if(path!=="/activity-plans")result.plan.revision++;return result;});
  await expect(other.currentActivityPlan()).rejects.toThrow(/已由同仁更新/);expect(other.node("use-activity-plan").checked).toBe(false);
 });
 it("日期變更時舊的慢回應不能覆蓋新週次",async()=>{
  const h=harness(),normal=h.api.getMockImplementation();let release;
  h.api.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const old=h.loadActivityPlans();h.node("proposal-date").value="2026-11-16";h.node("lock-at").value="2026-11-17T09:00";
  await h.loadActivityPlans();release(await normal('/activity-plans'));
  await expect(old).rejects.toThrow(/已變更/);expect(h.state.activityResolvedDate).toBe("2026-11-16");expect(h.node("use-activity-plan").checked).toBe(false);
 });
 it("適用活動未確認、設定過期、多活動與缺少確認日期皆阻擋",()=>{
  const p=summary(plan());
  expect(()=>a.choosePlanForDate([{...p,status:"draft",startProposalDate:""}],"2026-11-02",{})).toThrow(/尚未確認/);
  expect(()=>a.choosePlanForDate([{...p,settingsOutdated:true}],"2026-11-02",{})).toThrow(/尚未確認/);
  expect(()=>a.choosePlanForDate([p,{...p,id:"another"}],"2026-11-02",{})).toThrow(/多個活動/);
  expect(()=>a.choosePlanForDate([{...p,startProposalDate:""}],"2026-11-02",{})).toThrow(/缺少備貨/);
 });
 it("清單失敗不降級一般補貨；未存修改不覆蓋或切換",async()=>{
  const h=harness();await h.loadActivityPlans();h.api.mockRejectedValueOnce(Error("服務暫時失敗"));
  await expect(h.currentActivityPlan()).rejects.toThrow(/服務/);expect(h.node("use-activity-plan").checked).toBe(false);
  h.state.activityPlanDirty=true;h.fields[0].value="4,100,000";const count=h.api.mock.calls.length;
  await expect(h.loadActivityPlans()).rejects.toThrow(/未儲存修改/);expect(h.fields[0].value).toBe("4,100,000");expect(h.api.mock.calls.length).toBe(count);
 });
 it("多人新版於下次計算前重新讀取，既有計算不得繼續發布",async()=>{
  const h=harness();await h.loadActivityPlans();h.state.calculation={rows:[1]};h.database[0].revision=4;
  expect((await h.currentActivityPlan()).revision).toBe(4);expect(h.state.calculation).toBe(null);
  expect(app).toContain("!!selectedActivity !== !!calculatedActivity");
 });
 it("按鈕旁顯示儲存中，確認回讀後才顯示成功版本並更新下拉",async()=>{
  const h=harness();await h.loadActivityPlans();const saving=h.saveActivityPlan("confirmed");
  expect(h.node("activity-save-status").textContent).toMatch(/正在儲存/);expect(h.node("confirm-activity-plan").disabled).toBe(true);
  await saving;expect(h.node("activity-save-status").textContent).toMatch(/已成功.*v4/);expect(h.node("activity-plan-select").innerHTML).toContain("v4");
  expect(h.node("confirm-activity-plan").disabled).toBe(false);expect(h.state.activitySaving).toBe(false);
 });
 it("缺原因、錯誤總額在按鈕旁顯示且零寫入",async()=>{
  const h=harness();await h.loadActivityPlans();h.node("activity-confirm-reason").value="";await h.saveActivityPlan("confirmed");
  expect(h.node("activity-save-status").textContent).toMatch(/請填寫.*原因/);
  h.node("activity-confirm-reason").value="確認";h.fields[0].value="4,200,001";await h.saveActivityPlan("confirmed");expect(h.node("activity-save-status").textContent).toMatch(/加總/);
  expect(h.calls.filter(c=>c.opts?.method==="PUT")).toHaveLength(0);
 });
 it("重複點擊只送一次；回讀失敗不能誤報成功或自動重送",async()=>{
  const h=harness();await h.loadActivityPlans();const normal=h.api.getMockImplementation();
  h.api.mockImplementation(async(path,opts)=>{if(!opts?.method&&path!=="/activity-plans")throw Error("回讀中斷");return normal(path,opts);});
  const first=h.saveActivityPlan("confirmed");await h.saveActivityPlan("confirmed");await first;
  expect(h.calls.filter(c=>c.opts?.method==="PUT")).toHaveLength(1);expect(h.node("activity-save-status").textContent).toMatch(/已接受儲存v4.*尚未完成回讀/);
  expect(h.node("activity-save-status").dataset.kind).toBe("error");expect(h.state.activitySaving).toBe(false);
  await h.saveActivityPlan("confirmed");expect(h.calls.filter(c=>c.opts?.method==="PUT")).toHaveLength(1);
  h.api.mockImplementation(normal);await h.loadActivityPlans();expect(h.state.activitySaveCheck).toBe(null);expect(h.state.activityPlan.revision).toBe(4);expect(h.calls.filter(c=>c.opts?.method==="PUT")).toHaveLength(1);
 });
 it("讀回另存版本、不同金額或狀態，不宣稱本次已完成",async()=>{
  for(const mutate of [p=>p.revision++,p=>p.config.targets['2026-11'].R00--,p=>p.status="cancelled"]){
   const h=harness();await h.loadActivityPlans();const normal=h.api.getMockImplementation();
   h.api.mockImplementation(async(path,opts)=>{const result=await normal(path,opts);if(opts?.method)mutate(h.database[0]);return result;});
   await h.saveActivityPlan("confirmed");expect(h.node("activity-save-status").textContent).not.toMatch(/已成功/);expect(h.node("activity-save-status").textContent).toMatch(/不一致/);
  }
 });
 it("回讀物件欄位順序不同仍按實際金額核對",()=>{
  const p=plan(),other=structuredClone(p.config);other.targets['2026-11']=Object.fromEntries(Object.entries(other.targets['2026-11']).reverse());
  expect(a.configMatches(p.source,other,p.config)).toBe(true);other.targets['2026-11'].R00--;expect(a.configMatches(p.source,other,p.config)).toBe(false);
 });
});

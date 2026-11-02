import {readFileSync} from "node:fs";
import vm from "node:vm";
import {describe,it,expect} from "vitest";
const ctx={};ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(readFileSync("../store-transfer/activity.js","utf8"),ctx);
const a=ctx.StoreTransferActivity;
const values=v=>Object.fromEntries(a.STORES.map((s,i)=>[s,v[i]??0]));
const sum=v=>Object.values(v).reduce((s,n)=>s+n,0);
describe("門市活動目標整數化與守恆",()=>{
 it("逐店四捨五入後，自動扣回或補足尾差",()=>{
   expect(Object.values(a.roundTargets(values([1.5,1.5,1.5,1.5]),6))).toEqual([1,1,2,2,0,0]);
   expect(Object.values(a.roundTargets(values([1.4,1.4,1.4,1.8]),6))).toEqual([2,1,1,2,0,0]);
 });
 it("原始零店不分配尾差，微小目標不產生負值",()=>{
   const out=a.roundTargets(values([0,.2,.2,.2,.2,.2]),1);
   expect(out.R00).toBe(0);expect(sum(out)).toBe(1);
   expect(Object.values(out).every(n=>Number.isSafeInteger(n)&&n>=0)).toBe(true);
 });
 it("比例加總的浮點誤差不誤擋整數總目標",()=>{
   expect(sum(a.roundTargets(values([700000.5,700000.5,700000.5,700000.5,700000.5,699997.5]),4200000.000000001))).toBe(4200000);
 });
 it("整數與明確全零保持不變；不修改來源及已保存批次",()=>{
   const input=values([100,0,200,300,400,500]),before=JSON.stringify(input);
   expect(a.roundTargets(input,1500)).toEqual(input);expect(JSON.stringify(input)).toBe(before);
   expect(a.roundTargets(values([]),0)).toEqual(values([]));
 });
 it("人工加總錯誤、留白、負值、非數字及非整數總額不被吸收",()=>{
   expect(()=>a.roundTargets(values([10,10]),21)).toThrow(/加總/);
   for(const invalid of [NaN,Infinity,-1,undefined,"1",null]) {
     const input=values([1]);input.R00=invalid;
     expect(()=>a.roundTargets(input,1)).toThrow(/不完整/);
   }
   expect(()=>a.roundTargets(values([1.5]),1.5)).toThrow(/總目標須為整數/);
 });
 it("跨月各自守恆，JSON儲存重讀後仍為整數，原設定與品項需求不變",()=>{
   const source={months:[{month:"2026-11",retailTarget:6},{month:"2026-12",retailTarget:7}],rows:[{quantities:{"2026-11":3.2}}]};
   const config={reason:"確認",targets:{"2026-11":values([1.5,1.5,1.5,1.5]),"2026-12":values([2.4,2.3,2.3])}};
   const before=JSON.stringify({source,config}),out=JSON.parse(JSON.stringify(a.roundConfig(source,config)));
   expect(sum(out.targets["2026-11"])).toBe(6);expect(sum(out.targets["2026-12"])).toBe(7);
   expect(JSON.stringify({source,config})).toBe(before);
   expect(a.roundConfig(source,out)).toEqual(out);
 });
 it("固定大量分配情境皆無小數且精確等於原總額",()=>{
   for(let seed=1;seed<=1000;seed++) {
     const total=seed*4200,weights=a.STORES.map((_,i)=>(seed*(i+3)%97)+1),denom=sum(weights);
     const input=values(weights.map(w=>w/denom*total)),out=a.roundTargets(input,total);
     expect(sum(out)).toBe(total);
     for(const s of a.STORES) {expect(Number.isSafeInteger(out[s])).toBe(true);expect(Math.abs(out[s]-input[s])).toBeLessThanOrEqual(1.000001);}
   }
 });
 it("前台於保存前整數化並保留版本、未存修改與加總驗證",()=>{
   const app=readFileSync("../store-transfer/app.js","utf8");
   expect(app).toContain('type="text" inputmode="numeric"');
   expect(app.indexOf("config=globalThis.StoreTransferActivity.roundConfig(plan.source,config)")).toBeLessThan(app.indexOf('await api(`/activity-plans/${plan.id}`,{method:"PUT"'));
   expect(app).toContain('state.activityPlanDirty = source.months.some');
   expect(app).toContain('globalThis.StoreTransferActivity.parseTarget(field.value)');
 });
 it("千分位整數格式化及解析往返不改變金額，包括0與一兆",()=>{
   for(const n of [0,1,999,1000,129000000,1000000000000]) {
     const text=a.formatTarget(n);expect(a.parseTarget(text)).toBe(n);
     expect(a.formatTarget(a.parseTarget(text))).toBe(text);
   }
   expect(a.formatTarget(129000000)).toBe("129,000,000");
   expect(a.parseTarget("１２９，０００，０００")).toBe(129000000);
 });
 it("可貼上帶逗號金額，小數交由原有尾差校正；不誤吞格式錯誤或留白",()=>{
   expect(a.parseTarget(" 129,000,000 ")).toBe(129000000);
   expect(a.parseTarget("1,000.5")).toBe(1000.5);
   expect(a.parseTarget(".5")).toBe(.5);
   for(const raw of [""," ",null,undefined,"1,2","1,,000","1,000,","-1","1e6","1000元","NaN","Infinity"])
     expect(Number.isNaN(a.parseTarget(raw))).toBe(true);
 });
 it("千分位輸入→整數校正→JSON數值保存→千分位回讀完全守恆",()=>{
   const source={months:[{month:"2026-11",retailTarget:129000000}]};
   const targets=values([30000000,20000000,10000000,19000000,25000000,25000000]);
   const parsed=Object.fromEntries(Object.entries(targets).map(([s,v])=>[s,a.parseTarget(a.formatTarget(v))]));
   const saved=JSON.parse(JSON.stringify(a.roundConfig(source,{targets:{"2026-11":parsed}})));
   expect(sum(saved.targets["2026-11"])).toBe(129000000);
   expect(saved.targets["2026-11"]).toEqual(targets);
   expect(Object.values(saved.targets["2026-11"]).every(v=>typeof v==="number")).toBe(true);
 });
});

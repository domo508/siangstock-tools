import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, it, expect, vi } from "vitest";
function load(context = {}) {
 const sandbox={console,AbortController,setTimeout,clearTimeout,...context}; vm.createContext(sandbox);
 vm.runInContext(readFileSync('../procurement-planning/shortage-batch.js','utf8'),sandbox);return sandbox.ProcurementShortageBatch;
}
const items=Array.from({length:660},(_,i)=>({storeCode:'TEST',sku:`SKU${i}`,sourceBatchId:'B1',quantity:i%3}));
describe('門市不足批次執行',()=>{
 it('660項最多同時4筆、逐筆進度且件數與來源不變',async()=>{
  const api=load();let active=0,peak=0;const progress=[];const seen=[];const before=JSON.stringify(items);
  const results=await api.run({items,concurrency:99,onProgress:p=>progress.push(p),execute:async item=>{active++;peak=Math.max(peak,active);await Promise.resolve();seen.push(item.sku);active--;}});
  expect(peak).toBe(4);expect(results).toHaveLength(660);expect(new Set(seen).size).toBe(660);expect(results.every(r=>r.status==='success')).toBe(true);
  expect(progress.some(p=>p.completed>0&&p.completed<660)).toBe(true);expect(progress.at(-1)).toMatchObject({completed:660,success:660,remaining:0,active:0});expect(JSON.stringify(items)).toBe(before);
 });
 it('重複門市品號只送一次，不混淆不同門市',async()=>{
  const api=load();const results=await api.run({items:[items[0],items[0],{...items[0],storeCode:'OTHER'}],execute:async()=>{}});expect(results).toHaveLength(2);
 });
 it('單筆失敗繼續其他項，保留失敗來源與訊息',async()=>{
  const api=load();const results=await api.run({items:items.slice(0,8),execute:async item=>{if(item.sku==='SKU2')throw Object.assign(new Error('測試失敗'),{status:500});}});
  expect(results.filter(r=>r.status==='success')).toHaveLength(7);expect(results.find(r=>r.status==='failed')).toMatchObject({item:items[2],error:'測試失敗'});
 });
 it('401停止排入後續項，已送出4筆收尾後保留未送出',async()=>{
  const results=await load().run({items:items.slice(0,20),execute:async()=>{throw Object.assign(new Error('登入到期'),{status:401});}});
  expect(results.filter(r=>r.status==='failed')).toHaveLength(4);expect(results.filter(r=>r.status==='not_started')).toHaveLength(16);
 });
 it('版本變更停止後續項，不宣稱全部成功',async()=>{
  let current=true;const results=await load().run({items:items.slice(0,8),shouldContinue:()=>current,execute:async()=>{current=false;}});
  expect(results.filter(r=>r.status==='success')).toHaveLength(1);expect(results.filter(r=>r.status==='not_started')).toHaveLength(7);
 });
 it('空清單不送出',async()=>{const execute=vi.fn();expect(await load().run({items:[],execute})).toHaveLength(0);expect(execute).not.toHaveBeenCalled();});
 it('重試先排除已關閉、變更來源及不確定結果，保留原因由原操作沿用',()=>{
  const result=load().retryPlan([{item:items[0],status:'success'},{item:items[1],status:'failed'},{item:items[2],status:'failed'},{item:items[3],status:'failed'},{item:items[4],status:'uncertain'},{item:items[5],status:'not_started'}],
  [items[1],items[3],items[4],items[5]].map((r,i)=>({store_code:r.storeCode,sku:r.sku,source_batch_id:i===1?'NEW':'B1'})),true);
  expect(result.items.map(i=>i.sku)).toEqual(['SKU1','SKU5']);expect(result.alreadyClosed).toBe(1);expect(result.changed.map(i=>i.sku)).toEqual(['SKU3']);expect(result.uncertain.map(i=>i.sku)).toEqual(['SKU4']);
 });
 it('寫入20秒逾時，不自動重送且標示結果不確定',async()=>{
  vi.useFakeTimers();try{
   const fetch=vi.fn(()=>new Promise(()=>{}));const promise=load({fetch}).requestJson('/fake',{},'POST');const assertion=expect(promise).rejects.toMatchObject({uncertain:true});
   await vi.advanceTimersByTimeAsync(20000);await assertion;expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  }finally{vi.useRealTimers();}
 });
 it('讀取逾時不誤稱寫入不確定',async()=>{
  vi.useFakeTimers();try{const promise=load({fetch:()=>new Promise(()=>{})}).requestJson('/fake',null,'GET');const assertion=expect(promise).rejects.toMatchObject({uncertain:false});await vi.advanceTimersByTimeAsync(20000);await assertion;}finally{vi.useRealTimers();}
 });
 it('非JSON登入頁不能算成功，網路中斷不直接重試寫入',async()=>{
  await expect(load({fetch:async()=>({ok:true,status:200,json:async()=>{throw new Error('html');}})}).requestJson('/fake',{})).rejects.toMatchObject({uncertain:true});
  await expect(load({fetch:async()=>{throw new Error('offline');}}).requestJson('/fake',{})).rejects.toMatchObject({uncertain:true});
 });
 it('正常回應與HTTP錯誤仍保存原有後端結果',async()=>{
  const payload={resolutionType:'cancelled',reason:'合成原因'};const fetch=vi.fn(async()=>({ok:true,json:async()=>({status:'cancelled'})}));
  expect(await load({fetch}).requestJson('/fake',payload)).toMatchObject({status:'cancelled'});expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(payload);
  await expect(load({fetch:async()=>({ok:false,status:403,json:async()=>({error:'權限不足'})})}).requestJson('/fake',{})).rejects.toMatchObject({status:403,message:'權限不足'});
 });
});

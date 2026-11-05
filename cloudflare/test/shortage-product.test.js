import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
const sandbox={console}; vm.createContext(sandbox);
vm.runInContext(readFileSync('../procurement-planning/shortage-batch.js','utf8'),sandbox);
const group=sandbox.ProcurementShortageBatch.groupProducts;
const rows=[
 {store_code:'R01',sku:'N11017',product_name:'合成商品',unfilled_quantity:5,covered_quantity:5,fulfilled_quantity:2,needed_by:'2026-11-12',source_batch_id:'B1',handling_mode:'merge_next'},
 {store_code:'R03',sku:'N11017',product_name:'合成商品',unfilled_quantity:8,covered_quantity:0,fulfilled_quantity:1,needed_by:'2026-11-10',source_batch_id:'B2',handling_mode:'new_order'},
 {store_code:'R01',sku:'N110170',product_name:'不同品號',unfilled_quantity:0,covered_quantity:0,fulfilled_quantity:0}
];
describe('缺貨商品彙整只改呈現',()=>{
 it('同品號跨店只列一次、相似品號不合併，各店來源與狀態保留',()=>{
  const before=JSON.stringify(rows); const result=group(rows);expect(result).toHaveLength(2);
  const item=result.find(r=>r.sku==='N11017');
  expect(item).toMatchObject({unfilled:13,covered:5,purchaseUncovered:8,transferRemaining:10,stores:['R01','R03'],earliestNeededBy:'2026-11-10'});
  expect(item.rows[0]).toBe(rows[0]);expect(item.rows[1]).toBe(rows[1]);expect(JSON.stringify(rows)).toBe(before);
 });
 it('先逐店計算缺口再加總，別店超額覆蓋不抵掉未採購量',()=>{
  const result=group([{...rows[0],covered_quantity:20,fulfilled_quantity:20},rows[1]])[0];
  expect(result.purchaseUncovered).toBe(8);expect(result.transferRemaining).toBe(7);expect(result.unfilled).toBe(13);
 });
 it('空清單、明確零值、未知到店日與特殊品號均保留',()=>{
  expect(group([])).toHaveLength(0);
  expect(group([{store_code:'R01',sku:'<N&1>',product_name:'<合成>',unfilled_quantity:0}])[0]).toMatchObject({sku:'<N&1>',purchaseUncovered:0,transferRemaining:0,earliestNeededBy:''});
 });
 it('600筆明細彙整後數量與筆數守恆',()=>{
  const sample=Array.from({length:600},(_,i)=>({store_code:`R0${i%6}`,sku:`N${Math.floor(i/6)}`,unfilled_quantity:i%7,covered_quantity:i%2,fulfilled_quantity:i%3}));
  const result=group(sample);expect(result).toHaveLength(100);expect(result.flatMap(r=>r.rows)).toHaveLength(600);
  expect(result.reduce((sum,r)=>sum+r.unfilled,0)).toBe(sample.reduce((sum,r)=>sum+r.unfilled_quantity,0));
 });
});

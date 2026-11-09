import {readFileSync} from 'node:fs';import vm from 'node:vm';import {it,expect} from 'vitest';
const b={};vm.createContext(b);vm.runInContext(readFileSync('../store-transfer/bulk-supply.js','utf8'),b);const api=b.StoreTransferBulkSupply;
const rows=Array.from({length:73},(_,i)=>({sku:`SKU${i}`,extraQuantity:0,maxExtra:10,baseReleasable:0,allocated:0,canEdit:i!==30}));
it('單品、本頁、跨頁全選保留草稿，個別取消及不可選品項隔離',()=>{
 const m=api.createSelection(rows);m.select('SKU1',true);m.selectPage(1);expect(m.selected.size).toBe(25);expect(m.selected.has('SKU30')).toBe(false);m.drafts.set('SKU1','3');m.selectPage(2);expect(m.drafts.get('SKU1')).toBe('3');expect(m.selected.size).toBe(48);m.selectAll();expect(m.selected.size).toBe(72);m.select('SKU1',false);expect(m.items()).toHaveLength(71);m.selected.clear();expect(m.validate()).toContain('請先勾選品項。');
});
it('跨頁逐品號空白、小數、超量及低於占用皆阻擋；0保留',()=>{
 const m=api.createSelection([...rows,{sku:'ALLOC',canEdit:true,extraQuantity:3,maxExtra:10,allocated:4,baseReleasable:1}]);m.selectAll();expect(m.validate()).toHaveLength(0);m.drafts.set('SKU1','');m.drafts.set('SKU51','11');m.drafts.set('SKU70','1.5');m.drafts.set('ALLOC','2');expect(m.validate()).toHaveLength(4);expect(m.items().find(r=>r.sku==='SKU0').extraQuantity).toBe(0);expect(api.createSelection(rows).selected.size).toBe(0);
});
it('直接新增、額度用完、未知及批次鎖定各自說明，不把無保留誤稱不能申請',()=>{
 const row={supplyKnown:true,batchEditable:true,remainingQuantity:7,directManualAllowed:true,reserve:0};
 expect(api.availabilityMessage(row)).toEqual({tone:'ready',text:'可直接人工新增，不需額外開放。'});
 expect(api.availabilityMessage({...row,remainingQuantity:0,directManualAllowed:false}).text).toContain('目前剩餘可申請量為0');
 expect(api.availabilityMessage({...row,remainingQuantity:0,directManualAllowed:false,reserve:4}).text).toContain('總部評估');
 expect(api.availabilityMessage({...row,remainingQuantity:null,supplyKnown:false}).tone).toBe('warn');
 expect(api.availabilityMessage({...row,batchEditable:false}).text).toContain('沒有可編輯門市');
 expect(api.availabilityMessage({}).tone).toBe('warn');
});

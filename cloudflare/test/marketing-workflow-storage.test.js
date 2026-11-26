import {it,expect} from 'vitest';
import {spreadsheetFixture} from './helpers/marketing-runtime.js';
const key='snapshot:fixture',log='行銷流程版本紀錄';
function setup(){const f=spreadsheetFixture();Object.getPrototypeOf(f.source).hideSheet=function(){return this};return f;}
it('writes all parts and completion in one range under a shared writer lock, then validates the complete record',()=>{
 const f=setup();let held=false,acquired=0,released=0;f.c.LockService.getScriptLock=()=>({tryLock(){expect(held).toBe(false);held=true;acquired++;return true},releaseLock(){held=false;released++}});
 const value={text:'羊毛被\n'.repeat(17000),selected:['A1'],count:1};expect(f.c.marketingWorkflowRecord_(f.ss,key,value)).toEqual(value);const rows=f.ss.getSheetByName(log).rows;
 expect(rows.filter(r=>r[6]==='part').length).toBeGreaterThan(1);expect(rows.at(-1)[6]).toBe('complete');expect(f.c.marketingWorkflowRecord_(f.ss,key)).toEqual(value);expect(acquired).toBe(1);expect(released).toBe(1);
});
it('a competing record writer cannot overwrite another writer or publish an orphan completion marker',()=>{
 const f=setup();f.c.marketingWorkflowRecord_(f.ss,'seed',{});const s=f.ss.getSheetByName(log),proto=Object.getPrototypeOf(s.getRange(1,1)),original=proto.setValues;let held=false,attempted=false;
 f.c.LockService.getScriptLock=()=>({tryLock(){if(held)return false;held=true;return true},releaseLock(){held=false}});
 proto.setValues=function(values){if(this.sheet===s){expect(held).toBe(true);if(!attempted){attempted=true;expect(()=>f.c.marketingWorkflowRecord_(f.ss,'competing',{bad:true})).toThrow(/尚未寫入/);}expect(values.at(-1)[6]).toBe('complete');}return original.call(this,values)};
 try{f.c.marketingWorkflowRecord_(f.ss,key,{count:2});expect(f.c.marketingWorkflowRecord_(f.ss,key)).toEqual({count:2});expect(f.c.marketingWorkflowRecord_(f.ss,'competing')).toBeNull();expect(attempted).toBe(true);}finally{proto.setValues=original}
});
it('failure releases the writer lock and cannot activate a completion-only record',()=>{
 const f=setup();f.c.marketingWorkflowRecord_(f.ss,'seed',{});const s=f.ss.getSheetByName(log),proto=Object.getPrototypeOf(s.getRange(1,1)),original=proto.setValues;let released=0;
 f.c.LockService.getScriptLock=()=>({tryLock:()=>true,releaseLock(){released++}});proto.setValues=function(v){if(this.sheet===s)throw Error('injected range failure');return original.call(this,v)};
 try{expect(()=>f.c.marketingWorkflowRecord_(f.ss,key,{count:1})).toThrow(/injected/);expect(f.c.marketingWorkflowRecord_(f.ss,key)).toBeNull();expect(released).toBe(1);}finally{proto.setValues=original}
});
it('missing latest parts still fail closed and never silently fall back to an older snapshot',()=>{
 const f=setup();f.c.marketingWorkflowRecord_(f.ss,key,{count:1});f.c.marketingWorkflowRecord_(f.ss,key,{count:2});const s=f.ss.getSheetByName(log);s.rows.splice(-2,1);expect(()=>f.c.marketingWorkflowRecord_(f.ss,key)).toThrow(/流程歷史儲存不完整/);
});
it('restoring exact missing parts is append-only and does not rewrite earlier history',()=>{
 const f=setup(),value={count:29,decisionHash:'',unifiedHash:''};f.c.marketingWorkflowRecord_(f.ss,key,value);f.c.marketingWorkflowRecord_(f.ss,key,value);const s=f.ss.getSheetByName(log),missing=s.rows.splice(-2,1)[0],before=JSON.stringify(s.rows);
 expect(()=>f.c.marketingWorkflowRecord_(f.ss,key)).toThrow(/不完整/);s.rows.push(missing);expect(JSON.stringify(s.rows.slice(0,-1))).toBe(before);expect(f.c.marketingWorkflowRecord_(f.ss,key)).toEqual(value);
});
it('direct-edit invalidation respects the same document lock as manual additions and review, keeping user edits on contention',()=>{
 const f=setup();f.c.setupMarketingSync();f.c.syncMarketingFromPanel();f.c.upgradeMarketingUnifiedReview();const s=f.ss.getSheetByName('活動案型');s.getRange(2,2).setValue('人工修改保留');const before=JSON.stringify(f.ss.getSheets().map(s=>s.rows));let called=0;f.c.LockService.getDocumentLock=()=>({tryLock(){called++;return false},releaseLock(){throw Error('must not release unowned lock')}});
 f.c.onEdit({source:f.ss,range:s.getRange(2,2)});expect(called).toBe(1);expect(JSON.stringify(f.ss.getSheets().map(s=>s.rows))).toBe(before);
});
it('after exact append-only recovery, the real manual-add and unified-review flow succeeds without resync or changes to neighbors',()=>{
 const f=setup();f.source.rows[1][1]='⚠ 排除特賣品\n*華爾紗兩用被套85折\n門市：11/11 00:00 - 11/15 23:59';f.c.setupMarketingSync();f.c.syncMarketingFromPanel();f.c.upgradeMarketingUnifiedReview();
 const run=f.control.getRange('B7').getValue(),offer=f.c.marketingCurrentOffers_(f.ss,run)[0],id=f.c.marketingReviewId_(offer),snap=f.c.marketingSnapshot_(run,id),originalSource=f.source.rows[1][1],snapshotKey='snapshot:'+f.c.marketingProductKey_(run,id);
 f.c.marketingWorkflowRecord_(f.ss,'run:'+run,{version:'20261125-marketing-channel-r3'});f.c.marketingWorkflowRecord_(f.ss,snapshotKey,snap);f.c.marketingWorkflowRecord_(f.ss,snapshotKey,snap);
 const s=f.ss.getSheetByName(log),missing=s.rows.splice(-2,1)[0],before=JSON.stringify(s.rows);expect(()=>f.c.loadMarketingReview('all','','20261105-marketing-select-all-r11')).toThrow(/流程歷史儲存不完整/);
 s.rows.push(missing);expect(JSON.stringify(s.rows.slice(0,-1))).toBe(before);const added=f.c.addMarketingProducts(id,run,['A3'],'20261105-marketing-select-all-r11');expect(added.addedCount).toBe(1);expect(added.preview.offers[0].error).toBe('');
 expect(f.c.confirmMarketingReview(added.preview.token,[id],'20261105-marketing-select-all-r11').success).toBe(1);expect(f.c.marketingCurrentOffers_(f.ss,run)[0].values[10]).toBe('已覆核');expect(f.c.marketingSnapshot_(run,id).count).toBe(3);expect(f.control.getRange('B7').getValue()).toBe(run);expect(f.source.rows[1][1]).toBe(originalSource);
});

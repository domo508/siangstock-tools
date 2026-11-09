import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {it,expect,vi} from 'vitest';
class Element {
  constructor(){this.listeners={};this.value='';this.disabled=false;this.textContent='';this.files=[];this.isConnected=true;this.focus=vi.fn();}
  addEventListener(name,fn){this.listeners[name]=fn;}
  async fire(name){return this.listeners[name]?.();}
  async click(){if(!this.disabled)return this.fire('click');}
}
function setup({authorized=true,fail=false}={}) {
 const nodes=Object.fromEntries(['date','status','download','file','source','batch','load','authorize','close'].map(k=>[k,new Element()]));
 const dialog=new Element();dialog.querySelector=s=>nodes[s.match(/"(.*?)"/)[1]];dialog.showModal=vi.fn();dialog.close=()=>dialog.fire('close');
 const data={batch:{id:'SYNTH',revision:1},items:[{supplier:'普優瑪'}]};
 const api={shipmentDate:date=>{if(!date)throw Error('日期');},isPuyouma:()=>true,parseSource:()=>({currentHeader:'庫存11/9'}),buildOrder:()=>({workbook:{},fileName:'合成.xlsx',rows:[{}],quantity:3,shipmentDate:'2026-11-06'})};
 const sources={token:()=>authorized,initialize:vi.fn(),authorize:vi.fn(async()=>{authorized=true;}),verifyCompanyIdentity:vi.fn(),loadPuyoumaConsignment:vi.fn(async()=>{if(fail)throw Error('讀取失敗');return {workbook:{},metadata:{fetchedAt:'2026-11-09T00:00:00Z'}};})};
 const writer={writeFile:vi.fn()},fetch=vi.fn(async()=>({ok:true,json:async()=>structuredClone(data)}));
 const ctx={fetch,console,Date};ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(readFileSync('../procurement-planning/puyouma-order-ui.js','utf8'),ctx);
 const controller=ctx.PuyoumaOrderUI.createController({dialog,api,core:{},reader:{},writer,readWorkbook:async()=>({}),getConfig:()=>({googleOAuthClientId:'SYNTH'}),googleSources:sources,ensureCurrent:async()=>true});
 return {nodes,dialog,controller,sources,writer,fetch,setFail:value=>{fail=value;},open:()=>controller.open({id:'SYNTH',status:'approved',supplier_summary:['普優瑪']},new Element())};
}
it('有效授權自動讀取成功即停用兩按鈕，仍可填日期下載；重開才再讀取',async()=>{
 const t=setup();await t.open();expect(t.sources.loadPuyoumaConsignment).toHaveBeenCalledTimes(1);
 expect(t.nodes.load.disabled).toBe(true);expect(t.nodes.authorize.disabled).toBe(true);expect(t.nodes.source.textContent).toContain('寄庫資料已就緒');
 await t.nodes.load.click();await t.nodes.authorize.fire('click');expect(t.sources.authorize).not.toHaveBeenCalled();expect(t.sources.loadPuyoumaConsignment).toHaveBeenCalledTimes(1);
 expect(t.nodes.download.disabled).toBe(true);t.nodes.date.value='2026-11-06';await t.nodes.date.fire('input');await t.nodes.download.click();
 expect(t.writer.writeFile).toHaveBeenCalledTimes(1);expect(t.nodes.status.textContent).toContain('已匯出1個品號、3件');expect(t.nodes.load.disabled).toBe(true);
 await t.dialog.close();await t.open();expect(t.nodes.date.value).toBe('');expect(t.sources.loadPuyoumaConsignment).toHaveBeenCalledTimes(2);
});
it('讀取失敗恢復按鈕，可手動重試；成功後不重複授權',async()=>{
 const t=setup({fail:true});await t.open();expect(t.nodes.load.disabled).toBe(false);expect(t.nodes.authorize.disabled).toBe(false);expect(t.nodes.download.disabled).toBe(true);
 t.setFail(false);await t.nodes.load.click();expect(t.nodes.load.disabled).toBe(true);expect(t.nodes.authorize.disabled).toBe(true);expect(t.sources.authorize).not.toHaveBeenCalled();
});
it('尚無授權可授權並取得；手動備援成功亦不再要求Google授權',async()=>{
 const t=setup({authorized:false});await t.open();expect(t.nodes.authorize.disabled).toBe(false);await t.nodes.authorize.click();expect(t.sources.authorize).toHaveBeenCalledTimes(1);expect(t.nodes.authorize.disabled).toBe(true);
 const m=setup({authorized:false});await m.open();m.nodes.file.files=[{name:'合成寄庫.xlsx'}];await m.nodes.file.fire('change');
 expect(m.nodes.source.textContent).toContain('寄庫資料已就緒');expect(m.nodes.load.disabled).toBe(true);expect(m.nodes.authorize.disabled).toBe(true);expect(m.sources.authorize).not.toHaveBeenCalled();
});

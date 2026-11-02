import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describe,it,expect,vi} from 'vitest';
const version=JSON.parse(readFileSync('../live-guidance/version.json','utf8')).version;
const script=readFileSync('../live-guidance/app.js','utf8');
function page(){
 const listeners={},focus={},requests=[],nodes=[];
 const node=tag=>{const el={tag,listeners:{},append(){},prepend(){},before(){},after(){},setAttribute(){},addEventListener(n,fn){this.listeners[n]=fn},querySelector(){return null},contains(){return false},style:{},dataset:{}};nodes.push(el);return el;};
 const main=node(),document={currentScript:{src:'https://local.test/live-guidance/app.js',dataset:{}},querySelector:s=>s==='main'?main:null,createElement:node,createComment:node,querySelectorAll:()=>[],addEventListener:(n,f)=>{(listeners[n]??=[]).push(f)}};
 const ctx={document,URL,WeakMap,Promise,Event:class{constructor(type,options){this.type=type;Object.assign(this,options)}},AbortController,setTimeout,clearTimeout,setInterval(){},requestAnimationFrame(){return 1},MutationObserver:class{observe(){}},window:{addEventListener:(n,f)=>{focus[n]=f}},fetch:(_,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});requests.push({resolve,reject})})};
 vm.runInNewContext(readFileSync('../live-guidance/progress.js','utf8'),ctx);
 vm.runInNewContext(script,ctx);
 function fire(input,type='change'){
  const e={target:input,type,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};
  for(const fn of listeners[type]||[]){fn(e);if(e.stopped)break;}
  if(!e.stopped && type==='change')input.handled++;
  return e;
 }
 const input=()=>({files:[{}],isConnected:true,disabled:false,handled:0,matches:s=>s==='input[type="file"]',closest:s=>s==='#version-warning'?null:({}),dispatchEvent(e){fire(this,e.type)}});
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
 const finish=async(v=version)=>{requests.shift().resolve({ok:true,json:async()=>({version:v})});await flush()};
 return {input,fire,focus,requests,finish,flush,api:ctx.CompanyGuidance,retry:()=>nodes.find(n=>n.tag==='button').listeners.click()};
}
describe('原生選檔返回與版本檢查時序',()=>{
 it('初始版本確認中保留四類選檔，成功後各處理一次',async()=>{const p=page();const fields=Array.from({length:4},p.input);for(const i of fields){expect(p.fire(i).stopped).toBe(true);expect(i.handled).toBe(0)}expect(p.requests).toHaveLength(1);await p.finish();expect(fields.map(i=>i.handled)).toEqual([1,1,1,1]);});
 it('已就緒時直接傳遞；重新聚焦檢查期間不遺失選檔',async()=>{const p=page();await p.finish();const i=p.input();expect(p.fire(i).stopped).not.toBe(true);expect(i.handled).toBe(1);p.focus.focus();p.fire(i);expect(i.handled).toBe(1);await p.finish();expect(i.handled).toBe(2);});
 it.each(['future-version',null])('版本過期或失敗不處理選檔：%s',async v=>{const p=page(),i=p.input();p.fire(i);if(v)await p.finish(v);else{p.requests.shift().reject(Error('offline'));await p.flush()}expect(i.handled).toBe(0);expect(p.fire(i).stopped).toBe(true);expect(p.requests).toHaveLength(0);});
 it('等待時重選檔案只採用最後一次',async()=>{const p=page(),i=p.input();p.fire(i);i.files=[{}];p.fire(i);await p.finish();expect(i.handled).toBe(1);});
 it.each(['disabled','removed','selection-replaced'])('不處理已失效的選檔：%s',async mode=>{const p=page(),i=p.input();p.fire(i);if(mode==='disabled')i.disabled=true;if(mode==='removed')i.isConnected=false;if(mode==='selection-replaced')i.files=[{}];await p.finish();expect(i.handled).toBe(0);});
 it('版本確認中仍阻擋一般按鈕和表單，不自動送出',async()=>{const p=page(),i=p.input();i.matches=()=>false;expect(p.fire(i,'click').stopped).toBe(true);expect(p.fire(i,'submit').stopped).toBe(true);expect(p.fire(i).stopped).toBe(true);await p.finish();expect(i.handled).toBe(0);});
});

describe('版本查詢暫時失敗可恢復且不清除選檔',()=>{
 it('短暫斷線不等於新版；重新確認成功後恢復該次選檔一次',async()=>{const p=page(),i=p.input(),files=i.files;p.fire(i);p.requests.shift().reject(Error('offline'));await p.flush();expect(i.handled).toBe(0);expect(i.files).toBe(files);p.retry();expect(p.requests).toHaveLength(1);await p.finish();expect(i.handled).toBe(1);expect(i.files).toBe(files);});
 it('逾時後保持資料並允許重新確認，不永久鎖定',async()=>{vi.useFakeTimers();try{const p=page(),i=p.input();p.fire(i);await vi.advanceTimersByTimeAsync(10000);p.requests.shift();expect(i.handled).toBe(0);p.retry();await p.finish();expect(i.handled).toBe(1);}finally{vi.useRealTimers()}});
 it.each([401,403,500])('HTTP %s 只阻擋新操作，登入或服務恢復後可重新確認',async status=>{const p=page(),i=p.input();p.fire(i);p.requests.shift().resolve({ok:false,status});await p.flush();expect(i.handled).toBe(0);p.retry();await p.finish();expect(i.handled).toBe(1);});
 it('格式異常不可當作新版，也不可沿用舊版本；修復後才處理',async()=>{const p=page(),i=p.input();p.fire(i);await p.finish('');expect(i.handled).toBe(0);p.retry();await p.finish();expect(i.handled).toBe(1);});
 it('真正不同版本保持鎖定，不得用重新確認繞過',async()=>{const p=page(),i=p.input();p.fire(i);await p.finish('future-version');expect(await p.api.ensureCurrent()).toBe(false);expect(p.requests).toHaveLength(0);expect(i.handled).toBe(0);});
 it('重試成功仍不得復用已變更的選取或自動點擊業務操作',async()=>{const p=page(),i=p.input();p.fire(i);p.requests.shift().reject(Error('offline'));await p.flush();i.files=[{}];p.retry();await p.finish();expect(i.handled).toBe(0);});
});

// Context hooks observe focus only; they do not replay or trigger business actions.
it('切換操作卡片只通知情境，不送出業務請求',async()=>{
 const p=page();await p.finish();const calls=[];p.api.register({context(target){calls.push(target);return 'activity-settings';},resolve(){return {title:'活動設定'};}});
 const field=p.input();p.fire(field,'focusin');expect(calls).toEqual([field]);expect(field.handled).toBe(0);expect(p.requests).toHaveLength(0);
});

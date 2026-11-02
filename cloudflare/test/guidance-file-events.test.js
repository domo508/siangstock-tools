import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describe,it,expect} from 'vitest';
const version=JSON.parse(readFileSync('../live-guidance/version.json','utf8')).version;
const script=readFileSync('../live-guidance/app.js','utf8');
function page(){
 const listeners={},focus={},requests=[];
 const node=()=>({append(){},prepend(){},before(){},after(){},setAttribute(){},addEventListener(){},querySelector(){return null},contains(){return false},style:{},dataset:{}});
 const main=node(),document={currentScript:{src:'https://local.test/live-guidance/app.js',dataset:{}},querySelector:s=>s==='main'?main:null,createElement:node,createComment:node,querySelectorAll:()=>[],addEventListener:(n,f)=>{(listeners[n]??=[]).push(f)}};
 const ctx={document,URL,WeakMap,Promise,Event:class{constructor(type,options){this.type=type;Object.assign(this,options)}},AbortController,setTimeout,clearTimeout,setInterval(){},requestAnimationFrame(){return 1},MutationObserver:class{observe(){}},window:{addEventListener:(n,f)=>{focus[n]=f}},fetch:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))};
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
 return {input,fire,focus,requests,finish,flush};
}
describe('原生選檔返回與版本檢查時序',()=>{
 it('初始版本確認中保留四類選檔，成功後各處理一次',async()=>{const p=page();const fields=Array.from({length:4},p.input);for(const i of fields){expect(p.fire(i).stopped).toBe(true);expect(i.handled).toBe(0)}expect(p.requests).toHaveLength(1);await p.finish();expect(fields.map(i=>i.handled)).toEqual([1,1,1,1]);});
 it('已就緒時直接傳遞；重新聚焦檢查期間不遺失選檔',async()=>{const p=page();await p.finish();const i=p.input();expect(p.fire(i).stopped).not.toBe(true);expect(i.handled).toBe(1);p.focus.focus();p.fire(i);expect(i.handled).toBe(1);await p.finish();expect(i.handled).toBe(2);});
 it.each(['future-version',null])('版本過期或失敗不處理選檔：%s',async v=>{const p=page(),i=p.input();p.fire(i);if(v)await p.finish(v);else{p.requests.shift().reject(Error('offline'));await p.flush()}expect(i.handled).toBe(0);expect(p.fire(i).stopped).toBe(true);expect(p.requests).toHaveLength(0);});
 it('等待時重選檔案只採用最後一次',async()=>{const p=page(),i=p.input();p.fire(i);i.files=[{}];p.fire(i);await p.finish();expect(i.handled).toBe(1);});
 it.each(['disabled','removed','selection-replaced'])('不處理已失效的選檔：%s',async mode=>{const p=page(),i=p.input();p.fire(i);if(mode==='disabled')i.disabled=true;if(mode==='removed')i.isConnected=false;if(mode==='selection-replaced')i.files=[{}];await p.finish();expect(i.handled).toBe(0);});
 it('版本確認中仍阻擋一般按鈕和表單，不自動送出',async()=>{const p=page(),i=p.input();i.matches=()=>false;expect(p.fire(i,'click').stopped).toBe(true);expect(p.fire(i,'submit').stopped).toBe(true);expect(p.fire(i).stopped).toBe(true);await p.finish();expect(i.handled).toBe(0);});
});

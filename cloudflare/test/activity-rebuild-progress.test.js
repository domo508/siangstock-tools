import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {afterEach,describe,it,expect,vi} from 'vitest';
const app=readFileSync('../procurement-planning/app.js','utf8');
function section(start,end){return app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));}
function runtime(){
 const reports=[],controls={mode:'ok',cache:null,terminated:0,files:2};
 class Worker {
  constructor(){this.listeners=new Map();}
  addEventListener(event,fn){this.listeners.set(event,fn);}
  removeEventListener(event){this.listeners.delete(event);}
  postMessage(payload){if(controls.mode===payload.type)return;queueMicrotask(()=>this.listeners.get('message')?.({data:payload.type==='finalize'?{history:{version:1,cells:[],intervals:[]}}:{type:payload.type}}));}
  terminate(){controls.terminated++;}
 }
 const sandbox={AbortController,setTimeout,clearTimeout,queueMicrotask,TextEncoder,Worker,console,APP_VERSION:'test',MAX_SEASONAL_SOURCE_BYTES:45*1024*1024,
  state:{googleAuthorized:true,config:{fixedSources:{seasonalSalesFolderId:'synthetic'}},salesFiles:[]},
  googleSources:{listDriveExcelFiles:async(_folder,{signal})=>{if(controls.mode==='list')return new Promise(()=>{});expect(signal).toBeTruthy();return Array.from({length:controls.files},(_,i)=>({id:String(i),size:1,name:'synthetic.xlsx'}));},downloadDriveFile:async()=>{if(controls.mode==='download')return new Promise(()=>{});return {arrayBuffer:async()=>new ArrayBuffer(0)};}},
  sourceSha256:async()=> 'synthetic-hash',setStatus:message=>reports.push(message)};
 vm.createContext(sandbox);vm.runInContext(section('  function workerRequest(','  function modelStamp(')+section('  async function activityHistoryStep(','  get("#build-transfer-activity-draft").addEventListener(')+section('  async function loadActivityHistory(','  function updateAutomaticForecastCost('),sandbox);
 sandbox.activityHistoryCache=async(mode)=>{if(controls.mode==='cache')return new Promise(()=>{});return mode==='readonly'?controls.cache:null;};
 return {sandbox,reports,controls};
}
afterEach(()=>vi.useRealTimers());
describe('活動重建同區進度與有限等待',()=>{
 it('各階段及每個檔案均回報，保留原歷史彙總',async()=>{const r=runtime();const result=await r.sandbox.loadActivityHistory([],{onProgress:m=>r.reports.push(m)});expect(result).toMatchObject({version:1});expect(r.controls.terminated).toBe(1);for(const text of ['檔案清單','本機歷史彙總','下載歷史銷售 1/2','解析歷史銷售 2/2','核對近期','彙整歷史','保存已驗證'])expect(r.reports.some(m=>m.includes(text))).toBe(true);});
 it('相同版本命中快取不重新下載或啟動背景程序',async()=>{const r=runtime();r.controls.cache={version:1,cells:['synthetic']};expect(await r.sandbox.loadActivityHistory([])).toEqual(r.controls.cache);expect(r.controls.terminated).toBe(0);expect(r.reports.some(m=>m.includes('已取得本機'))).toBe(true);});
 for(const mode of ['list','cache','initialize','download','ingest','recent','finalize'])it(`${mode}無回應時明確停止並釋放背景程序`,async()=>{vi.useFakeTimers();const r=runtime();r.controls.mode=mode;const promise=r.sandbox.loadActivityHistory([]);const assertion=expect(promise).rejects.toThrow('超過等待時間');await vi.runAllTimersAsync();await assertion;expect(r.controls.terminated).toBe(['list','cache'].includes(mode)?0:1);});
 it('逾時先回報具體原因再中止網路，避免只顯示AbortError',async()=>{vi.useFakeTimers();const r=runtime();let signal;const pending=r.sandbox.activityHistoryStep('正在下載第1份',s=>{signal=s;return new Promise((_,reject)=>s.addEventListener('abort',()=>reject(new Error('AbortError'))));},()=>{},20);const assertion=expect(pending).rejects.toThrow('正在下載第1份 超過等待時間');await vi.runAllTimersAsync();await assertion;expect(signal.aborted).toBe(true);});
 it('背景讀取成功後清除逾時計時器',async()=>{vi.useFakeTimers();const r=runtime();expect(await r.sandbox.activityHistoryStep('檢查',async()=>42,()=>{},20)).toBe(42);expect(vi.getTimerCount()).toBe(0);});
 it('Google未授權立即提示，不啟動背景工作',async()=>{const r=runtime();r.sandbox.state.googleAuthorized=false;await expect(r.sandbox.loadActivityHistory([])).rejects.toThrow('Google授權');expect(r.controls.terminated).toBe(0);});
});

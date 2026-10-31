import {it,expect,vi,afterEach} from 'vitest';
import {recognitionResponse} from '../worker/src/store-order-stream';
afterEach(()=>vi.useRealTimers());
it('超過兩分鐘仍持續保活，只在工作完成後輸出整份JSON，不洩露部分結果',async()=>{
 vi.useFakeTimers();let finish;const work=new Promise(resolve=>{finish=resolve;});
 const response=recognitionResponse(()=>work,()=>({error:'safe',status:503}));
 expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('content-encoding')).toBe('identity');
 const reader=response.body.getReader(),decoder=new TextDecoder();let text=decoder.decode((await reader.read()).value);
 expect(text.trim()).toBe('');vi.advanceTimersByTime(130000);
 for(let i=0;i<13;i++){const part=await reader.read();expect(part.done).toBe(false);text+=decoder.decode(part.value);}
 expect(text.trim()).toBe('');finish({extraction:{rows:[{sku:'TEST',quantity:2}]}});
 while(true){const part=await reader.read();if(part.done)break;text+=decoder.decode(part.value);}
 expect(JSON.parse(text).extraction.rows).toEqual([{sku:'TEST',quantity:2}]);expect(vi.getTimerCount()).toBe(0);
});
it('串流後服務拒絕仍回傳可判別的安全錯誤，不以HTTP200當辨識成功',async()=>{
 const response=recognitionResponse(async()=>{throw Error('private upstream key');},()=>({error:'請稍後再試',status:429}));
 expect(await response.json()).toEqual({error:'請稍後再試',status:429});
});
it('手機取消連線時停止保活，不向已關閉串流寫入或自動再呼叫AI',async()=>{
 vi.useFakeTimers();let finish;const work=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
 const response=recognitionResponse(work,()=>({error:'safe',status:503}));await response.body.cancel();expect(vi.getTimerCount()).toBe(0);finish({completed:true});await Promise.resolve();expect(work).toHaveBeenCalledOnce();
});

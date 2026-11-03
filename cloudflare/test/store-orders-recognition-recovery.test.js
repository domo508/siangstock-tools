import {it,expect,vi} from 'vitest';
import {waitRecognition,collectRecognition,recognitionQuery} from '../../store-orders/recognition-job.js';
const page={storeCode:'R14',fileId:'source-file-1',index:0};
const result={extraction:{header:{paperNumber:'SYNTHETIC'},rows:[]}};
it('查詢原作業從處理中至完成，只有GET，不提交新AI',async()=>{
 let n=0;const api=vi.fn(async()=>++n===1?{job:{id:'job',status:'processing'}}:{job:{id:'job',status:'completed'},result});
 expect(await waitRecognition(page,{api,jobId:'job',sleep:async()=>{}})).toEqual(result);expect(api.mock.calls.every(args=>args.length===1&&args[0].startsWith('/recognitions?'))).toBe(true);
});
it('辨識失敗、作業不同、缺完整表頭均拒絕，不自動重送',async()=>{
 for(const data of [{job:{id:'job',status:'failed',error:'5分鐘上限'}},{job:{id:'other',status:'completed'},result},{job:{id:'job',status:'completed'},result:{extraction:{}}}])await expect(waitRecognition(page,{api:async()=>data,jobId:'job'})).rejects.toThrow();
});
it('多頁只在全部完成後回傳，缺頁或第二頁失敗均不套用第一頁',async()=>{
 const pages=[page,{...page,index:1}];const api=async path=>path.endsWith('=0')?{job:{id:'a',status:'completed'},result}:{job:null};await expect(collectRecognition(pages,{api})).rejects.toThrow(/第2頁/);
 const rows=await collectRecognition(pages,{api:async path=>({job:{id:path,status:'completed'},result})});expect(rows).toEqual([result,result]);expect(recognitionQuery(pages[1])).toContain('pageIndex=1');
});
it('網路中斷及查詢等待上限保留原作業，沒有重送',async()=>{
 const api=vi.fn(async()=>{throw new TypeError('network');});await expect(waitRecognition(page,{api,jobId:'job'})).rejects.toThrow('network');expect(api).toHaveBeenCalledOnce();
 await expect(waitRecognition(page,{api:async()=>({job:{id:'job',status:'processing'}}),jobId:'job',maxWait:0})).rejects.toThrow(/檢查／取回/);
});

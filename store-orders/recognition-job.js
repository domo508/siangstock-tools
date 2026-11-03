// Poll only an existing operation. This module never retries a paid submission.
export const recognitionQuery=p=>`/recognitions?store=${encodeURIComponent(p.storeCode)}&fileId=${encodeURIComponent(p.fileId)}&pageIndex=${p.index}`;
export async function waitRecognition(page,{api,jobId,onProgress=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,maxWait=360000}){
 const started=now();
 while(true){
  const data=await api(recognitionQuery(page));
  if(!data.job||data.job.id!==jobId)throw Error('辨識作業已改變或尚未確認提交，請檢查狀態；未自動重送');
  onProgress(data.job);
  if(data.job.status==='completed'){if(!data.result?.extraction?.header)throw Error('完整辨識結果尚未取得，未採用部分結果');return data.result;}
  if(data.job.status==='failed')throw Error(data.job.error||'辨識未完成，未自動重送；請人工填寫或明確重試');
  if(now()-started>=maxWait)throw Error('暫時無法確認辨識完成，未自動重送；請稍後按「檢查／取回辨識結果」');
  await sleep(5000);
 }
}
export async function collectRecognition(pages,{api,onProgress=()=>{},wait=waitRecognition}){
 const results=[];
 for(const [i,page] of pages.entries()){
  const data=await api(recognitionQuery(page));
  if(!data.job)throw Error(`第${i+1}頁沒有可取回的辨識作業，未套用部分結果；請完整辨識或人工補齊`);
  onProgress(data.job,i);
  results.push(data.job.status==='completed'&&data.result?data.result:await wait(page,{api,jobId:data.job.id,onProgress:job=>onProgress(job,i)}));
 }
 return results;
}

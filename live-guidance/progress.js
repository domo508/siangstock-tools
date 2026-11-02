/* Local display state only: no network, storage, timers or business actions. */
(function(root){
  'use strict';
  function classify(message, failed=false){
    if(failed) return 'error';
    if(/等待.*授權|請.*授權|授權.*暫停|尚未.*授權/.test(message)) return 'authorization';
    if(/正在|處理中|分析中|計算中|讀取中|下載中/.test(message)) return 'processing';
    if(/失敗|無法|錯誤|無權|未授權|衝突/.test(message)) return 'error';
    if(/完成|成功|已取得|已保存|已儲存|已發布/.test(message)) return 'complete';
    return 'waiting';
  }
  function create(now=()=>Date.now()){
    let value=null,signature='';
    return {
      report(record){
        const key=JSON.stringify([record.id,record.message,record.status,record.current,record.total]);
        if(key===signature)return;
        signature=key;value={...record,updatedAt:now()};
      },
      reset(){value=null;signature='';},
      view(){if(!value)return null;const elapsedSeconds=Math.max(0,Math.floor((now()-value.updatedAt)/1000));return {...value,elapsedSeconds,stalled:value.status==='processing'&&elapsedSeconds>=30};}
    };
  }
  root.CompanyGuidanceProgress=Object.freeze({create,classify});
})(globalThis);

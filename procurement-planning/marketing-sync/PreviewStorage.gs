// Short-lived preview validation belongs in document cache, never permanent snapshots.
const MS_PREVIEW_STORAGE_VERSION='20261120-preview-cache-r1';
function marketingPreviewCache_(){const cache=CacheService.getDocumentCache();if(!cache)throw new Error('預覽暫存服務未取得，請稍後重新讀取；未變更覆核。');return cache;}
function marketingSavePreview_(token,run,offers){
 const cache=marketingPreviewCache_(),at=Date.now(),values={};
 offers.forEach(x=>{values['marketing-preview:'+token+':'+x.id]=JSON.stringify({run,at,fingerprint:x.fingerprint});});
 cache.putAll(values,900);
 const saved=cache.getAll(Object.keys(values));if(Object.entries(values).some(([k,v])=>saved[k]!==v))throw new Error('預覽暫存未完整保存，請重新讀取核對；不會自動覆核。');
}
function marketingLoadPreview_(token,id){
 const key='marketing-preview:'+token+':'+id,cache=marketingPreviewCache_(),raw=cache.get(key);
 // Old open r11 windows remain readable until their original 15-minute expiry.
 return JSON.parse(raw===null?PropertiesService.getDocumentProperties().getProperty(key)||'null':raw);
}
function marketingConsumePreview_(token,id){
 const key='marketing-preview:'+token+':'+id;
 // Keep an expiring tombstone: an old Properties record must never resurrect it.
 const props=PropertiesService.getDocumentProperties();if(props.getProperty(key)!==null)props.setProperty(key,'null');
 marketingPreviewCache_().put(key,'null',900);
}
function marketingPreviewStorageReport_(){
 const all=PropertiesService.getDocumentProperties().getProperties(),now=Date.now(),groups={},expiredKeys=[],size=s=>encodeURIComponent(String(s)).replace(/%[A-F\d]{2}/gi,'x').length;
 for(const [key,value] of Object.entries(all)){
  const name=key.startsWith('marketing-preview:')?'preview':key.includes(':parts:')?'snapshotParts':key.startsWith('marketing-products:')?'snapshotRoots':'other',g=groups[name]||(groups[name]={count:0,bytes:0});g.count++;g.bytes+=size(key)+size(value);
  if(name!=='preview')continue;
  let p;try{p=JSON.parse(value);}catch(_){continue;}
  if(p===null||(p&&Number.isFinite(p.at)&&p.at>=0&&now-p.at>900000))expiredKeys.push(key);
 }
 return {groups,expiredKeys};
}
function diagnoseMarketingStorage(){const r=marketingPreviewStorageReport_(),result={readOnly:true,version:MS_PREVIEW_STORAGE_VERSION,groups:r.groups,expiredPreviewCount:r.expiredKeys.length};console.log(JSON.stringify(result));return result;}
function clearExpiredMarketingPreviews(){
 const lock=LockService.getDocumentLock();if(!lock.tryLock(1000))throw new Error('目前有作業處理中，尚未清理。');
 try{const props=PropertiesService.getDocumentProperties(),before=props.getProperties(),plan=marketingPreviewStorageReport_(),removed=[];
  for(const key of plan.expiredKeys){if(props.getProperty(key)!==before[key])throw new Error('預覽資料已變更，停止清理。');props.deleteProperty(key);removed.push(key);}
  const after=props.getProperties(),targets=new Set(removed);if(Object.entries(before).some(([k,v])=>!targets.has(k)&&after[k]!==v))throw new Error('保存資料核對不一致，停止操作。');
  const result={removed:removed.length,snapshotsAndOtherPropertiesUnchanged:true,version:MS_PREVIEW_STORAGE_VERSION};console.log(JSON.stringify(result));return result;
 }finally{lock.releaseLock();}
}

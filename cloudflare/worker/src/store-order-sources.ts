// Reversible photo disposition. No image, original filename or reason in D1.
export class SourceActionError extends Error {constructor(message:string,public status=409){super(message);}}
type Drive={checkFolder(folder:string,allowed:string[]):Promise<unknown>;meta(id:string):Promise<any>;sourceMeta?(id:string):Promise<any>;read(id:string,max:number):Promise<ArrayBuffer>;owned(id:string,folder:string):Promise<any>;write(folder:string,name:string,data:unknown,op:string):Promise<string>;json(id:string):Promise<any>;move(id:string,from:string,to:string,allowed:string[]):Promise<unknown>;checkPermissions(id:string,allowed:string[]):Promise<unknown>};
type Scope={store:string;actor:string;guest:boolean;hq:boolean;pending:string;recycle:string;hqEmails:string[];storeEmails:string[]};
const fail=(s:string,status=409):never=>{throw new SourceActionError(s,status);};
const now=()=>new Date().toISOString();
const digest=async(v:unknown)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))].map(n=>n.toString(16).padStart(2,'0')).join('');
const kinds=new Set(['image/jpeg','image/png','image/heic','image/heif','application/pdf']);
export async function sourceAction(db:D1Database,drive:Drive,scope:Scope,body:any){
 const {fileId,operationId,action,expectedVersion}=body;
 if(!/^[A-Za-z0-9_-]{8,200}$/.test(fileId||'')||!/^[A-Za-z0-9-]{8,80}$/.test(operationId||'')||!['remove','restore'].includes(action)||!Number.isSafeInteger(expectedVersion)||expectedVersion<0||body.confirmed!==true)fail('請核對照片、填寫原因並再次確認',400);
 if((action==='restore'||body.recordOnly===true)&&!scope.hq)fail('復原照片僅限總部操作',403);
 let history=await db.prepare('SELECT * FROM store_order_source_actions WHERE operation_id=?').bind(operationId).first<any>();
 let current=await db.prepare('SELECT * FROM store_order_source_controls WHERE file_id=?').bind(fileId).first<any>();
 if(history&&(history.file_id!==fileId||history.store_code!==scope.store||history.action!==action||history.expected_version!==expectedVersion||(!scope.hq&&history.actor!==scope.actor)))fail('操作識別與照片不一致',403);
 if(current&&current.store_code!==scope.store)fail('無權操作此照片',403);
 if(history&&current?.operation_id!==operationId)fail('照片狀態已變更，請更新清單');
 if(history?.completed_at)return {completed:true,state:current.state,version:current.version};
 if(history){const prior=await drive.json(history.record_id);if(await digest(prior)!==history.record_hash)fail('移除紀錄已變更，請由總部核對，不會移動照片',503);if(body.reason!==undefined&&prior.reason!==body.reason.trim())fail('同一操作的原因不可變更，請保留原原因重試');}
 const recordOnly=history?!!history.record_only:action==='restore'?!!current?.record_only:body.recordOnly===true;
 if(action==='restore'&&body.recordOnly!==undefined&&recordOnly!==(body.recordOnly===true))fail('來源處理方式已變更，請更新紀錄');
 if(history&&body.recordOnly!==undefined&&recordOnly!==(body.recordOnly===true))fail('同一操作的處理方式不可變更');
 const linked=await db.prepare('SELECT store_code,order_id,duplicate_of,digest FROM store_order_sources WHERE file_id=?').bind(fileId).first<any>();
 if(linked&&linked.store_code!==scope.store)fail('無權操作此照片',403);
 if(linked?.duplicate_of&&!scope.hq)fail('重複照片請由總部核對',403);
 if(linked?.order_id&&!linked.duplicate_of)fail('照片已保存成訂單，請使用訂單作廢流程');
 if(recordOnly&&(!scope.hq||!linked))fail('只有總部可核對本店已登記來源',403);
 const meta=recordOnly&&drive.sourceMeta?await drive.sourceMeta(fileId):await drive.meta(fileId);
 if(meta&&!kinds.has(meta.mimeType))fail('只能移除待收照片或PDF',400);
 if(scope.guest&&meta.appProperties?.soActor!==scope.actor)fail('只能移除自己上傳的待收照片',403);
 const from=action==='remove'?scope.pending:scope.recycle,to=action==='remove'?scope.recycle:scope.pending;
 if(recordOnly){
  if(action==='remove'&&meta&&!meta.trashed&&meta.parents?.includes(scope.pending))fail('原圖仍在待收資料夾，請使用移除照片');
  if(action==='restore'){
   await drive.owned(fileId,scope.pending);
   const bytes=await drive.read(fileId,20000000),actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
   if(actual!==linked.digest)fail('原圖內容不同，不能重新啟用舊來源');
  }
 }else if(!meta||meta.trashed||(!meta.parents?.includes(from)&&!(history&&meta.parents?.includes(to))))fail('照片不在允許的資料夾；請由總部展開來源異常核對',403);
 if(action==='restore'&&linked&&!linked.duplicate_of&&await db.prepare("SELECT 1 FROM store_order_sources s WHERE s.store_code=? AND s.digest=? AND s.file_id!=? AND s.duplicate_of IS NULL AND NOT EXISTS(SELECT 1 FROM store_order_source_controls x WHERE x.file_id=s.file_id AND x.state!='active')").bind(scope.store,linked.digest,fileId).first())fail('已有相同內容的新來源，請保留新來源，不要復原舊紀錄');
 await drive.checkFolder(scope.pending,scope.storeEmails);await drive.checkFolder(scope.recycle,scope.hqEmails);
 if(!history){
  const reason=typeof body.reason==='string'?body.reason.trim():'';
  if(!reason||reason.length>200)fail('請填寫移除或復原原因（最多200字）',400);
  const busy=await db.prepare("SELECT 1 FROM store_order_recognitions WHERE file_id=? AND status='processing' AND lock_until>? UNION ALL SELECT 1 FROM store_orders WHERE store_code=? AND lock_until>? UNION ALL SELECT 1 FROM store_order_batches WHERE store_code=? AND status='preparing' LIMIT 1").bind(fileId,now(),scope.store,now(),scope.store).first();
  if(busy)fail('照片正在辨識、保存或交接，請完成後更新清單再操作');
  if((current?.version||0)!==expectedVersion||(action==='restore'?current?.state!=='removed':current&&current.state!=='active'))fail('照片狀態已變更，請更新清單');
  const at=now(),record={schemaVersion:1,kind:'source-action',operationId,fileId,storeCode:scope.store,action,reason,actor:scope.actor,recordOnly,duplicate:!!linked?.duplicate_of,createdAt:at};
  const recordId=await drive.write(scope.recycle,operationId+'.json',record,operationId);
  const back=await drive.json(recordId);if(Object.entries(record).some(([k,v])=>k!=='createdAt'&&back[k]!==v))fail('移除紀錄核對失敗，尚未移動照片',503);
  await drive.checkPermissions(recordId,scope.hqEmails);
  try{await db.prepare('INSERT INTO store_order_source_actions(operation_id,file_id,store_code,action,expected_version,actor,record_id,record_hash,created_at,hq_review,record_only) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(operationId,fileId,scope.store,action,expectedVersion,scope.actor,recordId,await digest(back),at,scope.hq?1:0,recordOnly?1:0).run();}
  catch(e){if(String(e).includes('source_action_conflict'))fail('照片已變更、正在處理或已保存，請更新清單');throw e;}
  history={record_id:recordId};
 }
 const lease=crypto.randomUUID(),until=new Date(Date.now()+15*60000).toISOString();
 const claimed=await db.prepare("UPDATE store_order_source_controls SET lease_token=?,lease_until=? WHERE file_id=? AND operation_id=? AND state IN ('removing','restoring') AND (lease_until IS NULL OR lease_until<=?)").bind(lease,until,fileId,operationId,now()).run();
 if(!claimed.meta.changes)fail('此照片操作正在進行，請稍後更新清單，勿重複操作');
 try{
  if(recordOnly&&action==='remove'){const latest=drive.sourceMeta?await drive.sourceMeta(fileId):await drive.meta(fileId);if(latest&&!latest.trashed&&latest.parents?.includes(scope.pending))fail('原圖已回到待處理，請先由總部核對原操作');}
  if(!recordOnly){await drive.move(fileId,from,to,action==='remove'?scope.hqEmails:scope.storeEmails);
  await drive.owned(fileId,to);await drive.checkPermissions(fileId,action==='remove'?scope.hqEmails:scope.storeEmails);}
  const state=action==='remove'?'removed':'active',at=now();
  await db.batch([db.prepare('UPDATE store_order_source_controls SET state=?,updated_at=?,lease_token=NULL,lease_until=NULL WHERE file_id=? AND operation_id=? AND lease_token=?').bind(state,at,fileId,operationId,lease),db.prepare('UPDATE store_order_source_actions SET completed_at=? WHERE operation_id=?').bind(at,operationId)]);
  return {completed:true,state,version:expectedVersion+1};
 }catch{fail('照片操作尚未確認完成；請從移除紀錄使用同一操作重試，不要刪除原圖',503);}
 finally{await db.prepare('UPDATE store_order_source_controls SET lease_token=NULL,lease_until=NULL WHERE file_id=? AND lease_token=?').bind(fileId,lease).run();}
}

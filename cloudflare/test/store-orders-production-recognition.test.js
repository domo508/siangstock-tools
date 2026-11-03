import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {recognizeStoreOrder,orderRecognitionPayload,parseOrderRecognition,recognitionStatus,advanceRecognition} from '../worker/src/store-order-recognition';
import {syntheticFullOrder} from '../../store-orders/synthetic-form.js';
let sql,env,source,results;const png=()=>{const b=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.writeUInt32BE(10,16);b.writeUInt32BE(10,20);return 'data:image/png;base64,'+b.toString('base64');};
const body=()=>({storeCode:'R14',fileId:'source-000001',operationId:crypto.randomUUID(),mode:'full',consent:true,image:png(),detailImages:[png(),png(),png()]});
const context=()=>({actor:'store@siangapato.com.tw',storeCode:'R14',fileId:'source-000001',validateSource:source,storage:{async save(id,result){results.set(id,structuredClone(result));return {id,hash:await digest(result)};},async load(id){return structuredClone(results.get(id));}}});
const digest=async v=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v)))).toString('hex');
const good=()=>({id:'resp_synthetic',status:'completed',model:'gpt-6.1-sol',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(syntheticFullOrder())}]}],usage:{input_tokens:100,output_tokens:200}});
beforeEach(()=>{sql=new DatabaseSync(':memory:');sql.exec(readFileSync('worker/migrations/0044_store_order_recognition.sql','utf8'));sql.exec(readFileSync('worker/migrations/0053_store_order_recognition_recovery.sql','utf8'));results=new Map();env={OPENAI_API_KEY:'synthetic-key',DB:{prepare(q){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(q).get(...values)||null;},async run(){const r=sql.prepare(q).run(...values);return {meta:{changes:Number(r.changes)}};}};}}};source=vi.fn(async()=>{});vi.stubGlobal('fetch',vi.fn(async(_url,init)=>Response.json(init?.method==='POST'?{id:'resp_synthetic',status:'queued'}:good())));});
afterEach(()=>{sql.close();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('正式完整單仍採固定模型、store false、嚴格schema與原測試的細節圖；無商品主檔',()=>{const p=orderRecognitionPayload(png(),[png(),png(),png()]);expect(p).toMatchObject({model:'gpt-6.1-sol',store:false,text:{format:{strict:true,name:'store_order_full'}}});expect(p.input[1].content.filter(c=>c.type==='input_image')).toHaveLength(4);expect(JSON.stringify(p)).not.toMatch(/全為虛構|synthetic-key|成本價/);});
it('背景只提交一次；斷線後同一作業取回完整結果，D1沒有完整單與個資',async()=>{
 const b=body(),start=await recognizeStoreOrder(env,b,context());expect(start.job.status).toBe('processing');expect(start).not.toHaveProperty('extraction');
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({background:true,store:false,reasoning:{effort:'high'},max_output_tokens:16000});
 const result=await recognitionStatus(env,b.operationId,context());expect(result.result.extraction.header.paperNumber).toBe('TEST-FULL-0001');expect(result.job.status).toBe('completed');
 await recognizeStoreOrder(env,b,context());await recognitionStatus(env,b.operationId,context());expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(1);
 expect(JSON.stringify(sql.prepare('SELECT * FROM store_order_recognitions').all())).not.toMatch(/測試客戶|0000000000|data:image|synthetic-key|paperName/);
});
it('缺金鑰、未授權、圖片非法或來源不屬本店時不呼叫上游',async()=>{await expect(recognizeStoreOrder({...env,OPENAI_API_KEY:undefined},body(),context())).rejects.toMatchObject({status:503});await expect(recognizeStoreOrder(env,{...body(),consent:false},context())).rejects.toMatchObject({status:400});await expect(recognizeStoreOrder(env,{...body(),image:'invalid'},context())).rejects.toMatchObject({status:400});source.mockRejectedValueOnce(Error('未授權來源'));await expect(recognizeStoreOrder(env,body(),context())).rejects.toThrow('未授權來源');expect(fetch).not.toHaveBeenCalled();});
it('處理中鎖與每日額度由SQLite原子限制，拒絕的請求不花AI費用',async()=>{const b=body();sql.prepare('INSERT INTO store_order_recognitions(id,store_code,file_id,actor,request_hash,status,business_day,created_at,updated_at,lock_until) VALUES (?,?,?,?,?,?,?,?,?,?)').run('running-job','R14','source-000001','other@siangapato.com.tw','hash','processing','2026-10-30','now','now','9999');await expect(recognizeStoreOrder(env,b,context())).rejects.toMatchObject({status:429});expect(fetch).not.toHaveBeenCalled();});
it('上游失敗／部分結果皆不採用，不自動重試，不回傳上游原始錯誤',async()=>{fetch.mockResolvedValueOnce(Response.json({error:{message:'secret-upstream-raw'}},{status:429}));await expect(recognizeStoreOrder(env,body(),context())).rejects.toMatchObject({status:503});expect(sql.prepare('SELECT status FROM store_order_recognitions').get().status).toBe('failed');expect(()=>parseOrderRecognition({...good(),status:'incomplete',incomplete_details:{reason:'max_output_tokens'}})).toThrow(/未採用部分結果/);expect(fetch).toHaveBeenCalledOnce();});

it('處理中查詢不重送；超過3分鐘仍processing，超過5分鐘要求取消且不採用部分結果',async()=>{
 const b=body();await recognizeStoreOrder(env,b,context());fetch.mockImplementation(async()=>Response.json({id:'resp_synthetic',status:'in_progress'}));
 sql.prepare('UPDATE store_order_recognitions SET created_at=?').run(new Date(Date.now()-190000).toISOString());expect((await recognitionStatus(env,b.operationId,context())).job.status).toBe('processing');
 sql.prepare('UPDATE store_order_recognitions SET deadline_at=?').run(new Date(Date.now()-1000).toISOString());const r=await recognitionStatus(env,b.operationId,context());expect(r.job).toMatchObject({status:'failed',error:expect.stringContaining('5分鐘')});expect(r).not.toHaveProperty('result');expect(fetch.mock.calls.filter(c=>c[0].endsWith('/cancel'))).toHaveLength(1);
});
it('提交回覆中斷不自動重送；相同operation只能讀狀態',async()=>{
 fetch.mockRejectedValueOnce(new TypeError('private transport error'));const b=body();await expect(recognizeStoreOrder(env,b,context())).rejects.toMatchObject({status:503});expect((await recognizeStoreOrder(env,b,context())).job.status).toBe('failed');expect(fetch).toHaveBeenCalledOnce();
});
it('其他訪客、不同門市與來源不能讀取既有辨識結果',async()=>{
 const b=body();await recognizeStoreOrder(env,b,context());for(const changed of [{actor:'other-guest'},{storeCode:'R15'},{fileId:'other-file'}])await expect(recognitionStatus(env,b.operationId,{...context(),...changed})).rejects.toMatchObject({status:403});expect(fetch).toHaveBeenCalledOnce();
});
it('雲端保存失敗仍可讀同一AI結果接續，不新增辨識；篡改雲端內容拒絕',async()=>{
 const b=body();await recognizeStoreOrder(env,b,context());const c=context();c.storage.save=async()=>{throw Error('storage unavailable');};await expect(recognitionStatus(env,b.operationId,c)).rejects.toThrow('storage unavailable');expect(sql.prepare('SELECT status FROM store_order_recognitions').get().status).toBe('processing');
 expect((await recognitionStatus(env,b.operationId,context())).job.status).toBe('completed');results.get(b.operationId).extraction.header.paperNumber='tampered';await expect(recognitionStatus(env,b.operationId,context())).rejects.toMatchObject({status:409});expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(1);
});
it('不完整結果終止且不保存；PDF頁碼分開與請求重用內容衝突',async()=>{
 const b=body();await recognizeStoreOrder(env,b,context());await expect(recognizeStoreOrder(env,{...b,pageIndex:1},context())).rejects.toMatchObject({status:409});fetch.mockResolvedValueOnce(Response.json({...good(),status:'incomplete'}));expect((await recognitionStatus(env,b.operationId,context())).job.status).toBe('failed');expect(results.size).toBe(0);
});

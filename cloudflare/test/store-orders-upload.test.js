import {it,expect,vi} from 'vitest';
import {createSourceUploader} from '../../store-orders/source-upload.js';
const image=()=>new Blob(['synthetic-no-customer-data'],{type:'image/png'});
it('PUT回應遺失但公司雲端確認成功，仍正確判定已上傳，不再PUT',async()=>{
 const bodies=[],put=vi.fn(async()=>{throw new TypeError('Load failed');});
 const api=vi.fn(async(path,method,body)=>{bodies.push(body);return path==='/upload-session'?{uploadUrl:'synthetic'}:{completed:true,fileId:'source-test'};});
 const uploader=createSourceUploader({api,upload:put});expect(await uploader.send(image(),'R14')).toMatchObject({completed:true});expect(put).toHaveBeenCalledTimes(1);expect(bodies[0].operationId).toBe(bodies[1].operationId);
});
it('PUT成功不代表已保存，未完成時擋下；重選同檔沿用操作，已存在不再傳送',async()=>{
 let round=0;const ops=[],put=vi.fn(async()=>({id:'untrusted-browser-only'}));
 const api=vi.fn(async(path,method,b)=>{ops.push(b.operationId);if(path==='/upload-session')return {completed:round>0};return round?{completed:true,fileId:'verified'}:{completed:false};});
 const uploader=createSourceUploader({api,upload:put});await expect(uploader.send(image(),'R14')).rejects.toThrow(/尚未確認/);round++;expect(await uploader.send(image(),'R14')).toMatchObject({fileId:'verified'});expect(new Set(ops).size).toBe(1);expect(put).toHaveBeenCalledTimes(1);
});
it('確認斷線、無fileId、公司拒絕均不假裝成功；換店或登出不沿用操作',async()=>{
 const ops=[];let mode='network';const api=async(path,method,b)=>{ops.push(b.operationId);if(path==='/upload-session')return {completed:true};if(mode==='network')throw new TypeError('Load failed');if(mode==='denied')throw Object.assign(Error('無權存取'),{status:403});return {completed:true};};
 const u=createSourceUploader({api,upload:vi.fn()});await expect(u.send(image(),'R14')).rejects.toThrow(/無法連線確認/);mode='denied';await expect(u.send(image(),'R14')).rejects.toThrow(/無權/);mode='missing-id';await expect(u.send(image(),'R01')).rejects.toThrow(/尚未確認/);u.clear();await expect(u.send(image(),'R14')).rejects.toThrow(/尚未確認/);expect(ops[0]).toBe(ops[2]);expect(ops[0]).not.toBe(ops[4]);expect(ops[0]).not.toBe(ops[6]);
});

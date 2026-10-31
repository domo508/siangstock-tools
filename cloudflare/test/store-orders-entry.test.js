import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
it('正式主頁與本機驗收頁必須完全一致，避免發布入口缺少新操作元件',()=>{
 expect(readFileSync('../store-orders/index.html','utf8')).toBe(readFileSync('../store-orders/cloud.html','utf8'));
});
it('公司及訪客入口不可有重複元件識別，避免按鈕移位後接到錯誤區域',()=>{
 for(const file of ['../store-orders/index.html','../store-orders/guest/index.html']){
  const ids=[...readFileSync(file,'utf8').matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);expect(new Set(ids).size).toBe(ids.length);
 }
});

import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
it('正式主頁與本機驗收頁必須完全一致，避免發布入口缺少新操作元件',()=>{
 expect(readFileSync('../store-orders/index.html','utf8')).toBe(readFileSync('../store-orders/cloud.html','utf8'));
});

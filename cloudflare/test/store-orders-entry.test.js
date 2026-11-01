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

it('總部步驟5下載整批，內建範本，權限工具不再包含ERP結果流程',()=>{const html=readFileSync('../store-orders/cloud.html','utf8'),js=readFileSync('../store-orders/cloud.js','utf8');expect(html.indexOf('4．整日清單與閉店結算')).toBeLessThan(html.indexOf('5．下載整批POS'));expect(html).toContain('總部權限工具');expect(html).not.toContain('id="cloud-result');expect(html).not.toContain('id="pos-template-file"');expect(js).toContain('builtInPOSProfile');expect(js).toContain("'/batches/'");expect(js).not.toContain("$('cloud-result-save')");});

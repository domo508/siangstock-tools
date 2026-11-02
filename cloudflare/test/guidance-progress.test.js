import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describe,it,expect} from 'vitest';
const ctx={};vm.runInNewContext(readFileSync('../live-guidance/progress.js','utf8'),ctx);const P=ctx.CompanyGuidanceProgress;
describe('即時指引真實進度與等待時間',()=>{
 it('相同訊息或定時重繪不假造更新時間，30秒才提示等待',()=>{let t=100000;const p=P.create(()=>t);p.report({id:'read',message:'正在解析',status:'processing'});t+=29999;p.report({id:'read',message:'正在解析',status:'processing'});expect(p.view()).toMatchObject({updatedAt:100000,stalled:false,elapsedSeconds:29});t++;expect(p.view()).toMatchObject({updatedAt:100000,stalled:true,elapsedSeconds:30});});
 it('真實步驟或完成量更新才更新時間、解除等待',()=>{let t=0;const p=P.create(()=>t);p.report({id:'read',message:'正在讀取',status:'processing',current:1,total:4});t=35000;expect(p.view().stalled).toBe(true);p.report({id:'read',message:'正在讀取',status:'processing',current:2,total:4});expect(p.view()).toMatchObject({updatedAt:35000,stalled:false,current:2,total:4});});
 it.each([['processing',true],['complete',false],['authorization',false],['error',false],['waiting',false]])('只有處理中才呈現無新進度等待：%s',(status,stalled)=>{let t=0;const p=P.create(()=>t);p.report({message:'狀態',status});t=60000;expect(p.view().stalled).toBe(stalled);});
 it('切換操作不沿用前次時間，不以點擊當作業務進度',()=>{const p=P.create(()=>0);expect(p.view()).toBeNull();p.report({message:'已保存',status:'complete'});p.reset();expect(p.view()).toBeNull();});
 it.each([['正在讀取檔案','processing'],['等待Google授權','authorization'],['無法取得來源','error'],['核准完成','complete'],['未驗證但可繼續：數量不是有效非負數','waiting']])('依實際訊息分類：%s',(text,status)=>expect(P.classify(text)).toBe(status));
 it('錯誤樣式優先於文字正在處理，不偽裝仍在運算',()=>expect(P.classify('正在讀取時發生問題',true)).toBe('error'));
 it('正式所有共用指引頁先載入同版進度元件，資料不傳出',()=>{const paths=['inventory/index.html','cost-analysis/index.html','supplier-reconciliation/index.html','competitive-analysis/index.html','procurement-planning/index.html','store-transfer/index.html','inventory/rules-admin/index.html','procurement-planning/rules-admin/index.html','store-transfer/rules/index.html','store-orders/settings.html'];const version=JSON.parse(readFileSync('../live-guidance/version.json','utf8')).version;for(const f of paths){const s=readFileSync('../'+f,'utf8');expect(s.indexOf(`/live-guidance/progress.js?v=${version}`)).toBeGreaterThan(-1);expect(s.indexOf(`/live-guidance/progress.js?v=${version}`)).toBeLessThan(s.indexOf(`/live-guidance/app.js?v=${version}`));}expect(readFileSync('../live-guidance/progress.js','utf8')).not.toMatch(/fetch\(|localStorage|sendBeacon|XMLHttpRequest/);});
});

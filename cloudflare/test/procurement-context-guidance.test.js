import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
const ctx={};vm.createContext(ctx);vm.runInContext(readFileSync('../procurement-planning/guidance.js','utf8'),ctx);
const guide=ctx.ProcurementGuidance;
const base={loggedIn:true,fileCount:0,dates:true,canApprove:true};
it.each(['returnScope','firstReview','review','batch','approved','analysis'])('接續%s且未選來源不顯示四檔進度，也不回到來源步驟',stage=>{
 const input={...base,[stage]:true};const before=JSON.stringify(input),step=guide.resolve(input),progress=guide.progress(input);
 expect(progress.total).toBeUndefined();expect(progress.current).toBeUndefined();expect(progress.message).not.toContain('0／4');expect(step.target).not.toMatch(/#(?:inventory-file|pending-files|transfer-file|sales-files|source-title|analysis-month)/);expect(JSON.stringify(input)).toBe(before);
});
it('核准已完成但後續仍在處理，指出摘要／同步而非要求重新匯入或重複核准',()=>{
 const s={...base,approved:true,summaryBusy:true};expect(guide.resolve(s)).toMatchObject({title:'核准已完成，正在處理摘要／同步',busy:true,target:'#workflow-status'});expect(guide.progress(s).total).toBeUndefined();
 const complete=guide.resolve({...s,summaryBusy:false});expect(complete.keepState).toBe(true);expect(complete.hint).toContain('不要重新核准');
});
it('活動設定優先於已恢復的採購階段，並依真實保存條件提供下一步',()=>{
 const s={...base,context:'activity-settings',approved:true,activityEnabled:true,canManageActivities:true,activityAvailable:true};
 expect(guide.resolve(s).target).toBe('#activity-demand-fields');
 expect(guide.resolve({...s,activityValid:true,activityDirty:true}).target).toBe('#activity-registry-reason');
 expect(guide.resolve({...s,activityValid:true,activityDirty:true,activityReason:true}).target).toBe('#activity-registry-save');
 expect(guide.resolve({...s,activityValid:true,activitySelected:true,analysis:true}).title).toContain('已保存');
 expect(guide.progress(s).message).toContain('活動日期');expect(guide.progress(s).total).toBeUndefined();
 expect(guide.resolve({...s,canManageActivities:false}).title).toContain('唯讀');
 expect(guide.resolve({...s,activityBusy:true}).busy).toBe(true);
});
it('門市交接按讀取、重建、保存、發布分流，不要求新建採購來源',()=>{
 const s={...base,context:'activity-handoff',review:true,transferAvailable:true};
 expect(guide.resolve({...s,transferSyncing:true}).busy).toBe(true);
 expect(guide.resolve({...s,transferError:true}).target).toBe('#refresh-transfer-activity-period');
 expect(guide.resolve(s).target).toBe('#activity-transfer-backfill');
 expect(guide.resolve({...s,transferDraft:true,canSaveTransfer:true}).target).toBe('#save-transfer-activity-draft');
 expect(guide.resolve({...s,transferDraft:true,canPublishTransfer:true}).target).toBe('#publish-transfer-activity');
 expect(guide.resolve({...s,transferDraft:true}).target).toBe('#transfer-activity-status');
 expect(guide.progress(s).message).toContain('門市活動');expect(guide.progress(s).total).toBeUndefined();
});
it('只有新建採購顯示四類來源；真實讀檔進度和未完成總量仍保留',()=>{
 expect(guide.progress(base)).toMatchObject({current:0,total:4});
 expect(guide.progress({...base,importProgress:{current:2,total:5}})).toMatchObject({current:2,total:5});
 expect(guide.resolve({...base,loggedIn:false,approved:true}).target).toBe('#account-badge');
 expect(guide.resolve({...base,master:true}).target).toBe('#inventory-file');
});
it('主採購在本機讀取新指引模組，且指引只導航、不執行業務操作',()=>{
 const html=readFileSync('../procurement-planning/index.html','utf8');expect(html.indexOf('src="guidance.js?')).toBeLessThan(html.indexOf('src="app.js?'));
 const code=readFileSync('../procurement-planning/guidance.js','utf8');expect(code).not.toMatch(/fetch\(|localStorage|sessionStorage|\.click\(|\.submit\(|postJson|X-Google/);
 const app=readFileSync('../procurement-planning/app.js','utf8');expect(app).toContain('acceptStatus(status)');expect(app).toContain("guidanceContext==='activity-settings'");
});

it('月初新建先填業績、再保存、成功後才準備來源；明確0可完成',()=>{
 const s={...base,monthStart:true,canManageBudget:true};
 expect(guide.resolve(s).target).toBe('#channel-forecast-title');expect(guide.progress(s).total).toBeUndefined();
 expect(guide.resolve({...s,forecastComplete:true}).target).toBe('#save-budget-button');
 expect(guide.resolve({...s,forecastSaved:true,forecastDirty:false,forecastComplete:true}).target).toBe('#source-title');
 expect(guide.resolve({...s,forecastSaved:true,forecastDirty:true,forecastComplete:true}).target).toBe('#save-budget-button');
 expect(guide.resolve({...s,canManageBudget:false}).title).toContain('有權限同仁');
 expect(guide.resolve({...s,forecastSaved:true,context:'budget'}).title).toContain('已保存');
 expect(guide.resolve({...s,context:'budget',historyMode:true}).target).toBe('#history-mode-banner');
});
it.each(['returnScope','firstReview','review','batch','approved','analysis','monthEnd'])('接續%s不被缺少業績預估倒退；活動卡片仍優先',stage=>{
 const s={...base,monthStart:true,[stage]:true};expect(guide.resolve(s).target).not.toBe('#channel-forecast-title');expect(guide.progress(s).message).not.toContain('月初採購先');
 expect(guide.resolve({...s,context:'activity-settings',activityEnabled:false}).target).toBe('#activity-enabled');
});
it('月中及月底初始不自動要求重做月初業績預估',()=>{expect(guide.resolve({...base,monthStart:false}).target).toBe('#source-title');});

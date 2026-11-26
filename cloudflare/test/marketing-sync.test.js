import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../../procurement-planning/marketing-sync/Code.gs',import.meta.url),'utf8');
function runtime(){const ctx=vm.createContext({});vm.runInContext(code,ctx);return ctx;}
describe('marketing sync conservative draft parser',()=>{
  it('preserves full original text and distinct paragraph activity identities',()=>{
    const ctx=runtime(),raw='門市：11/3 - 11/10\n全館85折\n----------\n門市：11/11 - 11/15\n活動第二段';
    const r=ctx.parseMarketingDraft_({year:2026,month:11,cells:[{sheet:'26測試',ref:'L4',category:'短促',raw}]},'run');
    expect(r['活動主檔']).toHaveLength(2);expect(r['活動主檔'][0][1]).not.toBe(r['活動主檔'][1][1]);
    expect(r['活動主檔'].map(a=>a[9]).join('\n----------\n')).toBe(raw);
    expect(r['活動主檔'].every(a=>a[5]===''&&a[6]===''&&a[8]==='待覆核')).toBe(true);
  });
  it('extracts each SKU without transferring a neighbouring gift threshold or quantity',()=>{
    const r=runtime().parseMarketingDraft_({year:2026,month:11,cells:[{sheet:'26測試',ref:'L3',category:'鋪底',raw:'滿1000贈球1入｜贈品貨號：N12345\n指定系列滿3000贈鏡｜贈品貨號：N67890'}]},'run');
    expect(r['贈品／加價購'].map(a=>a[5])).toEqual(['N12345','N67890']);
    expect(r['贈品／加價購'].every(a=>a.slice(7,10).every(x=>x===''))).toBe(true);
  });
  it('keeps multi-SKU paid add-ons separate from free gifts and flags lottery',()=>{
    const ctx=runtime();const r=ctx.parseMarketingDraft_({year:2026,month:11,cells:[{sheet:'26測試',ref:'L5',category:'加價購',raw:'枕套299元｜加價購貨號：D12345、D12346\n滿5000抽Acer行李箱'}]},'r');
    expect(r['贈品／加價購']).toHaveLength(2);expect(r['贈品／加價購'].every(a=>a[4]==='加價購')).toBe(true);
    expect(r['覆核待辦'].some(a=>a[4].includes('不等於每筆訂單'))).toBe(true);
  });
  it('escapes formula-like source text and never contains a network/publishing service',()=>{
    const ctx=runtime();expect(ctx.safeMarketingText_('=IMPORTDATA("example")')).toBe("'=IMPORTDATA(\"example\")");
    expect(ctx.safeMarketingText_('一般文字')).toBe('一般文字');
    expect(code).not.toMatch(/UrlFetchApp|DriveApp|GmailApp|MailApp|ScriptApp\.newTrigger/);
  });
  it('maps worksheet coordinates deterministically and retains platform-only scope',()=>{
    const ctx=runtime();expect(ctx.columnLabel_(12)).toBe('L');expect(ctx.columnLabel_(27)).toBe('AA');
    const r=ctx.parseMarketingDraft_({year:2026,month:11,cells:[{sheet:'26測試',ref:'L20',category:'蝦皮短促',raw:'11/11全館85折'}]},'r');
    expect(r['活動主檔'][0][7]).toContain('不預設門市');
  });
});

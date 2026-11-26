import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../../procurement-planning/marketing-sync/CodeV2.gs',import.meta.url),'utf8');
function runtime(){const ctx=vm.createContext({});vm.runInContext(code,ctx);vm.runInContext(fs.readFileSync(new URL('../../procurement-planning/marketing-sync/ProductMatch.gs',import.meta.url),'utf8'),ctx);return ctx;}
function parse(raw,category='短促'){return runtime().parseMarketingDraft_({year:2026,month:11,cells:[{sheet:'26測試',ref:'L4',category,raw}]},'run');}
describe('marketing sync two offer types',()=>{
 it('has exactly two primary output types and never emits date-only offer rows',()=>{
  const r=parse('門市：11/3 10:00 - 11/10 23:59\n官網：11/3 10:00 - 11/10 23:59\n\n*全館85折\n\n*滿1000贈球1入｜贈品貨號：N12345');
  expect(Object.keys(r)).toEqual(['活動案型','贈品／加價購案型','覆核待辦','排除紀錄']);
  expect(r['活動案型']).toHaveLength(1);expect(r['贈品／加價購案型']).toHaveLength(1);
  for(const row of [...r['活動案型'],...r['贈品／加價購案型']]){expect(row[3]).toBe('2026-11-03 10:00');expect(row[4]).toBe('2026-11-10 23:59');expect(row[2]).not.toMatch(/^(門市|官網)：/);expect(row[10]).toBe('待覆核');}
 });
 it('splits channel periods only when the end dates differ',()=>{
  const r=parse('門市：11/16 00:00 - 11/30 23:59\n官網：11/16 00:00 - 12/1 09:59\n\n*全館85折');
  expect(r['活動案型']).toHaveLength(2);expect(r['活動案型'].map(a=>a[5])).toEqual(['門市','官網']);expect(r['活動案型'][1][4]).toBe('2026-12-01 09:59');
 });
 it('retains restrictions, separates each bullet and does not double emit gifts',()=>{
  const r=parse('雙11暖場\n⚠️排除出清品、指定系列\n*滿2000享89折\n*滿3800享86折\n*滿2300贈方巾｜贈品貨號：N12345\n門市：11/3 10:00 - 11/10 23:59');
  expect(r['活動案型']).toHaveLength(2);expect(r['贈品／加價購案型']).toHaveLength(1);expect(r['活動案型'][0][8]).toContain('出清品');expect(r['贈品／加價購案型'][0][11]).toBe('N12345');
 });
 it('keeps numbered limited prices with their heading and date',()=>{
  const r=parse('*11/11當日限定優惠價\n1、枕頭 - $1680\n2、枕墊(2入) - $399\n門市：11/11 00:00 - 11/11 23:59');
  expect(r['活動案型']).toHaveLength(2);expect(r['活動案型'][1][2]).toContain('當日限定優惠價｜枕墊');
 });
 it('does not infer dates or multiply pack size into gift quantity',()=>{
  const r=parse('*補充包（三入）388元｜加價購貨號：L12345','加價購');const a=r['贈品／加價購案型'][0];expect(a[3]).toBe('');expect(a[12]).toBe('');expect(a[0]).toBe('加價購');
 });
 it('separates labelled purchase gift and spend-threshold extra gift without sharing thresholds',()=>{
  const r=parse('6、品牌聯名任購即贈聯名紙膠帶，消費滿$3600再贈聯名襪子乙雙(不挑款)\n｜紙膠帶贈品貨號：N12345｜襪子贈品貨號：N67890','常態活動');
  expect(r['贈品／加價購案型']).toHaveLength(2);expect(r['贈品／加價購案型'].map(a=>a[11])).toEqual(['N12345','N67890']);expect(r['贈品／加價購案型'][0][13]).not.toContain('3600');expect(r['贈品／加價購案型'][1][13]).toContain('3600');
 });
 it('distinguishes lottery and buy-one-get-one from direct gift allocation',()=>{
  const r=parse('*滿5000抽Acer行李箱\n*SEMO小物買一送一');expect(r['贈品／加價購案型']).toHaveLength(1);expect(r['贈品／加價購案型'][0][0]).toBe('買一送一');expect(r['排除紀錄']).toHaveLength(1);
 });
 it('validates calendar dates and rejects standalone date content',()=>{
  const ctx=runtime();expect(ctx.marketingDate_(2026,11,31,'10:00')).toBe('');expect(ctx.marketingDate_(2026,11,3,'25:00')).toBe('');
  const r=parse('門市：11/3 10:00 - 11/10 23:59');expect(r['活動案型']).toHaveLength(0);expect(r['覆核待辦'][0][4]).toContain('只有日期');
 });
 it('does not mistake negative stacking restrictions for all-store merchandise scope',()=>{
  const r=parse('*熊暖墊單件現折200 - 不額外跟全館折扣活動\n*雙層紗床寢85折（不同享全站折扣）');
  expect(r['活動案型'][0][7]).toBe('熊暖墊');expect(r['活動案型'][1][7]).toBe('雙層紗床寢');
 });
 it('has no network service, preserves old drafts and checks full content before promotion',()=>{
  expect(code).not.toMatch(/UrlFetchApp|DriveApp|MailApp|GmailApp|deleteSheet|\.clear\(/);expect(code).toContain("setName('舊版r1_'+n)");expect(code).toContain('JSON.stringify(values)!==JSON.stringify(w.rows)');expect(code).toContain('parser:MS_VERSION');
 });
});

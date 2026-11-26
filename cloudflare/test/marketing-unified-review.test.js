import {it,expect} from 'vitest';
import {spreadsheetFixture} from './helpers/marketing-runtime.js';
const V='20261105-marketing-select-all-r11';
const text='⚠ 排除特賣品\n*華爾紗兩用被套85折\n門市：11/11 00:00 - 11/15 23:59';
function setup(raw=text){const f=spreadsheetFixture();f.source.rows[1][1]=raw;f.c.setupMarketingSync();f.c.syncMarketingFromPanel();f.c.upgradeMarketingUnifiedReview();return f;}
const preview=f=>f.c.loadMarketingReview('all','',V);
const approve=(f,p)=>f.c.confirmMarketingReview(p.token,p.offers.map(o=>o.id),V);
it('one action reviews both conditions and products and validates the complete sheet',()=>{
 const f=setup(),p=preview(f);expect(p.offers[0].error).toBe('');expect(approve(f,p).success).toBe(1);
 expect(f.ss.getSheetByName('活動案型').rows[1][10]).toBe('已覆核');expect(f.c.validateMarketingUnified_().pending).toBe(0);
 expect(f.ss.getSheetByName('活動案型').hidden).toContainEqual([18,1]);
});
it('November undated activities are long-term but are not automatically reviewed',()=>{
 const f=setup('⚠ 排除特賣品\n*華爾紗兩用被套85折\n門市限定'),p=preview(f);
 expect(p.offers[0].period).toBe('長期有效');expect(p.offers[0].status).toBe('待覆核');expect(p.offers[0].error).not.toContain('期間');
 expect(approve(f,p).success).toBe(1);
});
it('later undated activities remain pending unless an identical verified long-term activity recurs',()=>{
 const f=setup('⚠ 排除特賣品\n*華爾紗兩用被套85折\n門市限定');expect(approve(f,preview(f)).success).toBe(1);
 f.source.rows=[['分類','11月','12月'],['常態',f.source.rows[1][1],f.source.rows[1][1]]];f.control.getRange('B4').setValue(12);f.c.syncMarketingFromPanel();
 const p=preview(f);expect(p.offers[0].period).toBe('長期有效');expect(p.offers[0].status).toBe('已覆核');expect(f.c.validateMarketingUnified_().pending).toBe(0);
});
it('does not carry changed conditions, unreviewed activities, or changed masters',()=>{
 for(const kind of ['changed','unreviewed','master']){const f=setup('⚠ 排除特賣品\n*華爾紗兩用被套85折\n門市限定');if(kind!=='unreviewed')approve(f,preview(f));
 const raw=f.source.rows[1][1];f.source.rows=[['分類','11月','12月'],['常態',raw,kind==='changed'?raw.replace('85折','8折'):raw]];if(kind==='master')f.setMaster('new-master');f.control.getRange('B4').setValue(12);f.c.syncMarketingFromPanel();
 expect(preview(f).offers[0].period).toBe('活動期間待確認');expect(f.c.validateMarketingUnified_().pending).toBe(1);}
});
it('later undated new activities cannot be approved just by confirming the product set',()=>{
 const f=setup();f.source.rows=[['分類','12月'],['常態','⚠ 排除特賣品\n*埃及棉浴巾85折\n門市限定']];f.control.getRange('B4').setValue(12);f.c.syncMarketingFromPanel();const p=preview(f);
 expect(p.offers[0].error).toContain('期間待確認');expect(approve(f,p).failed).toBe(1);
});
it('edits and direct approved dropdown changes invalidate unified approval',()=>{
 const f=setup();approve(f,preview(f));const s=f.ss.getSheetByName('活動案型'),d=f.ss.getSheetByName('活動商品明細');
 d.getRange(2,1).setValue(false);f.c.onEdit({source:f.ss,range:d.getRange(2,1)});expect(s.rows[1][10]).toBe('待覆核');
 s.getRange(2,11).setValue('已覆核');f.c.onEdit({source:f.ss,range:s.getRange(2,11)});expect(s.rows[1][10]).toBe('待覆核');expect(f.c.validateMarketingUnified_().pending).toBe(1);
 expect(approve(f,preview(f)).success).toBe(1);
});
it('manual additions return an unreviewed fresh preview and can be approved once at the end',()=>{
 const f=setup();approve(f,preview(f));const p=preview(f),added=f.c.addMarketingProduct(p.offers[0].id,p.run,'A3',V);
 expect(added.preview.offers[0].status).toBe('待覆核');expect(approve(f,added.preview).success).toBe(1);
});
it('rejects old windows and stale previews without changing rows',()=>{
 const f=setup(),p=preview(f);expect(()=>f.c.loadMarketingReview('all','')).toThrow(/介面版本/);expect(()=>f.c.confirmMarketingReview(p.token,[p.offers[0].id])).toThrow(/介面版本/);
 const s=f.ss.getSheetByName('活動案型');s.getRange(2,3).setValue('變更條件');expect(approve(f,p).failed).toBe(1);expect(s.rows[1][10]).toBe('待覆核');
});
it('reports mixed batch success without approving incomplete periods',()=>{
 const f=setup('⚠ 排除特賣品\n*華爾紗兩用被套85折\n門市：11/11 00:00 - 11/15 23:59\n\n*埃及棉浴巾85折\n門市限定');
 const s=f.ss.getSheetByName('活動案型');s.getRange(3,4).setValue('');s.getRange(3,5).setValue('');const p=preview(f),r=approve(f,p);
 expect(r.success).toBe(1);expect(r.failed).toBe(1);expect(s.rows[2][10]).toBe('待覆核');
});

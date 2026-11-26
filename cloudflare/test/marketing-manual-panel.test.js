import {it,expect} from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import {spreadsheetFixture} from './helpers/marketing-runtime.js';

// Exercise the actual installed HTML script against the real bound-sheet APIs.
function panel(){
 const f=spreadsheetFixture();f.source.rows[1][1]='⚠ 排除特賣品\n*不存在商品85折\n門市：11/11 00:00 - 11/15 23:59';f.c.setupMarketingSync();f.c.syncMarketingFromPanel();f.c.upgradeMarketingUnifiedReview();
 const id=f.c.marketingCurrentOffers_(f.ss,f.control.getRange('B7').getValue())[0].values[12],pending=[],calls=[],nodes={};
 class Element{constructor(){this.children=[];this.dataset={};this.value='';this.checked=false;this.disabled=false;}append(...x){this.children.push(...x);}replaceChildren(){this.children=[];}focus(){this.focused=true;}}
 const get=id=>nodes[id]??=new Element(),walk=key=>{const out=[];const visit=n=>{if(n.dataset[key])out.push(n);n.children.forEach(visit);};visit(get(key==='offer'?'offers':'results'));return out;},all=()=>walk('offer');get('searchKind').value='sku';
 const document={getElementById:get,createElement:()=>new Element(),querySelectorAll:selector=>walk(selector.includes('data-sku')?'sku':'offer').filter(n=>selector.includes(':checked')?n.checked:selector.includes(':not')?!n.disabled:true)};
 // Match Apps Script's chainable asynchronous RPC; deliberately do not auto-run.
 const rpc={withSuccessHandler(success){return {withFailureHandler(failure){return new Proxy({}, {get:(_,key)=>(...args)=>{calls.push(key);pending.push(()=>{try{success(f.c[key](...args));}catch(e){failure(e);}});}});}};}};
 const html=fs.readFileSync(new URL('../../procurement-planning/marketing-sync/ReviewPanel.html',import.meta.url),'utf8');
 const code=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('<?!= JSON.stringify(mode) ?>',JSON.stringify('manual')).replace('<?!= JSON.stringify(offerId) ?>',JSON.stringify(id)).replace('<?!= JSON.stringify(reviewVersion) ?>',JSON.stringify('20261105-marketing-select-all-r11'));
 const timers=[],events={};vm.runInNewContext(code,{document,google:{script:{run:rpc}},window:{addEventListener:(n,fn)=>events[n]=fn},setTimeout:fn=>timers.push(fn)});
 return {...f,get,pending,calls,html,all,timers,events,products:()=>walk('sku'),next(){pending.shift()();},search(sku){get('sku').value=sku;get('search').onclick();this.next();},select(){const n=walk('sku').find(n=>!n.disabled);n.checked=true;n.onchange();}};
}
it('the real panel adds twice without reload or reason and keeps final confirmation explicit',()=>{
 const p=panel();p.next();expect(p.html).not.toContain('id="reason"');
 p.search('A1');p.select();p.get('add').onclick();p.get('add').onclick();expect(p.pending.length).toBe(1);p.next();
 expect(p.get('sku').value).toBe('');expect(p.get('sku').focused).toBe(true);expect(p.get('search').disabled).toBe(false);expect(p.get('add').disabled).toBe(true);
 p.search('A2');p.select();p.get('add').onclick();p.next();
 expect(p.calls).toEqual(['loadMarketingReview','searchMarketingProducts','addMarketingProducts','searchMarketingProducts','addMarketingProducts']);
 expect(p.get('manualFeedback').textContent).toContain('已加入1筆');expect(p.ss.getSheetByName('活動案型').rows[1][17]).toBe('需重新確認');
 p.get('confirm').onclick();expect(p.pending.length).toBe(0);expect(p.get('feedback').textContent).toContain('勾選');
 p.all()[0].checked=true;p.get('confirm').onclick();p.next();expect(p.get('feedback').textContent).toContain('成功');expect(p.ss.getSheetByName('活動案型').rows[1][17]).toBe('已確認');
});
it('failed lookup preserves the entered SKU and lets the operator correct and continue',()=>{
 const p=panel();p.next();p.search('BAD');
 expect(p.get('sku').value).toBe('BAD');expect(p.products()[0].disabled).toBe(true);expect(p.get('add').disabled).toBe(true);
 p.search('A1');p.select();p.get('add').onclick();p.next();expect(p.get('manualFeedback').className).toBe('success');
 expect(p.calls.filter(x=>x==='loadMarketingReview').length).toBe(1);
});
it('does not discard a pending basket on reload or new search, and keeps review actions after cards',()=>{
 const p=panel();p.next();p.search('A1');p.select();p.get('load').onclick();expect(p.pending).toHaveLength(0);expect(p.get('manualFeedback').textContent).toContain('未加入');
 p.get('sku').value='A2';p.get('search').onclick();expect(p.pending).toHaveLength(0);p.get('clearSearch').onclick();p.get('search').onclick();p.next();
 expect(p.html.indexOf('id="offers"')).toBeLessThan(p.html.indexOf('class="reviewbar"'));expect(p.html).toContain('grid-template-columns:140px minmax(0,1fr) auto');
});
it('selects pages, preserves selections across navigation, and adds all eligible results beyond 100',()=>{
 const p=panel(),base=p.c.readMarketingMaster_(),items=Array.from({length:120},(_,i)=>({sku:'P'+String(i).padStart(3,'0'),name:'測試大類 枕墊 '+i,size:'標準'}));items[1].sku='SA001';items[2].off=true;
 p.c.readMarketingMaster_=()=>({...base,products:items});p.next();p.get('searchKind').value='name';p.search('測試大類');
 p.get('selectPage').onclick();expect(p.get('add').textContent).toContain('49');expect(p.products().filter(n=>n.checked)).toHaveLength(49);
 p.get('more').onclick();p.next();expect(p.products().filter(n=>n.checked)).toHaveLength(0);p.get('selectPage').onclick();expect(p.get('basketCount').textContent).toContain('99');
 p.get('selectAll').onclick();p.get('selectAll').onclick();expect(p.pending).toHaveLength(1);p.next();expect(p.get('basketCount').textContent).toContain('118');expect(p.get('manualFeedback').textContent).toContain('所有搜尋結果');
 p.get('unselectPage').onclick();expect(p.get('basketCount').textContent).toContain('68');p.get('prev').onclick();p.next();expect(p.products().filter(n=>n.checked)).toHaveLength(49);
 p.get('clearSearch').onclick();expect(p.get('basketCount').textContent).toContain('0');p.get('selectAll').onclick();p.next();p.get('add').onclick();p.next();
 expect(p.get('manualFeedback').textContent).toContain('已加入118筆');expect(p.get('add').disabled).toBe(true);expect(p.get('search').disabled).toBe(false);expect(p.all()[0].checked).toBe(false);
});
it('all-results lookup failure keeps prior cross-page selections and does not add anything',()=>{
 const p=panel();p.next();p.search('A1,A2');p.get('selectPage').onclick();const before=JSON.stringify(p.ss.getSheetByName('活動商品明細').rows);
 p.c.searchMarketingProducts=()=>{throw new Error('來源讀取失敗');};p.get('selectAll').onclick();p.next();
 expect(p.get('manualFeedback').textContent).toContain('讀取失敗');expect(p.get('basketCount').textContent).toContain('2');expect(p.get('add').disabled).toBe(false);expect(JSON.stringify(p.ss.getSheetByName('活動商品明細').rows)).toBe(before);
});

it('slow or failed interface reports status without automatic resend or clearing input',()=>{const p=panel();p.get('sku').value='A1';p.timers[0]();expect(p.get('next').textContent).toContain('仍在核對');expect(p.calls).toEqual(['loadMarketingReview']);expect(p.get('sku').value).toBe('A1');p.events.error();expect(p.get('step').textContent).toContain('未完成');expect(p.calls).toHaveLength(1);});

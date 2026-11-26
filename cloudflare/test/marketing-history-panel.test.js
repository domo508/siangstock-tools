import {it,expect} from 'vitest';import vm from 'node:vm';import fs from 'node:fs';import {spreadsheetFixture} from './helpers/marketing-runtime.js';
it('real history client only issues read calls and preserves current working rows, selections and properties',()=>{
 const f=spreadsheetFixture();f.c.setupMarketingSync();f.c.syncMarketingFromPanel();const before=JSON.stringify({rows:f.ss.getSheets().map(s=>s.rows),props:f.props.getProperties()}),seed=f.c.loadMarketingHistoryCatalog('20261119-marketing-history-r1'),nodes={},calls=[],pending=[];
 class Element{constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.textContent='';}append(...items){for(const n of items){this.children.push(n);if(this.tag==='select'&&!this.value)this.value=n.value}}replaceChildren(...n){this.children=[];if(this.tag==='select')this.value='';this.append(...n)}}
 const get=id=>nodes[id]??=new Element(['period','run','type'].includes(id)?'select':'div');get('seed').textContent=JSON.stringify(seed);get('type').value='all';
 const document={getElementById:get,createElement:tag=>new Element(tag)};
 const rpc={withSuccessHandler(success){return {withFailureHandler(failure){return new Proxy({}, {get:(_,key)=>(...args)=>{calls.push(key);pending.push(()=>{try{success(f.c[key](...args));}catch(e){failure(e);}});}});}};}};

 const html=fs.readFileSync(new URL('../../procurement-planning/marketing-sync/History.html',import.meta.url),'utf8'),code=html.match(/<script>([\s\S]*?)<\/script>/)[1];let closed=false;vm.runInNewContext(code,{document,google:{script:{run:rpc,host:{close(){closed=true}}}}});
 expect(calls).toEqual([]);get('query').onclick();get('query').onclick();expect(calls).toEqual(['loadMarketingHistory']);pending.shift()();expect(get('status').textContent).toContain('唯讀');const card=get('offers').children[0],details=card.children.filter(n=>n.tag==='details').at(-1);details.open=true;details.ontoggle();expect(calls).toEqual(['loadMarketingHistory','loadMarketingHistoryProducts']);pending.shift()();expect(JSON.stringify({rows:f.ss.getSheets().map(s=>s.rows),props:f.props.getProperties()})).toBe(before);get('close').onclick();expect(closed).toBe(true);
});

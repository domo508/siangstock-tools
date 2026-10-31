import {it,expect} from 'vitest';
import {loadSourceGroup} from '../../store-orders/source-group.js';
const deps=(overrides={})=>({register:async id=>({id}),read:async id=>id,decode:async id=>id==='pdf'?['page1','page2']:[id],...overrides});
it('整組依選取順序載入，PDF多頁及獨立原圖保持來源與頁數',async()=>{
 const r=await loadSourceGroup(['second','pdf','first'],deps());
 expect(r.sources.map(s=>[s.fileId,s.pages])).toEqual([['second',1],['pdf',2],['first',1]]);
 expect(r.pages.map(p=>[p.fileId,p.index])).toEqual([['second',0],['pdf',0],['pdf',1],['first',0]]);
});
it('失敗不改寫既有來源或吞掉失敗頁，重新讀取可完整成功',async()=>{
 const existing=[{fileId:'saved',pages:1}],before=structuredClone(existing);
 await expect(loadSourceGroup(['ok','bad'],deps({existingSources:existing,read:async id=>{if(id==='bad')throw Error('Load failed');return id;}}))).rejects.toThrow('Load failed');
 expect(existing).toEqual(before);
 expect((await loadSourceGroup(['ok','bad'],deps({existingSources:existing}))).pages).toHaveLength(2);
});
it('空選取、重複、重複追加、來源別名重複與空白解析均阻擋',async()=>{
 for(const [ids,d] of [[[],deps()],[['a','a'],deps()],[['a'],deps({existingSources:[{fileId:'a'}]})],[['a','b'],deps({register:async()=>({id:'same'})})],[['a'],deps({decode:async()=>[]})]])await expect(loadSourceGroup(ids,d)).rejects.toThrow();
});
it('單張可續作原訂單，多張或追加不可帶入其他訂單',async()=>{
 const d=deps({register:async()=>({existing:'order1'})});
 expect(await loadSourceGroup(['a'],d)).toEqual({existing:'order1'});
 await expect(loadSourceGroup(['a','b'],d)).rejects.toThrow('其他訂單');
 await expect(loadSourceGroup(['a'],{...d,existingSources:[{fileId:'old'}]})).rejects.toThrow('其他訂單');
});

it('超過30頁須整組阻擋，不截取部分頁面',async()=>{await expect(loadSourceGroup(['pdf'],deps({decode:async()=>Array(31).fill('page')}))).rejects.toThrow('最多30頁');});

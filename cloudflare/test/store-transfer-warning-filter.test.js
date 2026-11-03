import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describe,expect,it} from 'vitest';

const source=readFileSync('../store-transfer/app.js','utf8');
function functionSource(name) {
  const match=source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
  if(!match)throw new Error(`Missing production function ${name}`);
  return match[0];
}
function fixture(role='hq') {
  const row=(store,sku,quantity=3,suggested=1)=>{
    const input={value:String(quantity)},reason={value:'合成原因'},cell={innerHTML:''};
    const main={hidden:false,dataset:{store,sku,itemType:'regular',suggested:String(suggested),reviewBase:String(suggested),supplyKnown:'false',supplyCeiling:'100',otherAllocated:'0',systemReason:'合成判斷',manual:'false'},querySelector:s=>s.includes('reason')?reason:input,matches:s=>s==='tr[data-store-row][data-item-type]'};
    const warning={hidden:true,dataset:{quantityWarning:''},previousElementSibling:main,querySelector:()=>cell,matches:s=>s==='[data-quantity-warning]'};main.nextElementSibling=warning;
    return {main,warning,input,reason,cell};
  };
  const entries=[row('R00','A102067'),row('R06','A102067'),row('R01','B53398')];
  const buttons=[{disabled:false},{disabled:false}],status={textContent:''};
  const detail={hidden:true,classList:{contains:()=>true},previousElementSibling:entries[0].main};
  const section={hidden:false,querySelectorAll:()=>entries.map(e=>e.main)};
  const root={querySelectorAll(s){if(s==='[data-store-row]'||s==='tr[data-item-type]')return entries.map(e=>e.main);if(s==='[data-quantity-warning]')return entries.map(e=>e.warning);if(s==='[data-decision-detail]')return [detail];if(s==='[data-store-section]')return [section];return buttons;},querySelector:()=>status};
  const state={batchStore:'all',batchSku:'',calculationStore:'all',calculationSku:'',config:{role,stores:{R00:{name:'合成中山'},R06:{name:'合成文心'},R01:{name:'合成北屯'}}}};
  const ctx={state,$:()=>root,refreshSkuFilterSummary:()=>{},quantityProjectionText:()=> '預估可售至：2026-11-13'};
  vm.createContext(ctx);
  vm.runInContext(['escapeHtml','syncQuantityWarningVisibility','applyResultFilters','refreshDialogQuantityWarnings'].map(functionSource).join('\n'),ctx);
  const filter=(sku='',store='all',scope='batch')=>{state[scope==='batch'?'batchSku':'calculationSku']=sku;state[scope==='batch'?'batchStore':'calculationStore']=store;ctx.applyResultFilters(scope);};
  return {entries,ctx,state,root,buttons,status,detail,section,filter};
}

describe('正式前台提醒列跟隨商品主列',()=>{
  for(const role of ['hq','store']) it(`${role}：大小寫／部分品號搜尋、清除與重新計算不留下孤立提醒`,()=>{
    const f=fixture(role),before=f.entries.map(e=>({value:e.input.value,reason:e.reason.value,dataset:{...e.main.dataset}}));
    f.ctx.refreshDialogQuantityWarnings();
    expect(f.entries.every(e=>!e.warning.hidden)).toBe(true);
    for(const q of ['a102067','A102','A102067']) {
      f.filter(q);expect(f.entries.map(e=>e.main.hidden)).toEqual([false,false,true]);
      expect(f.entries.map(e=>e.warning.hidden)).toEqual([false,false,true]);
      f.ctx.refreshDialogQuantityWarnings();expect(f.entries[2].warning.hidden).toBe(true);
    }
    f.filter('NOT-FOUND');expect(f.section.hidden).toBe(true);expect(f.entries.every(e=>e.warning.hidden)).toBe(true);expect(f.detail.hidden).toBe(true);
    f.filter();expect(f.section.hidden).toBe(false);expect(f.entries.every(e=>!e.warning.hidden)).toBe(true);
    expect(f.entries.map(e=>({value:e.input.value,reason:e.reason.value,dataset:{...e.main.dataset}}))).toEqual(before);
  });
  it('門市與品號聯合篩選，切回全部恢復應有提醒',()=>{
    const f=fixture();f.ctx.refreshDialogQuantityWarnings();
    f.filter('A102067','R06');expect(f.entries.map(e=>e.warning.hidden)).toEqual([true,false,true]);
    f.filter('A102067','R01');expect(f.entries.every(e=>e.warning.hidden)).toBe(true);
    f.filter('','R00');expect(f.entries.map(e=>e.warning.hidden)).toEqual([false,true,true]);
    f.filter();expect(f.entries.every(e=>!e.warning.hidden)).toBe(true);
  });
  it('篩掉的供應不足／缺原因仍計入整批防呆，不能藉搜尋繞過',()=>{
    const f=fixture();f.entries[2].main.dataset.supplyKnown='true';f.entries[2].main.dataset.supplyCeiling='1';
    f.filter('A102067');f.ctx.refreshDialogQuantityWarnings();
    expect(f.entries[2].warning.hidden).toBe(true);expect(f.entries[2].warning.dataset.warningTone).toBe('danger');
    expect(f.buttons.every(b=>b.disabled)).toBe(true);
    expect(f.status.textContent).toContain('1 筆');
    f.entries[2].main.dataset.supplyKnown='false';f.entries[2].reason.value='';f.ctx.refreshDialogQuantityWarnings();
    expect(f.entries[2].warning.hidden).toBe(true);expect(f.buttons.every(b=>b.disabled)).toBe(true);
  });
  it('無提醒者不因清除篩選重新出現；明確歸零、人工新增也同步',()=>{
    const f=fixture();f.entries[0].input.value='1';f.entries[1].input.value='0';f.entries[1].reason.value='合成取消';
    f.entries[2].main.dataset.manual='true';f.entries[2].main.dataset.suggested='0';
    f.ctx.refreshDialogQuantityWarnings();f.filter('B53398');expect(f.entries.map(e=>e.warning.hidden)).toEqual([true,true,false]);
    f.filter();expect(f.entries.map(e=>e.warning.hidden)).toEqual([true,true,false]);
    expect(f.entries[1].input.value).toBe('0');
  });
  it('提醒標題包含門市／品號並完整跳脫文字',()=>{
    const f=fixture();f.state.config.stores.R00.name='<門市&名稱>';f.entries[0].main.dataset.sku='A<102067';
    f.ctx.refreshDialogQuantityWarnings();
    expect(f.entries[0].cell.innerHTML).toContain('R00 &lt;門市&amp;名稱&gt;／A&lt;102067');
    expect(f.entries[0].cell.innerHTML).toContain('系統未建議追加量');
    expect(f.entries[0].cell.innerHTML).not.toContain('<門市');
  });
  it('找不到商品主列的提醒一律隱藏，預覽篩選也相容',()=>{
    const f=fixture();f.ctx.refreshDialogQuantityWarnings();f.entries[2].warning.previousElementSibling=null;
    f.filter('', 'all','calculation');expect(f.entries[2].warning.hidden).toBe(true);
  });
  it('已展開明細跟隨商品主列，不受中間提醒列有無內容影響',()=>{
    const f=fixture();f.entries[0].input.value='1';f.ctx.refreshDialogQuantityWarnings();
    f.detail.previousElementSibling=f.entries[0].warning;
    f.filter('A102067');expect(f.entries[0].warning.hidden).toBe(true);expect(f.detail.hidden).toBe(false);
    f.filter('B53398');expect(f.detail.hidden).toBe(true);
    f.filter('A102067');expect(f.detail.hidden).toBe(false);
  });
});

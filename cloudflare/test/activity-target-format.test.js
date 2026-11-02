import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describe,it,expect} from 'vitest';
const code=readFileSync('../procurement-planning/app.js','utf8');
function render(retailAmount){
 const node=()=>({children:[],listeners:{},append(...items){this.children.push(...items)},appendChild(item){this.children.push(item)},addEventListener(event,fn){this.listeners[event]=fn},setAttribute(name,value){this[name]=value},replaceChildren(item){this.children=item.children}});
 const state={activityTargets:{'2026-11':{amount:10000000,retailAmount}},analysis:{},legacyActivity:{},activityTargetSignature:''};
 const elements={activityMonthlyTargets:node()};let invalidations=0,refreshes=0;
 const ctx={state,elements,document:{createElement:node,createDocumentFragment:node},activityMonthList:()=>['2026-11'],formatIntegerAmount:n=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:0}).format(n),invalidateAnalysis:()=>invalidations++,renderActivityControls:()=>refreshes++};
 vm.runInNewContext(code.slice(code.indexOf('  function renderActivityTargets('),code.indexOf('  async function loadActivityMonthTargets('))+'\nrenderActivityTargets(true);',ctx);
 return {state,input:elements.activityMonthlyTargets.children[1].children[1],counts:()=>({invalidations,refreshes})};
}
describe('大活動六店目標金額格式',()=>{
 it.each([[3500000,'3,500,000'],[0,'0'],[null,''],[3500000.25,'3,500,000.25']])('帶入 %s 顯示 %s 且不改原數值',(amount,display)=>{
  const {input,state}=render(amount);expect(input.type).toBe('text');expect(input.value).toBe(display);expect(state.activityTargets['2026-11'].retailAmount).toBe(amount);
 });
 it.each([['3,500,000',3500000,'3,500,000'],['4000000',4000000,'4,000,000'],['0',0,''],['',null,''],['3,500,000.25',3500000.25,'3,500,000.25']])('輸入 %s 保存數值 %s，再離開欄位套用千分位',(typed,amount,display)=>{
  const {input,state,counts}=render(3500000);input.value=typed;input.listeners.input();expect(state.activityTargets['2026-11'].retailAmount).toBe(amount);input.listeners.blur();expect(input.value).toBe(amount===0?'0':display);expect(state.legacyActivity).toBe(null);expect(counts()).toEqual({invalidations:1,refreshes:1});
  const saved=JSON.parse(JSON.stringify(state.activityTargets['2026-11']));expect(saved.retailAmount).toBe(amount);expect(saved.amount).toBe(10000000);expect(render(saved.retailAmount).input.value).toBe(input.value);
 });
});

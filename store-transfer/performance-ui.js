(function(){'use strict';
const core=globalThis.StoreTransferPerformance,$=id=>document.getElementById(id),fmt=v=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:1}).format(v);
const metrics=[['turnover','估計庫存週轉天數','天',false],['stockout','快照缺貨率','%',true],['warehouse','缺貨轉寄率','%',true],['stagnant','42天無現場去化庫存占比','%',true],['fill','核准配貨滿足率','%',true]];
function text(tag,value){const e=document.createElement(tag);e.textContent=value;return e;}
function mount({api,checkRuntimeVersion}){
 let data=null,busy=false,sequence=0;const root=$('performance-panel');if(!root)return;
 const status=$('performance-status'),cards=$('performance-cards'),trend=$('performance-trend'),byStore=$('performance-store');
 function render(){if(!data)return;try{
  const storeCodes=byStore.value==='all'?Object.keys(data.stores):[byStore.value];
  const latest=[...data.snapshots.map(s=>s.salesEnd),...data.supply.map(s=>s.date)].sort().at(-1);
  if(!latest){status.textContent='尚無可比較資料。總部下次正式計算時可確認來源日期，隨批次保存成效摘要；不需重建舊批次。';cards.replaceChildren();trend.replaceChildren();return;}
  // Each comparison measures its own calendar; never truncate evidence at a manual launch date.
  const snapshots=data.snapshots,supply=data.supply;
  const mode=$('performance-period').value,p=core.periods(mode,latest,$('performance-start').value,$('performance-end').value);
  const a=core.measure(snapshots,supply,storeCodes,p.current),b=core.measure(snapshots,supply,storeCodes,p.previous);
  $('performance-range').textContent=`本期 ${p.current.join('～')} ／ 前期 ${p.previous.join('～')}；資料最新日 ${latest}。`;
  cards.replaceChildren(...metrics.map(([key,label,unit,rate])=>{const card=document.createElement('article');card.className='performance-card';card.append(text('h3',label),text('strong',a[key]==null?'資料不足':fmt(a[key]*(rate?100:1))+unit),text('p',core.delta(a[key],b[key],rate).text),text('small',b[key]==null?'前期：資料不足':`前期：${fmt(b[key]*(rate?100:1))}${unit}`));return card;}));
  const errors=[...new Set([...a.quality,...b.quality.map(q=>'前期：'+q)])];status.textContent=errors.length?`可用資料已顯示；${errors.join('；')}。缺資料不當成0。`:'本期與前期資料已載入；請搭配活動與季節差異解讀，不直接視為系統造成的效果。';
  trend.replaceChildren();
  for(const store of storeCodes){const m=core.measure(snapshots,supply,[store],p.current),section=document.createElement('article');section.className='performance-store-result';section.append(text('h3',`${store} ${data.stores[store].name}`),text('p',`本期現場淨銷售 ${m.localQty==null?'資料不足':fmt(m.localQty)+'件'} ／ 缺貨轉寄 ${m.warehouseQty==null?'資料不足':fmt(m.warehouseQty)+'件'} ／ 核准覆蓋 ${fmt(m.covered)}／需求 ${fmt(m.need)} 件`));
   const list=document.createElement('div');list.className='performance-weeks';
   const weeks=[...new Set(data.supply.filter(r=>r.storeCode===store&&r.date>=p.current[0]&&r.date<=p.current[1]).map(r=>r.weekKey))].sort();
   for(const week of weeks){const rows=data.supply.filter(r=>r.weekKey===week&&r.storeCode===store),d=rows.reduce((n,r)=>n+r.need,0),c=rows.reduce((n,r)=>n+r.covered,0),approved=rows.every(r=>r.approved);list.append(text('p',`${week}：${approved?(d>0?fmt(c/d*100)+'%':'無系統需求'):'待核准'}；需求${fmt(d)}件／覆蓋${fmt(c)}件`));}
   section.append(list);trend.append(section);
  }
 }catch(error){status.textContent=error.message;cards.replaceChildren();trend.replaceChildren();}}
 async function load(){if(busy)return;busy=true;$('performance-refresh').disabled=true;status.textContent='正在讀取成效摘要；不會重新計算或更改批次。';const seq=++sequence;
  try{if(!(await checkRuntimeVersion()))throw Error('請先重新載入最新版。');const next=await api('/performance');if(seq!==sequence)return;data=next;const markerDates=[...new Set(data.snapshots.map(s=>s.remarkSince).filter(Boolean))];if(markerDates.length===1&&!$('performance-remark-since').value)$('performance-remark-since').value=markerDates[0];const currentStore=byStore.value;byStore.replaceChildren();if(data.role!=='store'){const option=text('option',data.role==='supervisor'?'所屬區域全部門市':'全部門市');option.value='all';byStore.append(option);}for(const [code,store]of Object.entries(data.stores)){const option=text('option',`${code} ${store.name}`);option.value=code;byStore.append(option);}if(currentStore==='all'&&data.role!=='store'||data.stores[currentStore])byStore.value=currentStore;render();}
  catch(error){data=null;cards.replaceChildren();trend.replaceChildren();status.textContent=`讀取失敗：${error.message}；可稍後按更新成效資料，原批次不受影響。`;}
  finally{busy=false;$('performance-refresh').disabled=false;}}
 for(const id of ['performance-store','performance-period','performance-start','performance-end'])$(id).addEventListener('change',()=>{$('performance-custom').hidden=$('performance-period').value!=='custom';render();});
 $('performance-refresh').addEventListener('click',load);load();return{refresh:load};
}
globalThis.StoreTransferPerformanceUI={mount};
})();

(function(root){
 'use strict';
 // Counts use saved, role-scoped API rows, independent of display filters and drafts.
 function summaryText(rows){
 const counts={store:0,hq:0,stock:0,erp:0};
 for(const r of rows){
  if(r.status==='store_confirmation'){counts[r.store_status==='submitted'?'hq':'store']++;continue;}
  if(r.status!=='waiting_stock')continue;
  const approved=Number(r.approved_quantity??0),committed=Number(r.committed_quantity||0),dispatched=Number(r.dispatched_quantity||0);
  if(approved>committed)counts.stock++;
  if(Math.min(approved,committed)>dispatched)counts.erp++;
 }
 const parts=[['store','待門市確認'],['hq','待總部覆核'],['stock','等待到貨／待配'],['erp','待週調撥出貨']].filter(([k])=>counts[k]).map(([k,label])=>`${label} ${counts[k]}筆`);
 return parts.length?parts.join('・'):'目前無待處理新品首配';
 }
 function mount({api,config,checkRuntimeVersion,sendNotice}){
 const host=document.getElementById('new-product-panel');if(!host)return;
 host.hidden=false;let all=[],drafts=new Map(),busy=false;
 const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const store=config.role==='store',status=document.getElementById('new-product-status'),content=document.getElementById('new-product-content');
 const key=r=>`${r.id}|${r.store_code}|${r.sku}`;
 function draft(r){return drafts.get(key(r))||{quantity:Number(store?r.confirmed_quantity??r.suggested_quantity:r.approved_quantity??r.confirmed_quantity??r.suggested_quantity),reason:String(store?r.store_reason||'':r.hq_reason||'')};}
 function rowChanged(r){const d=draft(r),base=Number(store?r.suggested_quantity:r.confirmed_quantity??r.suggested_quantity);return root.NewProductAllocation.changed(r)||d.quantity!==base||Boolean(d.reason);}
 function render(){document.getElementById('new-product-summary').textContent=summaryText(all);const filter=document.getElementById('new-product-store').value,only=document.getElementById('new-product-changed').checked;content.replaceChildren();
 const plans=[...new Set(all.map(r=>r.id))];
 if(!plans.length){content.innerHTML=store?'<p>目前沒有需要本店確認的新品首配。已核定品項由總部安排出貨，門市無需再次確認。</p>':'<p>目前沒有已核准採購的新品首配。新品完成採購核准後會出現在此處。</p>';return;}
 for(const id of plans){const rows=all.filter(r=>r.id===id),first=rows[0],visible=rows.filter(r=>(filter==='all'||r.store_code===filter)&&(!only||rowChanged(r)));
 const section=document.createElement('article');section.className='new-product-plan';
 const ready=first.status==='waiting_stock';const total=rows.reduce((n,r)=>n+Number(r.approved_quantity??0),0),committed=rows.reduce((n,r)=>n+Number(r.committed_quantity||0),0),dispatched=rows.reduce((n,r)=>n+Number(r.dispatched_quantity||0),0);
 const complete=ready&&dispatched>=total,fullyClaimed=ready&&committed>=total;
 const phaseTitle=complete?'首配已完成':fullyClaimed?'首配已帶入週調撥・待完成ERP':ready?'首配已核定・等待庫存／週調撥':'新品首配・'+(store?'確認本店需求':'第一次需求覆核');
 section.innerHTML=`<div class="section-heading"><div><p class="eyebrow">${e(id)}</p><h3>${phaseTitle}</h3></div></div><p>${ready?`核定${total}件／已帶入週調撥${committed}件（含已產ERP ${dispatched}件）／尚待配${Math.max(0,total-committed)}件。`:'到貨前先核定需求；不產生ERP。到貨後帶入週調撥，總部進行第二次出貨覆核。'}</p><p class="status-line">目前顯示${visible.length}筆／本批${rows.length}筆；儲存與覆核依完整範圍，篩選不減少資料。</p>`;
 if(!store&&Number(first.notice_total)>0){const notices=document.createElement('p');notices.className='status-line';notices.setAttribute('role','status');notices.textContent=`門市首配通知：${Number(first.notice_sent)||0}/${Number(first.notice_total)}已通知／已完成確認`;section.append(notices);if(Number(first.notice_sent)<Number(first.notice_total)&&sendNotice){const retry=document.createElement('button');retry.type='button';retry.className='secondary-button';retry.textContent='重送未成功的新品通知';retry.addEventListener('click',async()=>{if(!(await checkRuntimeVersion()))return;retry.disabled=true;notices.textContent='正在寄送新品通知…';try{const result=await sendNotice(id);notices.textContent=`新品通知本次寄出${result.sent}封；尚待處理${result.remaining}間。`;await load();}catch(error){notices.textContent=`新品通知待處理：${error.message}；原核准與首配保留。`;}finally{retry.disabled=false;}});section.append(retry);}}
 const next=document.createElement('p');next.className='status-line';next.textContent=complete?'目前狀態：首配已完成；無需重複申請或核定。':fullyClaimed?'目前狀態：已帶入週調撥；下一步：由總部接續本週出貨覆核及ERP。':ready?'目前狀態：首配已核定；下一步：等待最新庫存計算帶入週調撥。':store?(first.store_status==='submitted'?'目前狀態：已送出；下一步：等待總部核定。':'目前狀態：待本店確認；下一步：核對數量後暫存或送出。'):rows.some(r=>r.store_status!=='submitted')?'目前狀態：仍有門市尚未送出；下一步：等待門市回覆。':'目前狀態：各店已送出；下一步：核對完整需求後核定首配。';section.append(next);
 const go=document.createElement('button');go.type='button';go.className='secondary-button compact';go.textContent='前往首配明細';go.addEventListener('click',()=>{const first=section.querySelector('.new-product-line');first?.scrollIntoView({block:'center',behavior:'smooth'});first?.querySelector('input:not(:disabled),summary')?.focus({preventScroll:true});});section.append(go);
 for(const r of visible){const d=draft(r),editable=!ready&&(!store||r.store_status!=='submitted'),node=document.createElement('div');node.className='new-product-line'+(rowChanged(r)?' is-adjusted':'');node.innerHTML=`<div><strong>${e(r.store_code)} ${e(config.stores[r.store_code]?.name||'')}</strong><br><strong>${e(r.sku)}</strong><p>${e(r.name)}</p><details><summary>查看首配依據</summary><p>${e(r.evidence)}</p></details></div><div>系統建議 <strong>${r.suggested_quantity}</strong> 件<br>門市確認 ${r.confirmed_quantity??'尚未確認'}<br><span>${e(({pending:'尚未回覆',saved:'已暫存',submitted:'已送出'})[r.store_status])}</span></div><label>${store?'門市確認量':'總部核定量'}<input type="number" min="0" max="100000" step="1" value="${d.quantity}" ${editable?'':'disabled'} data-qty></label><label>調整原因<textarea rows="2" maxlength="500" ${editable?'':'disabled'} data-reason>${e(d.reason)}</textarea></label>`;
 const update=()=>{const raw=node.querySelector('[data-qty]').value;drafts.set(key(r),{quantity:raw===''?NaN:Number(raw),reason:node.querySelector('[data-reason]').value});node.classList.toggle('is-adjusted',rowChanged(r));status.textContent='有尚未儲存的新品異動；請暫存或送出。';};node.querySelector('[data-qty]').addEventListener('input',update);node.querySelector('[data-reason]').addEventListener('input',update);section.append(node);}
 if(!visible.length){const empty=document.createElement('p');empty.textContent='此篩選下沒有品項；可取消「只看異動品項」查看完整內容。';section.append(empty);}
 const actions=document.createElement('div');actions.className='detail-actions';if(!ready){const buttons=store?[['save','暫存'],['submit','送出總部覆核']]:[['approve','核定首配，等待到貨']];for(const [action,label]of buttons){const button=document.createElement('button');button.type='button';button.className=action==='save'?'secondary-button':'primary-button';button.textContent=label;button.disabled=busy||(store&&rows.every(r=>r.store_status==='submitted'))||(!store&&rows.some(r=>r.store_status!=='submitted'));button.addEventListener('click',()=>save(id,action,section));actions.append(button);}}else{const p=document.createElement('p');p.textContent=complete?'本批首配流程已完成，後續依一般週補貨規則判斷。':fullyClaimed?'已核定量均已帶入週調撥，請接續原週批次處理；不重複開量。':store?'已核定，等待總部安排到貨後出貨；無需重複送出。':'下一步：匯入最新庫存並產生本週建議；有可釋出量時，自動帶入首配待配量。';actions.append(p);}section.append(actions);content.append(section);}
 }
 async function load(){try{status.textContent='正在讀取新品首配…';document.getElementById('new-product-summary').textContent='正在讀取待處理筆數…';const response=await api('/new-products');all=response.rows;render();status.textContent=drafts.size?'已讀取最新版本並保留未保存輸入；請比對目前門市確認量後再送出。':'已讀取新品首配；依目前狀態確認需求或等待到貨。';}catch(error){document.getElementById('new-product-summary').textContent='待處理筆數讀取失敗，請展開更新列表';status.textContent=`新品首配讀取失敗：${error.message}`;}}
 async function save(id,action,section){if(busy||!(await checkRuntimeVersion()))return;const rows=all.filter(r=>r.id===id);const message=document.createElement('p');message.className='status-line';message.setAttribute('role','status');section.append(message);let saved=false,locked=[];try{const items=rows.map(r=>{const d=draft(r);root.NewProductAllocation.quantity(d.quantity);if(d.quantity!==Number(store?r.suggested_quantity:r.confirmed_quantity??r.suggested_quantity)&&!d.reason.trim())throw Error(`${r.store_code}／${r.sku}調整數量請填原因。`);return {storeCode:r.store_code,sku:r.sku,quantity:d.quantity,reason:d.reason};});busy=true;locked=[...content.querySelectorAll('button')].map(b=>[b,b.disabled]);locked.forEach(([b])=>b.disabled=true);message.textContent='正在保存，請稍候…';
 const result=await fetch(`/api/store-transfer/new-products/${encodeURIComponent(id)}/${action}`,{method:'PUT',headers:{'Content-Type':'application/json','X-New-Product-Version':'20261116-new-product-allocation-r3'},body:JSON.stringify({expectedRevision:rows[0].revision,storeCode:config.storeCode,items}),cache:'no-store'});const response=await result.json();if(!result.ok)throw Error(response.error||`HTTP ${result.status}`);saved=true;
 // Only successful saving clears drafts. Refreshing a different plan cannot discard unsaved work.
 for(const r of rows)drafts.delete(key(r));all=(await api('/new-products')).rows;busy=false;render();status.textContent=action==='approve'?'首配需求已核定，等待到貨；尚未產生ERP。':action==='submit'?'本店新品首配已送出總部覆核。':'新品首配已暫存。';
 }catch(error){message.textContent=saved?`新品資料已保存，但重新讀取失敗：${error.message}；請更新列表確認，勿重複送出。`:`保存未完成：${error.message}；輸入已保留。`;message.setAttribute('role','alert');status.textContent=message.textContent;}finally{busy=false;locked.forEach(([b,disabled])=>{if(b.isConnected)b.disabled=disabled;});}}
 document.getElementById('new-product-refresh').addEventListener('click',load);document.getElementById('new-product-changed').addEventListener('change',render);const sel=document.getElementById('new-product-store');sel.innerHTML=(store?'':'<option value="all">全部門市</option>')+Object.entries(config.stores).filter(([code])=>!store||code===config.storeCode).map(([code,v])=>`<option value="${e(code)}">${e(code)} ${e(v.name)}</option>`).join('');sel.addEventListener('change',render);load();
 }
 root.NewProductAllocationUI={mount,summaryText};
})(globalThis);

(function(root){
  "use strict";
  const PAGE_SIZE=25;
  const escape=value=>String(value ?? "").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function createSelection(rows){
    const selected=new Set(), drafts=new Map(rows.map(r=>[r.sku,String(r.extraQuantity)]));
    return {rows,selected,drafts,
      select(sku,on){if(rows.find(r=>r.sku===sku)?.canEdit){if(on)selected.add(sku);else selected.delete(sku);}},
      selectPage(page){for(const r of rows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE))this.select(r.sku,true);},
      selectAll(){for(const r of rows)this.select(r.sku,true);},
      items(){return rows.filter(r=>selected.has(r.sku)).map(r=>({sku:r.sku,extraQuantity:Number(drafts.get(r.sku))}));},
      validate(){
        const errors=[];
        if(!selected.size)errors.push('請先勾選品項。');
        for(const r of rows.filter(r=>selected.has(r.sku))){
          const raw=drafts.get(r.sku),n=Number(raw);
          if(raw==null || !String(raw).trim() || !Number.isSafeInteger(n) || n<0 || n>100000 || n>r.maxExtra)errors.push(`${r.sku}：請填寫0至${r.maxExtra}件的整數。`);
          else if(Number(r.baseReleasable)+n<Number(r.allocated))errors.push(`${r.sku}：開放後額度低於已分配量，請先減量。`);
        }
        return errors;
      }
    };
  }
  function availabilityMessage(row){
    if(row.batchEditable===false)return {tone:'muted',text:'本批目前沒有可編輯門市，請先確認批次狀態。'};
    if(row.supplyKnown!==true || row.remainingQuantity==null)return {tone:'warn',text:'剩餘可申請量資料未取得或不一致，請重新搜尋核對。'};
    if(row.directManualAllowed && row.remainingQuantity>0)return {tone:'ready',text:'可直接人工新增，不需額外開放。'};
    return {tone:'muted',text:Number(row.reserve)>0?'目前剩餘可申請量為0；如有需求，可由總部評估額外開放。':'目前剩餘可申請量為0，且無安全保留量可額外開放。'};
  }
  function mount(host,context){
    let model=createSelection([]),page=0,revision=null,preview=null,busy=false,searched=false,lastQuery="";
    host.innerHTML=`<details><summary>系列商品搜尋與批次開放</summary><p>使用本批商品快照查詢。可單品、本頁或跨頁全部勾選；換頁保留已選。每個品號各自設定「額外開放總量」，六店共用，並非整個系列共用件數。</p><div class="quota-fields"><label>查詢方式<select data-bulk-mode><option value="name">商品品名／關鍵字</option><option value="sku">ERP品號（完整或部分）</option></select></label><label>查詢文字<input data-bulk-query maxlength="80" placeholder="例如 天絲 禾暮；空白分隔須全部符合"></label><button type="button" class="secondary-button" data-bulk="search">搜尋商品</button></div><p>剩餘可新增量為搜尋當下的本批六店共用額度，已扣除各店已分配量，不是每店各有一份；實際新增仍須通過原檢核。重新搜尋會清除本區勾選與開放草稿；不影響下方尚未暫存的門市申請。</p><div data-bulk-results></div><p data-bulk-status class="status-line" role="status" aria-live="polite">請先搜尋需要開放的商品。</p></details>`;
    const $=s=>host.querySelector(s), status=$('[data-bulk-status]');
    function invalidate(){preview=null;$('[data-bulk-preview]')?.replaceChildren();}
    function summary(){const items=model.items();$('[data-bulk-summary]').textContent=`搜尋「${lastQuery}」：${model.rows.length.toLocaleString('zh-TW')}個品號・可選${model.rows.filter(r=>r.canEdit).length.toLocaleString('zh-TW')}個・跨頁已選${items.length.toLocaleString('zh-TW')}個`;
      const b=$('[data-bulk="preview"]');if(b)b.disabled=busy || !items.length;
    }
    function render(){
      if(!searched)return;
      const count=Math.max(1,Math.ceil(model.rows.length/PAGE_SIZE));page=Math.min(page,count-1);
      const rows=model.rows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
      $('[data-bulk-results]').innerHTML=`<p data-bulk-summary role="status" aria-live="polite"></p><div class="quota-selection-actions"><button type="button" class="secondary-button" data-bulk="page">勾選本頁可開放品項</button><button type="button" class="secondary-button" data-bulk="all">跨頁勾選全部搜尋結果</button><button type="button" class="secondary-button" data-bulk="clear">清除全部勾選</button></div><div class="quota-product-list">${rows.map(r=>`<article class="quota-product"><label class="quota-product-choice"><input type="checkbox" data-bulk-sku="${escape(r.sku)}" ${model.selected.has(r.sku)?'checked':''} ${r.canEdit?'':'disabled'}><span><strong>${escape(r.sku)}</strong><br>${escape(r.productName)}</span></label><div class="quota-product-facts"><span>安全保留：${r.reserve ?? '未知'}件</span><span>原可供應：${r.baseReleasable ?? '未知'}件</span><span>已分配：${r.allocated}件</span><span>已開放：${r.extraQuantity}件</span><strong>本批六店共用剩餘可新增：${r.remainingQuantity == null ? '未知' : r.remainingQuantity.toLocaleString('zh-TW')}件</strong></div><p class="quota-availability ${availabilityMessage(r).tone}">${escape(availabilityMessage(r).text)}</p>${r.canEdit?`<label>本批額外開放總量（上限${r.maxExtra}件）<input type="number" min="0" max="${r.maxExtra}" step="1" data-bulk-amount="${escape(r.sku)}" value="${escape(model.drafts.get(r.sku))}"></label>`:`<p class="status-line">${r.directManualAllowed ? "無需勾選開放額度，可在人工新增品項區申請。" : `不可勾選額外開放：${escape(r.blockedReason)}`}</p>`}</article>`).join('') || '<p>沒有符合的商品，請調整查詢文字。</p>'}</div><div class="quota-selection-actions"><button type="button" class="secondary-button" data-bulk="prev" ${page===0?'disabled':''}>上一頁</button><span>第${page+1}／${count}頁，每頁${PAGE_SIZE}筆</span><button type="button" class="secondary-button" data-bulk="next" ${page>=count-1?'disabled':''}>下一頁</button></div><div class="quota-fields"><label>統一設定每個已選品號的額外開放總量<input type="number" data-bulk-uniform min="0" step="1"></label><button type="button" class="secondary-button" data-bulk="apply">套用至已選品號</button></div><p>統一數量仍須逐品號符合上限；不會自動縮減或略過。填0代表取消該品號額外開放，不能低於已分配量。</p><label>共同開放／調整原因<textarea data-bulk-reason maxlength="300" rows="2"></textarea></label><div class="quota-selection-actions"><button type="button" class="primary-button" data-bulk="preview">預覽批次開放</button></div><div data-bulk-preview></div>`;
      $('[data-bulk-reason]').value=host._bulkReason || '';summary();
    }
    function validate(){const errors=model.validate();if(revision===null)errors.push("請先重新搜尋，取得本批最新額度後再預覽。");if(!$('[data-bulk-reason]')?.value.trim())errors.push('請填寫共同開放原因。');return errors;}
    function showErrors(errors){status.textContent=errors.slice(0,20).join('；')+(errors.length>20?`；另有${errors.length-20}項，請逐筆修正。`:'');}
    function showPreview(){
      invalidate();const errors=validate();if(errors.length){showErrors(errors);return;}
      const items=model.items(),reason=$('[data-bulk-reason]').value.trim();
      preview={items,reason,expectedRevision:revision};
      $('[data-bulk-preview]').innerHTML=`<section class="quota-preview"><h4>確認本批開放內容</h4><p>已選${items.length.toLocaleString('zh-TW')}個品號・開放總量合計${items.reduce((n,r)=>n+r.extraQuantity,0).toLocaleString('zh-TW')}件（設定後的額外總量，不是本次新增件數）</p><p>共同原因：${escape(reason)}</p><details><summary>核對全部已選品號與數量</summary><ul>${items.map(i=>{const r=model.rows.find(r=>r.sku===i.sku);return `<li>${escape(i.sku)}／${escape(r.productName)}：${r.extraQuantity} → ${i.extraQuantity}件</li>`;}).join('')}</ul></details><button type="button" class="primary-button" data-bulk="confirm">確認批次開放（${items.length.toLocaleString('zh-TW')}個品號）</button><p>確認後才寫入；若任一品號不符上限或批次變更，整批停止。只開放額度，不新增申請或核准。</p></section>`;
      status.textContent='預覽已就緒，請核對品號、數量與原因後確認開放。';
    }
    host.addEventListener('input',e=>{e.stopPropagation();if(busy)return;
      if(e.target.matches('[data-bulk-amount]'))model.drafts.set(e.target.dataset.bulkAmount,e.target.value);
      if(e.target.matches('[data-bulk-reason]'))host._bulkReason=e.target.value;
      // Changing a query also invalidates its preview. Existing results remain
      // explicitly tied to the last successful search until Search is pressed.
      invalidate();
    });
    host.addEventListener('change',e=>{e.stopPropagation();if(busy)return;if(e.target.matches('[data-bulk-sku]')){model.select(e.target.dataset.bulkSku,e.target.checked);invalidate();summary();}});
    host.addEventListener('click',async e=>{
      const button=e.target.closest('[data-bulk]');if(!button)return;e.stopPropagation();
      if(busy || context.isBusy())return;
      const action=button.dataset.bulk;
      if(action==='page' || action==='all' || action==='clear'){
        if(action==='page')model.selectPage(page);if(action==='all')model.selectAll();if(action==='clear')model.selected.clear();invalidate();render();return;
      }
      if(action==='prev' || action==='next'){page+=action==='prev'?-1:1;invalidate();render();return;}
      if(action==='apply'){
        const raw=$('[data-bulk-uniform]').value;
        if(!raw.trim() || !Number.isSafeInteger(Number(raw)) || Number(raw)<0 || Number(raw)>100000){status.textContent='統一開放總量須為0至100,000的整數。';return;}
        if(!model.selected.size){status.textContent='請先勾選品項。';return;}
        for(const sku of model.selected)model.drafts.set(sku,raw);invalidate();render();const errors=model.validate();if(errors.length)showErrors(errors);else status.textContent='已套用至跨頁已選品號，請預覽確認；尚未寫入。';return;
      }
      if(action==='preview'){showPreview();return;}
      if(action!=='search' && action!=='confirm')return;
      if(action==='confirm' && !preview){status.textContent='內容已變更，請重新預覽後確認。';return;}
      if(action==='search' && !$('[data-bulk-query]').value.trim()){status.textContent='請先輸入品名、關鍵字或ERP品號。';return;}
      const fields=[...host.querySelectorAll('input,select,textarea,button')].map(el=>[el,el.disabled]);
      busy=true;context.setBusy(true);fields.forEach(([el])=>el.disabled=true);status.textContent=action==='search'?'正在搜尋本批商品…':'正在確認整批額度，請勿重複操作…';
      let saved=false;
      try{
        if(action==='search'){
          const query=$('[data-bulk-query]').value.trim(),mode=$('[data-bulk-mode]').value;
          const p=await context.api(`/batches/${encodeURIComponent(context.batchId)}/supply-releases?mode=${encodeURIComponent(mode)}&q=${encodeURIComponent(query)}`);
          lastQuery=query;model=createSelection(p.rows);revision=p.expectedRevision;page=0;preview=null;searched=true;host._bulkReason='';render();
          status.textContent=`已搜尋「${query}」，請勾選並設定各品號開放總量；換頁會保留勾選。`;
        }else{
          const result=await context.api(`/batches/${encodeURIComponent(context.batchId)}/supply-releases`,{method:'PUT',body:preview});saved=true;
          const success=`已成功開放${result.count.toLocaleString('zh-TW')}個品號，設定後額外總量合計${result.totalExtra.toLocaleString('zh-TW')}件；門市更新可申請狀態後可人工新增。`;
          for(const item of preview.items){const r=model.rows.find(r=>r.sku===item.sku);r.extraQuantity=item.extraQuantity;}
          revision=result.expectedRevision;model.selected.clear();preview=null;render();
          try{await context.refresh();status.textContent=success;}catch(err){status.textContent=`${success} 本畫面更新未完成：${err.message}`;}
        }
      }catch(err){invalidate();if(action==='confirm')revision=null;status.textContent=`${saved?'額度已保存；':action==='confirm'?'尚未確認批次開放成功，請重新搜尋核對實際額度後再操作；':'搜尋失敗，保留上次結果與勾選；'}${err.message}`;}
      finally{busy=false;context.setBusy(false);fields.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});if(searched)summary();}
    });
    return {get model(){return model;}};
  }
  root.StoreTransferBulkSupply={mount,createSelection,availabilityMessage,PAGE_SIZE};
})(globalThis);

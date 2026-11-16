/* Historical numeric sales evidence only; no workflow write or ERP action. */
(function(){'use strict';const $=id=>document.getElementById(id);
function mount({api,readReports,refresh}){
 const panel=$('performance-import');panel.hidden=false;let pending=null,busy=false;
 const status=$('performance-import-status'),auto=$('performance-auto-status');
 async function reload(){try{const result=await api('/batches');const current=$('performance-import-batch').value;$('performance-import-batch').replaceChildren();for(const b of result.batches||[]){if(!['open','review','approved','erp_created','closed'].includes(b.status))continue;const o=document.createElement('option');o.value=b.id;o.textContent=`${b.week_key}｜${b.proposal_date}｜${b.id}`;$('performance-import-batch').append(o);}if([...$('performance-import-batch').options].some(o=>o.value===current))$('performance-import-batch').value=current;status.textContent='選擇原正式批次及銷售檔，只補銷售成效，不改原批次。';}catch(e){status.textContent=`批次讀取失敗：${e.message}`;}}
 async function saveAutomatic(payload){pending=payload;auto.textContent='正在自動保存銷售成效摘要…';try{const r=await api('/performance-sales',{method:'POST',body:payload});pending=null;auto.textContent=`銷售成效已自動保存：${r.stores}店／${r.days}店日。${r.complete?'完整期間無交易日已記為0。':'只保存來源可辨識的門市日期；其餘日期未知，可用歷史補匯確認完整期間。'}庫存快照仍需核對實際日期。`;$('performance-auto-retry').hidden=true;refresh?.();return true;}catch(e){auto.textContent=`銷售成效尚未保存：${e.message}。原補貨結果不變，可按重試，不需重算。`;$('performance-auto-retry').hidden=false;return false;}}
 $('performance-auto-retry').addEventListener('click',async()=>{if(!pending||busy)return;busy=true;$('performance-auto-retry').disabled=true;try{await saveAutomatic(pending);}finally{busy=false;$('performance-auto-retry').disabled=false;}});
 $('performance-import-refresh').addEventListener('click',reload);
 for(const field of panel.querySelectorAll('input,select'))field.addEventListener('change',()=>{if(field.id!=='performance-import-complete')$('performance-import-complete').checked=false;status.textContent=`已選${$('performance-import-files').files.length}份銷售檔；請核對期間與原批次全部門市後再確認補匯。`;});
 $('performance-import-save').addEventListener('click',async()=>{if(busy)return;busy=true;const button=$('performance-import-save');button.disabled=true;const fields=[...panel.querySelectorAll('input,select')];fields.forEach(f=>f.disabled=true);
 try{const batchId=$('performance-import-batch').value,files=[...$('performance-import-files').files],salesStart=$('performance-import-start').value,salesEnd=$('performance-import-end').value,remarkSince=$('performance-import-remark').value;
 if(!batchId||!files.length||!globalThis.StoreTransferPerformance.validDate(salesStart)||!globalThis.StoreTransferPerformance.validDate(salesEnd)||!globalThis.StoreTransferPerformance.validDate(remarkSince)||!$('performance-import-complete').checked)throw Error('請選擇批次、銷售檔並確認期間與門市資料完整。');
 status.textContent='正在讀取商品範圍與本機銷售檔，尚未保存…';const context=await api(`/performance-import-context?batch=${encodeURIComponent(batchId)}`);const reports=await readReports(files);const payload=globalThis.StoreTransferPerformance.buildSalesSummary(reports,context.catalog,context.stores,{batchId,salesStart,salesEnd,remarkSince,complete:true});
 status.textContent=`正在保存${payload.salesStart}～${payload.salesEnd}銷售成效…`;const r=await api('/performance-sales',{method:'POST',body:payload});status.textContent=`補匯成功：${r.stores}店／${r.days}店日；相同內容不重複累加。原批次數量、核准及ERP保持不變。此次只補銷售，未補歷史庫存或成本。`;refresh?.();
 }catch(e){status.textContent=`補匯未完成：${e.message}；原批次未改動，可修正後重試。`;}finally{fields.forEach(f=>f.disabled=false);button.disabled=false;busy=false;}});
 reload();return{saveAutomatic};
}
globalThis.StoreTransferPerformanceImport={mount};})();

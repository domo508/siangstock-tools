// Feedback and navigation only. These helpers never submit forms or call an API.
export function createFlowFeedback(doc=document) {
 const areas={session:'cloud-status',master:'cloud-master-feedback',receipt:'cloud-receipt-status',incoming:'cloud-incoming-status',ai:'cloud-ai-status',review:'cloud-review-status',save:'cloud-save-status',settlement:'cloud-settlement-status',hq:'cloud-hq-status'};
 const anchors={session:'cloud-login',master:'cloud-master-zone',receipt:'cloud-receipt',incoming:'cloud-incoming-heading',ai:'cloud-ai-zone',review:'cloud-review',save:'cloud-save-zone',settlement:'cloud-settlement',hq:'cloud-hq',version:'version-warning'};
 const labels={'cloud-upload-zone':'選擇照片','cloud-master-tools':'更新商品查詢',version:'更新版本',session:'連線公司工具',master:'取得商品主檔',receipt:'上傳訂購單',incoming:'載入單據',ai:'辨識完整訂購單',review:'核對訂單',save:'保存公司雲端',settlement:'閉店結算',hq:'總部操作'};
 let last='session',active=null,next=null,pending=null;
 const get=id=>doc.getElementById(id);
 function areaFor(target){
  if(!target?.closest)return last;
  if(target.closest('#cloud-next-step'))return last;
  if(target.closest('#cloud-authorize,#cloud-master,#cloud-master-file,#cloud-master-tools'))return 'master';
  if(target.closest('#cloud-ai,#cloud-ai-consent'))return 'ai';
  if(target.closest('#cloud-save-zone'))return 'save';
  if(target.closest('#cloud-review'))return 'review';
  if(target.closest('#cloud-incoming,#cloud-queue,#cloud-batches'))return 'incoming';
  if(target.closest('#cloud-hq'))return 'hq';
  if(target.closest('#cloud-settlement'))return 'settlement';
  if(target.closest('#cloud-receipt'))return 'receipt';
  return 'session';
 }
 doc.addEventListener('click',e=>{last=areaFor(e.target);},true);
 doc.addEventListener('change',e=>{last=areaFor(e.target);},true);
 function target(area){if(area==='review')return doc.querySelector('#cloud-review .paper-review-sheet')||get(anchors.review);return get(anchors[area]||area);}
 function go(area){const el=target(area);if(!el||el.hidden)return;el.setAttribute('tabindex','-1');el.scrollIntoView({block:'start',behavior:'auto'});el.focus({preventScroll:true});}
 function guide(area,title,hint,{scroll=false,scrollTo=area}={}){
  next=area;get('cloud-next-step').hidden=false;get('cloud-next-title').textContent=title;get('cloud-next-hint').textContent=hint;
  const button=get('cloud-next-go');button.textContent='前往'+(labels[area]||'查看提示');button.hidden=!area;
  if(scroll)pending=scrollTo;
 }
 get('cloud-next-go').onclick=()=>{if(next)go(next);};
 function show(text,error=false,area=active?.area||last){
  const el=get(areas[area]||areas.session);el.hidden=false;el.textContent=text;el.className='notice '+(error?'danger':'success');
  if(active)active.messaged=true;
  if(error){const hints={master:'請查看主檔區的原因，重試雲端讀取；需要時再使用手動備援。',receipt:'請先檢查待收清單，確認沒有原圖後再重試，避免重複上傳。',incoming:'請查看此處原因，核對待收清單或原來的單據。',ai:'請查看按鈕旁的錯誤。再次辨識會另計費用，不會自動重送。',save:'請回到覆核欄位修正，保存成功前不代表已交接。',settlement:'請核對異常單與雲端結果；不要重複建立結算批次。'};
   guide(area,'這一步尚未完成',hints[area]||'請依此處錯誤提示修正後再操作。',{scroll:true});
   if(active)active.failed=true;
  }
 }
 function begin({area=last,working}={}){active={area,messaged:false,failed:false};pending=null;const el=get(areas[area]||areas.session);el.hidden=false;el.className='notice flow-working';el.textContent=working||`正在${labels[area]||'處理'}，請稍候…`;el.setAttribute('aria-busy','true');guide(area,'處理中',el.textContent);return active;}
 function finish(context){
  const el=get(areas[context.area]||areas.session);el?.removeAttribute('aria-busy');
  if(context.cancelled){show('已取消本次操作，沒有送出新的請求。',false,context.area);guide(context.area,'已取消操作','可查看目前內容，確定需要時再操作。');}
  if(!context.messaged&&!context.failed&&el?.classList.contains('flow-working')){el.textContent='操作已完成，請繼續下一步。';el.className='notice success';}
  if(get('cloud-next-title').textContent==='處理中')guide(context.area,'這一步已完成','結果已顯示在目前步驟，請核對後繼續操作。');
  const destination=pending||areas[context.area];pending=null;active=null;if(destination)go(destination);
 }
 function failure(error,blocked){show(error.message||'操作尚未確認完成',true);if(/公司登入|請先連線|登入權限已到期|需要公司登入/.test(error.message||''))guide('session','下一步：重新連線公司工具','登入狀態尚未確認，請重新連線後回到原步驟。',{scroll:true});else if(/請先保存目前|請先保存.*草稿/.test(error.message||''))guide('save','下一步：先保存目前單據','目前內容尚未保存，請先核對並保存，再切換其他單據。',{scroll:true});else if(/門市.*未授權|此門市未授權/.test(error.message||''))guide('receipt','請確認門市權限','請選擇已授權門市；需要其他門市時請由總部設定。',{scroll:true});if(blocked)guide('version','請重新載入最新版','目前操作已停止，請先更新版本。',{scroll:true});}
 return {begin,finish,show,guide,failure,go};
}

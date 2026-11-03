// Shared by the real cloud page and the synthetic preview. No automatic removal.
export function createSourceRemovalUI({container,api,canChange,canRestore,inDraft,setBusy,afterChange,notice}){
 const doc=container.ownerDocument,node=(tag,text,cls)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const details=node('details',undefined,'source-removed-tools'),summary=node('summary','已移除照片／操作未完成'),list=node('div'),listStatus=node('p'),help=node('p','總部可在此核對重複照片與原檔已移走的來源；停用舊來源不會刪除或搬動雲端原檔。請勿直接從Drive刪除待收原圖。'),reload=node('button','更新移除紀錄與來源異常','secondary');reload.type='button';listStatus.setAttribute('role','status');details.append(summary,help,reload,listStatus,list);container.after(details);
 const dialog=node('dialog',undefined,'source-removal-dialog');dialog.setAttribute('aria-labelledby','source-remove-title');
 const title=node('h2');title.id='source-remove-title';const description=node('p'),identity=node('p',undefined,'source-remove-identity'),reasonLabel=node('label','原因（必填）'),reason=node('textarea');reason.rows=3;reason.maxLength=200;reason.placeholder='例如：誤傳、重複上傳或本張測試不再使用。請勿填客戶個資。';reasonLabel.append(reason);
 const checkLabel=node('label',undefined,'check'),check=node('input');check.type='checkbox';const checkText=node('span');checkLabel.append(check,checkText);
 const status=node('p');status.setAttribute('role','alert');const actions=node('div',undefined,'source-remove-actions'),cancel=node('button','保留照片','secondary'),confirm=node('button','確認移除','source-remove-confirm');cancel.type=confirm.type='button';actions.append(cancel,confirm);dialog.append(title,description,identity,reasonLabel,checkLabel,status,actions);doc.body.append(dialog);
 let selected=null,working=false,op=null,origin=null,refreshing=false;
 function controls(){confirm.disabled=working||!selected||!check.checked||(!selected.operationId&&!reason.value.trim())||!canChange();cancel.disabled=working;reason.disabled=working||!!selected?.operationId;check.disabled=working;}
 reason.oninput=check.onchange=controls;
 function close(){if(working)return;dialog.close();origin?.focus();selected=null;op=null;}
 cancel.onclick=close;dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
 function open(item,action,button){if(!canChange())return;origin=button;selected={...item,action};op=item.operationId||crypto.randomUUID();title.textContent=action==='restore'?'復原待收照片？':'移除這張待收照片？';identity.textContent=item.label||`照片識別：${item.fileId.slice(-8)}`;
  description.textContent=action==='restore'?'復原後會回到原門市的待收清單，可能再次阻擋日結。請確認仍需處理這張照片。':'原圖會移至總部可復原區，完成後不再出現在待收清單，也不再阻擋日結。這不會作廢任何已保存訂單。';
  if(item.recordOnly){title.textContent=action==='restore'?'重新啟用舊來源？':'停用原檔已移走的來源？';description.textContent=action==='restore'?'請先將同一份原圖放回本店待處理資料夾。系統會核對內容及權限；不會自動從垃圾桶還原或搬動其他位置的檔案。':'系統將再次確認原圖已不在本店待處理資料夾，只停用舊來源紀錄、保留原因，不會刪除或搬動原檔。停用後可重新匯入同檔案。';}
  if(item.duplicate&&!item.recordOnly)description.textContent+=' 本張為重傳副本，只處理這個副本，不改動原來源或已保存訂單。';
  if(inDraft(item.fileId))description.textContent+=' 此照片屬於目前未保存草稿；移除成功後將放棄這份草稿，其餘原圖仍保留。';
  checkText.textContent=action==='restore'?'我已確認要將這張照片恢復為待收。':'我已確認這張照片可移除；若仍是有效訂單，應保留並完成覆核。';
  reason.value='';reasonLabel.hidden=!!item.operationId;check.checked=false;status.textContent='';if(item.recordOnly)checkText.textContent=action==='restore'?'我已將同一份原圖放回本店待處理資料夾，同意核對後重新啟用。':'我已核對原檔位置，確認停用這筆舊來源紀錄。';confirm.textContent=item.operationId?'重試原操作':action==='restore'?'確認復原':'確認移除';if(item.recordOnly&&!item.operationId)confirm.textContent=action==='restore'?'確認重新啟用':'確認停用舊來源';cancel.textContent=item.recordOnly?'暫不處理':action==='restore'?'暫不復原':'保留照片';controls();dialog.showModal();reasonLabel.hidden?check.focus():reason.focus();
 }
 confirm.onclick=async()=>{
  if(confirm.disabled||!selected)return;const item=selected;working=true;setBusy(true);controls();status.textContent=item.action==='restore'?'正在復原並確認存取權限…':'正在移至可復原區並確認存取權限…';
  try{
   const result=await api('/source-actions','POST',{storeCode:container.dataset.storeCode||'R14',fileId:item.fileId,action:item.action,operationId:op,expectedVersion:item.expectedVersion??item.sourceVersion??item.version??0,confirmed:true,recordOnly:!!item.recordOnly,...(!item.operationId?{reason:reason.value.trim()}:{})});
   if(result.completed!==true)throw Error('操作尚未確認完成，請更新清單查看紀錄');
   dialog.close();selected=null;op=null;details.open=true;
   try{await afterChange(item.fileId,item.action);}catch{notice('照片操作已完成，但清單更新未完成，請手動檢查新單。',true);return;}
   const text=item.recordOnly?(item.action==='restore'?'舊來源已重新啟用，請重新開啟處理。':'舊來源已停用，原檔未被移動或刪除；可重新匯入同檔案。'):item.action==='restore'?'照片已復原至待收清單，請重新開啟處理。':'照片已移除並保留可復原紀錄；已保存訂單保持原樣。';notice(text,false);listStatus.textContent=text;
  }catch(e){status.textContent=e.message||'尚未確認成功，請保留原圖並更新清單';status.className='notice danger';notice(status.textContent,true);}
  finally{working=false;setBusy(false);controls();await refresh();}
 };
 async function refresh(){if(!details.open||refreshing)return;refreshing=true;try{const data=await api('/source-actions?store='+encodeURIComponent(container.dataset.storeCode||'R14'));list.replaceChildren();for(const item of data.records){const row=node('div',undefined,'item'),missing=item.state==='missing',phase=missing?'原檔不在待處理資料夾，尚未停用':item.state==='removed'?(item.recordOnly?'舊來源已停用，原檔未搬動':'已移除，可由總部復原'):'操作未完成，不代表已移除';row.append(node('strong',phase),node('p',`來源識別：${item.fileId.slice(-8)}｜${new Date(item.updatedAt).toLocaleString('zh-TW')}`));if(item.state!=='removed'||canRestore()){const b=node('button',missing?'核對並停用舊來源':item.state==='removed'?(item.recordOnly?'原檔放回後重新啟用':'復原至待收清單'):'重試原操作','secondary');b.type='button';b.onclick=()=>open(item,missing?'remove':item.state==='removed'?'restore':item.action,b);if(item.state==='removed')b.onclick=()=>open({fileId:item.fileId,version:item.version,recordOnly:item.recordOnly},'restore',b);row.append(b);}else row.append(node('p','需要復原時，請聯絡總部。'));list.append(row);}if(!data.records.length)list.append(node('p','目前沒有已移除或未完成的操作。'));}catch(e){listStatus.textContent='移除紀錄讀取失敗：'+e.message;listStatus.className='notice danger';}finally{refreshing=false;}}
 reload.onclick=()=>void refresh();
 details.addEventListener('toggle',()=>{if(details.open)void refresh();});
 return {button(file,label){const b=node('button','移除待收照片','source-remove-button');b.type='button';b.disabled=!!file.duplicate&&!canRestore();b.setAttribute('aria-label','移除'+label);b.onclick=()=>open({fileId:file.id,sourceVersion:file.sourceVersion||0,label,duplicate:file.duplicate},'remove',b);return b;},refresh,dialog};
}

// No image, token or customer content is persisted. Reuse an operation only within this tab.
export function createSourceUploader({api,upload}) {
 const attempts=new Map();
 async function send(file,storeCode,progress=()=>{}) {
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
  const key=storeCode+':'+file.type+':'+[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
  for(const [k,v] of attempts)if(v.expires<Date.now())attempts.delete(k);
  if(!attempts.has(key)){if(attempts.size>=100)throw Error('本分頁上傳筆數已達上限，請先核對新單再重新開啟');attempts.set(key,{operationId:crypto.randomUUID(),expires:Date.now()+7200000});}
  const body={storeCode,mimeType:file.type,size:file.size,operationId:attempts.get(key).operationId};
  progress('建立雲端上傳');
  const session=await api('/upload-session','POST',body);
  if(!session.completed){
   progress('傳送原圖');
   // A lost/CORS-blocked response may follow a successful PUT. Never resend blindly.
   try{await upload(file,session);}catch{/* Company-side confirmation below is authoritative. */}
  }
  progress('確認雲端存檔');
  let confirmed;
  try{confirmed=await api('/upload-confirm','POST',body);}catch(e){if(e.status)throw e;throw Error('無法連線確認雲端存檔，請先按「立即檢查新單」，勿重複上傳');}
  if(!confirmed.completed||!confirmed.fileId)throw Error('尚未確認原圖完整上傳；請先按「立即檢查新單」。若無此圖，再選同一檔案重試');
  return confirmed;
 }
 return {send,clear:()=>attempts.clear()};
}

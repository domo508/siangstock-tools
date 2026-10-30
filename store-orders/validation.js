import {createPOSProfile} from './pos-profile.js?v=20261031-store-orders-r27';
import {prepareImageInput} from './image-input.js?v=20261031-store-orders-r27';
import {createReview} from './review.js?v=20261031-store-orders-r27';
import * as C from './core.js?v=20261031-store-orders-r27';
import {VersionGuard} from './runtime.js?v=20261031-store-orders-r27';
import {validateExtraction} from './recognition.js?v=20261031-store-orders-r27';
const $=id=>document.getElementById(id),guard=new VersionGuard();
let master=null,image=null,prepared=null,raw=null,recognition=null,config=null,busy=false,profileUI=null;
const context=()=>({existingNumbers:$('existing-numbers').value.split(/[,，、\s]+/).filter(Boolean),expectedStore:$('expected-store').value.trim().toUpperCase()});
const review=createReview($('paper-review'),{requireVersion:async()=>{try{await guard.require();}finally{controls();}},exportProfile:()=>profileUI?.get()||{},context});
profileUI=createPOSProfile($('pos-template-panel'),{requireVersion:()=>guard.require(),onChange:()=>review.refresh(),allowLegacy:false});
function status(message,error=false){$('status').textContent=message;$('status').className=error?'error':'success';}
function controls(){const blocked=guard.blocked||busy;profileUI?.setBlocked(blocked);for(const id of ['master','image','crop','synthetic-confirmed','expected-store','existing-numbers'])$(id).disabled=blocked;$('recognize').disabled=blocked||!prepared||!$('synthetic-confirmed').checked||!config?.ready;$('version-warning').hidden=!guard.blocked;if(blocked)$('paper-review').querySelectorAll('[data-export]').forEach(b=>b.disabled=true);else review.refresh();}
async function run(work){if(busy)return;busy=true;controls();try{await guard.require();await work();}catch(e){status(e.message,true);}finally{busy=false;controls();}}
function render(){if(raw)review.update(raw,master,prepared?.preview||'',recognition);}
function clear(){prepared=null;raw=null;recognition=null;review.clear();$('synthetic-confirmed').checked=false;$('crop-preview').hidden=true;$('crop-preview').removeAttribute('src');controls();}
$('master').onchange=()=>run(async()=>{const file=$('master').files[0];if(!file)return;const next=C.parseMaster(XLSX.read(await file.arrayBuffer(),C.READ_OPTIONS),XLSX,`validation:${Date.now()}`);await guard.require();master=next;$('master-status').textContent=`已載入 ${master.count} 個貨號，主檔只在本機比對`;render();});
$('image').onchange=()=>run(async()=>{clear();image?.close();image=null;const file=$('image').files[0];if(!file)return;if(!['image/jpeg','image/png'].includes(file.type)||file.size>20000000)throw Error('請選20MB內JPEG或PNG');const next=await createImageBitmap(file);if(next.width*next.height>40000000){next.close();throw Error('圖片尺寸過大，請縮小');}await guard.require();image=next;status('照片已在本機開啟，請產生完整預覽；尚未傳出');});
$('crop').onclick=()=>run(()=>{if(!image)throw Error('請先選照片');clear();prepared=prepareImageInput(image,{left:0,right:100,top:0,bottom:100,full:true});$('crop-preview').src=prepared.preview;$('crop-preview').hidden=false;status('已準備完整單與3張重疊細節圖，請檢查預覽並確認全為虛構個資，再送出辨識。');});
$('synthetic-confirmed').onchange=controls;
for(const id of ['expected-store','existing-numbers'])$(id).oninput=()=>review.refresh();
$('recognize').onclick=()=>run(async()=>{if(!prepared||!$('synthetic-confirmed').checked)throw Error('請先檢查完整單預覽並確認資料授權');raw=null;recognition=null;review.clear();status('正在辨識完整訂購單，請勿重複操作…');const response=await fetch('/api/store-orders-validation/recognize',{method:'POST',headers:{'Content-Type':'application/json','X-Store-Orders-Version':C.VERSION},body:JSON.stringify({image:prepared.image,detailImages:prepared.detailImages,mode:'full',syntheticHeaderConfirmed:true})});const data=await response.json();await guard.require();if(!response.ok)throw Error(data.error||'辨識失敗');const extraction=validateExtraction(data.extraction);if(!extraction.header)throw Error('完整單辨識缺少表頭，請重新辨識');raw=extraction;recognition=data.recognition||null;render();status('辨識完成，請對照原圖修正，核對後勾選整單確認並下載POS。');});
$('reload-version').onclick=()=>location.assign(`/store-orders/validation.html?deploy=${encodeURIComponent(guard.current||C.VERSION)}&reload=${Date.now()}`);
async function update(){await guard.check();controls();}window.addEventListener('focus',update);setInterval(update,60000);
await update();try{const r=await fetch('/api/store-orders-validation/config',{cache:'no-store'});if(r.ok){const value=await r.json();if(value.version===C.VERSION)config=value;}}catch{/* Fail closed without the local recognition service. */}
$('api-status').textContent=config?.ready?`辨識服務已就緒（${config.model}）；只在按下辨識後傳送圖片。`:'辨識服務尚未就緒；請確認本機伺服器與金鑰設定。尚可載入主檔及預覽照片。';controls();

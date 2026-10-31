import * as C from './core.js?v=20261031-store-orders-r36';
import {readPOSTemplate,revisedPOSErrors} from './pos-template.js?v=20261031-store-orders-r36';
export function createPOSProfile(root,{requireVersion,onChange=()=>{},allowLegacy=true}){
 let template=null,reading=false,blocked=false;
 root.innerHTML='<h3>ERP匯入格式</h3><label>匯出格式<select id="pos-format"><option value="latest">新版POS（依工程師最終範本）</option><option value="legacy">舊版21欄（僅歷史回歸測試）</option></select></label><div id="pos-latest"><label>最終POS範本（只在本機讀取，不採用範例訂單）<input id="pos-template-file" type="file" accept=".xlsx,.xls"></label><p>新版依範本放入姓名、電話、地址；下載檔含個資，請妥善保管。原始範本不會被修改或上傳。同單共用資訊與付款欄垂直合併，取貨倉庫不同時分開保留；商品欄逐列保留。</p><label class="check"><input id="pos-payment-confirmed" type="checkbox" checked>已確認付款對照（如需變更請先取消勾選）：中信信用卡、現金、百貨現金卷、LinePay</label></div><p id="pos-template-status" role="status"></p>';
 if(!allowLegacy){root.querySelector('option[value=legacy]').remove();root.querySelector('#pos-format').closest('label').hidden=true;}
 const $=id=>root.querySelector('#'+id),get=()=>$('pos-format').value==='legacy'?null:{template:reading?null:template,paymentMappingConfirmed:$('pos-payment-confirmed').checked};
 function sync(){const p=get();$('pos-latest').hidden=!p;$('pos-template-status').textContent=!p?'目前為舊版21欄測試檔，不含成交單價；不代表新版格式。':reading?'正在檢查範本…':template?`已讀取${template.headers.length}欄；${template.priceHeader?'單價欄：'+template.priceHeader:'缺少單價欄，暫不可產檔'}。${revisedPOSErrors([],p).join('；')}`:'請載入工程師的最終範本；R欄為價格，共25欄。';setBlocked(blocked);onChange();}
 function setBlocked(value){blocked=value;for(const el of root.querySelectorAll('input,select'))el.disabled=blocked||reading;}
 $('pos-format').onchange=sync;$('pos-payment-confirmed').onchange=sync;
 $('pos-template-file').onchange=async()=>{template=null;reading=true;sync();try{await requireVersion();const f=$('pos-template-file').files[0];if(!f||f.size>5000000)throw Error('請選5MB內的POS範本');const wb=XLSX.read(await f.arrayBuffer(),C.READ_OPTIONS);await requireVersion();template=readPOSTemplate(wb,XLSX);}catch(e){reading=false;sync();$('pos-template-status').textContent=e.message;return;}reading=false;sync();};
 $('pos-template-status').textContent='請載入含單價的最終範本；最終格式共25欄，R欄為價格。';
 return {get,setBlocked};
}

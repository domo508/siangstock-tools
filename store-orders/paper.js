import { STORES, taipeiDate } from "./core.js?v=20261030-store-orders-r24";
import { VersionGuard } from "./runtime.js?v=20261030-store-orders-r24";
const $=id=>document.getElementById(id),guard=new VersionGuard();
for(const [code,name] of Object.entries({...STORES,R14:STORES.R14||""})){const option=document.createElement("option");option.value=code;option.textContent=`${code} ${name}`;$("paper-store").append(option);}
$("paper-store").value="R14";
function serial(){ $("serial").textContent=`${$("paper-store").value}-${taipeiDate().replaceAll("-","")}-${crypto.randomUUID().replaceAll("-","")}`;$("store-name").textContent=`${$("paper-store").value} ${STORES[$("paper-store").value]||""}`; }
for(let i=0;i<14;i++){const row=document.createElement("tr");for(let c=0;c<6;c++){const cell=document.createElement("td");if(c===5)cell.textContent="□銷貨 □訂貨";row.append(cell);}$("paper-lines").append(row);}
async function checked(work){try{await guard.require();work();}catch(e){$("paper-warning").textContent=e.message;$("paper-reload").hidden=false;}}
$("paper-store").onchange=()=>checked(serial);$("next").onclick=()=>checked(serial);$("print").onclick=()=>checked(()=>window.print());serial();

$("paper-reload").onclick=()=>location.assign(`/store-orders/paper.html?deploy=${encodeURIComponent(guard.current)}&reload=${Date.now()}`);

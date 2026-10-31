import {allocateBundle} from "./bundle-pricing.js?v=20261031-store-orders-r30";
import {createPOSProfile} from "./pos-profile.js?v=20261031-store-orders-r30";
import {buildRevisedPOS,revisedPOSErrors,TEMPLATE_WRITE_OPTIONS} from "./pos-template.js?v=20261031-store-orders-r30";
import {validateExtraction,extractionOrder} from "./recognition.js?v=20261031-store-orders-r30";
import * as C from "./core.js?v=20261031-store-orders-r30";
import { VersionGuard } from "./runtime.js?v=20261031-store-orders-r30";
import * as G from "./google.js?v=20261031-store-orders-r30";
import { pagesFor, recognize } from "./media.js?v=20261031-store-orders-r30";
const $ = id => document.getElementById(id), guard = new VersionGuard();
const state = { mode: "disconnected", session: null, master: null, current: null, orders: [], local: new Map(), pages: new Map(), previews: [], dirty: false, busy: false, settlement: null };
const profileUI=createPOSProfile($("pos-template-panel"),{requireVersion:()=>guard.require(),onChange:()=>controls()});
const recoveryKey = () => `store-orders:${state.session?.email || "local-demo"}`;
function message(value, error = false) { $("activity").textContent = value; $("activity").className = error ? "error" : "success"; }
function element(tag, value, className) { const e = document.createElement(tag); if (value !== undefined) e.textContent = value; if (className) e.className = className; return e; }
function money(cents) { return (cents / 100).toLocaleString("zh-TW", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
async function run(work) {
  if (state.busy) return;
  state.busy = true;
  document.querySelector("main").inert = true;
  try { await guard.require(); await work(); }
  catch (e) { message(e.message || "操作未完成，請重試", true); }
  finally { state.busy = false; document.querySelector("main").inert = false; await updateVersion(); controls(); }
}
async function api(path, method = "GET", body) {
  if (state.mode !== "cloud") throw Error("目前是本機模式，不能執行雲端交接");
  const r = await fetch(`/api/store-orders${path}`, { method, cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Store-Orders-Version": C.VERSION }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!(r.headers.get("Content-Type") || "").includes("application/json")) throw Error("公司登入已過期或API尚未啟用，請重新連線公司工具");
  const data = await r.json(); if (!r.ok) {const error=Error(data.error || "雲端操作未完成");error.code=data.code;throw error;} return data;
}
async function updateVersion() { const valid = await guard.check(); $("version-warning").hidden = valid; return valid; }
function controls() {
  const ready = state.mode !== "disconnected" && !guard.blocked && !state.busy, cloud = state.mode === "cloud", hq = state.session?.role === "hq" || state.mode === "demo";
  for (const id of ["scan", "new-order", "settle"]) $(id).disabled = !ready;
  $("authorize").disabled = !cloud || state.busy; $("master-cloud").disabled = !ready || !cloud;
  $("recognition-file").disabled = !ready || state.mode!=="demo"; $("capture").disabled = !ready; $("store").disabled = state.busy; $("store-other").disabled = state.busy; $("date").disabled = state.busy;
  $("save").disabled = !ready || !state.current || !!state.current.batchId;
  profileUI.setBlocked(guard.blocked||state.busy);
  $("export-test").disabled = !!(profileUI.get()&&revisedPOSErrors(state.current?[state.current]:[],profileUI.get()).length) || !ready || !hq || !state.current || !["settled", "import_failed"].includes(state.current.status);
  $("save-result").disabled = !ready || !hq || !state.current || !["exported", "import_unknown", "import_failed"].includes(state.current.status);
  $("retention").hidden = !cloud || !hq;
  $("correct").hidden = !cloud || !hq || !state.current?.batchId || !["settled", "import_failed"].includes(state.current?.status);
  $("retry-settle").hidden = !state.settlement || !cloud;
  $("order-status").disabled = !!state.current?.batchId;
  $("order-form").inert=!!state.current?.batchId && !(cloud && hq && ["settled","import_failed"].includes(state.current.status));
}
function remember() {
  if (!state.current || !state.dirty) return;
  try { sessionStorage.setItem(recoveryKey(), JSON.stringify({ expires: Date.now() + 2*3600000, order: state.current })); } catch { message("分頁草稿無法暫存，請盡快保存至公司雲端", true); }
}
function clearPreview() { state.previews.forEach(URL.revokeObjectURL); state.previews = []; $("previews").replaceChildren(); }
function renderPreviews(order) {
  clearPreview(); $("ocr-text").value = "";
  for (const source of order.sources) {
    const pages = state.pages.get(source.fileId) || [];
    if (!pages.length) { const b = element("button", "載入來源原圖", "secondary"); b.type = "button"; b.onclick = () => run(async()=>{ const blob = await G.download(source.fileId); state.pages.set(source.fileId, await pagesFor(blob)); renderPreviews(order); }); $("previews").append(b); }
    for (let i=0;i<pages.length;i++) { const url = URL.createObjectURL(pages[i]); state.previews.push(url); const img = element("img"); img.src = url; img.alt = `來源原圖第${i+1}頁`; img.className = "preview-image"; $("previews").append(img); }
  }
}
function markDirty() { state.dirty = true; if (state.current) state.current.reviewed = false; $("reviewed").checked = false; remember(); updateTotals(); }
function updateTotals() {
  const o = state.current; if (!o) return;
  try { const t=C.totals(o); $("totals").textContent=`${t.rows}列／${t.quantity}件・成交 ${money(t.amountCents)} 元・已收 ${money(t.paidCents)} 元・未收 ${money(t.unpaidCents)} 元`; }
  catch { $("totals").textContent = "請補齊各列有效數量、成交單價及收款"; }
  const v=C.validateOrder(o,{complete:true}); $("validation").replaceChildren();
  for(const warning of v.warnings) $("validation").append(element("p",warning,"warning"));
  for(const error of v.errors) $("validation").append(element("p",error,"error"));
}
function itemMatch(item) {
  if(state.master && state.current) state.current.masterVersion=state.master.version;
  const match=C.matchProduct(state.master,item.sku); item.matchStatus=match.status; item.manualConfirmed=false;
  for(const key of ["name","color","size","colorCode","sizeCode"]) item[key]="";
  item.discontinued=false;item.costSnapshot=null;
  item.nameHintAcknowledged=false;
  if(match.status === "unique") Object.assign(item,C.applyProduct(item,match.matches[0]));
}
function reverseFill(item) {
  const found=C.reverseProduct(state.master,item);
  if(found.status === "unique") {Object.assign(item,C.applyReverseProduct(item,found.matches[0]));state.current.masterVersion=state.master.version;message("已由品名與規格唯一反查帶入貨號，請勾選核對確認");}
  else if(!C.text(item.sku))message(found.status === "ambiguous" ? "品名有多個候選，請補規格或人工選定" : "品名不足或沒有唯一對應，請補規格或人工查找",true);
}
function renderGroups() {
  $("price-groups").replaceChildren();
  for(const group of state.current.priceGroups||[]) {
    const box=element("div"),rows=state.current.items.flatMap((item,index)=>item.priceGroupId===group.id?[index+1]:[]);
    box.append(element("p",`組合 ${group.id}：第 ${rows.join("、")} 列，整組 ${group.amount} 元（只計一次）`,"warning"));
    const allocation=element("p");const showAllocation=()=>{if(group.pricingMode!=="total_only")return;try{const a=allocateBundle(state.current,group);allocation.textContent="ERP整元拆價："+a.lines.map(l=>`第${l.index+1}列 ${l.quantity}件×${l.unitPrice}元＝${l.amountCents/100}元`).join("；")+"；合計"+a.amountCents/100+"元。";allocation.className="notice";}catch(e){allocation.textContent="ERP自動拆價待處理："+e.message;allocation.className="warning";}};showAllocation();box.append(allocation);
    if(group.pricingMode === "total_only"){const label=element("label","整組總金額（只填總價，ERP自動拆價）"),input=element("input");input.type="number";input.min="0";input.step="0.01";input.value=group.amount;input.oninput=()=>{group.amount=input.value;group.totalConfirmed=false;markDirty();showAllocation();};label.append(input);box.append(label);}else {const label=element("label","已確認各列成交價分配，且合計等於整組金額","check"),input=element("input");input.type="checkbox";input.checked=group.allocationConfirmed===true;input.onchange=()=>{group.allocationConfirmed=input.checked;markDirty();};label.prepend(input);box.append(label);}
    const remove=element("button","移除此組合設定","secondary");remove.type="button";remove.onclick=()=>{state.current.items.forEach(item=>{if(item.priceGroupId===group.id)delete item.priceGroupId;});state.current.priceGroups=state.current.priceGroups.filter(g=>g!==group);markDirty();renderItems();};box.append(remove);$("price-groups").append(box);
  }
}
$("add-price-group").onclick=()=>run(()=>{
  if(!state.current)throw Error("請先建立訂單");const values=$("group-rows").value.split(/[,，、\s]+/).filter(Boolean),rows=values.map(Number);
  if(rows.length<2||new Set(rows).size!==rows.length||rows.some(n=>!Number.isSafeInteger(n)||n<1||n>state.current.items.length))throw Error("請填兩個以上不重複且存在的商品列號");
  C.cents($("group-amount").value);if(rows.some(n=>state.current.items[n-1].priceGroupId))throw Error("商品列已屬其他組合，請先移除原組合設定");
  const id=crypto.randomUUID();state.current.priceGroups??=[];state.current.priceGroups.push({id,amount:$("group-amount").value,pricingMode:"total_only",totalConfirmed:false});rows.forEach(n=>{state.current.items[n-1].priceGroupId=id;state.current.items[n-1].unitPrice="";});$("group-rows").value="";$("group-amount").value="";markDirty();renderItems();
});
function renderItems() {
  $("items").replaceChildren();
  state.current.items.forEach((item,index)=>{
    const node=$("item-template").content.firstElementChild.cloneNode(true); node.querySelector("legend").textContent=`商品 ${index+1}`;
    const nameHint=()=>{const reference=C.nameReference(item.name,item.paperName);node.querySelector('[data-role="name-reference"]').textContent=reference.message;node.querySelector('[data-role="name-confirm"]').hidden=!reference.conflict;};
    for(const input of node.querySelectorAll("[data-key]")) {
      const key=input.dataset.key; if(input.type === "checkbox") input.checked=!!item[key]; else input.value=item[key] ?? "";if(key==="unitPrice"&&C.totalOnlyGroup(state.current,item)){input.disabled=true;input.placeholder="採整組總價";}
      input.addEventListener("input",()=>{
        item[key]=input.type === "checkbox" ? input.checked : key === "quantity" ? (input.value === "" ? null : Number(input.value)) : input.value;
        if(["name","color","size"].includes(key)) { item.matchStatus="manual"; item.manualConfirmed=false; node.querySelector('[data-key="manualConfirmed"]').checked=false; }
        if(["paperName","sku","name"].includes(key)){item.nameHintAcknowledged=false;node.querySelector('[data-key="nameHintAcknowledged"]').checked=false;}
        if(key === "paperName" && item.matchStatus === "name_auto") {item.sku="";itemMatch(item);}
        if(["quantity","unitPrice"].includes(key)&&item.priceGroupId){const group=state.current.priceGroups?.find(g=>g.id===item.priceGroupId);if(group)group.allocationConfirmed=false;renderGroups();}
        nameHint();
        markDirty();
        try { node.querySelector('[data-role="subtotal"]').textContent=`小計 ${money(item.quantity*C.cents(item.unitPrice))} 元`; } catch { node.querySelector('[data-role="subtotal"]').textContent="請補齊數量與成交單價"; }
      });
      if(key === "paperName")input.addEventListener("change",()=>{if(!C.text(item.sku)&&!guard.blocked){reverseFill(item);markDirty();if(item.matchStatus==="name_auto")renderItems();}});
      if(key === "sku") input.addEventListener("change",()=>{ item.sku=C.text(item.sku).toUpperCase(); itemMatch(item); markDirty(); renderItems(); });
    }
    const status=item.matchStatus === "unique" ? "主檔唯一命中" : item.matchStatus === "ambiguous" ? "同貨號有多筆規格，請人工確認" : "商品未唯一命中，請補齊資料並人工確認";
    node.querySelector('[data-role="match"]').textContent=`${status}${item.discontinued ? "・停用品，只提醒不阻擋" : ""}`;
    if(item.matchStatus === "selected")node.querySelector('[data-role="match"]').textContent="已人工選定主檔商品，請再核對數量、成交單價與銷別";
    node.querySelector('[data-role="recognition-confirm"]').hidden=true;
    node.querySelector('[data-role="reverse-confirm"]').hidden=item.matchStatus!=="name_auto";
    if(item.matchStatus === "name_auto")node.querySelector('[data-role="match"]').textContent="品名與規格唯一反查，自動帶入貨號；請核對確認";
    nameHint();
    if(C.totalOnlyGroup(state.current,item))node.querySelector('[data-key="zeroConfirmed"]').closest("label").hidden=true;
    node.querySelector('[data-action="search"]').onclick=()=>run(()=>{
      const container=node.querySelector('[data-role="candidates"]');container.replaceChildren();
      if(!state.master){container.append(element("p","請先載入商品主檔；找不到時仍可人工輸入並確認。","warning"));return;}
      const candidates=C.searchProducts(state.master,item.paperName||item.sku);
      if(!candidates.length){container.append(element("p","沒有合適候選，請補充簡寫品名或規格；不會自動換品。","warning"));return;}
      container.append(element("p","以下僅為搜尋候選，需人工選定；不以品名相似度自動配對。","muted"));
      for(const product of candidates){const button=element("button",`${product.sku}｜${product.name}｜${product.color||"缺顏色"}｜${product.size||"缺尺碼"}${product.discontinued?"（停用品）":""}`,"secondary");button.type="button";button.onclick=()=>run(()=>{Object.assign(item,C.applyProduct(item,product,{manual:true}));state.current.masterVersion=state.master.version;markDirty();renderItems();});container.append(button);}
    });
    try { node.querySelector('[data-role="subtotal"]').textContent=`小計 ${money(item.quantity*C.cents(item.unitPrice))} 元`; } catch { if(C.totalOnlyGroup(state.current,item))node.querySelector('[data-role="subtotal"]').textContent="金額含於整組總價，不另拆分"; }
    node.querySelector('[data-action="remove"]').onclick=()=>{ if(item.priceGroupId){message("請先移除此列所屬組合設定，再移除商品",true);return;}state.current.items.splice(index,1); markDirty(); renderItems(); };
    $("items").append(node);
  }); renderGroups(); updateTotals();
}
function renderOrder(order) {
  state.current=order; $("workspace").hidden=false; $("empty-workspace").hidden=true;
  $("order-title").textContent=`${C.STATUS[order.status] || order.status}・版本 ${order.version}${state.mode === "demo" ? "（本機測試）" : ""}`;
  const bindings={"paper-number":"paperNumber","order-date":"businessDate",clerk:"clerk","page-count":"pageCount","paper-rows":"paperRowCount",note:"note",unpaid:"unpaid","paper-total":"paperTotal","exception-reason":"exceptionReason"};
  for(const [id,key] of Object.entries(bindings)) $(id).value=order[key] ?? "";
  for(const key of ["name","phone","address"]) $(`customer-${key}`).value=order.customer[key] || "";
  $("reviewed").checked=!!order.reviewed;
  $("erp-number").value=order.erpNumber || "";$("erp-reason").value="";
  $("erp-result").value=["import_unknown","import_failed","erp_created"].includes(order.status)?order.status:"import_unknown";
  $("order-status").value=["pending","reviewed","needs_info","cancelled"].includes(order.status) ? order.status : "reviewed";
  for(const key of C.PAYMENTS) document.querySelector(`[data-payment="${key}"]`).value=order.payments[key] ?? 0;
  $("source-page-label").hidden=!order.headerRecognition;$("source-page").value=order.headerRecognition?.pageNumber??"";
  $("header-recognition-confirm").hidden=!order.headerRecognition;$("header-recognition-confirmed").checked=order.headerRecognition?.confirmed===true;$("header-recognition-note").textContent=order.headerRecognition?`完整測試單辨識：原日期 ${order.headerRecognition.rawDate||"未讀出"}，頁碼 ${order.headerRecognition.pageNumber??"未讀出"}；疑義欄位：${order.headerRecognition.uncertainFields.join("、")||"無標示，仍須核對"}`:"";
  renderPreviews(order); renderItems(); controls();
}
function newBlank() { if(state.dirty) throw Error("目前有未保存修改，請先保存"); state.dirty=false; renderOrder(C.newOrder(crypto.randomUUID(),selectedStore(),$("date").value)); }
async function refresh() {
  if(state.mode === "demo") { state.orders=[...state.local.values()].filter(o=>o.storeCode === selectedStore() && o.businessDate === $("date").value); renderQueue(); return; }
  const query=new URLSearchParams({store:selectedStore(),date:$("date").value});
  const data=await api(`/queue?${query}`); state.orders=data.orders; renderQueue();
  $("batches").replaceChildren(...data.batches.map(b=>element("p",`${b.previous_batch_id ? "補交" : "結算"}批次 ${b.id}・${b.status === "settled" ? "交接完成" : b.status === "aborted" ? "未交接，請重新核對後結算" : "尚未完成，需重試"}`)));
  if(state.session.role === "hq") {const attention=await api("/attention");for(const o of attention.orders)$("batches").append(element("p",`逾30天待辦：${o.store_code}／${o.business_date}／${o.id}・${C.STATUS[o.status]}`,"warning"));if(attention.maintenance?.event === "retention_failed")$("batches").append(element("p","最近一次到期回收未完成，請總部檢查雲端權限後手動重試。","warning"));}
  const scanned=await api(`/scan?store=${encodeURIComponent(selectedStore())}`);
  $("incoming").replaceChildren();
  for(const f of scanned.files) {
    const row=element("div",undefined,"queue-row"), label=element("span",`${C.taipeiDate(f.createdTime)} 上傳・${f.mimeType}・${f.orderId ? "已建立訂單" : "待收單"}`);
    const add=element("button",f.orderId ? "開啟訂單" : "建立新單","secondary"); add.onclick=()=>run(async()=>{ if(state.dirty) throw Error("請先保存目前修改"); if(f.orderId) await loadOrder(f.orderId); else await importSource(f,false); }); row.append(label,add);
    if(!f.orderId && state.current && !state.current.batchId) { const attach=element("button","併入目前單（續頁）","secondary"); attach.onclick=()=>run(()=>importSource(f,true)); row.append(attach); }
    $("incoming").append(row);
  }
  if(!scanned.files.length) $("incoming").append(element("p","目前沒有待處理原圖","muted"));
}
function renderQueue() {
  $("queue").replaceChildren();
  for(const o of state.orders) {
    const row=element("div",undefined,"queue-row"), label=element("div",`${o.paperNumber || o.id}・${C.STATUS[o.status]}・版本 ${o.version}`);
    if(o.updated_at && Date.now()-Date.parse(o.updated_at)>30*86400000 && !["erp_created","cancelled"].includes(o.status)) label.append(element("p","超過30天未完成，請總部處理","warning"));
    const button=element("button","查看／續作","secondary"); button.onclick=()=>run(async()=>{ if(state.dirty) throw Error("請先保存目前修改"); await loadOrder(o.id); }); row.append(label,button); $("queue").append(row);
  }
  if(!state.orders.length) $("queue").append(element("p","本日期尚無已保存訂單；仍須確認待收原圖。","muted"));
}
async function loadOrder(id) {
  let order;
  if(state.mode === "demo") order=structuredClone(state.local.get(id));
  else { order=(await api(`/orders/${id}`)).order; order.batchId=state.orders.find(o=>o.id === id)?.batch_id || null; }
  state.dirty=false; renderOrder(order);
}
async function importSource(f,attach) {
  if(!attach) newBlank();
  const result=await api("/sources","POST",{fileId:f.id,storeCode:selectedStore()});
  if(result.duplicate) { message("相同內容已收單，此次重傳會在結算時移入受限回收區",true); return; }
  if(result.orderId && result.orderId !== state.current.id) { await loadOrder(result.orderId); return; }
  if(state.current.sources.some(s=>s.fileId === f.id)) throw Error("此原圖已在目前訂單中");
  const blob=await G.download(f.id), pages=await pagesFor(blob);
  state.pages.set(f.id,pages); state.current.sources.push({fileId:f.id,pages:pages.length,verified:true}); state.current.pageCount=state.current.sources.reduce((n,s)=>n+s.pages,0);
  state.dirty=true; renderOrder(state.current); remember(); message("原圖已載入，請補齊紙本內容並保存訂單");
}
async function save() {
  const o=state.current; if(!o) throw Error("請先開啟訂單");
  if(o.status === "reviewed") { const v=C.validateOrder(o,{complete:true}); if(v.errors.length) throw Error(v.errors.join("；")); }
  if(["needs_info","cancelled"].includes(o.status) && !C.text(o.exceptionReason)) throw Error("請填補件或取消原因");
  if(state.mode === "demo") { o.version++; state.local.set(o.id,structuredClone(o)); message("已保存在本機測試清單，未上傳或交接"); }
  else {
    const operation=state.saveOperation && state.saveOperation.content === JSON.stringify(o) ? state.saveOperation.id : crypto.randomUUID(); state.saveOperation={id:operation,content:JSON.stringify(o)};
    const r=await api("/orders","POST",{order:o,expectedVersion:o.version,operationId:operation}); o.version=r.version; state.saveOperation=null; message("公司雲端保存成功；尚未結算");
  }
  state.dirty=false; sessionStorage.removeItem(recoveryKey());if(C.validDate(o.businessDate))$("date").value=o.businessDate; renderOrder(o); await refresh();
}
function download(blob,name) { const url=URL.createObjectURL(blob),a=element("a"); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000); }
function selectedStore() {
  const code = $("store").value === "__other__" ? C.text($("store-other").value).toUpperCase() : $("store").value;
  if (!C.validStoreCode(code)) throw Error("請填入門市代號（1至16碼大寫英文字母、數字或連字號），例如 R99");
  if (state.mode === "cloud" && !Object.hasOwn(state.session.stores, code)) throw Error("此門市尚未授權，請由總部設定門市與帳號權限後再操作雲端");
  return code;
}
function selectStore(code) {
  const known = [...$("store").options].some(o => o.value === code);
  $("store").value = known ? code : "__other__";
  $("store-other-label").hidden = known;
  $("store-other").value = known ? "" : code;
}
function setStores(entries) {
  $("store").replaceChildren(...Object.entries(entries).map(([code,value])=>{const o=element("option",`${code}・${typeof value === "string" ? value : value.name}`);o.value=code;return o;}));
  const other=element("option","其它");other.value="__other__";$("store").append(other);
  $("store-other-label").hidden=true;$("store-other").value="";
}
function recover() {
  try { state.settlement=JSON.parse(sessionStorage.getItem(`${recoveryKey()}:settlement`) || "null"); } catch { state.settlement=null; }
  try { const stored=JSON.parse(sessionStorage.getItem(recoveryKey()) || "null"); if(stored && stored.expires>Date.now()) { state.dirty=true; selectStore(stored.order.storeCode);$("date").value=stored.order.businessDate;renderOrder(stored.order); message("已恢復此分頁兩小時內的未保存草稿；原圖需重新載入，請保存至雲端"); } else sessionStorage.removeItem(recoveryKey()); } catch { sessionStorage.removeItem(recoveryKey()); }
}
$("connect").onclick=()=>run(async()=>{
  if(state.dirty) throw Error("請先保存或清除本機修改後連線"); state.mode="cloud";
  try { state.session=await api("/session"); if(state.session.version !== C.VERSION) throw Error("API版本不同，請重新載入最新版"); state.current=null;state.pages.clear();state.local.clear();clearPreview();$("workspace").hidden=true;$("empty-workspace").hidden=false;setStores(state.session.stores); $("session-status").textContent=`${state.session.email}・${state.session.role === "hq" ? "總部" : "門市"}・${state.session.cloudReady ? "雲端服務已設定，仍需授權讀圖" : "雲端服務身分未設定，不能保存或結算"}`; recover(); await refresh(); }
  catch(e) { state.mode="disconnected";state.session=null;throw e; }
});
$("authorize").onclick=()=>run(async()=>{ G.configure(state.session.googleClientId);await G.authorize();await G.verifyIdentity(state.session.email);message("公司雲端授權完成"); });
$("local-demo").onclick=()=>run(async()=>{
  if(state.dirty) throw Error("請先保存或清除目前草稿"); state.mode="demo";state.session=null;G.clear();setStores(C.STORES);$("session-status").textContent="本機測試模式：不會上傳、不會交接，不代表公司登入成功。請勿以此模式處理正式訂單。";
  newBlank();state.current.paperNumber=`TEST-${crypto.randomUUID().slice(0,8)}`;state.current.clerk="測試人員";
  const canvas=document.createElement("canvas");canvas.width=900;canvas.height=240;const ctx=canvas.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,900,240);ctx.fillStyle="black";ctx.font="36px sans-serif";ctx.fillText("TEST01 2 100",30,90);ctx.fillText("TEST02 1 50",30,160);const blob=await new Promise(r=>canvas.toBlob(r));
  const sourceId=`local-${crypto.randomUUID()}`;state.pages.set(sourceId,[blob]);state.current.sources=[{fileId:sourceId,pages:1,verified:true}];
  state.current.items=[{sku:"TEST01",name:"合成測試商品一",color:"白",size:"均碼",quantity:2,unitPrice:100,saleType:"銷貨",matchStatus:"manual",manualConfirmed:true},{sku:"TEST02",name:"合成測試商品二",color:"藍",size:"均碼",quantity:1,unitPrice:50,saleType:"訂貨",matchStatus:"manual",manualConfirmed:true}];state.current.payments["現金"]=250;state.current.paperTotal=250;state.current.paperRowCount=2;renderOrder(state.current);await refresh();message("已載入合成範例；請對照原圖並勾選覆核，再選已覆核及保存");
});
$("logout").onclick=()=>{
  const cloud=state.mode === "cloud";
  sessionStorage.removeItem(recoveryKey());sessionStorage.removeItem(`${recoveryKey()}:settlement`);G.clear();
  state.mode="disconnected";state.session=null;state.current=null;state.master=null;state.orders=[];
  state.local.clear();state.pages.clear();state.dirty=false;state.settlement=null;clearPreview();
  $("order-form").reset();$("order-form").inert=false;$("items").replaceChildren();$("price-groups").replaceChildren();$("group-rows").value="";$("group-amount").value="";$("validation").replaceChildren();
  $("workspace").hidden=true;$("empty-workspace").hidden=false;$("queue").replaceChildren();$("incoming").replaceChildren();
  $("batches").replaceChildren();$("import-results").replaceChildren();$("ocr-text").value="";$("capture").value="";$("master-file").value="";
  $("erp-number").value="";$("erp-reason").value="";$("session-status").textContent="已登出並清除目前分頁草稿。";
  controls();if(cloud)location.assign("/cdn-cgi/access/logout");
};
$("reload-version").onclick=()=>{remember();location.assign(guard.reloadUrl());};
$("new-order").onclick=()=>run(newBlank);$("scan").onclick=()=>run(refresh);
for(const id of ["store","store-other","date"]) $(id).addEventListener("change",()=>run(async()=>{if(state.dirty){selectStore(state.current.storeCode);$("date").value=state.current.businessDate;throw Error("請先保存目前修改再切換");}$("store-other-label").hidden=$("store").value!=="__other__";state.current=null;state.settlement=null;$("workspace").hidden=true;$("empty-workspace").hidden=false;clearPreview();if($("store").value === "__other__" && !C.text($("store-other").value)){state.orders=[];renderQueue();$("store-other").focus();return;}await refresh();}));
$("capture").onchange=()=>run(async()=>{
  const files=[...$("capture").files];if(!files.length)return;
  selectedStore();
  $("import-results").replaceChildren();let succeeded=0,failed=0;
  try {
    for(const [index,file] of files.entries()) {
      const result=element("li",`檔案 ${index+1}／${files.length}：處理中`);$("import-results").append(result);
      try {
        message(`正在檢查第 ${index+1}／${files.length} 個檔案…`);const pages=await pagesFor(file);
        if(state.mode === "demo") {
          if(!state.current)newBlank();
          if(state.current.batchId)throw Error("已結算訂單不能加入原圖，請新增空白訂單");
          const count=state.current.sources.reduce((n,s)=>n+s.pages,0)+pages.length;
          if(count>30 || state.current.sources.length>=30)throw Error("同張訂單最多30頁／30個來源，請分單處理");
          const id=`local-${crypto.randomUUID()}`;state.pages.set(id,pages);state.current.sources.push({fileId:id,pages:pages.length,verified:true});state.current.pageCount=count;state.dirty=true;renderOrder(state.current);remember();
        } else {
          const normalized=new Blob([file],{type:file.type || (/\.hei[cf]$/i.test(file.name)?"image/heic":"")});
          const session=await api("/upload-session","POST",{storeCode:selectedStore(),mimeType:normalized.type,size:normalized.size,operationId:crypto.randomUUID()});await G.upload(normalized,session);
        }
        succeeded++;result.textContent=`檔案 ${index+1}：${state.mode === "demo" ? "已加入本機原圖，未上傳" : "雲端上傳成功，待收單覆核"}`;result.className="success";
      } catch(e) {failed++;result.textContent=`檔案 ${index+1}：失敗・${e.message || "請重試"}`;result.className="error";}
    }
  } finally {$("capture").value="";}
  await refresh();message(`匯入完成：成功 ${succeeded} 個、失敗 ${failed} 個。${state.mode === "demo" ? "原圖只保留在本機，未上傳。" : "上傳不代表已覆核或結算。"}`,failed>0);
});
$("recognition-file").onchange=()=>run(async()=>{
  try {
    if(state.mode!=="demo")throw Error("辨識樣本結果目前僅能套用至本機測試訂單");
    if(!state.current||state.current.batchId)throw Error("請先開啟未結算的空白訂單並載入原圖");
    if(state.current.items.length)throw Error("目前已有商品列，請另建空白訂單，避免覆蓋已填內容");
    const file=$("recognition-file").files[0];if(!file)return;if(file.size>1000000)throw Error("辨識結果檔案過大");
    const data=validateExtraction(JSON.parse(await file.text())),draft=extractionOrder(data,state.master);
    if(data.header){
      if(C.text(draft.storeCode)&&draft.storeCode!==selectedStore())throw Error("紙本門市與目前門市不同，請先選取正確門市，不會自動換店");
      if([...state.local.values()].some(o=>o.id!==state.current.id&&o.storeCode===state.current.storeCode&&o.paperNumber===draft.paperNumber))throw Error("此紙本單號已存在，請確認重複單");
      for(const key of ["paperNumber","businessDate","clerk","customer","note","pageCount","paperTotal","payments","headerRecognition"])state.current[key]=draft[key];
      if(C.validDate(state.current.businessDate))$("date").value=state.current.businessDate;
    }
    state.current.items=draft.items;state.current.priceGroups=draft.priceGroups;state.current.paperRowCount=draft.paperRowCount;state.current.masterVersion=draft.masterVersion;markDirty();renderOrder(state.current);message("已套用去識別化商品辨識結果；貨號、組合分配及不確定列仍需人工核對，未保存或結算");
  } finally {$("recognition-file").value="";}
});
async function loadMaster(blob,version) { state.master=C.parseMaster(XLSX.read(await blob.arrayBuffer(),C.READ_OPTIONS),XLSX,version);$("master-status").textContent=`主檔 ${state.master.count} 個貨號・版本 ${version}。已保存訂單保留原快照；修改貨號才重新查找。`;if(state.current&&!state.current.batchId){let changed=false;for(const item of state.current.items){if(!C.text(item.sku)&&C.reverseProduct(state.master,item).status==="unique"){reverseFill(item);changed=true;}}if(changed){markDirty();renderItems();}} }
$("master-file").onchange=()=>run(async()=>{const file=$("master-file").files[0];if(!file)return;const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());await loadMaster(file,`manual:${[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,"0")).join("")}`);});
$("master-cloud").onclick=()=>run(async()=>{const data=await G.latestMaster(state.session.masterFolderId);await loadMaster(data.blob,data.version);});
$("ocr").onclick=()=>run(async()=>{if(!state.current)throw Error("請先開啟訂單");const pages=state.current.sources.flatMap(s=>state.pages.get(s.fileId)||[]);if(pages.length !== state.current.pageCount)throw Error("請先載入所有原圖頁面");$("ocr-text").value=await recognize(pages,message);message("本機辨識完成；文字可能錯誤，仍須逐欄對照原圖");});
$("extract-skus").onclick=()=>run(()=>{if(!state.master)throw Error("請先載入商品主檔");const tokens=$("ocr-text").value.toUpperCase().match(/[A-Z0-9][A-Z0-9_-]{2,79}/g)||[];let count=0;for(const sku of new Set(tokens)){if(state.current.items.some(i=>i.sku===sku))continue;if(C.matchProduct(state.master,sku).status !== "unique")continue;const item={sku,quantity:null,unitPrice:"",saleType:"",zeroConfirmed:false};itemMatch(item);state.current.items.push(item);count++;}state.current.masterVersion=state.master.version;markDirty();renderItems();message(`已加入${count}個唯一命中貨號，數量、成交單價與銷別仍需依紙本確認；未命中或同貨號多列請手動新增，不能視為完整收單`);});
$("add-item").onclick=()=>run(()=>{state.current.items.push({sku:"",name:"",color:"",size:"",quantity:null,unitPrice:"",saleType:"",matchStatus:"missing",manualConfirmed:false});markDirty();renderItems();});
const bindings={"paper-number":"paperNumber","order-date":"businessDate",clerk:"clerk","page-count":"pageCount","paper-rows":"paperRowCount",note:"note",unpaid:"unpaid","paper-total":"paperTotal","exception-reason":"exceptionReason"};
for(const [id,key] of Object.entries(bindings)) $(id).addEventListener("input",()=>{if(!state.current)return;invalidateHeader();state.current[key]=["pageCount","paperRowCount"].includes(key) ? ($(id).value === "" ? null : Number($(id).value)) : $(id).value;markDirty();});
for(const key of ["name","phone","address"]) $(`customer-${key}`).addEventListener("input",()=>{if(state.current){invalidateHeader();state.current.customer[key]=$(`customer-${key}`).value;markDirty();}});
for(const key of C.PAYMENTS){const label=element("label",key),input=element("input");input.type="number";input.min="0";input.step="0.01";input.value=0;input.dataset.payment=key;input.addEventListener("input",()=>{if(state.current){invalidateHeader();state.current.payments[key]=input.value;markDirty();}});label.append(input);$("payments").append(label);}
function invalidateHeader(){if(state.current?.headerRecognition){state.current.headerRecognition.confirmed=false;$("header-recognition-confirmed").checked=false;}}
$("source-page").oninput=()=>{if(state.current?.headerRecognition){state.current.headerRecognition.pageNumber=$("source-page").value===""?null:Number($("source-page").value);invalidateHeader();markDirty();}};
$("header-recognition-confirmed").onchange=()=>{if(state.current?.headerRecognition){state.current.headerRecognition.confirmed=$("header-recognition-confirmed").checked;markDirty();}};
$("reviewed").onchange=()=>{if(state.current){state.current.reviewed=$("reviewed").checked;state.current.items.forEach(i=>{i.recognitionConfirmed=state.current.reviewed;});(state.current.priceGroups||[]).forEach(g=>{if(g.pricingMode==="total_only")g.totalConfirmed=state.current.reviewed;});state.dirty=true;remember();updateTotals();}};
$("order-status").onchange=()=>{if(state.current){state.current.status=$("order-status").value;state.dirty=true;remember();}};
$("order-form").onsubmit=e=>{e.preventDefault();run(save);};
async function performSettlement(body) {try{const r=await api("/settle","POST",body);state.settlement=null;$("settlement-status").textContent=`交接完成・批次 ${r.batchId}`;state.current=null;$("workspace").hidden=true;$("empty-workspace").hidden=false;await refresh();}catch(e){if(e.code === "settlement_reconfirm"){state.settlement=null;sessionStorage.removeItem(`${recoveryKey()}:settlement`);$("settlement-confirmed").checked=false;}throw e;}}
$("settle").onclick=()=>run(async()=>{
  if(state.dirty)throw Error("請先保存目前訂單");if(!$("settlement-confirmed").checked)throw Error("請先核對紙本與本次清單");
  await refresh();
  if(state.mode === "demo") {const list=state.orders.filter(o=>!o.batchId),summary=C.settlementSummary(list.filter(o=>o.status === "reviewed"),list.filter(o=>o.status !== "reviewed"));if(!list.length&&!$("no-orders").checked)throw Error("無單日請明確勾選今日無單");const batch=crypto.randomUUID();for(const o of list)if(o.status !== "needs_info"){o.batchId=batch;o.status=o.status === "cancelled" ? "cancelled" : "settled";o.version++;state.local.set(o.id,structuredClone(o));}$("settlement-status").textContent=`本機模擬結算 ${summary.orders}單／${summary.quantity}件／${money(summary.amountCents)}元，未交接公司雲端`;state.current=null;$("workspace").hidden=true;$("empty-workspace").hidden=false;await refresh();return;}
  const body={storeCode:selectedStore(),businessDate:$("date").value,orders:state.orders.filter(o=>!o.batch_id).map(o=>({id:o.id,version:o.version})),operationId:crypto.randomUUID(),confirmed:true,noOrders:$("no-orders").checked};
  state.settlement=body;sessionStorage.setItem(`${recoveryKey()}:settlement`,JSON.stringify(body));
  try{await performSettlement(body);sessionStorage.removeItem(`${recoveryKey()}:settlement`);}catch(e){$("settlement-status").textContent=e.code === "settlement_reconfirm" ? "本次尚未交接，請處理新單或異常後，重新核對並結算。" : "結算未確認成功；保留原操作，可按重試，請勿另開結算。";throw e;}
});
$("retry-settle").onclick=()=>run(async()=>{if(!state.settlement)throw Error("沒有待重試操作");await performSettlement(state.settlement);sessionStorage.removeItem(`${recoveryKey()}:settlement`);});
$("export-test").onclick=()=>run(async()=>{
  if(state.dirty)throw Error("請先保存修改");let order=state.current;if(!order)throw Error("請先開啟訂單");
  // Validate and serialize before reserving export, preventing a local error from consuming it.
  const profile=profileUI.get();const bytes=XLSX.write(profile?buildRevisedPOS([order],XLSX,profile):C.buildPOS([order],XLSX,{mode:"test"}),profile?TEMPLATE_WRITE_OPTIONS:C.WRITE_OPTIONS);
  if(state.mode === "cloud"){const r=await api(`/orders/${order.id}/export`,"POST",{expectedVersion:order.version,mode:"test"});order.version=r.version;order.status="exported";}
  else{if(!["settled","import_failed"].includes(order.status))throw Error("請先模擬結算，再開啟訂單產檔");order.status="exported";order.version++;state.local.set(order.id,structuredClone(order));}
  download(new Blob([bytes],{type:profile?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"application/vnd.ms-excel"}),`測試勿正式匯入-POS-${order.id}.${profile?"xlsx":"xls"}`);renderOrder(order);await refresh();message("POS測試檔已產生；請依所選範本核對成交單價、付款、個資及倉庫，正式ERP計價仍待驗證。若下載未完成，請先登記確認匯入失敗再重產。");
});
$("save-result").onclick=()=>run(async()=>{const o=state.current,b={expectedVersion:o.version,status:$("erp-result").value,erpNumber:$("erp-number").value,reason:$("erp-reason").value,operationId:crypto.randomUUID()};if(!C.text(b.reason)||b.status === "erp_created"&&!C.text(b.erpNumber))throw Error("請填確認說明及成功建立的ERP單號");if(state.mode === "cloud"){const r=await api(`/orders/${o.id}/result`,"POST",b);o.version=r.version;}else{o.version++;}o.status=b.status;o.erpNumber=b.status === "erp_created" ? b.erpNumber : "";state.local.set(o.id,structuredClone(o));renderOrder(o);await refresh();message("匯入結果已登記");});
$("correct").onclick=()=>run(async()=>{const o=state.current;if(!C.text(o.exceptionReason))throw Error("請在原因欄填寫更正原因");const r=await api(`/orders/${o.id}/correct`,"POST",{expectedVersion:o.version,order:o,reason:o.exceptionReason,operationId:crypto.randomUUID()});o.version=r.version;state.dirty=false;sessionStorage.removeItem(recoveryKey());renderOrder(o);await refresh();message("總部更正版本保存成功，原版保留");});
$("retention").onclick=()=>run(async()=>{const r=await api("/retention","POST",{});message(`已移入受限回收區 ${r.recycledBatches} 個到期批次，未永久刪除`);});
window.addEventListener("focus",()=>{updateVersion().then(controls);});
window.addEventListener("beforeunload",e=>{remember();if(state.dirty){e.preventDefault();e.returnValue="";}});
setInterval(()=>{updateVersion().then(controls);if(state.mode === "cloud"&&!state.busy&&!document.hidden)run(refresh);},60000);
$("date").value=C.taipeiDate();setStores(C.STORES);updateVersion().then(controls);

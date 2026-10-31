// Shared browser/Worker business rules. No customer data is persisted here.
export const VERSION = "20261031-store-orders-r37";
export const READ_OPTIONS = Object.freeze({ type: "array", cellStyles: true, cellDates: false, raw: true });
export const WRITE_OPTIONS = Object.freeze({ bookType: "biff8", type: "array" });
export const POS_HEADERS = Object.freeze(["單號", "結帳日期", "開單倉庫", "出貨倉庫", "取貨倉庫", "會員卡號", "銷別", "備註", "貨號", "顏色", "顏色編碼", "尺碼", "尺碼編碼", "是否贈品", "導購", "實收率", "數量", "中信信用卡", "現金", "百貨現金卷", "LinePay"]);
export const PAYMENTS = Object.freeze(["中信信用卡", "現金", "百貨現金卷", "LinePay"]);
export const STORES = Object.freeze({ R00: "台北中山門市", R01: "台中北屯門市", R03: "新竹東區門市", R10: "新莊門市", R07: "誠品480門市", R06: "文心秀泰門市" });
export const STATUS = Object.freeze({ pending: "待覆核", needs_info: "待補件", reviewed: "已覆核", settled: "已結算", exported: "已產檔", import_unknown: "待確認匯入結果", import_failed: "匯入失敗", erp_created: "ERP 已建立", cancelled: "已取消" });
export function text(value) { return String(value ?? "").normalize("NFKC").trim(); }
export function storeLabel(code,name){const label=text(name);return !label||label===text(code)?text(code):`${text(code)}・${label}`;}
export function validStoreCode(code) { return typeof code === "string" && /^[A-Z0-9][A-Z0-9-]{0,15}$/.test(code); }
export function taipeiDate(value = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
export function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function cents(value) {
  if (value === "" || value === null || value === undefined || typeof value === "boolean" || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error("金額須為非負數，最多兩位小數");
  const parts = String(value).split(".");
  const n = Number(parts[0]) * 100 + Number((parts[1] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > 100000000000) throw new Error("金額超過允許範圍");
  return n;
}
export function newOrder(id, storeCode = "R00", date = taipeiDate()) {
  return { schemaVersion: 1, id, storeCode, businessDate: date, paperNumber: "", clerk: "", customer: { name: "", phone: "", address: "" }, note: "", pageCount: 1, paperRowCount: null, sources: [], items: [], priceGroups: [], payments: Object.fromEntries(PAYMENTS.map(k => [k, 0])), unpaid: 0, paperTotal: "", masterVersion: "", status: "pending", version: 0, reviewed: false, exceptionReason: "" };
}
// Missing basis means historical per-unit prices; never reinterpret saved orders.
export function lineAmountCents(order,item){return order.priceBasis==='line_total'?cents(item.unitPrice):item.quantity*cents(item.unitPrice);}
export function ordinaryERPPrice(order,item){
 if(order.priceBasis!=='line_total')return cents(item.unitPrice)/100;
 if(!Number.isSafeInteger(item.quantity)||item.quantity<1)throw Error('數量須為正整數');
 const amount=cents(item.unitPrice),divisor=item.quantity*100;
 if(amount%divisor!==0)throw Error('本列總金額無法換算為整元ERP單價；請確認數量與價格，不會自動改動總金額');
 return amount/divisor;
}
export function totalOnlyGroup(order,item){return (Array.isArray(order.priceGroups)?order.priceGroups:[]).find(g=>g.id===item.priceGroupId&&g.pricingMode==="total_only");}
export function useTotalOnlyGroups(order){for(const g of order.priceGroups||[]){if(g.pricingMode!=="total_only"){g.previousAllocations=order.items.flatMap((i,n)=>i.priceGroupId===g.id?[{row:n+1,unitPrice:i.unitPrice}]:[]);}g.pricingMode="total_only";g.totalConfirmed=false;for(const i of order.items)if(i.priceGroupId===g.id)i.unitPrice="";}return order;}
export function totals(order) {
  if(order.priceBasis!==undefined&&!["unit","line_total"].includes(order.priceBasis))throw Error("請確認價格是單件單價或本列商品總金額");
  const check=priceGroupValidation(order,false);if(check.errors.length)throw Error(check.errors.join("；"));
  let quantity = 0, amountCents = 0;
  for (const item of order.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 100000) throw new Error("數量須為1至100000的整數");
    quantity += item.quantity;
    if(!totalOnlyGroup(order,item))amountCents += lineAmountCents(order,item);
  }
  for(const g of order.priceGroups||[])if(g.pricingMode==="total_only")amountCents+=cents(g.amount);
  const paidCents = PAYMENTS.reduce((n, k) => n + cents(order.payments[k]), 0);
  if (![quantity, amountCents, paidCents].every(Number.isSafeInteger)) throw new Error("合計超過允許範圍");
  return { orders: 1, rows: order.items.length, quantity, amountCents, paidCents, unpaidCents: cents(order.unpaid) };
}
export function validateOrder(order, { complete = false } = {}) {
  const errors = [], warnings = [];
  if(order?.priceBasis!==undefined&&!["unit","line_total","unknown"].includes(order.priceBasis))errors.push("價格計算方式無效");
  if(complete&&order?.priceBasis==="unknown")errors.push("請確認價格是單件單價或本列商品總金額");
  if(order?.memberNumber!==undefined&&(typeof order.memberNumber!=="string"||order.memberNumber.length>100))errors.push("會員編號格式錯誤");
  if (!order || order.schemaVersion !== 1 || !/^[a-zA-Z0-9-]{8,80}$/.test(order.id || "")) return { errors: ["訂單識別或資料版本錯誤"], warnings };
  if (!validStoreCode(order.storeCode)) errors.push("門市代號格式錯誤");
  if (!validDate(order.businessDate)) errors.push("業務日期格式錯誤");
  if (!Array.isArray(order.items) || order.items.length > 100 || !Array.isArray(order.sources) || order.sources.length > 30) return { errors: [...errors, "明細或頁數超過上限"], warnings };
  if (!order.payments || typeof order.payments !== "object") return { errors: [...errors, "缺少付款資料"], warnings };
  if (text(order.paperNumber).length > 80 || text(order.clerk).length > 100 || text(order.note).length > 1000 || !order.customer || Object.values(order.customer).some(v => typeof v !== "string" || v.length > 500)) errors.push("表頭內容過長或格式錯誤");
  if (!Number.isSafeInteger(order.pageCount) || order.pageCount < 1 || order.pageCount > 30) errors.push("總頁數須為1至30頁");
  if(order.headerRecognition){const h=order.headerRecognition;if(typeof h!=="object"||Array.isArray(h)||typeof h.confirmed!=="boolean"||typeof h.rawDate!=="string"||h.rawDate.length>100||!Array.isArray(h.uncertainFields)||h.uncertainFields.length>30||h.uncertainFields.some(v=>typeof v!=="string"||v.length>100))errors.push("表頭辨識覆核資料格式錯誤");}
  if (complete) {
    if(order.headerRecognition){if(order.headerRecognition.confirmed!==true)errors.push("完整單表頭與收款辨識尚未人工確認");if(!Number.isSafeInteger(order.headerRecognition.pageNumber)||order.headerRecognition.pageNumber<1||order.headerRecognition.pageNumber>order.pageCount)errors.push("請確認來源頁碼與總頁數");}
    if (!text(order.paperNumber) || !text(order.clerk)) errors.push("請填紙本單號與經手人");
    if (!order.items.length) errors.push("至少需有一筆商品");
    if(!Number.isSafeInteger(order.paperRowCount)||order.paperRowCount!==order.items.length) errors.push("紙本商品列數與目前明細不一致，請逐列核對，不能只採用部分辨識結果");
    if (order.reviewed !== true) errors.push("請確認已逐欄對照原圖");
    if (!order.sources.length || order.sources.some(s => s.verified !== true || !Number.isSafeInteger(s.pages) || s.pages < 1 || s.pages > 30) || order.sources.reduce((n, s) => n + s.pages, 0) !== order.pageCount) errors.push("來源缺頁或尚未確認頁數");
  }
  const groupCheck=priceGroupValidation(order,complete);errors.push(...groupCheck.errors);warnings.push(...groupCheck.warnings);
  order.items.forEach((item, index) => {
    const label = `第${index + 1}列`;
    if (!text(item.sku) || text(item.sku).length > 80) errors.push(`${label}請填完整貨號`);
    if (!["銷貨", "訂貨"].includes(item.saleType)) errors.push(`${label}請選擇單一銷別`);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000) errors.push(`${label}數量須為正整數`);
    if(!totalOnlyGroup(order,item))try { if (cents(item.unitPrice) === 0 && complete && !item.zeroConfirmed) errors.push(`${label}零元商品須明確確認`); } catch { errors.push(`${label}成交單價錯誤`); }
    if(item.recognitionUncertain && complete && item.recognitionConfirmed!==true)errors.push(`${label}辨識有疑義，請對照原圖確認`);
    if(item.matchStatus === "name_auto" && complete && item.reverseLookupConfirmed !== true) errors.push(`${label}品名反查帶入貨號，請核對原圖並確認`);
    if (item.matchStatus !== "unique" && item.matchStatus !== "name_auto") {
      warnings.push(`${label}${item.matchStatus==="selected"?"已人工選定主檔商品":"商品未唯一命中主檔"}`);
      if (complete && !item.manualConfirmed) errors.push(`${label}需人工確認商品`);
    }
    if(item.matchStatus === "name_auto")warnings.push(`${label}由品名唯一反查帶入貨號，仍須核對`);
    if (item.discontinued) warnings.push(`${label}停用品，可繼續使用`);
    const reference=nameReference(item.name,item.paperName);
    if(reference.conflict){warnings.push(`${label}${reference.message}`);if(complete&&item.nameHintAcknowledged!==true)errors.push(`${label}請確認貨號與原圖，勾選品名差異確認`);}
    if (complete && (!text(item.name) || !text(item.color) || !text(item.size))) errors.push(`${label}缺品名、顏色或尺碼`);
    if (["sku", "name", "paperName", "color", "size", "colorCode", "sizeCode"].some(k => text(item[k]).length > 200)) errors.push(`${label}商品欄位過長`);
  });
  try {
    const t = totals(order);
    if (complete && cents(order.paperTotal) !== t.amountCents) errors.push("紙本總額與商品小計不一致");
    if (complete && t.amountCents !== t.paidCents + t.unpaidCents) errors.push("成交總額必須等於已收加未收金額");
  } catch (e) { errors.push(e.message); }
  return { errors: [...new Set(errors)], warnings };
}
export function warehouses(storeCode, saleType) {
  if (!validStoreCode(storeCode) || !["銷貨", "訂貨"].includes(saleType)) throw new Error("門市或銷別錯誤");
  return [storeCode, storeCode, saleType === "訂貨" ? "T00" : storeCode];
}
export function parseMaster(workbook, XLSX, version) {
  const aliases = { sku: ["貨號", "ERP品號", "商品編號", "品號"], name: ["品名", "商品名稱", "商品品名"], color: ["顏色", "色名", "顏色名稱"], size: ["尺碼", "尺寸"], colorCode: ["顏色編碼", "顏色代碼"], sizeCode: ["尺碼編碼", "尺碼代碼"], discontinued: ["已下架", "停用", "停用品"], status: ["貨品狀態", "商品狀態"] };
  const candidates = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
    rows.slice(0, 35).forEach((row, i) => {
      const map = Object.fromEntries(Object.entries(aliases).map(([k, names]) => [k, row.findIndex(v => names.includes(text(v)))]));
      if (map.sku >= 0 && map.name >= 0) candidates.push({ sheetName, rows, index: i, map });
    });
  }
  if (candidates.length !== 1) throw new Error("商品主檔需有唯一的貨號／品名表頭，請確認工作表");
  const { rows, index, map, sheetName } = candidates[0], bySku = new Map();
  const costColumns=rows[index].flatMap((v,i)=>text(v)==="成本價"?[i]:[]);
  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i], sheet = workbook.Sheets[sheetName];
    const cell = sheet[XLSX.utils.encode_cell({ r: i, c: map.sku })];
    const rawSku = cell?.t === "s" && typeof cell.v === "string" ? cell.v : row[map.sku];
    if (cell?.t === "d" || (cell?.t === "n" && XLSX.SSF.is_date(cell.z || "")) || /^INVALID DATE$/i.test(text(rawSku))) throw new Error(`商品主檔第${i + 1}列貨號為日期，請改為完整文字貨號`);
    const sku = text(rawSku).toUpperCase(), name = text(row[map.name]);
    if (!sku && !name) continue;
    if (!sku || !name) throw new Error(`商品主檔第${i + 1}列缺少貨號或品名`);
    const record = Object.fromEntries(Object.keys(aliases).map(k => [k, text(row[map[k]])]));
    record.sku = sku;
    record.costSnapshot={sku,value:costColumns.length===1?text(row[costColumns[0]]):null,field:"成本價",masterVersion:version,status:costColumns.length===1?"provided":"missing_or_ambiguous"};
    record.discontinued = /^(是|1|true|停用|已下架)$/i.test(record.discontinued) || /停用|已下架/.test(record.status);
    if (!bySku.has(sku)) bySku.set(sku, []);
    const signature = JSON.stringify(record);
    if (!bySku.get(sku).some(r => JSON.stringify(r) === signature)) bySku.get(sku).push(record);
  }
  if (!bySku.size) throw new Error("商品主檔沒有可用資料");
  return { version, sheetName, bySku, count: bySku.size };
}
export function matchProduct(master, sku) {
  const key = text(sku).toUpperCase(), matches = master?.bySku.get(key) || [];
  return { status: matches.length === 1 ? "unique" : matches.length ? "ambiguous" : "missing", matches };
}
// A shortened paper name is evidence for review/search, never the product identity.
function nameCategories(value){
  const normalized=text(value);
  return [["床包",/床包|床罩/],["枕套",/枕套|枕頭套/],["枕頭",/枕頭(?!套)|枕芯|好眠枕|高中枕|高枕|低枕/],["毛巾",/毛巾|浴巾|手巾|方巾/],["被套",/被套/],["被子",/冷被|涼被|棉被|羽絨被/]].filter(([,pattern])=>pattern.test(normalized)).map(([category])=>category);
}
export function nameReference(officialName,paperName){
  const actual=nameCategories(officialName),reference=nameCategories(paperName);
  const conflict=!!text(paperName)&&actual.length>0&&reference.length>0&&!actual.some(c=>reference.includes(c));
  return {conflict,message:conflict?"手寫品名與正式品名的商品類型不同，請核對完整貨號；不會自動換品":""};
}
export function applyProduct(item,product,{manual=false}={}){
  return {...item,costSnapshot:product.costSnapshot?structuredClone(product.costSnapshot):null,sku:product.sku,name:product.name,color:product.color||"",size:product.size||"",colorCode:product.colorCode||"",sizeCode:product.sizeCode||"",discontinued:!!product.discontinued,matchStatus:manual?"selected":"unique",manualConfirmed:manual,nameHintAcknowledged:false};
}
export function searchProducts(master,query,limit=10){
  const normalize=v=>text(v).toLowerCase().replace(/[\s\p{P}\p{S}]/gu,"");
  const q=normalize(query);if(!q||!master)return [];
  const grams=new Set(Array.from({length:Math.max(0,q.length-1)},(_,i)=>q.slice(i,i+2))),ranked=[];
  for(const records of master.bySku.values())for(const record of records){
    const sku=normalize(record.sku),name=normalize(`${record.name}${record.color||""}${record.size||""}`);
    let score=sku===q?10000:sku.includes(q)?1000:name.includes(q)?500:0;
    if(!score&&!nameReference(record.name,query).conflict)for(const gram of grams)if(name.includes(gram))score++;
    if(score)ranked.push({record,score});
  }
  return ranked.sort((a,b)=>b.score-a.score||a.record.sku.localeCompare(b.record.sku,"zh-Hant")).slice(0,Math.max(1,Math.min(30,limit))).map(r=>r.record);
}
// A name may fill an EMPTY SKU only on a unique strict name/spec match.
const normalizeProductText = value => text(value).toLowerCase().replace(/呎/g,"尺").replace(/[\s\p{P}\p{S}]/gu,"");
export function reverseProduct(master, item) {
  if(text(item.sku))return {status:"existing",matches:[]};
  const query=normalizeProductText(item.paperName);
  if(!master || query.length<4 || /^(同上|贈品|商品|床包|枕套|浴巾|毛巾|被套|枕頭)$/.test(query))return {status:"insufficient",matches:[]};
  const matches=[];
  for(const records of master.bySku.values())for(const record of records){
    const full=normalizeProductText(`${record.name}${record.color||""}${record.size||""}`);
    // All explicitly supplied spec terms must agree; never choose a top fuzzy score.
    const size=normalizeProductText(item.paperSize||""),color=normalizeProductText(item.paperColor||"");
    if(full.includes(query)&&(!size||full.includes(size))&&(!color||full.includes(color))&&!nameReference(record.name,item.paperName).conflict)matches.push(record);
  }
  return {status:matches.length===1?"unique":matches.length?"ambiguous":"missing",matches};
}
export function applyReverseProduct(item, product) {
  if(text(item.sku))throw Error("已有貨號，不以品名覆寫");
  return {...applyProduct(item,product),matchStatus:"name_auto",manualConfirmed:false,reverseLookupConfirmed:false,reverseEvidence:text(item.paperName)};
}
export function priceGroupValidation(order, complete=false) {
  const errors=[],warnings=[],groups=order.priceGroups??[],ids=new Set(),assigned=new Set();
  if(!Array.isArray(groups)||groups.length>50)return {errors:["組合金額資料格式錯誤"],warnings};
  for(const group of groups){
    const id=text(group?.id),rows=order.items.filter(item=>item.priceGroupId===id);
    if(!id||id.length>80||ids.has(id)){errors.push("組合金額識別重複或空白");continue;}ids.add(id);
    if(rows.length<2){errors.push(`組合 ${id} 至少需包含兩列商品`);continue;}
    let target;try{target=cents(group.amount);}catch{errors.push(`組合 ${id} 合計金額無效`);continue;}
    if(![undefined,"allocated","total_only"].includes(group.pricingMode)){errors.push(`組合 ${id} 計價模式錯誤`);continue;}
    if(group.pricingMode==="total_only"){
      rows.forEach(item=>assigned.add(item));
      if(rows.some(item=>item.unitPrice!==""&&item.unitPrice!==null&&item.unitPrice!==undefined))errors.push(`組合 ${id} 只採整組總價，各列單價必須留空，不能重複計價`);
      if(complete&&group.totalConfirmed!==true)errors.push(`組合 ${id} 整組總價尚未確認`);
      warnings.push(`組合 ${id}：${rows.length}列共用 ${target/100} 元，只計一次，不拆分各列價格`);
      continue;
    }
    let allocated=null;try{allocated=rows.reduce((n,item)=>n+item.quantity*cents(item.unitPrice),0);}catch{/* unresolved allocation */}
    rows.forEach(item=>assigned.add(item));
    const repeated=target>0&&rows.filter(item=>{try{return item.quantity*cents(item.unitPrice)===target;}catch{return false;}}).length>1;
    if(repeated)errors.push(`組合 ${id} 的整組金額重複填入多列，請勿重複計價`);
    warnings.push(`組合 ${id}：${rows.length}列共用 ${target/100} 元，只計一次；各列成交價須確認分配`);
    if(complete&&(allocated!==target||group.allocationConfirmed!==true))errors.push(`組合 ${id} 尚未確認各列分配，或分配合計不等於整組金額`);
  }
  if(order.items.some(item=>text(item.priceGroupId)&&!assigned.has(item)))errors.push("商品列連結的組合金額不存在或不完整");
  return {errors,warnings};
}

export function assertConservation(orders, rows) {
  const expected = orders.reduce((a, o) => a + totals(o).quantity, 0);
  if (rows.length !== orders.reduce((a, o) => a + o.items.length, 0) || rows.reduce((a, r) => a + r[16], 0) !== expected) throw new Error("輸出列數或件數不守恆，已停止產檔");
  for (const order of orders) {
    const group = rows.filter(r => r[0] === order.paperNumber), t = totals(order);
    const paid = group.reduce((n, r) => n + r.slice(17).reduce((a, v) => a + cents(v === "" ? 0 : v), 0), 0);
    if (group.length !== order.items.length || paid !== t.paidCents) throw new Error("輸出收款或品項不守恆，已停止產檔");
  }
}
export function posRows(orders, { mode = "test" } = {}) {
  // No client-provided flag can bypass the ERP acceptance gate in this release.
  if (mode !== "test") throw new Error("ERP 計價、收款及混合銷別尚未驗證，禁止正式產檔");
  const numbers = new Set();
  const rows = orders.flatMap(order => {
    const validation = validateOrder(order, { complete: true });
    if (validation.errors.length) throw new Error(validation.errors.join("；"));
    if (numbers.has(order.paperNumber)) throw new Error("紙本單號重複，已停止產檔");
    numbers.add(order.paperNumber);
    return order.items.map((item, i) => [order.paperNumber, order.businessDate.replaceAll("-", "/"), ...warehouses(order.storeCode, item.saleType), "", item.saleType, "測試檔・未完成ERP驗收", text(item.sku), text(item.color), text(item.colorCode), text(item.size), text(item.sizeCode), "", "", 100, item.quantity, ...PAYMENTS.map(k => i === 0 ? cents(order.payments[k]) / 100 : "")]);
  });
  assertConservation(orders, rows);
  return rows;
}
export function buildPOS(orders, XLSX, options) {
  const rows = posRows(orders, options), wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([["POS單信息", "", "", "", "", "", "", "", "貨品信息", "", "", "", "", "", "", "", "", "收款方式", "", "", ""], POS_HEADERS, ...rows]);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }, { s: { r: 0, c: 8 }, e: { r: 0, c: 16 } }, { s: { r: 0, c: 17 }, e: { r: 0, c: 20 } }];
  // Explicit strings protect identifiers (including leading zeros) and formula-like text.
  rows.forEach((row, r) => row.forEach((v, c) => { const cell = ws[XLSX.utils.encode_cell({ r: r + 2, c })]; if (cell && typeof v === "string") { cell.t = "s"; delete cell.f; cell.z = "@"; } }));
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return wb;
}
export function settlementSummary(orders, exceptions = []) {
  if (orders.some(o => o.status !== "reviewed" || validateOrder(o, { complete: true }).errors.length)) throw new Error("尚有未完成覆核的訂單");
  if (exceptions.some(o => !["needs_info", "cancelled"].includes(o.status) || !text(o.exceptionReason))) throw new Error("異常單需選擇留待補件或取消並填原因");
  const numbers = orders.map(o => `${o.storeCode}:${text(o.paperNumber)}`);
  if (new Set(numbers).size !== numbers.length) throw new Error("紙本單號重複，請先確認");
  return orders.reduce((a, o) => { const t = totals(o); for (const k of Object.keys(a)) a[k] += t[k] || 0; return a; }, { orders: 0, rows: 0, quantity: 0, amountCents: 0, paidCents: 0, unpaidCents: 0 });
}

// store-orders/core.js
var VERSION = "20261030-store-orders-r24";
var READ_OPTIONS = Object.freeze({ type: "array", cellStyles: true, cellDates: false, raw: true });
var WRITE_OPTIONS = Object.freeze({ bookType: "biff8", type: "array" });
var POS_HEADERS = Object.freeze(["\u55AE\u865F", "\u7D50\u5E33\u65E5\u671F", "\u958B\u55AE\u5009\u5EAB", "\u51FA\u8CA8\u5009\u5EAB", "\u53D6\u8CA8\u5009\u5EAB", "\u6703\u54E1\u5361\u865F", "\u92B7\u5225", "\u5099\u8A3B", "\u8CA8\u865F", "\u984F\u8272", "\u984F\u8272\u7DE8\u78BC", "\u5C3A\u78BC", "\u5C3A\u78BC\u7DE8\u78BC", "\u662F\u5426\u8D08\u54C1", "\u5C0E\u8CFC", "\u5BE6\u6536\u7387", "\u6578\u91CF", "\u4E2D\u4FE1\u4FE1\u7528\u5361", "\u73FE\u91D1", "\u767E\u8CA8\u73FE\u91D1\u5377", "LinePay"]);
var PAYMENTS = Object.freeze(["\u4E2D\u4FE1\u4FE1\u7528\u5361", "\u73FE\u91D1", "\u767E\u8CA8\u73FE\u91D1\u5377", "LinePay"]);
var STORES = Object.freeze({ R00: "\u53F0\u5317\u4E2D\u5C71\u9580\u5E02", R01: "\u53F0\u4E2D\u5317\u5C6F\u9580\u5E02", R03: "\u65B0\u7AF9\u6771\u5340\u9580\u5E02", R10: "\u65B0\u838A\u9580\u5E02", R07: "\u8AA0\u54C1480\u9580\u5E02", R06: "\u6587\u5FC3\u79C0\u6CF0\u9580\u5E02" });
var STATUS = Object.freeze({ pending: "\u5F85\u8986\u6838", needs_info: "\u5F85\u88DC\u4EF6", reviewed: "\u5DF2\u8986\u6838", settled: "\u5DF2\u7D50\u7B97", exported: "\u5DF2\u7522\u6A94", import_unknown: "\u5F85\u78BA\u8A8D\u532F\u5165\u7D50\u679C", import_failed: "\u532F\u5165\u5931\u6557", erp_created: "ERP \u5DF2\u5EFA\u7ACB", cancelled: "\u5DF2\u53D6\u6D88" });
function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}
function validStoreCode(code) {
  return typeof code === "string" && /^[A-Z0-9][A-Z0-9-]{0,15}$/.test(code);
}
function taipeiDate(value = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function cents(value) {
  if (value === "" || value === null || value === void 0 || typeof value === "boolean" || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error("\u91D1\u984D\u9808\u70BA\u975E\u8CA0\u6578\uFF0C\u6700\u591A\u5169\u4F4D\u5C0F\u6578");
  const parts = String(value).split(".");
  const n = Number(parts[0]) * 100 + Number((parts[1] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > 1e11) throw new Error("\u91D1\u984D\u8D85\u904E\u5141\u8A31\u7BC4\u570D");
  return n;
}
function newOrder(id, storeCode = "R00", date = taipeiDate()) {
  return { schemaVersion: 1, id, storeCode, businessDate: date, paperNumber: "", clerk: "", customer: { name: "", phone: "", address: "" }, note: "", pageCount: 1, paperRowCount: null, sources: [], items: [], payments: Object.fromEntries(PAYMENTS.map((k) => [k, 0])), unpaid: 0, paperTotal: "", masterVersion: "", status: "pending", version: 0, reviewed: false, exceptionReason: "" };
}
function totalOnlyGroup(order, item) {
  return (Array.isArray(order.priceGroups) ? order.priceGroups : []).find((g) => g.id === item.priceGroupId && g.pricingMode === "total_only");
}
function useTotalOnlyGroups(order) {
  for (const g of order.priceGroups || []) {
    if (g.pricingMode !== "total_only") {
      g.previousAllocations = order.items.flatMap((i, n) => i.priceGroupId === g.id ? [{ row: n + 1, unitPrice: i.unitPrice }] : []);
    }
    g.pricingMode = "total_only";
    g.totalConfirmed = false;
    for (const i of order.items) if (i.priceGroupId === g.id) i.unitPrice = "";
  }
  return order;
}
function totals(order) {
  const check = priceGroupValidation(order, false);
  if (check.errors.length) throw Error(check.errors.join("\uFF1B"));
  let quantity = 0, amountCents = 0;
  for (const item of order.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 1e5) throw new Error("\u6578\u91CF\u9808\u70BA1\u81F3100000\u7684\u6574\u6578");
    quantity += item.quantity;
    if (!totalOnlyGroup(order, item)) amountCents += item.quantity * cents(item.unitPrice);
  }
  for (const g of order.priceGroups || []) if (g.pricingMode === "total_only") amountCents += cents(g.amount);
  const paidCents = PAYMENTS.reduce((n, k) => n + cents(order.payments[k]), 0);
  if (![quantity, amountCents, paidCents].every(Number.isSafeInteger)) throw new Error("\u5408\u8A08\u8D85\u904E\u5141\u8A31\u7BC4\u570D");
  return { orders: 1, rows: order.items.length, quantity, amountCents, paidCents, unpaidCents: cents(order.unpaid) };
}
function validateOrder(order, { complete = false } = {}) {
  const errors = [], warnings = [];
  if (!order || order.schemaVersion !== 1 || !/^[a-zA-Z0-9-]{8,80}$/.test(order.id || "")) return { errors: ["\u8A02\u55AE\u8B58\u5225\u6216\u8CC7\u6599\u7248\u672C\u932F\u8AA4"], warnings };
  if (!validStoreCode(order.storeCode)) errors.push("\u9580\u5E02\u4EE3\u865F\u683C\u5F0F\u932F\u8AA4");
  if (!validDate(order.businessDate)) errors.push("\u696D\u52D9\u65E5\u671F\u683C\u5F0F\u932F\u8AA4");
  if (!Array.isArray(order.items) || order.items.length > 100 || !Array.isArray(order.sources) || order.sources.length > 30) return { errors: [...errors, "\u660E\u7D30\u6216\u9801\u6578\u8D85\u904E\u4E0A\u9650"], warnings };
  if (!order.payments || typeof order.payments !== "object") return { errors: [...errors, "\u7F3A\u5C11\u4ED8\u6B3E\u8CC7\u6599"], warnings };
  if (text(order.paperNumber).length > 80 || text(order.clerk).length > 100 || text(order.note).length > 1e3 || !order.customer || Object.values(order.customer).some((v) => typeof v !== "string" || v.length > 500)) errors.push("\u8868\u982D\u5167\u5BB9\u904E\u9577\u6216\u683C\u5F0F\u932F\u8AA4");
  if (!Number.isSafeInteger(order.pageCount) || order.pageCount < 1 || order.pageCount > 30) errors.push("\u7E3D\u9801\u6578\u9808\u70BA1\u81F330\u9801");
  if (order.headerRecognition) {
    const h = order.headerRecognition;
    if (typeof h !== "object" || Array.isArray(h) || typeof h.confirmed !== "boolean" || typeof h.rawDate !== "string" || h.rawDate.length > 100 || !Array.isArray(h.uncertainFields) || h.uncertainFields.length > 30 || h.uncertainFields.some((v) => typeof v !== "string" || v.length > 100)) errors.push("\u8868\u982D\u8FA8\u8B58\u8986\u6838\u8CC7\u6599\u683C\u5F0F\u932F\u8AA4");
  }
  if (complete) {
    if (order.headerRecognition) {
      if (order.headerRecognition.confirmed !== true) errors.push("\u5B8C\u6574\u55AE\u8868\u982D\u8207\u6536\u6B3E\u8FA8\u8B58\u5C1A\u672A\u4EBA\u5DE5\u78BA\u8A8D");
      if (!Number.isSafeInteger(order.headerRecognition.pageNumber) || order.headerRecognition.pageNumber < 1 || order.headerRecognition.pageNumber > order.pageCount) errors.push("\u8ACB\u78BA\u8A8D\u4F86\u6E90\u9801\u78BC\u8207\u7E3D\u9801\u6578");
    }
    if (!text(order.paperNumber) || !text(order.clerk)) errors.push("\u8ACB\u586B\u7D19\u672C\u55AE\u865F\u8207\u7D93\u624B\u4EBA");
    if (!order.items.length) errors.push("\u81F3\u5C11\u9700\u6709\u4E00\u7B46\u5546\u54C1");
    if (!Number.isSafeInteger(order.paperRowCount) || order.paperRowCount !== order.items.length) errors.push("\u7D19\u672C\u5546\u54C1\u5217\u6578\u8207\u76EE\u524D\u660E\u7D30\u4E0D\u4E00\u81F4\uFF0C\u8ACB\u9010\u5217\u6838\u5C0D\uFF0C\u4E0D\u80FD\u53EA\u63A1\u7528\u90E8\u5206\u8FA8\u8B58\u7D50\u679C");
    if (order.reviewed !== true) errors.push("\u8ACB\u78BA\u8A8D\u5DF2\u9010\u6B04\u5C0D\u7167\u539F\u5716");
    if (!order.sources.length || order.sources.some((s) => s.verified !== true || !Number.isSafeInteger(s.pages) || s.pages < 1 || s.pages > 30) || order.sources.reduce((n, s) => n + s.pages, 0) !== order.pageCount) errors.push("\u4F86\u6E90\u7F3A\u9801\u6216\u5C1A\u672A\u78BA\u8A8D\u9801\u6578");
  }
  const groupCheck = priceGroupValidation(order, complete);
  errors.push(...groupCheck.errors);
  warnings.push(...groupCheck.warnings);
  order.items.forEach((item, index) => {
    const label = `\u7B2C${index + 1}\u5217`;
    if (!text(item.sku) || text(item.sku).length > 80) errors.push(`${label}\u8ACB\u586B\u5B8C\u6574\u8CA8\u865F`);
    if (!["\u92B7\u8CA8", "\u8A02\u8CA8"].includes(item.saleType)) errors.push(`${label}\u8ACB\u9078\u64C7\u55AE\u4E00\u92B7\u5225`);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1e5) errors.push(`${label}\u6578\u91CF\u9808\u70BA\u6B63\u6574\u6578`);
    if (!totalOnlyGroup(order, item)) try {
      if (cents(item.unitPrice) === 0 && complete && !item.zeroConfirmed) errors.push(`${label}\u96F6\u5143\u5546\u54C1\u9808\u660E\u78BA\u78BA\u8A8D`);
    } catch {
      errors.push(`${label}\u6210\u4EA4\u55AE\u50F9\u932F\u8AA4`);
    }
    if (item.recognitionUncertain && complete && item.recognitionConfirmed !== true) errors.push(`${label}\u8FA8\u8B58\u6709\u7591\u7FA9\uFF0C\u8ACB\u5C0D\u7167\u539F\u5716\u78BA\u8A8D`);
    if (item.matchStatus === "name_auto" && complete && item.reverseLookupConfirmed !== true) errors.push(`${label}\u54C1\u540D\u53CD\u67E5\u5E36\u5165\u8CA8\u865F\uFF0C\u8ACB\u6838\u5C0D\u539F\u5716\u4E26\u78BA\u8A8D`);
    if (item.matchStatus !== "unique" && item.matchStatus !== "name_auto") {
      warnings.push(`${label}${item.matchStatus === "selected" ? "\u5DF2\u4EBA\u5DE5\u9078\u5B9A\u4E3B\u6A94\u5546\u54C1" : "\u5546\u54C1\u672A\u552F\u4E00\u547D\u4E2D\u4E3B\u6A94"}`);
      if (complete && !item.manualConfirmed) errors.push(`${label}\u9700\u4EBA\u5DE5\u78BA\u8A8D\u5546\u54C1`);
    }
    if (item.matchStatus === "name_auto") warnings.push(`${label}\u7531\u54C1\u540D\u552F\u4E00\u53CD\u67E5\u5E36\u5165\u8CA8\u865F\uFF0C\u4ECD\u9808\u6838\u5C0D`);
    if (item.discontinued) warnings.push(`${label}\u505C\u7528\u54C1\uFF0C\u53EF\u7E7C\u7E8C\u4F7F\u7528`);
    const reference = nameReference(item.name, item.paperName);
    if (reference.conflict) {
      warnings.push(`${label}${reference.message}`);
      if (complete && item.nameHintAcknowledged !== true) errors.push(`${label}\u8ACB\u78BA\u8A8D\u8CA8\u865F\u8207\u539F\u5716\uFF0C\u52FE\u9078\u54C1\u540D\u5DEE\u7570\u78BA\u8A8D`);
    }
    if (complete && (!text(item.name) || !text(item.color) || !text(item.size))) errors.push(`${label}\u7F3A\u54C1\u540D\u3001\u984F\u8272\u6216\u5C3A\u78BC`);
    if (["sku", "name", "paperName", "color", "size", "colorCode", "sizeCode"].some((k) => text(item[k]).length > 200)) errors.push(`${label}\u5546\u54C1\u6B04\u4F4D\u904E\u9577`);
  });
  try {
    const t = totals(order);
    if (complete && cents(order.paperTotal) !== t.amountCents) errors.push("\u7D19\u672C\u7E3D\u984D\u8207\u5546\u54C1\u5C0F\u8A08\u4E0D\u4E00\u81F4");
    if (complete && t.amountCents !== t.paidCents + t.unpaidCents) errors.push("\u6210\u4EA4\u7E3D\u984D\u5FC5\u9808\u7B49\u65BC\u5DF2\u6536\u52A0\u672A\u6536\u91D1\u984D");
  } catch (e) {
    errors.push(e.message);
  }
  return { errors: [...new Set(errors)], warnings };
}
function warehouses(storeCode, saleType) {
  if (!validStoreCode(storeCode) || !["\u92B7\u8CA8", "\u8A02\u8CA8"].includes(saleType)) throw new Error("\u9580\u5E02\u6216\u92B7\u5225\u932F\u8AA4");
  return [storeCode, storeCode, saleType === "\u8A02\u8CA8" ? "T00" : storeCode];
}
function parseMaster(workbook, XLSX2, version) {
  const aliases = { sku: ["\u8CA8\u865F", "ERP\u54C1\u865F", "\u5546\u54C1\u7DE8\u865F", "\u54C1\u865F"], name: ["\u54C1\u540D", "\u5546\u54C1\u540D\u7A31", "\u5546\u54C1\u54C1\u540D"], color: ["\u984F\u8272", "\u8272\u540D", "\u984F\u8272\u540D\u7A31"], size: ["\u5C3A\u78BC", "\u5C3A\u5BF8"], colorCode: ["\u984F\u8272\u7DE8\u78BC", "\u984F\u8272\u4EE3\u78BC"], sizeCode: ["\u5C3A\u78BC\u7DE8\u78BC", "\u5C3A\u78BC\u4EE3\u78BC"], discontinued: ["\u5DF2\u4E0B\u67B6", "\u505C\u7528", "\u505C\u7528\u54C1"], status: ["\u8CA8\u54C1\u72C0\u614B", "\u5546\u54C1\u72C0\u614B"] };
  const candidates = [];
  for (const sheetName2 of workbook.SheetNames) {
    const rows2 = XLSX2.utils.sheet_to_json(workbook.Sheets[sheetName2], { header: 1, raw: true, defval: "" });
    rows2.slice(0, 35).forEach((row, i) => {
      const map2 = Object.fromEntries(Object.entries(aliases).map(([k, names]) => [k, row.findIndex((v) => names.includes(text(v)))]));
      if (map2.sku >= 0 && map2.name >= 0) candidates.push({ sheetName: sheetName2, rows: rows2, index: i, map: map2 });
    });
  }
  if (candidates.length !== 1) throw new Error("\u5546\u54C1\u4E3B\u6A94\u9700\u6709\u552F\u4E00\u7684\u8CA8\u865F\uFF0F\u54C1\u540D\u8868\u982D\uFF0C\u8ACB\u78BA\u8A8D\u5DE5\u4F5C\u8868");
  const { rows, index, map, sheetName } = candidates[0], bySku = /* @__PURE__ */ new Map();
  const costColumns = rows[index].flatMap((v, i) => text(v) === "\u6210\u672C\u50F9" ? [i] : []);
  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i], sheet = workbook.Sheets[sheetName];
    const cell = sheet[XLSX2.utils.encode_cell({ r: i, c: map.sku })];
    const rawSku = cell?.t === "s" && typeof cell.v === "string" ? cell.v : row[map.sku];
    if (cell?.t === "d" || cell?.t === "n" && XLSX2.SSF.is_date(cell.z || "") || /^INVALID DATE$/i.test(text(rawSku))) throw new Error(`\u5546\u54C1\u4E3B\u6A94\u7B2C${i + 1}\u5217\u8CA8\u865F\u70BA\u65E5\u671F\uFF0C\u8ACB\u6539\u70BA\u5B8C\u6574\u6587\u5B57\u8CA8\u865F`);
    const sku = text(rawSku).toUpperCase(), name = text(row[map.name]);
    if (!sku && !name) continue;
    if (!sku || !name) throw new Error(`\u5546\u54C1\u4E3B\u6A94\u7B2C${i + 1}\u5217\u7F3A\u5C11\u8CA8\u865F\u6216\u54C1\u540D`);
    const record = Object.fromEntries(Object.keys(aliases).map((k) => [k, text(row[map[k]])]));
    record.sku = sku;
    record.costSnapshot = { sku, value: costColumns.length === 1 ? text(row[costColumns[0]]) : null, field: "\u6210\u672C\u50F9", masterVersion: version, status: costColumns.length === 1 ? "provided" : "missing_or_ambiguous" };
    record.discontinued = /^(是|1|true|停用|已下架)$/i.test(record.discontinued) || /停用|已下架/.test(record.status);
    if (!bySku.has(sku)) bySku.set(sku, []);
    const signature = JSON.stringify(record);
    if (!bySku.get(sku).some((r) => JSON.stringify(r) === signature)) bySku.get(sku).push(record);
  }
  if (!bySku.size) throw new Error("\u5546\u54C1\u4E3B\u6A94\u6C92\u6709\u53EF\u7528\u8CC7\u6599");
  return { version, sheetName, bySku, count: bySku.size };
}
function matchProduct(master2, sku) {
  const key2 = text(sku).toUpperCase(), matches = master2?.bySku.get(key2) || [];
  return { status: matches.length === 1 ? "unique" : matches.length ? "ambiguous" : "missing", matches };
}
function nameCategories(value) {
  const normalized = text(value);
  return [["\u5E8A\u5305", /床包|床罩/], ["\u6795\u5957", /枕套|枕頭套/], ["\u6795\u982D", /枕頭(?!套)|枕芯|好眠枕|高中枕|高枕|低枕/], ["\u6BDB\u5DFE", /毛巾|浴巾|手巾|方巾/], ["\u88AB\u5957", /被套/], ["\u88AB\u5B50", /冷被|涼被|棉被|羽絨被/]].filter(([, pattern]) => pattern.test(normalized)).map(([category]) => category);
}
function nameReference(officialName, paperName) {
  const actual = nameCategories(officialName), reference = nameCategories(paperName);
  const conflict = !!text(paperName) && actual.length > 0 && reference.length > 0 && !actual.some((c) => reference.includes(c));
  return { conflict, message: conflict ? "\u624B\u5BEB\u54C1\u540D\u8207\u6B63\u5F0F\u54C1\u540D\u7684\u5546\u54C1\u985E\u578B\u4E0D\u540C\uFF0C\u8ACB\u6838\u5C0D\u5B8C\u6574\u8CA8\u865F\uFF1B\u4E0D\u6703\u81EA\u52D5\u63DB\u54C1" : "" };
}
function applyProduct(item, product, { manual = false } = {}) {
  return { ...item, costSnapshot: product.costSnapshot ? structuredClone(product.costSnapshot) : null, sku: product.sku, name: product.name, color: product.color || "", size: product.size || "", colorCode: product.colorCode || "", sizeCode: product.sizeCode || "", discontinued: !!product.discontinued, matchStatus: manual ? "selected" : "unique", manualConfirmed: manual, nameHintAcknowledged: false };
}
function searchProducts(master2, query, limit = 10) {
  const normalize = (v) => text(v).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  const q = normalize(query);
  if (!q || !master2) return [];
  const grams = new Set(Array.from({ length: Math.max(0, q.length - 1) }, (_, i) => q.slice(i, i + 2))), ranked = [];
  for (const records of master2.bySku.values()) for (const record of records) {
    const sku = normalize(record.sku), name = normalize(`${record.name}${record.color || ""}${record.size || ""}`);
    let score = sku === q ? 1e4 : sku.includes(q) ? 1e3 : name.includes(q) ? 500 : 0;
    if (!score && !nameReference(record.name, query).conflict) {
      for (const gram of grams) if (name.includes(gram)) score++;
    }
    if (score) ranked.push({ record, score });
  }
  return ranked.sort((a, b) => b.score - a.score || a.record.sku.localeCompare(b.record.sku, "zh-Hant")).slice(0, Math.max(1, Math.min(30, limit))).map((r) => r.record);
}
var normalizeProductText = (value) => text(value).toLowerCase().replace(/呎/g, "\u5C3A").replace(/[\s\p{P}\p{S}]/gu, "");
function reverseProduct(master2, item) {
  if (text(item.sku)) return { status: "existing", matches: [] };
  const query = normalizeProductText(item.paperName);
  if (!master2 || query.length < 4 || /^(同上|贈品|商品|床包|枕套|浴巾|毛巾|被套|枕頭)$/.test(query)) return { status: "insufficient", matches: [] };
  const matches = [];
  for (const records of master2.bySku.values()) for (const record of records) {
    const full = normalizeProductText(`${record.name}${record.color || ""}${record.size || ""}`);
    const size = normalizeProductText(item.paperSize || ""), color = normalizeProductText(item.paperColor || "");
    if (full.includes(query) && (!size || full.includes(size)) && (!color || full.includes(color)) && !nameReference(record.name, item.paperName).conflict) matches.push(record);
  }
  return { status: matches.length === 1 ? "unique" : matches.length ? "ambiguous" : "missing", matches };
}
function applyReverseProduct(item, product) {
  if (text(item.sku)) throw Error("\u5DF2\u6709\u8CA8\u865F\uFF0C\u4E0D\u4EE5\u54C1\u540D\u8986\u5BEB");
  return { ...applyProduct(item, product), matchStatus: "name_auto", manualConfirmed: false, reverseLookupConfirmed: false, reverseEvidence: text(item.paperName) };
}
function priceGroupValidation(order, complete = false) {
  const errors = [], warnings = [], groups = order.priceGroups ?? [], ids = /* @__PURE__ */ new Set(), assigned = /* @__PURE__ */ new Set();
  if (!Array.isArray(groups) || groups.length > 50) return { errors: ["\u7D44\u5408\u91D1\u984D\u8CC7\u6599\u683C\u5F0F\u932F\u8AA4"], warnings };
  for (const group of groups) {
    const id = text(group?.id), rows = order.items.filter((item) => item.priceGroupId === id);
    if (!id || id.length > 80 || ids.has(id)) {
      errors.push("\u7D44\u5408\u91D1\u984D\u8B58\u5225\u91CD\u8907\u6216\u7A7A\u767D");
      continue;
    }
    ids.add(id);
    if (rows.length < 2) {
      errors.push(`\u7D44\u5408 ${id} \u81F3\u5C11\u9700\u5305\u542B\u5169\u5217\u5546\u54C1`);
      continue;
    }
    let target;
    try {
      target = cents(group.amount);
    } catch {
      errors.push(`\u7D44\u5408 ${id} \u5408\u8A08\u91D1\u984D\u7121\u6548`);
      continue;
    }
    if (![void 0, "allocated", "total_only"].includes(group.pricingMode)) {
      errors.push(`\u7D44\u5408 ${id} \u8A08\u50F9\u6A21\u5F0F\u932F\u8AA4`);
      continue;
    }
    if (group.pricingMode === "total_only") {
      rows.forEach((item) => assigned.add(item));
      if (rows.some((item) => item.unitPrice !== "" && item.unitPrice !== null && item.unitPrice !== void 0)) errors.push(`\u7D44\u5408 ${id} \u53EA\u63A1\u6574\u7D44\u7E3D\u50F9\uFF0C\u5404\u5217\u55AE\u50F9\u5FC5\u9808\u7559\u7A7A\uFF0C\u4E0D\u80FD\u91CD\u8907\u8A08\u50F9`);
      if (complete && group.totalConfirmed !== true) errors.push(`\u7D44\u5408 ${id} \u6574\u7D44\u7E3D\u50F9\u5C1A\u672A\u78BA\u8A8D`);
      warnings.push(`\u7D44\u5408 ${id}\uFF1A${rows.length}\u5217\u5171\u7528 ${target / 100} \u5143\uFF0C\u53EA\u8A08\u4E00\u6B21\uFF0C\u4E0D\u62C6\u5206\u5404\u5217\u50F9\u683C`);
      continue;
    }
    let allocated = null;
    try {
      allocated = rows.reduce((n, item) => n + item.quantity * cents(item.unitPrice), 0);
    } catch {
    }
    rows.forEach((item) => assigned.add(item));
    const repeated = target > 0 && rows.filter((item) => {
      try {
        return item.quantity * cents(item.unitPrice) === target;
      } catch {
        return false;
      }
    }).length > 1;
    if (repeated) errors.push(`\u7D44\u5408 ${id} \u7684\u6574\u7D44\u91D1\u984D\u91CD\u8907\u586B\u5165\u591A\u5217\uFF0C\u8ACB\u52FF\u91CD\u8907\u8A08\u50F9`);
    warnings.push(`\u7D44\u5408 ${id}\uFF1A${rows.length}\u5217\u5171\u7528 ${target / 100} \u5143\uFF0C\u53EA\u8A08\u4E00\u6B21\uFF1B\u5404\u5217\u6210\u4EA4\u50F9\u9808\u78BA\u8A8D\u5206\u914D`);
    if (complete && (allocated !== target || group.allocationConfirmed !== true)) errors.push(`\u7D44\u5408 ${id} \u5C1A\u672A\u78BA\u8A8D\u5404\u5217\u5206\u914D\uFF0C\u6216\u5206\u914D\u5408\u8A08\u4E0D\u7B49\u65BC\u6574\u7D44\u91D1\u984D`);
  }
  if (order.items.some((item) => text(item.priceGroupId) && !assigned.has(item))) errors.push("\u5546\u54C1\u5217\u9023\u7D50\u7684\u7D44\u5408\u91D1\u984D\u4E0D\u5B58\u5728\u6216\u4E0D\u5B8C\u6574");
  return { errors, warnings };
}
function assertConservation(orders, rows) {
  const expected = orders.reduce((a, o) => a + totals(o).quantity, 0);
  if (rows.length !== orders.reduce((a, o) => a + o.items.length, 0) || rows.reduce((a, r) => a + r[16], 0) !== expected) throw new Error("\u8F38\u51FA\u5217\u6578\u6216\u4EF6\u6578\u4E0D\u5B88\u6046\uFF0C\u5DF2\u505C\u6B62\u7522\u6A94");
  for (const order of orders) {
    const group = rows.filter((r) => r[0] === order.paperNumber), t = totals(order);
    const paid = group.reduce((n, r) => n + r.slice(17).reduce((a, v) => a + cents(v === "" ? 0 : v), 0), 0);
    if (group.length !== order.items.length || paid !== t.paidCents) throw new Error("\u8F38\u51FA\u6536\u6B3E\u6216\u54C1\u9805\u4E0D\u5B88\u6046\uFF0C\u5DF2\u505C\u6B62\u7522\u6A94");
  }
}
function posRows(orders, { mode = "test" } = {}) {
  if (mode !== "test") throw new Error("ERP \u8A08\u50F9\u3001\u6536\u6B3E\u53CA\u6DF7\u5408\u92B7\u5225\u5C1A\u672A\u9A57\u8B49\uFF0C\u7981\u6B62\u6B63\u5F0F\u7522\u6A94");
  const numbers = /* @__PURE__ */ new Set();
  const rows = orders.flatMap((order) => {
    const validation = validateOrder(order, { complete: true });
    if (validation.errors.length) throw new Error(validation.errors.join("\uFF1B"));
    if (numbers.has(order.paperNumber)) throw new Error("\u7D19\u672C\u55AE\u865F\u91CD\u8907\uFF0C\u5DF2\u505C\u6B62\u7522\u6A94");
    numbers.add(order.paperNumber);
    return order.items.map((item, i) => [order.paperNumber, order.businessDate.replaceAll("-", "/"), ...warehouses(order.storeCode, item.saleType), "", item.saleType, "\u6E2C\u8A66\u6A94\u30FB\u672A\u5B8C\u6210ERP\u9A57\u6536", text(item.sku), text(item.color), text(item.colorCode), text(item.size), text(item.sizeCode), "", "", 100, item.quantity, ...PAYMENTS.map((k) => i === 0 ? cents(order.payments[k]) / 100 : "")]);
  });
  assertConservation(orders, rows);
  return rows;
}
function buildPOS(orders, XLSX2, options) {
  const rows = posRows(orders, options), wb = XLSX2.utils.book_new();
  const ws = XLSX2.utils.aoa_to_sheet([["POS\u55AE\u4FE1\u606F", "", "", "", "", "", "", "", "\u8CA8\u54C1\u4FE1\u606F", "", "", "", "", "", "", "", "", "\u6536\u6B3E\u65B9\u5F0F", "", "", ""], POS_HEADERS, ...rows]);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }, { s: { r: 0, c: 8 }, e: { r: 0, c: 16 } }, { s: { r: 0, c: 17 }, e: { r: 0, c: 20 } }];
  rows.forEach((row, r) => row.forEach((v, c) => {
    const cell = ws[XLSX2.utils.encode_cell({ r: r + 2, c })];
    if (cell && typeof v === "string") {
      cell.t = "s";
      delete cell.f;
      cell.z = "@";
    }
  }));
  XLSX2.utils.book_append_sheet(wb, ws, "Sheet1");
  return wb;
}

// store-orders/google.js
var token = "";
var client = null;
function configure(clientId) {
  if (!clientId || !globalThis.google?.accounts?.oauth2) throw Error("Google \u6388\u6B0A\u5143\u4EF6\u5C1A\u672A\u5C31\u7DD2\uFF0C\u8ACB\u7A0D\u5F8C\u91CD\u8A66");
  client = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: "openid email https://www.googleapis.com/auth/drive.readonly", include_granted_scopes: false, callback: () => {
  } });
}
async function authorize() {
  if (!client) throw Error("\u8ACB\u5148\u5B8C\u6210\u516C\u53F8\u5DE5\u5177\u767B\u5165");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error("Google \u6388\u6B0A\u903E\u6642\uFF0C\u8ACB\u91CD\u8A66")), 12e4);
    client.callback = (r) => {
      clearTimeout(timeout);
      if (r.error || !r.access_token) return reject(Error("Google \u6388\u6B0A\u5931\u6557"));
      token = r.access_token;
      resolve();
    };
    client.error_callback = () => {
      clearTimeout(timeout);
      reject(Error("Google \u6388\u6B0A\u5DF2\u53D6\u6D88\uFF0C\u8ACB\u91CD\u8A66"));
    };
    client.requestAccessToken({ prompt: token ? "" : "select_account", hd: "siangapato.com.tw" });
  });
}
function clear() {
  token = "";
  client = null;
}
async function request(path, options = {}, upload2 = false) {
  if (!token) throw Error("\u8ACB\u5148\u6309\u300C\u6388\u6B0A\u516C\u53F8\u96F2\u7AEF\u786C\u789F\u300D");
  const r = await fetch(`https://www.googleapis.com/${upload2 ? "upload/" : ""}drive/v3/${path}`, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  if (r.status === 401) {
    token = "";
    throw Error("Google \u6388\u6B0A\u5DF2\u904E\u671F\uFF0C\u8ACB\u91CD\u65B0\u6388\u6B0A");
  }
  if (!r.ok) throw Error("\u516C\u53F8\u96F2\u7AEF\u64CD\u4F5C\u672A\u6210\u529F\uFF0C\u8ACB\u78BA\u8A8D\u5E33\u865F\u3001\u6B0A\u9650\u6216\u984D\u5EA6\u5F8C\u91CD\u8A66");
  return r;
}
async function verifyIdentity(expected) {
  const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok || (await r.json()).email?.toLowerCase() !== expected.toLowerCase()) {
    clear();
    throw Error("\u96F2\u7AEF\u5E33\u865F\u8207\u516C\u53F8\u5DE5\u5177\u767B\u5165\u5E33\u865F\u4E0D\u540C\uFF0C\u8ACB\u91CD\u65B0\u767B\u5165");
  }
}
async function upload(file, session) {
  if (session.completed) return { id: session.fileId };
  const url = new URL(session.uploadUrl);
  if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com") throw Error("\u4E0A\u50B3\u4F4D\u7F6E\u4E0D\u6B63\u78BA\uFF0C\u5DF2\u505C\u6B62");
  const r = await fetch(url.href, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!r.ok) throw Error("\u7167\u7247\u4E0A\u50B3\u672A\u78BA\u8A8D\u6210\u529F\uFF0C\u8ACB\u66F4\u65B0\u65B0\u55AE\u6E05\u55AE\u5F8C\u518D\u91CD\u8A66");
  return r.json();
}
async function download(id) {
  return (await request(`files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`)).blob();
}
async function latestMaster(folderId) {
  const files = [];
  let page = "";
  do {
    const query = new URLSearchParams({ q: `'${folderId}' in parents and trashed=false and mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`, supportsAllDrives: "true", includeItemsFromAllDrives: "true", fields: "nextPageToken,files(id,name,modifiedTime)", pageSize: "100", ...page ? { pageToken: page } : {} });
    const data = await (await request(`files?${query}`)).json();
    files.push(...data.files || []);
    page = data.nextPageToken || "";
  } while (page);
  files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  if (!files.length || files[0].modifiedTime === files[1]?.modifiedTime) throw Error("\u5546\u54C1\u4E3B\u6A94\u6C92\u6709\u552F\u4E00\u7684\u6700\u65B0\u6A94\uFF0C\u8ACB\u78BA\u8A8D\u8CC7\u6599\u593E");
  return { blob: await download(files[0].id), version: `${files[0].id}:${files[0].modifiedTime}` };
}

// store-orders/runtime.js
var VersionGuard = class {
  constructor(fetcher = (...args) => fetch(...args)) {
    this.fetcher = fetcher;
    this.blocked = true;
    this.current = "";
  }
  async check() {
    try {
      const r = await this.fetcher(`${typeof location !== "undefined" && location.pathname.startsWith("/store-orders/guest/") ? "/store-orders/guest" : "/store-orders"}/version.json?check=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
      if (!r.ok) throw Error();
      const v = await r.json();
      this.current = v.version;
      this.blocked = v.version !== VERSION;
    } catch {
      this.blocked = true;
    }
    return !this.blocked;
  }
  async require() {
    if (!await this.check()) throw new Error("\u7121\u6CD5\u78BA\u8A8D\u7248\u672C\u6216\u7248\u672C\u4E0D\u540C\uFF0C\u8ACB\u91CD\u65B0\u8F09\u5165\u6700\u65B0\u7248");
  }
  reloadUrl() {
    return `/store-orders/?deploy=${encodeURIComponent(this.current || VERSION)}&reload=${Date.now()}`;
  }
};

// store-orders/media.js
var BASE = `${typeof location !== "undefined" && location.pathname.startsWith("/store-orders/guest/") ? "/store-orders/guest" : "/store-orders"}/vendor/${VERSION}/`;
async function pagesFor(file) {
  if (file.size > 2e7) throw Error("\u6BCF\u500B\u6A94\u6848\u6700\u591A20MB\uFF0C\u8ACB\u5206\u9801\u62CD\u651D\u6216\u58D3\u7E2E");
  const type = file.type || (/\.heic$/i.test(file.name || "") ? "image/heic" : "");
  if (type === "application/pdf") {
    const pdfjs = await import(`${BASE}pdf/pdf.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${BASE}pdf/pdf.worker.mjs`;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true, cMapUrl: `${BASE}pdf/cmaps/`, cMapPacked: true, standardFontDataUrl: `${BASE}pdf/standard_fonts/` }).promise;
    if (pdf.numPages > 30) {
      await pdf.destroy();
      throw Error("\u55AE\u4E00\u6A94\u6848\u6700\u591A30\u9801");
    }
    const pages = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i), original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 2200 / Math.max(original.width, original.height)) });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        pages.push(await new Promise((resolve) => canvas.toBlob(resolve, "image/png")));
        page.cleanup();
        canvas.width = canvas.height = 0;
      }
    } finally {
      await pdf.destroy();
    }
    return pages;
  }
  if (["image/heic", "image/heif"].includes(type)) {
    try {
      const { heicTo } = await import(`${BASE}heic/heic-to.min.js`);
      const converted = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
      return Array.isArray(converted) ? converted : [converted];
    } catch {
      throw Error("\u6B64HEIC\u7167\u7247\u7121\u6CD5\u8F49\u63DB\uFF0C\u8ACB\u5728\u624B\u6A5F\u6539\u7528JPEG\u6216\u91CD\u65B0\u62CD\u7167");
    }
  }
  if (!["image/jpeg", "image/png"].includes(type)) throw Error("\u8ACB\u9078JPEG\u3001PNG\u3001HEIC\u6216PDF\uFF1B\u4E0D\u652F\u63F4\u7684\u683C\u5F0F\u8ACB\u8F49\u6A94");
  try {
    const image = await createImageBitmap(file);
    if (image.width * image.height > 4e7) throw Error();
    image.close();
  } catch {
    throw Error("\u7167\u7247\u7121\u6CD5\u958B\u555F\u6216\u5C3A\u5BF8\u904E\u5927\uFF0C\u8ACB\u91CD\u65B0\u62CD\u7167\u6216\u7E2E\u5C0F");
  }
  return [file];
}

// store-orders/image-input.js
var BAND_RANGES = [[0, 0.36], [0.28, 0.74], [0.66, 1]];
function imagePlan(width, height, { full = true } = {}) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 4e7) throw Error("\u5716\u7247\u5C3A\u5BF8\u7121\u6548\u6216\u904E\u5927");
  const scale = Math.min(1, 4096 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const overviewScale = full ? Math.min(1, 2200 / Math.max(w, h)) : 1;
  return { width: w, height: h, overview: { width: Math.max(1, Math.round(w * overviewScale)), height: Math.max(1, Math.round(h * overviewScale)) }, bands: full ? BAND_RANGES.map(([top, bottom]) => ({ x: 0, y: Math.floor(h * top), width: w, height: Math.ceil(h * bottom) - Math.floor(h * top) })) : [] };
}
function prepareImageInput(image, { left = 0, right = 100, top = 0, bottom = 100, full = true } = {}) {
  if (![left, right, top, bottom].every(Number.isFinite) || left < 0 || right > 100 || top < 0 || bottom > 100 || left >= right || top >= bottom) throw Error("\u8ACB\u8F38\u5165\u6709\u6548\u88C1\u5207\u7BC4\u570D");
  if (full && (left !== 0 || right !== 100 || top !== 0 || bottom !== 100)) throw Error("\u5B8C\u6574\u55AE\u9808\u4FDD\u7559\u6574\u5F35\u7167\u7247\uFF0C\u8ACB\u91CD\u65B0\u7522\u751F\u9810\u89BD");
  const width = Math.max(1, Math.round(image.width * (right - left) / 100)), height = Math.max(1, Math.round(image.height * (bottom - top) / 100)), plan = imagePlan(width, height, { full });
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, image.width * left / 100, image.height * top / 100, width, height, 0, 0, canvas.width, canvas.height);
  const encode = (x, y, width2, height2, outWidth = width2, outHeight = height2) => {
    const c = document.createElement("canvas");
    c.width = outWidth;
    c.height = outHeight;
    c.getContext("2d").drawImage(canvas, x, y, width2, height2, 0, 0, outWidth, outHeight);
    return c.toDataURL("image/jpeg", 0.95);
  };
  return { preview: encode(0, 0, plan.width, plan.height), image: encode(0, 0, plan.width, plan.height, plan.overview.width, plan.overview.height), detailImages: plan.bands.map((b) => encode(b.x, b.y, b.width, b.height)), plan };
}

// store-orders/bundle-pricing.js
var abs = (x) => x < 0n ? -x : x;
function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}
function egcd(a, b) {
  let x = 1n, y = 0n, u = 0n, v = 1n;
  while (b) {
    const q = a / b;
    [a, b] = [b, a % b];
    [x, u] = [u, x - q * u];
    [y, v] = [v, y - q * v];
  }
  return { g: a, x, y };
}
function floor(a, b) {
  return a >= 0n ? a / b : -((-a + b - 1n) / b);
}
var ceil = (a, b) => -floor(-a, b);
function costUnits(value) {
  const s = text(value);
  if (s.length > 24 || !/^\d+(?:\.\d{1,6})?$/.test(s)) throw Error("\u4E3B\u6A94\u6210\u672C\u50F9\u7F3A\u6F0F\u6216\u7121\u6548");
  const [a, b = ""] = s.split("."), n = BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0"));
  if (n <= 0n || n > 1000000000000000n) throw Error("\u4E3B\u6A94\u6210\u672C\u50F9\u9700\u70BA\u6B63\u6578\uFF0C\u96F6\u6210\u672C\u4E0D\u80FD\u81EA\u52D5\u62C6\u50F9");
  return n;
}
function pair(total, a, b, ca, cb) {
  if (total < 0n) return null;
  const { g, x, y } = egcd(a, b);
  if (total % g) return null;
  const u = x * (total / g), v = y * (total / g), da = b / g, db = a / g, lo = ceil(-u, da), hi = floor(v, db);
  if (lo > hi) return null;
  const den = ca * a + cb * b, k = floor(total * ca - u * den, den * da);
  let best = null;
  for (let candidate of [k, k + 1n, lo, hi]) {
    candidate = candidate < lo ? lo : candidate > hi ? hi : candidate;
    const p = u + da * candidate, q = v - db * candidate, error = abs(p * den - total * ca);
    if (!best || error < best.error) best = { p, q, error };
  }
  return [best.p, best.q];
}
function allocateBundle(order, group) {
  const entries = order.items.flatMap((item, index) => item.priceGroupId === group.id ? [{ item, index }] : []);
  if (entries.length < 2) throw Error("\u7D44\u5408\u81F3\u5C11\u5169\u5217\u5546\u54C1");
  const cents2 = BigInt(cents(group.amount));
  if (cents2 % 100n) throw Error("\u7D44\u5408\u7E3D\u50F9\u542B\u5C0F\u6578\uFF0C\u7121\u6CD5\u4FDD\u6301\u6574\u5143\u55AE\u50F9\u53CA\u539F\u7E3D\u984D\uFF0C\u8ACB\u5148\u78BA\u8A8D\u6210\u4EA4\u7E3D\u984D");
  const total = cents2 / 100n, quantities = entries.map(({ item }) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw Error("\u7D44\u5408\u6578\u91CF\u7121\u6548");
    return BigInt(item.quantity);
  }), costs = entries.map(({ item, index }) => {
    try {
      if (item.costSnapshot?.sku !== text(item.sku).toUpperCase() || item.costSnapshot?.field !== "\u6210\u672C\u50F9" || !text(item.costSnapshot?.masterVersion) || item.costSnapshot?.status !== "provided") throw Error("\u4E3B\u6A94\u6210\u672C\u50F9\u5FEB\u7167\u7F3A\u6F0F\uFF0C\u8ACB\u91CD\u65B0\u9078\u7528\u5546\u54C1");
      return costUnits(item.costSnapshot.value);
    } catch (e) {
      throw Error(`\u7B2C${index + 1}\u5217${e.message}`);
    }
  }), weight = costs.reduce((n, c, i) => n + c * quantities[i], 0n);
  const base = costs.map((c) => (2n * total * c + weight) / (2n * weight)), difference = total - base.reduce((n, p, i) => n + p * quantities[i], 0n);
  let prices = difference === 0n ? [...base] : null;
  if (!prices && abs(difference) <= 200000n) {
    const direction = difference > 0n ? 1n : -1n, target = Number(abs(difference)), paths = new Array(target + 1);
    paths[0] = 0n;
    const indices = entries.map((_, i) => i).filter((i) => total * costs[i] % weight !== 0n && (direction > 0n ? base[i] === total * costs[i] / weight : base[i] > total * costs[i] / weight)).sort((i, j) => {
      const a = total * costs[i] % weight, b = total * costs[j] % weight;
      return a === b ? j - i : (a > b ? -1 : 1) * Number(direction);
    });
    let reachable = 0;
    for (const i of indices) {
      const q = Number(quantities[i]);
      reachable = Math.min(target, reachable + q);
      for (let n = reachable; n >= q; n--) if (paths[n] === void 0 && paths[n - q] !== void 0) paths[n] = paths[n - q] | 1n << BigInt(i);
      if (paths[target] !== void 0) break;
    }
    if (paths[target] !== void 0) prices = base.map((p, i) => p + (paths[target] & 1n << BigInt(i) ? direction : 0n));
  }
  if (!prices) {
    const pairs = [];
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) pairs.push({ i, j, g: gcd(quantities[i], quantities[j]) });
    pairs.sort((a, b) => a.g < b.g ? -1 : a.g > b.g ? 1 : a.i - b.i || a.j - b.j);
    for (const { i, j } of pairs) {
      const rest = base.reduce((n, p, k) => k === i || k === j ? n : n + p * quantities[k], 0n), answer = pair(total - rest, quantities[i], quantities[j], costs[i], costs[j]);
      if (answer) {
        prices = [...base];
        [prices[i], prices[j]] = answer;
        break;
      }
    }
  }
  if (!prices || prices.some((p, i) => p < 0n || abs(p * weight - total * costs[i]) > weight)) throw Error("\u6B64\u7D44\u5408\u6578\u91CF\u8207\u7E3D\u50F9\u7121\u6CD5\u5728\u6210\u672C\u6BD4\u4F8B\u7684\u6574\u5143\u5C3E\u5DEE\u5167\u5B88\u6046\uFF0C\u8ACB\u4EBA\u5DE5\u78BA\u8A8DERP\u62C6\u50F9\u898F\u5247");
  const lines = entries.map(({ item, index }, i) => ({ index, sku: item.sku, quantity: item.quantity, unitCost: String(item.costSnapshot.value), costField: item.costSnapshot.field, masterVersion: item.costSnapshot.masterVersion, unitPrice: Number(prices[i]), amountCents: Number(prices[i] * quantities[i] * 100n), weightShare: Number(costs[i] * quantities[i]) / Number(weight) }));
  if (lines.reduce((n, l) => n + l.amountCents, 0) !== Number(cents2)) throw Error("\u7D44\u5408\u62C6\u50F9\u91D1\u984D\u4E0D\u5B88\u6046");
  return { groupId: group.id, paperCode: group.paperCode || "", amountCents: Number(cents2), method: "cost-weighted-unit-integer-v1", lines };
}
function resolvedERPPrices(order) {
  const prices = /* @__PURE__ */ new Map(), groups = [];
  for (const [i, item] of order.items.entries()) if (!totalOnlyGroup(order, item)) prices.set(i, cents(item.unitPrice) / 100);
  for (const group of order.priceGroups || []) if (group.pricingMode === "total_only") {
    const allocation = allocateBundle(order, group);
    groups.push(allocation);
    for (const line of allocation.lines) prices.set(line.index, line.unitPrice);
  }
  return { prices, groups };
}

// store-orders/pos-template.js
var BASE_HEADERS = Object.freeze(["\u55AE\u865F", "\u7D50\u5E33\u65E5\u671F", "\u958B\u55AE\u5009\u5EAB", "\u51FA\u8CA8\u5009\u5EAB", "\u53D6\u8CA8\u5009\u5EAB", "\u6703\u54E1\u7DE8\u865F", "\u59D3\u540D", "\u96FB\u8A71", "\u5730\u5740", "\u5099\u8A3B", "\u4E2D\u4FE1\u4FE1\u7528\u5361", "\u73FE\u91D1", "\u767E\u8CA8\u73FE\u91D1\u5377", "LinePay", "\u92B7\u5225", "\u8CA8\u865F", "\u6578\u91CF", "\u984F\u8272", "\u8272\u865F", "\u5C3A\u78BC", "\u78BC\u865F", "\u8D08\u54C1", "\u5C0E\u8CFC", "\u5BE6\u6536\u7387"]);
var PRICE_HEADERS = ["\u50F9\u683C"];
var FINAL_HEADERS = Object.freeze([...BASE_HEADERS.slice(0, 17), "\u50F9\u683C", ...BASE_HEADERS.slice(17)]);
var TEMPLATE_WRITE_OPTIONS = Object.freeze({ bookType: "xlsx", type: "array" });
function readPOSTemplate(wb, XLSX2) {
  if (wb.SheetNames.length !== 1 || wb.SheetNames[0] !== "Sheet1") throw Error("POS\u7BC4\u672C\u9700\u70BA\u55AE\u4E00Sheet1\u5DE5\u4F5C\u8868");
  const ws = wb.Sheets.Sheet1, rows = XLSX2.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }), headers = (rows[1] || []).map(text);
  const prices = headers.filter((h) => PRICE_HEADERS.includes(h));
  if (JSON.stringify(headers) !== JSON.stringify(FINAL_HEADERS)) throw Error("POS\u7BC4\u672C\u6B04\u4F4D\u8207\u6700\u7D4225\u6B04\u683C\u5F0F\u4E0D\u7B26\uFF0CR\u6B04\u9808\u70BA\u50F9\u683C\uFF0C\u8ACB\u4F7F\u7528\u5DE5\u7A0B\u5E2B\u78BA\u8A8D\u7248");
  if (headers.some((h, c) => ws[XLSX2.utils.encode_cell({ r: 1, c })]?.f)) throw Error("POS\u7BC4\u672C\u6B04\u540D\u4E0D\u5F97\u4F7F\u7528\u516C\u5F0F");
  const cells = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < headers.length; c++) {
    const cell = ws[XLSX2.utils.encode_cell({ r, c })];
    if (cell?.f) throw Error("POS\u7BC4\u672C\u8868\u982D\u4E0D\u5F97\u4F7F\u7528\u516C\u5F0F");
    if (cell) cells.push({ r, c, value: cell.v ?? "", style: cell.s ? structuredClone(cell.s) : null, format: cell.z || null });
  }
  return { headers, priceHeader: prices[0] || "", cells, merges: structuredClone(ws["!merges"] || []).filter((m) => m.s.r === 0 && m.e.r === 0 && m.e.c < headers.length), format: "20261030-final" };
}
function revisedPOSErrors(orders, { template, paymentMappingConfirmed = false } = {}) {
  const errors = [];
  if (!template) errors.push("\u8ACB\u8F09\u5165\u542B\u6BCF\u5217\u55AE\u50F9\u7684\u6700\u7D42POS\u7BC4\u672C");
  else if (JSON.stringify(template.headers) !== JSON.stringify(FINAL_HEADERS) || template.priceHeader !== "\u50F9\u683C") errors.push("\u8ACB\u91CD\u65B0\u8F09\u5165R\u6B04\u70BA\u50F9\u683C\u7684\u6700\u7D4225\u6B04POS\u7BC4\u672C");
  if (!paymentMappingConfirmed) errors.push("\u4ED8\u6B3E\u6B04\u4F4D\u5C0D\u7167\u5C1A\u672A\u78BA\u8A8D\uFF0C\u8ACB\u6838\u5C0D\u56DB\u7A2E\u4ED8\u6B3E\u65B9\u5F0F");
  for (const o of orders) try {
    resolvedERPPrices(o);
  } catch (e) {
    errors.push(e.message);
  }
  return errors;
}
function revisedPOSRows(orders, profile2 = {}) {
  const errors = revisedPOSErrors(orders, profile2);
  if (errors.length) throw Error(errors.join("\uFF1B"));
  const numbers = /* @__PURE__ */ new Set();
  return orders.flatMap((order) => {
    const check = validateOrder(order, { complete: true });
    if (check.errors.length) throw Error(check.errors.join("\uFF1B"));
    if (numbers.has(order.paperNumber)) throw Error("\u7D19\u672C\u55AE\u865F\u91CD\u8907\uFF0C\u5DF2\u505C\u6B62\u7522\u6A94");
    numbers.add(order.paperNumber);
    const resolved = resolvedERPPrices(order);
    return order.items.map((item, i) => {
      const [billing, shipping, pickup] = warehouses(order.storeCode, item.saleType);
      const value = { "\u55AE\u865F": order.paperNumber, "\u7D50\u5E33\u65E5\u671F": order.businessDate.replaceAll("-", "/"), "\u958B\u55AE\u5009\u5EAB": billing, "\u51FA\u8CA8\u5009\u5EAB": shipping, "\u53D6\u8CA8\u5009\u5EAB": pickup, "\u6703\u54E1\u7DE8\u865F": "", "\u59D3\u540D": String(order.customer?.name ?? ""), "\u96FB\u8A71": String(order.customer?.phone ?? ""), "\u5730\u5740": String(order.customer?.address ?? ""), "\u5099\u8A3B": String(order.note ?? ""), "\u4E2D\u4FE1\u4FE1\u7528\u5361": i === 0 ? cents(order.payments["\u4E2D\u4FE1\u4FE1\u7528\u5361"]) / 100 : "", "\u73FE\u91D1": i === 0 ? cents(order.payments["\u73FE\u91D1"]) / 100 : "", "\u767E\u8CA8\u73FE\u91D1\u5377": i === 0 ? cents(order.payments["\u767E\u8CA8\u73FE\u91D1\u5377"]) / 100 : "", "LinePay": i === 0 ? cents(order.payments.LinePay) / 100 : "", "\u92B7\u5225": item.saleType, "\u8CA8\u865F": text(item.sku), "\u6578\u91CF": item.quantity, "\u984F\u8272": text(item.color), "\u8272\u865F": text(item.colorCode), "\u5C3A\u78BC": text(item.size), "\u78BC\u865F": text(item.sizeCode), "\u8D08\u54C1": "", "\u5C0E\u8CFC": "", "\u5BE6\u6536\u7387": 100, [profile2.template.priceHeader]: resolved.prices.get(i) };
      return profile2.template.headers.map((h) => value[h]);
    });
  });
}
function assertRevisedPOSConservation(orders, rows, headers) {
  const col = (h) => headers.indexOf(h), expectedRows = orders.reduce((n, o) => n + o.items.length, 0);
  if (rows.length !== expectedRows || rows.some((r) => r.length !== headers.length)) throw Error("\u65B0\u7248POS\u5217\u6578\u6216\u6B04\u6578\u4E0D\u5B88\u6046");
  for (const o of orders) {
    const actual = rows.filter((r) => r[col("\u55AE\u865F")] === o.paperNumber), t = totals(o);
    let qty = 0, amount = 0, paid = 0;
    if (actual.length !== o.items.length) throw Error("\u65B0\u7248POS\u54C1\u9805\u5217\u6578\u4E0D\u5B88\u6046");
    const priceCol = headers.findIndex((h) => PRICE_HEADERS.includes(h)), resolved = resolvedERPPrices(o);
    for (const [i, r] of actual.entries()) {
      const item = o.items[i];
      if (r[col("\u8CA8\u865F")] !== text(item.sku) || r[col("\u6578\u91CF")] !== item.quantity || r[priceCol] !== resolved.prices.get(i) || r[col("\u92B7\u5225")] !== item.saleType || JSON.stringify(["\u958B\u55AE\u5009\u5EAB", "\u51FA\u8CA8\u5009\u5EAB", "\u53D6\u8CA8\u5009\u5EAB"].map((h) => r[col(h)])) !== JSON.stringify(warehouses(o.storeCode, item.saleType))) throw Error("\u65B0\u7248POS\u8CA8\u865F\u3001\u6578\u91CF\u3001\u50F9\u683C\u6216\u5009\u5EAB\u4E0D\u5B88\u6046");
      qty += r[col("\u6578\u91CF")];
      amount += r[col("\u6578\u91CF")] * cents(r[priceCol]);
      paid += ["\u4E2D\u4FE1\u4FE1\u7528\u5361", "\u73FE\u91D1", "\u767E\u8CA8\u73FE\u91D1\u5377", "LinePay"].reduce((n, h) => n + cents(r[col(h)] === "" ? 0 : r[col(h)]), 0);
    }
    if (qty !== t.quantity || amount !== t.amountCents || paid !== t.paidCents) throw Error("\u65B0\u7248POS\u4EF6\u6578\u3001\u6210\u4EA4\u91D1\u984D\u6216\u4ED8\u6B3E\u4E0D\u5B88\u6046");
    for (const [header, key2] of [["\u4E2D\u4FE1\u4FE1\u7528\u5361", "\u4E2D\u4FE1\u4FE1\u7528\u5361"], ["\u73FE\u91D1", "\u73FE\u91D1"], ["\u767E\u8CA8\u73FE\u91D1\u5377", "\u767E\u8CA8\u73FE\u91D1\u5377"], ["LinePay", "LinePay"]]) {
      const sum = actual.reduce((n, r) => n + cents(r[col(header)] === "" ? 0 : r[col(header)]), 0);
      if (sum !== cents(o.payments[key2])) throw Error("\u65B0\u7248POS\u4ED8\u6B3E\u65B9\u5F0F\u5C0D\u7167\u6216\u5404\u9805\u91D1\u984D\u4E0D\u5B88\u6046");
    }
  }
}
function buildRevisedPOS(orders, XLSX2, profile2 = {}) {
  const rows = revisedPOSRows(orders, profile2), t = profile2.template;
  assertRevisedPOSConservation(orders, rows, t.headers);
  const ws = XLSX2.utils.aoa_to_sheet([[], t.headers, ...rows]);
  for (const cell of t.cells) {
    const k = XLSX2.utils.encode_cell({ r: cell.r, c: cell.c });
    ws[k] = { t: typeof cell.value === "number" ? "n" : "s", v: cell.value, ...cell.style ? { s: structuredClone(cell.style) } : {}, ...cell.format ? { z: cell.format } : {} };
  }
  ws["!ref"] = XLSX2.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length + 1, c: t.headers.length - 1 } });
  ws["!merges"] = structuredClone(t.merges);
  let start = 2;
  for (const order of orders) {
    const end = start + order.items.length - 1;
    for (let c = 0; c < 14; c++) {
      let first = start;
      for (let r = start + 1; r <= end + 1; r++) {
        const same = r <= end && (c >= 10 || rows[r - 2][c] === rows[first - 2][c]);
        if (same) continue;
        if (r - first > 1) {
          ws["!merges"].push({ s: { r: first, c }, e: { r: r - 1, c } });
          for (let covered = first + 1; covered < r; covered++) delete ws[XLSX2.utils.encode_cell({ r: covered, c })];
        }
        first = r;
      }
    }
    start = end + 1;
  }
  rows.forEach((row, r) => row.forEach((v, c) => {
    const cell = ws[XLSX2.utils.encode_cell({ r: r + 2, c })];
    if (cell && typeof v === "string") {
      cell.t = "s";
      delete cell.f;
      cell.z = "@";
    }
  }));
  const wb = XLSX2.utils.book_new();
  XLSX2.utils.book_append_sheet(wb, ws, "Sheet1");
  const roundtrip = XLSX2.read(XLSX2.write(wb, TEMPLATE_WRITE_OPTIONS), READ_OPTIONS);
  assertMergedPOSConservation(orders, roundtrip, XLSX2, t.headers);
  return wb;
}
function assertMergedPOSConservation(orders, wb, XLSX2, headers) {
  const ws = wb.Sheets.Sheet1, rows = XLSX2.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }).slice(2);
  const expected = revisedPOSRows(orders, { template: { headers, priceHeader: "\u50F9\u683C" }, paymentMappingConfirmed: true });
  const boundaries = [];
  let at = 2;
  for (const o of orders) {
    boundaries.push({ start: at, end: at + o.items.length - 1 });
    at += o.items.length;
  }
  const covered = /* @__PURE__ */ new Set();
  for (const m of ws["!merges"] || []) {
    if (m.s.r === 0 && m.e.r === 0) continue;
    if (!Number.isInteger(m.s.r) || !Number.isInteger(m.e.r) || m.e.r <= m.s.r || m.s.c !== m.e.c || m.s.c < 0 || m.s.c >= 14 || !boundaries.some((b) => m.s.r >= b.start && m.e.r <= b.end)) throw Error("POS\u5408\u4F75\u7BC4\u570D\u8DE8\u55AE\u6216\u8986\u84CB\u5546\u54C1\u660E\u7D30");
    for (let r = m.s.r; r <= m.e.r; r++) {
      const key2 = r + ":" + m.s.c;
      if (covered.has(key2)) throw Error("POS\u5408\u4F75\u7BC4\u570D\u91CD\u758A");
      covered.add(key2);
      if (r === m.s.r) continue;
      const value = rows[r - 2]?.[m.s.c];
      if (value !== "" && value !== void 0) throw Error("POS\u5408\u4F75\u7BC4\u570D\u542B\u96B1\u85CF\u8CC7\u6599");
      if (m.s.c < 10) {
        if (expected[r - 2][m.s.c] !== expected[m.s.r - 2][m.s.c]) throw Error("POS\u5408\u4F75\u7BC4\u570D\u542B\u4E0D\u540C\u5009\u5EAB\u6216\u8A02\u55AE\u8CC7\u8A0A");
        rows[r - 2][m.s.c] = rows[m.s.r - 2][m.s.c];
      }
    }
  }
  if (JSON.stringify(rows) !== JSON.stringify(expected)) throw Error("POS\u5408\u4F75\u5F8C\u8CC7\u8A0A\u8207\u8986\u6838\u5167\u5BB9\u4E0D\u4E00\u81F4");
  assertRevisedPOSConservation(orders, rows, headers);
  return rows;
}

// store-orders/recognition.js
var EXTRACTION_SCHEMA = { type: "object", additionalProperties: false, required: ["rows", "sharedPrices", "warnings"], properties: {
  rows: { type: "array", items: { type: "object", additionalProperties: false, required: ["row", "sku", "paperName", "quantity", "unitPrice", "saleType", "gift", "uncertain", "groupCode"], properties: { groupCode: { type: "string" }, row: { type: "integer" }, sku: { type: "string" }, paperName: { type: "string" }, quantity: { type: ["integer", "null"] }, unitPrice: { type: ["number", "null"] }, saleType: { type: "string", enum: ["\u92B7\u8CA8", "\u8A02\u8CA8", ""] }, gift: { type: "boolean" }, uncertain: { type: "boolean" } } } },
  sharedPrices: { type: "array", items: { type: "object", additionalProperties: false, required: ["rows", "amount"], properties: { rows: { type: "array", items: { type: "integer" } }, amount: { type: ["number", "null"] } } } },
  warnings: { type: "array", items: { type: "string" } }
} };
function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((k) => keys.includes(k)) && keys.every((k) => Object.hasOwn(value, k));
}
function validateExtractionShape(data) {
  if (data && Object.hasOwn(data, "header")) return validateFullExtraction(data);
  if (!exactKeys(data, ["rows", "sharedPrices", "warnings"]) || !Array.isArray(data.rows) || !data.rows.length || data.rows.length > 100 || !Array.isArray(data.sharedPrices) || data.sharedPrices.length > 50 || !Array.isArray(data.warnings) || data.warnings.length > 100 || data.warnings.some((x) => typeof x !== "string" || x.length > 500)) throw Error("\u8FA8\u8B58\u56DE\u50B3\u683C\u5F0F\u932F\u8AA4\u6216\u6C92\u6709\u5546\u54C1\u5217\uFF0C\u8ACB\u91CD\u65B0\u8FA8\u8B58\u6216\u4EBA\u5DE5\u8F38\u5165");
  const ids = /* @__PURE__ */ new Set();
  for (const r of data.rows) {
    if (!exactKeys(r, Object.hasOwn(r, "groupCode") ? ["row", "sku", "paperName", "quantity", "unitPrice", "saleType", "gift", "uncertain", "groupCode"] : ["row", "sku", "paperName", "quantity", "unitPrice", "saleType", "gift", "uncertain"]) || Object.hasOwn(r, "groupCode") && (typeof r.groupCode !== "string" || r.groupCode.length > 20) || !Number.isSafeInteger(r.row) || r.row < 1 || r.row > 100 || ids.has(r.row) || typeof r.sku !== "string" || r.sku.length > 80 || typeof r.paperName !== "string" || r.paperName.length > 200 || !(r.quantity === null || Number.isSafeInteger(r.quantity) && r.quantity > 0 && r.quantity <= 1e5) || !["\u92B7\u8CA8", "\u8A02\u8CA8", ""].includes(r.saleType) || typeof r.gift !== "boolean" || typeof r.uncertain !== "boolean") throw Error("\u8FA8\u8B58\u5546\u54C1\u5217\u683C\u5F0F\u932F\u8AA4\uFF0C\u5DF2\u505C\u6B62\u63A1\u7528");
    if (r.unitPrice !== null) {
      if (typeof r.unitPrice !== "number") throw Error("\u8FA8\u8B58\u6210\u4EA4\u50F9\u683C\u5F0F\u932F\u8AA4");
      cents(r.unitPrice);
    }
    ids.add(r.row);
  }
  const grouped = /* @__PURE__ */ new Set();
  for (const g of data.sharedPrices) {
    if (!exactKeys(g, ["rows", "amount"]) || !Array.isArray(g.rows) || g.rows.length < 2 || new Set(g.rows).size !== g.rows.length || g.rows.some((n) => !ids.has(n) || grouped.has(n))) throw Error("\u8FA8\u8B58\u7D44\u5408\u5217\u865F\u91CD\u8907\u6216\u4E0D\u5B58\u5728");
    g.rows.forEach((n) => grouped.add(n));
    if (g.amount !== null) {
      if (typeof g.amount !== "number") throw Error("\u8FA8\u8B58\u7D44\u5408\u91D1\u984D\u683C\u5F0F\u932F\u8AA4");
      cents(g.amount);
    }
  }
  return data;
}
function normalizeCodedGroups(data) {
  if (!data.rows.some((r) => text(r.groupCode))) return data;
  const out = structuredClone(data), codes = /* @__PURE__ */ new Map();
  for (const row of out.rows) {
    if (!text(row.groupCode)) continue;
    const code = row.groupCode.trim().normalize("NFC").replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/^組合\s*/, "").toUpperCase();
    if (!code || code.length > 20 || !/[\p{L}\p{N}\p{P}\p{S}]/u.test(code) || !/^[\p{L}\p{N}\p{P}\p{S}\uFE0E\uFE0F]+$/u.test(code)) throw Error("\u8FA8\u8B58\u7D44\u5408\u4EE3\u865F\u7121\u6548\uFF0C\u8ACB\u4EBA\u5DE5\u78BA\u8A8D");
    row.groupCode = code;
    if (!codes.has(code)) codes.set(code, []);
    codes.get(code).push(row);
  }
  for (const [code, rows] of codes) {
    if (rows.length < 2) throw Error(`\u8FA8\u8B58\u7D44\u5408 ${code} \u53EA\u6709\u4E00\u5217\uFF0C\u8ACB\u78BA\u8A8D\u6F0F\u5217\u6216\u4EE3\u865F`);
    const ids = new Set(rows.map((r) => r.row)), overlaps = out.sharedPrices.filter((g) => g.rows.some((n) => ids.has(n)));
    if (overlaps.length > 1 || overlaps.some((g) => g.rows.length !== ids.size || g.rows.some((n) => !ids.has(n)))) throw Error(`\u8FA8\u8B58\u7D44\u5408 ${code} \u7684\u5217\u865F\u8207\u4EE3\u865F\u4E0D\u4E00\u81F4\uFF0C\u8ACB\u4EBA\u5DE5\u78BA\u8A8D`);
    const existing = overlaps[0], values = [...rows.map((r) => r.unitPrice), existing?.amount].filter((v) => v !== null && v !== void 0), amounts = [...new Set(values.map((v) => cents(v)))];
    const unresolved = out.warnings.some((w) => w.startsWith(`\u7D44\u5408 ${code} \u586B\u5165\u4E0D\u540C\u7E3D\u91D1\u984D`));
    const amount = amounts.length === 1 && !unresolved ? amounts[0] / 100 : null;
    const warning = amounts.length > 1 ? `\u7D44\u5408 ${code} \u586B\u5165\u4E0D\u540C\u7E3D\u91D1\u984D\uFF08${amounts.map((v) => v / 100).join("\u3001")}\uFF09\uFF0C\u8ACB\u4EBA\u5DE5\u78BA\u8A8D\uFF0C\u4E0D\u6703\u76F8\u52A0\u6216\u9078\u503C` : amounts.length === 0 ? `\u7D44\u5408 ${code} \u7F3A\u5C11\u7E3D\u91D1\u984D\uFF0C\u8ACB\u4EBA\u5DE5\u78BA\u8A8D` : "";
    if (warning && !out.warnings.includes(warning)) out.warnings.push(warning);
    if (existing) existing.amount = amount;
    else out.sharedPrices.push({ rows: rows.map((r) => r.row), amount });
  }
  return out;
}
function validateExtraction(data) {
  const checked = validateExtractionShape(data);
  return validateExtractionShape(normalizeCodedGroups(checked));
}
function extractionOrder(data, master2) {
  data = validateExtraction(data);
  const order = newOrder("sample-validation-001", "R00", "2026-10-23");
  order.paperNumber = "DEID-SAMPLE";
  order.clerk = "\u9A57\u8B49\u4EBA\u54E1";
  order.paperRowCount = data.rows.length;
  order.masterVersion = master2?.version || "";
  order.priceGroups = [];
  order.items = data.rows.map((r) => {
    let item = { sku: text(r.sku).toUpperCase(), paperName: r.paperName, name: "", color: "", size: "", quantity: r.quantity, unitPrice: r.unitPrice === null ? "" : r.unitPrice, saleType: r.saleType, zeroConfirmed: false, matchStatus: "missing", manualConfirmed: false, recognitionUncertain: r.uncertain };
    const found = matchProduct(master2, item.sku);
    if (found.status === "unique") item = applyProduct(item, found.matches[0]);
    else if (!item.sku) {
      const reverse = reverseProduct(master2, item);
      if (reverse.status === "unique") item = applyReverseProduct(item, reverse.matches[0]);
    }
    return item;
  });
  for (const [i, g] of data.sharedPrices.entries()) {
    const paperCode = data.rows.find((r) => g.rows.includes(r.row) && r.groupCode)?.groupCode || "", id = paperCode ? /^[A-Z0-9][A-Z0-9-]{0,11}$/.test(paperCode) ? `paper-${paperCode}` : `paper-mark-${i + 1}` : `shared-${i + 1}`;
    order.priceGroups.push({ id, paperCode, amount: g.amount === null ? "" : g.amount, pricingMode: "total_only", totalConfirmed: false });
    for (const n of g.rows) {
      const item = order.items[data.rows.findIndex((r) => r.row === n)];
      item.priceGroupId = id;
      item.unitPrice = "";
    }
  }
  if (data.header) {
    const h = data.header;
    order.paperNumber = h.paperNumber;
    order.storeCode = h.storeCode;
    order.businessDate = normalizePaperDate(h.businessDate);
    order.clerk = h.clerk;
    order.customer = { ...h.customer };
    order.note = h.note;
    order.paperRowCount = h.paperRowCount;
    order.pageCount = h.pageCount;
    order.paperTotal = data.paperTotal === null ? "" : data.paperTotal;
    order.payments = Object.fromEntries(PAYMENTS.map((k) => [k, data.payments[k] === null ? "" : data.payments[k]]));
    order.headerRecognition = { confirmed: false, uncertainFields: [...h.uncertainFields], pageNumber: h.pageNumber, rawDate: h.businessDate, synthetic: true };
  }
  return order;
}
var FULL_EXTRACTION_SCHEMA = { type: "object", additionalProperties: false, required: ["header", "payments", "paperTotal", "rows", "sharedPrices", "warnings"], properties: {
  ...EXTRACTION_SCHEMA.properties,
  header: { type: "object", additionalProperties: false, required: ["paperNumber", "storeCode", "businessDate", "clerk", "pageNumber", "pageCount", "paperRowCount", "customer", "note", "uncertainFields"], properties: { paperNumber: { type: "string" }, storeCode: { type: "string" }, businessDate: { type: "string" }, clerk: { type: "string" }, pageNumber: { type: ["integer", "null"] }, pageCount: { type: ["integer", "null"] }, paperRowCount: { type: ["integer", "null"] }, customer: { type: "object", additionalProperties: false, required: ["name", "phone", "address"], properties: { name: { type: "string" }, phone: { type: "string" }, address: { type: "string" } } }, note: { type: "string" }, uncertainFields: { type: "array", items: { type: "string" } } } },
  payments: { type: "object", additionalProperties: false, required: [...PAYMENTS], properties: Object.fromEntries(PAYMENTS.map((k) => [k, { type: ["number", "null"] }])) },
  paperTotal: { type: ["number", "null"] }
} };
function normalizePaperDate(value) {
  const raw = text(value);
  if (validDate(raw)) return raw;
  const parts = raw.match(/^(\d{2,4})\s*(?:年|[./-])\s*(\d{1,2})\s*(?:月|[./-])\s*(\d{1,2})\s*日?$/);
  if (!parts) return "";
  const year = Number(parts[1]) + (parts[1].length <= 3 ? 1911 : 0), date = `${year}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}`;
  return validDate(date) ? date : "";
}
function validateFullExtraction(data) {
  if (!exactKeys(data, ["header", "payments", "paperTotal", "rows", "sharedPrices", "warnings"])) throw Error("\u5B8C\u6574\u55AE\u8FA8\u8B58\u683C\u5F0F\u932F\u8AA4");
  validateExtractionShape({ rows: data.rows, sharedPrices: data.sharedPrices, warnings: data.warnings });
  const h = data.header, keys = ["paperNumber", "storeCode", "businessDate", "clerk", "pageNumber", "pageCount", "paperRowCount", "customer", "note", "uncertainFields"];
  if (!exactKeys(h, keys) || !["paperNumber", "storeCode", "businessDate", "clerk", "note"].every((k) => typeof h[k] === "string" && h[k].length <= (k === "note" ? 1e3 : 100)) || !exactKeys(h.customer, ["name", "phone", "address"]) || !Object.values(h.customer).every((v) => typeof v === "string" && v.length <= 500) || !Array.isArray(h.uncertainFields) || h.uncertainFields.length > 30 || h.uncertainFields.some((v) => typeof v !== "string" || v.length > 100)) throw Error("\u5B8C\u6574\u55AE\u8868\u982D\u683C\u5F0F\u932F\u8AA4\uFF0C\u96FB\u8A71\u9808\u4FDD\u7559\u6587\u5B57\u578B\u5225");
  for (const k of ["pageNumber", "pageCount", "paperRowCount"]) if (h[k] !== null && (!Number.isSafeInteger(h[k]) || h[k] < 1 || h[k] > (k === "paperRowCount" ? 100 : 30))) throw Error("\u5B8C\u6574\u55AE\u9801\u78BC\u6216\u5546\u54C1\u5217\u6578\u683C\u5F0F\u932F\u8AA4");
  if (!exactKeys(data.payments, [...PAYMENTS])) throw Error("\u5B8C\u6574\u55AE\u4ED8\u6B3E\u6B04\u4F4D\u683C\u5F0F\u932F\u8AA4");
  for (const value of [...Object.values(data.payments), data.paperTotal]) if (value !== null) {
    if (typeof value !== "number") throw Error("\u5B8C\u6574\u55AE\u91D1\u984D\u683C\u5F0F\u932F\u8AA4");
    cents(value);
  }
  return data;
}

// store-orders/review.js
function reviewDraft(raw, master2) {
  const o = useTotalOnlyGroups(extractionOrder(raw, master2));
  o.id = crypto.randomUUID();
  o.sources = [];
  o.reviewed = false;
  o.status = "pending";
  return o;
}
function confirmItem(item, confirmed) {
  for (const k of ["manualConfirmed", "recognitionConfirmed", "reverseLookupConfirmed", "zeroConfirmed", "nameHintAcknowledged"]) item[k] = confirmed;
  item.reviewConfirmed = confirmed;
}
function confirmReview(order, value) {
  order.reviewed = value;
  if (order.headerRecognition) order.headerRecognition.confirmed = value;
  order.items.forEach((i) => confirmItem(i, value));
  (order.priceGroups || []).forEach((g) => {
    if (g.pricingMode === "total_only") g.totalConfirmed = value;
    else g.allocationConfirmed = value;
  });
}
function reviewErrors(order, { imagePresent = false, sourceConfirmed = false, existingNumbers = [], expectedStore = "", allowMultiPage = false, sourcePageCount = 0 } = {}) {
  const errors = validateOrder(order, { complete: true }).errors.filter((e) => !e.includes("\u8FA8\u8B58\u6709\u7591\u7FA9"));
  if (!imagePresent || !sourceConfirmed) errors.push("\u8ACB\u8F09\u5165\u4E26\u78BA\u8A8D\u5B8C\u6574\u539F\u5716\u8207\u9801\u6578");
  if (allowMultiPage && sourcePageCount !== order.pageCount) errors.push("\u539F\u5716\u9801\u6578\u8207\u8A02\u55AE\u7E3D\u9801\u6578\u4E0D\u7B26\uFF0C\u8ACB\u6536\u9F4A\u6240\u6709\u9801");
  if (!allowMultiPage && (order.pageCount !== 1 || order.headerRecognition?.pageNumber !== 1)) errors.push("\u6B64\u6E2C\u8A66\u8986\u6838\u9801\u53EA\u652F\u63F4\u5B8C\u6574\u55AE\u9801\uFF1B\u591A\u9801\u8ACB\u56DE\u9580\u5E02\u5DE5\u5177\u6536\u9F4A\u6240\u6709\u9801");
  if (expectedStore && text(order.storeCode).toUpperCase() !== text(expectedStore).toUpperCase()) errors.push("\u8A02\u55AE\u9580\u5E02\u8207\u76EE\u524D\u9580\u5E02\u4EE3\u865F\u4E0D\u540C\uFF0C\u8ACB\u6838\u5C0D\u4E26\u4FEE\u6B63");
  if (existingNumbers.includes(text(order.paperNumber))) errors.push("\u8A02\u55AE\u7DE8\u865F\u5DF2\u5B58\u5728\uFF0C\u8ACB\u78BA\u8A8D\u91CD\u8907\u55AE");
  if (validDate(order.businessDate) && (Number(order.businessDate.slice(0, 4)) < 2e3 || Number(order.businessDate.slice(0, 4)) > Number(taipeiDate().slice(0, 4)) + 1)) errors.push("\u696D\u52D9\u65E5\u671F\u5E74\u4EFD\u7570\u5E38\uFF0C\u8ACB\u4FEE\u6B63\u5F8C\u518D\u8986\u6838");
  const missingPrices = order.items.flatMap((i, n) => !totalOnlyGroup(order, i) && (i.unitPrice === "" || i.unitPrice === null || i.unitPrice === void 0) ? [n + 1] : []);
  return [...new Set(errors.filter((e) => !(missingPrices.length && e === "\u91D1\u984D\u9808\u70BA\u975E\u8CA0\u6578\uFF0C\u6700\u591A\u5169\u4F4D\u5C0F\u6578")).map((e) => {
    for (const g of order.priceGroups || []) {
      const rows = order.items.flatMap((i, n) => i.priceGroupId === g.id ? [n + 1] : []);
      e = e.replace(`\u7D44\u5408 ${g.id}`, `\u7B2C${rows.join("\u3001")}\u5217\u7D44\u5408`);
    }
    return e.replace(/第(\d+)列成交單價錯誤/g, (_, n) => `\u7B2C${n}\u5217\u8ACB\u586B\u6709\u6548\u6210\u4EA4\u55AE\u50F9${order.items[Number(n) - 1]?.priceGroupId ? "\uFF08\u5728\u8A72\u7D44\u5408\u7684\u5206\u914D\u5340\u586B\u5BEB\uFF09" : ""}`);
  }))];
}
function reviewWorkbook(order, XLSX2) {
  const wb = XLSX2.utils.book_new(), t = totals(order);
  const rows = [["ERP\u532F\u5165\u6E2C\u8A66\u6838\u5C0D\u8868\uFF08\u672C\u6A94\u4E0D\u53EF\u532F\u5165ERP\uFF09"], ["\u7D19\u672C\u55AE\u865F", "\u9580\u5E02", "\u65E5\u671F", "\u5217\u6578", "\u4EF6\u6578", "\u6210\u4EA4\u7E3D\u984D", "\u4ED8\u6B3E\u5408\u8A08"], [order.paperNumber, order.storeCode, order.businessDate, t.rows, t.quantity, t.amountCents / 100, t.paidCents / 100], [], ["\u5E8F", "\u8CA8\u865F", "\u7D19\u672C\u54C1\u540D", "\u6B63\u5F0F\u54C1\u540D", "\u984F\u8272", "\u5C3A\u78BC", "\u6578\u91CF", "\u6210\u4EA4\u55AE\u50F9", "\u5C0F\u8A08", "\u92B7\u5225", "\u958B\u55AE\u5009\u5EAB", "\u51FA\u8CA8\u5009\u5EAB", "\u53D6\u8CA8\u5009\u5EAB", "\u7D44\u5408"], ...order.items.map((i, n) => [n + 1, i.sku, i.paperName, i.name, i.color, i.size, i.quantity, totalOnlyGroup(order, i) ? "" : Number(i.unitPrice), totalOnlyGroup(order, i) ? "" : i.quantity * cents(i.unitPrice) / 100, i.saleType, ...warehouses(order.storeCode, i.saleType), i.priceGroupId || ""]), [], ["\u4ED8\u6B3E\u65B9\u5F0F", "\u91D1\u984D"], ...PAYMENTS.map((k) => [k, Number(order.payments[k])]), [], ["\u6CE8\u610F", "\u65B0\u7248\u4F9D\u6240\u9078\u6700\u7D42\u7BC4\u672C\u9010\u5217\u532F\u5165\u55AE\u50F9\uFF1B\u820A\u7248\u4E0D\u542B\u55AE\u50F9\u3002\u9700\u5728ERP\u6838\u5C0D\u6210\u4EA4\u50F9\u3001\u7D44\u5408\u3001\u8D08\u54C1\u3001\u4ED8\u6B3E\u8207\u5009\u5EAB\u3002"]];
  const ws = XLSX2.utils.aoa_to_sheet(rows);
  for (const cell of Object.values(ws)) if (cell && typeof cell === "object" && typeof cell.v === "string") {
    cell.t = "s";
    delete cell.f;
    cell.z = "@";
  }
  XLSX2.utils.book_append_sheet(wb, ws, "\u6210\u4EA4\u50F9\u6838\u5C0D");
  let allocations = [];
  try {
    allocations = resolvedERPPrices(order).groups;
  } catch {
  }
  if (allocations.length) {
    const allocationSheet = XLSX2.utils.aoa_to_sheet([["\u7D44\u5408\u4EE3\u865F", "\u5217\u865F", "\u8CA8\u865F", "\u6578\u91CF", "\u55AE\u4EF6\u6210\u672C", "\u6210\u672C\u6B04\u4F4D", "\u4E3B\u6A94\u7248\u672C", "\u5206\u914D\u6BD4\u4F8B", "ERP\u55AE\u50F9", "\u5217\u91D1\u984D"], ...allocations.flatMap((a) => a.lines.map((l) => [a.paperCode || a.groupId, l.index + 1, l.sku, l.quantity, l.unitCost, l.costField, l.masterVersion, l.weightShare, l.unitPrice, l.amountCents / 100]))]);
    for (const c of Object.values(allocationSheet)) if (c && typeof c === "object" && typeof c.v === "string") {
      c.t = "s";
      delete c.f;
      c.z = "@";
    }
    XLSX2.utils.book_append_sheet(wb, allocationSheet, "\u7D44\u5408\u62C6\u50F9");
  }
  if (order.priceGroups?.length) {
    const groups = XLSX2.utils.aoa_to_sheet([["\u7D44\u5408\u4EE3\u865F", "\u5546\u54C1\u5217\u865F", "\u6574\u7D44\u7E3D\u91D1\u984D\uFF08\u53EA\u8A18\u4E00\u6B21\uFF09", "\u8A08\u50F9\u65B9\u5F0F"], ...order.priceGroups.map((g) => [g.paperCode || g.id, order.items.flatMap((i, n) => i.priceGroupId === g.id ? [n + 1] : []).join("\u3001"), Number(g.amount), g.pricingMode === "total_only" ? "\u7D19\u672C\u6574\u7D44\u7E3D\u50F9\uFF0CERP\u6309\u6210\u672C\u62C6\u50F9" : "\u6B77\u53F2\u5404\u5217\u5206\u914D"])]);
    for (const c of Object.values(groups)) if (c && typeof c === "object" && typeof c.v === "string") {
      c.t = "s";
      delete c.f;
      c.z = "@";
    }
    XLSX2.utils.book_append_sheet(wb, groups, "\u7D44\u5408\u7E3D\u50F9");
  }
  return wb;
}
var node = (tag, text2 = "", cls = "") => {
  const n = document.createElement(tag);
  n.textContent = text2;
  if (cls) n.className = cls;
  return n;
};
function createReview(root, { requireVersion, context, exportProfile = () => null, cloudMode = false }) {
  let original = null, master2 = null, order = null, image = "", sourceConfirmed = false, confirmedAt = "", edits = [], recognition = null;
  function confirmation(value) {
    confirmReview(order, value);
  }
  const changed = (path, before, after) => {
    if (JSON.stringify(before) !== JSON.stringify(after)) edits.push({ path, before: structuredClone(before), after: structuredClone(after), at: (/* @__PURE__ */ new Date()).toISOString() });
    confirmation(false);
    confirmedAt = "";
    root.querySelector("#review-all").checked = false;
    refresh2();
  };
  function field(parent, label, value, update, { type = "text", key: key2 = "", options = null } = {}) {
    const wrap = node("label", label), input = document.createElement(options ? "select" : "input");
    input.dataset.reviewField = key2;
    if (options) for (const v of options) {
      const opt = node("option", v || "\u8ACB\u9078\u64C7");
      opt.value = v;
      input.append(opt);
    }
    else {
      input.type = type;
      if (type === "number") {
        input.min = "0";
        input.step = "any";
      }
    }
    input.value = value ?? "";
    input.addEventListener("change", () => {
      const before = value, after = type === "number" ? input.value === "" ? "" : Number(input.value) : input.value;
      update(after);
      value = after;
      changed(key2, before, after);
    });
    wrap.append(input);
    parent.append(wrap);
    return input;
  }
  function check(parent, label, checked, fn, id = "") {
    const wrap = node("label", "", "check"), input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    if (id) input.id = id;
    input.onchange = () => fn(input.checked);
    wrap.append(input, document.createTextNode(label));
    parent.append(wrap);
    return input;
  }
  function button(parent, label, fn, cls = "secondary") {
    const b = node("button", label, cls);
    b.type = "button";
    b.onclick = fn;
    parent.append(b);
    return b;
  }
  function refresh2() {
    if (!order) return;
    const errors = reviewErrors(order, { imagePresent: Array.isArray(image) ? image.length > 0 : !!image, sourceConfirmed, existingNumbers: context().existingNumbers, expectedStore: context().expectedStore, allowMultiPage: cloudMode, sourcePageCount: context().sourcePageCount || 0 });
    const profile2 = exportProfile(), erpErrors = profile2 ? revisedPOSErrors([order], profile2) : [];
    const box = root.querySelector("#review-errors");
    box.replaceChildren();
    for (const e of [...errors, ...erpErrors]) box.append(node("p", e, "error"));
    for (const w of validateOrder(order, { complete: true }).warnings.filter((w2) => !w2.startsWith("\u7D44\u5408 "))) box.append(node("p", w, "warning"));
    for (const panel of root.querySelectorAll("[data-price-group]")) {
      const g = order.priceGroups.find((g2) => g2.id === panel.dataset.priceGroup), label = panel.querySelector("[data-group-summary]");
      const allocation = panel.querySelector("[data-group-allocation]");
      try {
        const a = allocateBundle(order, g);
        allocation.textContent = "\u4F9D\u4E3B\u6A94\u6210\u672C\u6BD4\u4F8B\u62C6\u50F9\uFF08\u55AE\u50F9\u56DB\u6368\u4E94\u5165\u70BA\u6574\u5143\u3001\u5C3E\u5DEE\u5B88\u6046\uFF09\uFF1A" + a.lines.map((l) => `\u7B2C${l.index + 1}\u5217 ${l.quantity}\u4EF6 \xD7 ${l.unitPrice}\u5143\uFF1D${l.amountCents / 100}\u5143`).join("\uFF1B") + "\uFF0C\u5408\u8A08" + a.amountCents / 100 + "\u5143\u3002";
      } catch (e) {
        allocation.textContent = context().guest ? "\u7D44\u5408\u7E3D\u50F9\u7531\u7E3D\u90E8\u7D50\u7B97\u6642\u4F9D\u6B63\u5F0F\u4E3B\u6A94\u6210\u672C\u62C6\u50F9\uFF1B\u8ACB\u5728\u6B64\u6838\u5C0D\u6574\u7D44\u7E3D\u50F9\u3002" : "\u81EA\u52D5\u62C6\u50F9\u5F85\u8655\u7406\uFF1A" + e.message;
      }
      try {
        label.textContent = `\u6574\u7D44 ${cents(g.amount) / 100} \u5143\uFF0C\u53EA\u8A08\u4E00\u6B21\uFF1BERP\u55AE\u50F9\u7531\u7CFB\u7D71\u6309\u6210\u672C\u6BD4\u4F8B\u56DB\u6368\u4E94\u5165\u70BA\u6574\u5143\u3002`;
        label.className = "success";
      } catch {
        label.textContent = "\u8ACB\u586B\u6709\u6548\u7684\u6574\u7D44\u7E3D\u91D1\u984D\u3002";
        label.className = "error";
      }
    }
    let total = "\u8ACB\u5148\u88DC\u9F4A\u5546\u54C1\u6578\u91CF\u53CA\u6210\u4EA4\u55AE\u50F9\uFF1B\u7D44\u5408\u5546\u54C1\u53EA\u9700\u5728\u8868\u683C\u5167\u586B\u6574\u7D44\u7E3D\u91D1\u984D\u3002";
    try {
      const t = totals(order);
      total = `${t.rows}\u5217\uFF0F${t.quantity}\u4EF6\uFF0F\u5546\u54C1\u5408\u8A08 ${t.amountCents / 100} \u5143\uFF0F\u4ED8\u6B3E ${t.paidCents / 100} \u5143`;
    } catch {
    }
    root.querySelector("#review-totals").textContent = total;
    root.querySelectorAll("[data-export]").forEach((b) => b.disabled = !!errors.length || b.dataset.export === "pos" && !!erpErrors.length);
    root.querySelector("#review-complete").textContent = confirmedAt && !errors.length && erpErrors.length ? "\u5DF2\u8986\u6838\uFF1B\u65B0\u7248POS\u5C0D\u63A5\u4ECD\u6709\u5F85\u78BA\u8A8D\u4E8B\u9805\uFF0C\u53EF\u5148\u4E0B\u8F09\u6838\u5C0D\u8868\u8207\u5099\u4EFD\u3002" : confirmedAt && !errors.length ? `\u5DF2\u8986\u6838\uFF08${new Date(confirmedAt).toLocaleString("zh-TW")}\uFF09\uFF0C${cloudMode ? "\u53EF\u4FDD\u5B58\u8986\u6838\u5167\u5BB9\u4E26\u4EA4\u63A5\u7E3D\u90E8\u3002" : "\u53EF\u4E0B\u8F09ERP\u6E2C\u8A66\u6A94\u3002"}` : confirmedAt ? "\u5DF2\u52FE\u9078\u6574\u55AE\u78BA\u8A8D\uFF0C\u4F46\u4ECD\u6709\u4E0B\u5217\u8CC7\u6599\u5F85\u4FEE\u6B63\uFF0C\u66AB\u6642\u7121\u6CD5\u4E0B\u8F09\u3002" : "\u8ACB\u5B8C\u6210\u8CC7\u6599\u4FEE\u6B63\uFF0C\u518D\u52FE\u9078\u6700\u4E0B\u65B9\u5169\u9805\u78BA\u8A8D\u3002";
    root.querySelector("#review-complete").className = confirmedAt && !errors.length ? "success" : "warning";
    root.querySelectorAll("[data-subtotal]").forEach((n) => {
      const i = order.items[Number(n.dataset.subtotal)];
      try {
        if (totalOnlyGroup(order, i)) {
          n.textContent = "\u542B\u65BC\u6574\u7D44\u7E3D\u50F9";
          return;
        }
        n.textContent = Number.isSafeInteger(i.quantity) ? String(i.quantity * cents(i.unitPrice) / 100) : "\u5F85\u586B";
      } catch {
        n.textContent = "\u5F85\u586B";
      }
    });
  }
  function groupPanel(g) {
    const panel = node("div", "", "inline-price-group");
    panel.dataset.priceGroup = g.id;
    const entries = order.items.flatMap((i, n) => i.priceGroupId === g.id ? [[i, n]] : []);
    panel.append(node("h4", `\u7D44\u5408 ${g.paperCode || ""}\uFF5C\u7B2C ${entries.map(([, n]) => n + 1).join("\u3001")} \u5217\u7D44\u5408\uFF5C\u7D19\u672C\u6574\u7D44\u7E3D\u50F9\uFF0CERP\u81EA\u52D5\u62C6\u50F9`));
    field(panel, "\u6574\u7D44\u7E3D\u91D1\u984D", g.amount, (v) => g.amount = v, { type: "number", key: `groups.${g.id}.amount` });
    panel.append(node("p", entries.map(([i, n]) => `\u7B2C${n + 1}\u5217 ${i.sku || "\u5F85\u586B\u8CA8\u865F"}\uFF5C${i.name || "\u5F85\u78BA\u8A8D\u54C1\u540D"}\uFF5C\u6578\u91CF ${i.quantity ?? "\u5F85\u586B"}`).join("\uFF1B")));
    const allocation = node("p", "", "notice");
    allocation.dataset.groupAllocation = "";
    panel.append(allocation);
    const summary = node("p");
    summary.dataset.groupSummary = "";
    panel.append(summary);
    if (!context().guest) button(panel, "\u4F9D\u76EE\u524D\u4E3B\u6A94\u53D6\u5F97\u672C\u7D44\u6210\u672C", () => {
      try {
        const before = entries.map(([i]) => i.costSnapshot || null), snapshots = entries.map(([item, n]) => {
          const match = matchProduct(master2, item.sku);
          if (match.status !== "unique") throw Error(`\u7B2C${n + 1}\u5217\u4E3B\u6A94\u672A\u552F\u4E00\u5C0D\u61C9\uFF0C\u7121\u6CD5\u53D6\u5F97\u6210\u672C`);
          const snapshot2 = match.matches[0].costSnapshot;
          costUnits(snapshot2?.value);
          return structuredClone(snapshot2);
        });
        entries.forEach(([item], n) => item.costSnapshot = snapshots[n]);
        changed("groups." + g.id + ".costSnapshots", before, snapshots);
        draw();
      } catch (e) {
        root.querySelector("#review-errors").prepend(node("p", e.message, "error"));
      }
    });
    button(panel, "\u53D6\u6D88\u6B64\u7D44\u5408\uFF0C\u6539\u70BA\u5404\u5217\u7368\u7ACB\u8A08\u50F9", () => {
      const before = structuredClone(g);
      order.items.forEach((i) => {
        if (i.priceGroupId === g.id) delete i.priceGroupId;
      });
      order.priceGroups = order.priceGroups.filter((x) => x !== g);
      changed("removeGroup", before, null);
      draw();
    });
    return panel;
  }
  function draw() {
    root.replaceChildren();
    if (!order) return;
    root.append(node("h3", "\u4F9D\u7D19\u672C\u4F4D\u7F6E\u4FEE\u6B63\u8207\u8986\u6838"));
    const restoreLabel = node("label", "\u6062\u5FA9\u4EBA\u5DE5\u8986\u6838\u5099\u4EFD\uFF08\u5148\u5099\u59A5\u76F8\u540C\u539F\u5716\uFF1B\u6062\u5FA9\u5F8C\u91CD\u65B0\u78BA\u8A8D\uFF09"), restoreInput = document.createElement("input");
    restoreInput.type = "file";
    restoreInput.accept = ".json,application/json";
    restoreInput.id = "review-restore";
    restoreLabel.append(restoreInput);
    root.append(restoreLabel);
    restoreInput.onchange = async () => {
      try {
        await requireVersion();
        const file = restoreInput.files[0];
        if (!file || file.size > 1e6) throw Error("\u8ACB\u90781MB\u5167\u7684\u4EBA\u5DE5\u8986\u6838\u5099\u4EFD");
        const b = JSON.parse(await file.text());
        if (![VERSION, "20261024-store-orders-r10", "20261024-store-orders-r11", "20261024-store-orders-r12", "20261024-store-orders-r13", "20261024-store-orders-r14", "20261025-store-orders-r15", "20261025-store-orders-r16", "20261029-store-orders-r17", "20261029-store-orders-r18", "20261029-store-orders-r19", "20261029-store-orders-r20", "20261029-store-orders-r21", "20261030-store-orders-r22", "20261030-store-orders-r23"].includes(b.version)) throw Error("\u5099\u4EFD\u7248\u672C\u4E0D\u540C\uFF0C\u8ACB\u78BA\u8A8D\u4F86\u6E90\u7248\u672C");
        if (!cloudMode || b.original?.rows?.length) validateExtraction(b.original);
        if (!b.original.header || JSON.stringify(b.original) !== JSON.stringify(original)) throw Error("\u5099\u4EFD\u8207\u76EE\u524D\u539F\u59CB\u8FA8\u8B58\u4E0D\u540C\uFF0C\u8ACB\u5148\u8F09\u5165\u540C\u4EFD\u539F\u8FA8\u8B58JSON\u8207\u539F\u5716");
        const o = b.reviewedOrder;
        if (!Array.isArray(o?.items) || o.items.some((i) => !i || typeof i !== "object") || !Array.isArray(o.priceGroups) || !o.headerRecognition || !Array.isArray(b.edits)) throw Error("\u4EBA\u5DE5\u8986\u6838\u5099\u4EFD\u683C\u5F0F\u932F\u8AA4");
        validateOrder(o);
        if (cloudMode && (o.id !== order.id || JSON.stringify(o.sources) !== JSON.stringify(order.sources))) throw Error("\u5099\u4EFD\u8A02\u55AE\u6216\u4F86\u6E90\u4E0D\u540C\uFF0C\u8ACB\u91CD\u65B0\u9078\u53D6");
        order = useTotalOnlyGroups(structuredClone(o));
        edits = structuredClone(b.edits);
        recognition = b.recognition || null;
        if (cloudMode) {
          if (o.id !== order.id || JSON.stringify(o.sources) !== JSON.stringify(order.sources)) throw Error("\u5099\u4EFD\u8A02\u55AE\u6216\u4F86\u6E90\u4E0D\u540C\uFF0C\u8ACB\u91CD\u65B0\u9078\u53D6");
        } else order.sources = [];
        order.reviewed = false;
        order.headerRecognition.confirmed = false;
        order.items.forEach((i) => confirmItem(i, false));
        order.priceGroups.forEach((g) => g.allocationConfirmed = false);
        sourceConfirmed = false;
        confirmedAt = "";
        draw();
      } catch (e) {
        root.querySelector("#review-errors").prepend(node("p", e.message, "error"));
      }
    };
    root.append(node("p", "\u5148\u7531\u4E0A\u5F80\u4E0B\u5C0D\u7167\u539F\u5716\uFF0C\u4FEE\u6B63\u8868\u982D\u3001\u5546\u54C1\u3001\u7D44\u5408\u7E3D\u50F9\u8207\u4ED8\u6B3E\u3002\u6838\u5C0D\u5B8C\u6210\u5F8C\uFF0C\u53EA\u9700\u52FE\u9078\u6700\u4E0B\u65B9\u5169\u9805\u78BA\u8A8D\u3002\u4FEE\u6B63\u50C5\u7559\u5728\u76EE\u524D\u5206\u9801\uFF0C\u96E2\u958B\u524D\u53EF\u4E0B\u8F09\u542B\u539F\u8FA8\u8B58\u53CA\u4FEE\u6B63\u7D00\u9304\u7684\u5099\u4EFD\u3002"));
    const layout = node("div", "", "paper-review-layout"), aside = node("aside", "", "paper-reference");
    aside.append(node("h4", "\u539F\u5716\u5C0D\u7167"));
    if (image && (Array.isArray(image) ? image.length : true)) {
      for (const imageURL of Array.isArray(image) ? image : [image]) {
        const a = node("a", "\u53E6\u958B\u539F\u5716\u653E\u5927");
        a.href = imageURL;
        a.target = "_blank";
        a.rel = "noopener";
        const img = node("img");
        img.src = imageURL;
        img.alt = "\u672C\u6B21\u5B8C\u6574\u8A02\u8CFC\u55AE\u9810\u89BD";
        aside.append(a, img);
      }
    } else aside.append(node("p", "\u5C1A\u7121\u539F\u5716\uFF0C\u8ACB\u5148\u9078\u7167\u7247\u4E26\u7522\u751F\u5B8C\u6574\u55AE\u9810\u89BD\uFF1B\u4E0D\u5F97\u50C5\u9760JSON\u7522\u6A94\u3002", "error"));
    layout.append(aside);
    const form = node("div", "", "paper-review-sheet");
    layout.append(form);
    root.append(layout);
    form.append(node("h3", "\u7FD4\u4ED4\u5C45\u5BB6\uFF5C\u9580\u5E02\u8A02\u8CFC\u55AE"));
    const head = node("div", "", "form-grid");
    form.append(head);
    field(head, "\u8A02\u55AE\u7DE8\u865F\uFF08\u6BCF\u55AE\u552F\u4E00\uFF09", order.paperNumber, (v) => order.paperNumber = v, { key: "paperNumber" }).parentElement.classList.add("wide");
    field(head, "\u9580\u5E02\uFF0F\u4EE3\u865F", order.storeCode, (v) => order.storeCode = text(v).toUpperCase(), { key: "storeCode" });
    field(head, "\u8A02\u8CFC\u65E5\u671F\uFF08\u897F\u5143\uFF09", order.businessDate, (v) => order.businessDate = v, { type: "date", key: "businessDate" });
    field(head, "\u7D93\u624B\u4EBA", order.clerk, (v) => order.clerk = v, { key: "clerk" });
    const pages = node("div", "", "form-grid");
    head.append(pages);
    field(pages, "\u9801\u78BC", order.headerRecognition.pageNumber, (v) => order.headerRecognition.pageNumber = v, { type: "number", key: "pageNumber" });
    field(pages, "\u5171\u5E7E\u9801", order.pageCount, (v) => order.pageCount = v, { type: "number", key: "pageCount" });
    field(head, "\u6574\u55AE\u5546\u54C1\u5217\u6578\uFF08\u8ACB\u7167\u7D19\u672C\u78BA\u8A8D\uFF09", order.paperRowCount, (v) => order.paperRowCount = v, { type: "number", key: "paperRowCount" });
    head.append(node("span", "", "paper-grid-space"));
    for (const [k, label] of [["name", "\u59D3\u540D"], ["phone", "\u96FB\u8A71\uFF08\u4FDD\u7559\u524D\u5C0E0\uFF09"], ["address", "\u5730\u5740"]]) {
      const input = field(head, label, order.customer[k], (v) => order.customer[k] = v, { key: `customer.${k}` });
      if (k === "address") input.parentElement.classList.add("wide");
    }
    form.append(node("p", `\u539F\u8FA8\u8B58\u65E5\u671F\uFF1A${original.header.businessDate || "\u672A\u8B80\u51FA"}\uFF1B\u7591\u7FA9\uFF1A${original.header.uncertainFields.join("\u3001") || "\u7121"}\u3002\u539F\u59CB\u8FA8\u8B58\u7D50\u679C\u4FDD\u7559\u65BC\u4E0B\u65B9\u8207\u5099\u4EFD\u4E2D\u3002`, "muted"));
    const scroll = node("div", "", "paper-table-scroll"), table = node("table", "", "paper-review-table"), thead = node("thead"), tr = node("tr");
    for (const title of ["\u5E8F", "\u5B8C\u6574\u8CA8\u865F", "\u54C1\u540D\uFF0F\u898F\u683C", "\u6578\u91CF", "\u6210\u4EA4\u55AE\u50F9", "\u5C0F\u8A08", "\u92B7\u5225"]) tr.append(node("th", title));
    thead.append(tr);
    table.append(thead);
    const body = node("tbody");
    table.append(body);
    scroll.append(table);
    form.append(scroll);
    order.items.forEach((item, index) => {
      const row = node("tr"), cell = () => {
        const td = node("td");
        row.append(td);
        return td;
      };
      cell().textContent = String(index + 1);
      const sku = cell();
      field(sku, "\u8CA8\u865F", item.sku, (v) => {
        item.sku = text(v).toUpperCase();
        const found = matchProduct(master2, item.sku);
        if (found.status === "unique") Object.assign(item, applyProduct(item, found.matches[0]));
        else Object.assign(item, { costSnapshot: null, name: "", color: "", size: "", colorCode: "", sizeCode: "", matchStatus: found.status });
        confirmItem(item, false);
        draw();
      }, { key: `items.${index}.sku` });
      const details = cell(), spec = node("details"), specTitle = node("summary", `${item.name || "\u5F85\u88DC\u6B63\u5F0F\u54C1\u540D"}\uFF5C${item.color || "\u7F3A\u984F\u8272"}\uFF5C${item.size || "\u7F3A\u5C3A\u78BC"}\uFF08\u4FEE\u6B63\uFF09`);
      spec.append(specTitle);
      spec.open = !item.name || !item.color || !item.size;
      details.append(spec);
      for (const [k, label] of [["name", "\u6B63\u5F0F\u54C1\u540D"], ["color", "\u984F\u8272"], ["colorCode", "\u984F\u8272\u7DE8\u78BC"], ["size", "\u5C3A\u78BC"], ["sizeCode", "\u5C3A\u78BC\u7DE8\u78BC"]]) field(spec, label, item[k], (v) => {
        item[k] = v;
        if (k === "color" || k === "size") {
          const code = k === "color" ? "colorCode" : "sizeCode";
          item[code] = "";
          root.querySelector(`[data-review-field="items.${index}.${code}"]`).value = "";
        }
        confirmItem(item, false);
        if (k !== "paperName") {
          item.matchStatus = "selected";
          item.manualConfirmed = false;
        }
      }, { key: `items.${index}.${k}` });
      button(details, "\u67E5\u627E\u5546\u54C1", () => {
        const old = details.querySelector(".review-candidates");
        old?.remove();
        const list = node("div", "", "review-candidates"), matches = searchProducts(master2, item.sku || item.paperName, 10);
        if (!matches.length) list.append(node("p", "\u67E5\u7121\u5019\u9078\uFF0C\u8ACB\u4FEE\u6B63\u8CA8\u865F\uFF0F\u7D19\u672C\u54C1\u540D\u6216\u4EBA\u5DE5\u88DC\u9F4A\u898F\u683C\u3002", "warning"));
        for (const p of matches) button(list, `${p.sku}\uFF5C${p.name}\uFF5C${p.color || "\u7F3A\u984F\u8272"}\uFF5C${p.size || "\u7F3A\u5C3A\u78BC"}`, () => {
          const before = structuredClone(item);
          Object.assign(item, applyProduct(item, p, { manual: true }));
          confirmItem(item, false);
          changed(`items.${index}.product`, before, item);
          draw();
        });
        details.append(list);
      });
      if (item.matchStatus === "name_auto") details.append(node("p", "\u7531\u54C1\u540D\u53CD\u67E5\uFF0C\u52D9\u5FC5\u6838\u5C0D\u8CA8\u865F", "warning"));
      if (item.discontinued) details.append(node("p", "\u505C\u7528\u54C1\u63D0\u9192\uFF08\u53EF\u4F7F\u7528\uFF09", "warning"));
      if (!["unique", "name_auto", "selected"].includes(item.matchStatus)) details.append(node("p", "\u672A\u552F\u4E00\u547D\u4E2D\u4E3B\u6A94\uFF1B\u8ACB\u88DC\u9F4A\u5F8C\u4EBA\u5DE5\u78BA\u8A8D", "warning"));
      for (const [k, label] of [["quantity", "\u6578\u91CF"], ["unitPrice", "\u6210\u4EA4\u55AE\u50F9"]]) {
        const td = cell();
        if (k === "unitPrice" && item.priceGroupId) {
          td.append(node("p", "\u63A1\u6574\u7D44\u7E3D\u50F9\uFF0C\u4E0D\u53E6\u586B\u55AE\u50F9"));
        } else field(td, label, item[k], (v) => {
          item[k] = v;
          confirmItem(item, false);
          if (k === "quantity" && item.priceGroupId) draw();
        }, { type: "number", key: `items.${index}.${k}` });
      }
      const subtotal = cell();
      subtotal.dataset.subtotal = index;
      const sales = cell();
      field(sales, "\u92B7\u5225", item.saleType, (v) => {
        item.saleType = v;
        confirmItem(item, false);
      }, { options: ["", "\u92B7\u8CA8", "\u8A02\u8CA8"], key: `items.${index}.saleType` });
      button(sales, "\u79FB\u9664\u6B64\u5217", () => {
        if (item.priceGroupId) {
          root.querySelector("#review-errors").prepend(node("p", "\u8ACB\u5148\u79FB\u9664\u6B64\u5217\u6240\u5C6C\u7D44\u5408\uFF0C\u518D\u522A\u9664\u5546\u54C1\u5217\u3002", "error"));
          return;
        }
        order.items.splice(index, 1);
        changed(`items.${index}`, item, null);
        draw();
      });
      body.append(row);
      const group = order.priceGroups.find((g) => g.id === item.priceGroupId);
      if (group && order.items.map((i) => i.priceGroupId).lastIndexOf(group.id) === index) {
        const groupRow = node("tr", "", "inline-group-row"), groupCell = node("td");
        groupCell.colSpan = 7;
        groupCell.append(groupPanel(group));
        groupRow.append(groupCell);
        body.append(groupRow);
      }
    });
    button(form, "\u65B0\u589E\u5546\u54C1\u5217", () => {
      order.items.push({ sku: "", paperName: "", name: "", color: "", size: "", quantity: "", unitPrice: "", saleType: "", matchStatus: "missing" });
      changed("addItem", null, order.items.length);
      draw();
    });
    const groups = node("details");
    groups.append(node("summary", "\u624B\u52D5\u65B0\u589E\u7D44\u5408\uFF08\u5DF2\u8FA8\u8B58\u7684\u7D44\u5408\u76F4\u63A5\u5728\u5546\u54C1\u8868\u5167\u4FEE\u6B63\uFF09"));
    form.append(groups);
    const add = node("div", "", "form-grid");
    let groupRows = "", groupAmount = "";
    field(add, "\u65B0\u589E\u7D44\u5408\u5217\u865F\uFF08\u4F8B\u5982 6,7\uFF09", "", (v) => groupRows = v, { key: "newGroupRows" });
    field(add, "\u65B0\u589E\u7D44\u5408\u5408\u8A08", "", (v) => groupAmount = v, { type: "number", key: "newGroupAmount" });
    groups.append(add);
    button(groups, "\u5EFA\u7ACB\u7D44\u5408", () => {
      try {
        const rows = groupRows.split(/[,，、\s]+/).filter(Boolean).map(Number);
        if (rows.length < 2 || new Set(rows).size !== rows.length || rows.some((n) => !Number.isInteger(n) || !order.items[n - 1] || order.items[n - 1].priceGroupId)) throw Error("\u8ACB\u586B\u81F3\u5C11\u5169\u500B\u672A\u5C6C\u7D44\u5408\u7684\u6709\u6548\u5217\u865F");
        cents(groupAmount);
        const g = { id: crypto.randomUUID(), amount: groupAmount, pricingMode: "total_only", totalConfirmed: false };
        order.priceGroups.push(g);
        for (const n of rows) {
          order.items[n - 1].priceGroupId = g.id;
          order.items[n - 1].unitPrice = "";
          confirmItem(order.items[n - 1], false);
        }
        changed("addGroup", null, g);
        draw();
      } catch (e) {
        root.querySelector("#review-errors").prepend(node("p", e.message, "error"));
      }
    });
    const pay = node("div", "", "form-grid");
    form.append(node("h4", "\u4ED8\u6B3E\u65B9\u5F0F\uFF0F\u5404\u9805\u5BE6\u6536\u91D1\u984D"), pay);
    for (const [k, label] of [["\u4E2D\u4FE1\u4FE1\u7528\u5361", "\u4FE1\u7528\u5361\uFF08\u4E2D\u4FE1\u4FE1\u7528\u5361\uFF09"], ["\u73FE\u91D1", "\u73FE\u91D1"], ["\u767E\u8CA8\u73FE\u91D1\u5377", "\u767E\u8CA8\u5377\uFF08\u767E\u8CA8\u73FE\u91D1\u5377\uFF09"], ["LinePay", "\u96FB\u5B50\u652F\u4ED8\uFF08LinePay\uFF09"]]) field(pay, label, order.payments[k], (v) => order.payments[k] = v, { type: "number", key: `payments.${k}` });
    field(form, "\u6210\u4EA4\u7E3D\u984D", order.paperTotal, (v) => order.paperTotal = v, { type: "number", key: "paperTotal" });
    field(form, "\u5099\u8A3B", order.note, (v) => order.note = v, { key: "note" });
    const foot = node("div");
    root.append(foot);
    check(foot, cloudMode ? "\u6211\u5DF2\u5C0D\u7167\u6240\u6709\u4F86\u6E90\u539F\u5716\uFF0C\u78BA\u8A8D\u9801\u6578\u3001\u5546\u54C1\u5217\u53CA\u4ED8\u6B3E\u5340\u5B8C\u6574" : "\u6211\u5DF2\u5C0D\u7167\u5B8C\u6574\u539F\u5716\uFF0C\u78BA\u8A8D\u672C\u55AE\u53EA\u67091\u9801\u4E14\u6240\u6709\u5546\u54C1\u5217\u53CA\u4ED8\u6B3E\u5340\u5B8C\u6574", sourceConfirmed, (v) => {
      sourceConfirmed = v;
      if (!cloudMode) order.sources = v ? [{ id: "local-review-image", pages: 1, verified: true }] : [];
      changed("sourceConfirmed", !v, v);
    }, "review-source");
    const all = check(foot, cloudMode ? "\u6211\u5DF2\u9010\u6B04\u6838\u5C0D\u8868\u982D\u3001\u6BCF\u5217\u5546\u54C1\u3001\u7D44\u5408\u7E3D\u50F9\u8207\u4ED8\u6B3E\uFF0C\u78BA\u8A8D\u5167\u5BB9\u6B63\u78BA" : "\u6211\u5DF2\u9010\u6B04\u6838\u5C0D\u8868\u982D\u3001\u6BCF\u5217\u5546\u54C1\u3001\u7D44\u5408\u7E3D\u50F9\u8207\u4ED8\u6B3E\uFF0C\u78BA\u8A8D\u5F8C\u7522\u51FAERP\u6E2C\u8A66\u6A94", order.reviewed, (v) => {
      confirmation(v);
      confirmedAt = v ? (/* @__PURE__ */ new Date()).toISOString() : "";
      if (cloudMode) order.reviewedAt = confirmedAt;
      refresh2();
    }, "review-all");
    all.disabled = false;
    foot.append(node("p", "", "success"));
    foot.lastChild.id = "review-complete";
    foot.append(node("p", "", "notice"));
    foot.lastChild.id = "review-totals";
    const errs = node("div");
    errs.id = "review-errors";
    errs.setAttribute("aria-live", "polite");
    foot.append(errs);
    foot.append(node("p", cloudMode ? "\u8986\u6838\u5167\u5BB9\u9808\u5148\u4FDD\u5B58\u81F3\u516C\u53F8\u96F2\u7AEF\uFF0C\u9589\u5E97\u7D50\u7B97\u5B8C\u6210\u5F8C\u7531\u7E3D\u90E8\u4F9D\u6700\u7D4225\u6B04POS\u532F\u51FA\u3002\u4E0B\u8F09\u5099\u4EFD\u542B\u5BA2\u6236\u500B\u8CC7\uFF0C\u8ACB\u59A5\u5584\u4FDD\u7BA1\u3002" : "\u532F\u5165\u524D\u8ACB\u78BA\u8A8DERP\u53EF\u64A4\u56DE\u7684\u6E2C\u8A66\u65B9\u5F0F\u3002\u65B0\u7248\u4F9D\u4E0A\u65B9\u6700\u7D42\u7BC4\u672C\u8207\u78BA\u8A8D\u7684\u4ED8\u6B3E\u5C0D\u7167\u7522\u6A94\uFF0C\u55AE\u50F9\u9010\u5217\u5E36\u5165\uFF1B\u7D44\u5408\u4F9D\u5DF2\u4FDD\u5B58\u7684\u4E3B\u6A94\u6210\u672C\u50F9\u53CA\u6578\u91CF\u6BD4\u4F8B\u62C6\u50F9\uFF0C\u7F3A\u6210\u672C\u6216\u91D1\u984D\u7121\u6CD5\u5B88\u6046\u6642\u505C\u6B62\u3002\u65B0\u7248\u540C\u55AE\u8CC7\u8A0A\u8207\u4ED8\u6B3E\u5782\u76F4\u5408\u4F75\uFF0C\u53D6\u8CA8\u5009\u5EAB\u4E0D\u540C\u6642\u4FDD\u7559\u9010\u5217\uFF1B\u4ED8\u6B3E\u53EA\u8A08\u4E00\u6B21\uFF0C\u5BE6\u6536\u7387100\u3001\u8D08\u54C1\u6B04\u66AB\u7559\u7A7A\u3002\u820A\u7248\u56DE\u6B78\u683C\u5F0F\u4ECD\u70BA21\u6B04\u3001\u4E0D\u542B\u55AE\u50F9\u3002\u8ACB\u7528\u6210\u4EA4\u50F9\u6838\u5C0D\u8868\u9A57\u8B49\u50F9\u683C\u3001\u8D08\u54C1\u3001\u6DF7\u5408\u92B7\u5225\u53CAT00\u3002\u6B63\u5F0F\u7522\u6A94\u4ECD\u672A\u958B\u653E\u3002", "notice"));
    const actions = node("div", "", "actions");
    foot.append(actions);
    async function download3(kind) {
      try {
        await requireVersion();
        if (kind !== "backup") {
          const errors = reviewErrors(order, { imagePresent: Array.isArray(image) ? image.length > 0 : !!image, sourceConfirmed, existingNumbers: context().existingNumbers, expectedStore: context().expectedStore, allowMultiPage: cloudMode, sourcePageCount: context().sourcePageCount || 0 });
          if (errors.length) throw Error(errors.join("\uFF1B"));
        }
        let bytes, name;
        if (kind === "backup") {
          bytes = JSON.stringify({ version: VERSION, original, reviewedOrder: order, edits, confirmedAt, recognition }, null, 2);
          name = cloudMode ? "\u4EBA\u5DE5\u8986\u6838\u5099\u4EFD_\u542B\u5BA2\u6236\u500B\u8CC7.json" : "\u4EBA\u5DE5\u8986\u6838\u5099\u4EFD_\u542B\u865B\u69CB\u5BA2\u6236\u8CC7\u6599.json";
        } else if (kind === "pos") {
          const profile2 = exportProfile();
          bytes = XLSX.write(profile2 ? buildRevisedPOS([order], XLSX, profile2) : buildPOS([order], XLSX, { mode: "test" }), profile2 ? TEMPLATE_WRITE_OPTIONS : WRITE_OPTIONS);
          name = profile2 ? "ERP\u532F\u5165\u6E2C\u8A66_\u65B0\u7248POS.xlsx" : "ERP\u532F\u5165\u6E2C\u8A66_\u820A\u7248POS.xls";
        } else {
          bytes = XLSX.write(reviewWorkbook(order, XLSX), { type: "array", bookType: "xlsx" });
          name = "ERP\u532F\u5165\u5F8C_\u6210\u4EA4\u50F9\u6838\u5C0D\u8868.xlsx";
        }
        const url = URL.createObjectURL(new Blob([bytes])), a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1e4);
      } catch (e) {
        errs.prepend(node("p", e.message, "error"));
      }
    }
    for (const [kind, label] of [["pos", "\u4E0B\u8F09 ERP \u6E2C\u8A66 POS\uFF08\u4F9D\u6240\u9078\u683C\u5F0F\uFF09"], ["check", "\u4E0B\u8F09\u6210\u4EA4\u50F9\u6838\u5C0D\u8868\uFF08.xlsx\uFF09"], ["backup", "\u4E0B\u8F09\u539F\u8FA8\u8B58\u8207\u4EBA\u5DE5\u4FEE\u6B63\u5099\u4EFD"]]) {
      if (cloudMode && kind === "pos") continue;
      const b = button(actions, label, () => download3(kind));
      b.id = `review-export-${kind}`;
      if (kind !== "backup") b.dataset.export = kind;
    }
    refresh2();
  }
  return { get() {
    return order ? { order: structuredClone(order), original: structuredClone(original), recognition: structuredClone(recognition), edits: structuredClone(edits) } : null;
  }, loadSaved(saved, nextMaster, nextImages) {
    original = saved.originalExtraction;
    master2 = nextMaster;
    order = structuredClone(saved);
    if (order.priceGroups?.some((g) => g.pricingMode !== "total_only")) order = useTotalOnlyGroups(order);
    image = nextImages;
    recognition = saved.recognition || null;
    edits = saved.reviewEdits || [];
    sourceConfirmed = saved.reviewed === true;
    confirmedAt = saved.reviewedAt || "";
    draw();
  }, update(raw, nextMaster, nextImage, nextRecognition = null) {
    if (!raw?.header) {
      original = null;
      order = null;
      root.replaceChildren();
      return;
    }
    if (original !== raw || master2 !== nextMaster) {
      original = raw;
      master2 = nextMaster;
      order = reviewDraft(raw, master2);
      edits = [];
      confirmedAt = "";
      sourceConfirmed = false;
    }
    image = nextImage || "";
    recognition = nextRecognition;
    draw();
  }, clear() {
    original = null;
    order = null;
    root.replaceChildren();
  }, refresh: refresh2 };
}

// store-orders/pos-profile.js
function createPOSProfile(root, { requireVersion, onChange = () => {
}, allowLegacy = true }) {
  let template = null, reading = false, blocked = false;
  root.innerHTML = '<h3>ERP\u532F\u5165\u683C\u5F0F</h3><label>\u532F\u51FA\u683C\u5F0F<select id="pos-format"><option value="latest">\u65B0\u7248POS\uFF08\u4F9D\u5DE5\u7A0B\u5E2B\u6700\u7D42\u7BC4\u672C\uFF09</option><option value="legacy">\u820A\u724821\u6B04\uFF08\u50C5\u6B77\u53F2\u56DE\u6B78\u6E2C\u8A66\uFF09</option></select></label><div id="pos-latest"><label>\u6700\u7D42POS\u7BC4\u672C\uFF08\u53EA\u5728\u672C\u6A5F\u8B80\u53D6\uFF0C\u4E0D\u63A1\u7528\u7BC4\u4F8B\u8A02\u55AE\uFF09<input id="pos-template-file" type="file" accept=".xlsx,.xls"></label><p>\u65B0\u7248\u4F9D\u7BC4\u672C\u653E\u5165\u59D3\u540D\u3001\u96FB\u8A71\u3001\u5730\u5740\uFF1B\u4E0B\u8F09\u6A94\u542B\u500B\u8CC7\uFF0C\u8ACB\u59A5\u5584\u4FDD\u7BA1\u3002\u539F\u59CB\u7BC4\u672C\u4E0D\u6703\u88AB\u4FEE\u6539\u6216\u4E0A\u50B3\u3002\u540C\u55AE\u5171\u7528\u8CC7\u8A0A\u8207\u4ED8\u6B3E\u6B04\u5782\u76F4\u5408\u4F75\uFF0C\u53D6\u8CA8\u5009\u5EAB\u4E0D\u540C\u6642\u5206\u958B\u4FDD\u7559\uFF1B\u5546\u54C1\u6B04\u9010\u5217\u4FDD\u7559\u3002</p><label class="check"><input id="pos-payment-confirmed" type="checkbox" checked>\u5DF2\u78BA\u8A8D\u4ED8\u6B3E\u5C0D\u7167\uFF08\u5982\u9700\u8B8A\u66F4\u8ACB\u5148\u53D6\u6D88\u52FE\u9078\uFF09\uFF1A\u4E2D\u4FE1\u4FE1\u7528\u5361\u3001\u73FE\u91D1\u3001\u767E\u8CA8\u73FE\u91D1\u5377\u3001LinePay</label></div><p id="pos-template-status" role="status"></p>';
  if (!allowLegacy) {
    root.querySelector("option[value=legacy]").remove();
    root.querySelector("#pos-format").closest("label").hidden = true;
  }
  const $2 = (id) => root.querySelector("#" + id), get = () => $2("pos-format").value === "legacy" ? null : { template: reading ? null : template, paymentMappingConfirmed: $2("pos-payment-confirmed").checked };
  function sync() {
    const p = get();
    $2("pos-latest").hidden = !p;
    $2("pos-template-status").textContent = !p ? "\u76EE\u524D\u70BA\u820A\u724821\u6B04\u6E2C\u8A66\u6A94\uFF0C\u4E0D\u542B\u6210\u4EA4\u55AE\u50F9\uFF1B\u4E0D\u4EE3\u8868\u65B0\u7248\u683C\u5F0F\u3002" : reading ? "\u6B63\u5728\u6AA2\u67E5\u7BC4\u672C\u2026" : template ? `\u5DF2\u8B80\u53D6${template.headers.length}\u6B04\uFF1B${template.priceHeader ? "\u55AE\u50F9\u6B04\uFF1A" + template.priceHeader : "\u7F3A\u5C11\u55AE\u50F9\u6B04\uFF0C\u66AB\u4E0D\u53EF\u7522\u6A94"}\u3002${revisedPOSErrors([], p).join("\uFF1B")}` : "\u8ACB\u8F09\u5165\u5DE5\u7A0B\u5E2B\u7684\u6700\u7D42\u7BC4\u672C\uFF1BR\u6B04\u70BA\u50F9\u683C\uFF0C\u517125\u6B04\u3002";
    setBlocked(blocked);
    onChange();
  }
  function setBlocked(value) {
    blocked = value;
    for (const el of root.querySelectorAll("input,select")) el.disabled = blocked || reading;
  }
  $2("pos-format").onchange = sync;
  $2("pos-payment-confirmed").onchange = sync;
  $2("pos-template-file").onchange = async () => {
    template = null;
    reading = true;
    sync();
    try {
      await requireVersion();
      const f = $2("pos-template-file").files[0];
      if (!f || f.size > 5e6) throw Error("\u8ACB\u90785MB\u5167\u7684POS\u7BC4\u672C");
      const wb = XLSX.read(await f.arrayBuffer(), READ_OPTIONS);
      await requireVersion();
      template = readPOSTemplate(wb, XLSX);
    } catch (e) {
      reading = false;
      sync();
      $2("pos-template-status").textContent = e.message;
      return;
    }
    reading = false;
    sync();
  };
  $2("pos-template-status").textContent = "\u8ACB\u8F09\u5165\u542B\u55AE\u50F9\u7684\u6700\u7D42\u7BC4\u672C\uFF1B\u6700\u7D42\u683C\u5F0F\u517125\u6B04\uFF0CR\u6B04\u70BA\u50F9\u683C\u3002";
  return { get, setBlocked };
}

// store-orders/merge-pages.js
function mergeFullPages(input) {
  if (!Array.isArray(input) || !input.length || input.length > 30) throw Error("\u8ACB\u6536\u9F4A1\u81F330\u9801\u4F86\u6E90");
  const pages = input.map((p) => validateExtraction(p));
  if (pages.some((p) => !p.header)) throw Error("\u4F86\u6E90\u7F3A\u5C11\u5B8C\u6574\u8868\u982D");
  const numbers = new Set(pages.map((p) => text(p.header.paperNumber)).filter(Boolean));
  if (numbers.size > 1) throw Error("\u4F86\u6E90\u8A02\u55AE\u7DE8\u865F\u4E0D\u540C\uFF0C\u4E0D\u80FD\u5408\u4F75\u70BA\u540C\u4E00\u5F35\u8A02\u55AE");
  const stores = new Set(pages.map((p) => text(p.header.storeCode).toUpperCase()).filter(Boolean));
  if (stores.size > 1) throw Error("\u4F86\u6E90\u9580\u5E02\u4E0D\u540C\uFF0C\u4E0D\u80FD\u5408\u4F75");
  const known = pages.map((p) => p.header.pageNumber).filter((n) => n !== null);
  if (new Set(known).size !== known.length) throw Error("\u4F86\u6E90\u9801\u78BC\u91CD\u8907\uFF0C\u8ACB\u6838\u5C0D\u662F\u5426\u91CD\u50B3");
  const sorted = [...pages].sort((a, b) => (a.header.pageNumber ?? 31) - (b.header.pageNumber ?? 31));
  const out = structuredClone(sorted[0]);
  out.rows = [];
  out.sharedPrices = [];
  out.warnings = pages.flatMap((p) => p.warnings);
  out.header.uncertainFields = [...new Set(pages.flatMap((p) => p.header.uncertainFields))];
  const uncertain = (k) => {
    if (!out.header.uncertainFields.includes(k)) out.header.uncertainFields.push(k);
    out.warnings.push(`\u591A\u9801${k}\u4E0D\u4E00\u81F4\u6216\u672A\u586B\uFF0C\u8ACB\u5C0D\u7167\u6240\u6709\u539F\u5716\u4FEE\u6B63`);
  };
  function select(values, key2, empty = "") {
    const usable = [...new Set(values.filter((v) => v !== null && v !== "" && v !== void 0))];
    if (usable.length > 1) {
      uncertain(key2);
      return empty;
    }
    return usable[0] ?? empty;
  }
  for (const k of ["paperNumber", "storeCode", "clerk", "note"]) out.header[k] = select(pages.map((p) => p.header[k]), k);
  out.header.businessDate = select(pages.map((p) => normalizePaperDate(p.header.businessDate)), "businessDate");
  for (const k of ["name", "phone", "address"]) out.header.customer[k] = select(pages.map((p) => p.header.customer[k]), "customer." + k);
  for (const k of ["paperRowCount", "pageCount"]) out.header[k] = select(pages.map((p) => p.header[k]), k, null);
  if (known.length !== pages.length || known.some((n) => n > pages.length) || out.header.pageCount !== pages.length) {
    uncertain("pageCount");
  }
  out.header.pageNumber = 1;
  out.paperTotal = select(pages.map((p) => p.paperTotal), "paperTotal", null);
  for (const k of Object.keys(out.payments)) {
    const values = pages.map((p) => p.payments[k]), nonzero = values.filter((v) => v !== 0 && v !== null);
    out.payments[k] = nonzero.length ? select(nonzero, "payments." + k, null) : values.some((v) => v === null) ? null : 0;
  }
  for (const page of sorted) {
    const map = /* @__PURE__ */ new Map();
    for (const r of page.rows) {
      const row = out.rows.length + 1;
      map.set(r.row, row);
      out.rows.push({ ...r, row });
    }
    for (const g of page.sharedPrices) out.sharedPrices.push({ ...g, rows: g.rows.map((n) => map.get(n)) });
  }
  const codes = new Set(out.rows.map((r) => r.groupCode).filter(Boolean));
  for (const code of codes) {
    const ids = out.rows.filter((r) => r.groupCode === code).map((r) => r.row), groups = out.sharedPrices.filter((g) => g.rows.some((n) => ids.includes(n)));
    if (groups.some((g) => g.rows.some((n) => !ids.includes(n)))) throw Error("\u8DE8\u9801\u7D44\u5408\u4EE3\u865F\u8207\u62EC\u865F\u7BC4\u570D\u4E0D\u4E00\u81F4\uFF0C\u8ACB\u4EBA\u5DE5\u8F38\u5165");
    const amounts = [...new Set(groups.map((g) => g.amount).filter((v) => v !== null))];
    out.sharedPrices = out.sharedPrices.filter((g) => !groups.includes(g));
    out.sharedPrices.push({ rows: ids, amount: amounts.length === 1 ? amounts[0] : null });
    if (amounts.length > 1) out.warnings.push(`\u7D44\u5408${code}\u8DE8\u9801\u7E3D\u50F9\u4E0D\u4E00\u81F4\uFF0C\u8ACB\u4EBA\u5DE5\u4FEE\u6B63`);
  }
  return validateExtraction(out);
}

// store-orders/cloud.js
var $ = (id) => document.getElementById(id);
var guard = new VersionGuard();
var guestPage = location.pathname.startsWith("/store-orders/guest/");
var apiPrefix = guestPage ? "/api/store-orders-guest" : "/api/store-orders";
var state = { session: null, master: null, current: null, base: "", sources: [], pages: [], urls: [], queue: [], busy: false, correction: false, settlement: null, aiOperation: null };
var key = () => `store-orders-cloud:${state.session?.email || "disconnected"}`;
var review = createReview($("cloud-review"), { cloudMode: true, requireVersion: () => guard.require(), context: () => ({ expectedStore: store(), existingNumbers: [], sourcePageCount: state.pages.length, guest: !!state.session?.guest }) });
var profile = createPOSProfile($("cloud-pos-profile"), { requireVersion: () => guard.require(), allowLegacy: false, onChange: () => controls() });
function node2(tag, text2, cls) {
  const n = document.createElement(tag);
  if (text2 !== void 0) n.textContent = text2;
  if (cls) n.className = cls;
  return n;
}
function message(text2, error = false) {
  $("cloud-status").textContent = text2;
  $("cloud-status").className = error ? "error" : "success";
}
function store() {
  return $("cloud-store").value === "__other__" ? text($("cloud-store-other").value).toUpperCase() : $("cloud-store").value;
}
var hq = () => state.session?.role === "hq";
function stash() {
  if (state.current && dirty()) try {
    sessionStorage.setItem(key(), JSON.stringify({ expires: Date.now() + 72e5, ...snapshot() }));
  } catch {
  }
}
function snapshot() {
  return review.get();
}
function dirty() {
  return !!state.current && JSON.stringify(snapshot()?.order) !== state.base;
}
function checkLeave() {
  if (dirty()) throw Error("\u8ACB\u5148\u4FDD\u5B58\u76EE\u524D\u8986\u6838\u6216\u8349\u7A3F\uFF0C\u518D\u5207\u63DB\u8A02\u55AE");
}
function controls() {
  const disabled = state.busy || guard.blocked, connected = !!state.session;
  $("version-warning").hidden = !guard.blocked;
  $("cloud-work").inert = !connected || disabled;
  profile.setBlocked(disabled);
  $("cloud-connect").disabled = disabled;
  $("cloud-authorize").disabled = !connected || disabled;
  $("cloud-logout").disabled = disabled;
  $("cloud-hq").hidden = !hq();
  $("cloud-order").hidden = !state.current;
  const locked = !!state.current?.batchId && !state.correction;
  $("cloud-review").inert = disabled || locked;
  $("cloud-save").disabled = disabled || locked;
  $("cloud-correct").hidden = !hq() || !state.current?.batchId || !["settled", "import_failed"].includes(state.current?.status);
  $("cloud-ai").disabled = disabled || locked || !state.pages.length || !state.session?.recognitionReady;
  $("cloud-export").disabled = disabled || !hq() || !state.current || !["settled", "import_failed"].includes(state.current.status) || !state.session.productionExportEnabled || !!revisedPOSErrors(state.current ? [state.current] : [], profile.get()).length;
  $("cloud-result-save").disabled = disabled || !hq() || !state.current || !["exported", "import_failed", "import_unknown"].includes(state.current.status);
  $("cloud-retry-settle").hidden = !state.settlement;
}
async function run(fn) {
  if (state.busy) return;
  state.busy = true;
  controls();
  try {
    await guard.require();
    await fn();
  } catch (e) {
    message(e.message || "\u64CD\u4F5C\u5C1A\u672A\u78BA\u8A8D\u5B8C\u6210", true);
  } finally {
    state.busy = false;
    controls();
  }
}
async function api(path, method = "GET", body) {
  if (!state.session && !["/session", "/redeem"].includes(path)) throw Error("\u8ACB\u5148\u9023\u7DDA\u516C\u53F8\u5DE5\u5177");
  const r = await fetch(apiPrefix + path, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", "X-Store-Orders-Version": VERSION }, ...body ? { body: JSON.stringify(body) } : {} });
  if (!(r.headers.get("Content-Type") || "").includes("application/json")) throw Error("\u516C\u53F8\u767B\u5165\u5DF2\u904E\u671F\uFF0C\u8ACB\u91CD\u65B0\u9023\u7DDA");
  const data = await r.json();
  if (!r.ok) {
    const e = Error(data.error || "\u516C\u53F8\u96F2\u7AEF\u64CD\u4F5C\u672A\u5B8C\u6210");
    e.code = data.code;
    e.status = r.status;
    throw e;
  }
  return data;
}
function clearOrder() {
  state.urls.forEach(URL.revokeObjectURL);
  state.urls = [];
  state.pages = [];
  state.current = null;
  state.base = "";
  state.correction = false;
  state.aiOperation = null;
  review.clear();
  $("cloud-ai-consent").checked = false;
  controls();
}
async function getFile(id) {
  if (!guestPage) return download(id);
  const r = await fetch(apiPrefix + "/file/" + encodeURIComponent(id), { credentials: "same-origin", cache: "no-store" });
  if (!r.ok) throw Error("\u8A2A\u5BA2\u7121\u6B0A\u53D6\u5F97\u6B64\u539F\u5716\uFF0C\u6216\u767B\u5165\u5DF2\u5230\u671F");
  return r.blob();
}
async function loadImages(order) {
  state.urls.forEach(URL.revokeObjectURL);
  state.urls = [];
  state.pages = [];
  for (const source of order.sources) {
    const pages = await pagesFor(await getFile(source.fileId));
    if (pages.length !== source.pages) throw Error("\u4F86\u6E90\u9801\u6578\u8207\u4FDD\u5B58\u5167\u5BB9\u4E0D\u7B26\uFF0C\u8ACB\u91CD\u65B0\u6838\u5C0D");
    for (const [index, blob] of pages.entries()) {
      state.pages.push({ fileId: source.fileId, index, blob });
      state.urls.push(URL.createObjectURL(blob));
    }
  }
}
function adopt(order) {
  state.current = structuredClone(order);
  review.loadSaved(order, state.master, state.urls);
  state.base = JSON.stringify(snapshot().order);
  $("cloud-handling").value = ["pending", "reviewed", "needs_info", "cancelled"].includes(order.status) ? order.status : "pending";
  $("cloud-reason").value = order.exceptionReason || "";
  controls();
}
function blankRaw(order) {
  return { header: { paperNumber: order.paperNumber, storeCode: order.storeCode, businessDate: order.businessDate, clerk: order.clerk, pageNumber: 1, pageCount: order.pageCount, paperRowCount: order.paperRowCount, customer: structuredClone(order.customer), note: order.note, uncertainFields: [] }, paperTotal: order.paperTotal || null, payments: structuredClone(order.payments), rows: [], sharedPrices: [], warnings: [] };
}
function newDraft(sources) {
  const o = newOrder(crypto.randomUUID(), store(), $("cloud-date").value);
  o.sources = sources;
  o.pageCount = sources.reduce((n, s) => n + s.pages, 0);
  o.originalExtraction = blankRaw(o);
  o.headerRecognition = { pageNumber: 1, confirmed: false, uncertainFields: [], rawDate: o.businessDate, synthetic: false };
  o.reviewEdits = [];
  o.recognizedPages = [];
  o.recognition = null;
  return o;
}
async function registerSource(fileId) {
  const r = await api("/sources", "POST", { storeCode: store(), fileId });
  if (r.orderId) return { existing: r.orderId };
  if (r.duplicate) throw Error("\u6B64\u7167\u7247\u8207\u5DF2\u4E0A\u50B3\u539F\u5716\u91CD\u8907\uFF0C\u8ACB\u958B\u555F\u539F\u4F86\u7684\u55AE\u64DA");
  return { id: r.fileId };
}
async function openSource(fileId, append = false) {
  if (!append) checkLeave();
  if (append && (!state.current || state.current.batchId)) throw Error("\u8ACB\u5148\u958B\u555F\u672A\u7D50\u7B97\u8A02\u55AE");
  const r = await registerSource(fileId);
  if (r.existing) {
    if (append) throw Error("\u539F\u5716\u5DF2\u5C6C\u5176\u4ED6\u8A02\u55AE");
    return openOrder(r.existing);
  }
  const blob = await getFile(r.id), pages = await pagesFor(blob), source = { fileId: r.id, pages: pages.length, verified: true };
  if (append) {
    const o = snapshot().order;
    if (o.sources.some((s) => s.fileId === r.id)) throw Error("\u6B64\u4F86\u6E90\u5DF2\u52A0\u5165\u76EE\u524D\u8A02\u55AE");
    o.sources.push(source);
    o.pageCount += pages.length;
    o.reviewed = false;
    await loadImages(o);
    adopt(o);
    state.base = "";
  } else {
    clearOrder();
    const o = newDraft([source]);
    await loadImages(o);
    adopt(o);
    state.base = "";
  }
  message("\u539F\u5716\u5DF2\u8F09\u5165\u3002\u53EF\u9001\u51FAAI\u8FA8\u8B58\uFF0C\u6216\u76F4\u63A5\u4F9D\u539F\u5716\u4EBA\u5DE5\u586B\u5BEB\uFF1B\u5C1A\u672A\u4FDD\u5B58\u516C\u53F8\u8A02\u55AE\u3002");
}
async function openOrder(id) {
  checkLeave();
  const { order } = await api("/orders/" + id);
  clearOrder();
  await loadImages(order);
  if (!order.originalExtraction) order.originalExtraction = blankRaw(order);
  adopt(order);
  message("\u5DF2\u8B80\u53D6\u516C\u53F8\u4FDD\u5B58\u7248\u672C\uFF1B\u7D50\u7B97\u5F8C\u9580\u5E02\u7121\u6CD5\u518D\u8B80\u53D6\u5167\u5BB9\u3002");
}
async function refresh() {
  const code = store(), date = $("cloud-date").value;
  if (!validStoreCode(code) || !validDate(date)) throw Error("\u8ACB\u9078\u64C7\u6709\u6548\u9580\u5E02\u8207\u65E5\u671F");
  const data = await api(`/queue?store=${encodeURIComponent(code)}&date=${date}`), scan = await api(`/scan?store=${encodeURIComponent(code)}`);
  state.queue = data.orders;
  state.sources = scan.files;
  $("cloud-incoming").replaceChildren();
  for (const f of scan.files.filter((f2) => !f2.orderId)) {
    const row = node2("div", void 0, "item"), label = node2("p", `\u5F85\u6536\u55AE\u30FB${new Date(f.createdTime).toLocaleString("zh-TW")}\u30FB${f.mimeType}`), open = node2("button", "\u958B\u555F\u70BA\u65B0\u8A02\u55AE"), append = node2("button", "\u52A0\u5165\u76EE\u524D\u8A02\u55AE", "secondary");
    open.onclick = () => run(() => openSource(f.id));
    append.onclick = () => run(() => openSource(f.id, true));
    row.append(label, open, append);
    $("cloud-incoming").append(row);
  }
  $("cloud-queue").replaceChildren();
  for (const o of data.orders) {
    const row = node2("div", void 0, "item");
    row.append(node2("p", `${o.id}\u30FB${{ pending: "\u5F85\u8986\u6838", reviewed: "\u5DF2\u8986\u6838", needs_info: "\u5F85\u88DC\u4EF6", cancelled: "\u53D6\u6D88", settled: "\u5DF2\u7D50\u7B97", exported: "\u5DF2\u7522\u6A94", import_unknown: "\u532F\u5165\u7D50\u679C\u5F85\u78BA\u8A8D", import_failed: "\u78BA\u8A8D\u532F\u5165\u5931\u6557", erp_created: "ERP\u5DF2\u5EFA\u7ACB" }[o.status] || o.status}\u30FB\u7248\u672C${o.version}`));
    const b = node2("button", "\u958B\u555F\uFF0F\u7E8C\u4F5C", "secondary");
    b.onclick = () => run(() => openOrder(o.id));
    row.append(b);
    $("cloud-queue").append(row);
  }
  $("cloud-batches").replaceChildren(...data.batches.map((b) => node2("p", `\u6279\u6B21${b.id}\u30FB${b.status === "settled" ? "\u5DF2\u4EA4\u63A5" : b.status}`)));
  $("cloud-list-summary").textContent = `\u672C\u65E5${data.orders.length}\u7B46\u6D41\u7A0B\u7D00\u9304\u30FB${scan.files.filter((f) => !f.orderId).length}\u500B\u5F85\u6536\u4F86\u6E90\u30FB${data.batches.length}\u6279\u4EA4\u63A5\u3002\u7D50\u7B97\u524D\u8ACB\u9010\u55AE\u6838\u5C0D\u539F\u5716\u3001\u9801\u6578\u3001\u4EF6\u6578\u3001\u91D1\u984D\u8207\u6536\u6B3E\u3002`;
}
async function guestCatalog() {
  try {
    const data = await api("/catalog"), bySku = /* @__PURE__ */ new Map();
    for (const r of data.records) {
      if (!bySku.has(r.sku)) bySku.set(r.sku, []);
      bySku.get(r.sku).push(r);
    }
    state.master = { version: data.version, count: bySku.size, bySku };
    $("cloud-master-status").textContent = `\u5DF2\u8F09\u5165${bySku.size}\u500B\u5546\u54C1\u67E5\u8A62\u8CC7\u6599\uFF08\u4E0D\u542B\u6210\u672C\uFF09`;
  } catch (e) {
    message(e.message, true);
  }
}
async function connect() {
  if (dirty()) throw Error("\u8ACB\u5148\u4FDD\u5B58\u76EE\u524D\u8349\u7A3F");
  const s = await api("/session");
  if (s.version !== VERSION) throw Error("API\u7248\u672C\u4E0D\u540C\uFF0C\u8ACB\u91CD\u65B0\u8F09\u5165\u6700\u65B0\u7248");
  state.session = s;
  $("cloud-store").replaceChildren(...Object.entries(s.stores).map(([id, value]) => {
    const o = node2("option", `${id}\u30FB${value.name}`);
    o.value = id;
    return o;
  }));
  const other = node2("option", "\u5176\u5B83");
  other.value = "__other__";
  $("cloud-store").append(other);
  if (Object.hasOwn(s.stores, "R14")) $("cloud-store").value = "R14";
  $("cloud-session").textContent = `${s.email}\u30FB${hq() ? "\u7E3D\u90E8" : "\u9580\u5E02"}\u30FB${s.recognitionReady ? "AI\u8FA8\u8B58\u5DF2\u8A2D\u5B9A" : "AI\u672A\u8A2D\u5B9A\uFF0C\u53EF\u4EBA\u5DE5\u8986\u6838"}`;
  state.settlement = JSON.parse(sessionStorage.getItem(key() + ":settlement") || "null");
  if (!guestPage) configure(s.googleClientId);
  await refresh();
  if (hq()) await invitations();
  if (guestPage) {
    await guestCatalog();
    message("\u8A2A\u5BA2\u5DF2\u767B\u5165\uFF0C\u53EA\u80FD\u67E5\u770B\u81EA\u5DF1\u63D0\u4EA4\u7684\u55AE\u64DA\u3002");
  } else message("\u516C\u53F8\u5DE5\u5177\u5DF2\u9023\u7DDA\uFF0C\u8ACB\u6388\u6B0A\u8B80\u53D6\u516C\u53F8\u96F2\u7AEF\u786C\u789F\u3002");
}
async function master(blob, version) {
  const m = parseMaster(XLSX.read(await blob.arrayBuffer(), READ_OPTIONS), XLSX, version);
  state.master = m;
  $("cloud-master-status").textContent = `\u5DF2\u8F09\u5165${m.count}\u500B\u8CA8\u865F\uFF1B\u7248\u672C${version}\u3002\u5DF2\u4FDD\u5B58\u7684\u5546\u54C1\u8207\u6210\u672C\u5FEB\u7167\u4E0D\u88AB\u8986\u84CB\u3002`;
  if (hq()) {
    const records = [...m.bySku.values()].flat().map((r) => ({ sku: text(r.sku), name: text(r.name), color: text(r.color), colorCode: text(r.colorCode), size: text(r.size), sizeCode: text(r.sizeCode), discontinued: r.discontinued === true }));
    await api("/catalog", "POST", { version, records });
  }
  if (state.current) {
    const snap = snapshot(), o = snap.order;
    o.originalExtraction = snap.original;
    o.reviewEdits = snap.edits;
    o.recognition = snap.recognition;
    review.loadSaved(o, m, state.urls);
  }
}
$("cloud-review").addEventListener("change", (e) => {
  if (e.target.id === "review-all") $("cloud-handling").value = e.target.checked ? "reviewed" : "pending";
  stash();
});
$("cloud-restore-draft").onclick = () => run(async () => {
  checkLeave();
  const stored = JSON.parse(sessionStorage.getItem(key()) || "null");
  if (!stored || stored.expires <= Date.now()) {
    sessionStorage.removeItem(key());
    throw Error("\u6C92\u6709\u5169\u5C0F\u6642\u5167\u53EF\u6062\u5FA9\u7684\u5206\u9801\u8349\u7A3F");
  }
  const o = stored.order;
  if (!Object.hasOwn(state.session.stores, o.storeCode)) throw Error("\u8349\u7A3F\u9580\u5E02\u672A\u6388\u6B0A");
  if (o.version > 0) {
    const saved = await api("/orders/" + o.id);
    if (saved.order.version !== o.version) throw Error("\u96F2\u7AEF\u5DF2\u6709\u8F03\u65B0\u7248\u672C\uFF0C\u8ACB\u91CD\u65B0\u958B\u555F\u4E26\u5C0D\u7167\u5099\u4EFD\u4FEE\u6B63");
  }
  clearOrder();
  $("cloud-store").value = o.storeCode;
  $("cloud-date").value = o.businessDate;
  o.originalExtraction = stored.original;
  o.recognition = stored.recognition;
  o.reviewEdits = stored.edits;
  confirmReview(o, false);
  await loadImages(o);
  adopt(o);
  state.base = "";
  message("\u5DF2\u6062\u5FA9\u5206\u9801\u8349\u7A3F\uFF0C\u8ACB\u91CD\u65B0\u6838\u5C0D\u4E26\u4FDD\u5B58\u516C\u53F8\u96F2\u7AEF\u3002");
});
$("cloud-connect").onclick = () => run(async () => {
  if (guestPage) {
    const code = $("cloud-guest-code").value;
    await api("/redeem", "POST", { code });
    $("cloud-guest-code").value = "";
  }
  await connect();
});
$("cloud-authorize").onclick = () => run(async () => {
  await authorize();
  await verifyIdentity(state.session.email);
  const latest = await latestMaster(state.session.masterFolderId);
  await master(latest.blob, latest.version);
  message("\u96F2\u7AEF\u6388\u6B0A\u5B8C\u6210\uFF0C\u5DF2\u53D6\u5F97\u6700\u65B0\u5546\u54C1\u4E3B\u6A94\u3002");
});
$("cloud-master").onclick = () => run(async () => {
  if (guestPage) return guestCatalog();
  const latest = await latestMaster(state.session.masterFolderId);
  await master(latest.blob, latest.version);
});
$("cloud-master-file").onchange = () => run(async () => {
  const f = $("cloud-master-file").files[0];
  if (f) {
    const digest = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
    await master(f, `manual:${[...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
  }
  ;
});
$("cloud-upload").onchange = () => run(async () => {
  const files = [...$("cloud-upload").files];
  $("cloud-upload-results").replaceChildren();
  let failed = 0;
  for (const [i, f] of files.entries()) {
    const line = node2("li", `\u7B2C${i + 1}\u500B\u6A94\u6848\u8655\u7406\u4E2D`);
    $("cloud-upload-results").append(line);
    try {
      const pages = await pagesFor(f);
      if (!pages.length) throw Error("\u7121\u53EF\u89E3\u6790\u9801\u9762");
      const mime = f.type || (/\.hei[cf]$/i.test(f.name) ? "image/heic" : "");
      const session = await api("/upload-session", "POST", { storeCode: store(), mimeType: mime, size: f.size, operationId: crypto.randomUUID() });
      await upload(new Blob([f], { type: mime }), session);
      line.textContent = `\u7B2C${i + 1}\u500B\u6A94\u6848\u5DF2\u4E0A\u50B3\u516C\u53F8\u96F2\u7AEF\uFF0C\u5F85\u8986\u6838`;
      line.className = "success";
    } catch (e) {
      failed++;
      line.textContent = `\u7B2C${i + 1}\u500B\u6A94\u6848\u5931\u6557\uFF1A${e.message}`;
      line.className = "error";
    }
  }
  $("cloud-upload").value = "";
  await refresh();
  message(`\u4E0A\u50B3\u5B8C\u6210\uFF1A\u6210\u529F${files.length - failed}\uFF0C\u5931\u6557${failed}\u3002\u4E0A\u50B3\u4E0D\u4EE3\u8868\u5DF2\u4FDD\u5B58\u8A02\u55AE\u6216\u7D50\u7B97\u3002`, failed > 0);
});
$("cloud-refresh").onclick = () => run(refresh);
for (const id of ["cloud-store", "cloud-store-other", "cloud-date"]) $(id).onchange = () => run(async () => {
  if (dirty()) {
    if (state.current) {
      $("cloud-store").value = state.current.storeCode;
      $("cloud-date").value = state.current.businessDate;
    }
    throw Error("\u8ACB\u5148\u4FDD\u5B58\u76EE\u524D\u8986\u6838\u6216\u8349\u7A3F\uFF0C\u518D\u5207\u63DB");
  }
  $("cloud-store-other-label").hidden = $("cloud-store").value !== "__other__";
  if (!Object.hasOwn(state.session.stores, store())) throw Error("\u6B64\u9580\u5E02\u672A\u6388\u6B0A\uFF0C\u8ACB\u7531\u7E3D\u90E8\u8A2D\u5B9A");
  clearOrder();
  await refresh();
});
$("cloud-ai").onclick = () => run(async () => {
  if (!$("cloud-ai-consent").checked) throw Error("\u8ACB\u5148\u78BA\u8A8D\u5B8C\u6574\u55AE\u50B3\u9001\u6388\u6B0A");
  if (!state.current || state.current.batchId) throw Error("\u8ACB\u958B\u555F\u672A\u7D50\u7B97\u7684\u5B8C\u6574\u8A02\u55AE");
  if (!state.master) throw Error("\u8ACB\u5148\u53D6\u5F97\u5546\u54C1\u4E3B\u6A94");
  if (snapshot().order.items.length && !confirm("\u91CD\u65B0\u8FA8\u8B58\u6703\u8986\u84CB\u76EE\u524D\u672A\u4FDD\u5B58\u7684\u8868\u982D\u3001\u5546\u54C1\u53CA\u4ED8\u6B3E\u4FEE\u6B63\uFF0C\u4E26\u53E6\u8A08API\u8CBB\u7528\u3002\u78BA\u5B9A\u91CD\u65B0\u8FA8\u8B58\uFF1F")) return;
  const results = [];
  for (const [i, p] of state.pages.entries()) {
    message(`\u6B63\u5728\u8FA8\u8B58\u7B2C${i + 1}\uFF0F${state.pages.length}\u9801\uFF0C\u8ACB\u52FF\u91CD\u8907\u64CD\u4F5C\u3002`);
    const image = await createImageBitmap(p.blob);
    let prepared;
    try {
      prepared = prepareImageInput(image, { full: true });
    } finally {
      image.close();
    }
    const request2 = { storeCode: store(), fileId: p.fileId, operationId: crypto.randomUUID(), mode: "full", consent: true, image: prepared.image, detailImages: prepared.detailImages };
    state.aiOperation = request2.operationId;
    const result = await api("/recognize", "POST", request2);
    results.push(result);
  }
  const raw = mergeFullPages(results.map((r) => r.extraction));
  if (text(raw.header.storeCode).toUpperCase() !== store()) throw Error("\u8FA8\u8B58\u9580\u5E02\u8207\u76EE\u524D\u9580\u5E02\u4E0D\u540C\uFF0C\u672A\u5957\u7528\u7D50\u679C\uFF0C\u8ACB\u5C0D\u7167\u539F\u5716\u4EBA\u5DE5\u4FEE\u6B63");
  const base = snapshot().order;
  review.update(raw, state.master, state.urls, results.map((r) => r.recognition));
  const draft = review.get().order;
  Object.assign(draft, { id: base.id, version: base.version, sources: base.sources, status: "pending", reviewed: false, originalExtraction: raw, recognizedPages: results.map((r) => r.extraction), recognition: results.map((r) => r.recognition), reviewEdits: [], headerRecognition: { ...draft.headerRecognition, synthetic: false } });
  adopt(draft);
  state.base = "";
  $("cloud-ai-consent").checked = false;
  message("\u8FA8\u8B58\u5B8C\u6210\uFF0C\u8ACB\u4F9D\u539F\u5716\u6838\u5C0D\u4E26\u4FEE\u6B63\u3002\u53EA\u6709\u52FE\u9078\u5B8C\u6574\u8986\u6838\u78BA\u8A8D\u4E14\u4FDD\u5B58\u5F8C\uFF0C\u624D\u5217\u5165\u5DF2\u8986\u6838\u8A02\u55AE\u3002");
});
async function saveOrder() {
  if (!state.current) throw Error("\u8ACB\u5148\u958B\u555F\u8A02\u55AE");
  const snap = snapshot(), o = snap.order;
  o.originalExtraction = snap.original;
  o.recognition = snap.recognition;
  o.reviewEdits = snap.edits;
  o.exceptionReason = $("cloud-reason").value;
  o.status = $("cloud-handling").value;
  if (o.status === "reviewed") {
    const errors = reviewErrors(o, { imagePresent: state.urls.length > 0, sourceConfirmed: $("review-source")?.checked === true, expectedStore: store(), allowMultiPage: true, sourcePageCount: state.pages.length, guest: !!state.session?.guest });
    if (errors.length) throw Error(errors.join("\uFF1B"));
  }
  if (state.correction) {
    if (!text(o.exceptionReason)) throw Error("\u7E3D\u90E8\u66F4\u6B63\u5FC5\u9808\u586B\u5BEB\u539F\u56E0");
    const r = await api(`/orders/${o.id}/correct`, "POST", { expectedVersion: state.current.version, order: o, reason: o.exceptionReason, operationId: crypto.randomUUID() });
    o.version = r.version;
    o.status = state.current.status;
    o.batchId = state.current.batchId;
  } else {
    const r = await api("/orders", "POST", { order: o, expectedVersion: state.current.version, operationId: crypto.randomUUID() });
    o.version = r.version;
  }
  state.correction = false;
  adopt(o);
  $("cloud-date").value = o.businessDate;
  sessionStorage.removeItem(key());
  await refresh();
  message("\u5DF2\u4FDD\u5B58\u516C\u53F8\u96F2\u7AEF\uFF0C\u5C1A\u672A\u7D50\u7B97\u6642\u4ECD\u53EF\u7E7C\u7E8C\u8986\u6838\u3002");
}
$("cloud-save").onclick = () => run(saveOrder);
$("cloud-correct").onclick = () => {
  if (!["settled", "import_failed"].includes(state.current?.status)) return;
  state.correction = true;
  controls();
  message("\u7E3D\u90E8\u66F4\u6B63\u6A21\u5F0F\uFF1A\u4FEE\u6B63\u5F8C\u91CD\u65B0\u6838\u5C0D\uFF0C\u586B\u539F\u56E0\u4E26\u4FDD\u5B58\uFF1B\u539F\u7248\u6703\u4FDD\u7559\u3002");
};
async function prepareCosts() {
  if (!hq()) return;
  if (!state.master) throw Error("\u7E3D\u90E8\u7D50\u7B97\u524D\u8ACB\u5148\u53D6\u5F97\u6700\u65B0\u5546\u54C1\u4E3B\u6A94");
  for (const row of state.queue.filter((r) => r.status === "reviewed" && !r.batch_id)) {
    const { order } = await api("/orders/" + row.id);
    let changed = false;
    for (const item of order.items.filter((i) => i.priceGroupId)) {
      if (item.costSnapshot?.status === "provided" && item.costSnapshot.sku === item.sku) continue;
      const match = matchProduct(state.master, item.sku);
      if (match.status !== "unique" || !match.matches[0].costSnapshot?.value) throw Error(`\u8A02\u55AE${order.paperNumber}\u7D44\u5408\u5546\u54C1${item.sku}\u7F3A\u552F\u4E00\u6709\u6548\u6210\u672C\uFF0C\u8ACB\u5148\u8986\u6838`);
      costUnits(match.matches[0].costSnapshot.value);
      item.costSnapshot = structuredClone(match.matches[0].costSnapshot);
      changed = true;
    }
    if (changed) await api("/orders", "POST", { order, expectedVersion: order.version, operationId: crypto.randomUUID() });
  }
}
async function settle(body) {
  try {
    const result = await api("/settle", "POST", body);
    state.settlement = null;
    sessionStorage.removeItem(key() + ":settlement");
    clearOrder();
    await refresh();
    message(`\u96F2\u7AEF\u4EA4\u63A5\u5B8C\u6210\uFF0C\u6279\u6B21${result.batchId}`);
  } catch (e) {
    if (e.code === "settlement_reconfirm") {
      state.settlement = null;
      sessionStorage.removeItem(key() + ":settlement");
      $("cloud-settlement-confirmed").checked = false;
    }
    throw e;
  }
}
$("cloud-settle").onclick = () => run(async () => {
  checkLeave();
  if (!$("cloud-settlement-confirmed").checked) throw Error("\u8ACB\u5148\u6838\u5C0D\u672C\u6B21\u7D19\u672C\u8207\u5B8C\u6574\u6E05\u55AE");
  await refresh();
  await prepareCosts();
  await refresh();
  const orders = state.queue.filter((o) => !o.batch_id).map((o) => ({ id: o.id, version: o.version }));
  const body = { storeCode: store(), businessDate: $("cloud-date").value, orders, operationId: crypto.randomUUID(), confirmed: true, noOrders: $("cloud-no-orders").checked };
  state.settlement = body;
  sessionStorage.setItem(key() + ":settlement", JSON.stringify(body));
  await settle(body);
});
$("cloud-retry-settle").onclick = () => run(() => settle(state.settlement));
function download2(bytes, name, mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime })), a = node2("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e4);
}
$("cloud-export").onclick = () => run(async () => {
  checkLeave();
  const o = state.current;
  if (!hq() || !state.session.productionExportEnabled || !["settled", "import_failed"].includes(o?.status)) throw Error("\u6B64\u8A02\u55AE\u4E0D\u80FD\u6B63\u5F0F\u7522\u6A94");
  const p = profile.get(), bytes = XLSX.write(buildRevisedPOS([o], XLSX, p), TEMPLATE_WRITE_OPTIONS);
  const result = await api(`/orders/${o.id}/export`, "POST", { expectedVersion: o.version, mode: "production" });
  o.version = result.version;
  o.status = "exported";
  adopt(o);
  download2(bytes, `POS-${o.paperNumber}.xlsx`);
  await refresh();
  message("POS\u5DF2\u7522\u751F\uFF0C\u8ACB\u532F\u5165ERP\u4E26\u767B\u8A18\u7D50\u679C\uFF1B\u7D50\u679C\u4E0D\u660E\u6642\u8ACB\u52FF\u91CD\u7522\u3002");
});
async function invitations() {
  if (!hq()) return;
  const data = await api("/guest-invites");
  $("cloud-invites").replaceChildren();
  for (const invite of data.invites) {
    const row = node2("div", void 0, "item");
    row.append(node2("p", `${invite.store_code}\u30FB\u5230\u671F${new Date(invite.expires_at).toLocaleString("zh-TW")}\u30FB\u4F7F\u7528${invite.uses}/${invite.max_uses}${invite.revoked_at ? "\u30FB\u5DF2\u505C\u7528" : ""}`));
    if (!invite.revoked_at) {
      const b = node2("button", "\u505C\u7528\u6B64\u9080\u8ACB\u78BC", "secondary");
      b.onclick = () => run(async () => {
        await api("/guest-invites/" + invite.id + "/revoke", "POST", { expectedVersion: invite.version });
        await invitations();
        message("\u9080\u8ACB\u78BC\u53CA\u5DF2\u767B\u5165\u7684\u8A2A\u5BA2\u6B0A\u9650\u5DF2\u505C\u7528\u3002");
      });
      row.append(b);
    }
    $("cloud-invites").append(row);
  }
}
$("cloud-invite-create").onclick = () => run(async () => {
  const result = await api("/guest-invites", "POST", { storeCode: store(), hours: Number($("cloud-invite-hours").value), maxUses: Number($("cloud-invite-uses").value) });
  $("cloud-invite-code").value = result.code;
  $("cloud-invite-result").hidden = false;
  await invitations();
  message("\u9080\u8ACB\u78BC\u53EA\u986F\u793A\u9019\u4E00\u6B21\u3002\u8ACB\u7531\u7E3D\u90E8\u81EA\u884C\u63D0\u4F9B\u7D66\u7576\u73ED\u540C\u4EC1\uFF0C\u4E0D\u8981\u516C\u958B\u5F35\u8CBC\u3002");
});
$("cloud-invite-refresh").onclick = () => run(invitations);
async function setupRequest(path, method = "GET") {
  const r = await fetch("/api/store-orders/" + path, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", "X-Store-Orders-Version": VERSION }, ...method === "POST" ? { body: "{}" } : {} });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "\u5132\u5B58\u8A2D\u5B9A\u672A\u5B8C\u6210");
  return data;
}
$("cloud-owner-start").onclick = () => run(async () => {
  const data = await setupRequest("oauth/start", "POST");
  location.assign(data.authorizeUrl);
});
$("cloud-result-save").onclick = () => run(async () => {
  const o = state.current;
  if (!o) throw Error("\u8ACB\u958B\u555F\u8A02\u55AE");
  const status = $("cloud-result").value, r = await api(`/orders/${o.id}/result`, "POST", { expectedVersion: o.version, status, erpNumber: $("cloud-erp-number").value, reason: $("cloud-result-reason").value, operationId: crypto.randomUUID() });
  o.version = r.version;
  o.status = status;
  adopt(o);
  await refresh();
  message("ERP\u5EFA\u7ACB\u7D50\u679C\u5DF2\u767B\u8A18\u3002");
});
$("cloud-logout").onclick = () => run(async () => {
  if (guestPage) await api("/logout", "POST", {});
  sessionStorage.removeItem(key());
  sessionStorage.removeItem(key() + ":settlement");
  clear();
  clearOrder();
  state.session = null;
  state.master = null;
  $("cloud-invite-code").value = "";
  $("cloud-master-file").value = "";
  $("cloud-upload").value = "";
  controls();
  location.assign(guestPage ? "/store-orders/guest/" : "/cdn-cgi/access/logout");
});
$("reload-version").onclick = () => {
  const url = new URL(location.href);
  url.searchParams.set("deploy", guard.current || VERSION);
  url.searchParams.set("reload", String(Date.now()));
  location.assign(url.href);
};
window.addEventListener("beforeunload", (e) => {
  if (dirty()) {
    try {
      sessionStorage.setItem(key(), JSON.stringify({ expires: Date.now() + 72e5, ...snapshot() }));
    } catch {
    }
    e.preventDefault();
    e.returnValue = "";
  }
});
setInterval(() => {
  guard.check().then(controls);
  if (state.session && !state.busy && !document.hidden) run(refresh);
}, 6e4);
window.addEventListener("focus", () => guard.check().then(controls));
$("cloud-date").value = taipeiDate();
if (guestPage) {
  $("cloud-authorize").hidden = true;
  $("cloud-master-file").closest("label").hidden = true;
  $("cloud-settle").closest("section").querySelectorAll("label,button").forEach((n) => n.hidden = true);
  $("cloud-connect").textContent = "\u4F7F\u7528\u9080\u8ACB\u78BC\u767B\u5165";
}
await guard.check();
controls();
if (!guestPage) try {
  const info = await setupRequest("storage-setup");
  $("cloud-owner-setup").hidden = false;
  $("cloud-owner-status").textContent = info.configured ? "\u516C\u53F8\u5132\u5B58\u5DF2\u8A2D\u5B9A\uFF1B\u6388\u6B0A\u5931\u6548\u6642\u53EF\u7531\u64C1\u6709\u8005\u91CD\u65B0\u6388\u6B0A\u3002" : info.clientReady ? "\u8ACB\u7531\u6307\u5B9A\u8CC7\u6599\u593E\u64C1\u6709\u8005\u5B8C\u6210\u4E00\u6B21Google\u6388\u6B0A\u3002" : "Google\u7528\u6236\u7AEF\u6191\u8B49\u6216\u4FDD\u7BA1\u5340\u5C1A\u672A\u8A2D\u5B9A\uFF0C\u8ACB\u7531\u7BA1\u7406\u8005\u5B8C\u6210\u8A2D\u5B9A\u3002";
  $("cloud-owner-start").disabled = !info.clientReady;
} catch {
}

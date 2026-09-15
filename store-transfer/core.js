(function (root, factory) {
  const api = factory();
  root.StoreTransferCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORE_ORDER = ["R00", "R01", "R03", "R10", "R07", "R06"];

  function localDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new Error("日期格式必須是 YYYY-MM-DD。");
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) throw new Error("日期不存在。");
    return date;
  }

  function isoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function isWorkingDay(date, holidays) {
    return date.getDay() !== 0 && date.getDay() !== 6 && !holidays.has(isoDate(date));
  }

  function previousWorkingDay(value, holidayDates) {
    const holidays = new Set(holidayDates || []);
    const date = localDate(value);
    while (!isWorkingDay(date, holidays)) date.setDate(date.getDate() - 1);
    return isoDate(date);
  }

  function nextWorkingDay(value, holidayDates) {
    const holidays = new Set(holidayDates || []);
    const date = localDate(value);
    while (!isWorkingDay(date, holidays)) date.setDate(date.getDate() + 1);
    return isoDate(date);
  }

  function allocateQuantity(total, weights, order) {
    const quantity = Math.max(0, Math.floor(Number(total) || 0));
    const stores = (order || Object.keys(weights || {})).filter((store) => Number(weights[store]) > 0);
    if (!quantity || !stores.length) return Object.fromEntries(stores.map((store) => [store, 0]));
    const weightTotal = stores.reduce((sum, store) => sum + Number(weights[store]), 0);
    const rows = stores.map((store, index) => {
      const exact = quantity * Number(weights[store]) / weightTotal;
      return { store, index, base: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let remaining = quantity - rows.reduce((sum, row) => sum + row.base, 0);
    rows.slice().sort((a, b) => b.remainder - a.remainder || a.index - b.index).forEach((row) => { if (remaining > 0) { row.base += 1; remaining -= 1; } });
    return Object.fromEntries(rows.map((row) => [row.store, row.base]));
  }

  function combinedAllocationWeights(storeSales42) {
    const eligible = Object.entries(storeSales42 || {}).filter(([, sales]) => Number(sales) > 0);
    const total = eligible.reduce((sum, [, sales]) => sum + Number(sales), 0);
    return Object.fromEntries(eligible.map(([store, sales]) => [store, .7 * Number(sales) / total + .3 / eligible.length]));
  }

  function normalizeName(value) {
    return String(value || "").normalize("NFKC").replace(/\s+/g, "").replace(/[×X＊]/g, "x");
  }

  function stockRule(record) {
    const value = normalizeName(`${record?.name || ""} ${record?.size || ""}`);
    const category = String(record?.style1 || "");
    if (/贈品|運費|客製|代工|拍照樣|拍攝樣|樣品|耗材|保費|折扣|折價|蝦幣|手續費|服務費|商品券/i.test(value) || /輔料|客製/.test(category)) return null;
    const standalone = [["3.5尺", /(?<![\dx*.])3\.5尺/], ["5尺", /(?<![\dx*.])5尺/], ["6尺", /(?<![\dx*.])6尺/], ["7尺", /(?<![\dx*.])7尺/]].find(([, pattern]) => pattern.test(value));
    if (standalone) return standalone[0] === "5尺" ? { role: "不可售展示", quantity: 1, note: "5尺不可售展示1件" } : { role: "可售最低庫存", quantity: 1, note: `${standalone[0]}可售最低庫存1件` };
    if (/6x7尺.*薄被套/.test(value)) return /天絲|華爾紗/.test(value) ? { role: "可售最低庫存", quantity: 1, note: "天絲／華爾紗雙人薄被套最低1件" } : { role: "不可售展示", quantity: 1, note: "雙人薄被套展示1件" };
    if (/6x7尺.*兩用被套/.test(value)) return { role: "不可售展示", quantity: 1, note: "雙人兩用被套展示1件" };
    if (/床包|被套/.test(value)) return null;
    if (/抱枕|靠枕/.test(value)) return { role: "不可售展示", quantity: 1, note: "抱枕／靠枕展示1件" };
    if (/枕套|枕頭套/.test(value)) return /(?:2|二|兩)(?:入|個|只|件|枚)|一對|x2(?:\D|$)/i.test(value) ? { role: "不可售展示", quantity: 1, note: "枕套2入組展示1組" } : { role: "不可售展示", quantity: 2, note: "單入枕套展示2件" };
    if (/枕頭|枕芯|乳膠枕|羽絨枕|記憶枕|水洗枕|舒眠枕|柔眠枕/.test(value)) return { role: "不可售展示", quantity: 2, note: "枕頭／枕芯展示2件" };
    if (/\d+(?:\.\d+)?(?:尺|cm|公分)|\d+(?:\.\d+)?x\d+(?:\.\d+)?/i.test(value)) return { role: "不可售展示", quantity: 1, note: "有尺寸配件展示1件" };
    return null;
  }

  function daysBetween(value, latest) {
    return Math.floor((Date.parse(`${latest}T12:00:00`) - Date.parse(`${value}T12:00:00`)) / 86400000);
  }

  function buildSuggestions(input) {
    const stores = input.storeCodes || STORE_ORDER;
    const masterBySku = input.master.bySku;
    const inventory = new Map();
    for (const row of input.inventory.records) inventory.set(`${row.warehouseCode}|${row.sku}`, (inventory.get(`${row.warehouseCode}|${row.sku}`) || 0) + row.quantity);
    const sales = [...input.sales.flatMap((report) => report.records), ...input.sales.flatMap((report) => report.takeRecords || [])];
    const latest = input.sales.reduce((max, report) => report.maxDate > max ? report.maxDate : max, "");
    if (!latest) throw new Error("銷售明細沒有可辨識的結帳日期。");
    const local = new Map(), b3 = new Map(), activeWeeks = new Map();
    for (const row of sales) {
      const store = row.warehouseCode;
      if (!stores.includes(store) || daysBetween(row.date, latest) < 0 || daysBetween(row.date, latest) >= 42) continue;
      const qty = Number(row.deductQuantity || row.quantity || 0);
      if (row.shipWarehouseCode === store) {
        const key = `${store}|${row.sku}`; local.set(key, (local.get(key) || 0) + qty);
        if (qty > 0) { if (!activeWeeks.has(key)) activeWeeks.set(key, new Set()); activeWeeks.get(key).add(Math.floor(daysBetween(row.date, latest) / 7)); }
      } else if (row.shipWarehouseCode === "T00" && row.saleType === "取貨") {
        const key = `${store}|${row.sku}`; b3.set(key, (b3.get(key) || 0) + qty);
      }
    }
    const pendingInbound = new Map(), pendingOutbound = new Map();
    for (const row of input.transfer.records) {
      if (!['提交', '發貨審核'].includes(row.status)) continue;
      const outKey = `${row.sourceWarehouseCode}|${row.sku}`, inKey = `${row.destinationWarehouseCode}|${row.sku}`;
      if (row.status === '提交') pendingOutbound.set(outKey, (pendingOutbound.get(outKey) || 0) + row.quantity);
      pendingInbound.set(inKey, (pendingInbound.get(inKey) || 0) + row.quantity);
    }
    const needsBySku = new Map();
    for (const store of stores) {
      for (const [sku, master] of masterBySku) {
        const key = `${store}|${sku}`, local42 = Math.max(0, local.get(key) || 0), b342 = Math.max(0, b3.get(key) || 0);
        const performance = local42 + b342, weeks = activeWeeks.get(key)?.size || 0;
        const tier = performance >= 12 && weeks >= 4 ? "熱銷" : performance >= 4 && weeks >= 2 ? "穩定" : "低銷";
        const daily = local42 / 42;
        const target = tier === "熱銷" ? daily * 10 : tier === "穩定" ? daily * 7 : local42 > 0 ? 1 : 0;
        const rule = stockRule(master);
        const appliesDisplay = ["R00", "R06"].includes(store) && rule?.role === "不可售展示";
        const minimum = rule?.role === "可售最低庫存" ? rule.quantity : 0;
        const display = appliesDisplay ? rule.quantity : 0;
        const current = Math.max(0, (inventory.get(key) || 0) + (pendingInbound.get(key) || 0));
        const sellable = Math.max(0, current - display);
        const need = Math.max(0, Math.ceil(Math.max(target, minimum) - sellable - 1e-9));
        if (!need) continue;
        const row = { storeCode: store, sku, productName: master.name, localSales42: local42, b3Sales42: b342, currentInventory: current, tier, targetQuantity: Math.max(target, minimum), displayQuantity: display, rawNeed: need, ruleSummary: [tier, rule?.note, pendingInbound.get(key) ? `在途${pendingInbound.get(key)}件` : ""].filter(Boolean).join("；") };
        if (!needsBySku.has(sku)) needsBySku.set(sku, []); needsBySku.get(sku).push(row);
      }
    }
    const result = [];
    for (const [sku, rows] of needsBySku) {
      const available = Math.max(0, Math.floor((inventory.get(`T00|${sku}`) || 0) - (pendingOutbound.get(`T00|${sku}`) || 0)));
      const weights = combinedAllocationWeights(Object.fromEntries(rows.map((row) => [row.storeCode, row.localSales42 + row.b3Sales42 || 1])));
      const totalNeed = rows.reduce((sum, row) => sum + row.rawNeed, 0);
      let allocated;
      if (available >= totalNeed) allocated = Object.fromEntries(rows.map((row) => [row.storeCode, row.rawNeed]));
      else {
        allocated = Object.fromEntries(rows.map((row) => [row.storeCode, 0]));
        for (let unit = 0; unit < available; unit += 1) {
          const open = rows.filter((row) => allocated[row.storeCode] < row.rawNeed).sort((a, b) => (weights[b.storeCode] / (allocated[b.storeCode] + 1)) - (weights[a.storeCode] / (allocated[a.storeCode] + 1)) || STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode));
          if (!open.length) break; allocated[open[0].storeCode] += 1;
        }
      }
      for (const row of rows) if (allocated[row.storeCode] > 0) result.push({ ...row, suggestedQuantity: allocated[row.storeCode], hqAvailable: available, ruleSummary: `${row.ruleSummary}${available < totalNeed ? "；總倉不足依70/30分配" : ""}` });
    }
    return { latestSalesDate: latest, rows: result.sort((a, b) => STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode) || a.sku.localeCompare(b.sku)), totals: { itemCount: result.length, quantity: result.reduce((sum, row) => sum + row.suggestedQuantity, 0) } };
  }

  function buildErpWorkbook(items, XLSX, storeCode) {
    const rows = items.filter((item) => item.store_code === storeCode && Number(item.hq_approved_quantity) > 0).map((item) => ({ 貨號: item.sku, 品名: item.product_name, 顏色: "", 尺碼: "", 數量: Number(item.hq_approved_quantity), 價格: "", 備註: "門市週調撥", 倉庫: "" }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows, { header: ["貨號", "品名", "顏色", "尺碼", "數量", "價格", "備註", "倉庫"] }), "通用貨品數量");
    return workbook;
  }

  return { STORE_ORDER, previousWorkingDay, nextWorkingDay, allocateQuantity, combinedAllocationWeights, stockRule, buildSuggestions, buildErpWorkbook };
});

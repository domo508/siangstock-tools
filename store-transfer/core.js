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

  function excludedFromRegularTransfer(record) {
    const value = normalizeName(`${record?.name || ""} ${record?.size || ""}`);
    const category = String(record?.style1 || "");
    return /贈品|運費|客製|代工|拍照樣|拍攝樣|樣品|耗材|保費|折扣|折價|蝦幣|手續費|服務費|商品券/i.test(value) || /贈品|輔料|客製/.test(category);
  }

  function daysBetween(value, latest) {
    return Math.floor((Date.parse(`${latest}T12:00:00`) - Date.parse(`${value}T12:00:00`)) / 86400000);
  }

  function dateKey(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
    return date.toISOString().slice(0, 10);
  }

  function parseMarketingWorkbook(workbook, XLSX, asOfDate) {
    const reference = localDate(asOfDate);
    const year = reference.getFullYear();
    const referenceMs = Date.parse(`${asOfDate}T12:00:00Z`);
    const futureLimit = referenceMs + 21 * 86400000;
    const activities = [];
    const dateRange = /^(\d{1,2})\s*[\/.]\s*(\d{1,2})\s*(?:-|–|—|~|～|至)\s*(?:(\d{1,2})\s*[\/.]\s*)?(\d{1,2})(?=\s|$)/;
    const singleDate = /^(\d{1,2})\s*[\/.]\s*(\d{1,2})(?=\s|[-–—:：]|$)/;
    for (const sheetName of workbook.SheetNames || []) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });
      let section = "";
      rows.forEach((row) => {
        const rowText = row.map((value) => String(value || "").normalize("NFKC").trim()).filter(Boolean).join("\n");
        if (/門市銷售波段/.test(rowText)) section = "store";
        else if (/(?:官網|平台|電商).*銷售波段/.test(rowText)) section = "online";
        for (const cell of row) {
          const text = String(cell || "").normalize("NFKC").trim();
          if (!text || !/(?:\d{1,2}\s*[\/.]\s*\d{1,2})/.test(text)) continue;
          const segments = text.split(/\n(?=\s*\d{1,2}\s*[\/.]\s*\d{1,2})/).map((value) => value.trim()).filter(Boolean);
          segments.forEach((rawSegment) => {
            const range = rawSegment.match(dateRange);
            const single = range ? null : rawSegment.match(singleDate);
            if (!range && !single) return;
            const segment = rawSegment.replace(/\s+/g, " ").trim();
            const startMonth = Number((range || single)[1]), startDay = Number((range || single)[2]);
            const endMonth = range ? Number(range[3] || range[1]) : startMonth;
            const endDay = range ? Number(range[4]) : new Date(Date.UTC(year, startMonth, 0)).getUTCDate();
            const start = dateKey(year, startMonth, startDay);
            const endYear = endMonth < startMonth ? year + 1 : year;
            const end = dateKey(endYear, endMonth, endDay);
            if (!start || !end) return;
            const startMs = Date.parse(`${start}T12:00:00Z`), endMs = Date.parse(`${end}T12:00:00Z`);
            if (endMs < referenceMs || startMs > futureLimit) return;
            const explicitOnlineOnly = /門市不參與|官網專屬|電商專屬/.test(segment);
            if (explicitOnlineOnly) return;
            const giftSkus = [...segment.matchAll(/贈品(?:貨號|品號)\s*[：:]\s*([A-Z0-9-]+)/gi)].map((item) => item[1].toUpperCase());
            const isGift = /贈|滿額禮|滿件禮|加價購/.test(segment) || giftSkus.length > 0;
            if (!isGift) return;
            const amountMatch = segment.match(/(?:消費)?滿\s*(?:NT\$|\$)?\s*([\d,]+)\s*元?/i);
            const pieceMatch = amountMatch ? null : segment.match(/(?:滿|任選|購買)[^\d]{0,16}(\d+)\s*(?:件|組)/);
            const giftQuantityMatch = segment.match(/贈(?:送)?[^，。；]{0,24}?(\d+)\s*(?:件|個|組)/);
            const thresholdType = amountMatch ? "amount" : (pieceMatch ? "quantity" : "manual");
            const thresholdValue = Number(String(amountMatch?.[1] || pieceMatch?.[1] || "0").replace(/,/g, ""));
            const cumulative = !/不累贈|每(?:筆|單)[^，。；]{0,16}(?:限|最多)[^，。；]{0,8}(?:1|一|乙)(?:件|個|組)/.test(segment);
            activities.push({
              sheetName, section, startDate: start, endDate: end, description: segment.slice(0, 420), giftSkus: [...new Set(giftSkus)],
              thresholdType, thresholdValue, giftQuantity: Math.max(1, Number(giftQuantityMatch?.[1] || 1)), cumulative,
              thresholdText: amountMatch ? `滿${thresholdValue.toLocaleString("zh-TW")}元` : (pieceMatch ? `滿${thresholdValue}件` : "門檻需人工確認")
            });
          });
        }
      });
    }
    const seen = new Set();
    const unique = activities.filter((activity) => {
      const key = `${activity.startDate}|${activity.endDate}|${activity.giftSkus.join(",")}|${activity.description}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    return {
      activities: unique,
      giftActivities: unique.filter((activity) => activity.giftSkus.length),
      warnings: unique.flatMap((activity) => [
        ...(!activity.giftSkus.length ? [`${activity.startDate}～${activity.endDate}活動未標示贈品貨號，需人工確認。`] : []),
        ...(activity.giftSkus.length && activity.thresholdType === "manual" ? [`${activity.startDate}～${activity.endDate}贈品活動未辨識到滿額或滿件門檻，先依實際耗用估算並保留人工確認。`] : [])
      ])
    };
  }

  function buildStoreOrderStats(sales, stores, latest) {
    const orders = new Map();
    const seenLines = new Set();
    for (const row of sales) {
      if (!stores.includes(row.warehouseCode) || row.shipWarehouseCode !== row.warehouseCode) continue;
      const age = daysBetween(row.date, latest);
      if (age < 0 || age >= 42) continue;
      const orderId = String(row.posOrder || row.sourceOrder || "").trim();
      if (!orderId) continue;
      const lineKey = [row.warehouseCode, orderId, row.transactionTimestamp || row.date, row.sku, row.quantity, row.actualAmount].join("|");
      if (seenLines.has(lineKey)) continue;
      seenLines.add(lineKey);
      const key = `${row.warehouseCode}|${orderId}`;
      const order = orders.get(key) || { storeCode: row.warehouseCode, orderId, date: row.date, amount: 0, quantity: 0 };
      order.amount += Number(row.actualAmount || 0);
      order.quantity += Number(row.quantity || 0);
      if (row.date > order.date) order.date = row.date;
      orders.set(key, order);
    }
    const result = new Map();
    for (const storeCode of stores) {
      const storeOrders = [...orders.values()].filter((order) => order.storeCode === storeCode && order.amount > 0);
      const recent21 = storeOrders.filter((order) => daysBetween(order.date, latest) < 21);
      result.set(storeCode, {
        orders42: storeOrders,
        orderCount42: storeOrders.length,
        orderCount21: recent21.length,
        averageTicket: storeOrders.length ? storeOrders.reduce((sum, order) => sum + order.amount, 0) / storeOrders.length : null,
        dailyOrders: recent21.length / 21
      });
    }
    return result;
  }

  function forecastQualifiedGifts(activity, stats, coverageDays) {
    if (!stats || !stats.orderCount42 || !activity.thresholdValue || !["amount", "quantity"].includes(activity.thresholdType)) {
      return { status: "manual", eligibleRate: null, forecastOrders: null, forecastGifts: null };
    }
    const units = stats.orders42.map((order) => {
      const base = activity.thresholdType === "amount" ? order.amount : Math.max(0, order.quantity);
      if (base < activity.thresholdValue) return 0;
      return (activity.cumulative ? Math.floor(base / activity.thresholdValue) : 1) * activity.giftQuantity;
    });
    const eligibleOrders = units.filter((value) => value > 0).length;
    const eligibleRate = eligibleOrders / stats.orderCount42;
    const giftsPerOrder = units.reduce((sum, value) => sum + value, 0) / stats.orderCount42;
    const forecastOrders = Math.ceil(stats.dailyOrders * coverageDays);
    return { status: "calculated", eligibleRate, forecastOrders, forecastGifts: Math.ceil(forecastOrders * giftsPerOrder) };
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
        if (excludedFromRegularTransfer(master)) continue;
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
      for (const row of rows) if (allocated[row.storeCode] > 0) result.push({ ...row, itemType: "regular", suggestedQuantity: allocated[row.storeCode], hqAvailable: available, ruleSummary: `${row.ruleSummary}${available < totalNeed ? "；總倉不足依70/30分配" : ""}` });
    }
    const regularBySku = new Map();
    result.forEach((row) => regularBySku.set(row.sku, (regularBySku.get(row.sku) || 0) + row.suggestedQuantity));
    const storeOrderStats = buildStoreOrderStats(sales, stores, latest);
    const activityRows = [];
    const activityKeys = new Set();
    for (const activity of input.marketing?.giftActivities || []) {
      const remainingDays = Math.max(0, Math.floor((Date.parse(`${activity.endDate}T12:00:00`) - Date.parse(`${latest}T12:00:00`)) / 86400000) + 1);
      const coverageDays = Math.min(21, remainingDays);
      for (const sku of activity.giftSkus) {
        const master = masterBySku.get(sku);
        const hqAvailable = Math.max(0, Math.floor((inventory.get(`T00|${sku}`) || 0) - (pendingOutbound.get(`T00|${sku}`) || 0) - (regularBySku.get(sku) || 0)));
        const candidates = stores.map((storeCode) => {
          const key = `${storeCode}|${sku}`;
          const recentUsage = sales.reduce((sum, row) => {
            if (row.warehouseCode !== storeCode || row.shipWarehouseCode !== storeCode || row.sku !== sku) return sum;
            const age = daysBetween(row.date, latest);
            return age >= 0 && age < 21 ? sum + Math.max(0, Number(row.deductQuantity || row.quantity || 0)) : sum;
          }, 0);
          const current = Math.max(0, (inventory.get(key) || 0) + (pendingInbound.get(key) || 0));
          const usageForecast = recentUsage > 0 ? Math.ceil(recentUsage / 21 * coverageDays) : 0;
          const stats = storeOrderStats.get(storeCode);
          const qualification = forecastQualifiedGifts(activity, stats, coverageDays);
          const thresholdForecast = qualification.forecastGifts || 0;
          const target = qualification.status === "calculated" ? Math.max(usageForecast, thresholdForecast) : usageForecast;
          return { storeCode, current, recentUsage, rawNeed: Math.max(0, target - current), target, usageForecast, qualification, stats };
        });
        const totalNeed = candidates.reduce((sum, row) => sum + row.rawNeed, 0);
        const openCandidates = candidates.filter((row) => row.rawNeed > 0);
        const weights = Object.fromEntries(openCandidates.map((row) => [row.storeCode, row.target || row.recentUsage || 1]));
        const allocated = hqAvailable >= totalNeed
          ? Object.fromEntries(candidates.map((row) => [row.storeCode, row.rawNeed]))
          : allocateQuantity(hqAvailable, weights, openCandidates.map((row) => row.storeCode));
        for (const candidate of candidates) {
          const key = `${candidate.storeCode}|${sku}`;
          if (activityKeys.has(key)) continue;
          activityKeys.add(key);
          const suggested = Math.min(candidate.rawNeed, allocated[candidate.storeCode] || 0);
          const qualificationText = candidate.qualification.status === "calculated"
            ? `${activity.thresholdText}${activity.cumulative ? "、可累贈" : "、不累贈"}；平均客單${Math.round(candidate.stats.averageTicket).toLocaleString("zh-TW")}元；近42天達標率${(candidate.qualification.eligibleRate * 100).toFixed(1)}%；預估${candidate.qualification.forecastOrders}筆訂單／${candidate.qualification.forecastGifts}件贈品`
            : `${activity.thresholdText}；訂單門檻資料不足`;
          const usageText = candidate.recentUsage > 0
            ? `近21天實際耗用${candidate.recentUsage}件／同期間推估${candidate.usageForecast}件`
            : "近21天無可辨識贈品耗用";
          activityRows.push({
            storeCode: candidate.storeCode, sku, productName: master?.name || `活動贈品 ${sku}`,
            localSales42: candidate.recentUsage, b3Sales42: 0, currentInventory: candidate.current,
            tier: "活動／贈品", targetQuantity: candidate.target, displayQuantity: 0, rawNeed: candidate.rawNeed,
            suggestedQuantity: suggested, hqAvailable, itemType: "activity_gift",
            activityPeriod: `${activity.startDate}～${activity.endDate}`,
            averageTicket: candidate.stats.averageTicket, eligibleRate: candidate.qualification.eligibleRate,
            forecastOrders: candidate.qualification.forecastOrders, forecastGiftQuantity: candidate.qualification.forecastGifts,
            thresholdText: activity.thresholdText, cumulative: activity.cumulative,
            ruleSummary: `活動／贈品；${activity.startDate}～${activity.endDate}；${qualificationText}；${usageText}；取兩種估算較高值${candidate.target}件${candidate.qualification.status === "manual" ? "，需人工確認" : ""}${hqAvailable < totalNeed ? "；總倉不足依需求比例分配" : ""}`
          });
        }
      }
    }
    const regularRows = result.sort((a, b) => STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode) || a.sku.localeCompare(b.sku));
    activityRows.sort((a, b) => STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode) || a.sku.localeCompare(b.sku));
    const rows = [...regularRows, ...activityRows];
    return {
      latestSalesDate: latest, rows, regularRows, activityRows, marketingWarnings: input.marketing?.warnings || [],
      totals: { itemCount: rows.length, quantity: rows.reduce((sum, row) => sum + row.suggestedQuantity, 0), regularItemCount: regularRows.length, activityItemCount: activityRows.length }
    };
  }

  function buildErpWorkbook(items, XLSX, storeCode) {
    const grouped = new Map();
    items.filter((item) => item.store_code === storeCode && Number(item.hq_approved_quantity) > 0).forEach((item) => {
      const current = grouped.get(item.sku) || { sku: item.sku, productName: item.product_name, quantity: 0, types: new Set() };
      current.quantity += Number(item.hq_approved_quantity);
      current.types.add(item.item_type === "activity_gift" ? "活動／贈品" : "一般補貨");
      grouped.set(item.sku, current);
    });
    const rows = [...grouped.values()].map((item) => ({ 貨號: item.sku, 品名: item.productName, 顏色: "", 尺碼: "", 數量: item.quantity, 價格: "", 備註: [...item.types].join("＋"), 倉庫: "" }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows, { header: ["貨號", "品名", "顏色", "尺碼", "數量", "價格", "備註", "倉庫"] }), "通用貨品數量");
    return workbook;
  }

  return { STORE_ORDER, previousWorkingDay, nextWorkingDay, allocateQuantity, combinedAllocationWeights, stockRule, parseMarketingWorkbook, buildSuggestions, buildErpWorkbook };
});

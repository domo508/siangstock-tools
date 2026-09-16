(function (root, factory) {
  const api = factory();
  root.StoreTransferCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORE_ORDER = ["R00", "R01", "R03", "R10", "R07", "R06"];
  const CONSUMABLES = Object.freeze({
    P11041: { name: "紡布提袋 25' [65×45×20][大]", size: "大" },
    P11042: { name: "紡布提袋 25' [48×31×12][中]", size: "中" },
    P11043: { name: "紡布提袋 25' [30×30×10][小]", size: "小" }
  });

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

  function addCalendarDays(value, days) {
    const date = localDate(value);
    date.setDate(date.getDate() + Number(days || 0));
    return isoDate(date);
  }

  function nextWeekdayAfter(value, weekday) {
    const date = localDate(value);
    do date.setDate(date.getDate() + 1); while (date.getDay() !== weekday);
    return isoDate(date);
  }

  function storeSchedule(proposalDate, storeCode, storeInventory) {
    const holidays = storeInventory?.workdayHolidays || [];
    const defaultWeekdays = { R00: 3, R01: 4, R03: 4, R10: 3, R07: 3, R06: 4 };
    const weekday = Math.min(4, Math.max(3, Number(storeInventory?.arrivalWeekdayByStore?.[storeCode] ?? defaultWeekdays[storeCode] ?? 3)));
    const currentArrivalBase = nextWeekdayAfter(proposalDate, weekday);
    let nextFriday = nextWeekdayAfter(proposalDate, 5);
    while (previousWorkingDay(nextFriday, holidays) <= proposalDate) nextFriday = addCalendarDays(nextFriday, 7);
    const nextArrivalBase = addCalendarDays(nextFriday, weekday === 3 ? 5 : 6);
    const currentArrivalDate = nextWorkingDay(currentArrivalBase, holidays);
    const nextArrivalDate = nextWorkingDay(nextArrivalBase, holidays);
    return {
      storeCode,
      arrivalWeekday: weekday,
      currentArrivalDate,
      nextProposalDate: previousWorkingDay(nextFriday, holidays),
      nextArrivalDate,
      coverageDays: Math.max(1, daysBetween(proposalDate, nextArrivalDate)),
      preArrivalDays: Math.max(0, daysBetween(proposalDate, currentArrivalDate))
    };
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

  function configuredRule(base, storeInventory) {
    if (!base || !storeInventory || !Array.isArray(storeInventory.rules)) return base;
    const managed = storeInventory.rules.find((rule) => String(rule?.name || "") === base.name);
    if (!managed || managed.enabled === false) return null;
    const quantity = Number(managed.quantity);
    return {
      ...base,
      role: ["不可售展示", "可售最低庫存", "可售特殊備貨", "排除規則"].includes(managed.inventoryRole) ? managed.inventoryRole : base.role,
      quantity: Number.isInteger(quantity) && quantity >= 0 ? quantity : base.quantity,
      scope: String(managed.scope || base.scope || "R00、R06"),
      priority: Number(managed.priority || 0)
    };
  }

  function builtInStockRule(record, storeInventory) {
    const value = normalizeName(`${record?.name || ""} ${record?.size || ""}`);
    const standalone = [["3.5尺", /(?<![\dx*.])3\.5尺/], ["5尺", /(?<![\dx*.])5尺/], ["6尺", /(?<![\dx*.])6尺/], ["7尺", /(?<![\dx*.])7尺/]].find(([, pattern]) => pattern.test(value));
    if (standalone) return configuredRule(standalone[0] === "5尺"
      ? { name: "獨立5尺商品", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "5尺不可售展示1件" }
      : { name: "獨立3.5尺、6尺、7尺商品", role: "可售最低庫存", quantity: 1, scope: "全部有銷售資料的營運門市", note: `${standalone[0]}可售最低庫存1件` }, storeInventory);
    if (/6x7尺.*薄被套/.test(value)) return configuredRule(/天絲|華爾紗/.test(value)
      ? { name: "6×7尺雙人薄被套天絲／華爾紗", role: "可售最低庫存", quantity: 1, scope: "全部有銷售資料的營運門市", note: "天絲／華爾紗雙人薄被套最低1件" }
      : { name: "6×7尺雙人薄被套一般材質", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "雙人薄被套展示1件" }, storeInventory);
    if (/6x7尺.*兩用被套/.test(value)) return configuredRule({ name: "6×7尺雙人兩用被套", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "雙人兩用被套展示1件" }, storeInventory);
    if (/床包|被套/.test(value)) return null;
    if (/抱枕|靠枕/.test(value)) return configuredRule({ name: "抱枕、靠枕及相關套件", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "抱枕／靠枕展示1件" }, storeInventory);
    if (/枕套|枕頭套/.test(value)) return configuredRule(/(?:2|二|兩)(?:入|個|只|件|枚)|一對|x2(?:\D|$)/i.test(value)
      ? { name: "枕套2入組", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "枕套2入組展示1組" }
      : { name: "枕套1入／單入", role: "不可售展示", quantity: 2, scope: "R00、R06", note: "單入枕套展示2件" }, storeInventory);
    if (/枕頭|枕芯|乳膠枕|羽絨枕|記憶枕|水洗枕|舒眠枕|柔眠枕/.test(value)) return configuredRule({ name: "枕頭／枕芯", role: "不可售展示", quantity: 2, scope: "R00、R06", note: "枕頭／枕芯展示2件" }, storeInventory);
    if (/\d+(?:\.\d+)?(?:尺|cm|公分)|\d+(?:\.\d+)?x\d+(?:\.\d+)?/i.test(value)) return configuredRule({ name: "有尺寸配件", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "有尺寸配件展示1件" }, storeInventory);
    return null;
  }

  function productRuleFacts(record) {
    const fields = {
      mainCategory: normalizeName(record?.mainCategory),
      style1: normalizeName(record?.style1),
      style2: normalizeName(record?.style2),
      sizeGroup: normalizeName(record?.sizeGroup),
      size: normalizeName(record?.size),
      name: normalizeName(record?.name)
    };
    const categorySource = `${fields.mainCategory}${fields.style1}${fields.style2}`;
    const itemSource = `${categorySource}${fields.name}${fields.sizeGroup}${fields.size}`;
    const isKnownNoSize = /枕套|枕頭套|枕頭|枕芯|乳膠枕|羽絨枕|記憶枕|水洗枕|舒眠枕|柔眠枕|抱枕|靠枕|毛巾|浴巾|手巾|方巾/.test(itemSource);
    const hasBedDimension = /(?<![\dx*.])(?:3\.5|5|6|7)尺|6x7尺|\d+(?:\.\d+)?(?:cm|公分)|\d+(?:\.\d+)?x\d+(?:\.\d+)?/i.test(`${fields.sizeGroup}${fields.size}${fields.name}`);
    let productCategory = "";
    if (/配件/.test(categorySource) || isKnownNoSize || /保潔墊/.test(itemSource)) productCategory = "配件";
    else if (/床包/.test(itemSource)) productCategory = "床包";
    else if (/被套/.test(itemSource)) productCategory = "被套";
    else productCategory = String(record?.mainCategory || record?.style1 || "").trim();
    let sizeAttribute = "";
    if (/無尺寸/.test(`${fields.sizeGroup}${fields.size}`) || isKnownNoSize) sizeAttribute = "無尺寸";
    else if (/有尺寸/.test(`${fields.sizeGroup}${fields.size}`) || hasBedDimension) sizeAttribute = "有尺寸";
    else if (productCategory === "配件") sizeAttribute = "無尺寸";
    return { productCategory, sizeAttribute, itemSource };
  }

  function normalizedRuleConditions(rule) {
    const productCategory = String(rule?.productCategory || "").trim();
    const sizeAttribute = String(rule?.sizeAttribute || "").trim();
    const itemTypeKeywords = String(rule?.itemTypeKeywords || "").trim();
    if (rule?.conditionMode === "structured") {
      if ((!productCategory || productCategory === "全部") && (!sizeAttribute || sizeAttribute === "全部") && !itemTypeKeywords) return null;
      return { productCategory, sizeAttribute, itemTypeKeywords };
    }
    const legacy = normalizeName(`${rule?.name || ""}${rule?.matchText || ""}`);
    if (/無尺寸配件|配件.*無尺寸/.test(legacy)) return { productCategory: "配件", sizeAttribute: "無尺寸", itemTypeKeywords: "" };
    if (/有尺寸配件|配件.*有尺寸/.test(legacy)) return { productCategory: "配件", sizeAttribute: "有尺寸", itemTypeKeywords: "" };
    return null;
  }

  function matchesManagedRule(record, rule) {
    const conditions = normalizedRuleConditions(rule);
    if (!conditions) return false;
    const facts = productRuleFacts(record);
    if (conditions.productCategory && conditions.productCategory !== "全部" && normalizeName(conditions.productCategory) !== normalizeName(facts.productCategory)) return false;
    if (conditions.sizeAttribute && conditions.sizeAttribute !== "全部" && conditions.sizeAttribute !== facts.sizeAttribute) return false;
    const keywords = conditions.itemTypeKeywords.split(/[|｜、,，]/).map(normalizeName).filter(Boolean);
    return !keywords.length || keywords.some((keyword) => facts.itemSource.includes(keyword));
  }

  function managedConditionRule(record, storeInventory) {
    const rules = Array.isArray(storeInventory?.rules) ? storeInventory.rules : [];
    const match = rules.filter((rule) => rule?.enabled !== false && matchesManagedRule(record, rule))
      .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0))[0];
    if (!match) return null;
    return {
      name: String(match.name || "自訂門市規則"),
      role: String(match.inventoryRole || "可售最低庫存"),
      quantity: Math.max(0, Number(match.quantity || 0)),
      scope: String(match.scope || "R00、R06"),
      priority: Number(match.priority || 0),
      note: `${String(match.name || "自訂門市規則")}：${String(match.inventoryRole || "庫存規則")}${Math.max(0, Number(match.quantity || 0))}件`
    };
  }

  function stockRule(record, storeInventory) {
    if (excludedFromRegularTransfer(record)) return null;
    const candidates = [builtInStockRule(record, storeInventory), managedConditionRule(record, storeInventory)].filter(Boolean);
    return candidates.sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0))[0] || null;
  }

  function appliesToStore(rule, store, localSales42) {
    if (!rule) return false;
    const scope = String(rule.scope || "");
    if (/全部有銷售資料/.test(scope)) return Number(localSales42) > 0;
    const codes = scope.match(/R\d{2}/g) || [];
    return codes.length ? codes.includes(store) : true;
  }

  function managedRuleByName(storeInventory, name, fallback) {
    if (!storeInventory || !Array.isArray(storeInventory.rules)) return fallback;
    const rule = storeInventory.rules.find((item) => String(item?.name || "") === name);
    if (!rule || rule.enabled === false) return null;
    return { ...fallback, role: rule.inventoryRole || fallback.role, quantity: Math.max(0, Number(rule.quantity ?? fallback.quantity)), scope: String(rule.scope || fallback.scope), priority: Number(rule.priority || 0) };
  }

  function excludedFromRegularTransfer(record) {
    const value = normalizeName(`${record?.name || ""} ${record?.size || ""}`);
    const category = String(record?.style1 || "");
    return /贈品|運費|客製|代工|拍照樣|拍攝樣|樣品|耗材|保費|折扣|折價|蝦幣|手續費|服務費|商品券/i.test(value) || /贈品|輔料|客製/.test(category);
  }

  function daysBetween(value, latest) {
    return Math.floor((Date.parse(`${latest}T12:00:00`) - Date.parse(`${value}T12:00:00`)) / 86400000);
  }

  function addDays(value, days) {
    const date = localDate(value);
    date.setDate(date.getDate() + Math.max(0, Math.floor(days)));
    return isoDate(date);
  }

  function projectedSellThroughDate(asOfDate, baseSellableQuantity, addedQuantity, dailySales) {
    const daily = Number(dailySales || 0);
    if (!(daily > 0)) return "近期無現場銷售";
    const available = Math.max(0, Number(baseSellableQuantity || 0) + Number(addedQuantity || 0));
    return addDays(asOfDate, Math.floor(available / daily));
  }

  function isSingleDuvet(record) {
    const value = normalizeName(`${record?.name || ""} ${record?.size || ""}`);
    return /單人.*(?:薄被套|兩用被套)|(?:薄被套|兩用被套).*單人/.test(value);
  }

  function materialName(record) {
    const value = normalizeName(`${record?.mainCategory || ""} ${record?.style1 || ""} ${record?.style2 || ""} ${record?.name || ""}`);
    const match = value.match(/天絲棉|天絲|長絨棉|華爾紗|純棉|精梳棉|水洗棉|石墨烯|牛奶絲|涼感|法蘭絨|羊毛|羽絨/);
    return match?.[0] || String(record?.mainCategory || record?.style1 || "其它材質").trim() || "其它材質";
  }

  function singleDuvetType(record) {
    return /兩用被套/.test(normalizeName(`${record?.name || ""} ${record?.style1 || ""} ${record?.style2 || ""}`)) ? "單人兩用被套" : "單人薄被套";
  }

  function sStockProtection(available, usage14, usage42, usage84) {
    const stock = Math.max(0, Math.floor(Number(available || 0)));
    if (stock > 5) return { level: "一般", reserve: 0, releasable: stock, reason: "總倉S品庫存高於5件" };
    let level = "無周轉", reserve = 0;
    if (usage42 >= 2 || usage14 > 0) { level = "高周轉"; reserve = Math.min(stock, 2); }
    else if (usage42 >= 1) { level = "中周轉"; reserve = Math.min(stock, 1); }
    else if (usage84 > 0) { level = "低周轉"; reserve = Math.min(stock, 1); }
    return { level, reserve, releasable: Math.max(0, stock - reserve), reason: `${level}；總部保留${reserve}件` };
  }

  function generalHqStockProtection(available, usage14, usage42, usage84, coverageDays) {
    const stock = Math.max(0, Math.floor(Number(available || 0)));
    const rates = [Number(usage14 || 0) / 14, Number(usage42 || 0) / 42, Number(usage84 || 0) / 84];
    const daily = Math.max(0, ...rates);
    const reserve = Math.min(stock, Math.ceil(daily * Math.max(1, Number(coverageDays || 1)) - 1e-9));
    return {
      level: daily > 0 ? "總部需求保護" : "近期無總部耗用",
      daily,
      reserve,
      releasable: Math.max(0, stock - reserve),
      reason: daily > 0
        ? `總部14／42／84天耗用${Number(usage14 || 0)}／${Number(usage42 || 0)}／${Number(usage84 || 0)}件；以最高日速${daily.toFixed(3)}保留${reserve}件`
        : "近84天無可辨識總部耗用，不另保留安全庫存"
    };
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
    const proposalDate = input.proposalDate || input.sales.reduce((max, report) => report.maxDate > max ? report.maxDate : max, "");
    const scheduleByStore = Object.fromEntries(stores.map((store) => [store, storeSchedule(proposalDate, store, input.storeInventory || {})]));
    const masterBySku = input.master.bySku;
    const inventory = new Map();
    for (const row of input.inventory.records) inventory.set(`${row.warehouseCode}|${row.sku}`, (inventory.get(`${row.warehouseCode}|${row.sku}`) || 0) + row.quantity);
    const regularSales = input.sales.flatMap((report) => report.records);
    const takeSales = input.sales.flatMap((report) => report.takeRecords || []);
    const dedupe = (rows, take = false) => {
      const seen = new Set();
      return rows.filter((row) => {
        const transaction = take ? (row.pickupOrder || row.sourceOrder || row.transactionTimestamp || row.date) : (row.sourceOrder || row.posOrder || row.pickupOrder || row.transactionTimestamp || row.date);
        const key = [take ? "B3" : row.saleType, row.warehouseCode, row.shipWarehouseCode, transaction, row.sku, row.quantity, row.deductQuantity, row.actualAmount || 0].join("|");
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
    };
    const primarySales = dedupe(regularSales);
    const uniqueTakeSales = dedupe(takeSales, true);
    const orderKeys = new Set(primarySales.filter((row) => row.saleType === "訂貨" && row.sourceOrder).map((row) => `${row.sourceOrder}|${row.sku}`));
    const b3PendingRows = [];
    const matchedTakeSales = uniqueTakeSales.filter((row) => {
      const eligible = /^R\d{2}$/.test(row.warehouseCode || "") && row.shipWarehouseCode === "T00" && row.saleType === "取貨";
      if (!eligible) return false;
      const matched = Boolean(row.sourceOrder) && orderKeys.has(`${row.sourceOrder}|${row.sku}`);
      if (!matched) b3PendingRows.push({ storeCode: row.warehouseCode, sku: row.sku, sourceOrder: row.sourceOrder || "", pickupOrder: row.pickupOrder || "", quantity: Number(row.deductQuantity || row.quantity || 0), reason: "來源單號＋ERP品號無法配對門市訂貨" });
      return matched;
    });
    const sales = [...primarySales, ...matchedTakeSales];
    const latest = input.sales.reduce((max, report) => report.maxDate > max ? report.maxDate : max, "");
    if (!latest) throw new Error("銷售明細沒有可辨識的結帳日期。");

    const local = new Map(), b3 = new Map(), activeWeeks = new Map();
    const hqUsage14 = new Map(), hqUsage42 = new Map(), hqUsage84 = new Map();
    const hqDirect14 = new Map(), hqDirect42 = new Map(), hqDirect84 = new Map();
    for (const row of sales) {
      const age = daysBetween(row.date, latest);
      if (age < 0) continue;
      const qty = Number(row.deductQuantity || row.quantity || 0);
      const store = row.warehouseCode;
      if (stores.includes(store) && age < 42) {
        if (row.shipWarehouseCode === store) {
          const key = `${store}|${row.sku}`; local.set(key, (local.get(key) || 0) + qty);
          if (qty > 0) { if (!activeWeeks.has(key)) activeWeeks.set(key, new Set()); activeWeeks.get(key).add(Math.floor(age / 7)); }
        } else if (row.shipWarehouseCode === "T00" && row.saleType === "取貨") {
          const key = `${store}|${row.sku}`; b3.set(key, (b3.get(key) || 0) + qty);
        }
      }
      const hqDirect = row.shipWarehouseCode === "T00" && !/^R\d{2}$/.test(store || "");
      const b3Take = row.shipWarehouseCode === "T00" && row.saleType === "取貨";
      if ((hqDirect || b3Take) && age < 84) {
        const amount = Number.isFinite(qty) ? qty : 0;
        hqUsage84.set(row.sku, (hqUsage84.get(row.sku) || 0) + amount);
        if (age < 42) hqUsage42.set(row.sku, (hqUsage42.get(row.sku) || 0) + amount);
        if (age < 14) hqUsage14.set(row.sku, (hqUsage14.get(row.sku) || 0) + amount);
        if (hqDirect) {
          hqDirect84.set(row.sku, (hqDirect84.get(row.sku) || 0) + amount);
          if (age < 42) hqDirect42.set(row.sku, (hqDirect42.get(row.sku) || 0) + amount);
          if (age < 14) hqDirect14.set(row.sku, (hqDirect14.get(row.sku) || 0) + amount);
        }
      }
    }

    const pendingInbound = new Map(), pendingOutbound = new Map();
    for (const row of input.transfer.records) {
      if (!["提交", "發貨審核"].includes(row.status)) continue;
      const outKey = `${row.sourceWarehouseCode}|${row.sku}`, inKey = `${row.destinationWarehouseCode}|${row.sku}`;
      if (row.status === "提交") pendingOutbound.set(outKey, (pendingOutbound.get(outKey) || 0) + row.quantity);
      pendingInbound.set(inKey, (pendingInbound.get(inKey) || 0) + row.quantity);
    }

    const specialTopTwo = new Map();
    const specialRule = managedRuleByName(input.storeInventory, "單人薄被套／單人兩用被套材質前2名", { role: "可售特殊備貨", quantity: 1, scope: "R00、R06" });
    for (const store of stores) {
      if (!specialRule || !appliesToStore(specialRule, store, 1)) continue;
      const groups = new Map();
      for (const [sku, master] of masterBySku) {
        if (master.sellThroughStop || excludedFromRegularTransfer(master) || !isSingleDuvet(master)) continue;
        const sold = Math.max(0, local.get(`${store}|${sku}`) || 0);
        if (!(sold > 0)) continue;
        const group = `${singleDuvetType(master)}|${materialName(master)}`;
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push({ sku, sold, weeks: activeWeeks.get(`${store}|${sku}`)?.size || 0 });
      }
      for (const rows of groups.values()) {
        rows.sort((a, b) => b.sold - a.sold || b.weeks - a.weeks || a.sku.localeCompare(b.sku));
        rows.slice(0, 2).forEach((row) => specialTopTwo.set(`${store}|${row.sku}`, specialRule.quantity));
      }
    }

    const needsBySku = new Map();
    for (const store of stores) {
      for (const [sku, master] of masterBySku) {
        if (CONSUMABLES[sku] || excludedFromRegularTransfer(master)) continue;
        const key = `${store}|${sku}`, local42 = Math.max(0, local.get(key) || 0), b342 = Math.max(0, b3.get(key) || 0);
        const performance = local42 + b342, weeks = activeWeeks.get(key)?.size || 0;
        const tier = performance >= 12 && weeks >= 4 ? "熱銷" : performance >= 4 && weeks >= 2 ? "穩定" : "低銷";
        const daily = local42 / 42;
        const schedule = scheduleByStore[store];
        const target = daily * schedule.coverageDays;
        const rule = stockRule(master, input.storeInventory);
        if (rule?.role === "排除規則") continue;
        const ruleApplies = appliesToStore(rule, store, local42);
        const appliesDisplay = ruleApplies && rule?.role === "不可售展示";
        const minimum = ruleApplies && rule?.role === "可售最低庫存" ? rule.quantity : 0;
        const display = appliesDisplay ? rule.quantity : 0;
        const current = Math.max(0, (inventory.get(key) || 0) + (pendingInbound.get(key) || 0));
        const displayGap = Math.max(0, display - current);
        const sellable = Math.max(0, current - display);
        const sellableNeed = Math.max(0, Math.ceil(Math.max(target, minimum) - sellable - 1e-9));
        const normalNeed = displayGap + sellableNeed;
        const specialNeed = specialTopTwo.has(key) ? Math.max(0, Number(specialTopTwo.get(key)) - sellable) : 0;
        const itemType = specialNeed > 0 && normalNeed <= specialNeed ? "special_stock" : "regular";
        const need = itemType === "special_stock" ? specialNeed : normalNeed;
        if (!need) continue;
        const row = {
          storeCode: store, sku, productName: master.name, localSales42: local42, b3Sales42: b342,
          currentInventory: current, tier, targetQuantity: Math.max(target, minimum, specialNeed), displayQuantity: display,
          displayGap, sellableNeed, rawNeed: need, itemType,
          baseSellableQuantity: Math.max(0, sellable - daily * schedule.preArrivalDays), dailySales: daily, calculationDate: schedule.currentArrivalDate,
          currentArrivalDate: schedule.currentArrivalDate, nextArrivalDate: schedule.nextArrivalDate, coverageDays: schedule.coverageDays,
          preArrivalStockoutRisk: daily > 0 && sellable < daily * schedule.preArrivalDays,
          systemSellThroughDate: projectedSellThroughDate(schedule.currentArrivalDate, Math.max(0, sellable - daily * schedule.preArrivalDays), need, daily),
          isSellThroughStop: Boolean(master.sellThroughStop),
          ruleSummary: [itemType === "special_stock" ? `${singleDuvetType(master)}／${materialName(master)}前2名花色；建議維持1件，非必要調撥` : `${tier}；保護${schedule.coverageDays}天至${schedule.nextArrivalDate}`, displayGap ? `展示缺口${displayGap}件另補` : "", rule?.note, pendingInbound.get(key) ? `在途${pendingInbound.get(key)}件` : "", daily > 0 && sellable < daily * schedule.preArrivalDays ? `本批${schedule.currentArrivalDate}到店前有缺貨風險` : ""].filter(Boolean).join("；")
        };
        if (!needsBySku.has(sku)) needsBySku.set(sku, []); needsBySku.get(sku).push(row);
      }
    }

    function allocateRows(rows, available) {
      const weights = combinedAllocationWeights(Object.fromEntries(rows.map((row) => [row.storeCode, row.localSales42 + row.b3Sales42 || 1])));
      const allocated = Object.fromEntries(rows.map((row) => [row.storeCode, 0]));
      for (let unit = 0; unit < available; unit += 1) {
        const open = rows.filter((row) => allocated[row.storeCode] < row.rawNeed).sort((a, b) => (weights[b.storeCode] / (allocated[b.storeCode] + 1)) - (weights[a.storeCode] / (allocated[a.storeCode] + 1)) || STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode));
        if (!open.length) break;
        allocated[open[0].storeCode] += 1;
      }
      return allocated;
    }

    const regularRows = [], specialStockRows = [], shortageRows = [];
    for (const [sku, allRows] of needsBySku) {
      const hqAvailable = Math.max(0, Math.floor((inventory.get(`T00|${sku}`) || 0) - (pendingOutbound.get(`T00|${sku}`) || 0)));
      const isS = allRows.some((row) => row.isSellThroughStop);
      const usage14 = Math.max(0, (isS ? hqUsage14 : hqDirect14).get(sku) || 0), usage42 = Math.max(0, (isS ? hqUsage42 : hqDirect42).get(sku) || 0), usage84 = Math.max(0, (isS ? hqUsage84 : hqDirect84).get(sku) || 0);
      const horizon = Math.max(...allRows.map((row) => row.coverageDays || 1));
      const protection = isS ? sStockProtection(hqAvailable, usage14, usage42, usage84) : generalHqStockProtection(hqAvailable, usage14, usage42, usage84, horizon);
      if (isS && protection.releasable === 0) continue;
      let remaining = protection.releasable;
      for (const type of ["regular", "special_stock"]) {
        let rows = allRows.filter((row) => row.itemType === type);
        if (isS && protection.level === "無周轉") rows = rows.filter((row) => row.localSales42 > 0);
        const allocated = allocateRows(rows, remaining);
        const used = Object.values(allocated).reduce((sum, value) => sum + value, 0);
        remaining = Math.max(0, remaining - used);
        for (const row of rows) {
          const suggested = allocated[row.storeCode] || 0;
          if (suggested > 0) {
            const output = { ...row, suggestedQuantity: suggested, hqAvailable, hqReserve: protection.reserve, hqReleasable: protection.releasable, systemSellThroughDate: projectedSellThroughDate(row.calculationDate, row.baseSellableQuantity, suggested, row.dailySales), ruleSummary: `${row.ruleSummary}；${isS ? "S品" : "總部安全庫存"}${protection.reason}，可釋出${protection.releasable}件${suggested < row.rawNeed ? "；總倉不足依70/30分配" : ""}` };
            (type === "special_stock" ? specialStockRows : regularRows).push(output);
          }
          const unfilled = Math.max(0, row.rawNeed - suggested);
          if (type === "regular" && unfilled > 0) shortageRows.push({ storeCode: row.storeCode, sku, productName: row.productName, demandQuantity: row.rawNeed, allocatedQuantity: suggested, unfilledQuantity: unfilled, itemType: "regular", currentArrivalDate: row.currentArrivalDate, nextArrivalDate: row.nextArrivalDate, followUpStatus: "待回拋主採購", reason: isS ? `S品僅可釋出${protection.releasable}件；${protection.reason}` : protection.reserve > 0 ? `總部安全庫存保留${protection.reserve}件；總倉可釋出${protection.releasable}件` : `總倉可用${hqAvailable}件，不足全部門市需求` });
        }
      }
    }
    regularRows.sort((a, b) => STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode) || a.sku.localeCompare(b.sku));
    specialStockRows.sort((a, b) => STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode) || a.sku.localeCompare(b.sku));

    const regularBySku = new Map();
    [...regularRows, ...specialStockRows].forEach((row) => regularBySku.set(row.sku, (regularBySku.get(row.sku) || 0) + row.suggestedQuantity));
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
          if (suggested > 0) activityRows.push({
            storeCode: candidate.storeCode, sku, productName: master?.name || `活動贈品 ${sku}`,
            localSales42: candidate.recentUsage, b3Sales42: 0, currentInventory: candidate.current,
            tier: "活動／贈品", targetQuantity: candidate.target, displayQuantity: 0, rawNeed: candidate.rawNeed,
            suggestedQuantity: suggested, hqAvailable, itemType: "activity_gift",
            calculationDate: latest, baseSellableQuantity: candidate.current, dailySales: 0,
            systemSellThroughDate: `活動至${activity.endDate}`,
            activityPeriod: `${activity.startDate}～${activity.endDate}`,
            averageTicket: candidate.stats.averageTicket, eligibleRate: candidate.qualification.eligibleRate,
            forecastOrders: candidate.qualification.forecastOrders, forecastGiftQuantity: candidate.qualification.forecastGifts,
            thresholdText: activity.thresholdText, cumulative: activity.cumulative,
            ruleSummary: `活動／贈品；${activity.startDate}～${activity.endDate}；${qualificationText}；${usageText}；取兩種估算較高值${candidate.target}件${candidate.qualification.status === "manual" ? "，需人工確認" : ""}${hqAvailable < totalNeed ? "；總倉不足依需求比例分配" : ""}`
          });
          const unfilled = Math.max(0, candidate.rawNeed - suggested);
          if (unfilled > 0) shortageRows.push({ storeCode: candidate.storeCode, sku, productName: master?.name || `活動贈品 ${sku}`, demandQuantity: candidate.rawNeed, allocatedQuantity: suggested, unfilledQuantity: unfilled, itemType: "activity_gift", reason: `活動贈品總倉可用${hqAvailable}件，不足活動需求` });
        }
      }
    }
    activityRows.sort((a, b) => STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode) || a.sku.localeCompare(b.sku));

    const history = input.consumableHistory || [];
    const consumableSnapshots = [], consumableNeedsBySku = new Map();
    for (const storeCode of stores) {
      for (const [sku, definition] of Object.entries(CONSUMABLES)) {
        const matching = history.filter((row) => (row.store_code || row.storeCode) === storeCode && (row.sku || "") === sku && (row.snapshot_date || row.snapshotDate) < latest)
          .sort((a, b) => String(b.snapshot_date || b.snapshotDate).localeCompare(String(a.snapshot_date || a.snapshotDate)));
        const previous = matching[0];
        const currentQuantity = Math.max(0, Number(inventory.get(`${storeCode}|${sku}`) || 0));
        let inbound = 0, outbound = 0, weeklyConsumption = null, trusted = false;
        if (previous) {
          const previousDate = previous.snapshot_date || previous.snapshotDate;
          const intervalDays = daysBetween(previousDate, latest);
          for (const transfer of input.transfer.records) {
            if (transfer.sku !== sku) continue;
            if (transfer.destinationWarehouseCode === storeCode && transfer.status === "收貨審核" && transfer.receivedDate > previousDate && transfer.receivedDate <= latest) inbound += Number(transfer.quantity || 0);
            if (transfer.sourceWarehouseCode === storeCode && ["發貨審核", "收貨審核"].includes(transfer.status) && transfer.shippedDate > previousDate && transfer.shippedDate <= latest) outbound += Number(transfer.quantity || 0);
          }
          const rawConsumption = Number(previous.quantity ?? previous.current_quantity ?? previous.currentQuantity ?? 0) + inbound - outbound - currentQuantity;
          trusted = intervalDays >= 4 && intervalDays <= 10 && rawConsumption >= 0;
          if (trusted) weeklyConsumption = rawConsumption * 7 / intervalDays;
        }
        const historicalConsumption = matching.filter((row) => Number(row.trusted) === 1 && Number(row.weekly_consumption ?? row.weeklyConsumption) >= 0)
          .map((row) => Number(row.weekly_consumption ?? row.weeklyConsumption));
        if (trusted) historicalConsumption.unshift(weeklyConsumption);
        const samples = historicalConsumption.slice(0, 6);
        const averageWeeklyUsage = samples.length >= 4 ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null;
        const projectedCurrent = currentQuantity + Math.max(0, pendingInbound.get(`${storeCode}|${sku}`) || 0);
        consumableSnapshots.push({ storeCode, sku, snapshotDate: latest, currentQuantity, inboundQuantity: inbound, outboundQuantity: outbound, weeklyConsumption, trusted });
        if (averageWeeklyUsage == null) continue;
        let triggerWeeks, targetWeeks, requiresManual = false;
        if (averageWeeklyUsage >= 50) { triggerWeeks = 2; targetWeeks = 4; }
        else if (averageWeeklyUsage >= 20) { triggerWeeks = 1.5; targetWeeks = 3; }
        else { triggerWeeks = 1; targetWeeks = 1; requiresManual = true; }
        if (projectedCurrent >= averageWeeklyUsage * triggerWeeks) continue;
        const rawGap = Math.max(0, averageWeeklyUsage * targetWeeks - projectedCurrent);
        const suggested = Math.max(100, Math.ceil(rawGap / 100) * 100);
        const row = {
          storeCode, sku, productName: definition.name, consumableSize: definition.size,
          currentInventory: projectedCurrent, averageWeeklyUsage, targetQuantity: averageWeeklyUsage * targetWeeks,
          rawNeed: suggested, itemType: "consumable", calculationDate: latest,
          baseSellableQuantity: projectedCurrent, dailySales: averageWeeklyUsage / 7,
          systemSellThroughDate: `約${((projectedCurrent + suggested) / Math.max(averageWeeklyUsage, .01)).toFixed(1)}週`,
          ruleSummary: `${definition.size}提袋；近${samples.length}週平均耗用${averageWeeklyUsage.toFixed(1)}個；目前約${(projectedCurrent / Math.max(averageWeeklyUsage, .01)).toFixed(1)}週；低於${triggerWeeks}週啟動，補至約${targetWeeks}週；建議${suggested / 100}箱／${suggested}個${requiresManual ? "，低耗用須人工確認" : ""}`
        };
        if (!consumableNeedsBySku.has(sku)) consumableNeedsBySku.set(sku, []);
        consumableNeedsBySku.get(sku).push(row);
      }
    }

    const consumableRows = [];
    for (const [sku, candidates] of consumableNeedsBySku) {
      const hqAvailable = Math.max(0, Math.floor((inventory.get(`T00|${sku}`) || 0) - (pendingOutbound.get(`T00|${sku}`) || 0)));
      const availableBoxes = Math.floor(hqAvailable / 100);
      const neededBoxes = Object.fromEntries(candidates.map((row) => [row.storeCode, row.rawNeed / 100]));
      const totalBoxes = Object.values(neededBoxes).reduce((sum, value) => sum + value, 0);
      const allocatedBoxes = availableBoxes >= totalBoxes
        ? neededBoxes
        : allocateQuantity(availableBoxes, Object.fromEntries(candidates.map((row) => [row.storeCode, row.averageWeeklyUsage || 1])), candidates.map((row) => row.storeCode));
      for (const row of candidates) {
        const suggested = Math.min(row.rawNeed, (allocatedBoxes[row.storeCode] || 0) * 100);
        if (suggested > 0) consumableRows.push({ ...row, suggestedQuantity: suggested, hqAvailable, systemSellThroughDate: `約${((row.currentInventory + suggested) / Math.max(row.averageWeeklyUsage, .01)).toFixed(1)}週`, ruleSummary: `${row.ruleSummary}${suggested < row.rawNeed ? `；總倉僅可配${suggested / 100}箱` : ""}` });
        const unfilled = Math.max(0, row.rawNeed - suggested);
        if (unfilled > 0) shortageRows.push({ storeCode: row.storeCode, sku, productName: row.productName, demandQuantity: row.rawNeed, allocatedQuantity: suggested, unfilledQuantity: unfilled, itemType: "consumable", reason: `提袋須以100個為單位；總倉可用${hqAvailable}個` });
      }
    }
    consumableRows.sort((a, b) => STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode) || a.sku.localeCompare(b.sku));
    shortageRows.sort((a, b) => STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode) || a.sku.localeCompare(b.sku));

    const rows = [...regularRows, ...specialStockRows, ...activityRows, ...consumableRows];
    return {
      latestSalesDate: latest, proposalDate, scheduleByStore, rows, regularRows, specialStockRows, activityRows, consumableRows, shortageRows, consumableSnapshots,
      marketingWarnings: input.marketing?.warnings || [],
      b3Audit: { matchedCount: matchedTakeSales.length, pendingCount: b3PendingRows.length, pendingRows: b3PendingRows },
      totals: {
        itemCount: rows.length, quantity: rows.reduce((sum, row) => sum + row.suggestedQuantity, 0),
        regularItemCount: regularRows.length, specialStockItemCount: specialStockRows.length,
        activityItemCount: activityRows.length, consumableItemCount: consumableRows.length,
        shortageItemCount: shortageRows.length
      }
    };
  }

  function buildErpWorkbook(items, XLSX, storeCode) {
    const grouped = new Map();
    items.filter((item) => item.store_code === storeCode && Number(item.hq_approved_quantity) > 0).forEach((item) => {
      const current = grouped.get(item.sku) || { sku: item.sku, productName: item.product_name, quantity: 0, types: new Set() };
      current.quantity += Number(item.hq_approved_quantity);
      current.types.add(({ activity_gift: "活動／贈品", special_stock: "建議備貨", consumable: "門市耗材" })[item.item_type] || "一般補貨");
      grouped.set(item.sku, current);
    });
    const rows = [...grouped.values()].map((item) => ({ 貨號: item.sku, 品名: item.productName, 顏色: "", 尺碼: "", 數量: item.quantity, 價格: "", 備註: [...item.types].join("＋"), 倉庫: "" }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows, { header: ["貨號", "品名", "顏色", "尺碼", "數量", "價格", "備註", "倉庫"] }), "通用貨品數量");
    return workbook;
  }

  return { STORE_ORDER, CONSUMABLES, previousWorkingDay, nextWorkingDay, storeSchedule, allocateQuantity, combinedAllocationWeights, stockRule, projectedSellThroughDate, sStockProtection, generalHqStockProtection, parseMarketingWorkbook, buildSuggestions, buildErpWorkbook };
});

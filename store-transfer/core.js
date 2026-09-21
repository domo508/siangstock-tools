(function (root, factory) {
  const api = factory();
  root.StoreTransferCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORE_ORDER = ["R00", "R01", "R03", "R10", "R07", "R06"];
  const STORE_COMPANY = Object.freeze({ R00: "寬承", R01: "寬承", R03: "寬沐", R06: "寬沐", R07: "寬沐", R09: "寬沐", R10: "寬沐" });
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
    const managedNames = [base.name, ...(Array.isArray(base.legacyNames) ? base.legacyNames : [])];
    const managed = storeInventory.rules.find((rule) => managedNames.includes(String(rule?.name || "")));
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
    const categoryValue = normalizeName(`${record?.mainCategory || ""} ${record?.style1 || ""} ${record?.style2 || ""}`);
    const isQuilt = !/被套/.test(value) && /被胎|棉被|被子|夏季被|四季被|涼被|羽絨被|羊毛被|蠶絲被|機能被|舒眠被|冷被|暖被/.test(value);
    const isNonStandardAccessoryBlanket = /熊冷被|涼毯|蓋毯/.test(value);
    if (isQuilt) {
      if (/6x7尺/.test(value)) return configuredRule({ name: "有尺寸配件", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "6×7尺棉被／被子展示1件" }, storeInventory);
      if (!isNonStandardAccessoryBlanket) return null;
    }
    const standalone = [["3.5尺", /(?<![\dx*.])3\.5尺/], ["5尺", /(?<![\dx*.])5尺/], ["6尺", /(?<![\dx*.])6尺/], ["7尺", /(?<![\dx*.])7尺/]].find(([, pattern]) => pattern.test(value));
    if (standalone) return configuredRule(standalone[0] === "5尺"
      ? { name: "獨立5尺商品", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "5尺不可售展示1件" }
      : { name: "獨立3.5尺、6尺、7尺商品", role: "可售最低庫存", quantity: 1, scope: "全部有銷售資料的營運門市", note: `${standalone[0]}可售最低庫存1件` }, storeInventory);
    if (/6x7尺.*薄被套/.test(value)) return configuredRule(/天絲|華爾紗|純棉|精梳棉|精梳純/.test(`${value}${categoryValue}`)
      ? { name: "6×7尺雙人薄被套天絲／華爾紗／純棉／精梳純棉", legacyNames: ["6×7尺雙人薄被套天絲／華爾紗"], role: "可售最低庫存", quantity: 1, scope: "全部有銷售資料的營運門市", note: "天絲／華爾紗／純棉／精梳純棉雙人薄被套最低1件" }
      : { name: "6×7尺雙人薄被套一般材質", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "雙人薄被套展示1件" }, storeInventory);
    if (/6x7尺.*兩用被套/.test(value)) return configuredRule({ name: "6×7尺雙人兩用被套", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "雙人兩用被套展示1件" }, storeInventory);
    if (/床包|被套/.test(value)) return null;
    if (/抱枕|靠枕/.test(value)) return configuredRule({ name: "抱枕、靠枕及相關套件", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "抱枕／靠枕展示1件" }, storeInventory);
    if (/枕套|枕頭套/.test(value)) return configuredRule(/(?:2|二|兩)(?:入|個|只|件|枚)|一對|x2(?:\D|$)/i.test(value)
      ? { name: "枕套2入組", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "枕套2入組展示1組" }
      : { name: "枕套1入／單入", role: "不可售展示", quantity: 2, scope: "R00、R06", note: "單入枕套展示2件" }, storeInventory);
    if (/枕頭|枕芯|乳膠枕|羽絨枕|鵝絨枕|記憶枕|水洗枕|舒眠枕|柔眠枕|軟枕|硬枕|午安枕|午睡枕|體驗枕|頸枕|好眠枕|忘憂枕|抗菌枕/.test(value) || /枕頭|枕芯/.test(categoryValue)) return configuredRule({ name: "枕頭／枕芯", role: "不可售展示", quantity: 2, scope: "R00、R06", note: "枕頭／枕芯展示2件" }, storeInventory);
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
    const isKnownNoSize = /枕套|枕頭套|枕頭|枕芯|乳膠枕|羽絨枕|鵝絨枕|記憶枕|水洗枕|舒眠枕|柔眠枕|軟枕|硬枕|午安枕|午睡枕|體驗枕|頸枕|好眠枕|忘憂枕|抗菌枕|抱枕|靠枕|毛巾|浴巾|手巾|方巾/.test(itemSource);
    const hasBedDimension = /(?<![\dx*.])(?:3\.5|5|6|7)尺|6x7尺|\d+(?:\.\d+)?(?:cm|公分)|\d+(?:\.\d+)?x\d+(?:\.\d+)?/i.test(`${fields.sizeGroup}${fields.size}${fields.name}`);
    const hasAccessorySize = /熊冷被|涼毯|蓋毯|單人|沙發|(?:M|L|XL|XXL)號|(?:大|小)(?:號|款|尺寸|[\]】)）]|$)/i.test(`${fields.sizeGroup}${fields.size}${fields.name}`);
    const isGeneralAccessory = /圍裙|坐墊|眼罩|萬年曆|束口袋|抓板|票卡|零錢包|室內鞋|室內拖鞋|拖鞋|鞋袋|香氛|空氣噴霧|熊冷被|涼毯|蓋毯/.test(itemSource);
    const isProtectedStandardQuilt = !/被套/.test(itemSource) && /被胎|棉被|被子|夏季被|四季被|涼被|羽絨被|羊毛被|蠶絲被|機能被|舒眠被|冷被|暖被/.test(itemSource) && /(?:4\.5x6\.5|8x7)尺/.test(itemSource) && !/熊冷被|涼毯|蓋毯/.test(itemSource);
    let productCategory = "";
    if (!isProtectedStandardQuilt && (/配件/.test(categorySource) || isKnownNoSize || isGeneralAccessory || /保潔墊/.test(itemSource))) productCategory = "配件";
    else if (/床包/.test(itemSource)) productCategory = "床包";
    else if (/被套/.test(itemSource)) productCategory = "被套";
    else productCategory = String(record?.mainCategory || record?.style1 || "").trim();
    let sizeAttribute = "";
    if (/無尺寸/.test(`${fields.sizeGroup}${fields.size}`) || isKnownNoSize) sizeAttribute = "無尺寸";
    else if (/有尺寸/.test(`${fields.sizeGroup}${fields.size}`) || hasBedDimension || hasAccessorySize) sizeAttribute = "有尺寸";
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

  function activityScope(segment) {
    const value = String(segment || "").normalize("NFKC").replace(/\s+/g, " ").trim();
    const compact = normalizeName(value);
    if (/全館|全店|全品項/.test(compact) || /^(?:\d{1,2}[\/.]\d{1,2}(?:[-–—~～至]\d{1,2}[\/.]?\d{1,2})?)?(?:消費|單筆消費)?滿/.test(compact)) {
      return { scopeType: "all", scopeLabel: "全館", scopeTargets: [], thresholdBasis: "order_total", thresholdBasisLabel: "整張訂單" };
    }
    const patterns = [
      ["category", "指定類別", /(?:指定(?:類別|品類)[：:]?|(?:類別|品類)[：:])([^\s，。；、()（）]{1,24})/],
      ["category", "指定類別", /(?:購買|任選)?([^\s，。；、()（）]{1,20})(?:類別|品類)(?=消費|商品|任選|購買|滿|且)/],
      ["series", "指定系列", /(?:指定系列[：:]?|系列[：:])([^\s，。；、()（）]{1,24})/],
      ["series", "指定系列", /(?:購買|任選)?([^\s，。；、()（）]{1,20})系列(?=消費|商品|任選|購買|滿|且)/],
      ["product", "指定品項", /(?:指定(?:品項|商品)[：:]?|(?:品項|商品)[：:])([^\s，。；()（）]{1,40})/]
    ];
    for (const [scopeType, label, pattern] of patterns) {
      const match = value.match(pattern);
      if (!match) continue;
      const targets = match[1].split(/[、,，|｜/]/).map((item) => item.replace(/^(?:購買|任選)/, "").replace(/(?:消費|商品|任選|購買|滿|且全單).*$/g, "").trim()).filter(Boolean);
      if (!targets.length) continue;
      const orderTotal = /(?:全單|整單|全館)[^，。；]{0,12}(?:滿|門檻)/.test(compact);
      return {
        scopeType, scopeLabel: `${label}：${targets.join("、")}`, scopeTargets: targets,
        thresholdBasis: orderTotal ? "order_total" : "scoped_subtotal",
        thresholdBasisLabel: orderTotal ? "訂單含指定範圍後，以整張訂單計算" : "只計指定範圍小計"
      };
    }
    return { scopeType: "unknown", scopeLabel: "適用範圍待確認", scopeTargets: [], thresholdBasis: "manual", thresholdBasisLabel: "人工確認" };
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
            const scope = activityScope(segment);
            activities.push({
              sheetName, section, startDate: start, endDate: end, description: segment.slice(0, 420), giftSkus: [...new Set(giftSkus)],
              thresholdType, thresholdValue, giftQuantity: Math.max(1, Number(giftQuantityMatch?.[1] || 1)), cumulative,
              thresholdText: amountMatch ? `滿${thresholdValue.toLocaleString("zh-TW")}元` : (pieceMatch ? `滿${thresholdValue}件` : "門檻需人工確認"),
              ...scope
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
        ...(activity.giftSkus.length && activity.thresholdType === "manual" ? [`${activity.startDate}～${activity.endDate}贈品活動未辨識到滿額或滿件門檻，先依實際耗用估算並保留人工確認。`] : []),
        ...(activity.giftSkus.length && activity.scopeType === "unknown" ? [`${activity.startDate}～${activity.endDate}贈品活動未辨識到全館或指定類別／系列／品項，停止套用全館訂單，改依實際耗用並保留人工確認。`] : [])
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
      const order = orders.get(key) || { storeCode: row.warehouseCode, orderId, date: row.date, amount: 0, quantity: 0, lines: [] };
      order.amount += Number(row.actualAmount || 0);
      order.quantity += Number(row.quantity || 0);
      order.lines.push({ sku: row.sku, amount: Number(row.actualAmount || 0), quantity: Number(row.quantity || 0) });
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
        dailyOrders: recent21.length / 21,
        latestDate: latest
      });
    }
    return result;
  }

  function scopedStoreOrderStats(activity, stats, masterBySku) {
    if (!stats || activity.scopeType === "unknown") return null;
    const scopeType = activity.scopeType || "all";
    const targets = (activity.scopeTargets || []).map(normalizeName).filter(Boolean);
    const matches = (line) => {
      if (scopeType === "all") return true;
      const master = masterBySku.get(line.sku) || {};
      const source = scopeType === "category"
        ? normalizeName(`${master.mainCategory || ""}${master.style1 || ""}${master.style2 || ""}${master.name || ""}`)
        : scopeType === "series"
          ? normalizeName(`${master.style1 || ""}${master.style2 || ""}${master.series || ""}${master.name || ""}`)
          : normalizeName(`${line.sku || ""}${master.name || ""}`);
      return targets.some((target) => source.includes(target));
    };
    const orders42 = stats.orders42.map((order) => {
      const lines = (order.lines || []).filter(matches);
      if (scopeType !== "all" && !lines.length) return null;
      return {
        ...order,
        scopedAmount: scopeType === "all" ? order.amount : lines.reduce((sum, line) => sum + Number(line.amount || 0), 0),
        scopedQuantity: scopeType === "all" ? order.quantity : lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)
      };
    }).filter(Boolean);
    const recent21 = orders42.filter((order) => daysBetween(order.date, stats.latestDate) < 21);
    return {
      ...stats, orders42, orderCount42: orders42.length, orderCount21: recent21.length,
      averageTicket: orders42.length ? orders42.reduce((sum, order) => sum + order.scopedAmount, 0) / orders42.length : null,
      dailyOrders: recent21.length / 21
    };
  }

  function forecastQualifiedGifts(activity, stats, coverageDays) {
    if (!stats || !stats.orderCount42 || !activity.thresholdValue || !["amount", "quantity"].includes(activity.thresholdType)) {
      return { status: "manual", eligibleRate: null, forecastOrders: null, forecastGifts: null };
    }
    const units = stats.orders42.map((order) => {
      const amount = !activity.thresholdBasis || activity.thresholdBasis === "order_total" ? order.amount : order.scopedAmount;
      const quantity = !activity.thresholdBasis || activity.thresholdBasis === "order_total" ? order.quantity : order.scopedQuantity;
      const base = activity.thresholdType === "amount" ? amount : Math.max(0, quantity);
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
    const matchedKuanmuB3 = matchedTakeSales.filter((row) => STORE_COMPANY[row.warehouseCode] === "寬沐");
    const rowCost = (row) => Number(row.purchaseCostAmount || row.storeCostAmount || row.registeredWarehouseCostAmount || 0)
      || Number(masterBySku.get(row.sku)?.unitCost || 0) * Number(row.deductQuantity || row.quantity || 0);
    const kuanmuB3BaseCost = matchedKuanmuB3.reduce((sum, row) => sum + rowCost(row), 0);
    const kuanmuReceivedTransfers = input.transfer.records.filter((row) => row.sourceWarehouseCode === "T00" && STORE_COMPANY[row.destinationWarehouseCode] === "寬沐" && row.status === "收貨審核");
    const kuanmuTransferBaseCost = kuanmuReceivedTransfers.reduce((sum, row) => sum + Number(masterBySku.get(row.sku)?.unitCost || 0) * Number(row.quantity || 0), 0);
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

    const calculationMode = input.calculationMode === "comparison" ? "comparison" : "formal";
    const submittedInbound = new Map(), inTransitInbound = new Map(), pendingOutbound = new Map();
    const pendingTransferRows = [];
    for (const row of input.transfer.records) {
      if (!["提交", "發貨審核"].includes(row.status)) continue;
      const outKey = `${row.sourceWarehouseCode}|${row.sku}`, inKey = `${row.destinationWarehouseCode}|${row.sku}`;
      if (row.status === "提交") {
        submittedInbound.set(inKey, (submittedInbound.get(inKey) || 0) + row.quantity);
        if (calculationMode === "formal") pendingOutbound.set(outKey, (pendingOutbound.get(outKey) || 0) + row.quantity);
      } else {
        inTransitInbound.set(inKey, (inTransitInbound.get(inKey) || 0) + row.quantity);
      }
      if (stores.includes(row.destinationWarehouseCode)) pendingTransferRows.push({
        storeCode: row.destinationWarehouseCode,
        sku: row.sku,
        productName: row.name || masterBySku.get(row.sku)?.name || "",
        documentCode: row.documentCode || "",
        status: row.status,
        quantity: Number(row.quantity || 0),
        openedDate: row.openedDate || "",
        shippedDate: row.shippedDate || "",
        includedInCalculation: row.status === "發貨審核" || calculationMode === "formal"
      });
    }
    const includedInbound = (key) => (inTransitInbound.get(key) || 0) + (calculationMode === "formal" ? (submittedInbound.get(key) || 0) : 0);

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
        const physicalInventory = Math.max(0, inventory.get(key) || 0);
        const pendingSubmittedQuantity = Math.max(0, submittedInbound.get(key) || 0);
        const inTransitQuantity = Math.max(0, inTransitInbound.get(key) || 0);
        const current = Math.max(0, physicalInventory + includedInbound(key));
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
          currentInventory: current, physicalInventory, pendingSubmittedQuantity, inTransitQuantity,
          tier, targetQuantity: Math.max(target, minimum, specialNeed), displayQuantity: display,
          displayGap, sellableNeed, rawNeed: need, itemType,
          baseSellableQuantity: Math.max(0, sellable - daily * schedule.preArrivalDays), dailySales: daily, calculationDate: schedule.currentArrivalDate,
          currentArrivalDate: schedule.currentArrivalDate, nextArrivalDate: schedule.nextArrivalDate, coverageDays: schedule.coverageDays,
          preArrivalStockoutRisk: daily > 0 && sellable < daily * schedule.preArrivalDays,
          systemSellThroughDate: projectedSellThroughDate(schedule.currentArrivalDate, Math.max(0, sellable - daily * schedule.preArrivalDays), Math.max(0, need - displayGap), daily),
          isSellThroughStop: Boolean(master.sellThroughStop),
          ruleSummary: [itemType === "special_stock" ? `${singleDuvetType(master)}／${materialName(master)}前2名花色；建議維持1件，非必要調撥` : `${tier}；保護${schedule.coverageDays}天至${schedule.nextArrivalDate}`, displayGap ? `展示缺口${displayGap}件另補` : "", rule?.note, pendingSubmittedQuantity ? `${calculationMode === "comparison" ? "A/B測試排除待發貨" : "待發貨"}${pendingSubmittedQuantity}件` : "", inTransitQuantity ? `發貨在途${inTransitQuantity}件` : "", daily > 0 && sellable < daily * schedule.preArrivalDays ? `本批${schedule.currentArrivalDate}到店前有缺貨風險` : ""].filter(Boolean).join("；")
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
            const output = { ...row, suggestedQuantity: suggested, hqAvailable, hqReserve: protection.reserve, hqReleasable: protection.releasable, systemSellThroughDate: projectedSellThroughDate(row.calculationDate, row.baseSellableQuantity, Math.max(0, suggested - row.displayGap), row.dailySales), ruleSummary: `${row.ruleSummary}；${isS ? "S品" : "總部安全庫存"}${protection.reason}，可釋出${protection.releasable}件${suggested < row.rawNeed ? "；總倉不足依70/30分配" : ""}` };
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
    const marketingWarnings = [...(input.marketing?.warnings || [])];
    const activityGroups = new Map();
    for (const activity of input.marketing?.giftActivities || []) for (const sku of activity.giftSkus) {
      if (!activityGroups.has(sku)) activityGroups.set(sku, []);
      activityGroups.get(sku).push(activity);
    }
    for (const [sku, sourceActivities] of activityGroups) {
      const signatures = new Set(sourceActivities.map((activity) => [activity.scopeType || "all", (activity.scopeTargets || []).join("|"), activity.thresholdBasis || "order_total", activity.thresholdType, activity.thresholdValue, activity.giftQuantity, activity.cumulative].join("|")));
      const chronological = sourceActivities.slice().sort((left, right) => left.startDate.localeCompare(right.startDate));
      const continuous = chronological.every((row, index) => index === 0 || row.startDate <= addDays(chronological[index - 1].endDate, 1));
      let activity;
      if (signatures.size === 1 && continuous) {
        activity = { ...sourceActivities[0], startDate: sourceActivities.reduce((min, row) => row.startDate < min ? row.startDate : min, sourceActivities[0].startDate), endDate: sourceActivities.reduce((max, row) => row.endDate > max ? row.endDate : max, sourceActivities[0].endDate) };
      } else {
        activity = {
          ...sourceActivities[0], startDate: sourceActivities.reduce((min, row) => row.startDate < min ? row.startDate : min, sourceActivities[0].startDate), endDate: sourceActivities.reduce((max, row) => row.endDate > max ? row.endDate : max, sourceActivities[0].endDate),
          thresholdType: "manual", thresholdValue: 0, thresholdText: "多筆活動條件不同，需人工確認", scopeType: "unknown", scopeLabel: "多筆活動適用範圍不同", thresholdBasis: "manual", thresholdBasisLabel: "人工確認"
        };
        marketingWarnings.push(`${sku}同時出現在多筆條件不同或期間不連續的活動；未直接相加或只取第一筆，已改以實際耗用估算並保留人工確認。`);
      }
      {
        const master = masterBySku.get(sku);
        const hqAvailable = Math.max(0, Math.floor((inventory.get(`T00|${sku}`) || 0) - (pendingOutbound.get(`T00|${sku}`) || 0) - (regularBySku.get(sku) || 0)));
        const candidates = stores.map((storeCode) => {
          const key = `${storeCode}|${sku}`;
          const schedule = scheduleByStore[storeCode];
          const serviceStart = schedule.currentArrivalDate > activity.startDate ? schedule.currentArrivalDate : activity.startDate;
          const protectionEnd = schedule.nextArrivalDate < activity.endDate ? schedule.nextArrivalDate : activity.endDate;
          const effectiveDays = serviceStart <= protectionEnd ? daysBetween(serviceStart, protectionEnd) + 1 : 0;
          const consumptionStart = proposalDate > activity.startDate ? proposalDate : activity.startDate;
          const dayBeforeArrival = addDays(schedule.currentArrivalDate, 0);
          const arrivalDate = localDate(dayBeforeArrival); arrivalDate.setDate(arrivalDate.getDate() - 1);
          const preArrivalEndCandidate = isoDate(arrivalDate);
          const preArrivalEnd = preArrivalEndCandidate < activity.endDate ? preArrivalEndCandidate : activity.endDate;
          const preArrivalDays = consumptionStart <= preArrivalEnd ? daysBetween(consumptionStart, preArrivalEnd) + 1 : 0;
          const recentUsage = sales.reduce((sum, row) => {
            if (row.warehouseCode !== storeCode || row.shipWarehouseCode !== storeCode || row.sku !== sku) return sum;
            const age = daysBetween(row.date, latest);
            return age >= 0 && age < 21 ? sum + Math.max(0, Number(row.deductQuantity || row.quantity || 0)) : sum;
          }, 0);
          const physicalInventory = Math.max(0, inventory.get(key) || 0);
          const pendingSubmittedQuantity = Math.max(0, submittedInbound.get(key) || 0);
          const inTransitQuantity = Math.max(0, inTransitInbound.get(key) || 0);
          const current = Math.max(0, physicalInventory + includedInbound(key));
          const dailyUsage = recentUsage / 21;
          const usageForecast = recentUsage > 0 ? Math.ceil(dailyUsage * effectiveDays) : 0;
          const stats = scopedStoreOrderStats(activity, storeOrderStats.get(storeCode), masterBySku);
          const qualification = forecastQualifiedGifts(activity, stats, effectiveDays);
          const thresholdForecast = qualification.forecastGifts || 0;
          const target = qualification.status === "calculated" ? Math.max(usageForecast, thresholdForecast) : usageForecast;
          const preArrivalQualification = forecastQualifiedGifts(activity, stats, preArrivalDays);
          const preArrivalUse = Math.max(Math.ceil(dailyUsage * preArrivalDays), preArrivalQualification.forecastGifts || 0);
          const projectedAtArrival = Math.max(0, current - preArrivalUse);
          return { storeCode, current, physicalInventory, pendingSubmittedQuantity, inTransitQuantity, projectedAtArrival, preArrivalUse, recentUsage, rawNeed: effectiveDays > 0 ? Math.max(0, target - projectedAtArrival) : 0, target, usageForecast, qualification, stats, effectiveDays, currentArrivalDate: schedule.currentArrivalDate, protectionEnd };
        });
        const totalNeed = candidates.reduce((sum, row) => sum + row.rawNeed, 0);
        const openCandidates = candidates.filter((row) => row.rawNeed > 0);
        const weights = Object.fromEntries(openCandidates.map((row) => [row.storeCode, row.target || row.recentUsage || 1]));
        const allocated = hqAvailable >= totalNeed
          ? Object.fromEntries(candidates.map((row) => [row.storeCode, row.rawNeed]))
          : allocateQuantity(hqAvailable, weights, openCandidates.map((row) => row.storeCode));
        for (const candidate of candidates) {
          const suggested = Math.min(candidate.rawNeed, allocated[candidate.storeCode] || 0);
          const qualificationText = candidate.qualification.status === "calculated"
            ? `${activity.thresholdText}${activity.cumulative ? "、可累贈" : "、不累贈"}；範圍平均客單${Math.round(candidate.stats.averageTicket).toLocaleString("zh-TW")}元；近42天範圍達標率${(candidate.qualification.eligibleRate * 100).toFixed(1)}%；預估${candidate.qualification.forecastOrders}筆訂單／${candidate.qualification.forecastGifts}件贈品`
            : `${activity.thresholdText}；訂單門檻資料不足`;
          const usageText = candidate.recentUsage > 0
            ? `近21天實際耗用${candidate.recentUsage}件／同期間推估${candidate.usageForecast}件`
            : "近21天無可辨識贈品耗用";
          activityRows.push({
            storeCode: candidate.storeCode, sku, productName: master?.name || `活動贈品 ${sku}`,
            localSales42: candidate.recentUsage, b3Sales42: 0, currentInventory: candidate.current,
            physicalInventory: candidate.physicalInventory, pendingSubmittedQuantity: candidate.pendingSubmittedQuantity, inTransitQuantity: candidate.inTransitQuantity,
            tier: "活動／贈品", targetQuantity: candidate.target, displayQuantity: 0, rawNeed: candidate.rawNeed,
            suggestedQuantity: suggested, hqAvailable, itemType: "activity_gift",
            calculationDate: latest, baseSellableQuantity: candidate.current, dailySales: 0,
            systemSellThroughDate: `活動至${activity.endDate}`,
            activityPeriod: `${activity.startDate}～${activity.endDate}`,
            activityScope: activity.scopeLabel || "全館", thresholdBasis: activity.thresholdBasisLabel || "整張訂單",
            matchingOrderCount: candidate.stats?.orderCount42 ?? null, averageTicket: candidate.stats?.averageTicket ?? null, eligibleRate: candidate.qualification.eligibleRate,
            forecastOrders: candidate.qualification.forecastOrders, forecastGiftQuantity: candidate.qualification.forecastGifts,
            currentArrivalDate: candidate.currentArrivalDate, effectiveDays: candidate.effectiveDays,
            thresholdText: activity.thresholdText, cumulative: activity.cumulative,
            ruleSummary: `活動／贈品；${activity.startDate}～${activity.endDate}；本批${candidate.currentArrivalDate}到店，有效估算${candidate.effectiveDays}天至${candidate.protectionEnd}；到店前預估耗用${candidate.preArrivalUse}件、到店時預估剩餘${candidate.projectedAtArrival}件；${qualificationText}；${usageText}；取兩種估算較高值${candidate.target}件${candidate.effectiveDays === 0 ? "；到店時活動已結束，本批不補" : ""}${candidate.qualification.status === "manual" ? "，需人工確認" : ""}${hqAvailable < totalNeed ? "；總倉不足依需求比例分配" : ""}`
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
        const transferKey = `${storeCode}|${sku}`;
        const pendingSubmittedQuantity = Math.max(0, submittedInbound.get(transferKey) || 0);
        const inTransitQuantity = Math.max(0, inTransitInbound.get(transferKey) || 0);
        const projectedCurrent = currentQuantity + includedInbound(transferKey);
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
          currentInventory: projectedCurrent, physicalInventory: currentQuantity, pendingSubmittedQuantity, inTransitQuantity,
          averageWeeklyUsage, targetQuantity: averageWeeklyUsage * targetWeeks,
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
    pendingTransferRows.sort((a, b) => STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode) || a.sku.localeCompare(b.sku) || a.documentCode.localeCompare(b.documentCode));

    const actionableActivityRows = activityRows.filter((row) => Number(row.suggestedQuantity) > 0);
    const rows = [...regularRows, ...specialStockRows, ...actionableActivityRows, ...consumableRows];
    const submittedRows = pendingTransferRows.filter((row) => row.status === "提交");
    const inTransitRows = pendingTransferRows.filter((row) => row.status === "發貨審核");
    const comparisonKeys = new Set([
      ...rows.map((row) => `${row.storeCode}|${row.sku}`),
      ...submittedRows.map((row) => `${row.storeCode}|${row.sku}`)
    ]);
    const comparisonFacts = [...comparisonKeys].map((compoundKey) => {
      const [storeCode, sku] = compoundKey.split("|");
      const systemRow = rows.find((row) => row.storeCode === storeCode && row.sku === sku);
      const master = masterBySku.get(sku) || {};
      const localSales42 = Math.max(0, local.get(compoundKey) || 0);
      const b3Sales42 = Math.max(0, b3.get(compoundKey) || 0);
      const schedule = scheduleByStore[storeCode];
      const rule = stockRule(master, input.storeInventory);
      const ruleApplies = rule && appliesToStore(rule, storeCode, localSales42);
      const displayQuantity = ruleApplies && rule.role === "不可售展示" ? Number(rule.quantity || 0) : 0;
      const physicalInventory = Math.max(0, inventory.get(compoundKey) || 0);
      const inTransitQuantity = Math.max(0, inTransitInbound.get(compoundKey) || 0);
      const baseSellableQuantity = Math.max(0, physicalInventory + inTransitQuantity - displayQuantity - (localSales42 / 42) * (schedule?.preArrivalDays || 0));
      return {
        storeCode, sku,
        productName: systemRow?.productName || master.name || submittedRows.find((row) => row.storeCode === storeCode && row.sku === sku)?.productName || "",
        physicalInventory: systemRow?.physicalInventory ?? physicalInventory,
        hqInventory: Math.max(0, inventory.get(`T00|${sku}`) || 0),
        displayQuantity: systemRow?.displayQuantity ?? displayQuantity,
        inTransitQuantity: systemRow?.inTransitQuantity ?? inTransitQuantity,
        localSales42: systemRow?.localSales42 ?? localSales42,
        b3Sales42: systemRow?.b3Sales42 ?? b3Sales42,
        dailySales: systemRow?.dailySales ?? localSales42 / 42,
        baseSellableQuantity: systemRow?.baseSellableQuantity ?? baseSellableQuantity,
        calculationDate: systemRow?.calculationDate || schedule?.currentArrivalDate || latest,
        suggestedQuantity: Number(systemRow?.suggestedQuantity || 0),
        systemSellThroughDate: systemRow?.systemSellThroughDate || projectedSellThroughDate(schedule?.currentArrivalDate || latest, baseSellableQuantity, 0, localSales42 / 42),
        itemType: systemRow?.itemType || "regular",
        ruleSummary: systemRow?.ruleSummary || [rule?.name, rule?.role, ruleApplies ? `適用${rule.quantity || 0}件` : ""].filter(Boolean).join("；")
      };
    });
    return {
      latestSalesDate: latest, proposalDate, scheduleByStore, calculationMode, rows, regularRows, specialStockRows, activityRows, consumableRows, shortageRows, consumableSnapshots, pendingTransferRows, comparisonFacts,
      marketingWarnings,
      b3Audit: { matchedCount: matchedTakeSales.length, pendingCount: b3PendingRows.length, pendingRows: b3PendingRows },
      companyImpact: {
        kuanmuB3Count: matchedKuanmuB3.length, kuanmuB3BaseCost,
        kuanmuTransferCount: kuanmuReceivedTransfers.length, kuanmuTransferBaseCost,
        kuanmuBaseCost: kuanmuB3BaseCost + kuanmuTransferBaseCost,
        kuanmuIntercompanyRevenue: (kuanmuB3BaseCost + kuanmuTransferBaseCost) * 1.11
      },
      totals: {
        itemCount: rows.length, quantity: rows.reduce((sum, row) => sum + row.suggestedQuantity, 0),
        regularItemCount: regularRows.length, specialStockItemCount: specialStockRows.length,
        activityItemCount: actionableActivityRows.length, consumableItemCount: consumableRows.length,
        shortageItemCount: shortageRows.length,
        pendingTransferItemCount: pendingTransferRows.length,
        pendingSubmittedQuantity: submittedRows.reduce((sum, row) => sum + row.quantity, 0),
        inTransitQuantity: inTransitRows.reduce((sum, row) => sum + row.quantity, 0),
        excludedSubmittedQuantity: calculationMode === "comparison" ? submittedRows.reduce((sum, row) => sum + row.quantity, 0) : 0,
        excludedSubmittedDocumentCount: calculationMode === "comparison" ? new Set(submittedRows.map((row) => row.documentCode)).size : 0
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

  const COMPARISON_COLUMNS = ["比較區塊", "ERP品號", "品名", "當時門市實際庫存", "當時總倉庫存", "列為展示品數量", "未完成調入量", "近42天門市銷售", "系統建議量(A)", "人工調撥量(B)", "差異(B-A)", "系統建議後可售至", "人工調撥數量可售至", "品項分類", "判斷分析"];

  function comparisonTypeLabel(type) {
    return ({ regular: "一般必要補貨", special_stock: "建議備貨", activity_gift: "活動／贈品", consumable: "門市耗材" })[type] || "一般必要補貨";
  }

  function buildComparisonReport(calculation, storeCode, storeName) {
    if (calculation?.calculationMode !== "comparison") throw new Error("只有A/B測試比對結果可以下載差異分析表。");
    const manualBySku = new Map();
    calculation.pendingTransferRows.filter((row) => row.storeCode === storeCode && row.status === "提交").forEach((row) => {
      const current = manualBySku.get(row.sku) || { quantity: 0, documents: new Set() };
      current.quantity += Number(row.quantity || 0);
      if (row.documentCode) current.documents.add(row.documentCode);
      manualBySku.set(row.sku, current);
    });
    const facts = new Map((calculation.comparisonFacts || []).filter((row) => row.storeCode === storeCode).map((row) => [row.sku, row]));
    const rows = [...new Set([...facts.keys(), ...manualBySku.keys()])].map((sku) => {
      const fact = facts.get(sku) || { sku, storeCode, productName: "", itemType: "regular", suggestedQuantity: 0, physicalInventory: 0, hqInventory: 0, displayQuantity: 0, inTransitQuantity: 0, localSales42: 0, dailySales: 0, baseSellableQuantity: 0, calculationDate: calculation.latestSalesDate };
      const aQuantity = Number(fact.suggestedQuantity || 0), bQuantity = Number(manualBySku.get(sku)?.quantity || 0);
      const section = aQuantity > 0 && bQuantity > 0 ? "A、B都有" : aQuantity > 0 ? "僅A" : "僅B";
      const difference = bQuantity - aQuantity;
      const documentText = [...(manualBySku.get(sku)?.documents || [])].join("、");
      const analysis = section === "A、B都有"
        ? `人工量${difference === 0 ? "與系統相同" : difference > 0 ? `比系統多${difference}件` : `比系統少${Math.abs(difference)}件`}。${fact.ruleSummary || ""}`
        : section === "僅A" ? `系統判定仍有補貨缺口，人工未開立。${fact.ruleSummary || ""}`
          : `人工已開立${documentText ? `（${documentText}）` : ""}，系統依現況未提出新增建議。${fact.ruleSummary || ""}`;
      return {
        section, sku, productName: fact.productName, physicalInventory: fact.physicalInventory, hqInventory: fact.hqInventory,
        displayQuantity: fact.displayQuantity, pendingQuantity: fact.inTransitQuantity, localSales42: fact.localSales42,
        aQuantity, bQuantity, difference,
        aProjection: fact.systemSellThroughDate,
        bProjection: projectedSellThroughDate(fact.calculationDate, fact.baseSellableQuantity, bQuantity, fact.dailySales),
        itemType: comparisonTypeLabel(fact.itemType), analysis
      };
    }).sort((left, right) => ["A、B都有", "僅A", "僅B"].indexOf(left.section) - ["A、B都有", "僅A", "僅B"].indexOf(right.section) || left.sku.localeCompare(right.sku));
    return {
      storeCode, storeName: storeName || storeCode, proposalDate: calculation.proposalDate, latestSalesDate: calculation.latestSalesDate,
      rows,
      summary: {
        both: rows.filter((row) => row.section === "A、B都有").length,
        onlyA: rows.filter((row) => row.section === "僅A").length,
        onlyB: rows.filter((row) => row.section === "僅B").length,
        totalA: rows.reduce((sum, row) => sum + row.aQuantity, 0),
        totalB: rows.reduce((sum, row) => sum + row.bQuantity, 0)
      }
    };
  }

  function buildComparisonWorkbook(calculation, XLSX, storeCode, storeName) {
    const report = buildComparisonReport(calculation, storeCode, storeName);
    const workbook = XLSX.utils.book_new();
    const worksheet = {};
    const merges = [];
    const set = (address, value, style) => { worksheet[address] = { v: value, t: typeof value === "number" ? "n" : "s", ...(style ? { s: style } : {}) }; };
    const merge = (range) => merges.push(XLSX.utils.decode_range(range));
    const titleStyle = { fill: { fgColor: { rgb: "15344A" } }, font: { name: "Arial", bold: true, color: { rgb: "FFFFFF" }, sz: 18 }, alignment: { vertical: "center" } };
    const infoStyle = { fill: { fgColor: { rgb: "EEF3F6" } }, font: { name: "Arial", color: { rgb: "36566C" }, sz: 10 }, alignment: { vertical: "center" } };
    const kpiStyle = { fill: { fgColor: { rgb: "B58B2A" } }, font: { name: "Arial", bold: true, color: { rgb: "FFFFFF" }, sz: 11 }, alignment: { horizontal: "center", vertical: "center" } };
    const kpiNoteStyle = { fill: { fgColor: { rgb: "FFF6D9" } }, font: { name: "Arial", color: { rgb: "6D5720" }, sz: 9 }, alignment: { horizontal: "center", vertical: "center" } };
    merge("A1:O2"); set("A1", `${report.storeName}｜本週調撥建議差異分析`, titleStyle);
    merge("A3:O3"); set("A3", `A＝本次A/B模式系統獨立建議（建議日 ${report.proposalDate}）　｜　B＝匯入調撥單中狀態為「提交」的人工調撥`, infoStyle);
    [["A","C",`A、B都有｜${report.summary.both} 項`,"共同品項，重點看數量差"],["D","F",`僅A｜${report.summary.onlyA} 項`,"系統有建議、人工未開"],["G","I",`僅B｜${report.summary.onlyB} 項`,"人工有開、系統未建議"],["J","L",`A建議總量｜${report.summary.totalA} 件`,"系統獨立建議量"],["M","O",`B手動總量｜${report.summary.totalB} 件`,"提交狀態人工調撥量"]].forEach(([left,right,label,note]) => { merge(`${left}5:${right}5`); merge(`${left}6:${right}6`); set(`${left}5`, label, kpiStyle); set(`${left}6`, note, kpiNoteStyle); });
    merge("A8:O8"); set("A8", `口徑：A/B模式完全排除「提交」調撥對門市需求與總倉可用量的影響；未完成調入量僅包含「發貨審核」在途量。近42天門市銷售截止 ${report.latestSalesDate}；B為匯入檔內提交狀態人工調撥量。`, { fill: { fgColor: { rgb: "F7F1E5" } }, font: { name: "Arial", color: { rgb: "5C5140" }, sz: 9 }, alignment: { wrapText: true, vertical: "center" } });
    let nextRow = 10;
    const sections = [["A、B都有","第一區：A、B都有品項","237A76"],["僅A","第二區：僅A有的品項","B07A1A"],["僅B","第三區：僅B有的品項","A64B5A"]];
    for (const [section, label, color] of sections) {
      const sectionRows = report.rows.filter((row) => row.section === section);
      merge(`A${nextRow}:O${nextRow}`); set(`A${nextRow}`, `${label}｜${sectionRows.length} 項`, { fill: { fgColor: { rgb: color } }, font: { name: "Arial", bold: true, color: { rgb: "FFFFFF" }, sz: 12 }, alignment: { vertical: "center" } });
      nextRow += 1;
      COMPARISON_COLUMNS.forEach((column, index) => set(XLSX.utils.encode_cell({ r: nextRow - 1, c: index }), column, { fill: { fgColor: { rgb: "E7EFF3" } }, font: { name: "Arial", bold: true, color: { rgb: "15344A" }, sz: 10 }, alignment: { wrapText: true, horizontal: "center", vertical: "center" } }));
      nextRow += 1;
      if (!sectionRows.length) { merge(`A${nextRow}:O${nextRow}`); set(`A${nextRow}`, "本區無品項", { font: { name: "Arial", italic: true, color: { rgb: "6B7F8E" } } }); nextRow += 2; continue; }
      for (const row of sectionRows) {
        const values = [row.section,row.sku,row.productName,row.physicalInventory,row.hqInventory,row.displayQuantity,row.pendingQuantity,row.localSales42,row.aQuantity,row.bQuantity,row.difference,row.aProjection,row.bProjection,row.itemType,row.analysis];
        values.forEach((value, index) => set(XLSX.utils.encode_cell({ r: nextRow - 1, c: index }), value, { font: { name: "Arial", sz: 10, color: { rgb: "243746" } }, alignment: { wrapText: true, vertical: "top", horizontal: index >= 3 && index <= 12 ? "center" : "left" }, fill: index >= 3 && index <= 7 ? { fgColor: { rgb: "EAF4F7" } } : index >= 11 && index <= 12 ? { fgColor: { rgb: "FFF5D9" } } : index === 14 ? { fgColor: { rgb: "F2F7F9" } } : undefined }));
        worksheet[`K${nextRow}`] = { f: `J${nextRow}-I${nextRow}`, t: "n", v: row.difference, s: worksheet[`K${nextRow}`].s };
        nextRow += 1;
      }
      nextRow += 1;
    }
    worksheet["!ref"] = `A1:O${Math.max(1, nextRow - 1)}`;
    worksheet["!merges"] = merges;
    worksheet["!cols"] = [14,15,38,13,13,13,13,13,13,13,13,20,20,16,50].map((wch) => ({ wch }));
    worksheet["!rows"] = Array.from({ length: nextRow }, (_, index) => ({ hpt: index < 2 ? 27 : index === 7 ? 58 : 25 }));
    worksheet["!freeze"] = { xSplit: 0, ySplit: 3, topLeftCell: "A4", activePane: "bottomLeft", state: "frozen" };
    XLSX.utils.book_append_sheet(workbook, worksheet, "調撥差異分析");
    return workbook;
  }

  return { STORE_ORDER, STORE_COMPANY, CONSUMABLES, previousWorkingDay, nextWorkingDay, storeSchedule, allocateQuantity, combinedAllocationWeights, stockRule, projectedSellThroughDate, sStockProtection, generalHqStockProtection, parseMarketingWorkbook, buildSuggestions, buildErpWorkbook, buildComparisonReport, buildComparisonWorkbook };
});

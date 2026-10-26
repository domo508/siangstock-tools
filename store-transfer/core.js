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
  const CUSTOM_TRANSFER_SKU_MARKERS = Object.freeze(["SA", "SB", "OA", "OB"]);

  function isCustomTransferSku(sku) {
    const normalized = String(sku || "").normalize("NFKC").trim().toUpperCase();
    return Boolean(normalized) && CUSTOM_TRANSFER_SKU_MARKERS.some((marker) => normalized.includes(marker));
  }

  function isCombinationTransferSku(sku) {
    const normalized = String(sku || "").normalize("NFKC").trim().toUpperCase();
    return /^O[A-Z0-9._/-]*$/.test(normalized);
  }

  function transferExclusionSkus(storeInventory) {
    return new Set((Array.isArray(storeInventory?.transferExclusions) ? storeInventory.transferExclusions : [])
      .filter((item) => item && item.enabled !== false)
      .map((item) => String(item.sku || "").normalize("NFKC").trim().toUpperCase())
      .filter(Boolean));
  }

  function normalizedApplicabilityRules(storeInventory) {
    return (Array.isArray(storeInventory?.applicabilityRules) ? storeInventory.applicabilityRules : [])
      .filter((item) => item && item.enabled !== false)
      .slice()
      .sort((left, right) => {
        const leftExact = left.matchType === "sku" ? 1 : 0;
        const rightExact = right.matchType === "sku" ? 1 : 0;
        return rightExact - leftExact || Number(right.priority || 0) - Number(left.priority || 0) || String(left.name || "").localeCompare(String(right.name || ""), "zh-Hant");
      });
  }

  function applicabilityRuleMatches(rule, product, storeCode) {
    if (rule.storeScope === "selected" && !(rule.stores || []).includes(storeCode)) return false;
    const sku = String(product?.sku || "").normalize("NFKC").trim().toUpperCase();
    if (rule.matchType === "sku") return sku === String(rule.sku || "").normalize("NFKC").trim().toUpperCase();
    const productName = normalizeName(product?.name || "").toLocaleLowerCase("zh-Hant");
    const keywords = (Array.isArray(rule.keywords) ? rule.keywords : String(rule.keywords || "").split(/[、,，|｜]/))
      .map((keyword) => normalizeName(keyword).toLocaleLowerCase("zh-Hant"))
      .filter(Boolean);
    if (!keywords.length) return false;
    return rule.keywordMode === "all" ? keywords.every((keyword) => productName.includes(keyword)) : keywords.some((keyword) => productName.includes(keyword));
  }

  function applicabilityRuleActive(rule, proposalDate) {
    const scheduleMode = String(rule.scheduleMode || "always");
    if (scheduleMode === "always") return true;
    if (scheduleMode === "date_range" || scheduleMode === "campaign") return Boolean(rule.startDate && rule.endDate && proposalDate >= rule.startDate && proposalDate <= rule.endDate);
    if (scheduleMode === "annual") {
      const monthDay = String(proposalDate || "").slice(5);
      const start = String(rule.startMonthDay || "");
      const end = String(rule.endMonthDay || "");
      if (!/^\d{2}-\d{2}$/.test(start) || !/^\d{2}-\d{2}$/.test(end)) return false;
      return start <= end ? monthDay >= start && monthDay <= end : monthDay >= start || monthDay <= end;
    }
    return false;
  }

  function transferApplicabilityDecision(storeInventory, product, storeCode, proposalDate) {
    const sku = String(product?.sku || "").normalize("NFKC").trim().toUpperCase();
    if (isCustomTransferSku(sku)) return { excluded: true, source: "custom_sku" };
    if (isCombinationTransferSku(sku)) return { excluded: true, source: "combination_sku" };
    if (transferExclusionSkus(storeInventory).has(sku)) return { excluded: true, source: "exact_exclusion" };
    for (const rule of normalizedApplicabilityRules(storeInventory)) {
      if (!applicabilityRuleMatches(rule, product, storeCode)) continue;
      const active = applicabilityRuleActive(rule, proposalDate);
      if (rule.action === "include_period") return { excluded: !active, source: "applicability_rule", rule };
      if (!active) continue;
      if (rule.action === "exclude") return { excluded: true, source: "applicability_rule", rule };
      if (rule.action === "allow") return { excluded: false, source: "applicability_rule", rule };
    }
    return { excluded: false, source: "default" };
  }

  function transferExclusionReason(decision) {
    if (!decision?.excluded) return "";
    if (decision.source === "custom_sku") return "客製品號（SA／SB／OA／OB）不自動產生周調撥建議";
    if (decision.source === "combination_sku") return "O開頭組合號不自動產生周調撥建議";
    if (decision.source === "exact_exclusion") return "已列入排除周調撥品號";
    if (decision.source === "applicability_rule") {
      const name = decision.rule?.name ? `「${decision.rule.name}」` : "周調撥適用規則";
      return decision.rule?.action === "include_period" ? `${name}目前不在納入期間` : `${name}設定為排除周調撥`;
    }
    return "依周調撥適用規則不自動產生建議";
  }

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

  function storeSchedule(proposalDate, storeCode, storeInventory, approvalDate = "") {
    const holidays = storeInventory?.workdayHolidays || [];
    if (approvalDate) {
      const currentArrivalDate = addCalendarDays(approvalDate, 2);
      const nextArrivalDate = addCalendarDays(currentArrivalDate, 7);
      return {
        storeCode,
        arrivalWeekday: localDate(currentArrivalDate).getDay(),
        currentArrivalDate,
        nextProposalDate: addCalendarDays(approvalDate, 7),
        nextArrivalDate,
        coverageDays: Math.max(1, daysBetween(proposalDate, nextArrivalDate)),
        preArrivalDays: Math.max(0, daysBetween(proposalDate, currentArrivalDate))
      };
    }
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
    const isPillowcaseProduct = /枕套|枕頭套/.test(normalizeName(record?.mainCategory)) || /^(?:\[[^\]]+\])?(?:枕套|枕頭套)/.test(value);
    const isQuilt = !/被套/.test(value) && /被胎|棉被|被子|夏季被|四季被|涼被|羽絨被|羊毛被|蠶絲被|機能被|舒眠被|冷被|暖被/.test(value);
    const isNonStandardAccessoryBlanket = /熊冷被|涼毯|蓋毯/.test(value);
    if (isQuilt) {
      if (/6x7尺/.test(value)) return configuredRule({ name: "有尺寸配件", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "6×7尺棉被／被子展示1件" }, storeInventory);
      if (!isNonStandardAccessoryBlanket) return null;
    }
    const standalone = [["3.5尺", /(?<![\dx*.])3\.5尺/], ["5尺", /(?<![\dx*.])5尺/], ["6尺", /(?<![\dx*.])6尺/], ["7尺", /(?<![\dx*.])7尺/]].find(([, pattern]) => pattern.test(value));
    if (standalone) return configuredRule(standalone[0] === "5尺"
      ? { name: "獨立5尺商品", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "5尺不可售展示1件" }
      : { name: "獨立3.5尺、6尺、7尺商品", role: "可售最低庫存", quantity: 1, scope: "近42天有該品號現場銷售的營運門市", note: `${standalone[0]}可售最低庫存1件` }, storeInventory);
    if (/6x7尺.*薄被套/.test(value)) return configuredRule(/天絲|華爾紗|純棉|精梳棉|精梳純/.test(`${value}${categoryValue}`)
      ? { name: "6×7尺雙人薄被套天絲／華爾紗／純棉／精梳純棉", legacyNames: ["6×7尺雙人薄被套天絲／華爾紗"], role: "可售最低庫存", quantity: 1, scope: "近42天有該品號現場銷售的營運門市", note: "天絲／華爾紗／純棉／精梳純棉雙人薄被套最低1件" }
      : { name: "6×7尺雙人薄被套一般材質", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "雙人薄被套展示1件" }, storeInventory);
    if (/6x7尺.*兩用被套/.test(value)) return configuredRule({ name: "6×7尺雙人兩用被套", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "雙人兩用被套展示1件" }, storeInventory);
    if (isPillowcaseProduct) return configuredRule(/(?:2|二|兩)(?:入|個|只|件|枚)|一對|x2(?:\D|$)/i.test(value)
      ? { name: "枕套2入組", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "枕套2入組展示1組" }
      : { name: "枕套1入／單入", role: "不可售展示", quantity: 2, scope: "R00、R06", note: "單入枕套展示2件" }, storeInventory);
    if (/床包|被套/.test(value)) return null;
    if (/抱枕|靠枕/.test(value)) return configuredRule({ name: "抱枕、靠枕及相關套件", role: "不可售展示", quantity: 1, scope: "R00、R06", note: "抱枕／靠枕展示1件" }, storeInventory);
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
    const isBearCoolingPad = /熊冷墊/.test(itemSource);
    const isKnownNoSize = /枕套|枕頭套|枕頭|枕芯|乳膠枕|羽絨枕|鵝絨枕|記憶枕|水洗枕|舒眠枕|柔眠枕|軟枕|硬枕|午安枕|午睡枕|體驗枕|頸枕|好眠枕|忘憂枕|抗菌枕|抱枕|靠枕|毛巾|浴巾|手巾|方巾|擦澡球|中筒襪|髮帶|洗衣膠囊|兒童睡袋/.test(itemSource);
    const hasBedDimension = /(?<![\dx*.])(?:3\.5|5|6|7)尺|6x7尺|\d+(?:\.\d+)?(?:cm|公分)|\d+(?:\.\d+)?x\d+(?:\.\d+)?/i.test(`${fields.sizeGroup}${fields.size}${fields.name}`);
    const hasAccessorySize = isBearCoolingPad || /熊冷被|涼毯|蓋毯|單人|沙發|(?:M|L|XL|XXL)號|(?:大|小)(?:號|款|尺寸|[\]】)）]|$)/i.test(`${fields.sizeGroup}${fields.size}${fields.name}`);
    const isGeneralAccessory = /圍裙|坐墊|眼罩|萬年曆|束口袋|抓板|票卡|零錢包|室內鞋|室內拖鞋|拖鞋|鞋袋|香氛|空氣噴霧|熊冷被|熊冷墊|涼毯|蓋毯/.test(itemSource);
    const isProtectedStandardQuilt = !/被套/.test(itemSource) && /被胎|棉被|被子|夏季被|四季被|涼被|羽絨被|羊毛被|蠶絲被|機能被|舒眠被|冷被|暖被/.test(itemSource) && /(?:4\.5x6\.5|8x7)尺/.test(itemSource) && !/熊冷被|涼毯|蓋毯/.test(itemSource);
    let productCategory = "";
    if (/床包/.test(itemSource)) productCategory = "床包";
    else if (/被套/.test(itemSource)) productCategory = "被套";
    else if (!isProtectedStandardQuilt && (/配件/.test(categorySource) || isKnownNoSize || isGeneralAccessory || /保潔墊/.test(itemSource))) productCategory = "配件";
    else productCategory = String(record?.mainCategory || record?.style1 || "").trim();
    let sizeAttribute = "";
    if (["床包", "被套"].includes(productCategory) && hasBedDimension) sizeAttribute = "有尺寸";
    else if (/無尺寸/.test(`${fields.sizeGroup}${fields.size}`) || isKnownNoSize) sizeAttribute = "無尺寸";
    else if (/有尺寸/.test(`${fields.sizeGroup}${fields.size}`) || hasBedDimension || hasAccessorySize) sizeAttribute = "有尺寸";
    else if (productCategory === "配件") sizeAttribute = "無尺寸";
    return { productCategory, sizeAttribute, itemSource };
  }

  function normalizedRuleConditions(rule) {
    const productCategory = String(rule?.productCategory || "").trim();
    const sizeAttribute = String(rule?.sizeAttribute || "").trim();
    const itemTypeKeywords = String(rule?.itemTypeKeywords || "").trim();
    const exactSkus = String(rule?.exactSkus || "").trim();
    if (rule?.conditionMode === "structured") {
      if ((!productCategory || productCategory === "全部") && (!sizeAttribute || sizeAttribute === "全部") && !itemTypeKeywords && !exactSkus) return null;
      return { productCategory, sizeAttribute, itemTypeKeywords, exactSkus };
    }
    const legacy = normalizeName(`${rule?.name || ""}${rule?.matchText || ""}`);
    if (/無尺寸配件|配件.*無尺寸/.test(legacy)) return { productCategory: "配件", sizeAttribute: "無尺寸", itemTypeKeywords: "", exactSkus: "" };
    if (/有尺寸配件|配件.*有尺寸/.test(legacy)) return { productCategory: "配件", sizeAttribute: "有尺寸", itemTypeKeywords: "", exactSkus: "" };
    return null;
  }

  function matchesManagedRule(record, rule) {
    const conditions = normalizedRuleConditions(rule);
    if (!conditions) return false;
    const facts = productRuleFacts(record);
    if (conditions.productCategory && conditions.productCategory !== "全部" && normalizeName(conditions.productCategory) !== normalizeName(facts.productCategory)) return false;
    if (conditions.sizeAttribute && conditions.sizeAttribute !== "全部" && conditions.sizeAttribute !== facts.sizeAttribute) return false;
    const skus = conditions.exactSkus.split(/[|｜、,，\s]+/).map((value) => value.normalize("NFKC").trim().toLocaleUpperCase("en-US")).filter(Boolean);
    if (skus.length && !skus.includes(String(record?.sku || "").normalize("NFKC").trim().toLocaleUpperCase("en-US"))) return false;
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

  function storeDisplayException(storeCode, sku, exceptions) {
    const match = (Array.isArray(exceptions) ? exceptions : []).find((item) => item?.enabled !== false
      && String(item?.storeCode || item?.store_code || "") === storeCode
      && String(item?.sku || "").normalize("NFKC").trim().toLocaleUpperCase("en-US") === String(sku || "").normalize("NFKC").trim().toLocaleUpperCase("en-US"));
    if (!match) return null;
    const quantity = Math.max(0, Math.floor(Number(match.displayQuantity ?? match.display_quantity ?? 0)));
    return { name: "本店單品展示例外", role: "不可售展示", quantity, scope: storeCode, priority: 10000, note: `本店單品展示例外：不可售展示${quantity}件` };
  }

  function appliesToStore(rule, store, localSales42) {
    if (!rule) return false;
    const scope = String(rule.scope || "");
    if (/全部有銷售資料|近42天有該品號現場銷售/.test(scope)) return rule.role === "不可售展示" || Number(localSales42) > 0;
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
    return /贈品|運費|客製|代工|拍照樣|拍攝樣|樣品|展示品|展示專用|耗材|保費|折扣|折價|蝦幣|手續費|服務費|商品券/i.test(value) || /贈品|輔料|客製/.test(category);
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
    const reserve = Math.max(0, Math.min(stock, Math.ceil(daily * Math.max(1, Number(coverageDays || 1)) - 1e-9)));
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

  function supplyDecisionReason(rawNeed, suggested, protection, hqAvailable, isSellThroughStop) {
    const demand = Math.max(0, Math.floor(Number(rawNeed || 0)));
    const supplied = Math.max(0, Math.floor(Number(suggested || 0)));
    if (!(demand > 0)) return "本次總需求0件，系統未提出調撥建議";
    if (supplied >= demand) return `系統已足額建議：總需求${demand}件，供應${supplied}件`;
    const unfilled = Math.max(0, demand - supplied);
    const supplyState = supplied > 0 ? `總倉不足，部分供應${supplied}件／總需求${demand}件` : `總倉不足，未供應；總需求${demand}件`;
    const protectionReason = isSellThroughStop
      ? `S品${protection.reason}，總倉可釋出${protection.releasable}件`
      : protection.reserve > 0
        ? `總部安全庫存保留${protection.reserve}件，總倉可釋出${protection.releasable}件`
        : `總倉可用${Math.max(0, Math.floor(Number(hqAvailable || 0)))}件`;
    return `${supplyState}；未配${unfilled}件；${protectionReason}`;
  }

  function dateKey(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
    return date.toISOString().slice(0, 10);
  }

  function activityScope(segment) {
    const value = String(segment || "").normalize("NFKC").replace(/\s+/g, " ").trim().replace(/^[*＊•·-]+\s*/, "");
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
    const purchasedProduct = value.match(/(?:購買|任選)\s*([^，。；\n]{1,40}?)(?=(?:消費|滿|贈|送|$))/);
    if (purchasedProduct) {
      const target = purchasedProduct[1].trim();
      if (target) return { scopeType: "product", scopeLabel: `指定品項：${target}`, scopeTargets: [target], thresholdBasis: "scoped_subtotal", thresholdBasisLabel: "只計指定品項小計" };
    }
    return { scopeType: "unknown", scopeLabel: "適用範圍待確認", scopeTargets: [], thresholdBasis: "manual", thresholdBasisLabel: "人工確認" };
  }

  function marketingChannelSegments(value, fallbackSection) {
    const source = String(value || "");
    const lines = source.split("\n");
    const leadingHeaders = [];
    let bodyStart = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line && (leadingHeaders.length || index === 0)) { bodyStart = index + 1; continue; }
      const header = line.match(/^(門市|官網|平台|電商|蝦皮|MOMO)\s*[：:].*\d{1,2}\s*[\/.]\s*\d{1,2}/i);
      if (!header) break;
      leadingHeaders.push({ line, channel: header[1] });
      bodyStart = index + 1;
    }
    if (leadingHeaders.length) {
      const storeHeader = leadingHeaders.find((item) => item.channel === "門市");
      const sharedBody = lines.slice(bodyStart).join("\n").trim();
      if (storeHeader) return [{ text: [storeHeader.line, sharedBody].filter(Boolean).join("\n"), section: "store" }];
      return [{ text: [leadingHeaders[0].line, sharedBody].filter(Boolean).join("\n"), section: "online" }];
    }
    const marked = source.replace(/(^|[\n；;])\s*(門市|官網|平台|電商|蝦皮|MOMO)\s*[：:]/gi, (_match, separator, label) => `${separator}\u001e${label}：`);
    if (!marked.includes("\u001e")) return [{ text: marked, section: fallbackSection || "" }];
    return marked.split("\u001e").map((part) => part.trim()).filter(Boolean).map((text) => {
      const channel = text.match(/^(門市|官網|平台|電商|蝦皮|MOMO)\s*[：:]/i)?.[1] || "";
      return { text, section: channel === "門市" ? "store" : (channel ? "online" : (fallbackSection || "")) };
    });
  }

  function marketingDateSegments(value) {
    const text = String(value || "").trim();
    if (!text) return [];
    const starts = [0];
    for (const match of text.matchAll(/\n\s*(?=\d{1,2}\s*[\/.]\s*\d{1,2})/g)) starts.push((match.index || 0) + match[0].length);
    return starts.map((start, index) => text.slice(start, starts[index + 1]).trim()).filter(Boolean);
  }

  function marketingGiftMatches(segment) {
    const matches = [];
    const pattern = /贈品(?:貨號|品號)\s*[：:]\s*([A-Z0-9]+(?:-[A-Z0-9]+)*)/gi;
    for (const match of segment.matchAll(pattern)) matches.push({ sku: match[1].toUpperCase(), index: match.index || 0, end: (match.index || 0) + match[0].length });
    return matches;
  }

  function parseMarketingWorkbook(workbook, XLSX, asOfDate) {
    const reference = localDate(asOfDate);
    const year = reference.getFullYear();
    const referenceMs = Date.parse(`${asOfDate}T12:00:00Z`);
    const futureLimit = referenceMs + 21 * 86400000;
    const activities = [];
    const time = "(?:\\s+\\d{1,2}\\s*:\\s*\\d{2})?";
    const dateRange = new RegExp(`(\\d{1,2})\\s*[\\/.]\\s*(\\d{1,2})${time}\\s*(?:-|–|—|~|～|至)\\s*(?:(\\d{1,2})\\s*[\\/.]\\s*)?(\\d{1,2})${time}(?=\\s|$)`);
    const singleDate = /(\d{1,2})\s*[\/.]\s*(\d{1,2})(?=\s|[-–—:：]|$)/;
    for (const sheetName of workbook.SheetNames || []) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });
      let section = "";
      rows.forEach((row) => {
        const rowText = row.map((value) => String(value || "").normalize("NFKC").trim()).filter(Boolean).join("\n");
        if (/門市銷售波段/.test(rowText)) section = "store";
        else if (/(?:官網|平台|電商).*銷售波段/.test(rowText)) section = "online";
        for (const cell of row) {
          const text = String(cell || "").normalize("NFKC").replace(/\r\n?/g, "\n").trim();
          if (!text || !/(?:\d{1,2}\s*[\/.]\s*\d{1,2})/.test(text)) continue;
          const channelSegments = marketingChannelSegments(text, section);
          channelSegments.forEach((channelSegment) => marketingDateSegments(channelSegment.text).forEach((rawSegment) => {
            if (channelSegment.section === "online") return;
            const range = rawSegment.match(dateRange);
            const single = range ? null : rawSegment.match(singleDate);
            if (!range && !single) return;
            const segment = rawSegment.replace(/[ \t]+/g, " ").trim();
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
            const giftMatches = marketingGiftMatches(segment);
            const isGift = /贈|滿額禮|滿件禮|加價購/.test(segment) || giftMatches.length > 0;
            if (!isGift) return;
            if (!giftMatches.length) {
              activities.push({ sheetName, section: channelSegment.section || section, startDate: start, endDate: end, description: segment.slice(0, 420), giftSkus: [], thresholdType: "manual", thresholdValue: 0, giftQuantity: 1, cumulative: false, thresholdText: "門檻需人工確認", ...activityScope(segment) });
              return;
            }
            const groupNoCumulativeAt = segment.search(/以上不累贈/);
            giftMatches.forEach((giftMatch, index) => {
              const previousEnd = index > 0 ? giftMatches[index - 1].end : (range || single).index + (range || single)[0].length;
              const nextStart = giftMatches[index + 1]?.index ?? segment.length;
              const clause = segment.slice(previousEnd, giftMatch.end).replace(/^\s*[，。、；;]+/, "").trim();
              const afterClause = segment.slice(giftMatch.end, nextStart);
              const amountMatch = clause.match(/(?:消費|全單|整單)?\s*滿\s*(?:NT\$|\$)?\s*([\d,]+)\s*元?/i);
              const pieceMatch = amountMatch ? null : clause.match(/(?:滿|任選|購買)[^\d]{0,24}(\d+)\s*(?:件|組)/);
              const giftQuantityMatch = clause.match(/贈(?:送)?[^，。；\n]{0,24}?(\d+)\s*(?:件|個|組)/);
              const thresholdType = amountMatch ? "amount" : (pieceMatch ? "quantity" : "manual");
              const thresholdValue = Number(String(amountMatch?.[1] || pieceMatch?.[1] || "0").replace(/,/g, ""));
              const localCumulativeText = `${clause}\n${afterClause}`.replace(/以上不累贈/g, "");
              const directlyNonCumulative = /不累贈|每(?:筆|單)[^，。；\n]{0,16}(?:限|最多)[^，。；\n]{0,8}(?:1|一|乙)(?:件|個|組)/.test(localCumulativeText);
              const groupedNonCumulative = groupNoCumulativeAt >= 0 && giftMatch.index < groupNoCumulativeAt;
              const scope = activityScope(clause);
              activities.push({
                sheetName, section: channelSegment.section || section, startDate: start, endDate: end, description: clause.slice(0, 420), giftSkus: [giftMatch.sku],
                thresholdType, thresholdValue, giftQuantity: Math.max(1, Number(giftQuantityMatch?.[1] || 1)), cumulative: !(directlyNonCumulative || groupedNonCumulative),
                thresholdText: amountMatch ? `滿${thresholdValue.toLocaleString("zh-TW")}元` : (pieceMatch ? `滿${thresholdValue}件` : "門檻需人工確認"),
                ...scope
              });
            });
          }));
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
    const scheduleByStore = Object.fromEntries(stores.map((store) => [store, storeSchedule(proposalDate, store, input.storeInventory || {}, input.approvalDate || "")]));
    const masterBySku = input.master.bySku;
    const activity = input.activityPlan ? (() => {
      if (!globalThis.StoreTransferActivity) throw new Error("活動調撥模組未載入，請重新載入最新版。");
      if (input.calculationMode === "comparison") throw new Error("活動備貨僅適用正式補貨；A/B測試請先取消活動。");
      const ctx = globalThis.StoreTransferActivity.prepare(input.activityPlan, proposalDate, input.approvalDate, input.storeInventory || {});
      if (!globalThis.StoreTransferActivity.validDate(input.activityInventoryDate) || input.activityInventoryDate > proposalDate || input.activityInventoryDate < input.activityPlan.source.asOfDate) throw new Error("請填寫不早於活動基準且不晚於開單日的最新庫存快照日期。");
      return ctx;
    })() : null;
    if (activity?.active) for (const store of stores) Object.assign(scheduleByStore[store], {
      currentArrivalDate: activity.timing.arrivalDate,
      nextArrivalDate: globalThis.StoreTransferActivity.add(activity.timing.nextUsableDate, -2),
      activityPlanId: activity.planId, activityPlanRevision: activity.revision,
      activityUsableDate: activity.timing.usableDate, activityProtectionEnd: activity.timing.protectionEnd,
      activityBufferDays: 2, activityName: activity.name, activityApprovalDate: activity.timing.approvalDate
    });
    const transferExclusions = transferExclusionSkus(input.storeInventory);
    const applicabilityRules = normalizedApplicabilityRules(input.storeInventory);
    const isTransferExcluded = (sku, storeCode = "") => {
      const normalized = String(sku || "").normalize("NFKC").trim().toUpperCase();
      if (isCustomTransferSku(normalized) || isCombinationTransferSku(normalized)) return true;
      if (transferExclusions.has(normalized)) return true;
      if (!storeCode || !applicabilityRules.length) return false;
      return transferApplicabilityDecision({ transferExclusions: [], applicabilityRules }, masterBySku.get(normalized) || { sku: normalized, name: "" }, storeCode, proposalDate).excluded;
    };
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
        if (isTransferExcluded(sku, store) || master.sellThroughStop || excludedFromRegularTransfer(master) || !isSingleDuvet(master)) continue;
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
        if (isTransferExcluded(sku, store) || CONSUMABLES[sku] || excludedFromRegularTransfer(master)) continue;
        const key = `${store}|${sku}`, local42 = Math.max(0, local.get(key) || 0), b342 = Math.max(0, b3.get(key) || 0);
        const performance = local42 + b342, weeks = activeWeeks.get(key)?.size || 0;
        const tier = performance >= 12 && weeks >= 4 ? "熱銷" : performance >= 4 && weeks >= 2 ? "穩定" : "低銷";
        const daily = local42 / 42;
        const schedule = scheduleByStore[store];
        let target = daily * schedule.coverageDays;
        const activityApplies = activity?.active && activity.has(store, sku);
        let activityEvidence = "", activityPreUse = null;
        if (activityApplies) {
          const from = globalThis.StoreTransferActivity.add(input.activityInventoryDate, 1);
          // Each date appears exactly once: normal demand outside the event,
          // the shared daily forecast inside it. Cover until the next usable batch.
          const through = activity.timing.protectionEnd;
          const planned = activity.demand(store, sku, from, through, daily);
          target = Math.max(target, planned);
          activityPreUse = activity.demand(store, sku, from, globalThis.StoreTransferActivity.add(activity.timing.usableDate,-1), daily);
          activityEvidence = `${activity.name}；活動基準v${activity.revision}；預計${activity.timing.arrivalDate}到店＋固定2日緩衝至${activity.timing.usableDate}；保障至${through}；逐日含週末需求${planned.toFixed(1)}件`;
        }
        const rule = storeDisplayException(store, sku, input.storeDisplayExceptions) || stockRule(master, input.storeInventory);
        if (rule?.role === "排除規則") continue;
        const ruleApplies = appliesToStore(rule, store, local42);
        const appliesDisplay = ruleApplies && rule?.role === "不可售展示";
        const minimum = ruleApplies && rule?.role === "可售最低庫存" ? rule.quantity : 0;
        let display = appliesDisplay ? rule.quantity : 0;
        let displaySuppressedReason = "";
        if (master.sellThroughStop && display > 0) {
          const hqAvailableForDisplay = Math.max(0, Math.floor((inventory.get(`T00|${sku}`) || 0) - (pendingOutbound.get(`T00|${sku}`) || 0)));
          const displayProtection = sStockProtection(hqAvailableForDisplay, Math.max(0, hqUsage14.get(sku) || 0), Math.max(0, hqUsage42.get(sku) || 0), Math.max(0, hqUsage84.get(sku) || 0));
          if (displayProtection.releasable === 0) { display = 0; displaySuppressedReason = "S品總倉無可釋出量，本次停用展示需求"; }
        }
        const physicalInventory = Math.max(0, inventory.get(key) || 0);
        const pendingSubmittedQuantity = Math.max(0, submittedInbound.get(key) || 0);
        const inTransitQuantity = Math.max(0, inTransitInbound.get(key) || 0);
        let current = Math.max(0, physicalInventory + includedInbound(key)), activityTimeline = null;
        if (activityApplies) {
          let timely = 0; const inbound=[];
          for (const t of input.transfer.records.filter(t => t.destinationWarehouseCode === store && t.sku === sku && ["提交","發貨審核"].includes(t.status))) {
            const d = input.activityInboundDates?.[t.documentCode];
            if (!t.documentCode || !globalThis.StoreTransferActivity.validDate(d)) throw new Error(`${store}／${sku}既有調撥到店日待確認，請在活動卡片填寫各調撥單到店日。`);
            inbound.push({date:d,quantity:Number(t.quantity || 0)});
            // Only confirmed stock usable before this batch can support opening.
            if (globalThis.StoreTransferActivity.add(d, 2) <= activity.timing.usableDate) timely += Number(t.quantity || 0);
          }
          current = Math.max(0, physicalInventory + timely);
          activityTimeline = activity.timeline(store,sku,globalThis.StoreTransferActivity.add(input.activityInventoryDate,1),physicalInventory,display,inbound,daily);
        }
        const displayGap = Math.max(0, display - current);
        const sellable = Math.max(0, current - display);
        const sellableNeed = activityTimeline ? Math.max(activityTimeline.need - displayGap, Math.ceil(minimum-sellable), 0) : Math.max(0, Math.ceil(Math.max(target, minimum) - sellable - 1e-9));
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
          baseSellableQuantity: activityTimeline?.atArrival ?? Math.max(0, sellable - (activityPreUse ?? daily * schedule.preArrivalDays)), dailySales: daily, calculationDate: schedule.currentArrivalDate,
          currentArrivalDate: schedule.currentArrivalDate, nextArrivalDate: schedule.nextArrivalDate, coverageDays: schedule.coverageDays,
          preArrivalStockoutRisk: activityTimeline ? activityTimeline.openingRisk : sellable < (activityPreUse ?? daily * schedule.preArrivalDays),
          ...(activityApplies ? {activityPlanId:activity.planId,activityPlanRevision:activity.revision,activityEvidence,activityDemandIncrease:Math.max(0,target-daily*schedule.coverageDays),activityDemandSchedule:Array.from({length:Math.max(0,daysBetween(activity.timing.usableDate,activity.timing.protectionEnd)+1)},(_,i)=>{const d=globalThis.StoreTransferActivity.add(activity.timing.usableDate,i);return [d,activity.demand(store,sku,d,d,daily),i===0?0:activityTimeline.inbound.filter(t=>globalThis.StoreTransferActivity.add(t.date,2)===d).reduce((s,t)=>s+t.quantity,0)];})} : {}),
          systemSellThroughDate: projectedSellThroughDate(schedule.currentArrivalDate, Math.max(0, sellable - daily * schedule.preArrivalDays), Math.max(0, need - displayGap), daily),
          isSellThroughStop: Boolean(master.sellThroughStop),
          ruleSummary: [activityEvidence, itemType === "special_stock" ? `${singleDuvetType(master)}／${materialName(master)}前2名花色；建議維持1件，非必要調撥` : `${tier}；保護${schedule.coverageDays}天至${schedule.nextArrivalDate}`, displayGap ? `展示缺口${displayGap}件另補` : "", rule?.note, displaySuppressedReason, pendingSubmittedQuantity ? `${calculationMode === "comparison" ? "A/B測試排除待發貨" : "待發貨"}${pendingSubmittedQuantity}件` : "", inTransitQuantity ? `發貨在途${inTransitQuantity}件` : "", daily > 0 && sellable < daily * schedule.preArrivalDays ? `本批${schedule.currentArrivalDate}到店前有缺貨風險` : ""].filter(Boolean).join("；")
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
    const systemDecisionByKey = new Map();
    for (const [sku, allRows] of needsBySku) {
      const hqAvailable = Math.max(0, Math.floor((inventory.get(`T00|${sku}`) || 0) - (pendingOutbound.get(`T00|${sku}`) || 0)));
      const isS = allRows.some((row) => row.isSellThroughStop);
      const usage14 = Math.max(0, (isS ? hqUsage14 : hqDirect14).get(sku) || 0), usage42 = Math.max(0, (isS ? hqUsage42 : hqDirect42).get(sku) || 0), usage84 = Math.max(0, (isS ? hqUsage84 : hqDirect84).get(sku) || 0);
      const horizon = Math.max(...allRows.map((row) => row.coverageDays || 1));
      const protection = isS ? sStockProtection(hqAvailable, usage14, usage42, usage84) : generalHqStockProtection(hqAvailable, usage14, usage42, usage84, horizon);
      if (isS && protection.releasable === 0) {
        for (const row of allRows) systemDecisionByKey.set(`${row.storeCode}|${sku}`, supplyDecisionReason(row.rawNeed, 0, protection, hqAvailable, true));
        continue;
      }
      let remaining = protection.releasable;
      for (const type of ["regular", "special_stock"]) {
        let rows = allRows.filter((row) => row.itemType === type);
        if (isS && protection.level === "無周轉") rows = rows.filter((row) => row.localSales42 > 0);
        const allocated = allocateRows(rows, remaining);
        const used = Object.values(allocated).reduce((sum, value) => sum + value, 0);
        remaining = Math.max(0, remaining - used);
        for (const row of rows) {
          const suggested = allocated[row.storeCode] || 0;
          const systemDecisionReason = supplyDecisionReason(row.rawNeed, suggested, protection, hqAvailable, isS);
          systemDecisionByKey.set(`${row.storeCode}|${sku}`, systemDecisionReason);
          if (suggested > 0) {
            const output = { ...row, suggestedQuantity: suggested, hqAvailable, hqReserve: protection.reserve, hqReleasable: protection.releasable, hqSupplyCeiling: protection.releasable, systemSellThroughDate: projectedSellThroughDate(row.calculationDate, row.baseSellableQuantity, Math.max(0, suggested - row.displayGap), row.dailySales), systemDecisionReason, ruleSummary: `${row.ruleSummary}；${isS ? "S品" : "總部安全庫存"}${protection.reason}，可釋出${protection.releasable}件${suggested < row.rawNeed ? "；總倉不足依70/30分配" : ""}` };
            (type === "special_stock" ? specialStockRows : regularRows).push(output);
          }
          const unfilled = Math.max(0, row.rawNeed - suggested);
          if (type === "regular" && unfilled > 0) shortageRows.push({ storeCode: row.storeCode, sku, productName: row.productName, demandQuantity: row.rawNeed, allocatedQuantity: suggested, unfilledQuantity: unfilled, itemType: "regular", currentArrivalDate: row.currentArrivalDate, nextArrivalDate: row.nextArrivalDate, followUpStatus: "待回拋主採購", systemDecisionReason, reason: isS ? `S品僅可釋出${protection.releasable}件；${protection.reason}` : protection.reserve > 0 ? `總部安全庫存保留${protection.reserve}件；總倉可釋出${protection.releasable}件` : `總倉可用${hqAvailable}件，不足全部門市需求` });
        }
      }
    }
    for (const row of [...regularRows,...specialStockRows]) if(row.activityPlanId) {
      row.systemSellThroughDate = globalThis.StoreTransferActivity.projection(row.activityDemandSchedule,row.baseSellableQuantity,row.displayGap,row.suggestedQuantity);
      row.systemDecisionReason = `${row.activityEvidence}；${row.systemDecisionReason}`;
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
        const candidates = stores.filter((storeCode) => !isTransferExcluded(sku, storeCode)).map((storeCode) => {
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
            suggestedQuantity: suggested, hqAvailable, hqReserve: 0, hqReleasable: hqAvailable, hqSupplyCeiling: (regularBySku.get(sku) || 0) + hqAvailable, itemType: "activity_gift",
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
        if (isTransferExcluded(sku, storeCode)) continue;
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
        if (suggested > 0) consumableRows.push({ ...row, suggestedQuantity: suggested, hqAvailable, hqReserve: 0, hqReleasable: hqAvailable, hqSupplyCeiling: hqAvailable, systemSellThroughDate: `約${((row.currentInventory + suggested) / Math.max(row.averageWeeklyUsage, .01)).toFixed(1)}週`, ruleSummary: `${row.ruleSummary}${suggested < row.rawNeed ? `；總倉僅可配${suggested / 100}箱` : ""}` });
        const unfilled = Math.max(0, row.rawNeed - suggested);
        if (unfilled > 0) shortageRows.push({ storeCode: row.storeCode, sku, productName: row.productName, demandQuantity: row.rawNeed, allocatedQuantity: suggested, unfilledQuantity: unfilled, itemType: "consumable", reason: `提袋須以100個為單位；總倉可用${hqAvailable}個` });
      }
    }
    consumableRows.sort((a, b) => STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode) || a.sku.localeCompare(b.sku));
    shortageRows.sort((a, b) => STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode) || a.sku.localeCompare(b.sku));
    pendingTransferRows.sort((a, b) => STORE_ORDER.indexOf(a.storeCode) - STORE_ORDER.indexOf(b.storeCode) || a.sku.localeCompare(b.sku) || a.documentCode.localeCompare(b.documentCode));

    const actionableActivityRows = activityRows.filter((row) => Number(row.suggestedQuantity) > 0);
    const rows = [...regularRows, ...specialStockRows, ...actionableActivityRows, ...consumableRows];
    if(activity?.active) {
      const ordinary=buildSuggestions({...input,activityPlan:null});
      const baseline=new Map(ordinary.rows.map(r=>[`${r.storeCode}|${r.sku}|${r.itemType}`,r.suggestedQuantity]));
      for(const row of rows.filter(r=>r.activityPlanId)) {
        row.activityAdditionalQuantity=Math.max(0,row.suggestedQuantity-(baseline.get(`${row.storeCode}|${row.sku}|${row.itemType}`)||0));
        row.ruleSummary=`${row.ruleSummary}；相較一般週補貨增加${row.activityAdditionalQuantity}件（已含本次建議內）`;
      }
      for(const row of shortageRows) {
        const need=needsBySku.get(row.sku)?.find(r=>r.storeCode===row.storeCode && r.activityPlanId);
        if(need) row.reason=`${need.activityEvidence}；${row.reason}`;
      }
    }
    const submittedRows = pendingTransferRows.filter((row) => row.status === "提交");
    const inTransitRows = pendingTransferRows.filter((row) => row.status === "發貨審核");
    const comparisonKeys = new Set([
      ...rows.map((row) => `${row.storeCode}|${row.sku}`),
      ...submittedRows.filter((row) => !isTransferExcluded(row.sku, row.storeCode)).map((row) => `${row.storeCode}|${row.sku}`)
    ]);
    const comparisonFacts = [...comparisonKeys].map((compoundKey) => {
      const [storeCode, sku] = compoundKey.split("|");
      const systemRow = rows.find((row) => row.storeCode === storeCode && row.sku === sku);
      const master = masterBySku.get(sku) || {};
      const localSales42 = Math.max(0, local.get(compoundKey) || 0);
      const b3Sales42 = Math.max(0, b3.get(compoundKey) || 0);
      const schedule = scheduleByStore[storeCode];
      const rule = storeDisplayException(storeCode, sku, input.storeDisplayExceptions) || stockRule(master, input.storeInventory);
      const ruleApplies = rule && appliesToStore(rule, storeCode, localSales42);
      let displayQuantity = ruleApplies && rule.role === "不可售展示" ? Number(rule.quantity || 0) : 0;
      let displaySuppressedReason = "";
      if (master.sellThroughStop && displayQuantity > 0) {
        const hqAvailableForDisplay = Math.max(0, Math.floor((inventory.get(`T00|${sku}`) || 0) - (pendingOutbound.get(`T00|${sku}`) || 0)));
        const displayProtection = sStockProtection(hqAvailableForDisplay, Math.max(0, hqUsage14.get(sku) || 0), Math.max(0, hqUsage42.get(sku) || 0), Math.max(0, hqUsage84.get(sku) || 0));
        if (displayProtection.releasable === 0) { displayQuantity = 0; displaySuppressedReason = "S品總倉無可釋出量，本次停用展示需求"; }
      }
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
        ruleSummary: systemRow?.ruleSummary || [rule?.name, rule?.role, ruleApplies ? `適用${rule.quantity || 0}件` : "", displaySuppressedReason].filter(Boolean).join("；")
      };
    });
    const manualItemKeys = new Set([
      ...[...inventory.entries()].filter(([key, quantity]) => stores.includes(key.split("|")[0]) && Number(quantity) > 0).map(([key]) => key),
      ...[...local.keys()], ...[...b3.keys()], ...[...submittedInbound.keys()], ...[...inTransitInbound.keys()],
      ...rows.map((row) => `${row.storeCode}|${row.sku}`), ...shortageRows.map((row) => `${row.storeCode}|${row.sku}`)
    ]);
    const manualItemFacts = [...manualItemKeys].filter((compoundKey) => {
      const [storeCode, sku] = compoundKey.split("|");
      return stores.includes(storeCode) && masterBySku.has(sku);
    }).map((compoundKey) => {
      const [storeCode, sku] = compoundKey.split("|");
      const master = masterBySku.get(sku) || {};
      const schedule = scheduleByStore[storeCode];
      const localSales42 = Math.max(0, local.get(compoundKey) || 0);
      const rule = storeDisplayException(storeCode, sku, input.storeDisplayExceptions) || stockRule(master, input.storeInventory);
      const ruleApplies = rule && appliesToStore(rule, storeCode, localSales42);
      let displayQuantity = ruleApplies && rule.role === "不可售展示" ? Number(rule.quantity || 0) : 0;
      if (master.sellThroughStop && displayQuantity > 0) {
        const hqAvailableForDisplay = Math.max(0, Math.floor((inventory.get(`T00|${sku}`) || 0) - (pendingOutbound.get(`T00|${sku}`) || 0)));
        const protection = sStockProtection(hqAvailableForDisplay, Math.max(0, hqUsage14.get(sku) || 0), Math.max(0, hqUsage42.get(sku) || 0), Math.max(0, hqUsage84.get(sku) || 0));
        if (protection.releasable === 0) displayQuantity = 0;
      }
      const physicalInventory = Math.max(0, inventory.get(compoundKey) || 0);
      const pending = Math.max(0, submittedInbound.get(compoundKey) || 0);
      const inTransit = Math.max(0, inTransitInbound.get(compoundKey) || 0);
      const current = Math.max(0, physicalInventory + includedInbound(compoundKey));
      const dailyUsage = localSales42 / 42;
      const displayGap = Math.max(0, displayQuantity - current);
      const baseQuantity = Math.max(0, current - displayQuantity - dailyUsage * (schedule?.preArrivalDays || 0));
      const minimum = ruleApplies && rule?.role === "可售最低庫存" ? Number(rule.quantity || 0) : 0;
      const target = dailyUsage * Number(schedule?.coverageDays || 1);
      const sellable = Math.max(0, current - displayQuantity);
      const rawNeed = displayGap + Math.max(0, Math.ceil(Math.max(target, minimum) - sellable - 1e-9));
      let systemReason = systemDecisionByKey.get(compoundKey) || "";
      if (!systemReason && rawNeed <= 0) {
        if (rule?.role === "可售最低庫存" && !ruleApplies && localSales42 <= 0) systemReason = "近42天現場銷售0件，可售最低庫存規則不適用；本次總需求0件";
        else if (pending + inTransit > 0) systemReason = `待發貨／在途${pending + inTransit}件已抵足需求；本次總需求0件`;
        else if (current > 0) systemReason = `門市現有庫存${current}件已滿足需求；本次總需求0件`;
        else systemReason = "依現行規則未形成補貨需求；本次總需求0件";
      }
      const hqAvailable = Math.max(0, Math.floor((inventory.get(`T00|${sku}`) || 0) - (pendingOutbound.get(`T00|${sku}`) || 0)));
      const hqProtection = master.sellThroughStop
        ? sStockProtection(hqAvailable, Math.max(0, hqUsage14.get(sku) || 0), Math.max(0, hqUsage42.get(sku) || 0), Math.max(0, hqUsage84.get(sku) || 0))
        : generalHqStockProtection(hqAvailable, Math.max(0, hqDirect14.get(sku) || 0), Math.max(0, hqDirect42.get(sku) || 0), Math.max(0, hqDirect84.get(sku) || 0), Number(schedule?.coverageDays || 1));
      const exclusionDecision = transferApplicabilityDecision(input.storeInventory || {}, { ...master, sku }, storeCode, proposalDate);
      const exclusionReason = transferExclusionReason(exclusionDecision);
      if (exclusionReason) systemReason = exclusionReason;
      const activityNeed = activity?.active ? needsBySku.get(sku)?.find(row=>row.storeCode===storeCode && row.activityPlanId) : null;
      if(activityNeed && !exclusionReason) systemReason=`${activityNeed.activityEvidence}；${systemReason || "依活動逐日需求計算"}`;
      return {
        storeCode, sku, productName: master.name || "", calculationDate: schedule?.currentArrivalDate || latest,
        baseQuantity:activityNeed?.baseSellableQuantity ?? baseQuantity, displayGap, dailyUsage,
        physicalInventory, pendingSubmittedQuantity: pending, inTransitQuantity: inTransit,
        currentQuantity: current, localSales42, b3Sales42: Math.max(0, b3.get(compoundKey) || 0),
        targetQuantity: activityNeed?.targetQuantity ?? Math.max(target, minimum), displayQuantity,
        currentArrivalDate: schedule?.currentArrivalDate || latest,
        nextArrivalDate: schedule?.nextArrivalDate || latest,
        preArrivalStockoutRisk: dailyUsage > 0 && Math.max(0, current - displayQuantity) < dailyUsage * (schedule?.preArrivalDays || 0),
        systemProjection: activityNeed ? `活動逐日估算至${activity.timing.protectionEnd}，請查看保障缺口` : projectedSellThroughDate(schedule?.currentArrivalDate || latest, baseQuantity, 0, dailyUsage),
        systemReason, hqAvailable, hqReserve: hqProtection.reserve, hqReleasable: hqProtection.releasable,
        autoExcluded: exclusionDecision.excluded, exclusionReason
      };
    }).sort((left, right) => STORE_ORDER.indexOf(left.storeCode) - STORE_ORDER.indexOf(right.storeCode) || left.sku.localeCompare(right.sku));
    const maximumCoverageDays = Math.max(1, ...Object.values(scheduleByStore).map((schedule) => Number(schedule.coverageDays || 1)));
    const manualItemCatalog = [...masterBySku.entries()].map(([sku, record]) => {
      const hqAvailable = Math.max(0, Math.floor((inventory.get(`T00|${sku}`) || 0) - (pendingOutbound.get(`T00|${sku}`) || 0)));
      const protection = record.sellThroughStop
        ? sStockProtection(hqAvailable, Math.max(0, hqUsage14.get(sku) || 0), Math.max(0, hqUsage42.get(sku) || 0), Math.max(0, hqUsage84.get(sku) || 0))
        : generalHqStockProtection(hqAvailable, Math.max(0, hqDirect14.get(sku) || 0), Math.max(0, hqDirect42.get(sku) || 0), Math.max(0, hqDirect84.get(sku) || 0), maximumCoverageDays);
      const autoExclusions = Object.fromEntries(stores.map((storeCode) => {
        const decision = transferApplicabilityDecision(input.storeInventory || {}, { ...record, sku }, storeCode, proposalDate);
        return [storeCode, decision.excluded ? transferExclusionReason(decision) : ""];
      }).filter(([, reason]) => reason));
      return { sku, productName: record.name || "", hqAvailable, hqReserve: protection.reserve, hqReleasable: protection.releasable, autoExclusions };
    }).filter((row) => row.productName).sort((left, right) => left.sku.localeCompare(right.sku));
    return {
      latestSalesDate: latest, proposalDate, scheduleByStore, calculationMode, rows, regularRows, specialStockRows, activityRows, consumableRows, shortageRows, consumableSnapshots, pendingTransferRows, comparisonFacts, manualItemFacts, manualItemCatalog,
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

  function finalApprovedQuantity(item) {
    return Number(item.hq_approved_quantity ?? item.store_confirmed_quantity ?? item.suggested_quantity ?? 0);
  }

  function buildErpWorkbook(items, XLSX, storeCode) {
    const grouped = new Map();
    const approvedItems = items.filter((item) => item.store_code === storeCode && finalApprovedQuantity(item) > 0);
    approvedItems.forEach((item) => {
      const current = grouped.get(item.sku) || { sku: item.sku, productName: item.product_name, quantity: 0, types: new Set() };
      current.quantity += finalApprovedQuantity(item);
      current.types.add(({ activity_gift: "活動／贈品", special_stock: "建議備貨", consumable: "門市耗材" })[item.item_type] || "一般補貨");
      grouped.set(item.sku, current);
    });
    const rows = [...grouped.values()].map((item) => ({ 貨號: item.sku, 品名: item.productName, 顏色: "", 尺碼: "", 數量: item.quantity, 價格: "", 備註: [...item.types].join("＋"), 倉庫: "" }));
    const sourceQuantity = approvedItems.reduce((sum, item) => sum + finalApprovedQuantity(item), 0);
    const outputQuantity = rows.reduce((sum, item) => sum + Number(item.數量 || 0), 0);
    if (rows.length !== grouped.size || outputQuantity !== sourceQuantity) {
      throw new Error(`ERP匯出核對失敗：核准${grouped.size}個品號／${sourceQuantity}件，產檔${rows.length}個品號／${outputQuantity}件。請勿使用此檔案並通知管理同事。`);
    }
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
    const titleStyle = { fill: { fgColor: { rgb: "15344A" } }, font: { name: "Arial", bold: true, color: { rgb: "FFFFFF" }, sz: 18 }, alignment: { vertical: "center" } };
    const infoStyle = { fill: { fgColor: { rgb: "EEF3F6" } }, font: { name: "Arial", color: { rgb: "36566C" }, sz: 10 }, alignment: { vertical: "center" } };
    const kpiStyle = { fill: { fgColor: { rgb: "B58B2A" } }, font: { name: "Arial", bold: true, color: { rgb: "FFFFFF" }, sz: 11 }, alignment: { horizontal: "center", vertical: "center" } };
    const kpiNoteStyle = { fill: { fgColor: { rgb: "FFF6D9" } }, font: { name: "Arial", color: { rgb: "6D5720" }, sz: 9 }, alignment: { horizontal: "center", vertical: "center" } };
    const sections = [["A、B都有","A、B都有品項","237A76"],["僅A","僅A有的品項","B07A1A"],["僅B","僅B有的品項","A64B5A"]];
    for (const [section, label, color] of sections) {
      const worksheet = {};
      const merges = [];
      const set = (address, value, style) => { worksheet[address] = { v: value, t: typeof value === "number" ? "n" : "s", ...(style ? { s: style } : {}) }; };
      const merge = (range) => merges.push(XLSX.utils.decode_range(range));
      const sectionRows = report.rows.filter((row) => row.section === section);
      merge("A1:O2"); set("A1", `${report.storeName}｜本週調撥建議差異分析｜${section}`, titleStyle);
      merge("A3:O3"); set("A3", `A＝本次A/B模式系統獨立建議（建議日 ${report.proposalDate}）　｜　B＝匯入調撥單中狀態為「提交」的人工調撥`, infoStyle);
      [["A","C",`A、B都有｜${report.summary.both} 項`,"共同品項，重點看數量差"],["D","F",`僅A｜${report.summary.onlyA} 項`,"系統有建議、人工未開"],["G","I",`僅B｜${report.summary.onlyB} 項`,"人工有開、系統未建議"],["J","L",`A建議總量｜${report.summary.totalA} 件`,"系統獨立建議量"],["M","O",`B手動總量｜${report.summary.totalB} 件`,"提交狀態人工調撥量"]].forEach(([left,right,kpiLabel,note]) => { merge(`${left}5:${right}5`); merge(`${left}6:${right}6`); set(`${left}5`, kpiLabel, kpiStyle); set(`${left}6`, note, kpiNoteStyle); });
      merge("A8:O8"); set("A8", `口徑：A/B模式完全排除「提交」調撥對門市需求與總倉可用量的影響；未完成調入量僅包含「發貨審核」在途量。近42天門市銷售截止 ${report.latestSalesDate}；B為匯入檔內提交狀態人工調撥量。三個比較區塊分頁顯示，本頁為「${section}」。`, { fill: { fgColor: { rgb: "F7F1E5" } }, font: { name: "Arial", color: { rgb: "5C5140" }, sz: 9 }, alignment: { wrapText: true, vertical: "center" } });
      merge("A10:O10"); set("A10", `${label}｜${sectionRows.length} 項`, { fill: { fgColor: { rgb: color } }, font: { name: "Arial", bold: true, color: { rgb: "FFFFFF" }, sz: 12 }, alignment: { vertical: "center" } });
      COMPARISON_COLUMNS.forEach((column, index) => set(XLSX.utils.encode_cell({ r: 10, c: index }), column, { fill: { fgColor: { rgb: "E7EFF3" } }, font: { name: "Arial", bold: true, color: { rgb: "15344A" }, sz: 10 }, alignment: { wrapText: true, horizontal: "center", vertical: "center" } }));
      let nextRow = 12;
      if (!sectionRows.length) {
        merge("A12:O12");
        set("A12", "本頁無品項", { font: { name: "Arial", italic: true, color: { rgb: "6B7F8E" } } });
        nextRow = 13;
      }
      for (const row of sectionRows) {
        const values = [row.section,row.sku,row.productName,row.physicalInventory,row.hqInventory,row.displayQuantity,row.pendingQuantity,row.localSales42,row.aQuantity,row.bQuantity,row.difference,row.aProjection,row.bProjection,row.itemType,row.analysis];
        values.forEach((value, index) => set(XLSX.utils.encode_cell({ r: nextRow - 1, c: index }), value, { font: { name: "Arial", sz: 10, color: { rgb: "243746" } }, alignment: { wrapText: true, vertical: "top", horizontal: index >= 3 && index <= 12 ? "center" : "left" }, fill: index >= 3 && index <= 7 ? { fgColor: { rgb: "EAF4F7" } } : index >= 11 && index <= 12 ? { fgColor: { rgb: "FFF5D9" } } : index === 14 ? { fgColor: { rgb: "F2F7F9" } } : undefined }));
        worksheet[`K${nextRow}`] = { f: `J${nextRow}-I${nextRow}`, t: "n", v: row.difference, s: worksheet[`K${nextRow}`].s };
        nextRow += 1;
      }
      worksheet["!ref"] = `A1:O${Math.max(12, nextRow - 1)}`;
      worksheet["!merges"] = merges;
      worksheet["!cols"] = [14,15,38,13,13,13,13,13,13,13,13,20,20,16,50].map((wch) => ({ wch }));
      worksheet["!rows"] = Array.from({ length: Math.max(12, nextRow) }, (_value, index) => ({ hpt: index < 2 ? 27 : index === 7 ? 58 : 25 }));
      worksheet["!freeze"] = { xSplit: 0, ySplit: 11, topLeftCell: "A12", activePane: "bottomLeft", state: "frozen" };
      XLSX.utils.book_append_sheet(workbook, worksheet, section);
    }
    return workbook;
  }

  function buildFormalWorkbook(calculation, XLSX, storeCode, storeName) {
    if (calculation?.calculationMode !== "formal") throw new Error("只有正式補貨結果可以下載正式報表。");
    const workbook = XLSX.utils.book_new();
    const titleStyle = { fill: { fgColor: { rgb: "15344A" } }, font: { name: "Arial", bold: true, color: { rgb: "FFFFFF" }, sz: 17 }, alignment: { vertical: "center" } };
    const infoStyle = { fill: { fgColor: { rgb: "EEF3F6" } }, font: { name: "Arial", color: { rgb: "36566C" }, sz: 10 }, alignment: { wrapText: true, vertical: "center" } };
    const headerStyle = { fill: { fgColor: { rgb: "DDEBF1" } }, font: { name: "Arial", bold: true, color: { rgb: "15344A" }, sz: 10 }, alignment: { wrapText: true, horizontal: "center", vertical: "center" } };
    const rowStyle = { fill: { fgColor: { rgb: "FFFFFF" } }, font: { name: "Arial", color: { rgb: "243746" }, sz: 10 }, alignment: { wrapText: true, vertical: "top" } };
    const addSheet = (sheetName, description, headers, rows, widths) => {
      const worksheet = XLSX.utils.aoa_to_sheet([
        [`${storeName || storeCode}｜正式補貨報表｜${sheetName}`],
        [],
        [`建議日 ${calculation.proposalDate}　｜　銷售截止 ${calculation.latestSalesDate}　｜　${description}`],
        [],
        headers,
        ...(rows.length ? rows : [["本頁無資料"]])
      ]);
      worksheet["!merges"] = [XLSX.utils.decode_range(`A1:${XLSX.utils.encode_col(headers.length - 1)}1`), XLSX.utils.decode_range(`A3:${XLSX.utils.encode_col(headers.length - 1)}3`)];
      worksheet["!cols"] = widths.map((wch) => ({ wch }));
      worksheet["!rows"] = [{ hpt: 30 }, { hpt: 8 }, { hpt: 38 }, { hpt: 8 }, { hpt: 34 }];
      worksheet["!freeze"] = { xSplit: 0, ySplit: 5, topLeftCell: "A6", activePane: "bottomLeft", state: "frozen" };
      worksheet.A1.s = titleStyle;
      worksheet.A3.s = infoStyle;
      headers.forEach((_header, index) => { worksheet[XLSX.utils.encode_cell({ r: 4, c: index })].s = headerStyle; });
      for (let rowIndex = 5; rowIndex < 5 + Math.max(1, rows.length); rowIndex += 1) {
        for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
          if (cell) cell.s = rowStyle;
        }
      }
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    };
    const suggestionRows = (calculation.rows || []).filter((row) => row.storeCode === storeCode).map((row) => [
      comparisonTypeLabel(row.itemType), row.sku, row.productName, row.physicalInventory, row.pendingSubmittedQuantity,
      row.inTransitQuantity, row.localSales42, row.targetQuantity, row.displayQuantity, row.suggestedQuantity,
      row.currentArrivalDate, row.nextArrivalDate, row.systemSellThroughDate, row.ruleSummary
    ]);
    const shortageRows = (calculation.shortageRows || []).filter((row) => row.storeCode === storeCode).map((row) => [
      comparisonTypeLabel(row.itemType), row.sku, row.productName, row.demandQuantity, row.allocatedQuantity,
      row.unfilledQuantity, row.currentArrivalDate, row.nextArrivalDate, row.reason, row.followUpStatus || "待回拋主採購"
    ]);
    const pendingRows = (calculation.pendingTransferRows || []).filter((row) => row.storeCode === storeCode).map((row) => [
      row.sku, row.productName, row.documentCode, row.status, row.quantity, row.openedDate || "", row.shippedDate || "",
      row.includedInCalculation ? "已納入抵扣" : "未納入抵扣"
    ]);
    addSheet("本次調撥建議", "提交待發貨與發貨審核在途只抵扣需求，不併入本次新增調撥量。", ["品項分類", "ERP品號", "品名", "現有實體庫存", "待發貨量", "在途量", "近42天現場銷售", "目標庫存", "展示最低量", "本次系統建議調撥量", "本批預計到店", "下一輪預計到店", "建議後可售至", "判斷分析"], suggestionRows, [16, 15, 38, 13, 12, 12, 15, 12, 13, 18, 16, 16, 20, 55]);
    addSheet("缺貨未配", "總倉暫時無法配足的必要需求，不會混入門市確認量或ERP調撥檔。", ["品項分類", "ERP品號", "品名", "需求量", "已配量", "未配量", "本批預計到店", "下一輪預計到店", "未配原因", "後續狀態"], shortageRows, [16, 15, 38, 12, 12, 12, 16, 16, 48, 18]);
    addSheet("待發貨與在途", "提交列為待發貨、發貨審核列為在途；兩者已抵扣正式補貨需求。", ["ERP品號", "品名", "調撥單號", "狀態", "數量", "開單日", "發貨日", "本次計算"], pendingRows, [15, 38, 20, 14, 10, 14, 14, 18]);
    return workbook;
  }

  return { STORE_ORDER, STORE_COMPANY, CONSUMABLES, isCustomTransferSku, isCombinationTransferSku, previousWorkingDay, nextWorkingDay, storeSchedule, allocateQuantity, combinedAllocationWeights, stockRule, storeDisplayException, projectedSellThroughDate, sStockProtection, generalHqStockProtection, parseMarketingWorkbook, buildSuggestions, buildErpWorkbook, buildComparisonReport, buildComparisonWorkbook, buildFormalWorkbook };
});

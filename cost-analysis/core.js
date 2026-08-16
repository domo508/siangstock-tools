(function (global) {
  "use strict";

  const REPORT_ORDER = [
    "opening",
    "closing",
    "purchases",
    "sales",
    "storeMonthly",
    "movements",
    "supplierReturns",
    "transfers"
  ];

  const REPORT_SCHEMAS = {
    opening: {
      label: "期初庫存",
      fields: {
        warehouse: ["店倉名稱", "倉別", "倉庫", "庫別", "倉別名稱", "倉庫名稱"],
        sku: ["商品編號", "商品代號", "品號", "貨號", "sku", "商編", "商品編碼"],
        name: ["品名", "商品名稱", "商品品名"],
        qty: ["庫存數量", "實際庫存", "數量", "期初數量"],
        purchasePrice: ["進貨價", "最近進貨價", "實際進貨價", "單位進貨價"],
        purchaseCostAmount: ["進貨價成本總額", "進貨成本額", "實際庫存進貨額", "期初進貨成本額"],
        averageCost: ["成本價", "平均成本", "單位成本"],
        averageCostAmount: ["庫存成本額", "實際庫存成本額", "平均成本總額"]
      },
      required: ["warehouse", "qty"],
      requiredAny: [["sku", "name"], ["purchasePrice", "purchaseCostAmount"]]
    },
    closing: {
      label: "期末庫存",
      fields: {
        warehouse: ["店倉名稱", "倉別", "倉庫", "庫別", "倉別名稱", "倉庫名稱"],
        sku: ["商品編號", "商品代號", "品號", "貨號", "sku", "商編", "商品編碼"],
        name: ["品名", "商品名稱", "商品品名"],
        qty: ["庫存數量", "實際庫存", "數量", "期末數量"],
        purchasePrice: ["進貨價", "最近進貨價", "實際進貨價", "單位進貨價"],
        purchaseCostAmount: ["進貨價成本總額", "進貨成本額", "實際庫存進貨額", "期末進貨成本額"],
        averageCost: ["成本價", "平均成本", "單位成本"],
        averageCostAmount: ["庫存成本額", "實際庫存成本額", "平均成本總額"]
      },
      required: ["warehouse", "qty"],
      requiredAny: [["sku", "name"], ["purchasePrice", "purchaseCostAmount"]]
    },
    purchases: {
      label: "當月進貨明細",
      fields: {
        date: ["開單日期", "進貨日期", "驗收日期", "入庫日期", "日期", "單據日期"],
        doc: ["收貨單編碼", "進貨單號", "驗收單號", "入庫單號", "單據編號", "單號"],
        supplier: ["供應商", "廠商", "供應商名稱"],
        warehouse: ["收貨倉庫", "入庫倉", "倉別", "倉庫", "庫別"],
        sku: ["商品編號", "商品代號", "品號", "貨號", "sku", "商編"],
        name: ["品名", "商品名稱", "商品品名"],
        qty: ["已收數量", "進貨數量", "驗收數量", "入庫數量", "數量"],
        purchasePrice: ["成本價", "供應商成本價", "進貨價", "未稅單價"],
        untaxedAmount: ["未稅進貨額", "未稅金額", "進貨未稅額", "未稅總額"],
        status: ["狀態", "單據狀態", "審核狀態"]
      },
      required: ["qty"],
      requiredAny: [["sku", "name"], ["purchasePrice", "untaxedAmount"]]
    },
    sales: {
      label: "銷售品項成本明細",
      fields: {
        date: ["結帳時間", "銷貨日期", "訂單日期", "交易日期", "日期", "單據日期"],
        doc: ["POS單", "銷貨單號", "來源單號", "訂單編號", "訂單號", "單據編號", "單號"],
        store: ["開單倉名稱", "銷售門市", "門市", "通路", "店別", "倉別"],
        sku: ["商品編號", "商品代號", "品號", "貨號", "sku", "商編"],
        name: ["品名", "商品名稱", "商品品名"],
        qty: ["扣庫量", "銷售數量", "銷貨數量", "庫存數量", "數量"],
        purchaseCostAmount: ["進貨價金額", "進貨價成本額", "商品進貨成本", "銷貨進貨成本額", "商品成本額"],
        purchasePrice: ["進貨價", "最近進貨價", "實際進貨價", "進貨成本單價"],
        averageCost: ["成本價", "平均成本", "單位成本"],
        salesAmount: ["銷售金額", "銷貨金額", "未稅銷售額", "含稅金額"],
        status: ["狀態", "訂單狀態", "單據狀態"]
      },
      required: ["qty"],
      requiredAny: [["sku", "name"], ["purchasePrice", "purchaseCostAmount"]]
    },
    storeMonthly: {
      label: "門市月結報表",
      fields: {
        date: ["對帳日期", "交易日期", "日期", "單據日期"],
        doc: ["對帳單號", "訂單編號", "調撥單號", "單據編號", "單號"],
        store: ["對帳門市名稱", "對帳門市", "門市名稱"],
        otherStore: ["其它門市", "其他門市", "對方門市", "調撥門市"],
        reconcileType: ["對帳總類", "對帳種類", "對帳類別"],
        sku: ["商品編號", "商品代號", "品號", "貨號", "sku", "商編"],
        name: ["品名", "商品名稱", "商品品名"],
        qty: ["對帳數量", "調撥數量", "庫存數量", "數量"],
        claimAmount: ["結帳額", "請款金額", "對帳金額", "金額", "未稅金額"],
        status: ["狀態", "單據狀態", "對帳狀態"]
      },
      required: ["store", "reconcileType", "qty"],
      requiredAny: [["sku", "name"]]
    },
    movements: {
      label: "出入庫明細列表",
      fields: {
        date: ["出入庫日期", "異動日期", "日期", "單據日期"],
        doc: ["出入庫單編碼", "出入庫單號", "入庫單號", "出庫單號", "單據編號", "單號"],
        direction: ["出入庫類型", "單據類型", "異動類型", "出入庫", "類型"],
        warehouse: ["出入庫店倉", "倉別", "倉庫", "庫別", "異動倉庫"],
        sourceWarehouse: ["調出倉", "來源倉", "出庫倉"],
        destinationWarehouse: ["調入倉", "目的倉", "入庫倉"],
        reason: ["出入庫原因", "異動原因", "原因", "備註"],
        relatedDoc: ["關聯單號", "原單號", "訂單編號", "來源單號"],
        sku: ["商品編號", "商品代號", "品號", "貨號", "sku", "商編"],
        name: ["品名", "商品名稱", "商品品名"],
        qty: ["出入庫數量", "異動數量", "庫存數量", "數量"],
        purchasePrice: ["進貨價", "最近進貨價", "實際進貨價", "進貨成本單價"],
        purchaseCostAmount: ["進貨價成本額", "進貨成本額"],
        averageCost: ["成本價", "平均成本", "單位成本"],
        status: ["狀態", "單據狀態", "審核狀態"]
      },
      required: ["reason", "qty"],
      requiredAny: [["sku", "name"], ["direction", "doc"]]
    },
    supplierReturns: {
      label: "退廠／供應商退貨明細",
      fields: {
        date: ["退貨日期", "退廠日期", "日期", "單據日期"],
        doc: ["退貨單編碼", "退貨單號", "退廠單號", "單據編號", "單號"],
        supplier: ["供應商", "廠商", "供應商名稱"],
        warehouse: ["來源倉", "退貨倉", "倉別", "倉庫"],
        sku: ["商品編號", "商品代號", "品號", "貨號", "sku", "商編"],
        name: ["品名", "商品名稱", "商品品名"],
        qty: ["退貨數量", "退廠數量", "數量"],
        purchasePrice: ["成本價", "供應商成本價", "進貨價", "未稅單價"],
        untaxedAmount: ["未稅進貨額", "未稅退貨額", "未稅金額", "退貨未稅額"],
        status: ["狀態", "單據狀態", "審核狀態"]
      },
      required: ["qty"],
      requiredAny: [["sku", "name"], ["purchasePrice", "untaxedAmount"]]
    },
    transfers: {
      label: "調撥單明細",
      fields: {
        date: ["開單日期", "調撥日期", "日期", "單據日期"],
        doc: ["單據編碼", "調撥單號", "單據編號", "單號"],
        sourceWarehouse: ["調出倉庫名", "調出倉", "調出倉別", "來源倉", "出庫倉"],
        destinationWarehouse: ["調入倉庫名", "調入倉", "調入倉別", "目的倉", "入庫倉"],
        sku: ["商品編號", "商品代號", "品號", "貨號", "sku", "商編"],
        name: ["品名", "商品名稱", "商品品名"],
        qty: ["調撥數量", "數量"],
        purchasePrice: ["調出方進貨價", "進貨價", "最近進貨價", "實際進貨價"],
        purchaseCostAmount: ["進貨價成本額", "調撥進貨成本額", "實際成本額"],
        sourceCostPrice: ["調出方成本價", "調出成本價"],
        destinationCostPrice: ["調入方成本價", "調入成本價"],
        transferAmount: ["調出方成本額", "調撥金額", "結算額"],
        status: ["狀態", "單據狀態", "審核狀態"]
      },
      required: ["sourceWarehouse", "destinationWarehouse", "qty"],
      requiredAny: [["sku", "name"]]
    }
  };

  const INCLUDED_WAREHOUSES = [
    "寬承總倉",
    "台中北屯門市",
    "台北中山門市",
    "退貨倉",
    "瑕疵倉",
    "報廢倉",
    "員購倉",
    "行銷活動商品拍攝倉",
    "行銷活動商品拍攝",
    "行銷公關品倉",
    "行銷公關品",
    "行銷寄賣倉",
    "行銷寄賣",
    "行銷市集特賣倉",
    "客服倉",
    "寄倉momo購物"
  ];

  const DIRECT_STORES = ["台中北屯門市", "台北中山門市"];
  const FRANCHISE_STORES = [
    "台中文心秀泰專櫃",
    "台中誠品480專櫃",
    "高雄夢時代專櫃",
    "新竹東區門市",
    "新莊門巾",
    "新莊門市",
    "快閃高雄漢神本館"
  ];

  const CANCELLED_WORDS = ["取消", "作廢", "刪除", "不成立", "未成立"];
  const DEFAULT_PRODUCT_RULES = {
    "排除關鍵字": ["運費"],
    "待人工確認關鍵字": [],
    "指定品名白名單": []
  };
  const SHEET_NAME_HINTS = {
    opening: ["期初庫存", "期初"],
    closing: ["期末庫存", "期末"],
    purchases: ["當月進貨明細", "進貨明細", "採購明細"],
    sales: ["銷售品項成本", "銷售成本", "銷貨成本"],
    storeMonthly: ["門市月結報表", "門市月結", "月結報表"],
    movements: ["出入庫明細", "出入庫"],
    supplierReturns: ["供應商退貨", "退廠", "進貨退貨"],
    transfers: ["調撥單明細", "調撥明細", "調撥單"]
  };
  const EPSILON = 0.000001;

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/[\s\-_–—／/＆&()（）【】\[\]：:．.]/g, "");
  }

  function normalizeHeader(value) {
    return normalizeText(value).replace(/\*/g, "");
  }

  function parseNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (value == null || value === "") return null;
    let text = String(value).trim();
    if (!text) return null;
    const negative = /^\(.*\)$/.test(text);
    text = text.replace(/[(),，$＄元%％\s]/g, "");
    if (!/^[-+]?\d*(?:\.\d+)?$/.test(text) || text === "" || text === ".") return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? (negative ? -Math.abs(parsed) : parsed) : null;
  }

  function isCancelled(value) {
    const text = normalizeText(value);
    return CANCELLED_WORDS.some((word) => text.includes(normalizeText(word)));
  }

  function isFreight(name) {
    const text = normalizeText(name);
    return text.includes("運費");
  }

  function normalizeRuleText(value) {
    return String(value == null ? "" : value).normalize("NFKC").toLocaleLowerCase("zh-Hant").trim().replace(/\s+/g, "");
  }

  function normalizeRuleExact(value) {
    return String(value == null ? "" : value).normalize("NFKC").toLocaleLowerCase("zh-Hant").trim();
  }

  function productRuleResult(name, rules) {
    const activeRules = rules && typeof rules === "object" ? rules : DEFAULT_PRODUCT_RULES;
    const exclusions = Array.isArray(activeRules["排除關鍵字"]) ? activeRules["排除關鍵字"] : [];
    const reviews = Array.isArray(activeRules["待人工確認關鍵字"]) ? activeRules["待人工確認關鍵字"] : [];
    const whitelist = Array.isArray(activeRules["指定品名白名單"]) ? activeRules["指定品名白名單"] : [];
    const normalizedName = normalizeRuleText(name);
    const exactName = normalizeRuleExact(name);
    if (exactName && whitelist.some((value) => normalizeRuleExact(value) === exactName)) {
      return { category: "normal", keywords: [], reason: `完整品名命中白名單：${String(name).trim()}` };
    }
    const exclusionMatches = exclusions.filter((keyword) => normalizedName.includes(normalizeRuleText(keyword)));
    if (exclusionMatches.length) {
      return { category: "excluded", keywords: exclusionMatches, reason: `命中排除關鍵字：${exclusionMatches[0]}` };
    }
    const reviewMatches = reviews.filter((keyword) => normalizedName.includes(normalizeRuleText(keyword)));
    if (reviewMatches.length) {
      return { category: "review", keywords: reviewMatches, reason: `命中待確認關鍵字：${reviewMatches[0]}` };
    }
    return { category: "normal", keywords: [], reason: "未命中排除或待確認關鍵字" };
  }

  function displayNumber(value, maximumFractionDigits = 4) {
    return new Intl.NumberFormat("zh-TW", { maximumFractionDigits }).format(Number(value || 0));
  }

  function classifyWarehouse(value) {
    const text = normalizeText(value);
    if (!text) return "unknown";
    if (FRANCHISE_STORES.some((name) => text.includes(normalizeText(name)))) return "franchise";
    if (DIRECT_STORES.some((name) => text.includes(normalizeText(name)))) return "direct";
    if (INCLUDED_WAREHOUSES.some((name) => text.includes(normalizeText(name)))) return "included";
    return "unknown";
  }

  function fieldLabel(field) {
    const labels = {
      warehouse: "倉別",
      sku: "商品編號",
      name: "品名",
      qty: "數量",
      purchasePrice: "進貨價",
      purchaseCostAmount: "進貨價成本總額",
      averageCost: "平均成本",
      averageCostAmount: "平均成本總額",
      date: "日期",
      doc: "單據編號",
      supplier: "供應商",
      untaxedAmount: "未稅進貨額",
      status: "狀態",
      store: "對帳／銷售門市",
      otherStore: "其它門市",
      reconcileType: "對帳總類",
      claimAmount: "請款金額",
      direction: "出入庫類型",
      sourceWarehouse: "調出／來源倉",
      destinationWarehouse: "調入／目的倉",
      reason: "出入庫原因",
      relatedDoc: "關聯單號",
      salesAmount: "銷售金額",
      sourceCostPrice: "調出方成本價",
      destinationCostPrice: "調入方成本價",
      transferAmount: "調撥金額"
    };
    return labels[field] || field;
  }

  function scoreHeader(header, aliases) {
    const normalized = normalizeHeader(header);
    if (!normalized) return 0;
    let best = 0;
    for (const alias of aliases) {
      const target = normalizeHeader(alias);
      if (normalized === target) best = Math.max(best, 100);
      else if (normalized.includes(target)) best = Math.max(best, 70);
      else if (normalized.length >= 3 && target.includes(normalized)) best = Math.max(best, 60);
    }
    return best;
  }

  function autoMapHeaders(headers, reportType) {
    const schema = REPORT_SCHEMAS[reportType];
    const used = new Set();
    const mapping = {};
    for (const [field, aliases] of Object.entries(schema.fields)) {
      let bestIndex = -1;
      let bestScore = 0;
      headers.forEach((header, index) => {
        if (used.has(index)) return;
        const normalized = normalizeHeader(header);
        if (field === "purchasePrice" && (normalized.includes("金額") || normalized.endsWith("額"))) return;
        if (field === "purchaseCostAmount" && !normalized.includes("進貨")) return;
        if (field === "date" && normalized.includes("上市")) return;
        if (field === "direction" && (normalized.includes("店倉") || normalized.endsWith("倉") || normalized.includes("原因") || normalized.includes("備註") || normalized.includes("日期") || normalized.includes("時間"))) return;
        const score = scoreHeader(header, aliases);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });
      if (bestIndex >= 0 && bestScore >= 60) {
        mapping[field] = bestIndex;
        used.add(bestIndex);
      } else {
        mapping[field] = null;
      }
    }
    return mapping;
  }

  function validateMapping(reportType, mapping) {
    const schema = REPORT_SCHEMAS[reportType];
    const missing = [];
    for (const field of schema.required || []) {
      if (mapping[field] == null) missing.push(fieldLabel(field));
    }
    for (const group of schema.requiredAny || []) {
      if (!group.some((field) => mapping[field] != null)) {
        missing.push(group.map(fieldLabel).join("／"));
      }
    }
    return { valid: missing.length === 0, missing };
  }

  function headerScore(row, reportType) {
    if (!Array.isArray(row)) return 0;
    const schema = REPORT_SCHEMAS[reportType];
    let score = 0;
    for (const aliases of Object.values(schema.fields)) {
      if (row.some((cell) => scoreHeader(cell, aliases) >= 60)) score += 1;
    }
    return score;
  }

  function inspectSheet(sheet, XLSX, reportType) {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    let headerRowIndex = 0;
    let bestScore = -1;
    rows.slice(0, 30).forEach((row, index) => {
      const score = headerScore(row, reportType);
      if (score > bestScore) {
        bestScore = score;
        headerRowIndex = index;
      }
    });
    const headers = (rows[headerRowIndex] || []).map((value, index) => String(value || `欄位${index + 1}`).trim());
    const mapping = autoMapHeaders(headers, reportType);
    return { headerRowIndex, headers, mapping, validation: validateMapping(reportType, mapping), rows };
  }

  function inspectWorkbook(workbook, XLSX, reportType) {
    const sheets = workbook.SheetNames.map((name) => {
      const inspected = inspectSheet(workbook.Sheets[name], XLSX, reportType);
      return { name, ...inspected };
    });
    sheets.sort((a, b) => {
      if (a.validation.valid !== b.validation.valid) return a.validation.valid ? -1 : 1;
      const nameScore = (sheetName) => (SHEET_NAME_HINTS[reportType] || []).reduce((score, hint, index) => {
        const name = normalizeText(sheetName);
        const normalizedHint = normalizeText(hint);
        if (name === normalizedHint) return Math.max(score, 100 - index);
        if (name.includes(normalizedHint)) return Math.max(score, 80 - index);
        return score;
      }, 0);
      const sheetNameDifference = nameScore(b.name) - nameScore(a.name);
      if (sheetNameDifference !== 0) return sheetNameDifference;
      return headerScore(b.headers, reportType) - headerScore(a.headers, reportType);
    });
    return { reportType, sheets };
  }

  function valueAt(row, mapping, field) {
    const index = mapping[field];
    return index == null ? "" : row[index];
  }

  function amountFrom(row, mapping, amountField, priceField, qty) {
    const total = parseNumber(valueAt(row, mapping, amountField));
    if (total != null) return total;
    const price = parseNumber(valueAt(row, mapping, priceField));
    return price != null && qty != null ? price * qty : null;
  }

  function hasIdentity(record) {
    return Boolean(normalizeText(record.sku) || normalizeText(record.name));
  }

  function extractReport(workbook, XLSX, reportType, options) {
    const schema = REPORT_SCHEMAS[reportType];
    const sheetName = options && options.sheetName ? options.sheetName : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`找不到工作表：${sheetName}`);
    const inspected = inspectSheet(sheet, XLSX, reportType);
    const headerRowIndex = options && Number.isInteger(options.headerRowIndex) ? options.headerRowIndex : inspected.headerRowIndex;
    const headers = (inspected.rows[headerRowIndex] || []).map((value, index) => String(value || `欄位${index + 1}`).trim());
    const mapping = options && options.mapping ? options.mapping : autoMapHeaders(headers, reportType);
    const validation = validateMapping(reportType, mapping);
    if (!validation.valid) throw new Error(`${schema.label}缺少必要欄位：${validation.missing.join("、")}`);

    const records = [];
    let cancelledRows = 0;
    let blankRows = 0;
    const rows = inspected.rows.slice(headerRowIndex + 1);
    rows.forEach((row, rowIndex) => {
      if (!row.some((cell) => String(cell == null ? "" : cell).trim() !== "")) {
        blankRows += 1;
        return;
      }
      const status = valueAt(row, mapping, "status");
      if (isCancelled(status)) {
        cancelledRows += 1;
        return;
      }
      const qty = parseNumber(valueAt(row, mapping, "qty"));
      const record = {
        reportType,
        sourceRow: headerRowIndex + rowIndex + 2,
        date: valueAt(row, mapping, "date"),
        doc: String(valueAt(row, mapping, "doc") || "").trim(),
        supplier: String(valueAt(row, mapping, "supplier") || "").trim(),
        warehouse: String(valueAt(row, mapping, "warehouse") || "").trim(),
        sourceWarehouse: String(valueAt(row, mapping, "sourceWarehouse") || "").trim(),
        destinationWarehouse: String(valueAt(row, mapping, "destinationWarehouse") || "").trim(),
        store: String(valueAt(row, mapping, "store") || "").trim(),
        otherStore: String(valueAt(row, mapping, "otherStore") || "").trim(),
        reconcileType: String(valueAt(row, mapping, "reconcileType") || "").trim(),
        direction: String(valueAt(row, mapping, "direction") || "").trim(),
        reason: String(valueAt(row, mapping, "reason") || "").trim(),
        relatedDoc: String(valueAt(row, mapping, "relatedDoc") || "").trim(),
        sku: String(valueAt(row, mapping, "sku") || "").trim(),
        name: String(valueAt(row, mapping, "name") || "").trim(),
        qty,
        purchasePrice: parseNumber(valueAt(row, mapping, "purchasePrice")),
        averageCost: parseNumber(valueAt(row, mapping, "averageCost")),
        sourceCostPrice: parseNumber(valueAt(row, mapping, "sourceCostPrice")),
        destinationCostPrice: parseNumber(valueAt(row, mapping, "destinationCostPrice")),
        claimAmount: parseNumber(valueAt(row, mapping, "claimAmount")),
        salesAmount: parseNumber(valueAt(row, mapping, "salesAmount")),
        status: String(status || "").trim()
      };
      record.purchaseCostAmount = amountFrom(row, mapping, "purchaseCostAmount", "purchasePrice", qty);
      record.averageCostAmount = amountFrom(row, mapping, "averageCostAmount", "averageCost", qty);
      record.untaxedAmount = parseNumber(valueAt(row, mapping, "untaxedAmount"));
      record.transferAmount = parseNumber(valueAt(row, mapping, "transferAmount"));
      const looksLikeSummaryRow = !normalizeText(record.name)
        && !normalizeText(record.status)
        && !normalizeText(record.warehouse)
        && !normalizeText(record.sourceWarehouse)
        && !normalizeText(record.destinationWarehouse)
        && !normalizeText(record.store);
      if (looksLikeSummaryRow) return;
      if (!hasIdentity(record) || qty == null) return;
      const hasSalesCostWithoutStockMovement = reportType === "sales"
        && Math.abs(qty) < EPSILON
        && record.purchaseCostAmount != null
        && Math.abs(record.purchaseCostAmount) >= EPSILON;
      if (Math.abs(qty) < EPSILON && !hasSalesCostWithoutStockMovement) return;
      records.push(record);
    });

    return {
      reportType,
      records,
      meta: {
        reportType,
        label: schema.label,
        fileName: options && options.fileName ? options.fileName : "",
        sheetName,
        headerRow: headerRowIndex + 1,
        headers,
        mapping,
        rawRows: rows.length,
        acceptedRows: records.length,
        cancelledRows,
        blankRows
      }
    };
  }

  function mergeReportParts(reportType, parts) {
    const reports = (parts || []).filter((part) => part && Array.isArray(part.records));
    if (!reports.length) return null;
    const firstMeta = reports[0].meta || {};
    let records = reports.flatMap((part) => part.records);
    let duplicateRows = 0;

    if (reportType === "transfers" && reports.length > 1) {
      const retainedCounts = new Map();
      const merged = [];
      for (const part of reports) {
        const partCounts = new Map();
        for (const record of part.records) {
          const signature = JSON.stringify([
            normalizeText(record.doc),
            String(record.date || "").trim(),
            normalizeText(record.sourceWarehouse),
            normalizeText(record.destinationWarehouse),
            itemKey(record),
            Number(record.qty || 0),
            record.purchaseCostAmount,
            record.sourceCostPrice,
            record.destinationCostPrice,
            record.transferAmount
          ]);
          const occurrence = (partCounts.get(signature) || 0) + 1;
          partCounts.set(signature, occurrence);
          const retained = retainedCounts.get(signature) || 0;
          if (occurrence > retained) merged.push(record);
          else duplicateRows += 1;
        }
        for (const [signature, count] of partCounts) {
          retainedCounts.set(signature, Math.max(retainedCounts.get(signature) || 0, count));
        }
      }
      records = merged;
    }

    const fileNames = reports.map((part) => part.meta && part.meta.fileName).filter(Boolean);
    const sheetNames = [...new Set(reports.map((part) => part.meta && part.meta.sheetName).filter(Boolean))];
    return {
      reportType,
      records,
      meta: {
        ...firstMeta,
        reportType,
        label: firstMeta.label || REPORT_SCHEMAS[reportType].label,
        fileName: fileNames.join("、"),
        sheetName: sheetNames.join("、"),
        headerRow: reports.every((part) => part.meta && part.meta.headerRow === firstMeta.headerRow) ? firstMeta.headerRow : "多檔",
        rawRows: reports.reduce((total, part) => total + Number(part.meta && part.meta.rawRows || 0), 0),
        acceptedRows: records.length,
        cancelledRows: reports.reduce((total, part) => total + Number(part.meta && part.meta.cancelledRows || 0), 0),
        blankRows: reports.reduce((total, part) => total + Number(part.meta && part.meta.blankRows || 0), 0),
        note: reports.length > 1 ? `已合併${reports.length}個檔案；去除${duplicateRows}列重複調撥資料。` : ""
      }
    };
  }

  function itemKey(record) {
    const sku = normalizeText(record.sku);
    return sku ? `sku:${sku}` : `name:${normalizeText(record.name)}`;
  }

  function itemLabel(record) {
    return record.name || record.sku || "未命名商品";
  }

  function getOrCreateItem(items, record) {
    const key = itemKey(record);
    if (!items.has(key)) {
      items.set(key, {
        key,
        sku: record.sku || "",
        name: record.name || "",
        openingQty: 0,
        openingAmount: 0,
        purchaseQty: 0,
        purchaseAmount: 0,
        supplierReturnQty: 0,
        supplierReturnAmount: 0,
        closingQty: 0,
        closingAmount: 0,
        salesQty: 0,
        salesAmount: 0,
        adjustmentQty: 0,
        adjustmentAmount: 0,
        referencePrices: [],
        reasons: new Set()
      });
    }
    const item = items.get(key);
    if (!item.sku && record.sku) item.sku = record.sku;
    if (!item.name && record.name) item.name = record.name;
    return item;
  }

  function addPrice(item, price, source, date) {
    if (price != null && Number.isFinite(price)) item.referencePrices.push({ price, source, date: date || "" });
  }

  function addIssue(issues, level, type, record, detail) {
    issues.push({
      level,
      type,
      source: REPORT_SCHEMAS[record.reportType] ? REPORT_SCHEMAS[record.reportType].label : record.reportType,
      row: record.sourceRow || "",
      doc: record.doc || record.relatedDoc || "",
      sku: record.sku || "",
      name: record.name || "",
      detail
    });
  }

  function recordCost(record) {
    if (record.purchaseCostAmount != null) return record.purchaseCostAmount;
    if (record.purchasePrice != null && record.qty != null) return record.purchasePrice * record.qty;
    return null;
  }

  function normalizeReconcileType(value) {
    const text = normalizeText(value);
    const match = text.match(/[1-5一二三四五]/);
    if (!match) return null;
    return ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 })[match[0]] || Number(match[0]);
  }

  function monthlyDirection(record) {
    const type = normalizeReconcileType(record.reconcileType);
    if (type === 1) return { type, source: "寬承總倉", destination: record.store };
    if (type === 2) return { type, source: record.store, destination: "寬承總倉" };
    if (type === 3) return { type, source: record.store, destination: record.otherStore };
    if (type === 4) return { type, source: record.otherStore, destination: record.store };
    if (type === 5) return { type, source: "寬承總倉", destination: record.store };
    return { type: null, source: "", destination: "" };
  }

  function sameItem(a, b) {
    return itemKey(a) === itemKey(b);
  }

  function sameQuantity(a, b) {
    return a.qty != null && b.qty != null && Math.abs(Math.abs(a.qty) - Math.abs(b.qty)) < EPSILON;
  }

  function sameDirection(monthly, transfer) {
    const direction = monthlyDirection(monthly);
    const source = normalizeText(transfer.sourceWarehouse);
    const destination = normalizeText(transfer.destinationWarehouse);
    const store = normalizeText(monthly.store);
    if (direction.type === 3 && !normalizeText(monthly.otherStore)) return source === store;
    if (direction.type === 4 && !normalizeText(monthly.otherStore)) return destination === store;
    return normalizeText(direction.source) === source && normalizeText(direction.destination) === destination;
  }

  function findMatch(candidates, record, predicate) {
    let index = -1;
    if (record.doc) {
      index = candidates.findIndex((candidate) => !candidate._used
        && candidate.doc
        && normalizeText(candidate.doc) === normalizeText(record.doc)
        && sameItem(candidate, record)
        && predicate(candidate));
    }
    if (index < 0) index = candidates.findIndex((candidate) => !candidate._used && sameItem(candidate, record) && predicate(candidate));
    if (index >= 0) {
      candidates[index]._used = true;
      return candidates[index];
    }
    return null;
  }

  function findMonthlyTransferMatch(candidates, record) {
    const key = [normalizeReconcileType(record.reconcileType), normalizeText(record.store), itemKey(record), Math.abs(record.qty || 0)].join("|");
    const predicate = (candidate) => sameItem(candidate, record)
      && sameQuantity(candidate, record)
      && sameDirection(record, candidate)
      && !candidate._monthlyMatchKeys.has(key);
    let match = null;
    if (record.doc) {
      match = candidates.find((candidate) => candidate.doc
        && normalizeText(candidate.doc) === normalizeText(record.doc)
        && predicate(candidate));
    } else {
      match = candidates.find(predicate);
    }
    if (match) match._monthlyMatchKeys.add(key);
    return match;
  }

  function monthIndexFromDate(value) {
    const match = String(value == null ? "" : value).match(/(20\d{2})\D{1,3}(\d{1,2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    return month >= 1 && month <= 12 ? year * 12 + month : null;
  }

  function monthIndexFromTransferDoc(value) {
    const match = String(value == null ? "" : value).toUpperCase().match(/AT(\d{2})(0[1-9]|1[0-2])/);
    if (!match) return null;
    return (2000 + Number(match[1])) * 12 + Number(match[2]);
  }

  function crossMonthTransferContext(record) {
    const documentMonth = monthIndexFromTransferDoc(record.doc);
    const monthlyReportMonth = monthIndexFromDate(record.date);
    if (documentMonth == null || monthlyReportMonth == null || documentMonth >= monthlyReportMonth) return null;
    const year = Math.floor((documentMonth - 1) / 12);
    const month = documentMonth - year * 12;
    return { year, month };
  }

  function movementMode(record) {
    const direction = normalizeText(record.direction || record.status || record.doc);
    if (direction.includes("出庫")) return "out";
    if (direction.includes("入庫")) return "in";
    if (direction.startsWith("ot") || direction.startsWith("out")) return "out";
    if (direction.startsWith("in")) return "in";
    if (record.qty != null) return record.qty < 0 ? "out" : "in";
    return "unknown";
  }

  function adjustmentRule(record) {
    const reason = normalizeText(record.reason);
    const mode = movementMode(record);
    if (reason.includes("調撥") || reason.includes("客退") || reason.includes("銷退") || reason.includes("退貨入庫") || reason.includes("銷貨") || reason.includes("採購入庫") || reason.includes("採購退貨")) return null;
    if (reason.includes("盤盈")) return { sign: -1, label: "盤盈" };
    if (reason.includes("盤虧")) return { sign: 1, label: "盤虧" };
    if (reason.includes("報廢")) return { sign: 1, label: "報廢" };
    if (reason.includes("公關")) return { sign: 1, label: "公關贈送" };
    if (reason.includes("客訴")) return { sign: 1, label: "客訴處理" };
    if (reason.includes("活動贈品") || reason.includes("活動贈送")) return { sign: 1, label: "活動贈品" };
    if (reason.includes("展示樣品") || reason.includes("樣品領用")) return { sign: 1, label: "展示樣品" };
    if (reason.includes("員購") || reason.includes("員工訂購")) return { sign: 1, label: "員購待核對" };
    if (reason.includes("樣品歸還")) return { sign: -1, label: "樣品歸還" };
    if (reason.includes("其它入庫") || reason.includes("其他入庫")) return { sign: -1, label: "其它入庫" };
    if (reason.includes("生產加工")) return { sign: mode === "out" ? 1 : -1, label: "生產加工" };
    if (mode === "in" || mode === "out") return { sign: mode === "out" ? 1 : -1, label: "未分類出入庫", uncertain: true };
    return null;
  }

  function referencePrice(item) {
    const priority = ["期末庫存", "當月進貨明細", "銷售品項成本明細", "期初庫存"];
    for (const source of priority) {
      const candidates = item.referencePrices.filter((entry) => entry.source === source);
      if (candidates.length) return candidates[candidates.length - 1].price;
    }
    return item.referencePrices.length ? item.referencePrices[item.referencePrices.length - 1].price : 0;
  }

  function differenceStatus(quantityDifference, amountDifference) {
    const hasQuantityDifference = Math.abs(quantityDifference) >= EPSILON;
    const hasAmountDifference = Math.abs(amountDifference) >= 1;
    if (hasQuantityDifference && hasAmountDifference) return "數量＆金額差異";
    if (hasQuantityDifference) return "僅數量差異";
    if (hasAmountDifference) return "僅金額差異";
    return "通過";
  }

  function investigationAdvice(status, item) {
    const cReasonNote = item.reasons.size
      ? `先確認C組「${Array.from(item.reasons).join("、")}」是否完整，`
      : "";
    if (status === "數量＆金額差異") return `${cReasonNote}先查期初／期末倉別範圍、銷售／調撥／出入庫漏單、品號與正負方向；數量釐清後，再核對進貨價及未稅成本。`;
    if (status === "僅數量差異") return `${cReasonNote}檢查期初／期末倉別範圍、銷售／調撥／出入庫漏單、品號與正負方向；金額已在1元容許值內。`;
    if (status === "僅金額差異") return "數量已平衡；核對期初／期末進貨價、進貨／退廠未稅額及銷售進貨價成本。";
    return "數量與金額皆在容許值內，原則上無需排查。";
  }

  function sourceAmount(record) {
    if (record.reportType === "purchases" || record.reportType === "supplierReturns") {
      return record.untaxedAmount != null ? record.untaxedAmount : recordCost(record);
    }
    if (record.reportType === "storeMonthly") return record.claimAmount;
    if (record.reportType === "transfers") {
      return record.transferAmount != null ? record.transferAmount : recordCost(record);
    }
    return recordCost(record);
  }

  function analyzeReports(reports, options) {
    const items = new Map();
    const issues = [];
    const sourceChecks = [];
    const exclusions = [];
    const adjustmentDetails = [];
    const productRules = options && options.rules ? options.rules : DEFAULT_PRODUCT_RULES;
    const ruleContext = {
      version: options && options.rulesVersion != null ? options.rulesVersion : "內建預設",
      updatedAt: options && options.rulesUpdatedAt ? options.rulesUpdatedAt : "",
      exclusions: Array.isArray(productRules["排除關鍵字"]) ? [...productRules["排除關鍵字"]] : [],
      reviews: Array.isArray(productRules["待人工確認關鍵字"]) ? [...productRules["待人工確認關鍵字"]] : [],
      whitelist: Array.isArray(productRules["指定品名白名單"]) ? [...productRules["指定品名白名單"]] : []
    };
    const sourceCheckByType = new Map();

    for (const type of REPORT_ORDER) {
      let sourceCheck;
      if (reports[type] && reports[type].meta) {
        const meta = reports[type].meta;
        sourceCheck = {
          reportType: type,
          source: meta.label,
          fileName: meta.fileName,
          sheetName: meta.sheetName,
          headerRow: meta.headerRow,
          rawRows: meta.rawRows,
          acceptedRows: meta.acceptedRows,
          cancelledRows: meta.cancelledRows,
          parsedQty: 0,
          parsedAmount: 0,
          ruleExcludedRows: 0,
          ruleExcludedQty: 0,
          ruleExcludedAmount: 0,
          reviewRows: 0,
          note: meta.note || ""
        };
      } else {
        sourceCheck = { reportType: type, source: REPORT_SCHEMAS[type].label, fileName: "未匯入", sheetName: "", headerRow: "", rawRows: 0, acceptedRows: 0, cancelledRows: 0, parsedQty: 0, parsedAmount: 0, ruleExcludedRows: 0, ruleExcludedQty: 0, ruleExcludedAmount: 0, reviewRows: 0, note: type === "opening" || type === "closing" || type === "purchases" || type === "sales" ? "必要來源未匯入" : "本月無資料時可略過" };
      }
      sourceChecks.push(sourceCheck);
      sourceCheckByType.set(type, sourceCheck);
    }

    const filteredRecords = {};
    for (const type of REPORT_ORDER) {
      const records = reports[type] && Array.isArray(reports[type].records) ? reports[type].records : [];
      const sourceCheck = sourceCheckByType.get(type);
      filteredRecords[type] = records.filter((record) => {
        const amount = sourceAmount(record);
        sourceCheck.parsedQty += record.qty || 0;
        if (amount != null) sourceCheck.parsedAmount += amount;
        const result = productRuleResult(record.name, productRules);
        if (result.category === "excluded") {
          sourceCheck.ruleExcludedRows += 1;
          sourceCheck.ruleExcludedQty += record.qty || 0;
          if (amount != null) sourceCheck.ruleExcludedAmount += amount;
          exclusions.push({
            source: REPORT_SCHEMAS[type].label,
            row: record.sourceRow || "",
            doc: record.doc || record.relatedDoc || "",
            sku: record.sku || "",
            name: record.name || "",
            qty: record.qty || 0,
            amount: amount == null ? "" : amount,
            keywords: result.keywords.join("、"),
            reason: result.reason
          });
          return false;
        }
        if (result.category === "review") {
          sourceCheck.reviewRows += 1;
          addIssue(issues, "warning", "集中規則待人工確認", record, `${result.reason}；本次仍納入計算，請人工確認。`);
        }
        return true;
      });
      sourceCheck.ruleIncludedRows = records.length - sourceCheck.ruleExcludedRows;
      sourceCheck.ruleIncludedQty = sourceCheck.parsedQty - sourceCheck.ruleExcludedQty;
      sourceCheck.ruleIncludedAmount = sourceCheck.parsedAmount - sourceCheck.ruleExcludedAmount;
    }
    const getRecords = (type) => filteredRecords[type] || [];

    for (const type of ["opening", "closing"]) {
      for (const record of getRecords(type)) {
        const scope = classifyWarehouse(record.warehouse);
        if (scope === "franchise") {
          addIssue(issues, "info", "排除加盟店倉", record, `${record.warehouse}不屬總公司庫存範圍，未納入${REPORT_SCHEMAS[type].label}。`);
          continue;
        }
        if (scope === "unknown") {
          addIssue(issues, "error", "未知倉別", record, `無法判斷「${record.warehouse || "空白"}」是否屬總公司，該列暫不納入。`);
          continue;
        }
        const item = getOrCreateItem(items, record);
        const qty = record.qty || 0;
        const amount = recordCost(record);
        if (type === "opening") {
          item.openingQty += qty;
          if (amount != null) item.openingAmount += amount;
        } else {
          item.closingQty += qty;
          if (amount != null) item.closingAmount += amount;
        }
        addPrice(item, record.purchasePrice != null ? record.purchasePrice : (qty ? amount / qty : null), REPORT_SCHEMAS[type].label, record.date);
      }
    }

    for (const record of getRecords("purchases")) {
      const item = getOrCreateItem(items, record);
      const qty = Math.abs(record.qty || 0);
      const amount = record.untaxedAmount != null ? Math.abs(record.untaxedAmount) : Math.abs(recordCost(record) || 0);
      item.purchaseQty += qty;
      item.purchaseAmount += amount;
      addPrice(item, record.purchasePrice != null ? record.purchasePrice : (qty ? amount / qty : null), "當月進貨明細", record.date);
    }

    for (const record of getRecords("supplierReturns")) {
      const item = getOrCreateItem(items, record);
      const qty = Math.abs(record.qty || 0);
      const amount = record.untaxedAmount != null ? Math.abs(record.untaxedAmount) : Math.abs(recordCost(record) || 0);
      item.supplierReturnQty += qty;
      item.supplierReturnAmount += amount;
    }

    const sales = getRecords("sales").map((record) => ({ ...record, _used: false }));
    const movements = getRecords("movements").map((record) => ({ ...record, _used: false }));
    const transfers = getRecords("transfers").map((record) => ({ ...record, _used: false, _monthlyMatched: false, _monthlyMatchKeys: new Set() }));
    const monthly = getRecords("storeMonthly");

    for (const record of monthly) {
      const direction = monthlyDirection(record);
      if (!direction.type) {
        addIssue(issues, "error", "無法辨識對帳總類", record, `對帳總類「${record.reconcileType}」不在1至5類規則內。`);
        continue;
      }
      if (direction.type <= 4) {
        const match = findMonthlyTransferMatch(transfers, record);
        if (!match) {
          const crossMonth = crossMonthTransferContext(record);
          if (crossMonth) {
            addIssue(issues, "warning", "跨月調撥待查", record, `單號顯示為${crossMonth.year}年${crossMonth.month}月，但本筆列在較後月份的月結報表；${direction.source}→${direction.destination}尚未找到相同單號、商品及數量的調撥單，請補匯入上月調撥明細後再分析。`);
          } else {
            addIssue(issues, "error", "月結缺少調撥配對", record, `${direction.source}→${direction.destination}找不到相同單號、商品及數量的調撥單。`);
          }
        } else {
          match._monthlyMatched = true;
          const settlementAmount = match.transferAmount != null
            ? Math.abs(match.transferAmount)
            : (match.sourceCostPrice != null ? Math.abs(match.qty || 0) * match.sourceCostPrice : null);
          const amountDifference = record.claimAmount != null && settlementAmount != null
            ? Math.abs(Math.abs(record.claimAmount) - settlementAmount)
            : null;
          const amountTolerance = record.claimAmount != null
            ? Math.max(2, Math.abs(record.claimAmount) * 0.01)
            : 2;
          if (amountDifference != null && amountDifference > amountTolerance) {
            addIssue(issues, "warning", "月結與調撥金額不同", record, `月結請款 ${displayNumber(record.claimAmount)}，調撥結算金額 ${displayNumber(settlementAmount)}。兩者僅作請款勾稽，不作A／B成本。`);
          }
        }
      } else {
        const storeScope = classifyWarehouse(record.store);
        const saleMatch = findMatch(sales, record, (candidate) => sameQuantity(record, candidate)
          && ((record.doc && candidate.doc && normalizeText(record.doc) === normalizeText(candidate.doc))
            || !candidate.store
            || normalizeText(candidate.store).includes(normalizeText(record.store))));
        if (storeScope === "direct") {
          if (!saleMatch) {
            addIssue(issues, "warning", "直營總倉代出缺少銷售配對", record, "直營門市月結僅作記錄；目前找不到對應銷售成本明細。" );
          } else {
            const item = getOrCreateItem(items, saleMatch);
            const directReferencePrice = referencePrice(item);
            const cost = recordCost(saleMatch) != null
              ? recordCost(saleMatch)
              : Math.abs(saleMatch.qty || 0) * directReferencePrice;
            item.salesQty += saleMatch.qty || 0;
            if (cost != null && (recordCost(saleMatch) != null || directReferencePrice)) item.salesAmount += cost;
            else addIssue(issues, "error", "直營總倉代出缺少進貨價成本", saleMatch, "銷售數量已納入B，但找不到進貨價或進貨價成本額。" );
            addPrice(item, saleMatch.purchasePrice, "銷售品項成本明細", saleMatch.date);
          }
          continue;
        }
        if (storeScope !== "franchise") {
          addIssue(issues, "error", "總倉代出門市類型不明", record, `無法判斷「${record.store}」是直營或加盟。`);
          continue;
        }
        const item = getOrCreateItem(items, record);
        const signQty = Math.abs(record.qty || 0);
        item.salesQty += signQty;
        if (saleMatch) {
          const cost = recordCost(saleMatch);
          if (cost != null) item.salesAmount += Math.abs(cost);
          else addIssue(issues, "error", "總倉代出缺少進貨價成本", record, "已找到銷售明細，但沒有進貨價或進貨價成本額。" );
          addPrice(item, saleMatch.purchasePrice, "銷售品項成本明細", saleMatch.date);
        } else {
          const movementMatch = findMatch(movements, record, (candidate) => movementMode(candidate) === "out" && sameQuantity(record, candidate));
          const referenceCost = Math.abs(record.qty || 0) * referencePrice(item);
          const cost = movementMatch && recordCost(movementMatch) != null ? recordCost(movementMatch) : referenceCost;
          if (cost != null && (movementMatch && recordCost(movementMatch) != null || referencePrice(item))) {
            item.salesAmount += Math.abs(cost);
            if (movementMatch) addPrice(item, movementMatch.purchasePrice, "出入庫明細列表", movementMatch.date);
            if (!movementMatch || recordCost(movementMatch) == null) addIssue(issues, "info", "總倉代出採參考進貨價", record, "來源沒有逐筆進貨價成本，已依期末、當月進貨、銷售或期初的進貨價優先順序計算。" );
          } else {
            addIssue(issues, "error", "加盟總倉代出缺少成本", record, "第5類總倉代出沒有調撥單；也找不到銷售成本或總倉出庫進貨價成本。數量已納入，成本待補。" );
          }
        }
      }
    }

    for (const transfer of transfers) {
      const sourceScope = classifyWarehouse(transfer.sourceWarehouse);
      const destinationScope = classifyWarehouse(transfer.destinationWarehouse);
      let sign = 0;
      if ((sourceScope === "included" || sourceScope === "direct") && destinationScope === "franchise") sign = 1;
      if (sourceScope === "franchise" && (destinationScope === "included" || destinationScope === "direct")) sign = -1;
      if (sourceScope === "unknown" || destinationScope === "unknown") {
        addIssue(issues, "error", "調撥倉別不明", transfer, `${transfer.sourceWarehouse}→${transfer.destinationWarehouse}含有無法分類的倉別。`);
        continue;
      }
      if (sign === 0) continue;
      const item = getOrCreateItem(items, transfer);
      const qty = Math.abs(transfer.qty || 0) * sign;
      item.salesQty += qty;
      const franchiseStore = sign > 0 ? transfer.destinationWarehouse : transfer.sourceWarehouse;
      const saleMatch = findMatch(sales, transfer, (candidate) => sameQuantity(transfer, candidate)
        && (!candidate.store || normalizeText(candidate.store).includes(normalizeText(franchiseStore))));
      const basisRecord = saleMatch || transfer;
      const directBasisCost = recordCost(basisRecord);
      const fallbackPrice = referencePrice(item);
      const basisCost = directBasisCost != null ? directBasisCost : Math.abs(transfer.qty || 0) * fallbackPrice;
      if (basisCost != null && (directBasisCost != null || fallbackPrice)) item.salesAmount += Math.abs(basisCost) * sign;
      else addIssue(issues, "error", "跨體系調撥缺少進貨價成本", transfer, "數量已納入B，但銷售成本與調撥單都沒有進貨價相關欄位；調出／調入方成本價與門市成本不可替代。" );
      if (directBasisCost == null && fallbackPrice) addIssue(issues, "info", "跨體系調撥採參考進貨價", transfer, "調撥單只有調出／調入方成本價，已改採商品參考進貨價計算B。" );
      addPrice(item, basisRecord.purchasePrice, saleMatch ? "銷售品項成本明細" : "調撥單明細", basisRecord.date);
      if (!transfer._monthlyMatched) addIssue(issues, "error", "跨體系調撥缺少月結配對", transfer, "總公司與加盟店倉之間的調撥沒有配對到門市月結，可能漏請款或尚未月結。" );
    }

    for (const sale of sales) {
      if (sale._used) continue;
      const item = getOrCreateItem(items, sale);
      const qty = sale.qty || 0;
      const amount = recordCost(sale);
      item.salesQty += qty;
      if (amount != null) item.salesAmount += amount;
      else addIssue(issues, "error", "銷售缺少進貨價成本", sale, "銷售數量已納入B，但找不到進貨價或進貨價成本額。" );
      addPrice(item, sale.purchasePrice != null ? sale.purchasePrice : (qty ? amount / qty : null), "銷售品項成本明細", sale.date);
    }

    for (const movement of movements) {
      if (movement._used) continue;
      const rule = adjustmentRule(movement);
      if (!rule) continue;
      const item = getOrCreateItem(items, movement);
      const qty = Math.abs(movement.qty || 0) * rule.sign;
      const directMovementCost = recordCost(movement);
      const fallbackMovementPrice = referencePrice(item);
      const amount = (directMovementCost != null ? Math.abs(directMovementCost) : Math.abs(movement.qty || 0) * fallbackMovementPrice) * rule.sign;
      item.adjustmentQty += qty;
      item.adjustmentAmount += amount;
      item.reasons.add(rule.label);
      addPrice(item, movement.purchasePrice, "出入庫明細列表", movement.date);
      if (directMovementCost == null && fallbackMovementPrice) addIssue(issues, "info", "出入庫採參考進貨價", movement, "出入庫報表只有平均成本，已依商品參考進貨價計算C。" );
      if (directMovementCost == null && !fallbackMovementPrice) addIssue(issues, "error", "出入庫缺少進貨價成本", movement, "無法從期末、當月進貨、銷售或期初取得進貨價，C金額暫列0。" );
      if (rule.uncertain) addIssue(issues, "warning", "未分類出入庫原因", movement, `原因「${movement.reason || "空白"}」未命中既定規則，暫依${rule.sign > 0 ? "出庫" : "入庫"}方向納入C。`);
      if (rule.label === "員購待核對") addIssue(issues, "warning", "員購需確認銷貨單", movement, "若另有銷貨單，這筆應歸B並避免與C重複；目前未找到可靠關聯，暫列C。" );
      const quantityMagnitude = Math.abs(movement.qty || 0);
      const adoptedPrice = quantityMagnitude > EPSILON && directMovementCost != null
        ? Math.abs(directMovementCost) / quantityMagnitude
        : fallbackMovementPrice;
      const costBasis = directMovementCost != null
        ? "出入庫明細的進貨價相關欄位"
        : (fallbackMovementPrice ? "商品統一參考進貨價" : "缺少進貨價，C金額暫列0");
      const notice = rule.label === "員購待核對"
        ? "請確認是否另有銷貨單；若有，應歸B並避免與C重複。"
        : (rule.uncertain ? "原因未命中既定規則，請人工確認分類及方向。" : "");
      const resolvedDirection = movementMode(movement);
      adjustmentDetails.push({
        sourceRow: movement.sourceRow || "",
        date: movement.date || "",
        doc: movement.doc || "",
        relatedDoc: movement.relatedDoc || "",
        warehouse: movement.warehouse || "",
        sku: movement.sku || "",
        name: movement.name || "",
        sourceDirection: resolvedDirection === "out" ? "出庫" : (resolvedDirection === "in" ? "入庫" : "未辨識"),
        sourceReason: movement.reason || "",
        category: rule.label,
        sourceQty: movement.qty || 0,
        adjustmentQty: qty,
        sourceCostAmount: directMovementCost == null ? "" : Math.abs(directMovementCost),
        adoptedPrice: adoptedPrice || 0,
        adjustmentAmount: amount,
        costBasis,
        explanation: rule.sign > 0
          ? "非銷售出庫，C列正數，於A－B－C中扣除。"
          : "非銷售入庫，C列負數，於A－B－C中加回。",
        notice
      });
    }

    const details = Array.from(items.values()).map((item) => {
      const aQty = item.openingQty + item.purchaseQty - item.supplierReturnQty - item.closingQty;
      const aAmount = item.openingAmount + item.purchaseAmount - item.supplierReturnAmount - item.closingAmount;
      const quantityDifference = aQty - item.salesQty - item.adjustmentQty;
      const rawAmountDifference = aAmount - item.salesAmount - item.adjustmentAmount;
      const refPrice = referencePrice(item);
      const standardizedDifference = quantityDifference * refPrice;
      const priceBasisEffect = rawAmountDifference - standardizedDifference;
      const status = differenceStatus(quantityDifference, rawAmountDifference);
      const advice = investigationAdvice(status, item);
      return {
        ...item,
        reasons: Array.from(item.reasons).join("、"),
        aQty,
        aAmount,
        quantityDifference,
        rawAmountDifference,
        refPrice,
        standardizedDifference,
        priceBasisEffect,
        status,
        advice
      };
    }).sort((a, b) => Math.abs(b.rawAmountDifference) - Math.abs(a.rawAmountDifference));

    const totals = details.reduce((acc, item) => {
      for (const key of ["openingQty", "openingAmount", "purchaseQty", "purchaseAmount", "supplierReturnQty", "supplierReturnAmount", "closingQty", "closingAmount", "aQty", "aAmount", "salesQty", "salesAmount", "adjustmentQty", "adjustmentAmount", "quantityDifference", "rawAmountDifference", "standardizedDifference", "priceBasisEffect"]) acc[key] += item[key] || 0;
      return acc;
    }, Object.fromEntries(["openingQty", "openingAmount", "purchaseQty", "purchaseAmount", "supplierReturnQty", "supplierReturnAmount", "closingQty", "closingAmount", "aQty", "aAmount", "salesQty", "salesAmount", "adjustmentQty", "adjustmentAmount", "quantityDifference", "rawAmountDifference", "standardizedDifference", "priceBasisEffect"].map((key) => [key, 0])));

    totals.itemCount = details.length;
    totals.issueCount = issues.filter((issue) => issue.level !== "info").length;
    totals.passCount = details.filter((item) => item.status === "通過").length;
    totals.quantityOnlyIssueCount = details.filter((item) => item.status === "僅數量差異").length;
    totals.amountOnlyIssueCount = details.filter((item) => item.status === "僅金額差異").length;
    totals.quantityAmountIssueCount = details.filter((item) => item.status === "數量＆金額差異").length;
    totals.quantityIssueCount = totals.quantityOnlyIssueCount + totals.quantityAmountIssueCount;

    return { details, issues, sourceChecks, exclusions, adjustmentDetails, ruleContext, totals, generatedAt: new Date().toISOString() };
  }

  function setSheetLayout(sheet, widths, filterRange) {
    sheet["!cols"] = widths.map((wch) => ({ wch }));
    if (filterRange) sheet["!autofilter"] = { ref: filterRange };
  }

  function makeSheet(XLSX, rows, widths, filterRange) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    setSheetLayout(sheet, widths, filterRange);
    return sheet;
  }

  function setNumberFormats(XLSX, sheet, ranges, formatCode) {
    for (const rangeText of ranges) {
      const range = XLSX.utils.decode_range(rangeText);
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        for (let column = range.s.c; column <= range.e.c; column += 1) {
          const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
          if (cell && cell.t === "n") cell.z = formatCode;
        }
      }
    }
  }

  function buildOutputWorkbook(analysis, XLSX) {
    const workbook = XLSX.utils.book_new();
    const t = analysis.totals;
    const ruleContext = analysis.ruleContext || { version: "內建預設", updatedAt: "", exclusions: ["運費"], reviews: [], whitelist: [] };
    const summaryRows = [
      ["庫存成本分析摘要"],
      ["產生時間", analysis.generatedAt],
      ["集中排除規則", `公司集中規則 v${ruleContext.version}`, ruleContext.updatedAt || ""],
      ["排除關鍵字", `${ruleContext.exclusions.length}項；完整清單與逐列排除明細請見05_來源檢查`],
      ["計算項目", "數量", "進貨價成本金額"],
      ["期初庫存", t.openingQty, t.openingAmount],
      ["當月進貨", t.purchaseQty, t.purchaseAmount],
      ["退廠／供應商退貨", -t.supplierReturnQty, -t.supplierReturnAmount],
      ["期末庫存", -t.closingQty, -t.closingAmount],
      ["A：庫存推算耗用", t.aQty, t.aAmount],
      ["B：淨銷售／跨體系調撥", t.salesQty, t.salesAmount],
      ["C：非銷售出入庫調整", t.adjustmentQty, t.adjustmentAmount],
      ["最終未解釋差異", t.quantityDifference, t.rawAmountDifference],
      ["同一進貨價基準下的差異", t.quantityDifference, t.standardizedDifference],
      ["進貨價基準變動影響", "", t.priceBasisEffect],
      [],
      ["檢查統計", "數量"],
      ["商品總數", t.itemCount],
      ["完全通過", t.passCount],
      ["僅數量差異商品", t.quantityOnlyIssueCount],
      ["僅金額差異商品", t.amountOnlyIssueCount],
      ["數量＆金額差異商品", t.quantityAmountIssueCount],
      ["來源／配對問題", t.issueCount],
      [],
      ["成本規則"],
      ["A、B、C均以報表中的進貨價相關欄位為成本基準。一般報表的成本價代表平均成本，只供參考；當月進貨明細的成本價例外代表供應商進貨價。"],
      ["門市成本＝進貨價×1.1，門市月結金額為加盟請款金額，兩者均不直接作A／B成本。"],
      ["狀態判斷：未解釋數量絕對值小於0.000001視為0；未解釋金額絕對值未滿1元視為容許尾差。"]
    ];
    const summary = makeSheet(XLSX, summaryRows, [30, 20, 22]);
    setNumberFormats(XLSX, summary, ["B6:B15"], "#,##0");
    setNumberFormats(XLSX, summary, ["C6:C15"], "#,##0.00");
    setNumberFormats(XLSX, summary, ["B18:B23"], "#,##0");
    const summaryMergeLabels = new Set(["庫存成本分析摘要", "成本規則", "A、B、C均以報表中的進貨價相關欄位為成本基準。一般報表的成本價代表平均成本，只供參考；當月進貨明細的成本價例外代表供應商進貨價。", "門市成本＝進貨價×1.1，門市月結金額為加盟請款金額，兩者均不直接作A／B成本。", "狀態判斷：未解釋數量絕對值小於0.000001視為0；未解釋金額絕對值未滿1元視為容許尾差。"]);
    summary["!merges"] = summaryRows
      .map((row, index) => summaryMergeLabels.has(row[0]) ? { s: { r: index, c: 0 }, e: { r: index, c: 2 } } : null)
      .filter(Boolean);
    XLSX.utils.book_append_sheet(workbook, summary, "01_分析摘要");

    const detailHeaders = ["商品編號", "品名", "期初數量", "期初進貨價成本", "進貨數量", "進貨未稅額", "退廠數量", "退廠未稅額", "期末數量", "期末進貨價成本", "A數量", "A金額", "B數量", "B金額", "C數量", "C金額", "數量差異", "原始金額差異", "統一參考進貨價", "同價基準差異", "進貨價基準影響", "C組原因", "狀態", "建議排查方法"];
    const detailRows = [detailHeaders, ...analysis.details.map((item) => [item.sku, item.name, item.openingQty, item.openingAmount, item.purchaseQty, item.purchaseAmount, item.supplierReturnQty, item.supplierReturnAmount, item.closingQty, item.closingAmount, item.aQty, item.aAmount, item.salesQty, item.salesAmount, item.adjustmentQty, item.adjustmentAmount, item.quantityDifference, item.rawAmountDifference, item.refPrice, item.standardizedDifference, item.priceBasisEffect, item.reasons, item.status, item.advice])];
    const detailSheet = makeSheet(XLSX, detailRows, [16, 30, 12, 18, 12, 16, 12, 16, 12, 18, 12, 16, 12, 16, 12, 16, 12, 18, 16, 18, 18, 24, 18, 64], `A1:X${detailRows.length}`);
    const detailEndRow = Math.max(2, detailRows.length);
    setNumberFormats(XLSX, detailSheet, ["C", "E", "G", "I", "K", "M", "O", "Q"].map((column) => `${column}2:${column}${detailEndRow}`), "#,##0");
    setNumberFormats(XLSX, detailSheet, ["D", "F", "H", "J", "L", "N", "P", "R", "S", "T", "U"].map((column) => `${column}2:${column}${detailEndRow}`), "#,##0.00");
    XLSX.utils.book_append_sheet(workbook, detailSheet, "02_商品差異明細");

    const issueHeaders = ["層級", "問題類型", "來源報表", "來源列", "單據編號", "商品編號", "品名", "說明"];
    const issueRows = [issueHeaders, ...analysis.issues.map((issue) => [issue.level, issue.type, issue.source, issue.row, issue.doc, issue.sku, issue.name, issue.detail])];
    if (issueRows.length === 1) issueRows.push(["info", "無未配對資料", "", "", "", "", "", "所有來源與規則檢查均通過。"]);
    const issueSheet = makeSheet(XLSX, issueRows, [10, 24, 22, 10, 18, 16, 28, 70], `A1:H${issueRows.length}`);
    setNumberFormats(XLSX, issueSheet, [`D2:D${issueRows.length}`], "#,##0");
    XLSX.utils.book_append_sheet(workbook, issueSheet, "03_未配對資料");

    const sourceHeaders = ["報表種類", "檔名", "工作表", "表頭列", "原始資料列", "解析有效列", "有效數量", "有效來源金額", "規則排除列", "排除數量", "排除來源金額", "規則後列數", "規則後數量", "規則後來源金額", "待確認列", "取消／作廢列", "備註"];
    const sourceRows = [
      sourceHeaders,
      ...analysis.sourceChecks.map((row) => [row.source, row.fileName, row.sheetName, row.headerRow, row.rawRows, row.acceptedRows, row.parsedQty || 0, row.parsedAmount || 0, row.ruleExcludedRows || 0, row.ruleExcludedQty || 0, row.ruleExcludedAmount || 0, row.ruleIncludedRows || 0, row.ruleIncludedQty || 0, row.ruleIncludedAmount || 0, row.reviewRows || 0, row.cancelledRows, row.note]),
      [],
      ["期初／期末應納入倉別"],
      ["寬承總倉、台中北屯門市、台北中山門市、退貨倉（尚未退廠）、瑕疵倉、報廢倉（系統仍有帳面庫存者）、員購倉、客服倉、行銷－活動＆商品拍攝倉、行銷－公關品倉、行銷－寄賣倉、行銷－市集特賣倉、寄倉 momo 購物。排除加盟店倉；短期快閃「高雄漢神本館」亦屬加盟。"],
      [],
      ["報表專用成本規則"],
      ["當月進貨明細中的「成本價」是供應商進貨價；其它報表中的「成本價」是平均成本。所有A／B／C成本優先採進貨價相關欄位。"],
      [],
      ["公司集中商品規則"],
      ["規則版本", `v${ruleContext.version}`, ruleContext.updatedAt || ""],
      ["排除關鍵字", ruleContext.exclusions.join("、") || "無"],
      ["待確認關鍵字", ruleContext.reviews.join("、") || "無"],
      ["指定品名白名單", ruleContext.whitelist.join("、") || "無"],
      ["判斷順序", "完整品名白名單優先，其次排除關鍵字，再其次待人工確認關鍵字。"],
      [],
      ["集中規則排除明細"],
      ["來源報表", "來源列", "單據編號", "商品編號", "品名", "數量", "來源金額", "命中關鍵字", "排除原因"],
      ...(analysis.exclusions && analysis.exclusions.length
        ? analysis.exclusions.map((row) => [row.source, row.row, row.doc, row.sku, row.name, row.qty, row.amount, row.keywords, row.reason])
        : [["本次沒有集中規則排除資料"]])
    ];
    const sourceSheet = makeSheet(XLSX, sourceRows, [26, 34, 22, 10, 14, 14, 14, 18, 14, 14, 18, 14, 14, 20, 12, 16, 80]);
    setNumberFormats(XLSX, sourceSheet, ["D2:F9", "I2:I9", "L2:L9", "O2:P9"], "#,##0");
    setNumberFormats(XLSX, sourceSheet, ["G2:G9", "J2:J9", "M2:M9"], "#,##0");
    setNumberFormats(XLSX, sourceSheet, ["H2:H9", "K2:K9", "N2:N9"], "#,##0.00");
    const exclusionStartRow = 26;
    const exclusionEndRow = Math.max(exclusionStartRow, exclusionStartRow + (analysis.exclusions ? analysis.exclusions.length : 0) - 1);
    setNumberFormats(XLSX, sourceSheet, [`B${exclusionStartRow}:B${exclusionEndRow}`], "#,##0");
    setNumberFormats(XLSX, sourceSheet, [`F${exclusionStartRow}:F${exclusionEndRow}`], "#,##0");
    setNumberFormats(XLSX, sourceSheet, [`G${exclusionStartRow}:G${exclusionEndRow}`], "#,##0.00");
    const sourceMergeLabels = new Set(["期初／期末應納入倉別", "寬承總倉、台中北屯門市、台北中山門市、退貨倉（尚未退廠）、瑕疵倉、報廢倉（系統仍有帳面庫存者）、員購倉、客服倉、行銷－活動＆商品拍攝倉、行銷－公關品倉、行銷－寄賣倉、行銷－市集特賣倉、寄倉 momo 購物。排除加盟店倉；短期快閃「高雄漢神本館」亦屬加盟。", "報表專用成本規則", "當月進貨明細中的「成本價」是供應商進貨價；其它報表中的「成本價」是平均成本。所有A／B／C成本優先採進貨價相關欄位。", "公司集中商品規則", "集中規則排除明細"]);
    sourceSheet["!merges"] = sourceRows
      .map((row, index) => sourceMergeLabels.has(row[0]) ? { s: { r: index, c: 0 }, e: { r: index, c: 16 } } : null)
      .filter(Boolean);
    const adjustmentHeaders = ["來源列", "出入庫日期", "出入庫單號", "關聯單號", "倉別", "商品編號", "品名", "判斷方向", "原始原因", "C組分類", "來源數量", "C調整數量", "來源進貨價成本", "採用進貨價", "C調整金額", "成本依據", "納入說明", "注意事項"];
    const adjustmentRows = [
      adjustmentHeaders,
      ...(analysis.adjustmentDetails && analysis.adjustmentDetails.length
        ? analysis.adjustmentDetails.map((row) => [row.sourceRow, row.date, row.doc, row.relatedDoc, row.warehouse, row.sku, row.name, row.sourceDirection, row.sourceReason, row.category, row.sourceQty, row.adjustmentQty, row.sourceCostAmount, row.adoptedPrice, row.adjustmentAmount, row.costBasis, row.explanation, row.notice])
        : [["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "本月沒有納入C組的非銷售出入庫調整。", ""]])
    ];
    const adjustmentSheet = makeSheet(XLSX, adjustmentRows, [10, 16, 20, 18, 20, 16, 30, 14, 26, 18, 12, 14, 18, 16, 18, 28, 44, 48], `A1:R${adjustmentRows.length}`);
    const adjustmentEndRow = Math.max(2, adjustmentRows.length);
    setNumberFormats(XLSX, adjustmentSheet, [`A2:A${adjustmentEndRow}`], "#,##0");
    setNumberFormats(XLSX, adjustmentSheet, [`K2:L${adjustmentEndRow}`], "#,##0");
    setNumberFormats(XLSX, adjustmentSheet, [`M2:O${adjustmentEndRow}`], "#,##0.00");
    XLSX.utils.book_append_sheet(workbook, adjustmentSheet, "04_C組調整明細");
    XLSX.utils.book_append_sheet(workbook, sourceSheet, "05_來源檢查");
    return workbook;
  }

  global.InventoryCostCore = {
    REPORT_ORDER,
    REPORT_SCHEMAS,
    INCLUDED_WAREHOUSES,
    DIRECT_STORES,
    FRANCHISE_STORES,
    DEFAULT_PRODUCT_RULES,
    normalizeText,
    parseNumber,
    isFreight,
    productRuleResult,
    classifyWarehouse,
    fieldLabel,
    autoMapHeaders,
    validateMapping,
    inspectSheet,
    inspectWorkbook,
    extractReport,
    mergeReportParts,
    analyzeReports,
    buildOutputWorkbook,
    normalizeReconcileType,
    monthlyDirection
  };
})(globalThis);

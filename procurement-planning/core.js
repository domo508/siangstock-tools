(function (global) {
  "use strict";

  const LOCKED_RULES = Object.freeze({
    netDemandFormula: "MAX(總部需求＋逐店扣除調撥後庫存的門市需求－調撥後總部可用庫存－已採購未到貨, 0)",
    releaseRule: "月初依熱銷70%、穩定50%、低銷0%分批釋放；月中與月底依最新缺口重新計算。",
    consignmentRule: "工廠寄倉可拉貨量不得扣減淨採購需求；只用於供貨分配、交期核對與缺貨警示。",
    shortageAction: "寄倉現貨與可按時完成量不足時，顯示缺貨警示並新增寄庫單；不提供改向其他供應商採購。",
    pendingPurchaseRule: "採購單每次完整重匯；新單視為草稿不占用，主管審核與未結案部分到貨只扣未交量，已結案或全部到貨不再扣未到貨。",
    transferRule: "期間調撥單依庫存截止日還原在途狀態：提交須保留調出倉並預計入調入倉；發貨審核因ERP已扣調出倉，只預計入調入倉；收貨審核因ERP已入庫，不重複調整。",
    blacklistRule: "一次性代工品由人工以ERP品號或完整品名加入黑名單；SA／OA／SB／OB開頭品號及8×7尺商品固定視為一次性客製或組合品，不進一般採購與寄庫。",
    sellThroughStopRule: "只有品名結尾的獨立括號標記(S)視為已斷貨、售完即停；停止對外採購與新增寄庫，但保留線上銷售及門市由總倉現貨調撥去化。",
    sellThroughTransferRule: "(S)商品先保留總倉已知訂單及必要安全庫存，再以剩餘可調撥現貨供門市去化；不足只顯示缺貨，不得轉成供應商採購或寄庫需求。"
  });

  const CONFIRMED_OVERRIDES = Object.freeze({
    "A42359-A": "A068-TBA3-5062-00064"
  });

  const CONFIRMED_EXCLUSIONS = Object.freeze({
    "A43359-A": "原規劃製作、後續已放棄；供應商寄倉表可保留，工具固定忽略。"
  });

  const DEMAND_SALE_TYPES = Object.freeze(["銷貨", "訂貨", "退貨", "退訂"]);
  const CUSTOM_SKU_PREFIXES = Object.freeze(["SA", "OA", "SB", "OB"]);
  const CONFIRMED_COMBINATION_SKUS = Object.freeze(new Set(["OA41361", "OA42361", "OA43361", "OA44361"]));

  function isAutomaticProcurementExcludedSku(value) {
    const sku = normalizeSku(value);
    return CUSTOM_SKU_PREFIXES.some((prefix) => sku.startsWith(prefix));
  }

  function isEightBySevenCustomItem(...values) {
    return values.some((value) => /(?:^|[^0-9])8\s*[xX×＊*]\s*7\s*[尺呎](?:[^0-9]|$)/.test(String(value == null ? "" : value).normalize("NFKC")));
  }

  function isAutomaticProcurementExcludedItem(sku, ...descriptors) {
    return isAutomaticProcurementExcludedSku(sku) || isEightBySevenCustomItem(...descriptors);
  }

  function isCustomerCustomSku(value) {
    const sku = normalizeSku(value);
    return isAutomaticProcurementExcludedSku(sku) && !CONFIRMED_COMBINATION_SKUS.has(sku);
  }

  function isCustomerCustomItem(sku, ...descriptors) {
    const normalizedSku = normalizeSku(sku);
    return !CONFIRMED_COMBINATION_SKUS.has(normalizedSku)
      && (isCustomerCustomSku(normalizedSku) || isEightBySevenCustomItem(...descriptors));
  }

  function customerCustomExclusionReason(value, ...descriptors) {
    const sku = normalizeSku(value);
    return CONFIRMED_COMBINATION_SKUS.has(sku)
      ? "組合品號且掛(S)，不採購組合成品"
      : isEightBySevenCustomItem(...descriptors)
        ? "8×7尺客製尺寸，不列一般採購與寄庫"
      : "一次性客製品號，不列一般採購與寄庫";
  }

  const PROCUREMENT_POLICY = Object.freeze({
    reviewDays: 14,
    supplyProfiles: Object.freeze({
      puyouma: Object.freeze({
        key: "puyouma",
        label: "寄倉快速補貨",
        leadDays: 5,
        safetyBufferDays: Object.freeze({ "熱銷": 7, "穩定": 4, "低銷": 0 })
      }),
      shortLead: Object.freeze({
        key: "shortLead",
        label: "短交期製作",
        leadDays: 14,
        safetyBufferDays: Object.freeze({ "熱銷": 7, "穩定": 0, "低銷": 0 })
      }),
      default: Object.freeze({
        key: "default",
        label: "標準交期（待確認）",
        leadDays: 14,
        safetyBufferDays: Object.freeze({ "熱銷": 7, "穩定": 0, "低銷": 0 })
      })
    }),
    storeSafetyDays: Object.freeze({ "熱銷": "7～10天", "穩定": "5～7天", "低銷": "0或1件" }),
    puyoumaFactoryLeadDays: 45,
    puyoumaFactoryTargetDays: Object.freeze({ "熱銷": 120, "穩定": 105, "低銷": 90 }),
    lirongPullLeadDays: 5,
    lirongProductionDays: 14,
    lirongDeliveryAfterProductionDays: 5,
    lirongFactoryTargetDays: Object.freeze({ "熱銷": 90, "穩定": 60, "低銷": 60 }),
    abcThresholds: Object.freeze({ A: 0.7, B: 0.9 }),
    xyzThresholds: Object.freeze({ XActiveWeeks: 8, XCv: 0.75, YActiveWeeks: 4, YCv: 1.25 })
  });

  const SUPPLIER_RULES = Object.freeze([
    { name: "家禾", country: "國內", leadDays: 40, reviewDays: 14 },
    { name: "上林", country: "國內", leadDays: 5, reviewDays: 28 },
    { name: "力榮", country: "國內", leadDays: 14, reviewDays: 14 },
    { name: "普優瑪寢具有限公司", aliases: ["普優瑪", "普悠碼"], country: "國內", leadDays: 5, reviewDays: 14 },
    { name: "歐必斯", country: "國內", leadDays: 10, reviewDays: 0, automaticPurchase: false, exclusionReason: "接單後採購／客訂型供應商" },
    { name: "昭元棉業", country: "國內", leadDays: 50, reviewDays: 90 },
    { name: "尚美", country: "國內", leadDays: 7, reviewDays: 60 },
    { name: "超越嗅覺", aliases: ["超越嗅覺行銷有限公司"], country: "國內", leadDays: 40, reviewDays: 60 },
    { name: "凱信達", country: "國外", leadDays: 70, reviewDays: 0, automaticPurchase: false, exclusionReason: "一次性採購供應商" },
    { name: "寧波同一", country: "國外", leadDays: 70, reviewDays: "90-120" },
    { name: "潤泰羽絨", country: "國外", leadDays: 70, reviewDays: "90-120" },
    { name: "泰能脊康", aliases: ["深圳市泰能脊康科技有限公司"], country: "國外", leadDays: 70, reviewDays: "90-120" },
    { name: "逸寐", country: "國外", leadDays: 70, reviewDays: "90-120" },
    { name: "特娜鞋業", aliases: ["特娜鞋业"], country: "國外", leadDays: 30, reviewDays: 120 },
    { name: "南通（小霞）包裝", aliases: ["南通(小霞)包裝", "南通小霞包裝", "南通泰而逸纺织品有限公司"], country: "國外", leadDays: 30, reviewDays: 0 },
    { name: "禾鑫匠月", aliases: ["禾鑫匠月織麥"], country: "國外", leadDays: 14, reviewDays: 0 }
  ]);
  const DEFAULT_SPRING_FESTIVAL_RULE = Object.freeze({
    enabled: true,
    closureStart: "2027-01-16",
    recoveryDate: "2027-02-28",
    extraDays: 53
  });
  const PRIMARY_SUPPLIERS = Object.freeze(["普優瑪寢具有限公司", "力榮", "上林", "潤泰羽絨", "泰能脊康"]);

  const SCHEMAS = {
    master: {
      fields: {
        sku: ["貨號", "ERP品號", "商品編號", "品號", "sku"],
        name: ["品名", "商品名稱", "商品品名"],
        supplierSku: ["供應商貨號", "廠商貨號", "產品編號"],
        supplier: ["供應商簡稱", "供應商名稱", "供應商", "廠商名稱"],
        unitCost: ["進貨價", "採購價", "標準成本", "成本"],
        moq: ["MOQ", "最低採購量", "最小訂購量", "最小配貨數", "箱入數"],
        sizeGroup: ["尺碼組"],
        size: ["尺碼"],
        mainCategory: ["主類別"],
        style1: ["1級款式"],
        style2: ["2級款式"],
        season: ["季節"],
        stockType: ["存貨種類"],
        productStatus: ["貨品狀態", "商品狀態"],
        discontinued: ["已下架"],
        listedDate: ["開賣日期", "上市日期"]
      },
      required: ["sku", "name"]
    },
    inventory: {
      fields: {
        sku: ["貨號", "ERP品號", "商品編號", "品號", "sku"],
        name: ["品名", "商品名稱", "商品品名"],
        warehouseCode: ["店倉編號", "倉別編號", "倉庫編號"],
        warehouseName: ["店倉名稱", "倉別名稱", "倉庫名稱"],
        quantity: ["實際庫存", "可用庫存", "庫存數量", "現有庫存"],
        inventoryCost: ["實際庫存成本額", "庫存成本額", "庫存成本", "成本額"]
      },
      required: ["sku", "quantity"]
    },
    pending: {
      fields: {
        documentCode: ["採購單編碼", "單據編碼", "採購單號", "單據號"],
        status: ["狀態", "單據狀態"],
        supplier: ["廠商名稱", "供應商名稱", "供應商", "廠商"],
        sku: ["貨號", "ERP品號", "商品編號", "品號", "sku"],
        name: ["品名", "商品名稱", "商品品名"],
        orderedQuantity: ["採購數量", "訂購數量", "數量"],
        deliveredQuantity: ["交貨數量", "已交數量", "已到貨數量", "收貨數量"],
        remainingQuantity: ["未交數量", "待交數量", "未到貨數量"],
        unitCost: ["採購價", "進貨價", "未稅進貨價", "單價"],
        amount: ["採購額", "金額", "採購金額", "未稅金額", "合計"],
        remark: ["備註", "明細備註"],
        purchaseDate: ["採購日期", "開單日期", "建立日期"],
        expectedDeliveryDate: ["預計交貨時間", "預計交貨日期", "預計到貨日期", "交期"],
        receiptDate: ["收貨單開單日", "實際交貨日期", "到貨日期", "收貨日期", "全都到貨日期"],
        fullyReceived: ["已全部到貨", "全部到貨"],
        documentClosed: ["單據是否關閉", "單據已關閉", "已關閉", "結案"]
      },
      required: ["sku", "orderedQuantity"]
    },
    transfer: {
      fields: {
        documentCode: ["單據編碼", "調撥單號", "單據號"],
        status: ["狀態", "單據狀態"],
        sourceWarehouseCode: ["調出倉庫編號", "調出倉編號", "調出倉庫代碼"],
        sourceWarehouseName: ["調出倉庫名", "調出倉庫名稱", "調出倉"],
        destinationWarehouseCode: ["調入倉庫編號", "調入倉編號", "調入倉庫代碼"],
        destinationWarehouseName: ["調入倉庫名", "調入倉庫名稱", "調入倉"],
        sku: ["貨號", "ERP品號", "品號"],
        name: ["品名", "商品名稱"],
        quantity: ["數量", "調撥數量"],
        openedDate: ["開單日期", "建立日期"],
        shippedDate: ["發貨日期"],
        receivedDate: ["收貨日期"]
      },
      required: ["documentCode", "status", "sourceWarehouseName", "destinationWarehouseName", "sku", "quantity"]
    },
    sales: {
      fields: {
        saleType: ["銷別"],
        transactionDate: ["結帳時間", "銷售日期", "日期"],
        sku: ["貨號", "ERP品號", "商品編號", "品號", "sku"],
        name: ["品名", "商品名稱", "商品品名"],
        salesQuantity: ["銷售量", "數量"],
        actualAmount: ["實收金額", "銷售金額"],
        purchaseCostAmount: ["進貨價金額", "進貨成本金額"],
        storeCostAmount: ["店成本金額"],
        registeredWarehouseCostAmount: ["登錄倉成本金額"],
        warehouseCode: ["開單倉編號", "店倉編號"],
        warehouseName: ["開單倉名稱", "店倉名稱"],
        shipWarehouseCode: ["出貨倉編號"],
        shipWarehouseName: ["出貨倉名稱"],
        deductQuantity: ["扣庫量"],
        ecommercePlatform: ["電商平台"],
        posOrder: ["POS單", "POS單號"],
        sourceOrder: ["來源單號"],
        pickupOrder: ["取貨單號"]
      },
      required: ["saleType", "transactionDate", "sku", "salesQuantity"]
    }
  };

  const FIELD_LABELS = {
    sku: "ERP品號",
    name: "品名",
    supplierSku: "供應商貨號",
    supplier: "供應商",
    unitCost: "進貨價／採購價",
    warehouseCode: "店倉編號",
    warehouseName: "店倉名稱",
    quantity: "數量",
    orderedQuantity: "採購數量",
    deliveredQuantity: "交貨數量",
    remainingQuantity: "未交數量",
    receiptDate: "實際交貨日期",
    fullyReceived: "已全部到貨",
    documentClosed: "單據已關閉",
    inventoryCost: "庫存成本",
    amount: "金額",
    remark: "備註",
    saleType: "銷別",
    transactionDate: "結帳時間",
    salesQuantity: "銷售量",
    actualAmount: "實收金額",
    purchaseCostAmount: "進貨價金額",
    storeCostAmount: "店成本金額",
    registeredWarehouseCostAmount: "登錄倉成本金額",
    shipWarehouseCode: "出貨倉編號",
    shipWarehouseName: "出貨倉名稱",
    deductQuantity: "扣庫量",
    ecommercePlatform: "電商平台",
    documentCode: "單據編碼",
    status: "狀態",
    sourceWarehouseName: "調出倉庫名",
    destinationWarehouseName: "調入倉庫名"
  };

  function normalizeText(value) {
    return String(value == null ? "" : value).normalize("NFKC").trim().toLocaleLowerCase("zh-Hant");
  }

  function normalizeHeader(value) {
    return normalizeText(value).replace(/[\s\-_–—／/＆&()（）【】\[\]：:．.*\n\r]/g, "");
  }

  function normalizeSku(value) {
    return String(value == null ? "" : value).normalize("NFKC").trim().toUpperCase();
  }

  const KUANCHENG_STORE_CODES = new Set(["R00", "R01"]);
  const KUANMU_STORE_CODES = new Set(["R03", "R06", "R07", "R09", "R10"]);

  function warehouseCompany(code, name = "") {
    const normalizedCode = normalizeSku(code);
    if (KUANCHENG_STORE_CODES.has(normalizedCode) || normalizedCode === "T00") return "寬承";
    if (KUANMU_STORE_CODES.has(normalizedCode)) return "寬沐";
    if (/^R\d{2}$/.test(normalizedCode)) return "寬沐";
    return /門市|快閃|專櫃/.test(String(name || "")) ? "寬沐" : "寬承";
  }

  function normalizeName(value) {
    return normalizeText(value).replace(/[\s\-_–—／/＆&()（）【】\[\]：:．.,，。'’"“”]/g, "");
  }

  function isSellThroughStopName(value) {
    return /\(\s*S\s*\)\s*$/i.test(String(value == null ? "" : value).normalize("NFKC"));
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

  function scoreHeader(header, aliases) {
    const normalized = normalizeHeader(header);
    if (!normalized) return 0;
    let best = 0;
    for (const alias of aliases) {
      const target = normalizeHeader(alias);
      if (normalized === target) best = Math.max(best, 100);
      else if (normalized.includes(target)) best = Math.max(best, 70);
      else if (normalized.length >= 2 && target.includes(normalized)) best = Math.max(best, 60);
    }
    return best;
  }

  function autoMapHeaders(headers, schemaName) {
    const schema = SCHEMAS[schemaName];
    const mapping = {};
    const used = new Set();
    for (const [field, aliases] of Object.entries(schema.fields)) {
      let bestIndex = -1;
      let bestScore = 0;
      headers.forEach((header, index) => {
        if (used.has(index)) return;
        const score = scoreHeader(header, aliases);
        if (score > bestScore) {
          bestIndex = index;
          bestScore = score;
        }
      });
      mapping[field] = bestScore >= 60 ? bestIndex : null;
      if (mapping[field] != null) used.add(mapping[field]);
    }
    return mapping;
  }

  function validateMapping(schemaName, mapping) {
    const missing = SCHEMAS[schemaName].required
      .filter((field) => mapping[field] == null)
      .map((field) => FIELD_LABELS[field] || field);
    return { valid: missing.length === 0, missing };
  }

  function headerScore(row, schemaName) {
    if (!Array.isArray(row)) return 0;
    return Object.values(SCHEMAS[schemaName].fields).reduce((total, aliases) => (
      total + (row.some((value) => scoreHeader(value, aliases) >= 60) ? 1 : 0)
    ), 0);
  }

  function inspectWorkbook(workbook, XLSX, schemaName) {
    const sheets = workbook.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: "" });
      let headerRowIndex = 0;
      let bestScore = -1;
      rows.slice(0, 35).forEach((row, index) => {
        const score = headerScore(row, schemaName);
        if (score > bestScore) {
          headerRowIndex = index;
          bestScore = score;
        }
      });
      const headers = (rows[headerRowIndex] || []).map((value, index) => String(value || `欄位${index + 1}`).trim());
      const mapping = autoMapHeaders(headers, schemaName);
      return {
        name,
        rows,
        headers,
        mapping,
        headerRowIndex,
        score: bestScore,
        validation: validateMapping(schemaName, mapping)
      };
    });
    sheets.sort((left, right) => {
      const preferredLeft = schemaName === "inventory" && left.name === "乾淨商品" ? 1 : 0;
      const preferredRight = schemaName === "inventory" && right.name === "乾淨商品" ? 1 : 0;
      return preferredRight - preferredLeft
        || Number(right.validation.valid) - Number(left.validation.valid)
        || right.score - left.score;
    });
    return { schemaName, sheets };
  }

  function valueAt(row, mapping, field) {
    const index = mapping[field];
    return index == null ? "" : row[index];
  }

  function selectSheet(workbook, XLSX, schemaName) {
    const inspection = inspectWorkbook(workbook, XLSX, schemaName);
    const selected = inspection.sheets[0];
    if (!selected || !selected.validation.valid) {
      const sourceLabel = ({ master: "商品主檔", inventory: "庫存檔", pending: "採購單（全部狀態）", transfer: "期間調撥單", sales: "銷售明細" })[schemaName] || schemaName;
      throw new Error(`${sourceLabel}缺少：${selected?.validation.missing.join("、") || "可讀取的工作表"}`);
    }
    return selected;
  }

  function parseProductMasterWorkbook(workbook, XLSX, options = {}) {
    const selected = selectSheet(workbook, XLSX, "master");
    const listedDateIndex = selected.headers.findIndex((header) => normalizeHeader(header) === normalizeHeader("開賣日期"));
    const records = [];
    const bySku = new Map();
    const bySupplierSku = new Map();
    const byExactName = new Map();
    for (let index = selected.headerRowIndex + 1; index < selected.rows.length; index += 1) {
      const row = selected.rows[index];
      const sku = normalizeSku(valueAt(row, selected.mapping, "sku"));
      const name = String(valueAt(row, selected.mapping, "name") || "").trim();
      if (!sku || !name) continue;
      const sellThroughStop = isSellThroughStopName(name);
      const masterDiscontinued = !["", "否", "0", "false"].includes(normalizeText(valueAt(row, selected.mapping, "discontinued")));
      const record = {
        sourceRow: index + 1,
        sku,
        name,
        supplierSku: normalizeSku(valueAt(row, selected.mapping, "supplierSku")),
        supplier: String(valueAt(row, selected.mapping, "supplier") || "").trim(),
        unitCost: parseNumber(valueAt(row, selected.mapping, "unitCost")),
        moq: parseNumber(valueAt(row, selected.mapping, "moq")),
        sizeGroup: String(valueAt(row, selected.mapping, "sizeGroup") || "").trim(),
        size: String(valueAt(row, selected.mapping, "size") || "").trim(),
        mainCategory: String(valueAt(row, selected.mapping, "mainCategory") || "").trim(),
        style1: String(valueAt(row, selected.mapping, "style1") || "").trim(),
        style2: String(valueAt(row, selected.mapping, "style2") || "").trim(),
        season: String(valueAt(row, selected.mapping, "season") || "").trim(),
        stockType: String(valueAt(row, selected.mapping, "stockType") || "").trim(),
        productStatus: String(valueAt(row, selected.mapping, "productStatus") || "").trim(),
        sellThroughStop,
        externalPurchaseBlocked: masterDiscontinued || sellThroughStop,
        discontinued: masterDiscontinued,
        discontinuedReason: sellThroughStop
          ? "品名含停採標記(S)：已斷貨、售完即停"
          : (masterDiscontinued ? "商品主檔標示已下架" : ""),
        listedDate: String((listedDateIndex >= 0 ? row[listedDateIndex] : valueAt(row, selected.mapping, "listedDate")) || "").trim()
      };
      records.push(record);
      if (!bySku.has(sku)) bySku.set(sku, record);
      if (record.supplierSku) {
        if (!bySupplierSku.has(record.supplierSku)) bySupplierSku.set(record.supplierSku, []);
        bySupplierSku.get(record.supplierSku).push(record);
      }
      const nameKey = normalizeName(name);
      if (nameKey) {
        if (!byExactName.has(nameKey)) byExactName.set(nameKey, []);
        byExactName.get(nameKey).push(record);
      }
    }
    return {
      fileName: options.fileName || "",
      sheetName: selected.name,
      records,
      bySku,
      bySupplierSku,
      byExactName
    };
  }

  function parseInventoryWorkbook(workbook, XLSX, options = {}) {
    const selected = selectSheet(workbook, XLSX, "inventory");
    const records = [];
    const bySku = new Map();
    for (let index = selected.headerRowIndex + 1; index < selected.rows.length; index += 1) {
      const row = selected.rows[index];
      const sku = normalizeSku(valueAt(row, selected.mapping, "sku"));
      const quantity = parseNumber(valueAt(row, selected.mapping, "quantity"));
      if (!sku || quantity == null) continue;
      const record = {
        sourceRow: index + 1,
        sku,
        name: String(valueAt(row, selected.mapping, "name") || "").trim(),
        warehouseCode: normalizeSku(valueAt(row, selected.mapping, "warehouseCode")),
        warehouseName: String(valueAt(row, selected.mapping, "warehouseName") || "").trim(),
        quantity,
        inventoryCost: parseNumber(valueAt(row, selected.mapping, "inventoryCost")) || 0
      };
      record.procurementAvailable = !/^O0[0-6]$/.test(record.warehouseCode);
      records.push(record);
      if (!bySku.has(sku)) {
        bySku.set(sku, {
          sku,
          name: record.name,
          quantity: 0,
          availableQuantity: 0,
          excludedQuantity: 0,
          inventoryCost: 0,
          warehouses: new Set(),
          sourceRows: []
        });
      }
      const aggregated = bySku.get(sku);
      aggregated.quantity += record.quantity;
      if (record.procurementAvailable) aggregated.availableQuantity += record.quantity;
      else aggregated.excludedQuantity += record.quantity;
      aggregated.inventoryCost += record.inventoryCost;
      aggregated.sourceRows.push(record.sourceRow);
      if (record.warehouseCode || record.warehouseName) {
        aggregated.warehouses.add(`${record.warehouseCode} ${record.warehouseName}`.trim());
      }
    }
    return { fileName: options.fileName || "", sheetName: selected.name, records, bySku };
  }

  function findLabelValue(rows, label) {
    const target = normalizeHeader(label);
    for (const row of rows.slice(0, 20)) {
      for (let index = 0; index < row.length; index += 1) {
        if (normalizeHeader(row[index]) !== target) continue;
        for (let next = index + 1; next < row.length; next += 1) {
          if (row[next] !== "" && row[next] != null) return String(row[next]).trim();
        }
      }
    }
    return "";
  }

  function parsePendingPurchaseWorkbook(workbook, XLSX, options = {}) {
    const selected = selectSheet(workbook, XLSX, "pending");
    const headerRows = selected.rows.slice(0, selected.headerRowIndex);
    const metadata = {
      documentCode: findLabelValue(headerRows, "單據編碼"),
      purchaseDate: findLabelValue(headerRows, "採購日期"),
      deliveryDate: findLabelValue(headerRows, "交貨日期"),
      supplier: findLabelValue(headerRows, "廠商名稱"),
      remark: findLabelValue(headerRows, "備註")
    };
    const hasLifecycleColumns = ["status", "deliveredQuantity", "remainingQuantity", "receiptDate", "fullyReceived", "documentClosed"]
      .some((field) => selected.mapping[field] != null);
    const isAffirmative = (value) => /^(?:是|有|true|yes|y|1|已關閉|已完成|完成)$/i.test(String(value == null ? "" : value).normalize("NFKC").trim());
    const records = [];
    for (let index = selected.headerRowIndex + 1; index < selected.rows.length; index += 1) {
      const row = selected.rows[index];
      const sku = normalizeSku(valueAt(row, selected.mapping, "sku"));
      const orderedQuantity = parseNumber(valueAt(row, selected.mapping, "orderedQuantity"));
      if (!sku || orderedQuantity == null) continue;
      const deliveredQuantity = Math.max(0, Number(parseNumber(valueAt(row, selected.mapping, "deliveredQuantity")) || 0));
      const remainingCell = parseNumber(valueAt(row, selected.mapping, "remainingQuantity"));
      const status = String(valueAt(row, selected.mapping, "status") || "").normalize("NFKC").trim();
      const statusKey = normalizeText(status);
      const documentClosed = isAffirmative(valueAt(row, selected.mapping, "documentClosed"));
      const fullyReceived = isAffirmative(valueAt(row, selected.mapping, "fullyReceived")) || /(?:已)?全部到貨|全數到貨/.test(statusKey);
      const draft = /^(?:新單|草稿|暫存)$/.test(statusKey);
      const rawRemainingQuantity = remainingCell == null ? Number(orderedQuantity || 0) - deliveredQuantity : remainingCell;
      const quantity = hasLifecycleColumns
        ? ((draft || documentClosed || fullyReceived) ? 0 : Math.max(0, rawRemainingQuantity))
        : Math.max(0, Number(orderedQuantity || 0));
      if (quantity === 0 && deliveredQuantity === 0 && Number(orderedQuantity || 0) === 0) continue;
      const unitCost = parseNumber(valueAt(row, selected.mapping, "unitCost"));
      const orderedAmount = parseNumber(valueAt(row, selected.mapping, "amount"));
      let amount = unitCost != null ? quantity * unitCost : null;
      if (amount == null && orderedAmount != null && orderedQuantity) amount = orderedAmount * quantity / orderedQuantity;
      const remark = String(valueAt(row, selected.mapping, "remark") || "").trim();
      const name = String(valueAt(row, selected.mapping, "name") || "").trim();
      const customText = `${metadata.remark} ${remark}`.trim();
      const automaticProcurementExcluded = isAutomaticProcurementExcludedItem(sku, name);
      const isCustomOrder = /客製/.test(customText) || isCustomerCustomItem(sku, name);
      const receiptDate = parseDateValue(valueAt(row, selected.mapping, "receiptDate"));
      const expectedDeliveryDate = parseDateValue(valueAt(row, selected.mapping, "expectedDeliveryDate")) || parseDateValue(metadata.deliveryDate);
      records.push({
        sourceRow: index + 1,
        documentCode: String(valueAt(row, selected.mapping, "documentCode") || metadata.documentCode || "").trim(),
        supplier: String(valueAt(row, selected.mapping, "supplier") || metadata.supplier || "").trim(),
        status,
        sku,
        name,
        quantity,
        orderedQuantity: Math.max(0, Number(orderedQuantity || 0)),
        deliveredQuantity,
        remainingQuantity: Math.max(0, rawRemainingQuantity),
        unitCost,
        amount: amount || 0,
        orderedAmount: orderedAmount == null ? (unitCost == null ? 0 : Number(orderedQuantity || 0) * unitCost) : orderedAmount,
        actualReceiptCost: unitCost == null ? 0 : deliveredQuantity * unitCost,
        purchaseDate: parseDateValue(valueAt(row, selected.mapping, "purchaseDate")) || parseDateValue(metadata.purchaseDate),
        expectedDeliveryDate,
        receiptDate,
        draft,
        fullyReceived,
        documentClosed,
        hasLifecycleColumns,
        remark,
        isCustomOrder,
        automaticProcurementExcluded,
        customChannel: /客製/.test(customText) ? (remark || metadata.remark).replace(/客製/g, "").trim() : "",
        fileName: options.fileName || ""
      });
    }
    return {
      fileName: options.fileName || "",
      sheetName: selected.name,
      records,
      metadata: { ...metadata, hasLifecycleColumns, isCustomOrder: records.some((row) => row.isCustomOrder) }
    };
  }

  const ERP_TRANSFER_WAREHOUSES = Object.freeze([
    ["T00", ["寬承總倉", "總倉"]],
    ["R00", ["翔仔居家-台北中山門市", "台北中山門市"]],
    ["R01", ["翔仔居家-台中北屯門市", "台中北屯門市"]],
    ["R03", ["翔仔居家-新竹東區門市", "新竹東區門市"]],
    ["R06", ["翔仔居家-台中文心秀泰專櫃", "文心秀泰門市", "台中文心秀泰專櫃"]],
    ["R07", ["翔仔居家-台中誠品480專櫃", "誠品480門市", "台中誠品480專櫃"]],
    ["R10", ["翔仔居家-新莊門市", "新莊門市"]],
    ["R09", ["翔仔居家-高雄夢時代專櫃", "高雄夢時代專櫃"]]
  ]);

  function transferWarehouseCode(code, name) {
    const normalizedCode = normalizeSku(code);
    if (/^(?:T|R|W)\d{2}$/.test(normalizedCode)) return normalizedCode;
    const normalizedName = normalizeName(name);
    for (const [warehouseCode, aliases] of ERP_TRANSFER_WAREHOUSES) {
      if (aliases.some((alias) => normalizeName(alias) === normalizedName)) return warehouseCode;
    }
    return "";
  }

  function otherTransferWarehouseCode(code, name) {
    const identity = normalizeSku(code) || normalizeName(name) || "UNKNOWN";
    return `OTHER:${identity}`;
  }

  function parseTransferWorkbook(workbook, XLSX, options = {}) {
    const selected = selectSheet(workbook, XLSX, "transfer");
    const records = [];
    const errors = [];
    const ignoredRows = [];
    const allowedStatuses = new Set(["提交", "發貨審核", "收貨審核"]);
    for (let index = selected.headerRowIndex + 1; index < selected.rows.length; index += 1) {
      const row = selected.rows[index];
      const documentCode = String(valueAt(row, selected.mapping, "documentCode") || "").trim();
      const status = String(valueAt(row, selected.mapping, "status") || "").trim();
      const sku = normalizeSku(valueAt(row, selected.mapping, "sku"));
      const quantity = parseNumber(valueAt(row, selected.mapping, "quantity"));
      if (!documentCode && !status && !sku) continue;
      if (!documentCode || !status || !sku || quantity == null || quantity <= 0) {
        errors.push({ sourceRow: index + 1, message: "單據編碼、狀態、ERP品號或正數數量不完整。" });
        continue;
      }
      if (!allowedStatuses.has(status)) {
        errors.push({ sourceRow: index + 1, documentCode, sku, message: `不支援的調撥狀態：${status}` });
        continue;
      }
      const sourceWarehouseName = String(valueAt(row, selected.mapping, "sourceWarehouseName") || "").trim();
      const destinationWarehouseName = String(valueAt(row, selected.mapping, "destinationWarehouseName") || "").trim();
      const sourceWarehouseRawCode = valueAt(row, selected.mapping, "sourceWarehouseCode");
      const destinationWarehouseRawCode = valueAt(row, selected.mapping, "destinationWarehouseCode");
      if ((!sourceWarehouseName && !normalizeSku(sourceWarehouseRawCode)) || (!destinationWarehouseName && !normalizeSku(destinationWarehouseRawCode))) {
        errors.push({ sourceRow: index + 1, documentCode, sku, message: "調出倉或調入倉資料不完整。" });
        continue;
      }
      const managedSourceWarehouseCode = transferWarehouseCode(sourceWarehouseRawCode, sourceWarehouseName);
      const managedDestinationWarehouseCode = transferWarehouseCode(destinationWarehouseRawCode, destinationWarehouseName);
      if (!managedSourceWarehouseCode && !managedDestinationWarehouseCode) {
        ignoredRows.push({
          sourceRow: index + 1,
          documentCode,
          sku,
          status,
          sourceWarehouseName,
          destinationWarehouseName,
          message: `與總倉及既有門市無關：${sourceWarehouseName} → ${destinationWarehouseName}`
        });
        continue;
      }
      const sourceWarehouseCode = managedSourceWarehouseCode || otherTransferWarehouseCode(sourceWarehouseRawCode, sourceWarehouseName);
      const destinationWarehouseCode = managedDestinationWarehouseCode || otherTransferWarehouseCode(destinationWarehouseRawCode, destinationWarehouseName);
      records.push({
        sourceRow: index + 1,
        fileName: options.fileName || "",
        documentCode,
        status,
        sourceWarehouseCode,
        sourceWarehouseName,
        sourceWarehouseManaged: Boolean(managedSourceWarehouseCode),
        destinationWarehouseCode,
        destinationWarehouseName,
        destinationWarehouseManaged: Boolean(managedDestinationWarehouseCode),
        sku,
        name: String(valueAt(row, selected.mapping, "name") || "").trim(),
        quantity,
        openedDate: parseDateValue(valueAt(row, selected.mapping, "openedDate")),
        shippedDate: parseDateValue(valueAt(row, selected.mapping, "shippedDate")),
        receivedDate: parseDateValue(valueAt(row, selected.mapping, "receivedDate"))
      });
    }
    if (!records.length) throw new Error(errors[0]?.message || "期間調撥單沒有可辨識的明細。");
    if (errors.length) {
      const preview = errors.slice(0, 3).map((error) => `第${error.sourceRow}列：${error.message}`).join("；");
      throw new Error(`期間調撥單有${errors.length}筆無法安全判斷：${preview}`);
    }
    return { fileName: options.fileName || "", sheetName: selected.name, records, errors, ignoredRows };
  }

  function parseNewProductWorkbook(workbook, XLSX, options = {}) {
    const aliases = {
      sku: ["ERP品號", "貨號", "品號"],
      listedDate: ["預計／實際上市日", "預計上市日", "實際上市日", "上市日期", "上架日"],
      channels: ["預計販售通路或門市", "預計通路或門市", "販售通路", "通路", "門市"],
      firstMonthQty: ["首月預估量", "首批預估量", "首月數量", "預估數量", "數量"],
      similarSku: ["相似品號", "相似ERP品號"],
      marketingIncluded: ["是否已納入行銷預估", "納入行銷預估"],
      remark: ["備註", "人工備註"]
    };
    const normalizedAliases = Object.fromEntries(Object.entries(aliases).map(([key, values]) => [key, values.map(normalizeHeader)]));
    let selected = null;
    for (const name of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: "" });
      for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
        const headers = rows[index].map(normalizeHeader);
        const mapping = {};
        for (const [key, values] of Object.entries(normalizedAliases)) mapping[key] = headers.findIndex((header) => values.includes(header));
        if (mapping.sku >= 0 && mapping.listedDate >= 0 && mapping.channels >= 0 && mapping.firstMonthQty >= 0) {
          selected = { name, rows, headerRowIndex: index, mapping };
          break;
        }
      }
      if (selected) break;
    }
    if (!selected) throw new Error("新品首批名單缺少ERP品號、預計／實際上市日、預計販售通路或門市或首月預估量。");
    const records = [];
    const errors = [];
    const seen = new Set();
    for (let index = selected.headerRowIndex + 1; index < selected.rows.length; index += 1) {
      const row = selected.rows[index];
      const read = (key) => selected.mapping[key] >= 0 ? row[selected.mapping[key]] : "";
      const sku = normalizeSku(read("sku"));
      if (!sku) continue;
      const listedDate = parseDateValue(read("listedDate"));
      const channels = String(read("channels") || "").trim();
      const firstMonthQty = parseNumber(read("firstMonthQty"));
      if (seen.has(sku)) errors.push({ sourceRow: index + 1, sku, message: "新品名單ERP品號重複。" });
      seen.add(sku);
      if (!listedDate) errors.push({ sourceRow: index + 1, sku, message: "上市日格式錯誤。" });
      if (!channels) errors.push({ sourceRow: index + 1, sku, message: "預計販售通路或門市不可空白。" });
      if (firstMonthQty == null || firstMonthQty < 0 || !Number.isInteger(firstMonthQty)) errors.push({ sourceRow: index + 1, sku, message: "首月預估量須為0或正整數。" });
      records.push({ sourceRow: index + 1, sku, listedDate, channels, firstMonthQty: Math.max(0, Number(firstMonthQty || 0)), similarSku: normalizeSku(read("similarSku")), marketingIncluded: String(read("marketingIncluded") || "").trim(), remark: String(read("remark") || "").trim() });
    }
    if (!records.length) throw new Error("新品首批名單沒有可辨識的ERP品號。");
    return { fileName: options.fileName || "", sheetName: selected.name, records, errors };
  }

  function parseDateValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === "number" && Number.isFinite(value)) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const date = new Date(epoch.getTime() + Math.round(value * 86400000));
      return date.toISOString().slice(0, 10);
    }
    const text = String(value || "").trim();
    if (!text) return "";
    const match = text.match(/(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)/);
    if (!match) return "";
    const normalized = `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
    const date = new Date(`${normalized}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? "" : normalized;
  }

  function parseSalesWorkbook(workbook, XLSX, options = {}) {
    const selected = selectSheet(workbook, XLSX, "sales");
    const records = [];
    const takeRecords = [];
    const excluded = { "排除銷別：取貨": 0, "排除非需求銷別": 0, "缺品號或日期": 0 };
    let minDate = "";
    let maxDate = "";
    for (let index = selected.headerRowIndex + 1; index < selected.rows.length; index += 1) {
      const row = selected.rows[index];
      const saleType = String(valueAt(row, selected.mapping, "saleType") || "").trim();
      if (saleType === "取貨") {
        excluded["排除銷別：取貨"] += 1;
        const sku = normalizeSku(valueAt(row, selected.mapping, "sku"));
        const transactionValue = valueAt(row, selected.mapping, "transactionDate");
        const date = parseDateValue(transactionValue);
        if (sku && date) {
          takeRecords.push({
            sourceRow: index + 1,
            fileName: options.fileName || "",
            saleType,
            date,
            sku,
            name: String(valueAt(row, selected.mapping, "name") || "").trim(),
            quantity: parseNumber(valueAt(row, selected.mapping, "salesQuantity")) || 0,
            warehouseCode: normalizeSku(valueAt(row, selected.mapping, "warehouseCode")),
            warehouseName: String(valueAt(row, selected.mapping, "warehouseName") || "").trim(),
            shipWarehouseCode: normalizeSku(valueAt(row, selected.mapping, "shipWarehouseCode")),
            shipWarehouseName: String(valueAt(row, selected.mapping, "shipWarehouseName") || "").trim(),
            deductQuantity: parseNumber(valueAt(row, selected.mapping, "deductQuantity")) || 0,
            actualAmount: parseNumber(valueAt(row, selected.mapping, "actualAmount")) || 0,
            purchaseCostAmount: parseNumber(valueAt(row, selected.mapping, "purchaseCostAmount")) || 0,
            storeCostAmount: parseNumber(valueAt(row, selected.mapping, "storeCostAmount")) || 0,
            registeredWarehouseCostAmount: parseNumber(valueAt(row, selected.mapping, "registeredWarehouseCostAmount")) || 0,
            sourceOrder: String(valueAt(row, selected.mapping, "sourceOrder") || "").trim(),
            pickupOrder: String(valueAt(row, selected.mapping, "pickupOrder") || "").trim()
          });
        }
        continue;
      }
      if (!DEMAND_SALE_TYPES.includes(saleType)) {
        excluded["排除非需求銷別"] += 1;
        continue;
      }
      const sku = normalizeSku(valueAt(row, selected.mapping, "sku"));
      const transactionValue = valueAt(row, selected.mapping, "transactionDate");
      const date = parseDateValue(transactionValue);
      const quantity = parseNumber(valueAt(row, selected.mapping, "salesQuantity"));
      if (!sku || !date || quantity == null) {
        excluded["缺品號或日期"] += 1;
        continue;
      }
      const record = {
        sourceRow: index + 1,
        fileName: options.fileName || "",
        saleType,
        date,
        transactionTimestamp: transactionValue instanceof Date
          ? transactionValue.toISOString()
          : String(transactionValue || "").trim(),
        sku,
        name: String(valueAt(row, selected.mapping, "name") || "").trim(),
        quantity,
        actualAmount: parseNumber(valueAt(row, selected.mapping, "actualAmount")) || 0,
        purchaseCostAmount: parseNumber(valueAt(row, selected.mapping, "purchaseCostAmount")) || 0,
        storeCostAmount: parseNumber(valueAt(row, selected.mapping, "storeCostAmount")) || 0,
        registeredWarehouseCostAmount: parseNumber(valueAt(row, selected.mapping, "registeredWarehouseCostAmount")) || 0,
        warehouseCode: normalizeSku(valueAt(row, selected.mapping, "warehouseCode")),
        warehouseName: String(valueAt(row, selected.mapping, "warehouseName") || "").trim(),
        shipWarehouseCode: normalizeSku(valueAt(row, selected.mapping, "shipWarehouseCode")),
        shipWarehouseName: String(valueAt(row, selected.mapping, "shipWarehouseName") || "").trim(),
        deductQuantity: parseNumber(valueAt(row, selected.mapping, "deductQuantity")) || 0,
        ecommercePlatform: String(valueAt(row, selected.mapping, "ecommercePlatform") || "").trim(),
        posOrder: String(valueAt(row, selected.mapping, "posOrder") || "").trim(),
        sourceOrder: String(valueAt(row, selected.mapping, "sourceOrder") || "").trim(),
        pickupOrder: String(valueAt(row, selected.mapping, "pickupOrder") || "").trim()
      };
      records.push(record);
      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;
    }
    return { fileName: options.fileName || "", sheetName: selected.name, records, takeRecords, excluded, minDate, maxDate };
  }

  function findHeaderTable(workbook, XLSX, sheetNames, requiredHeaders) {
    const candidateName = sheetNames.find((name) => workbook.SheetNames.includes(name));
    if (!candidateName) return null;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[candidateName], { header: 1, raw: true, defval: "" });
    let headerRowIndex = -1;
    for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
      const normalized = rows[index].map(normalizeHeader);
      if (requiredHeaders.every((header) => normalized.includes(normalizeHeader(header)))) {
        headerRowIndex = index;
        break;
      }
    }
    if (headerRowIndex < 0) return null;
    const headers = rows[headerRowIndex].map((value) => String(value || "").trim());
    const indexByHeader = new Map(headers.map((header, index) => [normalizeHeader(header), index]));
    return { sheetName: candidateName, rows, headerRowIndex, headers, indexByHeader };
  }

  function tableCell(table, row, aliases) {
    for (const alias of aliases) {
      const index = table.indexByHeader.get(normalizeHeader(alias));
      if (index != null) return row[index];
    }
    return "";
  }

  function parseForecastModelWorkbook(workbook, XLSX, options = {}) {
    const skuTable = findHeaderTable(workbook, XLSX, ["SKU模型建議"], ["ERP品號", "品名"]);
    if (!skuTable) throw new Error("季節模型回測檔缺少「SKU模型建議」頁籤或必要欄位。");
    const bySku = new Map();
    for (let index = skuTable.headerRowIndex + 1; index < skuTable.rows.length; index += 1) {
      const row = skuTable.rows[index];
      const sku = normalizeSku(tableCell(skuTable, row, ["ERP品號"]));
      if (!sku) continue;
      bySku.set(sku, {
        sku,
        name: String(tableCell(skuTable, row, ["品名"]) || "").trim(),
        supplier: String(tableCell(skuTable, row, ["供應商"]) || "").trim(),
        skuModel: String(tableCell(skuTable, row, ["SKU建議模型", "建議模型"]) || "近期6週").trim(),
        skuWape: parseNumber(tableCell(skuTable, row, ["SKU最佳WAPE", "最佳WAPE"])),
        materialCategory: String(tableCell(skuTable, row, ["材質類別", "商品群"]) || "其他").trim(),
        categoryLevel: String(tableCell(skuTable, row, ["輔助類別層級"]) || "材質").trim(),
        categoryName: String(tableCell(skuTable, row, ["輔助類別名稱", "材質類別", "商品群"]) || "其他").trim(),
        categoryModel: String(tableCell(skuTable, row, ["類別建議模型"]) || "").trim(),
        categoryWape: parseNumber(tableCell(skuTable, row, ["類別WAPE"])),
        categoryReliability: String(tableCell(skuTable, row, ["類別可信度"]) || "").trim(),
        season: String(tableCell(skuTable, row, ["季節"]) || "").trim()
      });
    }

    const categoryTable = findHeaderTable(workbook, XLSX, ["類別模型總覽"], ["範圍", "材質類別", "類別最佳模型"]);
    const byMaterial = new Map();
    if (categoryTable) {
      for (let index = categoryTable.headerRowIndex + 1; index < categoryTable.rows.length; index += 1) {
        const row = categoryTable.rows[index];
        const scope = String(tableCell(categoryTable, row, ["範圍"]) || "").trim();
        const material = String(tableCell(categoryTable, row, ["材質類別"]) || "").trim();
        if (!material || (scope && scope !== "普優瑪" && byMaterial.has(material))) continue;
        byMaterial.set(material, {
          material,
          scope,
          model: String(tableCell(categoryTable, row, ["類別最佳模型"]) || "近期6週").trim(),
          wape: parseNumber(tableCell(categoryTable, row, ["類別WAPE"])),
          reliability: String(tableCell(categoryTable, row, ["可信度"]) || "").trim()
        });
      }
    }

    const periodTable = findHeaderTable(workbook, XLSX, ["類別期間回測"], ["範圍", "類別名稱", "期間起日", "模型", "實際量"]);
    const seasonalIndexByMaterial = new Map();
    if (periodTable) {
      const actualByMaterialYearSlot = new Map();
      for (let index = periodTable.headerRowIndex + 1; index < periodTable.rows.length; index += 1) {
        const row = periodTable.rows[index];
        const scope = String(tableCell(periodTable, row, ["範圍"]) || "").trim();
        const level = String(tableCell(periodTable, row, ["類別層級"]) || "").trim();
        const modelName = String(tableCell(periodTable, row, ["模型"]) || "").trim();
        if (scope !== "普優瑪" || (level && level !== "材質") || modelName !== "近期6週") continue;
        const material = String(tableCell(periodTable, row, ["類別名稱"]) || "").trim();
        const date = parseDateValue(tableCell(periodTable, row, ["期間起日"]));
        const actual = parseNumber(tableCell(periodTable, row, ["實際量"]));
        if (!material || !date || actual == null) continue;
        const dateObject = new Date(`${date}T00:00:00Z`);
        const year = dateObject.getUTCFullYear();
        const start = Date.UTC(year, 0, 1);
        const slot = Math.max(0, Math.min(26, Math.floor((dateObject.getTime() - start) / 86400000 / 14)));
        actualByMaterialYearSlot.set(`${material}||${year}||${slot}`, { material, year, slot, actual: Math.max(0, actual) });
      }
      const byMaterialYear = new Map();
      for (const record of actualByMaterialYearSlot.values()) {
        const key = `${record.material}||${record.year}`;
        if (!byMaterialYear.has(key)) byMaterialYear.set(key, []);
        byMaterialYear.get(key).push(record);
      }
      const indexValues = new Map();
      for (const records of byMaterialYear.values()) {
        if (records.length < 18) continue;
        const mean = records.reduce((sum, record) => sum + record.actual, 0) / records.length;
        if (mean <= 0) continue;
        for (const record of records) {
          const key = `${record.material}||${record.slot}`;
          if (!indexValues.has(key)) indexValues.set(key, []);
          indexValues.get(key).push(record.actual / mean);
        }
      }
      for (const [key, values] of indexValues) {
        const separator = key.lastIndexOf("||");
        const material = key.slice(0, separator);
        const slot = Number(key.slice(separator + 2));
        if (!seasonalIndexByMaterial.has(material)) seasonalIndexByMaterial.set(material, new Map());
        seasonalIndexByMaterial.get(material).set(slot, values.reduce((sum, value) => sum + value, 0) / values.length);
      }
    }
    const seasonalProfilesBySku = new Map();
    const seasonalProfilesByKey = new Map();
    const seasonalTable = findHeaderTable(workbook, XLSX, ["季節指數"], ["範圍", "類別層級", "類別／品號", "14天位置", "季節指數"]);
    if (seasonalTable) {
      for (let index = seasonalTable.headerRowIndex + 1; index < seasonalTable.rows.length; index += 1) {
        const row = seasonalTable.rows[index];
        const scope = String(tableCell(seasonalTable, row, ["範圍"]) || "全部").trim() || "全部";
        const level = String(tableCell(seasonalTable, row, ["類別層級"]) || "").trim();
        const name = String(tableCell(seasonalTable, row, ["類別／品號", "類別名稱"]) || "").trim();
        const slotNumber = parseNumber(tableCell(seasonalTable, row, ["14天位置"]));
        const seasonalIndex = parseNumber(tableCell(seasonalTable, row, ["季節指數"]));
        if (!level || !name || slotNumber == null || seasonalIndex == null || slotNumber < 1 || slotNumber > 26 || seasonalIndex <= 0) continue;
        const target = level === "SKU"
          ? seasonalProfilesBySku
          : seasonalProfilesByKey;
        const key = level === "SKU" ? normalizeSku(name) : `${normalizeText(scope)}||${normalizeText(level)}||${normalizeText(name)}`;
        if (!target.has(key)) target.set(key, {
          scope, level, name, indices: new Map(),
          actualBySlot: new Map(),
          observationsBySlot: new Map(),
          reliability: String(tableCell(seasonalTable, row, ["可信度"]) || "低").trim(),
          seasonal: String(tableCell(seasonalTable, row, ["季節型"]) || "否").trim() === "是",
          peakSlots: String(tableCell(seasonalTable, row, ["旺季位置"]) || "").trim(),
          totalObservations: parseNumber(tableCell(seasonalTable, row, ["總觀察期數"])) || 0,
          totalActual: parseNumber(tableCell(seasonalTable, row, ["總實際量"])) || 0
        });
        const profile = target.get(key);
        profile.indices.set(slotNumber - 1, seasonalIndex);
        profile.actualBySlot.set(slotNumber - 1, Math.max(0, parseNumber(tableCell(seasonalTable, row, ["該位置實際量"])) || 0));
        profile.observationsBySlot.set(slotNumber - 1, Math.max(0, parseNumber(tableCell(seasonalTable, row, ["該位置觀察期數"])) || 0));
      }
    }
    return {
      fileName: options.fileName || "",
      skuSheetName: skuTable.sheetName,
      categorySheetName: categoryTable?.sheetName || "",
      bySku,
      byMaterial,
      seasonalIndexByMaterial,
      seasonalProfilesBySku,
      seasonalProfilesByKey,
      categoryModelAvailable: Boolean(categoryTable),
      seasonalIndexAvailable: seasonalProfilesBySku.size > 0 || seasonalProfilesByKey.size > 0 || seasonalIndexByMaterial.size > 0
    };
  }

  function cellFillRgb(cell) {
    if (!cell || !cell.s) return "";
    const candidates = [
      cell.s?.fgColor?.rgb,
      cell.s?.fill?.fgColor?.rgb,
      cell.s?.fill?.fgColor,
      cell.s?.patternFill?.fgColor?.rgb,
      cell.s?.patternFill?.fgColor
    ];
    const found = candidates.find((value) => typeof value === "string" && /^[A-Fa-f0-9]{6,8}$/.test(value));
    return found ? found.toUpperCase() : "";
  }

  function isPinkFill(rgb) {
    const normalized = String(rgb || "").toUpperCase();
    return ["F4CCCC", "FFF4CCCC", "FFC7CE", "FFFFC7CE", "FFC0CB", "FFFFC0CB", "FFD9E1", "FFFFD9E1"]
      .some((value) => normalized.endsWith(value.replace(/^FF(?=.{6}$)/, "")) || normalized === value);
  }

  function parseConsignmentWorkbook(workbook, XLSX, options = {}) {
    const sheetName = workbook.SheetNames.includes("庫存+下單") ? "庫存+下單" : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) throw new Error("寄倉表沒有可讀取的資料。");
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const headers = [];
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      headers[column] = String(sheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })]?.v || "").trim();
    }
    const findColumn = (aliases) => {
      let bestIndex = null;
      let bestScore = 0;
      headers.forEach((header, index) => {
        const score = scoreHeader(header, aliases);
        if (score > bestScore) { bestIndex = index; bestScore = score; }
      });
      return bestScore >= 60 ? bestIndex : null;
    };
    const columns = {
      supplierSku: findColumn(["產品編號", "供應商貨號"]),
      sku: findColumn(["編號", "ERP品號", "貨號"]),
      labelName: findColumn(["貼標名稱"]),
      name: findColumn(["商品名稱", "品名"]),
      spec: findColumn(["規格"]),
      unitCost: findColumn(["成品價", "採購價"])
    };
    let currentColumn = null;
    headers.forEach((header, index) => {
      const normalized = normalizeHeader(header);
      if (normalized.includes("最新") && normalized.includes("庫存")) currentColumn = index;
    });
    if (columns.sku == null || columns.supplierSku == null || columns.name == null || currentColumn == null) {
      throw new Error("寄倉表缺少「產品編號、編號、商品名稱、最新庫存」欄位。");
    }

    const cellValue = (row, column) => sheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v;
    const records = [];
    const exceptions = [];
    const confirmedExclusions = [];
    let numericStyledCells = 0;
    let pinkCells = 0;
    for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
      const supplierSku = normalizeSku(cellValue(row, columns.supplierSku));
      const sku = normalizeSku(cellValue(row, columns.sku));
      const labelName = columns.labelName == null ? "" : String(cellValue(row, columns.labelName) || "").trim();
      const name = String(cellValue(row, columns.name) || "").trim();
      const spec = columns.spec == null ? "" : String(cellValue(row, columns.spec) || "").trim();
      if (!supplierSku && !sku && !labelName && !name && !spec) continue;

      const confirmedExclusionReason = CONFIRMED_EXCLUSIONS[sku];
      if (confirmedExclusionReason) {
        confirmedExclusions.push({
          type: "已確認放棄品號",
          sourceRow: row + 1,
          sku,
          supplierSku,
          name,
          action: `排除；${confirmedExclusionReason}`
        });
        continue;
      }

      const expectedSupplierSku = CONFIRMED_OVERRIDES[sku];
      if (expectedSupplierSku && supplierSku !== expectedSupplierSku) {
        confirmedExclusions.push({
          type: "已確認重複品號",
          sourceRow: row + 1,
          sku,
          supplierSku,
          name,
          action: `排除；保留供應商貨號${expectedSupplierSku}`
        });
        continue;
      }

      let scheduledQty = 0;
      const scheduleNotes = new Set();
      for (let column = currentColumn + 1; column <= range.e.c; column += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        const cell = sheet[address];
        const value = parseNumber(cell?.v);
        if (value == null || value === 0) continue;
        const rgb = cellFillRgb(cell);
        if (rgb) numericStyledCells += 1;
        if (isPinkFill(rgb)) {
          pinkCells += 1;
          scheduledQty += value;
          if (headers[column]) scheduleNotes.add(headers[column]);
        }
      }
      records.push({
        sourceRow: row + 1,
        supplierSku,
        sku,
        labelName,
        name,
        spec,
        unitCost: parseNumber(cellValue(row, columns.unitCost)),
        currentQty: parseNumber(cellValue(row, currentColumn)) || 0,
        scheduledQty,
        scheduleNotes: [...scheduleNotes]
      });
    }
    return {
      fileName: options.fileName || "",
      sheetName,
      currentHeader: headers[currentColumn],
      records,
      exceptions,
      confirmedExclusions,
      styleAudit: {
        numericStyledCells,
        pinkCells,
        pinkDetected: pinkCells > 0
      }
    };
  }

  function parseLirongConsignmentWorkbook(workbook, XLSX, options = {}) {
    const sheetName = workbook.SheetNames.includes("工作表1") ? "工作表1" : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) throw new Error("力榮寄庫表沒有可讀取的資料。");
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
    let headerRowIndex = -1;
    let headers = [];
    for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
      const candidate = rows[index].map((value) => String(value || "").trim());
      const normalized = candidate.map(normalizeHeader);
      if (normalized.some((value) => /^(?:erp|翔仔)?(?:品號|貨號)$|^編號$/.test(value))
        && normalized.some((value) => /品名|商品名稱/.test(value))
        && normalized.some((value) => /庫存|現貨/.test(value))) {
        headerRowIndex = index;
        headers = candidate;
        break;
      }
    }
    if (headerRowIndex < 0) throw new Error("力榮寄庫表缺少品號、品名與寄庫現貨欄位。");
    const findColumn = (patterns) => headers.findIndex((header) => patterns.some((pattern) => pattern.test(normalizeHeader(header))));
    const skuColumn = findColumn([/^(?:erp|翔仔)?(?:品號|貨號)$/, /^編號$/]);
    const supplierSkuColumn = findColumn([/供應商貨號/, /產品編號/]);
    const nameColumn = findColumn([/商品名稱/, /品名/]);
    const currentColumn = findColumn([/最新.*庫存/, /寄庫.*現貨/, /^現貨$/, /庫存數量/, /^(?:\d{2,4}|\d{1,2}月\d{1,2}日?)庫存$/]);
    const scheduleColumns = headers.map((header, index) => ({ header, index })).filter(({ header, index }) => index !== currentColumn && /(排程|製作|下單|新增|預計.*(?:入庫|完工)|完工)/.test(normalizeHeader(header)));
    if ([skuColumn, nameColumn, currentColumn].some((index) => index < 0)) throw new Error("力榮寄庫表欄位辨識失敗，已停止計算。");
    const records = [];
    const seen = new Set();
    for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      const sku = normalizeSku(row[skuColumn]);
      const name = String(row[nameColumn] || "").trim();
      if (!sku && !name) continue;
      if (!sku) throw new Error(`力榮寄庫表第${index + 1}列缺少ERP品號。`);
      if (seen.has(sku)) throw new Error(`力榮寄庫表ERP品號重複：${sku}。`);
      seen.add(sku);
      const currentQty = parseNumber(row[currentColumn]);
      if (currentQty == null || currentQty < 0) throw new Error(`力榮寄庫表${sku}的現貨數量不是有效非負數。`);
      let scheduledQty = 0;
      const scheduleNotes = [];
      for (const column of scheduleColumns) {
        const value = row[column.index];
        if (value === "" || value == null) continue;
        const quantity = parseNumber(value);
        if (quantity == null || quantity < 0) throw new Error(`力榮寄庫表${sku}的排程數量格式異常。`);
        scheduledQty += quantity;
        if (quantity > 0) scheduleNotes.push(column.header);
      }
      records.push({
        sourceRow: index + 1, sku, supplierSku: supplierSkuColumn < 0 ? "" : normalizeSku(row[supplierSkuColumn]), name,
        currentQty, scheduledQty, scheduleNotes
      });
    }
    if (!records.length) throw new Error("力榮寄庫表沒有可辨識的商品列。");
    return { fileName: options.fileName || "", sheetName, records, bySku: new Map(records.map((row) => [row.sku, row])) };
  }

  function buildLirongConsignmentRecommendations(recommendations, lirongConsignment, options = {}) {
    const orderDate = parseDateValue(options.orderDate || recommendations.asOfDate) || recommendations.asOfDate;
    const lirongRules = options.consignmentRules?.lirong || {};
    const pullLeadDays = Math.max(0, Number(lirongRules.pullLeadDays ?? PROCUREMENT_POLICY.lirongPullLeadDays));
    const productionDays = Math.max(0, Number(lirongRules.productionDays ?? PROCUREMENT_POLICY.lirongProductionDays));
    const deliveryAfterProductionDays = Math.max(0, Number(lirongRules.deliveryAfterProductionDays ?? PROCUREMENT_POLICY.lirongDeliveryAfterProductionDays));
    const earliestDeliveryDays = productionDays + deliveryAfterProductionDays;
    const targetRules = lirongRules.targetDays || PROCUREMENT_POLICY.lirongFactoryTargetDays;
    const packSize = purchaseUnitFromRules("力榮", null, "", options.purchaseUnitRules);
    return recommendations.rows.filter((row) => /力榮/.test(row.supplier)).map((row) => {
      const consignment = lirongConsignment.bySku.get(row.sku);
      const currentQty = consignment?.currentQty || 0;
      const scheduledQty = consignment?.scheduledQty || 0;
      const targetDays = Number(targetRules[row.tier] ?? PROCUREMENT_POLICY.lirongFactoryTargetDays[row.tier]);
      const approvedPullQty = Math.max(0, Number(options.approvedPullBySku?.[row.sku] || 0));
      const rawQty = Math.max(approvedPullQty + row.forecastDailyQty * (productionDays + targetDays) - currentQty - scheduledQty, 0);
      const down = Math.floor(rawQty / packSize) * packSize;
      const coverageWithDown = row.forecastDailyQty > 0 ? Math.max(currentQty + scheduledQty + down - approvedPullQty, 0) / row.forecastDailyQty : 9999;
      const packed = roundByPack(rawQty, packSize, coverageWithDown, targetDays + productionDays);
      const blocked = row.externalPurchaseBlocked;
      const suggestedQty = blocked ? 0 : packed.quantity;
      return {
        sku: row.sku, supplierSku: row.supplierSku, sourceName: consignment?.name || "", masterName: row.name, tier: row.tier,
        forecastDailyQty: row.forecastDailyQty, pullLeadDays, productionDays, earliestDeliveryDays, targetLowDays: Number(targetRules["低銷"] ?? 60),
        targetHighDays: Number(targetRules["熱銷"] ?? 90), targetDays, currentQty, scheduledQty, approvedPullQty,
        productionCompleteDate: addDays(orderDate, productionDays), expectedArrivalDate: addDays(orderDate, currentQty >= approvedPullQty ? pullLeadDays : earliestDeliveryDays),
        rawQty, downQty: packed.down, upQty: packed.up, suggestedQty, unitCost: row.unitCost,
        futureCost: suggestedQty * row.unitCost, availableDaysAfter: row.forecastDailyQty > 0 ? (currentQty + scheduledQty + suggestedQty - approvedPullQty) / row.forecastDailyQty : null,
        beforePullRisk: currentQty < approvedPullQty, beforeProductionRisk: currentQty < approvedPullQty + row.forecastDailyQty * productionDays,
        beforeDeliveryRisk: currentQty + scheduledQty < approvedPullQty + row.forecastDailyQty * earliestDeliveryDays,
        status: blocked ? (row.automaticExclusionReason || "(S)／下架禁止新增寄庫") : (consignment ? "已命中力榮寄庫表" : "寄庫表未命中，待人工確認"),
        scheduleNotes: consignment?.scheduleNotes || []
      };
    });
  }

  function normalizeBlacklist(entries) {
    const list = Array.isArray(entries) ? entries : String(entries || "").split(/\r?\n/);
    return list.map((value) => String(value || "").trim()).filter(Boolean).map((value) => ({
      original: value,
      sku: normalizeSku(value),
      name: normalizeName(value)
    }));
  }

  function blacklistMatch(record, blacklist) {
    const sku = normalizeSku(record.sku);
    const supplierSku = normalizeSku(record.supplierSku);
    const names = [record.name, record.labelName, record.spec].map(normalizeName).filter(Boolean);
    return blacklist.find((entry) => (
      (sku && entry.sku === sku)
      || (supplierSku && entry.sku === supplierSku)
      || names.some((name) => entry.name === name)
    )) || null;
  }

  function resolveConsignment(consignment, master, blacklistInput) {
    const blacklist = normalizeBlacklist(blacklistInput);
    const bySku = new Map();
    const exceptions = [...consignment.exceptions];
    const confirmedExclusions = [...(consignment.confirmedExclusions || [])];
    const excluded = [];
    for (const row of consignment.records) {
      const blocked = blacklistMatch(row, blacklist);
      if (blocked) {
        excluded.push({ ...row, blacklistEntry: blocked.original, reason: "人工黑名單" });
        continue;
      }

      let sku = row.sku;
      let matchBasis = sku ? "寄倉表ERP品號" : "";
      if (!sku && row.supplierSku) {
        const candidates = master.bySupplierSku.get(row.supplierSku) || [];
        if (candidates.length === 1) {
          sku = candidates[0].sku;
          matchBasis = "商品主檔供應商貨號完全一致";
        } else if (candidates.length > 1) {
          exceptions.push({ type: "供應商貨號一對多", sourceRow: row.sourceRow, sku: "", supplierSku: row.supplierSku, name: row.name, action: "待人工確認" });
          continue;
        }
      }
      if (!sku && row.name) {
        const candidates = master.byExactName.get(normalizeName(row.name)) || [];
        if (candidates.length === 1) {
          sku = candidates[0].sku;
          matchBasis = "商品主檔完整品名完全一致";
        } else if (candidates.length > 1) {
          exceptions.push({ type: "完整品名一對多", sourceRow: row.sourceRow, sku: "", supplierSku: row.supplierSku, name: row.name, action: "待人工確認" });
          continue;
        }
      }
      if (!sku) {
        exceptions.push({ type: "缺ERP品號", sourceRow: row.sourceRow, sku: "", supplierSku: row.supplierSku, name: row.name, action: "加入人工黑名單或補品號" });
        continue;
      }
      if (!master.bySku.has(sku)) {
        exceptions.push({ type: "商品主檔未命中", sourceRow: row.sourceRow, sku, supplierSku: row.supplierSku, name: row.name, action: "待人工確認" });
      }
      if (!bySku.has(sku)) {
        bySku.set(sku, {
          sku,
          name: master.bySku.get(sku)?.name || row.name,
          currentQty: 0,
          scheduledQty: 0,
          scheduleNotes: new Set(),
          sourceRows: [],
          matchBases: new Set()
        });
      }
      const aggregated = bySku.get(sku);
      aggregated.currentQty += row.currentQty;
      aggregated.scheduledQty += row.scheduledQty;
      aggregated.sourceRows.push(row.sourceRow);
      row.scheduleNotes.forEach((note) => aggregated.scheduleNotes.add(note));
      aggregated.matchBases.add(matchBasis);
    }
    return { bySku, exceptions, confirmedExclusions, excluded, blacklist };
  }

  function aggregatePendingReports(reports) {
    const bySku = new Map();
    const records = reports.flatMap((report) => report.records);
    for (const row of records) {
      if (row.isCustomOrder || row.automaticProcurementExcluded || row.quantity <= 0) continue;
      if (!bySku.has(row.sku)) {
        bySku.set(row.sku, { sku: row.sku, name: row.name, quantity: 0, amount: 0, files: new Set(), sourceRows: [], deliveries: [], orders: [] });
      }
      const aggregated = bySku.get(row.sku);
      aggregated.quantity += row.quantity;
      aggregated.amount += row.amount;
      aggregated.files.add(row.fileName);
      aggregated.sourceRows.push(`${row.fileName || "採購單"}#${row.sourceRow}`);
      aggregated.deliveries.push({ quantity: row.quantity, deliveryDate: row.expectedDeliveryDate || null });
      aggregated.orders.push({
        quantity: row.quantity,
        purchaseDate: row.purchaseDate || null,
        deliveryDate: row.expectedDeliveryDate || null,
        documentCode: row.documentCode || ""
      });
      if (!aggregated.name && row.name) aggregated.name = row.name;
    }
    return { records, bySku, customRecords: records.filter((row) => row.isCustomOrder) };
  }

  function summarizePurchaseReports(reports, analysisMonth) {
    const records = (reports || []).flatMap((report) => report.records || []);
    const month = String(analysisMonth || "").slice(0, 7);
    const received = records.filter((row) => row.receiptDate && (!month || row.receiptDate.slice(0, 7) === month) && row.deliveredQuantity > 0);
    const pending = records.filter((row) => !row.isCustomOrder && !row.automaticProcurementExcluded && row.quantity > 0);
    const drafts = records.filter((row) => row.draft);
    const documentCount = (rows) => new Set(rows.map((row) => row.documentCode || `${row.fileName}#${row.sourceRow}`)).size;
    return {
      month,
      actualReceiptCost: received.reduce((sum, row) => sum + Number(row.actualReceiptCost || 0), 0),
      actualReceiptQuantity: received.reduce((sum, row) => sum + Number(row.deliveredQuantity || 0), 0),
      receiptDocumentCount: documentCount(received),
      pendingAmount: pending.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      pendingQuantity: pending.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      pendingDocumentCount: documentCount(pending),
      draftAmount: drafts.reduce((sum, row) => sum + Number(row.orderedAmount || 0), 0),
      draftDocumentCount: documentCount(drafts),
      closedPartialDocumentCount: documentCount(records.filter((row) => row.documentClosed && /部分到貨/.test(normalizeText(row.status))))
    };
  }

  function summarizeCompanyCostFlows(input = {}) {
    const month = String(input.analysisMonth || "").slice(0, 7);
    const masterBySku = input.master?.bySku || new Map();
    const salesRecords = (input.salesReports || []).flatMap((report) => report.records || []);
    const takeRecords = (input.salesReports || []).flatMap((report) => report.takeRecords || []);
    const inMonth = (row) => !month || String(row.date || "").slice(0, 7) === month;
    const costOf = (row) => {
      const explicit = Number(row.purchaseCostAmount || row.storeCostAmount || row.registeredWarehouseCostAmount || 0);
      if (explicit) return explicit;
      return Number(masterBySku.get(row.sku)?.unitCost || 0) * Number(row.deductQuantity || row.quantity || 0);
    };
    const directRows = salesRecords.filter((row) => inMonth(row) && warehouseCompany(row.warehouseCode, row.warehouseName) === "寬承");
    const directCost = directRows.reduce((sum, row) => sum + costOf(row), 0);
    const orderKeys = new Set(salesRecords.filter((row) => inMonth(row) && row.saleType === "訂貨" && row.sourceOrder)
      .map((row) => compositeKey(row.sourceOrder, row.sku)));
    const kuanmuB3Rows = takeRecords.filter((row) => inMonth(row) && row.shipWarehouseCode === "T00" && warehouseCompany(row.warehouseCode, row.warehouseName) === "寬沐" && row.sourceOrder && orderKeys.has(compositeKey(row.sourceOrder, row.sku)));
    const kuanmuB3BaseCost = kuanmuB3Rows.reduce((sum, row) => sum + costOf(row), 0);
    const transferRows = (input.transferReports || []).flatMap((report) => report.records || []);
    const kuanmuTransferRows = transferRows.filter((row) => row.status === "收貨審核" && row.sourceWarehouseCode === "T00" && warehouseCompany(row.destinationWarehouseCode, row.destinationWarehouseName) === "寬沐" && (!month || String(row.receivedDate || "").slice(0, 7) === month));
    const kuanmuTransferBaseCost = kuanmuTransferRows.reduce((sum, row) => sum + Number(masterBySku.get(row.sku)?.unitCost || 0) * Number(row.quantity || 0), 0);
    const kuanmuBaseCost = kuanmuB3BaseCost + kuanmuTransferBaseCost;
    const managementCostToDate = directCost + kuanmuBaseCost;
    const maxSalesDate = [...salesRecords, ...takeRecords].filter(inMonth).reduce((max, row) => row.date > max ? row.date : max, "");
    let elapsedDays = 0;
    let daysInMonth = 0;
    if (month && maxSalesDate) {
      const [year, monthNumber] = month.split("-").map(Number);
      daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
      elapsedDays = Math.min(daysInMonth, Math.max(1, Number(maxSalesDate.slice(8, 10))));
    }
    const forecastCost = managementCostToDate > 0 && elapsedDays > 0 ? managementCostToDate / elapsedDays * daysInMonth : 0;
    const currentInventoryCost = (input.inventory?.records || []).filter((row) => warehouseCompany(row.warehouseCode, row.warehouseName) === "寬承")
      .reduce((sum, row) => sum + Number(row.inventoryCost || 0), 0);
    const openingInventoryCost = Number(input.openingInventoryCost || 0);
    const actualReceiptCost = Number(input.purchaseSummary?.actualReceiptCost || 0);
    const supplierReturns = Number(input.supplierReturns || 0);
    const inventoryBridgeCost = openingInventoryCost > 0 ? openingInventoryCost + actualReceiptCost - supplierReturns - currentInventoryCost : null;
    return {
      month, maxSalesDate, elapsedDays, daysInMonth, directCost, kuanmuB3BaseCost, kuanmuTransferBaseCost, kuanmuBaseCost,
      kuanmuIntercompanyRevenue: kuanmuBaseCost * 1.11, managementCostToDate, forecastCost, currentInventoryCost,
      openingInventoryCost, actualReceiptCost, supplierReturns, inventoryBridgeCost,
      b3MatchedCount: kuanmuB3Rows.length, transferReceivedCount: kuanmuTransferRows.length,
      source: managementCostToDate > 0 ? "actual_weighted" : "fallback",
      warnings: openingInventoryCost > 0 ? [] : ["尚缺月初庫存成本快照；本月至今成本先以銷售與寬沐供貨流向作管理暫估。"]
    };
  }

  function transferStateAtDate(record, asOfDate) {
    const cutoff = parseDateValue(asOfDate);
    if (!cutoff) return record.status === "收貨審核" ? "received" : (record.status === "發貨審核" ? "shipped" : "submitted");
    if (record.receivedDate && record.receivedDate <= cutoff) return "received";
    if (record.shippedDate && record.shippedDate <= cutoff) return "shipped";
    if (record.openedDate && record.openedDate <= cutoff) return "submitted";
    if (!record.openedDate) return record.status === "收貨審核" ? "received" : (record.status === "發貨審核" ? "shipped" : "submitted");
    return "future";
  }

  function aggregateTransferReports(reports, options = {}) {
    const records = (reports || []).flatMap((report) => report.records || []);
    const adjustmentBySkuWarehouse = new Map();
    const bySku = new Map();
    const activeDocuments = new Set();
    const stateCounts = { submitted: 0, shipped: 0, received: 0, future: 0 };
    const addAdjustment = (sku, warehouseCode, quantity) => {
      const key = compositeKey(sku, warehouseCode);
      adjustmentBySkuWarehouse.set(key, (adjustmentBySkuWarehouse.get(key) || 0) + quantity);
    };
    for (const record of records) {
      const effectiveState = transferStateAtDate(record, options.asOfDate);
      stateCounts[effectiveState] += 1;
      if (!bySku.has(record.sku)) bySku.set(record.sku, { sku: record.sku, submittedQty: 0, shippedQty: 0, projectedDeltaQty: 0 });
      const sku = bySku.get(record.sku);
      if (effectiveState === "submitted") {
        addAdjustment(record.sku, record.sourceWarehouseCode, -record.quantity);
        addAdjustment(record.sku, record.destinationWarehouseCode, record.quantity);
        sku.submittedQty += record.quantity;
        activeDocuments.add(record.documentCode);
      } else if (effectiveState === "shipped") {
        // ERP在發貨審核時已扣調出倉，庫存檔尚未含調入倉，故只補回在途目的地。
        addAdjustment(record.sku, record.destinationWarehouseCode, record.quantity);
        sku.shippedQty += record.quantity;
        sku.projectedDeltaQty += record.quantity;
        activeDocuments.add(record.documentCode);
      }
    }
    return {
      records,
      bySku,
      adjustmentBySkuWarehouse,
      stateCounts,
      activeDocumentCount: activeDocuments.size,
      submittedQty: [...bySku.values()].reduce((sum, row) => sum + row.submittedQty, 0),
      shippedQty: [...bySku.values()].reduce((sum, row) => sum + row.shippedQty, 0)
    };
  }

  function calculateNetProcurementDemand(input) {
    const forecastDemandQty = Math.max(0, Number(input.forecastDemandQty || 0));
    const safetyStockQty = Math.max(0, Number(input.safetyStockQty || 0));
    const availableInventoryQty = Math.max(0, Number(input.availableInventoryQty || 0));
    const pendingPurchaseQty = Math.max(0, Number(input.pendingPurchaseQty || 0));
    // factoryConsignmentQty is deliberately not referenced here. This is a locked rule.
    return Math.max(forecastDemandQty + safetyStockQty - availableInventoryQty - pendingPurchaseQty, 0);
  }

  function roundSuggestedQuantity(quantity, weightedScore) {
    const raw = Math.max(0, Number(quantity || 0));
    const score = Number(weightedScore || 0);
    if (raw < 1 && score < 0.5) return 0;
    return Math.ceil(raw);
  }

  function roundByPack(quantity, packSize, coverageWithDown, minimumCoverageDays) {
    const raw = Math.max(0, Number(quantity || 0));
    const pack = Math.max(1, Math.round(Number(packSize || 1)));
    if (!raw) return { raw, packSize: pack, down: 0, up: 0, quantity: 0, direction: "無需求" };
    const down = Math.floor(raw / pack) * pack;
    const up = Math.ceil(raw / pack) * pack;
    const useDown = down > 0 && Number(coverageWithDown || 0) >= Number(minimumCoverageDays || 0);
    return { raw, packSize: pack, down, up, quantity: useDown ? down : up, direction: useDown ? "向下" : "向上" };
  }

  function puyoumaPackSize(masterRecord, fallbackName = "") {
    const text = [masterRecord?.name, masterRecord?.size, masterRecord?.sizeGroup, fallbackName]
      .filter(Boolean).join(" ").normalize("NFKC").replace(/[×＊*]/g, "x").replace(/\s+/g, "");
    if (/床包/.test(text) && /(?:^|[^\d.])(?:3\.5尺|7尺)/.test(text)) return 10;
    if (/床包/.test(text) && /(?:^|[^\d.])(?:5尺|6尺)/.test(text)) return 20;
    if (/兩用被套/.test(text)) return 10;
    if (/薄被套/.test(text) && /(4\.5x6\.5尺|單人)/.test(text)) return 10;
    if (/薄被套/.test(text) && /(6x7尺|雙人)/.test(text)) return 20;
    return 1;
  }

  function purchaseUnitFromRules(supplier, masterRecord, fallbackName, suppliedRules) {
    const supplierText = normalizeText(supplier);
    if (/力榮/.test(supplierText)) return 10;
    const confirmedPuyoumaUnit = /普優[瑪碼]/.test(supplierText) ? puyoumaPackSize(masterRecord, fallbackName) : 1;
    if (confirmedPuyoumaUnit > 1) return confirmedPuyoumaUnit;
    if (!Array.isArray(suppliedRules)) return confirmedPuyoumaUnit;
    const productText = normalizeText([masterRecord?.name, masterRecord?.size, masterRecord?.sizeGroup, fallbackName].filter(Boolean).join(" "));
    const candidates = suppliedRules.filter((rule) => {
      const ruleSupplier = normalizeText(rule?.supplier);
      return rule?.enabled !== false && ruleSupplier && supplierText && (supplierText === ruleSupplier || supplierText.includes(ruleSupplier) || ruleSupplier.includes(supplierText));
    });
    const matched = candidates.find((rule) => String(rule.matchText || "").split("|").map(normalizeText).filter(Boolean).every((part) => productText.includes(part)))
      || candidates.find((rule) => !String(rule.matchText || "").trim());
    return matched && Number.isInteger(Number(matched.quantity)) && Number(matched.quantity) > 0 ? Number(matched.quantity) : confirmedPuyoumaUnit;
  }

  function addDays(dateValue, days) {
    const key = parseDateValue(dateValue);
    if (!key) return "";
    const date = new Date(`${key}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + Math.round(Number(days || 0)));
    return date.toISOString().slice(0, 10);
  }

  function findSupplierRule(supplier, suppliedRules = []) {
    const normalized = normalizeText(supplier);
    return [...suppliedRules, ...SUPPLIER_RULES].find((row) => {
      const names = [row.name, row.supplierName, row.shortName, row.supplierShortName, ...(row.aliases || [])]
        .map(normalizeText).filter(Boolean);
      return normalized && names.some((name) => normalized === name || normalized.includes(name) || name.includes(normalized));
    }) || null;
  }

  function supplierSelectionCatalog(analysis, suppliedRules = [], primarySuppliers = PRIMARY_SUPPLIERS) {
    const rules = Array.isArray(suppliedRules) && suppliedRules.length ? suppliedRules : SUPPLIER_RULES;
    const canonicalName = (value) => {
      const name = String(value || "").trim();
      return findSupplierRule(name, rules)?.name || name;
    };
    const names = new Set();
    rules.forEach((rule) => { if (rule?.name) names.add(String(rule.name).trim()); });
    (analysis?.rows || []).forEach((row) => { const name = canonicalName(row.supplier); if (name) names.add(name); });
    (analysis?.productExclusions || []).forEach((row) => { const name = canonicalName(row.supplier); if (name) names.add(name); });
    const metrics = new Map([...names].map((name) => [name, { name, suggestedCount: 0, suggestedAmount: 0, reviewCount: 0 }]));
    (analysis?.suggestedRows || []).forEach((row) => {
      const name = canonicalName(row.supplier);
      if (!name) return;
      if (!metrics.has(name)) metrics.set(name, { name, suggestedCount: 0, suggestedAmount: 0, reviewCount: 0 });
      const item = metrics.get(name);
      item.suggestedCount += 1;
      item.suggestedAmount += Number(row.suggestedPurchaseAmount || 0);
    });
    (analysis?.rows || []).forEach((row) => {
      if (!row.externalPurchaseBlocked && !row.manualSupplierReview && !row.productStatusPendingReview) return;
      const name = canonicalName(row.supplier);
      if (!name) return;
      if (!metrics.has(name)) metrics.set(name, { name, suggestedCount: 0, suggestedAmount: 0, reviewCount: 0 });
      metrics.get(name).reviewCount += 1;
    });
    const primaryOrder = new Map(primarySuppliers.map((name, index) => [canonicalName(name), index]));
    const compare = (left, right) => left.name.localeCompare(right.name, "zh-Hant");
    const all = [...metrics.values()];
    const primary = all.filter((item) => primaryOrder.has(item.name)).sort((left, right) => primaryOrder.get(left.name) - primaryOrder.get(right.name));
    const other = all.filter((item) => !primaryOrder.has(item.name)).sort(compare);
    return { primary, other, all: [...primary, ...other], canonicalName };
  }

  function calculatePaymentSchedule(input) {
    const supplierRule = findSupplierRule(input.supplier, input.supplierRules || []);
    const amount = Math.max(0, Number(input.amount || 0));
    const orderDate = parseDateValue(input.orderDate);
    if (!supplierRule || !orderDate || !Number.isFinite(Number(supplierRule.leadDays))) {
      return { status: "REVIEW", supplierCountry: "", leadDays: null, expectedShipmentDate: "", expectedArrivalDate: "", entries: [], message: "供應商分類、平均採購週期或下單日缺漏。" };
    }
    const leadDays = Math.max(0, Number(supplierRule.leadDays));
    const isLirongConsignment = /力榮/.test(normalizeText(input.supplier)) && input.supplyMode === "consignment";
    const expectedShipmentDate = supplierRule.country === "國外" ? addDays(orderDate, leadDays) : "";
    const arrivalLeadDays = isLirongConsignment ? (Number(input.consignmentAvailableQty || 0) >= Number(input.confirmedQty || 0) ? 5 : 19) : leadDays;
    const expectedArrivalDate = supplierRule.country === "國內" ? addDays(orderDate, arrivalLeadDays) : "";
    const entries = supplierRule.country === "國外"
      ? [
        { trigger: "下單訂金30%", date: orderDate, month: orderDate.slice(0, 7), amount: Math.round(amount * 30) / 100 },
        { trigger: "預計出貨70%", date: expectedShipmentDate, month: expectedShipmentDate.slice(0, 7), amount: Math.round(amount * 70) / 100 }
      ]
      : [{ trigger: "預計到貨100%", date: expectedArrivalDate, month: expectedArrivalDate.slice(0, 7), amount }];
    return {
      status: "PASS", supplierCountry: supplierRule.country, leadDays, expectedShipmentDate, expectedArrivalDate, entries,
      message: supplierRule.country === "國外" ? "國外：下單30%、預計出貨70%。" : "國內：預計到貨100%。"
    };
  }

  function evaluateConsignmentSupply(input) {
    const confirmedPurchaseQty = Math.max(0, Number(input.confirmedPurchaseQty || 0));
    const currentConsignmentQty = Math.max(0, Number(input.currentConsignmentQty || 0));
    const scheduledBeforeDueQty = Math.max(0, Number(input.scheduledBeforeDueQty || 0));
    const currentGap = Math.max(confirmedPurchaseQty - currentConsignmentQty, 0);
    const gapAfterSchedule = Math.max(confirmedPurchaseQty - currentConsignmentQty - scheduledBeforeDueQty, 0);
    let status = "現有寄倉可直接覆蓋";
    if (currentGap > 0 && gapAfterSchedule === 0) status = "排程量可覆蓋；交期待確認";
    if (gapAfterSchedule > 0) status = "缺貨警示：需新增寄庫單";
    return { currentGap, gapAfterSchedule, status };
  }

  function calculatePurchaseBudget(input) {
    const forecastCostOutflow = Number(input.forecastCostOutflow || 0);
    const targetEndingInventoryCost = Number(input.targetEndingInventoryCost || 0);
    const openingInventoryCost = Number(input.openingInventoryCost || 0);
    const expectedSupplierReturns = Number(input.expectedSupplierReturns || 0);
    const purchasedAmountToDate = Number(input.purchasedAmountToDate || 0);
    const availableBudget = forecastCostOutflow + targetEndingInventoryCost - openingInventoryCost + expectedSupplierReturns;
    return {
      availableBudget,
      purchasedAmountToDate,
      remainingBudget: availableBudget - purchasedAmountToDate
    };
  }

  function resolveReleasedBudgetAmount(input) {
    const fullBudgetAmount = Math.max(0, Number(input.fullBudgetAmount || 0));
    const monthStartReleasedAmount = Math.max(0, Math.min(fullBudgetAmount, Number(input.monthStartReleasedAmount || 0)));
    const checkpoint = String(input.checkpoint || "month-start");
    const releasedBudgetAmount = checkpoint === "month-start" ? monthStartReleasedAmount : fullBudgetAmount;
    return {
      checkpoint,
      monthStartReleasedAmount,
      additionalReleasedAmount: Math.max(0, releasedBudgetAmount - monthStartReleasedAmount),
      releasedBudgetAmount
    };
  }

  function inferMaterialCategory(masterRecord, fallbackName = "") {
    const combined = [
      masterRecord?.name,
      masterRecord?.style1,
      masterRecord?.style2,
      masterRecord?.mainCategory,
      fallbackName
    ].filter(Boolean).join(" ").replace(/\s/g, "");
    const mainCategory = String(masterRecord?.mainCategory || "").replace(/\s/g, "");
    const nameOnly = [masterRecord?.name, fallbackName].filter(Boolean).join(" ").replace(/\s/g, "");
    const pillowAccessory = /(枕套|枕頭套|枕巾|抱枕套|靠枕套|床包|被套)/.test(nameOnly);
    const pillowCore = /^(枕頭|枕芯)$/.test(mainCategory)
      || (!mainCategory && !pillowAccessory && /(枕頭|枕芯|羽絨枕|乳膠枕|記憶枕|纖維枕|飯店枕|機能枕|水洗枕|軟枕|硬枕)/.test(nameOnly));
    if (pillowCore) return "枕芯";
    if (combined.includes("天絲棉")) return "天絲棉";
    if (combined.includes("天絲")) return "天絲";
    if (combined.includes("熊冷")) return "熊冷";
    if (combined.includes("麻糬被")) return "麻糬被";
    if (combined.includes("華爾紗")) return "華爾紗";
    if (combined.includes("水洗棉")) return "水洗棉";
    if (combined.includes("雙層紗")) return "雙層紗";
    if (combined.includes("有機棉")) return "有機棉";
    if (combined.includes("長絨棉")) return "長絨棉";
    if (combined.includes("純棉") || /(?:40|60|80|100)(?:支)?棉/.test(combined)) return "精梳純棉";
    if (/(涼感|涼被|冷被)/.test(combined)) return "涼感其他";
    if (/(暖被|冬被|羊羔絨|法蘭絨|保暖|厚被)/.test(combined)) return "冬季保暖其他";
    return "其他";
  }

  function classifyPuyoumaPurchaseTab(masterRecord, fallbackName = "") {
    const combined = [masterRecord?.name, masterRecord?.style1, masterRecord?.style2, fallbackName]
      .filter(Boolean).join(" ").replace(/\s/g, "");
    if (combined.includes("天絲")) return "天絲＋天絲棉";
    if (/(華爾紗|水洗棉|雙層紗|有機棉|純棉|長絨棉|(?:40|60|80|100)(?:支)?棉)/.test(combined)) return "長絨棉";
    return "無尺寸品項";
  }

  function reportProductHierarchy(row) {
    const sourceName = String(row?.name || "").normalize("NFKC").replace(/\s+/g, " ").trim();
    const purchaseTab = row?.purchaseTab || classifyPuyoumaPurchaseTab(row, sourceName);
    const mainCategory = normalizeText(row?.mainCategory || "");
    let mediumCategory = "其它品項";
    if (/床包/.test(mainCategory) || /床包/.test(sourceName)) mediumCategory = "床包";
    else if (/被套/.test(mainCategory) || /被套/.test(sourceName)) mediumCategory = "被套";
    else if (/枕套|枕頭套|枕巾/.test(mainCategory) || /枕套|枕頭套|枕巾/.test(sourceName)) mediumCategory = "枕套";
    else if (/枕頭|枕芯/.test(mainCategory) || /枕頭|枕芯/.test(sourceName)) mediumCategory = "枕芯";
    else if (mainCategory) mediumCategory = row?.mainCategory || "其它品項";
    const materialCategory = purchaseTab === "天絲＋天絲棉" ? "天絲／天絲棉" : (purchaseTab === "長絨棉" ? "長絨棉" : "無尺寸");

    const withoutStop = sourceName.replace(/\s*[（(]\s*S\s*[)）]\s*$/i, "").trim();
    let size = "無尺寸";
    const sizeCandidates = [row?.size, row?.sizeGroup].map((value) => String(value || "").normalize("NFKC").trim()).filter(Boolean);
    const explicitSize = sizeCandidates.find((value) => !/^(均碼|無尺寸|不分尺寸)$/.test(value));
    const nameSize = withoutStop.match(/\d+(?:\.\d+)?\s*(?:[xX×＊*]\s*\d+(?:\.\d+)?\s*){0,2}(?:尺|公分|cm)/i)?.[0];
    if (explicitSize || nameSize) size = explicitSize || nameSize.replace(/\s+/g, "");

    let majorCategory = withoutStop || String(row?.sku || "未命名品項");
    if (mediumCategory !== "其它品項" || size !== "無尺寸") {
      const bracketed = withoutStop.match(/[\[［]([^\]］]+)[\]］]/)?.[1]?.trim();
      const quoted = withoutStop.match(/[「『]([^」』]+)[」』]/)?.[1]?.trim();
      const parenthetical = [...withoutStop.matchAll(/[（(]([^()（）]+)[)）]/g)]
        .map((match) => match[1].trim())
        .find((value) => value && !/^(?:S|單入|雙入|兩入|\d+入)$/i.test(value) && !/(?:含|不含).*(?:枕套|枕頭套|枕芯)/.test(value));
      let candidate = bracketed || quoted || parenthetical || withoutStop;
      candidate = candidate
        .replace(/^(?:(?:40|60|80|100)(?:支|[sS])?\s*)?(?:天絲棉|天絲|長絨棉|精梳純棉|純棉|水洗棉|雙層紗|有機棉|華爾紗)\s*[-－—_:：]?\s*/i, "")
        .replace(/\s*[-－—]\s*(?:素色枕套|條紋枕套|素\s*\+\s*條紋枕套)\s*$/i, "")
        .trim();
      if (!bracketed) {
        candidate = candidate
          .replace(/\d+(?:\.\d+)?\s*(?:[xX×＊*]\s*(?:高)?\d+(?:\.\d+)?\s*){1,2}(?:尺|公分|cm)?/gi, " ")
          .replace(/\d+(?:\.\d+)?\s*(?:尺|公分|cm)/gi, " ")
          .replace(/(?:床包組?|單人|雙人|特大|薄被套|兩用被套|被套|枕頭套|枕套|抱枕|天絲棉|天絲|長絨棉|精梳純棉|純棉|水洗棉|雙層紗|有機棉|華爾紗|寢室|刺繡|鋪棉|不含|含|素色|條紋|\d+\s*[sS]|\d+入|單入|雙入|兩入)/gi, " ")
          .replace(/[\[\]［］()（）「」『』]/g, " ")
          .replace(/^[\s+\-－—_:：]+|[\s+\-－—_:：]+$/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }
      majorCategory = candidate || bracketed || quoted || parenthetical || withoutStop || String(row?.sku || "未辨識花色");
    }
    const smallCategory = size;
    return { materialCategory, majorCategory, mediumCategory, smallCategory, size };
  }

  const puyoumaConsignmentGroup = reportProductHierarchy;

  function applyDemandModel(modelName, recent6Daily, recent12Daily, lastYearDaily) {
    const name = String(modelName || "近期6週");
    const hasLastYear = Number.isFinite(lastYearDaily) && lastYearDaily > 0;
    if (name.includes("近期12週")) return { daily: recent12Daily, usedModel: "近期12週", seasonalDataReady: true };
    if (name === "去年同期") {
      return hasLastYear
        ? { daily: lastYearDaily, usedModel: name, seasonalDataReady: true }
        : { daily: recent6Daily, usedModel: "近期6週（去年同期不足）", seasonalDataReady: false };
    }
    const blend = name.match(/近期(\d+)%＋同期(\d+)%/);
    if (blend) {
      if (!hasLastYear) return { daily: recent6Daily, usedModel: "近期6週（去年同期不足）", seasonalDataReady: false };
      const recentWeight = Number(blend[1]) / 100;
      const lastYearWeight = Number(blend[2]) / 100;
      return {
        daily: recent6Daily * recentWeight + lastYearDaily * lastYearWeight,
        usedModel: name,
        seasonalDataReady: true
      };
    }
    return { daily: recent6Daily, usedModel: "近期6週", seasonalDataReady: true };
  }

  function isPublicRelationsMovement(sale) {
    const warehouseCode = normalizeSku(sale?.warehouseCode);
    const text = normalizeText([sale?.warehouseName, sale?.name, sale?.ecommercePlatform].filter(Boolean).join(" "));
    return warehouseCode === "O06" || /公關品|公關贈送|pr贈送/.test(text);
  }

  function comparableProductType(masterRecord, fallbackName = "") {
    const text = normalizeText([masterRecord?.mainCategory, masterRecord?.style1, masterRecord?.style2, masterRecord?.name, fallbackName].filter(Boolean).join(" "));
    if (/床包/.test(text)) return "床包";
    if (/兩用被套/.test(text)) return "兩用被套";
    if (/薄被套/.test(text)) return "薄被套";
    if (/被套/.test(text)) return "被套";
    if (/枕套|枕頭套|枕巾/.test(text)) return "枕套";
    if (/枕頭|枕芯|羽絨枕|軟枕|硬枕/.test(text)) return "枕芯";
    return normalizeText(masterRecord?.mainCategory || masterRecord?.style1 || "其它");
  }

  function comparableSize(masterRecord, fallbackName = "") {
    const text = [masterRecord?.size, masterRecord?.sizeGroup, masterRecord?.name, fallbackName]
      .filter(Boolean).join(" ").normalize("NFKC").replace(/[×＊*]/g, "x").replace(/\s+/g, "");
    const match = text.match(/(?:3\.5尺|4\.5x6\.5尺|5尺|6x7尺|6尺|7尺|8x7尺)/i);
    return normalizeText(match?.[0] || masterRecord?.size || masterRecord?.sizeGroup || "無尺寸");
  }

  function trimmedMean(values) {
    const sorted = values.map(Number).filter((value) => Number.isFinite(value) && value >= 0).sort((left, right) => left - right);
    if (!sorted.length) return null;
    const trim = sorted.length >= 5 ? Math.max(1, Math.floor(sorted.length * 0.1)) : 0;
    const kept = trim && sorted.length > trim * 2 ? sorted.slice(trim, -trim) : sorted;
    return kept.reduce((sum, value) => sum + value, 0) / kept.length;
  }

  function newProductWeights(activeDays, actualDaily, categoryDaily, netQuantity) {
    const days = Math.max(1, Math.floor(Number(activeDays || 1)));
    if (days <= 7) return { actualWeight: 0.3, categoryWeight: 0.7, label: "開賣1～7天：新品30%／類別70%" };
    if (days <= 14) return { actualWeight: 0.5, categoryWeight: 0.5, label: "開賣8～14天：新品50%／類別50%" };
    if (days <= 28) {
      const accelerated = Number(netQuantity || 0) >= 20 && Number(categoryDaily || 0) > 0 && Number(actualDaily || 0) >= Number(categoryDaily) * 2;
      return accelerated
        ? { actualWeight: 0.75, categoryWeight: 0.25, label: "開賣15～28天且實績明顯領先：新品75%／類別25%" }
        : { actualWeight: 0.65, categoryWeight: 0.35, label: "開賣15～28天：新品65%／類別35%" };
    }
    return { actualWeight: 0.85, categoryWeight: 0.15, label: "開賣29～42天：新品85%／類別15%" };
  }

  function coefficientOfVariation(values) {
    if (!values.length) return null;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (mean <= 0) return null;
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
    return Math.sqrt(variance) / mean;
  }

  function classifyXyz(weeklyQuantities) {
    const nonnegative = weeklyQuantities.map((value) => Math.max(0, value));
    const activeWeeks = nonnegative.filter((value) => value > 0).length;
    const cv = coefficientOfVariation(nonnegative);
    if (activeWeeks >= PROCUREMENT_POLICY.xyzThresholds.XActiveWeeks && cv != null && cv <= PROCUREMENT_POLICY.xyzThresholds.XCv) {
      return { xyzClass: "X", activeWeeks, cv };
    }
    if (activeWeeks >= PROCUREMENT_POLICY.xyzThresholds.YActiveWeeks && cv != null && cv <= PROCUREMENT_POLICY.xyzThresholds.YCv) {
      return { xyzClass: "Y", activeWeeks, cv };
    }
    return { xyzClass: "Z", activeWeeks, cv };
  }

  function demandTier(abcClass, xyzClass, recent6Qty, trendRatio, activeWeeks6) {
    if ((abcClass === "A" && xyzClass !== "Z") || (recent6Qty >= 12 && trendRatio >= 1.35 && activeWeeks6 >= 4)) return "熱銷";
    if ((abcClass === "A" && xyzClass === "Z") || (abcClass === "B" && xyzClass !== "Z")) return "穩定";
    return "低銷";
  }

  function recommendationScore(tier, xyzClass, activeWeeks6) {
    let score = ({ "熱銷": 0.9, "穩定": 0.65, "低銷": 0.3 })[tier] || 0.3;
    if (xyzClass === "X") score += 0.1;
    if (xyzClass === "Z") score -= 0.1;
    if (activeWeeks6 <= 1) score -= 0.1;
    return Math.min(1, Math.max(0, score));
  }

  function resolveSupplyProfile(supplier) {
    const normalized = normalizeText(supplier);
    const supplierRules = arguments[1] || [];
    const tier = arguments[2] || "穩定";
    const baseProfile = /普優[瑪碼]/.test(normalized)
      ? PROCUREMENT_POLICY.supplyProfiles.puyouma
      : (/力榮/.test(normalized) ? PROCUREMENT_POLICY.supplyProfiles.shortLead : PROCUREMENT_POLICY.supplyProfiles.default);
    const rule = findSupplierRule(supplier, supplierRules);
    if (!rule) {
      return {
        ...baseProfile,
        reviewDays: PROCUREMENT_POLICY.reviewDays,
        reviewPeriodLabel: `${PROCUREMENT_POLICY.reviewDays}天（預設）`,
        manualReview: false,
        paymentRule: ""
      };
    }
    const leadDays = Math.max(0, parseNumber(rule.leadDays ?? rule.productLeadDays) || baseProfile.leadDays);
    const rawReview = /上林/.test(normalized) ? 28 : (rule.reviewPeriod ?? rule.reviewDays ?? "");
    const reviewText = String(rawReview ?? "").normalize("NFKC").trim();
    const rangeMatch = reviewText.match(/^(\d+(?:\.\d+)?)\s*[-~～至]\s*(\d+(?:\.\d+)?)$/);
    const numericReview = reviewText === "" ? Number.NaN : Number(reviewText);
    let reviewDays = PROCUREMENT_POLICY.reviewDays;
    let reviewPeriodLabel = `${PROCUREMENT_POLICY.reviewDays}天（預設）`;
    let manualReview = false;
    if (rangeMatch) {
      const minimum = Math.min(Number(rangeMatch[1]), Number(rangeMatch[2]));
      const maximum = Math.max(Number(rangeMatch[1]), Number(rangeMatch[2]));
      reviewDays = tier === "熱銷" ? minimum : (tier === "低銷" ? maximum : (minimum + maximum) / 2);
      reviewPeriodLabel = `${minimum}～${maximum}天（${tier}${reviewDays}天）`;
    } else if (Number.isFinite(numericReview) && numericReview > 0) {
      reviewDays = numericReview;
      reviewPeriodLabel = `${numericReview}天`;
    } else if (Number.isFinite(numericReview) && numericReview === 0) {
      reviewDays = 0;
      reviewPeriodLabel = "未定（人工判斷）";
      manualReview = true;
    }
    return {
      ...baseProfile,
      leadDays,
      reviewDays,
      reviewPeriodLabel,
      manualReview,
      paymentRule: String(rule.paymentRule || "").trim()
    };
  }

  function resolveSpringFestivalAdjustment({ asOfDate, supplierCountry, horizonDays, rule } = {}) {
    const configured = rule && typeof rule === "object" ? rule : DEFAULT_SPRING_FESTIVAL_RULE;
    const enabled = configured.enabled !== false;
    const closureStart = parseDateValue(configured.closureStart || DEFAULT_SPRING_FESTIVAL_RULE.closureStart);
    const recoveryDate = parseDateValue(configured.recoveryDate || DEFAULT_SPRING_FESTIVAL_RULE.recoveryDate);
    const extraDays = Math.max(45, Math.min(60, Math.round(Number(configured.extraDays) || DEFAULT_SPRING_FESTIVAL_RULE.extraDays)));
    const startDate = parseDateValue(asOfDate);
    const windowEnd = startDate ? addDays(startDate, Math.max(0, Number(horizonDays) || 0)) : "";
    const validRange = Boolean(closureStart && recoveryDate && dateToUtcMs(closureStart) <= dateToUtcMs(recoveryDate));
    const active = Boolean(
      enabled
      && supplierCountry === "國外"
      && startDate
      && validRange
      && dateToUtcMs(startDate) <= dateToUtcMs(recoveryDate)
      && dateToUtcMs(windowEnd) >= dateToUtcMs(closureStart)
    );
    return { enabled, active, closureStart, recoveryDate, extraDays, windowEnd };
  }

  function dateToUtcMs(value) {
    const key = parseDateValue(value);
    return key ? new Date(`${key}T00:00:00Z`).getTime() : null;
  }

  function seasonalSlotFromMs(timestamp) {
    const anchor = Date.UTC(2024, 0, 1);
    return ((Math.floor((timestamp - anchor) / 86400000 / 14) % 26) + 26) % 26;
  }

  function averageSeasonalIndex(indices, fromMs, days, direction = 1) {
    const horizon = Math.max(1, Math.round(Number(days) || 1));
    let total = 0;
    let count = 0;
    for (let day = 0; day < horizon; day += 1) {
      const timestamp = fromMs + direction * day * 86400000;
      const value = Number(indices?.get(seasonalSlotFromMs(timestamp)));
      if (!Number.isFinite(value) || value <= 0) continue;
      total += value;
      count += 1;
    }
    return count ? total / count : null;
  }

  function seasonalProfileForRow(model, row) {
    if (!model) return null;
    const accepted = (profile) => profile && profile.seasonal && ["高", "中"].includes(profile.reliability) && profile.indices?.size >= 20;
    const skuProfile = model.seasonalProfilesBySku?.get(row.demand.sku);
    if (accepted(skuProfile)) return { ...skuProfile, source: `SKU：${row.demand.sku}` };
    const supplierScopes = [row.masterRecord?.supplier, row.modelRow?.supplier, "全部"].map(normalizeText).filter(Boolean);
    const categories = [
      [row.modelRow?.categoryLevel, row.modelRow?.categoryName],
      ["材質", row.materialCategory]
    ];
    for (const scope of supplierScopes) {
      for (const [level, name] of categories) {
        if (!level || !name) continue;
        const profile = model.seasonalProfilesByKey?.get(`${scope}||${normalizeText(level)}||${normalizeText(name)}`);
        if (accepted(profile)) return { ...profile, source: `${profile.scope}／${profile.level}：${profile.name}` };
      }
    }
    return null;
  }

  function horizonSeasonalAdjustment(profile, asOfMs, targetCoverageDays) {
    if (!profile?.indices?.size) return { factor: 1, futureIndex: null, recentIndex: null };
    const recentIndex = averageSeasonalIndex(profile.indices, asOfMs, 42, -1);
    const futureIndex = averageSeasonalIndex(profile.indices, asOfMs, targetCoverageDays, 1);
    if (!recentIndex || !futureIndex) return { factor: 1, futureIndex, recentIndex };
    const rawFactor = futureIndex / recentIndex;
    const limits = profile.reliability === "高" ? [0.5, 4] : [0.65, 3];
    return { factor: Math.max(limits[0], Math.min(limits[1], rawFactor)), futureIndex, recentIndex };
  }

  function historicalSeasonalAverageDaily(profile, fromMs, days) {
    if (profile?.level !== "SKU" || !profile.actualBySlot?.size || !profile.observationsBySlot?.size) return null;
    const horizon = Math.max(1, Math.round(Number(days) || 1));
    let total = 0;
    let observedDays = 0;
    for (let day = 0; day < horizon; day += 1) {
      const slot = seasonalSlotFromMs(fromMs + day * 86400000);
      const actual = Number(profile.actualBySlot.get(slot));
      const observations = Number(profile.observationsBySlot.get(slot));
      if (!Number.isFinite(actual) || !Number.isFinite(observations) || observations <= 0) continue;
      total += Math.max(0, actual) / observations / 14;
      observedDays += 1;
    }
    return observedDays ? total / observedDays : null;
  }

  function seasonalDemandMode(row) {
    const name = normalizeText(row.masterRecord?.name || row.demand?.name || "");
    const material = normalizeText(row.materialCategory || row.modelRow?.materialCategory || "");
    const productType = normalizeText(row.masterRecord?.productType || row.modelRow?.productType || "");
    const season = normalizeText(row.modelRow?.season || row.masterRecord?.season || "");
    const combined = `${name} ${material} ${productType}`;
    if (/(涼被|夏季被|熊冷|涼墊|冷感|冰涼)/.test(combined)) return "強夏季";
    if (/(冬被|羊毛|羽絨|法蘭絨|暖暖|熊暖|羊羔絨|保暖|厚被|麻糬被)/.test(combined)) return "強冬季";
    if (/(地墊|華夫格披毯)/.test(combined)) return "四季穩定";
    const ordinaryBedding = /(床包|被套|寢具)/.test(combined);
    if (ordinaryBedding && /天絲/.test(material || name)) return "四季－夏季偏旺";
    if (ordinaryBedding && /(純棉|精梳棉|精梳純棉|長絨棉)/.test(material || name)) return "四季－冬季偏旺";
    if (/夏/.test(season)) return "強夏季";
    if (/冬/.test(season)) return "強冬季";
    return "四季穩定";
  }

  function effectiveSeasonalFactor(rawFactor, mode) {
    const factor = Number(rawFactor);
    if (!Number.isFinite(factor) || factor <= 0) return 1;
    if (/^四季－/.test(mode)) return Math.max(0.8, Math.min(1.3, 1 + (factor - 1) * 0.4));
    return factor;
  }

  function hasRepeatedSeasonalPeak(profile) {
    const peakSlots = String(profile?.peakSlots || "").split(/[^0-9]+/).map(Number).filter((slot) => slot >= 1 && slot <= 26);
    return peakSlots.some((slot) => Number(profile?.observationsBySlot?.get(slot - 1) || 0) >= 2);
  }

  const STORE_CHANNEL_CODES = Object.freeze({
    "台北中山門市": "R00",
    "中山門市": "R00",
    "台中北屯門市": "R01",
    "北屯門市": "R01",
    "新竹門市": "R03",
    "文心門市": "R06",
    "誠品門市": "R07",
    "新莊門市": "R10",
    "高雄快閃": "R16",
    "高雄夢時代": "R09"
  });

  function compositeKey(left, right) { return `${left}\t${right}`; }

  function plannedChannelKey(channel) {
    const label = normalizeText(channel?.channel);
    if (/官網/.test(label)) return "kc_web";
    if (/momo|i預購/.test(label)) return "kc_momo";
    if (/蝦皮|shopee/.test(label)) return "kc_shopee";
    for (const [name, code] of Object.entries(STORE_CHANNEL_CODES)) {
      if (label.includes(normalizeText(name))) return code;
    }
    return String(channel?.company || "").trim() === "寬承" ? "kc_other" : `plan:${label}`;
  }

  function salesChannelKey(sale) {
    const warehouseCode = normalizeSku(sale?.warehouseCode);
    if (warehouseCode === "T00" || /^(T|W)/.test(warehouseCode)) {
      const platform = normalizeText(sale?.ecommercePlatform);
      if (/尚峪官網|官網/.test(platform)) return "kc_web";
      if (/momo|i預購/.test(platform)) return "kc_momo";
      if (/shopee|蝦皮/.test(platform)) return "kc_shopee";
      return "kc_other";
    }
    return /^R\d{2}$/.test(warehouseCode) ? warehouseCode : "kc_other";
  }

  function storeTargetQty(daily, tier) {
    if (tier === "熱銷") return Math.max(0, daily) * 10;
    if (tier === "穩定") return Math.max(0, daily) * 7;
    return daily > 0 ? 1 : 0;
  }

  function purchaseReleaseRate(tier, checkpoint) {
    if (checkpoint !== "month-start") return 1;
    if (tier === "熱銷") return 0.7;
    if (tier === "穩定") return 0.5;
    return 0;
  }

  function buildProcurementRecommendations(input) {
    const puyoumaRules = input.consignmentRules?.puyouma || {};
    const lirongRules = input.consignmentRules?.lirong || {};
    const puyoumaProductionDays = Math.max(0, Number(puyoumaRules.productionDays ?? PROCUREMENT_POLICY.puyoumaFactoryLeadDays));
    const puyoumaTargetDays = puyoumaRules.targetDays || PROCUREMENT_POLICY.puyoumaFactoryTargetDays;
    const lirongProductionDays = Math.max(0, Number(lirongRules.productionDays ?? PROCUREMENT_POLICY.lirongProductionDays));
    const pending = aggregatePendingReports(input.pendingReports || []);
    const storeTransferNeeds = (input.storeTransferNeeds || []).filter((row) => Number(row.unfilledQuantity || row.unfilled_quantity || 0) > 0 && ["merge_next", "new_order"].includes(String(row.handlingMode || row.handling_mode || "")));
    const storeTransferNeedBySkuStore = new Map();
    for (const need of storeTransferNeeds) {
      const sku = normalizeSku(need.sku);
      const storeCode = normalizeSku(need.storeCode || need.store_code);
      if (!sku || !storeCode) continue;
      storeTransferNeedBySkuStore.set(compositeKey(sku, storeCode), {
        quantity: Math.max(0, Number(need.unfilledQuantity || need.unfilled_quantity || 0)),
        neededBy: parseDateValue(need.neededBy || need.needed_by),
        handlingMode: String(need.handlingMode || need.handling_mode || ""),
        sourceBatchId: String(need.sourceBatchId || need.source_batch_id || "")
      });
    }
    const transfers = aggregateTransferReports(input.transferReports || [], { asOfDate: input.inventoryDate || input.asOfDate });
    const resolvedConsignment = resolveConsignment(input.consignment, input.master, input.blacklist || []);
    const blacklist = normalizeBlacklist(input.blacklist || []);
    const salesRecords = (input.salesReports || []).flatMap((report) => report.records || []);
    const procurementSalesRecords = salesRecords.filter((row) => {
      const masterRecord = input.master.bySku.get(row.sku);
      return !isAutomaticProcurementExcludedItem(row.sku, masterRecord?.name, row.name);
    });
    const procurementSalesBySku = new Map();
    for (const sale of procurementSalesRecords) {
      if (!procurementSalesBySku.has(sale.sku)) procurementSalesBySku.set(sale.sku, []);
      procurementSalesBySku.get(sale.sku).push(sale);
    }
    const maxSalesDate = salesRecords.reduce((max, row) => (!max || row.date > max ? row.date : max), "");
    const asOfDate = parseDateValue(input.asOfDate) || maxSalesDate;
    const asOfMs = dateToUtcMs(asOfDate);
    if (!asOfMs) throw new Error("無法判斷銷售資料截止日，請確認結帳時間與銷售截止日。");
    const maxSalesMs = dateToUtcMs(maxSalesDate);
    const salesDateGapDays = maxSalesMs == null ? null : Math.abs(Math.round((asOfMs - maxSalesMs) / 86400000));
    const priorYearDate = new Date(asOfMs);
    priorYearDate.setUTCFullYear(priorYearDate.getUTCFullYear() - 1);
    const priorYearMs = priorYearDate.getTime();
    const checkpoint = input.checkpoint || "month-start";
    const takeRecords = (input.salesReports || []).flatMap((report) => report.takeRecords || []);
    const physicalTakeByOrderSku = new Map();
    takeRecords.forEach((row) => {
      if (!row.sourceOrder || !/^R\d{2}$/.test(row.warehouseCode || "") || row.shipWarehouseCode !== "T00") return;
      const key = compositeKey(row.sourceOrder, row.sku);
      physicalTakeByOrderSku.set(key, (physicalTakeByOrderSku.get(key) || 0) + Math.max(0, Number(row.deductQuantity || row.quantity || 0)));
    });
    const remainingPhysicalTake = new Map(physicalTakeByOrderSku);
    const channelTotals42 = new Map();
    const skuChannel42 = new Map();
    const skuChannel84 = new Map();
    const skuDirect42 = new Map();
    const skuDirect84 = new Map();
    for (const sale of procurementSalesRecords) {
      const saleMs = dateToUtcMs(sale.date);
      if (saleMs == null || saleMs > asOfMs) continue;
      const ageDays = Math.floor((asOfMs - saleMs) / 86400000);
      if (ageDays < 0 || ageDays >= 84) continue;
      const channelKey = salesChannelKey(sale);
      const quantity = Number(sale.quantity || 0);
      const skuChannelKey = compositeKey(sale.sku, channelKey);
      skuChannel84.set(skuChannelKey, (skuChannel84.get(skuChannelKey) || 0) + quantity);
      let directQuantity = 0;
      if (sale.saleType === "訂貨" && quantity > 0 && /^R\d{2}$/.test(sale.warehouseCode || "") && sale.sourceOrder) {
        const orderKey = compositeKey(sale.sourceOrder, sale.sku);
        const availableTake = Math.max(0, remainingPhysicalTake.get(orderKey) || 0);
        directQuantity = Math.min(quantity, availableTake);
        if (directQuantity > 0) remainingPhysicalTake.set(orderKey, availableTake - directQuantity);
      }
      skuDirect84.set(skuChannelKey, (skuDirect84.get(skuChannelKey) || 0) + directQuantity);
      if (ageDays < 42) {
        const totals = channelTotals42.get(channelKey) || { actualAmount: 0, quantity: 0 };
        totals.actualAmount += Number(sale.actualAmount || 0);
        totals.quantity += quantity;
        channelTotals42.set(channelKey, totals);
        skuChannel42.set(skuChannelKey, (skuChannel42.get(skuChannelKey) || 0) + quantity);
        skuDirect42.set(skuChannelKey, (skuDirect42.get(skuChannelKey) || 0) + directQuantity);
      }
    }
    const plannedRevenueByChannel = new Map();
    (input.revenueChannels || []).forEach((channel) => {
      const key = plannedChannelKey(channel);
      const current = plannedRevenueByChannel.get(key) || { amount: 0, company: String(channel.company || "").trim(), label: String(channel.channel || "").trim() };
      current.amount += Math.max(0, Number(channel.amount || 0));
      if (!current.company) current.company = String(channel.company || "").trim();
      if (!current.label) current.label = String(channel.channel || "").trim();
      plannedRevenueByChannel.set(key, current);
    });
    const channelFactor = (key) => {
      const plan = plannedRevenueByChannel.get(key);
      if (!plan) return 1;
      const baselineMonthlyRevenue = Math.max(0, Number(channelTotals42.get(key)?.actualAmount || 0)) / 42 * 30;
      const rawFactor = baselineMonthlyRevenue > 0 ? plan.amount / baselineMonthlyRevenue : (plan.amount > 0 ? 1 : 0);
      return Math.max(0, Math.min(3, rawFactor));
    };
    const activeStoreCodes = new Set();
    for (const key of [...plannedRevenueByChannel.keys(), ...channelTotals42.keys()]) if (/^R\d{2}$/.test(key) && key !== "R09") activeStoreCodes.add(key);
    for (const need of storeTransferNeeds) {
      const storeCode = normalizeSku(need.storeCode || need.store_code);
      if (/^R\d{2}$/.test(storeCode) && storeCode !== "R09") activeStoreCodes.add(storeCode);
    }
    for (const record of transfers.records) {
      const effectiveState = transferStateAtDate(record, input.inventoryDate || input.asOfDate);
      if ((effectiveState === "submitted" || effectiveState === "shipped") && /^R\d{2}$/.test(record.destinationWarehouseCode) && record.destinationWarehouseCode !== "R09") {
        activeStoreCodes.add(record.destinationWarehouseCode);
      }
    }
    const inventoryBySkuWarehouse = new Map();
    (input.inventory.records || []).forEach((record) => {
      const key = compositeKey(record.sku, record.warehouseCode);
      inventoryBySkuWarehouse.set(key, (inventoryBySkuWarehouse.get(key) || 0) + Number(record.quantity || 0));
    });
    const projectedInventoryBySkuWarehouse = new Map(inventoryBySkuWarehouse);
    for (const [key, adjustment] of transfers.adjustmentBySkuWarehouse) {
      projectedInventoryBySkuWarehouse.set(key, (projectedInventoryBySkuWarehouse.get(key) || 0) + adjustment);
    }
    const demandBySku = new Map();

    const ensureDemand = (sku, name = "") => {
      if (!demandBySku.has(sku)) {
        demandBySku.set(sku, {
          sku,
          name,
          recent6Qty: 0,
          recent12Qty: 0,
          lastYear6Qty: 0,
          weekly12: Array(12).fill(0),
          hqRecent12Qty: 0,
          storeRecent12Qty: 0,
          actualAmount12: 0,
          sourceFiles: new Set()
        });
      }
      return demandBySku.get(sku);
    };

    for (const sale of procurementSalesRecords) {
      const saleMs = dateToUtcMs(sale.date);
      if (saleMs == null || saleMs > asOfMs) continue;
      const demand = ensureDemand(sale.sku, sale.name);
      const ageDays = Math.floor((asOfMs - saleMs) / 86400000);
      if (ageDays >= 0 && ageDays < 84) {
        demand.recent12Qty += sale.quantity;
        demand.actualAmount12 += sale.actualAmount;
        demand.weekly12[Math.floor(ageDays / 7)] += sale.quantity;
        const isHeadquarters = /^(T|W)/.test(sale.warehouseCode || "") || /(總倉|線上|電商)/.test(`${sale.warehouseName || ""}${sale.ecommercePlatform || ""}`);
        if (isHeadquarters) demand.hqRecent12Qty += sale.quantity;
        else demand.storeRecent12Qty += sale.quantity;
        if (ageDays < 42) demand.recent6Qty += sale.quantity;
      }
      const lastYearAgeDays = Math.floor((priorYearMs - saleMs) / 86400000);
      if (lastYearAgeDays >= 0 && lastYearAgeDays < 42) demand.lastYear6Qty += sale.quantity;
      if (sale.fileName) demand.sourceFiles.add(sale.fileName);
    }
    for (const [sku, purchase] of pending.bySku) ensureDemand(sku, purchase.name);
    for (const need of storeTransferNeeds) ensureDemand(normalizeSku(need.sku), String(need.productName || need.product_name || ""));

    const candidates = [];
    const productExclusions = [];
    const customSalesSkus = new Set();
    for (const sale of salesRecords) {
      const masterRecord = input.master.bySku.get(sale.sku);
      const effectiveName = masterRecord?.name || sale.name;
      if (!isAutomaticProcurementExcludedItem(sale.sku, effectiveName) || customSalesSkus.has(sale.sku)) continue;
      customSalesSkus.add(sale.sku);
      productExclusions.push({
        type: CONFIRMED_COMBINATION_SKUS.has(sale.sku) ? "組合品號排除" : isEightBySevenCustomItem(effectiveName) ? "8×7尺客製尺寸排除" : "一次性客製品號排除",
        sourceRow: masterRecord?.sourceRow || sale.sourceRow || "",
        sku: sale.sku,
        supplierSku: masterRecord?.supplierSku || "",
        supplier: masterRecord?.supplier || "未辨識供應商",
        name: effectiveName,
        action: customerCustomExclusionReason(sale.sku, effectiveName)
      });
    }
    for (const demand of demandBySku.values()) {
      const masterRecord = input.master.bySku.get(demand.sku);
      const inventory = input.inventory.bySku.get(demand.sku);
      const purchase = pending.bySku.get(demand.sku);
      const hasStoreTransferNeed = [...storeTransferNeedBySkuStore.keys()].some((key) => key.startsWith(`${demand.sku}\t`));
      if (input.onlyStoreTransferNeedSkus && !hasStoreTransferNeed) continue;
      if (Math.max(0, demand.recent12Qty) <= 0 && !purchase && !hasStoreTransferNeed) continue;
      const effectiveName = masterRecord?.name || demand.name;
      if (isAutomaticProcurementExcludedItem(demand.sku, effectiveName)) {
        if (!customSalesSkus.has(demand.sku)) productExclusions.push({
            type: CONFIRMED_COMBINATION_SKUS.has(demand.sku) ? "組合品號排除" : isEightBySevenCustomItem(effectiveName) ? "8×7尺客製尺寸排除" : "一次性客製品號排除",
            sourceRow: masterRecord?.sourceRow || "",
            sku: demand.sku,
            supplierSku: masterRecord?.supplierSku || "",
            supplier: masterRecord?.supplier || "未辨識供應商",
            name: effectiveName,
            action: customerCustomExclusionReason(demand.sku, effectiveName)
          });
        continue;
      }
      if (masterRecord?.sellThroughStop || isSellThroughStopName(effectiveName)) {
        productExclusions.push({
          type: "品名結尾停採標記(S)",
          sourceRow: masterRecord?.sourceRow || "",
          sku: demand.sku,
          supplierSku: masterRecord?.supplierSku || "",
          supplier: masterRecord?.supplier || "未辨識供應商",
          name: effectiveName,
          action: "停止對外採購與新增寄庫；保留線上銷售、庫存追蹤及門市由總倉現貨調撥"
        });
      }
      const blocked = blacklistMatch({
        sku: demand.sku,
        supplierSku: masterRecord?.supplierSku || "",
        name: masterRecord?.name || demand.name,
        labelName: "",
        spec: ""
      }, blacklist);
      if (blocked || CONFIRMED_EXCLUSIONS[demand.sku]) continue;
      const q12 = Math.max(0, demand.recent12Qty);
      const unitCost = Math.max(0, Number(masterRecord?.unitCost || 0));
      candidates.push({
        demand,
        masterRecord,
        inventory,
        purchase,
        demandValue: q12 * (unitCost || 1)
      });
    }

    const totalDemandValue = candidates.reduce((sum, row) => sum + row.demandValue, 0);
    let cumulativeValue = 0;
    for (const row of [...candidates].sort((left, right) => right.demandValue - left.demandValue)) {
      const startingShare = totalDemandValue > 0 ? cumulativeValue / totalDemandValue : 1;
      row.abcClass = startingShare < PROCUREMENT_POLICY.abcThresholds.A ? "A" : startingShare < PROCUREMENT_POLICY.abcThresholds.B ? "B" : "C";
      cumulativeValue += row.demandValue;
    }

    const preliminary = candidates.map((candidate) => {
      const { demand, masterRecord } = candidate;
      const modelRow = input.model?.bySku?.get(demand.sku);
      const recent6Daily = Math.max(0, demand.recent6Qty) / 42;
      const recent12Daily = Math.max(0, demand.recent12Qty) / 84;
      const lastYearDaily = Math.max(0, demand.lastYear6Qty) / 42;
      const selected = applyDemandModel(modelRow?.skuModel || "近期6週", recent6Daily, recent12Daily, lastYearDaily);
      const xyz = classifyXyz(demand.weekly12);
      const activeWeeks6 = demand.weekly12.slice(0, 6).filter((value) => value > 0).length;
      const trendRatio = recent12Daily > 0 ? recent6Daily / recent12Daily : (recent6Daily > 0 ? 2 : 0);
      const tier = demandTier(candidate.abcClass, xyz.xyzClass, Math.max(0, demand.recent6Qty), trendRatio, activeWeeks6);
      const materialCategory = modelRow?.materialCategory || inferMaterialCategory(masterRecord, demand.name);
      const categoryFallback = input.model?.byMaterial?.get(materialCategory);
      const listedDate = parseDateValue(masterRecord?.listedDate);
      const listedMs = dateToUtcMs(listedDate);
      const newProductActiveDays = listedMs != null && listedMs <= asOfMs ? Math.floor((asOfMs - listedMs) / 86400000) + 1 : null;
      return {
        ...candidate,
        modelRow,
        recent6Daily,
        recent12Daily,
        lastYearDaily,
        skuForecastDaily: Math.max(0, selected.daily),
        skuUsedModel: selected.usedModel,
        skuSeasonalDataReady: selected.seasonalDataReady,
        xyzClass: xyz.xyzClass,
        activeWeeks12: xyz.activeWeeks,
        activeWeeks6,
        variabilityCv: xyz.cv,
        trendRatio,
        tier,
        materialCategory,
        categoryKey: modelRow?.categoryName && modelRow.categoryName !== "無" ? modelRow.categoryName : materialCategory,
        categoryModel: modelRow?.categoryModel || categoryFallback?.model || "近期6週",
        categoryWape: modelRow?.categoryWape ?? categoryFallback?.wape ?? null,
        categoryReliability: modelRow?.categoryReliability || categoryFallback?.reliability || "無",
        listedDate,
        newProductActiveDays
      };
    });

    const matureComparableRows = preliminary.filter((row) => {
      const name = row.masterRecord?.name || row.demand.name;
      return !(row.newProductActiveDays != null && row.newProductActiveDays <= 42)
        && !row.masterRecord?.discontinued
        && !row.masterRecord?.sellThroughStop
        && !isAutomaticProcurementExcludedItem(row.demand.sku, name)
        && !/贈品/.test(`${name} ${row.masterRecord?.stockType || ""}`)
        && row.skuForecastDaily >= 0;
    });
    const comparablePools = new Map();
    const addComparable = (key, daily) => {
      if (!key) return;
      if (!comparablePools.has(key)) comparablePools.set(key, []);
      comparablePools.get(key).push(daily);
    };
    for (const peer of matureComparableRows) {
      const material = normalizeText(peer.materialCategory || "其它");
      const type = comparableProductType(peer.masterRecord, peer.demand.name);
      const size = comparableSize(peer.masterRecord, peer.demand.name);
      addComparable(`detail||${material}||${type}||${size}`, peer.skuForecastDaily);
      addComparable(`type||${material}||${type}`, peer.skuForecastDaily);
      addComparable(`material||${material}`, peer.skuForecastDaily);
    }
    const resolveComparableBaseline = (row) => {
      const material = normalizeText(row.materialCategory || "其它");
      const type = comparableProductType(row.masterRecord, row.demand.name);
      const size = comparableSize(row.masterRecord, row.demand.name);
      const candidates = [
        { key: `detail||${material}||${type}||${size}`, label: `${row.materialCategory}＋${type}＋${size}` },
        { key: `type||${material}||${type}`, label: `${row.materialCategory}＋${type}` },
        { key: `material||${material}`, label: `${row.materialCategory}` }
      ];
      for (const candidate of candidates) {
        const values = comparablePools.get(candidate.key) || [];
        if (values.length < 3) continue;
        return { daily: trimmedMean(values), sampleCount: values.length, label: candidate.label };
      }
      return { daily: row.skuForecastDaily, sampleCount: 0, label: "成熟同類樣本不足，沿用新品近期實績" };
    };
    for (const row of preliminary) {
      if (row.newProductActiveDays == null || row.newProductActiveDays > 42) continue;
      const validSales = (procurementSalesBySku.get(row.demand.sku) || []).filter((sale) => {
        const saleMs = dateToUtcMs(sale.date);
        return saleMs != null && saleMs >= dateToUtcMs(row.listedDate) && saleMs <= asOfMs && !isPublicRelationsMovement(sale);
      });
      const netQuantity = Math.max(0, validSales.reduce((sum, sale) => sum + Number(sale.quantity || 0), 0));
      const actualDaily = netQuantity / Math.max(1, row.newProductActiveDays);
      const comparable = resolveComparableBaseline(row);
      const weights = newProductWeights(row.newProductActiveDays, actualDaily, comparable.daily, netQuantity);
      row.newProductDemand = {
        activeDays: row.newProductActiveDays,
        netQuantity,
        actualDaily,
        categoryDaily: Math.max(0, Number(comparable.daily || 0)),
        categorySampleCount: comparable.sampleCount,
        categoryLabel: comparable.label,
        ...weights,
        blendedDaily: actualDaily * weights.actualWeight + Math.max(0, Number(comparable.daily || 0)) * weights.categoryWeight
      };
    }

    const categoryPools = new Map();
    for (const row of preliminary) {
      const key = `${row.categoryKey}||${row.categoryModel}`;
      if (!categoryPools.has(key)) {
        categoryPools.set(key, { key, recent6Daily: 0, recent12Daily: 0, lastYearDaily: 0, skuBaseDaily: 0, rows: [] });
      }
      const pool = categoryPools.get(key);
      pool.recent6Daily += row.recent6Daily;
      pool.recent12Daily += row.recent12Daily;
      pool.lastYearDaily += row.lastYearDaily;
      pool.skuBaseDaily += row.skuForecastDaily;
      pool.rows.push(row);
    }
    for (const pool of categoryPools.values()) {
      const sample = pool.rows[0];
      const categoryForecast = applyDemandModel(sample.categoryModel, pool.recent6Daily, pool.recent12Daily, pool.lastYearDaily);
      const rawFactor = pool.skuBaseDaily > 0 ? categoryForecast.daily / pool.skuBaseDaily : 1;
      let factor = Number.isFinite(rawFactor) ? rawFactor : 1;
      let usedModel = categoryForecast.usedModel;
      let seasonalDataReady = categoryForecast.seasonalDataReady;
      if (!seasonalDataReady) {
        const indices = input.model?.seasonalIndexByMaterial?.get(sample.materialCategory);
        if (indices?.size) {
          const currentSlot = seasonalSlotFromMs(asOfMs);
          const targetSlot = seasonalSlotFromMs(asOfMs + (PROCUREMENT_POLICY.reviewDays * 86400000));
          const recentIndices = [currentSlot, (currentSlot + 26) % 27, (currentSlot + 25) % 27]
            .map((slot) => indices.get(slot)).filter((value) => Number.isFinite(value) && value > 0);
          const targetIndex = indices.get(targetSlot);
          if (recentIndices.length && Number.isFinite(targetIndex) && targetIndex > 0) {
            const recentIndex = recentIndices.reduce((sum, value) => sum + value, 0) / recentIndices.length;
            factor = targetIndex / recentIndex;
            usedModel = `${sample.categoryModel}＋類別季節指數`;
            seasonalDataReady = true;
          }
        }
      }
      pool.factor = Math.max(0.6, Math.min(1.4, factor));
      pool.usedModel = usedModel;
      pool.seasonalDataReady = seasonalDataReady;
    }

    const factoryTargetDays = Number(input.factoryTargetDays || 90);
    const rows = preliminary.map((row) => {
      const pool = categoryPools.get(`${row.categoryKey}||${row.categoryModel}`);
      const supplier = row.masterRecord?.supplier || "未辨識供應商";
      const supplierRule = findSupplierRule(supplier, input.supplierRules || []);
      const supplyProfile = resolveSupplyProfile(supplier, input.supplierRules || [], row.tier);
      const supplierLeadDays = supplyProfile.leadDays;
      const reviewDays = supplyProfile.reviewDays;
      const safetyBufferDays = supplyProfile.safetyBufferDays[row.tier];
      const targetCoverageDays = reviewDays + supplierLeadDays + safetyBufferDays;
      const seasonalProfile = seasonalProfileForRow(input.model, row);
      const seasonalAdjustment = horizonSeasonalAdjustment(seasonalProfile, asOfMs, targetCoverageDays);
      const seasonalMode = seasonalDemandMode(row);
      const adoptedSeasonalFactor = effectiveSeasonalFactor(seasonalAdjustment.factor, seasonalMode);
      const demandBaseDaily = row.newProductDemand?.blendedDaily ?? row.skuForecastDaily;
      const ratioAdjustedDaily = demandBaseDaily * (pool?.factor || 1) * adoptedSeasonalFactor;
      const strongSeasonalSku = /^強(夏|冬)季$/.test(seasonalMode);
      const seasonalHistoryRepeated = strongSeasonalSku && hasRepeatedSeasonalPeak(seasonalProfile);
      const seasonalHistoricalDailyQty = seasonalHistoryRepeated
        ? historicalSeasonalAverageDaily(seasonalProfile, asOfMs, targetCoverageDays)
        : null;
      const adjustedDaily = seasonalHistoricalDailyQty == null
        ? ratioAdjustedDaily
        : Math.max(ratioAdjustedDaily, seasonalHistoricalDailyQty);
      const seasonalDemandBasis = seasonalHistoricalDailyQty != null && seasonalHistoricalDailyQty > ratioAdjustedDaily
        ? "SKU同季歷史絕對量"
        : (seasonalProfile ? (/^四季－/.test(seasonalMode) ? "近期速度×溫和季節曲線" : "近期速度×季節曲線") : "近期速度");
      const channelKeys = new Set([...channelTotals42.keys(), ...plannedRevenueByChannel.keys()]);
      const shares42 = [...channelKeys].map((key) => [key, Math.max(0, skuChannel42.get(compositeKey(row.demand.sku, key)) || 0)]).filter(([, quantity]) => quantity > 0);
      const shares84 = [...channelKeys].map((key) => [key, Math.max(0, skuChannel84.get(compositeKey(row.demand.sku, key)) || 0)]).filter(([, quantity]) => quantity > 0);
      const channelShares = shares42.length ? shares42 : shares84;
      const directMap = shares42.length ? skuDirect42 : skuDirect84;
      const shareTotal = channelShares.reduce((sum, [, quantity]) => sum + quantity, 0);
      let hqDailyQty = 0;
      const storeDailyByCode = Object.fromEntries([...activeStoreCodes].map((code) => [code, 0]));
      const storeDirectDailyByCode = Object.fromEntries([...activeStoreCodes].map((code) => [code, 0]));
      if (shareTotal > 0) {
        for (const [channelKey, quantity] of channelShares) {
          const channelDaily = adjustedDaily * quantity / shareTotal * channelFactor(channelKey);
          if (!/^R\d{2}$/.test(channelKey) || channelKey === "R09") {
            hqDailyQty += channelDaily;
            continue;
          }
          const directQuantity = Math.max(0, directMap.get(compositeKey(row.demand.sku, channelKey)) || 0);
          const directShare = Math.max(0, Math.min(1, directQuantity / quantity));
          hqDailyQty += channelDaily * directShare;
          storeDirectDailyByCode[channelKey] = (storeDirectDailyByCode[channelKey] || 0) + channelDaily * directShare;
          storeDailyByCode[channelKey] = (storeDailyByCode[channelKey] || 0) + channelDaily * (1 - directShare);
        }
      } else {
        hqDailyQty = adjustedDaily;
      }
      const storeDailyQty = Object.values(storeDailyByCode).reduce((sum, quantity) => sum + Number(quantity || 0), 0);
      const channelAdjustedDaily = hqDailyQty + storeDailyQty;
      const horizonDays = reviewDays + supplierLeadDays;
      const springFestival = resolveSpringFestivalAdjustment({
        asOfDate,
        supplierCountry: supplierRule?.country || "待確認",
        horizonDays,
        rule: input.springFestivalRule
      });
      let springFestivalExtraDailyQty = channelAdjustedDaily;
      let springFestivalHistoricalDailyQty = null;
      if (springFestival.active && springFestival.extraDays > 0 && seasonalProfile) {
        const extraStartMs = asOfMs + horizonDays * 86400000;
        const extraFutureIndex = averageSeasonalIndex(seasonalProfile.indices, extraStartMs, springFestival.extraDays, 1);
        const recentIndex = seasonalAdjustment.recentIndex;
        const rawExtraFactor = recentIndex && extraFutureIndex ? extraFutureIndex / recentIndex : seasonalAdjustment.factor;
        const limits = seasonalProfile.reliability === "高" ? [0.5, 4] : [0.65, 3];
        const extraFactor = effectiveSeasonalFactor(Math.max(limits[0], Math.min(limits[1], rawExtraFactor || 1)), seasonalMode);
        const ratioExtraDaily = demandBaseDaily * (pool?.factor || 1) * extraFactor;
        springFestivalHistoricalDailyQty = seasonalHistoryRepeated
          ? historicalSeasonalAverageDaily(seasonalProfile, extraStartMs, springFestival.extraDays)
          : null;
        const extraBaseDaily = springFestivalHistoricalDailyQty == null
          ? ratioExtraDaily
          : Math.max(ratioExtraDaily, springFestivalHistoricalDailyQty);
        const channelMultiplier = adjustedDaily > 0 ? channelAdjustedDaily / adjustedDaily : 1;
        springFestivalExtraDailyQty = extraBaseDaily * channelMultiplier;
      }
      const forecastFutureQty = channelAdjustedDaily * horizonDays;
      const hqSafetyStockQty = hqDailyQty * safetyBufferDays;
      let storeDemandQty = 0;
      let modelStoreDemandQty = 0;
      let storeSafetyStockQty = 0;
      const storeDemandByCode = {};
      const storeInventoryByCode = {};
      const storeTransferNeedByCode = {};
      let earliestStoreNeedDate = null;
      for (const storeCode of activeStoreCodes) {
        const storeDaily = Math.max(0, Number(storeDailyByCode[storeCode] || 0));
        const currentStoreInventory = Math.max(0, Number(projectedInventoryBySkuWarehouse.get(compositeKey(row.demand.sku, storeCode)) || 0));
        const storeSafety = storeTargetQty(storeDaily, row.tier);
        const modelStoreNeed = Math.max(storeDaily * horizonDays + storeSafety - currentStoreInventory, 0);
        const confirmedNeed = storeTransferNeedBySkuStore.get(compositeKey(row.demand.sku, storeCode));
        const storeNeed = Math.max(modelStoreNeed, Number(confirmedNeed?.quantity || 0));
        storeInventoryByCode[storeCode] = currentStoreInventory;
        storeDemandByCode[storeCode] = storeNeed;
        storeTransferNeedByCode[storeCode] = Number(confirmedNeed?.quantity || 0);
        if (confirmedNeed?.neededBy && (!earliestStoreNeedDate || confirmedNeed.neededBy < earliestStoreNeedDate)) earliestStoreNeedDate = confirmedNeed.neededBy;
        storeSafetyStockQty += storeSafety;
        modelStoreDemandQty += modelStoreNeed;
        storeDemandQty += storeNeed;
      }
      const hqDemandQty = hqDailyQty * horizonDays + hqSafetyStockQty;
      const safetyStockQty = hqSafetyStockQty + storeSafetyStockQty;
      const hqUsableCodes = ["T00", "R19", "R09"];
      const inventoryQty = hqUsableCodes.reduce((sum, code) => sum + Math.max(0, Number(projectedInventoryBySkuWarehouse.get(compositeKey(row.demand.sku, code)) || 0)), 0);
      const actualHqInventoryQty = hqUsableCodes.reduce((sum, code) => sum + Math.max(0, Number(inventoryBySkuWarehouse.get(compositeKey(row.demand.sku, code)) || 0)), 0);
      const excludedInventoryQty = Math.max(0, Number(row.inventory?.quantity || 0) - actualHqInventoryQty);
      const pendingQty = row.purchase?.quantity || 0;
      const timelyPendingQty = earliestStoreNeedDate
        ? (row.purchase?.deliveries || []).reduce((sum, delivery) => sum + (delivery.deliveryDate && delivery.deliveryDate <= earliestStoreNeedDate ? Math.max(0, Number(delivery.quantity || 0)) : 0), 0)
        : pendingQty;
      const effectivePendingQty = earliestStoreNeedDate ? Math.min(pendingQty, timelyPendingQty) : pendingQty;
      const pendingDeliveryDates = (row.purchase?.deliveries || []).map((delivery) => parseDateValue(delivery.deliveryDate)).filter(Boolean).sort();
      const earliestPendingDeliveryDate = pendingDeliveryDates[0] || null;
      const confirmedStoreNeedQty = Object.values(storeTransferNeedByCode).reduce((sum, value) => sum + Number(value || 0), 0);
      const demandSources = [];
      if (hqDemandQty > 0) demandSources.push("總部需求");
      if (modelStoreDemandQty > 0) demandSources.push("門市模型需求");
      if (confirmedStoreNeedQty > 0) demandSources.push("門市核准未配");
      const originalDemandSource = demandSources.join("＋") || "無需求";
      let pendingArrivalStatus = "無門市回拋需求";
      let pendingArrivalGap = "—";
      if (earliestStoreNeedDate) {
        if (pendingQty <= 0) {
          pendingArrivalStatus = "無未到貨可抵扣";
          pendingArrivalGap = "無未到貨覆蓋";
        } else if (!earliestPendingDeliveryDate) {
          pendingArrivalStatus = "未提供到貨日，不能抵扣";
          pendingArrivalGap = "到貨日未提供";
        } else {
          const gapDays = Math.round((dateToUtcMs(earliestPendingDeliveryDate) - dateToUtcMs(earliestStoreNeedDate)) / 86400000);
          pendingArrivalGap = gapDays > 0 ? `晚${gapDays}天` : gapDays < 0 ? `提前${Math.abs(gapDays)}天` : "同日到貨";
          pendingArrivalStatus = effectivePendingQty <= 0
            ? "未到貨晚於需要日，不能抵扣"
            : effectivePendingQty >= confirmedStoreNeedQty
              ? "可於需要日前完整覆蓋門市未配"
              : `可於需要日前部分抵扣${effectivePendingQty}件`;
        }
      }
      const transfer = transfers.bySku.get(row.demand.sku);
      const rawPurchaseQty = calculateNetProcurementDemand({
        forecastDemandQty: hqDemandQty + storeDemandQty,
        safetyStockQty: 0,
        availableInventoryQty: inventoryQty,
        pendingPurchaseQty: effectivePendingQty,
        factoryConsignmentQty: resolvedConsignment.bySku.get(row.demand.sku)?.currentQty || 0
      });
      const springFestivalAdjustedRawPurchaseQty = springFestival.active
        ? calculateNetProcurementDemand({
          forecastDemandQty: hqDemandQty + storeDemandQty + springFestivalExtraDailyQty * springFestival.extraDays,
          safetyStockQty: 0,
          availableInventoryQty: inventoryQty,
          pendingPurchaseQty: effectivePendingQty,
          factoryConsignmentQty: resolvedConsignment.bySku.get(row.demand.sku)?.currentQty || 0
        })
        : rawPurchaseQty;
      const springFestivalUncoveredRawQty = Math.max(springFestivalAdjustedRawPurchaseQty - rawPurchaseQty, 0);
      const springFestivalCycleStart = springFestival.closureStart ? addDays(springFestival.closureStart, -horizonDays) : "";
      const priorSpringFestivalPendingQty = springFestival.active
        ? Math.min(effectivePendingQty, (row.purchase?.orders || []).reduce((sum, order) => {
          const purchaseDate = parseDateValue(order.purchaseDate);
          if (!purchaseDate || purchaseDate < springFestivalCycleStart || purchaseDate > asOfDate) return sum;
          return sum + Math.max(0, Number(order.quantity || 0));
        }, 0))
        : 0;
      const springFestivalExtraRawQty = Math.max(springFestivalUncoveredRawQty - priorSpringFestivalPendingQty, 0);
      const score = recommendationScore(row.tier, row.xyzClass, row.activeWeeks6);
      const sellThroughStop = Boolean(row.masterRecord?.sellThroughStop || isSellThroughStopName(row.masterRecord?.name || row.demand.name));
      const isGift = /贈品/.test(`${row.masterRecord?.name || row.demand.name} ${row.masterRecord?.stockType || ""}`);
      const supplierAutomaticBlocked = supplierRule?.automaticPurchase === false;
      const masterDataIncomplete = !row.masterRecord?.supplier || !(Number(row.masterRecord?.unitCost) > 0) || !(Number(row.masterRecord?.moq) > 0);
      const productStatusPendingReview = !String(row.masterRecord?.productStatus || "").trim();
      const consignment = resolvedConsignment.bySku.get(row.demand.sku);
      const sellThroughConsignmentAvailableQty = sellThroughStop && consignment
        ? Math.max(0, Number(consignment.currentQty || 0) - pendingQty)
        : 0;
      const sellThroughConsignmentAllowed = sellThroughStop && sellThroughConsignmentAvailableQty > 0;
      const externalPurchaseBlocked = Boolean(row.masterRecord?.discontinued || (sellThroughStop && !sellThroughConsignmentAllowed) || isGift || supplierAutomaticBlocked || masterDataIncomplete);
      if ((isGift || supplierAutomaticBlocked || masterDataIncomplete || productStatusPendingReview) && !sellThroughStop && !row.masterRecord?.discontinued) {
        productExclusions.push({
          type: masterDataIncomplete ? "商品主檔必要資料不完整" : (productStatusPendingReview ? "貨品狀態空白待人工確認" : (isGift ? "贈品排除一般採購" : "供應商專屬週期")),
          sourceRow: row.masterRecord?.sourceRow || "",
          sku: row.demand.sku,
          supplierSku: row.masterRecord?.supplierSku || "",
          supplier,
          name: row.masterRecord?.name || row.demand.name,
          action: masterDataIncomplete
            ? "列入待人工確認；補齊供應商、正數進貨價與MOQ前不自動採購"
            : (productStatusPendingReview
              ? "保留試算建議量；第一次回匯必須明確填寫採購量與原因，完成二次確認後才能核准"
              : (isGift ? "排除總部一般自動採購；活動需求另行管理" : `${supplierRule.exclusionReason}；只追蹤人工下單`))
        });
      }
      const manualSupplierReview = Boolean(supplyProfile.manualReview);
      const releaseRate = purchaseReleaseRate(row.tier, checkpoint);
      const standardReleasedPurchaseQty = rawPurchaseQty * releaseRate;
      const releasedPurchaseQty = standardReleasedPurchaseQty + springFestivalExtraRawQty;
      const baseSuggestedPurchaseQty = externalPurchaseBlocked || manualSupplierReview ? 0 : roundSuggestedQuantity(releasedPurchaseQty, score);
      const standardBaseSuggestedPurchaseQty = externalPurchaseBlocked || manualSupplierReview ? 0 : roundSuggestedQuantity(standardReleasedPurchaseQty, score);
      const unitCost = Math.max(0, Number(row.masterRecord?.unitCost || 0));
      const normalizedSupplier = normalizeText(supplier);
      const packSize = purchaseUnitFromRules(supplier, row.masterRecord, row.demand.name, input.purchaseUnitRules);
      const standardDownQty = Math.floor(standardBaseSuggestedPurchaseQty / packSize) * packSize;
      const standardCoverageWithDown = channelAdjustedDaily > 0 ? (inventoryQty + effectivePendingQty + standardDownQty) / channelAdjustedDaily : 9999;
      const downQty = Math.floor(baseSuggestedPurchaseQty / packSize) * packSize;
      const coverageWithDown = channelAdjustedDaily > 0 ? (inventoryQty + effectivePendingQty + downQty) / channelAdjustedDaily : 9999;
      const minimumCoverageDays = /力榮/.test(normalizedSupplier) ? lirongProductionDays : reviewDays + supplierLeadDays;
      const standardPacked = roundByPack(standardBaseSuggestedPurchaseQty, packSize, standardCoverageWithDown, minimumCoverageDays);
      const packed = roundByPack(baseSuggestedPurchaseQty, packSize, coverageWithDown, minimumCoverageDays);
      const standardSuggestedPurchaseQty = externalPurchaseBlocked || manualSupplierReview
        ? 0
        : (sellThroughConsignmentAllowed ? Math.min(standardPacked.quantity, sellThroughConsignmentAvailableQty) : standardPacked.quantity);
      const suggestedPurchaseQty = externalPurchaseBlocked || manualSupplierReview
        ? 0
        : (sellThroughConsignmentAllowed ? Math.min(packed.quantity, sellThroughConsignmentAvailableQty) : packed.quantity);
      const springFestivalExtraSuggestedQty = Math.max(suggestedPurchaseQty - standardSuggestedPurchaseQty, 0);
      const factoryPullQty = pendingQty + suggestedPurchaseQty;
      const consignmentCurrentQty = consignment?.currentQty || 0;
      const consignmentScheduledQty = consignment?.scheduledQty || 0;
      const immediateConsignmentGap = consignment && !externalPurchaseBlocked && !sellThroughStop ? Math.max(factoryPullQty - consignmentCurrentQty, 0) : 0;
      const tierFactoryTargetDays = /普優[瑪碼]/.test(normalizedSupplier) ? Number(puyoumaTargetDays[row.tier] ?? PROCUREMENT_POLICY.puyoumaFactoryTargetDays[row.tier]) : factoryTargetDays;
      const factoryTargetQty = consignment && !externalPurchaseBlocked && !sellThroughStop ? channelAdjustedDaily * tierFactoryTargetDays : 0;
      const rawConsignmentOrderQty = consignment
        ? Math.max(factoryPullQty + channelAdjustedDaily * puyoumaProductionDays + factoryTargetQty - consignmentCurrentQty - consignmentScheduledQty, immediateConsignmentGap, 0)
        : 0;
      const suggestedConsignmentQty = externalPurchaseBlocked || sellThroughStop ? 0 : roundSuggestedQuantity(rawConsignmentOrderQty, Math.max(score, 0.5));
      let supplyStatus = "非寄倉供應商／寄倉品號未命中";
      if (sellThroughStop) {
        supplyStatus = sellThroughConsignmentAllowed
          ? `S品－既有寄庫現貨可拉回${sellThroughConsignmentAvailableQty}件；不得新增生產或新增寄庫`
          : "S品－寄庫現貨已用罄：禁止一般採購、新增生產與新增寄庫；仍可用總倉現貨銷售或調撥";
      } else if (row.masterRecord?.discontinued) {
        supplyStatus = "商品主檔已下架：不對外採購、不新增寄庫";
      } else if (isGift) {
        supplyStatus = "贈品：排除總部一般自動採購，保留稽核";
      } else if (supplierAutomaticBlocked) {
        supplyStatus = `${supplierRule.exclusionReason}：排除一般自動採購`;
      } else if (masterDataIncomplete) {
        supplyStatus = "待人工確認：商品主檔缺供應商、正數進貨價或MOQ；本次不自動採購";
      } else if (productStatusPendingReview) {
        supplyStatus = "待人工確認：貨品狀態空白；已保留試算建議量，第一次回匯須明確填量與原因";
      } else if (manualSupplierReview) {
        supplyStatus = "檢視期未定：保留需求與缺貨風險，採購量由人工判斷";
      } else if (consignment) {
        supplyStatus = immediateConsignmentGap > 0
          ? "缺貨警示：寄倉現貨不足，需新增寄庫單"
          : (suggestedConsignmentQty > 0 ? "現有採購可供應；仍需補足工廠目標" : "寄倉供貨充足");
      }
      if (springFestival.active && springFestivalExtraSuggestedQty > 0) {
        supplyStatus = `${supplyStatus}；春節停工備貨加量${springFestivalExtraSuggestedQty}件`;
      } else if (springFestival.active && priorSpringFestivalPendingQty > 0 && springFestivalUncoveredRawQty > 0) {
        supplyStatus = `${supplyStatus}；前次春節備貨未交${priorSpringFestivalPendingQty}件，本次不重複加量`;
      }
      return {
        sku: row.demand.sku,
        name: row.masterRecord?.name || row.demand.name,
        supplierSku: row.masterRecord?.supplierSku || "",
        supplier,
        supplyProfileKey: supplyProfile.key,
        supplyProfileLabel: supplyProfile.label,
        supplierLeadDays,
        reviewDays,
        reviewPeriodLabel: supplyProfile.reviewPeriodLabel,
        manualSupplierReview,
        paymentRule: supplyProfile.paymentRule,
        supplierCountry: supplierRule?.country || "待確認",
        unitCost,
        productStatus: String(row.masterRecord?.productStatus || "").trim(),
        productStatusPendingReview,
        materialCategory: row.materialCategory,
        purchaseTab: classifyPuyoumaPurchaseTab(row.masterRecord, row.demand.name),
        sizeGroup: row.masterRecord?.sizeGroup || "",
        size: row.masterRecord?.size || "",
        mainCategory: row.masterRecord?.mainCategory || "",
        style1: row.masterRecord?.style1 || "",
        style2: row.masterRecord?.style2 || "",
        recent6Qty: row.demand.recent6Qty,
        recent12Qty: row.demand.recent12Qty,
        lastYear6Qty: row.demand.lastYear6Qty,
        abcClass: row.abcClass,
        xyzClass: row.xyzClass,
        tier: row.tier,
        activeWeeks12: row.activeWeeks12,
        variabilityCv: row.variabilityCv,
        trendRatio: row.trendRatio,
        skuModel: row.newProductDemand ? `新品動態混合（${row.newProductDemand.label}）` : row.skuUsedModel,
        newProductDemand: row.newProductDemand || null,
        categoryModel: pool?.usedModel || row.categoryModel,
        categorySeasonFactor: pool?.factor || 1,
        seasonalProfileSource: seasonalProfile?.source || "無可用季節曲線",
        seasonalProfileReliability: seasonalProfile?.reliability || "無",
        seasonalPeakSlots: seasonalProfile?.peakSlots || "",
        seasonalDemandMode: seasonalMode,
        seasonalHistoryRepeated,
        horizonRawSeasonFactor: seasonalAdjustment.factor,
        horizonSeasonFactor: adoptedSeasonalFactor,
        horizonSeasonFutureIndex: seasonalAdjustment.futureIndex,
        horizonSeasonRecentIndex: seasonalAdjustment.recentIndex,
        seasonalHistoricalDailyQty,
        seasonalDemandBasis,
        categoryReliability: row.categoryReliability,
        categoryWape: row.categoryWape,
        seasonalDataReady: Boolean(seasonalProfile) || (row.skuSeasonalDataReady && (pool?.seasonalDataReady ?? true)),
        forecastDailyQty: channelAdjustedDaily,
        baseForecastDailyQty: adjustedDaily,
        hqDailyQty,
        storeDailyQty,
        storeDailyByCode,
        storeDirectDailyByCode,
        storeInventoryByCode,
        storeDemandByCode,
        storeTransferNeedByCode,
        storeTransferNeedQty: confirmedStoreNeedQty,
        earliestStoreNeedDate,
        originalDemandSource,
        earliestPendingDeliveryDate,
        pendingArrivalStatus,
        pendingArrivalGap,
        reviewDays,
        safetyDays: safetyBufferDays,
        safetyBufferDays,
        targetCoverageDays,
        forecastFutureQty,
        safetyStockQty,
        inventoryQty,
        excludedInventoryQty,
        pendingQty,
        effectivePendingQty,
        transferSubmittedQty: transfer?.submittedQty || 0,
        transferInTransitQty: transfer?.shippedQty || 0,
        rawPurchaseQty,
        releaseRate,
        standardReleasedPurchaseQty,
        releasedPurchaseQty,
        packSize,
        packDownQty: packed.down,
        packUpQty: packed.up,
        packDirection: packed.direction,
        recommendationScore: score,
        standardSuggestedPurchaseQty,
        suggestedPurchaseQty,
        suggestedPurchaseAmount: suggestedPurchaseQty * unitCost,
        springFestivalApplied: springFestival.active && springFestivalExtraSuggestedQty > 0,
        springFestivalClosureStart: springFestival.closureStart,
        springFestivalRecoveryDate: springFestival.recoveryDate,
        springFestivalExtraDays: springFestival.active ? springFestival.extraDays : 0,
        springFestivalExtraDailyQty: springFestival.active ? springFestivalExtraDailyQty : 0,
        springFestivalHistoricalDailyQty: springFestival.active ? springFestivalHistoricalDailyQty : null,
        springFestivalCycleStart,
        priorSpringFestivalPendingQty,
        springFestivalUncoveredRawQty,
        springFestivalExtraRawQty,
        springFestivalExtraSuggestedQty,
        springFestivalExtraAmount: springFestivalExtraSuggestedQty * unitCost,
        consignmentCurrentQty,
        consignmentScheduledQty,
        immediateConsignmentGap,
        factoryTargetDays: tierFactoryTargetDays,
        factoryTargetQty,
        suggestedConsignmentQty,
        supplyStatus,
        sellThroughStop,
        sellThroughConsignmentAllowed,
        sellThroughConsignmentAvailableQty,
        externalPurchaseBlocked,
        automaticExclusionReason: isGift ? "贈品排除一般自動採購" : (supplierAutomaticBlocked ? supplierRule.exclusionReason : ""),
        hqDemandQty,
        storeDemandQty,
        discontinued: Boolean(row.masterRecord?.discontinued),
        listedDate: row.listedDate || "",
        isNewProduct: Boolean(row.newProductActiveDays != null && row.newProductActiveDays <= 42),
        sourceFiles: [...row.demand.sourceFiles],
        scheduleNotes: consignment ? [...consignment.scheduleNotes] : []
      };
    }).sort((left, right) => (
      right.suggestedPurchaseAmount - left.suggestedPurchaseAmount
      || right.suggestedPurchaseQty - left.suggestedPurchaseQty
      || left.sku.localeCompare(right.sku)
    ));

    const kuanMuStoreCodes = new Set([...plannedRevenueByChannel.entries()]
      .filter(([key, plan]) => /^R\d{2}$/.test(key) && plan.company === "寬沐")
      .map(([key]) => key));
    const kuanMuForecastRevenue = [...plannedRevenueByChannel.values()]
      .filter((plan) => plan.company === "寬沐")
      .reduce((sum, plan) => sum + Number(plan.amount || 0), 0);
    let kuanMuOperationalDemandAmount = 0;
    for (const row of rows) {
      for (const storeCode of kuanMuStoreCodes) {
        const localDaily = Math.max(0, Number(row.storeDailyByCode?.[storeCode] || 0));
        const directDaily = Math.max(0, Number(row.storeDirectDailyByCode?.[storeCode] || 0));
        const currentInventory = Math.max(0, Number(row.storeInventoryByCode?.[storeCode] || 0));
        const monthlyTransferQty = Math.max(localDaily * 30 + storeTargetQty(localDaily, row.tier) - currentInventory, 0);
        kuanMuOperationalDemandAmount += (monthlyTransferQty + directDaily * 30) * Number(row.unitCost || 0);
      }
    }
    const kuanMuManagementTargetAmount = kuanMuForecastRevenue * 0.45;
    const kuanMuManagementGapAmount = Math.max(kuanMuManagementTargetAmount - kuanMuOperationalDemandAmount, 0);
    const suggestedRows = rows.filter((row) => row.suggestedPurchaseQty > 0);
    const consignmentRows = rows.filter((row) => row.suggestedConsignmentQty > 0 || row.immediateConsignmentGap > 0);
    return {
      asOfDate,
      sourceMaxSalesDate: maxSalesDate,
      salesDateGapDays,
      salesDateStatus: salesDateGapDays != null && salesDateGapDays <= 3 ? "PASS" : "REVIEW",
      checkpoint,
      rows,
      suggestedRows,
      consignmentRows,
      pending,
      transfers,
      consignment: resolvedConsignment,
      productExclusions,
      factoryTargetDays,
      appliedRules: {
        puyouma: { productionDays: puyoumaProductionDays, targetDays: { ...puyoumaTargetDays } },
        lirong: { productionDays: lirongProductionDays, targetDays: { ...(lirongRules.targetDays || PROCUREMENT_POLICY.lirongFactoryTargetDays) } },
        demandLocations: { hqInventoryCodes: ["T00", "R19", "R09"], activeStoreCodes: [...activeStoreCodes], channelRevenueApplied: plannedRevenueByChannel.size > 0 },
        releaseRates: checkpoint === "month-start" ? { "熱銷": 0.7, "穩定": 0.5, "低銷": 0 } : { "熱銷": 1, "穩定": 1, "低銷": 1 },
        springFestival: { ...(input.springFestivalRule || DEFAULT_SPRING_FESTIVAL_RULE) },
        kuanMuManagementTarget: "寬沐通路預估營收×45%，只顯示管理差額，不自動加進基本採購建議"
      },
      model: input.model,
      totals: {
        analyzedSkuCount: rows.length,
        suggestedSkuCount: suggestedRows.length,
        suggestedPurchaseQty: suggestedRows.reduce((sum, row) => sum + row.suggestedPurchaseQty, 0),
        suggestedPurchaseAmount: suggestedRows.reduce((sum, row) => sum + row.suggestedPurchaseAmount, 0),
        springFestivalSkuCount: rows.filter((row) => row.springFestivalApplied).length,
        springFestivalExtraQty: rows.reduce((sum, row) => sum + Number(row.springFestivalExtraSuggestedQty || 0), 0),
        springFestivalExtraAmount: rows.reduce((sum, row) => sum + Number(row.springFestivalExtraAmount || 0), 0),
        hotSkuCount: rows.filter((row) => row.tier === "熱銷").length,
        stableSkuCount: rows.filter((row) => row.tier === "穩定").length,
        lowSkuCount: rows.filter((row) => row.tier === "低銷").length,
        immediateShortageSkuCount: consignmentRows.filter((row) => row.immediateConsignmentGap > 0).length,
        consignmentSuggestionSkuCount: consignmentRows.length,
        seasonalFallbackSkuCount: rows.filter((row) => !row.seasonalDataReady).length,
        sellThroughStopExcludedCount: productExclusions.length,
        activeTransferDocumentCount: transfers.activeDocumentCount,
        transferSubmittedQty: transfers.submittedQty,
        transferInTransitQty: transfers.shippedQty,
        kuanMuForecastRevenue,
        kuanMuManagementTargetAmount,
        kuanMuOperationalDemandAmount,
        kuanMuManagementGapAmount
      }
    };
  }

  function buildSpecialProcurementAnalysis(input) {
    const base = input.baseAnalysis;
    if (!base?.rows || !input.master?.bySku) throw new Error("請先完成一次最新資料計算，再建立特殊採購流程。");
    const workflowType = input.workflowType === "new_product" ? "new_product" : "manual_draft";
    const sourceRows = Array.isArray(input.rows) ? input.rows : [];
    if (!sourceRows.length) throw new Error(workflowType === "new_product" ? "新品首批名單沒有可處理品項。" : "人工採購草稿沒有可處理品項。");
    const pending = aggregatePendingReports(input.pendingReports || []);
    const rows = sourceRows.map((source) => {
      const sku = normalizeSku(source.sku);
      const masterRecord = input.master.bySku.get(sku);
      if (!masterRecord) throw new Error(`${sku}不在最新商品主檔；請先更新商品主檔再繼續。`);
      if (isAutomaticProcurementExcludedItem(sku, masterRecord.name)) {
        const nextStep = CONFIRMED_COMBINATION_SKUS.has(sku) ? "不得建立組合成品採購。" : "請改由客製採購流程處理。";
        throw new Error(`${sku}為${customerCustomExclusionReason(sku, masterRecord.name)}；${nextStep}`);
      }
      if (!masterRecord.supplier || !(Number(masterRecord.unitCost) > 0) || !(Number(masterRecord.moq) > 0)) {
        throw new Error(`${sku}的商品主檔缺少供應商、正數進貨價或MOQ。`);
      }
      const productStatusPendingReview = !String(masterRecord.productStatus || "").trim();
      const existing = base.rows.find((row) => row.sku === sku);
      const inventoryQty = input.inventory?.bySku?.get(sku)?.availableQuantity ?? input.inventory?.bySku?.get(sku)?.quantity ?? existing?.inventoryQty ?? 0;
      const pendingQty = pending.bySku.get(sku)?.quantity ?? existing?.pendingQty ?? 0;
      const supplier = masterRecord.supplier;
      const supplyProfile = resolveSupplyProfile(supplier, input.supplierRules || [], existing?.tier || "穩定");
      const packSize = purchaseUnitFromRules(supplier, masterRecord, masterRecord.name, input.purchaseUnitRules);
      const requestedQty = workflowType === "new_product" ? Math.max(0, Number(source.firstMonthQty || 0)) : Math.max(0, Number(source.quantity || 0));
      const rawQty = workflowType === "new_product" ? Math.max(requestedQty - inventoryQty - pendingQty, 0) : Math.max(0, Number(existing?.rawPurchaseQty || 0));
      const minimumQty = rawQty > 0 ? Math.max(rawQty, Number(masterRecord.moq || 1)) : 0;
      const suggestedQty = workflowType === "new_product"
        ? Math.ceil(minimumQty / packSize) * packSize
        : Math.max(0, Number(existing?.suggestedPurchaseQty || 0));
      const unitCost = Number(masterRecord.unitCost || 0);
      const baseRow = existing || {};
      return {
        ...baseRow,
        sku,
        name: masterRecord.name,
        supplierSku: masterRecord.supplierSku || "",
        supplier,
        supplyProfileKey: supplyProfile.key,
        supplyProfileLabel: supplyProfile.label,
        supplierLeadDays: supplyProfile.leadDays,
        reviewDays: supplyProfile.reviewDays,
        reviewPeriodLabel: supplyProfile.reviewPeriodLabel,
        manualSupplierReview: false,
        paymentRule: supplyProfile.paymentRule,
        supplierCountry: findSupplierRule(supplier, input.supplierRules || [])?.country || "待確認",
        unitCost,
        productStatus: String(masterRecord.productStatus || "").trim(),
        productStatusPendingReview,
        materialCategory: existing?.materialCategory || inferMaterialCategory(masterRecord, masterRecord.name),
        purchaseTab: classifyPuyoumaPurchaseTab(masterRecord, masterRecord.name),
        recent6Qty: Number(existing?.recent6Qty || 0),
        recent12Qty: Number(existing?.recent12Qty || 0),
        lastYear6Qty: Number(existing?.lastYear6Qty || 0),
        abcClass: existing?.abcClass || "C",
        xyzClass: existing?.xyzClass || "Z",
        tier: existing?.tier || "穩定",
        activeWeeks12: Number(existing?.activeWeeks12 || 0),
        variabilityCv: Number(existing?.variabilityCv || 0),
        trendRatio: Number(existing?.trendRatio || 0),
        skuModel: workflowType === "new_product" ? "新品首月人工預估" : (existing?.skuModel || "人工草稿比對"),
        categoryModel: existing?.categoryModel || (source.similarSku ? `相似品號${source.similarSku}` : "新品人工預估"),
        categorySeasonFactor: Number(existing?.categorySeasonFactor || 1),
        categoryReliability: existing?.categoryReliability || "需人工確認",
        categoryWape: existing?.categoryWape ?? null,
        seasonalDataReady: Boolean(existing?.seasonalDataReady),
        forecastDailyQty: workflowType === "new_product" ? requestedQty / 30 : Number(existing?.forecastDailyQty || 0),
        safetyDays: Number(existing?.safetyDays || 0),
        safetyBufferDays: Number(existing?.safetyBufferDays || 0),
        targetCoverageDays: Number(existing?.targetCoverageDays || supplyProfile.leadDays + supplyProfile.reviewDays),
        forecastFutureQty: workflowType === "new_product" ? requestedQty : Number(existing?.forecastFutureQty || 0),
        safetyStockQty: Number(existing?.safetyStockQty || 0),
        inventoryQty,
        excludedInventoryQty: Number(existing?.excludedInventoryQty || 0),
        pendingQty,
        rawPurchaseQty: rawQty,
        packSize,
        packDownQty: Math.floor(suggestedQty / packSize) * packSize,
        packUpQty: Math.ceil(suggestedQty / packSize) * packSize,
        packDirection: "依特殊流程",
        recommendationScore: Number(existing?.recommendationScore || 0),
        suggestedPurchaseQty: suggestedQty,
        suggestedPurchaseAmount: suggestedQty * unitCost,
        consignmentCurrentQty: Number(existing?.consignmentCurrentQty || 0),
        consignmentScheduledQty: Number(existing?.consignmentScheduledQty || 0),
        immediateConsignmentGap: Number(existing?.immediateConsignmentGap || 0),
        factoryTargetDays: Number(existing?.factoryTargetDays || 0),
        factoryTargetQty: Number(existing?.factoryTargetQty || 0),
        suggestedConsignmentQty: workflowType === "new_product" ? Number(existing?.suggestedConsignmentQty || 0) : 0,
        supplyStatus: productStatusPendingReview
          ? "待人工確認：貨品狀態空白；已保留試算建議量，第一次回匯須明確填量與原因"
          : (workflowType === "new_product" ? `新品首批：${source.channels || "通路待確認"}` : "人工採購草稿：與系統淨需求比較後走兩次回匯"),
        sellThroughStop: Boolean(masterRecord.sellThroughStop),
        externalPurchaseBlocked: Boolean(masterRecord.discontinued || masterRecord.sellThroughStop),
        automaticExclusionReason: "",
        hqDemandQty: workflowType === "new_product" ? requestedQty : Number(existing?.hqDemandQty || 0),
        storeDemandQty: workflowType === "new_product" ? 0 : Number(existing?.storeDemandQty || 0),
        discontinued: Boolean(masterRecord.discontinued),
        isNewProduct: workflowType === "new_product",
        initialManualQty: workflowType === "manual_draft" ? requestedQty : null,
        initialManualReason: workflowType === "manual_draft" ? "人工匯入採購草稿" : "",
        listedDate: source.listedDate || masterRecord.listedDate || "",
        plannedChannels: source.channels || "",
        similarSku: source.similarSku || "",
        marketingIncluded: source.marketingIncluded || "",
        sourceFiles: [input.fileName || (workflowType === "new_product" ? "新品首批名單" : "人工採購草稿")],
        scheduleNotes: []
      };
    });
    const suggestedRows = rows;
    return {
      ...base,
      rows,
      suggestedRows,
      consignmentRows: workflowType === "new_product" ? rows.filter((row) => /普優[瑪碼]/.test(row.supplier)) : [],
      lirongConsignmentRows: [],
      meta: { ...(base.meta || {}), workflowType, workflowLabel: workflowType === "new_product" ? "新品首批採購" : "人工匯入採購單" },
      totals: {
        analyzedSkuCount: rows.length,
        suggestedSkuCount: rows.filter((row) => row.suggestedPurchaseQty > 0 || Number(row.initialManualQty || 0) > 0).length,
        suggestedPurchaseQty: rows.reduce((sum, row) => sum + Number(row.suggestedPurchaseQty || 0), 0),
        suggestedPurchaseAmount: rows.reduce((sum, row) => sum + Number(row.suggestedPurchaseAmount || 0), 0),
        hotSkuCount: rows.filter((row) => row.tier === "熱銷").length,
        stableSkuCount: rows.filter((row) => row.tier === "穩定").length,
        lowSkuCount: rows.filter((row) => row.tier === "低銷").length,
        immediateShortageSkuCount: rows.filter((row) => row.immediateConsignmentGap > 0).length,
        consignmentSuggestionSkuCount: rows.filter((row) => row.suggestedConsignmentQty > 0).length,
        seasonalFallbackSkuCount: rows.filter((row) => !row.seasonalDataReady).length,
        sellThroughStopExcludedCount: rows.filter((row) => row.sellThroughStop).length
      }
    };
  }

  function dateKey(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const date = new Date(`${text}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? "" : text;
  }

  function validateSourceDates(dates, maxGapDays = 14) {
    const valid = Object.entries(dates || {}).filter(([, value]) => dateKey(value));
    if (valid.length < 2) return { status: "REVIEW", gapDays: null, message: "請填入各來源的資料截止日。" };
    const times = valid.map(([, value]) => new Date(`${value}T00:00:00Z`).getTime());
    const gapDays = Math.round((Math.max(...times) - Math.min(...times)) / 86400000);
    return gapDays <= maxGapDays
      ? { status: "PASS", gapDays, message: `來源日期相差${gapDays}天，可進行同時點判斷。` }
      : { status: "REVIEW", gapDays, message: `來源日期相差${gapDays}天；可驗證品號串接，但不可直接判定實際淨需求。` };
  }

  function buildAnalysis(input) {
    const pending = aggregatePendingReports(input.pendingReports || []);
    const transfers = aggregateTransferReports(input.transferReports || [], { asOfDate: input.dates?.inventory });
    const resolvedConsignment = resolveConsignment(input.consignment, input.master, input.blacklist || []);
    const rows = [];
    for (const [sku, purchase] of [...pending.bySku.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const inventory = input.inventory.bySku.get(sku);
      const consignment = resolvedConsignment.bySku.get(sku);
      const supply = evaluateConsignmentSupply({
        confirmedPurchaseQty: purchase.quantity,
        currentConsignmentQty: consignment?.currentQty || 0,
        scheduledBeforeDueQty: consignment?.scheduledQty || 0
      });
      rows.push({
        sku,
        name: input.master.bySku.get(sku)?.name || purchase.name || inventory?.name || consignment?.name || "",
        pendingQty: purchase.quantity,
        pendingAmount: purchase.amount,
        inventoryQty: inventory?.quantity || 0,
        consignmentCurrentQty: consignment?.currentQty || 0,
        consignmentScheduledQty: consignment?.scheduledQty || 0,
        currentGap: supply.currentGap,
        gapAfterSchedule: supply.gapAfterSchedule,
        supplyStatus: consignment ? supply.status : "寄倉品號未命中／非寄倉供應商",
        inventoryMatched: Boolean(inventory),
        consignmentMatched: Boolean(consignment),
        scheduleNotes: consignment ? [...consignment.scheduleNotes] : [],
        purchaseSources: [...purchase.files]
      });
    }
    let dateCheck = validateSourceDates(input.dates || {});
    const inventoryDate = dateKey(input.dates?.inventory);
    const transferDate = dateKey(input.dates?.transfer);
    if (inventoryDate && transferDate) {
      const transferGapDays = Math.abs(Math.round((dateToUtcMs(inventoryDate) - dateToUtcMs(transferDate)) / 86400000));
      if (transferGapDays > 1) {
        dateCheck = {
          status: "REVIEW",
          gapDays: dateCheck.gapDays,
          transferGapDays,
          message: `期間調撥單與庫存截止日相差${transferGapDays}天；無法安全還原中間新增的調撥，請改用同日或相差1天內的完整調撥清單。`
        };
      } else {
        dateCheck = { ...dateCheck, transferGapDays };
      }
    }
    return {
      rows,
      pending,
      transfers,
      consignment: resolvedConsignment,
      dateCheck,
      dates: input.dates || {},
      totals: {
        skuCount: rows.length,
        pendingQty: rows.reduce((sum, row) => sum + row.pendingQty, 0),
        pendingAmount: rows.reduce((sum, row) => sum + row.pendingAmount, 0),
        activeTransferDocumentCount: transfers.activeDocumentCount,
        transferSubmittedQty: transfers.submittedQty,
        transferInTransitQty: transfers.shippedQty,
        inventoryMatched: rows.filter((row) => row.inventoryMatched).length,
        consignmentMatched: rows.filter((row) => row.consignmentMatched).length,
        consignmentCurrentQty: rows.reduce((sum, row) => sum + row.consignmentCurrentQty, 0),
        consignmentScheduledQty: rows.reduce((sum, row) => sum + row.consignmentScheduledQty, 0),
        shortageSkuCount: rows.filter((row) => row.gapAfterSchedule > 0 && row.consignmentMatched).length,
        exceptionCount: resolvedConsignment.exceptions.length,
        confirmedExclusionCount: resolvedConsignment.confirmedExclusions.length,
        excludedCount: resolvedConsignment.excluded.length
      }
    };
  }

  function setColumnWidths(sheet, widths) {
    sheet["!cols"] = widths.map((wch) => ({ wch }));
  }

  function addAutoFilter(sheet) {
    if (sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };
  }

  const EXCEL_CIS = Object.freeze({
    ink: "FF17324D",
    navy: "FF153F63",
    blue: "FF176B87",
    line: "FFD8E4E8",
    softBlue: "FFE8F2F5",
    input: "FFFFF2CC",
    warning: "FFFFE4B5",
    success: "FFE8F4ED",
    danger: "FFFCE8E6",
    excluded: "FFE7EAEC",
    white: "FFFFFFFF"
  });

  function excelFill(rgb) {
    return { patternType: "solid", fgColor: { rgb } };
  }

  function excelBottomBorder(rgb = EXCEL_CIS.line) {
    return { bottom: { style: "thin", color: { rgb } } };
  }

  function applySheetSpacing(sheet) {
    sheet["!margins"] = { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
  }

  function applyTableCis(sheet, XLSX, options = {}) {
    if (!sheet["!ref"]) return;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const headerRow = Number(options.headerRow || 0);
    const headerValues = XLSX.utils.sheet_to_json(sheet, { header: 1, range: headerRow, defval: "" })[0] || [];
    const inputHeaders = new Set(options.inputHeaders || ["人工確認採購量", "人工調整原因", "二次確認採購量", "二次確認原因"]);
    const decisionHeaders = new Set(options.decisionHeaders || [
      "人工確認要求", "加總需求（公式）", "建議採購量", "目前庫存可售至", "系統建議採購後可售至", "目前實際可採購量",
      "人工確認後可售至", "AI判斷", "最終可核准量", "最終可核准金額", "檢核結果", "回匯檢核狀態",
      "春節備貨規則", "春節額外備貨天數", "前次春節備貨未交量", "春節額外建議量", "調整前建議採購量"
    ]);
    const longTextHeaders = new Set(["商品品名", "人工確認要求", "人工調整原因", "AI判斷理由", "規則阻擋原因", "阻擋原因", "供貨狀態", "缺貨／供貨狀態", "二次確認原因", "銷售來源"]);
    const amountHeaders = new Set(["進貨價", "建議採購金額", "春節額外採購金額", "人工回匯金額", "規則阻擋金額", "最終可核准金額", "預計付款金額"]);
    const headerStyle = {
      fill: excelFill(EXCEL_CIS.navy),
      font: { name: "Arial", sz: 10, bold: true, color: { rgb: EXCEL_CIS.white } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: { left: { style: "thin", color: { rgb: EXCEL_CIS.white } }, right: { style: "thin", color: { rgb: EXCEL_CIS.white } } }
    };
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: headerRow, c: column });
      if (!sheet[address]) sheet[address] = { t: "s", v: "" };
      sheet[address].s = headerStyle;
    }
    for (let row = headerRow + 1; row <= range.e.r; row += 1) {
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        if (!sheet[address]) sheet[address] = { t: "s", v: "" };
        const header = String(headerValues[column - range.s.c] || "");
        const value = String(sheet[address].v ?? "");
        let fill = null;
        if (inputHeaders.has(header)) fill = EXCEL_CIS.input;
        else if (decisionHeaders.has(header)) fill = EXCEL_CIS.softBlue;
        if ((header === "AI判斷" || header === "回匯檢核狀態" || header === "檢核結果") && /合理|通過|可送正式核准/.test(value)) fill = EXCEL_CIS.success;
        if ((header === "AI判斷" || header === "回匯檢核狀態" || header === "人工確認要求") && /偏高|偏低|待補|必須|待人工/.test(value)) fill = EXCEL_CIS.warning;
        if ((header === "AI判斷" || header === "回匯檢核狀態" || header === "規則阻擋原因") && /阻擋|排除|轉頁/.test(value)) fill = EXCEL_CIS.excluded;
        if (header === "阻擋原因" && value) fill = EXCEL_CIS.danger;
        sheet[address].s = {
          fill: excelFill(fill || EXCEL_CIS.white),
          font: { name: "Arial", sz: 10, color: { rgb: EXCEL_CIS.ink }, bold: /AI判斷|回匯檢核狀態|最終可核准量|最終可核准金額/.test(header) },
          alignment: { vertical: "center", wrapText: longTextHeaders.has(header) },
          border: excelBottomBorder()
        };
        if (amountHeaders.has(header)) sheet[address].z = "#,##0";
        else if (/率$/.test(header)) sheet[address].z = "0.0%";
        else if (header === "預估日需求") sheet[address].z = "#,##0.000";
      }
    }
    const columnWidths = sheet["!cols"] || [];
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      if (columnWidths[column]) continue;
      const header = String(headerValues[column - range.s.c] || "");
      let wch = 16;
      if (/商品品名/.test(header)) wch = 42;
      else if (/理由|原因|狀態|來源|人工確認要求/.test(header)) wch = 34;
      else if (/可售至|日期|月份/.test(header)) wch = 18;
      else if (/品號|供應商貨號/.test(header)) wch = 20;
      else if (/金額/.test(header)) wch = 18;
      columnWidths[column] = { wch };
    }
    sheet["!cols"] = columnWidths;
    const rowCount = range.e.r + 1;
    sheet["!rows"] = Array.from({ length: rowCount }, (_unused, index) => ({ hpt: index === headerRow ? 34 : (index > headerRow ? 30 : 18) }));
    applySheetSpacing(sheet);
  }

  function applySummaryCis(sheet, XLSX) {
    if (!sheet["!ref"]) return;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const titleStyle = { fill: excelFill(EXCEL_CIS.white), font: { name: "Arial", sz: 16, bold: true, color: { rgb: EXCEL_CIS.ink } }, alignment: { vertical: "center" } };
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: range.s.r, c: column });
      if (!sheet[address]) sheet[address] = { t: "s", v: "" };
      sheet[address].s = titleStyle;
    }
    for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
      const first = String(sheet[XLSX.utils.encode_cell({ r: row, c: range.s.c })]?.v ?? "");
      const second = String(sheet[XLSX.utils.encode_cell({ r: row, c: range.s.c + 1 })]?.v ?? "");
      const isSection = ["指標", "採購預算"].includes(first) || (first && !second && /摘要|規則|預算/.test(first));
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        if (!sheet[address]) sheet[address] = { t: "s", v: "" };
        sheet[address].s = isSection
          ? { fill: excelFill(EXCEL_CIS.blue), font: { name: "Arial", sz: 10, bold: true, color: { rgb: EXCEL_CIS.white } }, alignment: { vertical: "center" } }
          : { fill: excelFill(column === range.s.c && first ? EXCEL_CIS.softBlue : EXCEL_CIS.white), font: { name: "Arial", sz: 10, bold: column === range.s.c, color: { rgb: EXCEL_CIS.ink } }, alignment: { vertical: "center", wrapText: column > range.s.c }, border: first || second ? excelBottomBorder() : undefined };
      }
    }
    sheet["!rows"] = Array.from({ length: range.e.r + 1 }, (_unused, index) => ({ hpt: index === range.s.r ? 28 : 22 }));
    applySheetSpacing(sheet);
  }

  function buildOutputWorkbook(analysis, XLSX) {
    const workbook = XLSX.utils.book_new();
    const summaryRows = [
      ["三來源品號串接與採購規則稽核"],
      ["資料安全", "本檔由瀏覽器本機產生；不修改原始Excel。"],
      ["日期檢核", analysis.dateCheck.status, analysis.dateCheck.message],
      [],
      ["指標", "結果"],
      ["未到貨採購SKU", analysis.totals.skuCount],
      ["未到貨採購數量", analysis.totals.pendingQty],
      ["未到貨採購金額", analysis.totals.pendingAmount],
      ["有效期間調撥單", analysis.totals.activeTransferDocumentCount],
      ["調撥提交中數量", analysis.totals.transferSubmittedQty],
      ["發貨在途數量", analysis.totals.transferInTransitQty],
      ["庫存品號命中", analysis.totals.inventoryMatched],
      ["寄倉品號命中", analysis.totals.consignmentMatched],
      ["寄倉現貨可拉量", analysis.totals.consignmentCurrentQty],
      ["粉紅底未完成排程量", analysis.totals.consignmentScheduledQty],
      ["寄倉排程後仍缺貨SKU", analysis.totals.shortageSkuCount],
      ["例外筆數", analysis.totals.exceptionCount],
      ["已確認固定排除", analysis.totals.confirmedExclusionCount],
      ["人工黑名單排除", analysis.totals.excludedCount]
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    setColumnWidths(summarySheet, [28, 20, 70]);
    applySummaryCis(summarySheet, XLSX);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "01_資料摘要");

    const detailRows = analysis.rows.map((row) => ({
      "ERP品號": row.sku,
      "商品品名": row.name,
      "未到貨採購量": row.pendingQty,
      "未到貨採購金額": row.pendingAmount,
      "目前公司庫存": row.inventoryQty,
      "寄倉現貨可拉量": row.consignmentCurrentQty,
      "粉紅底未完成量": row.consignmentScheduledQty,
      "現貨缺口": row.currentGap,
      "排程後缺口": row.gapAfterSchedule,
      "寄倉供貨狀態": row.supplyStatus,
      "庫存命中": row.inventoryMatched ? "是" : "否",
      "寄倉命中": row.consignmentMatched ? "是" : "否",
      "排程欄首原文": row.scheduleNotes.join("｜"),
      "採購單來源": row.purchaseSources.join("｜")
    }));
    const detailSheet = XLSX.utils.json_to_sheet(detailRows);
    setColumnWidths(detailSheet, [15, 46, 16, 18, 16, 18, 18, 14, 14, 30, 12, 12, 60, 28]);
    addAutoFilter(detailSheet);
    applyTableCis(detailSheet, XLSX);
    XLSX.utils.book_append_sheet(workbook, detailSheet, "02_品號串接");

    const exceptionRows = [
      ...analysis.consignment.confirmedExclusions.map((row) => ({
        "例外類型": row.type,
        "來源列": row.sourceRow,
        "ERP品號": row.sku,
        "供應商貨號": row.supplierSku,
        "商品名稱": row.name,
        "處理方式": row.action
      })),
      ...analysis.consignment.exceptions.map((row) => ({
        "例外類型": row.type,
        "來源列": row.sourceRow,
        "ERP品號": row.sku,
        "供應商貨號": row.supplierSku,
        "商品名稱": row.name,
        "處理方式": row.action
      })),
      ...analysis.consignment.excluded.map((row) => ({
        "例外類型": "人工黑名單",
        "來源列": row.sourceRow,
        "ERP品號": row.sku,
        "供應商貨號": row.supplierSku,
        "商品名稱": row.name,
        "處理方式": `排除；黑名單：${row.blacklistEntry}`
      }))
    ];
    const exceptionSheet = XLSX.utils.json_to_sheet(exceptionRows.length ? exceptionRows : [{ "例外類型": "無", "處理方式": "本次未發現例外" }]);
    setColumnWidths(exceptionSheet, [20, 12, 16, 28, 50, 50]);
    addAutoFilter(exceptionSheet);
    applyTableCis(exceptionSheet, XLSX);
    XLSX.utils.book_append_sheet(workbook, exceptionSheet, "03_例外清單");

    const ruleSheet = XLSX.utils.aoa_to_sheet([
      ["規則", "公式／定義", "狀態"],
      ["淨採購需求", LOCKED_RULES.netDemandFormula, "核心鎖定"],
      ["月初分批釋放", LOCKED_RULES.releaseRule, "本次確認"],
      ["寄倉處理", LOCKED_RULES.consignmentRule, "核心鎖定"],
      ["缺貨處理", LOCKED_RULES.shortageAction, "核心鎖定"],
      ["採購單狀態", LOCKED_RULES.pendingPurchaseRule, "核心鎖定"],
      ["期間調撥單", LOCKED_RULES.transferRule, "核心鎖定"],
      ["一次性代工", LOCKED_RULES.blacklistRule, "核心鎖定"],
      ["售完即停(S)", LOCKED_RULES.sellThroughStopRule, "核心鎖定"],
      ["(S)門市調撥", LOCKED_RULES.sellThroughTransferRule, "核心鎖定"],
      ["A42359-A", `只保留供應商貨號${CONFIRMED_OVERRIDES["A42359-A"]}`, "已確認"],
      ["A43359-A", CONFIRMED_EXCLUSIONS["A43359-A"], "已確認固定排除"]
    ]);
    setColumnWidths(ruleSheet, [22, 80, 18]);
    applyTableCis(ruleSheet, XLSX);
    XLSX.utils.book_append_sheet(workbook, ruleSheet, "04_核心規則");
    return workbook;
  }

  function recommendationSheetRows(rows, asOfDate) {
    const reportRows = rows.map((row) => {
      const storeInventoryQty = Object.values(row.storeInventoryByCode || {})
        .reduce((sum, quantity) => sum + Math.max(0, Number(quantity || 0)), 0);
      const currentInventoryAvailableDays = row.forecastDailyQty > 0
        ? (Math.max(0, Number(row.inventoryQty || 0)) + storeInventoryQty) / row.forecastDailyQty
        : null;
      const currentInventoryAvailableTo = currentInventoryAvailableDays == null
        ? "需求為0"
        : addDays(asOfDate || new Date().toISOString().slice(0, 10), Math.floor(currentInventoryAvailableDays));
      const systemAvailableDays = row.forecastDailyQty > 0
        ? (Number(row.inventoryQty || 0) + storeInventoryQty + Number((row.effectivePendingQty ?? row.pendingQty) || 0) + Number(row.suggestedPurchaseQty || 0)) / row.forecastDailyQty
        : null;
      const systemAvailableTo = systemAvailableDays == null
        ? "需求為0"
        : addDays(asOfDate || new Date().toISOString().slice(0, 10), Math.floor(systemAvailableDays));
      const hierarchy = reportProductHierarchy(row);
      return {
      "供應商": row.supplier,
      "採購分頁": row.purchaseTab,
      "大類（花色／同品項）": hierarchy.majorCategory,
      "中類（品項）": hierarchy.mediumCategory,
      "小類（尺寸）": hierarchy.smallCategory,
      "ERP品號": row.sku,
      "供應商貨號": row.supplierSku,
      "商品品名": row.name,
      "商品狀態": row.tier,
      "貨品狀態": row.productStatus || "空白（待人工確認）",
      "人工確認要求": row.productStatusPendingReview ? "必須明確填寫採購量與原因" : "依一般回匯規則",
      "ABC": row.abcClass,
      "XYZ": row.xyzClass,
      "近6週淨需求": row.recent6Qty,
      "近12週淨需求": row.recent12Qty,
      "去年同期6週": row.lastYear6Qty,
      "SKU模型": row.skuModel,
      "新品開賣天數": row.newProductDemand?.activeDays ?? "",
      "新品有效淨銷量": row.newProductDemand?.netQuantity ?? "",
      "新品實績日需求": row.newProductDemand?.actualDaily ?? "",
      "成熟同類日需求": row.newProductDemand?.categoryDaily ?? "",
      "成熟同類樣本數": row.newProductDemand?.categorySampleCount ?? "",
      "成熟同類基準": row.newProductDemand?.categoryLabel ?? "",
      "新品混合權重": row.newProductDemand ? `${Math.round(row.newProductDemand.actualWeight * 100)}%／${Math.round(row.newProductDemand.categoryWeight * 100)}%` : "",
      "類別模型": row.categoryModel,
      "類別季節係數": row.categorySeasonFactor,
      "季節模型來源": row.seasonalProfileSource || "無可用季節曲線",
      "季節曲線可信度": row.seasonalProfileReliability || "無",
      "旺季14天位置": row.seasonalPeakSlots || "",
      "季節需求模式": row.seasonalDemandMode || "四季穩定",
      "同季高峰跨年重複": row.seasonalHistoryRepeated ? "是" : "否",
      "原始季節係數": row.horizonRawSeasonFactor || 1,
      "保護期季節係數": row.horizonSeasonFactor || 1,
      "季節需求基準": row.seasonalDemandBasis || "近期速度",
      "同季歷史日均需求": row.seasonalHistoricalDailyQty ?? "",
      "預估日需求": row.forecastDailyQty,
      "供應交期類型": row.supplyProfileLabel,
      "到貨交期天數": row.supplierLeadDays,
      "檢視頻率天數": row.reviewDays,
      "安全緩衝天數": row.safetyBufferDays,
      "目標覆蓋天數": row.targetCoverageDays,
      "檢視週期＋到貨交期需求": row.forecastFutureQty,
      "安全庫存量": row.safetyStockQty,
      "總部需求（系統）": row.hqDemandQty,
      "門市需求（系統）": row.storeDemandQty,
      "門市核准未配需求": row.storeTransferNeedQty || 0,
      "門市最早需要到店日": row.earliestStoreNeedDate || "",
      "原採購需求歸屬": row.originalDemandSource || "",
      "加總需求（公式）": "",
      "可用公司庫存": row.inventoryQty,
      "門市可售庫存": storeInventoryQty,
      "非採購可用庫存": row.excludedInventoryQty,
      "已採購未到貨": row.pendingQty,
      "本次可抵扣未到貨": row.effectivePendingQty ?? row.pendingQty,
      "未到貨最早到貨日": row.earliestPendingDeliveryDate || "",
      "到貨是否來得及": row.pendingArrivalStatus || "",
      "到貨前時間缺口": row.pendingArrivalGap || "",
      "調撥提交中": row.transferSubmittedQty,
      "發貨在途": row.transferInTransitQty,
      "未進位淨採購需求": row.rawPurchaseQty,
      "本次釋放率": row.releaseRate,
      "釋放後未取整需求": row.releasedPurchaseQty,
      "春節備貨規則": row.springFestivalApplied ? "是" : "否",
      "春節停工開始日": row.springFestivalClosureStart || "",
      "春節恢復出貨日": row.springFestivalRecoveryDate || "",
      "春節額外備貨天數": row.springFestivalExtraDays || 0,
      "前次春節備貨未交量": row.priorSpringFestivalPendingQty || 0,
      "春節額外建議量": row.springFestivalExtraSuggestedQty || 0,
      "春節額外採購金額": row.springFestivalExtraAmount || 0,
      "箱入／採購單位": row.packSize,
      "單位向下量": row.packDownQty,
      "單位向上量": row.packUpQty,
      "系統取整方向": row.packDirection,
      "調整前建議採購量": row.standardSuggestedPurchaseQty,
      "建議採購量": row.suggestedPurchaseQty,
      "本次新增採購量": row.suggestedPurchaseQty,
      "目前庫存可售至": currentInventoryAvailableTo,
      "系統建議採購後可售至": systemAvailableTo,
      "寄倉現貨": row.consignmentCurrentQty,
      "粉紅排程": row.consignmentScheduledQty,
      "寄倉缺口": Math.max(row.suggestedPurchaseQty - row.consignmentCurrentQty - row.consignmentScheduledQty, 0),
      "目前實際可採購量": /普優[瑪碼]/.test(row.supplier) ? Math.min(row.suggestedPurchaseQty, row.consignmentCurrentQty) : row.suggestedPurchaseQty,
      "人工確認採購量": row.initialManualQty ?? "",
      "人工調整原因": row.initialManualReason || "",
      "人工確認後可售至": "",
      "AI判斷": "待回匯後重算",
      "新品上市日": row.listedDate || "",
      "新品預計通路／門市": row.plannedChannels || "",
      "相似品號": row.similarSku || "",
      "已納入行銷預估": row.marketingIncluded || "",
      "進貨價": row.unitCost,
      "建議採購金額": row.suggestedPurchaseAmount,
      "已下架": row.discontinued ? "是" : "否",
      "季節資料完整": row.seasonalDataReady ? "是" : "否",
      "銷售來源": row.sourceFiles.join("｜")
      };
    });
    return reportRows.sort((left, right) => (
      String(left["大類（花色／同品項）"] || "").localeCompare(String(right["大類（花色／同品項）"] || ""), "zh-Hant", { numeric: true })
      || String(left["中類（品項）"] || "").localeCompare(String(right["中類（品項）"] || ""), "zh-Hant", { numeric: true })
      || String(left["小類（尺寸）"] || "").localeCompare(String(right["小類（尺寸）"] || ""), "zh-Hant", { numeric: true })
      || String(left["ERP品號"] || "").localeCompare(String(right["ERP品號"] || ""), "zh-Hant", { numeric: true })
    ));
  }

  function appendJsonSheet(workbook, XLSX, sheetName, rows, widths) {
    const safeRows = rows.length ? rows : [{ "狀態": "本次無資料" }];
    const sheet = XLSX.utils.json_to_sheet(safeRows);
    if (rows.length) {
      const headers = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, defval: "" })[0] || [];
      const hqSystem = headers.indexOf("總部需求（系統）");
      const storeSystem = headers.indexOf("門市需求（系統）");
      const total = headers.indexOf("加總需求（公式）");
      if ([hqSystem, storeSystem, total].every((index) => index >= 0)) {
        rows.forEach((_row, index) => {
          const excelRow = index + 2;
          const hqSystemCell = XLSX.utils.encode_cell({ r: excelRow - 1, c: hqSystem });
          const storeSystemCell = XLSX.utils.encode_cell({ r: excelRow - 1, c: storeSystem });
          const totalCell = XLSX.utils.encode_cell({ r: excelRow - 1, c: total });
          sheet[totalCell] = { t: "n", f: `${hqSystemCell}+${storeSystemCell}` };
        });
      }
    }
    setColumnWidths(sheet, widths);
    addAutoFilter(sheet);
    applyTableCis(sheet, XLSX);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  }

  function appendPuyoumaConsignmentSheet(workbook, XLSX, rows) {
    const headers = [
      "材質／分頁", "大類（花色／同品項）", "中類（品項）", "小類（尺寸）", "ERP品號", "供應商貨號", "商品品名", "商品狀態", "預估日需求",
      "已採購未到貨", "本次建議採購量", "寄倉現貨", "粉紅底未完成量", "寄倉現貨缺口", "工廠目標天數", "工廠目標量",
      "建議新增寄庫量", "缺貨／供貨狀態", "排程欄首原文"
    ];
    const quantityKeys = ["預估日需求", "已採購未到貨", "本次建議採購量", "寄倉現貨", "粉紅底未完成量", "寄倉現貨缺口", "工廠目標量", "建議新增寄庫量"];
    const materialOrder = new Map(["天絲／天絲棉", "長絨棉", "無尺寸"].map((value, index) => [value, index]));
    const mediumOrder = new Map(["床包", "被套", "枕套", "枕芯", "其它品項"].map((value, index) => [value, index]));
    const groupedRows = rows.map((row) => ({ ...row, ...puyoumaConsignmentGroup(row) })).sort((left, right) => (
      (materialOrder.get(left.materialCategory) ?? 99) - (materialOrder.get(right.materialCategory) ?? 99)
      || left.majorCategory.localeCompare(right.majorCategory, "zh-Hant")
      || (mediumOrder.get(left.mediumCategory) ?? 99) - (mediumOrder.get(right.mediumCategory) ?? 99)
      || left.smallCategory.localeCompare(right.smallCategory, "zh-Hant", { numeric: true })
      || String(left["ERP品號"] || "").localeCompare(String(right["ERP品號"] || ""), "zh-Hant", { numeric: true })
    ));
    const sumRows = (items, key) => items.reduce((sum, item) => sum + Number(item[key] || 0), 0);
    const data = [
      ["普優瑪寄庫建議（依花色、品項與尺寸分類）"],
      ["排列方式", "材質保留為分頁／區段；大類：花色名稱，無法辨識花色時使用同品項名稱；中類：床包／被套／枕套／其它品項；小類：尺寸。小計不重複計入明細。"],
      [],
      headers
    ];
    const rowKinds = new Map([[0, "title"], [1, "note"], [3, "header"]]);
    let appendedMaterialCount = 0;
    for (const materialCategory of ["天絲／天絲棉", "長絨棉", "無尺寸"]) {
      const materialRows = groupedRows.filter((row) => row.materialCategory === materialCategory);
      if (!materialRows.length) continue;
      if (appendedMaterialCount > 0) data.push([]);
      appendedMaterialCount += 1;
      const materialSummary = Array(headers.length).fill("");
      materialSummary[0] = `材質區段：${materialCategory}`;
      materialSummary[2] = `${materialRows.length}個SKU`;
      quantityKeys.forEach((key) => { materialSummary[headers.indexOf(key)] = sumRows(materialRows, key); });
      rowKinds.set(data.length, "material");
      data.push(materialSummary);
      const majorCategories = [...new Set(materialRows.map((row) => row.majorCategory))];
      for (const majorCategory of majorCategories) {
        const majorRows = materialRows.filter((row) => row.majorCategory === majorCategory);
        const majorSummary = Array(headers.length).fill("");
        majorSummary[1] = `大類小計：${majorCategory}`;
        majorSummary[2] = `${majorRows.length}個SKU`;
        quantityKeys.forEach((key) => { majorSummary[headers.indexOf(key)] = sumRows(majorRows, key); });
        rowKinds.set(data.length, "major");
        data.push(majorSummary);
        const mediumCategories = [...new Set(majorRows.map((row) => row.mediumCategory))];
        for (const mediumCategory of mediumCategories) {
          const mediumRows = majorRows.filter((row) => row.mediumCategory === mediumCategory);
          const mediumSummary = Array(headers.length).fill("");
          mediumSummary[2] = `中類小計：${mediumCategory}`;
          mediumSummary[3] = `${mediumRows.length}個SKU`;
          quantityKeys.forEach((key) => { mediumSummary[headers.indexOf(key)] = sumRows(mediumRows, key); });
          rowKinds.set(data.length, "medium");
          data.push(mediumSummary);
          for (const row of mediumRows) {
            rowKinds.set(data.length, "detail");
            data.push([
              row.materialCategory, row.majorCategory, row.mediumCategory, row.smallCategory, row["ERP品號"], row["供應商貨號"], row["商品品名"], row["商品狀態"],
              row["預估日需求"], row["已採購未到貨"], row["本次建議採購量"], row["寄倉現貨"], row["粉紅底未完成量"], row["寄倉現貨缺口"],
              row["工廠目標天數"], row["工廠目標量"], row["建議新增寄庫量"], row["缺貨／供貨狀態"], row["排程欄首原文"]
            ]);
          }
        }
      }
    }
    if (!rows.length) {
      rowKinds.set(data.length, "empty");
      data.push(["本次無資料"]);
    }
    const sheet = XLSX.utils.aoa_to_sheet(data);
    const styles = {
      title: { fill: excelFill(EXCEL_CIS.white), font: { bold: true, sz: 14, color: { rgb: "FF153F63" } }, alignment: { vertical: "center" } },
      note: { fill: excelFill(EXCEL_CIS.white), font: { italic: true, color: { rgb: "FF64778A" } }, alignment: { vertical: "center", wrapText: true } },
      header: { fill: { patternType: "solid", fgColor: { rgb: "FF176B87" } }, font: { bold: true, color: { rgb: "FFFFFFFF" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true } },
      material: { fill: { patternType: "solid", fgColor: { rgb: "FF153F63" } }, font: { bold: true, color: { rgb: "FFFFFFFF" } }, alignment: { vertical: "center" } },
      major: { fill: { patternType: "solid", fgColor: { rgb: "FF176B87" } }, font: { bold: true, color: { rgb: "FFFFFFFF" } }, alignment: { vertical: "center" } },
      medium: { fill: { patternType: "solid", fgColor: { rgb: "FFDCECF0" } }, font: { bold: true, color: { rgb: "FF17324D" } }, alignment: { vertical: "center" } },
      detail: { fill: excelFill(EXCEL_CIS.white), font: { name: "Arial", sz: 10, color: { rgb: EXCEL_CIS.ink } }, alignment: { vertical: "center" }, border: excelBottomBorder() },
      empty: { fill: excelFill(EXCEL_CIS.white), font: { name: "Arial", sz: 10, color: { rgb: EXCEL_CIS.ink } } }
    };
    for (const [rowIndex, kind] of rowKinds) {
      const style = styles[kind];
      if (!style) continue;
      headers.forEach((_header, columnIndex) => {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
        if (!sheet[address]) sheet[address] = { t: "s", v: "" };
        sheet[address].s = style;
      });
    }
    const numericHeaders = new Set([...quantityKeys, "工廠目標天數"]);
    data.forEach((_row, rowIndex) => {
      if (!["detail", "material", "major", "medium"].includes(rowKinds.get(rowIndex))) return;
      headers.forEach((header, columnIndex) => {
        if (!numericHeaders.has(header)) return;
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
        if (sheet[address]) sheet[address].z = header === "預估日需求" ? "#,##0.00" : "#,##0";
      });
    });
    setColumnWidths(sheet, [18, 26, 16, 16, 16, 28, 48, 12, 14, 16, 18, 14, 20, 16, 16, 16, 20, 42, 58]);
    sheet["!rows"] = data.map((_row, index) => ({ hpt: rowKinds.get(index) === "title" ? 24 : (rowKinds.get(index) === "header" ? 34 : 21) }));
    applySheetSpacing(sheet);
    XLSX.utils.book_append_sheet(workbook, sheet, "04A_普優瑪寄庫建議");
  }

  function procurementWorkUnitForRow(row) {
    const supplier = String(row?.supplier || "").trim();
    if (!supplier) return null;
    const purchaseTab = /普優[瑪碼]/.test(supplier) ? String(row?.purchaseTab || "無尺寸品項").trim() : "";
    const categoryLabel = purchaseTab === "天絲＋天絲棉" ? "天絲／天絲棉" : purchaseTab === "長絨棉" ? "長絨棉" : purchaseTab ? "無尺寸" : "";
    const supplierLabel = findSupplierRule(supplier, SUPPLIER_RULES)?.name || supplier;
    return {
      id: `${normalizeText(supplier)}::${normalizeText(purchaseTab)}`,
      supplier,
      purchaseTab,
      label: categoryLabel ? `${supplierLabel}－${categoryLabel}` : supplierLabel
    };
  }

  function listProcurementWorkUnits(recommendations) {
    const units = new Map();
    for (const row of recommendations?.suggestedRows || []) {
      const unit = procurementWorkUnitForRow(row);
      if (!unit) continue;
      const current = units.get(unit.id) || { ...unit, skuCount: 0, quantity: 0, amount: 0 };
      current.skuCount += 1;
      current.quantity += Number(row.suggestedPurchaseQty || 0);
      current.amount += Number(row.suggestedPurchaseAmount || 0);
      units.set(unit.id, current);
    }
    return [...units.values()].sort((left, right) => left.supplier.localeCompare(right.supplier, "zh-Hant") || left.purchaseTab.localeCompare(right.purchaseTab, "zh-Hant"));
  }

  function rowMatchesProcurementWorkUnit(row, workUnit) {
    if (!workUnit) return true;
    const rowUnit = procurementWorkUnitForRow(row);
    if (!rowUnit) return false;
    const memberIds = Array.isArray(workUnit.memberIds) ? workUnit.memberIds : [];
    return memberIds.length ? memberIds.includes(rowUnit.id) : rowUnit.id === workUnit.id;
  }

  function buildRecommendationWorkbook(recommendations, XLSX, options = {}) {
    const workbook = XLSX.utils.book_new();
    const budget = options.budget || null;
    const sourceDateCheck = recommendations.validation?.dateCheck || null;
    const requestedSuppliers = Array.isArray(options.selectedSuppliers) ? options.selectedSuppliers.map((value) => String(value || "").trim()).filter(Boolean) : null;
    const requestedSet = requestedSuppliers ? new Set(requestedSuppliers.map(normalizeText)) : null;
    const allSupplierSet = new Set(recommendations.suggestedRows.map((row) => normalizeText(row.supplier)).filter(Boolean));
    const isFullScope = !requestedSet || (requestedSet.size === allSupplierSet.size && [...allSupplierSet].every((supplier) => requestedSet.has(supplier)));
    const workUnit = options.workUnit || null;
    const supplierIncluded = (supplier) => !requestedSet || requestedSet.has(normalizeText(supplier));
    const rowIncluded = (row) => supplierIncluded(row.supplier) && rowMatchesProcurementWorkUnit(row, workUnit);
    const selectedSuggestedRows = recommendations.suggestedRows.filter(rowIncluded);
    const selectedRows = recommendations.rows.filter(rowIncluded);
    const selectedSkuSet = new Set(selectedRows.map((row) => row.sku));
    const selectedTotals = {
      analyzedSkuCount: selectedRows.length,
      suggestedSkuCount: selectedSuggestedRows.length,
      suggestedPurchaseQty: selectedSuggestedRows.reduce((sum, row) => sum + Number(row.suggestedPurchaseQty || 0), 0),
      suggestedPurchaseAmount: selectedSuggestedRows.reduce((sum, row) => sum + Number(row.suggestedPurchaseAmount || 0), 0),
      hotSkuCount: selectedRows.filter((row) => row.tier === "熱銷").length,
      stableSkuCount: selectedRows.filter((row) => row.tier === "穩定").length,
      lowSkuCount: selectedRows.filter((row) => row.tier === "低銷").length,
      immediateShortageSkuCount: selectedRows.filter((row) => Number(row.immediateConsignmentGap || 0) > 0).length,
      consignmentSuggestionSkuCount: selectedRows.filter((row) => Number(row.suggestedConsignmentQty || 0) > 0).length,
      seasonalFallbackSkuCount: selectedRows.filter((row) => row.seasonalFallback).length,
      sellThroughStopExcludedCount: selectedRows.filter((row) => row.sellThroughStop).length,
      springFestivalSkuCount: selectedRows.filter((row) => row.springFestivalApplied).length,
      springFestivalExtraQty: selectedRows.reduce((sum, row) => sum + Number(row.springFestivalExtraSuggestedQty || 0), 0),
      springFestivalExtraAmount: selectedRows.reduce((sum, row) => sum + Number(row.springFestivalExtraAmount || 0), 0)
    };
    selectedTotals.productStatusPendingCount = selectedSuggestedRows.filter((row) => row.productStatusPendingReview).length;
    selectedTotals.productStatusPendingAmount = selectedSuggestedRows.filter((row) => row.productStatusPendingReview).reduce((sum, row) => sum + Number(row.suggestedPurchaseAmount || 0), 0);
    const outputScope = workUnit?.label || (isFullScope ? "全部供應商" : requestedSuppliers.join("、"));
    const summaryRows = [
      ["庫存採購與寄庫建議"],
      ["資料安全", "本檔由瀏覽器本機產生；不修改或上傳原始Excel。"],
      ["本次匯出範圍", outputScope],
      ["銷售截止日", recommendations.asOfDate],
      ["銷售檔最新結帳日", recommendations.sourceMaxSalesDate],
      ["銷售日期檢核", recommendations.salesDateStatus, recommendations.salesDateGapDays == null ? "未辨識" : `相差${recommendations.salesDateGapDays}天`],
      ["工廠寄倉目標", `${recommendations.factoryTargetDays}天`],
      ["採購時點", recommendations.checkpoint === "mid-month" ? "月中採購" : recommendations.checkpoint === "month-end" ? "月底驗證" : "月初採購"],
      ["分批釋放規則", recommendations.checkpoint === "month-start" ? "熱銷70%／穩定50%／低銷0%" : "依本次最新缺口100%重算"],
      ["採購流程", recommendations.meta?.workflowLabel || "一般採購建議"],
      ["固定來源模式", recommendations.meta?.sourceMode || "未標示"],
      ...Object.entries(recommendations.meta?.sourceHashes || {}).map(([source, hash]) => [`來源SHA-256：${source}`, String(hash)]),
      ["五來源日期檢核", sourceDateCheck?.status || "未提供", sourceDateCheck?.message || "下載前請確認庫存、未到貨、期間調撥、寄庫與銷售截止日。"],
      ...(sourceDateCheck?.status === "PASS" ? [] : [["使用限制", "資料時點未通過檢核；本檔只供串接驗收，不可直接下單。"]]),
      [],
      ["指標", "結果"],
      ["分析SKU", selectedTotals.analyzedSkuCount],
      ["建議採購SKU", selectedTotals.suggestedSkuCount],
      ["建議採購數量", selectedTotals.suggestedPurchaseQty],
      ["建議採購金額", selectedTotals.suggestedPurchaseAmount],
      ["有效期間調撥單", recommendations.totals.activeTransferDocumentCount || 0],
      ["調撥提交中數量", recommendations.totals.transferSubmittedQty || 0],
      ["發貨在途數量", recommendations.totals.transferInTransitQty || 0],
      ["春節停工備貨影響SKU", selectedTotals.springFestivalSkuCount],
      ["春節額外建議量", selectedTotals.springFestivalExtraQty],
      ["春節額外採購金額", selectedTotals.springFestivalExtraAmount, "已包含在建議採購金額與額度影響內"],
      ["熱銷／穩定／低銷", `${selectedTotals.hotSkuCount}／${selectedTotals.stableSkuCount}／${selectedTotals.lowSkuCount}`],
      ["寄倉現貨不足SKU", selectedTotals.immediateShortageSkuCount],
      ["需新增寄庫SKU", selectedTotals.consignmentSuggestionSkuCount],
      ["去年同期資料不足SKU", selectedTotals.seasonalFallbackSkuCount],
      ["品名結尾(S)停止外採SKU", selectedTotals.sellThroughStopExcludedCount],
      ["貨品狀態空白待人工確認SKU", selectedTotals.productStatusPendingCount],
      ["貨品狀態空白試算金額", selectedTotals.productStatusPendingAmount, "尚未核准；第一次回匯須明確填量與原因"],
      ["寬沐45%管理目標", recommendations.totals.kuanMuManagementTargetAmount || 0, "只作管理參考，未加入基本採購建議"],
      ["寬沐營運需求估算", recommendations.totals.kuanMuOperationalDemandAmount || 0],
      ["寬沐管理差額", recommendations.totals.kuanMuManagementGapAmount || 0, "需另行人工決定，不自動分配到SKU"],
      [],
      ["人工確認採購量填寫規則"],
      ["① 空白", "依建議採購量"],
      ["② 填0", "本次不採購"],
      ["③ 填正整數", "改採填入數量"],
      ["④ 禁止負數或文字", "若有人工修改，人工調整原因必填"],
      ["⑤ 貨品狀態空白", "不得沿用空白欄自動通過；必須明確填寫採購量與人工調整原因"]
    ];
    if (budget) {
      summaryRows.push(
        [],
        ["採購預算"],
        ["當月預估可採購金額", budget.availableBudget],
        ["目前已採購金額", budget.purchasedAmountToDate],
        ["尚可採購金額", budget.remainingBudget],
        ["本次建議採購金額", selectedTotals.suggestedPurchaseAmount],
        ["建議後剩餘額度", budget.remainingBudget - selectedTotals.suggestedPurchaseAmount]
      );
    }
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    setColumnWidths(summarySheet, [32, 72]);
    applySummaryCis(summarySheet, XLSX);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "01_採購摘要");

    const recommendationWidths = [20, 18, 26, 16, 16, 16, 28, 48, 12, 8, 8, 16, 16, 16, 24, 24, 16, 16, 20, 16, 16, 16, 16, 22, 18, 16, 18, 18, 18, 20, 16, 18, 28, 14, 18, 12, 16, 36];

    const puyoumaRows = selectedSuggestedRows.filter((row) => /普優[瑪碼]/.test(row.supplier));
    const lirongRows = selectedSuggestedRows.filter((row) => /力榮/.test(row.supplier));
    const shanglinRows = selectedSuggestedRows.filter((row) => /上林/.test(row.supplier));
    const dedicated = (row) => /普優[瑪碼]|力榮|上林/.test(row.supplier);
    const appendIfRows = (sheetName, rows, widths) => { if (!requestedSet || rows.length) appendJsonSheet(workbook, XLSX, sheetName, rows, widths); };
    appendIfRows("03A_力榮採購", recommendationSheetRows(lirongRows, recommendations.asOfDate), recommendationWidths);
    appendIfRows("03B1_普優瑪_天絲", recommendationSheetRows(puyoumaRows.filter((row) => row.purchaseTab === "天絲＋天絲棉"), recommendations.asOfDate), recommendationWidths);
    appendIfRows("03B2_普優瑪_長絨棉", recommendationSheetRows(puyoumaRows.filter((row) => row.purchaseTab === "長絨棉"), recommendations.asOfDate), recommendationWidths);
    appendIfRows("03B3_普優瑪_無尺寸", recommendationSheetRows(puyoumaRows.filter((row) => row.purchaseTab === "無尺寸品項"), recommendations.asOfDate), recommendationWidths);
    appendIfRows("03C_上林採購", recommendationSheetRows(shanglinRows, recommendations.asOfDate), recommendationWidths);
    appendIfRows("03D_其它供應商", recommendationSheetRows(selectedSuggestedRows.filter((row) => !dedicated(row)), recommendations.asOfDate), recommendationWidths);

    const sourceBySku = new Map(recommendations.rows.map((row) => [row.sku, row]));
    const consignmentRows = recommendations.consignmentRows.filter((row) => selectedSkuSet.has(row.sku)).map((row) => ({
      "採購分頁": row.purchaseTab,
      "ERP品號": row.sku,
      "供應商貨號": row.supplierSku,
      "商品品名": row.name,
      "商品狀態": row.tier,
      "預估日需求": row.forecastDailyQty,
      "已採購未到貨": row.pendingQty,
      "本次建議採購量": row.suggestedPurchaseQty,
      "寄倉現貨": row.consignmentCurrentQty,
      "粉紅底未完成量": row.consignmentScheduledQty,
      "寄倉現貨缺口": row.immediateConsignmentGap,
      "工廠目標天數": row.factoryTargetDays,
      "工廠目標量": row.factoryTargetQty,
      "建議新增寄庫量": row.suggestedConsignmentQty,
      "缺貨／供貨狀態": row.supplyStatus,
      "排程欄首原文": row.scheduleNotes.join("｜")
    }));
    const puyoumaConsignmentRows = consignmentRows
      .filter((row) => /普優[瑪碼]/.test(sourceBySku.get(row["ERP品號"])?.supplier || ""))
      .map((row) => {
        const source = sourceBySku.get(row["ERP品號"]) || {};
        return {
          ...row,
          purchaseTab: source.purchaseTab || row["採購分頁"],
          sizeGroup: source.sizeGroup || "",
          size: source.size || "",
          mainCategory: source.mainCategory || "",
          style1: source.style1 || "",
          style2: source.style2 || "",
          name: row["商品品名"],
          sku: row["ERP品號"]
        };
      });
    if (!requestedSet || puyoumaConsignmentRows.length) appendPuyoumaConsignmentSheet(workbook, XLSX, puyoumaConsignmentRows);
    const withReportHierarchy = (row) => {
      const source = sourceBySku.get(row["ERP品號"]) || {};
      const hierarchy = reportProductHierarchy({ ...source, name: row["商品品名"] || source.name, sku: row["ERP品號"] });
      return {
        "大類（花色／同品項）": hierarchy.majorCategory,
        "中類（品項）": hierarchy.mediumCategory,
        "小類（尺寸）": hierarchy.smallCategory,
        ...row
      };
    };
    const hierarchySort = (left, right) => (
      String(left["大類（花色／同品項）"] || "").localeCompare(String(right["大類（花色／同品項）"] || ""), "zh-Hant", { numeric: true })
      || String(left["中類（品項）"] || "").localeCompare(String(right["中類（品項）"] || ""), "zh-Hant", { numeric: true })
      || String(left["小類（尺寸）"] || "").localeCompare(String(right["小類（尺寸）"] || ""), "zh-Hant", { numeric: true })
      || String(left["ERP品號"] || "").localeCompare(String(right["ERP品號"] || ""), "zh-Hant", { numeric: true })
    );
    const lirongFallbackRows = consignmentRows
      .filter((row) => /力榮/.test(sourceBySku.get(row["ERP品號"])?.supplier || ""))
      .map(withReportHierarchy)
      .sort(hierarchySort);
    appendIfRows("04B_力榮寄庫建議", lirongFallbackRows, [26, 16, 16, 18, 16, 28, 50, 12, 16, 16, 18, 16, 20, 18, 16, 16, 20, 38, 60]);
    if (recommendations.lirongConsignmentRows?.length && selectedRows.some((row) => /力榮/.test(row.supplier))) {
      const lirongReportRows = recommendations.lirongConsignmentRows.map((row) => {
        const source = sourceBySku.get(row.sku) || {};
        const hierarchy = reportProductHierarchy({
          ...source,
          name: row.masterName || row.sourceName || source.name,
          sku: row.sku,
          purchaseTab: source.purchaseTab || ""
        });
        return {
          "大類（花色／同品項）": hierarchy.majorCategory, "中類（品項）": hierarchy.mediumCategory, "小類（尺寸）": hierarchy.smallCategory,
          "ERP品號": row.sku, "供應商貨號": row.supplierSku, "來源品名": row.sourceName, "最新主檔品名": row.masterName,
          "商品狀態": row.tier, "預估日需求": row.forecastDailyQty, "現貨拉貨交期": row.pullLeadDays, "製作期": row.productionDays,
          "製作後最早到貨": row.earliestDeliveryDays, "目標低標": row.targetLowDays, "目標高標": row.targetHighDays, "本次採用目標": row.targetDays,
          "工廠現貨": row.currentQty, "已確認製作中": row.scheduledQty, "已核准本次拉貨": row.approvedPullQty,
          "預計製作完成日": row.productionCompleteDate, "預計到貨日": row.expectedArrivalDate, "未取整需求": row.rawQty,
          "10件向下量": row.downQty, "10件向上量": row.upQty, "系統建議量": row.suggestedQty, "人工確認量": "", "人工調整原因": "",
          "寄庫後可售天數": row.availableDaysAfter, "現貨到貨前風險": row.beforePullRisk ? "有" : "無", "製作完成前風險": row.beforeProductionRisk ? "有" : "無",
          "製作後送達前風險": row.beforeDeliveryRisk ? "有" : "無", "例外狀態": row.status, "未來可能成本": row.futureCost,
          "排程欄首原文": row.scheduleNotes.join("｜")
        };
      }).sort(hierarchySort);
      const replacement = XLSX.utils.json_to_sheet(lirongReportRows);
      setColumnWidths(replacement, [26, 16, 16, ...Array(30).fill(18)]);
      addAutoFilter(replacement);
      applyTableCis(replacement, XLSX);
      if (workbook.Sheets["04B_力榮寄庫建議"]) workbook.Sheets["04B_力榮寄庫建議"] = replacement;
      else XLSX.utils.book_append_sheet(workbook, replacement, "04B_力榮寄庫建議");
    }
    appendIfRows("05_新品採購建議", recommendationSheetRows(selectedRows.filter((row) => row.isNewProduct), recommendations.asOfDate), recommendationWidths);
    appendIfRows("06_普優瑪新品寄庫", consignmentRows
      .filter((row) => sourceBySku.get(row["ERP品號"])?.isNewProduct && /普優[瑪碼]/.test(sourceBySku.get(row["ERP品號"])?.supplier || ""))
      .map(withReportHierarchy)
      .sort(hierarchySort), [26, 16, 16, 18, 16, 28, 50, 12, 16, 16, 18, 16, 20, 18, 16, 16, 20, 38, 60]);

    const exceptionRows = [
      ...(recommendations.productExclusions || []).filter((row) => supplierIncluded(row.supplier)).map((row) => ({
        "類型": row.type,
        "來源列": row.sourceRow,
        "ERP品號": row.sku,
        "供應商貨號": row.supplierSku,
        "供應商": row.supplier || "",
        "商品名稱": row.name,
        "處理方式": row.action
      })),
      ...recommendations.consignment.confirmedExclusions.filter((row) => !requestedSet || selectedSkuSet.has(row.sku)).map((row) => ({
        "類型": row.type,
        "來源列": row.sourceRow,
        "ERP品號": row.sku,
        "供應商貨號": row.supplierSku,
        "供應商": recommendations.rows.find((item) => item.sku === row.sku)?.supplier || "",
        "商品名稱": row.name,
        "處理方式": row.action
      })),
      ...recommendations.consignment.exceptions.filter((row) => !requestedSet || selectedSkuSet.has(row.sku)).map((row) => ({
        "類型": row.type,
        "來源列": row.sourceRow,
        "ERP品號": row.sku,
        "供應商貨號": row.supplierSku,
        "供應商": recommendations.rows.find((item) => item.sku === row.sku)?.supplier || "",
        "商品名稱": row.name,
        "處理方式": row.action
      })),
      ...recommendations.consignment.excluded.filter((row) => !requestedSet || selectedSkuSet.has(row.sku)).map((row) => ({
        "類型": "人工黑名單",
        "來源列": row.sourceRow,
        "ERP品號": row.sku,
        "供應商貨號": row.supplierSku,
        "供應商": recommendations.rows.find((item) => item.sku === row.sku)?.supplier || "",
        "商品名稱": row.name,
        "處理方式": `排除；黑名單：${row.blacklistEntry}`
      }))
    ];
    appendJsonSheet(workbook, XLSX, "07_排除與例外", exceptionRows, [20, 12, 16, 28, 20, 50, 65]);

    const ruleSheet = XLSX.utils.aoa_to_sheet([
      ["規則", "公式／定義", "狀態"],
      ["銷售需求口徑", "銷貨＋訂貨＋退貨＋退訂；排除取貨，避免總倉代出重複計算", "核心鎖定"],
      ["SKU模型", "依回測檔在近期6週與12週間選擇；類別模型只做季節需求池校正", "核心鎖定"],
      ["冬夏季模型", "強夏季／強冬季且SKU曲線可信度為中／高時，以至少兩個年度同一14天位置的歷史絕對量與近期速度季節化結果取高者；天絲寢具為四季夏偏旺、純棉寢具為四季冬偏旺，只採40%季節變化並限制於0.8～1.3倍；春節追加期間另按該段季節曲線計算", "核心鎖定"],
      ["ABC／XYZ", "12週成本貢獻做ABC；有銷售週數與變異係數做XYZ", "第一版"],
      ["淨採購需求", LOCKED_RULES.netDemandFormula, "核心鎖定"],
      ["公司備貨", "目標覆蓋＝供應商檢視期＋到貨交期＋商品分級安全緩衝；90～120天依熱銷90／穩定105／低銷120；0轉人工判斷", "第三版"],
      ["普優瑪採購與寄庫", `成品製作${recommendations.appliedRules?.puyouma?.productionDays ?? 45}天；寄庫目標熱銷${recommendations.appliedRules?.puyouma?.targetDays?.["熱銷"] ?? 120}／穩定${recommendations.appliedRules?.puyouma?.targetDays?.["穩定"] ?? 105}／低銷${recommendations.appliedRules?.puyouma?.targetDays?.["低銷"] ?? 90}天`, "集中規則"],
      ["力榮採購與寄庫", `製作${recommendations.appliedRules?.lirong?.productionDays ?? 14}天；寄庫熱銷${recommendations.appliedRules?.lirong?.targetDays?.["熱銷"] ?? 90}／穩定${recommendations.appliedRules?.lirong?.targetDays?.["穩定"] ?? 60}／低銷${recommendations.appliedRules?.lirong?.targetDays?.["低銷"] ?? 60}天；初始為每品號0或10的倍數，可由集中規則變更`, "集中規則"],
      ["上林檢視期", "固定28天；另加到貨交期與分級安全緩衝；總部／門市／加總需求保留公式", "已確認"],
      ["Excel編輯", "匯出檔不啟用工作表密碼保護；流程上只填人工欄位，系統欄位如被改動會在回匯時拒絕", "已確認"],
      ["付款認列", "國內預計到貨100%；國外下單30%、預計出貨70%；付款分配合計必須等於核准總額", "已確認"],
      ["一般自動採購排除", "凱信達一次性、歐必斯客訂型、所有總部贈品、SA／OA／SB／OB開頭及8×7尺的一次性客製／組合品均不產生一般自動採購或寄庫", "已確認"],
      ["寄倉處理", LOCKED_RULES.consignmentRule, "核心鎖定"],
      ["期間調撥單", LOCKED_RULES.transferRule, "核心鎖定"],
      ["售完即停(S)", LOCKED_RULES.sellThroughStopRule, "核心鎖定"],
      ["(S)門市調撥", LOCKED_RULES.sellThroughTransferRule, "核心鎖定"],
      ["寄庫建議", `工廠目標${recommendations.factoryTargetDays}天；寄倉現貨不足採購需求時必列缺貨警示`, "核心鎖定"],
      ["採購與寄庫報表分類", "材質保留為分頁／區段；大類為花色或同品項、中類為品項、小類為尺寸。普優瑪與力榮採購及寄庫報表皆依此排列", "已確認"],
      ["普優瑪工廠製作交期", `${recommendations.appliedRules?.puyouma?.productionDays ?? PROCUREMENT_POLICY.puyoumaFactoryLeadDays}天`, "集中規則"],
      ["A42359-A", `只保留供應商貨號${CONFIRMED_OVERRIDES["A42359-A"]}`, "已確認"],
      ["A43359-A", CONFIRMED_EXCLUSIONS["A43359-A"], "已確認固定排除"]
    ]);
    setColumnWidths(ruleSheet, [24, 90, 18]);
    applyTableCis(ruleSheet, XLSX);
    XLSX.utils.book_append_sheet(workbook, ruleSheet, "08_核心規則");
    return workbook;
  }

  function reviewReturnedWorkbook(workbook, XLSX, options = {}) {
    const preferredSheets = workbook.SheetNames.filter((name) => /^03(?:A|B\d|C|D)_/.test(name));
    const sourceSheets = preferredSheets.length ? preferredSheets : workbook.SheetNames.filter((name) => ["02_全部採購建議", "02_所選範圍採購建議"].includes(name));
    if (!sourceSheets.length && workbook.SheetNames.some((name) => /回匯.*覆核|二次覆核/.test(name))) throw new Error("這是舊版或已產生的二次覆核檔，不能作為第一次人工回匯；請使用本頁本次下載的採購建議Excel。");
    if (!sourceSheets.length) throw new Error("回匯檔缺少本工具的採購建議分頁；請使用本頁本次下載的Excel。");
    const rows = [];
    const errors = [];
    const seen = new Set();
    for (const sheetName of sourceSheets) {
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true });
      for (let index = 0; index < data.length; index += 1) {
        const source = data[index];
        const sku = normalizeSku(source["ERP品號"]);
        if (!sku || source["狀態"] === "本次無資料") continue;
        if (seen.has(sku)) {
          errors.push({ sheetName, sourceRow: index + 2, sku, message: "ERP品號在採購分頁重複。" });
          continue;
        }
        seen.add(sku);
        const baseline = options.baselineBySku?.get?.(sku);
        const allowedSkuSet = options.allowedSkuSet;
        const inCurrentScope = !allowedSkuSet || allowedSkuSet.has?.(sku);
        const sourceSupplier = String(source["供應商"] || "").trim();
        const sourceName = String(source["商品品名"] || "").trim();
        const sourceSuggestedQty = parseNumber(source["建議採購量"]);
        const sourceUnitCost = parseNumber(source["進貨價"]);
        const manualCell = source["人工確認採購量"] !== undefined ? source["人工確認採購量"] : source["人工量"];
        const manualBlank = manualCell === "" || manualCell == null;
        const reason = String(source["人工調整原因"] || source["原因"] || "").trim();
        const sparseManualAddition = Boolean(baseline && !sourceSupplier && !sourceName && sourceSuggestedQty == null && sourceUnitCost == null && !manualBlank);
        const supplier = sparseManualAddition ? String(baseline.supplier || "").trim() : sourceSupplier;
        const name = sparseManualAddition ? String(baseline.name || "").trim() : sourceName;
        const suggestedQty = sparseManualAddition ? Math.max(0, Number(baseline.suggestedPurchaseQty || 0)) : sourceSuggestedQty;
        const confirmedQty = manualBlank ? Math.max(0, suggestedQty || 0) : parseNumber(manualCell);
        const unitCost = sparseManualAddition ? Number(baseline.unitCost || 0) : sourceUnitCost;
        const productStatusPendingReview = Boolean(baseline?.productStatusPendingReview);
        if (options.baselineBySku && !baseline) errors.push({ sheetName, sourceRow: index + 2, sku, message: "ERP品號不在本次計算批次，無法補回供應商、進貨價、庫存、需求及寄庫資料。" });
        if (baseline && !inCurrentScope) errors.push({ sheetName, sourceRow: index + 2, sku, message: `ERP品號屬於「${procurementWorkUnitForRow(baseline)?.label || baseline.supplier || "其它採購範圍"}」，不可加入目前的採購批次。` });
        if (baseline) {
          if (!sparseManualAddition && normalizeText(supplier) !== normalizeText(baseline.supplier)) errors.push({ sheetName, sourceRow: index + 2, sku, message: `供應商與本次計算結果不同；此品號應屬「${baseline.supplier}」。` });
          if (Math.abs(Number(unitCost || 0) - Number(baseline.unitCost || 0)) >= 0.01) errors.push({ sheetName, sourceRow: index + 2, sku, message: "進貨價與本次商品主檔不同，請重新產生報表。" });
          if (Math.abs(Number(suggestedQty || 0) - Number(baseline.suggestedPurchaseQty || 0)) >= 0.01) errors.push({ sheetName, sourceRow: index + 2, sku, message: "系統建議量已被修改，請只填人工欄位。" });
        }
        if (confirmedQty == null || confirmedQty < 0 || !Number.isInteger(confirmedQty)) errors.push({ sheetName, sourceRow: index + 2, sku, message: "人工確認採購量必須為0或正整數。" });
        if (!manualBlank && confirmedQty !== suggestedQty && !reason) errors.push({ sheetName, sourceRow: index + 2, sku, message: "修改採購量時必須填人工調整原因。" });
        if (productStatusPendingReview && manualBlank) errors.push({ sheetName, sourceRow: index + 2, sku, message: "貨品狀態空白，必須明確填寫人工確認採購量，不能直接沿用系統試算。" });
        if (productStatusPendingReview && !reason) errors.push({ sheetName, sourceRow: index + 2, sku, message: "貨品狀態空白，人工調整原因必填，確認後才能進入二次覆核。" });
        const packSize = Math.max(1, Number(baseline?.packSize || source["箱入／採購單位"] || (/力榮/.test(supplier) ? 10 : 1)));
        const consignmentAvailableQty = Math.max(0, Number(
          baseline?.sellThroughConsignmentAllowed
            ? baseline.sellThroughConsignmentAvailableQty
            : (baseline?.consignmentCurrentQty ?? source["寄倉現貨"] ?? 0)
        ));
        const tailBoxException = Boolean(baseline?.sellThroughConsignmentAllowed && confirmedQty === consignmentAvailableQty && consignmentAvailableQty < packSize);
        if (confirmedQty != null && confirmedQty > 0 && confirmedQty % packSize !== 0 && !tailBoxException) errors.push({ sheetName, sourceRow: index + 2, sku, message: `${supplier || "此供應商"}的本品號採購單位為${packSize}件；人工量必須填0或${packSize}的倍數。` });
        if (unitCost == null || unitCost < 0) errors.push({ sheetName, sourceRow: index + 2, sku, message: "缺少有效進貨價，禁止核准金額。" });
        const supplierRule = findSupplierRule(supplier, options.supplierRules || []);
        let blockedReason = "";
        if (baseline?.sellThroughStop && !baseline.sellThroughConsignmentAllowed) blockedReason = "S品－寄庫現貨已用罄，禁止一般採購、新增生產與新增寄庫";
        else if (baseline?.discontinued) blockedReason = "商品主檔已下架，禁止採購";
        else if (baseline?.externalPurchaseBlocked) blockedReason = baseline.supplyStatus || baseline.automaticExclusionReason || "本品號受一般採購規則阻擋";
        else if (!baseline && isSellThroughStopName(name)) blockedReason = "最新主檔為(S)，且無本次寄庫可拉量基準，禁止新增外採";
        else if (/贈品/.test(`${name} ${source["存貨種類"] || ""}`)) blockedReason = "贈品排除一般自動採購";
        else if (supplierRule?.automaticPurchase === false) blockedReason = supplierRule.exclusionReason;
        if (baseline?.sellThroughConsignmentAllowed && Number(confirmedQty || 0) > consignmentAvailableQty) {
          blockedReason = `S品只能拉回既有寄庫現貨；本批扣除未到貨後最多可拉${consignmentAvailableQty}件，不得轉成新增生產或新增寄庫`;
          errors.push({ sheetName, sourceRow: index + 2, sku, message: blockedReason });
        }
        const finalQty = blockedReason ? 0 : Math.max(0, Number(confirmedQty || 0));
        const forecastDaily = Math.max(0, Number(sparseManualAddition ? baseline?.forecastDailyQty : source["預估日需求"] || 0));
        const inventoryQty = Math.max(0, Number(sparseManualAddition ? baseline?.inventoryQty : source["可用公司庫存"] || 0));
        const storeInventoryQty = Math.max(0, Number(sparseManualAddition ? Object.values(baseline?.storeInventoryByCode || {}).reduce((sum, value) => sum + Number(value || 0), 0) : source["門市可售庫存"] || 0));
        const pendingQty = Math.max(0, Number(sparseManualAddition ? (baseline?.effectivePendingQty ?? baseline?.pendingQty) : source["已採購未到貨"] || 0));
        const availableDays = forecastDaily > 0 ? (inventoryQty + storeInventoryQty + pendingQty + finalQty) / forecastDaily : null;
        const availableTo = availableDays == null ? "需求為0" : addDays(options.asOfDate || new Date().toISOString().slice(0, 10), Math.floor(availableDays));
        const comparison = Number(suggestedQty || 0) > 0 ? finalQty / Number(suggestedQty) : (finalQty > 0 ? Infinity : 1);
        const aiJudgment = blockedReason ? "規則阻擋" : (comparison > 1.2 ? "偏高" : comparison < 0.8 ? "偏低" : "合理");
        rows.push({
          sheetName, sourceRow: index + 2, supplier, supplierCountry: supplierRule?.country || "待確認", sku,
          supplierSku: String(source["供應商貨號"] || "").trim(), name, suggestedQty: Math.max(0, Number(suggestedQty || 0)),
          confirmedQty: Math.max(0, Number(confirmedQty || 0)), finalQty, unitCost: Math.max(0, Number(unitCost || 0)), reason,
          blockedReason, suggestedAmount: Math.max(0, Number(suggestedQty || 0)) * Math.max(0, Number(unitCost || 0)),
          manualAmount: Math.max(0, Number(confirmedQty || 0)) * Math.max(0, Number(unitCost || 0)),
          blockedAmount: blockedReason ? Math.max(0, Number(confirmedQty || 0)) * Math.max(0, Number(unitCost || 0)) : 0,
          approvedAmount: finalQty * Math.max(0, Number(unitCost || 0)), forecastDaily, inventoryQty, storeInventoryQty, pendingQty,
          availableTo, aiJudgment, productStatusPendingReview, manuallyAdded: sparseManualAddition,
          sellThroughConsignmentAllowed: Boolean(baseline?.sellThroughConsignmentAllowed),
          demandSummary: sparseManualAddition ? `總部需求${Number(baseline?.hqDemandQty || 0).toFixed(2)}；門市需求${Number(baseline?.storeDemandQty || 0).toFixed(2)}` : "",
          consignmentCurrentQty: Math.max(0, Number(baseline?.consignmentCurrentQty ?? source["寄倉現貨"] ?? 0)),
          consignmentScheduledQty: Math.max(0, Number(baseline?.consignmentScheduledQty ?? source["粉紅排程"] ?? 0)),
          currentAvailableQty: /普優[瑪碼]|力榮/.test(supplier) ? consignmentAvailableQty : Math.max(0, Number(source["目前實際可採購量"] || finalQty)),
          packSize
        });
      }
    }
    const orderDate = parseDateValue(options.orderDate) || new Date().toISOString().slice(0, 10);
    const suppliers = new Map();
    for (const row of rows.filter((item) => item.approvedAmount > 0)) {
      if (!suppliers.has(row.supplier)) suppliers.set(row.supplier, { supplier: row.supplier, amount: 0, confirmedQty: 0, consignmentAvailableQty: 0 });
      const supplier = suppliers.get(row.supplier);
      supplier.amount += row.approvedAmount;
      supplier.confirmedQty += row.finalQty;
      supplier.consignmentAvailableQty += row.currentAvailableQty;
    }
    const payments = [...suppliers.values()].map((supplier) => ({
      ...supplier,
      ...calculatePaymentSchedule({ ...supplier, orderDate, supplyMode: /力榮|普優[瑪碼]/.test(supplier.supplier) ? "consignment" : "direct", supplierRules: options.supplierRules || [] })
    }));
    payments.filter((item) => item.status !== "PASS").forEach((item) => errors.push({ sheetName: "付款月份", sourceRow: "", sku: "", message: `${item.supplier}：${item.message}` }));
    const suggestedAmount = rows.reduce((sum, row) => sum + row.suggestedAmount, 0);
    const manualAmount = rows.reduce((sum, row) => sum + row.manualAmount, 0);
    const blockedAmount = rows.reduce((sum, row) => sum + row.blockedAmount, 0);
    const approvedAmount = rows.reduce((sum, row) => sum + row.approvedAmount, 0);
    return {
      rows, errors, payments, orderDate,
      totals: { suggestedAmount, manualAmount, blockedAmount, approvedAmount, adjustmentAmount: approvedAmount - suggestedAmount }
    };
  }

  function buildSecondReviewWorkbook(review, XLSX, options = {}) {
    const workbook = XLSX.utils.book_new();
    const summary = XLSX.utils.aoa_to_sheet([
      ["第二次回匯覆核摘要"], ["批次編號", options.batchId || "待建立"], ["下單日", review.orderDate],
      ["系統建議金額", review.totals.suggestedAmount], ["人工回匯採購總額", review.totals.manualAmount],
      ["規則阻擋金額", review.totals.blockedAmount], ["最終可核准金額", review.totals.approvedAmount],
      ["人工調整增減金額", review.totals.adjustmentAmount], ["檢核結果", review.errors.length ? `阻擋：${review.errors.length}項` : "通過，可送正式核准"],
      ["通知規則", "本步驟不寄信；正式核准／撤銷／更正才寄送摘要。"]
    ]);
    setColumnWidths(summary, [30, 70]);
    applySummaryCis(summary, XLSX);
    XLSX.utils.book_append_sheet(workbook, summary, "01_回匯摘要");
    appendJsonSheet(workbook, XLSX, "02_二次覆核", review.rows.map((row) => ({
      "供應商": row.supplier, "供應商分類": row.supplierCountry, "ERP品號": row.sku, "供應商貨號": row.supplierSku,
      "商品品名": row.name, "系統建議量": row.suggestedQty, "人工回匯量": row.confirmedQty, "人工確認要求": row.productStatusPendingReview ? "貨品狀態空白，已明確人工確認" : "一般回匯", "規則阻擋原因": row.blockedReason,
      "最終可核准量": row.finalQty, "進貨價": row.unitCost, "人工回匯金額": row.manualAmount, "規則阻擋金額": row.blockedAmount,
      "最終可核准金額": row.approvedAmount, "人工調整原因": row.reason, "人工確認後可售至": row.availableTo, "AI判斷": row.aiJudgment,
      "預估日需求": row.forecastDaily, "可用公司庫存": row.inventoryQty, "門市可售庫存": row.storeInventoryQty, "已採購未到貨": row.pendingQty,
      "本次人工新增": row.manuallyAdded ? "是；資料已由本次計算批次補回" : "否", "需求摘要": row.demandSummary || "",
      "寄倉現貨": row.consignmentCurrentQty || 0, "粉紅排程": row.consignmentScheduledQty || 0,
      "目前實際可採購量": row.currentAvailableQty, "箱入／採購單位": row.packSize,
      "二次確認採購量": "", "二次確認原因": ""
    })), [18, 14, 16, 28, 52, 16, 16, 30, 18, 14, 18, 18, 20, 32, 18, 14, 16, 16, 16, 18, 20, 34, 16, 16, 18, 16, 18, 30]);
    appendJsonSheet(workbook, XLSX, "03_付款月份", review.payments.flatMap((supplier) => supplier.entries.map((entry) => ({
      "供應商": supplier.supplier, "供應商分類": supplier.supplierCountry, "平均採購週期": supplier.leadDays,
      "付款觸發": entry.trigger, "預計日期": entry.date, "付款月份": entry.month, "預計付款金額": entry.amount,
      "預計出貨日": supplier.expectedShipmentDate, "預計到貨日": supplier.expectedArrivalDate
    }))), [20, 14, 16, 20, 16, 14, 20, 16, 16]);
    appendJsonSheet(workbook, XLSX, "04_阻擋與警示", review.errors.map((error) => ({
      "來源分頁": error.sheetName, "來源列": error.sourceRow, "ERP品號": error.sku, "阻擋原因": error.message
    })), [26, 12, 18, 70]);
    return workbook;
  }

  function reviewSecondApprovalWorkbook(workbook, XLSX, options = {}) {
    const sheet = workbook.Sheets["02_二次覆核"];
    if (!sheet && workbook.SheetNames.some((name) => /回匯.*覆核|二次覆核/.test(name))) throw new Error("這是舊版二次覆核格式；請使用本次第一次回匯後由工具新下載的確認版。");
    if (!sheet) throw new Error("確認版缺少02_二次覆核分頁；請使用本次第一次回匯後由工具新下載的確認版。");
    const sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
    const rows = [];
    const errors = [];
    const seen = new Set();
    for (let index = 0; index < sourceRows.length; index += 1) {
      const source = sourceRows[index];
      const sku = normalizeSku(source["ERP品號"]);
      if (!sku) continue;
      if (seen.has(sku)) {
        errors.push({ sheetName: "02_二次覆核", sourceRow: index + 2, sku, message: "ERP品號重複。" });
        continue;
      }
      seen.add(sku);
      const supplier = String(source["供應商"] || "").trim();
      const name = String(source["商品品名"] || "").trim();
      const suggestedQty = Math.max(0, Number(parseNumber(source["系統建議量"]) || 0));
      const firstConfirmedQty = Math.max(0, Number(parseNumber(source["人工回匯量"]) || 0));
      const firstFinalQty = Math.max(0, Number(parseNumber(source["最終可核准量"]) || 0));
      const confirmationCell = source["二次確認採購量"];
      const confirmationBlank = confirmationCell === "" || confirmationCell == null;
      const finalQty = confirmationBlank ? firstFinalQty : parseNumber(confirmationCell);
      const firstReason = String(source["人工調整原因"] || "").trim();
      const secondReason = String(source["二次確認原因"] || "").trim();
      const reason = secondReason || firstReason;
      const blockedReason = String(source["規則阻擋原因"] || "").trim();
      const unitCost = parseNumber(source["進貨價"]);
      const baseline = options.baselineBySku?.get?.(sku);
      if (options.baselineBySku && !baseline) errors.push({ sheetName: "02_二次覆核", sourceRow: index + 2, sku, message: "品號不在第一次覆核結果，禁止加入。" });
      if (baseline) {
        if (normalizeText(supplier) !== normalizeText(baseline.supplier)) errors.push({ sheetName: "02_二次覆核", sourceRow: index + 2, sku, message: "供應商與第一次覆核結果不同，禁止修改。" });
        if (Math.abs(Number(unitCost || 0) - Number(baseline.unitCost || 0)) >= 0.01) errors.push({ sheetName: "02_二次覆核", sourceRow: index + 2, sku, message: "進貨價與第一次覆核結果不同，禁止修改。" });
        if (Math.abs(firstFinalQty - Number(baseline.finalQty || 0)) >= 0.01 || blockedReason !== String(baseline.blockedReason || "")) errors.push({ sheetName: "02_二次覆核", sourceRow: index + 2, sku, message: "第一次覆核結果欄位已被修改，請重新下載確認版。" });
      }
      if (confirmationBlank) errors.push({ sheetName: "02_二次覆核", sourceRow: index + 2, sku, message: "必須填寫二次確認採購量，0也需明確填入。" });
      if (baseline?.productStatusPendingReview && !firstReason) errors.push({ sheetName: "02_二次覆核", sourceRow: index + 2, sku, message: "貨品狀態空白品項缺少第一次人工確認原因，請重新由第一次回匯產生確認版。" });
      if (finalQty == null || finalQty < 0 || !Number.isInteger(finalQty)) errors.push({ sheetName: "02_二次覆核", sourceRow: index + 2, sku, message: "二次確認採購量必須為0或正整數。" });
      const packSize = Math.max(1, Number(baseline?.packSize || source["箱入／採購單位"] || (/力榮/.test(supplier) ? 10 : 1)));
      const tailBoxException = Boolean(baseline?.sellThroughConsignmentAllowed && finalQty === baseline.currentAvailableQty && finalQty < packSize);
      if (finalQty != null && finalQty > 0 && finalQty % packSize !== 0 && !tailBoxException) errors.push({ sheetName: "02_二次覆核", sourceRow: index + 2, sku, message: `${supplier || "此供應商"}的本品號採購單位為${packSize}件；二次確認量必須填0或${packSize}的倍數。` });
      if (baseline?.sellThroughConsignmentAllowed && Number(finalQty || 0) > Number(baseline.currentAvailableQty || 0)) errors.push({ sheetName: "02_二次覆核", sourceRow: index + 2, sku, message: `S品只能拉回既有寄庫現貨；本批最多可拉${baseline.currentAvailableQty}件。` });
      if (blockedReason && finalQty !== 0) errors.push({ sheetName: "02_二次覆核", sourceRow: index + 2, sku, message: `規則阻擋品項必須維持0：${blockedReason}` });
      if (!confirmationBlank && finalQty !== firstFinalQty && !secondReason) errors.push({ sheetName: "02_二次覆核", sourceRow: index + 2, sku, message: "二次修改數量時必須填二次確認原因。" });
      if (unitCost == null || unitCost < 0) errors.push({ sheetName: "02_二次覆核", sourceRow: index + 2, sku, message: "缺少有效進貨價，禁止核准金額。" });
      const forecastDaily = Math.max(0, Number(source["預估日需求"] || 0));
      const inventoryQty = Math.max(0, Number(source["可用公司庫存"] || 0));
      const storeInventoryQty = Math.max(0, Number(source["門市可售庫存"] || 0));
      const pendingQty = Math.max(0, Number(source["已採購未到貨"] || 0));
      const availableDays = forecastDaily > 0 ? (inventoryQty + storeInventoryQty + pendingQty + Math.max(0, Number(finalQty || 0))) / forecastDaily : null;
      const availableTo = availableDays == null ? String(source["人工確認後可售至"] || source["人工填寫可售至"] || "需求為0") : addDays(options.asOfDate || new Date().toISOString().slice(0, 10), Math.floor(availableDays));
      const comparison = suggestedQty > 0 ? Number(finalQty || 0) / suggestedQty : (Number(finalQty || 0) > 0 ? Infinity : 1);
      const aiJudgment = blockedReason ? "規則阻擋" : (comparison > 1.2 ? "偏高" : comparison < 0.8 ? "偏低" : "合理");
      rows.push({
        sheetName: "02_二次覆核", sourceRow: index + 2, supplier,
        supplierCountry: String(source["供應商分類"] || "待確認"), sku, supplierSku: String(source["供應商貨號"] || "").trim(), name,
        suggestedQty, confirmedQty: firstConfirmedQty, finalQty: Math.max(0, Number(finalQty || 0)), unitCost: Math.max(0, Number(unitCost || 0)), reason,
        blockedReason, productStatusPendingReview: Boolean(baseline?.productStatusPendingReview), suggestedAmount: suggestedQty * Math.max(0, Number(unitCost || 0)), manualAmount: firstConfirmedQty * Math.max(0, Number(unitCost || 0)),
        blockedAmount: blockedReason ? firstConfirmedQty * Math.max(0, Number(unitCost || 0)) : 0,
        approvedAmount: Math.max(0, Number(finalQty || 0)) * Math.max(0, Number(unitCost || 0)), forecastDaily, inventoryQty, storeInventoryQty, pendingQty,
        availableTo, aiJudgment, currentAvailableQty: Math.max(0, Number(source["目前實際可採購量"] || finalQty || 0)),
        packSize
      });
    }
    const orderDate = parseDateValue(options.orderDate) || new Date().toISOString().slice(0, 10);
    const suppliers = new Map();
    for (const row of rows.filter((item) => item.approvedAmount > 0)) {
      if (!suppliers.has(row.supplier)) suppliers.set(row.supplier, { supplier: row.supplier, amount: 0, confirmedQty: 0, consignmentAvailableQty: 0 });
      const supplier = suppliers.get(row.supplier);
      supplier.amount += row.approvedAmount;
      supplier.confirmedQty += row.finalQty;
      supplier.consignmentAvailableQty += row.currentAvailableQty;
    }
    const payments = [...suppliers.values()].map((supplier) => ({
      ...supplier,
      ...calculatePaymentSchedule({ ...supplier, orderDate, supplyMode: /力榮|普優[瑪碼]/.test(supplier.supplier) ? "consignment" : "direct", supplierRules: options.supplierRules || [] })
    }));
    payments.filter((item) => item.status !== "PASS").forEach((item) => errors.push({ sheetName: "付款月份", sourceRow: "", sku: "", message: `${item.supplier}：${item.message}` }));
    const suggestedAmount = rows.reduce((sum, row) => sum + row.suggestedAmount, 0);
    const manualAmount = rows.reduce((sum, row) => sum + row.manualAmount, 0);
    const blockedAmount = rows.reduce((sum, row) => sum + row.blockedAmount, 0);
    const approvedAmount = rows.reduce((sum, row) => sum + row.approvedAmount, 0);
    return { rows, errors, payments, orderDate, totals: { suggestedAmount, manualAmount, blockedAmount, approvedAmount, adjustmentAmount: approvedAmount - suggestedAmount } };
  }

  function buildErpPurchaseWorkbook(review, XLSX, options = {}) {
    if (!options.approved) throw new Error("尚未完成正式核准，禁止產生ERP檔案。");
    if (review.errors.length) throw new Error("回匯仍有阻擋項目，禁止產生ERP檔案。");
    const workbook = XLSX.utils.book_new();
    const supplierFilter = normalizeText(options.supplier || "");
    const rows = review.rows.filter((row) => Number(row.finalQty || 0) > 0 && (!supplierFilter || normalizeText(row.supplier) === supplierFilter));
    if (!rows.length) throw new Error("本批次沒有核准數量大於0的品項，無法產生ERP檔案。");
    const sheet = XLSX.utils.aoa_to_sheet([
      ["貨號", "品名", "顏色", "尺碼", "數量", "價格", "備註", "倉庫"],
      ...rows.map((row) => [
        String(row.sku || ""), String(row.name || ""), "", "",
        Math.trunc(Number(row.finalQty || 0)), Number(row.unitCost || 0), "", "寬承總倉"
      ])
    ]);
    setColumnWidths(sheet, [18, 52, 12, 12, 12, 14, 24, 16]);
    XLSX.utils.book_append_sheet(workbook, sheet, "通用貨品數量");
    return workbook;
  }

  global.ProcurementPlanningCore = {
    LOCKED_RULES,
    CONFIRMED_OVERRIDES,
    CONFIRMED_EXCLUSIONS,
    DEMAND_SALE_TYPES,
    CUSTOM_SKU_PREFIXES,
    CONFIRMED_COMBINATION_SKUS,
    PROCUREMENT_POLICY,
    SUPPLIER_RULES,
    DEFAULT_SPRING_FESTIVAL_RULE,
    PRIMARY_SUPPLIERS,
    normalizeText,
    normalizeHeader,
    normalizeSku,
    isAutomaticProcurementExcludedSku,
    isEightBySevenCustomItem,
    isAutomaticProcurementExcludedItem,
    isCustomerCustomSku,
    isCustomerCustomItem,
    customerCustomExclusionReason,
    normalizeName,
    isSellThroughStopName,
    parseNumber,
    inspectWorkbook,
    parseProductMasterWorkbook,
    parseInventoryWorkbook,
    parsePendingPurchaseWorkbook,
    parseTransferWorkbook,
    parseNewProductWorkbook,
    parseSalesWorkbook,
    parseForecastModelWorkbook,
    parseConsignmentWorkbook,
    parseLirongConsignmentWorkbook,
    buildLirongConsignmentRecommendations,
    normalizeBlacklist,
    blacklistMatch,
    resolveConsignment,
    aggregatePendingReports,
    summarizePurchaseReports,
    summarizeCompanyCostFlows,
    warehouseCompany,
    aggregateTransferReports,
    calculateNetProcurementDemand,
    roundSuggestedQuantity,
    roundByPack,
    puyoumaPackSize,
    purchaseUnitFromRules,
    findSupplierRule,
    supplierSelectionCatalog,
    calculatePaymentSchedule,
    evaluateConsignmentSupply,
    calculatePurchaseBudget,
    resolveReleasedBudgetAmount,
    inferMaterialCategory,
    classifyPuyoumaPurchaseTab,
    puyoumaConsignmentGroup,
    applyDemandModel,
    classifyXyz,
    resolveSupplyProfile,
    resolveSpringFestivalAdjustment,
    buildProcurementRecommendations,
    buildSpecialProcurementAnalysis,
    validateSourceDates,
    buildAnalysis,
    buildOutputWorkbook,
    procurementWorkUnitForRow,
    listProcurementWorkUnits,
    rowMatchesProcurementWorkUnit,
    buildRecommendationWorkbook,
    reviewReturnedWorkbook,
    buildSecondReviewWorkbook,
    reviewSecondApprovalWorkbook,
    buildErpPurchaseWorkbook,
    cellFillRgb,
    isPinkFill
  };
})(typeof globalThis !== "undefined" ? globalThis : window);

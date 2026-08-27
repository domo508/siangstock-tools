(function (global) {
  "use strict";

  const SOURCE_SCHEMAS = {
    a: {
      label: "A表・ERP收貨單",
      fields: {
        sku: ["貨號", "商品編號", "商品代號", "品號", "sku", "供應商貨號"],
        name: ["品名", "商品名稱", "商品品名"],
        qty: ["已收數量", "收貨數量", "進貨數量", "驗收數量", "數量"],
        unitPrice: ["未稅進貨價", "未稅單價", "供應商未稅價"],
        amount: ["未稅進貨額", "未稅金額", "未稅總額", "進貨未稅額"],
        supplier: ["供應商名稱", "供應商", "廠商名稱", "廠商"],
        doc: ["收貨單編碼", "收貨單號", "進貨單號", "驗收單號", "單據編號"],
        date: ["開單日期", "收貨日期", "入庫日期", "單據日期", "日期"]
      },
      required: ["sku", "name", "qty", "unitPrice", "amount", "date"]
    },
    b: {
      label: "B表・供應商對帳報表",
      fields: {
        transactionType: ["帳別", "交易類型", "單據類型", "類型"],
        sku: ["貨號", "貨品編號", "商品編號", "商品代號", "品號", "sku", "供應商貨號"],
        name: ["品名", "商品名稱", "商品品名"],
        qty: ["數量", "銷貨數量", "對帳數量"],
        unitPrice: ["單價", "未稅單價", "進貨價"],
        amount: ["合計", "總計", "銷貨小計", "未稅合計", "未稅金額", "未稅總額"],
        doc: ["進銷單號", "銷貨單號", "對帳單號", "單據編號", "單號"],
        date: ["帳款日", "對帳日期", "銷貨日期", "單據日期", "日期"]
      },
      required: ["name", "qty", "unitPrice", "amount", "date"]
    }
  };

  const FIELD_LABELS = {
    sku: "貨號", name: "品名", qty: "數量", unitPrice: "單價", amount: "合計／金額",
    supplier: "供應商", doc: "單據編號", date: "日期", transactionType: "帳別"
  };
  const NAME_MAPPING_SCHEMA = {
    fields: {
      sku: ["貨號", "我方貨號", "A表貨號", "商品貨號"],
      aName: ["品名", "我方品名", "A表品名", "商品名稱"],
      bName: ["上林品名", "供應商品名", "B表品名", "對方品名"],
      active: ["目前有進貨", "是否使用", "啟用"]
    },
    required: ["sku", "aName", "bName"]
  };
  const EPSILON = 0.000001;
  const NON_PRODUCT_NAMES = ["運費", "其他", "樣品", "展示", "版費", "加工費", "處理費", "包裝費", "代客鋪棉費用"];
  const PRODUCT_TYPES = ["薄被套", "兩用被", "床包", "涼被", "枕套", "靠枕套", "抱枕套", "靠枕", "抱枕", "沙發墊", "床墊"];

  function normalizeText(value) {
    return String(value == null ? "" : value).normalize("NFKC").trim().toLocaleLowerCase("zh-Hant");
  }

  function normalizeHeader(value) {
    return normalizeText(value).replace(/[\s\-_–—／/＆&()（）【】\[\]：:．.*]/g, "");
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

  function fieldLabel(field) { return FIELD_LABELS[field] || field; }

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

  function autoMapHeaders(headers, sourceType) {
    const schema = SOURCE_SCHEMAS[sourceType];
    const mapping = {};
    const used = new Set();
    for (const [field, aliases] of Object.entries(schema.fields)) {
      let bestIndex = -1;
      let bestScore = 0;
      headers.forEach((header, index) => {
        if (used.has(index)) return;
        const normalized = normalizeHeader(header);
        if (field === "unitPrice" && (normalized.includes("金額") || normalized.includes("合計") || normalized.endsWith("額"))) return;
        if (field === "date" && (normalized.includes("列印") || normalized.includes("新增"))) return;
        const score = scoreHeader(header, aliases);
        if (score > bestScore) { bestScore = score; bestIndex = index; }
      });
      mapping[field] = bestScore >= 60 ? bestIndex : null;
      if (mapping[field] != null) used.add(mapping[field]);
    }
    return mapping;
  }

  function validateMapping(sourceType, mapping) {
    const missing = SOURCE_SCHEMAS[sourceType].required.filter((field) => mapping[field] == null).map(fieldLabel);
    return { valid: missing.length === 0, missing };
  }

  function headerScore(row, sourceType) {
    if (!Array.isArray(row)) return 0;
    return Object.values(SOURCE_SCHEMAS[sourceType].fields).reduce((score, aliases) => score + (row.some((cell) => scoreHeader(cell, aliases) >= 60) ? 1 : 0), 0);
  }

  function inspectSheet(sheet, XLSX, sourceType) {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
    let headerRowIndex = 0;
    let bestScore = -1;
    rows.slice(0, 30).forEach((row, index) => {
      const score = headerScore(row, sourceType);
      if (score > bestScore) { bestScore = score; headerRowIndex = index; }
    });
    const headers = (rows[headerRowIndex] || []).map((value, index) => String(value || `欄位${index + 1}`).trim());
    const mapping = autoMapHeaders(headers, sourceType);
    return { headerRowIndex, headers, mapping, validation: validateMapping(sourceType, mapping), rows };
  }

  function detectSourceFormat(rows, sheetName, sourceType) {
    if (sourceType !== "b" || sheetName !== "帳款") return "";
    const signature = rows.slice(0, 3).flat().map((value) => String(value || "")).join(" ");
    return signature.includes("力榮興業有限公司") && signature.includes("收款對帳單明細表") ? "li-rong" : "";
  }

  function inspectWorkbook(workbook, XLSX, sourceType) {
    const sheets = workbook.SheetNames.map((name) => {
      const inspected = inspectSheet(workbook.Sheets[name], XLSX, sourceType);
      return { name, ...inspected, format: detectSourceFormat(inspected.rows, name, sourceType) };
    });
    sheets.sort((left, right) => Number(right.format === "li-rong") - Number(left.format === "li-rong")
      || Number(right.validation.valid) - Number(left.validation.valid)
      || headerScore(right.headers, sourceType) - headerScore(left.headers, sourceType));
    return { sourceType, format: sheets[0]?.format || "", sheets };
  }

  function inspectNameMappingWorkbook(workbook, XLSX) {
    const sheets = workbook.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: "" });
      let headerRowIndex = 0;
      let bestScore = -1;
      rows.slice(0, 30).forEach((row, index) => {
        const score = Object.values(NAME_MAPPING_SCHEMA.fields).reduce((total, aliases) => total + (row.some((cell) => scoreHeader(cell, aliases) >= 60) ? 1 : 0), 0);
        if (score > bestScore) { bestScore = score; headerRowIndex = index; }
      });
      const headers = (rows[headerRowIndex] || []).map((value, index) => String(value || `欄位${index + 1}`).trim());
      const mapping = {};
      const used = new Set();
      for (const [field, aliases] of Object.entries(NAME_MAPPING_SCHEMA.fields)) {
        let bestIndex = -1;
        let fieldScore = 0;
        headers.forEach((header, index) => {
          if (used.has(index)) return;
          const score = scoreHeader(header, aliases);
          if (score > fieldScore) { fieldScore = score; bestIndex = index; }
        });
        mapping[field] = fieldScore >= 60 ? bestIndex : null;
        if (mapping[field] != null) used.add(mapping[field]);
      }
      const missing = NAME_MAPPING_SCHEMA.required.filter((field) => mapping[field] == null).map((field) => ({ sku: "貨號", aName: "品名", bName: "上林品名" })[field]);
      return { name, rows, headerRowIndex, headers, mapping, validation: { valid: missing.length === 0, missing }, score: bestScore };
    });
    sheets.sort((left, right) => Number(right.validation.valid) - Number(left.validation.valid) || right.score - left.score);
    return { sheets };
  }

  function parseNameMappingWorkbook(workbook, XLSX, options = {}) {
    const inspection = inspectNameMappingWorkbook(workbook, XLSX);
    const selected = options.sheetName ? inspection.sheets.find((sheet) => sheet.name === options.sheetName) : inspection.sheets[0];
    if (!selected || !selected.validation.valid) throw new Error(`品名對照表缺少：${selected?.validation.missing.join("、") || "可讀取的工作表"}`);
    const records = [];
    for (let index = selected.headerRowIndex + 1; index < selected.rows.length; index += 1) {
      const row = selected.rows[index];
      const sku = String(row[selected.mapping.sku] || "").trim();
      const aName = String(row[selected.mapping.aName] || "").trim();
      const bName = String(row[selected.mapping.bName] || "").trim();
      const active = selected.mapping.active == null ? "" : String(row[selected.mapping.active] || "").trim();
      if (!sku && !aName && !bName) continue;
      records.push({ sourceRow: index + 1, sku, aName, bName, active, aliasKey: canonicalizeName(bName) });
    }
    const grouped = new Map();
    for (const record of records) {
      if (!record.sku || !record.aName || !record.aliasKey) continue;
      if (!grouped.has(record.aliasKey)) grouped.set(record.aliasKey, []);
      grouped.get(record.aliasKey).push(record);
    }
    const usable = [];
    const conflicts = [];
    for (const [aliasKey, rows] of grouped) {
      const uniqueSkus = [...new Set(rows.map((row) => row.sku))];
      if (uniqueSkus.length === 1) usable.push({ ...rows[0], aliasKey, sourceRows: rows.map((row) => row.sourceRow) });
      else conflicts.push({ aliasKey, bName: rows[0].bName, skus: uniqueSkus, sourceRows: rows.map((row) => row.sourceRow), rows });
    }
    if (!usable.length) throw new Error("品名對照表沒有可使用的一對一品名資料。");
    return {
      fileName: options.fileName || "", sheetName: selected.name, headerRowIndex: selected.headerRowIndex,
      records, usable, conflicts, usableByAlias: new Map(usable.map((row) => [row.aliasKey, row]))
    };
  }

  function applyNameMappingToBReport(report, nameMapping) {
    if (!nameMapping) return report;
    const mappedByRow = new Map();
    let mappedRecordCount = 0;
    const mappedNames = new Set();
    const unmappedNames = new Set();
    const records = report.records.map((record) => {
      if (String(record.sku || "").trim()) return { ...record };
      const mapped = nameMapping.usableByAlias.get(canonicalizeName(record.name));
      if (!mapped) { unmappedNames.add(record.name); return { ...record }; }
      mappedRecordCount += 1;
      mappedNames.add(record.name);
      const next = { ...record, sku: mapped.sku, nameMappingSourceRow: mapped.sourceRow, nameMappingAName: mapped.aName };
      mappedByRow.set(record.sourceRow, next);
      return next;
    });
    const rawRows = report.rawRows.map((row) => {
      const mapped = mappedByRow.get(row.sourceRow);
      if (!mapped) return { ...row };
      return { ...row, sku: mapped.sku, nameMappingSourceRow: mapped.nameMappingSourceRow, reason: `${row.reason}；品名對照表第${mapped.nameMappingSourceRow}列 → ${mapped.sku}` };
    });
    return {
      ...report, records, rawRows,
      nameMapping: {
        fileName: nameMapping.fileName, sheetName: nameMapping.sheetName,
        usableCount: nameMapping.usable.length, conflictCount: nameMapping.conflicts.length,
        mappedRecordCount, mappedUniqueNameCount: mappedNames.size, unmappedNames: [...unmappedNames].filter(Boolean).sort()
      }
    };
  }

  function valueAt(row, mapping, field) {
    const index = mapping[field];
    return index == null ? "" : row[index];
  }

  function isTotalRow(row, mapping) {
    const name = normalizeText(valueAt(row, mapping, "name"));
    const sku = normalizeText(valueAt(row, mapping, "sku"));
    return ["合計", "總計", "小計"].some((word) => name.includes(word) || sku.includes(word)) || (!name && !sku && row.filter((value) => value !== "" && value != null).length > 2);
  }

  function canonicalizeName(value) {
    let text = normalizeText(value)
      .replace(/[×＊*]/g, "x")
      .replace(/[＋+]/g, "plus")
      .replace(/pingu[™®?]/g, "pingu")
      .replace(/床包(?:三件套|兩件套|四件套|組|套)/g, "床包")
      .replace(/(?:鋪棉)?兩用被套|雙人兩用被|單人兩用被/g, "兩用被")
      .replace(/雙人薄被套|單人薄被套/g, "薄被套")
      .replace(/雙人床包|單人床包/g, "床包")
      .replace(/信封枕(?:套)?|壓框枕|枕套(?:2入|二入|對)/g, "枕套")
      .replace(/刺繡拉鍊抱枕/g, "抱枕套")
      .replace(/熊冷墊[-\s]*沙發/g, "沙發墊")
      .replace(/熊冷墊/g, "床墊")
      .replace(/床面墊子/g, "床墊")
      .replace(/沙發墊子/g, "沙發墊")
      .replace(/涼感涼被|熊冷被/g, "涼被")
      .replace(/60s?天絲/g, "天絲")
      .replace(/80s?天絲棉/g, "天絲棉")
      .replace(/(?:60s|80s|2入|二入|對)/g, "")
      .replace(/(?:含|不含)(?:兩個)?枕(?:頭)?套(?:2入)?/g, "")
      .replace(/plus(?:2枕|枕|袋)/g, "")
      .replace(/plus\d*/g, "")
      .replace(/cm/g, "")
      .replace(/尺/g, "")
      .replace(/[\s\-_–—／/＆&()（）【】\[\]：:．.,'’"?]/g, "");
    return text;
  }

  function bigrams(text) {
    if (text.length < 2) return new Set([text]);
    const result = new Set();
    for (let index = 0; index < text.length - 1; index += 1) result.add(text.slice(index, index + 2));
    return result;
  }

  function diceSimilarity(left, right) {
    const a = bigrams(left);
    const b = bigrams(right);
    let overlap = 0;
    a.forEach((gram) => { if (b.has(gram)) overlap += 1; });
    return a.size + b.size ? (2 * overlap) / (a.size + b.size) : 0;
  }

  function productType(name) {
    return PRODUCT_TYPES.find((type) => name.includes(type)) || "";
  }

  function signatureName(name) {
    let text = name;
    const genericWords = [
      "sybilho聯名", "印花樂聯名", "pingu", "翔仔居家", "26ss", "天絲棉", "天絲", "華爾紗", "雙層紗", "純棉", "涼感", "熊冷",
      "床包", "薄被套", "兩用被", "涼被", "枕套", "靠枕套", "抱枕套", "靠枕", "抱枕", "沙發墊", "床墊",
      "特大", "加大", "雙人", "單人", "聯名", "刺繡", "拉鍊", "含枕芯", "不含枕心"
    ];
    genericWords.forEach((word) => { text = text.replaceAll(word, ""); });
    return text.replace(/\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?/g, "").replace(/^[a-z]$|^[大小]$/g, "");
  }

  function dimensions(name) {
    return new Set(name.match(/\d+(?:\.\d+)?x\d+(?:\.\d+)?/g) || []);
  }

  function sizeTokens(name) {
    const text = normalizeText(name).replace(/[×＊*]/g, "x");
    const result = dimensions(text);
    const matches = text.matchAll(/(?:^|[^\dx.])(3\.5|4\.5|5|6|7|8)(?=尺)/g);
    for (const match of matches) result.add(match[1]);
    return result;
  }

  function priceSimilarity(left, right) {
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
    if (Math.abs(left - right) < EPSILON) return 1;
    return Math.max(0, 1 - Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 1));
  }

  function quantitySimilarity(left, right) {
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
    if (Math.abs(left - right) < EPSILON) return 1;
    return Math.max(0, 1 - Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 1));
  }

  function setsOverlap(left, right) {
    for (const value of left) if (right.has(value)) return true;
    return false;
  }

  function matchScore(a, b) {
    const exactSku = Boolean(a.sku && b.sku && normalizeText(a.sku) === normalizeText(b.sku));
    const nameScore = diceSimilarity(a.canonicalName, b.canonicalName);
    const aType = productType(a.canonicalName);
    const bType = productType(b.canonicalName);
    const aDimensions = dimensions(a.canonicalName);
    const bDimensions = dimensions(b.canonicalName);
    const aSizes = sizeTokens(a.name || a.canonicalName);
    const bSizes = sizeTokens(b.name || b.canonicalName);
    const sizesCompatible = !aSizes.size || !bSizes.size || setsOverlap(aSizes, bSizes);
    let compatibility = 0;
    if (aType && bType) compatibility += aType === bType ? 0.12 : -0.4;
    if (aDimensions.size && bDimensions.size) compatibility += setsOverlap(aDimensions, bDimensions) ? 0.08 : -0.25;
    if (!sizesCompatible) compatibility -= 0.65;
    const signatureScore = diceSimilarity(signatureName(a.canonicalName), signatureName(b.canonicalName));
    const priceScore = priceSimilarity(a.unitPrice, b.unitPrice);
    const qtyScore = quantitySimilarity(a.qty, b.qty);
    const score = exactSku ? 1 : Math.max(0, Math.min(1, nameScore * 0.58 + priceScore * 0.24 + qtyScore * 0.06 + compatibility));
    return { score, nameScore, signatureScore, priceScore, qtyScore, aType, bType, sizesCompatible, exactSku };
  }

  function effectiveUnitPrice(amount, qty, prices) {
    const unique = [...new Set(prices.filter((value) => Number.isFinite(value)))];
    if (unique.length === 1) return unique[0];
    if (Math.abs(qty) > EPSILON) return amount / qty;
    return unique[0] || 0;
  }

  function hasDistinctiveDimensions(value) {
    return /\d+(?:\.\d+)?\s*[x×＊*]\s*\d+(?:\.\d+)?(?:\s*[x×＊*]\s*\d+(?:\.\d+)?)?/i.test(String(value || ""));
  }

  function isRecoverableMisplacedProductName(value) {
    const normalized = normalizeText(value);
    const blockedHints = ["運費", "打樣", "色樣", "版費", "加工費", "處理費", "包裝費"];
    return hasDistinctiveDimensions(value) && !blockedHints.some((word) => normalized.includes(normalizeText(word)));
  }

  function findMisplacedBNames(rows, headerRowIndex, mapping) {
    const recoveredByDataRow = new Map();
    const consumedNameRows = new Map();
    if (mapping.transactionType == null || mapping.name == null) return { recoveredByDataRow, consumedNameRows };
    for (let index = headerRowIndex + 1; index < rows.length - 1; index += 1) {
      const row = rows[index];
      const nextRow = rows[index + 1];
      if (!Array.isArray(row) || !Array.isArray(nextRow)) continue;
      const currentName = normalizeText(valueAt(row, mapping, "name"));
      const currentType = String(valueAt(row, mapping, "transactionType") || "").trim();
      const hasFinancialValues = parseNumber(valueAt(row, mapping, "qty")) != null
        && parseNumber(valueAt(row, mapping, "unitPrice")) != null
        && parseNumber(valueAt(row, mapping, "amount")) != null;
      if ((currentName && currentName !== "其他") || !/銷貨|銷退|退貨|折讓/.test(currentType) || !hasFinancialValues) continue;
      const candidate = String(valueAt(nextRow, mapping, "transactionType") || "").trim();
      const nextHasNormalName = String(valueAt(nextRow, mapping, "name") || "").trim();
      const nextHasFinancialValues = ["qty", "unitPrice", "amount"].some((field) => parseNumber(valueAt(nextRow, mapping, field)) != null);
      if (!candidate || nextHasNormalName || nextHasFinancialValues || !isRecoverableMisplacedProductName(candidate)) continue;
      recoveredByDataRow.set(index, { name: candidate, nameSourceRow: index + 2 });
      consumedNameRows.set(index + 1, index + 1);
    }
    return { recoveredByDataRow, consumedNameRows };
  }

  function extractSource(workbook, XLSX, sourceType, options) {
    const sheetName = options.sheetName || workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
    const mapping = options.mapping;
    const headerRowIndex = options.headerRowIndex;
    const format = options.format || detectSourceFormat(rows, sheetName, sourceType);
    const records = [];
    const rawRows = [];
    const carried = { date: "", doc: "", transactionType: "", supplier: "" };
    const misplaced = sourceType === "b" ? findMisplacedBNames(rows, headerRowIndex, mapping) : { recoveredByDataRow: new Map(), consumedNameRows: new Map() };
    for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (!Array.isArray(row) || row.every((value) => value == null || String(value).trim() === "")) continue;
      if (sourceType === "b" && misplaced.consumedNameRows.has(index)) {
        rawRows.push({
          source: "B", sourceFile: options.fileName || "", sheetName, sourceRow: index + 1,
          date: "", doc: "", supplier: "", transactionType: String(valueAt(row, mapping, "transactionType") || "").trim(),
          sku: "", name: "", qty: 0, unitPrice: 0, amount: 0, included: false,
          reason: `錯置品名已併入B表第${misplaced.consumedNameRows.get(index)}列商品明細`
        });
        continue;
      }
      const recoveredName = misplaced.recoveredByDataRow.get(index);
      const name = recoveredName?.name || String(valueAt(row, mapping, "name") || "").trim();
      const sku = String(valueAt(row, mapping, "sku") || "").trim();
      const qtyValue = parseNumber(valueAt(row, mapping, "qty"));
      const priceValue = parseNumber(valueAt(row, mapping, "unitPrice"));
      const amountValue = parseNumber(valueAt(row, mapping, "amount"));
      let date = valueAt(row, mapping, "date");
      let doc = valueAt(row, mapping, "doc");
      let supplier = valueAt(row, mapping, "supplier");
      let transactionType = String(valueAt(row, mapping, "transactionType") || "").trim();
      if (sourceType === "b") {
        for (const [field, value] of Object.entries({ date, doc, transactionType, supplier })) {
          if (value != null && String(value).trim() !== "") carried[field] = value;
        }
        date ||= carried.date;
        doc ||= carried.doc;
        supplier ||= carried.supplier;
        transactionType ||= carried.transactionType;
      }
      if (sourceType === "b" && format === "li-rong") {
        supplier ||= "力榮";
        doc ||= String(date || "");
        transactionType ||= String(date || "").match(/\(([^)]+)\)/)?.[1] || "帳款";
      }
      let included = true;
      let reason = recoveredName ? `納入比對；品名由B表第${recoveredName.nameSourceRow}列帳別欄補回` : "納入比對";
      if (!name || qtyValue == null || priceValue == null || amountValue == null) { included = false; reason = "缺少品名、數量、單價或金額"; }
      if (sourceType === "a" && (!sku || isTotalRow(row, mapping))) { included = false; reason = isTotalRow(row, mapping) ? "合計列" : "缺少貨號"; }
      if (sourceType === "b" && NON_PRODUCT_NAMES.some((word) => normalizeText(name) === normalizeText(word))) { included = false; reason = "非商品項目"; }
      let sign = 1;
      if (sourceType === "b" && /銷退|退貨|折讓/.test(transactionType)) sign = -1;
      const record = {
        source: sourceType.toUpperCase(), sourceFile: options.fileName || "", sheetName, sourceRow: index + 1,
        nameSourceRow: recoveredName?.nameSourceRow || null, formatRepair: recoveredName ? "帳別欄錯置品名補回" : "",
        date, doc, supplier,
        transactionType, sku, name, qty: sign * Math.abs(qtyValue || 0), unitPrice: priceValue || 0,
        amount: sign * Math.abs(amountValue || 0), included, reason
      };
      rawRows.push(record);
      if (included) records.push(record);
    }
    return {
      sourceType, fileName: options.fileName || "", sheetName, headerRowIndex, mapping, records, rawRows, format,
      periodScope: format === "li-rong" ? "selected-month-statement" : "row-date"
    };
  }

  function sourceItemKey(report, record) {
    if (report.sourceType === "a") return record.sku;
    if (record.sku) return `sku:${normalizeText(record.sku)}`;
    return canonicalizeName(record.name);
  }

  function sourceRowLabel(record) {
    return record.nameSourceRow ? `${record.sourceRow}（品名${record.nameSourceRow}）` : String(record.sourceRow);
  }

  function aggregateSource(report) {
    const map = new Map();
    for (const record of report.records) {
      const key = sourceItemKey(report, record);
      const current = map.get(key) || {
        key, source: report.sourceType.toUpperCase(), sku: record.sku, name: record.name,
        canonicalName: canonicalizeName(record.name), qty: 0, amount: 0, prices: [], rows: [], docs: new Set(), dates: new Set()
      };
      current.qty += record.qty;
      current.amount += record.amount;
      current.prices.push(record.unitPrice);
      current.rows.push(sourceRowLabel(record));
      if (record.doc) current.docs.add(String(record.doc));
      if (record.date) current.dates.add(parseDateValue(record.date)?.key || String(record.date));
      map.set(key, current);
    }
    return [...map.values()].map((item) => ({ ...item, docs: [...item.docs], dates: [...item.dates], unitPrice: effectiveUnitPrice(item.amount, item.qty, item.prices) }));
  }

  function findMatches(aItems, bItems) {
    const candidates = [];
    aItems.forEach((a, aIndex) => bItems.forEach((b, bIndex) => candidates.push({ aIndex, bIndex, ...matchScore(a, b) })));
    const bestForA = new Map();
    const bestForB = new Map();
    for (const candidate of candidates) {
      const aList = bestForA.get(candidate.aIndex) || [];
      aList.push(candidate); bestForA.set(candidate.aIndex, aList);
      const bList = bestForB.get(candidate.bIndex) || [];
      bList.push(candidate); bestForB.set(candidate.bIndex, bList);
    }
    bestForA.forEach((list) => list.sort((left, right) => right.score - left.score));
    bestForB.forEach((list) => list.sort((left, right) => right.score - left.score));
    const accepted = [];
    const usedA = new Set();
    const usedB = new Set();
    const sorted = candidates.slice().sort((left, right) => right.score - left.score);
    for (const candidate of sorted) {
      if (usedA.has(candidate.aIndex) || usedB.has(candidate.bIndex)) continue;
      const aList = bestForA.get(candidate.aIndex);
      const bList = bestForB.get(candidate.bIndex);
      const mutualBest = aList[0] === candidate && bList[0] === candidate;
      const aMargin = candidate.score - (aList[1] ? aList[1].score : 0);
      const bMargin = candidate.score - (bList[1] ? bList[1].score : 0);
      const exactName = aItems[candidate.aIndex].canonicalName === bItems[candidate.bIndex].canonicalName;
      const strong = candidate.exactSku || (candidate.sizesCompatible && candidate.score >= 0.66 && (exactName || (mutualBest && aMargin >= 0.025 && bMargin >= 0.025)));
      if (!strong) continue;
      usedA.add(candidate.aIndex); usedB.add(candidate.bIndex);
      accepted.push({ ...candidate, confidence: candidate.exactSku ? "貨號完全一致" : exactName ? "名稱完全一致" : `名稱／規格相似度${Math.round(candidate.nameScore * 100)}%` });
    }
    for (const candidate of sorted) {
      if (usedA.has(candidate.aIndex) || usedB.has(candidate.bIndex)) continue;
      const samePrice = Math.abs(aItems[candidate.aIndex].unitPrice - bItems[candidate.bIndex].unitPrice) < EPSILON;
      const sameType = candidate.aType && candidate.aType === candidate.bType;
      if (!sameType || !candidate.sizesCompatible || candidate.signatureScore < 0.75 || (!samePrice && candidate.nameScore < 0.35)) continue;
      usedA.add(candidate.aIndex); usedB.add(candidate.bIndex);
      accepted.push({ ...candidate, confidence: samePrice ? `設計名稱與單價一致（${Math.round(candidate.signatureScore * 100)}%）` : `設計名稱與規格一致（${Math.round(candidate.signatureScore * 100)}%）` });
    }
    const suspected = [];
    for (const [aIndex, list] of bestForA) {
      if (usedA.has(aIndex)) continue;
      const candidate = list.find((entry) => {
        if (usedB.has(entry.bIndex) || entry.score < 0.48 || !entry.aType || entry.aType !== entry.bType || entry.signatureScore < 0.5) return false;
        return entry.sizesCompatible;
      });
      if (candidate) suspected.push(candidate);
    }
    return { accepted, suspected, usedA, usedB };
  }

  function differenceStatus(a, b) {
    const qtyDifferent = Math.abs(a.qty - b.qty) > EPSILON;
    const priceDifferent = Math.abs(a.unitPrice - b.unitPrice) > EPSILON;
    const amountDifferent = Math.abs(a.amount - b.amount) > EPSILON;
    if (qtyDifferent && priceDifferent) return "數量＋單價差異";
    if (qtyDifferent) return "數量差異";
    if (priceDifferent) return "單價差異";
    if (amountDifferent) return "計算異常";
    return "完全通過";
  }

  function pairedRow(a, b, match) {
    const status = differenceStatus(a, b);
    return {
      status, aSku: a.sku, aName: a.name, bName: b.name,
      aQty: a.qty, bQty: b.qty, qtyDifference: a.qty - b.qty,
      aUnitPrice: a.unitPrice, bUnitPrice: b.unitPrice, unitPriceDifference: a.unitPrice - b.unitPrice,
      aAmount: a.amount, bAmount: b.amount, amountDifference: a.amount - b.amount,
      matchBasis: match.confidence, matchScore: match.score, aRows: a.rows.join("、"), bRows: b.rows.join("、")
    };
  }

  function analyzeReports(aReport, bReport) {
    const aItems = aggregateSource(aReport);
    const bItems = aggregateSource(bReport);
    const matching = findMatches(aItems, bItems);
    const paired = matching.accepted.map((match) => pairedRow(aItems[match.aIndex], bItems[match.bIndex], match));
    const suspectedByA = new Map(matching.suspected.map((candidate) => [candidate.aIndex, candidate]));
    const aOnly = aItems.filter((_item, index) => !matching.usedA.has(index)).map((item, indexInFiltered) => {
      const originalIndex = aItems.indexOf(item);
      const candidate = suspectedByA.get(originalIndex);
      const candidateName = candidate ? bItems[candidate.bIndex].name : "";
      return { status: "僅A表存在", aSku: item.sku, aName: item.name, bName: "", aQty: item.qty, bQty: null, qtyDifference: item.qty, aUnitPrice: item.unitPrice, bUnitPrice: null, unitPriceDifference: null, aAmount: item.amount, bAmount: null, amountDifference: item.amount, matchBasis: candidateName ? `疑似：${candidateName}` : "未找到可靠對應商品", suspected: Boolean(candidateName), sortIndex: indexInFiltered };
    });
    const bOnly = bItems.filter((_item, index) => !matching.usedB.has(index)).map((item) => ({ status: "僅B表存在", aSku: "", aName: "", bName: item.name, aQty: null, bQty: item.qty, qtyDifference: -item.qty, aUnitPrice: null, bUnitPrice: item.unitPrice, unitPriceDifference: null, aAmount: null, bAmount: item.amount, amountDifference: -item.amount, matchBasis: "未找到可靠對應商品" }));
    const passed = paired.filter((item) => item.status === "完全通過");
    const differences = paired.filter((item) => item.status !== "完全通過").sort((left, right) => Math.abs(right.amountDifference) - Math.abs(left.amountDifference));
    const unmatched = [...aOnly, ...bOnly].sort((left, right) => Math.abs(right.amountDifference || 0) - Math.abs(left.amountDifference || 0));
    const totals = {
      aItemCount: aItems.length, bItemCount: bItems.length, matchedCount: paired.length,
      passCount: passed.length, differenceCount: differences.length, aOnlyCount: aOnly.length, bOnlyCount: bOnly.length,
      suspectedCount: aOnly.filter((item) => item.suspected).length,
      aPairRate: aItems.length ? paired.length / aItems.length : 0,
      bPairRate: bItems.length ? paired.length / bItems.length : 0,
      aAmount: aItems.reduce((sum, item) => sum + item.amount, 0),
      bAmount: bItems.reduce((sum, item) => sum + item.amount, 0),
      matchedAmountDifference: paired.reduce((sum, item) => sum + item.amountDifference, 0),
      absoluteDifference: differences.reduce((sum, item) => sum + Math.abs(item.amountDifference), 0)
    };
    return { generatedAt: new Date().toISOString(), aReport, bReport, aItems, bItems, paired, passed, differences, unmatched, aOnly, bOnly, totals };
  }

  function parseDateValue(value) {
    if (Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.valueOf())) {
      return { date: new Date(value.getFullYear(), value.getMonth(), value.getDate()), key: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` };
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
      return { date: new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()), key: `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}` };
    }
    const match = String(value || "").trim().match(/(\d{2,4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (!match) return null;
    const sourceYear = Number(match[1]);
    const year = sourceYear < 1912 ? sourceYear + 1911 : sourceYear;
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return { date, key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
  }

  function periodBounds(monthText, cutoffText) {
    const match = String(monthText || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) throw new Error("請選擇正確的對帳月份。");
    const year = Number(match[1]);
    const month = Number(match[2]);
    const start = new Date(year, month - 1, 1);
    const next = new Date(year, month, 1);
    const afterNext = new Date(year, month + 1, 1);
    const cutoffParsed = parseDateValue(cutoffText);
    if (!cutoffParsed || cutoffParsed.date < next) throw new Error("跨月補收截止日必須在對帳月份結束之後。");
    if (cutoffParsed.date >= afterNext) throw new Error("跨月補收截止日必須落在對帳月份的次月內。");
    return { monthText, start, next, end: new Date(next.valueOf() - 86400000), cutoff: cutoffParsed.date, cutoffKey: cutoffParsed.key };
  }

  function sameMonth(parsed, bounds) {
    return parsed && parsed.date >= bounds.start && parsed.date < bounds.next;
  }

  function receiptKey(record) {
    const date = parseDateValue(record.aReceiptDate || record.date);
    return [String(record.aDoc || record.doc || "").trim(), String(record.aSku || record.sku || "").trim(), date ? date.key : "", Number(record.aUnitPrice ?? record.unitPrice ?? 0)].join("|");
  }

  function applyPriorAllocations(aReport, allocations) {
    const remaining = new Map();
    for (const allocation of allocations || []) {
      const key = receiptKey(allocation);
      remaining.set(key, (remaining.get(key) || 0) + Math.abs(Number(allocation.recognizedQty || 0)));
    }
    const records = [];
    const exclusions = [];
    for (const record of aReport.records) {
      const key = receiptKey(record);
      const available = Math.max(0, Number(record.qty || 0));
      const used = Math.min(available, remaining.get(key) || 0);
      if (used > EPSILON) {
        exclusions.push({ ...record, excludedQty: used, excludedAmount: used * record.unitPrice, priorMonths: [...new Set((allocations || []).filter((item) => receiptKey(item) === key).map((item) => item.recognitionMonth).filter(Boolean))].join("、") });
        remaining.set(key, Math.max(0, (remaining.get(key) || 0) - used));
      }
      const residualQty = available - used;
      if (residualQty > EPSILON) records.push({ ...record, qty: residualQty, amount: residualQty * record.unitPrice, priorExcludedQty: used });
    }
    return { records, exclusions };
  }

  function reportWithRecords(report, records, rawReasonByRow = new Map()) {
    const includedRows = new Set(records.map((record) => record.sourceRow));
    const rawRows = report.rawRows.map((row) => {
      if (!row.included) return { ...row };
      const detail = rawReasonByRow.get(row.sourceRow);
      const included = includedRows.has(row.sourceRow);
      const includedReason = report.periodScope === "selected-month-statement"
        ? "納入指定月份整份帳款；原建單日期僅供稽核"
        : row.formatRepair ? `納入本期比對；${row.formatRepair}` : "納入本期比對";
      const mappingReason = row.nameMappingSourceRow ? `；品名對照表第${row.nameMappingSourceRow}列 → ${row.sku}` : "";
      return { ...row, included, reason: detail || (included ? `${includedReason}${mappingReason}` : "不在本期比對範圍") };
    });
    return { ...report, records, rawRows };
  }

  function recordDateTime(record) {
    return parseDateValue(record?.date)?.date?.valueOf() || 0;
  }

  function quantityText(value) {
    const number = Number(value || 0);
    return Number.isInteger(number) ? String(number) : String(Math.round(number * 1000) / 1000);
  }

  function auditRecordText(source, record, qty) {
    const date = parseDateValue(record.date)?.key || String(record.date || "未提供日期");
    const doc = String(record.doc || "未提供單號");
    const rowText = record.nameSourceRow ? `${source}表第${record.sourceRow}列（品名第${record.nameSourceRow}列）` : `${source}表第${record.sourceRow}列`;
    return `${rowText}｜${date}｜${doc}｜${quantityText(qty)}件`;
  }

  function buildBDemandLots(records) {
    const lots = [];
    let unappliedReturn = 0;
    const ordered = records.slice().sort((left, right) => left.sourceRow - right.sourceRow);
    for (const record of ordered) {
      if (record.qty > EPSILON) {
        const offset = Math.min(record.qty, unappliedReturn);
        unappliedReturn -= offset;
        const remaining = record.qty - offset;
        if (remaining > EPSILON) lots.push({ record, originalQty: remaining, remaining });
        continue;
      }
      if (record.qty >= -EPSILON) continue;
      let returned = -record.qty;
      for (let index = lots.length - 1; index >= 0 && returned > EPSILON; index -= 1) {
        const offset = Math.min(lots[index].remaining, returned);
        lots[index].remaining -= offset;
        returned -= offset;
      }
      unappliedReturn += returned;
    }
    return lots.filter((lot) => lot.remaining > EPSILON);
  }

  function lineCandidateScore(aLot, bLot) {
    let score = 0;
    if (Math.abs(aLot.remaining - bLot.remaining) <= EPSILON) score += 10000;
    if (Math.abs(aLot.record.unitPrice - bLot.record.unitPrice) <= EPSILON) score += 500;
    if (!aLot.crossMonth) score += 300;
    const aDate = recordDateTime(aLot.record);
    const bDate = recordDateTime(bLot.record);
    if (aDate && bDate) {
      const days = Math.round((aDate - bDate) / 86400000);
      if (days >= 0) score += 240 - Math.min(days, 180);
      else score += 100 - Math.min(Math.abs(days), 180);
      if (aLot.crossMonth && days >= 0) score += 80;
    }
    return score;
  }

  function allocateLineQuantities(baseRecords, crossRecords, bRecords, bounds) {
    const aLots = [
      ...baseRecords.map((record) => ({ record, remaining: Math.max(0, record.qty), crossMonth: false })),
      ...crossRecords.map((record) => ({ record, remaining: Math.max(0, record.qty), crossMonth: true }))
    ].filter((lot) => lot.remaining > EPSILON);
    const bLots = buildBDemandLots(bRecords);
    const allocations = [];
    const allocate = (aLot, bLot, qty) => {
      aLot.remaining -= qty;
      bLot.remaining -= qty;
      allocations.push({ aRecord: aLot.record, bRecord: bLot.record, qty, crossMonth: aLot.crossMonth });
    };

    while (true) {
      const exact = [];
      for (const aLot of aLots) for (const bLot of bLots) {
        if (aLot.remaining <= EPSILON || bLot.remaining <= EPSILON || Math.abs(aLot.remaining - bLot.remaining) > EPSILON) continue;
        exact.push({ aLot, bLot, score: lineCandidateScore(aLot, bLot) });
      }
      exact.sort((left, right) => right.score - left.score || left.bLot.record.sourceRow - right.bLot.record.sourceRow || left.aLot.record.sourceRow - right.aLot.record.sourceRow);
      if (!exact.length) break;
      allocate(exact[0].aLot, exact[0].bLot, exact[0].bLot.remaining);
    }

    const orderedB = bLots.slice().sort((left, right) => recordDateTime(left.record) - recordDateTime(right.record) || left.record.sourceRow - right.record.sourceRow);
    for (const bLot of orderedB) {
      while (bLot.remaining > EPSILON) {
        const candidates = aLots.filter((lot) => lot.remaining > EPSILON).sort((left, right) => lineCandidateScore(right, bLot) - lineCandidateScore(left, bLot) || left.record.sourceRow - right.record.sourceRow);
        if (!candidates.length) break;
        allocate(candidates[0], bLot, Math.min(candidates[0].remaining, bLot.remaining));
      }
    }

    const remainingA = aLots.filter((lot) => !lot.crossMonth && lot.remaining > EPSILON);
    const remainingB = bLots.filter((lot) => lot.remaining > EPSILON);
    const priorWindowDay = bounds.cutoff.getDate();
    const suspectedPrior = remainingA.filter((lot) => {
      const parsed = parseDateValue(lot.record.date);
      return parsed && parsed.date.getDate() <= priorWindowDay;
    });
    return { allocations, remainingA, remainingB, suspectedPrior };
  }

  function ledgerRowsFromWorkbook(workbook, XLSX) {
    const sheetName = workbook.SheetNames.find((name) => name === "08_跨月認列台帳");
    if (!sheetName) throw new Error("上期結果找不到「08_跨月認列台帳」頁籤。");
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: true, defval: "" });
    return rows.filter((row) => row["A收貨單號"] && row["A貨號"] && parseNumber(row["已認列數量"]) != null).map((row) => ({
      recognitionMonth: String(row["認列月份"] || ""), supplier: String(row["供應商"] || ""),
      bDate: row["B帳款日"], bDoc: String(row["B單號"] || ""), bName: String(row["B品名"] || ""),
      aReceiptDate: row["A收貨日"], aDoc: String(row["A收貨單號"] || ""), aSku: String(row["A貨號"] || ""), aName: String(row["A品名"] || ""),
      recognizedQty: Math.abs(parseNumber(row["已認列數量"]) || 0), aUnitPrice: parseNumber(row["A未稅單價"]) || 0,
      recognizedAmount: parseNumber(row["已認列金額"]) || 0, crossMonthDays: parseNumber(row["跨月天數"]) || 0,
      fingerprint: String(row["唯一識別碼"] || "")
    }));
  }

  function inferDominantMonth(report) {
    if (report.periodScope === "selected-month-statement") return "";
    const counts = new Map();
    for (const record of report.records) {
      const parsed = parseDateValue(record.date);
      if (!parsed) continue;
      const month = parsed.key.slice(0, 7);
      counts.set(month, (counts.get(month) || 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || "";
  }

  function analyzeMonthlyReports(aReport, bReport, options = {}) {
    const bounds = periodBounds(options.month, options.cutoff);
    const priorLedger = Array.isArray(options.priorLedger) ? options.priorLedger : [];
    const priorResult = applyPriorAllocations(aReport, priorLedger);
    const baseRecords = [];
    const crossRecords = [];
    for (const record of priorResult.records) {
      const parsed = parseDateValue(record.date);
      if (sameMonth(parsed, bounds)) baseRecords.push(record);
      else if (parsed && parsed.date >= bounds.next && parsed.date <= bounds.cutoff) crossRecords.push(record);
    }
    const bRecords = bReport.periodScope === "selected-month-statement"
      ? bReport.records.slice()
      : bReport.records.filter((record) => sameMonth(parseDateValue(record.date), bounds));
    if (!bRecords.length) throw new Error(`${bounds.monthText}的B表沒有可比對商品，請確認帳款日與月份。`);
    const baseAReport = reportWithRecords(aReport, baseRecords);
    const scopedBReport = reportWithRecords(bReport, bRecords);
    const combinedAReport = reportWithRecords(aReport, [...baseRecords, ...crossRecords]);
    const baseItems = aggregateSource(baseAReport);
    const combinedAItems = aggregateSource(combinedAReport);
    const bItems = aggregateSource(scopedBReport);
    const matching = findMatches(combinedAItems, bItems);
    const baseBySku = new Map(baseItems.map((item) => [item.sku, item]));
    const baseRecordsBySku = new Map();
    const crossRecordsBySku = new Map();
    const bRecordsByKey = new Map();
    for (const record of baseRecords) {
      const rows = baseRecordsBySku.get(record.sku) || [];
      rows.push(record); baseRecordsBySku.set(record.sku, rows);
    }
    for (const record of crossRecords) {
      const rows = crossRecordsBySku.get(record.sku) || [];
      rows.push(record); crossRecordsBySku.set(record.sku, rows);
    }
    for (const record of bRecords) {
      const key = sourceItemKey(scopedBReport, record);
      const rows = bRecordsByKey.get(key) || [];
      rows.push(record); bRecordsByKey.set(key, rows);
    }

    const paired = [];
    const currentLedger = [];
    const selectedCrossByRow = new Map();
    for (const match of matching.accepted) {
      const combinedItem = combinedAItems[match.aIndex];
      const bItem = bItems[match.bIndex];
      const baseItem = baseBySku.get(combinedItem.sku);
      const audit = allocateLineQuantities(baseRecordsBySku.get(combinedItem.sku) || [], crossRecordsBySku.get(combinedItem.sku) || [], bRecordsByKey.get(bItem.key) || [], bounds);
      const recognizedQty = audit.allocations.reduce((sum, row) => sum + row.qty, 0);
      const crossMonthQty = audit.allocations.filter((row) => row.crossMonth).reduce((sum, row) => sum + row.qty, 0);
      const aMissingQty = audit.remainingB.reduce((sum, row) => sum + row.remaining, 0);
      const bMissingQty = audit.remainingA.reduce((sum, row) => sum + row.remaining, 0);
      const suspectedPriorQty = audit.suspectedPrior.reduce((sum, row) => sum + row.remaining, 0);
      const recognizedAAmount = audit.allocations.reduce((sum, row) => sum + row.qty * row.aRecord.unitPrice, 0);
      const recognizedAUnitPrice = recognizedQty > EPSILON ? recognizedAAmount / recognizedQty : (baseItem?.unitPrice ?? combinedItem.unitPrice);
      const unitPriceDifference = recognizedAUnitPrice - bItem.unitPrice;
      const priceDifferent = Math.abs(unitPriceDifference) > EPSILON;
      const internalAmountAnomaly = [...(baseRecordsBySku.get(combinedItem.sku) || []), ...(bRecordsByKey.get(bItem.key) || [])]
        .some((record) => Math.abs(record.amount - record.qty * record.unitPrice) > EPSILON);
      const hasQuantityIssue = aMissingQty > EPSILON || bMissingQty > EPSILON;
      const onlySuspectedPrior = bMissingQty > EPSILON && aMissingQty <= EPSILON && Math.abs(bMissingQty - suspectedPriorQty) <= EPSILON;
      let status;
      if (!hasQuantityIssue && !priceDifferent && !internalAmountAnomaly) status = crossMonthQty > EPSILON ? "跨月完全通過" : "完全通過";
      else if (onlySuspectedPrior) status = `${crossMonthQty > EPSILON ? "跨月配對＋" : ""}疑似前期跨月${priceDifferent ? "＋單價差異" : ""}`;
      else if (hasQuantityIssue && priceDifferent) status = `${crossMonthQty > EPSILON ? "跨月" : ""}數量＋單價差異`;
      else if (hasQuantityIssue) status = `${crossMonthQty > EPSILON ? "跨月" : ""}數量差異`;
      else if (priceDifferent) status = `${crossMonthQty > EPSILON ? "跨月" : ""}單價差異`;
      else status = `${crossMonthQty > EPSILON ? "跨月" : ""}計算異常`;

      const crossDetails = audit.allocations.filter((row) => row.crossMonth).map((row) => `${auditRecordText("B", row.bRecord, row.qty)} ↔ ${auditRecordText("A", row.aRecord, row.qty)}`);
      const priceDifferenceDetails = audit.allocations.filter((row) => Math.abs(row.aRecord.unitPrice - row.bRecord.unitPrice) > EPSILON)
        .map((row) => `${auditRecordText("A", row.aRecord, row.qty)}・${quantityText(row.aRecord.unitPrice)}元 ↔ ${auditRecordText("B", row.bRecord, row.qty)}・${quantityText(row.bRecord.unitPrice)}元`);
      const suspectedDetails = audit.suspectedPrior.map((row) => auditRecordText("A", row.record, row.remaining));
      const aMissingDetails = audit.remainingB.map((row) => auditRecordText("B", row.record, row.remaining));
      const bMissingDetails = audit.remainingA.map((row) => auditRecordText("A", row.record, row.remaining));
      const explanation = [];
      if (recognizedQty > EPSILON) explanation.push(`逐筆已核對${quantityText(recognizedQty)}件${crossMonthQty > EPSILON ? `（含跨月${quantityText(crossMonthQty)}件）` : ""}`);
      if (aMissingQty > EPSILON) explanation.push(`A表缺少可對應收貨${quantityText(aMissingQty)}件，請查B來源明細`);
      if (bMissingQty > EPSILON) explanation.push(`B表缺少可對應帳款${quantityText(bMissingQty)}件，請查A來源明細`);
      if (suspectedPriorQty > EPSILON) explanation.push(`其中${quantityText(suspectedPriorQty)}件位於月初，疑似應由上期跨月認列，需匯入上期台帳確認`);
      if (priceDifferenceDetails.length) explanation.push(`逐筆單價差異：${priceDifferenceDetails.join("；")}`);

      for (const allocation of audit.allocations.filter((row) => row.crossMonth)) {
        const record = allocation.aRecord;
        const bRecord = allocation.bRecord;
        const aDate = parseDateValue(record.date);
        const bDate = parseDateValue(bRecord.date);
        const crossMonthDays = aDate && bDate ? Math.round((aDate.date - bDate.date) / 86400000) : 0;
        selectedCrossByRow.set(record.sourceRow, (selectedCrossByRow.get(record.sourceRow) || 0) + allocation.qty);
        currentLedger.push({
          recognitionMonth: bounds.monthText, supplier: record.supplier || "", bDate: bDate?.key || bRecord.date, bDoc: String(bRecord.doc || ""), bName: bRecord.name,
          aReceiptDate: aDate?.key || record.date, aDoc: String(record.doc || ""), aSku: record.sku, aName: record.name,
          recognizedQty: allocation.qty, aUnitPrice: record.unitPrice, recognizedAmount: allocation.qty * record.unitPrice, crossMonthDays,
          fingerprint: receiptKey(record)
        });
      }

      const aQty = baseItem?.qty || 0;
      const aAmount = baseItem?.amount || 0;
      const recognizedPriceDifference = audit.allocations.reduce((sum, row) => sum + row.qty * (row.aRecord.unitPrice - row.bRecord.unitPrice), 0);
      const auditAmountDifference = recognizedPriceDifference
        + audit.remainingA.reduce((sum, row) => sum + row.remaining * row.record.unitPrice, 0)
        - audit.remainingB.reduce((sum, row) => sum + row.remaining * row.record.unitPrice, 0);
      const pairedARecords = [
        ...(baseRecordsBySku.get(combinedItem.sku) || []),
        ...audit.allocations.filter((row) => row.crossMonth).map((row) => row.aRecord)
      ];
      const pairedARows = [...new Set(pairedARecords.map(sourceRowLabel))].join("、");
      paired.push({
        status, aSku: combinedItem.sku, aName: combinedItem.name, bName: bItem.name,
        aQty, bQty: bItem.qty, qtyDifference: aQty - bItem.qty, recognizedQty, crossMonthQty,
        aMissingQty, bMissingQty, auditDifferenceQty: bMissingQty - aMissingQty, suspectedPriorQty,
        aUnitPrice: recognizedAUnitPrice, bUnitPrice: bItem.unitPrice, unitPriceDifference,
        aAmount, bAmount: bItem.amount, amountDifference: aAmount - bItem.amount, auditAmountDifference,
        aMissingDetail: aMissingDetails.join("；"), bMissingDetail: bMissingDetails.join("；"),
        crossMonthDetail: crossDetails.join("；"), suspectedPriorDetail: suspectedDetails.join("；"), auditExplanation: explanation.join("；"),
        matchBasis: `${match.confidence}；逐筆數量分配`, matchScore: match.score,
        aRows: pairedARows, bRows: bItem.rows.join("、"), crossMonth: crossMonthQty > EPSILON
      });
    }

    const usedASkus = new Set(matching.accepted.map((match) => combinedAItems[match.aIndex].sku));
    const usedBKeys = new Set(matching.accepted.map((match) => bItems[match.bIndex].key));
    const selectedRecords = crossRecords.filter((record) => selectedCrossByRow.has(record.sourceRow)).map((record) => {
      const qty = selectedCrossByRow.get(record.sourceRow);
      return { ...record, qty, amount: qty * record.unitPrice, crossMonth: true };
    });
    const selectedRows = new Set(selectedRecords.map((record) => record.sourceRow));
    const baseRows = new Set(baseRecords.map((record) => record.sourceRow));
    const priorByRow = new Map(priorResult.exclusions.map((item) => [item.sourceRow, item]));
    const rawReasons = new Map();
    for (const row of aReport.rawRows) {
      if (!row.included) continue;
      const prior = priorByRow.get(row.sourceRow);
      if (selectedRows.has(row.sourceRow)) rawReasons.set(row.sourceRow, `逐筆跨月認列${quantityText(selectedCrossByRow.get(row.sourceRow))}件至${bounds.monthText}`);
      else if (baseRows.has(row.sourceRow)) rawReasons.set(row.sourceRow, prior ? `扣除前期已認列${prior.excludedQty}件後納入本期` : "納入本期比對");
      else if (prior) rawReasons.set(row.sourceRow, `前期已認列${prior.excludedQty}件，本期排除`);
      else rawReasons.set(row.sourceRow, "不在本期或未被逐筆跨月配對使用");
    }
    const finalAReport = reportWithRecords(aReport, [...baseRecords, ...selectedRecords], rawReasons);

    const suspectedBySku = new Map(matching.suspected.map((candidate) => [combinedAItems[candidate.aIndex].sku, bItems[candidate.bIndex]?.name || ""]));
    const aOnly = baseItems.filter((item) => !usedASkus.has(item.sku)).map((item) => {
      const records = baseRecordsBySku.get(item.sku) || [];
      const suspectedRows = records.filter((record) => {
        const parsed = parseDateValue(record.date);
        return parsed && parsed.date.getDate() <= bounds.cutoff.getDate();
      });
      const suspectedPriorQty = suspectedRows.reduce((sum, record) => sum + Math.max(0, record.qty), 0);
      const candidateName = suspectedBySku.get(item.sku) || "";
      return {
        status: "僅A表存在", aSku: item.sku, aName: item.name, bName: "", aQty: item.qty, bQty: null, qtyDifference: item.qty,
        recognizedQty: 0, crossMonthQty: 0, aMissingQty: 0, bMissingQty: item.qty, auditDifferenceQty: item.qty, suspectedPriorQty,
        aUnitPrice: item.unitPrice, bUnitPrice: null, unitPriceDifference: null, aAmount: item.amount, bAmount: null,
        amountDifference: item.amount, auditAmountDifference: item.amount, aMissingDetail: "", bMissingDetail: records.map((record) => auditRecordText("A", record, record.qty)).join("；"),
        crossMonthDetail: "", suspectedPriorDetail: suspectedRows.map((record) => auditRecordText("A", record, record.qty)).join("；"),
        auditExplanation: `B表沒有可靠對應商品；A表${quantityText(item.qty)}件待確認${suspectedPriorQty > EPSILON ? `，其中月初${quantityText(suspectedPriorQty)}件疑似前期跨月` : ""}`,
        matchBasis: candidateName ? `疑似：${candidateName}` : "未找到可靠對應商品", suspected: Boolean(candidateName), aRows: item.rows.join("、"), bRows: ""
      };
    });
    const bOnly = bItems.filter((item) => !usedBKeys.has(item.key)).map((item) => {
      const demandLots = buildBDemandLots(bRecordsByKey.get(item.key) || []);
      const missingQty = demandLots.reduce((sum, row) => sum + row.remaining, 0);
      return {
        status: "僅B表存在", aSku: "", aName: "", bName: item.name, aQty: null, bQty: item.qty, qtyDifference: -item.qty,
        recognizedQty: 0, crossMonthQty: 0, aMissingQty: missingQty, bMissingQty: 0, auditDifferenceQty: -missingQty, suspectedPriorQty: 0,
        aUnitPrice: null, bUnitPrice: item.unitPrice, unitPriceDifference: null, aAmount: null, bAmount: item.amount,
        amountDifference: -item.amount, auditAmountDifference: -item.amount,
        aMissingDetail: demandLots.map((row) => auditRecordText("B", row.record, row.remaining)).join("；"), bMissingDetail: "", crossMonthDetail: "", suspectedPriorDetail: "",
        auditExplanation: `A表沒有可靠對應商品；B表${quantityText(missingQty)}件待確認`, matchBasis: "未找到可靠對應商品", aRows: "", bRows: item.rows.join("、")
      };
    });
    const passed = paired.filter((row) => ["完全通過", "跨月完全通過"].includes(row.status));
    const differences = paired.filter((row) => !["完全通過", "跨月完全通過"].includes(row.status)).sort((left, right) => Math.abs(right.auditAmountDifference) - Math.abs(left.auditAmountDifference));
    const unmatched = [...aOnly, ...bOnly].sort((left, right) => Math.abs(right.auditAmountDifference || 0) - Math.abs(left.auditAmountDifference || 0));
    const aItems = aggregateSource(finalAReport);
    const totals = {
      aItemCount: aItems.length, bItemCount: bItems.length, matchedCount: paired.length,
      passCount: passed.length, differenceCount: differences.length, aOnlyCount: aOnly.length, bOnlyCount: bOnly.length,
      suspectedCount: aOnly.filter((item) => item.suspected).length,
      aPairRate: aItems.length ? paired.length / aItems.length : 0, bPairRate: bItems.length ? paired.length / bItems.length : 0,
      aAmount: aItems.reduce((sum, item) => sum + item.amount, 0), bAmount: bItems.reduce((sum, item) => sum + item.amount, 0),
      matchedAmountDifference: paired.reduce((sum, item) => sum + item.amountDifference, 0),
      absoluteDifference: differences.reduce((sum, item) => sum + Math.abs(item.auditAmountDifference), 0),
      crossMonthCount: paired.filter((row) => row.crossMonth).length, crossMonthPassCount: passed.filter((row) => row.crossMonth).length,
      priorExcludedCount: priorResult.exclusions.length, priorExcludedQty: priorResult.exclusions.reduce((sum, row) => sum + row.excludedQty, 0)
    };
    return {
      generatedAt: new Date().toISOString(), aReport: finalAReport, bReport: scopedBReport, aItems, bItems, paired, passed, differences, unmatched, aOnly, bOnly, totals,
      period: { month: bounds.monthText, cutoff: bounds.cutoffKey }, priorLedger, crossMonthAllocations: currentLedger,
      ledgerAllocations: [...priorLedger, ...currentLedger], priorPeriodExclusions: priorResult.exclusions,
      baseAnalysis: analyzeReports(baseAReport, scopedBReport)
    };
  }

  const DETAIL_HEADERS = [
    "差異類型", "A貨號", "A品名", "B品名", "A本月數量", "B本月數量", "月度淨差異", "逐筆已核對數量", "跨月認列數量",
    "A表缺少對應數量", "B表缺少對應數量", "稽核差異數量", "疑似前期數量", "A未稅進貨價", "B單價", "單價差異",
    "A本月未稅進貨額", "B合計", "月度金額差額", "稽核差異金額", "A表缺少時的B來源明細", "B表缺少時的A來源明細",
    "跨月配對明細", "疑似前期跨月明細", "稽核說明", "配對依據", "A原始列", "B原始列"
  ];
  function detailValues(item) {
    return [
      item.status, item.aSku, item.aName, item.bName, item.aQty, item.bQty, item.qtyDifference, item.recognizedQty, item.crossMonthQty,
      item.aMissingQty, item.bMissingQty, item.auditDifferenceQty, item.suspectedPriorQty, item.aUnitPrice, item.bUnitPrice, item.unitPriceDifference,
      item.aAmount, item.bAmount, item.amountDifference, item.auditAmountDifference, item.aMissingDetail || "", item.bMissingDetail || "",
      item.crossMonthDetail || "", item.suspectedPriorDetail || "", item.auditExplanation || "", item.matchBasis, item.aRows || "", item.bRows || ""
    ];
  }

  function makeSheet(XLSX, rows, widths, filterRange) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = widths.map((wch) => ({ wch }));
    if (filterRange) sheet["!autofilter"] = { ref: filterRange };
    return sheet;
  }

  function setNumberFormats(XLSX, sheet, ranges, formatCode) {
    for (const rangeText of ranges) {
      const range = XLSX.utils.decode_range(rangeText);
      for (let row = range.s.r; row <= range.e.r; row += 1) for (let column = range.s.c; column <= range.e.c; column += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell && cell.t === "n") cell.z = formatCode;
      }
    }
  }

  function rawRows(report) {
    return [["來源檔案", "工作表", "原始列", "是否納入", "排除／判斷原因", "日期", "單據編號", "帳別", "貨號", "品名", "數量", "單價", "金額"], ...report.rawRows.map((row) => [row.sourceFile, row.sheetName, row.sourceRow, row.included ? "是" : "否", row.reason, row.date, row.doc, row.transactionType, row.sku, row.name, row.qty, row.unitPrice, row.amount])];
  }

  function buildOutputWorkbook(analysis, XLSX) {
    const workbook = XLSX.utils.book_new();
    const t = analysis.totals;
    const crossDifferenceCount = Math.max(0, (t.crossMonthCount || 0) - (t.crossMonthPassCount || 0));
    const attentionCount = t.differenceCount + t.aOnlyCount + t.bOnlyCount;
    const summaryRows = [
      ["財務供應商對帳比對摘要", ""], ["產生時間", new Date(analysis.generatedAt).toLocaleString("zh-TW")],
      ["A表來源", analysis.aReport.fileName], ["B表來源", analysis.bReport.fileName],
      ["成本口徑", "A表未稅進貨價 ↔ B表單價；金額欄位只呈現財務影響，不作為一般差異類型"],
      ["對帳月份", analysis.period?.month || "未指定"], ["跨月補收截止日", analysis.period?.cutoff || "未使用"], ["", ""],
      ["指標", "結果"], ["A表商品數", t.aItemCount], ["B表商品數", t.bItemCount], ["成功配對", t.matchedCount],
      ["A表配對率", t.aPairRate], ["B表配對率", t.bPairRate], ["完全通過", t.passCount], ["跨月配對", t.crossMonthCount || 0], ["跨月完全通過", t.crossMonthPassCount || 0],
      ["前期已認列排除筆數", t.priorExcludedCount || 0], ["前期已認列排除數量", t.priorExcludedQty || 0], ["配對但有差異", t.differenceCount],
      ["僅A表存在", t.aOnlyCount], ["僅B表存在", t.bOnlyCount], ["疑似配對待確認", t.suspectedCount], ["", ""],
      ["數量對價關係", "說明"],
      ["A表對價", `A表${t.aItemCount}項＝成功配對${t.matchedCount}項＋僅A表${t.aOnlyCount}項`],
      ["B表對價", `B表${t.bItemCount}項＝成功配對${t.matchedCount}項＋僅B表${t.bOnlyCount}項`],
      ["成功配對對價", `成功配對${t.matchedCount}項＝完全通過${t.passCount}項＋配對但有差異${t.differenceCount}項`],
      ["跨月配對對價", `跨月配對${t.crossMonthCount || 0}項＝跨月完全通過${t.crossMonthPassCount || 0}項＋跨月有差異${crossDifferenceCount}項`],
      ["⚠ 財務特別提醒", `配對但有差異${t.differenceCount}項＋僅A表${t.aOnlyCount}項＋僅B表${t.bOnlyCount}項＝${attentionCount}項待確認`], ["", ""],
      ["A表未稅進貨總額", t.aAmount], ["B表合計總額", t.bAmount], ["已配對淨金額差額", t.matchedAmountDifference], ["待處理差異絕對額", t.absoluteDifference]
    ];
    const summarySheet = makeSheet(XLSX, summaryRows, [30, 78]);
    setNumberFormats(XLSX, summarySheet, ["B13:B14"], "0.0%");
    setNumberFormats(XLSX, summarySheet, ["B32:B35"], "#,##0;[Red](#,##0);-");
    for (const address of ["A30", "B30"]) {
      if (summarySheet[address]) summarySheet[address].s = { font: { bold: true, color: { rgb: "9C2F27" } }, fill: { fgColor: { rgb: "FBE9E7" } } };
    }
    XLSX.utils.book_append_sheet(workbook, summarySheet, "01_對帳總覽");

    const detailWidths = [22, 15, 38, 38, 13, 13, 13, 16, 15, 18, 18, 15, 15, 16, 12, 12, 18, 14, 16, 16, 56, 56, 62, 56, 68, 34, 16, 16];
    const differenceSheet = makeSheet(XLSX, [DETAIL_HEADERS, ...analysis.differences.map(detailValues)], detailWidths, `A1:AB${Math.max(1, analysis.differences.length + 1)}`);
    const unmatchedSheet = makeSheet(XLSX, [DETAIL_HEADERS, ...analysis.unmatched.map(detailValues)], detailWidths, `A1:AB${Math.max(1, analysis.unmatched.length + 1)}`);
    const passedSheet = makeSheet(XLSX, [DETAIL_HEADERS, ...analysis.passed.map(detailValues)], detailWidths, `A1:AB${Math.max(1, analysis.passed.length + 1)}`);
    if (analysis.differences.length) setNumberFormats(XLSX, differenceSheet, [`E2:T${analysis.differences.length + 1}`], "#,##0;[Red](#,##0);-");
    if (analysis.unmatched.length) setNumberFormats(XLSX, unmatchedSheet, [`E2:T${analysis.unmatched.length + 1}`], "#,##0;[Red](#,##0);-");
    if (analysis.passed.length) setNumberFormats(XLSX, passedSheet, [`E2:T${analysis.passed.length + 1}`], "#,##0;[Red](#,##0);-");
    XLSX.utils.book_append_sheet(workbook, differenceSheet, "02_差異明細");
    XLSX.utils.book_append_sheet(workbook, unmatchedSheet, "03_未配對品項");
    XLSX.utils.book_append_sheet(workbook, passedSheet, "04_完全通過");

    const rawWidths = [28, 18, 10, 12, 24, 16, 20, 12, 15, 42, 12, 14, 16];
    const aRawRows = rawRows(analysis.aReport);
    const bRawRows = rawRows(analysis.bReport);
    const aRaw = makeSheet(XLSX, aRawRows, rawWidths, `A1:M${Math.max(1, aRawRows.length)}`);
    const bRaw = makeSheet(XLSX, bRawRows, rawWidths, `A1:M${Math.max(1, bRawRows.length)}`);
    if (aRawRows.length > 1) setNumberFormats(XLSX, aRaw, [`K2:M${aRawRows.length}`], "#,##0;[Red](#,##0);-");
    if (bRawRows.length > 1) setNumberFormats(XLSX, bRaw, [`K2:M${bRawRows.length}`], "#,##0;[Red](#,##0);-");
    XLSX.utils.book_append_sheet(workbook, aRaw, "05_A表原始資料");
    XLSX.utils.book_append_sheet(workbook, bRaw, "06_B表原始資料");

    const rules = [
      ["比對規則", "說明"], ["商品配對", "依標準化品名、商品類型、規格、單價與數量計算；只有高可信且一對一時自動配對。"],
      ["品名對照表", analysis.bReport.nameMapping ? `已套用${analysis.bReport.nameMapping.fileName || "對照表"}：${analysis.bReport.nameMapping.mappedRecordCount}筆B明細、${analysis.bReport.nameMapping.mappedUniqueNameCount}種品名轉為我方貨號；${analysis.bReport.nameMapping.conflictCount}組一對多衝突未使用。` : "未使用；上林等品名差異較大的供應商可選填對照表，以供應商品名轉為我方貨號。"],
      ["保守原則", "名稱不夠可靠或多個候選太接近時，不強制沖銷，保留僅A／僅B及疑似候選。"],
      ["數量", "先按商品辨識，再逐筆分配A、B明細數量；優先配對等量明細，剩餘量才拆分。B表銷退以負數沖回。"], ["單價", "A表未稅進貨價減B表單價。"],
      ["金額", "A表未稅進貨額減B表合計；用來表示財務影響，不獨立重複分類。"],
      ["月份範圍", "一般B表依帳款日核對指定月份；力榮帳款整份依使用者選定月份認列，原建單日期只保留稽核。A表同時檢查本月與截止日前次月明細。"],
      ["跨月標示", "任何B明細對到次月A收貨都標示跨月，不以商品月總量是否短少為前提；認列數量寫入08_跨月認列台帳，供下期排除。"],
      ["疑似前期", "本月月初仍找不到B明細的A收貨會特別標示疑似前期跨月；未匯入上期台帳前不會自動排除。"],
      ["明細追溯", "差異頁籤列出A／B缺少的數量，以及原始列號、日期、單號與剩餘數量，供稽核直接回查。"],
      ["差異類型", "完全通過、跨月完全通過、疑似前期跨月、數量差異、單價差異、數量＋單價差異、計算異常、僅A表存在、僅B表存在。"],
      ["資料安全", "Excel只在目前瀏覽器分頁讀取、計算與下載，不上傳、不修改原始檔。"]
    ];
    XLSX.utils.book_append_sheet(workbook, makeSheet(XLSX, rules, [24, 92]), "07_比對說明");

    const ledgerHeaders = ["認列月份", "供應商", "B帳款日", "B單號", "B品名", "A收貨日", "A收貨單號", "A貨號", "A品名", "已認列數量", "A未稅單價", "已認列金額", "跨月天數", "唯一識別碼"];
    const ledgerRows = [ledgerHeaders, ...(analysis.ledgerAllocations || []).map((row) => [
      row.recognitionMonth, row.supplier, row.bDate, row.bDoc, row.bName, row.aReceiptDate, row.aDoc, row.aSku, row.aName,
      row.recognizedQty, row.aUnitPrice, row.recognizedAmount, row.crossMonthDays, row.fingerprint || receiptKey(row)
    ])];
    const ledger = makeSheet(XLSX, ledgerRows, [14, 20, 15, 20, 42, 15, 20, 15, 42, 14, 14, 16, 12, 54], `A1:N${Math.max(1, ledgerRows.length)}`);
    if (ledgerRows.length > 1) setNumberFormats(XLSX, ledger, [`J2:M${ledgerRows.length}`], "#,##0;[Red](#,##0);-");
    XLSX.utils.book_append_sheet(workbook, ledger, "08_跨月認列台帳");
    return workbook;
  }

  function freezeFirstRowInWorksheetXml(xml) {
    if (/<pane\b[^>]*\bstate="frozen"/.test(xml)) return xml;
    const pane = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';
    const selfClosingView = /<sheetViews><sheetView([^>]*)\/><\/sheetViews>/;
    if (selfClosingView.test(xml)) return xml.replace(selfClosingView, (_match, attributes) => `<sheetViews><sheetView${attributes}>${pane}</sheetView></sheetViews>`);
    const populatedView = /<sheetViews><sheetView([^>]*)>/;
    if (populatedView.test(xml)) return xml.replace(populatedView, (_match, attributes) => `<sheetViews><sheetView${attributes}>${pane}`);
    throw new Error("匯出工作表缺少sheetViews，無法安全凍結第一列表頭。");
  }

  async function buildFrozenWorkbookBytes(workbook, XLSX, JSZip) {
    if (!JSZip || typeof JSZip.loadAsync !== "function") throw new Error("Excel凍結窗格元件未載入，請重新整理後再下載。");
    const source = XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true });
    const archive = await JSZip.loadAsync(source);
    const worksheetPaths = Object.keys(archive.files).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path));
    if (!worksheetPaths.length) throw new Error("匯出檔中找不到Excel工作表。");
    for (const path of worksheetPaths) {
      const entry = archive.file(path);
      archive.file(path, freezeFirstRowInWorksheetXml(await entry.async("string")));
    }
    return archive.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  }

  global.SupplierReconciliationCore = {
    SOURCE_SCHEMAS, fieldLabel, parseNumber, normalizeHeader, canonicalizeName, autoMapHeaders, validateMapping,
    inspectWorkbook, inspectNameMappingWorkbook, parseNameMappingWorkbook, applyNameMappingToBReport,
    extractSource, aggregateSource, matchScore, findMatches, analyzeReports, parseDateValue, inferDominantMonth,
    ledgerRowsFromWorkbook, analyzeMonthlyReports, buildOutputWorkbook, buildFrozenWorkbookBytes
  };
})(globalThis);

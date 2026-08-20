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
      required: ["sku", "name", "qty", "unitPrice", "amount"]
    },
    b: {
      label: "B表・供應商對帳報表",
      fields: {
        transactionType: ["帳別", "交易類型", "單據類型", "類型"],
        name: ["品名", "商品名稱", "商品品名"],
        qty: ["數量", "銷貨數量", "對帳數量"],
        unitPrice: ["單價", "未稅單價", "進貨價"],
        amount: ["合計", "未稅合計", "未稅金額", "未稅總額"],
        doc: ["進銷單號", "銷貨單號", "對帳單號", "單據編號", "單號"],
        date: ["帳款日", "對帳日期", "銷貨日期", "單據日期", "日期"]
      },
      required: ["name", "qty", "unitPrice", "amount"]
    }
  };

  const FIELD_LABELS = {
    sku: "貨號", name: "品名", qty: "數量", unitPrice: "單價", amount: "合計／金額",
    supplier: "供應商", doc: "單據編號", date: "日期", transactionType: "帳別"
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

  function inspectWorkbook(workbook, XLSX, sourceType) {
    const sheets = workbook.SheetNames.map((name) => ({ name, ...inspectSheet(workbook.Sheets[name], XLSX, sourceType) }));
    sheets.sort((left, right) => Number(right.validation.valid) - Number(left.validation.valid) || headerScore(right.headers, sourceType) - headerScore(left.headers, sourceType));
    return { sourceType, sheets };
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
    const result = dimensions(name);
    const matches = name.matchAll(/(?:^|[^\d.])(3\.5|4\.5|5|6|7|8)(?=(?:加大|特大)?(?:床包|床墊))/g);
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
    const nameScore = diceSimilarity(a.canonicalName, b.canonicalName);
    const aType = productType(a.canonicalName);
    const bType = productType(b.canonicalName);
    const aDimensions = dimensions(a.canonicalName);
    const bDimensions = dimensions(b.canonicalName);
    let compatibility = 0;
    if (aType && bType) compatibility += aType === bType ? 0.12 : -0.4;
    if (aDimensions.size && bDimensions.size) compatibility += setsOverlap(aDimensions, bDimensions) ? 0.08 : -0.25;
    const signatureScore = diceSimilarity(signatureName(a.canonicalName), signatureName(b.canonicalName));
    const priceScore = priceSimilarity(a.unitPrice, b.unitPrice);
    const qtyScore = quantitySimilarity(a.qty, b.qty);
    const score = Math.max(0, Math.min(1, nameScore * 0.58 + priceScore * 0.24 + qtyScore * 0.06 + compatibility));
    return { score, nameScore, signatureScore, priceScore, qtyScore, aType, bType };
  }

  function effectiveUnitPrice(amount, qty, prices) {
    const unique = [...new Set(prices.filter((value) => Number.isFinite(value)))];
    if (unique.length === 1) return unique[0];
    if (Math.abs(qty) > EPSILON) return amount / qty;
    return unique[0] || 0;
  }

  function extractSource(workbook, XLSX, sourceType, options) {
    const sheetName = options.sheetName || workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
    const mapping = options.mapping;
    const headerRowIndex = options.headerRowIndex;
    const records = [];
    const rawRows = [];
    for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (!Array.isArray(row) || row.every((value) => value == null || String(value).trim() === "")) continue;
      const name = String(valueAt(row, mapping, "name") || "").trim();
      const sku = String(valueAt(row, mapping, "sku") || "").trim();
      const qtyValue = parseNumber(valueAt(row, mapping, "qty"));
      const priceValue = parseNumber(valueAt(row, mapping, "unitPrice"));
      const amountValue = parseNumber(valueAt(row, mapping, "amount"));
      const transactionType = String(valueAt(row, mapping, "transactionType") || "").trim();
      let included = true;
      let reason = "納入比對";
      if (!name || qtyValue == null || priceValue == null || amountValue == null) { included = false; reason = "缺少品名、數量、單價或金額"; }
      if (sourceType === "a" && (!sku || isTotalRow(row, mapping))) { included = false; reason = isTotalRow(row, mapping) ? "合計列" : "缺少貨號"; }
      if (sourceType === "b" && NON_PRODUCT_NAMES.some((word) => normalizeText(name) === normalizeText(word))) { included = false; reason = "非商品項目"; }
      let sign = 1;
      if (sourceType === "b" && /銷退|退貨|折讓/.test(transactionType)) sign = -1;
      const record = {
        source: sourceType.toUpperCase(), sourceFile: options.fileName || "", sheetName, sourceRow: index + 1,
        date: valueAt(row, mapping, "date"), doc: valueAt(row, mapping, "doc"), supplier: valueAt(row, mapping, "supplier"),
        transactionType, sku, name, qty: sign * Math.abs(qtyValue || 0), unitPrice: priceValue || 0,
        amount: sign * Math.abs(amountValue || 0), included, reason
      };
      rawRows.push(record);
      if (included) records.push(record);
    }
    return { sourceType, fileName: options.fileName || "", sheetName, headerRowIndex, mapping, records, rawRows };
  }

  function aggregateSource(report) {
    const map = new Map();
    for (const record of report.records) {
      const key = report.sourceType === "a" ? record.sku : canonicalizeName(record.name);
      const current = map.get(key) || {
        key, source: report.sourceType.toUpperCase(), sku: record.sku, name: record.name,
        canonicalName: canonicalizeName(record.name), qty: 0, amount: 0, prices: [], rows: [], docs: new Set()
      };
      current.qty += record.qty;
      current.amount += record.amount;
      current.prices.push(record.unitPrice);
      current.rows.push(record.sourceRow);
      if (record.doc) current.docs.add(String(record.doc));
      map.set(key, current);
    }
    return [...map.values()].map((item) => ({ ...item, docs: [...item.docs], unitPrice: effectiveUnitPrice(item.amount, item.qty, item.prices) }));
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
      const strong = candidate.score >= 0.66 && (exactName || (mutualBest && aMargin >= 0.025 && bMargin >= 0.025));
      if (!strong) continue;
      usedA.add(candidate.aIndex); usedB.add(candidate.bIndex);
      accepted.push({ ...candidate, confidence: exactName ? "名稱完全一致" : `名稱／規格相似度${Math.round(candidate.nameScore * 100)}%` });
    }
    for (const candidate of sorted) {
      if (usedA.has(candidate.aIndex) || usedB.has(candidate.bIndex)) continue;
      const samePrice = Math.abs(aItems[candidate.aIndex].unitPrice - bItems[candidate.bIndex].unitPrice) < EPSILON;
      const sameType = candidate.aType && candidate.aType === candidate.bType;
      const aSizes = sizeTokens(aItems[candidate.aIndex].canonicalName);
      const bSizes = sizeTokens(bItems[candidate.bIndex].canonicalName);
      const sizesCompatible = !aSizes.size || !bSizes.size || setsOverlap(aSizes, bSizes);
      if (!sameType || !sizesCompatible || candidate.signatureScore < 0.75 || (!samePrice && candidate.nameScore < 0.35)) continue;
      usedA.add(candidate.aIndex); usedB.add(candidate.bIndex);
      accepted.push({ ...candidate, confidence: samePrice ? `設計名稱與單價一致（${Math.round(candidate.signatureScore * 100)}%）` : `設計名稱與規格一致（${Math.round(candidate.signatureScore * 100)}%）` });
    }
    const suspected = [];
    for (const [aIndex, list] of bestForA) {
      if (usedA.has(aIndex)) continue;
      const candidate = list.find((entry) => {
        if (usedB.has(entry.bIndex) || entry.score < 0.48 || !entry.aType || entry.aType !== entry.bType || entry.signatureScore < 0.5) return false;
        const aSizes = sizeTokens(aItems[entry.aIndex].canonicalName);
        const bSizes = sizeTokens(bItems[entry.bIndex].canonicalName);
        return !aSizes.size || !bSizes.size || setsOverlap(aSizes, bSizes);
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

  const DETAIL_HEADERS = ["差異類型", "A貨號", "A品名", "B品名", "A數量", "B數量", "數量差異", "A未稅進貨價", "B單價", "單價差異", "A未稅進貨額", "B合計", "金額差額", "配對依據", "A原始列", "B原始列"];
  function detailValues(item) {
    return [item.status, item.aSku, item.aName, item.bName, item.aQty, item.bQty, item.qtyDifference, item.aUnitPrice, item.bUnitPrice, item.unitPriceDifference, item.aAmount, item.bAmount, item.amountDifference, item.matchBasis, item.aRows || "", item.bRows || ""];
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
    const summaryRows = [
      ["財務供應商對帳比對摘要", ""], ["產生時間", new Date(analysis.generatedAt).toLocaleString("zh-TW")],
      ["A表來源", analysis.aReport.fileName], ["B表來源", analysis.bReport.fileName],
      ["成本口徑", "A表未稅進貨價 ↔ B表單價；A表未稅進貨額 ↔ B表合計"], ["", ""],
      ["指標", "結果"], ["A表商品數", t.aItemCount], ["B表商品數", t.bItemCount], ["成功配對", t.matchedCount],
      ["A表配對率", t.aPairRate], ["B表配對率", t.bPairRate], ["完全通過", t.passCount], ["配對但有差異", t.differenceCount],
      ["僅A表存在", t.aOnlyCount], ["僅B表存在", t.bOnlyCount], ["疑似配對待確認", t.suspectedCount], ["", ""],
      ["A表未稅進貨總額", t.aAmount], ["B表合計總額", t.bAmount], ["已配對淨金額差額", t.matchedAmountDifference], ["待處理差異絕對額", t.absoluteDifference]
    ];
    const summarySheet = makeSheet(XLSX, summaryRows, [30, 42]);
    setNumberFormats(XLSX, summarySheet, ["B11:B12"], "0.0%");
    setNumberFormats(XLSX, summarySheet, ["B19:B22"], "#,##0;[Red](#,##0);-");
    XLSX.utils.book_append_sheet(workbook, summarySheet, "01_對帳總覽");

    const detailWidths = [18, 15, 38, 38, 12, 12, 12, 16, 12, 12, 17, 14, 14, 34, 14, 14];
    const differenceSheet = makeSheet(XLSX, [DETAIL_HEADERS, ...analysis.differences.map(detailValues)], detailWidths, `A1:P${Math.max(1, analysis.differences.length + 1)}`);
    const unmatchedSheet = makeSheet(XLSX, [DETAIL_HEADERS, ...analysis.unmatched.map(detailValues)], detailWidths, `A1:P${Math.max(1, analysis.unmatched.length + 1)}`);
    const passedSheet = makeSheet(XLSX, [DETAIL_HEADERS, ...analysis.passed.map(detailValues)], detailWidths, `A1:P${Math.max(1, analysis.passed.length + 1)}`);
    if (analysis.differences.length) setNumberFormats(XLSX, differenceSheet, [`E2:M${analysis.differences.length + 1}`], "#,##0;[Red](#,##0);-");
    if (analysis.unmatched.length) setNumberFormats(XLSX, unmatchedSheet, [`E2:M${analysis.unmatched.length + 1}`], "#,##0;[Red](#,##0);-");
    if (analysis.passed.length) setNumberFormats(XLSX, passedSheet, [`E2:M${analysis.passed.length + 1}`], "#,##0;[Red](#,##0);-");
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
      ["保守原則", "名稱不夠可靠或多個候選太接近時，不強制沖銷，保留僅A／僅B及疑似候選。"],
      ["數量", "A表已收數量減B表淨數量；B表銷退以負數沖回。"], ["單價", "A表未稅進貨價減B表單價。"],
      ["金額", "A表未稅進貨額減B表合計；用來表示財務影響，不獨立重複分類。"],
      ["差異類型", "完全通過、數量差異、單價差異、數量＋單價差異、計算異常、僅A表存在、僅B表存在。"],
      ["資料安全", "Excel只在目前瀏覽器分頁讀取、計算與下載，不上傳、不修改原始檔。"]
    ];
    XLSX.utils.book_append_sheet(workbook, makeSheet(XLSX, rules, [24, 92]), "07_比對說明");
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
    inspectWorkbook, extractSource, aggregateSource, matchScore, findMatches, analyzeReports, buildOutputWorkbook, buildFrozenWorkbookBytes
  };
})(globalThis);

(function (global) {
  "use strict";

  const core = global.ProcurementPlanningCore;
  const DAY_MS = 86400000;
  const PERIOD_DAYS = 14;
  const PERIOD_MS = PERIOD_DAYS * DAY_MS;
  const ANCHOR_MS = Date.UTC(2024, 0, 1);
  const MODELS = ["近期6週", "近期12週", "去年同期", "近期70%＋同期30%", "近期50%＋同期50%", "近期30%＋同期70%"];
  const INVENTORY_TYPES = new Set(["商品", "存貨", "原物料", "半成品", "成品"]);

  function dateMs(value) {
    const parsed = Date.parse(`${String(value || "").slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function periodOf(value) { return Math.floor((dateMs(value) - ANCHOR_MS) / PERIOD_MS); }
  function periodDate(period) { return new Date(ANCHOR_MS + period * PERIOD_MS).toISOString().slice(0, 10); }
  function round(value, digits = 4) {
    if (!Number.isFinite(Number(value))) return null;
    const factor = 10 ** digits;
    return Math.round(Number(value) * factor) / factor;
  }
  function clean(value) { return String(value == null ? "" : value).normalize("NFKC").trim(); }
  function addSeries(map, key, period, quantity) {
    if (!map.has(key)) map.set(key, new Map());
    const series = map.get(key);
    series.set(period, (series.get(period) || 0) + quantity);
  }
  function sumRange(series, from, to) {
    let total = 0;
    for (let period = from; period <= to; period += 1) total += Math.max(0, Number(series.get(period) || 0));
    return total;
  }

  function productType(master, fallbackName = "") {
    const text = clean([master?.mainCategory, master?.style1, master?.name, fallbackName].filter(Boolean).join(" "));
    if (core.inferMaterialCategory(master, fallbackName) === "枕芯") return "枕芯";
    const mappings = [
      [/(床包|床罩)/, "床包"], [/(兩用被套|被套)/, "被套"], [/(涼被|暖被|冬被|麻糬被|薄被)/, "被類"],
      [/(保潔墊)/, "保潔墊"], [/(枕套|枕巾)/, "枕套"], [/(毛巾|浴巾)/, "毛浴巾"], [/(抱枕|坐墊|靠枕)/, "抱枕坐墊"]
    ];
    return mappings.find(([pattern]) => pattern.test(text))?.[1] || clean(master?.mainCategory) || "其他";
  }

  function sizeType(master, fallbackName = "") {
    const direct = clean(master?.sizeGroup || master?.size);
    if (direct) return direct;
    const text = clean([master?.name, fallbackName].filter(Boolean).join(" "));
    const match = text.match(/(3\.5尺|5尺|6尺|7尺|單人|雙人|加大|特大)/);
    return match?.[1] || "無尺寸";
  }

  function categoryKeys(master, fallbackName = "") {
    const material = core.inferMaterialCategory(master, fallbackName);
    const type = productType(master, fallbackName);
    const size = sizeType(master, fallbackName);
    return [
      { level: "材質", name: material },
      { level: "材質×商品型態", name: `${material}｜${type}` },
      { level: "材質×商品型態×尺寸", name: `${material}｜${type}｜${size}` }
    ];
  }

  function modelPrediction(name, series, period) {
    const recent6 = sumRange(series, period - 3, period - 1) / 3;
    const recent12 = sumRange(series, period - 6, period - 1) / 6;
    const lastYear = Math.max(0, Number(series.get(period - 26) || 0));
    if (name === "近期12週") return recent12;
    if (name === "去年同期") return lastYear;
    const blend = name.match(/近期(\d+)%＋同期(\d+)%/);
    return blend ? recent6 * Number(blend[1]) / 100 + lastYear * Number(blend[2]) / 100 : recent6;
  }

  function evaluateSeries(series, firstPeriod, lastPeriod, modelNames = MODELS) {
    const result = new Map(modelNames.map((model) => [model, { model, actual: 0, predicted: 0, absoluteError: 0, samples: 0 }]));
    for (let period = firstPeriod; period <= lastPeriod; period += 1) {
      const actual = Math.max(0, Number(series.get(period) || 0));
      for (const model of modelNames) {
        const predicted = modelPrediction(model, series, period);
        const metric = result.get(model);
        metric.actual += actual;
        metric.predicted += predicted;
        metric.absoluteError += Math.abs(predicted - actual);
        metric.samples += 1;
      }
    }
    for (const metric of result.values()) {
      metric.wape = metric.actual > 0 ? metric.absoluteError / metric.actual : null;
      metric.bias = metric.actual > 0 ? (metric.predicted - metric.actual) / metric.actual : null;
    }
    return result;
  }

  function bestMetric(metrics, allowed = MODELS) {
    return allowed.map((name) => metrics.get(name)).filter((row) => row && row.wape != null)
      .sort((a, b) => a.wape - b.wape || allowed.indexOf(a.model) - allowed.indexOf(b.model))[0] || null;
  }

  function reliability(skuCount, samples, actual) {
    if (skuCount >= 5 && samples >= 26 && actual >= 500) return "高";
    if (skuCount >= 3 && samples >= 18 && actual >= 100) return "中";
    return "低";
  }

  function sourceSignature(row) {
    return [row.saleType, row.transactionTimestamp || row.date, row.sku, row.warehouseCode, row.shipWarehouseCode,
      row.posOrder, row.sourceOrder, row.pickupOrder, round(row.quantity, 4), round(row.deductQuantity, 4), round(row.actualAmount, 2)].join("¦");
  }

  function identitySignature(row) {
    const order = row.posOrder || row.sourceOrder || row.pickupOrder;
    return order ? [row.saleType, row.transactionTimestamp || row.date, row.sku, row.warehouseCode, order].join("¦") : "";
  }

  function createBuilder(master, options = {}) {
    const skuSeries = new Map();
    const categorySeries = new Map();
    const categorySkus = new Map();
    const signatureMax = new Map();
    const identityFingerprints = new Map();
    const sourceFiles = [];
    const blacklist = core.normalizeBlacklist(options.blacklist || []);
    let minDate = "";
    let maxDate = "";
    let acceptedRows = 0;
    let duplicateRows = 0;
    let conflictRows = 0;
    let excludedRows = 0;

    function eligible(row, masterRecord) {
      if (!masterRecord) return false;
      if (masterRecord.stockType && !INVENTORY_TYPES.has(clean(masterRecord.stockType))) return false;
      if (core.blacklistMatch({ sku: row.sku, supplierSku: masterRecord.supplierSku, name: masterRecord.name || row.name }, blacklist)) return false;
      return true;
    }

    function ingest(report, fileMetadata = {}) {
      const localCounts = new Map();
      const localIdentityFingerprints = new Map();
      const accepted = [];
      let fileExcluded = Object.values(report.excluded || {}).reduce((sum, value) => sum + Number(value || 0), 0);
      let fileDuplicates = 0;
      let fileConflicts = 0;
      for (const row of report.records) {
        const masterRecord = master.bySku.get(row.sku);
        if (!eligible(row, masterRecord)) { fileExcluded += 1; continue; }
        const identity = identitySignature(row);
        const fingerprint = [round(row.quantity, 4), round(row.deductQuantity, 4), round(row.actualAmount, 2)].join("¦");
        if (identity && identityFingerprints.has(identity) && !identityFingerprints.get(identity).has(fingerprint)) {
          fileConflicts += 1;
          continue;
        }
        if (identity) {
          if (!localIdentityFingerprints.has(identity)) localIdentityFingerprints.set(identity, new Set());
          localIdentityFingerprints.get(identity).add(fingerprint);
        }
        const signature = sourceSignature(row);
        const occurrence = (localCounts.get(signature) || 0) + 1;
        localCounts.set(signature, occurrence);
        if (occurrence <= (signatureMax.get(signature) || 0)) { fileDuplicates += 1; continue; }
        accepted.push({ row, masterRecord });
      }
      for (const [signature, count] of localCounts) signatureMax.set(signature, Math.max(signatureMax.get(signature) || 0, count));
      for (const [identity, fingerprints] of localIdentityFingerprints) {
        if (!identityFingerprints.has(identity)) identityFingerprints.set(identity, new Set());
        fingerprints.forEach((fingerprint) => identityFingerprints.get(identity).add(fingerprint));
      }
      for (const { row, masterRecord } of accepted) {
        const period = periodOf(row.date);
        if (!Number.isFinite(period)) continue;
        addSeries(skuSeries, row.sku, period, Number(row.quantity || 0));
        for (const scope of ["全部", ...(/普優[瑪碼]/.test(clean(masterRecord.supplier)) ? ["普優瑪"] : [])]) {
          for (const category of categoryKeys(masterRecord, row.name)) {
            const key = `${scope}¦${category.level}¦${category.name}`;
            addSeries(categorySeries, key, period, Number(row.quantity || 0));
            if (!categorySkus.has(key)) categorySkus.set(key, new Set());
            categorySkus.get(key).add(row.sku);
          }
        }
        if (!minDate || row.date < minDate) minDate = row.date;
        if (!maxDate || row.date > maxDate) maxDate = row.date;
      }
      acceptedRows += accepted.length;
      duplicateRows += fileDuplicates;
      conflictRows += fileConflicts;
      excludedRows += fileExcluded;
      const stats = {
        id: fileMetadata.id || "", name: fileMetadata.name || report.fileName || "銷售明細.xlsx",
        modifiedTime: fileMetadata.modifiedTime || "", size: Number(fileMetadata.size || 0), md5Checksum: fileMetadata.md5Checksum || "",
        minDate: report.minDate || "", maxDate: report.maxDate || "", sourceRows: report.records.length,
        acceptedRows: accepted.length, duplicateRows: fileDuplicates, conflictRows: fileConflicts, excludedRows: fileExcluded
      };
      sourceFiles.push(stats);
      return stats;
    }

    function finalize(metadata = {}) {
      if (!minDate || !maxDate) throw new Error("歷史銷售沒有可用交易資料。");
      const coverageDays = Math.floor((dateMs(maxDate) - dateMs(minDate)) / DAY_MS) + 1;
      if (coverageDays < 730) throw new Error(`歷史銷售涵蓋${coverageDays}天，不足兩年，無法可靠比較去年同期。`);
      if (conflictRows) throw new Error(`偵測到${conflictRows}筆相同交易識別但數量／金額不同，已停止發布，請先確認重疊匯出檔。`);
      const cutoffMs = dateMs(maxDate) - 1095 * DAY_MS;
      const cutoffPeriod = periodOf(new Date(cutoffMs).toISOString().slice(0, 10));
      const lastPeriod = periodOf(maxDate) - 1;
      const firstEvaluation = cutoffPeriod + 26;
      if (lastPeriod < firstEvaluation) throw new Error("完整14天回測期間不足，無法建立模型。");

      const categoryMetrics = new Map();
      const categoryRows = [];
      for (const [key, series] of categorySeries) {
        const [scope, level, name] = key.split("¦");
        const metrics = evaluateSeries(series, firstEvaluation, lastPeriod);
        const best = bestMetric(metrics);
        const skuCount = categorySkus.get(key)?.size || 0;
        const confidence = reliability(skuCount, best?.samples || 0, best?.actual || 0);
        const record = { key, scope, level, name, material: name.split("｜")[0], skuCount, metrics, best, reliability: confidence };
        categoryMetrics.set(key, record);
        if (level === "材質") {
          const skuSix = bestMetric(metrics, ["近期6週", "近期12週"]);
          categoryRows.push([scope, record.material, skuCount, skuSix?.model || "近期6週", round(skuSix?.wape), best?.model || "近期6週", round(best?.wape), round((Number(skuSix?.wape || 0) - Number(best?.wape || 0)) * 100, 2), round(best?.bias), confidence]);
        }
      }

      const skuRows = [];
      let activeSkuCount = 0;
      let skuWapeWeighted = 0;
      let skuActualWeighted = 0;
      for (const [sku, series] of skuSeries) {
        if (sumRange(series, Math.max(cutoffPeriod, lastPeriod - 25), lastPeriod) <= 0) continue;
        const masterRecord = master.bySku.get(sku);
        if (!masterRecord) continue;
        activeSkuCount += 1;
        const metrics = evaluateSeries(series, firstEvaluation, lastPeriod, ["近期6週", "近期12週"]);
        const bestSku = bestMetric(metrics, ["近期6週", "近期12週"]);
        const scope = /普優[瑪碼]/.test(clean(masterRecord.supplier)) ? "普優瑪" : "全部";
        const categories = categoryKeys(masterRecord, masterRecord.name);
        const candidates = categories.map((category) => categoryMetrics.get(`${scope}¦${category.level}¦${category.name}`)).filter(Boolean);
        const selectedCategory = [...candidates].reverse().find((item) => item.reliability !== "低") || candidates[0];
        const lastYearActual = Math.max(0, Number(series.get(lastPeriod - 26) || 0));
        const recent6 = sumRange(series, lastPeriod - 2, lastPeriod) / 3;
        const recent12 = sumRange(series, lastPeriod - 5, lastPeriod) / 6;
        skuRows.push([
          sku, masterRecord.name, masterRecord.supplier, scope, categories[0].name, productType(masterRecord), sizeType(masterRecord),
          bestSku?.model || "近期6週", round(bestSku?.wape), round(bestSku?.bias), round(recent6, 2), round(recent12, 2), round(lastYearActual, 2),
          selectedCategory?.level || "材質", selectedCategory?.name || categories[0].name, selectedCategory?.best?.model || "近期6週",
          round(selectedCategory?.best?.wape), round(selectedCategory?.best?.bias), selectedCategory?.reliability || "低",
          round(selectedCategory?.best?.samples), round(selectedCategory?.best?.actual, 2), clean(masterRecord.season), clean(masterRecord.stockType), masterRecord.discontinued ? "是" : "否"
        ]);
        if (bestSku?.actual) { skuWapeWeighted += bestSku.absoluteError; skuActualWeighted += bestSku.actual; }
      }
      skuRows.sort((a, b) => String(a[2]).localeCompare(String(b[2]), "zh-Hant") || String(a[0]).localeCompare(String(b[0])));

      const periodRows = [];
      for (const record of categoryMetrics.values()) {
        if (record.scope !== "普優瑪" || record.level !== "材質") continue;
        for (let period = firstEvaluation; period <= lastPeriod; period += 1) {
          const actual = Math.max(0, Number(categorySeries.get(record.key).get(period) || 0));
          for (const model of MODELS) periodRows.push([record.scope, record.level, record.name, periodDate(period), model, round(modelPrediction(model, categorySeries.get(record.key), period), 3), actual]);
        }
      }

      const generatedAt = metadata.generatedAt || new Date().toISOString();
      return {
        metadata: { ...metadata, generatedAt, minDate, maxDate, cutoffDate: new Date(cutoffMs).toISOString().slice(0, 10), firstEvaluationDate: periodDate(firstEvaluation), lastCompletePeriodStart: periodDate(lastPeriod) },
        summary: { sourceFileCount: sourceFiles.length, sourceBytes: sourceFiles.reduce((sum, file) => sum + file.size, 0), minDate, maxDate, coverageDays, acceptedRows, duplicateRows, conflictRows, excludedRows, activeSkuCount, skuWape: skuActualWeighted > 0 ? skuWapeWeighted / skuActualWeighted : null, categoryCount: categoryMetrics.size },
        sourceFiles: [...sourceFiles], categoryRows, skuRows, periodRows
      };
    }

    return { ingest, finalize };
  }

  function appendSheet(workbook, XLSX, rows, name, widths = []) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    if (widths.length) sheet["!cols"] = widths.map((wch) => ({ wch }));
    if (rows.length) sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ r: 3, c: 0 }, { r: Math.max(3, rows.length - 1), c: Math.max(0, (rows[3] || []).length - 1) }) };
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }

  function buildWorkbook(result, XLSX, approval = {}) {
    const workbook = XLSX.utils.book_new();
    const status = approval.approvedAt ? "正式核准" : "回測草稿";
    appendSheet(workbook, XLSX, [
      ["季節模型回測摘要"],
      ["狀態", status, "模型版本", result.metadata.generatedAt],
      ["歷史範圍", `${result.summary.minDate}～${result.summary.maxDate}`, "近三年截點", result.metadata.cutoffDate],
      ["指標", "數值", "說明"],
      ["來源檔數", result.summary.sourceFileCount, "固定Google Drive資料夾直屬Excel"],
      ["納入交易列", result.summary.acceptedRows, "已排除取貨、非需求銷別、非存貨及黑名單"],
      ["跨檔重複列", result.summary.duplicateRows, "依交易識別與同列出現次序去重"],
      ["衝突列", result.summary.conflictRows, "非0即禁止核准"],
      ["活躍SKU", result.summary.activeSkuCount, "最近52週仍有正需求"],
      ["SKU層級WAPE", round(result.summary.skuWape), "近期6週與12週擇優後加權"],
      ["產生者", result.metadata.generatedBy || ""],
      ["核准者", approval.approvedBy || ""],
      ["核准時間", approval.approvedAt || ""]
    ], "回測摘要", [24, 24, 26]);
    appendSheet(workbook, XLSX, [
      ["類別需求池回測總覽"], [], [],
      ["範圍", "材質類別", "SKU數", "SKU建議模型（6／12週）", "SKU層級WAPE", "類別最佳模型", "類別WAPE", "改善百分點", "類別偏差率", "可信度"],
      ...result.categoryRows
    ], "類別模型總覽", [12, 22, 10, 25, 16, 24, 14, 14, 14, 10]);
    appendSheet(workbook, XLSX, [
      ["目前活躍SKU模型建議"], [], [],
      ["ERP品號", "品名", "供應商", "範圍", "材質類別", "商品型態", "尺寸", "SKU建議模型", "SKU最佳WAPE", "SKU偏差率", "近期6週平均量", "近期12週平均量", "去年同期量", "輔助類別層級", "輔助類別名稱", "類別建議模型", "類別WAPE", "類別偏差率", "類別可信度", "回測樣本數", "回測實際量", "季節", "存貨種類", "已下架"],
      ...result.skuRows
    ], "SKU模型建議", [18, 50, 22, 12, 18, 18, 16, 20, 14, 14, 16, 18, 16, 22, 42, 24, 14, 14, 14, 14, 16, 14, 14, 10]);
    appendSheet(workbook, XLSX, [
      ["普優瑪材質類別逐期回測"], [], [],
      ["範圍", "類別層級", "類別名稱", "期間起日", "模型", "預測量", "實際量"],
      ...result.periodRows
    ], "類別期間回測", [12, 16, 24, 14, 24, 14, 14]);
    appendSheet(workbook, XLSX, [
      ["資料品質與規則"], [], [],
      ["規則", "內容"],
      ["需求銷別", "只納入銷貨、訂貨、退貨、退訂；取貨排除"],
      ["多檔去重", "以交易時間、銷別、品號、倉別、POS／來源／取貨單號、數量與金額建立識別；相同識別的第N筆只計一次"],
      ["衝突阻擋", "相同交易識別但數量或金額不同時停止發布"],
      ["商品範圍", "商品主檔可辨識的存貨類型；排除公司黑名單與非存貨服務"],
      ["期間", "14天一期；最近3期=近期6週、最近6期=近期12週、26期前=去年同期"],
      ["有效歷史", "以最新交易日回推三年；至少需涵蓋730天"],
      ["模型選擇", "SKU層級在近期6週／12週擇優；類別層級再比較去年同期與三種混合權重"],
      ["類別可信度", "高：至少5個SKU、26期、500件；中：至少3個SKU、18期、100件；其餘低"]
    ], "資料品質與規則", [24, 110]);
    appendSheet(workbook, XLSX, [
      ["來源紀錄"], [], [],
      ["Drive檔案ID", "檔名", "修改時間", "檔案大小", "MD5", "交易起日", "交易迄日", "來源需求列", "納入列", "跨檔重複列", "衝突列", "排除列"],
      ...result.sourceFiles.map((file) => [file.id, file.name, file.modifiedTime, file.size, file.md5Checksum, file.minDate, file.maxDate, file.sourceRows, file.acceptedRows, file.duplicateRows, file.conflictRows, file.excludedRows])
    ], "來源紀錄", [34, 34, 24, 16, 34, 14, 14, 16, 14, 18, 12, 14]);
    return workbook;
  }

  global.ProcurementSeasonalModel = { MODELS, createBuilder, buildWorkbook, periodOf, periodDate };
})(typeof globalThis !== "undefined" ? globalThis : self);

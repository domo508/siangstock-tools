(function () {
  "use strict";

  const core = globalThis.InventoryCostCore;
  const XLSX = globalThis.XLSX;
  const inventoryCore = globalThis.InventoryCore;
  const rulesClient = globalThis.InventoryRulesClient;
  const requiredTypes = new Set(["opening", "closing", "purchases", "sales"]);
  const descriptions = {
    opening: "請匯出全部店倉；總部體系模式會自動排除加盟店倉，單倉模式才依所選倉別計算。",
    closing: "請匯出全部店倉，且倉別範圍必須與期初完全一致。",
    purchases: "本報表中的「成本價」例外視為供應商進貨價，並作為分析月份鎖定主報表。",
    sales: "可同時選擇本月及前月，不可包含更早或未來月份；加盟總倉代出的R／T只作正式成本、扣庫與跨月稽核。客戶退貨已用負值呈現，不需另傳客退報表。",
    storeMonthly: "B2加盟調撥、B3總倉代出與B4加盟退回的主要認列來源，並與當月進貨共同鎖定分析月份。",
    movements: "盤盈、盤虧、報廢、贈送、客訴、員購與樣品等原因；月份須與本月主報表一致。",
    supplierReturns: "完成退廠後，以未稅進貨額沖減當月進貨；月份須與本月主報表一致。",
    transfers: "請選本月及前月，不可包含未來月份；只供月結單號、品項、數量、成本及跨月稽核，沒有月結時不會單獨增加B。"
  };

  const state = {
    sources: {},
    analysis: null,
    reports: null,
    companyAnalysis: null,
    warehouseBundle: null,
    warehouseScopes: [],
    warehouseCache: new Map(),
    analysisOptions: null,
    outputWorkbook: null,
    rules: null,
    rulesVersion: null,
    rulesUpdatedAt: "",
    rulesReady: false
  };

  const uploadGrid = document.getElementById("upload-grid");
  const analyzeButton = document.getElementById("analyze-button");
  const downloadButton = document.getElementById("download-button");
  const mainStatus = document.getElementById("main-status");
  const resultPanel = document.getElementById("result-panel");
  const summaryCards = document.getElementById("summary-cards");
  const resultRows = document.getElementById("result-rows");
  const resultHead = document.getElementById("result-head");
  const resultTitle = document.getElementById("result-title");
  const resultNote = document.getElementById("result-note");
  const analysisScope = document.getElementById("analysis-scope");
  const warehousePicker = document.getElementById("warehouse-picker");
  const warehouseSelect = document.getElementById("warehouse-select");
  const productRulesTitle = document.getElementById("product-rules-title");
  const productRulesDetail = document.getElementById("product-rules-detail");

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatNumber(value, maximumFractionDigits = 2) {
    return new Intl.NumberFormat("zh-TW", { maximumFractionDigits }).format(Number(value || 0));
  }

  function warehouseClassificationLabel(value) {
    return ({ included: "總部體系", direct: "直營門市", franchise: "加盟門市", unknown: "未分類" })[value] || value;
  }

  function resetResults(message) {
    state.analysis = null;
    state.reports = null;
    state.companyAnalysis = null;
    state.warehouseBundle = null;
    state.warehouseScopes = [];
    state.warehouseCache = new Map();
    state.analysisOptions = null;
    state.outputWorkbook = null;
    resultPanel.hidden = true;
    downloadButton.disabled = true;
    if (message) mainStatus.textContent = message;
  }

  async function refreshRules(context) {
    state.rulesReady = false;
    productRulesTitle.textContent = "正在取得公司最新版商品規則";
    productRulesDetail.textContent = "分析前會再次確認規則版本；若規則服務無法使用，系統將停止分析，避免使用不同版本。";
    updateAnalyzeAvailability(true);
    try {
      const latest = await rulesClient.fetchLatest(globalThis.fetch.bind(globalThis), inventoryCore);
      state.rules = latest.rules;
      state.rulesVersion = latest.version;
      state.rulesUpdatedAt = latest.updatedAt;
      state.rulesReady = true;
      const exclusions = latest.rules["排除關鍵字"] || [];
      productRulesTitle.textContent = `目前使用：公司集中規則 v${latest.version}`;
      productRulesDetail.textContent = `${rulesClient.formatUpdatedAt(latest.updatedAt)} 更新，共 ${exclusions.length} 項排除關鍵字：${exclusions.join("、") || "無"}。${context === "analysis" ? "已在分析前再次確認最新版。" : "開始分析前會再確認一次。"}`;
      updateAnalyzeAvailability(true);
      return latest;
    } catch (error) {
      state.rules = null;
      state.rulesVersion = null;
      state.rulesUpdatedAt = "";
      state.rulesReady = false;
      productRulesTitle.textContent = "公司集中規則服務目前無法使用";
      productRulesDetail.textContent = "為避免誤用舊規則，本次禁止分析。請稍後重試或通知管理者。";
      updateAnalyzeAvailability(true);
      throw error;
    }
  }

  function createCards() {
    uploadGrid.innerHTML = "";
    core.REPORT_ORDER.forEach((type, index) => {
      const schema = core.REPORT_SCHEMAS[type];
      const multiple = type === "transfers" || type === "sales";
      const card = document.createElement("article");
      card.className = "upload-card";
      card.dataset.type = type;
      card.innerHTML = `
        <div class="upload-card-header">
          <h3>${index + 1}. ${escapeHtml(schema.label)}</h3>
          <span class="source-badge ${requiredTypes.has(type) ? "required" : ""}">${requiredTypes.has(type) ? "必要" : "選填"}</span>
        </div>
        <p class="upload-help">${escapeHtml(descriptions[type])}</p>
        <label class="file-button">${multiple ? "選擇一或多個 .xlsx 檔" : "選擇 .xlsx 檔"}<input type="file" accept=".xlsx" data-file-type="${type}" ${multiple ? "multiple" : ""}></label>
        <p class="file-name" data-file-name>尚未選擇</p>
        <div class="mapping-box" data-mapping hidden></div>`;
      uploadGrid.appendChild(card);
    });
    uploadGrid.querySelectorAll("input[type=file]").forEach((input) => input.addEventListener("change", onFileChange));
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("無法讀取檔案"));
      reader.readAsArrayBuffer(file);
    });
  }

  async function onFileChange(event) {
    const input = event.currentTarget;
    const type = input.dataset.fileType;
    const card = input.closest(".upload-card");
    const fileName = card.querySelector("[data-file-name]");
    const mappingBox = card.querySelector("[data-mapping]");
    resetResults("檔案或欄位設定已變更，請重新開始分析。");
    card.classList.remove("ready", "error");
    if (!input.files || !input.files[0]) {
      delete state.sources[type];
      fileName.textContent = "尚未選擇";
      mappingBox.hidden = true;
      updateAnalyzeAvailability();
      return;
    }
    const files = Array.from(input.files);
    const file = files[0];
    fileName.textContent = `正在讀取：${files.map((entry) => entry.name).join("、")}`;
    try {
      const entries = await Promise.all(files.map(async (entryFile) => {
        const data = await readFile(entryFile);
        const workbook = XLSX.read(data, { type: "array", cellDates: true });
        const inspection = core.inspectWorkbook(workbook, XLSX, type);
        const selected = inspection.sheets[0];
        const validation = core.validateMapping(type, selected.mapping);
        if (!validation.valid) throw new Error(`${entryFile.name}缺少：${validation.missing.join("、")}`);
        return { file: entryFile, workbook, inspection, selected };
      }));
      const { workbook, inspection, selected } = entries[0];
      state.sources[type] = {
        type,
        file,
        files,
        entries,
        workbook,
        inspection,
        sheetName: selected.name,
        headerRowIndex: selected.headerRowIndex,
        headers: selected.headers,
        mapping: { ...selected.mapping }
      };
      fileName.textContent = files.length > 1 ? `已選擇${files.length}個檔案：${files.map((entry) => entry.name).join("、")}` : file.name;
      renderMapping(type);
    } catch (error) {
      delete state.sources[type];
      card.classList.add("error");
      fileName.textContent = `${file.name}：${error.message}`;
      mappingBox.hidden = true;
    }
    updateAnalyzeAvailability();
  }

  function mappingOptions(headers, selectedIndex) {
    return [`<option value="">不使用</option>`, ...headers.map((header, index) => `<option value="${index}" ${index === selectedIndex ? "selected" : ""}>${escapeHtml(header || `欄位${index + 1}`)}</option>`)].join("");
  }

  function renderMapping(type) {
    const source = state.sources[type];
    const card = uploadGrid.querySelector(`[data-type="${type}"]`);
    const box = card.querySelector("[data-mapping]");
    const schema = core.REPORT_SCHEMAS[type];
    const sheets = source.inspection.sheets;
    box.hidden = false;
    box.innerHTML = `
      <div class="mapping-meta">
        <label>工作表<select data-sheet-select>${sheets.map((sheet) => `<option value="${escapeHtml(sheet.name)}" ${sheet.name === source.sheetName ? "selected" : ""}>${escapeHtml(sheet.name)}</option>`).join("")}</select></label>
        <label>表頭列<input data-header-row type="number" min="1" max="30" value="${source.headerRowIndex + 1}"></label>
      </div>
      <div class="mapping-list">${Object.keys(schema.fields).map((field) => `<label>${escapeHtml(core.fieldLabel(field))}<select data-map-field="${field}">${mappingOptions(source.headers, source.mapping[field])}</select></label>`).join("")}</div>
      <p class="mapping-status" data-map-status></p>`;
    box.querySelector("[data-sheet-select]").addEventListener("change", (event) => {
      const selected = sheets.find((sheet) => sheet.name === event.target.value);
      source.sheetName = selected.name;
      source.headerRowIndex = selected.headerRowIndex;
      source.headers = selected.headers;
      source.mapping = { ...selected.mapping };
      renderMapping(type);
      resetResults("工作表已變更，請確認欄位後重新分析。");
      updateAnalyzeAvailability();
    });
    box.querySelector("[data-header-row]").addEventListener("change", (event) => {
      const rowIndex = Math.max(0, Number(event.target.value || 1) - 1);
      const sheet = source.workbook.Sheets[source.sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      source.headerRowIndex = rowIndex;
      source.headers = (rows[rowIndex] || []).map((value, index) => String(value || `欄位${index + 1}`).trim());
      source.mapping = core.autoMapHeaders(source.headers, type);
      renderMapping(type);
      resetResults("表頭列已變更，請確認欄位後重新分析。");
      updateAnalyzeAvailability();
    });
    box.querySelectorAll("[data-map-field]").forEach((select) => select.addEventListener("change", (event) => {
      const field = event.target.dataset.mapField;
      source.mapping[field] = event.target.value === "" ? null : Number(event.target.value);
      resetResults("欄位對應已變更，請重新開始分析。");
      validateSourceCard(type);
      updateAnalyzeAvailability();
    }));
    validateSourceCard(type);
  }

  function validateSourceCard(type) {
    const source = state.sources[type];
    const card = uploadGrid.querySelector(`[data-type="${type}"]`);
    const status = card.querySelector("[data-map-status]");
    const validation = core.validateMapping(type, source.mapping);
    card.classList.toggle("ready", validation.valid);
    card.classList.toggle("error", !validation.valid);
    status.className = `mapping-status ${validation.valid ? "ok" : "bad"}`;
    status.textContent = validation.valid ? "欄位檢查通過" : `仍缺少：${validation.missing.join("、")}`;
    return validation.valid;
  }

  function updateAnalyzeAvailability(preserveStatus = false) {
    const missingFiles = Array.from(requiredTypes).filter((type) => !state.sources[type]);
    const invalid = Object.keys(state.sources).filter((type) => !core.validateMapping(type, state.sources[type].mapping).valid);
    analyzeButton.disabled = missingFiles.length > 0 || invalid.length > 0 || !state.rulesReady;
    if (preserveStatus) return;
    if (missingFiles.length) mainStatus.textContent = `尚缺必要來源：${missingFiles.map((type) => core.REPORT_SCHEMAS[type].label).join("、")}`;
    else if (invalid.length) mainStatus.textContent = "部分報表的必要欄位尚未完成對應。";
    else if (!state.rulesReady) mainStatus.textContent = "必要來源已就緒，但需先取得公司最新版商品規則。";
    else mainStatus.textContent = "必要來源與欄位已就緒，可以開始分析。";
  }

  function renderCompanyResults(analysis) {
    const t = analysis.totals;
    resultTitle.textContent = "總部體系整體・本月勾稽摘要";
    resultNote.textContent = "畫面與02頁籤只顯示非通過商品；包含通過品項的完整底稿請見06_全部商品勾稽明細。";
    resultHead.innerHTML = "<tr><th>商品編號</th><th>品名</th><th>A數量</th><th>B合計</th><th>B1淨銷售</th><th>B2加盟調撥</th><th>B3總倉代出</th><th>B4加盟退回</th><th>C數量</th><th>D時點數量</th><th>未解釋數量</th><th>未解釋金額</th><th>狀態</th><th>建議排查方法</th></tr>";
    const cards = [
      ["A 庫存推算耗用", formatNumber(t.aQty), `$${formatNumber(t.aAmount)}`, false],
      ["B 四類來源合計", formatNumber(t.salesQty), `$${formatNumber(t.salesAmount)}`, false],
      ["B1 淨銷售", formatNumber(t.b1Qty), `$${formatNumber(t.b1Amount)}`, false],
      ["B2 加盟月結調撥", formatNumber(t.b2Qty), `$${formatNumber(t.b2Amount)}`, false],
      ["B3 總倉代出", formatNumber(t.b3Qty), `$${formatNumber(t.b3Amount)}`, false],
      ["B4 加盟退回", formatNumber(t.b4Qty), `$${formatNumber(t.b4Amount)}`, false],
      ["C 非銷售調整", formatNumber(t.adjustmentQty), `$${formatNumber(t.adjustmentAmount)}`, false],
      ["D 跨月／尚未月結時點", formatNumber(t.timingQty), `$${formatNumber(t.timingAmount)}`, false],
      ["最終未解釋差異", formatNumber(t.quantityDifference), `$${formatNumber(t.rawAmountDifference)}`, Math.abs(t.quantityDifference) > 0.000001 || Math.abs(t.rawAmountDifference) >= 1]
    ];
    summaryCards.innerHTML = cards.map(([label, value, sub, warn]) => `<div class="summary-card ${warn ? "warn" : ""}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(sub)}</span></div>`).join("");
    const differenceItems = analysis.details.filter((item) => item.status !== "通過").slice(0, 20);
    resultRows.innerHTML = differenceItems.length
      ? differenceItems.map((item) => `<tr><td>${escapeHtml(item.sku)}</td><td>${escapeHtml(item.name)}</td><td>${formatNumber(item.aQty)}</td><td>${formatNumber(item.salesQty)}</td><td>${formatNumber(item.b1Qty)}</td><td>${formatNumber(item.b2Qty)}</td><td>${formatNumber(item.b3Qty)}</td><td>${formatNumber(item.b4Qty)}</td><td>${formatNumber(item.adjustmentQty)}</td><td>${formatNumber(item.timingQty)}</td><td>${formatNumber(item.quantityDifference)}</td><td>${formatNumber(item.rawAmountDifference)}</td><td class="status-warn">${escapeHtml(item.status)}</td><td class="advice-cell">${escapeHtml(item.advice)}</td></tr>`).join("")
      : '<tr><td colspan="14" class="status-pass">本月所有商品皆通過，沒有需要列入差異明細的品項。</td></tr>';
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderWarehouseResults(analysis) {
    const t = analysis.totals;
    resultTitle.textContent = `${analysis.warehouse}・單倉實體庫存勾稽`;
    resultNote.textContent = "單倉報表只看實體庫存流向；總倉代出只列在實際扣庫的總倉，不等同門市完整銷售成本或門市損益。";
    resultHead.innerHTML = "<tr><th>商品編號</th><th>品名</th><th>A數量</th><th>B本倉扣庫</th><th>調入</th><th>調出</th><th>直接進貨</th><th>退廠</th><th>C數量</th><th>D時點數量</th><th>未解釋數量</th><th>未解釋金額</th><th>狀態</th><th>建議排查方法</th></tr>";
    const cards = [
      ["A 單倉庫存推算", formatNumber(t.aQty), `$${formatNumber(t.aAmount)}`, false],
      ["B 本倉實際銷售扣庫", formatNumber(t.salesQty), `$${formatNumber(t.salesAmount)}`, false],
      ["調撥入庫", formatNumber(t.transferInQty), `$${formatNumber(t.transferInAmount)}`, false],
      ["調撥出庫", formatNumber(t.transferOutQty), `$${formatNumber(t.transferOutAmount)}`, false],
      ["直接進貨", formatNumber(t.purchaseQty), `$${formatNumber(t.purchaseAmount)}`, false],
      ["退廠", formatNumber(t.supplierReturnQty), `$${formatNumber(t.supplierReturnAmount)}`, false],
      ["C 非銷售調整", formatNumber(t.adjustmentQty), `$${formatNumber(t.adjustmentAmount)}`, false],
      ["D 時點調整", formatNumber(t.timingQty), `$${formatNumber(t.timingAmount)}`, false],
      ["最終未解釋差異", formatNumber(t.quantityDifference), `$${formatNumber(t.rawAmountDifference)}`, Math.abs(t.quantityDifference) > 0.000001 || Math.abs(t.rawAmountDifference) >= 1]
    ];
    summaryCards.innerHTML = cards.map(([label, value, sub, warn]) => `<div class="summary-card ${warn ? "warn" : ""}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(sub)}</span></div>`).join("");
    const differenceItems = analysis.details.filter((item) => item.status !== "通過").slice(0, 20);
    resultRows.innerHTML = differenceItems.length
      ? differenceItems.map((item) => `<tr><td>${escapeHtml(item.sku)}</td><td>${escapeHtml(item.name)}</td><td>${formatNumber(item.aQty)}</td><td>${formatNumber(item.salesQty)}</td><td>${formatNumber(item.transferInQty)}</td><td>${formatNumber(item.transferOutQty)}</td><td>${formatNumber(item.purchaseQty)}</td><td>${formatNumber(item.supplierReturnQty)}</td><td>${formatNumber(item.adjustmentQty)}</td><td>${formatNumber(item.timingQty)}</td><td>${formatNumber(item.quantityDifference)}</td><td>${formatNumber(item.rawAmountDifference)}</td><td class="status-warn">${escapeHtml(item.status)}</td><td class="advice-cell">${escapeHtml(item.advice)}</td></tr>`).join("")
      : '<tr><td colspan="14" class="status-pass">本倉所有商品皆通過，沒有需要列入差異明細的品項。</td></tr>';
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderWarehouseOverview(bundle) {
    resultTitle.textContent = "全部店倉・實體庫存勾稽總覽";
    resultNote.textContent = "總覽用來找出優先排查倉別；下載Excel後可依未解釋金額、異常商品或來源提醒排序。";
    resultHead.innerHTML = "<tr><th>倉別</th><th>分類</th><th>A數量</th><th>B本倉扣庫</th><th>調入</th><th>調出</th><th>C數量</th><th>D數量</th><th>未解釋數量</th><th>未解釋金額</th><th>異常商品</th><th>來源提醒</th><th>期初期末</th><th>建議</th></tr>";
    const aggregate = bundle.analyses.reduce((acc, entry) => {
      const t = entry.analysis.totals;
      acc.a += t.aQty; acc.b += t.salesQty; acc.c += t.adjustmentQty; acc.diffQty += t.quantityDifference; acc.diffAmount += t.rawAmountDifference; acc.issues += t.issueCount;
      return acc;
    }, { a: 0, b: 0, c: 0, diffQty: 0, diffAmount: 0, issues: 0 });
    summaryCards.innerHTML = [
      ["偵測店倉", bundle.analyses.length, "期初／期末自動辨識"],
      ["各倉A合計", formatNumber(aggregate.a), "含各倉調入／調出"],
      ["各倉B合計", formatNumber(aggregate.b), "依實際扣庫倉"],
      ["各倉C合計", formatNumber(aggregate.c), "非銷售出入庫"],
      ["未解釋數量合計", formatNumber(aggregate.diffQty), `$${formatNumber(aggregate.diffAmount)}`],
      ["來源提醒", formatNumber(aggregate.issues, 0), "不含info"]
    ].map(([label, value, sub]) => `<div class="summary-card"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(sub)}</span></div>`).join("");
    resultRows.innerHTML = bundle.analyses.map((entry) => {
      const t = entry.analysis.totals;
      const complete = entry.opening && entry.closing;
      return `<tr><td>${escapeHtml(entry.name)}</td><td>${escapeHtml(warehouseClassificationLabel(entry.classification))}</td><td>${formatNumber(t.aQty)}</td><td>${formatNumber(t.salesQty)}</td><td>${formatNumber(t.transferInQty)}</td><td>${formatNumber(t.transferOutQty)}</td><td>${formatNumber(t.adjustmentQty)}</td><td>${formatNumber(t.timingQty)}</td><td>${formatNumber(t.quantityDifference)}</td><td>${formatNumber(t.rawAmountDifference)}</td><td>${formatNumber(t.itemCount - t.passCount, 0)}</td><td>${formatNumber(t.issueCount, 0)}</td><td class="${complete ? "status-pass" : "status-warn"}">${complete ? "完整" : "不完整"}</td><td class="advice-cell">${complete ? "依未解釋金額由大到小排查。" : "先補齊期初或期末倉別範圍。"}</td></tr>`;
    }).join("");
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function selectCurrentAnalysis(scroll = true) {
    if (!state.companyAnalysis || !state.reports || !state.analysisOptions) return;
    const mode = analysisScope.value;
    warehousePicker.hidden = mode !== "single";
    if (mode === "company") {
      state.analysis = state.companyAnalysis;
      state.outputWorkbook = core.buildOutputWorkbook(state.analysis, XLSX);
      renderCompanyResults(state.analysis);
    } else if (mode === "all") {
      if (!state.warehouseBundle) {
        state.warehouseBundle = core.analyzeAllWarehouses(state.reports, state.analysisOptions);
        state.warehouseCache = new Map(state.warehouseBundle.analyses.map((entry) => [core.canonicalWarehouseName(entry.name), entry.analysis]));
      }
      state.analysis = state.warehouseBundle;
      state.outputWorkbook = core.buildWarehouseOverviewWorkbook(state.warehouseBundle, XLSX);
      renderWarehouseOverview(state.warehouseBundle);
    } else {
      const target = mode === "headquarters" ? "寬承總倉" : warehouseSelect.value;
      const scope = state.warehouseScopes.find((candidate) => core.canonicalWarehouseName(candidate.name) === core.canonicalWarehouseName(target));
      if (!scope) throw new Error(`找不到「${target || "所選店倉"}」的期初／期末資料。`);
      const key = core.canonicalWarehouseName(scope.name);
      if (!state.warehouseCache.has(key)) state.warehouseCache.set(key, core.analyzeWarehouse(state.reports, scope.name, state.analysisOptions));
      state.analysis = state.warehouseCache.get(key);
      state.outputWorkbook = core.buildWarehouseOutputWorkbook(state.analysis, XLSX);
      renderWarehouseResults(state.analysis);
    }
    downloadButton.disabled = false;
    if (!scroll) resultPanel.scrollIntoView({ behavior: "auto", block: "start" });
  }

  analyzeButton.addEventListener("click", async () => {
    analyzeButton.disabled = true;
    downloadButton.disabled = true;
    mainStatus.textContent = "正在確認公司最新版商品規則……";
    try {
      await refreshRules("analysis");
      mainStatus.textContent = `已取得公司集中規則 v${state.rulesVersion}，正在整理八類來源並計算差異……`;
      const reports = {};
      for (const type of core.REPORT_ORDER) {
        const source = state.sources[type];
        if (!source) continue;
        const entries = source.entries || [{ file: source.file, workbook: source.workbook }];
        const parts = entries.map((entry, entryIndex) => {
          const selected = entryIndex === 0 ? source : entry.selected;
          return core.extractReport(entry.workbook, XLSX, type, {
            sheetName: selected.sheetName || selected.name,
            headerRowIndex: selected.headerRowIndex,
            mapping: selected.mapping,
            fileName: entry.file.name
          });
        });
        reports[type] = core.mergeReportParts(type, parts);
      }
      const monthContext = core.resolveAnalysisMonth(reports);
      const options = {
        rules: state.rules,
        rulesVersion: state.rulesVersion,
        rulesUpdatedAt: state.rulesUpdatedAt,
        analysisMonth: monthContext.analysisMonth,
        sourceMonthChecks: monthContext.sourceMonthChecks
      };
      state.reports = reports;
      state.analysisOptions = options;
      state.companyAnalysis = core.analyzeReports(reports, options);
      state.warehouseBundle = null;
      state.warehouseCache = new Map();
      state.warehouseScopes = core.discoverWarehouseScopes(reports);
      const currentWarehouse = warehouseSelect.value;
      warehouseSelect.innerHTML = state.warehouseScopes.map((entry) => `<option value="${escapeHtml(entry.name)}" ${entry.name === currentWarehouse ? "selected" : ""}>${escapeHtml(entry.name)}${entry.opening && entry.closing ? "" : "（期初／期末不完整）"}</option>`).join("");
      if (!warehouseSelect.value && state.warehouseScopes[0]) warehouseSelect.value = state.warehouseScopes[0].name;
      selectCurrentAnalysis();
      mainStatus.textContent = `分析完成：沿用現行總部體系結果，另偵測${formatNumber(state.warehouseScopes.length, 0)}個店倉；切換單倉或總覽時會在目前瀏覽器依需要計算。`;
    } catch (error) {
      mainStatus.textContent = `分析失敗：${error.message}`;
      resultPanel.hidden = true;
    }
    updateAnalyzeAvailability(true);
  });

  analysisScope.addEventListener("change", async () => {
    warehousePicker.hidden = analysisScope.value !== "single";
    if (!state.companyAnalysis) return;
    try {
      mainStatus.textContent = analysisScope.value === "all" ? "正在計算全部店倉總覽……" : "正在切換分析範圍……";
      await new Promise((resolve) => setTimeout(resolve, 20));
      selectCurrentAnalysis(false);
      mainStatus.textContent = "已切換分析範圍；不需重新讀取Excel。";
    } catch (error) {
      mainStatus.textContent = `無法切換：${error.message}`;
    }
  });

  warehouseSelect.addEventListener("change", async () => {
    if (!state.companyAnalysis || analysisScope.value !== "single") return;
    try {
      mainStatus.textContent = `正在計算${warehouseSelect.value}……`;
      await new Promise((resolve) => setTimeout(resolve, 20));
      selectCurrentAnalysis(false);
      mainStatus.textContent = `已切換至${warehouseSelect.value}；不需重新讀取Excel。`;
    } catch (error) {
      mainStatus.textContent = `無法切換：${error.message}`;
    }
  });

  downloadButton.addEventListener("click", async () => {
    if (!state.outputWorkbook) return;
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const originalLabel = downloadButton.textContent;
    downloadButton.disabled = true;
    downloadButton.textContent = "正在整理Excel…";
    try {
      const bytes = await core.buildFrozenWorkbookBytes(state.outputWorkbook, XLSX, globalThis.JSZip);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      const scopeLabel = state.analysis && state.analysis.mode === "warehouse"
        ? state.analysis.warehouse
        : (state.analysis && state.analysis.mode === "warehouse-overview" ? "全部店倉總覽" : "總部體系整體");
      link.download = `庫存成本分析_${scopeLabel}_${stamp}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      mainStatus.textContent = "Excel已下載：各頁籤第一列已凍結，明細表頭可直接篩選與排序。";
    } catch (error) {
      mainStatus.textContent = `Excel下載失敗：${error.message}`;
    } finally {
      downloadButton.textContent = originalLabel;
      downloadButton.disabled = false;
    }
  });

  createCards();
  updateAnalyzeAvailability();
  refreshRules("load").catch(() => {
    mainStatus.textContent = "公司集中規則服務目前無法使用；為避免誤用舊規則，本次禁止分析。";
  });
})();

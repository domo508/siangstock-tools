(function () {
  "use strict";

  const core = globalThis.InventoryCostCore;
  const XLSX = globalThis.XLSX;
  const inventoryCore = globalThis.InventoryCore;
  const rulesClient = globalThis.InventoryRulesClient;
  const requiredTypes = new Set(["opening", "closing", "purchases", "sales"]);
  const descriptions = {
    opening: "含總倉、直營與公司內各專用倉；排除加盟店倉。",
    closing: "倉別範圍必須與期初完全一致。",
    purchases: "本報表中的「成本價」例外視為供應商進貨價。",
    sales: "客戶退貨已用負值呈現，不需另傳客退報表。",
    storeMonthly: "用於加盟請款、總倉代出及門市調撥數量核對。",
    movements: "盤盈、盤虧、報廢、贈送、客訴、員購與樣品等原因。",
    supplierReturns: "完成退廠後，以未稅進貨額沖減當月進貨。",
    transfers: "公司內互調作稽核；跨加盟體系用於月結查漏補缺。"
  };

  const state = {
    sources: {},
    analysis: null,
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

  function resetResults(message) {
    state.analysis = null;
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
      const card = document.createElement("article");
      card.className = "upload-card";
      card.dataset.type = type;
      card.innerHTML = `
        <div class="upload-card-header">
          <h3>${index + 1}. ${escapeHtml(schema.label)}</h3>
          <span class="source-badge ${requiredTypes.has(type) ? "required" : ""}">${requiredTypes.has(type) ? "必要" : "選填"}</span>
        </div>
        <p class="upload-help">${escapeHtml(descriptions[type])}</p>
        <label class="file-button">選擇 .xlsx 檔<input type="file" accept=".xlsx" data-file-type="${type}"></label>
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
    const file = input.files[0];
    fileName.textContent = `正在讀取：${file.name}`;
    try {
      const data = await readFile(file);
      const workbook = XLSX.read(data, { type: "array", cellDates: true });
      const inspection = core.inspectWorkbook(workbook, XLSX, type);
      const selected = inspection.sheets[0];
      state.sources[type] = {
        type,
        file,
        workbook,
        inspection,
        sheetName: selected.name,
        headerRowIndex: selected.headerRowIndex,
        headers: selected.headers,
        mapping: { ...selected.mapping }
      };
      fileName.textContent = file.name;
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

  function renderResults(analysis) {
    const t = analysis.totals;
    const cards = [
      ["A 庫存推算耗用", formatNumber(t.aQty), `$${formatNumber(t.aAmount)}`, false],
      ["B 淨銷售／跨體系", formatNumber(t.salesQty), `$${formatNumber(t.salesAmount)}`, false],
      ["C 非銷售調整", formatNumber(t.adjustmentQty), `$${formatNumber(t.adjustmentAmount)}`, false],
      ["最終未解釋差異", formatNumber(t.quantityDifference), `$${formatNumber(t.rawAmountDifference)}`, Math.abs(t.quantityDifference) > 0.000001 || Math.abs(t.rawAmountDifference) >= 1]
    ];
    summaryCards.innerHTML = cards.map(([label, value, sub, warn]) => `<div class="summary-card ${warn ? "warn" : ""}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(sub)}</span></div>`).join("");
    resultRows.innerHTML = analysis.details.slice(0, 20).map((item) => `<tr><td>${escapeHtml(item.sku)}</td><td>${escapeHtml(item.name)}</td><td>${formatNumber(item.aQty)}</td><td>${formatNumber(item.salesQty)}</td><td>${formatNumber(item.adjustmentQty)}</td><td>${formatNumber(item.quantityDifference)}</td><td>${formatNumber(item.rawAmountDifference)}</td><td class="${item.status === "通過" ? "status-pass" : "status-warn"}">${escapeHtml(item.status)}</td></tr>`).join("");
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
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
        reports[type] = core.extractReport(source.workbook, XLSX, type, {
          sheetName: source.sheetName,
          headerRowIndex: source.headerRowIndex,
          mapping: source.mapping,
          fileName: source.file.name
        });
      }
      state.analysis = core.analyzeReports(reports, {
        rules: state.rules,
        rulesVersion: state.rulesVersion,
        rulesUpdatedAt: state.rulesUpdatedAt
      });
      state.outputWorkbook = core.buildOutputWorkbook(state.analysis, XLSX);
      renderResults(state.analysis);
      mainStatus.textContent = `分析完成：使用公司集中規則 v${state.rulesVersion}，共${formatNumber(state.analysis.totals.itemCount, 0)}項商品，排除${formatNumber(state.analysis.exclusions.length, 0)}列，另有${formatNumber(state.analysis.totals.issueCount, 0)}項來源或配對問題。`;
      downloadButton.disabled = false;
    } catch (error) {
      mainStatus.textContent = `分析失敗：${error.message}`;
      resultPanel.hidden = true;
    }
    updateAnalyzeAvailability(true);
  });

  downloadButton.addEventListener("click", () => {
    if (!state.outputWorkbook) return;
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(state.outputWorkbook, `庫存成本分析_${stamp}.xlsx`, { compression: true });
  });

  createCards();
  updateAnalyzeAvailability();
  refreshRules("load").catch(() => {
    mainStatus.textContent = "公司集中規則服務目前無法使用；為避免誤用舊規則，本次禁止分析。";
  });
})();

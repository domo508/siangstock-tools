(function () {
  "use strict";

  const core = globalThis.SupplierReconciliationCore;
  const XLSX = globalThis.XLSX;
  const ledgerStore = globalThis.SupplierReconciliationLedgerStore.createStore();
  const state = {
    sources: {}, priorLedger: [], priorShanglin: [], priorSource: "local", currentVendor: null, localSnapshot: null,
    nameMapping: null, nameMappingInvalid: false, analysis: null, outputWorkbook: null, filter: "differences", ledgerLoadToken: 0
  };
  const analyzeButton = document.getElementById("analyze-button");
  const downloadButton = document.getElementById("download-button");
  const mainStatus = document.getElementById("main-status");
  const resultPanel = document.getElementById("result-panel");
  const summaryCards = document.getElementById("summary-cards");
  const summaryNotes = document.getElementById("summary-notes");
  const resultRows = document.getElementById("result-rows");
  const periodMonth = document.getElementById("period-month");
  const cutoffDate = document.getElementById("cross-month-cutoff");
  const priorFileName = document.getElementById("prior-file-name");
  const nameMappingFileName = document.getElementById("name-mapping-file-name");
  const nameMappingStatus = document.getElementById("name-mapping-status");
  const localLedgerStatus = document.getElementById("local-ledger-status");
  const useLocalLedgerButton = document.getElementById("use-local-ledger");
  const clearLocalLedgerButton = document.getElementById("clear-local-ledger");
  const priorFileInput = document.getElementById("prior-file");

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function formatNumber(value) {
    if (value == null || value === "") return "—";
    return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function formatPercent(value) {
    return new Intl.NumberFormat("zh-TW", { style: "percent", maximumFractionDigits: 1 }).format(Number(value || 0));
  }

  function formatDateTime(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  function extractCurrentReport(type) {
    const source = state.sources[type];
    if (!source || !core.validateMapping(type, source.mapping).valid) return null;
    return core.extractSource(source.workbook, XLSX, type, {
      sheetName: source.sheetName, headerRowIndex: source.headerRowIndex, mapping: source.mapping,
      fileName: source.file.name, format: source.format
    });
  }

  function renderLocalLedgerStatus() {
    clearLocalLedgerButton.disabled = !state.currentVendor;
    if (state.priorSource === "manual") {
      localLedgerStatus.textContent = `本次採用手動匯入：${formatNumber(state.priorLedger.length)}筆跨月認列、${formatNumber(state.priorShanglin.length)}筆上林反向追蹤。`;
      return;
    }
    if (!state.currentVendor) {
      localLedgerStatus.textContent = "選擇B表與對帳月份後，會自動尋找該供應商最近一期台帳。";
      return;
    }
    if (!state.localSnapshot) {
      localLedgerStatus.textContent = `${state.currentVendor.label}：${periodMonth.value}以前沒有本機台帳，本次將從空白台帳開始。`;
      return;
    }
    const snapshot = state.localSnapshot;
    localLedgerStatus.textContent = `${state.currentVendor.label}：已自動帶入${snapshot.period}台帳（跨月認列${formatNumber(state.priorLedger.length)}筆、上林反向追蹤${formatNumber(state.priorShanglin.length)}筆），最後更新${formatDateTime(snapshot.updatedAt)}。`;
  }

  async function loadLocalLedger(bReport = null, force = false) {
    if (state.priorSource === "manual" && !force) { renderLocalLedgerStatus(); return; }
    const report = bReport || extractCurrentReport("b");
    if (!report || !periodMonth.value) {
      state.currentVendor = report ? core.inferLedgerVendor(report) : null;
      state.localSnapshot = null;
      renderLocalLedgerStatus();
      return;
    }
    const token = ++state.ledgerLoadToken;
    const vendor = core.inferLedgerVendor(report);
    state.currentVendor = vendor;
    localLedgerStatus.textContent = `正在尋找${vendor.label}最近一期本機台帳……`;
    try {
      const snapshot = await ledgerStore.loadPrior(vendor.key, periodMonth.value);
      if (token !== state.ledgerLoadToken) return;
      state.priorSource = "local";
      state.localSnapshot = snapshot;
      state.priorLedger = snapshot?.ledgerRows || [];
      state.priorShanglin = snapshot?.shanglinRows || [];
      renderLocalLedgerStatus();
    } catch (error) {
      if (token !== state.ledgerLoadToken) return;
      state.localSnapshot = null;
      state.priorLedger = [];
      state.priorShanglin = [];
      localLedgerStatus.textContent = `${error.message} 本次仍可正常比對，建議匯入上期結果Excel。`;
    }
  }

  function minimumRetainedMonth(period) {
    const [year, month] = period.split("-").map(Number);
    const date = new Date(year, month - 24, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  async function saveLocalLedger(analysis, workbook, vendor) {
    const minimumMonth = minimumRetainedMonth(analysis.period.month);
    const ledgerRows = core.ledgerRowsFromWorkbook(workbook, XLSX).filter((row) => !row.recognitionMonth || row.recognitionMonth >= minimumMonth);
    const shanglinRows = core.shanglinRowsFromWorkbook(workbook, XLSX);
    return ledgerStore.save({
      vendorKey: vendor.key, vendorLabel: vendor.label, period: analysis.period.month,
      ledgerRows, shanglinRows,
      summary: {
        matchedCount: analysis.totals.matchedCount || 0, differenceCount: analysis.totals.differenceCount || 0,
        aOnlyCount: analysis.totals.aOnlyCount || 0, bOnlyCount: analysis.totals.bOnlyCount || 0,
        reversePendingCount: shanglinRows.length
      }
    });
  }

  function resetResults(message) {
    state.analysis = null;
    state.outputWorkbook = null;
    resultPanel.hidden = true;
    downloadButton.disabled = true;
    if (message) mainStatus.textContent = message;
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("無法讀取檔案"));
      reader.readAsArrayBuffer(file);
    });
  }

  function mappingOptions(headers, selectedIndex) {
    return [`<option value="">不使用</option>`, ...headers.map((header, index) => `<option value="${index}" ${index === selectedIndex ? "selected" : ""}>${escapeHtml(header || `欄位${index + 1}`)}</option>`)].join("");
  }

  function renderMapping(type) {
    const source = state.sources[type];
    const card = document.querySelector(`[data-source="${type}"]`);
    const box = document.getElementById(`${type}-mapping`);
    const schema = core.SOURCE_SCHEMAS[type];
    box.hidden = false;
    box.innerHTML = `
      <div class="mapping-meta">
        <label>工作表<select data-sheet>${source.inspection.sheets.map((sheet) => `<option value="${escapeHtml(sheet.name)}" ${sheet.name === source.sheetName ? "selected" : ""}>${escapeHtml(sheet.name)}</option>`).join("")}</select></label>
        <label>表頭列<input data-header-row type="number" min="1" max="30" value="${source.headerRowIndex + 1}"></label>
      </div>
      <div class="mapping-list">${Object.keys(schema.fields).map((field) => `<label>${escapeHtml(core.fieldLabel(field))}${schema.required.includes(field) ? "＊" : ""}<select data-field="${field}">${mappingOptions(source.headers, source.mapping[field])}</select></label>`).join("")}</div>
      <p class="mapping-status" data-mapping-status></p>`;

    box.querySelector("[data-sheet]").addEventListener("change", (event) => {
      const selected = source.inspection.sheets.find((sheet) => sheet.name === event.target.value);
      source.sheetName = selected.name;
      source.headerRowIndex = selected.headerRowIndex;
      source.headers = selected.headers;
      source.mapping = { ...selected.mapping };
      source.format = selected.format || "";
      renderMapping(type);
      resetResults("工作表已變更，請確認欄位後重新比對。");
      if (type === "b" && state.priorSource !== "manual") void loadLocalLedger();
      updateAvailability();
    });

    box.querySelector("[data-header-row]").addEventListener("change", (event) => {
      const rowIndex = Math.max(0, Number(event.target.value || 1) - 1);
      const sheet = source.workbook.Sheets[source.sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
      source.headerRowIndex = rowIndex;
      source.headers = (rows[rowIndex] || []).map((value, index) => String(value || `欄位${index + 1}`).trim());
      source.mapping = core.autoMapHeaders(source.headers, type);
      renderMapping(type);
      resetResults("表頭列已變更，請確認欄位後重新比對。");
      if (type === "b" && state.priorSource !== "manual") void loadLocalLedger();
      updateAvailability();
    });

    box.querySelectorAll("[data-field]").forEach((select) => select.addEventListener("change", (event) => {
      source.mapping[event.target.dataset.field] = event.target.value === "" ? null : Number(event.target.value);
      resetResults("欄位設定已變更，請重新開始比對。");
      validateSource(type);
      if (type === "b" && state.priorSource !== "manual") void loadLocalLedger();
      updateAvailability();
    }));
    validateSource(type);
  }

  function validateSource(type) {
    const source = state.sources[type];
    const card = document.querySelector(`[data-source="${type}"]`);
    const status = document.querySelector(`#${type}-mapping [data-mapping-status]`);
    const validation = core.validateMapping(type, source.mapping);
    card.classList.toggle("ready", validation.valid);
    card.classList.toggle("error", !validation.valid);
    status.className = `mapping-status ${validation.valid ? "ok" : "bad"}`;
    status.textContent = validation.valid
      ? source.format === "li-rong" ? "已辨識力榮帳款格式；整份依選定月份認列，原建單日期保留稽核"
        : source.format === "shanglin" ? "已辨識上林請款格式；將以訂單內容、來源與日期逐單核對" : "必要欄位檢查通過"
      : `仍缺少：${validation.missing.join("、")}`;
    return validation.valid;
  }

  function updateAvailability() {
    const missing = ["a", "b"].filter((type) => !state.sources[type]);
    const invalid = ["a", "b"].filter((type) => state.sources[type] && !core.validateMapping(type, state.sources[type].mapping).valid);
    const periodMissing = !periodMonth.value || !cutoffDate.value;
    analyzeButton.disabled = missing.length > 0 || invalid.length > 0 || periodMissing || state.nameMappingInvalid;
    if (missing.length) mainStatus.textContent = `尚缺：${missing.map((type) => core.SOURCE_SCHEMAS[type].label).join("、")}`;
    else if (invalid.length) mainStatus.textContent = "部分必要欄位尚未完成對應。";
    else if (state.nameMappingInvalid) mainStatus.textContent = "上林品名對照表無法使用，請更換檔案或取消選取。";
    else if (periodMissing) mainStatus.textContent = "請選擇對帳月份與跨月補收截止日。";
    else mainStatus.textContent = state.nameMapping
      ? `兩份報表已就緒；將套用品名對照表${formatNumber(state.nameMapping.usable.length)}組有效對應。`
      : "兩份報表與必要欄位已就緒，可以開始比對。";
  }

  function setDefaultCutoff(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const [year, monthNumber] = month.split("-").map(Number);
    const date = new Date(year, monthNumber, 3);
    cutoffDate.value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  async function onFileChange(type, event) {
    const input = event.currentTarget;
    const fileName = document.getElementById(`${type}-file-name`);
    const card = document.querySelector(`[data-source="${type}"]`);
    const mappingBox = document.getElementById(`${type}-mapping`);
    resetResults("檔案已變更，請重新開始比對。");
    card.classList.remove("ready", "error");
    if (type === "b") { state.currentVendor = null; state.localSnapshot = null; }
    if (!input.files || !input.files[0]) {
      delete state.sources[type];
      fileName.textContent = "尚未選擇";
      mappingBox.hidden = true;
      if (type === "b" && state.priorSource !== "manual") { state.priorLedger = []; state.priorShanglin = []; }
      renderLocalLedgerStatus();
      updateAvailability();
      return;
    }
    const file = input.files[0];
    fileName.textContent = `正在讀取：${file.name}`;
    try {
      const data = await readFile(file);
      const workbook = XLSX.read(data, { type: "array", cellDates: true });
      const inspection = core.inspectWorkbook(workbook, XLSX, type);
      const selected = inspection.sheets[0];
      state.sources[type] = { file, workbook, inspection, sheetName: selected.name, headerRowIndex: selected.headerRowIndex, headers: selected.headers, mapping: { ...selected.mapping }, format: selected.format || inspection.format || "" };
      const formatText = state.sources[type].format === "li-rong" ? "・力榮帳款格式" : state.sources[type].format === "shanglin" ? "・上林請款格式" : "";
      fileName.textContent = `${file.name}・已讀取${formatText}`;
      renderMapping(type);
      if (type === "b" && core.validateMapping(type, state.sources[type].mapping).valid) {
        const report = extractCurrentReport("b");
        state.currentVendor = core.inferLedgerVendor(report);
        const inferred = core.inferDominantMonth(report);
        if (inferred && !periodMonth.value) { periodMonth.value = inferred; setDefaultCutoff(inferred); }
        if (state.priorSource !== "manual") await loadLocalLedger(report);
        else renderLocalLedgerStatus();
      }
    } catch (error) {
      delete state.sources[type];
      card.classList.add("error");
      fileName.textContent = `${file.name}：${error.message}`;
      mappingBox.hidden = true;
      if (type === "b") renderLocalLedgerStatus();
    }
    updateAvailability();
  }

  async function onNameMappingChange(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    const card = document.querySelector('[data-source="name-mapping"]');
    resetResults("品名對照表已變更，請重新開始比對。");
    state.nameMapping = null;
    state.nameMappingInvalid = false;
    card.classList.remove("ready", "error");
    nameMappingStatus.hidden = true;
    if (!file) {
      nameMappingFileName.textContent = "未選擇（非上林可略過）";
      updateAvailability();
      return;
    }
    nameMappingFileName.textContent = `正在讀取：${file.name}`;
    try {
      const data = await readFile(file);
      const workbook = XLSX.read(data, { type: "array", cellDates: true });
      state.nameMapping = core.parseNameMappingWorkbook(workbook, XLSX, { fileName: file.name });
      const mapping = state.nameMapping;
      card.classList.add("ready");
      nameMappingFileName.textContent = `${file.name}・已讀取`;
      nameMappingStatus.hidden = false;
      nameMappingStatus.className = `mapping-status ${mapping.conflicts.length ? "warn" : "ok"}`;
      nameMappingStatus.textContent = mapping.conflicts.length
        ? `可使用${formatNumber(mapping.usable.length)}組；另有${formatNumber(mapping.conflicts.length)}組一對多衝突將自動略過（例如停售或狀態文字）。`
        : `已確認${formatNumber(mapping.usable.length)}組一對一品名對應。`;
    } catch (error) {
      state.nameMappingInvalid = true;
      card.classList.add("error");
      nameMappingFileName.textContent = `${file.name}：${error.message}`;
      nameMappingStatus.hidden = false;
      nameMappingStatus.className = "mapping-status bad";
      nameMappingStatus.textContent = "此檔案不會被忽略；請更換正確對照表或取消選取。";
    }
    updateAvailability();
  }

  function statusClass(status) {
    if (status.startsWith("跨月")) return "cross";
    if (status.includes("疑似前期")) return "warn";
    if (status === "完全通過") return "pass";
    if (status === "僅A表存在" || status === "僅B表存在") return "single";
    if (status === "計算異常") return "warn";
    return "error";
  }

  function signedClass(value) {
    return value == null || Math.abs(Number(value)) < 0.000001 ? "" : Number(value) > 0 ? "positive" : "negative";
  }

  function renderRows(items) {
    resultRows.innerHTML = items.length ? items.map((item) => `<tr>
      <td><span class="status-chip ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
      <td>${escapeHtml(item.aSku || "—")}</td><td>${escapeHtml(item.aName || "—")}</td><td>${escapeHtml(item.bName || "—")}</td>
      <td>${formatNumber(item.aQty)}</td><td>${formatNumber(item.bQty)}</td><td class="${signedClass(item.qtyDifference)}">${formatNumber(item.qtyDifference)}</td>
      <td>${formatNumber(item.recognizedQty)}</td><td>${formatNumber(item.crossMonthQty)}</td>
      <td class="${signedClass(item.aMissingQty)}">${formatNumber(item.aMissingQty)}</td><td class="${signedClass(item.bMissingQty)}">${formatNumber(item.bMissingQty)}</td>
      <td class="${signedClass(item.auditDifferenceQty)}">${formatNumber(item.auditDifferenceQty)}</td>
      <td>${formatNumber(item.aUnitPrice)}</td><td>${formatNumber(item.bUnitPrice)}</td><td class="${signedClass(item.unitPriceDifference)}">${formatNumber(item.unitPriceDifference)}</td>
      <td class="audit-cell">${escapeHtml(item.auditExplanation || item.matchBasis)}</td>
    </tr>`).join("") : '<tr><td colspan="16" class="status-pass">這個分類目前沒有品項。</td></tr>';
  }

  function applyFilter(filter) {
    state.filter = filter;
    document.querySelectorAll("[data-filter]").forEach((button) => button.classList.toggle("active", button.dataset.filter === filter));
    if (!state.analysis) return;
    if (filter === "unmatched") renderRows(state.analysis.unmatched);
    else if (filter === "cross") renderRows(state.analysis.paired.filter((row) => row.crossMonth));
    else if (filter === "all") renderRows(state.analysis.paired);
    else renderRows(state.analysis.differences);
  }

  function renderResults(analysis) {
    const t = analysis.totals;
    if (analysis.vendorMode === "shanglin-order") {
      const cards = [
        ["A表商品", formatNumber(t.aItemCount), "ERP收貨商品"], ["B表本期商品", formatNumber(t.bItemCount), `整份${formatNumber(t.bStatementItemCount)}項，已先反查上期`],
        ["本期核對通過", formatNumber(t.matchedCount), `${formatNumber(t.exactOrderCount)}張整單・${formatNumber(t.exactLineCount)}筆明細`],
        ["上期反查通過", formatNumber(t.reverseResolvedOrderCount), `${formatNumber(t.reverseResolvedLineCount)}筆・${formatNumber(t.reverseResolvedQty)}件`],
        ["上期仍待追蹤", formatNumber(t.reverseUnresolvedOrderCount), `${formatNumber(t.reverseUnresolvedLineCount)}筆延續至下期`],
        ["疑似次期帳款", formatNumber(t.suspectedNextPeriodCount), "月底A表商品，等待次期B表"],
        ["疑似配對待確認", formatNumber(t.suspectedCandidateCount), "來源或日期脈絡衝突"],
        ["月底僅A商品", formatNumber(t.aOnlyCount), "尚未出現在本期B表"], ["僅B表存在", formatNumber(t.bOnlyCount), "沒有可靠A表候選"],
        ["待確認商品", formatNumber(t.attentionCount), "含通過後仍有次期待核項目"],
        ["候選價差影響", `$${formatNumber(t.absoluteDifference)}`, "僅供人工確認，不先認列差異"]
      ];
      summaryCards.innerHTML = cards.map(([label, value, sub]) => `<div class="summary-card ${label.includes("待確認") || label.includes("價差") ? "warn" : ""}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(sub)}</span></div>`).join("");
      summaryNotes.innerHTML = `
        <div class="equivalence-note">
          <strong>上林逐單核對關係</strong>
          <p>B表${formatNumber(t.bItemCount)}項＝本期核對通過${formatNumber(t.matchedCount)}項＋疑似配對${formatNumber(t.suspectedCandidateCount)}項＋僅B表${formatNumber(t.bOnlyCount)}項。</p>
          <p>上期反向跨月已驗證${formatNumber(t.reverseResolvedOrderCount)}張訂單、${formatNumber(t.reverseResolvedLineCount)}筆明細；這些B表明細會先移出本期一般對帳，避免重複配對。</p>
          <p>本期已有${formatNumber(t.exactOrderCount)}張訂單、${formatNumber(t.exactLineCount)}筆明細依內容雜湊、需求來源及日期通過；其中部分商品另有月底A表數量，分開標成疑似次期帳款，不當成本期數量差異。</p>
        </div>
        <div class="attention-alert" role="note">
          <strong>財務特別提醒</strong>
          <p>疑似次期帳款${formatNumber(t.suspectedNextPeriodCount)}項＋疑似配對${formatNumber(t.suspectedCandidateCount)}項＝<b>${formatNumber(t.attentionCount)}項待確認</b>；需取得上林次期報表後才能正式沖銷。</p>
        </div>`;
      applyFilter("differences"); resultPanel.hidden = false; resultPanel.scrollIntoView({ behavior: "smooth", block: "start" }); return;
    }
    const crossDifferenceCount = Math.max(0, (t.crossMonthCount || 0) - (t.crossMonthPassCount || 0));
    const attentionCount = t.differenceCount + t.aOnlyCount + t.bOnlyCount;
    const cards = [
      ["A表商品", formatNumber(t.aItemCount), "ERP收貨商品"], ["B表商品", formatNumber(t.bItemCount), "供應商商品"],
      ["成功配對", formatNumber(t.matchedCount), `A ${formatPercent(t.aPairRate)}・B ${formatPercent(t.bPairRate)}`],
      ["完全通過", formatNumber(t.passCount), "含跨月完全通過"], ["跨月配對", formatNumber(t.crossMonthCount), `其中完全通過${formatNumber(t.crossMonthPassCount)}項`],
      ["前期已認列排除", formatNumber(t.priorExcludedQty), `${formatNumber(t.priorExcludedCount)}筆收貨資料`], ["配對但有差異", formatNumber(t.differenceCount), "需由財務處理"],
      ["僅A表存在", formatNumber(t.aOnlyCount), "B表未找到可靠對應"], ["僅B表存在", formatNumber(t.bOnlyCount), "A表未找到可靠對應"],
      ["待處理差異額", `$${formatNumber(t.absoluteDifference)}`, "差異絕對額加總"]
    ];
    summaryCards.innerHTML = cards.map(([label, value, sub]) => `<div class="summary-card ${label === "配對但有差異" || label === "待處理差異額" ? "warn" : ""}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(sub)}</span></div>`).join("");
    summaryNotes.innerHTML = `
      <div class="equivalence-note">
        <strong>數量對價關係</strong>
        <p>A表${formatNumber(t.aItemCount)}項＝成功配對${formatNumber(t.matchedCount)}項＋僅A表${formatNumber(t.aOnlyCount)}項；B表${formatNumber(t.bItemCount)}項＝成功配對${formatNumber(t.matchedCount)}項＋僅B表${formatNumber(t.bOnlyCount)}項。</p>
        <p>成功配對${formatNumber(t.matchedCount)}項＝完全通過${formatNumber(t.passCount)}項＋配對但有差異${formatNumber(t.differenceCount)}項；跨月配對${formatNumber(t.crossMonthCount)}項＝跨月完全通過${formatNumber(t.crossMonthPassCount)}項＋跨月有差異${formatNumber(crossDifferenceCount)}項。</p>
      </div>
      <div class="attention-alert" role="note">
        <strong>財務特別提醒</strong>
        <p>配對但有差異${formatNumber(t.differenceCount)}項＋僅A表${formatNumber(t.aOnlyCount)}項＋僅B表${formatNumber(t.bOnlyCount)}項＝<b>${formatNumber(attentionCount)}項待確認</b></p>
      </div>`;
    applyFilter("differences");
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  analyzeButton.addEventListener("click", async () => {
    analyzeButton.disabled = true;
    downloadButton.disabled = true;
    mainStatus.textContent = "正在逐筆分配A、B明細數量並核對跨月差異……";
    try {
      const reports = {};
      for (const type of ["a", "b"]) {
        reports[type] = extractCurrentReport(type);
      }
      reports.b = core.applyNameMappingToBReport(reports.b, state.nameMapping);
      const vendor = core.inferLedgerVendor(reports.b);
      state.currentVendor = vendor;
      if (state.priorSource !== "manual") await loadLocalLedger(reports.b);
      state.analysis = core.analyzeMonthlyReports(reports.a, reports.b, { month: periodMonth.value, cutoff: cutoffDate.value, priorLedger: state.priorLedger, priorShanglin: state.priorShanglin });
      state.outputWorkbook = core.buildOutputWorkbook(state.analysis, XLSX);
      renderResults(state.analysis);
      const t = state.analysis.totals;
      const mappingText = state.analysis.bReport.nameMapping ? `；品名對照已套用${formatNumber(state.analysis.bReport.nameMapping.mappedRecordCount)}筆B明細` : "";
      const resultText = state.analysis.vendorMode === "shanglin-order"
        ? `上林逐單核對完成：上期反查通過${formatNumber(t.reverseResolvedOrderCount)}張；本期${formatNumber(t.exactOrderCount)}張整單、${formatNumber(t.exactLineCount)}筆明細通過；疑似次期${formatNumber(t.suspectedNextPeriodCount)}項、疑似配對${formatNumber(t.suspectedCandidateCount)}項待確認${mappingText}。`
        : `比對完成：成功配對${formatNumber(t.matchedCount)}項，其中跨月${formatNumber(t.crossMonthCount)}項；完全通過${formatNumber(t.passCount)}項，差異${formatNumber(t.differenceCount)}項，僅A表${formatNumber(t.aOnlyCount)}項，僅B表${formatNumber(t.bOnlyCount)}項${mappingText}。`;
      try {
        const saved = await saveLocalLedger(state.analysis, state.outputWorkbook, vendor);
        localLedgerStatus.textContent = `${vendor.label}：${saved.period}本機台帳已更新；下期會自動帶入。最後更新${formatDateTime(saved.updatedAt)}。`;
        mainStatus.textContent = `${resultText} 本機台帳已更新。`;
      } catch (storageError) {
        localLedgerStatus.textContent = `${storageError.message} 請下載結果Excel作為下期備援。`;
        mainStatus.textContent = `${resultText} 本機台帳未能保存，請下載結果Excel備援。`;
      }
      downloadButton.disabled = false;
    } catch (error) {
      resultPanel.hidden = true;
      mainStatus.textContent = `比對失敗：${error.message}`;
    } finally {
      analyzeButton.disabled = false;
    }
  });

  downloadButton.addEventListener("click", async () => {
    if (!state.outputWorkbook) return;
    const original = downloadButton.textContent;
    downloadButton.disabled = true;
    downloadButton.textContent = "正在整理Excel…";
    try {
      const bytes = await core.buildFrozenWorkbookBytes(state.outputWorkbook, XLSX, globalThis.JSZip);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      const date = new Date();
      const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
      link.href = url;
      link.download = `財務供應商對帳比對_${state.analysis.period?.month || stamp}.xlsx`;
      document.body.appendChild(link);
      link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      mainStatus.textContent = "結果Excel已下載；原始檔未被修改。";
    } catch (error) {
      mainStatus.textContent = `Excel下載失敗：${error.message}`;
    } finally {
      downloadButton.textContent = original;
      downloadButton.disabled = false;
    }
  });

  document.getElementById("a-file").addEventListener("change", (event) => onFileChange("a", event));
  document.getElementById("b-file").addEventListener("change", (event) => onFileChange("b", event));
  document.getElementById("name-mapping-file").addEventListener("change", onNameMappingChange);
  priorFileInput.addEventListener("change", async (event) => {
    resetResults("上期結果已變更，請重新開始比對。");
    const file = event.currentTarget.files?.[0];
    state.priorLedger = [];
    state.priorShanglin = [];
    if (!file) {
      state.priorSource = "local";
      priorFileName.textContent = "未選擇（首期可略過）";
      await loadLocalLedger(null, true);
      updateAvailability(); return;
    }
    state.priorSource = "manual";
    priorFileName.textContent = `正在讀取：${file.name}`;
    try {
      const data = await readFile(file);
      const workbook = XLSX.read(data, { type: "array", cellDates: true });
      state.priorLedger = core.ledgerRowsFromWorkbook(workbook, XLSX);
      state.priorShanglin = core.shanglinRowsFromWorkbook(workbook, XLSX);
      priorFileName.textContent = `${file.name}・已讀取${formatNumber(state.priorLedger.length)}筆跨月認列、${formatNumber(state.priorShanglin.length)}筆上林反向追蹤`;
      renderLocalLedgerStatus();
    } catch (error) {
      state.priorLedger = [];
      state.priorShanglin = [];
      priorFileName.textContent = `${file.name}：${error.message}`;
      localLedgerStatus.textContent = "手動匯入失敗；請更換正確結果Excel，或按「改用本機台帳」。";
    }
    updateAvailability();
  });
  useLocalLedgerButton.addEventListener("click", async () => {
    state.priorSource = "local";
    priorFileInput.value = "";
    priorFileName.textContent = "未選擇（目前自動使用本機台帳）";
    resetResults("已改用瀏覽器本機台帳，請重新開始比對。");
    await loadLocalLedger(null, true);
    updateAvailability();
  });
  clearLocalLedgerButton.addEventListener("click", async () => {
    const report = extractCurrentReport("b");
    const vendor = report ? core.inferLedgerVendor(report) : state.currentVendor;
    if (!vendor || !globalThis.confirm(`確定清除「${vendor.label}」在這個瀏覽器的全部台帳快照嗎？已下載的Excel不受影響。`)) return;
    clearLocalLedgerButton.disabled = true;
    try {
      const count = await ledgerStore.clearVendor(vendor.key);
      if (state.priorSource !== "manual") {
        state.priorLedger = []; state.priorShanglin = []; state.localSnapshot = null;
      }
      localLedgerStatus.textContent = `${vendor.label}本機台帳已清除${formatNumber(count)}個月份；需要時可匯入結果Excel復原。`;
    } catch (error) {
      localLedgerStatus.textContent = `清除失敗：${error.message}`;
    } finally {
      clearLocalLedgerButton.disabled = false;
    }
  });
  periodMonth.addEventListener("change", () => {
    setDefaultCutoff(periodMonth.value); resetResults("對帳月份已變更，請重新開始比對。");
    if (state.priorSource !== "manual") void loadLocalLedger();
    updateAvailability();
  });
  cutoffDate.addEventListener("change", () => { resetResults("跨月截止日已變更，請重新開始比對。"); updateAvailability(); });
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => applyFilter(button.dataset.filter)));
  renderLocalLedgerStatus();
  updateAvailability();
})();

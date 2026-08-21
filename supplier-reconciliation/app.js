(function () {
  "use strict";

  const core = globalThis.SupplierReconciliationCore;
  const XLSX = globalThis.XLSX;
  const state = { sources: {}, priorLedger: [], analysis: null, outputWorkbook: null, filter: "differences" };
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
      renderMapping(type);
      resetResults("工作表已變更，請確認欄位後重新比對。");
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
      updateAvailability();
    });

    box.querySelectorAll("[data-field]").forEach((select) => select.addEventListener("change", (event) => {
      source.mapping[event.target.dataset.field] = event.target.value === "" ? null : Number(event.target.value);
      resetResults("欄位設定已變更，請重新開始比對。");
      validateSource(type);
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
    status.textContent = validation.valid ? "必要欄位檢查通過" : `仍缺少：${validation.missing.join("、")}`;
    return validation.valid;
  }

  function updateAvailability() {
    const missing = ["a", "b"].filter((type) => !state.sources[type]);
    const invalid = ["a", "b"].filter((type) => state.sources[type] && !core.validateMapping(type, state.sources[type].mapping).valid);
    const periodMissing = !periodMonth.value || !cutoffDate.value;
    analyzeButton.disabled = missing.length > 0 || invalid.length > 0 || periodMissing;
    if (missing.length) mainStatus.textContent = `尚缺：${missing.map((type) => core.SOURCE_SCHEMAS[type].label).join("、")}`;
    else if (invalid.length) mainStatus.textContent = "部分必要欄位尚未完成對應。";
    else if (periodMissing) mainStatus.textContent = "請選擇對帳月份與跨月補收截止日。";
    else mainStatus.textContent = "兩份報表與必要欄位已就緒，可以開始比對。";
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
    if (!input.files || !input.files[0]) {
      delete state.sources[type];
      fileName.textContent = "尚未選擇";
      mappingBox.hidden = true;
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
      state.sources[type] = { file, workbook, inspection, sheetName: selected.name, headerRowIndex: selected.headerRowIndex, headers: selected.headers, mapping: { ...selected.mapping } };
      fileName.textContent = `${file.name}・已讀取`;
      renderMapping(type);
      if (type === "b" && core.validateMapping(type, state.sources[type].mapping).valid) {
        const report = core.extractSource(workbook, XLSX, type, { sheetName: selected.name, headerRowIndex: selected.headerRowIndex, mapping: selected.mapping, fileName: file.name });
        const inferred = core.inferDominantMonth(report);
        if (inferred && !periodMonth.value) { periodMonth.value = inferred; setDefaultCutoff(inferred); }
      }
    } catch (error) {
      delete state.sources[type];
      card.classList.add("error");
      fileName.textContent = `${file.name}：${error.message}`;
      mappingBox.hidden = true;
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

  analyzeButton.addEventListener("click", () => {
    analyzeButton.disabled = true;
    downloadButton.disabled = true;
    mainStatus.textContent = "正在逐筆分配A、B明細數量並核對跨月差異……";
    try {
      const reports = {};
      for (const type of ["a", "b"]) {
        const source = state.sources[type];
        reports[type] = core.extractSource(source.workbook, XLSX, type, { sheetName: source.sheetName, headerRowIndex: source.headerRowIndex, mapping: source.mapping, fileName: source.file.name });
      }
      state.analysis = core.analyzeMonthlyReports(reports.a, reports.b, { month: periodMonth.value, cutoff: cutoffDate.value, priorLedger: state.priorLedger });
      state.outputWorkbook = core.buildOutputWorkbook(state.analysis, XLSX);
      renderResults(state.analysis);
      const t = state.analysis.totals;
      mainStatus.textContent = `比對完成：成功配對${formatNumber(t.matchedCount)}項，其中跨月${formatNumber(t.crossMonthCount)}項；完全通過${formatNumber(t.passCount)}項，差異${formatNumber(t.differenceCount)}項，僅A表${formatNumber(t.aOnlyCount)}項，僅B表${formatNumber(t.bOnlyCount)}項。`;
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
  document.getElementById("prior-file").addEventListener("change", async (event) => {
    resetResults("上期結果已變更，請重新開始比對。");
    const file = event.currentTarget.files?.[0];
    state.priorLedger = [];
    if (!file) { priorFileName.textContent = "未選擇（首期可略過）"; updateAvailability(); return; }
    priorFileName.textContent = `正在讀取：${file.name}`;
    try {
      const data = await readFile(file);
      const workbook = XLSX.read(data, { type: "array", cellDates: true });
      state.priorLedger = core.ledgerRowsFromWorkbook(workbook, XLSX);
      priorFileName.textContent = `${file.name}・已讀取${formatNumber(state.priorLedger.length)}筆跨月認列`;
    } catch (error) {
      state.priorLedger = [];
      priorFileName.textContent = `${file.name}：${error.message}`;
    }
    updateAvailability();
  });
  periodMonth.addEventListener("change", () => { setDefaultCutoff(periodMonth.value); resetResults("對帳月份已變更，請重新開始比對。"); updateAvailability(); });
  cutoffDate.addEventListener("change", () => { resetResults("跨月截止日已變更，請重新開始比對。"); updateAvailability(); });
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => applyFilter(button.dataset.filter)));
  updateAvailability();
})();

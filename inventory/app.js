(function () {
  "use strict";

  const fileInput = document.getElementById("file-input");
  const chooseButton = document.getElementById("choose-file");
  const analyzeButton = document.getElementById("analyze-file");
  const downloadButton = document.getElementById("download-result");
  const exportRulesButton = document.getElementById("export-rules");
  const dropZone = document.getElementById("drop-zone");
  const fileName = document.getElementById("file-name");
  const fileDetails = document.getElementById("file-details");
  const statusBox = document.getElementById("status-box");
  const results = document.getElementById("results");
  const staleNotice = document.getElementById("stale-results-notice");
  const rulesState = document.getElementById("rules-state");
  const rulesSource = document.getElementById("rules-source");
  const rulesFeedback = document.getElementById("rules-feedback");

  const ruleLists = {
    "排除關鍵字": [document.getElementById("excluded-rule-list"), document.getElementById("excluded-rule-count")],
    "待人工確認關鍵字": [document.getElementById("review-rule-list"), document.getElementById("review-rule-count")],
    "指定品名白名單": [document.getElementById("whitelist-rule-list"), document.getElementById("whitelist-rule-count")]
  };

  let selectedFile = null;
  let analysis = null;
  let outputWorkbook = null;
  let activeRules = null;
  let rulesVersion = null;
  let rulesReady = false;

  function setStatus(message, kind) {
    statusBox.textContent = message;
    statusBox.className = `status-box ${kind || "info"}`;
    statusBox.hidden = false;
  }

  function resetResult() {
    analysis = null;
    outputWorkbook = null;
    results.hidden = true;
    staleNotice.hidden = true;
    downloadButton.disabled = true;
  }

  function renderRules(rules) {
    Object.entries(ruleLists).forEach(([key, parts]) => {
      const [list, count] = parts;
      const values = rules[key];
      list.replaceChildren();
      count.textContent = `${values.length} 項`;
      if (!values.length) {
        const empty = document.createElement("li");
        empty.className = "rule-empty";
        empty.textContent = key === "指定品名白名單" ? "目前沒有指定品名" : "目前沒有關鍵字";
        list.appendChild(empty);
      } else {
        values.forEach((value) => {
          const item = document.createElement("li");
          item.className = "rule-chip";
          item.textContent = value;
          list.appendChild(item);
        });
      }
    });
  }

  async function refreshRules(context) {
    rulesReady = false;
    analyzeButton.disabled = true;
    rulesState.textContent = "正在取得最新版";
    rulesState.className = "rules-state dirty";
    rulesFeedback.textContent = "正在向同源規則服務確認公司最新版本……";
    rulesFeedback.className = "rules-feedback working";
    try {
      const latest = await window.InventoryRulesClient.fetchLatest(window.fetch.bind(window), window.InventoryCore);
      const changed = rulesVersion !== null && latest.version !== rulesVersion;
      activeRules = latest.rules;
      rulesVersion = latest.version;
      rulesReady = true;
      renderRules(activeRules);
      rulesState.textContent = `集中規則 v${latest.version}`;
      rulesState.className = "rules-state applied";
      rulesSource.textContent = `目前使用：公司集中規則 v${latest.version}`;
      rulesFeedback.textContent = `更新時間：${window.InventoryRulesClient.formatUpdatedAt(latest.updatedAt)}。${context === "analysis" ? "已在分析前再次確認最新版。" : "每位同事開頁都會讀取這一版。"}`;
      rulesFeedback.className = "rules-feedback success";
      exportRulesButton.disabled = false;
      analyzeButton.disabled = !selectedFile;
      if (changed && analysis) {
        outputWorkbook = null;
        downloadButton.disabled = true;
        staleNotice.hidden = false;
      }
      return latest;
    } catch (error) {
      activeRules = null;
      exportRulesButton.disabled = true;
      rulesState.textContent = "規則服務無法使用";
      rulesState.className = "rules-state error";
      rulesFeedback.textContent = "為避免使用舊規則或各自不同的規則，目前禁止分析。請稍後重試或通知管理者。";
      rulesFeedback.className = "rules-feedback error";
      setStatus(`${error.message || error} 為避免分類錯誤，這次不會讀取 Excel。`, "error");
      throw error;
    }
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function acceptFile(file) {
    resetResult();
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".xlsx")) {
      selectedFile = null;
      analyzeButton.disabled = true;
      fileName.textContent = "尚未選擇 Excel";
      fileDetails.textContent = "只支援副檔名為 .xlsx 的檔案";
      setStatus("請選擇副檔名為 .xlsx 的 Excel 檔。", "error");
      return;
    }
    selectedFile = file;
    fileName.textContent = file.name;
    fileDetails.textContent = `${formatFileSize(file.size)}・檔案只會在這個瀏覽器分頁內讀取`;
    analyzeButton.disabled = !rulesReady;
    setStatus(rulesReady ? "檔案已選好。按「開始分析」即可；開始前會再取得公司最新規則。" : "檔案已選好，但需先連上集中規則服務才能分析。", rulesReady ? "success" : "working");
  }

  function setMetric(id, value) { document.getElementById(id).textContent = String(value); }

  function renderResults(result) {
    setMetric("metric-total", result.totalRows);
    setMetric("metric-normal", result.counts["正常商品"]);
    setMetric("metric-excluded", result.counts["排除項目"]);
    setMetric("metric-review", result.counts["待人工確認"]);
    setMetric("detected-sheet", result.sheetName);
    setMetric("detected-product", result.productNameColumn);
    setMetric("detected-quantity", result.quantityColumn || "未辨識");
    setMetric("detected-average", result.averageCostColumn || "未辨識");
    setMetric("detected-amount", result.amountColumn || "未辨識");
    setMetric("amount-status", result.amountStatus);
    const conservation = result.counts["正常商品"] + result.counts["排除項目"] + result.counts["待人工確認"];
    setMetric("conservation-check", conservation === result.totalRows ? "通過" : "未通過");
    results.hidden = false;
    staleNotice.hidden = true;
  }

  async function analyzeSelectedFile() {
    if (!selectedFile) return;
    analyzeButton.disabled = true;
    downloadButton.disabled = true;
    analyzeButton.textContent = "確認規則中……";
    setStatus("先向同源服務確認公司最新規則；尚未讀取 Excel。", "working");
    try {
      await refreshRules("analysis");
      analyzeButton.disabled = true;
      analyzeButton.textContent = "分析中……";
      setStatus(`已取得集中規則 v${rulesVersion}，正在本機讀取與分類；Excel 不會上傳……`, "working");
      await new Promise((resolve) => window.setTimeout(resolve, 30));
      const buffer = await selectedFile.arrayBuffer();
      analysis = window.InventoryCore.analyzeArrayBuffer(buffer, window.XLSX, activeRules, selectedFile.name);
      outputWorkbook = window.InventoryCore.buildOutputWorkbook(analysis, window.XLSX);
      renderResults(analysis);
      downloadButton.disabled = false;
      setStatus(`分析完成：使用集中規則 v${rulesVersion}，共 ${analysis.totalRows} 筆。現在可以下載新的 Excel。`, "success");
    } catch (error) {
      resetResult();
      if (rulesReady) setStatus(error.message || `處理失敗：${error}`, "error");
    } finally {
      analyzeButton.disabled = !selectedFile || !rulesReady;
      analyzeButton.textContent = "開始分析";
    }
  }

  function rulesFilename() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `公司庫存規則_v${rulesVersion}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
  }

  function exportRules() {
    if (!activeRules) return;
    const blob = new Blob([window.InventoryCore.serializeRules(activeRules)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = rulesFilename();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadResult() {
    if (!outputWorkbook || !selectedFile) return;
    try {
      const outputName = window.InventoryCore.safeOutputFilename(selectedFile.name);
      const outputBytes = window.InventoryCore.writeOutputWorkbook(outputWorkbook, window.XLSX);
      const blob = new Blob([outputBytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = outputName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus(`已觸發下載：${outputName}。原始檔沒有被修改。`, "success");
    } catch (error) { setStatus(error.message || `下載檔建立失敗：${error}`, "error"); }
  }

  exportRulesButton.addEventListener("click", exportRules);
  chooseButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => acceptFile(fileInput.files[0]));
  analyzeButton.addEventListener("click", analyzeSelectedFile);
  downloadButton.addEventListener("click", downloadResult);
  ["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); }));
  dropZone.addEventListener("drop", (event) => acceptFile(event.dataTransfer.files[0]));

  if (!window.XLSX || !window.InventoryCore || !window.InventoryRulesClient) {
    setStatus("找不到完整工具元件，已禁止分析。請通知管理者。", "error");
  } else {
    refreshRules("page").then(() => setStatus("已取得公司最新規則。請選擇要分析的 Excel。", "success")).catch(() => {});
  }
})();

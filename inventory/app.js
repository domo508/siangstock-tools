(function () {
  "use strict";

  const fileInput = document.getElementById("file-input");
  const chooseButton = document.getElementById("choose-file");
  const analyzeButton = document.getElementById("analyze-file");
  const downloadButton = document.getElementById("download-result");
  const dropZone = document.getElementById("drop-zone");
  const fileName = document.getElementById("file-name");
  const fileDetails = document.getElementById("file-details");
  const statusBox = document.getElementById("status-box");
  const results = document.getElementById("results");
  const staleNotice = document.getElementById("stale-results-notice");

  const updateRulesButton = document.getElementById("update-rules");
  const exportRulesButton = document.getElementById("export-rules");
  const importRulesButton = document.getElementById("import-rules");
  const rulesInput = document.getElementById("rules-input");
  const rulesState = document.getElementById("rules-state");
  const rulesFeedback = document.getElementById("rules-feedback");
  const rulesSource = document.getElementById("rules-source");

  const ruleEditors = {
    "排除關鍵字": {
      list: document.getElementById("excluded-rule-list"),
      input: document.getElementById("excluded-rule-input"),
      add: document.getElementById("add-excluded-rule"),
      count: document.getElementById("excluded-rule-count")
    },
    "待人工確認關鍵字": {
      list: document.getElementById("review-rule-list"),
      input: document.getElementById("review-rule-input"),
      add: document.getElementById("add-review-rule"),
      count: document.getElementById("review-rule-count")
    },
    "指定品名白名單": {
      list: document.getElementById("whitelist-rule-list"),
      input: document.getElementById("whitelist-rule-input"),
      add: document.getElementById("add-whitelist-rule"),
      count: document.getElementById("whitelist-rule-count")
    }
  };

  let selectedFile = null;
  let analysis = null;
  let outputWorkbook = null;
  let activeRules = null;
  let draftRules = null;
  let rulesDirty = false;

  function setStatus(message, kind) {
    statusBox.textContent = message;
    statusBox.className = `status-box ${kind || "info"}`;
    statusBox.hidden = false;
  }

  function setRulesFeedback(message, kind) {
    rulesFeedback.textContent = message;
    rulesFeedback.className = `rules-feedback ${kind || "info"}`;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function resetResult() {
    analysis = null;
    outputWorkbook = null;
    results.hidden = true;
    staleNotice.hidden = true;
    downloadButton.disabled = true;
  }

  function markRulesDirty(message) {
    rulesDirty = true;
    rulesState.textContent = "有尚未套用的修改";
    rulesState.className = "rules-state dirty";
    updateRulesButton.disabled = false;
    exportRulesButton.disabled = true;
    setRulesFeedback(message || "規則已修改。請按「更新規則」，才會套用到下一次分析。", "working");
  }

  function markRulesApplied(message) {
    rulesDirty = false;
    rulesState.textContent = "規則已套用";
    rulesState.className = "rules-state applied";
    updateRulesButton.disabled = true;
    exportRulesButton.disabled = false;
    setRulesFeedback(message || "目前畫面與分析使用的規則一致。", "success");
  }

  function renderRuleList(key) {
    const editor = ruleEditors[key];
    const values = draftRules[key];
    editor.list.replaceChildren();
    editor.count.textContent = `${values.length} 項`;
    if (!values.length) {
      const empty = document.createElement("li");
      empty.className = "rule-empty";
      empty.textContent = key === "指定品名白名單" ? "目前沒有指定品名" : "目前沒有關鍵字";
      editor.list.appendChild(empty);
      return;
    }
    values.forEach((value) => {
      const item = document.createElement("li");
      item.className = "rule-chip";
      const text = document.createElement("span");
      text.textContent = value;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "rule-remove";
      remove.textContent = "刪除";
      remove.setAttribute("aria-label", `刪除${key}「${value}」`);
      remove.addEventListener("click", () => {
        draftRules = window.InventoryCore.removeRuleItem(draftRules, key, value);
        renderRuleList(key);
        markRulesDirty(`已從「${key}」移除「${value}」。請按「更新規則」完成套用。`);
      });
      item.append(text, remove);
      editor.list.appendChild(item);
    });
  }

  function renderAllRules() {
    Object.keys(ruleEditors).forEach(renderRuleList);
  }

  function addRule(key) {
    const editor = ruleEditors[key];
    try {
      draftRules = window.InventoryCore.addRuleItem(draftRules, key, editor.input.value);
      const added = editor.input.value.normalize("NFKC").trim();
      editor.input.value = "";
      renderRuleList(key);
      markRulesDirty(`已把「${added}」加入「${key}」。請按「更新規則」完成套用。`);
      editor.input.focus();
    } catch (error) {
      setRulesFeedback(error.message || String(error), "error");
      editor.input.focus();
    }
  }

  function initializeRules() {
    activeRules = window.InventoryCore.cloneRules(window.INVENTORY_RULES);
    draftRules = window.InventoryCore.cloneRules(activeRules);
    renderAllRules();
    markRulesApplied("已載入隨工具附上的規則，可以直接分析或先調整。")
  }

  function updateRules() {
    activeRules = window.InventoryCore.cloneRules(draftRules);
    draftRules = window.InventoryCore.cloneRules(activeRules);
    rulesSource.textContent = "目前使用：頁面上已更新的規則";
    markRulesApplied("規則已更新。之後的分析會使用這份規則。")
    if (analysis) {
      outputWorkbook = null;
      downloadButton.disabled = true;
      staleNotice.hidden = false;
      setStatus("規則已更新，但畫面上的分類統計仍是舊結果。請重新按「開始分析」。", "working");
    } else {
      setStatus("規則已更新。選擇 Excel 後開始分析，就會使用新規則。", "success");
    }
  }

  function rulesFilename() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `庫存清理規則_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
  }

  function exportRules() {
    if (rulesDirty) {
      setRulesFeedback("請先按「更新規則」，再匯出已套用的規則。", "error");
      return;
    }
    const content = window.InventoryCore.serializeRules(activeRules);
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = rulesFilename();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setRulesFeedback("已觸發規則 JSON 下載。下次可用「載入規則 JSON」繼續使用。", "success");
  }

  async function importRulesFile(file) {
    if (!file) return;
    try {
      draftRules = window.InventoryCore.parseRulesJson(await file.text());
      renderAllRules();
      rulesSource.textContent = `已讀取：${file.name}（尚未套用）`;
      markRulesDirty("規則檔已載入到畫面。請確認內容，再按「更新規則」完成套用。")
    } catch (error) {
      rulesInput.value = "";
      setRulesFeedback(`規則檔無法使用：${error.message || error}`, "error");
    }
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
    analyzeButton.disabled = false;
    setStatus("檔案已選好。按「開始分析」即可。", "success");
  }

  function setMetric(id, value) {
    document.getElementById(id).textContent = String(value);
  }

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
    if (rulesDirty) {
      setStatus("規則有尚未套用的修改。請先按「更新規則」，再開始分析。", "error");
      document.getElementById("rules-manager").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (!window.XLSX || !window.InventoryCore || !activeRules) {
      setStatus("工具檔案不完整，請重新下載並保留整個 web 資料夾。", "error");
      return;
    }
    analyzeButton.disabled = true;
    downloadButton.disabled = true;
    analyzeButton.textContent = "分析中……";
    setStatus("正在本機讀取與分類，資料不會離開這台電腦……", "working");
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    try {
      const buffer = await selectedFile.arrayBuffer();
      analysis = window.InventoryCore.analyzeArrayBuffer(buffer, window.XLSX, activeRules, selectedFile.name);
      outputWorkbook = window.InventoryCore.buildOutputWorkbook(analysis, window.XLSX);
      renderResults(analysis);
      downloadButton.disabled = false;
      setStatus(`分析完成：共 ${analysis.totalRows} 筆，三分類加總一致。現在可以下載新的 Excel。`, "success");
    } catch (error) {
      resetResult();
      setStatus(error.message || `處理失敗：${error}`, "error");
    } finally {
      analyzeButton.disabled = false;
      analyzeButton.textContent = "開始分析";
    }
  }

  function downloadResult() {
    if (!outputWorkbook || !selectedFile) return;
    try {
      const outputName = window.InventoryCore.safeOutputFilename(selectedFile.name);
      const outputBytes = window.InventoryCore.writeOutputWorkbook(outputWorkbook, window.XLSX);
      const blob = new Blob([outputBytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = outputName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus(`已觸發下載：${outputName}。原始檔沒有被修改。`, "success");
    } catch (error) {
      setStatus(error.message || `下載檔建立失敗：${error}`, "error");
    }
  }

  Object.entries(ruleEditors).forEach(([key, editor]) => {
    editor.add.addEventListener("click", () => addRule(key));
    editor.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addRule(key);
      }
    });
  });
  updateRulesButton.addEventListener("click", updateRules);
  exportRulesButton.addEventListener("click", exportRules);
  importRulesButton.addEventListener("click", () => rulesInput.click());
  rulesInput.addEventListener("change", () => importRulesFile(rulesInput.files[0]));

  chooseButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => acceptFile(fileInput.files[0]));
  analyzeButton.addEventListener("click", analyzeSelectedFile);
  downloadButton.addEventListener("click", downloadResult);

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragging");
    });
  });
  dropZone.addEventListener("drop", (event) => acceptFile(event.dataTransfer.files[0]));

  if (!window.XLSX || !window.InventoryCore || !window.INVENTORY_RULES) {
    setStatus("找不到離線工具元件。請保留完整的 web 資料夾後再開啟。", "error");
  } else {
    try {
      initializeRules();
    } catch (error) {
      setStatus(`內建規則無法使用：${error.message || error}`, "error");
    }
  }
})();

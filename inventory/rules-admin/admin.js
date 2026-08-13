(function () {
  "use strict";
  const state = document.getElementById("rules-state");
  const feedback = document.getElementById("rules-feedback");
  const versionLabel = document.getElementById("admin-version");
  const updatedLabel = document.getElementById("admin-updated");
  const publishButton = document.getElementById("publish-rules");
  const exportButton = document.getElementById("export-rules");
  const reloadButton = document.getElementById("reload-rules");
  const restoreButton = document.getElementById("restore-defaults");
  const importButton = document.getElementById("import-rules");
  const rulesInput = document.getElementById("rules-input");
  const editors = {
    "排除關鍵字": { list: document.getElementById("excluded-rule-list"), input: document.getElementById("excluded-rule-input"), add: document.getElementById("add-excluded-rule"), count: document.getElementById("excluded-rule-count") },
    "待人工確認關鍵字": { list: document.getElementById("review-rule-list"), input: document.getElementById("review-rule-input"), add: document.getElementById("add-review-rule"), count: document.getElementById("review-rule-count") },
    "指定品名白名單": { list: document.getElementById("whitelist-rule-list"), input: document.getElementById("whitelist-rule-input"), add: document.getElementById("add-whitelist-rule"), count: document.getElementById("whitelist-rule-count") }
  };
  let currentVersion = null;
  let draftRules = null;
  let dirty = false;

  function setFeedback(message, kind) { feedback.textContent = message; feedback.className = `rules-feedback ${kind}`; }
  function setDirty(message) { dirty = true; state.textContent = "尚未發布"; state.className = "rules-state dirty"; publishButton.disabled = false; setFeedback(message, "working"); }
  function setClean(message) { dirty = false; state.textContent = "已是公司最新版"; state.className = "rules-state applied"; publishButton.disabled = true; exportButton.disabled = false; setFeedback(message, "success"); }

  function renderList(key) {
    const editor = editors[key];
    editor.list.replaceChildren();
    editor.count.textContent = `${draftRules[key].length} 項`;
    if (!draftRules[key].length) {
      const empty = document.createElement("li"); empty.className = "rule-empty"; empty.textContent = key === "指定品名白名單" ? "目前沒有指定品名" : "目前沒有關鍵字"; editor.list.appendChild(empty); return;
    }
    draftRules[key].forEach((value) => {
      const item = document.createElement("li"); item.className = "rule-chip";
      const text = document.createElement("span"); text.textContent = value;
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "rule-remove"; remove.textContent = "刪除"; remove.setAttribute("aria-label", `刪除${key}「${value}」`);
      remove.addEventListener("click", () => { draftRules = window.InventoryCore.removeRuleItem(draftRules, key, value); renderList(key); setDirty(`已移除「${value}」，尚未發布。`); });
      item.append(text, remove); editor.list.appendChild(item);
    });
  }
  function renderAll() { Object.keys(editors).forEach(renderList); }
  function addRule(key) {
    const editor = editors[key];
    try { const value = editor.input.value.normalize("NFKC").trim(); draftRules = window.InventoryCore.addRuleItem(draftRules, key, value); editor.input.value = ""; renderList(key); setDirty(`已新增「${value}」，尚未發布。`); editor.input.focus(); }
    catch (error) { setFeedback(error.message || String(error), "error"); }
  }

  async function loadLatest(force) {
    if (dirty && !force && !window.confirm("畫面有尚未發布的修改，確定要放棄並重新載入公司最新版嗎？")) return;
    state.textContent = "載入中"; state.className = "rules-state dirty"; publishButton.disabled = true;
    try {
      const latest = await window.InventoryRulesClient.fetchLatest(window.fetch.bind(window), window.InventoryCore);
      currentVersion = latest.version; draftRules = latest.rules; renderAll();
      versionLabel.textContent = `公司集中規則 v${latest.version}`;
      updatedLabel.textContent = `上次更新：${window.InventoryRulesClient.formatUpdatedAt(latest.updatedAt)}`;
      setClean("已取得公司最新版，可以開始編輯。");
    } catch (error) { state.textContent = "載入失敗"; state.className = "rules-state error"; exportButton.disabled = true; setFeedback(`${error.message || error} 目前不能編輯或發布。`, "error"); }
  }

  async function publish() {
    if (!dirty || !draftRules || !Number.isInteger(currentVersion)) return;
    publishButton.disabled = true; setFeedback("正在發布；不會傳送任何 Excel 或庫存資料……", "working");
    try {
      const response = await fetch("/api/rules/admin", { method: "PUT", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ expectedVersion: currentVersion, rules: draftRules }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `發布失敗（HTTP ${response.status}）`);
      currentVersion = data.version; draftRules = window.InventoryCore.cloneRules(data.rules);
      versionLabel.textContent = `公司集中規則 v${data.version}`; updatedLabel.textContent = `上次更新：${window.InventoryRulesClient.formatUpdatedAt(data.updatedAt)}`; renderAll(); setClean("發布成功。其他同事開頁或按分析時會取得這一版。");
    } catch (error) { publishButton.disabled = false; setFeedback(`${error.message || error}；畫面草稿仍保留。若是版本衝突，請先下載備份再重新載入。`, "error"); }
  }

  function exportRules() {
    if (!draftRules) return;
    const blob = new Blob([window.InventoryCore.serializeRules(draftRules)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `公司庫存規則_v${currentVersion || "草稿"}.json`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importRules(file) {
    if (!file) return;
    try { draftRules = window.InventoryCore.parseRulesJson(await file.text()); renderAll(); setDirty(`已載入「${file.name}」到畫面，確認後請按發布。`); }
    catch (error) { setFeedback(`JSON 無法使用：${error.message || error}`, "error"); }
    finally { rulesInput.value = ""; }
  }
  function restoreDefaults() {
    if (!window.confirm("確定要把畫面草稿換成工具預設規則嗎？這不會立刻發布，也不會刪除已下載的 JSON。")) return;
    draftRules = window.InventoryCore.cloneRules(window.INVENTORY_RULES); renderAll(); setDirty("已恢復預設草稿；確認後請按發布公司規則。");
  }

  Object.entries(editors).forEach(([key, editor]) => { editor.add.addEventListener("click", () => addRule(key)); editor.input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addRule(key); } }); });
  publishButton.addEventListener("click", publish); exportButton.addEventListener("click", exportRules); reloadButton.addEventListener("click", () => loadLatest(false)); restoreButton.addEventListener("click", restoreDefaults); importButton.addEventListener("click", () => rulesInput.click()); rulesInput.addEventListener("change", () => importRules(rulesInput.files[0]));
  if (!window.InventoryCore || !window.InventoryRulesClient || !window.INVENTORY_RULES) setFeedback("管理頁元件不完整，已禁止發布。", "error"); else loadLatest(true);
})();

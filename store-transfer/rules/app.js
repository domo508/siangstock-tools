(function () {
  "use strict";

  const APP_VERSION = "20261015-transfer-applicability-r2";
  const GOOGLE_READ_SCOPE = "openid email https://www.googleapis.com/auth/drive.readonly";
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const STORE_ORDER = ["R00", "R01", "R03", "R06", "R07", "R10"];
  const $ = (id) => document.getElementById(id);
  const state = { config: null, version: 0, exclusions: [], rules: [], dirty: false, googleTokenClient: null, googleAccessToken: "", masterBySku: null, keywordPreviewKey: "", runtimeOutdated: false, latestRuntimeVersion: "" };

  async function api(path, options = {}) {
    const response = await fetch(`/api/store-transfer${path}`, { cache: "no-store", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) }, ...options });
    const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }

  async function checkRuntimeVersion() {
    if (state.runtimeOutdated) return false;
    try {
      const response = await fetch(`version.json?check=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) return true;
      const manifest = await response.json();
      const latest = String(manifest?.version || "").trim();
      if (!latest || latest === APP_VERSION) return true;
      state.runtimeOutdated = true; state.latestRuntimeVersion = latest;
      $("version-warning").hidden = false; document.body.classList.add("runtime-outdated");
      $("page-status").textContent = "已有新版周調撥規則頁，本分頁已停止操作。";
      return false;
    } catch (_) { return true; }
  }

  function normalizedSku(value) { return String(value || "").normalize("NFKC").trim().toUpperCase(); }
  function keywords() { return $("rule-keywords").value.split(/[、,，|｜]/).map((value) => value.normalize("NFKC").trim()).filter(Boolean); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char])); }
  function markDirty() { state.dirty = true; $("save-rules").disabled = false; $("save-status").textContent = "有尚未儲存的周調撥規則變更。"; }
  function setFormStatus(message, error = false) { $("form-status").textContent = message; $("form-status").classList.toggle("error", error); }

  function fillSelect(select, values, selected) {
    select.replaceChildren(...values.map(([value, label]) => { const option = document.createElement("option"); option.value = value; option.textContent = label; return option; }));
    select.value = selected;
  }

  function setupDateSelectors() {
    const months = Array.from({ length: 12 }, (_, index) => [String(index + 1).padStart(2, "0"), `${index + 1}月`]);
    const days = Array.from({ length: 31 }, (_, index) => [String(index + 1).padStart(2, "0"), `${index + 1}日`]);
    fillSelect($("start-month"), months, "10"); fillSelect($("end-month"), months, "03");
    fillSelect($("start-day"), days, "01"); fillSelect($("end-day"), days, "31");
  }

  function setupStores() {
    const fieldset = $("selected-stores");
    const nodes = STORE_ORDER.map((code) => {
      const label = document.createElement("label"); const input = document.createElement("input"); input.type = "checkbox"; input.value = code; input.checked = true;
      label.append(input, document.createTextNode(`${code} ${state.config.stores[code].name}`)); return label;
    });
    fieldset.append(...nodes);
  }

  function selectedStores() { return [...$("selected-stores").querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value); }
  function isHardExclusionForm() { return $("match-type").value === "sku" && $("rule-action").value === "exclude" && $("store-scope").value === "all" && $("schedule-mode").value === "always"; }

  function syncForm() {
    const keywordMode = $("match-type").value === "keyword";
    $("sku-fields").hidden = keywordMode; $("keyword-fields").hidden = !keywordMode;
    $("selected-stores").hidden = $("store-scope").value !== "selected";
    const schedule = $("schedule-mode").value;
    $("date-range-fields").hidden = !["date_range", "campaign"].includes(schedule);
    $("annual-fields").hidden = schedule !== "annual";
    $("campaign-link-field").hidden = schedule !== "campaign";
    const hard = isHardExclusionForm();
    $("priority-level").disabled = hard;
    $("priority-help").textContent = hard ? "ERP品號硬性排除固定最高優先，不可調整。" : "同為品號或同為關鍵字時，層級較高者先套用。";
  }

  function resetForm() {
    $("rule-name").value = ""; $("match-type").value = "sku"; $("rule-sku").value = ""; $("rule-product-name").value = ""; $("rule-keywords").value = "";
    $("keyword-mode").value = "any"; $("rule-action").value = "exclude"; $("store-scope").value = "all"; $("schedule-mode").value = "always"; $("priority-level").value = "60";
    $("reason-type").value = "季節商品"; $("reason-note").value = ""; $("rule-enabled").value = "enabled"; $("start-date").value = ""; $("end-date").value = "";
    state.keywordPreviewKey = ""; $("preview-table-wrap").hidden = true; $("preview-rows").replaceChildren();
    $("match-preview").className = "match-preview"; $("match-preview").innerHTML = "<strong>尚未查找商品</strong><span>輸入ERP品號或品名關鍵字後，先確認命中內容。</span>";
    setFormStatus(""); syncForm();
  }

  function waitForGoogleIdentity() {
    if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => { const started = Date.now(); const timer = setInterval(() => { if (globalThis.google?.accounts?.oauth2) { clearInterval(timer); resolve(); } else if (Date.now() - started > 10000) { clearInterval(timer); reject(new Error("Google登入程式尚未載入，請重新整理後再試。")); } }, 100); });
  }

  async function authorizeProductMaster() {
    await waitForGoogleIdentity();
    if (!state.config.googleOAuthClientId) throw new Error("正式環境尚未設定Google OAuth用戶端。");
    if (!state.googleTokenClient) state.googleTokenClient = google.accounts.oauth2.initTokenClient({ client_id: state.config.googleOAuthClientId, scope: GOOGLE_READ_SCOPE, callback: () => {} });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Google授權逾時，請重試。")), 120000);
      state.googleTokenClient.callback = (response) => { clearTimeout(timer); if (response.error || !response.access_token) return reject(new Error(response.error_description || response.error || "Google授權失敗。")); state.googleAccessToken = response.access_token; resolve(response.access_token); };
      state.googleTokenClient.requestAccessToken({ prompt: state.googleAccessToken ? "" : "consent", hd: "siangapato.com.tw" });
    });
  }

  async function googleFetch(url) {
    if (!state.googleAccessToken) await authorizeProductMaster();
    let response = await fetch(url, { headers: { Authorization: `Bearer ${state.googleAccessToken}` } });
    if (response.status === 401) { state.googleAccessToken = ""; await authorizeProductMaster(); response = await fetch(url, { headers: { Authorization: `Bearer ${state.googleAccessToken}` } }); }
    if (!response.ok) { let message = `Google API ${response.status}`; try { message = (await response.json()).error?.message || message; } catch (_) { /* not json */ } throw new Error(message); }
    return response;
  }

  async function loadLatestProductMaster() {
    if (state.masterBySku) return state.masterBySku;
    await authorizeProductMaster();
    const identity = await (await googleFetch("https://openidconnect.googleapis.com/v1/userinfo")).json();
    if (String(identity.email || "").toLowerCase() !== String(state.config.email || "").toLowerCase()) { state.googleAccessToken = ""; throw new Error(`請使用目前工具帳號 ${state.config.email} 完成Google登入。`); }
    const folderId = String(state.config.fixedSources?.productMasterFolderId || "");
    const query = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`;
    const params = new URLSearchParams({ q: query, fields: "files(id,name,mimeType,modifiedTime,parents)", orderBy: "modifiedTime desc", pageSize: "100", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    const files = (await (await googleFetch(`https://www.googleapis.com/drive/v3/files?${params}`)).json()).files || [];
    const selected = files.filter((file) => file.mimeType === XLSX_MIME && file.parents?.[0] === folderId).sort((left, right) => String(right.modifiedTime).localeCompare(String(left.modifiedTime)))[0];
    if (!selected) throw new Error("商品主檔資料夾中找不到Excel檔案。");
    const buffer = await (await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(selected.id)}?alt=media&supportsAllDrives=true`)).arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true, dense: true, nodim: true });
    state.masterBySku = ProcurementPlanningCore.parseProductMasterWorkbook(workbook, XLSX, { fileName: selected.name }).bySku;
    return state.masterBySku;
  }

  async function lookupSku() {
    const sku = normalizedSku($("rule-sku").value); $("rule-sku").value = sku;
    if (!/^[A-Z0-9][A-Z0-9._/-]{0,79}$/.test(sku)) return setFormStatus("請輸入一個完整且有效的ERP品號。", true);
    $("lookup-sku").disabled = true; setFormStatus("正在讀取最新商品主檔…");
    try {
      const product = (await loadLatestProductMaster()).get(sku);
      if (!product) throw new Error(`最新商品主檔找不到品號 ${sku}。`);
      $("rule-product-name").value = product.name; if (!$("rule-name").value.trim()) $("rule-name").value = `${sku}周調撥規則`;
      $("match-preview").className = "match-preview is-ready"; $("match-preview").innerHTML = `<strong>已精準命中1個品號</strong><span>${escapeHtml(sku)}・${escapeHtml(product.name)}</span>`;
      setFormStatus("品名已帶入，請繼續設定規則。");
    } catch (error) { $("rule-product-name").value = ""; $("match-preview").className = "match-preview is-error"; $("match-preview").innerHTML = `<strong>查找失敗</strong><span>${escapeHtml(error.message)}</span>`; setFormStatus(error.message, true); }
    finally { $("lookup-sku").disabled = false; }
  }

  async function previewKeywords() {
    const values = keywords();
    if (!values.length) return setFormStatus("請至少輸入一個品名關鍵字。", true);
    $("preview-keywords").disabled = true; setFormStatus("正在讀取最新商品主檔並比對品名…");
    try {
      const master = await loadLatestProductMaster(); const all = $("keyword-mode").value === "all";
      const matches = [...master.values()].filter((product) => { const name = String(product.name || "").normalize("NFKC").toLowerCase(); return all ? values.every((value) => name.includes(value.toLowerCase())) : values.some((value) => name.includes(value.toLowerCase())); });
      state.keywordPreviewKey = `${values.join("|")}|${$("keyword-mode").value}`;
      $("preview-rows").innerHTML = matches.slice(0, 20).map((product) => `<tr><td><strong>${escapeHtml(product.sku)}</strong></td><td>${escapeHtml(product.name)}</td></tr>`).join("");
      $("preview-table-wrap").hidden = !matches.length;
      $("match-preview").className = `match-preview ${matches.length ? "is-ready" : "is-error"}`;
      $("match-preview").innerHTML = `<strong>目前命中 ${matches.length} 個ERP品號</strong><span>${matches.length > 20 ? "下方先顯示前20項；" : ""}正式套用時會依最新版商品主檔動態比對。</span>`;
      if (!$("rule-name").value.trim()) $("rule-name").value = `${values.join("／")}周調撥規則`;
      setFormStatus(matches.length ? "命中預覽已更新。" : "目前沒有命中商品，請調整關鍵字。", !matches.length);
    } catch (error) { setFormStatus(`無法預覽：${error.message}`, true); }
    finally { $("preview-keywords").disabled = false; }
  }

  function scheduleValues() {
    const mode = $("schedule-mode").value;
    const values = { scheduleMode: mode, startDate: "", endDate: "", startMonthDay: "", endMonthDay: "", campaignId: "", campaignName: "" };
    if (["date_range", "campaign"].includes(mode)) { values.startDate = $("start-date").value; values.endDate = $("end-date").value; if (!values.startDate || !values.endDate || values.startDate > values.endDate) throw new Error("請填寫正確的開始與結束日期。"); }
    if (mode === "annual") { values.startMonthDay = `${$("start-month").value}-${$("start-day").value}`; values.endMonthDay = `${$("end-month").value}-${$("end-day").value}`; }
    return values;
  }

  function addRule() {
    try {
      const name = $("rule-name").value.trim(); if (!name) throw new Error("請填寫規則名稱。");
      const matchType = $("match-type").value; const sku = normalizedSku($("rule-sku").value); const productName = $("rule-product-name").value.trim(); const keywordValues = keywords();
      if (matchType === "sku" && (!sku || !productName)) throw new Error("請先查找ERP品號並帶入品名。");
      if (matchType === "keyword" && state.keywordPreviewKey !== `${keywordValues.join("|")}|${$("keyword-mode").value}`) throw new Error("品名關鍵字或比對方式已變更，請重新查找並預覽。");
      const storeScope = $("store-scope").value; const stores = storeScope === "selected" ? selectedStores() : []; if (storeScope === "selected" && !stores.length) throw new Error("指定門市至少要選擇一間。");
      const reasonType = $("reason-type").value; const reasonNote = $("reason-note").value.trim(); if (reasonType === "其他" && !reasonNote) throw new Error("設定原因選擇其他時，請填寫補充說明。");
      const common = { id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, enabled: $("rule-enabled").value === "enabled", matchType, sku, productName, keywords: keywordValues, keywordMode: $("keyword-mode").value, action: $("rule-action").value, storeScope, stores, ...scheduleValues(), priority: Number($("priority-level").value), reasonType, reasonNote };
      if (isHardExclusionForm()) {
        if (state.exclusions.some((item) => normalizedSku(item.sku) === sku)) throw new Error(`${sku} 已在ERP品號硬性排除清單中。`);
        state.exclusions.unshift({ sku, productName, enabled: common.enabled });
      } else state.rules.unshift(common);
      markDirty(); renderRules(); resetForm(); setFormStatus("已加入待儲存清單；請在頁面下方填寫修改原因並儲存。", false);
    } catch (error) { setFormStatus(error.message, true); }
  }

  function scheduleLabel(rule) {
    if (rule.scheduleMode === "date_range") return `${rule.startDate}～${rule.endDate}`;
    if (rule.scheduleMode === "campaign") return `活動期間 ${rule.startDate}～${rule.endDate}`;
    if (rule.scheduleMode === "annual") return `每年${rule.startMonthDay}～${rule.endMonthDay}`;
    return "長期生效";
  }

  function renderRules() {
    const hardRows = state.exclusions.map((item, index) => ({ kind: "hard", index, enabled: item.enabled !== false, condition: `${item.sku}<span class="rule-kind">${escapeHtml(item.productName)}</span>`, action: "完全排除周調撥", stores: "全部門市", schedule: "長期生效", priority: "固定最高", reason: "ERP品號硬性排除" }));
    const normalRows = state.rules.map((item, index) => ({ kind: "rule", index, item, enabled: item.enabled !== false, condition: item.matchType === "sku" ? `${escapeHtml(item.sku)}<span class="rule-kind">${escapeHtml(item.productName)}</span>` : `${escapeHtml((item.keywords || []).join("、"))}<span class="rule-kind">品名關鍵字・${item.keywordMode === "all" ? "全部符合" : "任一符合"}</span>`, action: { exclude: "完全排除周調撥", include_period: "只在生效期間納入", allow: "允許周調撥" }[item.action] || item.action, stores: item.storeScope === "selected" ? (item.stores || []).join("、") : "全部門市", schedule: scheduleLabel(item), priority: item.matchType === "sku" ? `品號・${item.priority}` : `關鍵字・${item.priority}`, reason: `${item.reasonType}${item.reasonNote ? `：${item.reasonNote}` : ""}` }));
    const rows = [...hardRows, ...normalRows];
    $("rule-rows").innerHTML = rows.map((row) => {
      const previewButton = row.item?.matchType === "keyword" ? `<button class="table-action" type="button" data-preview-rule="${row.index}" aria-expanded="false">查看命中品號</button>` : "";
      const main = `<tr><td>${row.enabled ? "啟用" : "暫停"}</td><td><strong>${row.condition}</strong></td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.stores)}</td><td>${escapeHtml(row.schedule)}</td><td class="${row.kind === "hard" ? "hard-priority" : ""}">${escapeHtml(row.priority)}</td><td>${escapeHtml(row.reason)}</td><td><span class="table-actions">${previewButton}<button class="table-action" type="button" data-toggle-kind="${row.kind}" data-index="${row.index}">${row.enabled ? "暫停" : "啟用"}</button><button class="table-action danger" type="button" data-delete-kind="${row.kind}" data-index="${row.index}">刪除</button></span></td></tr>`;
      return row.item?.matchType === "keyword" ? `${main}<tr class="saved-keyword-preview" data-preview-row="${row.index}" hidden><td colspan="8"><div data-preview-content>尚未載入命中品號。</div></td></tr>` : main;
    }).join("");
    $("rule-empty").hidden = rows.length > 0; $("rule-count").textContent = `共${rows.length}筆；硬性排除${hardRows.length}筆`;
  }

  async function toggleSavedKeywordPreview(button) {
    const index = Number(button.dataset.previewRule); const rule = state.rules[index];
    const row = $("rule-rows").querySelector(`[data-preview-row="${index}"]`); if (!row || !rule) return;
    if (!row.hidden) { row.hidden = true; button.textContent = "查看命中品號"; button.setAttribute("aria-expanded", "false"); return; }
    row.hidden = false; button.textContent = "收合命中品號"; button.setAttribute("aria-expanded", "true");
    const content = row.querySelector("[data-preview-content]");
    if (content.dataset.loaded === "true") return;
    content.textContent = "正在讀取最新商品主檔並比對…";
    try {
      const values = (rule.keywords || []).map((value) => String(value).normalize("NFKC").toLowerCase()).filter(Boolean);
      const matches = [...(await loadLatestProductMaster()).values()].filter((product) => { const name = String(product.name || "").normalize("NFKC").toLowerCase(); return rule.keywordMode === "all" ? values.every((value) => name.includes(value)) : values.some((value) => name.includes(value)); }).sort((left, right) => String(left.sku).localeCompare(String(right.sku)));
      content.innerHTML = `<p><strong>最新版商品主檔目前命中 ${matches.length} 個ERP品號</strong>；正式產生批次時仍會依當時最新版主檔重新判斷。</p><div class="saved-keyword-preview-scroll"><table><thead><tr><th>ERP品號</th><th>品名</th></tr></thead><tbody>${matches.map((product) => `<tr><td><strong>${escapeHtml(product.sku)}</strong></td><td>${escapeHtml(product.name)}</td></tr>`).join("") || '<tr><td colspan="2">目前沒有命中品項。</td></tr>'}</tbody></table></div>`;
      content.dataset.loaded = "true";
    } catch (error) { content.textContent = `無法載入命中品號：${error.message}`; }
  }

  function ruleListAction(event) {
    const previewButton = event.target.closest("button[data-preview-rule]"); if (previewButton) { toggleSavedKeywordPreview(previewButton); return; }
    const button = event.target.closest("button[data-index]"); if (!button) return;
    const collection = button.dataset.toggleKind === "hard" || button.dataset.deleteKind === "hard" ? state.exclusions : state.rules; const index = Number(button.dataset.index);
    if (button.dataset.toggleKind) collection[index].enabled = collection[index].enabled === false;
    else collection.splice(index, 1);
    markDirty(); renderRules();
  }

  async function saveRules() {
    if (!(await checkRuntimeVersion())) return;
    const changeReason = $("change-reason").value.trim(); if (!changeReason) { $("save-status").textContent = "請填寫本次修改原因。"; $("change-reason").focus(); return; }
    $("save-rules").disabled = true; $("save-status").textContent = "正在儲存公司共用周調撥規則…";
    try {
      const payload = await api("/applicability-rules", { method: "PUT", body: JSON.stringify({ expectedVersion: state.version, changeReason, transferExclusions: state.exclusions, applicabilityRules: state.rules }) });
      state.version = payload.version; state.exclusions = payload.transferExclusions; state.rules = payload.applicabilityRules; state.dirty = false; $("change-reason").value = ""; renderRules();
      $("page-status").textContent = `公司共用規則v${payload.version}・更新者${payload.updatedBy}`; $("save-status").textContent = "周調撥規則已儲存；下次重新產生批次時生效。";
    } catch (error) { $("save-rules").disabled = false; $("save-status").textContent = `儲存失敗：${error.message}`; }
  }

  async function init() {
    try {
      if (!(await checkRuntimeVersion())) return;
      const [config, payload] = await Promise.all([api("/config"), api("/applicability-rules")]); state.config = config; state.version = payload.version; state.exclusions = payload.transferExclusions || []; state.rules = payload.applicabilityRules || [];
      if (config.role === "store") throw new Error("此頁只限總部周調撥帳號使用。");
      $("account-badge").textContent = `${config.email}・${config.role === "admin" ? "最高權限" : "總部"}`; setupStores(); setupDateSelectors(); resetForm(); renderRules();
      $("page-status").textContent = `公司共用規則v${payload.version}・更新${String(payload.updatedAt).replace("T", " ").slice(0, 19)}・${payload.updatedBy}`;
    } catch (error) { $("page-status").textContent = `無法載入：${error.message}`; $("page-status").classList.add("error"); }
  }

  ["match-type", "rule-action", "store-scope", "schedule-mode"].forEach((id) => $(id).addEventListener("change", syncForm));
  ["rule-keywords", "keyword-mode"].forEach((id) => $(id).addEventListener(id === "keyword-mode" ? "change" : "input", () => { state.keywordPreviewKey = ""; }));
  $("lookup-sku").addEventListener("click", lookupSku); $("preview-keywords").addEventListener("click", previewKeywords); $("reset-form").addEventListener("click", resetForm); $("add-rule").addEventListener("click", addRule); $("rule-rows").addEventListener("click", ruleListAction); $("save-rules").addEventListener("click", saveRules);
  $("reload-latest-button").addEventListener("click", () => { const url = new URL(location.href); url.searchParams.set("deploy", state.latestRuntimeVersion || Date.now()); location.replace(url.toString()); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkRuntimeVersion(); }); window.addEventListener("focus", checkRuntimeVersion); window.setInterval(checkRuntimeVersion, 5 * 60 * 1000);
  window.addEventListener("beforeunload", (event) => { if (!state.dirty) return; event.preventDefault(); event.returnValue = ""; });
  init();
})();

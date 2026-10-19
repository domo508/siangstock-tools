(function () {
  "use strict";
  const APP_VERSION = "20261020-store-transfer-r19";
  const state = { config: null, calculation: null, formalCalculation: null, activeBatch: null, activeCollaboration: null, collaborationDrafts: [], calculationStore: "all", batchStore: "all", calculationSku: "", batchSku: "", files: { master: null, marketing: null }, googleReady: false, runtimeOutdated: false, latestRuntimeVersion: "" };
  const $ = (id) => document.getElementById(id);
  const inputXlsx = globalThis.XLSX;
  const outputXlsx = globalThis.ProcurementXlsxWriter || inputXlsx;
  const parser = globalThis.ProcurementPlanningCore;
  const transferCore = globalThis.StoreTransferCore;
  const googleSources = globalThis.ProcurementGoogleSources;
  const xlsxPreflight = globalThis.StoreTransferXlsxPreflight;

  function showRuntimeWarning() {
    const warning = $("version-warning");
    if (warning instanceof HTMLDialogElement && typeof warning.showModal === "function") {
      if (!warning.open) warning.showModal();
      return;
    }
    warning.hidden = false;
  }

  async function checkRuntimeVersion() {
    if (state.runtimeOutdated) return false;
    try {
      const response = await fetch(`version.json?check=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) return true;
      const manifest = await response.json();
      const latestVersion = String(manifest?.version || "").trim();
      if (!latestVersion || latestVersion === APP_VERSION) return true;
      state.runtimeOutdated = true;
      state.latestRuntimeVersion = latestVersion;
      showRuntimeWarning();
      document.body.classList.add("runtime-outdated");
      $("hq-status").textContent = "已有新版工具，本分頁已停止操作；請按上方「重新載入最新版」。";
      return false;
    } catch (_) {
      return true;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  async function api(path, options = {}) {
    if ((options.method || "GET") !== "GET" && !(await checkRuntimeVersion())) throw new Error("已有新版工具，請先重新載入最新版。");
    const init = { method: options.method || "GET", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.googleAccessToken ? { "X-Google-Access-Token": options.googleAccessToken } : {}) }, cache: "no-store" };
    if (options.body) init.body = JSON.stringify(options.body);
    const response = await fetch(`/api/store-transfer${path}`, init);
    const contentType = response.headers.get("Content-Type") || "";
    const payload = /application\/json/i.test(contentType) ? await response.json().catch(() => ({})) : {};
    if (!response.ok) {
      const message = payload.error || (response.status === 401
        ? "登入已失效，請重新登入或切換至本店被指派的公司帳號。"
        : `處理失敗（HTTP ${response.status}）`);
      throw new Error(message);
    }
    if (!/application\/json/i.test(contentType)) throw new Error("登入已失效，請重新登入或切換至本店被指派的公司帳號。");
    return payload;
  }

  function accountRecovery(error) {
    const detail = String(error?.message || error || "無法確認公司帳號。");
    return `<div class="auth-recovery" role="alert"><strong>無法完成公司帳號驗證</strong><p>${escapeHtml(detail)}</p><p>按下方按鈕會先清除目前公司工具登入狀態；完成後請重新開啟週調撥，並選擇本店被指派的公司 Google 帳號。</p><a class="primary-button" href="/cdn-cgi/access/logout">重新登入／切換帳號</a></div>`;
  }

  function updateReady() {
    const ready = Boolean(state.files.master && state.files.marketing && $("inventory-file").files.length && $("sales-files").files.length && $("transfer-file").files.length);
    $("calculate-button").disabled = !ready;
    $("hq-status").textContent = ready ? "資料已備妥，可以開始本機檢核與計算。" : "請先備妥兩項固定來源及三類本次資料。";
  }

  function updateFile(event) {
    const input = event.currentTarget;
    const label = document.querySelector(`[data-for="${input.id}"]`);
    if (label) label.textContent = input.files.length ? (input.files.length === 1 ? input.files[0].name : `已選擇 ${input.files.length} 份檔案`) : "尚未選擇";
    if (input.id === "master-file") state.files.master = input.files[0] || null;
    if (input.id === "marketing-file") state.files.marketing = input.files[0] || null;
    updateReady();
  }

  function memoryFriendlyReadError(file, error) {
    const message = String(error?.message || error || "");
    if (/array buffer|allocation|out of memory|invalid array length/i.test(message)) {
      return new Error(`讀取「${file.name}」時瀏覽器記憶體不足。工具已改採逐份輕量讀取；請先關閉其他大型試算表分頁、重新整理後再試一次。若仍失敗，請把近12週銷售拆成2～3份，內容不必刪欄。`);
    }
    return error instanceof Error ? error : new Error(message || `無法讀取「${file.name}」。`);
  }

  async function workbook(file) {
    try {
      const data = await file.arrayBuffer();
      return inputXlsx.read(data, {
        type: "array",
        cellDates: true,
        cellStyles: false,
        dense: true,
        nodim: true
      });
    } catch (error) {
      throw memoryFriendlyReadError(file, error);
    }
  }

  function yieldToBrowser() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  function selectedStores() { return [...document.querySelectorAll('#store-options input:checked')].map((input) => input.value); }
  function calculationMode() { return document.querySelector('input[name="calculation-mode"]:checked')?.value === "comparison" ? "comparison" : "formal"; }
  function renderStores() { $("store-options").innerHTML = Object.entries(state.config.stores).map(([code, store]) => `<label><input type="checkbox" value="${code}" checked><span>${code} ${escapeHtml(store.name)}<small>${escapeHtml(store.company)}・${escapeHtml(store.relationship)}</small></span></label>`).join(""); }

  function displayExceptionDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function renderDisplayExceptions() {
    const query = $("display-exception-search").value.trim().toLocaleUpperCase("en-US");
    const filter = $("display-exception-status-filter").value;
    const all = state.config.displayExceptions || [];
    const rows = all.filter((item) => (!query || String(item.sku).toLocaleUpperCase("en-US").includes(query))
      && (filter === "all" || (filter === "enabled" ? item.enabled : !item.enabled)));
    $("display-exception-rows").innerHTML = rows.map((item) => `<tr><td><strong>${escapeHtml(item.sku)}</strong></td><td>${item.displayQuantity}件</td><td>取代總部通用量為 <strong>${item.displayQuantity}件</strong></td><td>${escapeHtml(item.reason)}</td><td><span class="display-exception-status${item.enabled ? "" : " disabled"}">${item.enabled ? "啟用" : "已停用"}</span></td><td>${escapeHtml(displayExceptionDate(item.updatedAt))}<br><small>${escapeHtml(item.updatedBy)}</small></td><td><div class="exception-actions"><button class="secondary-button compact" type="button" data-edit-display-exception="${escapeHtml(item.sku)}">編輯</button><button class="secondary-button compact" type="button" data-toggle-display-exception="${escapeHtml(item.sku)}">${item.enabled ? "停用" : "重新啟用"}</button></div></td></tr>`).join("");
    $("display-exception-empty").hidden = rows.length > 0;
    const enabled = all.filter((item) => item.enabled).length;
    $("display-exception-summary").textContent = `已啟用 ${enabled} 項・共 ${all.length} 項紀錄`;
  }

  async function loadDisplayExceptions() {
    const result = await api("/display-exceptions");
    state.config.displayExceptions = result.exceptions || [];
    renderDisplayExceptions();
  }

  async function showDisplayExceptions() {
    if (state.config?.role !== "store") return;
    document.querySelectorAll("[data-weekly-view]").forEach((element) => { element.hidden = true; });
    $("display-exceptions-panel").hidden = false;
    const store = state.config.stores[state.config.storeCode];
    $("display-exceptions-title").textContent = `管理${store.name}的展示例外`;
    history.replaceState(null, "", `${location.pathname}${location.search}#display-exceptions`);
    await loadDisplayExceptions();
    $("display-exceptions-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function hideDisplayExceptions() {
    $("display-exceptions-panel").hidden = true;
    document.querySelectorAll("[data-weekly-view]").forEach((element) => {
      if (element.id === "hq-panel") element.hidden = state.config.role === "store";
      else if (element.id === "store-panel") element.hidden = state.config.role !== "store";
      else element.hidden = false;
    });
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }

  function openDisplayExceptionDialog(item = null) {
    const dialog = $("display-exception-dialog");
    $("display-exception-dialog-title").textContent = item ? "編輯品號例外" : "新增品號例外";
    $("display-exception-sku").value = item?.sku || "";
    $("display-exception-sku").disabled = Boolean(item);
    $("display-exception-quantity").value = String(item?.displayQuantity ?? 1);
    $("display-exception-reason").value = item?.reason || "";
    $("display-exception-enabled").checked = item?.enabled !== false;
    $("display-exception-revision").value = String(item?.revision || 0);
    $("display-exception-dialog-status").textContent = "";
    dialog.showModal();
  }

  async function saveDisplayException(event) {
    event.preventDefault();
    const sku = $("display-exception-sku").value.trim().toLocaleUpperCase("en-US");
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true; $("display-exception-dialog-status").textContent = "正在儲存…";
    try {
      await api(`/display-exceptions/${encodeURIComponent(state.config.storeCode)}/${encodeURIComponent(sku)}`, { method: "PUT", body: {
        displayQuantity: Number($("display-exception-quantity").value), reason: $("display-exception-reason").value.trim(),
        enabled: $("display-exception-enabled").checked, expectedRevision: Number($("display-exception-revision").value || 0)
      } });
      $("display-exception-dialog").close();
      await loadDisplayExceptions();
      $("display-exception-page-status").textContent = `${sku} 已儲存；將從下一次總部重新計算開始生效。`;
    } catch (error) { $("display-exception-dialog-status").textContent = error.message; }
    finally { button.disabled = false; }
  }

  async function toggleDisplayException(sku) {
    const item = (state.config.displayExceptions || []).find((row) => row.sku === sku);
    if (!item) return;
    await api(`/display-exceptions/${encodeURIComponent(state.config.storeCode)}/${encodeURIComponent(item.sku)}`, { method: "PUT", body: {
      displayQuantity: item.displayQuantity, reason: item.reason, enabled: !item.enabled, expectedRevision: item.revision
    } });
    await loadDisplayExceptions();
    $("display-exception-page-status").textContent = `${sku} 已${item.enabled ? "停用" : "重新啟用"}；下一次總部重新計算時套用。`;
  }

  function renderComparisonDownloads(stores, mode) {
    const panel = $("comparison-downloads");
    panel.hidden = mode !== "comparison";
    $("comparison-download-buttons").innerHTML = mode === "comparison" ? stores.map((code) => `<button class="secondary-button compact" type="button" data-download-comparison="${escapeHtml(code)}">下載 ${escapeHtml(state.config.stores[code]?.name || code)}差異表</button>`).join("") : "";
  }

  function downloadComparison(storeCode) {
    if (!state.calculation || state.calculation.calculationMode !== "comparison") throw new Error("請先以A/B測試比對模式產生建議。");
    const storeName = state.config.stores[storeCode]?.name || storeCode;
    const workbook = transferCore.buildComparisonWorkbook(state.calculation, outputXlsx, storeCode, storeName);
    const safeName = String(storeName).replace(/[\\/:*?"<>|]/g, "-");
    outputXlsx.writeFile(workbook, `${state.calculation.proposalDate}_${safeName}_調撥建議差異分析.xlsx`, { compression: true });
    $("hq-status").textContent = `${storeName}的A/B調撥建議差異分析表已下載；未建立正式批次。`;
  }

  function renderFormalDownloads(stores, mode) {
    const panel = $("formal-downloads");
    panel.hidden = mode !== "formal";
    $("formal-download-options").innerHTML = mode === "formal" ? stores.map((code) => `<label><input type="checkbox" value="${escapeHtml(code)}" checked><span>${escapeHtml(state.config.stores[code]?.name || code)}</span></label>`).join("") : "";
  }

  function downloadFormalReports() {
    if (!state.calculation || state.calculation.calculationMode !== "formal") throw new Error("請先以正式補貨模式產生建議。");
    const stores = [...document.querySelectorAll('#formal-download-options input:checked')].map((input) => input.value);
    if (!stores.length) throw new Error("請至少勾選一間要下載的門市。");
    for (const storeCode of stores) {
      const storeName = state.config.stores[storeCode]?.name || storeCode;
      const workbook = transferCore.buildFormalWorkbook(state.calculation, outputXlsx, storeCode, storeName);
      const safeName = String(storeName).replace(/[\\/:*?"<>|]/g, "-");
      outputXlsx.writeFile(workbook, `${state.calculation.proposalDate}_${safeName}_正式補貨建議.xlsx`, { compression: true });
    }
    $("hq-status").textContent = `已下載 ${stores.length} 間門市的正式補貨報表；每間門市各一份。`;
  }

  function compactBatchItems(rows) {
    return rows.map((row) => ({
      storeCode: row.storeCode, sku: row.sku, productName: row.productName,
      suggestedQuantity: row.suggestedQuantity, ruleSummary: row.ruleSummary, itemType: row.itemType,
      calculationDate: row.calculationDate, baseSellableQuantity: row.baseSellableQuantity,
      displayGap: row.displayGap, dailySales: row.dailySales, systemSellThroughDate: row.systemSellThroughDate,
      systemDecisionReason: row.systemDecisionReason,
      decisionSnapshot: {
        localSales42: row.localSales42, b3Sales42: row.b3Sales42,
        physicalInventory: row.physicalInventory, pendingSubmittedQuantity: row.pendingSubmittedQuantity,
        inTransitQuantity: row.inTransitQuantity, currentQuantity: row.currentInventory,
        targetQuantity: row.targetQuantity,
        displayQuantity: row.displayQuantity, currentArrivalDate: row.currentArrivalDate,
        nextArrivalDate: row.nextArrivalDate, preArrivalStockoutRisk: Boolean(row.preArrivalStockoutRisk),
        hqAvailable: row.hqAvailable, hqReserve: row.hqReserve, hqReleasable: row.hqReleasable,
        hqSupplyCeiling: row.hqSupplyCeiling ?? row.hqReleasable ?? row.hqAvailable
      }
    }));
  }

  function compactBatchShortages(rows) {
    return rows.map((row) => ({
      storeCode: row.storeCode, sku: row.sku, productName: row.productName, itemType: row.itemType,
      demandQuantity: row.demandQuantity, allocatedQuantity: row.allocatedQuantity, unfilledQuantity: row.unfilledQuantity,
      reason: row.reason, followUpStatus: row.followUpStatus,
      currentArrivalDate: row.currentArrivalDate, nextArrivalDate: row.nextArrivalDate
    }));
  }

  function compactManualItemFacts(rows) {
    return (rows || []).map((row) => ({
      storeCode: row.storeCode, sku: row.sku, productName: row.productName,
      calculationDate: row.calculationDate, baseQuantity: row.baseQuantity,
      displayGap: row.displayGap, dailyUsage: row.dailyUsage, systemProjection: row.systemProjection,
      physicalInventory: row.physicalInventory, pendingSubmittedQuantity: row.pendingSubmittedQuantity,
      inTransitQuantity: row.inTransitQuantity, currentQuantity: row.currentQuantity,
      localSales42: row.localSales42, b3Sales42: row.b3Sales42,
      targetQuantity: row.targetQuantity, displayQuantity: row.displayQuantity,
      currentArrivalDate: row.currentArrivalDate, nextArrivalDate: row.nextArrivalDate,
      preArrivalStockoutRisk: Boolean(row.preArrivalStockoutRisk),
      systemReason: row.systemReason, hqAvailable: row.hqAvailable,
      hqReserve: row.hqReserve, hqReleasable: row.hqReleasable,
      autoExcluded: Boolean(row.autoExcluded), exclusionReason: row.exclusionReason || ""
    }));
  }

  function compactManualItemCatalog(rows) {
    const bySku = new Map();
    (rows || []).forEach((row) => { if (!bySku.has(row.sku)) bySku.set(row.sku, { sku: row.sku, productName: row.productName, hqAvailable: row.hqAvailable, hqReserve: row.hqReserve, hqReleasable: row.hqReleasable, autoExclusions: row.autoExclusions || {} }); });
    return [...bySku.values()];
  }

  async function sha256(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function collaborationCard(draft) {
    const finalized = draft.status === "finalized";
    const status = finalized ? `已轉正式${draft.finalizedBatchId ? `・${draft.finalizedBatchId}` : ""}` : "協作中";
    const deleteButton = !finalized && state.config.permissions?.canDeleteCollaboration
      ? `<button class="secondary-button compact delete-batch-button" type="button" data-delete-collaboration="${escapeHtml(draft.id)}" data-week-key="${escapeHtml(draft.weekKey)}" data-item-count="${escapeHtml(draft.itemCount)}">刪除協作批次</button>` : "";
    return `<article class="batch-card collaboration-card${finalized ? " superseded" : ""}"><div><h3>${escapeHtml(draft.weekKey)} A/B協作</h3><p class="batch-meta">${escapeHtml(draft.storeCodes.join("、"))}・${draft.itemCount}項・${draft.differenceCount}項有差異・版本${draft.revision}・${escapeHtml(draft.updatedBy)}更新</p></div><span class="batch-status">${escapeHtml(status)}</span><div class="batch-card-actions"><button class="secondary-button compact" type="button" data-open-collaboration="${escapeHtml(draft.id)}">查看${finalized ? "紀錄" : "／協作"}</button>${deleteButton}</div></article>`;
  }

  async function deleteCollaborationDraft(button) {
    const id = button.dataset.deleteCollaboration;
    const week = button.dataset.weekKey || id;
    const itemCount = button.dataset.itemCount || 0;
    if (!confirm(`確定要刪除 ${week} 的A/B協作批次嗎？\n\n協作編號：${id}\n品項數：${itemCount}\n\n刪除後前台不再顯示，但稽核資料會保留12個月；已轉正式的批次不能刪除。`)) return;
    button.disabled = true;
    try {
      await api(`/collaboration-drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (state.activeCollaboration?.draft?.id === id) { $("collaboration-dialog").close(); state.activeCollaboration = null; }
      $("collaboration-status").textContent = `已刪除${week}的A/B協作批次；稽核資料仍保留12個月。`;
      await loadCollaborationDrafts();
    } finally { button.disabled = false; }
  }

  async function loadCollaborationDrafts() {
    if (!state.config?.permissions?.canCollaborate) return;
    const result = await api("/collaboration-drafts");
    state.collaborationDrafts = result.drafts || [];
    $("collaboration-list").innerHTML = state.collaborationDrafts.length ? state.collaborationDrafts.map(collaborationCard).join("") : '<p class="empty-state">目前沒有A/B協作批次。</p>';
    $("collaboration-status").textContent = state.config.permissions.canFinalizeCollaboration
      ? "可共同編輯；此帳號也可將定稿轉成正式批次。"
      : "可共同查看與編輯；定稿後由 siang01 或 service1 轉成正式批次。";
  }

  function buildCollaborationPayload(stores) {
    if (state.calculation?.calculationMode !== "comparison" || !state.formalCalculation) throw new Error("請先以A/B測試比對模式產生建議。");
    const formalByKey = new Map(state.formalCalculation.rows.map((row) => [`${row.storeCode}|${row.sku}`, row]));
    const comparisonReports = stores.map((storeCode) => {
      const report = transferCore.buildComparisonReport(state.calculation, storeCode, state.config.stores[storeCode]?.name || storeCode);
      return { ...report, rows: report.rows.map((row) => {
        const formal = formalByKey.get(`${storeCode}|${row.sku}`);
        const formalSuggestedQuantity = Number(formal?.suggestedQuantity || 0);
        const typeByLabel = { "一般必要補貨": "regular", "建議備貨": "special_stock", "活動／贈品": "activity_gift", "門市耗材": "consumable" };
        return { ...row, itemType: formal?.itemType || typeByLabel[row.itemType] || "regular", formalSuggestedQuantity, decision: "accept_formal", agreedQuantity: formalSuggestedQuantity, note: "" };
      }) };
    });
    const lockAt = new Date($("lock-at").value).toISOString();
    return {
      version: 1, weekKey: $("week-key").value, proposalDate: $("proposal-date").value, responseDueAt: lockAt, lockAt,
      comparisonReports,
      formal: { rows: state.formalCalculation.rows, shortages: state.formalCalculation.shortageRows, manualItemFacts: state.formalCalculation.manualItemFacts, manualItemCatalog: compactManualItemCatalog(state.formalCalculation.manualItemCatalog), scheduleByStore: state.formalCalculation.scheduleByStore }
    };
  }

  async function saveCollaborationPayload(id, payload, expectedRevision) {
    const payloadText = JSON.stringify(payload);
    const result = await api(`/collaboration-drafts/${encodeURIComponent(id)}`, { method: "PUT", body: {
      weekKey: payload.weekKey, proposalDate: payload.proposalDate, expectedRevision, payload: payloadText, payloadSha256: await sha256(payloadText)
    } });
    return result.draft;
  }

  async function publishCollaboration() {
    const stores = selectedStores();
    const payload = buildCollaborationPayload(stores);
    const existing = state.collaborationDrafts.find((draft) => draft.weekKey === payload.weekKey && draft.status === "draft");
    if (existing && !confirm(`${payload.weekKey}已有進行中的A/B協作批次。\n\n要用這次重新計算的結果更新它嗎？`)) return;
    const id = existing?.id || `STC-${payload.weekKey}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const button = $("publish-collaboration-button"); button.disabled = true;
    try {
      const draft = await saveCollaborationPayload(id, payload, existing?.revision || 0);
      state.activeCollaboration = { draft, payload };
      await loadCollaborationDrafts();
      $("hq-status").textContent = `已${existing ? "更新" : "發布"}${payload.weekKey} A/B協作批次；四位總部協作者現在可共同檢視與調整。`;
    } finally { button.disabled = false; }
  }

  async function authorizeGoogle() {
    $("google-connect-button").disabled = true;
    $("source-status").textContent = "正在開啟公司 Google 授權…";
    try {
      googleSources.initialize(state.config.googleOAuthClientId);
      await googleSources.authorize();
      const identity = await googleSources.verifyCompanyIdentity();
      state.googleReady = true;
      $("auto-source-button").disabled = false;
      $("google-connect-button").textContent = "Google 已授權";
      $("source-status").textContent = `${identity.email} 已授權；請按「自動取得兩項資料」。`;
    } finally { $("google-connect-button").disabled = false; }
  }

  async function loadGoogleSources() {
    if (!state.googleReady) throw new Error("請先完成公司 Google 授權。");
    const button = $("auto-source-button");
    button.disabled = true; button.classList.add("is-loading");
    $("auto-source-label").textContent = "正在唯讀取得…";
    $("source-status").textContent = "正在取得最新商品主檔與整體行銷策略，來源檔不會被修改。";
    try {
      const fixed = state.config.fixedSources;
      const [master, marketing] = await Promise.all([
        googleSources.loadLatestMaster(fixed.productMasterFolderId),
        googleSources.downloadDriveFile(fixed.marketingDriveFileId, "整體行銷策略.xlsx")
      ]);
      state.files.master = master.file;
      state.files.marketing = marketing;
      document.querySelector('[data-for="master-file"]').textContent = `已自動取得：${master.file.name}`;
      document.querySelector('[data-for="marketing-file"]').textContent = "已自動取得：整體行銷策略.xlsx";
      $("source-status").textContent = `兩項固定來源已更新；商品主檔版本：${master.metadata.modifiedTime || master.file.name}。`;
      updateReady();
    } finally {
      button.classList.remove("is-loading"); button.disabled = !state.googleReady;
      $("auto-source-label").textContent = "重新取得兩項資料";
    }
  }

  function batchStatusLabel(status) {
    return { open: "目前作業・等待門市", review: "目前作業・總部覆核中", approved: "已核准", erp_created: "已產生ERP", closed: "已完成", cancelled: "已取代・僅供查閱" }[status] || status;
  }

  function storeFilterBar(scope, storeCodes, selected = "all") {
    if (state.config.role === "store") return "";
    const button = (code, label) => `<button class="store-filter-button${selected === code ? " is-active" : ""}" type="button" data-store-filter="${escapeHtml(code)}" data-store-filter-scope="${scope}" aria-pressed="${selected === code}">${escapeHtml(label)}</button>`;
    return `<nav class="store-filter-bar" aria-label="依門市查看"><span>依門市查看</span><div>${button("all", "全部門市")}${storeCodes.map((code) => button(code, `${code} ${state.config.stores[code]?.name || ""}`)).join("")}</div></nav>`;
  }

  function skuFilterBar(scope, query = "") {
    if (state.config.role === "store") return "";
    return `<section class="sku-search-toolbar" aria-label="依ERP品號搜尋"><label><span>搜尋ERP品號</span><input type="search" value="${escapeHtml(query)}" placeholder="輸入完整或部分品號，例如 A101110" autocomplete="off" data-sku-filter-scope="${scope}"></label><button class="secondary-button compact" type="button" data-clear-sku-filter="${scope}">清除</button><p class="status-line" data-sku-filter-summary>輸入品號後，會彙總分配門市、筆數與件數。</p></section>`;
  }

  function allocationQuantity(row, scope) {
    if (scope === "batch") {
      const approved = row.querySelector("[data-approved]");
      if (approved) return Math.max(0, Number(approved.value || 0));
      const confirmed = row.querySelector("[data-confirmed]");
      if (confirmed) return Math.max(0, Number(confirmed.value || 0));
    }
    return Math.max(0, Number(row.dataset.allocationQuantity || 0));
  }

  function refreshSkuFilterSummary(scope) {
    const root = scope === "calculation" ? $("calculation-results") : $("batch-detail");
    const query = scope === "calculation" ? state.calculationSku : state.batchSku;
    const summary = root?.querySelector("[data-sku-filter-summary]");
    if (!summary) return;
    if (!query) { summary.textContent = "輸入品號後，會彙總分配門市、筆數與件數。"; return; }
    const rows = [...root.querySelectorAll("[data-allocation-row]")].filter((row) => !row.hidden && allocationQuantity(row, scope) > 0);
    const skus = new Set(rows.map((row) => row.dataset.sku).filter(Boolean));
    const stores = new Set(rows.map((row) => row.dataset.store).filter(Boolean));
    const quantity = rows.reduce((sum, row) => sum + allocationQuantity(row, scope), 0);
    summary.textContent = rows.length
      ? `命中${skus.size}個品號・分配${stores.size}間門市・${rows.length}筆・合計${quantity}件`
      : `找不到符合「${query}」且分配量大於0的品項。`;
  }

  function applyResultFilters(scope) {
    const root = scope === "calculation" ? $("calculation-results") : $("batch-detail");
    if (!root) return;
    const storeCode = scope === "calculation" ? state.calculationStore : state.batchStore;
    const skuQuery = (scope === "calculation" ? state.calculationSku : state.batchSku).trim().toLocaleUpperCase("en-US");
    root.querySelectorAll("[data-store-row]").forEach((row) => {
      const storeMatches = storeCode === "all" || row.dataset.store === storeCode;
      const skuMatches = !skuQuery || String(row.dataset.sku || "").toLocaleUpperCase("en-US").includes(skuQuery);
      row.hidden = !(storeMatches && skuMatches);
    });
    root.querySelectorAll("[data-decision-detail]").forEach((detail) => {
      detail.hidden = !detail.classList.contains("is-open") || Boolean(detail.previousElementSibling?.hidden);
    });
    root.querySelectorAll("[data-store-section]").forEach((section) => {
      const rows = [...section.querySelectorAll("[data-store-row]")];
      section.hidden = rows.length > 0 && !rows.some((row) => !row.hidden);
    });
    refreshSkuFilterSummary(scope);
  }

  function applyStoreFilter(scope, storeCode) {
    const root = scope === "calculation" ? $("calculation-results") : $("batch-detail");
    if (!root) return;
    if (scope === "calculation") state.calculationStore = storeCode;
    else state.batchStore = storeCode;
    root.querySelectorAll(`[data-store-filter-scope="${scope}"]`).forEach((button) => {
      const active = button.dataset.storeFilter === storeCode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    applyResultFilters(scope);
    if (scope === "batch") {
      root.querySelectorAll("[data-store-status]").forEach((card) => card.classList.toggle("is-selected", storeCode !== "all" && card.dataset.storeStatus === storeCode));
      const manualStore = root.querySelector("[data-manual-store]");
      if (manualStore && storeCode !== "all") manualStore.value = storeCode;
    }
  }

  function applySkuFilter(scope, query) {
    if (scope === "calculation") state.calculationSku = query;
    else state.batchSku = query;
    applyResultFilters(scope);
  }

  function toggleDecisionDetail(button) {
    const detail = document.getElementById(button.dataset.detailTarget || "");
    if (!detail) return false;
    const open = !detail.classList.contains("is-open");
    detail.classList.toggle("is-open", open);
    detail.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    const label = open ? "收合判斷依據" : "展開判斷依據";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.textContent = open ? "−" : "+";
    return true;
  }

  function batchCard(batch) {
    const status = batchStatusLabel(batch.status);
    const ownStatus = { pending: "尚未處理", saved: "已暫存", submitted: "已送出", approved: "已核准", closed: "已完成" }[batch.store_status] || batch.store_status;
    const progress = batch.status === "cancelled" ? "新版批次已建立，本批不再接受修改或送出" : batch.store_total == null ? (ownStatus ? `本店：${ownStatus}` : "") : `門市已送出 ${Number(batch.store_submitted || 0) + Number(batch.store_approved || 0)}/${batch.store_total}・ERP ${batch.store_erp_created || 0}/${batch.store_total}`;
    const canDeleteWaiting = batch.status === "open" && Number(batch.store_approved || 0) === 0;
    const canDelete = state.config.permissions?.canDeleteBatch && (batch.status === "cancelled" || canDeleteWaiting);
    const deleteButton = canDelete
      ? `<button class="secondary-button compact delete-batch-button" type="button" data-delete-batch="${escapeHtml(batch.id)}" data-week-key="${escapeHtml(batch.week_key)}" data-item-count="${escapeHtml(batch.item_count || 0)}" data-delete-kind="${canDeleteWaiting ? "waiting" : "history"}">${canDeleteWaiting ? "刪除待確認批次" : "刪除批次"}</button>` : "";
    const shortage = Number(batch.shortage_count || 0) ? `・缺貨未配${escapeHtml(batch.shortage_count)}項／${escapeHtml(batch.unfilled_quantity || 0)}件` : "";
    const notificationTotal = Number(batch.notification_total || 0), notificationSent = Number(batch.notification_sent || 0), notificationFailed = Number(batch.notification_failed || 0);
    const notificationText = notificationTotal ? `・門市通知${notificationSent}/${notificationTotal}${notificationFailed ? `（${notificationFailed}封失敗）` : ""}` : "";
    const notificationButton = state.config.role !== "store" && notificationTotal > notificationSent && batch.status !== "cancelled"
      ? `<button class="secondary-button compact" type="button" data-send-batch-notifications="${escapeHtml(batch.id)}">${notificationFailed ? "重寄失敗通知" : "寄送門市通知"}</button>` : "";
    return `<article class="batch-card${batch.status === "cancelled" ? " superseded" : ""}"><div><h3>${escapeHtml(batch.week_key || batch.id)}</h3><p class="batch-meta">${escapeHtml(batch.item_count || 0)}項・系統建議${escapeHtml(batch.suggested_quantity || 0)}件${shortage}${notificationText}・${escapeHtml(progress)}・更新於${escapeHtml(batch.updated_at || "")}</p></div><span class="batch-status">${escapeHtml(status)}</span><div class="batch-card-actions"><button class="secondary-button compact" type="button" data-open-batch="${escapeHtml(batch.id)}">${batch.status === "cancelled" ? "查看紀錄" : "查看／處理"}</button>${notificationButton}${deleteButton}</div></article>`;
  }

  async function sendBatchNotifications(batchId, authorizeIfNeeded = true) {
    if (!googleSources.token() && authorizeIfNeeded) await authorizeGoogle();
    if (!googleSources.token()) throw new Error("尚未完成公司 Google 寄信授權；可在批次清單按「寄送門市通知」重試。");
    const result = await api(`/batches/${encodeURIComponent(batchId)}/notifications/send`, { method: "POST", googleAccessToken: googleSources.token() });
    if (result.failed) throw new Error(`已寄出${result.sent}封，但仍有${result.failed}間門市寄送失敗；可在批次清單重試。`);
    return result;
  }

  function oneMonthAgo(now = new Date()) {
    const cutoff = new Date(now);
    const day = cutoff.getDate();
    cutoff.setDate(1);
    cutoff.setMonth(cutoff.getMonth() - 1);
    const lastDay = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate();
    cutoff.setDate(Math.min(day, lastDay));
    return cutoff;
  }

  function isStorePendingBatch(batch) {
    return ["open", "review"].includes(batch.status) && ["pending", "saved", "submitted"].includes(batch.store_status);
  }

  function isRecentStoreHistory(batch, now = new Date()) {
    if (isStorePendingBatch(batch)) return false;
    const timestamp = new Date(batch.updated_at || batch.created_at || "");
    return !Number.isNaN(timestamp.getTime()) && timestamp >= oneMonthAgo(now);
  }

  function renderBatchCards(batches, emptyMessage) {
    return batches.length ? batches.map(batchCard).join("") : `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
  }

  async function deleteBatchFromHistory(button) {
    const id = button.dataset.deleteBatch;
    const week = button.dataset.weekKey || id;
    const itemCount = button.dataset.itemCount || 0;
    const waiting = button.dataset.deleteKind === "waiting";
    const target = waiting ? "這筆仍在等待門市的批次" : "這筆已取代批次";
    if (!confirm(`確定要刪除 ${week} 的${target}嗎？\n\n批次編號：${id}\n品項數：${itemCount}\n\n${waiting ? "刪除後門市將無法再回覆，已寄出的通知連結也不再顯示此批次。\n" : ""}前台不再顯示，但稽核資料會保留12個月。`)) return;
    button.disabled = true;
    try {
      await api(`/batches/${encodeURIComponent(id)}`, { method: "DELETE" });
      $("hq-status").textContent = `已刪除${week}的${waiting ? "待確認" : "舊"}批次；稽核資料仍保留12個月。`;
      await loadBatches();
    } finally { button.disabled = false; }
  }

  async function loadBatches() {
    const query = state.config.storeCode ? `?store=${encodeURIComponent(state.config.storeCode)}` : "";
    const payload = await api(`/batches${query}`);
    if (state.config.role === "store") {
      const pending = payload.batches.filter(isStorePendingBatch);
      const history = payload.batches.filter((batch) => isRecentStoreHistory(batch));
      $("store-batches").innerHTML = renderBatchCards(pending, "目前沒有待處理批次。");
      $("store-history-batches").innerHTML = renderBatchCards(history, "目前沒有近一個月歷史批次。");
      $("store-history-summary").textContent = history.length ? `共 ${history.length} 筆；預設收合，需要時再展開查閱。` : "目前沒有近一個月歷史批次。";
      return;
    }
    $("batch-list").innerHTML = renderBatchCards(payload.batches, "目前沒有週調撥批次。");
  }

  async function loadPendingPurchases() {
    const payload = await api("/pending-purchases");
    const rows = payload.rows || [];
    $("pending-purchase-empty").hidden = rows.length > 0;
    $("pending-purchase-wrap").hidden = rows.length === 0;
    $("pending-purchase-rows").innerHTML = rows.map((row) => `<tr><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.product_name)}</td><td>${Number(row.pending_quantity || 0).toLocaleString("zh-TW")}</td><td>${escapeHtml(row.expected_delivery_date || "未提供")}</td><td>${escapeHtml(row.source_date)}</td><td>已有未交，但本週仍須以總倉現貨判斷可配量</td></tr>`).join("");
    $("pending-purchase-updated").textContent = rows.length ? `共${rows.length}個品號・更新${String(rows[0].updated_at || "").replace("T", " ").slice(0, 19)}` : "目前無未到貨摘要";
  }

  function applyScheduleForWeek(weekKey) {
    const match = String(weekKey || "").match(/^(\d{4})-W(\d{2})$/); if (!match) return;
    const jan4 = new Date(Number(match[1]), 0, 4, 12), jan4Offset = (jan4.getDay() + 6) % 7;
    const monday = new Date(jan4); monday.setDate(jan4.getDate() - jan4Offset + (Number(match[2]) - 1) * 7);
    const tuesday = new Date(monday); tuesday.setDate(monday.getDate() + 1);
    const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const holidays = state.config.storeInventoryRules?.config?.workdayHolidays || [];
    const proposal = transferCore.nextWorkingDay(iso(monday), holidays);
    let lock = transferCore.nextWorkingDay(iso(tuesday), holidays);
    if (lock <= proposal) {
      const following = new Date(`${proposal}T12:00:00`); following.setDate(following.getDate() + 1);
      lock = transferCore.nextWorkingDay(iso(following), holidays);
    }
    $("proposal-date").value = proposal; $("lock-at").value = `${lock}T09:00`;
  }

  function defaults() {
    const today = new Date(), offset = (today.getDay() + 6) % 7;
    const monday = new Date(today); monday.setDate(today.getDate() - offset);
    const thursday = new Date(monday); thursday.setDate(monday.getDate() + 3);
    const start = new Date(thursday.getFullYear(), 0, 1), days = Math.floor((thursday - start) / 86400000);
    $("week-key").value = `${thursday.getFullYear()}-W${String(Math.ceil((days + start.getDay() + 1) / 7)).padStart(2, "0")}`;
    applyScheduleForWeek($("week-key").value);
  }

  function rowProjection(item, quantity) {
    if (!item.manual && item.item_type === "activity_gift") return item.system_projection || "依活動期間判斷";
    if (!item.manual && item.item_type === "consumable") {
      const weekly = Number(item.daily_usage || 0) * 7;
      return weekly > 0 ? `約${((Number(item.base_quantity || 0) + Number(quantity || 0)) / weekly).toFixed(1)}週` : "耗用資料不足";
    }
    if (item.manual && !(Number(item.daily_usage || 0) > 0) && /人工新增，無歷史推估/.test(String(item.system_projection || ""))) return "舊批次未保存銷售基準，請重新建立批次";
    if (!item.calculation_date) return item.system_projection || "舊批次未保存推估基準";
    const sellableAddition = Math.max(0, Number(quantity || 0) - Number(item.display_gap || 0));
    return transferCore.projectedSellThroughDate(item.calculation_date, item.base_quantity, sellableAddition, item.daily_usage);
  }

  function storeFacingSystemReason(reason, suggested = 0) {
    const value = String(reason || "").normalize("NFKC").trim();
    if (!value) return Number(suggested || 0) > 0 ? "本輪系統建議需求已滿足" : "本批次依現行規則未形成補貨需求";
    if (/總[倉部]|安全庫存|可釋出|可供應|14[／/]42[／/]84|最高日速|部分供應|未供應/.test(value)) return "受本輪供應條件限制，系統未建議追加";
    if (/系統已足額建議/.test(value)) return "本輪系統建議需求已滿足";
    return value;
  }

  function quantityProjectionText(row, quantity) {
    const item = {
      item_type: row.dataset.itemType,
      calculation_date: row.dataset.calculationDate,
      base_quantity: Number(row.dataset.base || 0),
      daily_usage: Number(row.dataset.daily || 0),
      display_gap: Number(row.dataset.displayGap || 0),
      system_projection: row.dataset.systemProjection || "",
      manual: row.dataset.manual === "true"
    };
    const stage = state.config.role === "store" ? "人工申請" : "總部核准";
    return `${stage}${quantity}件後，預估可售至：${rowProjection(item, quantity)}`;
  }

  function detailId(prefix, row) {
    return `${prefix}-${row.storeCode || row.store_code || "store"}-${row.sku || "item"}-${row.itemType || row.item_type || "regular"}`.replace(/[^A-Za-z0-9_-]/g, "-");
  }

  function detailButton(id) {
    return `<button class="secondary-button compact decision-detail-toggle" type="button" data-detail-target="${escapeHtml(id)}" aria-expanded="false" aria-label="展開判斷依據" title="展開判斷依據">+</button>`;
  }

  function detailRow(id, colspan, content) {
    return `<tr id="${escapeHtml(id)}" class="decision-detail-row" data-decision-detail hidden><td colspan="${colspan}"><div class="decision-evidence-grid">${content}</div></td></tr>`;
  }

  function warningRow(id, colspan) {
    return `<tr id="${escapeHtml(id)}-warning" class="decision-warning-row" data-quantity-warning hidden><td colspan="${colspan}"></td></tr>`;
  }

  function evidence(label, value, wide = false) {
    return `<div class="decision-evidence${wide ? " wide" : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value == null || value === "" ? "—" : value)}</strong></div>`;
  }

  function itemIdentity(row) {
    return `<strong class="decision-sku">${escapeHtml(row.sku)}</strong><span class="decision-product-name">${escapeHtml(row.productName || row.product_name || "")}</span>`;
  }

  function workflowColgroup(canChangeItems) {
    return `<colgroup><col class="workflow-col-toggle">${state.config.role !== "store" ? '<col class="workflow-col-store">' : ""}<col class="workflow-col-item"><col class="workflow-col-system"><col class="workflow-col-quantity"><col class="workflow-col-reason">${state.config.role !== "store" ? '<col class="workflow-col-quantity"><col class="workflow-col-reason">' : ""}${canChangeItems ? '<col class="workflow-col-action">' : ""}</colgroup>`;
  }

  function autoSizeReasonField(field) {
    if (!(field instanceof HTMLTextAreaElement)) return;
    field.style.height = "auto";
    const height = Math.min(Math.max(field.scrollHeight, 62), 160);
    field.style.height = `${height}px`;
    field.style.overflowY = field.scrollHeight > 160 ? "auto" : "hidden";
  }

  function previewRow(row, kind) {
    const allocation = kind === "shortage" ? "" : ` data-allocation-row data-allocation-quantity="${Number(row.suggestedQuantity || 0)}"`;
    const id = detailId(`calculation-${kind}`, row);
    if (kind === "shortage") return `<tr data-store-row data-store="${escapeHtml(row.storeCode)}" data-sku="${escapeHtml(row.sku)}"><td>${row.storeCode}</td><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.productName)}</td><td>${row.demandQuantity}</td><td>${row.allocatedQuantity}</td><td>${row.unfilledQuantity}</td><td>${escapeHtml(row.reason)}</td><td>${escapeHtml(row.followUpStatus || "待回拋主採購")}</td></tr>`;
    const start = `<tr data-store-row data-store="${escapeHtml(row.storeCode)}" data-sku="${escapeHtml(row.sku)}"${allocation}><td class="decision-toggle-cell" data-label="判斷依據">${detailButton(id)}</td><td data-label="門市">${row.storeCode}</td>`;
    if (kind === "special") return `${start}<td data-label="品項">${itemIdentity(row)}</td><td data-label="系統建議" class="decision-quantity">${row.suggestedQuantity}</td><td data-label="建議後">${escapeHtml(row.systemSellThroughDate)}</td></tr>${detailRow(id, 5, [evidence("近42天現場銷售", `${row.localSales42}件`), evidence("現有實體庫存", `${row.physicalInventory}件`), evidence("待發貨／在途", `${row.pendingSubmittedQuantity}／${row.inTransitQuantity}件`), evidence("系統判斷", row.ruleSummary, true)].join(""))}`;
    if (kind === "consumable") return `${start}<td data-label="品項">${itemIdentity(row)}</td><td data-label="系統建議" class="decision-quantity">${row.suggestedQuantity / 100}箱／${row.suggestedQuantity}個</td><td data-label="建議後">${escapeHtml(row.systemSellThroughDate)}</td></tr>${detailRow(id, 5, [evidence("現有實體庫存", `${row.physicalInventory}個`), evidence("待發貨／在途", `${row.pendingSubmittedQuantity}／${row.inTransitQuantity}個`), evidence("週均耗用", `${row.averageWeeklyUsage.toFixed(1)}個`), evidence("系統判斷", row.ruleSummary, true)].join(""))}`;
    return `${start}<td data-label="品項">${itemIdentity(row)}</td><td data-label="系統建議" class="decision-quantity">${row.suggestedQuantity}</td><td data-label="建議後">${escapeHtml(row.systemSellThroughDate)}</td><td data-label="到貨風險"><span class="risk-label ${row.preArrivalStockoutRisk ? "warn" : "safe"}">${row.preArrivalStockoutRisk ? "有缺貨空窗" : "可支撐到店"}</span></td></tr>${detailRow(id, 6, [evidence("近42天現場／B3銷售", `${row.localSales42}／${row.b3Sales42}件`), evidence("現有實體庫存", `${row.physicalInventory}件`), evidence("待發貨／在途", `${row.pendingSubmittedQuantity}／${row.inTransitQuantity}件`), evidence("目標／不可售展示", `${Number(row.targetQuantity).toFixed(1)}／${row.displayQuantity}件`), evidence("本批／下一輪到店", `${row.currentArrivalDate}／${row.nextArrivalDate}`), evidence("系統判斷", row.ruleSummary, true)].join(""))}`;
  }

  async function calculate() {
    if (!(await checkRuntimeVersion())) return;
    const stores = selectedStores(); if (!stores.length) throw new Error("請至少勾選一間門市。");
    $("calculate-button").disabled = true; $("hq-status").textContent = "正在本機讀取與計算，檔案不會上傳…";
    try {
      const masterFile = state.files.master, marketingFile = state.files.marketing, inventoryFile = $("inventory-file").files[0], transferFile = $("transfer-file").files[0], salesFiles = [...$("sales-files").files];

      // Large ERP sales exports can expand to hundreds of MB even when the .xlsx
      // itself is small. Read and compact each source sequentially so several
      // decompressed workbooks are never retained at the same time.
      $("hq-status").textContent = "正在預檢銷售明細的實際展開大小…";
      for (const file of salesFiles) await xlsxPreflight.assertSalesWorkbookSize(file);
      $("hq-status").textContent = "第1/5步：正在讀取商品主檔…";
      const master = parser.parseProductMasterWorkbook(await workbook(masterFile), inputXlsx, { fileName: masterFile.name });
      await yieldToBrowser();
      $("hq-status").textContent = "第2/5步：正在讀取整體行銷策略…";
      const marketingBook = await workbook(marketingFile);
      await yieldToBrowser();
      $("hq-status").textContent = "第3/5步：正在讀取公司庫存…";
      const inventory = parser.parseInventoryWorkbook(await workbook(inventoryFile), inputXlsx, { fileName: inventoryFile.name });
      await yieldToBrowser();
      $("hq-status").textContent = "第4/5步：正在讀取期間調撥單…";
      const transfer = parser.parseTransferWorkbook(await workbook(transferFile), inputXlsx, { fileName: transferFile.name });
      await yieldToBrowser();

      const sales = [];
      for (let index = 0; index < salesFiles.length; index += 1) {
        const file = salesFiles[index];
        $("hq-status").textContent = `第5/5步：正在輕量讀取銷售明細 ${index + 1}/${salesFiles.length}（${file.name}）…`;
        const report = parser.parseSalesWorkbook(await workbook(file), inputXlsx, { fileName: file.name });
        sales.push(report);
        await yieldToBrowser();
      }
      const [historyPayload, exceptionPayload] = await Promise.all([api("/consumable-snapshots"), api("/display-exceptions")]);
      state.config.displayExceptions = exceptionPayload.exceptions || [];
      const latestSalesDate = sales.reduce((max, report) => report.maxDate > max ? report.maxDate : max, "") || $("proposal-date").value;
      $("hq-status").textContent = "資料讀取完成，正在計算各門市建議量…";
      const mode = calculationMode();
      const calculationInput = {
        storeCodes: stores,
        master,
        inventory,
        transfer,
        sales,
        marketing: transferCore.parseMarketingWorkbook(marketingBook, inputXlsx, latestSalesDate),
        consumableHistory: historyPayload.snapshots || [],
        proposalDate: $("proposal-date").value,
        calculationMode: mode,
        storeInventory: state.config.storeInventoryRules?.config || {},
        storeDisplayExceptions: state.config.displayExceptions || []
      };
      state.calculation = transferCore.buildSuggestions(calculationInput);
      state.formalCalculation = mode === "comparison" ? transferCore.buildSuggestions({ ...calculationInput, calculationMode: "formal" }) : state.calculation;
      state.calculationStore = "all";
      state.calculationSku = "";
      $("calculation-store-filter").innerHTML = storeFilterBar("calculation", stores, state.calculationStore);
      $("calculation-sku-filter").innerHTML = skuFilterBar("calculation", state.calculationSku);
      if (mode === "formal") await api("/consumable-snapshots", { method: "POST", body: { snapshots: state.calculation.consumableSnapshots } });
      const ignoredTransferText = transfer.ignoredRows?.length ? `；另略過${transfer.ignoredRows.length}筆與總倉及既有門市皆無關的調撥` : "";
      $("calculation-summary").textContent = `銷售截止${state.calculation.latestSalesDate}；必要補貨${state.calculation.totals.regularItemCount}項、建議備貨${state.calculation.totals.specialStockItemCount}項、活動／贈品${state.calculation.totals.activityItemCount}項、耗材${state.calculation.totals.consumableItemCount}項、缺貨未配${state.calculation.totals.shortageItemCount}項；待發貨${state.calculation.totals.pendingSubmittedQuantity}件、發貨在途${state.calculation.totals.inTransitQuantity}件；B3成功配對${state.calculation.b3Audit.matchedCount}筆、待人工確認${state.calculation.b3Audit.pendingCount}筆${ignoredTransferText}；${mode === "formal" ? "提袋快照已記錄" : "A/B模式未寫入提袋快照"}。`;
      $("calculation-mode-alert").hidden = mode !== "comparison";
      $("calculation-mode-alert").innerHTML = mode === "comparison" ? `<strong>A/B測試比對：</strong>已排除${state.calculation.totals.excludedSubmittedDocumentCount}張提交單、共${state.calculation.totals.excludedSubmittedQuantity}件；本結果只能預覽，不能建立正式批次。發貨審核仍按在途量計算。` : "";
      renderComparisonDownloads(stores, mode);
      renderFormalDownloads(stores, mode);
      $("publish-collaboration-button").disabled = mode !== "comparison";
      const impact = state.calculation.companyImpact;
      $("company-impact").innerHTML = `<strong>寬承／寬沐成本流向：</strong>寬沐調撥收貨${impact.kuanmuTransferCount}筆、B3代出${impact.kuanmuB3Count}筆；原始供貨成本${formatCurrency(impact.kuanmuBaseCost)}，寬承對寬沐計價參考${formatCurrency(impact.kuanmuIntercompanyRevenue)}（成本×1.11）。合併檢視時抵銷公司間計價，只保留原始成本。`;
      $("b3-audit").hidden = !state.calculation.b3Audit.pendingCount;
      $("b3-audit").innerHTML = state.calculation.b3Audit.pendingCount ? `<strong>B3待人工確認：</strong>${state.calculation.b3Audit.pendingRows.slice(0, 20).map((row) => `${escapeHtml(row.storeCode)}／${escapeHtml(row.sku)}／來源單${escapeHtml(row.sourceOrder || "未填")}`).join("、")}${state.calculation.b3Audit.pendingCount > 20 ? "…" : ""}。這些資料未納入B3與門市能力。` : "";
      $("calculation-rows").innerHTML = state.calculation.regularRows.length ? state.calculation.regularRows.map((row) => previewRow(row, "regular")).join("") : '<tr><td colspan="6">本週沒有一般必要補貨。</td></tr>';
      $("special-stock-results").hidden = !state.calculation.specialStockRows.length;
      $("special-stock-rows").innerHTML = state.calculation.specialStockRows.map((row) => previewRow(row, "special")).join("");
      $("activity-results").hidden = !state.calculation.activityRows.length && !state.calculation.marketingWarnings.length;
      $("activity-rows").innerHTML = state.calculation.activityRows.length ? state.calculation.activityRows.map((row) => {
        const id = detailId("calculation-activity", row);
        const detail = [
          evidence("活動門檻", row.thresholdText), evidence("適用範圍", row.activityScope || "待確認"),
          evidence("門檻計算基礎", row.thresholdBasis || "待確認"), evidence("有效估算天數", `${Number(row.effectiveDays || 0)}天`),
          evidence("符合範圍訂單／平均客單", row.matchingOrderCount == null ? "待確認" : `${row.matchingOrderCount}筆／${Math.round(row.averageTicket || 0).toLocaleString("zh-TW")}元`),
          evidence("達標率／預估贈品", row.eligibleRate == null ? "待確認" : `${(row.eligibleRate * 100).toFixed(1)}%／${row.forecastGiftQuantity}件`),
          evidence("近21天耗用", `${row.localSales42}件`), evidence("庫存／待發貨／在途", `${row.physicalInventory}／${row.pendingSubmittedQuantity}／${row.inTransitQuantity}件`),
          evidence("系統判斷", row.ruleSummary, true)
        ].join("");
        return `<tr data-store-row data-store="${escapeHtml(row.storeCode)}" data-sku="${escapeHtml(row.sku)}" data-allocation-row data-allocation-quantity="${Number(row.suggestedQuantity || 0)}"><td class="decision-toggle-cell" data-label="判斷依據">${detailButton(id)}</td><td data-label="門市">${row.storeCode}</td><td data-label="品項">${itemIdentity(row)}</td><td data-label="活動期間">${escapeHtml(row.activityPeriod)}</td><td data-label="系統建議" class="decision-quantity">${row.suggestedQuantity}</td><td data-label="本批到店">${escapeHtml(row.currentArrivalDate || "待確認")}</td></tr>${detailRow(id, 6, detail)}`;
      }).join("") : '<tr><td colspan="6">目前沒有可直接配對贈品貨號的活動。</td></tr>';
      $("marketing-warnings").textContent = state.calculation.marketingWarnings.join(" ");
      $("consumable-results").hidden = !state.calculation.consumableRows.length;
      $("consumable-rows").innerHTML = state.calculation.consumableRows.map((row) => previewRow(row, "consumable")).join("");
      $("shortage-results").hidden = !state.calculation.shortageRows.length;
      $("shortage-rows").innerHTML = state.calculation.shortageRows.map((row) => previewRow(row, "shortage")).join("");
      $("pending-transfer-results").hidden = !state.calculation.pendingTransferRows.length;
      $("pending-transfer-rows").innerHTML = state.calculation.pendingTransferRows.map((row) => `<tr data-store-row data-store="${escapeHtml(row.storeCode)}" data-sku="${escapeHtml(row.sku)}"><td>${escapeHtml(row.storeCode)}</td><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.productName)}</td><td>${escapeHtml(row.documentCode)}</td><td>${escapeHtml(row.status)}</td><td>${row.quantity}</td><td>${escapeHtml(row.openedDate || "—")}</td><td>${escapeHtml(row.shippedDate || "—")}</td><td>${row.includedInCalculation ? "已納入抵扣" : "A/B模式已排除"}</td></tr>`).join("");
      $("publish-button").disabled = mode === "comparison" || (!state.calculation.rows.length && !state.calculation.shortageRows.length);
      $("publish-button").textContent = mode === "comparison" ? "A/B模式不可建立批次" : "建立門市確認批次";
      $("calculation-results").hidden = false;
      applyStoreFilter("calculation", state.calculationStore);
      const ignoredNotice = transfer.ignoredRows?.length ? ` 已略過${transfer.ignoredRows.length}筆兩端皆不屬於總倉或既有門市的資料。` : "";
      $("hq-status").textContent = (mode === "comparison" ? "A/B測試比對完成；可下載差異表，或發布為四人協作批次，此時尚不會通知門市。" : state.calculation.rows.length ? "計算完成，請先檢查四類結果，再建立門市確認批次。" : "本週沒有可建立批次的調撥項目；缺貨與提袋快照仍已完成記錄。") + ignoredNotice;
    } finally { $("calculate-button").disabled = false; }
  }

  async function publish() {
    if (!state.calculation) return;
    if (state.calculation.calculationMode === "comparison") throw new Error("A/B測試比對只能預覽，請切回正式補貨並重新計算後再建立批次。");
    const weekKey = $("week-key").value, proposalDate = $("proposal-date").value, localLock = $("lock-at").value;
    if (!weekKey || !proposalDate || !localLock) throw new Error("請填妥週次、建議產生日與鎖定時間。");
    $("publish-button").disabled = true;
    try {
      let notificationAuthorizationError = "";
      if (!googleSources.token()) {
        try { await authorizeGoogle(); }
        catch (error) { notificationAuthorizationError = error.message; }
      }
      const id = `TR-${weekKey}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      $("hq-status").textContent = "正在建立正式批次；大型缺貨清單會以精簡格式安全寫入…";
      await api("/batches", { method: "POST", body: { id, weekKey, proposalDate, responseDueAt: new Date(localLock).toISOString(), lockAt: new Date(localLock).toISOString(), items: compactBatchItems(state.calculation.rows), shortages: compactBatchShortages(state.calculation.shortageRows), manualItemFacts: compactManualItemFacts(state.calculation.manualItemFacts), manualItemCatalog: compactManualItemCatalog(state.calculation.manualItemCatalog), arrivalSchedule: state.calculation.scheduleByStore } });
      let notificationText = "";
      try {
        if (notificationAuthorizationError) throw new Error(notificationAuthorizationError);
        const result = await sendBatchNotifications(id, false);
        notificationText = `；已寄出${result.sent}封門市通知信`;
      } catch (error) {
        notificationText = `；批次已建立，但門市通知尚未全部寄出：${error.message}`;
      }
      $("hq-status").textContent = `已建立批次${id}${notificationText}；同週舊的未完成批次已改為僅供查閱，門市重新登入即可看到新版確認清單。`;
      $("calculation-results").hidden = true; state.calculation = null; await loadBatches();
    } finally { $("publish-button").disabled = false; }
  }

  function collaborationTypeLabel(type) {
    return ({ regular: "一般必要補貨", special_stock: "建議備貨", activity_gift: "活動／贈品", consumable: "門市耗材" })[type] || type;
  }

  function renderCollaborationDetail() {
    const { draft, payload } = state.activeCollaboration;
    const editable = draft.status === "draft";
    const rows = payload.comparisonReports.flatMap((report, reportIndex) => report.rows.map((row, rowIndex) => ({ report, reportIndex, row, rowIndex })));
    const body = rows.map(({ report, reportIndex, row, rowIndex }) => {
      const step = row.itemType === "consumable" ? 100 : 1;
      const options = [["accept_formal", "採用正式系統建議"], ["no_new", "本次不新增調撥"], ["custom", "自訂數量"]].map(([value, label]) => `<option value="${value}"${row.decision === value ? " selected" : ""}>${label}</option>`).join("");
      return `<tr data-collaboration-row data-report-index="${reportIndex}" data-row-index="${rowIndex}" data-item-type="${escapeHtml(row.itemType)}"><td>${escapeHtml(report.storeCode)} ${escapeHtml(report.storeName)}</td><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.productName)}</td><td>${row.aQuantity}</td><td>${row.bQuantity}</td><td>${row.difference > 0 ? "+" : ""}${row.difference}</td><td>${row.formalSuggestedQuantity}</td><td>${escapeHtml(collaborationTypeLabel(row.itemType))}</td><td><select data-collaboration-decision ${editable ? "" : "disabled"}>${options}</select></td><td><input data-collaboration-quantity type="number" min="0" step="${step}" value="${row.agreedQuantity}" ${editable && row.decision === "custom" ? "" : "disabled"}></td><td><input data-collaboration-note maxlength="500" value="${escapeHtml(row.note || "")}" ${editable ? "" : "disabled"} placeholder="自訂或不調撥時請填原因"></td></tr>`;
    }).join("");
    const finalizerNote = state.config.permissions.canFinalizeCollaboration ? "您可在儲存定稿後轉成正式批次。" : "只有 siang01 與 service1 可轉成正式批次。";
    $("collaboration-detail").innerHTML = `<p class="eyebrow">${escapeHtml(payload.weekKey)}・版本${draft.revision}</p><h2>A/B差異協作定稿</h2><p>最後更新：${escapeHtml(draft.updatedBy)}・${escapeHtml(draft.updatedAt)}。${finalizerNote}</p><div class="result-table-wrap"><table class="transfer-table collaboration-table"><thead><tr><th>門市</th><th>ERP品號</th><th>品名</th><th>A系統</th><th>B人工</th><th>B-A</th><th>正式建議</th><th>類型</th><th>協作決議</th><th>定稿量</th><th>備註</th></tr></thead><tbody>${body}</tbody></table></div><div class="detail-actions">${editable ? '<button class="secondary-button" type="button" data-collaboration-action="save">儲存協作版本</button>' : ""}${editable && state.config.permissions.canFinalizeCollaboration ? '<button class="primary-button" type="button" data-collaboration-action="finalize">轉成正式批次</button>' : ""}</div><p data-collaboration-dialog-status class="status-line"></p>`;
  }

  async function openCollaboration(id) {
    const result = await api(`/collaboration-drafts/${encodeURIComponent(id)}`);
    const actualHash = await sha256(result.draft.payload);
    if (actualHash !== result.draft.payloadSha256) throw new Error("協作內容完整性檢查失敗，請聯絡系統管理者。");
    let payload;
    try { payload = JSON.parse(result.draft.payload); } catch { throw new Error("協作內容無法解析。"); }
    state.activeCollaboration = { draft: result.draft, payload };
    renderCollaborationDetail();
    $("collaboration-dialog").showModal();
  }

  function readCollaborationDecisions() {
    const payload = state.activeCollaboration.payload;
    $("collaboration-detail").querySelectorAll("[data-collaboration-row]").forEach((element) => {
      const row = payload.comparisonReports[Number(element.dataset.reportIndex)].rows[Number(element.dataset.rowIndex)];
      const decision = element.querySelector("[data-collaboration-decision]").value;
      const note = element.querySelector("[data-collaboration-note]").value.normalize("NFKC").trim();
      let agreedQuantity = decision === "accept_formal" ? Number(row.formalSuggestedQuantity || 0) : decision === "no_new" ? 0 : Number(element.querySelector("[data-collaboration-quantity]").value);
      if (!Number.isSafeInteger(agreedQuantity) || agreedQuantity < 0) throw new Error(`${row.sku}的定稿量須為0以上整數。`);
      if (row.itemType === "consumable" && agreedQuantity % 100 !== 0) throw new Error(`${row.sku}為耗材，定稿量須為100的倍數。`);
      if (decision !== "accept_formal" && !note) throw new Error(`${row.sku}改為自訂數量或不新增調撥時，請填寫原因。`);
      row.decision = decision; row.agreedQuantity = agreedQuantity; row.note = note;
    });
    return payload;
  }

  async function saveActiveCollaboration() {
    const payload = readCollaborationDecisions();
    const draft = await saveCollaborationPayload(state.activeCollaboration.draft.id, payload, state.activeCollaboration.draft.revision);
    state.activeCollaboration.draft = draft;
    await loadCollaborationDrafts();
    renderCollaborationDetail();
    $("collaboration-detail").querySelector("[data-collaboration-dialog-status]").textContent = `已儲存版本${draft.revision}，其他協作者重新開啟後會看到最新內容。`;
    return draft;
  }

  function finalizedItems(payload) {
    const decisions = new Map(payload.comparisonReports.flatMap((report) => report.rows.map((row) => [`${report.storeCode}|${row.sku}`, row])));
    const formalKeys = new Set(payload.formal.rows.map((row) => `${row.storeCode}|${row.sku}`));
    const items = payload.formal.rows.map((row) => {
      const decision = decisions.get(`${row.storeCode}|${row.sku}`);
      const suggestedQuantity = decision ? Number(decision.agreedQuantity || 0) : Number(row.suggestedQuantity || 0);
      return { ...row, suggestedQuantity, ruleSummary: decision?.note ? `${row.ruleSummary || ""}；A/B協作：${decision.note}` : row.ruleSummary };
    }).filter((row) => row.suggestedQuantity > 0);
    payload.comparisonReports.forEach((report) => report.rows.forEach((row) => {
      const key = `${report.storeCode}|${row.sku}`;
      if (formalKeys.has(key) || Number(row.agreedQuantity || 0) <= 0) return;
      items.push({ storeCode: report.storeCode, sku: row.sku, productName: row.productName, suggestedQuantity: Number(row.agreedQuantity), itemType: row.itemType, calculationDate: payload.proposalDate, baseSellableQuantity: 0, displayGap: 0, dailySales: 0, systemSellThroughDate: "A/B協作決議新增", systemDecisionReason: `原系統未建議；A/B協作決議新增${row.note ? `：${row.note}` : ""}`, ruleSummary: `A/B協作決議新增：${row.note}` });
    }));
    return items;
  }

  function finalizedShortages(payload) {
    const decisions = new Map(payload.comparisonReports.flatMap((report) => report.rows.map((row) => [`${report.storeCode}|${row.sku}`, row])));
    return payload.formal.shortages.map((row) => {
      const decision = decisions.get(`${row.storeCode}|${row.sku}`);
      if (!decision) return row;
      const allocatedQuantity = Math.min(Number(row.demandQuantity || 0), Number(decision.agreedQuantity || 0));
      return { ...row, allocatedQuantity, unfilledQuantity: Math.max(0, Number(row.demandQuantity || 0) - allocatedQuantity), reason: (decision.note ? `${row.reason}；A/B協作：${decision.note}` : row.reason).slice(0, 500) };
    }).filter((row) => row.unfilledQuantity > 0);
  }

  async function finalizeCollaboration() {
    if (!state.config.permissions.canFinalizeCollaboration) throw new Error("只有 siang01 與 service1 可轉成正式批次。");
    const draft = await saveActiveCollaboration();
    const payload = state.activeCollaboration.payload;
    if (!confirm(`確定將${payload.weekKey} A/B協作定稿轉成正式門市確認批次嗎？\n\n建立後門市將看到正式確認清單，協作批次不能再編輯。`)) return;
    let notificationAuthorizationError = "";
    if (!googleSources.token()) {
      try { await authorizeGoogle(); }
      catch (error) { notificationAuthorizationError = error.message; }
    }
    const id = `TR-${payload.weekKey}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await api("/batches", { method: "POST", body: {
      id, weekKey: payload.weekKey, proposalDate: payload.proposalDate, responseDueAt: payload.responseDueAt, lockAt: payload.lockAt,
      items: compactBatchItems(finalizedItems(payload)), shortages: compactBatchShortages(finalizedShortages(payload)), manualItemFacts: compactManualItemFacts(payload.formal.manualItemFacts), manualItemCatalog: compactManualItemCatalog(payload.formal.manualItemCatalog), arrivalSchedule: payload.formal.scheduleByStore,
      collaborationId: draft.id, collaborationRevision: draft.revision
    } });
    let notificationText = "";
    try {
      if (notificationAuthorizationError) throw new Error(notificationAuthorizationError);
      const result = await sendBatchNotifications(id, false);
      notificationText = `，並寄出${result.sent}封門市通知信`;
    } catch (error) {
      notificationText = `；正式批次已建立，但門市通知尚未全部寄出：${error.message}`;
    }
    $("collaboration-dialog").close(); state.activeCollaboration = null;
    await Promise.all([loadCollaborationDrafts(), loadBatches()]);
    $("hq-status").textContent = `已將${payload.weekKey} A/B協作定稿轉成正式批次${id}${notificationText}。`;
  }

  async function handleCollaborationDialog(event) {
    const decision = event.target.closest("[data-collaboration-decision]");
    if (decision) {
      const row = decision.closest("[data-collaboration-row]"), quantityInput = row.querySelector("[data-collaboration-quantity]");
      const source = state.activeCollaboration.payload.comparisonReports[Number(row.dataset.reportIndex)].rows[Number(row.dataset.rowIndex)];
      quantityInput.disabled = decision.value !== "custom";
      if (decision.value === "accept_formal") quantityInput.value = source.formalSuggestedQuantity;
      if (decision.value === "no_new") quantityInput.value = "0";
      return;
    }
    const button = event.target.closest("[data-collaboration-action]"); if (!button) return;
    button.disabled = true;
    try {
      if (button.dataset.collaborationAction === "save") await saveActiveCollaboration();
      else await finalizeCollaboration();
    } catch (error) { $("collaboration-detail").querySelector("[data-collaboration-dialog-status]").textContent = error.message; }
    finally { if (button.isConnected) button.disabled = false; }
  }

  function savedDecisionSnapshot(item) {
    try {
      const snapshot = JSON.parse(item.decision_snapshot || "{}");
      return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {};
    } catch { return {}; }
  }

  function itemTable(payload) {
    const ownState = payload.storeStatuses.find((row) => row.store_code === state.config.storeCode);
    const ownStatus = ownState?.status;
    const returnedForStoreEdit = ownState?.correction_mode === "store";
    const editable = state.config.role === "store" && ["open", "review"].includes(payload.batch.status) && ownStatus !== "submitted" && (Date.now() < Date.parse(payload.batch.lock_at) || returnedForStoreEdit);
    const hqEditable = state.config.role !== "store" && ["open", "review"].includes(payload.batch.status);
    const correctionStores = new Set(payload.storeStatuses.filter((row) => row.correction_mode).map((row) => row.store_code));
    const correctionOpen = correctionStores.size > 0;
    const canChangeItems = editable || hqEditable;
    const table = (items, title, note = "") => items.length ? `<section class="result-section" data-store-section><h3>${title}</h3>${note ? `<p>${note}</p>` : ""}<p class="decision-table-note">判斷依據預設收合；需要時點選每列最左側的＋展開，主要確認與覆核不需展開。</p><div class="result-table-wrap"><table class="transfer-table workflow-table">${workflowColgroup(canChangeItems)}<thead><tr><th class="decision-toggle-cell" aria-label="判斷依據"></th>${state.config.role !== "store" ? "<th>門市</th>" : ""}<th>ERP品號／品名</th><th>系統建議</th><th>門市確認</th><th>門市調整原因</th>${state.config.role !== "store" ? "<th>總部核准</th><th>總部調整原因</th>" : ""}${canChangeItems ? "<th>品項操作</th>" : ""}</tr></thead><tbody>${items.map((item) => {
      const step = item.item_type === "consumable" ? 100 : 1;
      const rowHqEditable = hqEditable && (!correctionOpen || correctionStores.has(item.store_code));
      const confirmed = item.store_confirmed_quantity ?? item.suggested_quantity;
      const approved = item.hq_approved_quantity ?? confirmed;
      const manual = Number(item.suggested_quantity) === 0 && /人工新增/.test(String(item.rule_summary || ""));
      const projectionItem = { ...item, manual };
      const internalSystemReason = item.system_reason || (manual ? "舊批次未保存系統未建議原因，請重新建立批次" : item.rule_summary || "系統已提出調撥建議");
      const systemReason = state.config.role === "store" ? storeFacingSystemReason(internalSystemReason, item.suggested_quantity) : internalSystemReason;
      const id = detailId("batch", item);
      const snapshot = savedDecisionSnapshot(item);
      const hasSnapshot = Object.keys(snapshot).length > 0;
      const hasInventoryBreakdown = snapshot.inventoryEvidenceVersion === 1;
      const autoExcluded = manual && snapshot.autoExcluded === true;
      const reviewBase = Number(confirmed || 0);
      const reviewQuantity = state.config.role === "store" ? Number(confirmed || 0) : Number(approved || 0);
      const comparisonBase = state.config.role === "store" ? Number(item.suggested_quantity || 0) : reviewBase;
      const removed = comparisonBase > 0 && reviewQuantity === 0;
      const adjusted = reviewQuantity !== comparisonBase;
      const warning = autoExcluded || (!manual && reviewQuantity > Number(item.suggested_quantity || 0));
      const changeClass = warning ? " item-warning" : (manual || adjusted ? " item-human-change" : "");
      const persisted = state.config.role === "store" ? item.store_confirmed_quantity != null : item.hq_approved_quantity != null;
      const badges = [removed ? "已取消" : "", manual ? "人工新增" : "", adjusted && !removed && !manual ? `數量已調整 ${comparisonBase}→${reviewQuantity}` : "", persisted && (manual || adjusted) ? "已暫存" : ""].filter(Boolean);
      const changeMeta = persisted && (manual || adjusted) && item.updated_at ? `<small class="change-meta">最後修改：${escapeHtml(item.updated_by || "公司帳號")}・${escapeHtml(item.updated_at)}</small>` : "";
      const identity = `${itemIdentity(item)}${manual ? `<span class="manual-item-badge${autoExcluded ? " warn" : ""}">${autoExcluded ? "自動排除・人工申請" : "人工新增"}</span>` : ""}<span class="change-badges" data-change-badges>${badges.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</span>${changeMeta}`;
      const systemCell = `<strong class="decision-quantity">${item.suggested_quantity}</strong><small>系統建議後可售至：${escapeHtml(item.system_projection || rowProjection(projectionItem, item.suggested_quantity))}</small>`;
      const confirmedCell = `<input data-confirmed type="number" min="0" step="${step}" value="${confirmed}" ${editable ? "" : "disabled"}><small data-confirmed-projection>申請後預估可售至：${escapeHtml(rowProjection(projectionItem, confirmed))}</small>`;
      const approvedCell = `<input data-approved type="number" min="0" step="${step}" value="${approved}" ${rowHqEditable ? "" : "disabled"}><small data-approved-projection>核准後預估可售至：${escapeHtml(rowProjection(projectionItem, approved))}</small>`;
      const supplyKnown = Object.prototype.hasOwnProperty.call(snapshot, "hqSupplyCeiling");
      const supplyCeiling = Number(snapshot.hqSupplyCeiling ?? snapshot.hqReleasable ?? snapshot.hqAvailable ?? 0);
      const otherAllocated = Number(payload.supplyUsage?.[item.sku]?.otherAllocated || 0);
      const evidenceContent = [
        hasSnapshot ? evidence("近42天現場／B3銷售", `${Number(snapshot.localSales42 || 0)}／${Number(snapshot.b3Sales42 || 0)}件`) : evidence("近42天推估", Number(item.daily_usage || 0) > 0 ? `約${(Number(item.daily_usage) * 42).toFixed(1)}件` : "舊批次未保存"),
        hasInventoryBreakdown ? evidence("現有實體庫存", `${Number(snapshot.physicalInventory)}件`) : evidence("現有實體庫存", "舊批次未保存，需以原始檔重算"),
        hasInventoryBreakdown ? evidence("待發貨／在途", `${Number(snapshot.pendingSubmittedQuantity)}／${Number(snapshot.inTransitQuantity)}件`) : evidence("待發貨／在途", "舊批次未保存，需以原始檔重算"),
        hasInventoryBreakdown ? evidence("計算可用量", `${Number(snapshot.currentQuantity)}件`) : evidence("調撥前可售基準", `${Number(item.base_quantity || 0).toFixed(1)}件`),
        hasSnapshot ? evidence("目標／不可售展示", `${Number(snapshot.targetQuantity || 0)}／${Number(snapshot.displayQuantity || 0)}件`) : evidence("不可售展示缺口", `${Number(item.display_gap || 0)}件`),
        hasSnapshot ? evidence("本批／下一輪到店", `${snapshot.currentArrivalDate || "—"}／${snapshot.nextArrivalDate || "—"}`) : evidence("計算日期", item.calculation_date || "舊批次未保存"),
        ...(state.config.role !== "store" ? [supplyKnown ? evidence("總倉可用／安全保留／本批可供應", `${Number(snapshot.hqAvailable || 0)}／${Number(snapshot.hqReserve || 0)}／${supplyCeiling}件`) : evidence("總倉供應快照", "舊批次未保存")] : []),
        evidence("系統判斷", systemReason, true),
        ...(!hasSnapshot ? [evidence("批次快照", "舊批次未保存完整判斷明細；原建議、確認量及可售至仍可正常查閱", true)] : [])
      ].join("");
      const columns = (state.config.role !== "store" ? 7 : 4) + (canChangeItems ? 1 : 0) + 1;
      return `<tr class="${changeClass.trim()}" data-store-row data-store="${item.store_code}" data-sku="${escapeHtml(item.sku)}" data-suggested="${Number(item.suggested_quantity || 0)}" data-review-base="${reviewBase}" data-saved-quantity="${reviewQuantity}" data-saved-reason="${escapeHtml(state.config.role === "store" ? item.store_reason || "" : item.hq_reason || "")}" data-auto-excluded="${autoExcluded ? "true" : "false"}" data-supply-known="${supplyKnown ? "true" : "false"}" data-supply-ceiling="${supplyCeiling}" data-other-allocated="${otherAllocated}" data-allocation-row data-allocation-quantity="${approved}" data-product-name="${escapeHtml(item.product_name)}" data-item-type="${item.item_type || "regular"}" data-calculation-date="${escapeHtml(item.calculation_date)}" data-base="${Number(item.base_quantity || 0)}" data-daily="${Number(item.daily_usage || 0)}" data-display-gap="${Number(item.display_gap || 0)}" data-system-projection="${escapeHtml(item.system_projection || "")}" data-system-reason="${escapeHtml(systemReason)}" data-manual="${manual ? "true" : "false"}"><td class="decision-toggle-cell" data-label="判斷依據">${detailButton(id)}</td>${state.config.role !== "store" ? `<td data-label="門市"><strong>${escapeHtml(item.store_code)}</strong><small>${escapeHtml(state.config.stores[item.store_code]?.name || "")}</small></td>` : ""}<td data-label="品項">${identity}</td><td data-label="系統建議" class="decision-stage-cell">${systemCell}</td><td data-label="門市確認" class="decision-stage-cell">${confirmedCell}</td><td data-label="門市原因"><textarea data-reason class="reason-input" rows="2" maxlength="300" ${editable ? "" : "disabled"} placeholder="未調整可留白">${escapeHtml(item.store_reason || "")}</textarea></td>${state.config.role !== "store" ? `<td data-label="總部核准" class="decision-stage-cell">${approvedCell}</td><td data-label="總部原因"><textarea data-hq-reason class="reason-input" rows="2" maxlength="300" ${rowHqEditable ? "" : "disabled"} placeholder="未調整可留白">${escapeHtml(item.hq_reason || "")}</textarea></td>` : ""}${canChangeItems ? `<td data-label="品項操作">${editable || rowHqEditable ? `<button class="secondary-button compact remove-item-button" type="button" data-remove-item data-mode="${state.config.role === "store" ? "store" : "hq"}">${removed ? "恢復此品項" : "移除此品項"}</button>` : "—"}</td>` : ""}</tr>${warningRow(id, columns)}${detailRow(id, columns, evidenceContent)}`;
    }).join("")}</tbody></table></div></section>` : "";
    const storeOptions = payload.storeStatuses.filter((row) => !correctionOpen || correctionStores.has(row.store_code)).map((row) => `<option value="${row.store_code}">${row.store_code} ${escapeHtml(state.config.stores[row.store_code]?.name || "")}</option>`).join("");
    const manualForm = canChangeItems ? `<section class="result-section manual-item-section"><h3>人工新增品項</h3><p>輸入完整ERP品號後，系統會帶入品名、「系統未建議原因」與「申請後預估可售至」。推估沿用本批次建立時的門市庫存、待發貨／在途及近42天現場銷售基準；送出後總部覆核會看到相同欄位。移除既有品項仍會保留稽核紀錄。</p><div class="manual-item-form">${state.config.role !== "store" ? `<label><span>門市</span><select data-manual-store>${storeOptions}</select></label>` : ""}<label><span>品項類型</span><select data-manual-type><option value="regular">一般必要補貨</option><option value="special_stock">建議調撥</option><option value="activity_gift">活動／贈品</option><option value="consumable">提袋耗材</option></select></label><label><span>ERP品號</span><input data-manual-sku maxlength="80" autocomplete="off"></label><label><span>品名（自動帶入）</span><input data-manual-name maxlength="300" readonly></label><label><span>${state.config.role === "store" ? "門市確認量" : "總部核准量"}</span><input data-manual-quantity type="number" min="1" step="1"></label><label><span>${state.config.role === "store" ? "申請後" : "核准後"}預估可售至</span><output data-manual-projection>請先輸入品號與數量</output></label><label class="manual-system-reason-field"><span>系統未建議原因</span><output data-manual-system-reason>請先輸入品號</output></label><label class="manual-reason-field"><span>新增原因</span><textarea data-manual-reason class="reason-input" rows="2" maxlength="300" autocomplete="off"></textarea></label><button class="secondary-button" type="button" data-local-action="add-item">加入確認清單</button></div><p class="manual-supply-warning" data-manual-supply-warning role="alert" hidden></p><p class="status-line" data-manual-status></p><div class="result-table-wrap"><table class="transfer-table manual-item-table"><thead><tr><th>門市</th><th>ERP品號</th><th>品名</th><th>類型</th><th>系統建議</th><th>系統未建議原因</th><th>${state.config.role === "store" ? "門市確認量" : "總部核准量"}</th><th>${state.config.role === "store" ? "申請後" : "核准後"}預估可售至</th><th>原因</th><th>操作</th></tr></thead><tbody data-manual-rows></tbody></table></div></section>` : "";
    const shortages = payload.shortages || [];
    const shortageTable = shortages.length ? `<section class="result-section shortage-section" data-store-section><h3>缺貨未配與後續補貨狀態</h3><p>這些數量不會加入門市確認量或ERP檔；用來說明總倉為何未能配足，並保留後續回拋主採購的狀態。</p><div class="result-table-wrap"><table class="transfer-table compact-table"><thead><tr><th>門市</th><th>ERP品號</th><th>品名</th><th>需求量</th><th>已配量</th><th>未配不足量</th><th>原因</th><th>後續狀態</th></tr></thead><tbody>${shortages.map((row) => `<tr data-store-row data-store="${escapeHtml(row.store_code)}" data-sku="${escapeHtml(row.sku)}"><td>${escapeHtml(row.store_code)}</td><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.product_name)}</td><td>${row.demand_quantity}</td><td>${row.allocated_quantity}</td><td>${row.unfilled_quantity}</td><td>${escapeHtml(state.config.role === "store" ? storeFacingSystemReason(row.reason, row.allocated_quantity) : row.reason)}</td><td>${escapeHtml(row.follow_up_status)}</td></tr>`).join("")}</tbody></table></div></section>` : "";
    return [
      table(payload.items.filter((item) => item.item_type === "regular"), "一般週補貨（必要調撥）"),
      table(payload.items.filter((item) => item.item_type === "special_stock"), "建議調撥（非必要）", "單人被套各材質前2名花色；可依現場判斷填0。"),
      table(payload.items.filter((item) => item.item_type === "activity_gift"), "活動／贈品調撥"),
      table(payload.items.filter((item) => item.item_type === "consumable"), "門市耗材補貨", "提袋請以100個為單位調整。"),
      shortageTable,
      manualForm
    ].join("");
  }

  let manualLookupTimer = 0;
  function refreshDialogQuantityWarnings() {
    const detail = $("batch-detail");
    const rows = [...detail.querySelectorAll("tr[data-item-type]")];
    const inputSelector = state.config.role === "store" ? "[data-confirmed]" : "[data-approved]";
    const reasonSelector = state.config.role === "store" ? "[data-reason]" : "[data-hq-reason]";
    const totals = new Map();
    rows.forEach((row) => {
      const input = row.querySelector(inputSelector);
      if (!input) return;
      totals.set(row.dataset.sku, (totals.get(row.dataset.sku) || 0) + Math.max(0, Number(input.value || 0)));
    });
    let blocking = 0;
    rows.forEach((row) => {
      const input = row.querySelector(inputSelector), warning = row.nextElementSibling?.matches("[data-quantity-warning]") ? row.nextElementSibling : null;
      if (!input || !warning) return;
      const quantity = Math.max(0, Number(input.value || 0));
      const suggested = Number(row.dataset.suggested || 0);
      const comparisonBase = state.config.role === "store" ? suggested : Number(row.dataset.reviewBase || 0);
      const reason = row.querySelector(reasonSelector)?.value.trim() || "";
      const supplyKnown = row.dataset.supplyKnown === "true";
      const ceiling = Number(row.dataset.supplyCeiling || 0);
      const otherAllocated = state.config.role === "store" ? Number(row.dataset.otherAllocated || 0) : 0;
      const total = Number(totals.get(row.dataset.sku) || 0) + otherAllocated;
      const extra = Math.max(0, quantity - suggested);
      const projectionText = quantityProjectionText(row, quantity);
      let tone = "", title = "", copy = "";
      if (supplyKnown && total > ceiling) {
        tone = "danger"; blocking += 1;
        if (state.config.role === "store") {
          title = `總倉供應量不足：${row.dataset.sku} 無法以目前數量送出`;
          copy = "請降低申請量後再送出；修改後系統會重新估算可售至，超出部分不會轉入缺貨未配。";
        } else {
          title = `總倉數量不足：${row.dataset.sku} 超過本批可供應量 ${total - ceiling} 件`;
          copy = `總倉本批最多可供應 ${ceiling} 件；目前各門市合計 ${total} 件。請修改數量，超出部分不會轉入缺貨未配。`;
        }
      } else if (quantity !== comparisonBase && !reason) {
        tone = "danger"; blocking += 1;
        title = quantity > comparisonBase ? "人工追加量尚未填寫原因" : "人工減量尚未填寫原因";
        copy = `請填寫具體調整原因後再暫存、送出或核准；${projectionText}。`;
      } else if (extra > 0) {
        tone = "warning";
        title = `系統未建議追加量：${extra} 件`;
        copy = `${row.dataset.systemReason || `本輪系統需求為 ${suggested} 件`}；${projectionText}。`;
      } else if (row.dataset.manual === "true") {
        tone = "info";
        title = "人工新增品項的系統未建議原因";
        copy = `${row.dataset.systemReason || "本批次依現行規則未形成補貨需求"}；${projectionText}。`;
      }
      warning.hidden = !tone;
      warning.className = `decision-warning-row${tone ? ` ${tone}` : ""}`;
      warning.querySelector("td").innerHTML = tone ? `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span>` : "";
    });
    detail.querySelectorAll('[data-action="save"], [data-action="submit"], [data-action="approve"]').forEach((button) => { button.disabled = blocking > 0; });
    const status = detail.querySelector("#dialog-status");
    if (status && blocking > 0) status.textContent = `尚有 ${blocking} 筆數量或原因未通過檢核。`;
    else if (status && /尚有 \d+ 筆數量或原因未通過檢核/.test(status.textContent)) status.textContent = "數量檢核完成，可以繼續操作。";
  }

  function updateManualFormProjection() {
    const detail = $("batch-detail"), skuInput = detail.querySelector("[data-manual-sku]"), output = detail.querySelector("[data-manual-projection]");
    if (!skuInput || !output || !skuInput.dataset.lookupSku) return;
    const quantity = Number(detail.querySelector("[data-manual-quantity]").value || 0);
    const item = { item_type: detail.querySelector("[data-manual-type]").value, calculation_date: skuInput.dataset.calculationDate, base_quantity: Number(skuInput.dataset.base || 0), daily_usage: Number(skuInput.dataset.daily || 0), display_gap: Number(skuInput.dataset.displayGap || 0), system_projection: skuInput.dataset.systemProjection || "", manual: true };
    const warning = detail.querySelector("[data-manual-supply-warning]"), addButton = detail.querySelector('[data-local-action="add-item"]');
    const maximum = Math.max(0, Number(skuInput.dataset.hqReleasable || 0) - Number(skuInput.dataset.otherAllocated || 0));
    const supplyExceeded = skuInput.dataset.supplyKnown === "true" && quantity > maximum;
    const projectionQuantity = supplyExceeded ? maximum : quantity;
    output.textContent = quantity > 0 ? `${supplyExceeded ? "依可供應上限" : state.config.role === "store" ? "申請後" : "核准後"}預估可售至：${rowProjection(item, projectionQuantity)}` : "請輸入本次數量";
    warning.hidden = !supplyExceeded;
    warning.textContent = supplyExceeded
      ? state.config.role === "store"
        ? `總倉供應量不足：${skuInput.dataset.lookupSku}無法以目前數量加入，請降低申請量後重試。`
        : `總倉數量不足：本店目前最多可核准 ${maximum} 件，輸入 ${quantity} 件；請修改數量後再加入。`
      : "";
    addButton.disabled = supplyExceeded;
  }

  async function lookupManualItemFact() {
    const detail = $("batch-detail"), status = detail.querySelector("[data-manual-status]");
    const storeCode = state.config.role === "store" ? state.config.storeCode : detail.querySelector("[data-manual-store]").value;
    const skuInput = detail.querySelector("[data-manual-sku]"), nameInput = detail.querySelector("[data-manual-name]"), output = detail.querySelector("[data-manual-projection]"), systemReasonOutput = detail.querySelector("[data-manual-system-reason]");
    const sku = skuInput.value.normalize("NFKC").trim().toUpperCase();
    skuInput.value = sku;
    ["lookupSku", "lookupStore", "calculationDate", "base", "daily", "displayGap", "systemProjection", "systemReason", "hqAvailable", "hqReserve", "hqReleasable", "supplyKnown", "otherAllocated"].forEach((key) => { delete skuInput.dataset[key]; });
    const supplyWarning = detail.querySelector("[data-manual-supply-warning]"); supplyWarning.hidden = true; supplyWarning.textContent = "";
    detail.querySelector('[data-local-action="add-item"]').disabled = false;
    nameInput.value = ""; output.textContent = "正在查找批次基準…"; systemReasonOutput.textContent = "正在查找系統判斷…";
    if (!/^[A-Z0-9][A-Z0-9._/-]{0,79}$/.test(sku)) { output.textContent = "請輸入完整ERP品號"; systemReasonOutput.textContent = "請先輸入完整ERP品號"; return null; }
    try {
      const fact = await api(`/batches/${encodeURIComponent(state.activeBatch.batch.id)}/manual-item-fact?store=${encodeURIComponent(storeCode)}&sku=${encodeURIComponent(sku)}`);
      if (skuInput.value !== sku || (state.config.role !== "store" && detail.querySelector("[data-manual-store]").value !== storeCode)) return null;
      nameInput.value = fact.productName;
      Object.assign(skuInput.dataset, { lookupSku: fact.sku, lookupStore: fact.storeCode, calculationDate: fact.calculationDate, base: String(fact.baseQuantity), daily: String(fact.dailyUsage), displayGap: String(fact.displayGap), systemProjection: fact.systemProjection || "", systemReason: fact.systemReason || "", autoExcluded: String(fact.autoExcluded === true), exclusionReason: fact.exclusionReason || "", hqAvailable: String(fact.hqAvailable || 0), hqReserve: String(fact.hqReserve || 0), hqReleasable: String(fact.hqReleasable || 0), supplyKnown: String(fact.supplyKnown === true), otherAllocated: String(fact.otherAllocated || 0) });
      systemReasonOutput.textContent = state.config.role === "store" ? storeFacingSystemReason(fact.systemReason, 0) : fact.systemReason || "本批次未保存系統未建議原因";
      status.textContent = fact.autoExcluded ? `${fact.storeCode}／${fact.sku} 原屬自動排除品；仍可人工申請，送出後會以黃色標示供總部覆核。` : `${fact.storeCode}／${fact.sku} 已帶入批次建立時的庫存、近42天銷售及總倉可供應基準。`;
      updateManualFormProjection();
      return fact;
    } catch (error) {
      output.textContent = "無法推估"; systemReasonOutput.textContent = "無法取得系統判斷"; status.textContent = error.message; return null;
    }
  }

  function scheduleManualItemLookup() {
    clearTimeout(manualLookupTimer);
    manualLookupTimer = setTimeout(() => { lookupManualItemFact(); }, 350);
  }

  async function addManualItem() {
    const detail = $("batch-detail"), status = detail.querySelector("[data-manual-status]");
    const storeCode = state.config.role === "store" ? state.config.storeCode : detail.querySelector("[data-manual-store]").value;
    const type = detail.querySelector("[data-manual-type]").value;
    const skuInput = detail.querySelector("[data-manual-sku]"), nameInput = detail.querySelector("[data-manual-name]");
    const quantityInput = detail.querySelector("[data-manual-quantity]"), reasonInput = detail.querySelector("[data-manual-reason]");
    const sku = skuInput.value.normalize("NFKC").trim().toUpperCase();
    if (skuInput.dataset.lookupSku !== sku || skuInput.dataset.lookupStore !== storeCode) {
      if (!await lookupManualItemFact()) return;
    }
    const productName = nameInput.value.normalize("NFKC").trim();
    const quantity = Number(quantityInput.value), reason = reasonInput.value.normalize("NFKC").trim();
    if (!sku || !productName || !Number.isSafeInteger(quantity) || quantity <= 0 || !reason) { status.textContent = "請填妥ERP品號、品名、1以上整數數量與新增原因。"; return; }
    if (type === "consumable" && quantity % 100 !== 0) { status.textContent = "提袋耗材數量須為100的倍數。"; return; }
    const maximum = Math.max(0, Number(skuInput.dataset.hqReleasable || 0) - Number(skuInput.dataset.otherAllocated || 0));
    if (skuInput.dataset.supplyKnown === "true" && quantity > maximum) {
      status.textContent = state.config.role === "store" ? `${sku}總倉供應量不足，無法以目前數量加入；請降低申請量。` : `${sku}總倉數量不足，本店目前最多可核准${maximum}件；請修改數量。`;
      return;
    }
    const duplicate = [...detail.querySelectorAll("tbody tr")].some((row) => row.dataset.store === storeCode && row.dataset.sku === sku && row.dataset.itemType === type);
    if (duplicate) { status.textContent = `${storeCode}／${sku}已在清單中，請直接修改該列數量。`; return; }
    const labels = { regular: "一般必要補貨", special_stock: "建議調撥", activity_gift: "活動／贈品", consumable: "提袋耗材" };
    const row = document.createElement("tr");
    const projectionItem = { item_type: type, calculation_date: skuInput.dataset.calculationDate, base_quantity: Number(skuInput.dataset.base || 0), daily_usage: Number(skuInput.dataset.daily || 0), display_gap: Number(skuInput.dataset.displayGap || 0), system_projection: skuInput.dataset.systemProjection || "", manual: true };
    const internalSystemReason = skuInput.dataset.systemReason || "本批次未保存系統未建議原因";
    const systemReason = state.config.role === "store" ? storeFacingSystemReason(internalSystemReason, 0) : internalSystemReason;
    const autoExcluded = skuInput.dataset.autoExcluded === "true";
    row.classList.toggle("manual-excluded-item", autoExcluded);
    row.dataset.storeRow = ""; row.dataset.store = storeCode; row.dataset.sku = sku; row.dataset.suggested = "0"; row.dataset.reviewBase = "0"; row.dataset.savedQuantity = ""; row.dataset.savedReason = ""; row.dataset.autoExcluded = autoExcluded ? "true" : "false"; row.dataset.supplyKnown = skuInput.dataset.supplyKnown || "false"; row.dataset.supplyCeiling = skuInput.dataset.hqReleasable || "0"; row.dataset.otherAllocated = skuInput.dataset.otherAllocated || "0"; row.dataset.allocationRow = ""; row.dataset.allocationQuantity = String(quantity); row.dataset.productName = productName; row.dataset.itemType = type; row.dataset.calculationDate = projectionItem.calculation_date; row.dataset.base = String(projectionItem.base_quantity); row.dataset.daily = String(projectionItem.daily_usage); row.dataset.displayGap = String(projectionItem.display_gap); row.dataset.systemProjection = projectionItem.system_projection; row.dataset.systemReason = systemReason; row.dataset.manual = "true";
    row.className = autoExcluded ? "item-warning" : "item-human-change";
    row.innerHTML = `<td>${storeCode}</td><td>${escapeHtml(sku)}<span class="manual-item-badge${autoExcluded ? " warn" : ""}">${autoExcluded ? "自動排除・人工申請" : "人工新增"}</span><span class="change-badges" data-change-badges><span>人工新增</span><span>待暫存</span></span></td><td>${escapeHtml(productName)}</td><td>${labels[type]}</td><td>0</td><td class="decision-reason-cell">${escapeHtml(systemReason)}</td><td>${state.config.role === "store" ? `<input data-confirmed type="number" min="1" step="${type === "consumable" ? 100 : 1}" value="${quantity}">` : `<input data-confirmed type="number" value="0" disabled><input data-approved type="number" min="1" step="${type === "consumable" ? 100 : 1}" value="${quantity}">`}</td><td data-${state.config.role === "store" ? "confirmed" : "approved"}-projection>${state.config.role === "store" ? "申請後" : "核准後"}預估可售至：${escapeHtml(rowProjection(projectionItem, quantity))}</td><td>${state.config.role === "store" ? `<textarea data-reason class="reason-input" rows="2" maxlength="300">${escapeHtml(reason)}</textarea>` : `<input data-reason type="hidden" value=""><textarea data-hq-reason class="reason-input" rows="2" maxlength="300">${escapeHtml(reason)}</textarea>`}</td><td><button class="secondary-button compact remove-item-button" type="button" data-remove-unsaved>取消新增</button></td>`;
    const warning = document.createElement("tr"); warning.className = "decision-warning-row"; warning.dataset.quantityWarning = ""; warning.hidden = true; warning.innerHTML = '<td colspan="10"></td>';
    detail.querySelector("[data-manual-rows]").append(row, warning);
    row.querySelectorAll("textarea.reason-input").forEach(autoSizeReasonField);
    applyResultFilters("batch");
    skuInput.value = ""; nameInput.value = ""; quantityInput.value = ""; reasonInput.value = ""; detail.querySelector("[data-manual-projection]").textContent = "請先輸入品號與數量"; detail.querySelector("[data-manual-system-reason]").textContent = "請先輸入品號";
    status.textContent = `${storeCode}／${sku}已加入畫面；按暫存、送出或核准後才會正式保存。`;
    refreshDialogQuantityWarnings();
  }

  function removeDialogItem(button) {
    const row = button.closest("tr"), mode = button.dataset.mode;
    const quantityInput = row.querySelector(mode === "hq" ? "[data-approved]" : "[data-confirmed]");
    const reasonInput = row.querySelector(mode === "hq" ? "[data-hq-reason]" : "[data-reason]");
    if (row.classList.contains("item-marked-removed")) {
      quantityInput.value = row.dataset.restoreQuantity || row.dataset.reviewBase || row.dataset.suggested || "0";
      reasonInput.placeholder = "未調整可留白";
    } else {
      row.dataset.restoreQuantity = quantityInput.value;
      quantityInput.value = "0";
      reasonInput.placeholder = "請填寫移除原因";
    }
    updateDialogProjection({ target: quantityInput });
    refreshSkuFilterSummary("batch");
    applyRowChangeState(row);
    if (Number(quantityInput.value) === 0 && !reasonInput.value.trim()) reasonInput.focus();
  }

  function applyRowChangeState(row) {
    const quantityInput = row.querySelector(state.config.role === "store" ? "[data-confirmed]" : "[data-approved]");
    const reasonInput = row.querySelector(state.config.role === "store" ? "[data-reason]" : "[data-hq-reason]");
    if (!quantityInput || !reasonInput) return;
    const quantity = Number(quantityInput.value || 0);
    const comparisonBase = state.config.role === "store" ? Number(row.dataset.suggested || 0) : Number(row.dataset.reviewBase || 0);
    const suggested = Number(row.dataset.suggested || 0);
    const manual = row.dataset.manual === "true";
    const removed = comparisonBase > 0 && quantity === 0;
    const adjusted = quantity !== comparisonBase;
    const warning = row.dataset.autoExcluded === "true" || (!manual && quantity > suggested);
    const pending = String(quantity) !== String(row.dataset.savedQuantity ?? "") || reasonInput.value !== (row.dataset.savedReason || "");
    row.classList.toggle("item-marked-removed", removed);
    row.classList.toggle("item-warning", warning);
    row.classList.toggle("item-human-change", !warning && (manual || adjusted));
    const labels = [removed ? "已取消" : "", manual ? "人工新增" : "", adjusted && !removed && !manual ? `數量已調整 ${comparisonBase}→${quantity}` : "", pending ? "待暫存" : ((manual || adjusted) ? "已暫存" : "")].filter(Boolean);
    const badgeBox = row.querySelector("[data-change-badges]");
    if (badgeBox) badgeBox.innerHTML = labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("");
    const button = row.querySelector("[data-remove-item]");
    if (button) button.textContent = removed ? "恢復此品項" : "移除此品項";
  }

  function updateDialogProjection(event) {
    const input = event.target.closest("[data-confirmed], [data-approved]");
    if (!input) return;
    const row = input.closest("tr");
    const item = { item_type: row.dataset.itemType, calculation_date: row.dataset.calculationDate, base_quantity: Number(row.dataset.base), daily_usage: Number(row.dataset.daily), display_gap: Number(row.dataset.displayGap), system_projection: row.dataset.systemProjection, manual: row.dataset.manual === "true" };
    const target = input.matches("[data-approved]") ? row.querySelector("[data-approved-projection]") : row.querySelector("[data-confirmed-projection]");
    if (target) target.textContent = `${input.matches("[data-approved]") ? "核准後" : "申請後"}預估可售至：${rowProjection(item, Number(input.value || 0))}`;
    refreshDialogQuantityWarnings();
  }

  function approvedCorrectionPanel(payload) {
    if (state.config.role === "store" || payload.batch.status !== "approved") return "";
    const eligible = payload.storeStatuses.filter((row) => row.status === "approved" && !row.erp_created_at);
    if (!eligible.length) return "";
    const options = eligible.map((row) => `<option value="${row.store_code}">${row.store_code} ${escapeHtml(state.config.stores[row.store_code]?.name || "")}</option>`).join("");
    return `<section class="approved-correction-panel"><h3>已核准內容需要修改</h3><p>選擇門市並填寫原因。尚未產生ERP才能開啟；原核准內容會保留為更正版本。</p><div class="approved-correction-controls"><label><span>門市</span><select data-correction-store>${options}</select></label><label><span>更正原因</span><input data-correction-reason maxlength="300" placeholder="必填，例如：門市補充實際需求"></label><button class="secondary-button" type="button" data-action="open-hq-correction">開啟總部更正</button><button class="secondary-button" type="button" data-action="return-store">退回門市修改</button></div></section>`;
  }

  function detailActions(payload) {
    const ownState = payload.storeStatuses.find((row) => row.store_code === state.config.storeCode);
    const ownStatus = ownState?.status;
    if (state.config.role === "store" && ["open", "review"].includes(payload.batch.status) && ownStatus === "submitted" && Date.now() < Date.parse(payload.batch.lock_at)) return '<button class="secondary-button" type="button" data-action="withdraw">撤回修改</button>';
    if (state.config.role === "store" && ["open", "review"].includes(payload.batch.status) && ownStatus !== "submitted" && (Date.now() < Date.parse(payload.batch.lock_at) || ownState?.correction_mode === "store")) return '<button class="secondary-button" type="button" data-action="save">暫存</button><button class="primary-button" type="button" data-action="submit">送出總部覆核</button>';
    if (state.config.role !== "store" && ["open", "review"].includes(payload.batch.status)) return '<button class="secondary-button" type="button" data-action="hq-save">暫存覆核</button><button class="primary-button" type="button" data-action="approve">核准本週調撥</button>';
    if (state.config.role !== "store" && ["approved", "erp_created"].includes(payload.batch.status)) {
      const erpButtons = [...new Set(payload.items.map((item) => item.store_code))].map((store) => { const done = payload.storeStatuses.find((row) => row.store_code === store)?.erp_created_at; return `<button class="secondary-button" type="button" data-action="erp" data-store="${store}">${done ? "重新下載" : "下載"}${store} ERP檔</button>`; }).join("");
      if (payload.batch.status === "erp_created") return `${erpButtons}<button class="primary-button" type="button" data-action="close">標記本週批次完成</button>`;
      return erpButtons;
    }
    return "";
  }

  function statusOverview(payload) {
    if (state.config.role === "store") return "";
    const labels = { pending: "尚未處理", saved: "已暫存", submitted: "已送出", approved: "已核准", closed: "已完成" };
    return `<section class="store-status-overview"><h3>門市回覆與ERP狀態</h3><p>可直接點選門市卡片，只查看該店調撥內容。</p><div class="status-grid">${payload.storeStatuses.map((row) => { const correctionLabel = row.correction_mode === "store" ? "總部退回・待門市修改" : row.correction_mode === "hq" ? "總部更正中" : labels[row.status] || row.status; return `<button class="store-status-card" type="button" data-store-status="${row.store_code}" data-store-filter="${row.store_code}" data-store-filter-scope="batch"><strong>${row.store_code} ${escapeHtml(state.config.stores[row.store_code]?.name || "")}</strong><span>${escapeHtml(correctionLabel)}</span><small>${row.erp_created_at ? `ERP已產生・${escapeHtml(row.erp_created_at)}` : "ERP尚未產生"}</small></button>`; }).join("")}</div></section>`;
  }

  async function openBatch(id) {
    const query = state.config.storeCode ? `?store=${state.config.storeCode}` : "";
    state.activeBatch = await api(`/batches/${encodeURIComponent(id)}${query}`);
    const p = state.activeBatch;
    state.batchStore = state.config.role === "store" ? state.config.storeCode : "all";
    state.batchSku = "";
    const storeCodes = p.storeStatuses.map((row) => row.store_code);
    const supersededNotice = p.batch.status === "cancelled" ? '<p class="result-alert warn"><strong>本批次已被新版取代。</strong>資料仍完整保留供查閱，但門市與總部都不能再修改、送出或核准。</p>' : "";
    const schedule = (() => { try { return JSON.parse(p.batch.arrival_schedule || "{}"); } catch { return {}; } })();
    const scheduleText = Object.values(schedule).map((row) => `${row.storeCode} 本批${row.currentArrivalDate}／下一輪${row.nextArrivalDate}`).join("；");
    const activeCorrection = p.storeStatuses.find((row) => row.correction_mode);
    const correctionNotice = activeCorrection ? `<p class="result-alert warn"><strong>${activeCorrection.correction_mode === "store" ? "已退回門市修改" : "總部更正中"}：</strong>${escapeHtml(activeCorrection.store_code)}・第${escapeHtml(activeCorrection.correction_revision)}版・${escapeHtml(activeCorrection.correction_reason || "未填原因")}。原核准內容已保留，重新核准後才可產生ERP。</p>` : "";
    $("batch-detail").innerHTML = `<p class="eyebrow">${escapeHtml(p.batch.week_key)}</p><h2>${escapeHtml(p.batch.id)}</h2><p>門市回覆鎖定：${escapeHtml(p.batch.lock_at)}・批次狀態：${escapeHtml(batchStatusLabel(p.batch.status))}</p>${scheduleText ? `<p class="status-line">到店日快照：${escapeHtml(scheduleText)}</p>` : ""}${supersededNotice}${correctionNotice}${storeFilterBar("batch", storeCodes, state.batchStore)}${skuFilterBar("batch", state.batchSku)}${approvedCorrectionPanel(p)}${statusOverview(p)}${itemTable(p)}<div class="detail-actions">${detailActions(p)}</div><p id="dialog-status" class="status-line"></p>`;
    $("batch-detail").querySelectorAll("textarea.reason-input").forEach(autoSizeReasonField);
    $("batch-dialog").showModal();
    applyStoreFilter("batch", state.batchStore);
    refreshDialogQuantityWarnings();
  }

  function rowsFromDialog(mode) {
    return [...$("batch-detail").querySelectorAll("tbody tr[data-item-type]")].map((row) => ({ storeCode: row.dataset.store, sku: row.dataset.sku, productName: row.dataset.productName, itemType: row.dataset.itemType, ...(mode === "approve" ? { approvedQuantity: Number(row.querySelector("[data-approved]").value), reason: row.querySelector("[data-hq-reason]").value } : { confirmedQuantity: Number(row.querySelector("[data-confirmed]").value), reason: row.querySelector("[data-reason]").value }) }));
  }

  async function handleDialog(event) {
    const detailToggle = event.target.closest("[data-detail-target]");
    if (detailToggle) { toggleDecisionDetail(detailToggle); return; }
    const filterButton = event.target.closest('[data-store-filter-scope="batch"]');
    if (filterButton) { applyStoreFilter("batch", filterButton.dataset.storeFilter); return; }
    const clearSku = event.target.closest('[data-clear-sku-filter="batch"]');
    if (clearSku) {
      const input = $("batch-detail").querySelector('[data-sku-filter-scope="batch"]');
      if (input) input.value = "";
      applySkuFilter("batch", "");
      return;
    }
    const localAction = event.target.closest("[data-local-action]");
    if (localAction?.dataset.localAction === "add-item") { await addManualItem(); return; }
    const unsavedRemove = event.target.closest("[data-remove-unsaved]");
    if (unsavedRemove) { const row = unsavedRemove.closest("tr"), warning = row.nextElementSibling?.matches("[data-quantity-warning]") ? row.nextElementSibling : null; warning?.remove(); row.remove(); refreshSkuFilterSummary("batch"); refreshDialogQuantityWarnings(); return; }
    const removeItem = event.target.closest("[data-remove-item]");
    if (removeItem) { removeDialogItem(removeItem); return; }
    const button = event.target.closest("[data-action]"); if (!button) return;
    const action = button.dataset.action, batch = state.activeBatch; button.disabled = true;
    try {
      if (action === "save" || action === "submit") await api(`/batches/${encodeURIComponent(batch.batch.id)}/stores/${state.config.storeCode}/${action}`, { method: "PUT", body: { items: rowsFromDialog(action) } });
      else if (action === "withdraw") await api(`/batches/${encodeURIComponent(batch.batch.id)}/stores/${state.config.storeCode}/withdraw`, { method: "POST", body: {} });
      else if (action === "hq-save") await api(`/batches/${encodeURIComponent(batch.batch.id)}/hq-save`, { method: "PUT", body: { items: rowsFromDialog("approve") } });
      else if (action === "approve") {
        try { await api(`/batches/${encodeURIComponent(batch.batch.id)}/approve`, { method: "POST", body: { items: rowsFromDialog("approve") } }); }
        catch (error) { if (!/尚未送出/.test(error.message) || !confirm(`${error.message}\n\n是否以目前資料繼續核准？`)) throw error; await api(`/batches/${encodeURIComponent(batch.batch.id)}/approve`, { method: "POST", body: { items: rowsFromDialog("approve"), confirmPendingStores: true } }); }
      } else if (action === "erp") {
        const store = button.dataset.store, wb = transferCore.buildErpWorkbook(batch.items, outputXlsx, store);
        outputXlsx.writeFile(wb, `${batch.batch.week_key}_${store}_ERP調撥單.xlsx`, { compression: true });
        await api(`/batches/${encodeURIComponent(batch.batch.id)}/erp-created`, { method: "POST", body: { storeCode: store } });
        $("dialog-status").textContent = `${store} ERP調撥檔已下載並記錄；調出與調入倉請在ERP下拉選單人工指定。`;
        $("batch-dialog").close(); await openBatch(batch.batch.id); await loadBatches(); return;
      } else if (action === "close") {
        await api(`/batches/${encodeURIComponent(batch.batch.id)}/close`, { method: "POST", body: {} });
      } else if (action === "open-hq-correction" || action === "return-store") {
        const storeCode = $("batch-detail").querySelector("[data-correction-store]")?.value;
        const reason = $("batch-detail").querySelector("[data-correction-reason]")?.value.trim();
        if (!storeCode || !reason) throw new Error("請先選擇門市並填寫更正原因。");
        const label = action === "return-store" ? "退回門市修改" : "開啟總部更正";
        if (!confirm(`確定要將 ${storeCode} 的已核准內容「${label}」嗎？\n\n原核准資料會保留；重新核准前不能產生新版ERP檔。`)) return;
        await api(`/batches/${encodeURIComponent(batch.batch.id)}/corrections/open`, { method: "POST", body: { storeCode, mode: action === "return-store" ? "store" : "hq", reason } });
      }
      $("batch-dialog").close(); await loadBatches();
    } catch (error) { $("dialog-status").textContent = error.message; } finally { button.disabled = false; }
  }

  async function start() {
    try {
      if (!(await checkRuntimeVersion())) return;
      if (!inputXlsx || !outputXlsx || !parser || !transferCore || !googleSources || !xlsxPreflight) throw new Error("工具元件載入失敗，請重新整理頁面。");
      state.config = await api("/config");
      $("account-badge").textContent = `${state.config.email}・${state.config.role === "store" ? state.config.storeCode : state.config.role === "admin" ? "最高權限" : "總部"}`;
      $("refresh-button").disabled = false;
      if (state.config.role === "store") {
        $("store-panel").hidden = false;
        $("batch-list").hidden = true;
        $("store-history").hidden = false;
        $("history-eyebrow").textContent = "歷史紀錄";
        $("history-title").textContent = "門市批次紀錄";
        const store = state.config.stores[state.config.storeCode];
        $("page-title").innerHTML = "本週調撥，<br>確認自己的門市就好。";
        $("hero-description").textContent = "查看系統建議、調整數量並送出總部審核；本店展示例外從固定入口另外維護。";
        $("store-identity").textContent = `${state.config.storeCode} ${store.name}；只會顯示本店資料。`;
      }
      else {
        $("hq-panel").hidden = false; renderStores(); defaults();
        if (state.config.permissions?.canManageRules) { $("rules-link").hidden = false; $("transfer-rules-link").hidden = false; }
        if (!state.config.googleOAuthClientId) { $("google-connect-button").disabled = true; $("source-status").textContent = "正式環境尚未設定 Google OAuth，用手動備援仍可操作。"; }
      }
      await Promise.all([loadBatches(), loadPendingPurchases(), ...(state.config.permissions?.canCollaborate ? [loadCollaborationDrafts()] : [])]);
      if (state.config.role === "store" && location.hash === "#display-exceptions") await showDisplayExceptions();
    } catch (error) { $("account-badge").textContent = "公司帳號驗證失敗"; $("batch-list").innerHTML = accountRecovery(error); }
  }

  document.querySelectorAll('input[type="file"]').forEach((input) => input.addEventListener("change", updateFile));
  $("reload-latest-button").addEventListener("click", () => {
    const url = new URL(window.location.href);
    url.searchParams.set("deploy", state.latestRuntimeVersion || String(Date.now()));
    window.location.replace(url.toString());
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkRuntimeVersion(); });
  window.addEventListener("focus", checkRuntimeVersion);
  window.setInterval(checkRuntimeVersion, 5 * 60 * 1000);
  $("refresh-button").addEventListener("click", () => loadBatches().catch((error) => { $("batch-list").innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`; }));
  $("calculate-button").addEventListener("click", () => calculate().catch((error) => { $("hq-status").textContent = error.message; $("calculate-button").disabled = false; }));
  $("publish-button").addEventListener("click", () => publish().catch((error) => { $("hq-status").textContent = error.message; }));
  $("publish-collaboration-button").addEventListener("click", () => publishCollaboration().catch((error) => { $("hq-status").textContent = error.message; }));
  $("refresh-collaboration-button").addEventListener("click", () => loadCollaborationDrafts().catch((error) => { $("collaboration-status").textContent = error.message; }));
  $("google-connect-button").addEventListener("click", () => authorizeGoogle().catch((error) => { $("source-status").textContent = error.message; }));
  $("auto-source-button").addEventListener("click", () => loadGoogleSources().catch((error) => { $("source-status").textContent = `自動取得失敗：${error.message}；可改用手動備援。`; }));
  $("show-display-exceptions").addEventListener("click", () => showDisplayExceptions().catch((error) => { $("display-exception-page-status").textContent = error.message; }));
  $("hide-display-exceptions").addEventListener("click", hideDisplayExceptions);
  $("add-display-exception").addEventListener("click", () => openDisplayExceptionDialog());
  document.querySelectorAll("[data-close-display-exception]").forEach((button) => button.addEventListener("click", () => $("display-exception-dialog").close()));
  $("display-exception-form").addEventListener("submit", saveDisplayException);
  $("display-exception-search").addEventListener("input", renderDisplayExceptions);
  $("display-exception-status-filter").addEventListener("change", renderDisplayExceptions);
  $("display-exception-rows").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-display-exception]");
    if (edit) { openDisplayExceptionDialog((state.config.displayExceptions || []).find((item) => item.sku === edit.dataset.editDisplayException)); return; }
    const toggle = event.target.closest("[data-toggle-display-exception]");
    if (toggle) toggleDisplayException(toggle.dataset.toggleDisplayException).catch((error) => { $("display-exception-page-status").textContent = error.message; });
  });
  $("week-key").addEventListener("change", () => applyScheduleForWeek($("week-key").value));
  document.querySelectorAll('input[name="calculation-mode"]').forEach((input) => input.addEventListener("change", () => {
    if (!state.calculation) return;
    state.calculation = null; state.formalCalculation = null;
    $("calculation-results").hidden = true;
    $("comparison-downloads").hidden = true;
    $("formal-downloads").hidden = true;
    $("publish-button").textContent = "建立門市確認批次";
    $("hq-status").textContent = "計算模式已變更，請重新產生建議。";
  }));
  document.addEventListener("click", (event) => {
    const notificationButton = event.target.closest("[data-send-batch-notifications]");
    if (notificationButton) {
      notificationButton.disabled = true;
      sendBatchNotifications(notificationButton.dataset.sendBatchNotifications)
        .then((result) => { $("hq-status").textContent = `已補寄${result.sent}封門市通知信。`; return loadBatches(); })
        .catch((error) => { $("hq-status").textContent = error.message; return loadBatches(); })
        .finally(() => { notificationButton.disabled = false; });
      return;
    }
    const deleteButton = event.target.closest("[data-delete-batch]");
    if (deleteButton) {
      deleteBatchFromHistory(deleteButton).catch((error) => { $("batch-list").insertAdjacentHTML("afterbegin", `<p class="empty-state">${escapeHtml(error.message)}</p>`); });
      return;
    }
    const button = event.target.closest("[data-open-batch]");
    if (button) openBatch(button.dataset.openBatch).catch((error) => { $("batch-list").innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`; });
    const collaborationButton = event.target.closest("[data-open-collaboration]");
    if (collaborationButton) openCollaboration(collaborationButton.dataset.openCollaboration).catch((error) => { $("collaboration-status").textContent = error.message; });
    const deleteCollaborationButton = event.target.closest("[data-delete-collaboration]");
    if (deleteCollaborationButton) deleteCollaborationDraft(deleteCollaborationButton).catch((error) => { $("collaboration-status").textContent = error.message; });
  });
  $("batch-detail").addEventListener("click", handleDialog);
  $("batch-detail").addEventListener("input", (event) => {
    if (event.target.matches('[data-sku-filter-scope="batch"]')) { applySkuFilter("batch", event.target.value); return; }
    if (event.target.matches("textarea.reason-input")) autoSizeReasonField(event.target);
    updateDialogProjection(event);
    if (event.target.matches("[data-manual-sku]")) scheduleManualItemLookup();
    if (event.target.matches("[data-manual-quantity]")) updateManualFormProjection();
    if (event.target.matches("[data-approved], [data-confirmed]")) refreshSkuFilterSummary("batch");
    if (event.target.matches("[data-approved], [data-confirmed], [data-reason], [data-hq-reason]")) applyRowChangeState(event.target.closest("tr"));
    if (event.target.matches("[data-reason], [data-hq-reason]")) refreshDialogQuantityWarnings();
  });
  $("batch-detail").addEventListener("change", (event) => {
    if (event.target.matches("[data-manual-store]")) scheduleManualItemLookup();
    if (event.target.matches("[data-manual-type]")) {
      const quantity = $("batch-detail").querySelector("[data-manual-quantity]");
      quantity.step = event.target.value === "consumable" ? "100" : "1";
      updateManualFormProjection();
    }
  });
  $("collaboration-detail").addEventListener("click", handleCollaborationDialog);
  $("collaboration-detail").addEventListener("change", handleCollaborationDialog);
  $("calculation-results").addEventListener("click", (event) => {
    const detailToggle = event.target.closest("[data-detail-target]");
    if (detailToggle) { toggleDecisionDetail(detailToggle); return; }
    const clearSku = event.target.closest('[data-clear-sku-filter="calculation"]');
    if (clearSku) {
      const input = $("calculation-results").querySelector('[data-sku-filter-scope="calculation"]');
      if (input) input.value = "";
      applySkuFilter("calculation", "");
      return;
    }
    const formalDownloadButton = event.target.closest("#download-formal-reports");
    if (formalDownloadButton) {
      formalDownloadButton.disabled = true;
      try { downloadFormalReports(); }
      catch (error) { $("hq-status").textContent = error.message; }
      finally { formalDownloadButton.disabled = false; }
      return;
    }
    const downloadButton = event.target.closest("[data-download-comparison]");
    if (downloadButton) {
      downloadButton.disabled = true;
      try { downloadComparison(downloadButton.dataset.downloadComparison); }
      catch (error) { $("hq-status").textContent = error.message; }
      finally { downloadButton.disabled = false; }
      return;
    }
    const filterButton = event.target.closest('[data-store-filter-scope="calculation"]');
    if (filterButton) applyStoreFilter("calculation", filterButton.dataset.storeFilter);
  });
  $("calculation-results").addEventListener("input", (event) => {
    if (event.target.matches('[data-sku-filter-scope="calculation"]')) applySkuFilter("calculation", event.target.value);
  });
  start();
})();

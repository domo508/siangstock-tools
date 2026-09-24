(function () {
  "use strict";

  const core = globalThis.ProcurementPlanningCore;
  const googleSources = globalThis.ProcurementGoogleSources;
  const outputXlsx = globalThis.ProcurementXlsxWriter || globalThis.XLSX;
  const MODEL_CACHE = Object.freeze({ database: "siangstock-procurement-local", store: "files", key: "seasonal-model", refreshMonths: 6 });
  const WORKFLOW_CACHE = Object.freeze({ key: "procurement-workflow-drafts", version: 1, maxRecords: 30 });
  const DEFAULT_COST_RATE = 2659538.3 / 5936068.44;
  const MAX_SEASONAL_SOURCE_BYTES = 45 * 1024 * 1024;
  const state = {
    config: null, masterFile: null, masterWorkbook: null, inventoryFile: null, pendingFiles: [], transferFile: null,
    consignmentFile: null, consignmentWorkbook: null, lirongConsignmentFile: null, lirongConsignmentWorkbook: null,
    salesFiles: [], modelFile: null, marketingFile: null, analysis: null, reviewFile: null, firstReview: null,
    secondReviewFile: null, review: null, ledger: null, monthPlan: null, procurementRules: null, revenueChannels: [], budgetDirty: false, sourceMetadata: null, modelMetadata: null, batchId: "", approved: false, erpDownloaded: false,
    selectedSuppliers: new Set(), returnScope: null, consignmentSource: null,
    googleAuthorized: false, modelWorker: null, modelDraft: null,
    baseAnalysis: null, parsedSources: null, workflowType: "system_recommendation",
    newProductFile: null, manualDraftFiles: [], postedOrderFiles: [], storeShortageNeeds: [], storeShortagePermissions: { canDecide: false }, storeShortageRendered: false, shortageRunMode: "merge_next",
    purchaseStatusSummary: null, costSummary: null, sharedCostSnapshot: null, draftId: "", draftStage: "", latestDraft: null, workflowDrafts: [], sharedDrafts: [], sharedDraftId: "", sharedDraftRevision: 0, parentBatchId: "", activeWorkUnit: null, selectedWorkUnitIds: new Set(), forecastCostRate: DEFAULT_COST_RATE
  };

  const get = (selector) => document.querySelector(selector);
  const elements = {
    accountBadge: get("#account-badge"), googleConnect: get("#google-connect-button"), autoSource: get("#auto-source-button"), autoSourceLabel: get("#auto-source-label"),
    autoSourceProgress: get("#auto-source-progress"), sourceStatus: get("#source-status"),
    month: get("#analysis-month"), checkpoint: get("#checkpoint"), orderDate: get("#order-date"), inventoryDate: get("#inventory-date"),
    pendingDate: get("#pending-date"), transferDate: get("#transfer-date"), consignmentDate: get("#consignment-date"), salesDate: get("#sales-date"),
    masterFile: get("#master-file"), inventoryFile: get("#inventory-file"), pendingFiles: get("#pending-files"), transferFile: get("#transfer-file"), consignmentFile: get("#consignment-file"),
    lirongConsignmentFile: get("#lirong-consignment-file"), salesFiles: get("#sales-files"), modelFile: get("#model-file"), marketingFile: get("#marketing-file"),
    masterFileName: get("#master-file-name"), inventoryFileName: get("#inventory-file-name"), pendingFilesName: get("#pending-files-name"), transferFileName: get("#transfer-file-name"),
    consignmentFileName: get("#consignment-file-name"), lirongConsignmentFileName: get("#lirong-consignment-file-name"), salesFilesName: get("#sales-files-name"),
    modelFileName: get("#model-file-name"), modelBadge: get("#model-badge"), marketingFileName: get("#marketing-file-name"), blacklist: get("#blacklist-input"),
    modelRunBadge: get("#model-run-badge"), modelRefresh: get("#model-refresh-button"), modelRefreshLabel: get("#model-refresh-label"),
    modelDownloadDraft: get("#model-download-draft-button"), modelApprove: get("#model-approve-button"), modelProgressBar: get("#model-progress-bar"),
    modelProgressText: get("#model-progress-text"), modelRunSummary: get("#model-run-summary"),
    blacklistStatus: get("#blacklist-status"), analyze: get("#analyze-button"), download: get("#download-button"), status: get("#main-status"),
    resultPanel: get("#result-panel"), dateCheck: get("#date-check-message"), summaryCards: get("#summary-cards"), resultAlert: get("#result-alert"), resultRows: get("#result-rows"),
    supplierFilterList: get("#supplier-filter-list"), otherSupplierFilterList: get("#other-supplier-filter-list"), otherSupplierGroup: get("#other-supplier-group"), otherSupplierSummary: get("#other-supplier-summary"),
    supplierScopeStatus: get("#supplier-scope-status"), selectAllSuppliers: get("#select-all-suppliers"), clearSuppliers: get("#clear-suppliers"), workUnitList: get("#work-unit-list"), workUnitTotal: get("#work-unit-total"), workUnitSelectionStatus: get("#work-unit-selection-status"),
    excludedResultPanel: get("#excluded-result-panel"), excludedResultCount: get("#excluded-result-count"), excludedResultRows: get("#excluded-result-rows"),
    forecastRevenue: get("#forecast-revenue"), terminalForecastRevenue: get("#terminal-forecast-revenue"), forecastCost: get("#forecast-cost"), targetEndingCost: get("#target-ending-cost"), openingCost: get("#opening-cost"),
    supplierReturns: get("#supplier-returns"), releasedBudget: get("#released-budget"), purchasedToDate: get("#purchased-to-date"), budgetSourceNote: get("#budget-source-note"),
    saveBudget: get("#save-budget-button"), budgetPlanStatus: get("#budget-plan-status"), budgetSummary: get("#budget-summary"), ledgerStatus: get("#ledger-status"), costBreakdown: get("#cost-breakdown"), costSnapshotStatus: get("#cost-snapshot-status"),
    channelRows: get("#channel-rows"), kuanchengTotal: get("#kuancheng-total"), kuanmuTotal: get("#kuanmu-total"), addChannel: get("#add-channel-button"),
    reviewFile: get("#review-file"), reviewButton: get("#review-button"), secondReviewFile: get("#second-review-file"), confirmReview: get("#confirm-review-button"),
    submitApproval: get("#submit-approval-button"), approve: get("#approve-button"), retryNotification: get("#retry-notification-button"),
    erp: get("#erp-button"), workflowStatus: get("#workflow-status"), workflowSummary: get("#workflow-summary"),
    workflowErrors: get("#workflow-errors"), workflowErrorTitle: get("#workflow-error-title"), workflowErrorList: get("#workflow-error-list"),
    approvalQueueRows: get("#approval-queue-rows"), refreshQueue: get("#refresh-queue-button"),
    reviewFileLabel: get("#review-file-label"), secondReviewFileLabel: get("#second-review-file-label"),
    workflowStepDownload: get("#workflow-step-download"), workflowStepFirst: get("#workflow-step-first"), workflowStepSecond: get("#workflow-step-second"), workflowStepApproval: get("#workflow-step-approval"),
    resumeDraftCard: get("#resume-draft-card"), resumeDraftList: get("#resume-draft-list"), sharedDraftList: get("#shared-draft-list"), sharedDraftStatus: get("#shared-draft-status"), refreshSharedDrafts: get("#refresh-shared-drafts-button"), restoreReportFile: get("#restore-report-file"), restoreReportLabel: get("#restore-report-label")
    ,newProductFile: get("#new-product-file"), newProductButton: get("#new-product-button"), manualDraftFiles: get("#manual-draft-files"), manualDraftButton: get("#manual-draft-button"),
    postedOrderFiles: get("#posted-order-files"), postedOrderButton: get("#posted-order-button"), specialWorkflowStatus: get("#special-workflow-status"), activeLedgerRows: get("#active-ledger-rows"), erpReconciliationPanel: get("#erp-reconciliation-panel"), erpReconciliationList: get("#erp-reconciliation-list"),
    storeShortageCard: get("#store-shortage-card"), storeShortageTopCount: get("#store-shortage-top-count"), storeShortageCount: get("#store-shortage-count"), storeShortageEmpty: get("#store-shortage-empty"), storeShortageBatchBar: get("#store-shortage-batch-bar"), storeShortageSelectAll: get("#store-shortage-select-all"), storeShortageSelectedCount: get("#store-shortage-selected-count"), storeShortageTableWrap: get("#store-shortage-table-wrap"), storeShortageRows: get("#store-shortage-rows"), storeShortageStatus: get("#store-shortage-status"), runShortageOrder: get("#run-shortage-order-button")
  };

  function today() { return new Date().toISOString().slice(0, 10); }
  function setInitialDates() { const value = today(); elements.month.value = value.slice(0, 7); elements.orderDate.value = value; }
  function fileLabel(files) {
    if (!files.length) return "尚未選擇";
    if (files.length === 1) return files[0].name;
    return `已選擇${files.length}份：${files.map((file) => file.name).join("、")}`;
  }
  function formatNumber(value) { return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(Number(value || 0)); }
  function formatCurrency(value) { return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(Number(value || 0)); }
  function formatCurrencyPrecise(value) { return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0)); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
  function sourceProof(id, metadata) { return `ID…${String(id || "").slice(-6)}・更新${metadata?.modifiedTime || "依工作表內容"}・抓取${String(metadata?.fetchedAt || "").replace("T", " ").slice(0, 19)}・SHA-256 ${String(metadata?.sha256 || "").slice(0, 12)}…`; }
  function setStatus(message, type = "") { elements.status.textContent = message; elements.status.className = `main-status ${type}`.trim(); }
  function setWorkflowStatus(message, type = "") { elements.workflowStatus.textContent = message; elements.workflowStatus.className = `main-status ${type}`.trim(); }
  function clearWorkflowErrors() {
    elements.workflowErrorList.replaceChildren();
    elements.workflowErrors.hidden = true;
  }
  function renderWorkflowErrors(errors, title = "尚有阻擋") {
    clearWorkflowErrors();
    elements.workflowErrorTitle.textContent = title;
    errors.slice(0, 20).forEach((error) => {
      const item = document.createElement("li");
      const location = [error.sheetName, error.sourceRow ? `第${error.sourceRow}列` : "", error.sku].filter(Boolean).join("・");
      item.textContent = `${location ? `${location}：` : ""}${error.message}`;
      elements.workflowErrorList.append(item);
    });
    if (errors.length > 20) {
      const item = document.createElement("li");
      item.textContent = `另有${errors.length - 20}項；請先修正上述同類問題後重新檢查。`;
      elements.workflowErrorList.append(item);
    }
    elements.workflowErrors.hidden = false;
  }
  function updateSourceProgress(id, status, message) {
    const item = elements.autoSourceProgress.querySelector(`[data-source-progress="${id}"]`);
    if (!item) return;
    const icons = { waiting: "○", loading: "…", success: "✓", error: "!" };
    item.dataset.status = status;
    item.querySelector(".source-progress-icon").textContent = icons[status] || "○";
    item.querySelector("[data-source-message]").textContent = message;
  }
  function resetSourceProgress() {
    elements.autoSourceProgress.hidden = false;
    ["master", "marketing", "puyouma", "lirong"].forEach((id) => updateSourceProgress(id, "waiting", "等待取得"));
  }
  const automaticSourceLabels = {
    master: "商品主檔", marketing: "整體行銷策略", puyouma: "普優瑪寄庫表", lirong: "力榮寄庫表"
  };
  function identifySourceError(error, sourceId, failureStage) {
    error.sourceId ||= sourceId;
    error.sourceLabel ||= automaticSourceLabels[sourceId] || "固定Google資料";
    error.failureStage ||= failureStage;
    return error;
  }
  function automaticSourceFailureMessage(error, hasPreviousSources) {
    const failures = Array.isArray(error?.sourceFailures) && error.sourceFailures.length ? error.sourceFailures : [error];
    const labels = [...new Set(failures.map((item) => item?.sourceLabel || automaticSourceLabels[item?.sourceId] || "固定Google資料"))];
    const stages = [...new Set(failures.map((item) => item?.failureStage || "資料取得或格式檢核"))];
    const sourceLabel = labels.join("、");
    const stage = stages.join("、");
    const reason = failures.map((item) => {
      const label = item?.sourceLabel || automaticSourceLabels[item?.sourceId] || "固定Google資料";
      return `${label}：${item?.message || "未提供錯誤原因"}`;
    }).join("；");
    const result = hasPreviousSources
      ? "本分頁先前成功取得的四項資料仍保留，這次重新整理未覆蓋舊資料"
      : "本次自動來源尚未完成，尚未採用不完整資料";
    const nextStep = hasPreviousSources
      ? "稍後可再按「重新取得最新資料」；不必重做門市不足量或重新選擇本次人工匯入檔"
      : `先重試「自動取得最新資料」；若只有${sourceLabel}持續失敗，再使用該來源卡片的「手動備援」`;
    return `操作環節：自動取得最新資料｜失敗區塊：${sourceLabel}｜失敗階段：${stage}｜原因：${reason}｜處理結果：${result}｜建議處理：${nextStep}。`;
  }
  function setAutomaticSourceBusy(busy, label) {
    elements.autoSource.disabled = busy;
    elements.autoSource.classList.toggle("is-loading", busy);
    elements.autoSource.setAttribute("aria-busy", String(busy));
    elements.autoSourceLabel.textContent = label;
  }
  function blacklistEntries() { return Array.isArray(state.procurementRules?.blacklist) ? state.procurementRules.blacklist : []; }
  async function readWorkbook(file) {
    const data = await file.arrayBuffer();
    return XLSX.read(data, { type: "array", cellDates: true, cellStyles: true, nodim: true });
  }
  function monthAfter(isoDate, months) {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return "";
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    return date.toISOString().slice(0, 7);
  }
  function modelRefreshMonth() { return state.modelMetadata ? monthAfter(state.modelMetadata.importedAt, MODEL_CACHE.refreshMonths) : ""; }
  function modelRefreshRequired() {
    const refreshMonth = modelRefreshMonth();
    return !state.modelFile || !refreshMonth || !elements.month.value || elements.month.value >= refreshMonth;
  }
  function renderModelStatus() {
    const refreshMonth = modelRefreshMonth();
    const required = modelRefreshRequired();
    elements.modelBadge.className = `source-badge ${required ? "required" : "recommended"}`;
    elements.modelBadge.textContent = required ? "本月必要更新" : `沿用中・${refreshMonth}必要`;
    if (!state.modelFile || !state.modelMetadata) {
      elements.modelFileName.textContent = "本機沒有可沿用版本，請選擇季節模型";
      return;
    }
    const importedDate = new Date(state.modelMetadata.importedAt);
    const imported = Number.isNaN(importedDate.getTime())
      ? "日期不明"
      : importedDate.toLocaleString("zh-TW", { hour12: false });
    elements.modelFileName.textContent = required
      ? `沿用版本已到期：${state.modelMetadata.name}・上次提供${imported}；本月須重新選擇並通過檢核`
      : `本次沿用：${state.modelMetadata.name}・提供${imported}・下次必要更新${refreshMonth}`;
  }
  function openModelCache() {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error("這個瀏覽器不支援本機版本保留")); return; }
      const request = indexedDB.open(MODEL_CACHE.database, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(MODEL_CACHE.store)) request.result.createObjectStore(MODEL_CACHE.store);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("無法開啟本機版本儲存"));
    });
  }
  async function readCachedModel() {
    const database = await openModelCache();
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction(MODEL_CACHE.store, "readonly").objectStore(MODEL_CACHE.store).get(MODEL_CACHE.key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("無法讀取本機季節模型"));
      });
    } finally { database.close(); }
  }
  async function writeCachedModel(record) {
    const database = await openModelCache();
    try {
      await new Promise((resolve, reject) => {
        const request = database.transaction(MODEL_CACHE.store, "readwrite").objectStore(MODEL_CACHE.store).put(record, MODEL_CACHE.key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error("無法保存本機季節模型"));
      });
    } finally { database.close(); }
  }

  async function readWorkflowDrafts() {
    const database = await openModelCache();
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction(MODEL_CACHE.store, "readonly").objectStore(MODEL_CACHE.store).get(WORKFLOW_CACHE.key);
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => reject(request.error || new Error("無法讀取未完成採購批次"));
      });
    } finally { database.close(); }
  }

  async function writeWorkflowDrafts(records) {
    const database = await openModelCache();
    try {
      await new Promise((resolve, reject) => {
        const request = database.transaction(MODEL_CACHE.store, "readwrite").objectStore(MODEL_CACHE.store).put(records, WORKFLOW_CACHE.key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error("無法保存未完成採購批次"));
      });
    } finally { database.close(); }
  }

  function workflowStageLabel(stage) {
    return ({ analysis: "已產生採購建議", downloaded: "等待第一次人工回匯", first_reviewed: "第一次覆核完成，可直接送出或回匯異動", second_reviewed: "可送出待核准", pending_approval: "等待正式核准", approved: "已核准，待建立ERP", erp_created: "ERP已建立" })[stage] || "未完成批次";
  }

  function isUnfinishedWorkflowDraft(draft) { return draft && draft.stage !== "erp_created"; }

  function isParentWorkflowDraft(draft) {
    return Boolean(draft) && !draft.activeWorkUnit && (!draft.parentBatchId || draft.id === draft.parentBatchId);
  }

  function detachChildSharedIdentity(draft) {
    if (draft?.activeWorkUnit && draft.sharedDraftId && draft.sharedDraftId === draft.parentBatchId) {
      draft.sharedDraftId = "";
      draft.sharedDraftRevision = 0;
    }
    return draft;
  }

  function taipeiDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "時間未記錄" : new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
  }

  function newParentBatchId() {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    return `PLAN-${stamp}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function workflowSnapshot(stage = state.draftStage || "analysis") {
    state.draftId ||= `LOCAL-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
    if (state.activeWorkUnit && state.sharedDraftId === state.parentBatchId) {
      state.sharedDraftId = "";
      state.sharedDraftRevision = 0;
    }
    return {
      version: WORKFLOW_CACHE.version, id: state.draftId, stage, updatedAt: new Date().toISOString(), sharedDraftId: state.sharedDraftId, sharedDraftRevision: state.sharedDraftRevision, parentBatchId: state.parentBatchId, activeWorkUnit: state.activeWorkUnit, batchId: state.batchId,
      analysis: state.analysis, baseAnalysis: state.baseAnalysis === state.analysis ? null : state.baseAnalysis, workflowType: state.workflowType,
      selectedSuppliers: [...state.selectedSuppliers], returnScope: state.returnScope ? [...state.returnScope] : null,
      firstReview: state.firstReview, review: state.review, purchaseStatusSummary: state.purchaseStatusSummary, costSummary: state.costSummary,
      consignmentStyleAudit: state.consignmentSource?.styleAudit || { pinkDetected: false, pinkCells: 0 },
      controls: { month: elements.month.value, checkpoint: elements.checkpoint.value, orderDate: elements.orderDate.value, inventoryDate: elements.inventoryDate.value, pendingDate: elements.pendingDate.value, transferDate: elements.transferDate.value, consignmentDate: elements.consignmentDate.value, salesDate: elements.salesDate.value }
    };
  }

  async function persistWorkflowDraft(stage) {
    if (!state.analysis) return;
    try {
      state.draftStage = stage;
      const snapshot = workflowSnapshot(stage);
      const records = (await readWorkflowDrafts()).filter((row) => row.id !== snapshot.id);
      records.unshift(snapshot);
      state.workflowDrafts = records.slice(0, WORKFLOW_CACHE.maxRecords);
      await writeWorkflowDrafts(state.workflowDrafts);
      state.latestDraft = state.workflowDrafts.find(isUnfinishedWorkflowDraft) || null;
      renderResumeDrafts();
      renderWorkUnitDashboard();
      if (snapshot.sharedDraftId) await syncSharedWorkflowDraft(snapshot);
    } catch (error) { console.warn("未完成採購批次無法保存於本機", error); }
  }

  async function removeWorkflowDraft(id = state.draftId) {
    const records = (await readWorkflowDrafts()).filter((row) => row.id !== id);
    await writeWorkflowDrafts(records);
    state.workflowDrafts = records;
    if (state.latestDraft?.id === id) state.latestDraft = records.find(isUnfinishedWorkflowDraft) || null;
    renderResumeDrafts();
    renderWorkUnitDashboard();
  }

  function renderResumeDrafts() {
    if (!elements.resumeDraftCard || !elements.resumeDraftList) return;
    const drafts = state.workflowDrafts.filter(isUnfinishedWorkflowDraft);
    elements.resumeDraftCard.hidden = drafts.length === 0 && state.sharedDrafts.length === 0;
    const fragment = document.createDocumentFragment();
    drafts.forEach((draft) => {
      const checkpoint = ({ "month-start": "月初採購", "mid-month": "月中採購", "month-end": "月底驗證" })[draft.controls?.checkpoint] || "採購";
      const item = document.createElement("article"); item.className = "resume-draft-item";
      const copy = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = `${draft.controls?.month || "月份未標示"}・${checkpoint}`;
      const summary = document.createElement("p");
      const amount = Number(draft.activeWorkUnit?.amount || 0);
      summary.textContent = `${draft.activeWorkUnit?.label || "尚未選擇審核單位"}・${workflowStageLabel(draft.stage)}${amount > 0 ? `・${formatCurrency(amount)}` : ""}・最後保存${taipeiDateTime(draft.updatedAt)}`;
      copy.append(title, summary);
      const actions = document.createElement("div"); actions.className = "resume-draft-actions";
      const resume = document.createElement("button"); resume.type = "button"; resume.className = "primary-button"; resume.textContent = "繼續操作";
      resume.addEventListener("click", async () => { try { if (draft.sharedDraftId) await openSharedWorkflowDraft(draft.sharedDraftId); else restoreWorkflowDraft(draft); } catch (error) { setWorkflowStatus(`無法恢復：${error.message}`, "error"); } });
      const redownload = document.createElement("button"); redownload.type = "button"; redownload.className = "secondary-button"; redownload.textContent = "重新下載本批報表";
      redownload.addEventListener("click", async () => { try { restoreWorkflowDraft(draft); await downloadRecommendation(); } catch (error) { setWorkflowStatus(`無法重新下載：${error.message}`, "error"); } });
      const publish = document.createElement("button"); publish.type = "button"; publish.className = "secondary-button"; publish.textContent = draft.sharedDraftId ? "更新協作草稿" : "發布協作草稿";
      publish.addEventListener("click", async () => { publish.disabled = true; try { await publishWorkflowDraft(draft); } catch (error) { setWorkflowStatus(`協作草稿發布失敗：${error.message}`, "error"); } finally { publish.disabled = false; } });
      const discard = document.createElement("button"); discard.type = "button"; discard.className = "secondary-button"; discard.textContent = "移除本機紀錄";
      discard.addEventListener("click", async () => { if (globalThis.confirm("只移除這筆瀏覽器本機續作紀錄，不會刪除已下載Excel或公司台帳。確定移除？")) await removeWorkflowDraft(draft.id); });
      actions.append(resume, redownload, publish, discard); item.append(copy, actions); fragment.append(item);
    });
    elements.resumeDraftList.replaceChildren(fragment);
  }

  function updateSupplierChecks() {
    [elements.supplierFilterList, elements.otherSupplierFilterList].forEach((list) => list.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = state.selectedSuppliers.has(input.value); }));
    renderSelectedAnalysis();
  }

  function restoreWorkflowDraft(draft) {
    if (!draft?.analysis) throw new Error("續作資料缺少採購建議內容，請重新產生建議。");
    Object.entries(draft.controls || {}).forEach(([key, value]) => {
      const target = ({ month: elements.month, checkpoint: elements.checkpoint, orderDate: elements.orderDate, inventoryDate: elements.inventoryDate, pendingDate: elements.pendingDate, transferDate: elements.transferDate, consignmentDate: elements.consignmentDate, salesDate: elements.salesDate })[key];
      if (target && value) target.value = value;
    });
    state.analysis = draft.analysis; state.baseAnalysis = draft.baseAnalysis || draft.analysis; state.workflowType = draft.workflowType || "system_recommendation";
    state.parentBatchId = draft.parentBatchId || draft.id; state.activeWorkUnit = draft.activeWorkUnit || null; state.sharedDraftId = draft.sharedDraftId || ""; state.sharedDraftRevision = Number(draft.sharedDraftRevision || 0);
    state.selectedWorkUnitIds = new Set();
    const restoredSuppliers = new Set(draft.selectedSuppliers || []); state.returnScope = draft.returnScope ? new Set(draft.returnScope) : null;
    state.firstReview = draft.firstReview || null; state.review = draft.review || null; state.purchaseStatusSummary = draft.purchaseStatusSummary || null; state.costSummary = draft.costSummary || null; state.consignmentSource = { styleAudit: draft.consignmentStyleAudit || { pinkDetected: false, pinkCells: 0 } };
    state.draftId = draft.id; state.draftStage = draft.stage; state.latestDraft = draft;
    updateAutomaticForecastCost();
    renderSummary(state.analysis, state.consignmentSource); state.selectedSuppliers = restoredSuppliers; updateSupplierChecks(); elements.resultPanel.hidden = false;
    resetReviewWorkflow();
    state.batchId = draft.batchId || "";
    state.firstReview = draft.firstReview || null; state.review = draft.review || null;
    if (draft.stage === "downloaded") {
      setFileInputEnabled(elements.reviewFile, elements.reviewFileLabel, true);
      setWorkflowStep(elements.workflowStepDownload, "done", `已恢復${state.activeWorkUnit?.label || `${state.returnScope?.size || 0}家供應商`}`);
      setWorkflowStep(elements.workflowStepFirst, "active", "可繼續第一次人工回匯");
      setWorkflowStatus("已恢復未完成批次；請選擇先前填寫的第一次人工回匯檔。", "success");
    } else if (draft.stage === "first_reviewed" && state.firstReview) {
      state.review = state.firstReview;
      setWorkflowStep(elements.workflowStepDownload, "done", "本批建議已下載"); setWorkflowStep(elements.workflowStepFirst, "done", "第一次覆核已通過");
      setWorkflowStep(elements.workflowStepSecond, "active", "無異動可直接送出；有異動才回匯"); setFileInputEnabled(elements.secondReviewFile, elements.secondReviewFileLabel, true);
      elements.submitApproval.disabled = false; elements.submitApproval.textContent = "全部沿用並送出待核准";
      setWorkflowStatus("已恢復第一次覆核結果；若沒有異動可直接送出，有異動再回匯先前下載的覆核與異動確認表。", "success");
    } else if (draft.stage === "second_reviewed" && state.review) {
      setWorkflowStep(elements.workflowStepDownload, "done", "本批建議已下載"); setWorkflowStep(elements.workflowStepFirst, "done", "第一次覆核已通過");
      setWorkflowStep(elements.workflowStepSecond, "done", "異動確認已通過"); setWorkflowStep(elements.workflowStepApproval, "active", "可送出待核准台帳");
      elements.submitApproval.disabled = state.review.errors?.length > 0; elements.submitApproval.textContent = "送出異動後待核准"; setWorkflowStatus("已恢復至待送核准階段。", "success");
    } else if (draft.stage === "pending_approval" && state.review) {
      setWorkflowStep(elements.workflowStepDownload, "done", "本批建議已下載"); setWorkflowStep(elements.workflowStepFirst, "done", "第一次覆核已通過");
      setWorkflowStep(elements.workflowStepSecond, "done", "覆核結果已確認"); setWorkflowStep(elements.workflowStepApproval, "active", "已送待核准");
      elements.approve.disabled = !state.config?.permissions?.canApprove; setWorkflowStatus(`批次${state.batchId}已送待核准；尚未寄信。`, "success");
    } else if (["approved", "erp_created"].includes(draft.stage) && state.review) {
      state.approved = true; setWorkflowStep(elements.workflowStepDownload, "done", "本批建議已下載"); setWorkflowStep(elements.workflowStepFirst, "done", "第一次覆核已通過");
      setWorkflowStep(elements.workflowStepSecond, "done", "覆核結果已確認"); setWorkflowStep(elements.workflowStepApproval, "done", workflowStageLabel(draft.stage));
      elements.erp.disabled = draft.stage === "erp_created";
      setWorkflowStatus(draft.stage === "erp_created" ? "此審核單位已完成ERP建立。" : "此審核單位已正式核准，可下載ERP採購檔。", "success");
    } else resetReviewWorkflow("已恢復採購建議；請重新選擇供應商並下載本批Excel。");
    renderWorkUnitDashboard(); renderBudget(); elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function hydrateWorkflowDrafts() {
    try {
      state.workflowDrafts = await readWorkflowDrafts();
      state.latestDraft = state.workflowDrafts.find(isUnfinishedWorkflowDraft) || null;
      renderResumeDrafts();
    }
    catch (error) { console.warn("無法讀取未完成採購批次", error); }
  }

  function snapshotJson(snapshot) {
    return JSON.stringify(snapshot, (_key, value) => {
      if (value instanceof Map) return { __localType: "Map", value: [...value.entries()] };
      if (value instanceof Set) return { __localType: "Set", value: [...value.values()] };
      return value;
    });
  }

  function snapshotFromJson(text) {
    return JSON.parse(text, (_key, value) => {
      if (value?.__localType === "Map") return new Map(value.value || []);
      if (value?.__localType === "Set") return new Set(value.value || []);
      return value;
    });
  }

  function sharedSnapshotJson(draft) {
    const clone = JSON.parse(snapshotJson(draft));
    clone.baseAnalysis = null;
    if (clone.analysis) {
      delete clone.analysis.model;
      delete clone.analysis.pending;
      delete clone.analysis.transfers;
    }
    const stripLocalSourceNames = (value) => {
      if (Array.isArray(value)) return value.map(stripLocalSourceNames);
      if (!value || typeof value !== "object") return value;
      for (const key of Object.keys(value)) {
        if (["fileName", "sourceFile", "sourceFiles"].includes(key)) delete value[key];
        else value[key] = stripLocalSourceNames(value[key]);
      }
      return value;
    };
    return JSON.stringify(stripLocalSourceNames(clone));
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function sha256(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function encodeSharedSnapshot(draft) {
    const json = sharedSnapshotJson(draft);
    if (typeof CompressionStream === "function") {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
      const payload = bytesToBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
      return { payloadEncoding: "gzip-base64", payload, payloadSha256: await sha256(payload) };
    }
    return { payloadEncoding: "json", payload: json, payloadSha256: await sha256(json) };
  }

  async function decodeSharedSnapshot(draft) {
    if (await sha256(draft.payload) !== draft.payloadSha256) throw new Error("協作草稿內容檢核失敗，請重新整理後再試。");
    let json = draft.payload;
    if (draft.payloadEncoding === "gzip-base64") {
      if (typeof DecompressionStream !== "function") throw new Error("目前瀏覽器不支援協作草稿解壓縮，請更新 Chrome 後再試。");
      const stream = new Blob([base64ToBytes(draft.payload)]).stream().pipeThrough(new DecompressionStream("gzip"));
      json = await new Response(stream).text();
    }
    if (draft.payloadEncoding !== "gzip-base64" && draft.payloadEncoding !== "json") throw new Error("協作草稿格式不相容。");
    const snapshot = snapshotFromJson(json);
    snapshot.sharedDraftId = draft.id;
    snapshot.sharedDraftRevision = draft.revision;
    return snapshot;
  }

  function sharedDraftSuppliers(draft) {
    const fromReview = draft.review?.rows?.map((row) => row.supplier) || draft.firstReview?.rows?.map((row) => row.supplier) || [];
    const fromWorkUnit = draft.activeWorkUnit?.memberLabels || (draft.activeWorkUnit?.label ? [draft.activeWorkUnit.label] : []);
    return [...new Set([...fromReview, ...fromWorkUnit].map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 100);
  }

  function sharedDraftAmount(draft) {
    return Math.max(0, Number(draft.review?.totals?.approvedAmount ?? draft.firstReview?.totals?.manualAmount ?? draft.activeWorkUnit?.amount ?? 0));
  }

  async function saveLocalDraftSnapshot(snapshot) {
    const records = (await readWorkflowDrafts()).filter((row) => row.id !== snapshot.id);
    records.unshift(snapshot);
    state.workflowDrafts = records.slice(0, WORKFLOW_CACHE.maxRecords);
    await writeWorkflowDrafts(state.workflowDrafts);
    state.latestDraft = state.workflowDrafts.find(isUnfinishedWorkflowDraft) || null;
  }

  async function saveSharedWorkflowDraft(draft, expectedRevision) {
    detachChildSharedIdentity(draft);
    const encoded = await encodeSharedSnapshot(draft);
    const result = await postJson(`/api/procurement/collaboration-drafts/${encodeURIComponent(draft.sharedDraftId || draft.id)}`, {
      analysisMonth: draft.controls?.month,
      checkpoint: draft.controls?.checkpoint,
      workflowType: draft.workflowType || "system_recommendation",
      stage: draft.stage || "analysis",
      workUnitLabel: draft.activeWorkUnit?.label || "尚未選擇審核單位",
      supplierSummary: sharedDraftSuppliers(draft),
      amount: sharedDraftAmount(draft),
      ...encoded,
      expectedRevision
    }, {}, "PUT");
    return result.draft;
  }

  async function updateSharedMetadata(localDraft, shared) {
    localDraft.sharedDraftId = shared.id;
    localDraft.sharedDraftRevision = shared.revision;
    localDraft.updatedAt = shared.updatedAt;
    await saveLocalDraftSnapshot(localDraft);
    if (state.draftId === localDraft.id) {
      state.sharedDraftId = shared.id;
      state.sharedDraftRevision = shared.revision;
    }
    const index = state.sharedDrafts.findIndex((row) => row.id === shared.id);
    if (shared.stage === "erp_created") {
      if (index >= 0) state.sharedDrafts.splice(index, 1);
    } else if (index >= 0) state.sharedDrafts[index] = shared;
    else state.sharedDrafts.unshift(shared);
    renderResumeDrafts();
    renderSharedDrafts();
  }

  async function publishWorkflowDraft(draft) {
    const localDraft = detachChildSharedIdentity({ ...draft, sharedDraftId: draft.sharedDraftId || draft.id, sharedDraftRevision: Number(draft.sharedDraftRevision || 0) });
    if (!localDraft.sharedDraftId) localDraft.sharedDraftId = localDraft.id;
    setWorkflowStatus("正在發布公司共用協作草稿；原始Excel不會上傳…");
    let shared;
    let repairedParent = false;
    try {
      shared = await saveSharedWorkflowDraft(localDraft, localDraft.sharedDraftRevision);
    } catch (error) {
      if (error.status !== 409 || !isParentWorkflowDraft(localDraft)) throw error;
      shared = await repairOverwrittenParentDraft(localDraft);
      if (!shared) throw error;
      repairedParent = true;
    }
    await updateSharedMetadata(localDraft, shared);
    setWorkflowStatus(repairedParent
      ? "已保留原子批次並恢復公司共用母批次；其他授權同事現在可分別查看母批次與子批次。"
      : `協作草稿已發布；${shared.updatedBy}與其他授權同事現在都能查看並接續。`, "success");
  }

  async function syncSharedWorkflowDraft(snapshot) {
    try {
      const shared = await saveSharedWorkflowDraft(snapshot, Number(snapshot.sharedDraftRevision || 0));
      await updateSharedMetadata(snapshot, shared);
    } catch (error) {
      setWorkflowStatus(`本機進度已保存，但公司共用草稿未同步：${error.message}`, "error");
      throw error;
    }
  }

  function renderSharedDrafts() {
    if (!elements.sharedDraftList || !elements.sharedDraftStatus) return;
    const fragment = document.createDocumentFragment();
    const isParentDraft = (draft) => draft.stage === "analysis" && (!draft.workUnitLabel || draft.workUnitLabel === "尚未選擇審核單位");
    const drafts = [...state.sharedDrafts].sort((left, right) => Number(isParentDraft(right)) - Number(isParentDraft(left)) || String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
    drafts.forEach((draft) => {
      const parentDraft = isParentDraft(draft);
      const item = document.createElement("article"); item.className = `resume-draft-item is-shared${parentDraft ? " is-parent" : ""}`;
      const copy = document.createElement("div");
      const checkpoint = ({ "month-start": "月初採購", "mid-month": "月中採購", "month-end": "月底驗證" })[draft.checkpoint] || "採購";
      const title = document.createElement("strong"); title.textContent = `${draft.analysisMonth}・${checkpoint}・${draft.workUnitLabel || "尚未選擇審核單位"}`;
      const summary = document.createElement("p");
      summary.textContent = `${parentDraft ? "母批次・固定置頂・" : ""}${workflowStageLabel(draft.stage)}・${formatCurrency(draft.amount)}・第${draft.revision}版・${draft.updatedBy}更新於${taipeiDateTime(draft.updatedAt)}`;
      copy.append(title, summary);
      const actions = document.createElement("div"); actions.className = "resume-draft-actions";
      const open = document.createElement("button"); open.type = "button"; open.className = "primary-button"; open.textContent = "接續操作";
      open.addEventListener("click", async () => { open.disabled = true; try { await openSharedWorkflowDraft(draft.id); } catch (error) { setWorkflowStatus(`無法開啟協作草稿：${error.message}`, "error"); } finally { open.disabled = false; } });
      actions.append(open);
      if (state.config?.permissions?.canManageCollaborationDrafts && !parentDraft && !["pending_approval", "approved", "erp_created"].includes(draft.stage)) {
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary-button"; remove.textContent = "移出協作區";
        remove.addEventListener("click", async () => {
          if (!globalThis.confirm(`確定將「${draft.workUnitLabel || "這筆草稿"}」移出公司共用協作區？\n\n不會影響正式核准台帳、ERP紀錄或已下載檔案；系統仍保留移除者與時間供稽核。`)) return;
          remove.disabled = true;
          try {
            const response = await fetch(`/api/procurement/collaboration-drafts/${encodeURIComponent(draft.id)}`, { method: "DELETE", headers: { Accept: "application/json" }, cache: "no-store" });
            const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
            state.sharedDrafts = state.sharedDrafts.filter((row) => row.id !== draft.id);
            renderSharedDrafts();
            setWorkflowStatus(`已將${draft.workUnitLabel || "協作草稿"}移出公司共用協作區；正式台帳與ERP紀錄未受影響。`, "success");
          } catch (error) {
            remove.disabled = false;
            setWorkflowStatus(`共用草稿移除失敗：${error.message}`, "error");
          }
        });
        actions.append(remove);
      }
      item.append(copy, actions); fragment.append(item);
    });
    elements.sharedDraftList.replaceChildren(fragment);
    elements.sharedDraftStatus.textContent = state.sharedDrafts.length ? `目前有${state.sharedDrafts.length}筆未完成公司共用草稿。` : "本月份目前沒有公司共用協作草稿。";
    elements.resumeDraftCard.hidden = state.sharedDrafts.length === 0 && state.workflowDrafts.filter(isUnfinishedWorkflowDraft).length === 0;
  }

  async function loadSharedWorkflowDrafts() {
    if (!state.config || !elements.month.value) return;
    elements.sharedDraftStatus.textContent = "正在讀取公司共用草稿…";
    try {
      const response = await fetch(`/api/procurement/collaboration-drafts?month=${encodeURIComponent(elements.month.value)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      state.sharedDrafts = result.drafts || [];
      renderSharedDrafts();
    } catch (error) {
      state.sharedDrafts = [];
      elements.sharedDraftStatus.textContent = `公司共用草稿同步失敗：${error.message}`;
      renderResumeDrafts();
    }
  }

  async function openSharedWorkflowDraft(id) {
    setWorkflowStatus("正在載入公司共用最新版…");
    const draft = await fetchSharedWorkflowDraft(id);
    const snapshot = await decodeSharedSnapshot(draft);
    restoreWorkflowDraft(snapshot);
    await saveLocalDraftSnapshot(snapshot);
    renderResumeDrafts();
    setWorkflowStatus(`已載入公司共用第${draft.revision}版；後續回匯與確認會同步給其他協作者。`, "success");
  }

  async function fetchSharedWorkflowDraft(id) {
    const response = await fetch(`/api/procurement/collaboration-drafts/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
    const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) {
      const error = new Error(result.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return result.draft;
  }

  async function repairOverwrittenParentDraft(localParent) {
    const remoteDraft = await fetchSharedWorkflowDraft(localParent.sharedDraftId || localParent.id);
    const overwrittenChild = await decodeSharedSnapshot(remoteDraft);
    const matchesKnownBug = overwrittenChild.activeWorkUnit
      && overwrittenChild.parentBatchId === localParent.id
      && overwrittenChild.id !== localParent.id;
    if (!matchesKnownBug) return null;

    const rescuedChild = detachChildSharedIdentity({ ...overwrittenChild, sharedDraftId: "", sharedDraftRevision: 0 });
    let childShared;
    try {
      childShared = await saveSharedWorkflowDraft(rescuedChild, 0);
    } catch (error) {
      if (error.status !== 409) throw error;
      childShared = await fetchSharedWorkflowDraft(rescuedChild.id);
    }
    await updateSharedMetadata(rescuedChild, childShared);

    const refreshedParent = { ...localParent, sharedDraftId: remoteDraft.id, sharedDraftRevision: remoteDraft.revision };
    return saveSharedWorkflowDraft(refreshedParent, remoteDraft.revision);
  }

  function appendWorkflowSnapshotSheet(workbook, snapshot) {
    const json = snapshotJson(snapshot);
    const chunks = [];
    for (let index = 0; index < json.length; index += 30000) chunks.push([json.slice(index, index + 30000)]);
    const sheetName = "99_本機續作資料";
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["請勿修改；供換機或清除瀏覽器後續作"], ...chunks]), sheetName);
    workbook.Workbook ||= {};
    workbook.Workbook.Sheets ||= workbook.SheetNames.map((name) => ({ name, Hidden: 0 }));
    const info = workbook.Workbook.Sheets.find((row) => row.name === sheetName);
    if (info) info.Hidden = 2;
  }

  function extractWorkflowSnapshot(workbook) {
    const sheet = workbook.Sheets["99_本機續作資料"];
    if (!sheet) throw new Error("這份Excel沒有續作資料；請使用本工具下載的本批採購建議報表。");
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
    const json = rows.slice(1).map((row) => String(row[0] || "")).join("");
    const snapshot = snapshotFromJson(json);
    if (snapshot?.version !== WORKFLOW_CACHE.version || !snapshot?.analysis) throw new Error("續作資料版本不相容，請重新產生採購建議。");
    return snapshot;
  }
  async function hydrateCachedModel() {
    try {
      const cached = await readCachedModel();
      if (cached?.file && cached?.metadata) {
        core.parseForecastModelWorkbook(await readWorkbook(cached.file), XLSX, { fileName: cached.metadata.name });
        state.modelFile = cached.file;
        state.modelMetadata = cached.metadata;
      }
    } catch (error) {
      console.warn("無法沿用本機季節模型", error);
    }
    renderModelStatus(); updateReadyState();
  }
  async function selectSeasonalModel() {
    const selected = elements.modelFile.files[0] || null;
    if (!selected) { renderModelStatus(); return; }
    const previousFile = state.modelFile;
    const previousMetadata = state.modelMetadata;
    elements.modelFileName.textContent = `正在檢核${selected.name}…`;
    try {
      core.parseForecastModelWorkbook(await readWorkbook(selected), XLSX, { fileName: selected.name });
      const metadata = { name: selected.name, importedAt: new Date().toISOString(), size: selected.size, lastModified: selected.lastModified };
      state.modelFile = selected;
      state.modelMetadata = metadata;
      await writeCachedModel({ file: selected, metadata });
      invalidateAnalysis(); renderModelStatus(); updateReadyState();
    } catch (error) {
      state.modelFile = previousFile;
      state.modelMetadata = previousMetadata;
      elements.modelFile.value = "";
      renderModelStatus();
      setStatus(`季節模型未採用：${error.message}`, "error");
      updateReadyState();
    }
  }
  function updateModelControls() {
    const canBuild = Boolean(state.googleAuthorized && state.config?.permissions?.canApprove && !state.modelWorker);
    elements.modelRefresh.disabled = !canBuild;
    elements.modelDownloadDraft.disabled = !state.modelDraft?.blob;
    elements.modelApprove.disabled = !(state.googleAuthorized && state.config?.permissions?.canApprove && state.modelWorker && state.modelDraft?.blob && state.modelDraft?.driveFile);
  }
  function setModelProgress(message, type = "") {
    elements.modelProgressText.textContent = message;
    elements.modelProgressText.className = `model-progress-text ${type}`.trim();
  }
  function renderModelRunSummary(summary) {
    if (!summary) { elements.modelRunSummary.hidden = true; elements.modelRunSummary.replaceChildren(); return; }
    const values = [
      ["歷史範圍", `${summary.minDate}～${summary.maxDate}`],
      ["來源Excel", `${summary.sourceFileCount}份・${formatNumber(summary.sourceBytes / 1024 / 1024)} MB`],
      ["納入／去重", `${formatNumber(summary.acceptedRows)}／${formatNumber(summary.duplicateRows)}列`],
      ["活躍SKU／WAPE", `${formatNumber(summary.activeSkuCount)}／${summary.skuWape == null ? "—" : `${(summary.skuWape * 100).toFixed(2)}%`}`]
    ];
    elements.modelRunSummary.replaceChildren(...values.map(([label, value]) => {
      const article = document.createElement("article");
      const small = document.createElement("small"); small.textContent = label;
      const strong = document.createElement("strong"); strong.textContent = value;
      article.append(small, strong); return article;
    }));
    elements.modelRunSummary.hidden = false;
  }
  function workerRequest(worker, payload, transfer = []) {
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        if (event.data?.type === "error") reject(new Error(event.data.message));
        else resolve(event.data);
      };
      const onError = (event) => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        reject(new Error(event.message || "背景回測工作失敗。"));
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage(payload, transfer);
    });
  }
  function modelStamp() { return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12); }
  async function loadApprovedSeasonalModel() {
    const folderId = state.config?.fixedSources?.seasonalApprovedFolderId;
    if (!folderId) return;
    elements.modelRunBadge.textContent = "正在取得正式版";
    try {
      const approved = await googleSources.loadLatestApprovedModel(folderId);
      if (!approved) {
        elements.modelRunBadge.className = "source-badge required";
        elements.modelRunBadge.textContent = "尚無正式版";
        setModelProgress("正式模型資料夾尚無檔案；請由採購核准者建立第一次回測草稿。", "error");
        return;
      }
      core.parseForecastModelWorkbook(await readWorkbook(approved.file), XLSX, { fileName: approved.file.name });
      state.modelFile = approved.file;
      state.modelMetadata = approved.metadata;
      await writeCachedModel({ file: approved.file, metadata: approved.metadata });
      elements.modelRunBadge.className = "source-badge recommended";
      elements.modelRunBadge.textContent = "正式版已自動取得";
      setModelProgress(`已自動取得公司正式版：${approved.file.name}。平常直接沿用，到期月份再重跑。`, "success");
      renderModelStatus(); updateReadyState();
    } catch (error) {
      elements.modelRunBadge.className = "source-badge required";
      elements.modelRunBadge.textContent = "正式版取得失敗";
      setModelProgress(`無法取得正式模型：${error.message}；仍可使用本機快取或手動備援。`, "error");
    } finally { updateModelControls(); }
  }
  async function buildSeasonalModelDraft() {
    if (!state.googleAuthorized || !state.config?.permissions?.canApprove || state.modelWorker) return;
    const fixed = state.config.fixedSources || {};
    elements.modelProgressBar.hidden = false; elements.modelProgressBar.value = 0;
    elements.modelRefresh.classList.add("is-loading"); elements.modelRefreshLabel.textContent = "正在準備歷史銷售…";
    elements.modelRunBadge.className = "source-badge required"; elements.modelRunBadge.textContent = "回測進行中";
    state.modelDraft = null; renderModelRunSummary(null);
    try {
      if (!state.masterFile) {
        setModelProgress("正在取得最新版商品主檔…");
        const master = await googleSources.loadLatestMaster(fixed.productMasterFolderId);
        state.masterFile = master.file; state.masterWorkbook = null;
        elements.masterFileName.textContent = `自動取得：${master.file.name}`;
      }
      const sourceFiles = await googleSources.listDriveExcelFiles(fixed.seasonalSalesFolderId);
      if (!sourceFiles.length) throw new Error("近三年歷史銷售資料夾沒有直屬.xlsx檔案。");
      const oversized = sourceFiles.filter((file) => Number(file.size || 0) > MAX_SEASONAL_SOURCE_BYTES);
      if (oversized.length) {
        const details = oversized.map((file) => `${file.name}（${formatNumber(Number(file.size || 0) / 1024 / 1024)} MB）`).join("、");
        throw new Error(`大型檔案預檢未通過：${details}超過單檔45 MB安全上限。請把該期間拆成較小Excel後再重跑；這不是欄位缺漏。`);
      }
      const totalBytes = sourceFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
      setModelProgress(`已找到${sourceFiles.length}份Excel（${formatNumber(totalBytes / 1024 / 1024)} MB），正在啟動背景回測…`);
      const worker = new Worker("seasonal-model-worker.js?v=20260914-seasonal-wape-r2");
      state.modelWorker = worker; updateModelControls();
      const masterBuffer = await state.masterFile.arrayBuffer();
      await workerRequest(worker, { type: "initialize", masterBuffer, masterName: state.masterFile.name, blacklist: blacklistEntries() }, [masterBuffer]);
      for (let index = 0; index < sourceFiles.length; index += 1) {
        const file = sourceFiles[index];
        elements.modelRefreshLabel.textContent = `正在處理 ${index + 1}/${sourceFiles.length}`;
        setModelProgress(`下載並分析 ${file.name}（${index + 1}/${sourceFiles.length}）…`);
        const downloaded = await googleSources.downloadDriveFile(file.id, file.name);
        const buffer = await downloaded.arrayBuffer();
        let response;
        try {
          response = await workerRequest(worker, { type: "ingest", index, file, buffer }, [buffer]);
        } catch (error) {
          throw new Error(`${file.name}處理失敗：${error.message}`);
        }
        elements.modelProgressBar.value = Math.round(((index + 1) / (sourceFiles.length + 1)) * 100);
        setModelProgress(`${file.name}完成：納入${formatNumber(response.stats.acceptedRows)}列、跨檔去重${formatNumber(response.stats.duplicateRows)}列。`);
      }
      elements.modelRefreshLabel.textContent = "正在彙整回測結果…";
      const draft = await workerRequest(worker, { type: "finalize", metadata: { generatedAt: new Date().toISOString(), generatedBy: state.config.email, sourceFolderId: fixed.seasonalSalesFolderId } });
      const fileName = `季節模型回測_草稿_${modelStamp()}.xlsx`;
      const blob = new Blob([draft.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const driveFile = await googleSources.uploadDriveExcel(fixed.seasonalDraftFolderId, fileName, blob, { status: "draft", generatedBy: state.config.email });
      state.modelDraft = { blob, fileName, summary: draft.summary, metadata: draft.metadata, driveFile };
      elements.modelProgressBar.value = 100;
      elements.modelRunBadge.className = "source-badge recommended"; elements.modelRunBadge.textContent = "草稿待核准";
      setModelProgress(`草稿已寫入Google Drive：${fileName}。請先看下方摘要；核准後才會成為公司共用正式版。`, "success");
      renderModelRunSummary(draft.summary);
    } catch (error) {
      elements.modelRunBadge.className = "source-badge required"; elements.modelRunBadge.textContent = "回測未完成";
      setModelProgress(`季節模型回測停止：${error.message}`, "error");
      if (state.modelWorker) { state.modelWorker.terminate(); state.modelWorker = null; }
    } finally {
      elements.modelRefresh.classList.remove("is-loading"); elements.modelRefreshLabel.textContent = "建立／更新回測草稿";
      updateModelControls();
    }
  }
  function downloadModelDraft() {
    if (!state.modelDraft?.blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(state.modelDraft.blob); link.download = state.modelDraft.fileName; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  async function approveSeasonalModel() {
    if (!state.modelWorker || !state.modelDraft?.driveFile || !state.config?.permissions?.canApprove) return;
    elements.modelApprove.disabled = true;
    const approvedAt = new Date().toISOString();
    setModelProgress("正在建立正式版、寫入Google Drive並寄送核准摘要…");
    try {
      const formal = await workerRequest(state.modelWorker, { type: "approve", approvedBy: state.config.email, approvedAt });
      const fileName = `季節模型回測_正式版_${modelStamp()}.xlsx`;
      const blob = new Blob([formal.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const driveFile = await googleSources.uploadDriveExcel(state.config.fixedSources.seasonalApprovedFolderId, fileName, blob, { status: "approved", approvedBy: state.config.email, approvedAt });
      const file = new File([blob], fileName, { type: blob.type, lastModified: Date.now() });
      core.parseForecastModelWorkbook(await readWorkbook(file), XLSX, { fileName });
      const metadata = { ...formal.metadata, name: fileName, importedAt: approvedAt, source: "Google Drive正式版", approved: true, fileId: driveFile.id };
      state.modelFile = file; state.modelMetadata = metadata;
      await writeCachedModel({ file, metadata });
      let mailMessage = "核准摘要已寄出";
      try {
        await googleSources.sendSeasonalModelSummary(state.config.notification?.recipient || "siang01@siangapato.com.tw", formal.summary, metadata, driveFile);
      } catch (error) { mailMessage = `正式版已發布，但摘要寄送失敗：${error.message}`; }
      state.modelDraft = null;
      state.modelWorker.terminate(); state.modelWorker = null;
      elements.modelRunBadge.className = "source-badge recommended"; elements.modelRunBadge.textContent = "正式版已發布";
      setModelProgress(`公司正式版已發布：${fileName}；${mailMessage}。`, mailMessage.includes("失敗") ? "error" : "success");
      renderModelStatus(); updateReadyState();
    } catch (error) {
      setModelProgress(`正式版發布失敗：${error.message}；草稿仍保留，可重試核准。`, "error");
    } finally { updateModelControls(); }
  }
  function createSummaryCard(label, value, note, className = "") {
    const card = document.createElement("article"); card.className = "summary-card";
    const small = document.createElement("small"); small.textContent = label;
    const strong = document.createElement("strong"); strong.className = `value ${className}`.trim(); strong.textContent = value;
    const span = document.createElement("span"); span.textContent = note; card.append(small, strong, span); return card;
  }
  function requirementsReady() {
    return Boolean(state.config && state.procurementRules && (state.masterFile || state.masterWorkbook) && state.inventoryFile && state.pendingFiles.length && state.transferFile
      && (state.consignmentFile || state.consignmentWorkbook) && (state.lirongConsignmentFile || state.lirongConsignmentWorkbook)
      && state.marketingFile && state.salesFiles.length && state.modelFile && !modelRefreshRequired() && elements.month.value && elements.orderDate.value
      && elements.inventoryDate.value && elements.pendingDate.value && elements.transferDate.value && elements.consignmentDate.value && elements.salesDate.value);
  }
  function updateReadyState() {
    renderModelStatus();
    elements.analyze.disabled = !requirementsReady();
    elements.runShortageOrder.disabled = !requirementsReady() || !state.storeShortageNeeds.some((row) => row.handling_mode === "new_order" && Number(row.unfilled_quantity || 0) > Number(row.covered_quantity || 0));
    updateSpecialWorkflowReady();
    if (!requirementsReady() && !state.analysis) setStatus(modelRefreshRequired()
      ? "請完成公司登入、日期與必要資料；本月季節模型需要提供或更新。"
      : "請完成公司登入、日期與必要資料；商品主檔與寄庫表可自動取得或手動備援。");
  }
  function setFileInputEnabled(input, label, enabled) {
    input.disabled = !enabled;
    label.classList.toggle("is-disabled", !enabled);
  }
  function setWorkflowStep(element, status, note = "") {
    element.dataset.status = status;
    if (note) element.querySelector("small").textContent = note;
  }
  function resetReviewWorkflow(message = "請先在分批審核區勾選一個或多個單位並下載本批Excel；下載後才會開放第一次人工回匯。") {
    state.reviewFile = null; state.firstReview = null; state.secondReviewFile = null; state.review = null; state.approved = false; state.erpDownloaded = false; state.batchId = "";
    elements.reviewFile.value = ""; elements.secondReviewFile.value = "";
    setFileInputEnabled(elements.reviewFile, elements.reviewFileLabel, false);
    setFileInputEnabled(elements.secondReviewFile, elements.secondReviewFileLabel, false);
    elements.reviewButton.disabled = true; elements.confirmReview.disabled = true; elements.submitApproval.disabled = true; elements.submitApproval.textContent = "全部沿用並送出待核准"; elements.approve.disabled = true;
    elements.retryNotification.disabled = true; elements.erp.disabled = true;
    elements.workflowSummary.replaceChildren();
    clearWorkflowErrors();
    setWorkflowStep(elements.workflowStepDownload, state.returnScope ? "done" : (state.analysis ? "active" : "waiting"), state.returnScope ? `已下載${state.activeWorkUnit?.label || `${state.returnScope.size}家供應商`}` : "先選擇一個分批審核單位並下載");
    setWorkflowStep(elements.workflowStepFirst, state.returnScope ? "active" : "locked", state.returnScope ? "已開放第一次人工回匯" : "下載本批Excel後開放");
    setWorkflowStep(elements.workflowStepSecond, "locked", "第一次覆核通過後開放");
    setWorkflowStep(elements.workflowStepApproval, "locked", "第一次覆核通過後開放");
    setWorkflowStatus(message);
  }
  function invalidateAnalysis() {
    state.analysis = null; state.baseAnalysis = null; state.parsedSources = null; state.workflowType = "system_recommendation"; state.consignmentSource = null; state.selectedSuppliers = new Set(); state.returnScope = null; state.purchaseStatusSummary = null; state.costSummary = null; state.draftId = ""; state.draftStage = ""; state.sharedDraftId = ""; state.sharedDraftRevision = 0; state.parentBatchId = ""; state.activeWorkUnit = null; state.selectedWorkUnitIds = new Set();
    elements.download.disabled = true; elements.resultPanel.hidden = true; elements.supplierFilterList.replaceChildren();
    resetReviewWorkflow("請先產生建議，再於分批審核區勾選一個或多個單位並下載本批Excel；下載後才會開放第一次人工回匯。");
    renderBudget();
  }
  function updateSpecialWorkflowReady() {
    const hasBase = Boolean(state.baseAnalysis && state.parsedSources);
    elements.newProductButton.disabled = !(hasBase && state.newProductFile);
    elements.manualDraftButton.disabled = !(hasBase && state.manualDraftFiles.length);
    elements.postedOrderButton.disabled = !(state.postedOrderFiles.length && state.config?.permissions?.canApprove);
  }
  function bindFileInput(input, key, label, multiple = false, workbookKey = "") {
    input.addEventListener("change", () => {
      const files = [...input.files]; state[key] = multiple ? files : (files[0] || null);
      if (workbookKey) state[workbookKey] = null;
      label.textContent = fileLabel(files); invalidateAnalysis(); updateReadyState();
    });
  }
  function validateAutoMaster(workbook) {
    const inspection = core.inspectWorkbook(workbook, XLSX, "master").sheets[0];
    if (!inspection?.validation?.valid) throw new Error(`商品主檔缺少：${inspection?.validation?.missing?.join("、") || "必要欄位"}`);
    const requiredColumns = [["supplier", "供應商"], ["unitCost", "進貨價"], ["moq", "MOQ／最小配貨數"], ["productStatus", "貨品狀態"], ["discontinued", "已下架"]];
    const missingColumns = requiredColumns.filter(([field]) => inspection.mapping[field] == null).map(([, label]) => label);
    if (missingColumns.length) throw new Error(`最新商品主檔缺少必要欄位：${missingColumns.join("、")}`);
    const parsed = core.parseProductMasterWorkbook(workbook, XLSX);
    if (parsed.records.length !== parsed.bySku.size) throw new Error("最新商品主檔有重複ERP品號，已停止採用。");
    const hardInvalidCount = parsed.records.filter((row) => !row.supplier || !(row.unitCost > 0) || !(row.moq > 0)).length;
    const statusReviewCount = parsed.records.filter((row) => !row.productStatus).length;
    return { parsed, invalidCount: hardInvalidCount + statusReviewCount, hardInvalidCount, statusReviewCount };
  }
  async function loadLedger() {
    if (!state.config || !elements.month.value) return;
    try {
      const response = await fetch(`/api/procurement/ledger?month=${encodeURIComponent(elements.month.value)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      state.ledger = result; elements.purchasedToDate.value = String(Number(result.totals.committedAmount || 0));
      elements.ledgerStatus.textContent = `台帳已同步：正式承諾${formatCurrency(result.totals.committedAmount)}；待核准${formatCurrency(result.totals.pendingAmount)}；已核准未建ERP${formatCurrency(result.totals.approvedNotErpAmount)}；已建ERP未到貨${formatCurrency(result.totals.erpNotReceivedAmount)}；已到貨${formatCurrency(result.totals.receivedAmount)}；本月付款${formatCurrency(result.totals.currentMonthPayment)}；未來付款${formatCurrency(result.totals.futureMonthPayments)}。`;
      elements.ledgerStatus.classList.remove("error");
      renderApprovalQueue();
      renderActiveLedger();
      renderErpReconciliations();
      renderBudget();
    } catch (error) {
      state.ledger = null; elements.ledgerStatus.textContent = `台帳同步失敗：${error.message}；為避免錯算，正式核准前請重新整理。`;
      elements.ledgerStatus.classList.add("error");
    }
  }
  function renderApprovalQueue() {
    const pending = (state.ledger?.batches || []).filter((row) => row.status === "pending_approval");
    if (!pending.length) {
      const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 6; cell.textContent = "目前沒有待核准批次。"; row.appendChild(cell); elements.approvalQueueRows.replaceChildren(row); return;
    }
    const fragment = document.createDocumentFragment();
    pending.forEach((item) => {
      const row = document.createElement("tr");
      appendCell(row, item.id); appendCell(row, (item.supplier_summary || []).join("、") || "未提供"); appendCell(row, item.created_by || "");
      appendCell(row, String(item.created_at || "").replace("T", " ").slice(0, 19)); appendCell(row, formatCurrency(item.approved_amount));
      const action = document.createElement("td");
      if (state.config?.permissions?.canApprove) {
        const button = document.createElement("button"); button.type = "button"; button.className = "secondary-button queue-approve"; button.textContent = "核准並寄摘要";
        button.addEventListener("click", () => approveQueuedBatch(item.id, button)); action.appendChild(button);
      } else action.textContent = "待核准";
      row.appendChild(action); fragment.appendChild(row);
    });
    elements.approvalQueueRows.replaceChildren(fragment);
  }
  function statusLabel(status) {
    return ({ pending_approval: "待核准", approved: "已核准", erp_created: "ERP已建立／未到貨", received: "已到貨", revoked: "已撤銷" })[status] || status;
  }
  function workflowLabel(type) {
    return ({ system_recommendation: "一般採購", new_product: "新品首批", manual_draft: "人工匯入", manual_posted: "補登已採購", customer_custom: "客製採購" })[type] || "一般採購";
  }
  function appendLedgerClosureSummary(cell, item) {
    const summary = item.closure_summary || {};
    const details = document.createElement("details"); details.className = "ledger-closure-summary";
    const trigger = document.createElement("summary"); trigger.textContent = "查看ERP閉環摘要"; details.appendChild(trigger);
    if (!summary.hasItemBaseline) {
      const empty = document.createElement("p"); empty.textContent = "此舊批次尚無逐品項閉環基準；回填ERP單號或補回原核准報表後才會顯示收貨數量。"; details.appendChild(empty);
      cell.appendChild(details); return;
    }
    const waitingForErp = item.status === "approved";
    const values = [
      ["原核准金額", formatCurrencyPrecise(summary.originalApprovedAmount)],
      ["ERP／調整後金額", formatCurrencyPrecise(summary.currentCommittedAmount)],
      ["承諾差額", formatCurrencyPrecise(summary.amountDelta)],
      ["ERP訂購量", waitingForErp ? "尚未回填ERP" : `${formatNumber(summary.erpOrderedQuantity)}件`],
      ["累計實收", waitingForErp ? "尚未比對" : `${formatNumber(summary.receivedQuantity)}件`],
      ["剩餘未到", waitingForErp ? "尚未比對" : `${formatNumber(summary.remainingQuantity)}件`]
    ];
    const grid = document.createElement("dl"); grid.className = "ledger-closure-grid";
    values.forEach(([label, value]) => {
      const term = document.createElement("dt"); term.textContent = label;
      const description = document.createElement("dd"); description.textContent = value;
      grid.append(term, description);
    });
    details.appendChild(grid); cell.appendChild(details);
  }
  function renderActiveLedger() {
    const active = (state.ledger?.batches || []).filter((row) => ["approved", "erp_created", "received"].includes(row.status));
    if (!active.length) {
      const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 8; cell.textContent = "本月目前沒有已承諾批次。"; row.appendChild(cell); elements.activeLedgerRows.replaceChildren(row); return;
    }
    const fragment = document.createDocumentFragment();
    active.forEach((item) => {
      const row = document.createElement("tr");
      appendCell(row, item.id); appendCell(row, workflowLabel(item.workflow_type));
      const erpCell = document.createElement("td");
      if (item.status === "approved" && state.config?.permissions?.canApprove && !["manual_posted", "customer_custom"].includes(item.workflow_type)) {
        const entry = document.createElement("label"); entry.className = "ledger-erp-entry";
        const input = document.createElement("input"); input.type = "text"; input.maxLength = 120; input.placeholder = "輸入ERP採購單號"; input.setAttribute("aria-label", `${item.id} ERP採購單號`);
        const hint = document.createElement("small"); hint.textContent = "匯入ERP後填寫；一張正式單號只能綁定一個批次。";
        entry.append(input, hint); erpCell.appendChild(entry);
        erpCell.dataset.erpEntry = item.id;
      } else {
        const reference = document.createElement("strong"); reference.textContent = item.erp_reference || "—"; erpCell.appendChild(reference);
        if (item.erp_reference && item.erp_created_at) {
          const meta = document.createElement("small"); meta.textContent = `由${item.erp_created_by || "核准者"}・${String(item.erp_created_at).replace("T", " ").slice(0, 19)}`; meta.style.display = "block"; erpCell.appendChild(meta);
        }
      }
      row.appendChild(erpCell);
      appendCell(row, (item.supplier_summary || []).join("、") || "未提供"); appendCell(row, statusLabel(item.status));
      const amountCell = document.createElement("td");
      const amount = document.createElement("strong"); amount.textContent = formatCurrency(item.approved_amount); amountCell.appendChild(amount);
      appendLedgerClosureSummary(amountCell, item); row.appendChild(amountCell);
      appendCell(row, `v${item.revision}`);
      const action = document.createElement("td"); action.className = "ledger-action-stack";
      if (item.status === "approved" && state.config?.permissions?.canApprove && !["manual_posted", "customer_custom"].includes(item.workflow_type)) {
        const button = document.createElement("button"); button.type = "button"; button.className = "secondary-button"; button.textContent = "確認ERP已開立"; button.disabled = true;
        const input = erpCell.querySelector("input");
        input.addEventListener("input", () => { button.disabled = !input.value.trim(); });
        button.addEventListener("click", () => confirmLedgerErpCreated(item, input, button)); action.appendChild(button);
      }
      if (state.config?.role === "admin" && item.status !== "received") {
        const correctButton = document.createElement("button"); correctButton.type = "button"; correctButton.className = "table-action"; correctButton.textContent = "更正金額";
        correctButton.addEventListener("click", () => correctLedgerBatch(item, correctButton));
        const revokeButton = document.createElement("button"); revokeButton.type = "button"; revokeButton.className = "table-action"; revokeButton.textContent = "撤銷";
        revokeButton.addEventListener("click", () => revokeLedgerBatch(item, revokeButton));
        action.append(correctButton, revokeButton);
      }
      if (state.config?.permissions?.canApprove) {
        const notifyButton = document.createElement("button"); notifyButton.type = "button"; notifyButton.className = "table-action"; notifyButton.textContent = "重送摘要";
        notifyButton.addEventListener("click", () => retryLedgerNotification(item.id, notifyButton));
        action.appendChild(notifyButton);
      }
      if (!action.childNodes.length) action.textContent = item.status === "received" ? "已由收貨結案" : "僅最高權限可更正／撤銷";
      row.appendChild(action); fragment.appendChild(row);
    });
    elements.activeLedgerRows.replaceChildren(fragment);
  }
  async function confirmLedgerErpCreated(item, input, button) {
    const erpReference = input.value.trim();
    if (!erpReference) return;
    button.disabled = true; input.disabled = true;
    try {
      const localDraft = state.batchId === item.id
        ? { review: state.review }
        : state.workflowDrafts.find((draft) => draft.batchId === item.id && draft.review);
      const approvedItems = (localDraft?.review?.rows || []).filter((row) => Number(row.finalQty || 0) > 0).map((row) => ({
        sku: row.sku, name: row.name || "", supplier: row.supplier || "", quantity: Number(row.finalQty || 0),
        unitCost: Number(row.unitCost || 0), amount: Number(row.finalQty || 0) * Number(row.unitCost || 0)
      }));
      await postJson(`/api/procurement/batches/${encodeURIComponent(item.id)}/erp-created`, {
        erpReference, approvedItems, idempotencyKey: `${item.id}:erp:${erpReference}`
      });
      if (item.id === state.batchId) await persistWorkflowDraft("erp_created");
      await loadLedger();
      setWorkflowStatus(`批次${item.id}已連結ERP採購單${erpReference}；後續完整採購檔會自動核對收貨與差異。`, "success");
    } catch (error) {
      button.disabled = false; input.disabled = false;
      setWorkflowStatus(`ERP單號回填失敗（已承諾批次${item.id}）：${error.message}`, "error");
    }
  }
  function reconciliationTypeLabel(type) {
    return ({ added: "ERP新增品項", removed: "ERP少了品項", quantity: "數量不同", price: "價格不同" })[type] || "內容不同";
  }
  function renderErpReconciliations() {
    const records = state.ledger?.reconciliations || [];
    elements.erpReconciliationPanel.hidden = records.length === 0;
    if (!records.length) { elements.erpReconciliationList.replaceChildren(); return; }
    const fragment = document.createDocumentFragment();
    records.forEach((record) => {
      const card = document.createElement("article"); card.className = "erp-reconciliation-card";
      const heading = document.createElement("h5"); heading.textContent = `${record.erp_reference}・${(record.supplier_summary || []).join("、") || "未提供供應商"}`;
      const summary = document.createElement("p"); summary.textContent = `原承諾${formatCurrencyPrecise(record.amount_before)}，ERP目前${formatCurrencyPrecise(record.amount_after)}，差額${formatCurrencyPrecise(record.amount_delta)}；共${record.difference_count}項需確認。`;
      const wrap = document.createElement("div"); wrap.className = "result-table-wrap";
      const table = document.createElement("table"); table.className = "procurement-table compact-table";
      table.innerHTML = "<thead><tr><th>ERP品號</th><th>品名</th><th>差異</th><th>核准數量</th><th>ERP數量</th><th>原單價</th><th>ERP單價</th><th>金額差異</th></tr></thead>";
      const tbody = document.createElement("tbody");
      (record.items || []).forEach((item) => {
        const tr = document.createElement("tr");
        [item.sku, item.name || "", reconciliationTypeLabel(item.difference_type), formatNumber(item.approved_quantity), formatNumber(item.erp_quantity), formatCurrencyPrecise(item.unit_cost_before), formatCurrencyPrecise(item.unit_cost_after), formatCurrencyPrecise(item.amount_delta)].forEach((value) => appendCell(tr, value));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody); wrap.appendChild(table);
      const actions = document.createElement("div"); actions.className = "erp-reconciliation-actions";
      const label = document.createElement("label"); label.textContent = "差異原因";
      const reason = document.createElement("textarea"); reason.rows = 2; reason.maxLength = 500; reason.placeholder = "例如：臨時追加贈品抱枕套，已向主管確認"; label.appendChild(reason);
      const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "primary-button"; confirm.textContent = "確認並更新台帳"; confirm.disabled = !state.config?.permissions?.canApprove;
      const sourceError = document.createElement("button"); sourceError.type = "button"; sourceError.className = "secondary-button"; sourceError.textContent = "標記ERP資料有誤"; sourceError.disabled = !state.config?.permissions?.canApprove;
      const status = document.createElement("p"); status.className = "erp-reconciliation-status main-status"; status.setAttribute("role", "status");
      confirm.addEventListener("click", () => resolveErpReconciliation(record, reason, confirm, status, "confirm"));
      sourceError.addEventListener("click", () => resolveErpReconciliation(record, reason, sourceError, status, "source-error"));
      actions.append(label, confirm, sourceError, status); card.append(heading, summary, wrap, actions); fragment.appendChild(card);
    });
    elements.erpReconciliationList.replaceChildren(fragment);
  }
  async function resolveErpReconciliation(record, reasonInput, button, status, action) {
    const reason = reasonInput.value.trim();
    if (!reason) { status.textContent = "請先填寫差異原因。"; status.className = "erp-reconciliation-status main-status error"; return; }
    button.disabled = true; status.textContent = action === "confirm" ? "正在更新原批次台帳…" : "正在標記本次ERP來源資料…";
    try {
      await postJson(`/api/procurement/erp-reconciliations/${record.id}/${action}`, { reason });
      if (action === "confirm") await sendPendingNotification(record.batch_id).catch(() => false);
      await loadLedger();
      setWorkflowStatus(action === "confirm" ? `${record.erp_reference}差異已確認並更新原批次台帳。` : `${record.erp_reference}已標記為ERP來源資料有誤；台帳未變更。`, "success");
    } catch (error) { button.disabled = false; status.textContent = `ERP差異處理失敗（${record.erp_reference}）：${error.message}`; status.className = "erp-reconciliation-status main-status error"; }
  }
  async function sendPendingNotification(batchId) {
    const token = googleSources.token();
    if (!token) return false;
    await postJson(`/api/procurement/batches/${encodeURIComponent(batchId)}/notify`, {}, { "X-Google-Access-Token": token });
    return true;
  }
  async function retryLedgerNotification(batchId, button) {
    if (!googleSources.token()) { setWorkflowStatus("請先完成公司 Google 授權，再重送這筆額度摘要。", "error"); return; }
    button.disabled = true;
    try {
      const result = await postJson(`/api/procurement/batches/${encodeURIComponent(batchId)}/notify`, {}, { "X-Google-Access-Token": googleSources.token() });
      setWorkflowStatus(result.status === "sent" ? `批次${batchId}摘要已寄送。` : `批次${batchId}目前沒有待寄摘要。`, "success");
    } catch (error) { button.disabled = false; setWorkflowStatus(`摘要重送失敗：${error.message}`, "error"); }
  }
  async function revokeLedgerBatch(item, button) {
    const reason = globalThis.prompt(`請輸入撤銷批次${item.id}的原因（撤銷後會沖回${formatCurrency(item.approved_amount)}）：`, "");
    if (!reason?.trim()) return;
    button.disabled = true;
    try {
      await postJson(`/api/procurement/batches/${encodeURIComponent(item.id)}/revoke`, { reason: reason.trim(), idempotencyKey: `${item.id}:revoke:${item.revision}` });
      const sent = await sendPendingNotification(item.id).catch(() => false);
      await loadLedger();
      setWorkflowStatus(`批次${item.id}已撤銷並沖回額度；摘要${sent ? "已寄送" : "待Google授權後重送"}。`, sent ? "success" : "error");
    } catch (error) { button.disabled = false; setWorkflowStatus(`撤銷失敗：${error.message}`, "error"); }
  }
  function scaledPaymentValues(item, approvedAmount) {
    const original = Number(item.approved_amount || 0);
    const schedule = Array.isArray(item.payment_schedule) ? item.payment_schedule.map((row) => ({ ...row })) : [];
    if (schedule.length && original > 0) {
      let allocated = 0;
      schedule.forEach((entry, index) => {
        const amount = index === schedule.length - 1 ? approvedAmount - allocated : Math.round(Number(entry.amount || 0) / original * approvedAmount * 100) / 100;
        entry.amount = amount; allocated += amount;
      });
      const current = schedule.filter((row) => row.month === elements.month.value).reduce((sum, row) => sum + Number(row.amount || 0), 0);
      return { schedule, current, future: approvedAmount - current };
    }
    const currentRatio = original > 0 ? Number(item.payment_current_month || 0) / original : 1;
    const current = Math.round(approvedAmount * currentRatio * 100) / 100;
    return { schedule, current, future: approvedAmount - current };
  }
  async function correctLedgerBatch(item, button) {
    const amountText = globalThis.prompt(`批次${item.id}目前承諾${formatCurrency(item.approved_amount)}。請輸入更正後承諾金額：`, String(item.approved_amount));
    if (amountText == null) return;
    const approvedAmount = Number(amountText.replace(/,/g, ""));
    if (!Number.isFinite(approvedAmount) || approvedAmount < 0) { setWorkflowStatus("更正金額必須是0或正數。", "error"); return; }
    const reason = globalThis.prompt("請輸入本次更正原因：", "");
    if (!reason?.trim()) return;
    const payment = scaledPaymentValues(item, approvedAmount);
    button.disabled = true;
    try {
      await postJson(`/api/procurement/batches/${encodeURIComponent(item.id)}/correct`, {
        expectedRevision: Number(item.revision), suggestedAmount: Number(item.suggested_amount || 0), manualAmount: approvedAmount + Number(item.blocked_amount || 0),
        blockedAmount: Number(item.blocked_amount || 0), approvedAmount, adjustmentAmount: approvedAmount - Number(item.suggested_amount || 0),
        paymentCurrentMonth: payment.current, paymentFutureMonths: payment.future, paymentSchedule: payment.schedule,
        reason: reason.trim(), idempotencyKey: `${item.id}:correct:${item.revision}:${approvedAmount}`
      });
      const sent = await sendPendingNotification(item.id).catch(() => false);
      await loadLedger();
      setWorkflowStatus(`批次${item.id}已更正為${formatCurrency(approvedAmount)}；摘要${sent ? "已寄送" : "待Google授權後重送"}。`, sent ? "success" : "error");
    } catch (error) { button.disabled = false; setWorkflowStatus(`更正失敗：${error.message}`, "error"); }
  }
  async function approveQueuedBatch(batchId, button) {
    const token = googleSources.token();
    if (!token) { setWorkflowStatus("請先按上方「公司 Google 授權」，再核准共用待核准批次；核准後系統才能立即寄送摘要。", "error"); return; }
    button.disabled = true; setWorkflowStatus(`正在核准批次${batchId}…`);
    try {
      await postJson(`/api/procurement/batches/${encodeURIComponent(batchId)}/approve`, { idempotencyKey: `${batchId}:approve` });
      await postJson(`/api/procurement/batches/${encodeURIComponent(batchId)}/notify`, {}, { "X-Google-Access-Token": token });
      setWorkflowStatus(`批次${batchId}已核准，摘要已寄送給siang01。`, "success");
      await loadLedger();
    } catch (error) { button.disabled = false; setWorkflowStatus(`核准失敗：${error.message}`, "error"); }
  }

  async function loadProcurementRules() {
    const response = await fetch("/api/procurement/rules", { headers: { Accept: "application/json" }, cache: "no-store" });
    const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    state.procurementRules = result.rules;
    elements.blacklist.value = blacklistEntries().join("\n");
    elements.blacklistStatus.textContent = `公司共用黑名單目前${blacklistEntries().length}項・規則版本v${result.version}`;
  }
  function applyMonthPlan(plan) {
    state.monthPlan = plan;
    state.budgetDirty = false;
    state.revenueChannels = Array.isArray(plan?.revenueChannels) ? plan.revenueChannels.map((row) => ({ ...row })) : [];
    elements.forecastRevenue.value = String(plan?.forecastRevenue ?? 0);
    const savedRevenue = Number(plan?.forecastRevenue || 0);
    const savedCost = Number(plan?.forecastCostOutflow || 0);
    state.forecastCostRate = savedRevenue > 0 && savedCost > 0 ? savedCost / savedRevenue : DEFAULT_COST_RATE;
    elements.forecastCost.value = String(Math.round(Number(elements.forecastRevenue.value || 0) * state.forecastCostRate * 100) / 100);
    elements.targetEndingCost.value = String(plan?.targetEndingInventoryCost ?? 0);
    elements.openingCost.value = String(plan?.openingInventoryCost ?? 0);
    elements.supplierReturns.value = String(plan?.expectedSupplierReturns ?? 0);
    elements.releasedBudget.value = String(plan?.releasedBudgetAmount ?? plan?.budgetAmount ?? 0);
    elements.budgetSourceNote.value = plan?.sourceNote || "";
    elements.budgetPlanStatus.textContent = plan
      ? `已同步${plan.analysisMonth}中性情境：整月額度${formatCurrency(plan.fullBudgetAmount)}・已釋放${formatCurrency(plan.releasedBudgetAmount)}・更新${String(plan.updatedAt || "").replace("T", " ").slice(0, 19)}。`
      : `${elements.month.value}尚無已核准月份快照；目前欄位只在本頁暫存。`;
    renderChannels(); renderBudget();
  }
  function renderChannels() {
    const editable = state.config?.permissions?.canManageBudget === true;
    const fragment = document.createDocumentFragment();
    state.revenueChannels.forEach((item, index) => {
      const row = document.createElement("tr");
      const companyCell = document.createElement("td"); const company = document.createElement("select");
      ["寬承", "寬沐"].forEach((name) => { const option = document.createElement("option"); option.value = name; option.textContent = name; company.appendChild(option); }); company.value = item.company; company.disabled = !editable;
      const channelCell = document.createElement("td"); const channel = document.createElement("input"); channel.type = "text"; channel.value = item.channel || ""; channel.disabled = !editable;
      const amountCell = document.createElement("td"); const amount = document.createElement("input"); amount.type = "number"; amount.min = "0"; amount.step = "1"; amount.value = String(item.amount || 0); amount.disabled = !editable;
      const actionCell = document.createElement("td"); const remove = document.createElement("button"); remove.type = "button"; remove.className = "table-action"; remove.textContent = "刪除"; remove.disabled = !editable;
      const changed = () => { state.revenueChannels[index] = { company: company.value, channel: channel.value.trim(), amount: Number(amount.value || 0) }; renderChannelTotals(); markBudgetDirty(); };
      company.addEventListener("change", changed); channel.addEventListener("input", changed); amount.addEventListener("input", changed);
      remove.addEventListener("click", () => { state.revenueChannels.splice(index, 1); renderChannels(); markBudgetDirty(); });
      companyCell.appendChild(company); channelCell.appendChild(channel); amountCell.appendChild(amount); actionCell.appendChild(remove); row.append(companyCell, channelCell, amountCell, actionCell); fragment.appendChild(row);
    });
    elements.channelRows.replaceChildren(fragment); renderChannelTotals();
  }
  function renderChannelTotals() {
    const subtotal = (company) => state.revenueChannels.filter((row) => row.company === company).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const kuancheng = subtotal("寬承"); const kuanmu = subtotal("寬沐");
    elements.kuanchengTotal.textContent = formatCurrency(kuancheng); elements.kuanmuTotal.textContent = formatCurrency(kuanmu);
    elements.terminalForecastRevenue.value = String(kuancheng + kuanmu);
  }
  function updateAutomaticForecastCost() {
    if (state.costSummary?.forecastCost > 0) {
      elements.forecastCost.value = String(Math.round(state.costSummary.forecastCost * 100) / 100);
      return;
    }
    const revenue = Math.max(0, Number(elements.forecastRevenue.value || 0));
    elements.forecastCost.value = String(Math.round(revenue * state.forecastCostRate * 100) / 100);
  }
  function addRevenueChannel() {
    state.revenueChannels.push({ company: "寬承", channel: "新通路", amount: 0 }); renderChannels(); markBudgetDirty();
  }
  async function loadMonthPlan() {
    if (!state.config || !elements.month.value) return;
    try {
      const response = await fetch(`/api/procurement/month-plan?month=${encodeURIComponent(elements.month.value)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      applyMonthPlan(result.plan || null);
    } catch (error) {
      state.monthPlan = null;
      state.budgetDirty = true;
      elements.budgetPlanStatus.textContent = `月份額度同步失敗：${error.message}；正式核准前請重新整理。`;
      renderBudget();
    }
  }
  function effectiveCostSummary() {
    return state.costSummary || state.sharedCostSnapshot;
  }
  function renderCostSnapshotStatus() {
    if (!elements.costSnapshotStatus) return;
    const snapshot = state.sharedCostSnapshot;
    elements.costSnapshotStatus.textContent = snapshot
      ? `公司共用成本快照：資料截至${snapshot.dataAsOfDate}・由${snapshot.updatedBy}更新於${String(snapshot.updatedAt || "").replace("T", " ").slice(0, 19)}。`
      : `${elements.month.value}尚無公司共用成本快照；完成一次正式採購建議運算後才會建立。`;
  }
  async function loadCostSnapshot() {
    if (!state.config || !elements.month.value) return;
    try {
      const response = await fetch(`/api/procurement/cost-snapshot?month=${encodeURIComponent(elements.month.value)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      state.sharedCostSnapshot = result.snapshot || null;
      if (!state.costSummary && state.sharedCostSnapshot?.forecastCost >= 0) elements.forecastCost.value = String(state.sharedCostSnapshot.forecastCost);
      renderCostSnapshotStatus(); renderBudget();
    } catch (error) {
      state.sharedCostSnapshot = null;
      if (elements.costSnapshotStatus) elements.costSnapshotStatus.textContent = `公司共用成本快照同步失敗：${error.message}`;
      renderBudget();
    }
  }
  async function saveCostSnapshot() {
    if (!state.config?.permissions?.canApprove || !state.costSummary) {
      renderCostSnapshotStatus();
      return;
    }
    const summary = state.costSummary;
    try {
      const result = await postJson("/api/procurement/cost-snapshot", {
        analysisMonth: elements.month.value,
        checkpoint: elements.checkpoint.value,
        dataAsOfDate: [elements.inventoryDate.value, elements.pendingDate.value, elements.transferDate.value, elements.salesDate.value].filter(Boolean).sort().at(-1),
        inventoryDate: elements.inventoryDate.value,
        pendingDate: elements.pendingDate.value,
        transferDate: elements.transferDate.value,
        salesDate: elements.salesDate.value,
        forecastCost: Number(elements.forecastCost.value || 0),
        managementCostToDate: Number(summary.managementCostToDate || 0),
        actualReceiptCost: Number(summary.actualReceiptCost || 0),
        directCost: Number(summary.directCost || 0),
        kuanmuBaseCost: Number(summary.kuanmuBaseCost || 0),
        kuanmuIntercompanyRevenue: Number(summary.kuanmuIntercompanyRevenue || 0),
        currentInventoryCost: Number(summary.currentInventoryCost || 0),
        inventoryBridgeCost: summary.inventoryBridgeCost == null ? null : Number(summary.inventoryBridgeCost),
        source: summary.source || "actual_weighted",
        maxSalesDate: summary.maxSalesDate || elements.salesDate.value,
        transferReceivedCount: Number(summary.transferReceivedCount || 0),
        b3MatchedCount: Number(summary.b3MatchedCount || 0),
        warnings: summary.warnings || [],
        sourceHashes: state.analysis?.meta?.sourceHashes || {},
        calculationVersion: "20260918-custom-cost-r1"
      }, {}, "PUT");
      state.sharedCostSnapshot = result.snapshot;
      renderCostSnapshotStatus();
    } catch (error) {
      if (elements.costSnapshotStatus) elements.costSnapshotStatus.textContent = `本次採購建議已完成，但公司共用成本快照未更新：${error.message}`;
    }
  }
  async function loadConfig() {
    try {
      const response = await fetch("/api/procurement/config", { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "請先完成公司帳號登入。" : `權限服務回應${response.status}`);
      state.config = await response.json();
      const roleLabel = { admin: "最高權限", approver: "採購核准者", operator: "採購操作" }[state.config.role] || "公司使用者";
      elements.accountBadge.textContent = `${state.config.email}・${roleLabel}`;
      if (state.config.googleOAuthClientId) { elements.googleConnect.disabled = false; }
      else {
        elements.googleConnect.disabled = true;
        elements.sourceStatus.textContent = "Cloudflare 尚未設定 GOOGLE_OAUTH_CLIENT_ID；自動來源與郵件暫停。";
        elements.sourceStatus.classList.add("error");
      }
      elements.saveBudget.disabled = !state.config.permissions?.canManageBudget;
      elements.addChannel.disabled = !state.config.permissions?.canManageBudget;
      await Promise.all([loadProcurementRules(), loadLedger(), loadMonthPlan(), loadStoreShortageNeeds(), loadSharedWorkflowDrafts()]);
      await loadCostSnapshot();
    } catch (error) {
      state.config = null; elements.accountBadge.textContent = "公司登入驗證失敗";
      elements.sourceStatus.textContent = error.message; elements.sourceStatus.classList.add("error");
    }
    updateReadyState();
  }

  function handlingLabel(row) {
    if (row.status === "covered_waiting") return "已由採購覆蓋待到貨";
    if (row.status === "arrived") return Number(row.fulfilled_quantity || 0) > 0 ? "已到貨，後續批次部分補配" : "已到貨待下次調撥";
    return ({ pending_decision: "待決定", merge_next: "等待併入下一張採購單", new_order: "建立門市不足補採新單" })[row.handling_mode] || row.status || "待決定";
  }
  function selectedStoreShortageKeys() {
    return [...elements.storeShortageRows.querySelectorAll("[data-shortage-select]:checked")].map((input) => ({ storeCode: input.dataset.store, sku: input.dataset.sku }));
  }
  function updateStoreShortageSelection() {
    const checkboxes = [...elements.storeShortageRows.querySelectorAll("[data-shortage-select]")];
    const selected = checkboxes.filter((input) => input.checked).length;
    elements.storeShortageSelectedCount.textContent = `${selected}項`;
    elements.storeShortageSelectAll.checked = checkboxes.length > 0 && selected === checkboxes.length;
    elements.storeShortageSelectAll.indeterminate = selected > 0 && selected < checkboxes.length;
    elements.storeShortageBatchBar.querySelectorAll("[data-shortage-bulk-mode], [data-shortage-bulk-close]").forEach((button) => { button.disabled = selected === 0 || !state.storeShortagePermissions?.canDecide; });
  }
  function renderStoreShortageNeeds() {
    const rows = state.storeShortageNeeds || [];
    const total = rows.reduce((sum, row) => sum + Number(row.unfilled_quantity || 0), 0);
    const canDecide = Boolean(state.storeShortagePermissions?.canDecide);
    const countLabel = rows.length ? `${rows.length}項・${formatNumber(total)}件` : "目前無待辦";
    elements.storeShortageCount.textContent = countLabel;
    elements.storeShortageTopCount.textContent = rows.length ? `門市不足 ${countLabel}` : "門市不足目前無待辦";
    elements.storeShortageEmpty.hidden = rows.length > 0;
    elements.storeShortageBatchBar.hidden = rows.length === 0;
    elements.storeShortageTableWrap.hidden = rows.length === 0;
    if (!state.storeShortageRendered || (rows.length > 0 && !elements.storeShortageCard.open)) elements.storeShortageCard.open = rows.length > 0;
    state.storeShortageRendered = true;
    elements.storeShortageRows.innerHTML = rows.map((row) => {
      const purchaseUncovered = Math.max(0, Number(row.unfilled_quantity || 0) - Number(row.covered_quantity || 0));
      const transferRemaining = Math.max(0, Number(row.unfilled_quantity || 0) - Number(row.fulfilled_quantity || 0));
      const disabled = canDecide ? "" : " disabled";
      return `<tr><td class="shortage-select-column"><input type="checkbox" data-shortage-select data-store="${escapeHtml(row.store_code)}" data-sku="${escapeHtml(row.sku)}" aria-label="選取${escapeHtml(row.store_code)} ${escapeHtml(row.sku)}"${disabled}></td><td>${escapeHtml(row.store_code)}</td><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.product_name)}</td><td>${formatNumber(row.approved_demand_quantity)}</td><td>${formatNumber(row.allocated_quantity)}</td><td>${formatNumber(row.unfilled_quantity)}</td><td>${formatNumber(row.covered_quantity)}</td><td>${formatNumber(purchaseUncovered)}</td><td>${formatNumber(row.fulfilled_quantity || 0)}</td><td>${formatNumber(transferRemaining)}</td><td>${escapeHtml(row.needed_by || "待確認")}</td><td>${escapeHtml(handlingLabel(row))}</td><td><div class="shortage-actions"><button type="button" data-shortage-mode="merge_next" data-store="${escapeHtml(row.store_code)}" data-sku="${escapeHtml(row.sku)}" class="${row.handling_mode === "merge_next" ? "is-selected" : ""}"${disabled}>併入下一張</button><button type="button" data-shortage-mode="new_order" data-store="${escapeHtml(row.store_code)}" data-sku="${escapeHtml(row.sku)}" class="${row.handling_mode === "new_order" ? "is-selected" : ""}"${disabled}>建立補採新單</button><button type="button" data-shortage-close="resolved" data-store="${escapeHtml(row.store_code)}" data-sku="${escapeHtml(row.sku)}"${disabled}>已補配結案</button><button type="button" data-shortage-close="cancelled" data-store="${escapeHtml(row.store_code)}" data-sku="${escapeHtml(row.sku)}"${disabled}>取消需求</button></div></td></tr>`;
    }).join("");
    elements.storeShortageSelectAll.disabled = !canDecide || rows.length === 0;
    updateStoreShortageSelection();
    elements.runShortageOrder.disabled = !rows.some((row) => row.handling_mode === "new_order" && Number(row.unfilled_quantity || 0) > Number(row.covered_quantity || 0)) || !requirementsReady();
  }
  async function loadStoreShortageNeeds() {
    try {
      const response = await fetch("/api/procurement/store-shortages", { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      state.storeShortageNeeds = result.rows || [];
      state.storeShortagePermissions = result.permissions || { canDecide: false };
      renderStoreShortageNeeds();
      elements.storeShortageStatus.textContent = state.storeShortageNeeds.length ? "請先選擇處理方式；已選擇的最新版需求會在本次計算與未到貨量交叉檢查。" : "目前沒有已由總部核准、仍未配足的門市需求。";
    } catch (error) {
      state.storeShortageNeeds = [];
      state.storeShortagePermissions = { canDecide: false };
      renderStoreShortageNeeds();
      elements.storeShortageStatus.textContent = `門市未配需求同步失敗：${error.message}`;
    }
  }
  async function decideStoreShortage(event) {
    const closeButton = event.target.closest("[data-shortage-close]");
    if (closeButton) {
      const actionLabel = closeButton.dataset.shortageClose === "resolved" ? "已補配結案" : "取消需求";
      const reason = globalThis.prompt(`請輸入${closeButton.dataset.store}／${closeButton.dataset.sku}${actionLabel}的原因：`, "");
      if (!reason?.trim()) return;
      closeButton.disabled = true;
      try {
        await postJson(`/api/procurement/store-shortages/${encodeURIComponent(closeButton.dataset.store)}/${encodeURIComponent(closeButton.dataset.sku)}/close`, { resolutionType: closeButton.dataset.shortageClose, reason: reason.trim() });
        await loadStoreShortageNeeds();
        if (state.analysis) invalidateAnalysis();
        elements.storeShortageStatus.textContent = `${closeButton.dataset.store}／${closeButton.dataset.sku}已${actionLabel}，並保留結案紀錄。`;
      } catch (error) {
        closeButton.disabled = false;
        elements.storeShortageStatus.textContent = `結案失敗：${error.message}`;
      }
      return;
    }
    const button = event.target.closest("[data-shortage-mode]");
    if (!button) return;
    button.disabled = true;
    try {
      await postJson(`/api/procurement/store-shortages/${encodeURIComponent(button.dataset.store)}/${encodeURIComponent(button.dataset.sku)}`, { handlingMode: button.dataset.shortageMode }, {}, "PUT");
      await loadStoreShortageNeeds();
      if (state.analysis) invalidateAnalysis();
      elements.storeShortageStatus.textContent = "處理方式已儲存；請重新產生採購建議，系統會用最新版需求防重計算。";
    } catch (error) {
      button.disabled = false;
      elements.storeShortageStatus.textContent = `處理方式儲存失敗：${error.message}`;
    }
  }

  async function batchDecideStoreShortages(button) {
    const selected = selectedStoreShortageKeys();
    if (!selected.length) return;
    const mode = button.dataset.shortageBulkMode;
    const resolutionType = button.dataset.shortageBulkClose;
    const actionLabel = mode === "merge_next" ? "併入下一張採購" : mode === "new_order" ? "建立補採新單" : resolutionType === "resolved" ? "已補配結案" : "取消需求";
    let reason = "";
    if (resolutionType) {
      reason = globalThis.prompt(`請輸入這${selected.length}項批次「${actionLabel}」的共同原因：`, "")?.trim() || "";
      if (!reason) return;
    } else if (!globalThis.confirm(`確定將已勾選的${selected.length}項批次設為「${actionLabel}」？`)) return;
    elements.storeShortageBatchBar.querySelectorAll("button").forEach((item) => { item.disabled = true; });
    elements.storeShortageStatus.textContent = `正在批次處理${selected.length}項「${actionLabel}」…`;
    const failures = [];
    for (const item of selected) {
      try {
        if (resolutionType) {
          await postJson(`/api/procurement/store-shortages/${encodeURIComponent(item.storeCode)}/${encodeURIComponent(item.sku)}/close`, { resolutionType, reason });
        } else {
          await postJson(`/api/procurement/store-shortages/${encodeURIComponent(item.storeCode)}/${encodeURIComponent(item.sku)}`, { handlingMode: mode }, {}, "PUT");
        }
      } catch (error) {
        failures.push(`${item.storeCode}／${item.sku}：${error.message}`);
      }
    }
    await loadStoreShortageNeeds();
    if (state.analysis) invalidateAnalysis();
    if (failures.length) {
      elements.storeShortageStatus.textContent = `已完成${selected.length - failures.length}項；另有${failures.length}項失敗：${failures.slice(0, 3).join("；")}`;
    } else {
      elements.storeShortageStatus.textContent = `已完成${selected.length}項「${actionLabel}」；系統保留逐筆處理與稽核紀錄。`;
    }
  }

  async function savePendingSnapshot(pendingReports) {
    const pending = core.aggregatePendingReports(pendingReports);
    const rows = [...pending.bySku.values()].map((row) => ({
      sku: row.sku, productName: row.name || "", pendingQuantity: row.quantity,
      expectedDeliveryDate: (row.deliveries || []).map((item) => item.deliveryDate).filter(Boolean).sort()[0] || ""
    }));
    await postJson("/api/procurement/pending-purchase-snapshot", { sourceDate: elements.pendingDate.value, rows }, {}, "PUT");
  }
  async function syncErpReconciliations(pendingReports) {
    const linkedReferences = new Set((state.ledger?.batches || []).filter((row) => ["erp_created", "received"].includes(row.status) && row.erp_reference).map((row) => String(row.erp_reference).trim()));
    if (!linkedReferences.size) return;
    const grouped = new Map();
    pendingReports.flatMap((report) => report.records || []).forEach((row) => {
      const erpReference = String(row.documentCode || "").trim();
      if (!linkedReferences.has(erpReference)) return;
      const group = grouped.get(erpReference) || { erpReference, sourceStatus: "", documentClosed: false, fullyReceived: false, items: new Map() };
      group.sourceStatus = row.status || group.sourceStatus;
      group.documentClosed ||= Boolean(row.documentClosed);
      group.fullyReceived ||= Boolean(row.fullyReceived);
      const existing = group.items.get(row.sku);
      if (existing && Math.abs(Number(existing.unitCost || 0) - Number(row.unitCost || 0)) >= 0.01) throw new Error(`${erpReference}的${row.sku}在完整採購檔出現不同未稅採購價。`);
      const item = existing || { sku: row.sku, name: row.name || "", orderedQuantity: 0, unitCost: Number(row.unitCost || 0), orderedAmount: 0, deliveredQuantity: 0, remainingQuantity: 0, lifecycleStatus: "" };
      item.orderedQuantity += Number(row.orderedQuantity || 0);
      item.orderedAmount += Number(row.orderedAmount || 0) || Number(row.orderedQuantity || 0) * Number(row.unitCost || 0);
      item.deliveredQuantity += Number(row.deliveredQuantity || 0);
      item.remainingQuantity += Number(row.remainingQuantity || 0);
      item.lifecycleStatus = row.status || item.lifecycleStatus;
      group.items.set(row.sku, item); grouped.set(erpReference, group);
    });
    if (!grouped.size) return;
    const orders = [...grouped.values()].map((group) => ({ ...group, items: [...group.items.values()] }));
    const result = await postJson("/api/procurement/erp-reconciliations", { orders });
    const pendingCount = (result.results || []).filter((row) => row.status === "pending").length;
    const missing = (result.results || []).filter((row) => row.status === "missing_baseline").map((row) => row.erpReference);
    await loadLedger();
    if (missing.length) throw new Error(`ERP差異比對缺少原核准逐品項基準：${missing.join("、")}。這些舊批次台帳未變更，請保留原核准報表供補回。`);
    if (pendingCount) setWorkflowStatus(`完整採購檔已找到${pendingCount}筆ERP內容差異，請在「ERP差異待確認」逐筆填寫原因後更新台帳。`, "error");
  }
  async function connectGoogle() {
    elements.googleConnect.disabled = true; elements.sourceStatus.textContent = "正在等待公司 Google 授權…";
    try {
      googleSources.initialize(state.config.googleOAuthClientId);
      await googleSources.authorize(); const identity = await googleSources.verifyCompanyIdentity();
      if (identity.email !== state.config.email) throw new Error("Google 授權帳號與公司登入帳號不一致。");
      state.googleAuthorized = true;
      elements.googleConnect.textContent = "Google 已授權"; elements.autoSource.disabled = false;
      elements.sourceStatus.textContent = "授權完成；正在確認公司共用的最新季節模型。access token只保存在目前分頁記憶體。";
      elements.sourceStatus.className = "result-alert";
      updateModelControls();
      await loadApprovedSeasonalModel();
    } catch (error) {
      state.googleAuthorized = false;
      elements.sourceStatus.textContent = error.message; elements.sourceStatus.className = "result-alert error"; elements.googleConnect.disabled = false;
      updateModelControls();
    }
  }
  async function loadAutomaticSources() {
    resetSourceProgress();
    setAutomaticSourceBusy(true, "正在取得 4 項最新資料…");
    elements.sourceStatus.textContent = "已開始唯讀取得固定 Google 資料；下方會逐項顯示進度與結果。";
    elements.sourceStatus.className = "result-alert";
    let completed = false;
    try {
      const sources = await googleSources.loadAll(state.config, XLSX, ({ id, status, message }) => updateSourceProgress(id, status, message));
      let masterValidation;
      try {
        masterValidation = validateAutoMaster(await readWorkbook(sources.master.file));
        updateSourceProgress("master", "success", "已取得並通過格式檢核");
      } catch (error) {
        const sourceError = identifySourceError(error, "master", "檔案格式檢核");
        updateSourceProgress("master", "error", `檔案格式檢核失敗：${sourceError.message}`);
        throw sourceError;
      }
      state.masterFile = sources.master.file; state.masterWorkbook = null; state.marketingFile = sources.marketingFile;
      state.consignmentWorkbook = sources.puyoumaWorkbook; state.consignmentFile = null;
      state.lirongConsignmentWorkbook = sources.lirongWorkbook; state.lirongConsignmentFile = null;
      state.sourceMetadata = sources;
      let puyouma;
      try {
        puyouma = core.parseConsignmentWorkbook(state.consignmentWorkbook, XLSX);
      } catch (error) {
        const sourceError = identifySourceError(error, "puyouma", "內容解析");
        updateSourceProgress("puyouma", "error", `內容解析失敗：${sourceError.message}`);
        throw sourceError;
      }
      let lirong;
      try {
        lirong = core.parseLirongConsignmentWorkbook(state.lirongConsignmentWorkbook, XLSX);
      } catch (error) {
        const sourceError = identifySourceError(error, "lirong", "內容解析");
        updateSourceProgress("lirong", "error", `內容解析失敗：${sourceError.message}`);
        throw sourceError;
      }
      if (!puyouma.styleAudit.pinkDetected) {
        updateSourceProgress("puyouma", "error", "未辨識粉紅排程格式");
        throw identifySourceError(new Error("未辨識到粉紅排程格式，已停止採用"), "puyouma", "內容規則檢核");
      }
      updateSourceProgress("marketing", "success", "已取得並完成內容驗證");
      updateSourceProgress("puyouma", "success", `已取得並讀取${puyouma.records.length}列`);
      updateSourceProgress("lirong", "success", `已取得並讀取${lirong.records.length}列`);
      elements.masterFileName.textContent = `自動：${sources.master.metadata.name}・${sourceProof(sources.master.metadata.id, sources.master.metadata)}`;
      elements.marketingFileName.textContent = `自動：整體行銷策略・${sourceProof(sources.marketingMetadata.fileId, sources.marketingMetadata)}`;
      elements.consignmentFileName.textContent = `自動：庫存+下單／庫存布，共${puyouma.records.length}列・${sourceProof(sources.puyoumaMetadata.spreadsheetId, sources.puyoumaMetadata)}`;
      elements.lirongConsignmentFileName.textContent = `自動：${sources.lirongMetadata.selectedSheet || lirong.sheetName || "力榮寄庫"}，共${lirong.records.length}列・${sourceProof(sources.lirongMetadata.spreadsheetId, sources.lirongMetadata)}`;
      elements.sourceStatus.textContent = masterValidation.invalidCount
        ? `固定 Google 資料源已完成格式檢核；${masterValidation.hardInvalidCount}列缺供應商、正數進貨價或MOQ並停止自動採購，${masterValidation.statusReviewCount}列貨品狀態空白仍顯示試算建議，但第一次回匯必須明確填量與原因。`
        : "固定 Google 資料源已完成格式檢核；本次採用自動來源。";
      elements.sourceStatus.className = `result-alert ${masterValidation.invalidCount ? "warn" : ""}`.trim();
      completed = true; invalidateAnalysis(); updateReadyState();
    } catch (error) {
      const hasPreviousSources = Boolean(state.sourceMetadata && state.masterFile && state.consignmentWorkbook && state.lirongConsignmentWorkbook);
      elements.sourceStatus.textContent = automaticSourceFailureMessage(error, hasPreviousSources);
      elements.sourceStatus.className = `result-alert ${hasPreviousSources ? "warn" : "error"}`;
    } finally {
      setAutomaticSourceBusy(false, completed ? "重新取得最新資料" : "重試取得最新資料");
      if (!googleSources.token()) {
        elements.autoSource.disabled = true;
        elements.googleConnect.disabled = false;
        elements.googleConnect.textContent = "重新 Google 授權";
      }
    }
  }
  function supplierCatalog(analysis = state.analysis) {
    return core.supplierSelectionCatalog(
      analysis,
      state.procurementRules?.suppliers || core.SUPPLIER_RULES,
      state.procurementRules?.featuredSuppliers || core.PRIMARY_SUPPLIERS
    );
  }
  function canonicalSupplierName(value) {
    const name = String(value || "").trim();
    return core.findSupplierRule(name, state.procurementRules?.suppliers || core.SUPPLIER_RULES)?.name || name;
  }
  function supplierNames(analysis) {
    return supplierCatalog(analysis).all.map((item) => item.name);
  }
  function positiveSupplierNames(analysis = state.analysis) {
    return supplierCatalog(analysis).all.filter((item) => item.suggestedCount > 0).map((item) => item.name);
  }
  function workUnitRows(unit, rows = state.analysis?.suggestedRows || []) {
    return rows.filter((row) => core.rowMatchesProcurementWorkUnit(row, unit));
  }
  function workUnitMemberIds(unit) {
    if (!unit) return [];
    return Array.isArray(unit.memberIds) && unit.memberIds.length ? unit.memberIds : (unit.id ? [unit.id] : []);
  }
  function workUnitDraft(unit) {
    return state.workflowDrafts.find((row) => row.parentBatchId === state.parentBatchId && workUnitMemberIds(row.activeWorkUnit).includes(unit.id)) || null;
  }
  function combinedWorkUnit(units) {
    const sorted = [...units].sort((left, right) => left.label.localeCompare(right.label, "zh-Hant"));
    const memberIds = sorted.map((unit) => unit.id);
    const suppliers = [...new Set(sorted.map((unit) => canonicalSupplierName(unit.supplier)))];
    return {
      id: `GROUP::${memberIds.join("||")}`,
      memberIds,
      suppliers,
      supplier: suppliers[0] || "",
      label: sorted.map((unit) => unit.label).join("＋"),
      skuCount: sorted.reduce((sum, unit) => sum + Number(unit.skuCount || 0), 0),
      quantity: sorted.reduce((sum, unit) => sum + Number(unit.quantity || 0), 0),
      amount: sorted.reduce((sum, unit) => sum + Number(unit.amount || 0), 0)
    };
  }
  function renderWorkUnitDashboard() {
    if (!elements.workUnitList || !elements.workUnitTotal) return;
    const units = state.analysis ? core.listProcurementWorkUnits(state.analysis) : [];
    const total = units.reduce((sum, unit) => sum + Number(unit.amount || 0), 0);
    elements.workUnitTotal.textContent = units.length ? `${units.length}個審核單位・${formatCurrency(total)}` : "產生建議後顯示";
    const activeIds = new Set(workUnitMemberIds(state.activeWorkUnit));
    const fragment = document.createDocumentFragment();
    units.forEach((unit) => {
      const draft = workUnitDraft(unit);
      const selected = state.selectedWorkUnitIds.has(unit.id);
      const card = document.createElement("article"); card.className = `work-unit-card ${activeIds.has(unit.id) ? "is-active" : ""} ${selected ? "is-selected" : ""}`.trim();
      const heading = document.createElement("label"); heading.className = "work-unit-card-heading";
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = selected; checkbox.disabled = Boolean(draft);
      checkbox.setAttribute("aria-label", `選擇${unit.label}`);
      const title = document.createElement("strong"); title.textContent = unit.label;
      heading.append(checkbox, title);
      const detail = document.createElement("small"); detail.textContent = `${formatNumber(unit.skuCount)}個SKU・${formatNumber(unit.quantity)}件・${formatCurrency(unit.amount)}`;
      const status = document.createElement("span"); status.className = "work-unit-status"; status.textContent = draft ? workflowStageLabel(draft.stage) : "尚未開始";
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selectedWorkUnitIds.add(unit.id); else state.selectedWorkUnitIds.delete(unit.id);
        state.activeWorkUnit = null; state.returnScope = null; state.draftId = ""; state.draftStage = "";
        const selectedUnits = units.filter((item) => state.selectedWorkUnitIds.has(item.id));
        state.selectedSuppliers = new Set(selectedUnits.map((item) => canonicalSupplierName(item.supplier)));
        updateSupplierChecks(); resetReviewWorkflow("已更新分批範圍；確認勾選後，可直接在此下載本批Excel。"); renderWorkUnitDashboard();
      });
      card.append(heading, detail, status);
      if (draft) {
        const button = document.createElement("button"); button.type = "button"; button.className = activeIds.has(unit.id) ? "primary-button" : "secondary-button";
        button.textContent = "開啟此批次";
        button.addEventListener("click", () => restoreWorkflowDraft(draft));
        card.append(button);
      }
      fragment.appendChild(card);
    });
    elements.workUnitList.replaceChildren(fragment);
    const selectedUnits = units.filter((unit) => state.selectedWorkUnitIds.has(unit.id));
    const selectedAmount = selectedUnits.reduce((sum, unit) => sum + Number(unit.amount || 0), 0);
    elements.workUnitSelectionStatus.textContent = selectedUnits.length
      ? `已選${selectedUnits.length}個審核單位・${formatNumber(selectedUnits.reduce((sum, unit) => sum + Number(unit.skuCount || 0), 0))}個SKU・${formatCurrency(selectedAmount)}`
      : "請勾選一個或多個審核單位；下載完成後會自動清空，避免帶入下一批。";
    elements.download.disabled = !selectedUnits.length || Boolean(state.activeWorkUnit && state.returnScope);
    elements.download.textContent = selectedUnits.length ? `下載已選${selectedUnits.length}個單位的本批報表` : "勾選後下載本批報表";
  }
  async function startSelectedWorkUnits() {
    const units = core.listProcurementWorkUnits(state.analysis).filter((unit) => state.selectedWorkUnitIds.has(unit.id));
    if (!units.length) return;
    state.activeWorkUnit = combinedWorkUnit(units); state.parentBatchId ||= newParentBatchId();
    state.draftId = `${state.parentBatchId}-${Math.random().toString(36).slice(2, 8)}`;
    state.draftStage = "analysis"; state.batchId = ""; state.returnScope = null; state.sharedDraftId = ""; state.sharedDraftRevision = 0;
    state.selectedSuppliers = new Set(state.activeWorkUnit.suppliers); updateSupplierChecks();
    resetReviewWorkflow(`已選擇${units.length}個審核單位，正在下載合併審核報表。`);
    renderWorkUnitDashboard();
    elements.download.disabled = true;
    try {
      await downloadRecommendation();
    } catch (error) {
      state.returnScope = null;
      setWorkflowStatus(`本批報表下載失敗：${error.message}。已保留勾選內容，可修正後直接重試。`, "error");
      renderWorkUnitDashboard();
    }
  }
  function selectedRows() {
    if (!state.analysis) return [];
    if (state.activeWorkUnit) return workUnitRows(state.activeWorkUnit);
    return state.analysis.suggestedRows.filter((row) => state.selectedSuppliers.has(canonicalSupplierName(row.supplier)));
  }
  function selectedExcludedRows() {
    if (!state.analysis) return [];
    return state.analysis.rows.filter((row) => (!state.activeWorkUnit ? state.selectedSuppliers.has(canonicalSupplierName(row.supplier)) : core.rowMatchesProcurementWorkUnit(row, state.activeWorkUnit)) && (row.externalPurchaseBlocked || row.manualSupplierReview || row.productStatusPendingReview));
  }
  function renderExcludedRows() {
    const rows = selectedExcludedRows();
    elements.excludedResultPanel.hidden = !rows.length;
    elements.excludedResultCount.textContent = `${formatNumber(rows.length)}項`;
    const fragment = document.createDocumentFragment();
    rows.sort((left, right) => Number(right.rawPurchaseQty || 0) - Number(left.rawPurchaseQty || 0) || String(left.sku).localeCompare(String(right.sku))).forEach((item) => {
      const row = document.createElement("tr");
      [item.supplier, item.sku, item.name, formatNumber(item.rawPurchaseQty), formatNumber(item.suggestedPurchaseQty), item.supplyStatus].forEach((value) => appendCell(row, value));
      fragment.appendChild(row);
    });
    elements.excludedResultRows.replaceChildren(fragment);
  }
  function selectedPaymentSummary(rows) {
    const bySupplier = new Map();
    rows.forEach((row) => {
      const summary = bySupplier.get(row.supplier) || { supplier: row.supplier, amount: 0, confirmedQty: 0, consignmentAvailableQty: 0 };
      summary.amount += Number(row.suggestedPurchaseAmount || 0);
      summary.confirmedQty += Number(row.suggestedPurchaseQty || 0);
      summary.consignmentAvailableQty += Number(row.consignmentCurrentQty || 0);
      bySupplier.set(row.supplier, summary);
    });
    let current = 0; let future = 0; const reviewSuppliers = [];
    bySupplier.forEach((summary) => {
      const schedule = core.calculatePaymentSchedule({ ...summary, orderDate: elements.orderDate.value, supplyMode: /力榮|普優[瑪碼]/.test(summary.supplier) ? "consignment" : "direct", supplierRules: state.procurementRules?.suppliers || core.SUPPLIER_RULES });
      if (schedule.status !== "PASS") { reviewSuppliers.push(summary.supplier); return; }
      schedule.entries.forEach((entry) => { if (entry.month === elements.month.value) current += entry.amount; else future += entry.amount; });
    });
    return { current, future, reviewSuppliers };
  }
  function renderSelectedAnalysis() {
    if (!state.analysis) return;
    const rows = selectedRows();
    const amount = rows.reduce((sum, row) => sum + Number(row.suggestedPurchaseAmount || 0), 0);
    const quantity = rows.reduce((sum, row) => sum + Number(row.suggestedPurchaseQty || 0), 0);
    const payments = selectedPaymentSummary(rows);
    const remainingAfter = currentBudget().remainingBudget - amount;
    const statusReviewRows = rows.filter((row) => row.productStatusPendingReview);
    const statusReviewAmount = statusReviewRows.reduce((sum, row) => sum + Number(row.suggestedPurchaseAmount || 0), 0);
    const springFestivalRows = rows.filter((row) => row.springFestivalApplied);
    const springFestivalExtraQty = springFestivalRows.reduce((sum, row) => sum + Number(row.springFestivalExtraSuggestedQty || 0), 0);
    const springFestivalExtraAmount = springFestivalRows.reduce((sum, row) => sum + Number(row.springFestivalExtraAmount || 0), 0);
      elements.summaryCards.replaceChildren(
      createSummaryCard("已選供應商", formatNumber(state.selectedSuppliers.size), "可逐家查看與匯出"),
      createSummaryCard("建議採購SKU", formatNumber(rows.length), "只計本次勾選範圍"),
      createSummaryCard("建議採購數量", formatNumber(quantity), "已套用箱規／10件單位"),
      createSummaryCard("建議採購金額", formatCurrency(amount), "依最新商品主檔", "currency"),
      createSummaryCard("期間調撥", formatNumber(state.analysis.totals.activeTransferDocumentCount || 0), `有效單據・提交${formatNumber(state.analysis.totals.transferSubmittedQty || 0)}件・發貨在途${formatNumber(state.analysis.totals.transferInTransitQty || 0)}件`),
      createSummaryCard("春節停工備貨", formatCurrency(springFestivalExtraAmount), `${formatNumber(springFestivalRows.length)}個SKU・額外${formatNumber(springFestivalExtraQty)}件；已含在建議金額`, "currency"),
      createSummaryCard("預計本月付款", formatCurrency(payments.current), "依下單日與付款規則", "currency"),
      createSummaryCard("預計未來付款", formatCurrency(payments.future), "依平均採購週期", "currency"),
      createSummaryCard("採購後尚可承諾", formatCurrency(remainingAfter), remainingAfter < 0 ? "超出目前已釋放額度" : "已釋放額度扣除已承諾與本批", `currency ${remainingAfter < 0 ? "negative" : ""}`),
      createSummaryCard("待人工確認試算", formatCurrency(statusReviewAmount), `${formatNumber(statusReviewRows.length)}個貨品狀態空白SKU；尚未核准`, "currency"),
      createSummaryCard("寬沐45%管理參考", formatCurrency(state.analysis.totals.kuanMuManagementTargetAmount || 0), `營運需求${formatCurrency(state.analysis.totals.kuanMuOperationalDemandAmount || 0)}・差額${formatCurrency(state.analysis.totals.kuanMuManagementGapAmount || 0)}；未加進建議`, "currency")
    );
    renderRows(rows);
    const scopeNames = [...state.selectedSuppliers];
    const missingPayment = payments.reviewSuppliers.length ? `；${payments.reviewSuppliers.join("、")}付款規則待確認` : "";
    elements.supplierScopeStatus.textContent = scopeNames.length
      ? `目前查看：${state.activeWorkUnit?.label || scopeNames.join("、")}；請在下方複選要合併審核的單位並直接下載${statusReviewRows.length ? `；其中${statusReviewRows.length}項貨品狀態空白須明確人工確認` : ""}${missingPayment}。`
      : "尚未選擇供應商；請至少勾選一家後再下載。";
    elements.supplierScopeStatus.className = `supplier-scope-status ${scopeNames.length && !payments.reviewSuppliers.length ? "" : "warn"}`.trim();
    renderExcludedRows();
  }
  function resetScopeForNewExport() {
    state.activeWorkUnit = null; state.selectedWorkUnitIds = new Set(); state.returnScope = null; state.draftId = ""; state.draftStage = "";
    resetReviewWorkflow("查看範圍已變更；請在「分批審核與開單」勾選一個或多個單位後直接下載Excel。");
    renderSelectedAnalysis();
    renderWorkUnitDashboard();
  }
  function renderSupplierFilters(analysis) {
    const catalog = supplierCatalog(analysis);
    state.selectedSuppliers = new Set(catalog.all.filter((item) => item.suggestedCount > 0).map((item) => item.name));
    const option = (item) => {
      const supplier = item.name;
      const label = document.createElement("label"); label.className = "supplier-option";
      if (item.reviewCount) label.classList.add("has-review");
      const input = document.createElement("input"); input.type = "checkbox"; input.checked = state.selectedSuppliers.has(supplier); input.value = supplier;
      const strong = document.createElement("strong"); strong.textContent = supplier;
      const small = document.createElement("small");
      const review = item.reviewCount ? `・${item.reviewCount}項待確認／排除` : "";
      small.textContent = `${item.suggestedCount}個建議SKU・${formatCurrency(item.suggestedAmount)}${review}`;
      input.addEventListener("change", () => {
        if (input.checked) state.selectedSuppliers.add(supplier); else state.selectedSuppliers.delete(supplier);
        resetScopeForNewExport();
      });
      label.append(input, strong, small);
      return label;
    };
    const primaryFragment = document.createDocumentFragment();
    catalog.primary.forEach((item) => primaryFragment.appendChild(option(item)));
    const otherFragment = document.createDocumentFragment();
    catalog.other.forEach((item) => otherFragment.appendChild(option(item)));
    elements.supplierFilterList.replaceChildren(primaryFragment);
    elements.otherSupplierFilterList.replaceChildren(otherFragment);
    const otherPositive = catalog.other.filter((item) => item.suggestedCount > 0).length;
    const otherReview = catalog.other.reduce((sum, item) => sum + item.reviewCount, 0);
    elements.otherSupplierSummary.textContent = `${catalog.other.length}家・${otherPositive}家有建議・${otherReview}項待確認／排除`;
    renderSelectedAnalysis();
  }
  function renderSummary(analysis, consignmentSource) {
    elements.dateCheck.textContent = `銷售截止日：${analysis.asOfDate}｜檔案最新：${analysis.sourceMaxSalesDate}`;
    const styleNote = consignmentSource.styleAudit.pinkDetected ? `已辨識${formatNumber(consignmentSource.styleAudit.pinkCells)}個粉紅排程格。` : "未辨識粉紅排程。";
    elements.resultAlert.textContent = `${analysis.validation.dateCheck.message} ${styleNote} 上林採28天檢視；普優瑪與力榮採購／寄庫分頁處理。`;
    elements.resultAlert.className = `result-alert ${analysis.validation.dateCheck.status === "PASS" && consignmentSource.styleAudit.pinkDetected ? "" : "warn"}`.trim();
    renderSupplierFilters(analysis);
    renderWorkUnitDashboard();
  }
  function appendCell(row, value, className = "") { const cell = document.createElement("td"); cell.textContent = value; if (className) cell.className = className; row.appendChild(cell); }
  function renderRows(rows) {
    const fragment = document.createDocumentFragment();
    rows.forEach((item) => {
      const row = document.createElement("tr");
      [item.supplier, item.sku, item.name, `${item.tier}・${item.abcClass}${item.xyzClass}`, item.supplyProfileLabel,
        item.supplierLeadDays, item.targetCoverageDays, item.recent6Qty, item.recent12Qty, item.forecastDailyQty,
        item.inventoryQty, item.pendingQty, item.transferSubmittedQty, item.transferInTransitQty, item.suggestedPurchaseQty, formatCurrency(item.suggestedPurchaseAmount),
        item.springFestivalExtraSuggestedQty, formatCurrency(item.springFestivalExtraAmount),
        item.consignmentCurrentQty, item.suggestedConsignmentQty, item.supplyStatus].forEach((value, index) => appendCell(row, typeof value === "number" ? formatNumber(value) : value, index === 19 && item.immediateConsignmentGap > 0 ? "negative" : ""));
      fragment.appendChild(row);
    });
    elements.resultRows.replaceChildren(fragment);
  }
  async function resolveWorkbook(file, loaded) { return loaded || readWorkbook(file); }
  async function analyze() {
    if (!requirementsReady()) return;
    elements.analyze.disabled = true; elements.download.disabled = true; setStatus("正在本機解析資料並套用正式採購、寄庫與付款規則…");
    try {
      const [masterWorkbook, inventoryWorkbook, transferWorkbook, consignmentWorkbook, lirongWorkbook, modelWorkbook, pendingWorkbooks, salesWorkbooks] = await Promise.all([
        resolveWorkbook(state.masterFile, state.masterWorkbook), readWorkbook(state.inventoryFile), readWorkbook(state.transferFile),
        resolveWorkbook(state.consignmentFile, state.consignmentWorkbook),
        resolveWorkbook(state.lirongConsignmentFile, state.lirongConsignmentWorkbook), readWorkbook(state.modelFile),
        Promise.all(state.pendingFiles.map(readWorkbook)), Promise.all(state.salesFiles.map(readWorkbook))
      ]);
      const master = core.parseProductMasterWorkbook(masterWorkbook, XLSX, { fileName: "本次商品主檔" });
      const inventory = core.parseInventoryWorkbook(inventoryWorkbook, XLSX, { fileName: "本次庫存" });
      const transferReport = core.parseTransferWorkbook(transferWorkbook, XLSX, { fileName: state.transferFile.name || "期間調撥單" });
      const consignment = core.parseConsignmentWorkbook(consignmentWorkbook, XLSX, { fileName: "普優瑪寄庫" });
      const lirongConsignment = core.parseLirongConsignmentWorkbook(lirongWorkbook, XLSX, { fileName: "力榮寄庫" });
      const pendingReports = pendingWorkbooks.map((workbook, index) => core.parsePendingPurchaseWorkbook(workbook, XLSX, { fileName: state.pendingFiles[index]?.name || "未到貨採購單" }));
      state.purchaseStatusSummary = core.summarizePurchaseReports(pendingReports, elements.month.value);
      const salesReports = salesWorkbooks.map((workbook, index) => core.parseSalesWorkbook(workbook, XLSX, { fileName: state.salesFiles[index]?.name || "銷售明細" }));
      state.costSummary = core.summarizeCompanyCostFlows({
        analysisMonth: elements.month.value, master, inventory, salesReports, transferReports: [transferReport],
        purchaseSummary: state.purchaseStatusSummary, openingInventoryCost: Number(elements.openingCost.value || 0), supplierReturns: Number(elements.supplierReturns.value || 0)
      });
      updateAutomaticForecastCost();
      const model = core.parseForecastModelWorkbook(modelWorkbook, XLSX, { fileName: "季節模型" });
      const validation = core.buildAnalysis({ master, inventory, pendingReports, transferReports: [transferReport], consignment, blacklist: blacklistEntries(), dates: {
        inventory: elements.inventoryDate.value, pending: elements.pendingDate.value, transfer: elements.transferDate.value, consignment: elements.consignmentDate.value, sales: elements.salesDate.value
      } });
      const selectedStoreShortageNeeds = state.storeShortageNeeds.filter((row) => row.handling_mode === state.shortageRunMode);
      const uncoveredStoreShortageNeeds = selectedStoreShortageNeeds.map((row) => ({ ...row, unfilledQuantity: Math.max(0, Number(row.unfilled_quantity || 0) - Number(row.covered_quantity || 0)) }));
      const analysis = core.buildProcurementRecommendations({ master, inventory, pendingReports, transferReports: [transferReport], inventoryDate: elements.inventoryDate.value, consignment, salesReports, model,
        blacklist: blacklistEntries(), asOfDate: elements.salesDate.value, checkpoint: elements.checkpoint.value,
        supplierRules: state.procurementRules?.suppliers || core.SUPPLIER_RULES,
        springFestivalRule: state.procurementRules?.springFestival,
        purchaseUnitRules: state.procurementRules?.purchaseUnits,
        consignmentRules: state.procurementRules?.consignment,
        storeInventoryRules: state.procurementRules?.storeInventory,
        revenueChannels: state.revenueChannels, storeTransferNeeds: uncoveredStoreShortageNeeds, onlyStoreTransferNeedSkus: state.shortageRunMode === "new_order" });
      analysis.validation = validation;
      analysis.lirongConsignmentRows = core.buildLirongConsignmentRecommendations(analysis, lirongConsignment, {
        orderDate: elements.orderDate.value, purchaseUnitRules: state.procurementRules?.purchaseUnits, consignmentRules: state.procurementRules?.consignment
      });
      analysis.meta = {
        month: elements.month.value, checkpoint: elements.checkpoint.value, sourceMode: state.consignmentWorkbook ? "Google自動" : "手動備援",
        seasonalModel: state.modelMetadata ? { ...state.modelMetadata, refreshMonth: modelRefreshMonth(), status: "本次沿用／已更新" } : null,
        sourceHashes: state.sourceMetadata ? {
          master: state.sourceMetadata.master.metadata.sha256,
          marketing: state.sourceMetadata.marketingMetadata.sha256,
          puyouma: state.sourceMetadata.puyoumaMetadata.sha256,
          lirong: state.sourceMetadata.lirongMetadata.sha256
        } : {}
      };
      state.analysis = analysis; state.baseAnalysis = analysis; state.workflowType = state.shortageRunMode === "new_order" ? "store_shortage_replenishment" : "system_recommendation";
      state.parentBatchId = newParentBatchId(); state.activeWorkUnit = null; state.selectedWorkUnitIds = new Set(); state.draftId = state.parentBatchId;
      state.parsedSources = { master, inventory, pendingReports, transferReports: [transferReport], consignment, lirongConsignment, salesReports, model };
      state.consignmentSource = consignment; state.returnScope = null; renderSummary(analysis, consignment);
      elements.resultPanel.hidden = false;
      resetReviewWorkflow("採購建議已完成；請在「分批審核與開單」勾選一個或多個供應商／普優瑪分類，直接下載本批Excel。");
      const springFestivalNote = analysis.totals.springFestivalSkuCount > 0
        ? `其中春節停工備貨${analysis.totals.springFestivalSkuCount}個SKU、加量${formatNumber(analysis.totals.springFestivalExtraQty)}件、增加${formatCurrency(analysis.totals.springFestivalExtraAmount)}。`
        : "本次無春節停工備貨加量。";
      setStatus(`完成：${analysis.totals.suggestedSkuCount}個SKU，建議金額${formatCurrency(analysis.totals.suggestedPurchaseAmount)}。${springFestivalNote}`, "success");
      await syncDetectedCustomOrders(pendingReports, master);
      await savePendingSnapshot(pendingReports);
      await syncErpReconciliations(pendingReports);
      await persistWorkflowDraft("analysis");
      await saveCostSnapshot();
      renderBudget(); updateSpecialWorkflowReady(); elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      state.analysis = null; elements.resultPanel.hidden = true; setStatus(`無法完成：${error.message || "請確認檔案格式"}`, "error");
    } finally { elements.analyze.disabled = !requirementsReady(); }
  }
  function activateSpecialAnalysis(analysis, label) {
    state.analysis = analysis;
    state.workflowType = analysis.meta?.workflowType || "system_recommendation";
    state.returnScope = null;
    renderSummary(analysis, state.parsedSources.consignment);
    elements.resultPanel.hidden = false;
    resetReviewWorkflow(`${label}已建立；請先勾選供應商並下載Excel，再走第一次回匯、需要時異動與正式核准。`);
    setStatus(`${label}完成：${analysis.rows.length}個SKU，系統建議金額${formatCurrency(analysis.totals.suggestedPurchaseAmount)}。`, "success");
    elements.specialWorkflowStatus.textContent = `${label}已切換為目前工作批次；草稿尚未占用正式額度。`;
    elements.specialWorkflowStatus.className = "main-status success";
    renderBudget();
    elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function buildNewProductFlow() {
    if (!state.baseAnalysis || !state.newProductFile) return;
    elements.newProductButton.disabled = true;
    elements.specialWorkflowStatus.textContent = `正在檢查${state.newProductFile.name}與最新商品主檔…`;
    try {
      const parsed = core.parseNewProductWorkbook(await readWorkbook(state.newProductFile), XLSX, { fileName: state.newProductFile.name });
      if (parsed.errors.length) throw new Error(parsed.errors.map((row) => `${row.sku || `第${row.sourceRow}列`}：${row.message}`).join("；"));
      const analysis = core.buildSpecialProcurementAnalysis({
        baseAnalysis: state.baseAnalysis, workflowType: "new_product", rows: parsed.records, fileName: state.newProductFile.name,
        master: state.parsedSources.master, inventory: state.parsedSources.inventory, pendingReports: state.parsedSources.pendingReports,
        supplierRules: state.procurementRules?.suppliers || core.SUPPLIER_RULES, purchaseUnitRules: state.procurementRules?.purchaseUnits
      });
      activateSpecialAnalysis(analysis, "新品首批採購建議");
    } catch (error) {
      elements.specialWorkflowStatus.textContent = `新品首批停止：${error.message}`;
      elements.specialWorkflowStatus.className = "main-status error";
    } finally { updateSpecialWorkflowReady(); }
  }
  async function buildManualDraftFlow() {
    if (!state.baseAnalysis || !state.manualDraftFiles.length) return;
    elements.manualDraftButton.disabled = true;
    elements.specialWorkflowStatus.textContent = "正在把人工採購草稿與最新淨需求比對…";
    try {
      const workbooks = await Promise.all(state.manualDraftFiles.map(readWorkbook));
      const reports = workbooks.map((workbook, index) => core.parsePendingPurchaseWorkbook(workbook, XLSX, { fileName: state.manualDraftFiles[index].name }));
      const rows = reports.flatMap((report) => report.records.map((row) => ({ ...row, supplier: report.metadata.supplier })));
      const duplicate = rows.find((row, index) => rows.findIndex((item) => item.sku === row.sku) !== index);
      if (duplicate) throw new Error(`${duplicate.sku}在人工採購草稿中重複，請先合併為單一數量。`);
      const analysis = core.buildSpecialProcurementAnalysis({
        baseAnalysis: state.baseAnalysis, workflowType: "manual_draft", rows, fileName: state.manualDraftFiles.map((file) => file.name).join("、"),
        master: state.parsedSources.master, inventory: state.parsedSources.inventory, pendingReports: state.parsedSources.pendingReports,
        supplierRules: state.procurementRules?.suppliers || core.SUPPLIER_RULES, purchaseUnitRules: state.procurementRules?.purchaseUnits
      });
      activateSpecialAnalysis(analysis, "人工匯入採購單");
    } catch (error) {
      elements.specialWorkflowStatus.textContent = `人工採購草稿停止：${error.message}`;
      elements.specialWorkflowStatus.className = "main-status error";
    } finally { updateSpecialWorkflowReady(); }
  }
  function postedOrderPayload(report, master, workflowType) {
    const erpReference = String(report.metadata.documentCode || "").trim();
    if (!erpReference) throw new Error(`${report.fileName}缺少ERP單據編碼，禁止補登。`);
    const validRows = report.records.filter((row) => workflowType !== "customer_custom" || row.isCustomOrder);
    if (!validRows.length) throw new Error(`${report.fileName}沒有可補登的採購明細。`);
    const bySupplier = new Map();
    const approvedItems = [];
    validRows.forEach((row) => {
      const masterRow = master?.bySku?.get(row.sku);
      const supplier = String(report.metadata.supplier || masterRow?.supplier || "").trim();
      if (!supplier) throw new Error(`${report.fileName}的${row.sku}無法辨識供應商。`);
      const quantity = Number(row.orderedQuantity ?? row.quantity ?? 0);
      const unitCost = Number(row.unitCost || masterRow?.unitCost || 0);
      const amount = Number(row.orderedAmount || 0) || quantity * unitCost;
      if (!(amount > 0)) throw new Error(`${report.fileName}的${row.sku}缺少可計算的採購金額。`);
      const item = bySupplier.get(supplier) || { supplier, amount: 0, confirmedQty: 0, consignmentAvailableQty: 0 };
      item.amount += amount; item.confirmedQty += quantity; bySupplier.set(supplier, item);
      approvedItems.push({ sku: row.sku, name: row.name || masterRow?.name || "", supplier, quantity, unitCost, amount });
    });
    const paymentSchedule = [];
    let paymentCurrentMonth = 0;
    let paymentFutureMonths = 0;
    bySupplier.forEach((supplier) => {
      const schedule = core.calculatePaymentSchedule({ ...supplier, orderDate: report.metadata.purchaseDate || elements.orderDate.value, supplyMode: /力榮|普優[瑪碼]/.test(supplier.supplier) ? "consignment" : "direct", supplierRules: state.procurementRules?.suppliers || core.SUPPLIER_RULES });
      if (schedule.status !== "PASS") throw new Error(`${supplier.supplier}付款月份無法判斷：${schedule.message}`);
      schedule.entries.forEach((entry) => {
        paymentSchedule.push({ supplier: supplier.supplier, country: schedule.supplierCountry, ...entry });
        if (entry.month === elements.month.value) paymentCurrentMonth += entry.amount; else paymentFutureMonths += entry.amount;
      });
    });
    const amount = [...bySupplier.values()].reduce((sum, row) => sum + row.amount, 0);
    const safeReference = erpReference.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 45) || "ERP";
    return {
      batchId: `ERP-${safeReference}`, analysisMonth: elements.month.value, erpReference,
      workflowType, supplierSummary: [...bySupplier.keys()], suggestedAmount: 0, manualAmount: amount, blockedAmount: 0,
      approvedAmount: amount, adjustmentAmount: amount, budgetAmount: currentBudget().availableBudget,
      paymentCurrentMonth, paymentFutureMonths, paymentSchedule,
      approvedItems,
      warningSummary: workflowType === "customer_custom" ? "有客訂對應；不得扣一般淨需求" : "補登既有ERP採購單",
      idempotencyKey: `erp-import:${erpReference}`
    };
  }
  async function importPostedReport(report, master, workflowType) {
    const payload = postedOrderPayload(report, master, workflowType);
    const result = await postJson("/api/procurement/manual-orders", payload);
    let notificationFailed = false;
    if (!result.duplicate && result.notification === "pending" && googleSources.token()) {
      try { await postJson(`/api/procurement/batches/${encodeURIComponent(payload.batchId)}/notify`, {}, { "X-Google-Access-Token": googleSources.token() }); }
      catch { notificationFailed = true; }
    }
    return { ...result, payload, notificationFailed };
  }
  async function syncDetectedCustomOrders(reports, master) {
    const customReports = reports.filter((report) => report.records.some((row) => row.isCustomOrder && row.quantity > 0));
    if (!customReports.length) return;
    if (!state.config?.permissions?.canApprove) {
      elements.specialWorkflowStatus.textContent = `偵測到${customReports.length}張客製未到貨採購單；請由採購核准者重新執行計算後自動納入台帳。`;
      elements.specialWorkflowStatus.className = "main-status error";
      return;
    }
    let added = 0; let duplicate = 0; const failures = [];
    for (const report of customReports) {
      try {
        const result = await importPostedReport(report, master, "customer_custom");
        if (result.duplicate) duplicate += 1; else added += 1;
      } catch (error) { failures.push(`${report.fileName}：${error.message}`); }
    }
    await loadLedger();
    elements.specialWorkflowStatus.textContent = `客製單自動辨識完成：新增${added}張、既有或重複${duplicate}張${failures.length ? `、${failures.length}張待處理（${failures.join("；")}）` : ""}；只納入承諾與付款，不扣一般淨需求。`;
    elements.specialWorkflowStatus.className = `main-status ${failures.length ? "error" : "success"}`;
  }
  async function importPostedOrders() {
    if (!state.postedOrderFiles.length || !state.config?.permissions?.canApprove) return;
    elements.postedOrderButton.disabled = true;
    elements.specialWorkflowStatus.textContent = "正在檢查ERP單號、金額、付款月份與重複台帳…";
    try {
      const workbooks = await Promise.all(state.postedOrderFiles.map(readWorkbook));
      const reports = workbooks.map((workbook, index) => core.parsePendingPurchaseWorkbook(workbook, XLSX, { fileName: state.postedOrderFiles[index].name }));
      let added = 0; let duplicate = 0;
      for (const report of reports) {
        const result = await importPostedReport(report, state.parsedSources?.master, "manual_posted");
        if (result.duplicate) duplicate += 1; else added += 1;
      }
      await loadLedger();
      elements.specialWorkflowStatus.textContent = `補登完成：新增${added}張、重複未計價${duplicate}張。已納入目前額度與付款月份。`;
      elements.specialWorkflowStatus.className = "main-status success";
    } catch (error) {
      elements.specialWorkflowStatus.textContent = `補登停止：${error.message}`;
      elements.specialWorkflowStatus.className = "main-status error";
    } finally { updateSpecialWorkflowReady(); }
  }
  function currentBudget() {
    const read = (element) => Number.isFinite(Number(element.value)) ? Number(element.value) : 0;
    const calculated = core.calculatePurchaseBudget({ forecastCostOutflow: read(elements.forecastCost), targetEndingInventoryCost: read(elements.targetEndingCost),
      openingInventoryCost: read(elements.openingCost), expectedSupplierReturns: read(elements.supplierReturns), purchasedAmountToDate: read(elements.purchasedToDate) });
    const fullBudgetAmount = calculated.availableBudget;
    const release = core.resolveReleasedBudgetAmount({
      checkpoint: elements.checkpoint.value,
      fullBudgetAmount,
      monthStartReleasedAmount: Number(elements.releasedBudget.value || 0)
    });
    return { ...calculated, ...release, fullBudgetAmount, availableBudget: release.releasedBudgetAmount, remainingBudget: release.releasedBudgetAmount - calculated.purchasedAmountToDate };
  }
  function renderBudget() {
    const result = currentBudget(); const revenue = Number(elements.forecastRevenue.value || 0); const terminalRevenue = Number(elements.terminalForecastRevenue.value || 0); const cost = Number(elements.forecastCost.value || 0);
    const summary = effectiveCostSummary();
    const actualCost = summary?.managementCostToDate;
    const cards = [
      createSummaryCard("最新預估整月成本耗用", formatCurrency(cost), summary?.source === "actual_weighted" ? `依${summary.maxSalesDate}前實際成本日均推估` : "資料不足，暫用核准比率備援", "currency"),
      createSummaryCard("本月至今成本耗用", actualCost == null ? "待匯入" : formatCurrencyPrecise(actualCost), summary ? "寬承直接成本＋寬沐供貨原始成本" : state.analysis ? "既有舊草稿未保存成本摘要；本次需重新匯入一次" : "匯入本月銷售後自動計算", "currency"),
      createSummaryCard("目前已釋放可採購額度", formatCurrency(result.releasedBudgetAmount), elements.checkpoint.value === "month-start" ? "月初階段額度" : "月中起自動累計釋放整月額度", "currency"),
      createSummaryCard("截至目前已承諾", formatCurrency(result.purchasedAmountToDate), "正式核准互斥狀態加總", "currency"),
      createSummaryCard("截至目前尚可承諾", formatCurrency(result.remainingBudget), result.remainingBudget < 0 ? "已超出額度" : "尚可核准", `currency ${result.remainingBudget < 0 ? "negative" : ""}`)
    ];
    if (state.review) {
      const currentPayment = state.review.payments.flatMap((row) => row.entries).filter((row) => row.month === elements.month.value).reduce((sum, row) => sum + row.amount, 0);
      cards.push(createSummaryCard("本批核准後尚可承諾", formatCurrency(result.remainingBudget - state.review.totals.approvedAmount), "依最終可核准金額", "currency"));
      cards.push(createSummaryCard("本批本月／未來付款", `${formatCurrency(currentPayment)}／${formatCurrency(state.review.totals.approvedAmount - currentPayment)}`, "依供應商付款觸發點", "currency"));
    }
    elements.budgetSummary.replaceChildren(...cards);
    if (elements.costBreakdown) {
      const releaseDetails = `
        <div><span>月初已釋放額度</span><strong>${formatCurrencyPrecise(result.monthStartReleasedAmount)}</strong><small>月份快照設定的第一階段額度</small></div>
        <div><span>月中新增釋放額度</span><strong>${formatCurrencyPrecise(result.additionalReleasedAmount)}</strong><small>${elements.checkpoint.value === "month-start" ? "月中採購時才自動釋放" : "已隨使用時點自動釋放"}</small></div>
        <div><span>累計已釋放額度</span><strong>${formatCurrencyPrecise(result.releasedBudgetAmount)}</strong><small>首頁尚可承諾以此金額扣除正式承諾</small></div>`;
      elements.costBreakdown.innerHTML = summary ? `${releaseDetails}
        <div><span>寬承直接銷售成本</span><strong>${formatCurrencyPrecise(summary.directCost)}</strong><small>所有線上通路＋R00、R01；依進貨價金額</small></div>
        <div><span>寬沐門市供貨原始成本</span><strong>${formatCurrencyPrecise(summary.kuanmuBaseCost)}</strong><small>調撥收貨${summary.transferReceivedCount}筆＋B3配對${summary.b3MatchedCount}筆</small></div>
        <div><span>寬承對寬沐計價參考</span><strong>${formatCurrencyPrecise(summary.kuanmuIntercompanyRevenue)}</strong><small>原始成本×1.11；合併檢視時抵銷</small></div>
        <div><span>本月實際收貨成本</span><strong>${formatCurrencyPrecise(summary.actualReceiptCost)}</strong><small>依採購單實際交貨日</small></div>
        <div><span>目前寬承體系庫存成本</span><strong>${formatCurrencyPrecise(summary.currentInventoryCost)}</strong><small>總倉＋R00＋R01；不含寬沐門市</small></div>
        <div><span>庫存公式驗證</span><strong>${summary.inventoryBridgeCost == null ? "待月初快照" : formatCurrencyPrecise(summary.inventoryBridgeCost)}</strong><small>${escapeHtml(summary.warnings.join(" ") || "期初＋收貨－退貨－目前庫存")}</small></div>` : `${releaseDetails}<p class="budget-note">匯入本月銷售、最新庫存、全部狀態採購單與期間調撥單後，系統會在此拆解成本。</p>`;
    }
    if (state.analysis) renderSelectedAnalysis();
  }
  function markBudgetDirty() {
    state.budgetDirty = true;
    elements.budgetPlanStatus.textContent = state.config?.permissions?.canManageBudget
      ? "通路預估或月份額度有尚未儲存的變更；儲存後其他使用者才會讀到。"
      : "目前是本頁暫算；只有siang01可儲存為公司共用月份快照。";
    renderBudget();
  }
  async function saveMonthPlan() {
    if (!state.config?.permissions?.canManageBudget) return;
    elements.saveBudget.disabled = true;
    const budget = currentBudget();
    const sourceNote = elements.budgetSourceNote.value.trim() || `${elements.month.value}中性情境管理輸入`;
    try {
      const result = await postJson("/api/procurement/month-plan", {
        analysisMonth: elements.month.value,
        forecastRevenue: Number(elements.forecastRevenue.value || 0),
        revenueChannels: state.revenueChannels,
        forecastCostOutflow: Number(elements.forecastCost.value || 0),
        targetEndingInventoryCost: Number(elements.targetEndingCost.value || 0),
        openingInventoryCost: Number(elements.openingCost.value || 0),
        expectedSupplierReturns: Number(elements.supplierReturns.value || 0),
        fullBudgetAmount: budget.fullBudgetAmount,
        releasedBudgetAmount: Number(elements.releasedBudget.value || 0),
        sourceNote
      }, {}, "PUT");
      applyMonthPlan(result.plan);
    } catch (error) {
      elements.budgetPlanStatus.textContent = `月份額度儲存失敗：${error.message}`;
    } finally { elements.saveBudget.disabled = false; }
  }
  async function downloadRecommendation() {
    if (!state.analysis || !state.activeWorkUnit) return;
    const selected = Array.isArray(state.activeWorkUnit.suppliers) && state.activeWorkUnit.suppliers.length
      ? state.activeWorkUnit.suppliers
      : [state.activeWorkUnit.supplier];
    const scopeLabel = state.activeWorkUnit.label.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
    const workflowLabel = state.analysis.meta?.workflowLabel || "採購建議";
    state.returnScope = new Set(selected);
    const workbook = core.buildRecommendationWorkbook(state.analysis, outputXlsx, { budget: currentBudget(), selectedSuppliers: selected, workUnit: state.activeWorkUnit });
    appendWorkflowSnapshotSheet(workbook, workflowSnapshot("downloaded"));
    outputXlsx.writeFile(workbook, `${elements.month.value}_${elements.checkpoint.value === "mid-month" ? "月中" : elements.checkpoint.value === "month-end" ? "月底" : "月初"}_${scopeLabel}_${workflowLabel}_人工審核.xlsx`, { compression: true, cellStyles: true });
    state.selectedWorkUnitIds = new Set();
    resetReviewWorkflow(`已下載${state.activeWorkUnit.memberIds?.length || 1}個審核單位的合併採購建議；完成Excel人工填量後，請選擇這一份第一次回匯檔。`);
    setFileInputEnabled(elements.reviewFile, elements.reviewFileLabel, true);
    setWorkflowStep(elements.workflowStepDownload, "done", `已下載${state.activeWorkUnit.label}`);
    setWorkflowStep(elements.workflowStepFirst, "active", "請回匯剛下載並完成填量的Excel");
    await persistWorkflowDraft("downloaded");
  }

  function addDraftConsignmentReservations(target, draft) {
    if (!["first_reviewed", "second_reviewed", "pending_approval", "approved"].includes(draft?.stage)) return;
    const rows = draft.review?.rows || draft.firstReview?.rows || [];
    rows.forEach((row) => {
      if (!/普優[瑪碼]|力榮/.test(String(row.supplier || ""))) return;
      const sku = core.normalizeSku(row.sku);
      const quantity = Math.max(0, Number(row.finalQty || 0));
      if (sku && quantity > 0) target.set(sku, Number(target.get(sku) || 0) + quantity);
    });
  }

  async function activeConsignmentReservations() {
    const reservations = new Map();
    const currentKeys = new Set([state.draftId, state.sharedDraftId].filter(Boolean));
    const seen = new Set();
    const include = (draft) => {
      const key = draft?.sharedDraftId || draft?.id;
      if (!key || currentKeys.has(key) || seen.has(key)) return;
      seen.add(key);
      addDraftConsignmentReservations(reservations, draft);
    };
    state.workflowDrafts.forEach(include);
    for (const metadata of state.sharedDrafts) {
      if (!metadata?.id || currentKeys.has(metadata.id) || seen.has(metadata.id)) continue;
      const response = await fetch(`/api/procurement/collaboration-drafts/${encodeURIComponent(metadata.id)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
      const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      if (!response.ok) throw new Error(`無法核對其他有效採購批次的寄庫占用：${result.error || `HTTP ${response.status}`}`);
      include(await decodeSharedSnapshot(result.draft));
    }
    return reservations;
  }

  async function reviewReturn() {
    if (!state.reviewFile || !state.analysis || !state.returnScope) return;
    elements.reviewButton.disabled = true; setWorkflowStatus("正在重新檢查人工數量、力榮10件規則、可售至、付款月份與額度…");
    try {
      const baselineRows = state.analysis.rows.filter((row) => core.rowMatchesProcurementWorkUnit(row, state.activeWorkUnit));
      const reservedConsignmentBySku = await activeConsignmentReservations();
      state.firstReview = core.reviewReturnedWorkbook(await readWorkbook(state.reviewFile), XLSX, {
        asOfDate: elements.salesDate.value || today(),
        orderDate: elements.orderDate.value,
        supplierRules: state.procurementRules?.suppliers || core.SUPPLIER_RULES,
        baselineBySku: new Map(state.analysis.rows.map((row) => [row.sku, row])),
        allowedSkuSet: new Set(baselineRows.map((row) => row.sku)),
        reservedConsignmentBySku
      });
      const t = state.firstReview.totals;
      elements.workflowSummary.replaceChildren(
        createSummaryCard("系統建議金額", formatCurrency(t.suggestedAmount), "原始工具建議", "currency"),
        createSummaryCard("人工回匯採購總額", formatCurrency(t.manualAmount), "規則排除前", "currency"),
        createSummaryCard("規則阻擋金額", formatCurrency(t.blockedAmount), "S／專屬週期／贈品", "currency"),
        createSummaryCard("最終可核准金額", formatCurrency(t.approvedAmount), "人工回匯－規則阻擋", "currency"),
        createSummaryCard("本次人工新增", `${state.firstReview.rows.filter((row) => row.manuallyAdded).length}項`, "已由本次計算批次補齊資料")
      );
      setFileInputEnabled(elements.secondReviewFile, elements.secondReviewFileLabel, state.firstReview.errors.length === 0);
      state.review = state.firstReview.errors.length ? null : state.firstReview;
      elements.submitApproval.disabled = state.firstReview.errors.length > 0;
      elements.submitApproval.textContent = "全部沿用並送出待核准";
      if (state.firstReview.errors.length) renderWorkflowErrors(state.firstReview.errors, "第一次回匯尚有阻擋，未產生覆核與異動確認表");
      else {
        clearWorkflowErrors();
        const unitLabel = (state.activeWorkUnit?.label || "採購").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
        outputXlsx.writeFile(core.buildSecondReviewWorkbook(state.firstReview, outputXlsx), `${elements.month.value}_${unitLabel}_第一次覆核暨異動確認表.xlsx`, { compression: true, cellStyles: true });
      }
      setWorkflowStep(elements.workflowStepFirst, state.firstReview.errors.length ? "blocked" : "done", state.firstReview.errors.length ? `有${state.firstReview.errors.length}項阻擋` : "第一次覆核已通過");
      setWorkflowStep(elements.workflowStepSecond, state.firstReview.errors.length ? "locked" : "active", state.firstReview.errors.length ? "修正第一次回匯後重跑" : "無異動直接送出；有異動只填變更列");
      setWorkflowStep(elements.workflowStepApproval, state.firstReview.errors.length ? "locked" : "active", state.firstReview.errors.length ? "覆核通過後開放" : "可全部沿用並送出待核准");
      setWorkflowStatus(state.firstReview.errors.length ? `覆核完成但有${state.firstReview.errors.length}項阻擋；請修正第一次回匯後重跑。` : "第一次覆核通過且已下載確認表；沒有異動可直接送出，有異動只需填寫變更品項後回匯同一份檔案。", state.firstReview.errors.length ? "error" : "success");
      if (!state.firstReview.errors.length) await persistWorkflowDraft("first_reviewed");
      renderBudget();
    } catch (error) {
      state.firstReview = null; state.review = null;
      renderWorkflowErrors([{ message: error.message }], "第一次回匯失敗，未產生覆核與異動確認表");
      setWorkflowStep(elements.workflowStepFirst, "blocked", "檔案或內容未通過檢查");
      setWorkflowStep(elements.workflowStepSecond, "locked", "第一次覆核通過後開放");
      setWorkflowStatus(`回匯失敗：${error.message}`, "error");
    }
    finally { elements.reviewButton.disabled = !state.reviewFile; }
  }
  async function confirmSecondReview() {
    if (!state.secondReviewFile) return;
    elements.confirmReview.disabled = true; setWorkflowStatus("正在檢查第二次異動量、原因、付款月份與核准金額…");
    try {
      clearWorkflowErrors();
      state.review = core.reviewSecondApprovalWorkbook(await readWorkbook(state.secondReviewFile), XLSX, { asOfDate: elements.salesDate.value || today(), orderDate: elements.orderDate.value, supplierRules: state.procurementRules?.suppliers || core.SUPPLIER_RULES, baselineBySku: new Map(state.firstReview.rows.map((row) => [row.sku, row])) });
      const t = state.review.totals;
      elements.workflowSummary.replaceChildren(
        createSummaryCard("系統建議金額", formatCurrency(t.suggestedAmount), "原始工具建議", "currency"),
        createSummaryCard("第一次人工回匯", formatCurrency(t.manualAmount), "規則排除前", "currency"),
        createSummaryCard("規則阻擋金額", formatCurrency(t.blockedAmount), "不可核准", "currency"),
        createSummaryCard("異動後核准金額", formatCurrency(t.approvedAmount), "將寫入集中台帳", "currency")
      );
      elements.submitApproval.disabled = state.review.errors.length > 0; elements.submitApproval.textContent = "送出異動後待核准";
      if (state.review.errors.length) renderWorkflowErrors(state.review.errors, "覆核與異動確認表尚有阻擋，禁止送出");
      setWorkflowStep(elements.workflowStepSecond, state.review.errors.length ? "blocked" : "done", state.review.errors.length ? `仍有${state.review.errors.length}項阻擋` : "異動確認已通過");
      setWorkflowStep(elements.workflowStepApproval, state.review.errors.length ? "locked" : "active", state.review.errors.length ? "修正異動確認表後重跑" : "可送出待核准台帳");
      setWorkflowStatus(state.review.errors.length ? `覆核與異動確認表仍有${state.review.errors.length}項阻擋，禁止送出。` : "異動確認通過；可送出待核准台帳，此步驟不寄信。", state.review.errors.length ? "error" : "success");
      if (!state.review.errors.length) await persistWorkflowDraft("second_reviewed");
      renderBudget();
    } catch (error) {
      state.review = null; elements.submitApproval.disabled = true;
      renderWorkflowErrors([{ message: error.message }], "覆核與異動確認表檢查失敗，禁止送出");
      setWorkflowStep(elements.workflowStepSecond, "blocked", "檔案或內容未通過檢查");
      setWorkflowStep(elements.workflowStepApproval, "locked", "異動確認通過後開放");
      setWorkflowStatus(`異動確認失敗：${error.message}`, "error");
    }
    finally { elements.confirmReview.disabled = !state.secondReviewFile; }
  }
  function batchPayload() {
    const currentMonthPayment = state.review.payments.flatMap((row) => row.entries).filter((row) => row.month === elements.month.value).reduce((sum, row) => sum + row.amount, 0);
    const availableBySku = new Map();
    state.review.rows.filter((row) => row.finalQty > 0).forEach((row) => availableBySku.set(row.sku, (availableBySku.get(row.sku) || 0) + row.finalQty));
    const mode = state.workflowType === "store_shortage_replenishment" ? "new_order" : "merge_next";
    const linkedNeeds = state.storeShortageNeeds.filter((row) => row.handling_mode === mode).sort((left, right) => String(left.needed_by || "9999").localeCompare(String(right.needed_by || "9999"))).map((row) => {
      const remaining = Math.max(0, Number(availableBySku.get(row.sku) || 0));
      const quantity = Math.min(remaining, Math.max(0, Number(row.unfilled_quantity || 0) - Number(row.covered_quantity || 0)));
      availableBySku.set(row.sku, remaining - quantity);
      return { storeCode: row.store_code, sku: row.sku, quantity };
    }).filter((row) => row.quantity > 0);
    return {
      batchId: state.batchId, analysisMonth: elements.month.value, supplierSummary: [...new Set(state.review.rows.filter((row) => row.finalQty > 0).map((row) => row.supplier))],
      workflowType: state.workflowType,
      suggestedAmount: state.review.totals.suggestedAmount, manualAmount: state.review.totals.manualAmount, blockedAmount: state.review.totals.blockedAmount,
      approvedAmount: state.review.totals.approvedAmount, adjustmentAmount: state.review.totals.adjustmentAmount, budgetAmount: currentBudget().availableBudget,
      paymentCurrentMonth: currentMonthPayment, paymentFutureMonths: state.review.totals.approvedAmount - currentMonthPayment,
      paymentSchedule: state.review.payments.flatMap((row) => row.entries.map((entry) => ({ supplier: row.supplier, country: row.supplierCountry, ...entry }))),
      approvedItems: state.review.rows.filter((row) => row.finalQty > 0).map((row) => ({
        sku: row.sku, name: row.name || "", supplier: row.supplier || "", quantity: Number(row.finalQty || 0),
        unitCost: Number(row.unitCost || 0), amount: Number(row.finalQty || 0) * Number(row.unitCost || 0)
      })),
      storeShortageNeeds: linkedNeeds,
      warningSummary: currentBudget().remainingBudget - state.review.totals.approvedAmount < 0 ? "本批核准後超出中性情境尚可承諾額度" : "無",
      idempotencyKey: `${state.batchId}:submit`
    };
  }
  async function postJson(url, payload, headers = {}, method = "POST") {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) {
      const error = new Error(result.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return result;
  }
  function newBatchId() {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const random = globalThis.crypto?.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
    return `PP-${stamp}-${random}`;
  }
  async function submitForApproval() {
    if (!state.review || state.review.errors.length) return;
    state.batchId ||= newBatchId(); elements.submitApproval.disabled = true; setWorkflowStatus("正在寫入待核准台帳；此步驟不寄信…");
    try {
      await postJson("/api/procurement/batches", batchPayload()); elements.approve.disabled = !state.config.permissions?.canApprove; await loadLedger();
      await persistWorkflowDraft("pending_approval");
      setWorkflowStep(elements.workflowStepApproval, "active", state.config.permissions?.canApprove ? "已送待核准，可正式核准" : "已送待核准，等候核准者處理");
      setWorkflowStatus(state.config.permissions?.canApprove ? `批次${state.batchId}已送待核准；尚未寄信。` : `批次${state.batchId}已送待核准，請由採購核准者處理。`, "success");
    } catch (error) { elements.submitApproval.disabled = false; setWorkflowStatus(`台帳寫入失敗：${error.message}`, "error"); }
  }
  async function approveBatch() {
    if (!state.batchId || !state.config.permissions?.canApprove) return;
    elements.approve.disabled = true; setWorkflowStatus("正在正式核准並建立通知工作…");
    try {
      await postJson(`/api/procurement/batches/${encodeURIComponent(state.batchId)}/approve`, { idempotencyKey: `${state.batchId}:approve` });
      state.approved = true; elements.erp.disabled = false; await loadLedger(); await persistWorkflowDraft("approved"); const token = googleSources.token();
      setWorkflowStep(elements.workflowStepApproval, "done", "正式核准完成，可下載ERP採購檔");
      if (!token) { elements.retryNotification.disabled = false; setWorkflowStatus("已正式核准且額度台帳已寫入；郵件待目前核准帳號完成 Google 授權後重送。", "error"); return; }
      try {
        await postJson(`/api/procurement/batches/${encodeURIComponent(state.batchId)}/notify`, {}, { "X-Google-Access-Token": token });
        elements.retryNotification.disabled = true; setWorkflowStatus("正式核准完成，額度摘要郵件已寄送；現在可下載ERP採購檔。", "success");
      } catch (notifyError) { elements.retryNotification.disabled = false; setWorkflowStatus(`正式核准與台帳已完成；郵件待重送：${notifyError.message}。ERP檔仍可下載。`, "error"); }
    } catch (error) { elements.approve.disabled = false; setWorkflowStatus(`核准失敗：${error.message}`, "error"); }
  }
  async function retryNotification() {
    if (!state.batchId || !state.config?.permissions?.canApprove) return;
    const token = googleSources.token();
    if (!token) { setWorkflowStatus("請先以目前公司登入帳號完成 Google 授權，再重送摘要。", "error"); return; }
    elements.retryNotification.disabled = true; setWorkflowStatus("正在重送核准摘要郵件…");
    try {
      const result = await postJson(`/api/procurement/batches/${encodeURIComponent(state.batchId)}/notify`, {}, { "X-Google-Access-Token": token });
      setWorkflowStatus(result.status === "sent" ? "摘要郵件已重送完成。" : "此批次沒有待寄送的摘要。", "success");
    } catch (error) { elements.retryNotification.disabled = false; setWorkflowStatus(`郵件仍待重送：${error.message}`, "error"); }
  }
  function downloadErp() {
    if (!state.review || !state.approved) return;
    try {
      const suppliers = [...new Set(state.review.rows.filter((row) => Number(row.finalQty || 0) > 0).map((row) => row.supplier))];
      suppliers.forEach((supplier) => {
        const safeSupplier = String(supplier || "供應商").replace(/[\\/:*?"<>|]/g, "-").slice(0, 45);
        XLSX.writeFile(core.buildErpPurchaseWorkbook(state.review, XLSX, { approved: true, batchId: state.batchId, supplier }), `${state.batchId}_${safeSupplier}_ERP正式採購單.xlsx`, { compression: true });
      });
      state.erpDownloaded = true; setWorkflowStatus(`已依供應商分開下載${suppliers.length}份ERP採購檔；匯入ERP後，請在下方「已承諾批次與額度異動」的所屬批次填入ERP採購單號。`, "success");
    }
    catch (error) { setWorkflowStatus(error.message, "error"); }
  }
  elements.newProductFile.addEventListener("change", () => { state.newProductFile = elements.newProductFile.files[0] || null; updateSpecialWorkflowReady(); });
  elements.manualDraftFiles.addEventListener("change", () => { state.manualDraftFiles = [...elements.manualDraftFiles.files]; updateSpecialWorkflowReady(); });
  elements.postedOrderFiles.addEventListener("change", () => {
    state.postedOrderFiles = [...elements.postedOrderFiles.files];
    updateSpecialWorkflowReady();
    if (!state.postedOrderFiles.length) return;
    if (!state.config?.permissions?.canApprove) {
      elements.specialWorkflowStatus.textContent = `已選${state.postedOrderFiles.length}份ERP採購單，但目前帳號沒有補登台帳權限。`;
      elements.specialWorkflowStatus.className = "main-status error";
      return;
    }
    elements.specialWorkflowStatus.textContent = `已選${state.postedOrderFiles.length}份ERP採購單：${state.postedOrderFiles.map((file) => file.name).join("、")}。可直接檢查並補登，不必先產生採購建議。`;
    elements.specialWorkflowStatus.className = "main-status success";
  });
  elements.newProductButton.addEventListener("click", buildNewProductFlow);
  elements.manualDraftButton.addEventListener("click", buildManualDraftFlow);
  elements.postedOrderButton.addEventListener("click", importPostedOrders);
  bindFileInput(elements.masterFile, "masterFile", elements.masterFileName, false, "masterWorkbook");
  bindFileInput(elements.inventoryFile, "inventoryFile", elements.inventoryFileName);
  bindFileInput(elements.pendingFiles, "pendingFiles", elements.pendingFilesName, true);
  bindFileInput(elements.transferFile, "transferFile", elements.transferFileName);
  bindFileInput(elements.consignmentFile, "consignmentFile", elements.consignmentFileName, false, "consignmentWorkbook");
  bindFileInput(elements.lirongConsignmentFile, "lirongConsignmentFile", elements.lirongConsignmentFileName, false, "lirongConsignmentWorkbook");
  bindFileInput(elements.salesFiles, "salesFiles", elements.salesFilesName, true);
  elements.modelFile.addEventListener("change", selectSeasonalModel);
  elements.modelRefresh.addEventListener("click", buildSeasonalModelDraft);
  elements.modelDownloadDraft.addEventListener("click", downloadModelDraft);
  elements.modelApprove.addEventListener("click", approveSeasonalModel);
  bindFileInput(elements.marketingFile, "marketingFile", elements.marketingFileName);
  elements.reviewFile.addEventListener("change", () => {
    state.reviewFile = elements.reviewFile.files[0] || null; state.firstReview = null; state.secondReviewFile = null; state.review = null; state.approved = false;
    elements.reviewButton.disabled = !state.reviewFile; setFileInputEnabled(elements.secondReviewFile, elements.secondReviewFileLabel, false); elements.confirmReview.disabled = true;
    elements.submitApproval.disabled = true; elements.submitApproval.textContent = "全部沿用並送出待核准"; elements.approve.disabled = true; elements.retryNotification.disabled = true; elements.erp.disabled = true;
    state.erpDownloaded = false;
    clearWorkflowErrors();
    setWorkflowStep(elements.workflowStepFirst, "active", state.reviewFile ? `已選擇${state.reviewFile.name}` : "請選擇第一次人工回匯檔");
    setWorkflowStep(elements.workflowStepSecond, "locked", "第一次覆核通過後開放");
    setWorkflowStep(elements.workflowStepApproval, "locked", "第一次覆核通過後開放");
    setWorkflowStatus(state.reviewFile ? `已選擇${state.reviewFile.name}；請開始第一次回匯檢查。` : "尚未選擇人工回匯檔。");
  });
  elements.secondReviewFile.addEventListener("change", () => {
    state.secondReviewFile = elements.secondReviewFile.files[0] || null; state.review = null;
    elements.confirmReview.disabled = !state.secondReviewFile; elements.submitApproval.disabled = true; elements.submitApproval.textContent = "送出異動後待核准";
    setWorkflowStep(elements.workflowStepSecond, "active", state.secondReviewFile ? `已選擇${state.secondReviewFile.name}` : "請選擇覆核與異動確認表");
    setWorkflowStatus(state.secondReviewFile ? `已選擇${state.secondReviewFile.name}；請檢查本次異動。` : "有變更時，請回匯已填寫異動量與原因的同一份確認表。");
  });
  elements.selectAllSuppliers.addEventListener("click", () => {
    state.selectedSuppliers = new Set(positiveSupplierNames(state.analysis));
    [elements.supplierFilterList, elements.otherSupplierFilterList].forEach((list) => list.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = state.selectedSuppliers.has(input.value); }));
    resetScopeForNewExport();
  });
  elements.clearSuppliers.addEventListener("click", () => {
    state.selectedSuppliers.clear();
    [elements.supplierFilterList, elements.otherSupplierFilterList].forEach((list) => list.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = false; }));
    resetScopeForNewExport();
  });
  [elements.checkpoint, elements.orderDate, elements.inventoryDate, elements.pendingDate, elements.transferDate, elements.consignmentDate, elements.salesDate].forEach((element) => element.addEventListener("change", () => {
    if (state.analysis) invalidateAnalysis();
    if (element === elements.checkpoint) renderBudget();
    updateReadyState();
  }));
  elements.month.addEventListener("change", () => {
    if (state.analysis) invalidateAnalysis();
    state.sharedCostSnapshot = null; renderCostSnapshotStatus(); renderModelStatus(); updateReadyState();
    Promise.all([loadLedger(), loadMonthPlan(), loadSharedWorkflowDrafts()]).then(loadCostSnapshot);
  });
  elements.forecastRevenue.addEventListener("input", () => { updateAutomaticForecastCost(); markBudgetDirty(); });
  elements.releasedBudget.addEventListener("input", markBudgetDirty);
  elements.budgetSourceNote.addEventListener("input", () => { elements.budgetPlanStatus.textContent = "額度來源註記尚未儲存。"; });
  elements.purchasedToDate.addEventListener("input", renderBudget); elements.saveBudget.addEventListener("click", saveMonthPlan);
  elements.addChannel.addEventListener("click", addRevenueChannel); elements.refreshQueue.addEventListener("click", loadLedger); elements.refreshSharedDrafts.addEventListener("click", loadSharedWorkflowDrafts);
  elements.googleConnect.addEventListener("click", connectGoogle); elements.autoSource.addEventListener("click", loadAutomaticSources);
  elements.storeShortageRows.addEventListener("click", decideStoreShortage);
  elements.storeShortageRows.addEventListener("change", (event) => { if (event.target.matches("[data-shortage-select]")) updateStoreShortageSelection(); });
  elements.storeShortageSelectAll.addEventListener("change", () => {
    elements.storeShortageRows.querySelectorAll("[data-shortage-select]").forEach((input) => { input.checked = elements.storeShortageSelectAll.checked; });
    updateStoreShortageSelection();
  });
  elements.storeShortageBatchBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-shortage-bulk-mode], [data-shortage-bulk-close]");
    if (button) batchDecideStoreShortages(button);
  });
  elements.runShortageOrder.addEventListener("click", async () => { state.shortageRunMode = "new_order"; try { await analyze(); } finally { state.shortageRunMode = "merge_next"; } });
  elements.analyze.addEventListener("click", analyze); elements.download.addEventListener("click", startSelectedWorkUnits);
  elements.reviewButton.addEventListener("click", reviewReturn); elements.confirmReview.addEventListener("click", confirmSecondReview);
  elements.submitApproval.addEventListener("click", submitForApproval); elements.approve.addEventListener("click", approveBatch);
  elements.retryNotification.addEventListener("click", retryNotification); elements.erp.addEventListener("click", downloadErp);
  elements.restoreReportFile.addEventListener("change", async () => {
    const file = elements.restoreReportFile.files[0];
    if (!file) return;
    try {
      const draft = extractWorkflowSnapshot(await readWorkbook(file));
      restoreWorkflowDraft(draft);
      await persistWorkflowDraft(draft.stage || "downloaded");
      setWorkflowStatus("已從先前下載的採購建議報表恢復批次。", "success");
    } catch (error) { setWorkflowStatus(`無法從報表恢復：${error.message}`, "error"); }
    finally { elements.restoreReportFile.value = ""; }
  });
  setInitialDates(); renderChannels(); renderBudget(); renderModelStatus(); updateModelControls(); updateReadyState(); hydrateCachedModel(); hydrateWorkflowDrafts(); loadConfig();
})();

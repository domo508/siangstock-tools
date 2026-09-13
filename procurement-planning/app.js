(function () {
  "use strict";

  const core = globalThis.ProcurementPlanningCore;
  const googleSources = globalThis.ProcurementGoogleSources;
  const BLACKLIST_KEY = "siangstock.procurement.blacklist.v1";
  const state = {
    config: null, masterFile: null, masterWorkbook: null, inventoryFile: null, pendingFiles: [],
    consignmentFile: null, consignmentWorkbook: null, lirongConsignmentFile: null, lirongConsignmentWorkbook: null,
    salesFiles: [], modelFile: null, marketingFile: null, analysis: null, reviewFile: null, firstReview: null,
    secondReviewFile: null, review: null, ledger: null, monthPlan: null, budgetDirty: false, sourceMetadata: null, batchId: "", approved: false, erpDownloaded: false
  };

  const get = (selector) => document.querySelector(selector);
  const elements = {
    accountBadge: get("#account-badge"), googleConnect: get("#google-connect-button"), autoSource: get("#auto-source-button"), sourceStatus: get("#source-status"),
    month: get("#analysis-month"), checkpoint: get("#checkpoint"), orderDate: get("#order-date"), inventoryDate: get("#inventory-date"),
    pendingDate: get("#pending-date"), consignmentDate: get("#consignment-date"), salesDate: get("#sales-date"),
    masterFile: get("#master-file"), inventoryFile: get("#inventory-file"), pendingFiles: get("#pending-files"), consignmentFile: get("#consignment-file"),
    lirongConsignmentFile: get("#lirong-consignment-file"), salesFiles: get("#sales-files"), modelFile: get("#model-file"), marketingFile: get("#marketing-file"),
    masterFileName: get("#master-file-name"), inventoryFileName: get("#inventory-file-name"), pendingFilesName: get("#pending-files-name"),
    consignmentFileName: get("#consignment-file-name"), lirongConsignmentFileName: get("#lirong-consignment-file-name"), salesFilesName: get("#sales-files-name"),
    modelFileName: get("#model-file-name"), marketingFileName: get("#marketing-file-name"), blacklist: get("#blacklist-input"), saveBlacklist: get("#save-blacklist-button"),
    blacklistStatus: get("#blacklist-status"), analyze: get("#analyze-button"), download: get("#download-button"), status: get("#main-status"),
    resultPanel: get("#result-panel"), dateCheck: get("#date-check-message"), summaryCards: get("#summary-cards"), resultAlert: get("#result-alert"), resultRows: get("#result-rows"),
    forecastRevenue: get("#forecast-revenue"), forecastCost: get("#forecast-cost"), targetEndingCost: get("#target-ending-cost"), openingCost: get("#opening-cost"),
    supplierReturns: get("#supplier-returns"), purchasedToDate: get("#purchased-to-date"), budgetSourceNote: get("#budget-source-note"),
    saveBudget: get("#save-budget-button"), budgetPlanStatus: get("#budget-plan-status"), budgetSummary: get("#budget-summary"), ledgerStatus: get("#ledger-status"),
    reviewFile: get("#review-file"), reviewButton: get("#review-button"), secondReviewFile: get("#second-review-file"), confirmReview: get("#confirm-review-button"),
    submitApproval: get("#submit-approval-button"), approve: get("#approve-button"), retryNotification: get("#retry-notification-button"),
    erp: get("#erp-button"), erpReference: get("#erp-reference"), erpCreated: get("#erp-created-button"), workflowStatus: get("#workflow-status"), workflowSummary: get("#workflow-summary")
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
  function sourceProof(id, metadata) { return `ID…${String(id || "").slice(-6)}・更新${metadata?.modifiedTime || "依工作表內容"}・抓取${String(metadata?.fetchedAt || "").replace("T", " ").slice(0, 19)}・SHA-256 ${String(metadata?.sha256 || "").slice(0, 12)}…`; }
  function setStatus(message, type = "") { elements.status.textContent = message; elements.status.className = `main-status ${type}`.trim(); }
  function setWorkflowStatus(message, type = "") { elements.workflowStatus.textContent = message; elements.workflowStatus.className = `main-status ${type}`.trim(); }
  function blacklistEntries() { return core.normalizeBlacklist(elements.blacklist.value).map((entry) => entry.original); }
  function updateBlacklistStatus(saved) { elements.blacklistStatus.textContent = `目前${blacklistEntries().length}項・${saved ? "已儲存於這個瀏覽器" : "尚未儲存"}`; }
  function loadBlacklist() {
    try { elements.blacklist.value = localStorage.getItem(BLACKLIST_KEY) || ""; updateBlacklistStatus(Boolean(elements.blacklist.value)); }
    catch (_error) { updateBlacklistStatus(false); }
  }
  function saveBlacklist() {
    const normalized = blacklistEntries().join("\n"); elements.blacklist.value = normalized;
    try { localStorage.setItem(BLACKLIST_KEY, normalized); updateBlacklistStatus(true); }
    catch (_error) { elements.blacklistStatus.textContent = "這個瀏覽器禁止本機儲存；本次仍可使用目前黑名單。"; }
  }
  async function readWorkbook(file) {
    const data = await file.arrayBuffer();
    return XLSX.read(data, { type: "array", cellDates: true, cellStyles: true, nodim: true });
  }
  function createSummaryCard(label, value, note, className = "") {
    const card = document.createElement("article"); card.className = "summary-card";
    const small = document.createElement("small"); small.textContent = label;
    const strong = document.createElement("strong"); strong.className = `value ${className}`.trim(); strong.textContent = value;
    const span = document.createElement("span"); span.textContent = note; card.append(small, strong, span); return card;
  }
  function requirementsReady() {
    return Boolean(state.config && (state.masterFile || state.masterWorkbook) && state.inventoryFile && state.pendingFiles.length
      && (state.consignmentFile || state.consignmentWorkbook) && (state.lirongConsignmentFile || state.lirongConsignmentWorkbook)
      && state.marketingFile && state.salesFiles.length && state.modelFile && elements.month.value && elements.orderDate.value
      && elements.inventoryDate.value && elements.pendingDate.value && elements.consignmentDate.value && elements.salesDate.value);
  }
  function updateReadyState() {
    elements.analyze.disabled = !requirementsReady();
    if (!requirementsReady() && !state.analysis) setStatus("請完成公司登入、日期與必要資料；商品主檔可自動取得或手動更新。");
  }
  function invalidateAnalysis() {
    state.analysis = null; state.reviewFile = null; state.firstReview = null; state.secondReviewFile = null; state.review = null; state.approved = false; state.erpDownloaded = false; state.batchId = "";
    elements.download.disabled = true; elements.submitApproval.disabled = true; elements.approve.disabled = true; elements.retryNotification.disabled = true; elements.erp.disabled = true;
    elements.reviewFile.value = ""; elements.secondReviewFile.value = ""; elements.reviewFile.disabled = true; elements.reviewButton.disabled = true;
    elements.secondReviewFile.disabled = true; elements.confirmReview.disabled = true;
    elements.erpReference.value = ""; elements.erpReference.disabled = true; elements.erpCreated.disabled = true;
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
    const invalid = parsed.records.filter((row) => !row.supplier || !(row.unitCost > 0) || !(row.moq > 0) || !row.productStatus);
    return { parsed, invalidCount: invalid.length };
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
      renderBudget();
    } catch (error) {
      state.ledger = null; elements.ledgerStatus.textContent = `台帳同步失敗：${error.message}；為避免錯算，正式核准前請重新整理。`;
      elements.ledgerStatus.classList.add("error");
    }
  }
  function applyMonthPlan(plan) {
    state.monthPlan = plan;
    state.budgetDirty = false;
    elements.forecastRevenue.value = String(plan?.forecastRevenue ?? 0);
    elements.forecastCost.value = String(plan?.forecastCostOutflow ?? 0);
    elements.targetEndingCost.value = String(plan?.targetEndingInventoryCost ?? 0);
    elements.openingCost.value = String(plan?.openingInventoryCost ?? 0);
    elements.supplierReturns.value = String(plan?.expectedSupplierReturns ?? 0);
    elements.budgetSourceNote.value = plan?.sourceNote || "";
    elements.budgetPlanStatus.textContent = plan
      ? `已同步${plan.analysisMonth}中性情境快照：額度${formatCurrency(plan.budgetAmount)}・更新${String(plan.updatedAt || "").replace("T", " ").slice(0, 19)}。`
      : `${elements.month.value}尚無已核准月份快照；目前欄位只在本頁暫存。`;
    renderBudget();
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
  async function loadConfig() {
    try {
      const response = await fetch("/api/procurement/config", { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "請先完成公司帳號登入。" : `權限服務回應${response.status}`);
      state.config = await response.json();
      elements.accountBadge.textContent = `${state.config.email}・${state.config.role === "admin" ? "核准管理者" : "採購操作"}`;
      if (state.config.googleOAuthClientId) { elements.googleConnect.disabled = false; }
      else {
        elements.googleConnect.disabled = true;
        elements.sourceStatus.textContent = "Cloudflare 尚未設定 GOOGLE_OAUTH_CLIENT_ID；自動來源與郵件暫停。";
        elements.sourceStatus.classList.add("error");
      }
      elements.saveBudget.disabled = state.config.role !== "admin";
      await Promise.all([loadLedger(), loadMonthPlan()]);
    } catch (error) {
      state.config = null; elements.accountBadge.textContent = "公司登入驗證失敗";
      elements.sourceStatus.textContent = error.message; elements.sourceStatus.classList.add("error");
    }
    updateReadyState();
  }
  async function connectGoogle() {
    elements.googleConnect.disabled = true; elements.sourceStatus.textContent = "正在等待公司 Google 授權…";
    try {
      googleSources.initialize(state.config.googleOAuthClientId);
      await googleSources.authorize(); const identity = await googleSources.verifyCompanyIdentity();
      if (identity.email !== state.config.email) throw new Error("Google 授權帳號與公司登入帳號不一致。");
      elements.googleConnect.textContent = "Google 已授權"; elements.autoSource.disabled = false;
      elements.sourceStatus.textContent = "授權完成；access token只保存在目前分頁記憶體，不會寫入D1或瀏覽器儲存。";
      elements.sourceStatus.className = "result-alert";
    } catch (error) {
      elements.sourceStatus.textContent = error.message; elements.sourceStatus.className = "result-alert error"; elements.googleConnect.disabled = false;
    }
  }
  async function loadAutomaticSources() {
    elements.autoSource.disabled = true; elements.sourceStatus.textContent = "正在唯讀取得商品主檔、行銷策略、普優瑪與力榮寄庫表…";
    try {
      const sources = await googleSources.loadAll(state.config, XLSX);
      const masterValidation = validateAutoMaster(await readWorkbook(sources.master.file));
      state.masterFile = sources.master.file; state.masterWorkbook = null; state.marketingFile = sources.marketingFile;
      state.consignmentWorkbook = sources.puyoumaWorkbook; state.consignmentFile = null;
      state.lirongConsignmentWorkbook = sources.lirongWorkbook; state.lirongConsignmentFile = null;
      state.sourceMetadata = sources;
      const puyouma = core.parseConsignmentWorkbook(state.consignmentWorkbook, XLSX);
      const lirong = core.parseLirongConsignmentWorkbook(state.lirongConsignmentWorkbook, XLSX);
      if (!puyouma.styleAudit.pinkDetected) throw new Error("普優瑪寄庫表未辨識到粉紅排程格式，已停止採用。");
      elements.masterFileName.textContent = `自動：${sources.master.metadata.name}・${sourceProof(sources.master.metadata.id, sources.master.metadata)}`;
      elements.marketingFileName.textContent = `自動：整體行銷策略・${sourceProof(sources.marketingMetadata.fileId, sources.marketingMetadata)}`;
      elements.consignmentFileName.textContent = `自動：庫存+下單／庫存布，共${puyouma.records.length}列・${sourceProof(sources.puyoumaMetadata.spreadsheetId, sources.puyoumaMetadata)}`;
      elements.lirongConsignmentFileName.textContent = `自動：工作表1，共${lirong.records.length}列・${sourceProof(sources.lirongMetadata.spreadsheetId, sources.lirongMetadata)}`;
      elements.sourceStatus.textContent = masterValidation.invalidCount
        ? `固定 Google 資料源已完成格式檢核；商品主檔有${masterValidation.invalidCount}列缺供應商或進貨價，受影響品號會阻擋核准，其餘品號可繼續。`
        : "固定 Google 資料源已完成格式檢核；本次採用自動來源。";
      elements.sourceStatus.className = `result-alert ${masterValidation.invalidCount ? "warn" : ""}`.trim();
      invalidateAnalysis(); updateReadyState();
    } catch (error) {
      elements.sourceStatus.textContent = `自動來源停止：${error.message} 請修正來源或改用明確標示的手動備援。`;
      elements.sourceStatus.className = "result-alert error";
    } finally { elements.autoSource.disabled = false; }
  }
  function renderSummary(analysis, consignmentSource) {
    elements.summaryCards.replaceChildren(
      createSummaryCard("分析SKU", formatNumber(analysis.totals.analyzedSkuCount), "近12週有需求或已有未到貨"),
      createSummaryCard("建議採購SKU", formatNumber(analysis.totals.suggestedSkuCount), "排除規則後"),
      createSummaryCard("建議採購數量", formatNumber(analysis.totals.suggestedPurchaseQty), "已套用箱規／10件單位"),
      createSummaryCard("建議採購金額", formatCurrency(analysis.totals.suggestedPurchaseAmount), "依最新商品主檔", "currency"),
      createSummaryCard("熱銷／穩定／低銷", `${analysis.totals.hotSkuCount}/${analysis.totals.stableSkuCount}/${analysis.totals.lowSkuCount}`, "ABC＋XYZ"),
      createSummaryCard("寄倉現貨不足", formatNumber(analysis.totals.immediateShortageSkuCount), "採購與寄庫分開"),
      createSummaryCard("規則排除", formatNumber(analysis.totals.sellThroughStopExcludedCount), "S／專屬週期／贈品")
    );
    elements.dateCheck.textContent = `銷售截止日：${analysis.asOfDate}｜檔案最新：${analysis.sourceMaxSalesDate}`;
    const styleNote = consignmentSource.styleAudit.pinkDetected ? `已辨識${formatNumber(consignmentSource.styleAudit.pinkCells)}個粉紅排程格。` : "未辨識粉紅排程。";
    elements.resultAlert.textContent = `${analysis.validation.dateCheck.message} ${styleNote} 上林採28天檢視；普優瑪與力榮採購／寄庫分頁處理。`;
    elements.resultAlert.className = `result-alert ${analysis.validation.dateCheck.status === "PASS" && consignmentSource.styleAudit.pinkDetected ? "" : "warn"}`.trim();
  }
  function appendCell(row, value, className = "") { const cell = document.createElement("td"); cell.textContent = value; if (className) cell.className = className; row.appendChild(cell); }
  function renderRows(rows) {
    const fragment = document.createDocumentFragment();
    rows.forEach((item) => {
      const row = document.createElement("tr");
      [item.supplier, item.sku, item.name, `${item.tier}・${item.abcClass}${item.xyzClass}`, item.supplyProfileLabel,
        item.supplierLeadDays, item.targetCoverageDays, item.recent6Qty, item.recent12Qty, item.forecastDailyQty,
        item.inventoryQty, item.pendingQty, item.suggestedPurchaseQty, formatCurrency(item.suggestedPurchaseAmount),
        item.consignmentCurrentQty, item.suggestedConsignmentQty, item.supplyStatus].forEach((value, index) => appendCell(row, typeof value === "number" ? formatNumber(value) : value, index === 15 && item.immediateConsignmentGap > 0 ? "negative" : ""));
      fragment.appendChild(row);
    });
    elements.resultRows.replaceChildren(fragment);
  }
  async function resolveWorkbook(file, loaded) { return loaded || readWorkbook(file); }
  async function analyze() {
    if (!requirementsReady()) return;
    elements.analyze.disabled = true; elements.download.disabled = true; setStatus("正在本機解析資料並套用正式採購、寄庫與付款規則…");
    try {
      const [masterWorkbook, inventoryWorkbook, consignmentWorkbook, lirongWorkbook, modelWorkbook, pendingWorkbooks, salesWorkbooks] = await Promise.all([
        resolveWorkbook(state.masterFile, state.masterWorkbook), readWorkbook(state.inventoryFile), resolveWorkbook(state.consignmentFile, state.consignmentWorkbook),
        resolveWorkbook(state.lirongConsignmentFile, state.lirongConsignmentWorkbook), readWorkbook(state.modelFile),
        Promise.all(state.pendingFiles.map(readWorkbook)), Promise.all(state.salesFiles.map(readWorkbook))
      ]);
      const master = core.parseProductMasterWorkbook(masterWorkbook, XLSX, { fileName: "本次商品主檔" });
      const inventory = core.parseInventoryWorkbook(inventoryWorkbook, XLSX, { fileName: "本次庫存" });
      const consignment = core.parseConsignmentWorkbook(consignmentWorkbook, XLSX, { fileName: "普優瑪寄庫" });
      const lirongConsignment = core.parseLirongConsignmentWorkbook(lirongWorkbook, XLSX, { fileName: "力榮寄庫" });
      const pendingReports = pendingWorkbooks.map((workbook) => core.parsePendingPurchaseWorkbook(workbook, XLSX, { fileName: "未到貨採購單" }));
      const salesReports = salesWorkbooks.map((workbook) => core.parseSalesWorkbook(workbook, XLSX, { fileName: "銷售明細" }));
      const model = core.parseForecastModelWorkbook(modelWorkbook, XLSX, { fileName: "季節模型" });
      const validation = core.buildAnalysis({ master, inventory, pendingReports, consignment, blacklist: blacklistEntries(), dates: {
        inventory: elements.inventoryDate.value, pending: elements.pendingDate.value, consignment: elements.consignmentDate.value, sales: elements.salesDate.value
      } });
      const analysis = core.buildProcurementRecommendations({ master, inventory, pendingReports, consignment, salesReports, model,
        blacklist: blacklistEntries(), asOfDate: elements.salesDate.value, checkpoint: elements.checkpoint.value, supplierRules: core.SUPPLIER_RULES });
      analysis.validation = validation;
      analysis.lirongConsignmentRows = core.buildLirongConsignmentRecommendations(analysis, lirongConsignment, { orderDate: elements.orderDate.value });
      analysis.meta = {
        month: elements.month.value, checkpoint: elements.checkpoint.value, sourceMode: state.consignmentWorkbook ? "Google自動" : "手動備援",
        sourceHashes: state.sourceMetadata ? {
          master: state.sourceMetadata.master.metadata.sha256,
          marketing: state.sourceMetadata.marketingMetadata.sha256,
          puyouma: state.sourceMetadata.puyoumaMetadata.sha256,
          lirong: state.sourceMetadata.lirongMetadata.sha256
        } : {}
      };
      state.analysis = analysis; renderSummary(analysis, consignment); renderRows(analysis.suggestedRows);
      elements.resultPanel.hidden = false; elements.download.disabled = false;
      elements.reviewFile.disabled = false;
      setStatus(`完成：${analysis.totals.suggestedSkuCount}個SKU，建議金額${formatCurrency(analysis.totals.suggestedPurchaseAmount)}。`, "success");
      renderBudget(); elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      state.analysis = null; elements.resultPanel.hidden = true; setStatus(`無法完成：${error.message || "請確認檔案格式"}`, "error");
    } finally { elements.analyze.disabled = !requirementsReady(); }
  }
  function currentBudget() {
    const read = (element) => Number.isFinite(Number(element.value)) ? Number(element.value) : 0;
    const calculated = core.calculatePurchaseBudget({ forecastCostOutflow: read(elements.forecastCost), targetEndingInventoryCost: read(elements.targetEndingCost),
      openingInventoryCost: read(elements.openingCost), expectedSupplierReturns: read(elements.supplierReturns), purchasedAmountToDate: read(elements.purchasedToDate) });
    if (!state.budgetDirty && Number.isFinite(Number(state.monthPlan?.budgetAmount))) {
      const availableBudget = Number(state.monthPlan.budgetAmount);
      return { ...calculated, availableBudget, remainingBudget: availableBudget - calculated.purchasedAmountToDate };
    }
    return calculated;
  }
  function renderBudget() {
    const result = currentBudget(); const revenue = Number(elements.forecastRevenue.value || 0); const cost = Number(elements.forecastCost.value || 0);
    const cards = [
      createSummaryCard("中性情境整月預估營收", formatCurrency(revenue), elements.checkpoint.value === "mid-month" ? "實際至今＋行銷預估剩餘" : "同月份最新核准預估", "currency"),
      createSummaryCard("整月預估成本耗用", formatCurrency(cost), revenue > 0 ? `占營收${formatNumber(cost / revenue * 100)}%` : "尚未輸入營收", "currency"),
      createSummaryCard("中性情境－整月預估可採購額度", formatCurrency(result.availableBudget),
        state.monthPlan && !state.budgetDirty ? "已核准月份快照；來源見上方註記" : "成本耗用＋目標期末－期初＋退貨", "currency"),
      createSummaryCard("截至目前已承諾", formatCurrency(result.purchasedAmountToDate), "正式核准互斥狀態加總", "currency"),
      createSummaryCard("截至目前尚可承諾", formatCurrency(result.remainingBudget), result.remainingBudget < 0 ? "已超出額度" : "尚可核准", `currency ${result.remainingBudget < 0 ? "negative" : ""}`)
    ];
    if (state.review) {
      const currentPayment = state.review.payments.flatMap((row) => row.entries).filter((row) => row.month === elements.month.value).reduce((sum, row) => sum + row.amount, 0);
      cards.push(createSummaryCard("本批核准後尚可承諾", formatCurrency(result.remainingBudget - state.review.totals.approvedAmount), "依最終可核准金額", "currency"));
      cards.push(createSummaryCard("本批本月／未來付款", `${formatCurrency(currentPayment)}／${formatCurrency(state.review.totals.approvedAmount - currentPayment)}`, "依供應商付款觸發點", "currency"));
    }
    elements.budgetSummary.replaceChildren(...cards);
  }
  function markBudgetDirty() {
    state.budgetDirty = true;
    elements.budgetPlanStatus.textContent = state.config?.role === "admin"
      ? "月份額度有尚未儲存的變更；儲存後其他使用者才會讀到。"
      : "目前是本頁暫算；只有siang01可儲存為公司共用月份快照。";
    renderBudget();
  }
  async function saveMonthPlan() {
    if (state.config?.role !== "admin") return;
    elements.saveBudget.disabled = true;
    const budget = currentBudget();
    const sourceNote = elements.budgetSourceNote.value.trim() || `${elements.month.value}中性情境管理輸入`;
    try {
      const result = await postJson("/api/procurement/month-plan", {
        analysisMonth: elements.month.value,
        forecastRevenue: Number(elements.forecastRevenue.value || 0),
        forecastCostOutflow: Number(elements.forecastCost.value || 0),
        targetEndingInventoryCost: Number(elements.targetEndingCost.value || 0),
        openingInventoryCost: Number(elements.openingCost.value || 0),
        expectedSupplierReturns: Number(elements.supplierReturns.value || 0),
        budgetAmount: budget.availableBudget,
        sourceNote
      }, {}, "PUT");
      applyMonthPlan(result.plan);
    } catch (error) {
      elements.budgetPlanStatus.textContent = `月份額度儲存失敗：${error.message}`;
    } finally { elements.saveBudget.disabled = false; }
  }
  function downloadRecommendation() {
    if (!state.analysis) return;
    XLSX.writeFile(core.buildRecommendationWorkbook(state.analysis, XLSX, { budget: currentBudget() }), `${elements.month.value}_${elements.checkpoint.value === "mid-month" ? "月中" : "月初"}_採購建議_人工審核.xlsx`, { compression: true, cellStyles: true });
  }
  async function reviewReturn() {
    if (!state.reviewFile || !state.analysis) return;
    elements.reviewButton.disabled = true; setWorkflowStatus("正在重新檢查人工數量、力榮10件規則、可售至、付款月份與額度…");
    try {
      state.firstReview = core.reviewReturnedWorkbook(await readWorkbook(state.reviewFile), XLSX, { asOfDate: elements.salesDate.value || today(), orderDate: elements.orderDate.value, supplierRules: core.SUPPLIER_RULES, baselineBySku: new Map(state.analysis.rows.map((row) => [row.sku, row])) });
      XLSX.writeFile(core.buildSecondReviewWorkbook(state.firstReview, XLSX), `${elements.month.value}_回匯二次覆核報表.xlsx`, { compression: true, cellStyles: true });
      const t = state.firstReview.totals;
      elements.workflowSummary.replaceChildren(
        createSummaryCard("系統建議金額", formatCurrency(t.suggestedAmount), "原始工具建議", "currency"),
        createSummaryCard("人工回匯採購總額", formatCurrency(t.manualAmount), "規則排除前", "currency"),
        createSummaryCard("規則阻擋金額", formatCurrency(t.blockedAmount), "S／專屬週期／贈品", "currency"),
        createSummaryCard("最終可核准金額", formatCurrency(t.approvedAmount), "人工回匯－規則阻擋", "currency")
      );
      elements.secondReviewFile.disabled = state.firstReview.errors.length > 0;
      elements.submitApproval.disabled = true;
      setWorkflowStatus(state.firstReview.errors.length ? `覆核完成但有${state.firstReview.errors.length}項阻擋；請修正第一次回匯後重跑。` : "第一次覆核通過；請在下載報表逐列填二次確認採購量，再回匯確認版。", state.firstReview.errors.length ? "error" : "success");
      renderBudget();
    } catch (error) { state.firstReview = null; state.review = null; setWorkflowStatus(`回匯失敗：${error.message}`, "error"); }
    finally { elements.reviewButton.disabled = !state.reviewFile; }
  }
  async function confirmSecondReview() {
    if (!state.secondReviewFile) return;
    elements.confirmReview.disabled = true; setWorkflowStatus("正在檢查二次確認量、原因、付款月份與核准金額…");
    try {
      state.review = core.reviewSecondApprovalWorkbook(await readWorkbook(state.secondReviewFile), XLSX, { asOfDate: elements.salesDate.value || today(), orderDate: elements.orderDate.value, supplierRules: core.SUPPLIER_RULES, baselineBySku: new Map(state.firstReview.rows.map((row) => [row.sku, row])) });
      const t = state.review.totals;
      elements.workflowSummary.replaceChildren(
        createSummaryCard("系統建議金額", formatCurrency(t.suggestedAmount), "原始工具建議", "currency"),
        createSummaryCard("第一次人工回匯", formatCurrency(t.manualAmount), "規則排除前", "currency"),
        createSummaryCard("規則阻擋金額", formatCurrency(t.blockedAmount), "不可核准", "currency"),
        createSummaryCard("二次確認核准金額", formatCurrency(t.approvedAmount), "將寫入集中台帳", "currency")
      );
      elements.submitApproval.disabled = state.review.errors.length > 0;
      setWorkflowStatus(state.review.errors.length ? `二次確認版仍有${state.review.errors.length}項阻擋，禁止送出。` : "二次確認版通過；可送出待核准台帳，此步驟不寄信。", state.review.errors.length ? "error" : "success");
      renderBudget();
    } catch (error) { state.review = null; elements.submitApproval.disabled = true; setWorkflowStatus(`確認版失敗：${error.message}`, "error"); }
    finally { elements.confirmReview.disabled = !state.secondReviewFile; }
  }
  function batchPayload() {
    const currentMonthPayment = state.review.payments.flatMap((row) => row.entries).filter((row) => row.month === elements.month.value).reduce((sum, row) => sum + row.amount, 0);
    return {
      batchId: state.batchId, analysisMonth: elements.month.value, supplierSummary: [...new Set(state.review.rows.filter((row) => row.finalQty > 0).map((row) => row.supplier))],
      suggestedAmount: state.review.totals.suggestedAmount, manualAmount: state.review.totals.manualAmount, blockedAmount: state.review.totals.blockedAmount,
      approvedAmount: state.review.totals.approvedAmount, adjustmentAmount: state.review.totals.adjustmentAmount, budgetAmount: currentBudget().availableBudget,
      paymentCurrentMonth: currentMonthPayment, paymentFutureMonths: state.review.totals.approvedAmount - currentMonthPayment,
      paymentSchedule: state.review.payments.flatMap((row) => row.entries.map((entry) => ({ supplier: row.supplier, country: row.supplierCountry, ...entry }))),
      warningSummary: currentBudget().remainingBudget - state.review.totals.approvedAmount < 0 ? "本批核准後超出中性情境尚可承諾額度" : "無",
      idempotencyKey: `${state.batchId}:submit`
    };
  }
  async function postJson(url, payload, headers = {}, method = "POST") {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result;
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
      await postJson("/api/procurement/batches", batchPayload()); elements.approve.disabled = state.config.role !== "admin"; await loadLedger();
      setWorkflowStatus(state.config.role === "admin" ? `批次${state.batchId}已送待核准；尚未寄信。` : `批次${state.batchId}已送待核准，請由siang01核准。`, "success");
    } catch (error) { elements.submitApproval.disabled = false; setWorkflowStatus(`台帳寫入失敗：${error.message}`, "error"); }
  }
  async function approveBatch() {
    if (!state.batchId || state.config.role !== "admin") return;
    elements.approve.disabled = true; setWorkflowStatus("正在正式核准並建立通知工作…");
    try {
      await postJson(`/api/procurement/batches/${encodeURIComponent(state.batchId)}/approve`, { idempotencyKey: `${state.batchId}:approve` });
      state.approved = true; elements.erp.disabled = false; elements.erpReference.disabled = false; await loadLedger(); const token = googleSources.token();
      if (!token) { elements.retryNotification.disabled = false; setWorkflowStatus("已正式核准且額度台帳已寫入；郵件待重新完成siang01 Google授權後重送。", "error"); return; }
      try {
        await postJson(`/api/procurement/batches/${encodeURIComponent(state.batchId)}/notify`, {}, { "X-Google-Access-Token": token });
        elements.retryNotification.disabled = true; setWorkflowStatus("正式核准完成，額度摘要郵件已寄送；現在可下載ERP採購檔。", "success");
      } catch (notifyError) { elements.retryNotification.disabled = false; setWorkflowStatus(`正式核准與台帳已完成；郵件待重送：${notifyError.message}。ERP檔仍可下載。`, "error"); }
    } catch (error) { elements.approve.disabled = false; setWorkflowStatus(`核准失敗：${error.message}`, "error"); }
  }
  async function retryNotification() {
    if (!state.batchId || state.config?.role !== "admin") return;
    const token = googleSources.token();
    if (!token) { setWorkflowStatus("請先以siang01完成公司 Google 授權，再重送摘要。", "error"); return; }
    elements.retryNotification.disabled = true; setWorkflowStatus("正在重送核准摘要郵件…");
    try {
      const result = await postJson(`/api/procurement/batches/${encodeURIComponent(state.batchId)}/notify`, {}, { "X-Google-Access-Token": token });
      setWorkflowStatus(result.status === "sent" ? "摘要郵件已重送完成。" : "此批次沒有待寄送的摘要。", "success");
    } catch (error) { elements.retryNotification.disabled = false; setWorkflowStatus(`郵件仍待重送：${error.message}`, "error"); }
  }
  function downloadErp() {
    if (!state.review || !state.approved) return;
    try {
      XLSX.writeFile(core.buildErpPurchaseWorkbook(state.review, XLSX, { approved: true, batchId: state.batchId }), `${state.batchId}_ERP正式採購單.xlsx`, { compression: true, cellStyles: true });
      state.erpDownloaded = true; elements.erpCreated.disabled = !elements.erpReference.value.trim(); setWorkflowStatus("ERP採購檔已下載；完成ERP開單後請填採購單號或確認註記，再更新台帳狀態。", "success");
    }
    catch (error) { setWorkflowStatus(error.message, "error"); }
  }
  async function confirmErpCreated() {
    const erpReference = elements.erpReference.value.trim();
    if (!state.batchId || !state.erpDownloaded || !erpReference || state.config?.role !== "admin") return;
    elements.erpCreated.disabled = true; setWorkflowStatus("正在將批次轉為已建立ERP、尚未到貨…");
    try {
      await postJson(`/api/procurement/batches/${encodeURIComponent(state.batchId)}/erp-created`, { erpReference, idempotencyKey: `${state.batchId}:erp:${erpReference}` });
      await loadLedger(); elements.erpReference.disabled = true; setWorkflowStatus("台帳已更新為已建立ERP、尚未到貨；金額只轉換狀態，不會重複占用額度。", "success");
    } catch (error) { elements.erpCreated.disabled = false; setWorkflowStatus(`ERP狀態更新失敗：${error.message}`, "error"); }
  }

  bindFileInput(elements.masterFile, "masterFile", elements.masterFileName, false, "masterWorkbook");
  bindFileInput(elements.inventoryFile, "inventoryFile", elements.inventoryFileName);
  bindFileInput(elements.pendingFiles, "pendingFiles", elements.pendingFilesName, true);
  bindFileInput(elements.consignmentFile, "consignmentFile", elements.consignmentFileName, false, "consignmentWorkbook");
  bindFileInput(elements.lirongConsignmentFile, "lirongConsignmentFile", elements.lirongConsignmentFileName, false, "lirongConsignmentWorkbook");
  bindFileInput(elements.salesFiles, "salesFiles", elements.salesFilesName, true);
  bindFileInput(elements.modelFile, "modelFile", elements.modelFileName);
  bindFileInput(elements.marketingFile, "marketingFile", elements.marketingFileName);
  elements.reviewFile.addEventListener("change", () => {
    state.reviewFile = elements.reviewFile.files[0] || null; state.firstReview = null; state.secondReviewFile = null; state.review = null; state.approved = false;
    elements.reviewButton.disabled = !state.reviewFile; elements.secondReviewFile.disabled = true; elements.confirmReview.disabled = true;
    elements.submitApproval.disabled = true; elements.approve.disabled = true; elements.retryNotification.disabled = true; elements.erp.disabled = true;
    elements.erpReference.value = ""; elements.erpReference.disabled = true; elements.erpCreated.disabled = true; state.erpDownloaded = false;
    setWorkflowStatus(state.reviewFile ? `已選擇${state.reviewFile.name}；請開始二次覆核。` : "尚未選擇人工回匯檔。");
  });
  elements.secondReviewFile.addEventListener("change", () => {
    state.secondReviewFile = elements.secondReviewFile.files[0] || null; state.review = null;
    elements.confirmReview.disabled = !state.secondReviewFile; elements.submitApproval.disabled = true;
    setWorkflowStatus(state.secondReviewFile ? `已選擇確認版${state.secondReviewFile.name}；請執行最終檢查。` : "請回匯已填寫二次確認量的覆核報表。");
  });
  [elements.orderDate, elements.inventoryDate, elements.pendingDate, elements.consignmentDate, elements.salesDate].forEach((element) => element.addEventListener("change", updateReadyState));
  elements.month.addEventListener("change", () => { updateReadyState(); Promise.all([loadLedger(), loadMonthPlan()]); });
  [elements.forecastRevenue, elements.forecastCost, elements.targetEndingCost, elements.openingCost, elements.supplierReturns].forEach((element) => element.addEventListener("input", markBudgetDirty));
  elements.budgetSourceNote.addEventListener("input", () => { elements.budgetPlanStatus.textContent = "額度來源註記尚未儲存。"; });
  elements.purchasedToDate.addEventListener("input", renderBudget); elements.saveBudget.addEventListener("click", saveMonthPlan);
  elements.blacklist.addEventListener("input", () => updateBlacklistStatus(false)); elements.saveBlacklist.addEventListener("click", saveBlacklist);
  elements.googleConnect.addEventListener("click", connectGoogle); elements.autoSource.addEventListener("click", loadAutomaticSources);
  elements.analyze.addEventListener("click", analyze); elements.download.addEventListener("click", downloadRecommendation);
  elements.reviewButton.addEventListener("click", reviewReturn); elements.confirmReview.addEventListener("click", confirmSecondReview);
  elements.submitApproval.addEventListener("click", submitForApproval); elements.approve.addEventListener("click", approveBatch);
  elements.retryNotification.addEventListener("click", retryNotification); elements.erp.addEventListener("click", downloadErp);
  elements.erpReference.addEventListener("input", () => { elements.erpCreated.disabled = !(state.erpDownloaded && elements.erpReference.value.trim()); });
  elements.erpCreated.addEventListener("click", confirmErpCreated);
  setInitialDates(); loadBlacklist(); renderBudget(); updateReadyState(); loadConfig();
})();

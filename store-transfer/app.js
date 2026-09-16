(function () {
  "use strict";
  const state = { config: null, calculation: null, activeBatch: null, calculationStore: "all", batchStore: "all", files: { master: null, marketing: null }, googleReady: false };
  const $ = (id) => document.getElementById(id);
  const inputXlsx = globalThis.XLSX;
  const outputXlsx = globalThis.ProcurementXlsxWriter || inputXlsx;
  const parser = globalThis.ProcurementPlanningCore;
  const transferCore = globalThis.StoreTransferCore;
  const googleSources = globalThis.ProcurementGoogleSources;
  const xlsxPreflight = globalThis.StoreTransferXlsxPreflight;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  async function api(path, options = {}) {
    const init = { method: options.method || "GET", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) }, cache: "no-store" };
    if (options.body) init.body = JSON.stringify(options.body);
    const response = await fetch(`/api/store-transfer${path}`, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `處理失敗（HTTP ${response.status}）`);
    return payload;
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
  function renderStores() { $("store-options").innerHTML = Object.entries(state.config.stores).map(([code, store]) => `<label><input type="checkbox" value="${code}" checked><span>${code} ${escapeHtml(store.name)}</span></label>`).join(""); }

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
    root.querySelectorAll("[data-store-row]").forEach((row) => { row.hidden = storeCode !== "all" && row.dataset.store !== storeCode; });
    root.querySelectorAll("[data-store-section]").forEach((section) => {
      const rows = [...section.querySelectorAll("[data-store-row]")];
      section.hidden = rows.length > 0 && !rows.some((row) => !row.hidden);
    });
    if (scope === "batch") {
      root.querySelectorAll("[data-store-status]").forEach((card) => card.classList.toggle("is-selected", storeCode !== "all" && card.dataset.storeStatus === storeCode));
      const manualStore = root.querySelector("[data-manual-store]");
      if (manualStore && storeCode !== "all") manualStore.value = storeCode;
    }
  }

  function batchCard(batch) {
    const status = batchStatusLabel(batch.status);
    const ownStatus = { pending: "尚未處理", saved: "已暫存", submitted: "已送出", approved: "已核准", closed: "已完成" }[batch.store_status] || batch.store_status;
    const progress = batch.status === "cancelled" ? "新版批次已建立，本批不再接受修改或送出" : batch.store_total == null ? (ownStatus ? `本店：${ownStatus}` : "") : `門市已送出 ${Number(batch.store_submitted || 0) + Number(batch.store_approved || 0)}/${batch.store_total}・ERP ${batch.store_erp_created || 0}/${batch.store_total}`;
    const deleteButton = batch.status === "cancelled" && state.config.permissions?.canDeleteBatch
      ? `<button class="secondary-button compact delete-batch-button" type="button" data-delete-batch="${escapeHtml(batch.id)}" data-week-key="${escapeHtml(batch.week_key)}" data-item-count="${escapeHtml(batch.item_count || 0)}">刪除批次</button>` : "";
    const shortage = Number(batch.shortage_count || 0) ? `・缺貨未配${escapeHtml(batch.shortage_count)}項／${escapeHtml(batch.unfilled_quantity || 0)}件` : "";
    return `<article class="batch-card${batch.status === "cancelled" ? " superseded" : ""}"><div><h3>${escapeHtml(batch.week_key || batch.id)}</h3><p class="batch-meta">${escapeHtml(batch.item_count || 0)}項・系統建議${escapeHtml(batch.suggested_quantity || 0)}件${shortage}・${escapeHtml(progress)}・更新於${escapeHtml(batch.updated_at || "")}</p></div><span class="batch-status">${escapeHtml(status)}</span><div class="batch-card-actions"><button class="secondary-button compact" type="button" data-open-batch="${escapeHtml(batch.id)}">${batch.status === "cancelled" ? "查看紀錄" : "查看／處理"}</button>${deleteButton}</div></article>`;
  }

  async function deleteBatchFromHistory(button) {
    const id = button.dataset.deleteBatch;
    const week = button.dataset.weekKey || id;
    const itemCount = button.dataset.itemCount || 0;
    if (!confirm(`確定要刪除 ${week} 的這筆已取代批次嗎？\n\n批次編號：${id}\n品項數：${itemCount}\n\n刪除後前台不再顯示，但稽核資料會保留12個月。`)) return;
    button.disabled = true;
    try {
      await api(`/batches/${encodeURIComponent(id)}`, { method: "DELETE" });
      $("hq-status").textContent = `已刪除${week}的舊批次；稽核資料仍保留12個月。`;
      await loadBatches();
    } finally { button.disabled = false; }
  }

  async function loadBatches() {
    const query = state.config.storeCode ? `?store=${encodeURIComponent(state.config.storeCode)}` : "";
    const payload = await api(`/batches${query}`);
    const html = payload.batches.length ? payload.batches.map(batchCard).join("") : '<p class="empty-state">目前沒有週調撥批次。</p>';
    $("batch-list").innerHTML = html;
    if (state.config.role === "store") $("store-batches").innerHTML = html;
  }

  function applyScheduleForWeek(weekKey) {
    const match = String(weekKey || "").match(/^(\d{4})-W(\d{2})$/); if (!match) return;
    const jan4 = new Date(Number(match[1]), 0, 4, 12), jan4Offset = (jan4.getDay() + 6) % 7;
    const monday = new Date(jan4); monday.setDate(jan4.getDate() - jan4Offset + (Number(match[2]) - 1) * 7);
    const friday = new Date(monday); friday.setDate(monday.getDate() + 4);
    const nextMonday = new Date(monday); nextMonday.setDate(monday.getDate() + 7);
    const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const holidays = state.config.storeInventoryRules?.config?.workdayHolidays || [];
    const proposal = transferCore.previousWorkingDay(iso(friday), holidays);
    const lock = transferCore.nextWorkingDay(iso(nextMonday), holidays);
    $("proposal-date").value = proposal; $("lock-at").value = `${lock}T09:00`;
  }

  function defaults() {
    const today = new Date(), offset = (today.getDay() + 6) % 7;
    const monday = new Date(today); monday.setDate(today.getDate() - offset);
    const friday = new Date(monday); friday.setDate(monday.getDate() + 4);
    const start = new Date(friday.getFullYear(), 0, 1), days = Math.floor((friday - start) / 86400000);
    $("week-key").value = `${friday.getFullYear()}-W${String(Math.ceil((days + start.getDay() + 1) / 7)).padStart(2, "0")}`;
    applyScheduleForWeek($("week-key").value);
  }

  function rowProjection(item, quantity) {
    if (item.item_type === "activity_gift") return item.system_projection || "依活動期間判斷";
    if (item.item_type === "consumable") {
      const weekly = Number(item.daily_usage || 0) * 7;
      return weekly > 0 ? `約${((Number(item.base_quantity || 0) + Number(quantity || 0)) / weekly).toFixed(1)}週` : "耗用資料不足";
    }
    if (!item.calculation_date) return item.system_projection || "舊批次未保存推估基準";
    return transferCore.projectedSellThroughDate(item.calculation_date, item.base_quantity, quantity, item.daily_usage);
  }

  function previewRow(row, kind) {
    const start = `<tr data-store-row data-store="${escapeHtml(row.storeCode)}"><td>${row.storeCode}</td>`;
    if (kind === "special") return `${start}<td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.productName)}</td><td>${row.localSales42}</td><td>${row.currentInventory}</td><td>${row.suggestedQuantity}</td><td>${escapeHtml(row.systemSellThroughDate)}</td><td>${escapeHtml(row.ruleSummary)}</td></tr>`;
    if (kind === "consumable") return `${start}<td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.productName)}</td><td>${row.currentInventory}</td><td>${row.averageWeeklyUsage.toFixed(1)}</td><td>${row.suggestedQuantity / 100}箱／${row.suggestedQuantity}個</td><td>${escapeHtml(row.systemSellThroughDate)}</td><td><details><summary>查看判斷</summary>${escapeHtml(row.ruleSummary)}</details></td></tr>`;
    if (kind === "shortage") return `${start}<td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.productName)}</td><td>${row.demandQuantity}</td><td>${row.allocatedQuantity}</td><td>${row.unfilledQuantity}</td><td>${escapeHtml(row.reason)}</td><td>${escapeHtml(row.followUpStatus || "待回拋主採購")}</td></tr>`;
    return `${start}<td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.productName)}</td><td>${row.localSales42}</td><td>${row.b3Sales42}</td><td>${row.currentInventory}</td><td>${Number(row.targetQuantity).toFixed(1)}／${row.displayQuantity}</td><td>${row.suggestedQuantity}</td><td>${escapeHtml(row.currentArrivalDate)}</td><td>${escapeHtml(row.nextArrivalDate)}</td><td>${escapeHtml(row.systemSellThroughDate)}</td><td>${row.preArrivalStockoutRisk ? "有缺貨空窗，需加急" : "可支撐至本批到店"}</td><td>${escapeHtml(row.ruleSummary)}</td></tr>`;
  }

  async function calculate() {
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
      const historyPayload = await api("/consumable-snapshots");
      const latestSalesDate = sales.reduce((max, report) => report.maxDate > max ? report.maxDate : max, "") || $("proposal-date").value;
      $("hq-status").textContent = "資料讀取完成，正在計算各門市建議量…";
      state.calculation = transferCore.buildSuggestions({
        storeCodes: stores,
        master,
        inventory,
        transfer,
        sales,
        marketing: transferCore.parseMarketingWorkbook(marketingBook, inputXlsx, latestSalesDate),
        consumableHistory: historyPayload.snapshots || [],
        proposalDate: $("proposal-date").value,
        storeInventory: state.config.storeInventoryRules?.config || {}
      });
      state.calculationStore = "all";
      $("calculation-store-filter").innerHTML = storeFilterBar("calculation", stores, state.calculationStore);
      await api("/consumable-snapshots", { method: "POST", body: { snapshots: state.calculation.consumableSnapshots } });
      const ignoredTransferText = transfer.ignoredRows?.length ? `；另略過${transfer.ignoredRows.length}筆與總倉及既有門市皆無關的調撥` : "";
      $("calculation-summary").textContent = `銷售截止${state.calculation.latestSalesDate}；必要補貨${state.calculation.totals.regularItemCount}項、建議備貨${state.calculation.totals.specialStockItemCount}項、活動／贈品${state.calculation.totals.activityItemCount}項、耗材${state.calculation.totals.consumableItemCount}項、缺貨未配${state.calculation.totals.shortageItemCount}項；B3成功配對${state.calculation.b3Audit.matchedCount}筆、待人工確認${state.calculation.b3Audit.pendingCount}筆${ignoredTransferText}；提袋快照已記錄。`;
      $("b3-audit").hidden = !state.calculation.b3Audit.pendingCount;
      $("b3-audit").innerHTML = state.calculation.b3Audit.pendingCount ? `<strong>B3待人工確認：</strong>${state.calculation.b3Audit.pendingRows.slice(0, 20).map((row) => `${escapeHtml(row.storeCode)}／${escapeHtml(row.sku)}／來源單${escapeHtml(row.sourceOrder || "未填")}`).join("、")}${state.calculation.b3Audit.pendingCount > 20 ? "…" : ""}。這些資料未納入B3與門市能力。` : "";
      $("calculation-rows").innerHTML = state.calculation.regularRows.length ? state.calculation.regularRows.map((row) => previewRow(row, "regular")).join("") : '<tr><td colspan="13">本週沒有一般必要補貨。</td></tr>';
      $("special-stock-results").hidden = !state.calculation.specialStockRows.length;
      $("special-stock-rows").innerHTML = state.calculation.specialStockRows.map((row) => previewRow(row, "special")).join("");
      $("activity-results").hidden = !state.calculation.activityRows.length && !state.calculation.marketingWarnings.length;
      $("activity-rows").innerHTML = state.calculation.activityRows.length ? state.calculation.activityRows.map((row) => `<tr data-store-row data-store="${escapeHtml(row.storeCode)}"><td>${row.storeCode}</td><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.productName)}</td><td>${escapeHtml(row.thresholdText)}<br><small>${escapeHtml(row.activityPeriod)}</small></td><td>${row.averageTicket == null ? "待確認" : `${Math.round(row.averageTicket).toLocaleString("zh-TW")}元`}</td><td>${row.eligibleRate == null ? "待確認" : `${(row.eligibleRate * 100).toFixed(1)}%`}</td><td>${row.forecastOrders == null ? "待確認" : `${row.forecastOrders}筆／${row.forecastGiftQuantity}件`}</td><td>${row.localSales42}</td><td>${row.currentInventory}</td><td>${row.suggestedQuantity}</td><td>${escapeHtml(row.ruleSummary)}</td></tr>`).join("") : '<tr><td colspan="11">目前沒有可直接配對贈品貨號的活動。</td></tr>';
      $("marketing-warnings").textContent = state.calculation.marketingWarnings.join(" ");
      $("consumable-results").hidden = !state.calculation.consumableRows.length;
      $("consumable-rows").innerHTML = state.calculation.consumableRows.map((row) => previewRow(row, "consumable")).join("");
      $("shortage-results").hidden = !state.calculation.shortageRows.length;
      $("shortage-rows").innerHTML = state.calculation.shortageRows.map((row) => previewRow(row, "shortage")).join("");
      $("publish-button").disabled = !state.calculation.rows.length && !state.calculation.shortageRows.length;
      $("calculation-results").hidden = false;
      applyStoreFilter("calculation", state.calculationStore);
      const ignoredNotice = transfer.ignoredRows?.length ? ` 已略過${transfer.ignoredRows.length}筆兩端皆不屬於總倉或既有門市的資料。` : "";
      $("hq-status").textContent = (state.calculation.rows.length ? "計算完成，請先檢查四類結果，再建立門市確認批次。" : "本週沒有可建立批次的調撥項目；缺貨與提袋快照仍已完成記錄。") + ignoredNotice;
    } finally { $("calculate-button").disabled = false; }
  }

  async function publish() {
    if (!state.calculation) return;
    const weekKey = $("week-key").value, proposalDate = $("proposal-date").value, localLock = $("lock-at").value;
    if (!weekKey || !proposalDate || !localLock) throw new Error("請填妥週次、建議產生日與鎖定時間。");
    $("publish-button").disabled = true;
    try {
      const id = `TR-${weekKey}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await api("/batches", { method: "POST", body: { id, weekKey, proposalDate, responseDueAt: new Date(localLock).toISOString(), lockAt: new Date(localLock).toISOString(), items: state.calculation.rows, shortages: state.calculation.shortageRows, arrivalSchedule: state.calculation.scheduleByStore } });
      $("hq-status").textContent = `已建立批次${id}；同週舊的未完成批次已改為僅供查閱，門市重新登入即可看到新版確認清單。`;
      $("calculation-results").hidden = true; state.calculation = null; await loadBatches();
    } finally { $("publish-button").disabled = false; }
  }

  function itemTable(payload) {
    const ownStatus = payload.storeStatuses.find((row) => row.store_code === state.config.storeCode)?.status;
    const editable = state.config.role === "store" && ["open", "review"].includes(payload.batch.status) && ownStatus !== "submitted" && Date.now() < Date.parse(payload.batch.lock_at);
    const hqEditable = state.config.role !== "store" && ["open", "review"].includes(payload.batch.status);
    const canChangeItems = editable || hqEditable;
    const table = (items, title, note = "") => items.length ? `<section class="result-section" data-store-section><h3>${title}</h3>${note ? `<p>${note}</p>` : ""}<div class="result-table-wrap"><table class="transfer-table"><thead><tr><th>門市</th><th>ERP品號</th><th>品名</th><th>建議量</th><th>建議後</th><th>門市確認量</th><th>確認後</th><th>門市調整原因</th>${state.config.role !== "store" ? "<th>總部核准量</th><th>核准後</th><th>總部調整原因</th>" : ""}${canChangeItems ? "<th>品項操作</th>" : ""}</tr></thead><tbody>${items.map((item) => {
      const step = item.item_type === "consumable" ? 100 : 1;
      const confirmed = item.store_confirmed_quantity ?? item.suggested_quantity;
      const approved = item.hq_approved_quantity ?? confirmed;
      const manual = Number(item.suggested_quantity) === 0 && /人工新增/.test(String(item.rule_summary || ""));
      return `<tr data-store-row data-store="${item.store_code}" data-sku="${escapeHtml(item.sku)}" data-product-name="${escapeHtml(item.product_name)}" data-item-type="${item.item_type || "regular"}" data-calculation-date="${escapeHtml(item.calculation_date)}" data-base="${Number(item.base_quantity || 0)}" data-daily="${Number(item.daily_usage || 0)}" data-system-projection="${escapeHtml(item.system_projection || "")}" data-manual="${manual ? "true" : "false"}"><td>${item.store_code}</td><td>${escapeHtml(item.sku)}${manual ? '<span class="manual-item-badge">人工新增</span>' : ""}</td><td>${escapeHtml(item.product_name)}</td><td>${item.suggested_quantity}</td><td>${escapeHtml(item.system_projection || rowProjection(item, item.suggested_quantity))}</td><td><input data-confirmed type="number" min="0" step="${step}" value="${confirmed}" ${editable ? "" : "disabled"}></td><td data-confirmed-projection>${escapeHtml(rowProjection(item, confirmed))}</td><td><input data-reason class="reason-input" value="${escapeHtml(item.store_reason || "")}" ${editable ? "" : "disabled"}></td>${state.config.role !== "store" ? `<td><input data-approved type="number" min="0" step="${step}" value="${approved}" ${hqEditable ? "" : "disabled"}></td><td data-approved-projection>${escapeHtml(rowProjection(item, approved))}</td><td><input data-hq-reason class="reason-input" value="${escapeHtml(item.hq_reason || "")}" ${hqEditable ? "" : "disabled"}></td>` : ""}${canChangeItems ? `<td><button class="secondary-button compact remove-item-button" type="button" data-remove-item data-mode="${state.config.role === "store" ? "store" : "hq"}">移除此品項</button></td>` : ""}</tr>`;
    }).join("")}</tbody></table></div></section>` : "";
    const storeOptions = payload.storeStatuses.map((row) => `<option value="${row.store_code}">${row.store_code} ${escapeHtml(state.config.stores[row.store_code]?.name || "")}</option>`).join("");
    const manualForm = canChangeItems ? `<section class="result-section manual-item-section"><h3>人工新增品項</h3><p>總部與門市皆可新增；ERP品號、品名、數量與原因必填。移除既有品項時會把本階段數量改為0，原列仍保留供稽核。</p><div class="manual-item-form">${state.config.role !== "store" ? `<label><span>門市</span><select data-manual-store>${storeOptions}</select></label>` : ""}<label><span>品項類型</span><select data-manual-type><option value="regular">一般必要補貨</option><option value="special_stock">建議調撥</option><option value="activity_gift">活動／贈品</option><option value="consumable">提袋耗材</option></select></label><label><span>ERP品號</span><input data-manual-sku maxlength="80" autocomplete="off"></label><label><span>品名</span><input data-manual-name maxlength="300" autocomplete="off"></label><label><span>${state.config.role === "store" ? "門市確認量" : "總部核准量"}</span><input data-manual-quantity type="number" min="1" step="1"></label><label class="manual-reason-field"><span>新增原因</span><input data-manual-reason maxlength="300" autocomplete="off"></label><button class="secondary-button" type="button" data-local-action="add-item">加入確認清單</button></div><p class="status-line" data-manual-status></p><div class="result-table-wrap"><table class="transfer-table manual-item-table"><thead><tr><th>門市</th><th>ERP品號</th><th>品名</th><th>類型</th><th>系統建議</th><th>${state.config.role === "store" ? "門市確認量" : "總部核准量"}</th><th>原因</th><th>操作</th></tr></thead><tbody data-manual-rows></tbody></table></div></section>` : "";
    const shortages = payload.shortages || [];
    const shortageTable = shortages.length ? `<section class="result-section shortage-section" data-store-section><h3>缺貨未配與後續補貨狀態</h3><p>這些數量不會加入門市確認量或ERP檔；用來說明總倉為何未能配足，並保留後續回拋主採購的狀態。</p><div class="result-table-wrap"><table class="transfer-table compact-table"><thead><tr><th>門市</th><th>ERP品號</th><th>品名</th><th>需求量</th><th>已配量</th><th>未配不足量</th><th>原因</th><th>後續狀態</th></tr></thead><tbody>${shortages.map((row) => `<tr data-store-row data-store="${escapeHtml(row.store_code)}"><td>${escapeHtml(row.store_code)}</td><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.product_name)}</td><td>${row.demand_quantity}</td><td>${row.allocated_quantity}</td><td>${row.unfilled_quantity}</td><td>${escapeHtml(row.reason)}</td><td>${escapeHtml(row.follow_up_status)}</td></tr>`).join("")}</tbody></table></div></section>` : "";
    return [
      table(payload.items.filter((item) => item.item_type === "regular"), "一般週補貨（必要調撥）"),
      table(payload.items.filter((item) => item.item_type === "special_stock"), "建議調撥（非必要）", "單人被套各材質前2名花色；可依現場判斷填0。"),
      table(payload.items.filter((item) => item.item_type === "activity_gift"), "活動／贈品調撥"),
      table(payload.items.filter((item) => item.item_type === "consumable"), "門市耗材補貨", "提袋請以100個為單位調整。"),
      shortageTable,
      manualForm
    ].join("");
  }

  function addManualItem() {
    const detail = $("batch-detail"), status = detail.querySelector("[data-manual-status]");
    const storeCode = state.config.role === "store" ? state.config.storeCode : detail.querySelector("[data-manual-store]").value;
    const type = detail.querySelector("[data-manual-type]").value;
    const skuInput = detail.querySelector("[data-manual-sku]"), nameInput = detail.querySelector("[data-manual-name]");
    const quantityInput = detail.querySelector("[data-manual-quantity]"), reasonInput = detail.querySelector("[data-manual-reason]");
    const sku = skuInput.value.normalize("NFKC").trim().toUpperCase(), productName = nameInput.value.normalize("NFKC").trim();
    const quantity = Number(quantityInput.value), reason = reasonInput.value.normalize("NFKC").trim();
    if (!sku || !productName || !Number.isSafeInteger(quantity) || quantity <= 0 || !reason) { status.textContent = "請填妥ERP品號、品名、1以上整數數量與新增原因。"; return; }
    if (type === "consumable" && quantity % 100 !== 0) { status.textContent = "提袋耗材數量須為100的倍數。"; return; }
    const duplicate = [...detail.querySelectorAll("tbody tr")].some((row) => row.dataset.store === storeCode && row.dataset.sku === sku && row.dataset.itemType === type);
    if (duplicate) { status.textContent = `${storeCode}／${sku}已在清單中，請直接修改該列數量。`; return; }
    const labels = { regular: "一般必要補貨", special_stock: "建議調撥", activity_gift: "活動／贈品", consumable: "提袋耗材" };
    const row = document.createElement("tr");
    row.dataset.storeRow = ""; row.dataset.store = storeCode; row.dataset.sku = sku; row.dataset.productName = productName; row.dataset.itemType = type; row.dataset.calculationDate = state.activeBatch.batch.proposal_date; row.dataset.base = "0"; row.dataset.daily = "0"; row.dataset.systemProjection = "人工新增，無歷史推估"; row.dataset.manual = "true";
    row.innerHTML = `<td>${storeCode}</td><td>${escapeHtml(sku)}<span class="manual-item-badge">尚未儲存</span></td><td>${escapeHtml(productName)}</td><td>${labels[type]}</td><td>0</td><td>${state.config.role === "store" ? `<input data-confirmed type="number" min="1" step="${type === "consumable" ? 100 : 1}" value="${quantity}">` : `<input data-confirmed type="number" value="0" disabled><input data-approved type="number" min="1" step="${type === "consumable" ? 100 : 1}" value="${quantity}">`}</td><td>${state.config.role === "store" ? `<input data-reason class="reason-input" value="${escapeHtml(reason)}">` : `<input data-reason type="hidden" value=""><input data-hq-reason class="reason-input" value="${escapeHtml(reason)}">`}</td><td><button class="secondary-button compact remove-item-button" type="button" data-remove-unsaved>取消新增</button></td>`;
    detail.querySelector("[data-manual-rows]").append(row);
    skuInput.value = ""; nameInput.value = ""; quantityInput.value = ""; reasonInput.value = "";
    status.textContent = `${storeCode}／${sku}已加入畫面；按暫存、送出或核准後才會正式保存。`;
  }

  function removeDialogItem(button) {
    const row = button.closest("tr"), mode = button.dataset.mode;
    const quantityInput = row.querySelector(mode === "hq" ? "[data-approved]" : "[data-confirmed]");
    const reasonInput = row.querySelector(mode === "hq" ? "[data-hq-reason]" : "[data-reason]");
    quantityInput.value = "0";
    reasonInput.placeholder = "請填寫移除原因";
    row.classList.add("item-marked-removed");
    updateDialogProjection({ target: quantityInput });
    if (!reasonInput.value.trim()) reasonInput.focus();
  }

  function updateDialogProjection(event) {
    const input = event.target.closest("[data-confirmed], [data-approved]");
    if (!input) return;
    const row = input.closest("tr");
    const item = { item_type: row.dataset.itemType, calculation_date: row.dataset.calculationDate, base_quantity: Number(row.dataset.base), daily_usage: Number(row.dataset.daily), system_projection: row.dataset.systemProjection };
    const target = input.matches("[data-approved]") ? row.querySelector("[data-approved-projection]") : row.querySelector("[data-confirmed-projection]");
    if (target) target.textContent = rowProjection(item, Number(input.value || 0));
  }

  function detailActions(payload) {
    const ownStatus = payload.storeStatuses.find((row) => row.store_code === state.config.storeCode)?.status;
    if (state.config.role === "store" && ["open", "review"].includes(payload.batch.status) && ownStatus === "submitted" && Date.now() < Date.parse(payload.batch.lock_at)) return '<button class="secondary-button" type="button" data-action="withdraw">撤回修改</button>';
    if (state.config.role === "store" && ["open", "review"].includes(payload.batch.status) && Date.now() < Date.parse(payload.batch.lock_at)) return '<button class="secondary-button" type="button" data-action="save">暫存</button><button class="primary-button" type="button" data-action="submit">送出總部覆核</button>';
    if (state.config.role !== "store" && ["open", "review"].includes(payload.batch.status)) return '<button class="primary-button" type="button" data-action="approve">核准本週調撥</button>';
    if (state.config.role !== "store" && ["approved", "erp_created"].includes(payload.batch.status)) return `${[...new Set(payload.items.map((item) => item.store_code))].map((store) => { const done = payload.storeStatuses.find((row) => row.store_code === store)?.erp_created_at; return `<button class="secondary-button" type="button" data-action="erp" data-store="${store}">${done ? "重新下載" : "下載"}${store} ERP檔</button>`; }).join("")}${payload.batch.status === "erp_created" ? '<button class="primary-button" type="button" data-action="close">標記本週批次完成</button>' : ""}`;
    return "";
  }

  function statusOverview(payload) {
    if (state.config.role === "store") return "";
    const labels = { pending: "尚未處理", saved: "已暫存", submitted: "已送出", approved: "已核准", closed: "已完成" };
    return `<section class="store-status-overview"><h3>門市回覆與ERP狀態</h3><p>可直接點選門市卡片，只查看該店調撥內容。</p><div class="status-grid">${payload.storeStatuses.map((row) => `<button class="store-status-card" type="button" data-store-status="${row.store_code}" data-store-filter="${row.store_code}" data-store-filter-scope="batch"><strong>${row.store_code} ${escapeHtml(state.config.stores[row.store_code]?.name || "")}</strong><span>${escapeHtml(labels[row.status] || row.status)}</span><small>${row.erp_created_at ? `ERP已產生・${escapeHtml(row.erp_created_at)}` : "ERP尚未產生"}</small></button>`).join("")}</div></section>`;
  }

  async function openBatch(id) {
    const query = state.config.storeCode ? `?store=${state.config.storeCode}` : "";
    state.activeBatch = await api(`/batches/${encodeURIComponent(id)}${query}`);
    const p = state.activeBatch;
    state.batchStore = state.config.role === "store" ? state.config.storeCode : "all";
    const storeCodes = p.storeStatuses.map((row) => row.store_code);
    const supersededNotice = p.batch.status === "cancelled" ? '<p class="result-alert warn"><strong>本批次已被新版取代。</strong>資料仍完整保留供查閱，但門市與總部都不能再修改、送出或核准。</p>' : "";
    const schedule = (() => { try { return JSON.parse(p.batch.arrival_schedule || "{}"); } catch { return {}; } })();
    const scheduleText = Object.values(schedule).map((row) => `${row.storeCode} 本批${row.currentArrivalDate}／下一輪${row.nextArrivalDate}`).join("；");
    $("batch-detail").innerHTML = `<p class="eyebrow">${escapeHtml(p.batch.week_key)}</p><h2>${escapeHtml(p.batch.id)}</h2><p>門市回覆鎖定：${escapeHtml(p.batch.lock_at)}・批次狀態：${escapeHtml(batchStatusLabel(p.batch.status))}</p>${scheduleText ? `<p class="status-line">到店日快照：${escapeHtml(scheduleText)}</p>` : ""}${supersededNotice}${storeFilterBar("batch", storeCodes, state.batchStore)}${statusOverview(p)}${itemTable(p)}<div class="detail-actions">${detailActions(p)}</div><p id="dialog-status" class="status-line"></p>`;
    $("batch-dialog").showModal();
    applyStoreFilter("batch", state.batchStore);
  }

  function rowsFromDialog(mode) {
    return [...$("batch-detail").querySelectorAll("tbody tr[data-item-type]")].map((row) => ({ storeCode: row.dataset.store, sku: row.dataset.sku, productName: row.dataset.productName, itemType: row.dataset.itemType, ...(mode === "approve" ? { approvedQuantity: Number(row.querySelector("[data-approved]").value), reason: row.querySelector("[data-hq-reason]").value } : { confirmedQuantity: Number(row.querySelector("[data-confirmed]").value), reason: row.querySelector("[data-reason]").value }) }));
  }

  async function handleDialog(event) {
    const filterButton = event.target.closest('[data-store-filter-scope="batch"]');
    if (filterButton) { applyStoreFilter("batch", filterButton.dataset.storeFilter); return; }
    const localAction = event.target.closest("[data-local-action]");
    if (localAction?.dataset.localAction === "add-item") { addManualItem(); return; }
    const unsavedRemove = event.target.closest("[data-remove-unsaved]");
    if (unsavedRemove) { unsavedRemove.closest("tr").remove(); return; }
    const removeItem = event.target.closest("[data-remove-item]");
    if (removeItem) { removeDialogItem(removeItem); return; }
    const button = event.target.closest("[data-action]"); if (!button) return;
    const action = button.dataset.action, batch = state.activeBatch; button.disabled = true;
    try {
      if (action === "save" || action === "submit") await api(`/batches/${encodeURIComponent(batch.batch.id)}/stores/${state.config.storeCode}/${action}`, { method: "PUT", body: { items: rowsFromDialog(action) } });
      else if (action === "withdraw") await api(`/batches/${encodeURIComponent(batch.batch.id)}/stores/${state.config.storeCode}/withdraw`, { method: "POST", body: {} });
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
      }
      $("batch-dialog").close(); await loadBatches();
    } catch (error) { $("dialog-status").textContent = error.message; } finally { button.disabled = false; }
  }

  async function start() {
    try {
      if (!inputXlsx || !outputXlsx || !parser || !transferCore || !googleSources || !xlsxPreflight) throw new Error("工具元件載入失敗，請重新整理頁面。");
      state.config = await api("/config");
      $("account-badge").textContent = `${state.config.email}・${state.config.role === "store" ? state.config.storeCode : state.config.role === "admin" ? "最高權限" : "總部"}`;
      $("refresh-button").disabled = false;
      if (state.config.role === "store") { $("store-panel").hidden = false; const store = state.config.stores[state.config.storeCode]; $("store-identity").textContent = `${state.config.storeCode} ${store.name}；只會顯示本店資料。`; }
      else {
        $("hq-panel").hidden = false; renderStores(); defaults();
        if (state.config.permissions?.canManageRules) $("rules-link").hidden = false;
        if (!state.config.googleOAuthClientId) { $("google-connect-button").disabled = true; $("source-status").textContent = "正式環境尚未設定 Google OAuth，用手動備援仍可操作。"; }
      }
      await loadBatches();
    } catch (error) { $("account-badge").textContent = "公司帳號驗證失敗"; $("batch-list").innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`; }
  }

  document.querySelectorAll('input[type="file"]').forEach((input) => input.addEventListener("change", updateFile));
  $("refresh-button").addEventListener("click", () => loadBatches().catch((error) => { $("batch-list").innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`; }));
  $("calculate-button").addEventListener("click", () => calculate().catch((error) => { $("hq-status").textContent = error.message; $("calculate-button").disabled = false; }));
  $("publish-button").addEventListener("click", () => publish().catch((error) => { $("hq-status").textContent = error.message; }));
  $("google-connect-button").addEventListener("click", () => authorizeGoogle().catch((error) => { $("source-status").textContent = error.message; }));
  $("auto-source-button").addEventListener("click", () => loadGoogleSources().catch((error) => { $("source-status").textContent = `自動取得失敗：${error.message}；可改用手動備援。`; }));
  $("week-key").addEventListener("change", () => applyScheduleForWeek($("week-key").value));
  document.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-batch]");
    if (deleteButton) {
      deleteBatchFromHistory(deleteButton).catch((error) => { $("batch-list").insertAdjacentHTML("afterbegin", `<p class="empty-state">${escapeHtml(error.message)}</p>`); });
      return;
    }
    const button = event.target.closest("[data-open-batch]");
    if (button) openBatch(button.dataset.openBatch).catch((error) => { $("batch-list").innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`; });
  });
  $("batch-detail").addEventListener("click", handleDialog);
  $("batch-detail").addEventListener("input", updateDialogProjection);
  $("calculation-results").addEventListener("click", (event) => {
    const filterButton = event.target.closest('[data-store-filter-scope="calculation"]');
    if (filterButton) applyStoreFilter("calculation", filterButton.dataset.storeFilter);
  });
  start();
})();

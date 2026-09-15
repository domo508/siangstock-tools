(function () {
  "use strict";
  const state = { config: null, calculation: null, activeBatch: null, files: { master: null, marketing: null }, googleReady: false };
  const $ = (id) => document.getElementById(id);
  const XLSX = globalThis.ProcurementXlsxWriter || globalThis.XLSX;
  const parser = globalThis.ProcurementPlanningCore;
  const transferCore = globalThis.StoreTransferCore;
  const googleSources = globalThis.ProcurementGoogleSources;

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

  async function workbook(file) { return XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, cellStyles: true, nodim: true }); }
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

  function batchCard(batch) {
    const status = { open: "等待門市", review: "總部覆核中", approved: "已核准", erp_created: "已產生ERP", closed: "已完成", cancelled: "已取消" }[batch.status] || batch.status;
    return `<article class="batch-card"><div><h3>${escapeHtml(batch.week_key || batch.id)}</h3><p class="batch-meta">${escapeHtml(batch.item_count || 0)}項・系統建議${escapeHtml(batch.suggested_quantity || 0)}件・更新於${escapeHtml(batch.updated_at || "")}</p></div><span class="batch-status">${escapeHtml(status)}</span><button class="secondary-button compact" type="button" data-open-batch="${escapeHtml(batch.id)}">查看／處理</button></article>`;
  }

  async function loadBatches() {
    const query = state.config.storeCode ? `?store=${encodeURIComponent(state.config.storeCode)}` : "";
    const payload = await api(`/batches${query}`);
    const html = payload.batches.length ? payload.batches.map(batchCard).join("") : '<p class="empty-state">目前沒有週調撥批次。</p>';
    $("batch-list").innerHTML = html;
    if (state.config.role === "store") $("store-batches").innerHTML = html;
  }

  function defaults() {
    const today = new Date(), offset = (today.getDay() + 6) % 7;
    const monday = new Date(today); monday.setDate(today.getDate() - offset);
    const friday = new Date(monday); friday.setDate(monday.getDate() + 4);
    const nextMonday = new Date(monday); nextMonday.setDate(monday.getDate() + 7);
    const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    $("proposal-date").value = iso(friday); $("lock-at").value = `${iso(nextMonday)}T09:00`;
    const start = new Date(friday.getFullYear(), 0, 1), days = Math.floor((friday - start) / 86400000);
    $("week-key").value = `${friday.getFullYear()}-W${String(Math.ceil((days + start.getDay() + 1) / 7)).padStart(2, "0")}`;
  }

  async function calculate() {
    const stores = selectedStores(); if (!stores.length) throw new Error("請至少勾選一間門市。");
    $("calculate-button").disabled = true; $("hq-status").textContent = "正在本機讀取與計算，檔案不會上傳…";
    try {
      const masterFile = state.files.master, marketingFile = state.files.marketing, inventoryFile = $("inventory-file").files[0], transferFile = $("transfer-file").files[0], salesFiles = [...$("sales-files").files];
      const [masterBook, marketingBook, inventoryBook, transferBook, ...salesBooks] = await Promise.all([workbook(masterFile), workbook(marketingFile), workbook(inventoryFile), workbook(transferFile), ...salesFiles.map(workbook)]);
      const sales = salesBooks.map((book, index) => parser.parseSalesWorkbook(book, XLSX, { fileName: salesFiles[index].name }));
      const latestSalesDate = sales.reduce((max, report) => report.maxDate > max ? report.maxDate : max, "") || $("proposal-date").value;
      state.calculation = transferCore.buildSuggestions({
        storeCodes: stores,
        master: parser.parseProductMasterWorkbook(masterBook, XLSX, { fileName: masterFile.name }),
        inventory: parser.parseInventoryWorkbook(inventoryBook, XLSX, { fileName: inventoryFile.name }),
        transfer: parser.parseTransferWorkbook(transferBook, XLSX, { fileName: transferFile.name }),
        sales,
        marketing: transferCore.parseMarketingWorkbook(marketingBook, XLSX, latestSalesDate)
      });
      if (!state.calculation.rows.length) throw new Error("本次沒有可由總倉供應的門市調撥建議。");
      $("calculation-summary").textContent = `銷售截止${state.calculation.latestSalesDate}；一般補貨${state.calculation.totals.regularItemCount}項、活動／贈品${state.calculation.totals.activityItemCount}項，共建議${state.calculation.totals.quantity}件。`;
      $("calculation-rows").innerHTML = state.calculation.regularRows.length ? state.calculation.regularRows.map((row) => `<tr><td>${row.storeCode}</td><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.productName)}</td><td>${row.localSales42}</td><td>${row.b3Sales42}</td><td>${row.currentInventory}</td><td>${Number(row.targetQuantity).toFixed(1)}／${row.displayQuantity}</td><td>${row.suggestedQuantity}</td><td>${escapeHtml(row.ruleSummary)}</td></tr>`).join("") : '<tr><td colspan="9">本週沒有一般補貨建議。</td></tr>';
      $("activity-results").hidden = !state.calculation.activityRows.length && !state.calculation.marketingWarnings.length;
      $("activity-rows").innerHTML = state.calculation.activityRows.length ? state.calculation.activityRows.map((row) => `<tr><td>${row.storeCode}</td><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.productName)}</td><td>${escapeHtml(row.activityPeriod)}</td><td>${row.localSales42}</td><td>${row.currentInventory}</td><td>${row.suggestedQuantity}</td><td>${escapeHtml(row.ruleSummary)}</td></tr>`).join("") : '<tr><td colspan="8">目前沒有可直接配對贈品貨號的活動。</td></tr>';
      $("marketing-warnings").textContent = state.calculation.marketingWarnings.join(" ");
      $("calculation-results").hidden = false; $("hq-status").textContent = "計算完成，請先檢查預覽，再建立門市確認批次。";
    } finally { $("calculate-button").disabled = false; }
  }

  async function publish() {
    if (!state.calculation) return;
    const weekKey = $("week-key").value, proposalDate = $("proposal-date").value, localLock = $("lock-at").value;
    if (!weekKey || !proposalDate || !localLock) throw new Error("請填妥週次、建議產生日與鎖定時間。");
    $("publish-button").disabled = true;
    try {
      const id = `TR-${weekKey}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await api("/batches", { method: "POST", body: { id, weekKey, proposalDate, responseDueAt: new Date(localLock).toISOString(), lockAt: new Date(localLock).toISOString(), items: state.calculation.rows } });
      $("hq-status").textContent = `已建立批次${id}；門市重新登入即可看到自己的確認清單。`;
      $("calculation-results").hidden = true; state.calculation = null; await loadBatches();
    } finally { $("publish-button").disabled = false; }
  }

  function itemTable(payload) {
    const editable = state.config.role === "store" && ["open", "review"].includes(payload.batch.status) && Date.now() < Date.parse(payload.batch.lock_at);
    const hqEditable = state.config.role !== "store" && ["open", "review"].includes(payload.batch.status);
    const table = (items, title) => items.length ? `<section class="result-section"><h3>${title}</h3><div class="result-table-wrap"><table class="transfer-table"><thead><tr><th>門市</th><th>ERP品號</th><th>品名</th><th>建議量</th><th>門市確認量</th><th>調整原因</th>${state.config.role !== "store" ? "<th>總部核准量</th>" : ""}</tr></thead><tbody>${items.map((item) => `<tr data-store="${item.store_code}" data-sku="${escapeHtml(item.sku)}" data-item-type="${item.item_type || "regular"}"><td>${item.store_code}</td><td>${escapeHtml(item.sku)}</td><td>${escapeHtml(item.product_name)}</td><td>${item.suggested_quantity}</td><td><input data-confirmed type="number" min="0" step="1" value="${item.store_confirmed_quantity ?? item.suggested_quantity}" ${editable || hqEditable ? "" : "disabled"}></td><td><input data-reason class="reason-input" value="${escapeHtml(item.store_reason || "")}" ${editable || hqEditable ? "" : "disabled"}></td>${state.config.role !== "store" ? `<td><input data-approved type="number" min="0" step="1" value="${item.hq_approved_quantity ?? item.store_confirmed_quantity ?? item.suggested_quantity}" ${hqEditable ? "" : "disabled"}></td>` : ""}</tr>`).join("")}</tbody></table></div></section>` : "";
    return table(payload.items.filter((item) => item.item_type !== "activity_gift"), "一般週補貨") + table(payload.items.filter((item) => item.item_type === "activity_gift"), "活動／贈品調撥");
  }

  function detailActions(payload) {
    if (state.config.role === "store" && ["open", "review"].includes(payload.batch.status)) return '<button class="secondary-button" type="button" data-action="save">暫存</button><button class="primary-button" type="button" data-action="submit">送出總部覆核</button>';
    if (state.config.role !== "store" && ["open", "review"].includes(payload.batch.status)) return '<button class="primary-button" type="button" data-action="approve">核准本週調撥</button>';
    if (state.config.role !== "store" && payload.batch.status === "approved") return [...new Set(payload.items.map((item) => item.store_code))].map((store) => `<button class="secondary-button" type="button" data-action="erp" data-store="${store}">下載${store} ERP檔</button>`).join("");
    return "";
  }

  async function openBatch(id) {
    const query = state.config.storeCode ? `?store=${state.config.storeCode}` : "";
    state.activeBatch = await api(`/batches/${encodeURIComponent(id)}${query}`);
    const p = state.activeBatch;
    $("batch-detail").innerHTML = `<p class="eyebrow">${escapeHtml(p.batch.week_key)}</p><h2>${escapeHtml(p.batch.id)}</h2><p>門市回覆鎖定：${escapeHtml(p.batch.lock_at)}・狀態：${escapeHtml(p.batch.status)}</p>${itemTable(p)}<div class="detail-actions">${detailActions(p)}</div><p id="dialog-status" class="status-line"></p>`;
    $("batch-dialog").showModal();
  }

  function rowsFromDialog(mode) {
    return [...$("batch-detail").querySelectorAll("tbody tr")].map((row) => ({ storeCode: row.dataset.store, sku: row.dataset.sku, itemType: row.dataset.itemType, ...(mode === "approve" ? { approvedQuantity: Number(row.querySelector("[data-approved]").value) } : { confirmedQuantity: Number(row.querySelector("[data-confirmed]").value), reason: row.querySelector("[data-reason]").value }) }));
  }

  async function handleDialog(event) {
    const button = event.target.closest("[data-action]"); if (!button) return;
    const action = button.dataset.action, batch = state.activeBatch; button.disabled = true;
    try {
      if (action === "save" || action === "submit") await api(`/batches/${encodeURIComponent(batch.batch.id)}/stores/${state.config.storeCode}/${action}`, { method: "PUT", body: { items: rowsFromDialog(action) } });
      else if (action === "approve") {
        try { await api(`/batches/${encodeURIComponent(batch.batch.id)}/approve`, { method: "POST", body: { items: rowsFromDialog("approve") } }); }
        catch (error) { if (!/尚未送出/.test(error.message) || !confirm(`${error.message}\n\n是否以目前資料繼續核准？`)) throw error; await api(`/batches/${encodeURIComponent(batch.batch.id)}/approve`, { method: "POST", body: { items: rowsFromDialog("approve"), confirmPendingStores: true } }); }
      } else if (action === "erp") {
        const store = button.dataset.store, wb = transferCore.buildErpWorkbook(batch.items, XLSX, store);
        XLSX.writeFile(wb, `${batch.batch.week_key}_${store}_ERP調撥單.xlsx`, { compression: true });
        $("dialog-status").textContent = `${store} ERP調撥檔已下載；調出與調入倉請在ERP下拉選單人工指定。`; return;
      }
      $("batch-dialog").close(); await loadBatches();
    } catch (error) { $("dialog-status").textContent = error.message; } finally { button.disabled = false; }
  }

  async function start() {
    try {
      if (!XLSX || !parser || !transferCore || !googleSources) throw new Error("工具元件載入失敗，請重新整理頁面。");
      state.config = await api("/config");
      $("account-badge").textContent = `${state.config.email}・${state.config.role === "store" ? state.config.storeCode : state.config.role === "admin" ? "最高權限" : "總部"}`;
      $("refresh-button").disabled = false;
      if (state.config.role === "store") { $("store-panel").hidden = false; const store = state.config.stores[state.config.storeCode]; $("store-identity").textContent = `${state.config.storeCode} ${store.name}；只會顯示本店資料。`; }
      else {
        $("hq-panel").hidden = false; renderStores(); defaults();
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
  document.addEventListener("click", (event) => { const button = event.target.closest("[data-open-batch]"); if (button) openBatch(button.dataset.openBatch).catch((error) => { $("batch-list").innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`; }); });
  $("batch-detail").addEventListener("click", handleDialog);
  start();
})();

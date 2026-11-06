(function (global) {
  "use strict";
  const key = (item) => JSON.stringify([item.storeCode, item.sku]);
  async function requestJson(url, payload, method = "POST", timeoutMs = 20000) {
    const controller = new AbortController();
    let expired = false;
    let timer;
    try {
      const response = await Promise.race([
        (async () => {
          const response = await fetch(url, { method, signal: controller.signal, cache: "no-store", headers: { "Content-Type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(payload) }) });
          let result;
          try { result = await response.json(); }
          catch (_) { throw Object.assign(new Error(`伺服器未回傳有效結果（HTTP ${response.status}），請確認公司登入與待辦。`), { uncertain: method !== "GET" }); }
          if (!response.ok) throw Object.assign(new Error(result.error || `HTTP ${response.status}`), { status: response.status });
          return result;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { expired = true; controller.abort(); reject(new Error("請求逾時")); }, timeoutMs); })
      ]);
      return response;
    } catch (error) {
      if (expired) throw Object.assign(new Error("連線逾時；伺服器可能已完成，請先重新確認待辦，勿直接重複送出。"), { uncertain: method !== "GET" });
      if (!Number(error.status) && method !== "GET") error.uncertain = true;
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function run({ items, execute, onProgress = () => {}, shouldContinue = () => true, concurrency = 4 }) {
    const unique = [...new Map(items.map(item => [key(item), item])).values()];
    let cursor = 0; let active = 0; let stopped = false;
    const results = [];
    const progress = () => onProgress({ total: unique.length, completed: results.length, active, remaining: unique.length - results.length - active, success: results.filter(r => r.status === "success").length, failed: results.filter(r => r.status === "failed").length, uncertain: results.filter(r => r.status === "uncertain").length });
    async function worker() {
      while (cursor < unique.length && !stopped && shouldContinue()) {
        const item = unique[cursor++]; active++; progress();
        try { await execute(item); results.push({ item, status: "success" }); }
        catch (error) {
          results.push({ item, status: error.uncertain ? "uncertain" : "failed", error: error.message, httpStatus: error.status });
          if ([401, 403].includes(Number(error.status))) stopped = true;
        } finally { active--; progress(); }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(4, Number(concurrency) || 1, unique.length)) }, worker));
    while (cursor < unique.length) results.push({ item: unique[cursor++], status: "not_started", error: "權限或版本已變更，本項尚未送出" });
    progress();
    return results;
  }
  function retryPlan(results, rows, closing) {
    const latest = new Map(rows.map(row => [key({ storeCode: row.store_code, sku: row.sku }), row]));
    const plan = { items: [], alreadyClosed: 0, changed: [], uncertain: [] };
    for (const result of results.filter(r => r.status !== "success")) {
      const row = latest.get(key(result.item));
      if (!row && closing) { plan.alreadyClosed++; continue; }
      if (!row || row.source_batch_id !== result.item.sourceBatchId) { plan.changed.push(result.item); continue; }
      if (result.status === "uncertain") { plan.uncertain.push(result.item); continue; }
      plan.items.push(result.item);
    }
    return plan;
  }
  // Presentation only: retain every original store/SKU row for decisions and API writes.
  function groupProducts(rows = []) {
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.sku)) groups.set(row.sku, { sku: row.sku, name: row.product_name || "", rows: [], stores: [], transferRemaining: 0, purchaseUncovered: 0, covered: 0, unfilled: 0, earliestNeededBy: "" });
      const group = groups.get(row.sku);
      group.rows.push(row);
      if (!group.stores.includes(row.store_code)) group.stores.push(row.store_code);
      const unfilled = Number(row.unfilled_quantity || 0);
      group.unfilled += unfilled;
      group.covered += Number(row.covered_quantity || 0);
      group.transferRemaining += Math.max(0, unfilled - Number(row.fulfilled_quantity || 0));
      group.purchaseUncovered += Math.max(0, unfilled - Number(row.covered_quantity || 0));
      if (row.needed_by && (!group.earliestNeededBy || row.needed_by < group.earliestNeededBy)) group.earliestNeededBy = row.needed_by;
    }
    return [...groups.values()].sort((a, b) => String(a.sku).localeCompare(String(b.sku), "zh-Hant", { numeric: true }));
  }
  // Procurement associations/approval are not proof of an ERP outstanding order.
  // Only physical follow-up allocation reduces the remaining store request here.
  function remainingNeed(row) {
    return Math.max(0, Number(row.unfilled_quantity || 0) - Number(row.fulfilled_quantity || 0));
  }
  function pendingInfo(sku, snapshot) {
    const row = snapshot?.rows?.find(item => item.sku === sku);
    const available = snapshot?.available === true;
    let orders = null;
    try { orders = Array.isArray(row?.order_details) ? row.order_details : JSON.parse(row?.order_details || "null"); } catch (_) { /* Legacy summary has no reliable order details. */ }
    if (!Array.isArray(orders)) orders = null;
    const total = available ? Number(row?.pending_quantity || 0) : null;
    const dates = (orders || []).map(order => order.deliveryDate).filter(Boolean).sort();
    return { total, orders, restricted: Boolean(row?.details_restricted), earliest: dates[0] || row?.expected_delivery_date || "", sourceDate: snapshot?.sourceDate || row?.source_date || "", updatedAt: snapshot?.updatedAt || row?.updated_at || "", available, error: snapshot?.error || "" };
  }
  function renderPendingInfo(sku, snapshot, escapeHtml) {
    const info = pendingInfo(sku, snapshot);
    const number = qty => Number(qty).toLocaleString("zh-TW", { maximumFractionDigits: 3 });
    const total = info.available ? `${number(info.total)}件` : "未交資料未提供";
    const date = info.earliest || (info.total === 0 ? "無未交" : "未提供");
    const updated = info.updatedAt ? new Date(info.updatedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) + "（台北）" : "未提供";
    const knownOrders = info.orders?.some(order => order.documentCode);
    const detail = info.orders?.length ? `<details><summary>查看未交${knownOrders ? "採購單" : "數量與日期"}明細</summary><div class="pending-order-list">${info.orders.map(order => `<div><span>${escapeHtml(order.documentCode || "未提供單號（商品未交量）")}</span><strong>${number(order.quantity)}件</strong><span>預計到貨：${escapeHtml(order.deliveryDate || "未提供")}</span></div>`).join("")}</div></details>` : "";
    return `<section class="shortage-pending-info" aria-label="ERP採購未交資訊"><div class="shortage-pending-grid"><div><span>ERP採購未交量</span><strong>${total}</strong></div><div><span>最早預計到貨日</span><strong>${escapeHtml(date)}</strong></div></div><p>${info.available ? `全公司商品總量，非門市專屬。清單截止：${escapeHtml(info.sourceDate || "未提供")}；更新：${escapeHtml(updated)}。` : escapeHtml(info.error || "請由主採購工具成功讀取完整ERP未交清單後同步。")}${info.restricted ? " 單據明細僅總部可查看。" : info.available && info.total > 0 && !knownOrders ? " 未提供採購單號明細。" : ""}</p>${detail}<p>建議、核准或摘要不當作已下單；未交量不等於本週可配庫存，到貨後仍須收貨與配送。</p></section>`;
  }
  global.ProcurementShortageBatch = { run, requestJson, retryPlan, groupProducts, remainingNeed, pendingInfo, renderPendingInfo };
})(typeof globalThis !== "undefined" ? globalThis : window);

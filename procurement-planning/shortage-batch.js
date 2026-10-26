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
  global.ProcurementShortageBatch = { run, requestJson, retryPlan };
})(typeof globalThis !== "undefined" ? globalThis : window);

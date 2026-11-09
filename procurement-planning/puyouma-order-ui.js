(function (global) {
  "use strict";
  function createController({ dialog, api, core, reader, writer, readWorkbook, getConfig, googleSources, ensureCurrent, afterAuthorize = () => {} }) {
    const find = name => dialog.querySelector(`[data-puyouma="${name}"]`);
    const date = find("date"), status = find("status"), download = find("download"), file = find("file"), sourceStatus = find("source"), title = find("batch");
    let payload = null, source = null, sequence = 0, busy = false, returnFocus = null;
    const message = value => { status.textContent = value; };
    function update() {
      let valid = false; try { api.shipmentDate(date.value); valid = true; } catch (_) { /* A blank date is deliberately required. */ }
      download.disabled = busy || !payload || !source || !valid;
      date.disabled = busy; file.disabled = busy;
      find("load").disabled = busy; find("authorize").disabled = busy;
    }
    async function batchData(id) {
      const response = await fetch(`/api/procurement/batches/${encodeURIComponent(id)}/supplier-order`, { cache: "no-store", headers: { Accept: "application/json" } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `無法讀取確認採購明細（HTTP ${response.status}）。`);
      return result;
    }
    async function loadSource(authorize = false) {
      const run = sequence; source = null; busy = true; update(); sourceStatus.textContent = "正在讀取最新普優瑪寄庫表…";
      try {
        if (!(await ensureCurrent())) throw new Error("請先確認或重新載入最新版，資料保留。");
        if (authorize) { googleSources.initialize(getConfig().googleOAuthClientId); await googleSources.authorize(); await googleSources.verifyCompanyIdentity(); afterAuthorize(); }
        if (!googleSources.token()) throw new Error("請按「公司Google授權並讀取」，或選擇寄庫表手動備援。");
        const result = await googleSources.loadPuyoumaConsignment(getConfig(), reader);
        if (run !== sequence) return;
        source = api.parseSource(result.workbook, reader, core);
        sourceStatus.textContent = `已讀取線上寄庫表；庫存欄：${source.currentHeader}。讀取時間：${new Date(result.metadata.fetchedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}（台北）。`;
        message(date.value ? "下一步：核對批次與出貨日期後，按「確認匯出」。" : "下一步：填寫出貨日期，再按「確認匯出」。");
      } catch (error) { if (run === sequence) { sourceStatus.textContent = `來源尚未就緒：${error.message}`; message("下一步：完成寄庫來源讀取並填寫出貨日期。"); } }
      finally { if (run === sequence) { busy = false; update(); } }
    }
    find("load").addEventListener("click", () => loadSource());
    find("authorize").addEventListener("click", () => loadSource(true));
    date.addEventListener("input", () => { update(); if (date.value && source) message("下一步：核對批次與出貨日期後，按「確認匯出」。"); });
    file.addEventListener("change", async () => {
      const selected = file.files?.[0], run = sequence; if (!selected) return;
      source = null; busy = true; update(); sourceStatus.textContent = "正在本機檢查手動寄庫來源…";
      try {
        if (!(await ensureCurrent())) throw new Error("請先確認或重新載入最新版，資料保留。");
        const workbook = await readWorkbook(selected); if (run !== sequence) return;
        source = api.parseSource(workbook, reader, core);
        sourceStatus.textContent = `手動寄庫來源：${selected.name}；庫存欄：${source.currentHeader}。請確認這是最新寄庫表。`;
        message(date.value ? "下一步：核對批次與出貨日期後，按「確認匯出」。" : "下一步：填寫出貨日期。");
      } catch (error) { if (run === sequence) { sourceStatus.textContent = `手動來源失敗：${error.message}`; message("下一步：修正寄庫表後重新選檔。"); } }
      finally { if (run === sequence) { busy = false; update(); } }
    });
    find("close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => { sequence++; payload = null; source = null; if (returnFocus?.isConnected) returnFocus.focus(); });
    download.addEventListener("click", async () => {
      if (busy || !payload || !source) return;
      const run = sequence; busy = true; update(); message("正在核對最新版、台帳版本與匯出數量…");
      try {
        if (!(await ensureCurrent())) throw new Error("請先確認或重新載入最新版，尚未下載。");
        const latest = await batchData(payload.batch.id); if (run !== sequence) return;
        if (JSON.stringify(latest) !== JSON.stringify(payload)) throw new Error("這筆採購台帳已變更，已停止匯出；請關閉後重新開啟此批次。");
        const output = api.buildOrder(latest, source, writer, { shipmentDate: date.value });
        writer.writeFile(output.workbook, output.fileName, { compression: true });
        message(`已匯出${output.rows.length}個品號、${output.quantity}件；出貨日期${output.shipmentDate}。只下載檔案，未重複下單或寄送摘要。`);
      } catch (error) { message(`尚未匯出：${error.message}`); }
      finally { if (run === sequence) { busy = false; update(); } }
    });
    return { async open(item, trigger) {
      if (!getConfig() || !["approved", "erp_created", "received"].includes(item.status)) return;
      const run = ++sequence; returnFocus = trigger; payload = null; source = null; busy = true; date.value = ""; file.value = "";
      title.textContent = `${item.id} · ${item.supplier_summary.join("、")}`;
      sourceStatus.textContent = "待讀取寄庫來源"; message("正在讀取這筆批次的確認採購明細…"); update(); dialog.showModal();
      try {
        if (!(await ensureCurrent())) throw new Error("請先確認或重新載入最新版，尚未讀取明細。");
        const result = await batchData(item.id); if (run !== sequence) return;
        payload = result; title.textContent = `${result.batch.id} · 台帳v${result.batch.revision} · ${result.items.filter(row => api.isPuyouma(row.supplier)).length}項普優瑪明細`;
        message("下一步：填寫出貨日期，並讀取最新寄庫表。");
      } catch (error) { message(`明細讀取失敗：${error.message}`); }
      finally { if (run === sequence) { busy = false; update(); date.focus(); } }
      if (run === sequence && payload && googleSources.token()) await loadSource();
    } };
  }
  global.PuyoumaOrderUI = { createController };
})(typeof globalThis !== "undefined" ? globalThis : window);

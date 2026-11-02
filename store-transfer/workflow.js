(function (root) {
  "use strict";
  const active = status => ["open", "review", "approved", "erp_created"].includes(status);
  function approvalStores(payload) {
    if (!["open", "review"].includes(payload.batch.status)) return [];
    return payload.storeStatuses.filter(row => row.status === "submitted" && !row.erp_created_at);
  }
  function exportStores(payload) {
    if (!active(payload.batch.status)) return [];
    return payload.storeStatuses.filter(row => row.status === "approved" && !row.correction_mode);
  }
  function prepareExports(payload, stores, core, XLSX) {
    if (!Array.isArray(stores) || !stores.length || new Set(stores).size !== stores.length) throw new Error("請勾選要下載的門市。");
    const eligible = new Set(exportStores(payload).map(row => row.store_code));
    return stores.map(store => {
      if (!eligible.has(store)) throw new Error(`${store}尚未核准或更正中，不能匯出。`);
      const items = payload.items.filter(row => row.store_code === store);
      const workbook = core.buildErpWorkbook(payload.items, XLSX, store);
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets["通用貨品數量"]);
      const expected = new Map();
      for (const row of items) {
        const quantity = Number(row.hq_approved_quantity ?? row.store_confirmed_quantity ?? row.suggested_quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error(`${store}／${row.sku}核准量異常，停止匯出。`);
        if (quantity > 0) expected.set(row.sku, (expected.get(row.sku) || 0) + quantity);
      }
      const actual = new Map();
      for (const row of rows) actual.set(row.貨號, (actual.get(row.貨號) || 0) + Number(row.數量));
      if (actual.size !== expected.size || [...expected].some(([sku, qty]) => actual.get(sku) !== qty)) throw new Error(`${store}核准結果與ERP輸出不一致，停止產檔。`);
      return { store, workbook, filename: `${payload.batch.week_key}_${store}_ERP調撥單.xlsx` };
    });
  }
  root.StoreTransferWorkflow = Object.freeze({ approvalStores, exportStores, prepareExports });
})(typeof window !== "undefined" ? window : globalThis);

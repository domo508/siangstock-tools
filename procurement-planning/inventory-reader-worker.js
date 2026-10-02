"use strict";

importScripts("../inventory/assets/xlsx.full.min.js", "core.js?v=20261002-inventory-large-r1");

self.addEventListener("message", async (event) => {
  try {
    const file = event.data?.file;
    if (!file || typeof file.arrayBuffer !== "function") throw new Error("未收到可讀取的庫存檔案");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, {
      type: "array",
      dense: true,
      cellDates: false,
      cellStyles: false
    });
    const inventory = ProcurementPlanningCore.parseInventoryWorkbook(workbook, XLSX, { fileName: file.name || "本次庫存" });
    self.postMessage({ ok: true, inventory });
  } catch (error) {
    self.postMessage({
      ok: false,
      name: error?.name || "Error",
      message: error?.message || "庫存檔讀取失敗"
    });
  }
});

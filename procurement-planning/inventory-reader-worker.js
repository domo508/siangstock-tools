"use strict";

importScripts("../inventory/assets/xlsx.full.min.js", "core.js?v=20261005-inventory-stream-r1", "inventory-stream-reader.js?v=20261005-inventory-stream-r1");

const STREAM_THRESHOLD_BYTES = 450 * 1024 * 1024;

self.addEventListener("message", async (event) => {
  try {
    const file = event.data?.file;
    if (!file || typeof file.arrayBuffer !== "function") throw new Error("未收到可讀取的庫存檔案");
    const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (signature[0] === 0x50 && signature[1] === 0x4b && signature[2] === 0x03 && signature[3] === 0x04) {
      const entries = await ProcurementInventoryStreamReader.inspectZip(file);
      const worksheet = entries.find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name));
      if (worksheet?.uncompressedSize >= STREAM_THRESHOLD_BYTES) {
        const inventory = await ProcurementInventoryStreamReader.readInventory(file, ProcurementPlanningCore, XLSX, entries);
        self.postMessage({ ok: true, inventory });
        return;
      }
    }
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, {
      type: "array",
      dense: true,
      cellDates: false,
      cellStyles: false,
      nodim: true
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

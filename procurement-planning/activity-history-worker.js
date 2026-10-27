"use strict";
importScripts("../inventory/assets/xlsx.full.min.js", "core.js?v=20261027-activity-period-phase1-r1", "activity-planning.js?v=20261027-activity-period-phase1-r1");
let builder = null;
self.onmessage = (event) => {
  const message = event.data || {};
  try {
    if (message.type === "initialize") { builder = ProcurementActivityPlanning.createHistoryBuilder(); self.postMessage({ type: "initialized" }); return; }
    if (!builder) throw new Error("活動歷史資料尚未初始化。");
    if (message.type === "ingest") {
      const book = XLSX.read(message.buffer, ProcurementPlanningCore.ACTIVITY_HISTORY_READ_OPTIONS);
      const report = ProcurementPlanningCore.parseSalesWorkbook(book, XLSX, { fileName: "活動歷史來源" });
      self.postMessage({ type: "ingested", stats: builder.ingest(report, message.file || {}) }); return;
    }
    if (message.type === "recent") { for (const report of message.reports || []) builder.ingest(report); self.postMessage({ type: "recent-ready" }); return; }
    if (message.type === "finalize") self.postMessage({ type: "history", history: builder.finalize() });
  } catch (error) { self.postMessage({ type: "error", message: error?.message || "活動歷史資料讀取失敗。" }); }
};

"use strict";

importScripts("../inventory/assets/xlsx.full.min.js", "core.js", "seasonal-model.js");

let builder = null;
let latestResult = null;

function workbook(buffer) { return XLSX.read(buffer, { type: "array", cellDates: true, cellStyles: true, nodim: true }); }
function workbookBuffer(result, approval = {}) {
  return XLSX.write(ProcurementSeasonalModel.buildWorkbook(result, XLSX, approval), { type: "array", bookType: "xlsx", compression: true, cellStyles: true });
}

self.onmessage = (event) => {
  const message = event.data || {};
  try {
    if (message.type === "initialize") {
      const master = ProcurementPlanningCore.parseProductMasterWorkbook(workbook(message.masterBuffer), XLSX, { fileName: message.masterName || "商品主檔.xlsx" });
      builder = ProcurementSeasonalModel.createBuilder(master, { blacklist: message.blacklist || [] });
      latestResult = null;
      self.postMessage({ type: "initialized", masterRows: master.records.length });
      return;
    }
    if (message.type === "ingest") {
      if (!builder) throw new Error("回測工作尚未初始化。");
      const report = ProcurementPlanningCore.parseSalesWorkbook(workbook(message.buffer), XLSX, { fileName: message.file?.name || "歷史銷售.xlsx" });
      self.postMessage({ type: "ingested", index: message.index, stats: builder.ingest(report, message.file || {}) });
      return;
    }
    if (message.type === "finalize") {
      if (!builder) throw new Error("回測工作尚未初始化。");
      latestResult = builder.finalize(message.metadata || {});
      const buffer = workbookBuffer(latestResult);
      self.postMessage({ type: "draft", buffer, summary: latestResult.summary, metadata: latestResult.metadata }, [buffer]);
      return;
    }
    if (message.type === "approve") {
      if (!latestResult) throw new Error("尚未建立可核准的回測草稿。");
      const approval = { approvedBy: message.approvedBy || "", approvedAt: message.approvedAt || new Date().toISOString() };
      const buffer = workbookBuffer(latestResult, approval);
      self.postMessage({ type: "approved", buffer, summary: latestResult.summary, metadata: { ...latestResult.metadata, ...approval } }, [buffer]);
    }
  } catch (error) {
    self.postMessage({ type: "error", stage: message.type || "unknown", message: error?.message || "季節模型回測失敗。" });
  }
};

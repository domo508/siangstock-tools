"use strict";

importScripts("../inventory/assets/xlsx.full.min.js", "core.js", "seasonal-model.js?v=20260914-seasonal-wape-r2");

let builder = null;
let latestResult = null;

function workbook(buffer, fileName = "Excel") {
  let parsed;
  try {
    parsed = XLSX.read(buffer, { type: "array", cellDates: true, cellStyles: true, nodim: true, WTF: true });
  } catch (error) {
    if (error instanceof RangeError || /Invalid string length/i.test(String(error?.message || ""))) {
      throw new Error(`${fileName}解壓後工作表過大，瀏覽器無法安全展開；請拆分檔案後重跑。`);
    }
    throw error;
  }
  const missingSheet = parsed.SheetNames.find((name) => !parsed.Sheets[name]);
  if (missingSheet) throw new Error(`${fileName}的「${missingSheet}」工作表過大或損毀，並非銷售欄位缺漏；請拆分或重新匯出。`);
  return parsed;
}
function workbookBuffer(result, approval = {}) {
  return XLSX.write(ProcurementSeasonalModel.buildWorkbook(result, XLSX, approval), { type: "array", bookType: "xlsx", compression: true, cellStyles: true });
}

self.onmessage = (event) => {
  const message = event.data || {};
  try {
    if (message.type === "initialize") {
      const master = ProcurementPlanningCore.parseProductMasterWorkbook(workbook(message.masterBuffer, message.masterName || "商品主檔.xlsx"), XLSX, { fileName: message.masterName || "商品主檔.xlsx" });
      builder = ProcurementSeasonalModel.createBuilder(master, { blacklist: message.blacklist || [] });
      latestResult = null;
      self.postMessage({ type: "initialized", masterRows: master.records.length });
      return;
    }
    if (message.type === "ingest") {
      if (!builder) throw new Error("回測工作尚未初始化。");
      const report = ProcurementPlanningCore.parseSalesWorkbook(workbook(message.buffer, message.file?.name || "歷史銷售.xlsx"), XLSX, { fileName: message.file?.name || "歷史銷售.xlsx" });
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

(function (global) {
  "use strict";

  if (!global.XLSX) throw new Error("Excel 報表輸出元件載入失敗。");
  global.ProcurementXlsxWriter = global.XLSX;
})(globalThis);

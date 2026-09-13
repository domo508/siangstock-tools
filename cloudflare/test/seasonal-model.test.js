import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function loadBrowserScript(path, context = {}) {
  const sandbox = { console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Blob, URL, setTimeout, clearTimeout, ...context };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path, "utf8"), sandbox, { filename: path });
  return sandbox;
}

const xlsxContext = loadBrowserScript("../inventory/assets/xlsx.full.min.js");
const XLSX = xlsxContext.XLSX;
const coreContext = loadBrowserScript("../procurement-planning/core.js", { XLSX });
const core = coreContext.ProcurementPlanningCore;
const seasonal = loadBrowserScript("../procurement-planning/seasonal-model.js", { XLSX, ProcurementPlanningCore: core }).ProcurementSeasonalModel;

function masterData() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["貨號", "品名", "供應商簡稱", "主類別", "2級款式", "尺碼", "存貨種類"],
    ["A1", "60天絲5尺床包", "普優瑪", "床包", "天絲", "5尺", "商品"]
  ]), "商品主檔");
  return core.parseProductMasterWorkbook(workbook, XLSX);
}

function historicalRows() {
  const records = [];
  const start = Date.UTC(2024, 0, 1);
  for (let index = 0; index < 70; index += 1) {
    const date = new Date(start + index * 14 * 86400000).toISOString().slice(0, 10);
    records.push({
      saleType: "銷貨", date, transactionTimestamp: `${date} 12:00:00`, sku: "A1", name: "60天絲5尺床包",
      quantity: index % 26 > 19 ? 20 : 10, actualAmount: 1000, warehouseCode: "R00", shipWarehouseCode: "T00",
      deductQuantity: 10, ecommercePlatform: "", posOrder: `P${index}`, sourceOrder: "", pickupOrder: ""
    });
  }
  return records;
}

describe("季節模型自動回測", () => {
  it("多檔重疊交易只計一次並能產生三個正式模型頁籤", () => {
    const builder = seasonal.createBuilder(masterData(), { blacklist: [] });
    const records = historicalRows();
    builder.ingest({ fileName: "2601-08.xlsx", records, excluded: {}, minDate: records[0].date, maxDate: records.at(-1).date }, { id: "one", name: "2601-08.xlsx", size: 100 });
    builder.ingest({ fileName: "2606-08.xlsx", records: records.slice(55), excluded: {}, minDate: records[55].date, maxDate: records.at(-1).date }, { id: "two", name: "2606-08.xlsx", size: 50 });
    const result = builder.finalize({ generatedBy: "buyer@siangapato.com.tw", generatedAt: "2026-09-14T00:00:00.000Z" });
    expect(result.summary.sourceFileCount).toBe(2);
    expect(result.summary.acceptedRows).toBe(70);
    expect(result.summary.duplicateRows).toBe(15);
    expect(result.summary.conflictRows).toBe(0);
    expect(result.summary.activeSkuCount).toBe(1);
    const workbook = seasonal.buildWorkbook(result, XLSX, { approvedBy: "buyer@siangapato.com.tw", approvedAt: "2026-09-14T01:00:00.000Z" });
    expect(workbook.SheetNames).toEqual(expect.arrayContaining(["SKU模型建議", "類別模型總覽", "類別期間回測", "來源紀錄"]));
    const parsed = core.parseForecastModelWorkbook(workbook, XLSX);
    expect(parsed.bySku.get("A1")).toMatchObject({ supplier: "普優瑪", materialCategory: "天絲" });
    expect(parsed.categoryModelAvailable).toBe(true);
    expect(parsed.seasonalIndexAvailable).toBe(true);
  });

  it("同一交易識別在跨檔出現不同數量時禁止發布", () => {
    const builder = seasonal.createBuilder(masterData(), { blacklist: [] });
    const records = historicalRows();
    builder.ingest({ records, excluded: {}, minDate: records[0].date, maxDate: records.at(-1).date }, { name: "完整.xlsx" });
    builder.ingest({ records: [{ ...records[60], quantity: 99 }], excluded: {}, minDate: records[60].date, maxDate: records[60].date }, { name: "衝突.xlsx" });
    expect(() => builder.finalize()).toThrow("相同交易識別");
  });
});

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

function pooledCategoryData() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["貨號", "品名", "供應商簡稱", "主類別", "2級款式", "尺碼", "存貨種類"],
    ["A1", "60天絲5尺床包A", "普優瑪", "床包", "天絲", "5尺", "商品"],
    ["A2", "60天絲5尺床包B", "普優瑪", "床包", "天絲", "5尺", "商品"]
  ]), "商品主檔");
  const records = [];
  const start = Date.UTC(2024, 0, 1);
  for (let index = 0; index < 70; index += 1) {
    const date = new Date(start + index * 14 * 86400000).toISOString().slice(0, 10);
    for (const [sku, quantity] of [["A1", index % 2 ? 20 : 0], ["A2", index % 2 ? 0 : 20]]) {
      records.push({
        saleType: "銷貨", date, transactionTimestamp: `${date} 12:00:00`, sku, name: `60天絲5尺床包${sku}`,
        quantity, actualAmount: quantity * 100, warehouseCode: "R00", shipWarehouseCode: "T00",
        deductQuantity: quantity, ecommercePlatform: "", posOrder: `P${index}-${sku}`, sourceOrder: "", pickupOrder: ""
      });
    }
  }
  return { master: core.parseProductMasterWorkbook(workbook, XLSX), records };
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
    expect(workbook.SheetNames).toEqual(expect.arrayContaining(["SKU模型建議", "類別模型總覽", "類別期間回測", "季節指數", "來源紀錄"]));
    const skuSheet = XLSX.utils.sheet_to_json(workbook.Sheets["SKU模型建議"], { header: 1, defval: null });
    expect(skuSheet[3]).toEqual(expect.arrayContaining(["輔助類別回測樣本數", "輔助類別回測實際量"]));
    const parsed = core.parseForecastModelWorkbook(workbook, XLSX);
    expect(parsed.bySku.get("A1")).toMatchObject({ supplier: "普優瑪", materialCategory: "天絲" });
    expect(parsed.categoryModelAvailable).toBe(true);
    expect(parsed.seasonalIndexAvailable).toBe(true);
    expect(parsed.seasonalProfilesBySku.get("A1")?.indices.size).toBe(26);
  });

  it("非普優瑪冬季品也建立SKU與供應商類別季節曲線", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["貨號", "品名", "供應商簡稱", "主類別", "2級款式", "尺碼", "存貨種類"],
      ["F13005", "冬季暖被", "潤泰羽絨", "被類", "冬被", "6x7尺", "商品"]
    ]), "商品主檔");
    const master = core.parseProductMasterWorkbook(workbook, XLSX);
    const records = historicalRows().map((row, index) => ({
      ...row,
      sku: "F13005",
      name: "冬季暖被",
      quantity: index % 26 >= 18 ? 30 : 1,
      posOrder: `W${index}`
    }));
    const builder = seasonal.createBuilder(master, { blacklist: [] });
    builder.ingest({ records, excluded: {}, minDate: records[0].date, maxDate: records.at(-1).date }, { name: "冬被歷史.xlsx" });
    const result = builder.finalize();
    expect(result.seasonalRows.some((row) => row[0] === "全部" && row[1] === "SKU" && row[2] === "F13005" && row[8] !== "低")).toBe(true);
    expect(result.seasonalRows.some((row) => row[0] === "潤泰羽絨" && row[1] === "材質" && row[9] === "是")).toBe(true);
    const parsed = core.parseForecastModelWorkbook(seasonal.buildWorkbook(result, XLSX), XLSX);
    expect(parsed.seasonalProfilesBySku.get("F13005")).toMatchObject({ seasonal: true });
  });

  it("同一交易識別在跨檔出現不同數量時禁止發布", () => {
    const builder = seasonal.createBuilder(masterData(), { blacklist: [] });
    const records = historicalRows();
    builder.ingest({ records, excluded: {}, minDate: records[0].date, maxDate: records.at(-1).date }, { name: "完整.xlsx" });
    builder.ingest({ records: [{ ...records[60], quantity: 99 }], excluded: {}, minDate: records[60].date, maxDate: records[60].date }, { name: "衝突.xlsx" });
    expect(() => builder.finalize()).toThrow("相同交易識別");
  });

  it("類別總覽的SKU層級WAPE由各SKU誤差加總，不誤用類別需求池WAPE", () => {
    const source = pooledCategoryData();
    const builder = seasonal.createBuilder(source.master, { blacklist: [] });
    builder.ingest({ records: source.records, excluded: {}, minDate: source.records[0].date, maxDate: source.records.at(-1).date }, { name: "雙SKU.xlsx" });
    const result = builder.finalize();
    const allTencel = result.categoryRows.find((row) => row[0] === "全部" && row[1] === "天絲");
    const puyoumaTencel = result.categoryRows.find((row) => row[0] === "普優瑪" && row[1] === "天絲");
    expect(allTencel[4]).toBeGreaterThan(allTencel[6]);
    expect(puyoumaTencel[4]).toBeGreaterThan(puyoumaTencel[6]);
    expect(allTencel[4]).toBe(puyoumaTencel[4]);
  });

  it("集中黑名單的運費品號不進入活躍SKU模型", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["貨號", "品名", "供應商簡稱", "主類別", "2級款式", "尺碼", "存貨種類"],
      ["A1", "60天絲5尺床包", "普優瑪", "床包", "天絲", "5尺", "商品"],
      ["ZZ900", "運費", "翔仔居家", "其他", "其他", "", "商品"]
    ]), "商品主檔");
    const records = historicalRows();
    records.push(...historicalRows().map((row) => ({ ...row, sku: "ZZ900", name: "運費", posOrder: `${row.posOrder}-freight` })));
    const builder = seasonal.createBuilder(core.parseProductMasterWorkbook(workbook, XLSX), { blacklist: ["ZZ900"] });
    builder.ingest({ records, excluded: {}, minDate: records[0].date, maxDate: records.at(-1).date }, { name: "含運費.xlsx" });
    const result = builder.finalize();
    expect(result.summary.activeSkuCount).toBe(1);
    expect(result.skuRows.map((row) => row[0])).toEqual(["A1"]);
  });
});

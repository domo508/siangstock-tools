import { beforeAll, describe, expect, it } from "vitest";

let core;

beforeAll(async () => {
  await import("../../store-transfer/core.js");
  core = globalThis.StoreTransferCore;
});

describe("門市週調撥日期規則", () => {
  it("星期五遇國定假日會提前到前一工作日", () => {
    expect(core.previousWorkingDay("2026-10-09", ["2026-10-09"])).toBe("2026-10-08");
  });

  it("星期一遇國定假日會順延到下一工作日", () => {
    expect(core.nextWorkingDay("2026-10-12", ["2026-10-12"])).toBe("2026-10-13");
  });
});

describe("總倉不足分配", () => {
  it("整數分配後不會超過總倉可調量", () => {
    const weights = core.combinedAllocationWeights({ R00: 6, R01: 3, R03: 1 });
    const result = core.allocateQuantity(7, weights, core.STORE_ORDER);
    expect(Object.values(result).reduce((sum, value) => sum + value, 0)).toBe(7);
    expect(result.R00).toBeGreaterThan(result.R03);
  });

  it("B3只影響門市能力權重，不直接當作現場補貨消耗", () => {
    const master = { sku: "A001", name: "一般商品", size: "", style1: "寢具" };
    const result = core.buildSuggestions({
      storeCodes: ["R00", "R01"],
      master: { bySku: new Map([["A001", master]]) },
      inventory: { records: [
        { warehouseCode: "T00", sku: "A001", quantity: 1 },
        { warehouseCode: "R00", sku: "A001", quantity: 0 },
        { warehouseCode: "R01", sku: "A001", quantity: 0 }
      ] },
      transfer: { records: [] },
      sales: [{ maxDate: "2026-09-14", records: [
        { warehouseCode: "R00", shipWarehouseCode: "R00", sku: "A001", date: "2026-09-14", quantity: 4, deductQuantity: 4, saleType: "銷貨" },
        { warehouseCode: "R01", shipWarehouseCode: "R01", sku: "A001", date: "2026-09-14", quantity: 4, deductQuantity: 4, saleType: "銷貨" }
      ], takeRecords: [
        { warehouseCode: "R00", shipWarehouseCode: "T00", sku: "A001", date: "2026-09-14", quantity: 20, deductQuantity: 20, saleType: "取貨" }
      ] }]
    });
    expect(result.totals.quantity).toBe(1);
    expect(result.rows[0].storeCode).toBe("R00");
    expect(result.rows[0].rawNeed).toBe(1);
  });
});

describe("整體行銷策略與活動贈品", () => {
  const fakeXlsx = { utils: { sheet_to_json: (sheet) => sheet.rows } };

  it("會辨識仍在進行中的贈品期間與貨號", () => {
    const workbook = {
      SheetNames: ["官網銷售波段"],
      Sheets: { "官網銷售波段": { rows: [["09/06 - Apple聯名天絲上市；購買四件組贈送隨身鏡\n贈品貨號：N00144"]] } }
    };
    const result = core.parseMarketingWorkbook(workbook, fakeXlsx, "2026-09-14");
    expect(result.giftActivities).toHaveLength(1);
    expect(result.giftActivities[0].giftSkus).toEqual(["N00144"]);
    expect(result.giftActivities[0].endDate).toBe("2026-09-30");
  });

  it("活動贈品獨立估算，不會併入一般補貨", () => {
    const gift = { sku: "N00144", name: "聯名隨身鏡", size: "", style1: "贈品" };
    const result = core.buildSuggestions({
      storeCodes: ["R00"],
      master: { bySku: new Map([["N00144", gift]]) },
      inventory: { records: [
        { warehouseCode: "T00", sku: "N00144", quantity: 10 },
        { warehouseCode: "R00", sku: "N00144", quantity: 0 }
      ] },
      transfer: { records: [] },
      sales: [{ maxDate: "2026-09-14", records: [
        { warehouseCode: "R00", shipWarehouseCode: "R00", sku: "N00144", date: "2026-09-10", quantity: 3, deductQuantity: 3, saleType: "銷貨" }
      ], takeRecords: [] }],
      marketing: { giftActivities: [{ startDate: "2026-09-06", endDate: "2026-09-30", giftSkus: ["N00144"] }], warnings: [] }
    });
    expect(result.regularRows).toHaveLength(0);
    expect(result.activityRows).toHaveLength(1);
    expect(result.activityRows[0].itemType).toBe("activity_gift");
    expect(result.activityRows[0].suggestedQuantity).toBe(3);
  });
});

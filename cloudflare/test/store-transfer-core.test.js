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
        { warehouseCode: "R01", shipWarehouseCode: "R01", sku: "A001", date: "2026-09-14", quantity: 4, deductQuantity: 4, saleType: "銷貨" },
        { warehouseCode: "R00", shipWarehouseCode: "R00", sku: "A001", date: "2026-09-14", quantity: 0, deductQuantity: 0, saleType: "訂貨", sourceOrder: "SO-1" }
      ], takeRecords: [
        { warehouseCode: "R00", shipWarehouseCode: "T00", sku: "A001", date: "2026-09-14", quantity: 20, deductQuantity: 20, saleType: "取貨", sourceOrder: "SO-1", pickupOrder: "PU-1" }
      ] }]
    });
    expect(result.totals.quantity).toBe(1);
    expect(result.rows[0].storeCode).toBe("R00");
    expect(result.rows[0].rawNeed).toBe(1);
    expect(result.b3Audit).toMatchObject({ matchedCount: 1, pendingCount: 0 });
  });

  it("無法用來源單號與品號配對的總倉取貨不會靜默算入B3", () => {
    const result = core.buildSuggestions({
      storeCodes: ["R00"], master: { bySku: new Map() }, inventory: { records: [] }, transfer: { records: [] },
      sales: [{ maxDate: "2026-09-14", records: [], takeRecords: [
        { warehouseCode: "R00", shipWarehouseCode: "T00", sku: "A001", date: "2026-09-14", quantity: 2, deductQuantity: 2, saleType: "取貨", sourceOrder: "SO-X", pickupOrder: "PU-X" }
      ] }]
    });
    expect(result.b3Audit).toMatchObject({ matchedCount: 0, pendingCount: 1 });
  });
});

describe("S品、建議備貨與可售至", () => {
  it("S品總倉5件內會先依周轉保留，無可釋出時不反覆列出", () => {
    expect(core.sStockProtection(2, 1, 2, 2)).toMatchObject({ level: "高周轉", reserve: 2, releasable: 0 });
    expect(core.sStockProtection(5, 0, 0, 0)).toMatchObject({ level: "無周轉", reserve: 0, releasable: 5 });
  });

  it("人工調整量會改變預估可售至日期", () => {
    expect(core.projectedSellThroughDate("2026-09-14", 2, 5, 1)).toBe("2026-09-21");
    expect(core.projectedSellThroughDate("2026-09-14", 2, 5, 0)).toBe("近期無現場銷售");
  });

  it("單人被套各材質前2名可進入非必要建議區", () => {
    const products = ["A1", "A2", "A3"].map((sku) => [sku, { sku, name: `天絲單人薄被套${sku}`, style1: "被套" }]);
    const records = [3, 2, 1].map((quantity, index) => ({ warehouseCode: "R00", shipWarehouseCode: "R00", sku: `A${index + 1}`, date: "2026-09-14", quantity, deductQuantity: quantity, saleType: "銷貨" }));
    const result = core.buildSuggestions({
      storeCodes: ["R00"], master: { bySku: new Map(products) },
      inventory: { records: [{ warehouseCode: "T00", sku: "A1", quantity: 2 }, { warehouseCode: "T00", sku: "A2", quantity: 2 }] },
      transfer: { records: [] }, sales: [{ maxDate: "2026-09-14", records, takeRecords: [] }]
    });
    expect(result.specialStockRows.map((row) => row.sku)).toEqual(["A1", "A2"]);
    expect(result.specialStockRows.every((row) => row.itemType === "special_stock")).toBe(true);
  });
});

describe("展示與最低庫存管理規則", () => {
  it("管理前台設定會取代程式預設量與適用門市", () => {
    const managed = { rules: [{ name: "獨立5尺商品", enabled: true, scope: "R01", inventoryRole: "不可售展示", quantity: 2, priority: 120 }] };
    expect(core.stockRule({ name: "天絲床包 獨立5尺" }, managed)).toMatchObject({ role: "不可售展示", quantity: 2, scope: "R01" });
  });

  it("前台新增的無尺寸配件規則可直接命中一般配件", () => {
    const managed = { rules: [
      { name: "枕頭／枕芯", enabled: true, scope: "R00、R06", inventoryRole: "不可售展示", quantity: 2, priority: 80 },
      { name: "無尺寸配件", enabled: true, scope: "全部有銷售資料的營運門市", matchText: "配件|無尺寸", inventoryRole: "不可售展示", quantity: 1, priority: 50 }
    ] };
    expect(core.stockRule({ name: "一般收納小配件", mainCategory: "配件", size: "" }, managed)).toMatchObject({ name: "無尺寸配件", quantity: 1 });
    expect(core.stockRule({ name: "人體工學枕芯 40×70cm", mainCategory: "配件", size: "40×70cm" }, managed)).toMatchObject({ name: "枕頭／枕芯", quantity: 2 });
  });

  it("新自訂規則依商品大類、尺寸屬性及任一品項關鍵字判斷", () => {
    const managed = { rules: [{ name: "坐墊展示", enabled: true, conditionMode: "structured", productCategory: "配件", sizeAttribute: "無尺寸", itemTypeKeywords: "坐墊｜椅墊", scope: "R01", inventoryRole: "不可售展示", quantity: 1, priority: 90 }] };
    expect(core.stockRule({ name: "舒適椅墊", mainCategory: "配件" }, managed)).toMatchObject({ name: "坐墊展示", scope: "R01" });
    expect(core.stockRule({ name: "浴巾", mainCategory: "配件" }, managed)).toBeNull();
  });

  it("前台設定排除規則後不會進入一般調撥建議", () => {
    const result = core.buildSuggestions({
      storeCodes: ["R00"],
      master: { bySku: new Map([["X001", { sku: "X001", name: "測試椅墊", mainCategory: "配件" }]]) },
      inventory: { records: [{ warehouseCode: "T00", sku: "X001", quantity: 10 }] }, transfer: { records: [] },
      sales: [{ maxDate: "2026-09-14", records: [{ warehouseCode: "R00", shipWarehouseCode: "R00", sku: "X001", date: "2026-09-14", quantity: 4, deductQuantity: 4, saleType: "銷貨" }], takeRecords: [] }],
      storeInventory: { rules: [{ name: "排除測試椅墊", enabled: true, conditionMode: "structured", productCategory: "配件", sizeAttribute: "無尺寸", itemTypeKeywords: "椅墊", scope: "R00", inventoryRole: "排除規則", quantity: 0, priority: 200 }] }
    });
    expect(result.regularRows).toHaveLength(0);
  });
});

describe("提袋耗材模型", () => {
  it("累積4個可信週次後依門檻以100個為單位建議", () => {
    const history = ["2026-09-07", "2026-08-31", "2026-08-24", "2026-08-17"].map((snapshotDate) => ({ snapshot_date: snapshotDate, store_code: "R00", sku: "P11041", current_quantity: 10, weekly_consumption: 60, trusted: 1 }));
    const result = core.buildSuggestions({
      storeCodes: ["R00"], master: { bySku: new Map() },
      inventory: { records: [{ warehouseCode: "T00", sku: "P11041", quantity: 1000 }, { warehouseCode: "R00", sku: "P11041", quantity: 40 }] },
      transfer: { records: [] }, sales: [{ maxDate: "2026-09-14", records: [], takeRecords: [] }], consumableHistory: history
    });
    expect(result.consumableRows).toHaveLength(1);
    expect(result.consumableRows[0]).toMatchObject({ sku: "P11041", suggestedQuantity: 200, itemType: "consumable" });
    expect(result.consumableRows[0].suggestedQuantity % 100).toBe(0);
  });

  it("歷史不足4週時只保存快照、不自動建議", () => {
    const result = core.buildSuggestions({
      storeCodes: ["R00"], master: { bySku: new Map() },
      inventory: { records: [{ warehouseCode: "T00", sku: "P11041", quantity: 1000 }, { warehouseCode: "R00", sku: "P11041", quantity: 0 }] },
      transfer: { records: [] }, sales: [{ maxDate: "2026-09-14", records: [], takeRecords: [] }], consumableHistory: []
    });
    expect(result.consumableRows).toHaveLength(0);
    expect(result.consumableSnapshots).toHaveLength(3);
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

  it("會解析滿額門檻與不累贈規則", () => {
    const workbook = {
      SheetNames: ["門市銷售波段"],
      Sheets: { "門市銷售波段": { rows: [["09/01-09/30 消費滿3,000元贈隨身鏡乙個（不累贈） 贈品貨號：N00144"]] } }
    };
    const activity = core.parseMarketingWorkbook(workbook, fakeXlsx, "2026-09-14").giftActivities[0];
    expect(activity.thresholdType).toBe("amount");
    expect(activity.thresholdValue).toBe(3000);
    expect(activity.cumulative).toBe(false);
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

  it("以門市POS平均客單與實際達標率預估贈品", () => {
    const sales = [4000, 3500, 2000, 1000].map((amount, index) => ({
      warehouseCode: "R00", shipWarehouseCode: "R00", sku: `P${index}`, date: `2026-09-${String(10 + index).padStart(2, "0")}`,
      transactionTimestamp: `2026-09-${String(10 + index).padStart(2, "0")}T10:00:00`, quantity: 1, deductQuantity: 1,
      actualAmount: amount, posOrder: `POS${index}`, saleType: "銷貨"
    }));
    const result = core.buildSuggestions({
      storeCodes: ["R00"],
      master: { bySku: new Map([["N00144", { sku: "N00144", name: "聯名隨身鏡", style1: "贈品" }]]) },
      inventory: { records: [{ warehouseCode: "T00", sku: "N00144", quantity: 10 }] },
      transfer: { records: [] },
      sales: [{ maxDate: "2026-09-14", records: sales, takeRecords: [] }],
      marketing: { giftActivities: [{ startDate: "2026-09-01", endDate: "2026-09-30", giftSkus: ["N00144"], thresholdType: "amount", thresholdValue: 3000, giftQuantity: 1, cumulative: false, thresholdText: "滿3,000元" }], warnings: [] }
    });
    expect(result.activityRows[0].averageTicket).toBe(2625);
    expect(result.activityRows[0].eligibleRate).toBe(.5);
    expect(result.activityRows[0].forecastOrders).toBe(4);
    expect(result.activityRows[0].suggestedQuantity).toBe(2);
  });
});

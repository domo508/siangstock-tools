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
const core = loadBrowserScript("../procurement-planning/core.js", { XLSX }).ProcurementPlanningCore;

function makeMaster() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["貨號", "品名", "供應商貨號", "供應商簡稱", "進貨價", "最小配貨數", "貨品狀態", "已下架"],
    ["A1", "60天絲測試床包", "V-A1", "普優瑪", 500, 1, "尚可追加", "否"],
    ["A42359-A", "80天絲棉測試床包", "A068-TBA3-5062-00064", "普優瑪", 1035, 1, "尚可追加", "否"],
    ["A2", "60天絲停售床包 60S (S)", "V-A2", "普優瑪", 600, 1, "尚未生產", "否"],
    ["A3", "60天絲正常床包 60S", "V-A3", "普優瑪", 600, 1, "尚可追加", "否"],
    ["A4", "走走多功能收納盒S", "V-A4", "普優瑪", 200, 1, "尚可追加", "否"]
  ]), "工作表1");
  return core.parseProductMasterWorkbook(workbook, XLSX, { fileName: "商品主檔.xlsx" });
}

function makeInventory() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["店倉編號", "店倉名稱", "貨號", "品名", "實際庫存", "實際庫存成本額"],
    ["T00", "寬承總倉", "A1", "60天絲測試床包", 6, 3000],
    ["R00", "台北門市", "A1", "60天絲測試床包", 2, 1000]
  ]), "乾淨商品");
  return core.parseInventoryWorkbook(workbook, XLSX, { fileName: "最新庫存.xlsx" });
}

function makePending() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["單據編碼:", "PR1", "採購日期:", "2026-08-24", "交貨日期:", "2026-08-28"],
    [],
    ["貨號", "品名", "採購價", "數量", "金額", "備註"],
    ["A1", "60天絲測試床包", 500, 5, 2500, "測試"]
  ]), "Sheet1");
  return core.parsePendingPurchaseWorkbook(workbook, XLSX, { fileName: "未到貨採購單.xlsx" });
}

function makeConsignment() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["普優瑪系統", "產品編號", "編號", "貼標名稱", "商品名稱", "規格", "布用量", "配布用量", "成品價", "最新\n庫存\n08/20", "6/5寄庫\n首批預計8月25出貨"],
    ["", "V-A1", "A1", "", "60天絲測試床包", "", "", "", 500, 2, 5],
    ["", "A068-TBA3-5063-00023", "A42359-A", "", "錯誤重複列", "", "", "", 940, 99, 99],
    ["", "A068-TBA3-5062-00064", "A42359-A", "", "80天絲棉測試床包", "", "", "", 1035, 7, 0],
    ["", "A068-TBA3-6062-00064", "A43359-A", "", "已放棄製作品號", "", "", "", 1035, 0, 20],
    ["", "OEM-1", "", "", "一次性代工品", "", "", "", 100, 0, 10]
  ]);
  sheet.K2.s = { fill: { fgColor: { rgb: "FFF4CCCC" } } };
  sheet.K3.s = { fill: { fgColor: { rgb: "FFF4CCCC" } } };
  sheet.K6.s = { fill: { fgColor: { rgb: "FFF4CCCC" } } };
  XLSX.utils.book_append_sheet(workbook, sheet, "庫存+下單");
  return core.parseConsignmentWorkbook(workbook, XLSX, { fileName: "寄倉.xlsx" });
}

function makeSales() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["銷別", "結帳時間", "貨號", "品名", "銷售量", "實收金額", "開單倉編號", "開單倉名稱"],
    ["銷貨", "2026-08-25 12:00:00", "A1", "60天絲測試床包", 38, 38000, "R00", "台北門市"],
    ["訂貨", "2026-08-18 12:00:00", "A1", "60天絲測試床包", 14, 14000, "R01", "台中門市"],
    ["退貨", "2026-08-12 12:00:00", "A1", "60天絲測試床包", -1, -1000, "R00", "台北門市"],
    ["取貨", "2026-08-20 12:00:00", "A1", "60天絲測試床包", 6, 0, "T00", "總倉"],
    ["銷貨", "2025-08-25 12:00:00", "A1", "60天絲測試床包", 10, 10000, "R00", "台北門市"]
  ]), "工作表1");
  return core.parseSalesWorkbook(workbook, XLSX, { fileName: "近年銷售.xlsx" });
}

function makeForecastModel() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["目前活躍SKU模型建議"],
    [],
    [],
    ["ERP品號", "品名", "SKU建議模型", "SKU最佳WAPE", "材質類別", "輔助類別名稱", "類別建議模型", "類別WAPE", "類別可信度"],
    ["A1", "60天絲測試床包", "近期6週", 0.4, "天絲", "天絲｜床包｜5尺床包", "近期70%＋同期30%", 0.25, "高"]
  ]), "SKU模型建議");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["類別需求池回測總覽"],
    [],
    [],
    ["範圍", "材質類別", "類別最佳模型", "類別WAPE", "可信度"],
    ["普優瑪", "天絲", "近期70%＋同期30%", 0.26, "高"]
  ]), "類別模型總覽");
  return core.parseForecastModelWorkbook(workbook, XLSX, { fileName: "季節模型.xlsx" });
}

describe("採購規劃核心鎖定公式", () => {
  it("枕頭本體固定歸四季枕芯，枕套不誤判", () => {
    expect(core.inferMaterialCategory({ mainCategory: "枕頭", style2: "羽絨", name: "PRIMARIO羽絨軟枕" })).toBe("枕芯");
    expect(core.inferMaterialCategory({ mainCategory: "枕芯", name: "機能記憶枕" })).toBe("枕芯");
    expect(core.inferMaterialCategory({ mainCategory: "枕套", style2: "天絲", name: "60天絲枕套2入" })).toBe("天絲");
    expect(core.inferMaterialCategory({ mainCategory: "床包", style2: "天絲", name: "床包組含枕頭套" })).toBe("天絲");
  });

  it("只把品名結尾的獨立括號(S)視為售完即停", () => {
    expect(core.isSellThroughStopName("60天絲床包 60S (S)")).toBe(true);
    expect(core.isSellThroughStopName("60天絲床包 60S（Ｓ）")).toBe(true);
    expect(core.isSellThroughStopName("60天絲床包 60S (S)   ")).toBe(true);
    expect(core.isSellThroughStopName("60天絲床包(S)追加說明")).toBe(false);
    expect(core.isSellThroughStopName("60天絲床包 60S")).toBe(false);
    expect(core.isSellThroughStopName("走走多功能收納盒S")).toBe(false);
    expect(core.isSellThroughStopName("WH-W36BS")).toBe(false);
    expect(core.LOCKED_RULES.sellThroughTransferRule).toContain("不足只顯示缺貨");
    expect(core.LOCKED_RULES.sellThroughTransferRule).toContain("不得轉成供應商採購");
  });

  it("淨採購需求只扣公司庫存與未到貨，絕不扣工廠寄倉", () => {
    const base = core.calculateNetProcurementDemand({
      forecastDemandQty: 20,
      safetyStockQty: 5,
      availableInventoryQty: 8,
      pendingPurchaseQty: 3,
      factoryConsignmentQty: 9999
    });
    const withoutConsignment = core.calculateNetProcurementDemand({
      forecastDemandQty: 20,
      safetyStockQty: 5,
      availableInventoryQty: 8,
      pendingPurchaseQty: 3,
      factoryConsignmentQty: 0
    });
    expect(base).toBe(14);
    expect(withoutConsignment).toBe(14);
  });

  it("小於1且加權分數低於0.5時不採購", () => {
    expect(core.roundSuggestedQuantity(0.8, 0.49)).toBe(0);
    expect(core.roundSuggestedQuantity(0.8, 0.5)).toBe(1);
    expect(core.roundSuggestedQuantity(1.2, 0.2)).toBe(2);
  });

  it("依供應商套用快速補貨、短交期與預設交期分級", () => {
    expect(core.resolveSupplyProfile("普優瑪寢具有限公司")).toMatchObject({
      key: "puyouma", leadDays: 5, safetyBufferDays: { "熱銷": 7, "穩定": 4, "低銷": 0 }
    });
    expect(core.resolveSupplyProfile("力榮興業")).toMatchObject({
      key: "shortLead", leadDays: 14, safetyBufferDays: { "熱銷": 7, "穩定": 0, "低銷": 0 }
    });
    expect(core.resolveSupplyProfile("尚未建檔供應商")).toMatchObject({ key: "default", leadDays: 14 });
  });

  it("依供應商檢視期分級，0天只保留人工判斷", () => {
    const rules = [
      { name: "潤泰羽絨", leadDays: 70, reviewPeriod: "90-120", paymentRule: "採購當月30%、到貨月份70%" },
      { name: "歐必斯", leadDays: 10, reviewPeriod: 0, paymentRule: "採購當月100%" }
    ];
    expect(core.resolveSupplyProfile("潤泰羽絨", rules, "熱銷")).toMatchObject({ reviewDays: 90, leadDays: 70, manualReview: false });
    expect(core.resolveSupplyProfile("潤泰羽絨", rules, "穩定")).toMatchObject({ reviewDays: 105, leadDays: 70, manualReview: false });
    expect(core.resolveSupplyProfile("潤泰羽絨", rules, "低銷")).toMatchObject({ reviewDays: 120, leadDays: 70, manualReview: false });
    expect(core.resolveSupplyProfile("歐必斯", rules, "熱銷")).toMatchObject({ reviewDays: 0, leadDays: 10, manualReview: true });
  });

  it("寄倉不足只產生寄庫缺口，不改向其他供應商", () => {
    expect(core.evaluateConsignmentSupply({ confirmedPurchaseQty: 10, currentConsignmentQty: 12, scheduledBeforeDueQty: 0 })).toEqual({
      currentGap: 0, gapAfterSchedule: 0, status: "現有寄倉可直接覆蓋"
    });
    expect(core.evaluateConsignmentSupply({ confirmedPurchaseQty: 10, currentConsignmentQty: 3, scheduledBeforeDueQty: 7 }).status).toBe("排程量可覆蓋；交期待確認");
    expect(core.evaluateConsignmentSupply({ confirmedPurchaseQty: 10, currentConsignmentQty: 3, scheduledBeforeDueQty: 2 })).toEqual({
      currentGap: 7, gapAfterSchedule: 5, status: "缺貨警示：需新增寄庫單"
    });
  });

  it("採購預算顯示預估可採購、已採購與尚可採購", () => {
    expect(core.calculatePurchaseBudget({
      forecastCostOutflow: 4000000,
      targetEndingInventoryCost: 11000000,
      openingInventoryCost: 10500000,
      expectedSupplierReturns: 50000,
      purchasedAmountToDate: 1200000
    })).toEqual({ availableBudget: 4550000, purchasedAmountToDate: 1200000, remainingBudget: 3350000 });
  });

  it("上林固定28天檢視，付款依國內到貨或國外出貨月份分配且守恆", () => {
    expect(core.resolveSupplyProfile("上林實業", [], "穩定")).toMatchObject({ reviewDays: 28, leadDays: 5 });
    const domestic = core.calculatePaymentSchedule({ supplier: "力榮", orderDate: "2026-09-20", amount: 123380, confirmedQty: 290, consignmentAvailableQty: 300, supplyMode: "consignment" });
    expect(domestic).toMatchObject({ status: "PASS", supplierCountry: "國內", expectedArrivalDate: "2026-09-25" });
    expect(domestic.entries).toEqual([{ trigger: "預計到貨100%", date: "2026-09-25", month: "2026-09", amount: 123380 }]);
    const foreign = core.calculatePaymentSchedule({ supplier: "凱信達", orderDate: "2026-09-20", amount: 100000 });
    expect(foreign).toMatchObject({ supplierCountry: "國外", expectedShipmentDate: "2026-11-29" });
    expect(foreign.entries.map((row) => row.amount)).toEqual([30000, 70000]);
    expect(foreign.entries.reduce((sum, row) => sum + row.amount, 0)).toBe(100000);
  });

  it("力榮逐品號使用10件單位，不跨品號湊數", () => {
    expect(core.roundByPack(14, 10, 20, 14)).toMatchObject({ down: 10, up: 20, quantity: 10, direction: "向下" });
    expect(core.roundByPack(14, 10, 10, 14)).toMatchObject({ down: 10, up: 20, quantity: 20, direction: "向上" });
  });
});

describe("四來源匯入與品號串接", () => {
  it("解析商品主檔、清理後庫存與標準採購單", () => {
    const master = makeMaster();
    const inventory = makeInventory();
    const pending = makePending();
    expect(master.bySku.get("A1")).toMatchObject({ supplierSku: "V-A1", unitCost: 500 });
    expect(master.bySku.get("A2")).toMatchObject({ sellThroughStop: true, externalPurchaseBlocked: true, discontinued: false });
    expect(master.bySku.get("A3")).toMatchObject({ sellThroughStop: false, externalPurchaseBlocked: false, discontinued: false });
    expect(master.bySku.get("A4")).toMatchObject({ sellThroughStop: false, externalPurchaseBlocked: false, discontinued: false });
    expect(inventory.bySku.get("A1").quantity).toBe(8);
    expect(inventory.bySku.get("A1").inventoryCost).toBe(4000);
    expect(pending.records[0]).toMatchObject({ sku: "A1", quantity: 5, amount: 2500 });
    expect(pending.metadata).toMatchObject({ documentCode: "PR1", purchaseDate: "2026-08-24", deliveryDate: "2026-08-28" });
  });

  it("辨識粉紅底未完成量、套用A42359-A正確列並固定排除A43359-A", () => {
    const consignment = makeConsignment();
    expect(consignment.styleAudit).toMatchObject({ pinkDetected: true, pinkCells: 2 });
    expect(consignment.records.find((row) => row.sku === "A1")).toMatchObject({ currentQty: 2, scheduledQty: 5 });
    expect(consignment.records.find((row) => row.sku === "A42359-A")).toMatchObject({ supplierSku: "A068-TBA3-5062-00064", currentQty: 7 });
    expect(consignment.records.some((row) => row.name === "錯誤重複列")).toBe(false);
    expect(consignment.records.some((row) => row.sku === "A43359-A")).toBe(false);
    expect(consignment.exceptions).toHaveLength(0);
    expect(consignment.confirmedExclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "已確認重複品號", sourceRow: 3, sku: "A42359-A" }),
      expect.objectContaining({ type: "已確認放棄品號", sourceRow: 5, sku: "A43359-A" })
    ]));
  });

  it("人工黑名單優先排除一次性代工品", () => {
    const resolved = core.resolveConsignment(makeConsignment(), makeMaster(), ["一次性代工品"]);
    expect(resolved.excluded).toHaveLength(1);
    expect(resolved.excluded[0]).toMatchObject({ supplierSku: "OEM-1", reason: "人工黑名單" });
    expect(resolved.exceptions.some((row) => row.type === "缺ERP品號")).toBe(false);
  });

  it("產出可稽核四頁籤且保留日期不同警示", () => {
    const analysis = core.buildAnalysis({
      master: makeMaster(),
      inventory: makeInventory(),
      pendingReports: [makePending()],
      consignment: makeConsignment(),
      blacklist: ["一次性代工品"],
      dates: { inventory: "2026-06-30", pending: "2026-08-24", consignment: "2026-08-20" }
    });
    expect(analysis.dateCheck).toMatchObject({ status: "REVIEW", gapDays: 55 });
    expect(analysis.rows[0]).toMatchObject({ sku: "A1", inventoryQty: 8, consignmentCurrentQty: 2, consignmentScheduledQty: 5, gapAfterSchedule: 0 });
    expect(analysis.totals).toMatchObject({ skuCount: 1, pendingQty: 5, pendingAmount: 2500, consignmentMatched: 1, exceptionCount: 0, confirmedExclusionCount: 2, excludedCount: 1 });
    const output = core.buildOutputWorkbook(analysis, XLSX);
    expect(output.SheetNames).toEqual(["01_資料摘要", "02_品號串接", "03_例外清單", "04_核心規則"]);
    const rules = XLSX.utils.sheet_to_json(output.Sheets["04_核心規則"], { header: 1, defval: "" });
    expect(rules.some((row) => String(row[1]).includes("不得扣減淨採購需求"))).toBe(true);
    expect(rules.some((row) => row[0] === "A43359-A" && String(row[1]).includes("已放棄"))).toBe(true);
    const serialized = XLSX.write(output, { type: "array", bookType: "xlsx", compression: true });
    expect(serialized.byteLength).toBeGreaterThan(1000);
  });

  it("同時點相差14天內才通過日期檢核", () => {
    expect(core.validateSourceDates({ inventory: "2026-08-20", pending: "2026-08-24", consignment: "2026-08-21" })).toMatchObject({ status: "PASS", gapDays: 4 });
    expect(core.validateSourceDates({ inventory: "", pending: "2026-08-24", consignment: "" }).status).toBe("REVIEW");
  });
});

describe("採購建議第二階段", () => {
  it("品名結尾(S)保留需求資料，但不進對外採購或寄庫建議", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["銷別", "結帳時間", "貨號", "品名", "銷售量", "實收金額", "開單倉編號", "開單倉名稱"],
      ["銷貨", "2026-08-25 12:00:00", "A2", "60天絲停售床包 60S (S)", 30, 30000, "R00", "台北門市"]
    ]), "工作表1");
    const recommendations = core.buildProcurementRecommendations({
      master: makeMaster(),
      inventory: makeInventory(),
      pendingReports: [],
      consignment: makeConsignment(),
      salesReports: [core.parseSalesWorkbook(workbook, XLSX, { fileName: "停售品銷售.xlsx" })],
      model: null,
      blacklist: [],
      asOfDate: "2026-08-28",
      factoryTargetDays: 105
    });
    const stoppedRow = recommendations.rows.find((row) => row.sku === "A2");
    expect(stoppedRow).toMatchObject({
      sellThroughStop: true,
      externalPurchaseBlocked: true,
      suggestedPurchaseQty: 0,
      suggestedConsignmentQty: 0
    });
    expect(stoppedRow.recent6Qty).toBe(30);
    expect(stoppedRow.supplyStatus).toContain("可用總倉現貨銷售或調撥");
    expect(recommendations.suggestedRows.some((row) => row.sku === "A2")).toBe(false);
    expect(recommendations.consignmentRows.some((row) => row.sku === "A2")).toBe(false);
    expect(recommendations.totals.sellThroughStopExcludedCount).toBe(1);
    expect(recommendations.productExclusions[0]).toMatchObject({ sku: "A2", type: "品名結尾停採標記(S)" });
    const output = core.buildRecommendationWorkbook(recommendations, XLSX);
    const exclusions = XLSX.utils.sheet_to_json(output.Sheets["07_排除與例外"], { defval: "" });
    expect(exclusions.some((row) => row["ERP品號"] === "A2" && String(row["處理方式"]).includes("保留線上銷售"))).toBe(true);
  });

  it("銷售需求排除取貨，保留銷貨、訂貨與退貨", () => {
    const sales = makeSales();
    expect(sales.records).toHaveLength(4);
    expect(sales.excluded["排除銷別：取貨"]).toBe(1);
    expect(sales.records.filter((row) => row.date.startsWith("2026")).reduce((sum, row) => sum + row.quantity, 0)).toBe(51);
  });

  it("讀取SKU與類別模型並產生採購、寄庫與缺貨警示", () => {
    const recommendations = core.buildProcurementRecommendations({
      master: makeMaster(),
      inventory: makeInventory(),
      pendingReports: [makePending()],
      consignment: makeConsignment(),
      salesReports: [makeSales()],
      model: makeForecastModel(),
      blacklist: ["一次性代工品"],
      asOfDate: "2026-08-28",
      checkpoint: "month-start",
      factoryTargetDays: 105
    });
    const row = recommendations.rows.find((item) => item.sku === "A1");
    expect(row).toMatchObject({
      recent6Qty: 51,
      lastYear6Qty: 10,
      abcClass: "A",
      purchaseTab: "天絲＋天絲棉",
      pendingQty: 5,
      inventoryQty: 8,
      supplyProfileKey: "puyouma",
      supplierLeadDays: 5,
      safetyBufferDays: 4,
      targetCoverageDays: 23,
      factoryTargetDays: 105
    });
    expect(recommendations.checkpoint).toBe("month-start");
    expect(row.suggestedPurchaseQty).toBeGreaterThan(0);
    expect(row.suggestedConsignmentQty).toBeGreaterThan(0);
    expect(row.supplyStatus).toContain("缺貨警示");
    expect(recommendations.totals.suggestedPurchaseAmount).toBe(row.suggestedPurchaseQty * 500);
  });

  it("建議Excel依普優瑪三類分頁並保留人工確認空白欄", () => {
    const recommendations = core.buildProcurementRecommendations({
      master: makeMaster(),
      inventory: makeInventory(),
      pendingReports: [makePending()],
      consignment: makeConsignment(),
      salesReports: [makeSales()],
      model: makeForecastModel(),
      blacklist: ["一次性代工品"],
      asOfDate: "2026-08-28",
      factoryTargetDays: 90
    });
    const output = core.buildRecommendationWorkbook(recommendations, XLSX);
    expect(output.SheetNames).toEqual([
      "01_採購摘要", "02_全部採購建議", "03A_力榮採購", "03B1_普優瑪_天絲",
      "03B2_普優瑪_長絨棉", "03B3_普優瑪_無尺寸", "03C_上林採購", "03D_其它供應商",
      "04A_普優瑪寄庫建議", "04B_力榮寄庫建議", "05_新品採購建議", "06_普優瑪新品寄庫",
      "07_排除與例外", "08_核心規則"
    ]);
    const rows = XLSX.utils.sheet_to_json(output.Sheets["03B1_普優瑪_天絲"], { defval: "" });
    expect(rows[0]["建議採購量"]).toBeGreaterThan(0);
    expect(rows[0]["人工確認採購量"]).toBe("");
    expect(rows[0]).toMatchObject({ "供應交期類型": "寄倉快速補貨", "到貨交期天數": 5, "目標覆蓋天數": 23 });
    expect(output.Sheets["03B1_普優瑪_天絲"]["!protect"]).toBeTruthy();
    const protectedHeaders = XLSX.utils.sheet_to_json(output.Sheets["03B1_普優瑪_天絲"], { header: 1, defval: "" })[0];
    const manualCell = output.Sheets["03B1_普優瑪_天絲"][XLSX.utils.encode_cell({ r: 1, c: protectedHeaders.indexOf("人工確認採購量") })];
    const totalCell = output.Sheets["03B1_普優瑪_天絲"][XLSX.utils.encode_cell({ r: 1, c: protectedHeaders.indexOf("加總需求（鎖定公式）") })];
    expect(manualCell.s.protection.locked).toBe(false);
    expect(totalCell.s.protection.locked).toBe(true);
    const rules = XLSX.utils.sheet_to_json(output.Sheets["08_核心規則"], { header: 1, defval: "" });
    expect(rules.some((row) => row[0] === "普優瑪採購與寄庫" && String(row[1]).includes("120／穩定105／低銷90天"))).toBe(true);
    expect(rules.some((row) => row[0] === "力榮採購與寄庫" && String(row[1]).includes("每品號0或10的倍數"))).toBe(true);
    expect(rules.some((row) => row[0] === "上林檢視期" && String(row[1]).includes("固定28天"))).toBe(true);
    const summary = XLSX.utils.sheet_to_json(output.Sheets["01_採購摘要"], { header: 1, defval: "" });
    expect(summary.some((row) => row[0] === "四來源日期檢核" && row[1] === "未提供")).toBe(true);
    expect(summary.some((row) => row[0] === "使用限制" && String(row[1]).includes("不可直接下單"))).toBe(true);
  });

  it("人工回匯後產生可售至、AI判斷、付款月份與ERP核准門檻", () => {
    const recommendations = core.buildProcurementRecommendations({
      master: makeMaster(), inventory: makeInventory(), pendingReports: [makePending()], consignment: makeConsignment(),
      salesReports: [makeSales()], model: makeForecastModel(), blacklist: ["一次性代工品"], asOfDate: "2026-08-28"
    });
    const workbook = core.buildRecommendationWorkbook(recommendations, XLSX);
    const sheet = workbook.Sheets["03B1_普優瑪_天絲"];
    const headers = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })[0];
    const manualColumn = headers.indexOf("人工確認採購量");
    const reasonColumn = headers.indexOf("人工調整原因");
    sheet[XLSX.utils.encode_cell({ r: 1, c: manualColumn })] = { t: "n", v: 20 };
    sheet[XLSX.utils.encode_cell({ r: 1, c: reasonColumn })] = { t: "s", v: "人工調整測試" };
    const review = core.reviewReturnedWorkbook(workbook, XLSX, { asOfDate: "2026-08-28", orderDate: "2026-09-20" });
    expect(review.errors).toHaveLength(0);
    expect(review.rows[0]).toMatchObject({ confirmedQty: 20, finalQty: 20, availableTo: expect.stringMatching(/^2026-/) });
    expect(["合理", "偏高", "偏低"]).toContain(review.rows[0].aiJudgment);
    expect(review.payments[0]).toMatchObject({ supplierCountry: "國內" });
    expect(() => core.buildErpPurchaseWorkbook(review, XLSX)).toThrow("尚未完成正式核准");
    expect(core.buildErpPurchaseWorkbook(review, XLSX, { approved: true, batchId: "PP-TEST" }).SheetNames.length).toBeGreaterThan(0);
  });

  it("二次覆核必須逐列明確確認，且會重算最終核准金額", () => {
    const recommendations = core.buildProcurementRecommendations({
      master: makeMaster(), inventory: makeInventory(), pendingReports: [makePending()], consignment: makeConsignment(),
      salesReports: [makeSales()], model: makeForecastModel(), blacklist: ["一次性代工品"], asOfDate: "2026-08-28"
    });
    const recommendation = core.buildRecommendationWorkbook(recommendations, XLSX);
    const firstSheet = recommendation.Sheets["03B1_普優瑪_天絲"];
    const firstHeaders = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" })[0];
    firstSheet[XLSX.utils.encode_cell({ r: 1, c: firstHeaders.indexOf("人工確認採購量") })] = { t: "n", v: 20 };
    firstSheet[XLSX.utils.encode_cell({ r: 1, c: firstHeaders.indexOf("人工調整原因") })] = { t: "s", v: "第一次人工判斷" };
    const firstReview = core.reviewReturnedWorkbook(recommendation, XLSX, { asOfDate: "2026-08-28", orderDate: "2026-09-20" });
    const secondWorkbook = core.buildSecondReviewWorkbook(firstReview, XLSX);
    expect(core.reviewSecondApprovalWorkbook(secondWorkbook, XLSX, { asOfDate: "2026-08-28", orderDate: "2026-09-20" }).errors[0].message).toContain("必須填寫二次確認");
    const secondSheet = secondWorkbook.Sheets["02_二次覆核"];
    const secondHeaders = XLSX.utils.sheet_to_json(secondSheet, { header: 1, defval: "" })[0];
    secondSheet[XLSX.utils.encode_cell({ r: 1, c: secondHeaders.indexOf("二次確認採購量") })] = { t: "n", v: 22 };
    secondSheet[XLSX.utils.encode_cell({ r: 1, c: secondHeaders.indexOf("二次確認原因") })] = { t: "s", v: "供應商臨時可追加" };
    const finalReview = core.reviewSecondApprovalWorkbook(secondWorkbook, XLSX, { asOfDate: "2026-08-28", orderDate: "2026-09-20" });
    expect(finalReview.errors).toHaveLength(0);
    expect(finalReview.rows[0]).toMatchObject({ finalQty: 22, approvedAmount: 11000, aiJudgment: expect.any(String) });
    expect(finalReview.totals.approvedAmount).toBe(11000);
  });
});

describe("採購規劃前台與入口", () => {
  it("首頁提供工具入口，工具頁保留麵包屑、返回與本機處理說明", () => {
    const homeHtml = readFileSync("../index.html", "utf8");
    const toolHtml = readFileSync("../procurement-planning/index.html", "utf8");
    expect(homeHtml).toContain('href="/procurement-planning/"');
    expect(homeHtml).toContain("庫存採購規劃");
    expect(toolHtml).toContain("公司工具首頁");
    expect(toolHtml).toContain("← 返回公司工具首頁");
    expect(toolHtml).toContain("原始Excel不上傳");
    expect(toolHtml).toContain("工廠寄倉可拉貨量不在這個扣除公式中");
    expect(toolHtml).toContain("目標覆蓋＝供應商檢視期＋到貨交期＋分級安全緩衝");
    expect(readFileSync("../procurement-planning/app.js", "utf8")).toContain("nodim: true");
    expect(toolHtml).toContain("公司 Google 授權");
    expect(toolHtml).toContain("正式核准並寄送摘要");
    expect(toolHtml).toContain("回匯二次確認版");
    expect(toolHtml).toContain("重送摘要郵件");
    expect(toolHtml).toContain("儲存本月額度");
    expect(toolHtml).toContain("已核准月份快照優先沿用");
    const toolApp = readFileSync("../procurement-planning/app.js", "utf8");
    expect(toolApp).toContain("/api/procurement/month-plan");
    const toolCss = readFileSync("../procurement-planning/style.css", "utf8");
    expect(toolCss).toContain("@media (max-width: 620px)");
    expect(toolCss).toMatch(/\.procurement-period,[\s\S]*\.budget-grid,[\s\S]*\.procurement-summary,[\s\S]*\.budget-summary \{ grid-template-columns: 1fr; \}/);
  });

  it("9月歷史接續資料固定為可追溯月份快照且不補寄舊通知", () => {
    const migration = readFileSync("worker/migrations/0003_procurement_month_plan_and_history.sql", "utf8");
    expect(migration).toContain("5936068.44");
    expect(migration).toContain("2659538.30");
    expect(migration).toContain("1329769.15");
    expect(migration).toContain("166750.60");
    expect(migration).toContain("84040");
    expect(migration).toContain("259110");
    expect(migration).toContain("123380");
    expect(migration).toContain("歷史匯入不建立通知工作");
    expect(migration).not.toContain("INSERT INTO procurement_notifications");
  });
});

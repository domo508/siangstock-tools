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

const xlsxContext = loadBrowserScript("../procurement-planning/assets/xlsx-js-style.bundle.js");
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
  it("只以明確客製備註辨識客訂，並排除一般未到貨淨需求", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["單據編碼:", "ERP-CUSTOM-1", "採購日期:", "2026-09-14", "廠商名稱:", "普優瑪", "備註:", "台北/新竹 客製"],
      [],
      ["貨號", "品名", "採購價", "數量", "金額", "備註"],
      ["A1", "客戶特殊尺寸", 500, 2, 1000, "台北"],
      ["A3", "拍照樣但非客製", 600, 1, 600, "新竹"]
    ]), "Sheet1");
    const report = core.parsePendingPurchaseWorkbook(workbook, XLSX, { fileName: "客製單.xlsx" });
    expect(report.metadata).toMatchObject({ documentCode: "ERP-CUSTOM-1", supplier: "普優瑪", isCustomOrder: true });
    expect(report.records.every((row) => row.isCustomOrder)).toBe(true);
    expect(report.records[0].customChannel).toBe("台北");
    const pending = core.aggregatePendingReports([report]);
    expect(pending.bySku.size).toBe(0);
    expect(pending.customRecords).toHaveLength(2);
  });

  it("新品首批名單需含上市日、通路與首月預估量", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["ERP品號", "預計／實際上市日", "預計販售通路或門市", "首月預估量", "相似品號", "是否已納入行銷預估"],
      ["A1", "2026-09-20", "官網、台北門市", 30, "A42359-A", "是"]
    ]), "新品名單");
    const parsed = core.parseNewProductWorkbook(workbook, XLSX, { fileName: "新品.xlsx" });
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.records[0]).toMatchObject({ sku: "A1", listedDate: "2026-09-20", channels: "官網、台北門市", firstMonthQty: 30, similarSku: "A42359-A" });
  });

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

  it("春節停工備貨只在國外供應商的補貨範圍跨入停工期時啟動", () => {
    const rule = { enabled: true, closureStart: "2027-01-16", recoveryDate: "2027-02-28", extraDays: 53 };
    expect(core.resolveSpringFestivalAdjustment({ asOfDate: "2026-09-14", supplierCountry: "國外", horizonDays: 175, rule })).toMatchObject({ active: true, extraDays: 53 });
    expect(core.resolveSpringFestivalAdjustment({ asOfDate: "2026-09-14", supplierCountry: "國內", horizonDays: 175, rule }).active).toBe(false);
    expect(core.resolveSpringFestivalAdjustment({ asOfDate: "2026-09-14", supplierCountry: "國外", horizonDays: 30, rule }).active).toBe(false);
    expect(core.resolveSpringFestivalAdjustment({ asOfDate: "2027-03-01", supplierCountry: "國外", horizonDays: 175, rule }).active).toBe(false);
  });

  it("預設供應商規則保留0903檢視期與後續確認的上林28天", () => {
    expect(core.resolveSupplyProfile("潤泰羽絨", [], "熱銷")).toMatchObject({ reviewDays: 90, leadDays: 70 });
    expect(core.resolveSupplyProfile("潤泰羽絨", [], "穩定")).toMatchObject({ reviewDays: 105, leadDays: 70 });
    expect(core.resolveSupplyProfile("尚美", [], "穩定")).toMatchObject({ reviewDays: 60, leadDays: 7 });
    expect(core.resolveSupplyProfile("昭元棉業", [], "熱銷")).toMatchObject({ reviewDays: 90, leadDays: 50 });
    expect(core.resolveSupplyProfile("上林", [], "穩定")).toMatchObject({ reviewDays: 28, leadDays: 5 });
    expect(core.resolveSupplyProfile("南通泰而逸纺织品有限公司", [], "熱銷")).toMatchObject({ reviewDays: 0, leadDays: 30, manualReview: true });
  });

  it("供應商選單保留五家主要供應商並把零建議與阻擋廠商列入其它", () => {
    const analysis = {
      suggestedRows: [{ supplier: "潤泰羽絨", suggestedPurchaseAmount: 6122 }],
      rows: [
        { supplier: "潤泰羽絨", externalPurchaseBlocked: false, manualSupplierReview: false },
        { supplier: "泰能脊康", externalPurchaseBlocked: true, manualSupplierReview: false },
        { supplier: "新供應商", externalPurchaseBlocked: false, manualSupplierReview: false }
      ],
      productExclusions: []
    };
    const catalog = core.supplierSelectionCatalog(analysis, core.SUPPLIER_RULES);
    expect(catalog.primary.map((item) => item.name)).toEqual(["普優瑪寢具有限公司", "力榮", "上林", "潤泰羽絨", "泰能脊康"]);
    expect(catalog.primary.find((item) => item.name === "泰能脊康")).toMatchObject({ suggestedCount: 0, reviewCount: 1 });
    expect(catalog.other.some((item) => item.name === "家禾")).toBe(true);
    expect(catalog.other.some((item) => item.name === "新供應商")).toBe(true);
    const managed = core.supplierSelectionCatalog(analysis, core.SUPPLIER_RULES, ["家禾"]);
    expect(managed.primary.map((item) => item.name)).toEqual(["家禾"]);
    expect(managed.other.some((item) => item.name === "潤泰羽絨")).toBe(true);
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

  it("集中採購單位可覆寫普優瑪箱入數，未確認的其它品項回到單件", () => {
    const rules = [
      { supplier: "普優瑪寢具有限公司", ruleName: "床包5尺", matchText: "床包|5尺", quantity: 20, enabled: true },
      { supplier: "普優瑪寢具有限公司", ruleName: "其它品項", matchText: "特殊新品", quantity: null, enabled: true }
    ];
    expect(core.purchaseUnitFromRules("普優瑪", { name: "60天絲床包", size: "5尺" }, "", rules)).toBe(20);
    expect(core.purchaseUnitFromRules("普優瑪", { name: "特殊新品" }, "", rules)).toBe(1);
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

  it("依力榮線上表單現行欄名辨識日期庫存與新增完工排程", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["翔仔貨號", "翔仔品名", "成品價", "9/1庫存", "9/2新增\n預計9/16完工"],
      ["A42349-A", "5尺床包 [沐堇 A]", "", 40, 40],
      ["A43349-A", "6尺床包 [沐堇 A]", "", 0, 40]
    ]), "工作表1");
    const consignment = core.parseLirongConsignmentWorkbook(workbook, XLSX, { fileName: "翔仔 X 力榮寄庫" });
    expect(consignment.records).toEqual([
      expect.objectContaining({ sku: "A42349-A", name: "5尺床包 [沐堇 A]", currentQty: 40, scheduledQty: 40 }),
      expect.objectContaining({ sku: "A43349-A", name: "6尺床包 [沐堇 A]", currentQty: 0, scheduledQty: 40 })
    ]);
    expect(consignment.records[0].scheduleNotes).toEqual(["9/2新增\n預計9/16完工"]);
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
  it("人工匯入採購單保留草稿量並共用兩次回匯欄位", () => {
    const base = core.buildProcurementRecommendations({
      master: makeMaster(), inventory: makeInventory(), pendingReports: [makePending()], consignment: makeConsignment(),
      salesReports: [makeSales()], model: makeForecastModel(), blacklist: [], asOfDate: "2026-08-28"
    });
    const special = core.buildSpecialProcurementAnalysis({
      baseAnalysis: base, workflowType: "manual_draft", rows: [{ sku: "A1", quantity: 27 }], fileName: "人工草稿.xlsx",
      master: makeMaster(), inventory: makeInventory(), pendingReports: [makePending()], supplierRules: core.SUPPLIER_RULES
    });
    expect(special.meta).toMatchObject({ workflowType: "manual_draft", workflowLabel: "人工匯入採購單" });
    expect(special.rows[0]).toMatchObject({ initialManualQty: 27, initialManualReason: "人工匯入採購草稿" });
    const output = core.buildRecommendationWorkbook(special, XLSX);
    const row = XLSX.utils.sheet_to_json(output.Sheets["03B1_普優瑪_天絲"], { defval: "" })[0];
    expect(row["人工確認採購量"]).toBe(27);
    expect(row["人工調整原因"]).toBe("人工匯入採購草稿");
  });

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
    expect(sales.takeRecords).toHaveLength(1);
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
      inventoryQty: 6,
      supplyProfileKey: "puyouma",
      supplierLeadDays: 5,
      safetyBufferDays: 4,
      targetCoverageDays: 23,
      factoryTargetDays: 105
    });
    expect(row.storeInventoryByCode.R00).toBe(2);
    expect(row.tier).toBe("穩定");
    expect(row.releaseRate).toBe(0.5);
    expect(recommendations.appliedRules.releaseRates).toEqual({ "熱銷": 0.7, "穩定": 0.5, "低銷": 0 });
    expect(recommendations.checkpoint).toBe("month-start");
    expect(row.suggestedPurchaseQty).toBeGreaterThan(0);
    expect(row.suggestedConsignmentQty).toBeGreaterThan(0);
    expect(row.supplyStatus).toContain("缺貨警示");
    expect(recommendations.totals.suggestedPurchaseAmount).toBe(row.suggestedPurchaseQty * 500);
  });

  it("月初依70／50／0分批釋放，月中則依最新缺口完整重算", () => {
    const source = {
      master: makeMaster(), inventory: makeInventory(), pendingReports: [makePending()], consignment: makeConsignment(),
      salesReports: [makeSales()], model: makeForecastModel(), blacklist: [], asOfDate: "2026-08-28"
    };
    const monthStart = core.buildProcurementRecommendations({ ...source, checkpoint: "month-start" }).rows.find((row) => row.sku === "A1");
    const midMonth = core.buildProcurementRecommendations({ ...source, checkpoint: "mid-month" }).rows.find((row) => row.sku === "A1");
    expect(monthStart.releaseRate).toBe(0.5);
    expect(midMonth.releaseRate).toBe(1);
    expect(midMonth.suggestedPurchaseQty).toBeGreaterThanOrEqual(monthStart.suggestedPurchaseQty);
  });

  it("國外供應商跨春節停工期時完整加入53天需求，並在報表分開揭露額度影響", () => {
    const master = makeMaster();
    master.records.find((row) => row.sku === "A1").supplier = "潤泰羽絨";
    const source = {
      master, inventory: makeInventory(), pendingReports: [makePending()], consignment: makeConsignment(),
      salesReports: [makeSales()], model: makeForecastModel(), blacklist: [], asOfDate: "2026-09-14", checkpoint: "month-start",
      supplierRules: core.SUPPLIER_RULES
    };
    const disabled = core.buildProcurementRecommendations({ ...source, springFestivalRule: { enabled: false, closureStart: "2027-01-16", recoveryDate: "2027-02-28", extraDays: 53 } });
    const adjusted = core.buildProcurementRecommendations({ ...source, springFestivalRule: { enabled: true, closureStart: "2027-01-16", recoveryDate: "2027-02-28", extraDays: 53 } });
    const baseRow = disabled.rows.find((row) => row.sku === "A1");
    const row = adjusted.rows.find((item) => item.sku === "A1");
    expect(row.springFestivalApplied).toBe(true);
    expect(row.springFestivalExtraDays).toBe(53);
    expect(row.standardSuggestedPurchaseQty).toBe(baseRow.suggestedPurchaseQty);
    expect(row.springFestivalExtraSuggestedQty).toBe(row.suggestedPurchaseQty - row.standardSuggestedPurchaseQty);
    expect(row.springFestivalExtraSuggestedQty).toBeGreaterThan(0);
    expect(row.springFestivalExtraAmount).toBe(row.springFestivalExtraSuggestedQty * row.unitCost);
    expect(adjusted.totals).toMatchObject({ springFestivalSkuCount: 1, springFestivalExtraQty: row.springFestivalExtraSuggestedQty, springFestivalExtraAmount: row.springFestivalExtraAmount });

    const output = core.buildRecommendationWorkbook(adjusted, XLSX);
    const summary = XLSX.utils.sheet_to_json(output.Sheets["01_採購摘要"], { header: 1, defval: "" });
    expect(summary).toContainEqual(["春節額外採購金額", row.springFestivalExtraAmount, "已包含在建議採購金額與額度影響內"]);
    const report = XLSX.utils.sheet_to_json(output.Sheets["03D_其它供應商"], { defval: "" })[0];
    expect(report).toMatchObject({ "春節備貨規則": "是", "春節額外備貨天數": 53, "春節額外建議量": row.springFestivalExtraSuggestedQty, "調整前建議採購量": row.standardSuggestedPurchaseQty });
  });

  it("貨品狀態空白仍顯示試算建議，但第一次回匯必須明確填量與原因", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["貨號", "品名", "供應商貨號", "供應商簡稱", "進貨價", "最小配貨數", "貨品狀態", "已下架"],
      ["A1", "60天絲測試床包", "V-A1", "普優瑪", 500, 1, "", "否"]
    ]), "工作表1");
    const master = core.parseProductMasterWorkbook(workbook, XLSX, { fileName: "商品主檔.xlsx" });
    const recommendations = core.buildProcurementRecommendations({
      master, inventory: makeInventory(), pendingReports: [makePending()], consignment: makeConsignment(),
      salesReports: [makeSales()], model: makeForecastModel(), blacklist: [], asOfDate: "2026-08-28", checkpoint: "month-start"
    });
    const row = recommendations.rows.find((item) => item.sku === "A1");
    expect(row).toMatchObject({ productStatus: "", productStatusPendingReview: true, externalPurchaseBlocked: false });
    expect(row.suggestedPurchaseQty).toBeGreaterThan(0);
    expect(row.supplyStatus).toContain("已保留試算建議量");
    expect(recommendations.suggestedRows.some((item) => item.sku === "A1")).toBe(true);
    expect(recommendations.productExclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: "A1", type: "貨品狀態空白待人工確認" })
    ]));

    const output = core.buildRecommendationWorkbook(recommendations, XLSX);
    const sheet = output.Sheets["03B1_普優瑪_天絲"];
    const firstRow = XLSX.utils.sheet_to_json(sheet, { defval: "" })[0];
    expect(firstRow).toMatchObject({ "貨品狀態": "空白（待人工確認）", "人工確認要求": "必須明確填寫採購量與原因" });
    const baselineBySku = new Map(recommendations.rows.map((item) => [item.sku, item]));
    const blockedReview = core.reviewReturnedWorkbook(output, XLSX, { asOfDate: "2026-08-28", orderDate: "2026-09-20", baselineBySku });
    expect(blockedReview.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("必須明確填寫人工確認採購量"),
      expect.stringContaining("人工調整原因必填")
    ]));

    const headers = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })[0];
    sheet[XLSX.utils.encode_cell({ r: 1, c: headers.indexOf("人工確認採購量") })] = { t: "n", v: row.suggestedPurchaseQty };
    sheet[XLSX.utils.encode_cell({ r: 1, c: headers.indexOf("人工調整原因") })] = { t: "s", v: "貨品狀態空白，採購人工確認仍可追加" };
    const confirmedReview = core.reviewReturnedWorkbook(output, XLSX, { asOfDate: "2026-08-28", orderDate: "2026-09-20", baselineBySku });
    expect(confirmedReview.errors).toHaveLength(0);
    expect(confirmedReview.rows[0]).toMatchObject({ productStatusPendingReview: true, finalQty: row.suggestedPurchaseQty });

    const special = core.buildSpecialProcurementAnalysis({
      baseAnalysis: recommendations, workflowType: "new_product", rows: [{ sku: "A1", firstMonthQty: 30, channels: "官網" }],
      fileName: "新品.xlsx", master, inventory: makeInventory(), pendingReports: [makePending()], supplierRules: core.SUPPLIER_RULES
    });
    expect(special.rows[0]).toMatchObject({ productStatusPendingReview: true });
    expect(special.rows[0].suggestedPurchaseQty).toBeGreaterThan(0);
  });

  it("通路營收倍率參與逐店需求，寬沐45%只另列管理參考", () => {
    const recommendations = core.buildProcurementRecommendations({
      master: makeMaster(), inventory: makeInventory(), pendingReports: [makePending()], consignment: makeConsignment(),
      salesReports: [makeSales()], model: makeForecastModel(), blacklist: [], asOfDate: "2026-08-28", checkpoint: "month-start",
      revenueChannels: [
        { company: "寬沐", channel: "台北中山門市", amount: 100000 },
        { company: "寬承", channel: "台中北屯門市", amount: 0 }
      ]
    });
    const row = recommendations.rows.find((item) => item.sku === "A1");
    expect(row.storeDemandByCode.R00).toBeGreaterThan(0);
    expect(row.storeDailyByCode.R01).toBe(0);
    expect(recommendations.totals.kuanMuManagementTargetAmount).toBe(45000);
    expect(recommendations.appliedRules.kuanMuManagementTarget).toContain("不自動加進");
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
    expect(rows[0]["系統建議採購後可售至"]).toMatch(/^2026-/);
    expect(rows[0]["人工確認採購量"]).toBe("");
    expect(rows[0]["人工確認後可售至"]).toBe("");
    expect(rows[0]).not.toHaveProperty("總部需求（人工）");
    expect(rows[0]).not.toHaveProperty("門市需求（人工）");
    expect(rows[0]).toMatchObject({ "供應交期類型": "寄倉快速補貨", "到貨交期天數": 5, "目標覆蓋天數": 23 });
    expect(output.SheetNames.every((sheetName) => !output.Sheets[sheetName]["!protect"])).toBe(true);
    const editableHeaders = XLSX.utils.sheet_to_json(output.Sheets["03B1_普優瑪_天絲"], { header: 1, defval: "" })[0];
    const totalCell = output.Sheets["03B1_普優瑪_天絲"][XLSX.utils.encode_cell({ r: 1, c: editableHeaders.indexOf("加總需求（公式）") })];
    const hqCell = XLSX.utils.encode_cell({ r: 1, c: editableHeaders.indexOf("總部需求（系統）") });
    const storeCell = XLSX.utils.encode_cell({ r: 1, c: editableHeaders.indexOf("門市需求（系統）") });
    expect(totalCell.f).toBe(`${hqCell}+${storeCell}`);
    expect(totalCell.s?.protection).toBeUndefined();
    const manualCell = output.Sheets["03B1_普優瑪_天絲"][XLSX.utils.encode_cell({ r: 1, c: editableHeaders.indexOf("人工確認採購量") })];
    const decisionCell = output.Sheets["03B1_普優瑪_天絲"][XLSX.utils.encode_cell({ r: 1, c: editableHeaders.indexOf("系統建議採購後可售至") })];
    expect(manualCell.s?.fill?.fgColor?.rgb).toBe("FFFFF2CC");
    expect(decisionCell.s?.fill?.fgColor?.rgb).toBe("FFE8F2F5");
    expect(output.Sheets["03B1_普優瑪_天絲"]["!margins"]).toMatchObject({ left: 0.35, right: 0.35, top: 0.5, bottom: 0.5 });
    const styledRoundTrip = XLSX.read(XLSX.write(output, { type: "array", bookType: "xlsx", cellStyles: true }), { type: "array", cellStyles: true });
    const styledSheet = styledRoundTrip.Sheets["03B1_普優瑪_天絲"];
    expect(styledSheet[XLSX.utils.encode_cell({ r: 1, c: editableHeaders.indexOf("人工確認採購量") })].s?.fgColor?.rgb).toBe("FFF2CC");
    expect(styledSheet["!margins"]).toMatchObject({ left: 0.35, right: 0.35, top: 0.5, bottom: 0.5 });
    const rules = XLSX.utils.sheet_to_json(output.Sheets["08_核心規則"], { header: 1, defval: "" });
    expect(rules.some((row) => row[0] === "普優瑪採購與寄庫" && String(row[1]).includes("120／穩定105／低銷90天"))).toBe(true);
    expect(rules.some((row) => row[0] === "力榮採購與寄庫" && String(row[1]).includes("每品號0或10的倍數"))).toBe(true);
    expect(rules.some((row) => row[0] === "上林檢視期" && String(row[1]).includes("固定28天"))).toBe(true);
    const summary = XLSX.utils.sheet_to_json(output.Sheets["01_採購摘要"], { header: 1, defval: "" });
    expect(summary.some((row) => row[0] === "四來源日期檢核" && row[1] === "未提供")).toBe(true);
    expect(summary.some((row) => row[0] === "使用限制" && String(row[1]).includes("不可直接下單"))).toBe(true);
  });

  it("普優瑪寄庫報表維持單一頁籤並依大類、花色與小類排列及顯示小計", () => {
    expect(core.puyoumaConsignmentGroup({ name: "5尺60天絲床包 [晨曦]", purchaseTab: "天絲＋天絲棉", mainCategory: "床包", size: "5尺床包" }))
      .toEqual({ majorCategory: "天絲", mediumCategory: "晨曦", smallCategory: "床包", size: "5尺床包" });
    expect(core.puyoumaConsignmentGroup({ name: "60天絲枕套 [晨曦]", purchaseTab: "天絲＋天絲棉", mainCategory: "枕套", size: "48×75公分" }))
      .toEqual({ majorCategory: "天絲", mediumCategory: "晨曦", smallCategory: "枕套", size: "48×75公分" });
    expect(core.puyoumaConsignmentGroup({ name: "走走多功能收納盒S", purchaseTab: "無尺寸品項", mainCategory: "收納" }))
      .toEqual({ majorCategory: "無尺寸", mediumCategory: "走走多功能收納盒S", smallCategory: "其它品項", size: "無尺寸" });
    expect(core.puyoumaConsignmentGroup({ name: "天絲刺繡抱枕-綠霧森林", purchaseTab: "天絲＋天絲棉", mainCategory: "抱枕" }))
      .toEqual({ majorCategory: "無尺寸", mediumCategory: "天絲刺繡抱枕-綠霧森林", smallCategory: "其它品項", size: "無尺寸" });

    const recommendations = core.buildProcurementRecommendations({
      master: makeMaster(), inventory: makeInventory(), pendingReports: [makePending()], consignment: makeConsignment(),
      salesReports: [makeSales()], model: makeForecastModel(), blacklist: [], asOfDate: "2026-08-28", factoryTargetDays: 90
    });
    const source = recommendations.rows.find((row) => row.sku === "A1");
    Object.assign(source, { name: "5尺60天絲床包 [晨曦]", size: "5尺床包", mainCategory: "床包", purchaseTab: "天絲＋天絲棉" });
    const baseConsignment = recommendations.consignmentRows.find((row) => row.sku === "A1");
    Object.assign(baseConsignment, { name: source.name, suggestedConsignmentQty: 12, immediateConsignmentGap: 4 });
    recommendations.rows.push({ ...source, sku: "A5", name: "60天絲枕套 [晨曦]", size: "48×75公分", mainCategory: "枕套" });
    recommendations.consignmentRows.push({ ...baseConsignment, sku: "A5", name: "60天絲枕套 [晨曦]", suggestedConsignmentQty: 8, immediateConsignmentGap: 2 });

    const output = core.buildRecommendationWorkbook(recommendations, XLSX);
    expect(output.SheetNames.filter((name) => name === "04A_普優瑪寄庫建議")).toHaveLength(1);
    const rows = XLSX.utils.sheet_to_json(output.Sheets["04A_普優瑪寄庫建議"], { header: 1, defval: "" });
    expect(rows[0][0]).toBe("普優瑪寄庫建議（依大類、花色與品項分類）");
    const headers = rows[3];
    expect(headers.slice(0, 7)).toEqual(["大類", "花色／同品項", "小類", "尺寸", "ERP品號", "供應商貨號", "商品品名"]);
    const majorSummary = rows.find((row) => row[0] === "大類小計：天絲");
    const mediumSummary = rows.find((row) => row[1] === "花色小計：晨曦");
    expect(majorSummary[headers.indexOf("建議新增寄庫量")]).toBe(20);
    expect(mediumSummary[headers.indexOf("寄倉現貨缺口")]).toBe(6);
    expect(mediumSummary[headers.indexOf("建議新增寄庫量")]).toBe(20);
    const details = rows.filter((row) => row[0] === "天絲" && row[1] === "晨曦");
    expect(details.map((row) => row[2])).toEqual(["床包", "枕套"]);
    expect(details.map((row) => row[3])).toEqual(["5尺床包", "48×75公分"]);
  });

  it("可只輸出勾選供應商，摘要金額與採購分頁同步縮小且保留稽核頁", () => {
    const recommendations = core.buildProcurementRecommendations({
      master: makeMaster(), inventory: makeInventory(), pendingReports: [makePending()], consignment: makeConsignment(),
      salesReports: [makeSales()], model: makeForecastModel(), blacklist: ["一次性代工品"], asOfDate: "2026-08-28"
    });
    const puyoumaAmount = recommendations.suggestedRows.reduce((sum, row) => sum + row.suggestedPurchaseAmount, 0);
    const lirongRow = { ...recommendations.suggestedRows[0], sku: "L1", supplier: "力榮", suggestedPurchaseQty: 10, suggestedPurchaseAmount: 3000, unitCost: 300, purchaseTab: "其它" };
    recommendations.rows.push(lirongRow);
    recommendations.suggestedRows.push(lirongRow);
    const output = core.buildRecommendationWorkbook(recommendations, XLSX, { selectedSuppliers: ["普優瑪"] });
    expect(output.SheetNames).toContain("02_所選範圍採購建議");
    expect(output.SheetNames).toContain("03B1_普優瑪_天絲");
    expect(output.SheetNames).not.toContain("03A_力榮採購");
    expect(output.SheetNames).not.toContain("03C_上林採購");
    expect(output.SheetNames).not.toContain("03D_其它供應商");
    expect(output.SheetNames).toEqual(expect.arrayContaining(["07_排除與例外", "08_核心規則"]));
    const summary = XLSX.utils.sheet_to_json(output.Sheets["01_採購摘要"], { header: 1, defval: "" });
    expect(summary.find((row) => row[0] === "本次匯出範圍")?.[1]).toBe("普優瑪");
    expect(summary.find((row) => row[0] === "建議採購金額")?.[1]).toBe(puyoumaAmount);
    const selectedRows = XLSX.utils.sheet_to_json(output.Sheets["02_所選範圍採購建議"], { defval: "" });
    expect(new Set(selectedRows.map((row) => row["供應商"]))).toEqual(new Set(["普優瑪"]));

    recommendations.lirongConsignmentRows = [{ sku: "L1", supplierSku: "LR-L1", sourceName: "力榮測試品", masterName: "力榮測試品", tier: "穩定", forecastDailyQty: 1, pullLeadDays: 5, productionDays: 14, earliestDeliveryDays: 19, targetLowDays: 60, targetHighDays: 90, targetDays: 60, currentQty: 0, scheduledQty: 0, approvedPullQty: 0, productionCompleteDate: "", expectedArrivalDate: "", rawQty: 20, downQty: 20, upQty: 20, suggestedQty: 20, availableDaysAfter: 20, beforePullRisk: true, beforeProductionRisk: true, beforeDeliveryRisk: true, status: "需製作", futureCost: 6000, scheduleNotes: [] }];
    const lirongOutput = core.buildRecommendationWorkbook(recommendations, XLSX, { selectedSuppliers: ["力榮"] });
    expect(lirongOutput.SheetNames).toEqual(expect.arrayContaining(["03A_力榮採購", "04B_力榮寄庫建議"]));
    expect(lirongOutput.SheetNames).not.toContain("03B1_普優瑪_天絲");
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
    expect(secondWorkbook.SheetNames.every((sheetName) => !secondWorkbook.Sheets[sheetName]["!protect"])).toBe(true);
    const secondRows = XLSX.utils.sheet_to_json(secondWorkbook.Sheets["02_二次覆核"], { defval: "" });
    expect(secondRows[0]["人工確認後可售至"]).toMatch(/^2026-/);
    expect(secondRows[0]).not.toHaveProperty("人工填寫可售至");
    const secondStyleHeaders = XLSX.utils.sheet_to_json(secondWorkbook.Sheets["02_二次覆核"], { header: 1, defval: "" })[0];
    const secondManualCell = secondWorkbook.Sheets["02_二次覆核"][XLSX.utils.encode_cell({ r: 1, c: secondStyleHeaders.indexOf("二次確認採購量") })];
    expect(secondManualCell.s?.fill?.fgColor?.rgb).toBe("FFFFF2CC");
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

  it("舊版二次覆核檔會顯示明確指引，不誤當第一次或現行二次回匯", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["ERP品號"], ["A1"]]), "03B_其它供應商回匯覆核");
    expect(() => core.reviewReturnedWorkbook(workbook, XLSX)).toThrow("舊版或已產生的二次覆核檔");
    expect(() => core.reviewSecondApprovalWorkbook(workbook, XLSX)).toThrow("舊版二次覆核格式");
  });
});

describe("採購規劃前台與入口", () => {
  it("首頁提供工具入口，工具頁保留麵包屑、返回與本機處理說明", () => {
    const homeHtml = readFileSync("../index.html", "utf8");
    const toolHtml = readFileSync("../procurement-planning/index.html", "utf8");
    const headers = readFileSync("../_headers", "utf8");
    expect(homeHtml).toContain('href="/procurement-planning/"');
    expect(homeHtml).toContain("庫存採購規劃");
    expect(toolHtml).toContain("公司工具首頁");
    expect(toolHtml).toContain("← 返回公司工具首頁");
    expect(toolHtml).toContain("原始Excel不上傳");
    expect(toolHtml).toContain("工廠寄倉可拉貨量不在這個扣除公式中");
    expect(toolHtml).toContain("目標覆蓋＝供應商檢視期＋到貨交期＋分級安全緩衝");
    const toolAppSource = readFileSync("../procurement-planning/app.js", "utf8");
    expect(toolAppSource).toContain("nodim: true");
    const styleScriptIndex = toolHtml.indexOf('src="assets/xlsx-js-style.bundle.js"');
    const styleRuntimeIndex = toolHtml.indexOf('src="xlsx-style-runtime.js');
    const readerScriptIndex = toolHtml.indexOf('src="../inventory/assets/xlsx.full.min.js"');
    expect(styleScriptIndex).toBeGreaterThan(-1);
    expect(styleRuntimeIndex).toBeGreaterThan(styleScriptIndex);
    expect(readerScriptIndex).toBeGreaterThan(styleRuntimeIndex);
    expect(toolAppSource).toContain("const outputXlsx = globalThis.ProcurementXlsxWriter || globalThis.XLSX");
    expect(toolAppSource).toContain("outputXlsx.writeFile(core.buildRecommendationWorkbook(state.analysis, outputXlsx");
    expect(toolHtml).toContain("公司 Google 授權");
    expect(toolHtml).toContain("正式核准並寄送摘要");
    expect(toolHtml).toContain("回匯二次確認版");
    expect(toolHtml).toContain("重送摘要郵件");
    expect(toolHtml).toContain("儲存本月額度");
    expect(toolHtml).toContain("整月額度與已釋放額度分開呈現");
    expect(toolHtml).toContain("寬承預估認列營收");
    expect(toolHtml).toContain("寬承＋寬沐終端通路預估營收");
    expect(toolHtml).toContain('id="auto-source-progress"');
    expect(toolHtml.match(/data-source-progress=/g)).toHaveLength(4);
    expect(toolHtml).toContain("普優瑪寄庫表</h3><span class=\"source-badge required\">自動取得・必要");
    expect(toolHtml).toContain("力榮寄庫表</h3><span class=\"source-badge required\">自動取得・必要");
    expect(toolHtml).toContain('class="source-group automatic-source-group"');
    expect(toolHtml).toContain('class="source-group manual-source-group"');
    expect(toolHtml).toContain('id="automatic-source-title">自動取得資料');
    expect(toolHtml).toContain('id="manual-source-title">本次必要匯入');
    expect(toolHtml.indexOf('data-source="master"')).toBeLessThan(toolHtml.indexOf('data-source="marketing"'));
    expect(toolHtml.indexOf('data-source="marketing"')).toBeLessThan(toolHtml.indexOf('data-source="consignment"'));
    expect(toolHtml.indexOf('data-source="consignment"')).toBeLessThan(toolHtml.indexOf('data-source="lirong-consignment"'));
    expect(toolHtml.indexOf('data-source="lirong-consignment"')).toBeLessThan(toolHtml.indexOf('data-source="model"'));
    expect(toolHtml.indexOf('data-source="model"')).toBeLessThan(toolHtml.indexOf('data-source="inventory"'));
    expect(toolHtml.indexOf('data-source="inventory"')).toBeLessThan(toolHtml.indexOf('data-source="pending"'));
    expect(toolHtml.indexOf('data-source="pending"')).toBeLessThan(toolHtml.indexOf('data-source="sales"'));
    expect(toolHtml.match(/class="source-file-link"/g)).toHaveLength(5);
    expect(toolHtml.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(5);
    expect(toolHtml).toContain("開啟商品主檔資料夾");
    expect(toolHtml).toContain("開啟整體行銷策略");
    expect(toolHtml).toContain("查看普優瑪寄庫表");
    expect(toolHtml).toContain("查看力榮寄庫表");
    expect(toolHtml).toContain("查看正式季節模型資料夾");
    expect(toolHtml).toContain("drive.google.com/drive/folders/1uQVKi42veJfq-taIcSd0aKp3oETLeaey");
    expect(toolHtml).toContain("docs.google.com/spreadsheets/d/1l-3gd0gmx-nX6Je5XeWBRxZ1bFzZeGY0");
    expect(toolHtml).toContain("docs.google.com/spreadsheets/d/1MPG0mSYQZ_ITp79eTHZ71z3ra9pq6pNhmHLlWDS0Ec4");
    expect(toolHtml).toContain("docs.google.com/spreadsheets/d/1uEc8DBg50lB4uqM8UrTYYEuZz8blPLJgP8JCm1IUzWI");
    expect(toolHtml).toContain("drive.google.com/drive/folders/1ZUG_f_wNSyOOhtECYzCYSXj6DLRiHyo3");
    expect(toolHtml).toContain("https://sheets.googleapis.com");
    expect(headers).toMatch(/\/procurement-planning\/index\.html[\s\S]*connect-src[^\n]*https:\/\/sheets\.googleapis\.com/);
    expect(headers).toMatch(/\/procurement-planning\/index\.html[\s\S]*connect-src[^\n]*https:\/\/gmail\.googleapis\.com/);
    expect(headers).toMatch(/\/procurement-planning\/index\.html[\s\S]*worker-src 'self'/);
    expect(headers).not.toMatch(/\/procurement-planning\/index\.html[\s\S]*worker-src 'none'/);
    expect(toolHtml).toContain("class=\"rules-entry-button\"");
    expect(toolHtml).toContain("新增、移除或調整公司共用黑名單");
    expect(toolHtml).toContain('id="model-badge"');
    expect(toolHtml).toContain("每6個月到期才重跑近三年歷史銷售");
    expect(toolHtml).toContain('id="model-refresh-button"');
    expect(toolHtml).toContain('id="model-approve-button"');
    expect(toolHtml).toContain('worker-src \'self\'');
    expect(toolHtml).toContain("規則管理");
    expect(toolHtml.indexOf('id="budget-title"')).toBeLessThan(toolHtml.indexOf('id="source-title"'));
    expect(toolHtml.indexOf('id="source-title"')).toBeLessThan(toolHtml.indexOf('id="workflow-title"'));
    expect(toolHtml).toContain('id="budget-details"');
    expect(toolHtml).toContain('id="supplier-filter-list"');
    expect(toolHtml).toContain('href="rules-admin/#supplier-display"');
    expect(toolHtml).toContain("管理顯示供應商");
    expect(toolHtml).toContain("下載所選供應商Excel");
    expect(toolHtml).toContain("春節加量");
    expect(toolHtml).toContain('id="workflow-step-download"');
    expect(toolHtml).toContain('id="review-file-label" class="file-button is-disabled"');
    expect(toolHtml).toContain("新品首批採購");
    expect(toolHtml).toContain("人工匯入採購單");
    expect(toolHtml).toContain("補登已採購單");
    expect(toolHtml).toContain('id="active-ledger-rows"');
    const toolApp = readFileSync("../procurement-planning/app.js", "utf8");
    expect(toolApp).toContain("/api/procurement/month-plan");
    expect(toolApp).toContain('setAutomaticSourceBusy(true, "正在取得 4 項最新資料…")');
    expect(toolApp).toContain('completed ? "重新取得最新資料" : "重試取得最新資料"');
    expect(toolApp).toContain("forecastRevenue: Number(elements.forecastRevenue.value || 0)");
    expect(toolApp).toContain('refreshMonths: 6');
    expect(toolApp).toContain('indexedDB.open(MODEL_CACHE.database, 1)');
    expect(toolApp).toContain('elements.month.value >= refreshMonth');
    expect(toolApp).toContain("selectedSuppliers: new Set()");
    expect(toolApp).toContain("selectedPaymentSummary");
    expect(toolApp).toContain("下載後才會開放第一次人工回匯");
    expect(toolApp).toContain("大型檔案預檢未通過");
    expect(toolApp).toContain("/api/procurement/manual-orders");
    const specialMigration = readFileSync("worker/migrations/0007_special_procurement_workflows.sql", "utf8");
    expect(specialMigration).toContain("workflow_type");
    expect(specialMigration).toContain("erp_reference");
    expect(specialMigration).toContain("UNIQUE INDEX");
    const toolCss = readFileSync("../procurement-planning/style.css", "utf8");
    expect(toolCss).toContain("@media (max-width: 620px)");
    expect(toolCss).toMatch(/\.procurement-period,[\s\S]*\.budget-grid,[\s\S]*\.procurement-summary,[\s\S]*\.budget-summary \{ grid-template-columns: 1fr; \}/);
    expect(toolCss).toMatch(/@media \(max-width: 620px\)[\s\S]*\.budget-grid \.budget-source-field \{ grid-column: auto; \}/);
    expect(toolCss).toContain(".workflow-grid .file-button.is-disabled");
    expect(toolCss).toContain(".supplier-filter-list");
    const rulesAdminHtml = readFileSync("../procurement-planning/rules-admin/index.html", "utf8");
    const rulesAdminApp = readFileSync("../procurement-planning/rules-admin/admin.js", "utf8");
    expect(rulesAdminHtml).toContain('id="featured-supplier-list"');
    expect(rulesAdminHtml).toContain("未列入、新增後尚未列入或由資料臨時辨識到的供應商");
    expect(rulesAdminHtml).toContain('id="spring-festival-extra-days"');
    expect(rulesAdminHtml).toContain("預設53天，可在45～60天內調整");
    expect(rulesAdminApp).toContain("featuredSuppliers");
    expect(rulesAdminApp).toContain("springFestival");
    const supplierMigration = readFileSync("worker/migrations/0009_restore_supplier_review_periods.sql", "utf8");
    expect(supplierMigration).toContain("featuredSuppliers");
    expect(supplierMigration).toContain('["普優瑪寢具有限公司","力榮","上林","潤泰羽絨","泰能脊康"]');
    const springFestivalMigration = readFileSync("worker/migrations/0010_foreign_supplier_spring_festival.sql", "utf8");
    expect(springFestivalMigration).toContain('"extraDays":53');
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
    const scopeCorrection = readFileSync("worker/migrations/0005_correct_revenue_scope.sql", "utf8");
    expect(scopeCorrection).toContain("forecast_revenue = 5936068.44");
    expect(scopeCorrection).toContain("終端通路預估7,100,102元只作營運參考");
    const oneTimeExclusions = readFileSync("worker/migrations/0006_exclude_confirmed_one_time_oem.sql", "utf8");
    expect(oneTimeExclusions).toContain("A068-PPB2-4875-00090");
    expect(oneTimeExclusions).toContain("A068-PCC1-1016-00091");
    expect(oneTimeExclusions).toContain("A068-PPF1-3030-00091");
    expect(oneTimeExclusions).toContain("一次性代工");
    const serviceExclusions = readFileSync("worker/migrations/0008_exclude_shipping_service_skus.sql", "utf8");
    ["C41723", "Z00999", "ZS1000", "ZS1005", "ZZ900"].forEach((sku) => expect(serviceExclusions).toContain(sku));
    expect(serviceExclusions).toContain("運費／配送服務");
  });
});

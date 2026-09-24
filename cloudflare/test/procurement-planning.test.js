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
const googleSources = loadBrowserScript("../procurement-planning/google-sources.js").ProcurementGoogleSources;

describe("固定 Google 來源頁籤選擇", () => {
  it("力榮優先使用現行下單頁籤並相容舊名", () => {
    expect(googleSources.selectSpreadsheetSheetTitle(["工作表1", "下單"], ["下單", "工作表1"])).toBe("下單");
    expect(googleSources.selectSpreadsheetSheetTitle(["工作表1"], ["下單", "工作表1"])).toBe("工作表1");
  });

  it("頁籤再次改名時只取第一個頁籤，後續仍由欄位檢核把關", () => {
    expect(googleSources.selectSpreadsheetSheetTitle(["供應商新版", "備註"], ["下單", "工作表1"])).toBe("供應商新版");
    expect(() => googleSources.selectSpreadsheetSheetTitle([], ["下單", "工作表1"])).toThrow("沒有可讀取的頁籤");
  });

  it("Google 唯讀來源遇到503會自動重試", async () => {
    let client;
    let attempts = 0;
    const sandbox = loadBrowserScript("../procurement-planning/google-sources.js", {
      URLSearchParams,
      google: { accounts: { oauth2: { initTokenClient: () => {
        client = { callback: null, requestAccessToken: () => client.callback({ access_token: "test-token" }) };
        return client;
      } } } },
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) return { ok: false, status: 503, json: async () => ({ error: { message: "The service is currently unavailable." } }) };
        return { ok: true, status: 200, json: async () => ({ files: [] }) };
      }
    });
    const sources = sandbox.ProcurementGoogleSources;
    sources.initialize("test-client");
    await sources.authorize();
    await expect(sources.listDriveExcelFiles("folder-id")).resolves.toEqual([]);
    expect(attempts).toBe(2);
  });
});

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

function makeTransfer() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["單據編碼", "狀態", "調出倉庫名", "調入倉庫名", "貨號", "品名", "數量", "開單日期", "發貨日期", "收貨日期"],
    ["AT1", "提交", "寬承總倉", "翔仔居家-台北中山門市", "A1", "60天絲測試床包", 2, "2026/8/27", "", ""],
    ["AT2", "發貨審核", "寬承總倉", "翔仔居家-台中北屯門市", "A1", "60天絲測試床包", 3, "2026/8/26", "2026/8/27", ""],
    ["AT3", "收貨審核", "寬承總倉", "翔仔居家-新竹東區門市", "A1", "60天絲測試床包", 4, "2026/8/25", "2026/8/26", "2026/8/28"]
  ]), "工作表1");
  return core.parseTransferWorkbook(workbook, XLSX, { fileName: "期間調撥單.xlsx" });
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
  it("完整採購檔同時有上次採購價與未稅採購價時採用本次未稅價格", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["單據編碼", "狀態", "貨號", "品名", "上次採購價", "未稅採購價", "採購數量", "交貨數量", "未交數量", "金額"],
      ["PR2026090017", "主管審核", "D32387", "追加抱枕套", 95, 105, 80, 0, 80, 8400]
    ]), "採購明細");
    const report = core.parsePendingPurchaseWorkbook(workbook, XLSX, { fileName: "完整採購檔.xlsx" });
    expect(report.records[0]).toMatchObject({ documentCode: "PR2026090017", sku: "D32387", orderedQuantity: 80, unitCost: 105, orderedAmount: 8400 });
  });

  it("月初只釋放第一階段額度，月中與月底自動累計釋放整月額度", () => {
    expect(core.resolveReleasedBudgetAmount({ checkpoint: "month-start", fullBudgetAmount: 2659538.3, monthStartReleasedAmount: 1329769.15 })).toEqual({
      checkpoint: "month-start", monthStartReleasedAmount: 1329769.15, additionalReleasedAmount: 0, releasedBudgetAmount: 1329769.15
    });
    expect(core.resolveReleasedBudgetAmount({ checkpoint: "mid-month", fullBudgetAmount: 2659538.3, monthStartReleasedAmount: 1329769.15 })).toEqual({
      checkpoint: "mid-month", monthStartReleasedAmount: 1329769.15, additionalReleasedAmount: 1329769.15, releasedBudgetAmount: 2659538.3
    });
    expect(core.resolveReleasedBudgetAmount({ checkpoint: "month-end", fullBudgetAmount: 2659538.3, monthStartReleasedAmount: 1329769.15 }).releasedBudgetAmount).toBe(2659538.3);
  });

  it("不完整或異常驟降的成本試算不得覆蓋公司共用快照", () => {
    const previous = { forecastCost: 2840127.71 };
    const incomplete = core.assessCostSnapshotPromotion({
      analysisMonth: "2026-09",
      previous,
      summary: { month: "2026-09", minSalesDate: "2026-09-18", maxSalesDate: "2026-09-24", currentMonthSalesRecordCount: 57, forecastCost: 720899.9 }
    });
    expect(incomplete.allowed).toBe(false);
    expect(incomplete.reasons.join("；")).toContain("未涵蓋月初");
    expect(incomplete.reasons.join("；")).toContain("25%");

    const complete = core.assessCostSnapshotPromotion({
      analysisMonth: "2026-09",
      previous,
      summary: { month: "2026-09", minSalesDate: "2026-09-01", maxSalesDate: "2026-09-24", currentMonthSalesRecordCount: 5000, forecastCost: 2900000 }
    });
    expect(complete).toMatchObject({ allowed: true, reasons: [] });
  });

  it("以明確客製備註辨識客訂，並排除一般未到貨淨需求", () => {
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

  it("SA／OA／SB／OB品號固定排除一般需求，四筆SEMO另列組合品原因", () => {
    ["SA832", "OA568", "SB1005", "OB129"].forEach((sku) => expect(core.isCustomerCustomSku(sku)).toBe(true));
    expect(core.isCustomerCustomSku("OA41361")).toBe(false);
    expect(core.isAutomaticProcurementExcludedSku("OA41361")).toBe(true);
    expect(core.isCustomerCustomSku("A41361")).toBe(false);
    expect(core.customerCustomExclusionReason("OA41361")).toContain("組合品號");
    expect(core.customerCustomExclusionReason("OA568")).toContain("一次性客製");

    const pendingWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(pendingWorkbook, XLSX.utils.aoa_to_sheet([
      ["貨號", "品名", "採購價", "數量", "金額", "備註"],
      ["OA568", "客製床包", 500, 2, 1000, "台北"]
    ]), "工作表1");
    const pendingReport = core.parsePendingPurchaseWorkbook(pendingWorkbook, XLSX, { fileName: "客製前綴採購.xlsx" });
    expect(pendingReport.records[0]).toMatchObject({ sku: "OA568", isCustomOrder: true, customChannel: "" });
    expect(core.aggregatePendingReports([pendingReport]).bySku.size).toBe(0);

    const combinationWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(combinationWorkbook, XLSX.utils.aoa_to_sheet([
      ["貨號", "品名", "採購價", "數量", "金額", "備註"],
      ["OA41361", "SEMO組合品", 600, 1, 600, ""]
    ]), "工作表1");
    const combinationReport = core.parsePendingPurchaseWorkbook(combinationWorkbook, XLSX, { fileName: "組合品.xlsx" });
    expect(combinationReport.records[0]).toMatchObject({ sku: "OA41361", isCustomOrder: false, automaticProcurementExcluded: true });
    expect(core.aggregatePendingReports([combinationReport]).bySku.size).toBe(0);
    expect(core.aggregatePendingReports([combinationReport]).customRecords).toHaveLength(0);

    const masterWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(masterWorkbook, XLSX.utils.aoa_to_sheet([
      ["貨號", "品名", "供應商貨號", "供應商簡稱", "進貨價", "最小配貨數", "貨品狀態", "已下架"],
      ["A1", "一般床包", "V-A1", "普優瑪", 500, 1, "尚可追加", "否"],
      ["OA568", "90X200X25客製床包", "V-OA568", "普優瑪", 500, 1, "尚可追加", "否"],
      ["OA41361", "SEMO組合品", "V-OA41361", "家禾", 600, 1, "尚未生產", "否"]
    ]), "工作表1");
    const salesWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(salesWorkbook, XLSX.utils.aoa_to_sheet([
      ["銷別", "結帳時間", "貨號", "品名", "銷售量", "實收金額", "開單倉編號", "開單倉名稱"],
      ["銷貨", "2026-08-25 12:00:00", "A1", "一般床包", 20, 20000, "R00", "台北門市"],
      ["銷貨", "2026-08-25 12:00:00", "OA568", "客製床包", 2, 2000, "R00", "台北門市"],
      ["銷貨", "2026-08-25 12:00:00", "OA41361", "SEMO組合品", 1, 1000, "R00", "台北門市"]
    ]), "工作表1");
    const recommendations = core.buildProcurementRecommendations({
      master: core.parseProductMasterWorkbook(masterWorkbook, XLSX), inventory: makeInventory(), pendingReports: [], consignment: makeConsignment(),
      salesReports: [core.parseSalesWorkbook(salesWorkbook, XLSX)], model: makeForecastModel(), blacklist: [], asOfDate: "2026-08-28", checkpoint: "mid-month"
    });
    expect(recommendations.rows.map((row) => row.sku)).toContain("A1");
    expect(recommendations.rows.some((row) => core.isCustomerCustomSku(row.sku))).toBe(false);
    expect(recommendations.productExclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: "OA568", type: "一次性客製品號排除" }),
      expect.objectContaining({ sku: "OA41361", type: "組合品號排除" })
    ]));
    expect(() => core.buildSpecialProcurementAnalysis({
      baseAnalysis: recommendations, workflowType: "new_product", rows: [{ sku: "OA568", firstMonthQty: 2 }],
      master: core.parseProductMasterWorkbook(masterWorkbook, XLSX), inventory: makeInventory(), pendingReports: []
    })).toThrow(/客製採購流程/);
  });

  it("8×7尺商品視為一次性客製尺寸，不列一般採購與寄庫", () => {
    expect(core.isEightBySevenCustomItem("8x7尺羽絨被")).toBe(true);
    expect(core.isEightBySevenCustomItem("8X7呎兩用被套")).toBe(true);
    expect(core.isEightBySevenCustomItem("8×7 尺薄被套")).toBe(true);
    expect(core.isEightBySevenCustomItem("6x7尺兩用被套")).toBe(false);
    expect(core.isAutomaticProcurementExcludedItem("F14008", "8x7尺羽絨被")).toBe(true);
    expect(core.isCustomerCustomItem("F14008", "8×7尺羽絨被")).toBe(true);
    expect(core.customerCustomExclusionReason("F14008", "8×7尺羽絨被")).toContain("客製尺寸");

    const pendingWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(pendingWorkbook, XLSX.utils.aoa_to_sheet([
      ["貨號", "品名", "採購價", "數量", "金額", "備註"],
      ["F14008", "8x7尺羽絨被", 3000, 1, 3000, "台北"]
    ]), "工作表1");
    const pendingReport = core.parsePendingPurchaseWorkbook(pendingWorkbook, XLSX, { fileName: "8x7客製採購.xlsx" });
    expect(pendingReport.records[0]).toMatchObject({ automaticProcurementExcluded: true, isCustomOrder: true });
    expect(core.aggregatePendingReports([pendingReport]).bySku.size).toBe(0);
    expect(core.aggregatePendingReports([pendingReport]).customRecords).toHaveLength(1);

    const masterWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(masterWorkbook, XLSX.utils.aoa_to_sheet([
      ["貨號", "品名", "供應商貨號", "供應商簡稱", "進貨價", "最小配貨數", "貨品狀態", "已下架"],
      ["A1", "一般床包", "V-A1", "普優瑪", 500, 1, "尚可追加", "否"],
      ["F14008", "8×7尺羽絨被", "V-F14008", "潤泰羽絨", 3000, 1, "尚可追加", "否"]
    ]), "工作表1");
    const salesWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(salesWorkbook, XLSX.utils.aoa_to_sheet([
      ["銷別", "結帳時間", "貨號", "品名", "銷售量", "實收金額", "開單倉編號", "開單倉名稱"],
      ["銷貨", "2026-08-25 12:00:00", "A1", "一般床包", 20, 20000, "R00", "台北門市"],
      ["銷貨", "2026-08-25 12:00:00", "F14008", "8×7尺羽絨被", 3, 15000, "R00", "台北門市"]
    ]), "工作表1");
    const master = core.parseProductMasterWorkbook(masterWorkbook, XLSX);
    const recommendations = core.buildProcurementRecommendations({
      master, inventory: makeInventory(), pendingReports: [], consignment: makeConsignment(),
      salesReports: [core.parseSalesWorkbook(salesWorkbook, XLSX)], model: makeForecastModel(), blacklist: [], asOfDate: "2026-08-28", checkpoint: "mid-month"
    });
    expect(recommendations.rows.map((row) => row.sku)).not.toContain("F14008");
    expect(recommendations.productExclusions).toContainEqual(expect.objectContaining({ sku: "F14008", type: "8×7尺客製尺寸排除" }));
    expect(() => core.buildSpecialProcurementAnalysis({
      baseAnalysis: recommendations, workflowType: "new_product", rows: [{ sku: "F14008", firstMonthQty: 1 }],
      master, inventory: makeInventory(), pendingReports: []
    })).toThrow(/8×7尺客製尺寸/);
  });

  it("全部狀態採購單會排除新單與已結案未交量，並按實際交貨日計入收貨成本", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["採購單編碼", "狀態", "單據是否關閉", "收貨單開單日", "貨號", "品名", "採購數量", "交貨數量", "未交數量", "採購價"],
      ["PR-DRAFT", "新單", "否", "", "A1", "草稿", 2, 0, 2, 500],
      ["PR-OPEN", "主管審核", "否", "", "A1", "正式未到貨", 3, 0, 3, 500],
      ["PR-PARTIAL-CLOSED", "部分到貨", "是", "2026-09-11", "A2", "部分到貨已結案", 4, 3, 1, 600],
      ["PR-PARTIAL-OPEN", "部分到貨", "否", "2026-09-12", "A3", "部分到貨未結案", 5, 2, 3, 700],
      ["PR-FULL", "已全部到貨", "是", "2026-08-31", "A4", "前月收貨", 1, 1, 0, 800]
    ]), "工作表1");
    const report = core.parsePendingPurchaseWorkbook(workbook, XLSX, { fileName: "全部狀態.xlsx" });
    const pending = core.aggregatePendingReports([report]);
    const summary = core.summarizePurchaseReports([report], "2026-09");
    expect(pending.bySku.get("A1").quantity).toBe(3);
    expect(pending.bySku.has("A2")).toBe(false);
    expect(pending.bySku.get("A3").quantity).toBe(3);
    expect(summary).toMatchObject({ actualReceiptCost: 3200, receiptDocumentCount: 2, pendingQuantity: 6, draftDocumentCount: 1, closedPartialDocumentCount: 1 });
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

describe("五來源匯入與品號串接", () => {
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

  it("解析期間調撥單並依庫存截止日還原提交、發貨與收貨狀態", () => {
    const report = makeTransfer();
    expect(report.records).toHaveLength(3);
    expect(report.records[0]).toMatchObject({ sourceWarehouseCode: "T00", destinationWarehouseCode: "R00", quantity: 2 });
    const onAugust27 = core.aggregateTransferReports([report], { asOfDate: "2026-08-27" });
    expect(onAugust27).toMatchObject({ activeDocumentCount: 3, submittedQty: 2, shippedQty: 7 });
    expect(onAugust27.adjustmentBySkuWarehouse.get("A1\tT00")).toBe(-2);
    expect(onAugust27.adjustmentBySkuWarehouse.get("A1\tR00")).toBe(2);
    expect(onAugust27.adjustmentBySkuWarehouse.get("A1\tR01")).toBe(3);
    expect(onAugust27.adjustmentBySkuWarehouse.get("A1\tR03")).toBe(4);
    const onAugust28 = core.aggregateTransferReports([report], { asOfDate: "2026-08-28" });
    expect(onAugust28).toMatchObject({ activeDocumentCount: 2, submittedQty: 2, shippedQty: 3 });
    expect(onAugust28.adjustmentBySkuWarehouse.has("A1\tR03")).toBe(false);
  });

  it("期間調撥只要一端屬於管理倉即保留，兩端都無關則略過", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["單據編碼", "狀態", "調出倉庫名", "調入倉庫名", "貨號", "品名", "數量", "開單日期", "發貨日期", "收貨日期"],
      ["AT4", "發貨審核", "[快閃] 高雄漢神巨蛋", "寬承總倉", "A1", "60天絲測試床包", 5, "2026/9/12", "2026/9/13", ""],
      ["AT5", "收貨審核", "寬承總倉", "瑕疵倉", "A1", "60天絲測試床包", 2, "2026/9/10", "2026/9/11", "2026/9/12"],
      ["AT6", "收貨審核", "行銷-活動&商品拍攝", "瑕疵倉", "A1", "60天絲測試床包", 1, "2026/9/10", "2026/9/11", "2026/9/12"]
    ]), "工作表1");
    const report = core.parseTransferWorkbook(workbook, XLSX, { fileName: "含其它倉調撥.xlsx" });
    expect(report.records).toHaveLength(2);
    expect(report.ignoredRows).toHaveLength(1);
    expect(report.records[0]).toMatchObject({
      sourceWarehouseManaged: false,
      destinationWarehouseCode: "T00",
      destinationWarehouseManaged: true
    });
    expect(report.records[0].sourceWarehouseCode).toMatch(/^OTHER:/);
    expect(report.records[1]).toMatchObject({
      sourceWarehouseCode: "T00",
      sourceWarehouseManaged: true,
      destinationWarehouseManaged: false
    });
    const projected = core.aggregateTransferReports([report], { asOfDate: "2026-09-13" });
    expect(projected.adjustmentBySkuWarehouse.get("A1\tT00")).toBe(5);
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
    const analysis = core.buildAnalysis({
      master: makeMaster(), inventory: makeInventory(), pendingReports: [makePending()], transferReports: [makeTransfer()],
      consignment: makeConsignment(), blacklist: [],
      dates: { inventory: "2026-08-28", pending: "2026-08-28", transfer: "2026-08-25", consignment: "2026-08-28", sales: "2026-08-28" }
    });
    expect(analysis.dateCheck).toMatchObject({ status: "REVIEW", transferGapDays: 3 });
    expect(analysis.dateCheck.message).toContain("同日或相差1天內");
  });
});

describe("採購建議第二階段", () => {
  it("採購建議使用調撥後的總倉與逐店庫存，並揭露提交與發貨在途量", () => {
    const recommendations = core.buildProcurementRecommendations({
      master: makeMaster(), inventory: makeInventory(), pendingReports: [makePending()], transferReports: [makeTransfer()],
      inventoryDate: "2026-08-28", consignment: makeConsignment(), salesReports: [makeSales()], model: makeForecastModel(),
      blacklist: [], asOfDate: "2026-08-28", checkpoint: "mid-month"
    });
    const row = recommendations.rows.find((item) => item.sku === "A1");
    expect(row).toMatchObject({ inventoryQty: 4, transferSubmittedQty: 2, transferInTransitQty: 3 });
    expect(row.storeInventoryByCode).toMatchObject({ R00: 4, R01: 3 });
    expect(recommendations.totals).toMatchObject({ activeTransferDocumentCount: 2, transferSubmittedQty: 2, transferInTransitQty: 3 });
  });

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

  it("公司協作草稿不含原始檔名時仍可匯出本批報表", () => {
    const recommendations = core.buildProcurementRecommendations({
      master: makeMaster(), inventory: makeInventory(), pendingReports: [makePending()], consignment: makeConsignment(),
      salesReports: [makeSales()], model: makeForecastModel(), blacklist: [], asOfDate: "2026-08-28"
    });
    const source = recommendations.rows.find((row) => row.sku === "A1");
    Object.assign(source, { suggestedPurchaseQty: 10, suggestedPurchaseAmount: 5000 });
    recommendations.suggestedRows = [source];
    recommendations.suggestedRows.forEach((row) => { delete row.sourceFiles; });
    const output = core.buildRecommendationWorkbook(recommendations, XLSX);
    const purchaseSheet = output.SheetNames.find((name) => /^03[ABCD]/.test(name)
      && XLSX.utils.sheet_to_json(output.Sheets[name], { header: 1, defval: "" }).flat().includes("A1"));
    expect(purchaseSheet).toBeTruthy();
    const rows = XLSX.utils.sheet_to_json(output.Sheets[purchaseSheet], { header: 1, defval: "" });
    expect(rows.flat()).toContain("公司協作草稿（不保存原始檔名）");
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

  it("季節曲線依完整保護期加權，而非只看單一未來日期", () => {
    const baseModel = makeForecastModel();
    const indices = new Map(Array.from({ length: 26 }, (_unused, slot) => [slot, 1]));
    const slotOf = (date) => {
      const timestamp = Date.parse(`${date}T00:00:00Z`);
      return ((Math.floor((timestamp - Date.UTC(2024, 0, 1)) / 86400000 / 14) % 26) + 26) % 26;
    };
    const asOfMs = Date.parse("2026-08-28T00:00:00Z");
    for (let day = -41; day <= 0; day += 1) indices.set(slotOf(new Date(asOfMs + day * 86400000).toISOString().slice(0, 10)), 0.5);
    for (let day = 1; day <= 23; day += 1) indices.set(slotOf(new Date(asOfMs + day * 86400000).toISOString().slice(0, 10)), 2.5);
    const actualBySlot = new Map(Array.from({ length: 26 }, (_unused, slot) => [slot, 280]));
    const observationsBySlot = new Map(Array.from({ length: 26 }, (_unused, slot) => [slot, 2]));
    const winterMaster = makeMaster();
    winterMaster.records.find((record) => record.sku === "A1").name = "冬季羽絨被";
    const seasonalModel = {
      ...baseModel,
      bySku: new Map([["A1", { ...baseModel.bySku.get("A1"), name: "冬季羽絨被", materialCategory: "冬季保暖其他", season: "冬季" }]]),
      seasonalProfilesBySku: new Map([["A1", { level: "SKU", indices, actualBySlot, observationsBySlot, reliability: "高", seasonal: true, peakSlots: "18、19" }]]),
      seasonalProfilesByKey: new Map()
    };
    const source = {
      master: winterMaster, inventory: makeInventory(), pendingReports: [makePending()], consignment: makeConsignment(),
      salesReports: [makeSales()], blacklist: [], asOfDate: "2026-08-28", checkpoint: "mid-month"
    };
    const withoutSeason = core.buildProcurementRecommendations({ ...source, model: baseModel }).rows.find((row) => row.sku === "A1");
    const withSeason = core.buildProcurementRecommendations({ ...source, model: seasonalModel }).rows.find((row) => row.sku === "A1");
    expect(withSeason.horizonSeasonFactor).toBeGreaterThan(1);
    expect(withSeason.seasonalDemandMode).toBe("強冬季");
    expect(withSeason.seasonalProfileSource).toBe("SKU：A1");
    expect(withSeason.seasonalHistoricalDailyQty).toBe(10);
    expect(withSeason.seasonalDemandBasis).toBe("SKU同季歷史絕對量");
    expect(withSeason.suggestedPurchaseQty).toBeGreaterThan(withoutSeason.suggestedPurchaseQty);
  });

  it("天絲寢具維持四季品，只採用40%季節變化且不套歷史絕對量下限", () => {
    const baseModel = makeForecastModel();
    const indices = new Map(Array.from({ length: 26 }, (_unused, slot) => [slot, 1]));
    const slotOf = (timestamp) => ((Math.floor((timestamp - Date.UTC(2024, 0, 1)) / 86400000 / 14) % 26) + 26) % 26;
    const asOfMs = Date.parse("2026-08-28T00:00:00Z");
    for (let day = -41; day <= 0; day += 1) indices.set(slotOf(asOfMs + day * 86400000), 0.5);
    for (let day = 1; day <= 23; day += 1) indices.set(slotOf(asOfMs + day * 86400000), 2.5);
    const seasonalModel = {
      ...baseModel,
      bySku: new Map([["A1", { ...baseModel.bySku.get("A1"), season: "夏季" }]]),
      seasonalProfilesBySku: new Map([["A1", {
        level: "SKU", indices,
        actualBySlot: new Map(Array.from({ length: 26 }, (_unused, slot) => [slot, 2800])),
        observationsBySlot: new Map(Array.from({ length: 26 }, (_unused, slot) => [slot, 2])),
        reliability: "高", seasonal: true, peakSlots: "18、19"
      }]]),
      seasonalProfilesByKey: new Map()
    };
    const row = core.buildProcurementRecommendations({
      master: makeMaster(), inventory: makeInventory(), pendingReports: [makePending()], consignment: makeConsignment(),
      salesReports: [makeSales()], model: seasonalModel, blacklist: [], asOfDate: "2026-08-28", checkpoint: "mid-month"
    }).rows.find((item) => item.sku === "A1");
    expect(row.seasonalDemandMode).toBe("四季－夏季偏旺");
    expect(row.horizonRawSeasonFactor).toBeGreaterThan(row.horizonSeasonFactor);
    expect(row.horizonSeasonFactor).toBeLessThanOrEqual(1.3);
    expect(row.seasonalHistoricalDailyQty).toBeNull();
    expect(row.seasonalDemandBasis).toBe("近期速度×溫和季節曲線");
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

  it("門市核准未配需求以同店同品號最新版防重，並只抵扣需要日前可到貨的未交量", () => {
    const source = {
      master: makeMaster(), inventory: makeInventory(), pendingReports: [makePending()], consignment: makeConsignment(),
      salesReports: [makeSales()], model: makeForecastModel(), blacklist: [], asOfDate: "2026-08-28", checkpoint: "mid-month",
      storeTransferNeeds: [
        { storeCode: "R00", sku: "A1", productName: "60天絲測試床包", unfilledQuantity: 20, neededBy: "2026-08-27", handlingMode: "merge_next", sourceBatchId: "W1" },
        { storeCode: "R00", sku: "A1", productName: "60天絲測試床包", unfilledQuantity: 12, neededBy: "2026-08-27", handlingMode: "merge_next", sourceBatchId: "W2" }
      ]
    };
    const late = core.buildProcurementRecommendations(source).rows.find((row) => row.sku === "A1");
    expect(late.storeTransferNeedByCode.R00).toBe(12);
    expect(late.storeDemandByCode.R00).toBeGreaterThanOrEqual(12);
    expect(late.storeTransferNeedQty).toBe(12);
    expect(late.pendingQty).toBe(5);
    expect(late.effectivePendingQty).toBe(0);
    expect(late.originalDemandSource).toContain("門市核准未配");
    expect(late.earliestPendingDeliveryDate).toBe("2026-08-28");
    expect(late.pendingArrivalStatus).toBe("未到貨晚於需要日，不能抵扣");
    expect(late.pendingArrivalGap).toBe("晚1天");
    const timely = core.buildProcurementRecommendations({ ...source, storeTransferNeeds: [{ ...source.storeTransferNeeds[1], neededBy: "2026-08-29" }] }).rows.find((row) => row.sku === "A1");
    expect(timely.effectivePendingQty).toBe(5);
    expect(timely.pendingArrivalStatus).toBe("可於需要日前部分抵扣5件");
    expect(timely.pendingArrivalGap).toBe("提前1天");
    expect(late.rawPurchaseQty).toBeGreaterThanOrEqual(timely.rawPurchaseQty);
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

  it("同一春節週期較早建立的正式未到貨量會抵扣春節缺口，重跑不重複加量", () => {
    const master = makeMaster();
    master.records.find((row) => row.sku === "A1").supplier = "潤泰羽絨";
    const inventoryWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(inventoryWorkbook, XLSX.utils.aoa_to_sheet([
      ["店倉編號", "店倉名稱", "貨號", "品名", "實際庫存", "實際庫存成本額"],
      ["T00", "寬承總倉", "A1", "60天絲測試床包", 100, 50000],
      ["R00", "台北門市", "A1", "60天絲測試床包", 49, 24500]
    ]), "乾淨商品");
    const pendingWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(pendingWorkbook, XLSX.utils.aoa_to_sheet([
      ["單據編碼:", "PR-SPRING", "採購日期:", "2026-09-14", "交貨日期:", "2026-10-31"],
      [],
      ["貨號", "品名", "採購價", "數量", "金額", "備註"],
      ["A1", "60天絲測試床包", 500, 350, 175000, "前次春節備貨"]
    ]), "Sheet1");
    const salesWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(salesWorkbook, XLSX.utils.aoa_to_sheet([
      ["銷別", "結帳時間", "貨號", "品名", "銷售量", "實收金額", "開單倉編號", "開單倉名稱"],
      ["銷貨", "2026-09-10 12:00:00", "A1", "60天絲測試床包", 104, 104000, "R00", "台北門市"]
    ]), "工作表1");
    const adjusted = core.buildProcurementRecommendations({
      master,
      inventory: core.parseInventoryWorkbook(inventoryWorkbook, XLSX),
      pendingReports: [core.parsePendingPurchaseWorkbook(pendingWorkbook, XLSX)],
      consignment: makeConsignment(),
      salesReports: [core.parseSalesWorkbook(salesWorkbook, XLSX)],
      model: makeForecastModel(),
      blacklist: [],
      asOfDate: "2026-09-17",
      checkpoint: "mid-month",
      supplierRules: core.SUPPLIER_RULES,
      springFestivalRule: { enabled: true, closureStart: "2027-01-16", recoveryDate: "2027-02-28", extraDays: 53 }
    });
    const row = adjusted.rows.find((item) => item.sku === "A1");
    expect(row.rawPurchaseQty).toBe(0);
    expect(row.springFestivalUncoveredRawQty).toBeGreaterThan(0);
    expect(row.priorSpringFestivalPendingQty).toBe(350);
    expect(row.springFestivalExtraSuggestedQty).toBe(0);
    expect(row.suggestedPurchaseQty).toBe(0);
    expect(row.supplyStatus).toContain("本次不重複加量");

    const output = core.buildRecommendationWorkbook({ ...adjusted, suggestedRows: [row] }, XLSX);
    const report = XLSX.utils.sheet_to_json(output.Sheets["03D_其它供應商"], { defval: "" })[0];
    expect(report["前次春節備貨未交量"]).toBe(350);
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
      "01_採購摘要", "03A_力榮採購", "03B1_普優瑪_天絲",
      "03B2_普優瑪_長絨棉", "03B3_普優瑪_無尺寸", "03C_上林採購", "03D_其它供應商",
      "04A_普優瑪寄庫建議", "04B_力榮寄庫建議", "05_新品採購建議", "06_普優瑪新品寄庫",
      "07_排除與例外", "08_核心規則"
    ]);
    const rows = XLSX.utils.sheet_to_json(output.Sheets["03B1_普優瑪_天絲"], { defval: "" });
    expect(rows[0]["建議採購量"]).toBeGreaterThan(0);
    const recommendationRow = recommendations.rows.find((item) => item.sku === rows[0]["ERP品號"]);
    const expectedHqAvailableDays = Number(recommendationRow.hqDailyQty) > 0
      ? Math.floor(Number(recommendationRow.inventoryQty || 0) / Number(recommendationRow.hqDailyQty))
      : null;
    const expectedHqAvailableTo = expectedHqAvailableDays == null
      ? "需求為0"
      : new Date(Date.UTC(2026, 7, 28 + expectedHqAvailableDays)).toISOString().slice(0, 10);
    const expectedCompanyAvailableDays = Math.floor(
      (Number(rows[0]["可用公司庫存"] || 0) + Number(rows[0]["門市可售庫存"] || 0)) / Number(rows[0]["預估日需求"])
    );
    const expectedCompanyAvailableTo = new Date(Date.UTC(2026, 7, 28 + expectedCompanyAvailableDays)).toISOString().slice(0, 10);
    expect(rows[0]["總倉目前庫存可售至"]).toBe(expectedHqAvailableTo);
    expect(rows[0]["全公司合計庫存可售至"]).toBe(expectedCompanyAvailableTo);
    expect(rows[0]["全公司系統建議採購後可售至"]).toMatch(/^2026-/);
    expect(rows[0]["人工確認採購量"]).toBe("");
    expect(rows[0]["全公司人工確認後可售至"]).toBe("");
    expect(rows[0]).not.toHaveProperty("總部需求（人工）");
    expect(rows[0]).not.toHaveProperty("門市需求（人工）");
    expect(rows[0]).toMatchObject({ "供應交期類型": "寄倉快速補貨", "到貨交期天數": 5, "目標覆蓋天數": 23 });
    expect(output.SheetNames.every((sheetName) => !output.Sheets[sheetName]["!protect"])).toBe(true);
    const editableHeaders = XLSX.utils.sheet_to_json(output.Sheets["03B1_普優瑪_天絲"], { header: 1, defval: "" })[0];
    expect(editableHeaders.indexOf("總倉目前庫存可售至") + 1).toBe(editableHeaders.indexOf("全公司合計庫存可售至"));
    expect(editableHeaders.indexOf("全公司合計庫存可售至") + 1).toBe(editableHeaders.indexOf("全公司系統建議採購後可售至"));
    const totalCell = output.Sheets["03B1_普優瑪_天絲"][XLSX.utils.encode_cell({ r: 1, c: editableHeaders.indexOf("加總需求（公式）") })];
    const hqCell = XLSX.utils.encode_cell({ r: 1, c: editableHeaders.indexOf("總部需求（系統）") });
    const storeCell = XLSX.utils.encode_cell({ r: 1, c: editableHeaders.indexOf("門市需求（系統）") });
    expect(totalCell.f).toBe(`${hqCell}+${storeCell}`);
    expect(totalCell.s?.protection).toBeUndefined();
    const manualCell = output.Sheets["03B1_普優瑪_天絲"][XLSX.utils.encode_cell({ r: 1, c: editableHeaders.indexOf("人工確認採購量") })];
    const decisionCell = output.Sheets["03B1_普優瑪_天絲"][XLSX.utils.encode_cell({ r: 1, c: editableHeaders.indexOf("全公司系統建議採購後可售至") })];
    const currentInventoryAvailableToCell = output.Sheets["03B1_普優瑪_天絲"][XLSX.utils.encode_cell({ r: 1, c: editableHeaders.indexOf("總倉目前庫存可售至") })];
    expect(manualCell.s?.fill?.fgColor?.rgb).toBe("FFFFF2CC");
    expect(currentInventoryAvailableToCell.s?.fill?.fgColor?.rgb).toBe("FFE8F2F5");
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
    expect(summary.some((row) => row[0] === "五來源日期檢核" && row[1] === "未提供")).toBe(true);
    expect(summary.some((row) => row[0] === "使用限制" && String(row[1]).includes("不可直接下單"))).toBe(true);
  });

  it("普優瑪寄庫報表以花色為大類、品項為中類、尺寸為小類", () => {
    expect(core.puyoumaConsignmentGroup({ name: "5尺60天絲床包 [晨曦]", purchaseTab: "天絲＋天絲棉", mainCategory: "床包", size: "5尺床包" }))
      .toEqual({ materialCategory: "天絲／天絲棉", majorCategory: "晨曦", mediumCategory: "床包", smallCategory: "5尺床包", size: "5尺床包" });
    expect(core.puyoumaConsignmentGroup({ name: "60天絲枕套 [晨曦]", purchaseTab: "天絲＋天絲棉", mainCategory: "枕套", size: "48×75公分" }))
      .toEqual({ materialCategory: "天絲／天絲棉", majorCategory: "晨曦", mediumCategory: "枕套", smallCategory: "48×75公分", size: "48×75公分" });
    expect(core.puyoumaConsignmentGroup({ name: "走走多功能收納盒S", purchaseTab: "無尺寸品項", mainCategory: "收納" }))
      .toEqual({ materialCategory: "無尺寸", majorCategory: "走走多功能收納盒S", mediumCategory: "收納", smallCategory: "無尺寸", size: "無尺寸" });
    expect(core.puyoumaConsignmentGroup({ name: "天絲刺繡抱枕-綠霧森林", purchaseTab: "天絲＋天絲棉", mainCategory: "抱枕" }))
      .toEqual({ materialCategory: "天絲／天絲棉", majorCategory: "綠霧森林", mediumCategory: "抱枕", smallCategory: "無尺寸", size: "無尺寸" });

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
    expect(rows[0][0]).toBe("普優瑪寄庫建議（依花色、品項與尺寸分類）");
    const headers = rows[3];
    expect(headers.slice(0, 7)).toEqual(["材質／分頁", "大類（花色／同品項）", "中類（品項）", "小類（尺寸）", "ERP品號", "供應商貨號", "商品品名"]);
    const materialSummary = rows.find((row) => row[0] === "材質區段：天絲／天絲棉");
    const majorSummary = rows.find((row) => row[1] === "大類小計：晨曦");
    expect(materialSummary[headers.indexOf("建議新增寄庫量")]).toBe(20);
    expect(majorSummary[headers.indexOf("寄倉現貨缺口")]).toBe(6);
    expect(majorSummary[headers.indexOf("建議新增寄庫量")]).toBe(20);
    const details = rows.filter((row) => row[0] === "天絲／天絲棉" && row[1] === "晨曦");
    expect(details.map((row) => row[2])).toEqual(["床包", "枕套"]);
    expect(details.map((row) => row[3])).toEqual(["5尺床包", "48×75公分"]);

    const purchaseRows = XLSX.utils.sheet_to_json(output.Sheets["03B1_普優瑪_天絲"], { defval: "" });
    expect(purchaseRows[0]).toMatchObject({
      "大類（花色／同品項）": "晨曦",
      "中類（品項）": "床包",
      "小類（尺寸）": "5尺床包"
    });
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
    expect(output.SheetNames).not.toContain("02_所選範圍採購建議");
    expect(output.SheetNames).toContain("03B1_普優瑪_天絲");
    expect(output.SheetNames).not.toContain("03A_力榮採購");
    expect(output.SheetNames).not.toContain("03C_上林採購");
    expect(output.SheetNames).not.toContain("03D_其它供應商");
    expect(output.SheetNames).toEqual(expect.arrayContaining(["07_排除與例外", "08_核心規則"]));
    const summary = XLSX.utils.sheet_to_json(output.Sheets["01_採購摘要"], { header: 1, defval: "" });
    expect(summary.find((row) => row[0] === "本次匯出範圍")?.[1]).toBe("普優瑪");
    expect(summary.find((row) => row[0] === "建議採購金額")?.[1]).toBe(puyoumaAmount);
    const selectedRows = ["03B1_普優瑪_天絲", "03B2_普優瑪_長絨棉", "03B3_普優瑪_無尺寸"]
      .flatMap((sheetName) => XLSX.utils.sheet_to_json(output.Sheets[sheetName], { defval: "" }));
    expect(new Set(selectedRows.map((row) => row["供應商"]))).toEqual(new Set(["普優瑪"]));

    recommendations.lirongConsignmentRows = [{ sku: "L1", supplierSku: "LR-L1", sourceName: "力榮測試品", masterName: "力榮測試品", tier: "穩定", forecastDailyQty: 1, pullLeadDays: 5, productionDays: 14, earliestDeliveryDays: 19, targetLowDays: 60, targetHighDays: 90, targetDays: 60, currentQty: 0, scheduledQty: 0, approvedPullQty: 0, productionCompleteDate: "", expectedArrivalDate: "", rawQty: 20, downQty: 20, upQty: 20, suggestedQty: 20, availableDaysAfter: 20, beforePullRisk: true, beforeProductionRisk: true, beforeDeliveryRisk: true, status: "需製作", futureCost: 6000, scheduleNotes: [] }];
    const lirongOutput = core.buildRecommendationWorkbook(recommendations, XLSX, { selectedSuppliers: ["力榮"] });
    expect(lirongOutput.SheetNames).toEqual(expect.arrayContaining(["03A_力榮採購", "04B_力榮寄庫建議"]));
    expect(lirongOutput.SheetNames).not.toContain("03B1_普優瑪_天絲");
    const lirongPurchase = XLSX.utils.sheet_to_json(lirongOutput.Sheets["03A_力榮採購"], { defval: "" });
    expect(lirongPurchase[0]).toEqual(expect.objectContaining({
      "大類（花色／同品項）": expect.any(String),
      "中類（品項）": expect.any(String),
      "小類（尺寸）": expect.any(String)
    }));
    const lirongConsignment = XLSX.utils.sheet_to_json(lirongOutput.Sheets["04B_力榮寄庫建議"], { defval: "" });
    expect(lirongConsignment[0]).toEqual(expect.objectContaining({
      "大類（花色／同品項）": expect.any(String),
      "中類（品項）": expect.any(String),
      "小類（尺寸）": expect.any(String)
    }));
  });

  it("同一母批次依實際供應商拆單，普優瑪再拆成三個獨立審核單位", () => {
    const base = { supplier: "普優瑪", suggestedPurchaseQty: 2, suggestedPurchaseAmount: 1000, unitCost: 500, sourceFiles: [] };
    const rows = [
      { ...base, sku: "P-T", purchaseTab: "天絲＋天絲棉" },
      { ...base, sku: "P-C", purchaseTab: "長絨棉" },
      { ...base, sku: "P-N", purchaseTab: "無尺寸品項" },
      { ...base, sku: "O-1", supplier: "測試廠商甲", purchaseTab: "其它" },
      { ...base, sku: "O-2", supplier: "測試廠商乙", purchaseTab: "其它" }
    ];
    const recommendations = {
      rows, suggestedRows: rows, consignmentRows: [], lirongConsignmentRows: [], productExclusions: [],
      consignment: { confirmedExclusions: [], exceptions: [], excluded: [] }, totals: {}, validation: {}, meta: {}, asOfDate: "2026-09-18"
    };
    const units = core.listProcurementWorkUnits(recommendations);
    expect(units.map((unit) => unit.label)).toEqual(expect.arrayContaining([
      "普優瑪寢具有限公司－天絲／天絲棉", "普優瑪寢具有限公司－長絨棉", "普優瑪寢具有限公司－無尺寸", "測試廠商甲", "測試廠商乙"
    ]));
    expect(units).toHaveLength(5);
    const cotton = units.find((unit) => unit.purchaseTab === "長絨棉");
    const output = core.buildRecommendationWorkbook(recommendations, XLSX, { selectedSuppliers: ["普優瑪"], workUnit: cotton });
    expect(output.SheetNames).toContain("03B2_普優瑪_長絨棉");
    expect(output.SheetNames).not.toContain("03B1_普優瑪_天絲");
    expect(output.SheetNames).not.toContain("03B3_普優瑪_無尺寸");
    const exported = XLSX.utils.sheet_to_json(output.Sheets["03B2_普優瑪_長絨棉"], { defval: "" });
    expect(exported.map((row) => row["ERP品號"])).toEqual(["P-C"]);
    const groupedUnits = units.filter((unit) => ["測試廠商甲", "測試廠商乙"].includes(unit.supplier));
    const grouped = {
      id: `GROUP::${groupedUnits.map((unit) => unit.id).join("||")}`,
      memberIds: groupedUnits.map((unit) => unit.id),
      label: groupedUnits.map((unit) => unit.label).join("＋")
    };
    const groupedOutput = core.buildRecommendationWorkbook(recommendations, XLSX, { selectedSuppliers: ["測試廠商甲", "測試廠商乙"], workUnit: grouped });
    const groupedRows = XLSX.utils.sheet_to_json(groupedOutput.Sheets["03D_其它供應商"], { defval: "" });
    expect(groupedRows.map((row) => row["ERP品號"])).toEqual(["O-1", "O-2"]);
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
    const erp = core.buildErpPurchaseWorkbook(review, XLSX, { approved: true, batchId: "PP-TEST" });
    expect(erp.SheetNames).toEqual(["通用貨品數量"]);
    const erpRows = XLSX.utils.sheet_to_json(erp.Sheets["通用貨品數量"], { header: 1, defval: "" });
    expect(erpRows[0]).toEqual(["貨號", "品名", "顏色", "尺碼", "數量", "價格", "備註", "倉庫"]);
    expect(erpRows[1]).toEqual(["A1", "60天絲測試床包", "", "", 20, 500, "", "寬承總倉"]);
    expect(erpRows).toHaveLength(2);
    expect(erp.Sheets["通用貨品數量"]["A1"].s).toBeUndefined();
    const mixedReview = { ...review, rows: [...review.rows, { ...review.rows[0], sku: "B1", supplier: "另一供應商" }] };
    const supplierErp = core.buildErpPurchaseWorkbook(mixedReview, XLSX, { approved: true, supplier: review.rows[0].supplier });
    const supplierErpRows = XLSX.utils.sheet_to_json(supplierErp.Sheets["通用貨品數量"], { header: 1, defval: "" });
    expect(supplierErpRows).toHaveLength(2);
    expect(supplierErpRows[1][0]).toBe("A1");
  });

  it("第一次覆核與第二次異動使用同一份檔案，留白沿用且異動會重算最終核准金額", () => {
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
    expect(secondWorkbook.SheetNames).toContain("01_覆核摘要");
    expect(secondWorkbook.SheetNames).toContain("02_覆核與異動確認");
    const secondRows = XLSX.utils.sheet_to_json(secondWorkbook.Sheets["02_覆核與異動確認"], { defval: "" });
    expect(secondRows[0]["全公司人工確認後可售至"]).toMatch(/^2026-/);
    expect(secondRows[0]).not.toHaveProperty("人工填寫可售至");
    const secondStyleHeaders = XLSX.utils.sheet_to_json(secondWorkbook.Sheets["02_覆核與異動確認"], { header: 1, defval: "" })[0];
    expect(secondStyleHeaders.slice(5, 11)).toEqual(["原始採購建議量", "第一次人工回匯量", "第一次人工調整原因", "第一次覆核可核准量", "第二次異動採購量", "第二次異動原因"]);
    const secondManualCell = secondWorkbook.Sheets["02_覆核與異動確認"][XLSX.utils.encode_cell({ r: 1, c: secondStyleHeaders.indexOf("第二次異動採購量") })];
    expect(secondManualCell.s?.fill?.fgColor?.rgb).toBe("FFFFF2CC");
    const unchangedReview = core.reviewSecondApprovalWorkbook(secondWorkbook, XLSX, { asOfDate: "2026-08-28", orderDate: "2026-09-20", baselineBySku: new Map(firstReview.rows.map((row) => [row.sku, row])) });
    expect(unchangedReview.errors).toHaveLength(0);
    expect(unchangedReview.rows[0].finalQty).toBe(firstReview.rows[0].finalQty);
    const secondSheet = secondWorkbook.Sheets["02_覆核與異動確認"];
    const secondHeaders = XLSX.utils.sheet_to_json(secondSheet, { header: 1, defval: "" })[0];
    secondSheet[XLSX.utils.encode_cell({ r: 1, c: secondHeaders.indexOf("第二次異動採購量") })] = { t: "n", v: 22 };
    const missingReasonReview = core.reviewSecondApprovalWorkbook(secondWorkbook, XLSX, { asOfDate: "2026-08-28", orderDate: "2026-09-20", baselineBySku: new Map(firstReview.rows.map((row) => [row.sku, row])) });
    expect(missingReasonReview.errors.some((error) => error.message.includes("必須填寫第二次異動原因"))).toBe(true);
    secondSheet[XLSX.utils.encode_cell({ r: 1, c: secondHeaders.indexOf("第二次異動原因") })] = { t: "s", v: "供應商臨時可追加" };
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

  it("商品主檔同時有上市日期與開賣日期時優先採用開賣日期", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["貨號", "品名", "供應商簡稱", "進貨價", "最小配貨數", "貨品狀態", "上市日期", "開賣日期"],
      ["NEW-1", "60天絲5尺床包", "普優瑪", 500, 20, "尚可追加", "2026/01/01", "2026/09/03"]
    ]), "工作表1");
    expect(core.parseProductMasterWorkbook(workbook, XLSX).bySku.get("NEW-1").listedDate).toBe("2026/09/03");
  });

  it("新品15至28天且實績明顯領先時採75比25混合，並排除公關品移動", () => {
    const masterBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(masterBook, XLSX.utils.aoa_to_sheet([
      ["貨號", "品名", "供應商簡稱", "進貨價", "最小配貨數", "貨品狀態", "開賣日期", "主類別", "尺碼"],
      ["NEW-1", "60天絲5尺床包[新品]", "普優瑪", 500, 20, "尚可追加", "2026/09/03", "床包", "5尺"],
      ["OLD-1", "60天絲5尺床包[成熟1]", "普優瑪", 500, 20, "尚可追加", "2025/01/01", "床包", "5尺"],
      ["OLD-2", "60天絲5尺床包[成熟2]", "普優瑪", 500, 20, "尚可追加", "2025/01/01", "床包", "5尺"],
      ["OLD-3", "60天絲5尺床包[成熟3]", "普優瑪", 500, 20, "尚可追加", "2025/01/01", "床包", "5尺"]
    ]), "工作表1");
    const master = core.parseProductMasterWorkbook(masterBook, XLSX);
    const inventoryBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(inventoryBook, XLSX.utils.aoa_to_sheet([
      ["店倉編號", "店倉名稱", "貨號", "品名", "實際庫存"],
      ["T00", "寬承總倉", "NEW-1", "60天絲5尺床包[新品]", 0]
    ]), "乾淨商品");
    const salesBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(salesBook, XLSX.utils.aoa_to_sheet([
      ["銷別", "結帳時間", "貨號", "品名", "銷售量", "開單倉編號", "開單倉名稱"],
      ["銷貨", "2026/09/05", "NEW-1", "60天絲5尺床包[新品]", 21, "R00", "台北門市"],
      ["銷貨", "2026/09/06", "NEW-1", "60天絲5尺床包[新品]", 4, "O06", "公關品"],
      ["銷貨", "2026/09/05", "OLD-1", "60天絲5尺床包[成熟1]", 6, "R00", "台北門市"],
      ["銷貨", "2026/09/05", "OLD-2", "60天絲5尺床包[成熟2]", 7, "R00", "台北門市"],
      ["銷貨", "2026/09/05", "OLD-3", "60天絲5尺床包[成熟3]", 8, "R00", "台北門市"]
    ]), "工作表1");
    const analysis = core.buildProcurementRecommendations({
      master,
      inventory: core.parseInventoryWorkbook(inventoryBook, XLSX),
      pendingReports: [],
      consignment: { records: [], exceptions: [], confirmedExclusions: [] },
      salesReports: [core.parseSalesWorkbook(salesBook, XLSX)],
      model: { bySku: new Map(), byMaterial: new Map(), seasonalIndexByMaterial: new Map() },
      blacklist: [], asOfDate: "2026-09-21", checkpoint: "mid-month"
    });
    const row = analysis.rows.find((item) => item.sku === "NEW-1");
    expect(row.newProductDemand).toMatchObject({ activeDays: 19, netQuantity: 21, actualWeight: 0.75, categoryWeight: 0.25, categorySampleCount: 3 });
    expect(row.skuModel).toContain("新品動態混合");
    expect(row.newProductDemand.blendedDaily).toBeGreaterThan(row.newProductDemand.categoryDaily);
  });

  it("第一次回匯允許只填ERP品號、人工量與原因並由同批次補回資料", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["ERP品號", "人工確認採購量", "人工調整原因"],
      ["A42396", 40, "新品銷售優於類別基準"]
    ]), "03B1_普優瑪_天絲");
    const baseline = {
      sku: "A42396", supplier: "普優瑪", name: "60天絲5尺床包[MissCrazy]", supplierSku: "P-A42396", unitCost: 750,
      suggestedPurchaseQty: 20, packSize: 20, forecastDailyQty: 1.7, inventoryQty: 9, storeInventoryByCode: { R00: 1 },
      hqDemandQty: 30, storeDemandQty: 10, pendingQty: 0, effectivePendingQty: 0, consignmentCurrentQty: 80, consignmentScheduledQty: 20,
      purchaseTab: "天絲＋天絲棉", productStatusPendingReview: false, externalPurchaseBlocked: false
    };
    const review = core.reviewReturnedWorkbook(workbook, XLSX, {
      asOfDate: "2026-09-21", orderDate: "2026-09-22",
      baselineBySku: new Map([[baseline.sku, baseline]]), allowedSkuSet: new Set([baseline.sku])
    });
    expect(review.errors).toHaveLength(0);
    expect(review.rows[0]).toMatchObject({ supplier: "普優瑪", name: baseline.name, unitCost: 750, confirmedQty: 40, finalQty: 40, manuallyAdded: true, packSize: 20, consignmentCurrentQty: 80, consignmentScheduledQty: 20 });
    const second = core.buildSecondReviewWorkbook(review, XLSX);
    const secondRow = XLSX.utils.sheet_to_json(second.Sheets["02_覆核與異動確認"], { defval: "" })[0];
    expect(secondRow["本次人工新增"]).toContain("資料已由本次計算批次補回");
    expect(secondRow["需求摘要"]).toContain("總部需求30.00");
  });

  it("人工新增品號跨出目前供應商範圍時顯示明確原因", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["ERP品號", "人工量", "原因"], ["OTHER-1", 10, "人工追加"]
    ]), "03B1_普優瑪_天絲");
    const baseline = { sku: "OTHER-1", supplier: "力榮", name: "測試品", unitCost: 100, suggestedPurchaseQty: 0, packSize: 10, forecastDailyQty: 1, inventoryQty: 0, storeInventoryByCode: {}, pendingQty: 0, purchaseTab: "其它" };
    const review = core.reviewReturnedWorkbook(workbook, XLSX, { baselineBySku: new Map([[baseline.sku, baseline]]), allowedSkuSet: new Set() });
    expect(review.errors.some((error) => error.message.includes("不可加入目前的採購批次"))).toBe(true);
  });

  it("普優瑪採購單位可依尺寸辨識，不要求品名一定寫單人或雙人", () => {
    expect(core.puyoumaPackSize({ name: "60天絲4.5x6.5尺薄被套" })).toBe(10);
    expect(core.puyoumaPackSize({ name: "60天絲6×7尺薄被套" })).toBe(20);
    expect(core.puyoumaPackSize({ name: "60天絲6x7尺兩用被套" })).toBe(10);
    expect(core.puyoumaPackSize({ name: "60天絲3.5尺床包" })).toBe(10);
    expect(core.puyoumaPackSize({ name: "60天絲5尺床包" })).toBe(20);
  });

  it("普優瑪可用指定原因精確清回全部寄庫現貨，粉紅排程不計入且二次覆核沿用", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["ERP品號", "人工確認採購量", "人工調整原因"],
      ["A41385", 9, "全部寄庫現貨清回"],
      ["A42327", 22, "最後剩餘數量"]
    ]), "03B1_普優瑪_天絲");
    const baselines = [
      { sku: "A41385", supplier: "普優瑪寢具有限公司", name: "3.5尺床包60S天絲 [永夜]", unitCost: 450, suggestedPurchaseQty: 0, packSize: 10, forecastDailyQty: 0.3, inventoryQty: 0, storeInventoryByCode: {}, pendingQty: 0, consignmentCurrentQty: 9, consignmentScheduledQty: 20 },
      { sku: "A42327", supplier: "普優瑪寢具有限公司", name: "5尺天絲床包 [深灰雪松]", unitCost: 460, suggestedPurchaseQty: 20, packSize: 20, forecastDailyQty: 1.2, inventoryQty: 14, storeInventoryByCode: {}, pendingQty: 0, consignmentCurrentQty: 22, consignmentScheduledQty: 40 }
    ];
    const review = core.reviewReturnedWorkbook(workbook, XLSX, {
      baselineBySku: new Map(baselines.map((row) => [row.sku, row])),
      allowedSkuSet: new Set(baselines.map((row) => row.sku))
    });
    expect(review.errors).toHaveLength(0);
    expect(review.rows.map((row) => ({ sku: row.sku, finalQty: row.finalQty, currentAvailableQty: row.currentAvailableQty, fullConsignmentReturn: row.fullConsignmentReturn }))).toEqual([
      { sku: "A41385", finalQty: 9, currentAvailableQty: 9, fullConsignmentReturn: true },
      { sku: "A42327", finalQty: 22, currentAvailableQty: 22, fullConsignmentReturn: true }
    ]);

    const second = core.buildSecondReviewWorkbook(review, XLSX);
    const secondSheet = second.Sheets["02_覆核與異動確認"];
    const secondRows = XLSX.utils.sheet_to_json(secondSheet, { header: 1, raw: true, defval: "" });
    const secondQtyColumn = secondRows[0].indexOf("第二次異動採購量");
    secondSheet[XLSX.utils.encode_cell({ r: 1, c: secondQtyColumn })] = { t: "n", v: 9 };
    secondSheet[XLSX.utils.encode_cell({ r: 2, c: secondQtyColumn })] = { t: "n", v: 22 };
    const confirmed = core.reviewSecondApprovalWorkbook(second, XLSX, { baselineBySku: new Map(review.rows.map((row) => [row.sku, row])) });
    expect(confirmed.errors).toHaveLength(0);
  });

  it("全部寄庫現貨清回會扣除正式未到貨與其他有效批次占用，數量不相符即阻擋", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["ERP品號", "人工確認採購量", "人工調整原因"],
      ["A41385", 9, "全部寄庫現貨清回"]
    ]), "03B1_普優瑪_天絲");
    const baseline = { sku: "A41385", supplier: "普優瑪寢具有限公司", name: "3.5尺床包60S天絲 [永夜]", unitCost: 450, suggestedPurchaseQty: 0, packSize: 10, pendingQty: 2, consignmentCurrentQty: 12, consignmentScheduledQty: 20 };
    const review = core.reviewReturnedWorkbook(workbook, XLSX, {
      baselineBySku: new Map([[baseline.sku, baseline]]), allowedSkuSet: new Set([baseline.sku]),
      reservedConsignmentBySku: new Map([[baseline.sku, 3]])
    });
    expect(review.rows[0].currentAvailableQty).toBe(7);
    expect(review.errors.some((error) => error.message.includes("可清回量7件"))).toBe(true);
  });

  it("S品仍可在既有寄庫現貨範圍內拉回，但不得新增寄庫生產", () => {
    const masterBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(masterBook, XLSX.utils.aoa_to_sheet([
      ["貨號", "品名", "供應商貨號", "供應商簡稱", "進貨價", "最小配貨數", "貨品狀態"],
      ["B53355", "60天絲6×7尺兩用被套[測試](S)", "V-B53355", "普優瑪", 900, 10, "尚可追加"]
    ]), "工作表1");
    const inventoryBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(inventoryBook, XLSX.utils.aoa_to_sheet([
      ["店倉編號", "店倉名稱", "貨號", "品名", "實際庫存"], ["T00", "寬承總倉", "B53355", "60天絲6×7尺兩用被套[測試](S)", 0]
    ]), "乾淨商品");
    const salesBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(salesBook, XLSX.utils.aoa_to_sheet([
      ["銷別", "結帳時間", "貨號", "品名", "銷售量", "開單倉編號", "開單倉名稱"],
      ["銷貨", "2026/09/20", "B53355", "60天絲6×7尺兩用被套[測試](S)", 20, "T00", "總倉"]
    ]), "工作表1");
    const consignmentBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(consignmentBook, XLSX.utils.aoa_to_sheet([
      ["產品編號", "編號", "商品名稱", "成品價", "最新庫存09/21"],
      ["V-B53355", "B53355", "60天絲6×7尺兩用被套[測試](S)", 900, 70]
    ]), "庫存+下單");
    const analysis = core.buildProcurementRecommendations({
      master: core.parseProductMasterWorkbook(masterBook, XLSX), inventory: core.parseInventoryWorkbook(inventoryBook, XLSX), pendingReports: [],
      consignment: core.parseConsignmentWorkbook(consignmentBook, XLSX), salesReports: [core.parseSalesWorkbook(salesBook, XLSX)],
      model: { bySku: new Map(), byMaterial: new Map(), seasonalIndexByMaterial: new Map() }, blacklist: [], asOfDate: "2026-09-21", checkpoint: "mid-month"
    });
    const row = analysis.rows.find((item) => item.sku === "B53355");
    expect(row).toMatchObject({ sellThroughStop: true, sellThroughConsignmentAllowed: true, sellThroughConsignmentAvailableQty: 70, externalPurchaseBlocked: false, suggestedConsignmentQty: 0, packSize: 10 });
    expect(row.suggestedPurchaseQty).toBeGreaterThan(0);
    expect(row.suggestedPurchaseQty).toBeLessThanOrEqual(70);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["ERP品號", "人工量", "原因"], ["B53355", 20, "清回既有寄庫現貨"]
    ]), "03B1_普優瑪_天絲");
    const review = core.reviewReturnedWorkbook(workbook, XLSX, { baselineBySku: new Map([[row.sku, row]]), allowedSkuSet: new Set([row.sku]) });
    expect(review.errors).toHaveLength(0);
    expect(review.rows[0]).toMatchObject({ finalQty: 20, blockedReason: "", currentAvailableQty: 70 });

    const legacyRow = { ...row, suggestedPurchaseQty: 0, externalPurchaseBlocked: true, supplyStatus: "售完即停：不對外採購、不新增寄庫；可用總倉現貨銷售或調撥" };
    delete legacyRow.sellThroughConsignmentAllowed;
    delete legacyRow.sellThroughConsignmentAvailableQty;
    const legacyWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(legacyWorkbook, XLSX.utils.aoa_to_sheet([
      ["ERP品號", "人工量", "原因"], ["B53355", 10, "人工增加"]
    ]), "03B1_普優瑪_天絲");
    const legacyReview = core.reviewReturnedWorkbook(legacyWorkbook, XLSX, { baselineBySku: new Map([[legacyRow.sku, legacyRow]]), allowedSkuSet: new Set([legacyRow.sku]) });
    expect(legacyReview.errors).toHaveLength(0);
    expect(legacyReview.rows[0]).toMatchObject({ finalQty: 10, blockedReason: "", currentAvailableQty: 70, sellThroughConsignmentAllowed: true });

    const second = core.buildSecondReviewWorkbook(legacyReview, XLSX);
    const secondSheet = second.Sheets["02_覆核與異動確認"];
    const secondRows = XLSX.utils.sheet_to_json(secondSheet, { header: 1, raw: true, defval: "" });
    const secondQtyColumn = secondRows[0].indexOf("第二次異動採購量");
    secondSheet[XLSX.utils.encode_cell({ r: 1, c: secondQtyColumn })] = { t: "n", v: 10 };
    const legacyConfirmed = core.reviewSecondApprovalWorkbook(second, XLSX, { baselineBySku: new Map(legacyReview.rows.map((item) => [item.sku, item])) });
    expect(legacyConfirmed.errors).toHaveLength(0);
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
    expect(toolAppSource).toContain("const workbook = core.buildRecommendationWorkbook(state.analysis, outputXlsx");
    expect(toolAppSource).toContain("appendWorkflowSnapshotSheet(workbook");
    expect(toolAppSource).toContain("XLSX.writeFile(core.buildErpPurchaseWorkbook(state.review, XLSX");
    expect(toolAppSource).toContain("if (state.firstReview.errors.length) renderWorkflowErrors");
    expect(toolHtml).toContain('id="workflow-errors"');
    expect(toolHtml).toContain("公司 Google 授權");
    expect(toolHtml).toContain("正式核准並寄送摘要");
    expect(toolHtml).toContain("回匯有異動的覆核表");
    expect(toolHtml).toContain("全部沿用並送出待核准");
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
    expect(toolHtml).toContain("drive.google.com/drive/folders/1wzVoxLUXb9CEJK-cWrH8AMPxO5NVpTeC");
    expect(toolHtml).toContain("docs.google.com/spreadsheets/d/1l-3gd0gmx-nX6Je5XeWBRxZ1bFzZeGY0");
    expect(toolHtml).toContain("docs.google.com/spreadsheets/d/1MPG0mSYQZ_ITp79eTHZ71z3ra9pq6pNhmHLlWDS0Ec4");
    expect(toolHtml).toContain("docs.google.com/spreadsheets/d/1uEc8DBg50lB4uqM8UrTYYEuZz8blPLJgP8JCm1IUzWI");
    expect(toolHtml).toContain("drive.google.com/drive/folders/1ZUG_f_wNSyOOhtECYzCYSXj6DLRiHyo3");
    expect(toolHtml).toContain("https://sheets.googleapis.com");
    expect(headers).toMatch(/\/procurement-planning\/index\.html[\s\S]*connect-src[^\n]*https:\/\/sheets\.googleapis\.com/);
    expect(headers).toMatch(/\/procurement-planning\/index\.html[\s\S]*connect-src[^\n]*https:\/\/gmail\.googleapis\.com/);
    expect(headers).toMatch(/\/procurement-planning\/index\.html[\s\S]*worker-src 'self'/);
    expect(headers).not.toMatch(/\/procurement-planning\/index\.html[\s\S]*worker-src 'none'/);
    expect(toolHtml).not.toContain('id="blacklist-input"');
    expect(toolHtml).not.toContain("人工控制");
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
    expect(toolHtml).toContain("勾選後下載本批報表");
    expect(toolHtml).toContain("分批審核與開單");
    expect(toolHtml).toContain('id="work-unit-selection-status"');
    expect(toolHtml.indexOf('id="work-unit-list"')).toBeLessThan(toolHtml.indexOf('id="download-button"'));
    expect(toolHtml).toContain("春節加量");
    expect(toolHtml).toContain('id="workflow-step-download"');
    expect(toolHtml).toContain('id="review-file-label" class="file-button is-disabled"');
    expect(toolHtml).toContain("新品首批採購");
    expect(toolHtml).toContain("人工匯入採購單");
    expect(toolHtml).toContain("補登已採購單");
    expect(toolHtml).toContain("補登已建立ERP採購單可直接執行");
    expect(toolHtml).toContain('id="active-ledger-rows"');
    const toolApp = readFileSync("../procurement-planning/app.js", "utf8");
    const procurementWorker = readFileSync("worker/src/procurement.ts", "utf8");
    expect(toolApp).toContain("/api/procurement/month-plan");
    expect(toolApp).toContain("/api/procurement/cost-snapshot");
    expect(toolHtml).toContain('id="cost-snapshot-status"');
    expect(toolHtml).toContain("SA、OA、SB、OB開頭品號及品名標示8×7尺的商品排除一般採購與寄庫");
    expect(toolHtml).toContain("20260924-p0-r2");
    expect(toolApp).toContain("state.postedOrderFiles.length && state.config?.permissions?.canApprove");
    expect(toolApp).toContain("state.parsedSources?.master");
    expect(toolApp).toContain("可直接檢查並補登，不必先產生採購建議");
    expect(toolApp).toContain("操作環節：自動取得最新資料");
    expect(toolApp).toContain("失敗區塊：");
    expect(toolApp).toContain("失敗階段：");
    expect(toolApp).toContain("處理結果：");
    expect(toolApp).toContain("建議處理：");
    expect(toolHtml).toContain("採購批次續作與多人協作");
    expect(toolHtml).toContain('id="shared-draft-list"');
    expect(toolHtml).toContain("發布協作草稿");
    expect(toolApp).toContain("function renderResumeDrafts()");
    expect(toolApp).toContain("function renderSharedDrafts()");
    expect(toolApp).toContain("/api/procurement/collaboration-drafts");
    expect(procurementWorker).toContain('/api/procurement/cost-snapshot');
    expect(procurementWorker).toContain('/api/procurement/collaboration-drafts');
    expect(toolApp).toContain("canManageCollaborationDrafts");
    expect(procurementWorker).toContain('canManageCollaborationDrafts: role === "admin" || role === "approver"');
    expect(procurementWorker).not.toContain('只有最高權限可以移出公司共用協作草稿');
    expect(toolApp).toContain("母批次・固定置頂");
    expect(toolApp).toContain("function detachChildSharedIdentity");
    expect(toolApp).toContain("state.sharedDraftId = \"\"; state.sharedDraftRevision = 0;");
    expect(toolApp).toContain("function repairOverwrittenParentDraft");
    expect(toolApp).toContain("已保留原子批次並恢復公司共用母批次");
    expect(toolApp).toContain("移出協作區");
    expect(toolApp).toContain('{ method: "DELETE"');
    expect(procurementWorker).toContain("removed_at IS NULL");
    expect(procurementWorker).toContain('request.method === "DELETE"');
    expect(toolHtml).toContain('id="store-shortage-select-all"');
    expect(toolHtml).toContain('data-shortage-bulk-mode="merge_next"');
    expect(toolHtml).toContain('data-shortage-bulk-close="cancelled"');
    expect(toolHtml.indexOf('id="special-workflows-title"')).toBeLessThan(toolHtml.indexOf('id="store-shortage-card"'));
    expect(toolApp).toContain("async function batchDecideStoreShortages(button)");
    const collaborationMigration = readFileSync("worker/migrations/0022_procurement_collaboration_drafts.sql", "utf8");
    expect(collaborationMigration).toContain("CREATE TABLE procurement_collaboration_drafts");
    expect(collaborationMigration).not.toMatch(/file_name|excel|raw_rows/i);
    const collaborationRemovalMigration = readFileSync("worker/migrations/0026_procurement_collaboration_draft_soft_remove.sql", "utf8");
    expect(collaborationRemovalMigration).toContain("ADD COLUMN removed_at");
    expect(collaborationRemovalMigration).toContain("ADD COLUMN removed_by");
    expect(collaborationRemovalMigration).not.toMatch(/DELETE FROM|DROP TABLE/i);
    const costSnapshotMigration = readFileSync("worker/migrations/0021_procurement_cost_snapshots.sql", "utf8");
    expect(costSnapshotMigration).toContain("CREATE TABLE procurement_cost_snapshots");
    expect(costSnapshotMigration).toContain("source_hashes");
    expect(costSnapshotMigration).not.toMatch(/file_name|excel|raw_rows/i);
    expect(procurementWorker).toContain("VALUES (?, 'neutral', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(analysis_month)");
    expect(procurementWorker).not.toContain("VALUES (?, 'neutral', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(analysis_month)");
    expect(toolApp).toContain('setAutomaticSourceBusy(true, "正在取得 4 項最新資料…")');
    expect(toolApp).toContain('completed ? "重新取得最新資料" : "重試取得最新資料"');
    expect(toolApp).toMatch(/async function downloadRecommendation\(\)[\s\S]*state\.selectedWorkUnitIds = new Set\(\);[\s\S]*persistWorkflowDraft\("downloaded"\)/);
    expect(toolApp).toContain("state.selectedWorkUnitIds = new Set();\n    const restoredSuppliers");
    expect(toolApp).toContain("forecastRevenue: Number(elements.forecastRevenue.value || 0)");
    expect(toolApp).toContain('refreshMonths: 6');
    expect(toolApp).toContain('indexedDB.open(MODEL_CACHE.database, 1)');
    expect(toolApp).toContain('elements.month.value >= refreshMonth');
    expect(toolApp).toContain("selectedSuppliers: new Set()");
    expect(toolApp).toContain("selectedPaymentSummary");
    expect(toolApp).toContain("下載後才會開放第一次人工回匯");
    expect(toolApp).toContain("大型檔案預檢未通過");
    expect(toolApp).toContain("/api/procurement/manual-orders");
    expect(toolApp).toContain("補回舊版逐品項基準");
    expect(toolApp).toContain("本次採購建議仍正常完成");
    expect(toolApp).not.toContain('if (missing.length) throw new Error(`ERP差異比對缺少原核准逐品項基準');
    expect(procurementWorker).toContain("baselineBackfilled: true");
    expect(procurementWorker).toContain("ERP採購單${erpReference}既有台帳總額");
    expect(procurementWorker).toContain("INSERT OR IGNORE INTO procurement_batch_items");
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
    expect(rulesAdminHtml).toContain('id="blacklist-input"');
    expect(rulesAdminHtml).toContain("排除採購商品黑名單");
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

  it("依門市歸屬拆分寬承成本、寬沐B3與公司間計價", () => {
    const summary = core.summarizeCompanyCostFlows({
      analysisMonth: "2026-09",
      master: { bySku: new Map([["A1", { unitCost: 100 }]]) },
      inventory: { records: [
        { warehouseCode: "T00", inventoryCost: 1000 },
        { warehouseCode: "R00", inventoryCost: 200 },
        { warehouseCode: "R03", inventoryCost: 300 }
      ] },
      salesReports: [{ records: [
        { date: "2026-09-10", warehouseCode: "R00", sku: "A1", purchaseCostAmount: 200 },
        { date: "2026-09-10", warehouseCode: "R03", sku: "A1", saleType: "訂貨", sourceOrder: "SO1", purchaseCostAmount: 100 }
      ], takeRecords: [
        { date: "2026-09-10", warehouseCode: "R03", shipWarehouseCode: "T00", sku: "A1", sourceOrder: "SO1", purchaseCostAmount: 100 }
      ] }],
      transferReports: [{ records: [
        { status: "收貨審核", sourceWarehouseCode: "T00", destinationWarehouseCode: "R06", receivedDate: "2026-09-08", sku: "A1", quantity: 2 }
      ] }],
      purchaseSummary: { actualReceiptCost: 500 }, openingInventoryCost: 2000
    });
    expect(summary.directCost).toBe(200);
    expect(summary.kuanmuBaseCost).toBe(300);
    expect(summary.kuanmuIntercompanyRevenue).toBeCloseTo(333);
    expect(summary.managementCostToDate).toBe(500);
    expect(summary.currentInventoryCost).toBe(1200);
    expect(summary.inventoryBridgeCost).toBe(1300);
  });
});

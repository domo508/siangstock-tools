import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function loadBrowserScript(path, context = {}) {
  const sandbox = { console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Blob, URL, setTimeout, clearTimeout, setImmediate, clearImmediate, ...context };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path, "utf8"), sandbox, { filename: path });
  return sandbox;
}

const xlsxContext = loadBrowserScript("../inventory/assets/xlsx.full.min.js");
const XLSX = xlsxContext.XLSX;
const jszipContext = loadBrowserScript("../cost-analysis/assets/jszip.min.js");
const JSZip = jszipContext.JSZip;
const core = loadBrowserScript("../cost-analysis/core.js", { XLSX }).InventoryCostCore;

function report(type, records) {
  return { records: records.map((record, index) => ({ reportType: type, sourceRow: index + 2, ...record })) };
}

function baseInventory(sku, openingQty, closingQty, purchasePrice = 10) {
  return {
    opening: report("opening", [{ sku, name: `商品${sku}`, warehouse: "寬承總倉", qty: openingQty, purchasePrice }]),
    closing: report("closing", [{ sku, name: `商品${sku}`, warehouse: "寬承總倉", qty: closingQty, purchasePrice }])
  };
}

describe("庫存成本分析核心規則", () => {
  it("期初期末納入公司倉與兩間直營，排除加盟店倉", () => {
    const included = [
      "寬承總倉", "台中北屯門市", "台北中山門市", "退貨倉", "瑕疵倉", "報廢倉", "員購倉",
      "客服倉", "行銷-活動&商品拍攝倉", "行銷-公關品倉", "行銷-寄賣倉", "行銷-市集特賣倉", "寄倉 momo 購物"
    ];
    for (const warehouse of included) expect(["included", "direct"]).toContain(core.classifyWarehouse(warehouse));
    expect(core.classifyWarehouse("台中文心秀泰專櫃")).toBe("franchise");
    expect(core.classifyWarehouse("新莊門巾")).toBe("franchise");
    expect(core.classifyWarehouse("[快閃] 高雄漢神本館")).toBe("included");
    expect(core.classifyWarehouse("[快閃] 台南期間限定店")).toBe("included");
  });

  it("當月進貨的成本價視為進貨價，一般銷售的成本價只視為平均成本", () => {
    const purchaseHeaders = ["商品編號", "品名", "進貨數量", "成本價"];
    const salesHeaders = ["商品編號", "品名", "銷售數量", "成本價"];
    const purchaseMap = core.autoMapHeaders(purchaseHeaders, "purchases");
    const salesMap = core.autoMapHeaders(salesHeaders, "sales");
    expect(purchaseMap.purchasePrice).toBe(3);
    expect(salesMap.averageCost).toBe(3);
    expect(salesMap.purchasePrice).toBeNull();
    expect(core.validateMapping("purchases", purchaseMap).valid).toBe(true);
    expect(core.validateMapping("sales", salesMap).valid).toBe(false);
  });

  it("欄位相似時以工作表名稱正確區分期初期末與進貨退貨", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["倉別", "商品編號", "庫存數量", "進貨價"]]), "期初庫存");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["倉別", "商品編號", "庫存數量", "進貨價"]]), "期末庫存");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["商品編號", "進貨數量", "成本價"]]), "當月進貨明細");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["商品編號", "退貨數量", "成本價"]]), "供應商退貨");
    expect(core.inspectWorkbook(workbook, XLSX, "opening").sheets[0].name).toBe("期初庫存");
    expect(core.inspectWorkbook(workbook, XLSX, "closing").sheets[0].name).toBe("期末庫存");
    expect(core.inspectWorkbook(workbook, XLSX, "purchases").sheets[0].name).toBe("當月進貨明細");
    expect(core.inspectWorkbook(workbook, XLSX, "supplierReturns").sheets[0].name).toBe("供應商退貨");
  });

  it("可自動辨識公司八份實際報表的核心欄位", () => {
    const cases = {
      opening: ["店倉名稱", "貨號", "品名", "實際庫存", "實際庫存成本額", "進貨價", "成本價"],
      closing: ["店倉名稱", "貨號", "品名", "實際庫存", "實際庫存成本額", "進貨價", "成本價"],
      purchases: ["收貨單編碼", "狀態", "收貨倉庫", "貨號", "品名", "已收數量", "成本價", "未稅進貨額", "供應商名稱", "開單日期"],
      sales: ["開單倉名稱", "POS單", "結帳時間", "貨號", "品名", "銷售量", "扣庫量", "進貨價金額"],
      storeMonthly: ["對帳門市名稱", "對帳種類", "單據日期", "單據編號", "貨號", "數量", "結帳額", "品名"],
      movements: ["出入庫單編碼", "開單日期", "狀態", "出入庫店倉", "出入庫原因", "數量", "成本價", "貨號", "品名", "出入庫審核日期"],
      supplierReturns: ["退貨單編碼", "狀態", "退貨倉庫", "貨號", "品名", "數量", "未稅退貨額", "成本價"],
      transfers: ["單據編碼", "狀態", "調出倉庫名", "調入倉庫名", "貨號", "品名", "數量", "調出方成本價", "調入方成本價", "調出方成本額", "結算額", "開單日期", "發貨日期", "收貨日期"]
    };
    for (const [type, headers] of Object.entries(cases)) {
      const mapping = core.autoMapHeaders(headers, type);
      expect(core.validateMapping(type, mapping).valid).toBe(true);
      if (type === "movements") expect(mapping.direction).toBeNull();
    }
    const salesMap = core.autoMapHeaders(cases.sales, "sales");
    expect(cases.sales[salesMap.qty]).toBe("扣庫量");
    expect(cases.sales[salesMap.purchaseCostAmount]).toBe("進貨價金額");
    expect(core.autoMapHeaders(["銷別", ...cases.sales], "sales").salesType).toBe(0);
    const transferMap = core.autoMapHeaders(cases.transfers, "transfers");
    expect(cases.transfers[transferMap.sourceCostAmount]).toBe("調出方成本額");
    expect(cases.transfers[transferMap.transferAmount]).toBe("結算額");
    expect(cases.transfers[transferMap.dispatchDate]).toBe("發貨日期");
    expect(cases.transfers[transferMap.receiptDate]).toBe("收貨日期");
  });

  it("排除報表合計列，並保留扣庫量為零但已有進貨價金額的銷售列", () => {
    const purchaseBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(purchaseBook, XLSX.utils.aoa_to_sheet([
      ["收貨單編碼", "狀態", "收貨倉庫", "貨號", "品名", "已收數量", "成本價", "未稅進貨額"],
      ["IR26060001", "入庫審核", "寬承總倉", "P1", "商品P1", 2, 10, 20],
      [52, "", "", 233, "", 8443, "", 3737974.5]
    ]), "進貨明細");
    const purchaseReport = core.extractReport(purchaseBook, XLSX, "purchases");
    expect(purchaseReport.records).toHaveLength(1);
    expect(purchaseReport.records[0].sku).toBe("P1");

    const salesBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(salesBook, XLSX.utils.aoa_to_sheet([
      ["POS單", "開單倉名稱", "貨號", "品名", "扣庫量", "進貨價金額"],
      ["SO1", "寬承總倉", "P1", "商品P1", 0, 30]
    ]), "銷售成本");
    const salesReport = core.extractReport(salesBook, XLSX, "sales");
    expect(salesReport.records).toHaveLength(1);
    expect(salesReport.records[0].purchaseCostAmount).toBe(30);
  });

  it("以進貨價計算A與B，並把同品項價格基準差異獨立呈現", () => {
    const reports = {
      ...baseInventory("P1", 10, 8),
      purchases: report("purchases", [{ sku: "P1", name: "商品P1", qty: 5, purchasePrice: 12, untaxedAmount: 60 }]),
      sales: report("sales", [{ sku: "P1", name: "商品P1", qty: 7, purchasePrice: 10, averageCost: 999 }])
    };
    reports.closing.records[0].purchasePrice = 11;
    const item = core.analyzeReports(reports).details[0];
    expect(item.aQty).toBe(7);
    expect(item.aAmount).toBe(72);
    expect(item.salesQty).toBe(7);
    expect(item.salesAmount).toBe(70);
    expect(item.rawAmountDifference).toBe(2);
    expect(item.priceBasisEffect).toBe(2);
  });

  it("客戶退貨用銷售負值沖回B，客退入庫不重複列入C", () => {
    const reports = {
      ...baseInventory("R1", 10, 8),
      sales: report("sales", [
        { sku: "R1", name: "商品R1", qty: 3, purchasePrice: 10 },
        { sku: "R1", name: "商品R1", qty: -1, purchasePrice: 10 }
      ]),
      movements: report("movements", [{ sku: "R1", name: "商品R1", qty: 1, direction: "入庫單", reason: "客退入庫", purchasePrice: 10 }])
    };
    const item = core.analyzeReports(reports).details[0];
    expect(item.aQty).toBe(2);
    expect(item.salesQty).toBe(2);
    expect(item.adjustmentQty).toBe(0);
    expect(item.quantityDifference).toBe(0);
  });

  it("訂貨與退訂只有在來源單號、維度、數量及金額完整反向且無有效T時才沖銷", () => {
    const reports = {
      ...baseInventory("ORDER-CANCEL", 1, 1, 100),
      sales: report("sales", [
        { date: "2026-06-06", doc: "R0100002606060008", salesType: "訂貨", store: "台北中山門市", pickupWarehouse: "寬承總倉", outboundWarehouse: "台北中山門市", sku: "ORDER-CANCEL", name: "訂貨退訂商品", salesQty: 1, qty: 0, salesAmount: 200, purchaseCostAmount: 100 },
        { date: "2026-06-06", doc: "R0100002606060010", sourceDoc: "R0100002606060008", salesType: "退訂", store: "台北中山門市", pickupWarehouse: "寬承總倉", outboundWarehouse: "台北中山門市", sku: "ORDER-CANCEL", name: "訂貨退訂商品", salesQty: -1, qty: 0, salesAmount: -200, purchaseCostAmount: -100 }
      ])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0]).toMatchObject({ salesQty: 0, salesAmount: 0, timingQty: 0, timingAmount: 0, status: "通過" });
    expect(analysis.issues.some((issue) => issue.type.includes("尚無T") || issue.type.includes("尚未月結"))).toBe(false);
    expect(analysis.salesCancellationDetails).toHaveLength(1);
    expect(analysis.salesCancellationDetails[0]).toMatchObject({ kind: "訂貨→退訂", originalDoc: "R0100002606060008", reversalDoc: "R0100002606060010" });
  });

  it("嚴格沖銷任一金額不完全反向時不自動配對", () => {
    const reports = {
      ...baseInventory("ORDER-MISMATCH", 1, 1, 100),
      sales: report("sales", [
        { date: "2026-06-06", doc: "R0100002606060008", salesType: "訂貨", store: "台北中山門市", pickupWarehouse: "寬承總倉", outboundWarehouse: "台北中山門市", sku: "ORDER-MISMATCH", name: "金額不符商品", salesQty: 1, qty: 0, salesAmount: 200, purchaseCostAmount: 100 },
        { date: "2026-06-06", doc: "R0100002606060010", sourceDoc: "R0100002606060008", salesType: "退訂", store: "台北中山門市", pickupWarehouse: "寬承總倉", outboundWarehouse: "台北中山門市", sku: "ORDER-MISMATCH", name: "金額不符商品", salesQty: -1, qty: 0, salesAmount: -199, purchaseCostAmount: -100 }
      ])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.salesCancellationDetails).toHaveLength(0);
    expect(analysis.details[0]).toMatchObject({ timingQty: -2, timingAmount: -200 });
    expect(analysis.issues.filter((issue) => issue.type === "本月R單尚無T")).toHaveLength(2);
  });

  it("訂貨已有有效T時即使退訂完整反向也不得自動沖銷", () => {
    const tDoc = "T0000002606100001";
    const reports = {
      ...baseInventory("ORDER-HAS-T", 1, 0, 100),
      sales: report("sales", [
        { date: "2026-06-06", doc: "R0100002606060008", pickupDoc: tDoc, salesType: "訂貨", store: "台北中山門市", pickupWarehouse: "寬承總倉", outboundWarehouse: "台北中山門市", sku: "ORDER-HAS-T", name: "已有T商品", salesQty: 1, qty: 0, salesAmount: 200, purchaseCostAmount: 100 },
        { date: "2026-06-06", doc: "R0100002606060010", sourceDoc: "R0100002606060008", pickupDoc: tDoc, salesType: "退訂", store: "台北中山門市", pickupWarehouse: "寬承總倉", outboundWarehouse: "台北中山門市", sku: "ORDER-HAS-T", name: "已有T商品", salesQty: -1, qty: 0, salesAmount: -200, purchaseCostAmount: -100 },
        { date: "2026-06-10", doc: tDoc, sourceDoc: "R0100002606060008", salesType: "取貨", store: "台北中山門市", outboundWarehouse: "寬承總倉", sku: "ORDER-HAS-T", name: "已有T商品", salesQty: 1, qty: 1, salesAmount: 0, purchaseCostAmount: 0 }
      ])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.salesCancellationDetails).toHaveLength(0);
    expect(analysis.issues.some((issue) => issue.type === "T單可能合併多張R，來源待查")).toBe(true);
  });

  it("同月銷貨與退貨完整反向時保留來源稽核但不列異常", () => {
    const reports = {
      ...baseInventory("SALE-RETURN", 1, 1, 80),
      sales: report("sales", [
        { date: "2026-06-08", doc: "R0100002606080001", salesType: "銷貨", store: "台北中山門市", pickupWarehouse: "台北中山門市", outboundWarehouse: "台北中山門市", sku: "SALE-RETURN", name: "銷退商品", salesQty: 1, qty: 1, salesAmount: 160, purchaseCostAmount: 80 },
        { date: "2026-06-08", doc: "R0100002606080002", sourceDoc: "R0100002606080001", salesType: "退貨", store: "台北中山門市", pickupWarehouse: "台北中山門市", outboundWarehouse: "台北中山門市", sku: "SALE-RETURN", name: "銷退商品", salesQty: -1, qty: -1, salesAmount: -160, purchaseCostAmount: -80 }
      ])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0]).toMatchObject({ salesQty: 0, salesAmount: 0, status: "通過" });
    expect(analysis.salesCancellationDetails).toHaveLength(1);
    const workbook = core.buildOutputWorkbook(analysis, XLSX);
    const sourceRows = XLSX.utils.sheet_to_json(workbook.Sheets["05_來源檢查"], { header: 1, defval: "" });
    expect(sourceRows.some((row) => row[0] === "銷售流水嚴格沖銷明細")).toBe(true);
    expect(sourceRows.some((row) => row[0] === "銷貨→退貨" && row[2] === "R0100002606080001" && row[4] === "R0100002606080002")).toBe(true);
  });

  it("第5類直營總倉代出只認列銷售一次且不要求調撥單", () => {
    const reports = {
      ...baseInventory("D1", 10, 9, 20),
      sales: report("sales", [{ sku: "D1", name: "商品D1", store: "台中北屯門市", qty: 1, purchasePrice: 20 }]),
      storeMonthly: report("storeMonthly", [{ sku: "D1", name: "商品D1", store: "台中北屯門市", reconcileType: "五 總倉代出", qty: 1, claimAmount: 30 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0].salesQty).toBe(1);
    expect(analysis.details[0].salesAmount).toBe(20);
    expect(analysis.issues.some((issue) => issue.type.includes("調撥"))).toBe(false);
  });

  it("第5類加盟總倉代出以月結確認數量、銷售明細取進貨價成本", () => {
    const tDoc = "T0000002606150001";
    const reports = {
      ...baseInventory("F5", 10, 9, 20),
      sales: report("sales", [
        { date: "2026-06-15", doc: "R0700002606150001", pickupDoc: tDoc, sku: "F5", name: "商品F5", store: "高雄夢時代專櫃", pickupWarehouse: "寬承總倉", salesQty: 1, qty: 0, purchaseCostAmount: 20 },
        { date: "2026-06-15", doc: tDoc, sourceDoc: "R0700002606150001", sku: "F5", name: "商品F5", store: "高雄夢時代專櫃", outboundWarehouse: "寬承總倉", salesQty: 1, qty: 1, salesAmount: 0, purchaseCostAmount: 0 }
      ]),
      storeMonthly: report("storeMonthly", [{ date: "2026-06-15", doc: tDoc, sku: "F5", name: "商品F5", store: "高雄夢時代專櫃", reconcileType: "5 總倉代出", qty: 1, claimAmount: 33 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0].salesQty).toBe(1);
    expect(analysis.details[0].salesAmount).toBe(20);
    expect(analysis.details[0].b3Qty).toBe(1);
    expect(analysis.details[0].b1Qty).toBe(0);
    expect(analysis.issues.some((issue) => issue.type.includes("缺少調撥"))).toBe(false);
  });

  it("第5類總倉代出找不到銷售單時使用指定狀態名稱", () => {
    const reports = {
      ...baseInventory("F5-MISSING", 10, 9, 20),
      storeMonthly: report("storeMonthly", [{ doc: "POS-MISSING", sku: "F5-MISSING", name: "商品F5", store: "新竹東區門市", reconcileType: "5 總倉代出", qty: 1, claimAmount: 22 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.issues.some((issue) => issue.type === "總倉代出無在銷售銷售報表中")).toBe(true);
  });

  it("跨加盟調撥以月結雙向勾稽，並避免再把銷售成本重複加入B", () => {
    const reports = {
      ...baseInventory("T1", 10, 8, 10),
      sales: report("sales", [{ doc: "TR-1", sku: "T1", name: "商品T1", store: "台中文心秀泰專櫃", qty: 2, purchasePrice: 10 }]),
      storeMonthly: report("storeMonthly", [{ doc: "TR-1", sku: "T1", name: "商品T1", store: "台中文心秀泰專櫃", reconcileType: "一 總倉調撥至對帳門市", qty: 2, claimAmount: 22 }]),
      transfers: report("transfers", [{ doc: "TR-1", sku: "T1", name: "商品T1", sourceWarehouse: "寬承總倉", destinationWarehouse: "台中文心秀泰專櫃", qty: 2, purchasePrice: 10, sourceCostPrice: 11, transferAmount: 22 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0].salesQty).toBe(2);
    expect(analysis.details[0].salesAmount).toBe(20);
    expect(analysis.details[0].quantityDifference).toBe(0);
    expect(analysis.issues.some((issue) => issue.type.includes("缺少月結"))).toBe(false);
  });

  it("B總計固定等於B1至B4，B2至B4以門市月結為認列主體", () => {
    const tDoc = "T0000002606200001";
    const reports = {
      opening: report("opening", [
        { sku: "NET", name: "一般銷售", warehouse: "寬承總倉", qty: 1, purchasePrice: 10 },
        { sku: "BUY", name: "加盟採購", warehouse: "寬承總倉", qty: 1, purchasePrice: 20 },
        { sku: "FUL", name: "總倉代出", warehouse: "寬承總倉", qty: 1, purchasePrice: 30 },
        { sku: "RET", name: "加盟退回", warehouse: "寬承總倉", qty: 0, purchasePrice: 40 }
      ]),
      closing: report("closing", [
        { sku: "NET", name: "一般銷售", warehouse: "寬承總倉", qty: 0, purchasePrice: 10 },
        { sku: "BUY", name: "加盟採購", warehouse: "寬承總倉", qty: 0, purchasePrice: 20 },
        { sku: "FUL", name: "總倉代出", warehouse: "寬承總倉", qty: 0, purchasePrice: 30 },
        { sku: "RET", name: "加盟退回", warehouse: "寬承總倉", qty: 1, purchasePrice: 40 }
      ]),
      sales: report("sales", [
        { date: "2026-06-10", doc: "S2606100001", store: "寬承總倉", sku: "NET", name: "一般銷售", qty: 1, purchasePrice: 10 },
        { date: "2026-06-20", doc: "R0700002606200001", pickupDoc: tDoc, store: "新竹東區門市", pickupWarehouse: "寬承總倉", sku: "FUL", name: "總倉代出", salesQty: 1, qty: 0, purchaseCostAmount: 30 },
        { date: "2026-06-20", doc: tDoc, sourceDoc: "R0700002606200001", store: "新竹東區門市", outboundWarehouse: "寬承總倉", sku: "FUL", name: "總倉代出", salesQty: 1, qty: 1, salesAmount: 0, purchaseCostAmount: 0 }
      ]),
      storeMonthly: report("storeMonthly", [
        { date: "2026-06-12", doc: "AT2606000001", store: "新竹東區門市", reconcileType: "1 總倉調撥至對帳門市", sku: "BUY", name: "加盟採購", qty: 1 },
        { date: "2026-06-20", doc: tDoc, store: "新竹東區門市", reconcileType: "5 總倉代出", sku: "FUL", name: "總倉代出", qty: 1 },
        { date: "2026-06-25", doc: "AT2606000002", store: "新竹東區門市", reconcileType: "2 對帳門市調撥至總倉", sku: "RET", name: "加盟退回", qty: 1 }
      ]),
      transfers: report("transfers", [
        { date: "2026-06-12", doc: "AT2606000001", sourceWarehouse: "寬承總倉", destinationWarehouse: "新竹東區門市", sku: "BUY", name: "加盟採購", qty: 1, purchasePrice: 20 },
        { date: "2026-06-25", doc: "AT2606000002", sourceWarehouse: "新竹東區門市", destinationWarehouse: "寬承總倉", sku: "RET", name: "加盟退回", qty: 1, purchasePrice: 40 }
      ])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.totals).toMatchObject({
      b1Qty: 1, b1Amount: 10,
      b2Qty: 1, b2Amount: 20,
      b3Qty: 1, b3Amount: 30,
      b4Qty: -1, b4Amount: -40,
      salesQty: 2, salesAmount: 20
    });
    expect(analysis.totals.salesQty).toBe(analysis.totals.b1Qty + analysis.totals.b2Qty + analysis.totals.b3Qty + analysis.totals.b4Qty);
    expect(analysis.totals.salesAmount).toBe(analysis.totals.b1Amount + analysis.totals.b2Amount + analysis.totals.b3Amount + analysis.totals.b4Amount);
    const workbook = core.buildOutputWorkbook(analysis, XLSX);
    const summaryRows = XLSX.utils.sheet_to_json(workbook.Sheets["01_分析摘要"], { header: 1, defval: "" });
    const detailHeaders = XLSX.utils.sheet_to_json(workbook.Sheets["06_全部商品勾稽明細"], { header: 1, defval: "" })[0];
    expect(summaryRows.some((row) => row[0] === "　B4：加盟退回" && row[1] === -1 && row[2] === -40)).toBe(true);
    expect(detailHeaders).toEqual(expect.arrayContaining(["B1淨銷售金額", "B2加盟月結調撥金額", "B3總倉代出金額", "B4加盟退回金額"]));
  });

  it("本月跨體系調撥沒有門市月結時不進B，只以D抵銷已扣庫時點", () => {
    const reports = {
      ...baseInventory("NO-MONTHLY", 1, 0, 15),
      transfers: report("transfers", [{ date: "2026-06-18", doc: "AT2606000099", sourceWarehouse: "寬承總倉", destinationWarehouse: "新竹東區門市", sku: "NO-MONTHLY", name: "尚未月結商品", qty: 1, purchasePrice: 15 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0]).toMatchObject({ b2Qty: 0, b4Qty: 0, salesQty: 0, timingQty: 1, timingAmount: 15, quantityDifference: 0, rawAmountDifference: 0 });
    expect(analysis.issues.some((issue) => issue.type === "有調撥無月結／可能漏請款" && issue.level === "error")).toBe(true);
  });

  it("加盟月結已認列但尚無調撥時仍進B2，並以反向D暫時抵銷", () => {
    const reports = {
      ...baseInventory("NO-TRANSFER", 1, 1, 15),
      storeMonthly: report("storeMonthly", [{ date: "2026-06-18", doc: "AT2606000100", store: "新竹東區門市", reconcileType: "1 總倉調撥至對帳門市", sku: "NO-TRANSFER", name: "尚無調撥商品", qty: 1 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0]).toMatchObject({ b2Qty: 1, b2Amount: 15, salesQty: 1, timingQty: -1, timingAmount: -15, quantityDifference: 0, rawAmountDifference: 0 });
    expect(analysis.issues.some((issue) => issue.type === "月結缺少調撥配對" && issue.level === "error")).toBe(true);
  });

  it("公司內部調撥不進B，輸出整合為同一活頁簿六個頁籤", () => {
    const reports = {
      ...baseInventory("I1", 5, 5),
      transfers: report("transfers", [{ sku: "I1", name: "商品I1", sourceWarehouse: "寬承總倉", destinationWarehouse: "瑕疵倉", qty: 1, purchasePrice: 10 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0].salesQty).toBe(0);
    const workbook = core.buildOutputWorkbook(analysis, XLSX);
    expect(workbook.SheetNames).toEqual(["01_分析摘要", "02_商品差異明細", "03_未配對資料", "04_C組調整明細", "05_來源檢查", "06_全部商品勾稽明細"]);
    expect(workbook.Sheets["05_來源檢查"]["!autofilter"].ref).toBe("A1:Q9");
  });

  it("名稱含快閃的倉別視為公司內部倉，不誤列B2", () => {
    const reports = {
      opening: report("opening", [{ date: "2026-06-01", sku: "POPUP", name: "快閃商品", warehouse: "寬承總倉", qty: 1, purchasePrice: 10 }]),
      closing: report("closing", [{ date: "2026-06-30", sku: "POPUP", name: "快閃商品", warehouse: "[快閃] 高雄漢神本館", qty: 1, purchasePrice: 10 }]),
      storeMonthly: report("storeMonthly", [{ date: "2026-06-20", doc: "AT2606000200", store: "[快閃] 高雄漢神本館", reconcileType: "1 總倉調撥至對帳門市", sku: "POPUP", name: "快閃商品", qty: 1 }]),
      transfers: report("transfers", [{ date: "2026-06-20", doc: "AT2606000200", sourceWarehouse: "寬承總倉", destinationWarehouse: "[快閃] 高雄漢神本館", sku: "POPUP", name: "快閃商品", qty: 1, purchasePrice: 10 }])
    };
    const item = core.analyzeReports(reports).details[0];
    expect(item).toMatchObject({ closingQty: 1, b2Qty: 0, salesQty: 0, quantityDifference: 0, rawAmountDifference: 0 });
  });

  it("加盟退回本月發貨次月收貨時，以D抵銷B4與期末未入庫的在途差", () => {
    const reports = {
      ...baseInventory("RETURN-IN-TRANSIT", 0, 0, 10),
      storeMonthly: report("storeMonthly", [{ date: "2026-06-28", doc: "AT2606000248", store: "台中文心秀泰專櫃", reconcileType: "2 對帳門市調撥至總倉", sku: "RETURN-IN-TRANSIT", name: "加盟退回在途", qty: 2 }]),
      transfers: report("transfers", [{ date: "2026-06-28", dispatchDate: "2026-06-28", receiptDate: "2026-07-09", doc: "AT2606000248", sourceWarehouse: "台中文心秀泰專櫃", destinationWarehouse: "寬承總倉", sku: "RETURN-IN-TRANSIT", name: "加盟退回在途", qty: 2, purchasePrice: 10 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0]).toMatchObject({ b4Qty: -2, b4Amount: -20, timingQty: 2, timingAmount: 20, quantityDifference: 0, rawAmountDifference: 0 });
    expect(analysis.timingDetails.some((row) => row.type === "本月加盟退回／次月收貨" && row.status === "調撥在途已調整")).toBe(true);
  });

  it("公司內部調撥在月底尚未收貨時，以D保留公司在途庫存", () => {
    const reports = {
      ...baseInventory("INTERNAL-IN-TRANSIT", 5, 0, 10),
      transfers: report("transfers", [{ date: "2026-06-28", dispatchDate: "2026-06-28", receiptDate: "2026-07-01", doc: "AT2606000234", sourceWarehouse: "台北中山門市", destinationWarehouse: "寬承總倉", sku: "INTERNAL-IN-TRANSIT", name: "內部在途", qty: 5, purchasePrice: 10 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0]).toMatchObject({ salesQty: 0, timingQty: 5, timingAmount: 50, quantityDifference: 0, rawAmountDifference: 0 });
    expect(analysis.timingDetails.some((row) => row.type === "公司內部調撥在途")).toBe(true);

    const notDispatched = core.analyzeReports({
      ...baseInventory("INTERNAL-NOT-DISPATCHED", 5, 5, 10),
      transfers: report("transfers", [{ date: "2026-06-28", receiptDate: "2026-07-01", doc: "AT2606000235", sourceWarehouse: "台北中山門市", destinationWarehouse: "寬承總倉", sku: "INTERNAL-NOT-DISPATCHED", name: "尚未發貨", qty: 5, purchasePrice: 10 }])
    });
    expect(notDispatched.details[0]).toMatchObject({ timingQty: 0, quantityDifference: 0 });
  });

  it("採購退貨未列退廠報表時由C補列，已列退廠報表時不重複", () => {
    const movement = { date: "2026-06-20", doc: "OT2026060019", sku: "PURCHASE-RETURN", name: "採購退貨商品", qty: -21, direction: "出庫單", reason: "[採購][採購退貨]", purchasePrice: 10 };
    const missingReturnAnalysis = core.analyzeReports({
      ...baseInventory("PURCHASE-RETURN", 21, 0, 10),
      movements: report("movements", [movement])
    });
    expect(missingReturnAnalysis.details[0]).toMatchObject({ supplierReturnQty: 0, adjustmentQty: 21, quantityDifference: 0, rawAmountDifference: 0 });
    expect(missingReturnAnalysis.issues.some((issue) => issue.type === "採購退貨未出現在退廠報表")).toBe(true);

    const reportedReturnAnalysis = core.analyzeReports({
      ...baseInventory("PURCHASE-RETURN", 21, 0, 10),
      supplierReturns: report("supplierReturns", [{ date: "2026-06-20", doc: "RT2606000019", sku: "PURCHASE-RETURN", name: "採購退貨商品", qty: 21, purchasePrice: 10, untaxedAmount: 210 }]),
      movements: report("movements", [movement])
    });
    expect(reportedReturnAnalysis.details[0]).toMatchObject({ supplierReturnQty: 21, adjustmentQty: 0, quantityDifference: 0, rawAmountDifference: 0 });
    expect(reportedReturnAnalysis.issues.some((issue) => issue.type === "採購退貨已由退廠報表認列")).toBe(true);
  });

  it("下載版Excel的六個頁籤皆凍結第一列，篩選範圍使用Excel相容工作表引用", async () => {
    const analysis = core.analyzeReports({ ...baseInventory("FREEZE", 1, 0, 10), sales: report("sales", [{ sku: "FREEZE", name: "凍結測試", qty: 1, purchasePrice: 10 }]) });
    const workbook = core.buildOutputWorkbook(analysis, XLSX);
    const bytes = await core.buildFrozenWorkbookBytes(workbook, XLSX, JSZip);
    const archive = await JSZip.loadAsync(bytes);
    for (let index = 1; index <= 6; index += 1) {
      const xml = await archive.file(`xl/worksheets/sheet${index}.xml`).async("string");
      expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    }
    const workbookXml = await archive.file("xl/workbook.xml").async("string");
    for (const sheetName of ["02_商品差異明細", "03_未配對資料", "04_C組調整明細", "05_來源檢查", "06_全部商品勾稽明細"]) {
      expect(workbookXml).toContain(`>'${sheetName}'!`);
    }
    expect(workbookXml).not.toMatch(/>0[2-6]_[^<]+!\$/);
    expect(workbookXml.match(/name="_xlnm\._FilterDatabase"[^>]*hidden="1"/g)).toHaveLength(5);

    const reopened = XLSX.read(bytes, { type: "array" });
    expect(reopened.SheetNames).toEqual(workbook.SheetNames);
    expect(reopened.Sheets["06_全部商品勾稽明細"]["!autofilter"].ref).toBe("A1:AH2");
  });

  it("加盟請款以公司側報表成本四捨五入核對，內部倉不查請款金額", () => {
    const reports = {
      ...baseInventory("B1", 10, 10, 20),
      storeMonthly: report("storeMonthly", [
        { doc: "AT1", sku: "B1", name: "商品B1", store: "新竹東區門市", reconcileType: "1 總倉調撥至對帳門市", qty: 1, claimAmount: 247 },
        { doc: "AT2", sku: "B1", name: "商品B1", store: "行銷-公關品倉", reconcileType: "1 總倉調撥至對帳門市", qty: 1, claimAmount: 0 }
      ]),
      transfers: report("transfers", [
        { doc: "AT1", sku: "B1", name: "商品B1", sourceWarehouse: "寬承總倉", destinationWarehouse: "新竹東區門市", qty: 1, sourceCostPrice: 246.9528, destinationCostPrice: 222.48, sourceCostAmount: 246.9528, destinationCostAmount: 222.48, transferAmount: 581 },
        { doc: "AT2", sku: "B1", name: "商品B1", sourceWarehouse: "寬承總倉", destinationWarehouse: "行銷-公關品倉", qty: 1, sourceCostPrice: 222.48, destinationCostPrice: 222.48, sourceCostAmount: 222.48, destinationCostAmount: 222.48, transferAmount: 222.48 }
      ])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.issues.some((issue) => issue.type === "月結與調撥金額不同")).toBe(false);
  });

  it("02只列差異商品，06保留包含通過品項的完整底稿", () => {
    const reports = {
      opening: report("opening", [
        { sku: "PASS", name: "通過商品", warehouse: "寬承總倉", qty: 1, purchasePrice: 10 },
        { sku: "DIFF", name: "差異商品", warehouse: "寬承總倉", qty: 1, purchasePrice: 10 }
      ]),
      closing: report("closing", [
        { sku: "PASS", name: "通過商品", warehouse: "寬承總倉", qty: 0, purchasePrice: 10 },
        { sku: "DIFF", name: "差異商品", warehouse: "寬承總倉", qty: 0, purchasePrice: 10 }
      ]),
      sales: report("sales", [{ sku: "PASS", name: "通過商品", qty: 1, purchasePrice: 10 }])
    };
    const workbook = core.buildOutputWorkbook(core.analyzeReports(reports), XLSX);
    const differenceRows = XLSX.utils.sheet_to_json(workbook.Sheets["02_商品差異明細"], { header: 1, defval: "" });
    const allRows = XLSX.utils.sheet_to_json(workbook.Sheets["06_全部商品勾稽明細"], { header: 1, defval: "" });
    expect(differenceRows.slice(1).map((row) => row[0])).toEqual(["DIFF"]);
    expect(allRows.slice(1).map((row) => row[0]).sort()).toEqual(["DIFF", "PASS"]);
  });

  it("將商品差異拆成四種互斥狀態並提供排查建議", () => {
    const reports = {
      opening: report("opening", [
        { sku: "PASS", name: "通過商品", warehouse: "寬承總倉", qty: 1, purchasePrice: 10 },
        { sku: "QTY", name: "僅數量商品", warehouse: "寬承總倉", qty: 1, purchasePrice: 10 },
        { sku: "AMT", name: "僅金額商品", warehouse: "寬承總倉", qty: 1, purchasePrice: 10 },
        { sku: "BOTH", name: "數量金額商品", warehouse: "寬承總倉", qty: 1, purchasePrice: 10 }
      ]),
      closing: report("closing", [
        { sku: "PASS", name: "通過商品", warehouse: "寬承總倉", qty: 0, purchasePrice: 10 },
        { sku: "QTY", name: "僅數量商品", warehouse: "寬承總倉", qty: 0, purchasePrice: 10 },
        { sku: "AMT", name: "僅金額商品", warehouse: "寬承總倉", qty: 0, purchasePrice: 10 },
        { sku: "BOTH", name: "數量金額商品", warehouse: "寬承總倉", qty: 0, purchasePrice: 10 }
      ]),
      sales: report("sales", [
        { sku: "PASS", name: "通過商品", qty: 1, purchaseCostAmount: 10 },
        { sku: "QTY", name: "僅數量商品", qty: 0, purchaseCostAmount: 10 },
        { sku: "AMT", name: "僅金額商品", qty: 1, purchaseCostAmount: 8 }
      ])
    };
    const analysis = core.analyzeReports(reports);
    const statuses = Object.fromEntries(analysis.details.map((item) => [item.sku, item.status]));
    expect(statuses).toEqual({ BOTH: "數量＆金額差異", AMT: "僅金額差異", PASS: "通過", QTY: "僅數量差異" });
    expect(analysis.details.every((item) => item.advice)).toBe(true);
    expect(analysis.totals.quantityOnlyIssueCount).toBe(1);
    expect(analysis.totals.amountOnlyIssueCount).toBe(1);
    expect(analysis.totals.quantityAmountIssueCount).toBe(1);
  });

  it("C組頁籤逐筆列出非銷售出入庫調整及成本說明", () => {
    const reports = {
      ...baseInventory("C1", 10, 9, 20),
      movements: report("movements", [{ doc: "OT1", sku: "C1", name: "商品C1", warehouse: "寬承總倉", qty: 1, direction: "出庫單", reason: "公關贈送", purchasePrice: 20 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.adjustmentDetails).toHaveLength(1);
    expect(analysis.adjustmentDetails[0]).toMatchObject({ category: "公關贈送", sourceDirection: "出庫", adjustmentQty: 1, adjustmentAmount: 20 });
    const workbook = core.buildOutputWorkbook(analysis, XLSX);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets["04_C組調整明細"], { header: 1, defval: "" });
    expect(rows[0]).toContain("納入說明");
    expect(rows[1]).toContain("非銷售出庫，C列正數，於A－B－C中扣除。");
    expect(XLSX.utils.format_cell(workbook.Sheets["04_C組調整明細"]["O2"])).toBe("20.00");
  });

  it("八類來源共用集中排除規則，並保留逐列排除數量與金額", () => {
    const excludedName = "活動折扣券";
    const reports = {
      opening: report("opening", [{ sku: "X1", name: excludedName, warehouse: "寬承總倉", qty: 1, purchasePrice: 10 }]),
      closing: report("closing", [{ sku: "X1", name: excludedName, warehouse: "寬承總倉", qty: 1, purchasePrice: 10 }]),
      purchases: report("purchases", [{ sku: "X1", name: excludedName, qty: 1, purchasePrice: 10, untaxedAmount: 10 }]),
      sales: report("sales", [{ sku: "X1", name: excludedName, qty: 1, purchasePrice: 10 }]),
      storeMonthly: report("storeMonthly", [{ sku: "X1", name: excludedName, store: "台中文心秀泰專櫃", reconcileType: "1", qty: 1, claimAmount: 11 }]),
      movements: report("movements", [{ sku: "X1", name: excludedName, qty: 1, direction: "出庫", reason: "公關贈送", purchasePrice: 10 }]),
      supplierReturns: report("supplierReturns", [{ sku: "X1", name: excludedName, qty: 1, purchasePrice: 10, untaxedAmount: 10 }]),
      transfers: report("transfers", [{ sku: "X1", name: excludedName, sourceWarehouse: "寬承總倉", destinationWarehouse: "台中文心秀泰專櫃", qty: 1, purchasePrice: 10, transferAmount: 11 }])
    };
    const analysis = core.analyzeReports(reports, {
      rules: { "排除關鍵字": ["折扣券"], "待人工確認關鍵字": [], "指定品名白名單": [] },
      rulesVersion: 5,
      rulesUpdatedAt: "2026-08-13T09:51:21.000Z"
    });
    expect(analysis.details).toHaveLength(0);
    expect(analysis.exclusions).toHaveLength(8);
    expect(analysis.exclusions.every((row) => row.keywords === "折扣券")).toBe(true);
    expect(analysis.sourceChecks.every((row) => row.ruleExcludedRows === 1)).toBe(true);
    expect(analysis.issues.every((issue) => issue.level === "info")).toBe(true);
  });

  it("完整品名白名單優先於排除關鍵字，待確認商品仍納入但提出警示", () => {
    const rules = {
      "排除關鍵字": ["樣品"],
      "待人工確認關鍵字": ["特殊"],
      "指定品名白名單": ["樣品正常商品"]
    };
    const reports = {
      opening: report("opening", [
        { sku: "W1", name: "樣品正常商品", warehouse: "寬承總倉", qty: 2, purchasePrice: 10 },
        { sku: "R1", name: "特殊商品", warehouse: "寬承總倉", qty: 1, purchasePrice: 10 }
      ]),
      closing: report("closing", [
        { sku: "W1", name: "樣品正常商品", warehouse: "寬承總倉", qty: 2, purchasePrice: 10 },
        { sku: "R1", name: "特殊商品", warehouse: "寬承總倉", qty: 1, purchasePrice: 10 }
      ])
    };
    const analysis = core.analyzeReports(reports, { rules, rulesVersion: 6 });
    expect(analysis.details.map((row) => row.sku).sort()).toEqual(["R1", "W1"]);
    expect(analysis.exclusions).toHaveLength(0);
    expect(analysis.issues.filter((issue) => issue.type === "集中規則待人工確認")).toHaveLength(2);
  });

  it("輸出來源檢查包含集中規則版本與排除明細", () => {
    const reports = {
      opening: report("opening", [{ sku: "E1", name: "門市運費", warehouse: "寬承總倉", qty: 3, purchasePrice: 20 }])
    };
    const analysis = core.analyzeReports(reports, {
      rules: { "排除關鍵字": ["運費"], "待人工確認關鍵字": [], "指定品名白名單": [] },
      rulesVersion: 5,
      rulesUpdatedAt: "2026-08-13T09:51:21.000Z"
    });
    const workbook = core.buildOutputWorkbook(analysis, XLSX);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets["05_來源檢查"], { header: 1, defval: "" });
    expect(rows.some((row) => row[0] === "規則版本" && row[1] === "v5")).toBe(true);
    expect(rows.some((row) => row[4] === "門市運費" && row[7] === "運費")).toBe(true);
  });

  it("下載活頁簿的數量與金額使用千分位格式", () => {
    const reports = {
      opening: report("opening", [{ sku: "N1", name: "一般商品", warehouse: "寬承總倉", qty: 12345, purchasePrice: 10 }]),
      closing: report("closing", [{ sku: "N1", name: "一般商品", warehouse: "寬承總倉", qty: 0, purchasePrice: 10 }])
    };
    const analysis = core.analyzeReports(reports, {
      rules: { "排除關鍵字": [], "待人工確認關鍵字": [], "指定品名白名單": [] },
      rulesVersion: 5
    });
    const workbook = core.buildOutputWorkbook(analysis, XLSX);
    expect(XLSX.utils.format_cell(workbook.Sheets["01_分析摘要"]["B6"])).toBe("12,345");
    expect(XLSX.utils.format_cell(workbook.Sheets["01_分析摘要"]["C6"])).toBe("123,450.00");
    expect(XLSX.utils.format_cell(workbook.Sheets["02_商品差異明細"]["C2"])).toBe("12,345");
    expect(XLSX.utils.format_cell(workbook.Sheets["02_商品差異明細"]["D2"])).toBe("123,450.00");
  });

  it("有月結單號時只配對相同單號，跨月缺單標示為待查", () => {
    const reports = {
      ...baseInventory("S1", 5, 5),
      storeMonthly: report("storeMonthly", [
        { date: "2026/6/2", doc: "AT2605000229", sku: "S1", name: "商品S1", store: "台北中山門市", reconcileType: "1 總倉調撥至對帳門市", qty: 1, claimAmount: 11 },
        { date: "2026/6/9", doc: "AT2606000068", sku: "S1", name: "商品S1", store: "台北中山門市", reconcileType: "1 總倉調撥至對帳門市", qty: 1, claimAmount: 11 }
      ]),
      transfers: report("transfers", [
        { date: "2026/6/9", doc: "AT2606000068", sku: "S1", name: "商品S1", sourceWarehouse: "寬承總倉", destinationWarehouse: "台北中山門市", qty: 1, transferAmount: 11 }
      ])
    };
    const analysis = core.analyzeReports(reports);
    const crossMonthIssues = analysis.issues.filter((issue) => issue.type === "跨月調撥待查");
    expect(crossMonthIssues).toHaveLength(1);
    expect(crossMonthIssues[0]).toMatchObject({ level: "warning", doc: "AT2605000229" });
    expect(analysis.issues.some((issue) => issue.doc === "AT2606000068" && issue.type.includes("缺少調撥"))).toBe(false);
  });

  it("合併多個調撥檔時去除跨檔重複列並保留同檔重複明細", () => {
    const duplicate = { date: "2026/5/31", doc: "AT2605000001", sku: "T1", name: "商品T1", sourceWarehouse: "寬承總倉", destinationWarehouse: "台中文心秀泰專櫃", qty: 1, transferAmount: 11 };
    const first = report("transfers", [duplicate, duplicate]);
    first.meta = { label: "調撥單明細", fileName: "05調撥.xlsx", sheetName: "工作表1", headerRow: 1, rawRows: 2, acceptedRows: 2, cancelledRows: 0, blankRows: 0 };
    const second = report("transfers", [duplicate]);
    second.meta = { label: "調撥單明細", fileName: "06調撥.xlsx", sheetName: "工作表1", headerRow: 1, rawRows: 1, acceptedRows: 1, cancelledRows: 0, blankRows: 0 };
    const merged = core.mergeReportParts("transfers", [first, second]);
    expect(merged.records).toHaveLength(2);
    expect(merged.meta.fileName).toBe("05調撥.xlsx、06調撥.xlsx");
    expect(merged.meta.note).toContain("去除1列重複調撥資料");
  });

  it("前月調撥由本月月結認列B2，並以D抵銷跨月庫存時點", () => {
    const reports = {
      ...baseInventory("MONTH-TRANSFER", 10, 9, 10),
      storeMonthly: report("storeMonthly", [
        { date: "2026-06-02", doc: "AT2605000001", sku: "MONTH-TRANSFER", name: "月份調撥商品", store: "台中文心秀泰專櫃", reconcileType: "1 總倉調撥至對帳門市", qty: 2, claimAmount: 22 },
        { date: "2026-06-10", doc: "AT2606000001", sku: "MONTH-TRANSFER", name: "月份調撥商品", store: "台中文心秀泰專櫃", reconcileType: "1 總倉調撥至對帳門市", qty: 1, claimAmount: 11 }
      ]),
      transfers: report("transfers", [
        { date: "2026-05-31", doc: "AT2605000001", sku: "MONTH-TRANSFER", name: "月份調撥商品", sourceWarehouse: "寬承總倉", destinationWarehouse: "台中文心秀泰專櫃", qty: 2, purchasePrice: 10, sourceCostAmount: 20 },
        { date: "2026-06-10", doc: "AT2606000001", sku: "MONTH-TRANSFER", name: "月份調撥商品", sourceWarehouse: "寬承總倉", destinationWarehouse: "台中文心秀泰專櫃", qty: 1, purchasePrice: 10, sourceCostAmount: 10 }
      ])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.analysisMonthLabel).toBe("2026年6月");
    expect(analysis.details[0]).toMatchObject({
      salesQty: 3,
      salesAmount: 30,
      b2Qty: 3,
      b2Amount: 30,
      timingQty: -2,
      timingAmount: -20,
      quantityDifference: 0,
      rawAmountDifference: 0
    });
    expect(analysis.issues.some((issue) => issue.type === "月結缺少調撥配對")).toBe(false);
    expect(analysis.issues.some((issue) => issue.type === "跨體系調撥缺少月結配對")).toBe(false);
  });

  it("分析月份已知時，月份無法判斷的調撥不直接混入B", () => {
    const reports = {
      ...baseInventory("UNKNOWN-TRANSFER-MONTH", 1, 1, 10),
      purchases: report("purchases", [{ date: "2026-06-01", sku: "UNKNOWN-TRANSFER-MONTH", name: "月份不明調撥", qty: 0, purchasePrice: 10, untaxedAmount: 0 }]),
      transfers: report("transfers", [{ doc: "AT-UNKNOWN", sku: "UNKNOWN-TRANSFER-MONTH", name: "月份不明調撥", sourceWarehouse: "寬承總倉", destinationWarehouse: "台中文心秀泰專櫃", qty: 1, purchasePrice: 10 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0].salesQty).toBe(0);
    expect(analysis.issues.some((issue) => issue.type === "調撥月份無法判斷" && issue.level === "error")).toBe(true);
  });

  it("門市互調的第3與第4類可共同配對同一筆調撥單", () => {
    const reports = {
      ...baseInventory("M1", 5, 5),
      storeMonthly: report("storeMonthly", [
        { doc: "AT1", sku: "M1", name: "商品M1", store: "台中北屯門市", reconcileType: "3 對帳門市調撥至其它門市", qty: 1 },
        { doc: "AT1", sku: "M1", name: "商品M1", store: "台北中山門市", reconcileType: "4 其它門市調撥至對帳門市", qty: 1 }
      ]),
      transfers: report("transfers", [
        { doc: "AT1", sku: "M1", name: "商品M1", sourceWarehouse: "台中北屯門市", destinationWarehouse: "台北中山門市", qty: 1, transferAmount: 10 }
      ])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.issues.some((issue) => issue.type === "月結缺少調撥配對")).toBe(false);
  });

  it("一張T合併兩張跨月R時依取貨單號逐品項配對且不重複認列成本", () => {
    const tDoc = "T0000002606160079";
    const reports = {
      opening: report("opening", [
        { sku: "F13057", name: "熊冷被", warehouse: "寬承總倉", qty: 1, purchasePrice: 470 },
        { sku: "L50038", name: "熊冷墊", warehouse: "寬承總倉", qty: 1, purchasePrice: 420 },
        { sku: "N00143", name: "贈品洗衣袋", warehouse: "寬承總倉", qty: 1, purchasePrice: 51.52 }
      ]),
      closing: report("closing", [
        { sku: "F13057", name: "熊冷被", warehouse: "寬承總倉", qty: 0, purchasePrice: 470 },
        { sku: "L50038", name: "熊冷墊", warehouse: "寬承總倉", qty: 0, purchasePrice: 420 },
        { sku: "N00143", name: "贈品洗衣袋", warehouse: "寬承總倉", qty: 0, purchasePrice: 51.52 }
      ]),
      sales: report("sales", [
        { date: "2026-05-31", doc: "R0600002605310005", pickupDoc: `EO1;${tDoc}`, store: "台中文心秀泰專櫃", outboundWarehouse: "台中文心秀泰專櫃", pickupWarehouse: "寬承總倉", sku: "L50038", name: "熊冷墊", salesQty: 1, qty: 0, purchaseCostAmount: 420 },
        { date: "2026-05-31", doc: "R0600002605310007", pickupDoc: `EO2;${tDoc}`, store: "台中文心秀泰專櫃", outboundWarehouse: "台中文心秀泰專櫃", pickupWarehouse: "寬承總倉", sku: "F13057", name: "熊冷被", salesQty: 1, qty: 0, purchaseCostAmount: 470 },
        { date: "2026-06-16", doc: tDoc, sourceDoc: "R0600002605310005", store: "台中文心秀泰專櫃", outboundWarehouse: "寬承總倉", sku: "F13057", name: "熊冷被", salesQty: 1, qty: 1, purchaseCostAmount: 470 },
        { date: "2026-06-16", doc: tDoc, sourceDoc: "R0600002605310005", store: "台中文心秀泰專櫃", outboundWarehouse: "寬承總倉", sku: "L50038", name: "熊冷墊", salesQty: 0, qty: 1, purchaseCostAmount: 0 },
        { date: "2026-06-16", doc: tDoc, sourceDoc: "R0600002605310005", store: "台中文心秀泰專櫃", outboundWarehouse: "寬承總倉", sku: "N00143", name: "贈品洗衣袋", salesQty: 1, qty: 1, purchaseCostAmount: 51.52 }
      ]),
      storeMonthly: report("storeMonthly", [
        { date: "2026-06-16", doc: tDoc, store: "台中文心秀泰專櫃", reconcileType: "5 總倉代出", sku: "F13057", name: "熊冷被", qty: 1 },
        { date: "2026-06-16", doc: tDoc, store: "台中文心秀泰專櫃", reconcileType: "5 總倉代出", sku: "L50038", name: "熊冷墊", qty: 1 }
      ])
    };
    const analysis = core.analyzeReports(reports);
    const bySku = Object.fromEntries(analysis.details.map((item) => [item.sku, item]));
    expect(analysis.analysisMonthLabel).toBe("2026年6月");
    expect(bySku.F13057).toMatchObject({ salesQty: 0, salesAmount: 0, timingQty: 1, timingAmount: 470, quantityDifference: 0, rawAmountDifference: 0 });
    expect(bySku.L50038).toMatchObject({ salesQty: 0, salesAmount: 0, timingQty: 1, timingAmount: 420, quantityDifference: 0, rawAmountDifference: 0 });
    expect(bySku.N00143).toMatchObject({ salesQty: 0, salesAmount: 0, timingQty: 1, timingAmount: 51.52, quantityDifference: 0 });
    expect(analysis.issues.some((issue) => issue.type === "跨月R→T已配對（T合併多張R）")).toBe(true);
    expect(analysis.issues.some((issue) => issue.sku === "F13057" && issue.type === "T單可能合併多張R，來源待查")).toBe(false);
    const workbook = core.buildOutputWorkbook(analysis, XLSX);
    const summaryRows = XLSX.utils.sheet_to_json(workbook.Sheets["01_分析摘要"], { header: 1, defval: "" });
    const issueRows = XLSX.utils.sheet_to_json(workbook.Sheets["03_未配對資料"], { header: 1, defval: "" });
    const detailRows = XLSX.utils.sheet_to_json(workbook.Sheets["06_全部商品勾稽明細"], { header: 1, defval: "" });
    expect(summaryRows.some((row) => row[0] === "D：跨月／尚未月結時點調整" && row[1] === 3 && row[2] === 941.52)).toBe(true);
    expect(issueRows.some((row) => row[0] === "D組跨月與尚未月結勾稽明細（含已配對）")).toBe(true);
    expect(detailRows[0]).toContain("D時點金額");
  });

  it("本月R尚無T時B照正式銷售認列並以D負項消除時間差", () => {
    const tDoc = "T0000002606300001";
    const reports = {
      ...baseInventory("R-NO-T", 1, 1, 100),
      sales: report("sales", [{ date: "2026-06-30", doc: "R0600002606300001", pickupDoc: tDoc, store: "新竹東區門市", pickupWarehouse: "寬承總倉", sku: "R-NO-T", name: "待總倉代出", salesQty: 1, qty: 0, purchaseCostAmount: 100 }]),
      storeMonthly: report("storeMonthly", [{ date: "2026-06-30", doc: tDoc, store: "新竹東區門市", reconcileType: "5 總倉代出", sku: "R-NO-T", name: "待總倉代出", qty: 1 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0]).toMatchObject({ salesQty: 1, salesAmount: 100, b3Qty: 1, b3Amount: 100, timingQty: -1, timingAmount: -100, quantityDifference: 0, rawAmountDifference: 0 });
    expect(analysis.issues.some((issue) => issue.type === "本月R單尚無T" && issue.level === "info")).toBe(true);
  });

  it("沒有完整R／T單號關聯時只列異常不自行配對沖銷", () => {
    const reports = {
      ...baseInventory("STRICT", 1, 0, 80),
      sales: report("sales", [
        { date: "2026-05-20", doc: "R0600002605200001", store: "新竹東區門市", pickupWarehouse: "寬承總倉", sku: "STRICT", name: "嚴格配對商品", salesQty: 1, qty: 0, purchaseCostAmount: 80 },
        { date: "2026-06-10", doc: "T0000002606100001", sourceDoc: "R0600002605209999", store: "新竹東區門市", outboundWarehouse: "寬承總倉", sku: "STRICT", name: "嚴格配對商品", salesQty: 1, qty: 1, purchaseCostAmount: 80 }
      ])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.issues.some((issue) => issue.type === "T單可能合併多張R，來源待查")).toBe(true);
    expect(analysis.details[0].salesQty).toBe(0);
    expect(analysis.details[0].timingQty).toBe(1);
  });

  it("同檔完全相同銷售列保留計算並標示疑似重複", () => {
    const duplicate = { date: "2026-06-30", doc: "T0000002606300052", sourceFile: "06銷售.xlsx", store: "寬承總倉", outboundWarehouse: "寬承總倉", sku: "G31001-1", name: "重複商品", salesQty: 1, qty: 1, purchaseCostAmount: 50 };
    const reports = { ...baseInventory("G31001-1", 2, 0, 50), sales: report("sales", [duplicate, duplicate]) };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0].salesQty).toBe(2);
    expect(analysis.issues.some((issue) => issue.type === "銷售明細疑似重複" && issue.level === "error")).toBe(true);
  });

  it("03未配對資料只列分析月份異常，前期未配對R與重複列不重複帶入", () => {
    const prior = { date: "2026-05-20", doc: "R0600002605200001", sourceFile: "05銷售.xlsx", store: "新竹東區門市", pickupWarehouse: "寬承總倉", sku: "MONTHLY-ISSUE", name: "月份範圍商品", salesQty: 1, qty: 0, purchaseCostAmount: 100 };
    const current = { date: "2026-06-20", doc: "R0600002606200001", sourceFile: "06銷售.xlsx", store: "新竹東區門市", pickupWarehouse: "寬承總倉", sku: "MONTHLY-ISSUE", name: "月份範圍商品", salesQty: 1, qty: 0, purchaseCostAmount: 100 };
    const reports = {
      ...baseInventory("MONTHLY-ISSUE", 1, 1, 100),
      sales: report("sales", [prior, prior, current])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.analysisMonthLabel).toBe("2026年6月");
    expect(analysis.issues.some((issue) => issue.doc === prior.doc)).toBe(false);
    expect(analysis.issues.some((issue) => issue.doc === current.doc && issue.type === "總倉代出尚未月結／可能漏請款" && issue.level === "error")).toBe(true);
  });

  it("前期R於本月才產生T且無本月月結時列跨月資訊，不誤標本月漏請款", () => {
    const tDoc = "T0000002606100002";
    const reports = {
      ...baseInventory("PRIOR-R-CURRENT-T", 1, 0, 100),
      sales: report("sales", [
        { date: "2026-05-20", doc: "R0600002605200002", pickupDoc: tDoc, store: "新竹東區門市", pickupWarehouse: "寬承總倉", sku: "PRIOR-R-CURRENT-T", name: "跨月配對商品", salesQty: 1, qty: 0, purchaseCostAmount: 100 },
        { date: "2026-06-10", doc: tDoc, sourceDoc: "R0600002605200002", store: "新竹東區門市", outboundWarehouse: "寬承總倉", sku: "PRIOR-R-CURRENT-T", name: "跨月配對商品", salesQty: 0, qty: 1, purchaseCostAmount: 0 }
      ])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0]).toMatchObject({ timingQty: 1, timingAmount: 100, quantityDifference: 0, rawAmountDifference: 0 });
    expect(analysis.issues.some((issue) => issue.doc === tDoc && issue.type === "前期R／本月T跨月配對" && issue.level === "info")).toBe(true);
    expect(analysis.issues.some((issue) => issue.doc === tDoc && issue.type === "總倉代出尚未月結／可能漏請款")).toBe(false);
    expect(analysis.timingDetails.some((detail) => detail.auditDoc === tDoc && detail.type === "前期R／本月T" && detail.status === "跨月R→T已配對")).toBe(true);
  });

  it("分析月份由本月主報表鎖定，銷售與調撥的前期資料不會推進月份", () => {
    const reports = {
      ...baseInventory("MONTH-LOCK", 2, 1, 100),
      purchases: report("purchases", [{ date: "2026-05-02", doc: "IR26050001", sku: "MONTH-LOCK", name: "月份鎖定商品", qty: 1, untaxedAmount: 100 }]),
      sales: report("sales", [
        { date: "2026-04-28", doc: "R0100002604280001", sku: "MONTH-LOCK", name: "月份鎖定商品", qty: 0, purchaseCostAmount: 0 },
        { date: "2026-05-18", doc: "R0100002605180001", sku: "MONTH-LOCK", name: "月份鎖定商品", qty: 2, purchaseCostAmount: 200 }
      ]),
      storeMonthly: report("storeMonthly", [{ date: "2026-05-18", doc: "AT26050001", sku: "MONTH-LOCK", name: "月份鎖定商品", store: "台中北屯門市", reconcileType: "1 總倉調撥至對帳門市", qty: 1 }]),
      movements: report("movements", [{ date: "2026-05-20", doc: "IO26050001", sku: "MONTH-LOCK", name: "月份鎖定商品", qty: 0 }]),
      supplierReturns: report("supplierReturns", [{ date: "2026-05-21", doc: "RT26050001", sku: "MONTH-LOCK", name: "月份鎖定商品", qty: 0 }]),
      transfers: report("transfers", [
        { date: "2026-04-28", doc: "AT26040001", sku: "MONTH-LOCK", name: "月份鎖定商品", qty: 1 },
        { date: "2026-05-18", doc: "AT26050001", sku: "MONTH-LOCK", name: "月份鎖定商品", qty: 1 }
      ])
    };
    const monthContext = core.resolveAnalysisMonth(reports);
    expect(monthContext.analysisMonthLabel).toBe("2026年5月");
    expect(monthContext.sourceMonthChecks.find((row) => row.type === "sales")).toMatchObject({ role: "本月認列＋前期稽核", result: "通過：2026年4月、2026年5月" });
    const analysis = core.analyzeReports(reports, monthContext);
    expect(analysis.analysisMonthLabel).toBe("2026年5月");
    const workbook = core.buildOutputWorkbook(analysis, XLSX);
    const sourceRows = XLSX.utils.sheet_to_json(workbook.Sheets["05_來源檢查"], { header: 1, defval: "" });
    expect(sourceRows.some((row) => row[0] === "來源月份檢查")).toBe(true);
    expect(sourceRows.some((row) => row[0] === "當月進貨明細" && row[1] === "月份鎖定主報表" && row[2] === "2026年5月")).toBe(true);
  });

  it("混入晚於分析月份的調撥資料時停止分析，不產生混月結果", () => {
    const reports = {
      purchases: report("purchases", [{ date: "2026-05-02", sku: "FUTURE", name: "未來月份商品", qty: 1 }]),
      sales: report("sales", [{ date: "2026-05-03", doc: "R0100002605030001", sku: "FUTURE", name: "未來月份商品", qty: 1, purchaseCostAmount: 10 }]),
      storeMonthly: report("storeMonthly", [{ date: "2026-05-03", doc: "AT26050001", sku: "FUTURE", name: "未來月份商品", qty: 1 }]),
      transfers: report("transfers", [
        { date: "2026-05-03", doc: "AT26050001", sku: "FUTURE", name: "未來月份商品", qty: 1 },
        { date: "2026-06-03", doc: "AT26060001", sku: "FUTURE", name: "未來月份商品", qty: 1 }
      ])
    };
    expect(() => core.resolveAnalysisMonth(reports)).toThrow("包含晚於分析月份2026年5月的2026年6月資料");
  });

  it("銷售只接受分析本月及前月，更早月份會停止分析", () => {
    const reports = {
      purchases: report("purchases", [{ date: "2026-05-02", sku: "OLD-SALES", name: "過早銷售商品", qty: 1 }]),
      sales: report("sales", [
        { date: "2026-03-03", doc: "R0100002603030001", sku: "OLD-SALES", name: "過早銷售商品", qty: 0, purchaseCostAmount: 0 },
        { date: "2026-05-03", doc: "R0100002605030001", sku: "OLD-SALES", name: "過早銷售商品", qty: 1, purchaseCostAmount: 10 }
      ])
    };
    expect(() => core.resolveAnalysisMonth(reports)).toThrow("包含早於前月的2026年3月資料；銷售只可匯入本月及前月");
  });

  it("當月進貨與門市月結月份不一致時停止分析", () => {
    const reports = {
      purchases: report("purchases", [{ date: "2026-05-02", sku: "MISMATCH", name: "月份不符商品", qty: 1 }]),
      sales: report("sales", [{ date: "2026-05-03", doc: "R0100002605030001", sku: "MISMATCH", name: "月份不符商品", qty: 1, purchaseCostAmount: 10 }]),
      storeMonthly: report("storeMonthly", [{ date: "2026-06-03", doc: "AT26060001", sku: "MISMATCH", name: "月份不符商品", qty: 1 }])
    };
    expect(() => core.resolveAnalysisMonth(reports)).toThrow("本月主報表月份不一致");
  });

  it("銷售明細缺少分析月份時停止分析", () => {
    const reports = {
      purchases: report("purchases", [{ date: "2026-05-02", sku: "NO-CURRENT-SALES", name: "缺本月銷售商品", qty: 1 }]),
      sales: report("sales", [{ date: "2026-04-03", doc: "R0100002604030001", sku: "NO-CURRENT-SALES", name: "缺本月銷售商品", qty: 1, purchaseCostAmount: 10 }])
    };
    expect(() => core.resolveAnalysisMonth(reports)).toThrow("銷售品項成本明細未包含分析月份2026年5月");
  });
});

describe("庫存成本分析前台", () => {
  it("入口可進入新工具，工具頁清楚標示八類來源、倉別提醒與本機處理", () => {
    const home = readFileSync("../index.html", "utf8");
    const html = readFileSync("../cost-analysis/index.html", "utf8");
    const app = readFileSync("../cost-analysis/app.js", "utf8");
    expect(home).toContain('href="/cost-analysis/"');
    expect(html).toContain("期初、期末請使用相同倉別範圍");
    expect(html).toContain("名稱含「快閃」的倉別");
    expect(html).toContain("請排除其餘加盟店倉");
    expect(html).toContain("選擇八類報表");
    expect(html).toContain("不會傳到網站、Cloudflare或其他伺服器");
    expect(html).toContain("公司最新版商品規則");
    expect(html).toContain("分析月份由本月主報表鎖定");
    expect(html).toContain("銷售若含更早月份，或任一稽核報表含未來月份，系統會停止分析");
    expect(html).toContain("凍結第一列");
    expect(html).toContain("assets/jszip.min.js");
    expect(html).toContain("第一次使用，照這份做就可以");
    expect(html).toContain("本月＋前月");
    expect(html).toContain("最終未解釋差異＝A－B－C－D");
    expect(html).toContain("03出現資料不代表一定形成最終差異");
    expect(app).toContain("可同時選擇本月及前月");
    expect(app).not.toContain("前2個月");
    expect(html).toContain("../inventory/rules-client.js");
    expect(app).toContain("rulesClient.fetchLatest");
    expect(app).toContain("core.resolveAnalysisMonth");
    expect(app).toContain('type === "transfers"');
    expect(app).toContain('type === "transfers" || type === "sales"');
    expect(app).toContain("multiple");
    expect(app).not.toContain("XMLHttpRequest");
  });
});

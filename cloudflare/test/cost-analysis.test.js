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
    expect(core.classifyWarehouse("[快閃] 高雄漢神本館")).toBe("franchise");
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
      transfers: ["單據編碼", "狀態", "調出倉庫名", "調入倉庫名", "貨號", "品名", "數量", "調出方成本價", "調入方成本價", "調出方成本額", "結算額", "開單日期"]
    };
    for (const [type, headers] of Object.entries(cases)) {
      const mapping = core.autoMapHeaders(headers, type);
      expect(core.validateMapping(type, mapping).valid).toBe(true);
      if (type === "movements") expect(mapping.direction).toBeNull();
    }
    const salesMap = core.autoMapHeaders(cases.sales, "sales");
    expect(cases.sales[salesMap.qty]).toBe("扣庫量");
    expect(cases.sales[salesMap.purchaseCostAmount]).toBe("進貨價金額");
    const transferMap = core.autoMapHeaders(cases.transfers, "transfers");
    expect(cases.transfers[transferMap.transferAmount]).toBe("調出方成本額");
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
    const reports = {
      ...baseInventory("F5", 10, 9, 20),
      sales: report("sales", [{ sku: "F5", name: "商品F5", store: "高雄夢時代專櫃", qty: 1, purchasePrice: 20 }]),
      storeMonthly: report("storeMonthly", [{ sku: "F5", name: "商品F5", store: "高雄夢時代專櫃", reconcileType: "5 總倉代出", qty: 1, claimAmount: 33 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0].salesQty).toBe(1);
    expect(analysis.details[0].salesAmount).toBe(20);
    expect(analysis.issues.some((issue) => issue.type.includes("缺少調撥"))).toBe(false);
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

  it("公司內部調撥不進B，輸出整合為同一活頁簿四個頁籤", () => {
    const reports = {
      ...baseInventory("I1", 5, 5),
      transfers: report("transfers", [{ sku: "I1", name: "商品I1", sourceWarehouse: "寬承總倉", destinationWarehouse: "瑕疵倉", qty: 1, purchasePrice: 10 }])
    };
    const analysis = core.analyzeReports(reports);
    expect(analysis.details[0].salesQty).toBe(0);
    const workbook = core.buildOutputWorkbook(analysis, XLSX);
    expect(workbook.SheetNames).toEqual(["01_分析摘要", "02_商品差異明細", "03_未配對資料", "04_來源檢查"]);
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
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets["04_來源檢查"], { header: 1, defval: "" });
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
});

describe("庫存成本分析前台", () => {
  it("入口可進入新工具，工具頁清楚標示八類來源、倉別提醒與本機處理", () => {
    const home = readFileSync("../index.html", "utf8");
    const html = readFileSync("../cost-analysis/index.html", "utf8");
    const app = readFileSync("../cost-analysis/app.js", "utf8");
    expect(home).toContain('href="/cost-analysis/"');
    expect(html).toContain("期初、期末請使用相同倉別範圍");
    expect(html).toContain("請排除加盟店倉");
    expect(html).toContain("選擇八類報表");
    expect(html).toContain("不會傳到網站、Cloudflare或其他伺服器");
    expect(html).toContain("公司最新版商品規則");
    expect(html).toContain("../inventory/rules-client.js");
    expect(app).toContain("rulesClient.fetchLatest");
    expect(app).not.toContain("XMLHttpRequest");
  });
});

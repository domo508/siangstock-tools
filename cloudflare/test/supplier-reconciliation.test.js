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
const core = loadBrowserScript("../supplier-reconciliation/core.js", { XLSX }).SupplierReconciliationCore;

function buildReports() {
  const aBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(aBook, XLSX.utils.aoa_to_sheet([
    ["開單日期", "收貨單編碼", "貨號", "品名", "已收數量", "未稅進貨價", "未稅進貨額", "供應商名稱"],
    ["2026-06-01", "R1", "P1", "60天絲床包 [晨曦]", 10, 100, 1000, "測試供應商"],
    ["2026-06-02", "R2", "P2", "純棉薄被套 [暮雨]", 5, 200, 1000, "測試供應商"],
    ["2026-06-03", "R3", "P3", "熊冷被 [Soft Beige]", 5, 300, 1500, "測試供應商"],
    ["2026-06-04", "R4", "P4", "內部限定床架配件", 2, 80, 160, "測試供應商"],
    ["", 4, "", "", 22, "", 3660, ""]
  ]), "工作表1");

  const bBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(bBook, XLSX.utils.aoa_to_sheet([
    ["測試供應商"], ["對帳單"], [], [], [], [], [], [],
    ["帳款日", "進銷單號", "帳別", "品名", "數量", "單價", "合計"],
    ["2026-06-01", "S1", "銷貨", "60天絲-晨曦-床包", 10, 100, 1000],
    ["2026-06-02", "S2", "銷貨", "純棉-暮雨-薄被套", 5, 200, 1000],
    ["2026-06-03", "T2", "銷退", "純棉-暮雨-薄被套", 1, 200, 200],
    ["2026-06-04", "S3", "銷貨", "涼感-熊冷Soft Beige-涼被", 5, 320, 1600],
    ["2026-06-05", "S5", "銷貨", "供應商獨有旅行收納袋", 3, 90, 270],
    ["2026-06-05", "S6", "銷貨", "運費", 1, 120, 120]
  ]), "對帳單");

  const aInspection = core.inspectWorkbook(aBook, XLSX, "a").sheets[0];
  const bInspection = core.inspectWorkbook(bBook, XLSX, "b").sheets[0];
  const aReport = core.extractSource(aBook, XLSX, "a", { sheetName: aInspection.name, headerRowIndex: aInspection.headerRowIndex, mapping: aInspection.mapping, fileName: "A.xlsx" });
  const bReport = core.extractSource(bBook, XLSX, "b", { sheetName: bInspection.name, headerRowIndex: bInspection.headerRowIndex, mapping: bInspection.mapping, fileName: "B.xlsx" });
  return { aReport, bReport };
}

describe("財務供應商對帳核心", () => {
  it("自動辨識A、B表頭並排除合計與非商品列", () => {
    const { aReport, bReport } = buildReports();
    expect(aReport.headerRowIndex).toBe(0);
    expect(bReport.headerRowIndex).toBe(8);
    expect(aReport.records).toHaveLength(4);
    expect(bReport.records).toHaveLength(5);
    expect(aReport.rawRows.some((row) => row.reason === "合計列")).toBe(true);
    expect(bReport.rawRows.some((row) => row.name === "運費" && row.reason === "非商品項目")).toBe(true);
  });

  it("下載檔名包含對帳供應商與月份，並清除不合法字元", () => {
    const analysis = { period: { month: "2026-06" }, bReport: { fileName: "6月-普優瑪(B表供應商).xlsx", records: [] } };
    expect(core.buildDownloadFileName(analysis)).toBe("財務供應商對帳比對_普悠瑪_2026-06.xlsx");
    expect(core.buildDownloadFileName(analysis, { label: '上林/寬承:*?"<>|' })).toBe("財務供應商對帳比對_上林 寬承_2026-06.xlsx");
  });

  it("以A未稅進貨價對B單價，並用數量與單價說明差異", () => {
    const { aReport, bReport } = buildReports();
    const analysis = core.analyzeReports(aReport, bReport);
    expect(analysis.totals.aItemCount).toBe(4);
    expect(analysis.totals.bItemCount).toBe(4);
    expect(analysis.totals.matchedCount).toBe(3);
    expect(analysis.paired.find((row) => row.aSku === "P1").status).toBe("完全通過");
    expect(analysis.paired.find((row) => row.aSku === "P2").status).toBe("數量差異");
    expect(analysis.paired.find((row) => row.aSku === "P3").status).toBe("單價差異");
    expect(analysis.totals.aOnlyCount).toBe(1);
    expect(analysis.totals.bOnlyCount).toBe(1);
  });

  it("金額不同但數量與單價相同時才列計算異常", () => {
    const { aReport, bReport } = buildReports();
    bReport.records.find((row) => row.name.includes("晨曦")).amount = 999;
    const analysis = core.analyzeReports(aReport, bReport);
    expect(analysis.paired.find((row) => row.aSku === "P1").status).toBe("計算異常");
    expect(analysis.paired.some((row) => row.status === "金額差異")).toBe(false);
  });

  it("支援民國年日期，並承接B表群組中留白的日期與帳別", () => {
    expect(core.parseDateValue("115/06/02").key).toBe("2026-06-02");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ["帳款日", "進銷單號", "帳別", "品名", "數量", "單價", "合計"],
      ["115/06/02", "S1", "銷退", "第一項", 1, 100, 100],
      ["", "", "", "第二項", 2, 100, 200]
    ]), "對帳單");
    const inspection = core.inspectWorkbook(book, XLSX, "b").sheets[0];
    const report = core.extractSource(book, XLSX, "b", { sheetName: inspection.name, headerRowIndex: inspection.headerRowIndex, mapping: inspection.mapping, fileName: "B.xlsx" });
    expect(report.records[1].date).toBe("115/06/02");
    expect(report.records[1].doc).toBe("S1");
    expect(report.records[1].transactionType).toBe("銷退");
    expect(report.records[1].qty).toBe(-2);
  });

  it("補回普悠瑪客製尺寸錯置在下一列帳別欄的品名", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ["帳款日", "進銷單號", "帳別", "品名", "數量", "單價", "合計"],
      ["115/06/04", "S1", "銷貨", "", 1, 275, 275],
      ["", "", "195*205*50可可咖床包組含2枕", "", "", "", ""],
      ["", "", "銷退", "其他", 1, 640, 640],
      ["", "", "180X186X44-60天絲床包[深灰雪松](含2枕)", "", "", "", ""],
      ["", "", "銷貨", "正常商品", 2, 100, 200],
      ["", "", "000123", "", "", "", ""],
      ["", "", "銷貨", "", 1, 120, 120],
      ["", "", "6/12進口運費", "", "", "", ""],
      ["", "", "銷貨", "", 3, 240, 720],
      ["", "", "48*78台灣之星打樣", "", "", "", ""]
    ]), "對帳單");
    const inspection = core.inspectWorkbook(book, XLSX, "b").sheets[0];
    const report = core.extractSource(book, XLSX, "b", { sheetName: inspection.name, headerRowIndex: inspection.headerRowIndex, mapping: inspection.mapping, fileName: "B.xlsx" });
    expect(report.records).toHaveLength(3);
    expect(report.records[0]).toMatchObject({ sourceRow: 2, nameSourceRow: 3, name: "195*205*50可可咖床包組含2枕", qty: 1, unitPrice: 275, amount: 275, formatRepair: "帳別欄錯置品名補回" });
    expect(report.records[1]).toMatchObject({ sourceRow: 4, nameSourceRow: 5, name: "180X186X44-60天絲床包[深灰雪松](含2枕)", qty: -1, unitPrice: 640, amount: -640 });
    expect(report.rawRows.find((row) => row.sourceRow === 3).reason).toContain("已併入B表第2列");
    expect(report.rawRows.find((row) => row.sourceRow === 5).reason).toContain("已併入B表第4列");
    expect(report.rawRows.find((row) => row.sourceRow === 8).included).toBe(false);
    expect(report.rawRows.find((row) => row.sourceRow === 10).included).toBe(false);
    expect(report.rawRows.find((row) => row.sourceRow === 11).included).toBe(false);
    expect(core.aggregateSource(report)[0].rows[0]).toBe("2（品名3）");
  });

  it("自動辨識力榮帳款頁，依選定月份整份納入並以貨號逐筆配對", () => {
    const bBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(bBook, XLSX.utils.aoa_to_sheet([
      ["力榮興業有限公司"], ["銷貨單"], [], [], [], [], [],
      ["序", "貨品編號", "品名", "數量", "單位", "單價", "銷貨小計"],
      [1, "P9", "不應選到的單張銷貨單", 99, "件", 99, 9801]
    ]), "0520(一般)");
    XLSX.utils.book_append_sheet(bBook, XLSX.utils.aoa_to_sheet([
      ["力榮興業有限公司"], ["收款對帳單明細表"], [], [], [], [], [], ["結帳日期:2026/05/01~31"],
      ["單據日期", "貨號", "品名", "單價", "數量", "總計"],
      ["5/20(一般)", "P1", "供應商舊品名", 90, 10, 900],
      ["", "P2", "第二項", 200, 20, 4000],
      ["6/17(一般)", "P3", "第三項", 250, 10, 2500],
      ["", "P3", "第三項", 300, 20, 6000],
      ["合計金額 (未稅)", 13400]
    ]), "帳款");
    XLSX.utils.book_append_sheet(bBook, XLSX.utils.aoa_to_sheet([
      ["力榮興業有限公司", "", "", "", "", "", "", "力榮興業有限公司"],
      ["收款對帳單明細表", "", "", "", "", "", "", "收款對帳單明細表"]
    ]), "背貼");

    const inspection = core.inspectWorkbook(bBook, XLSX, "b");
    expect(inspection.format).toBe("li-rong");
    expect(inspection.sheets[0].name).toBe("帳款");
    expect(inspection.sheets[0].validation.valid).toBe(true);
    expect(inspection.sheets[0].headers[inspection.sheets[0].mapping.amount]).toBe("總計");
    expect(inspection.sheets[0].headers[inspection.sheets[0].mapping.sku]).toBe("貨號");

    const selected = inspection.sheets[0];
    const bReport = core.extractSource(bBook, XLSX, "b", {
      sheetName: selected.name, headerRowIndex: selected.headerRowIndex, mapping: selected.mapping, format: selected.format, fileName: "力榮.xlsx"
    });
    expect(bReport.periodScope).toBe("selected-month-statement");
    expect(bReport.records).toHaveLength(4);
    expect(bReport.records[1]).toMatchObject({ sourceRow: 11, date: "5/20(一般)", doc: "5/20(一般)", sku: "P2", supplier: "力榮" });
    expect(core.inferDominantMonth(bReport)).toBe("");

    const makeAReport = (records) => ({
      sourceType: "a", fileName: "A.xlsx", sheetName: "工作表1", headerRowIndex: 0,
      records: records.map((row, index) => ({ ...row, sourceRow: index + 2, transactionType: "", included: true, reason: "納入比對" })),
      rawRows: records.map((row, index) => ({ ...row, source: "A", sourceFile: "A.xlsx", sheetName: "工作表1", sourceRow: index + 2, transactionType: "", included: true, reason: "納入比對" }))
    });
    const aReport = makeAReport([
      { date: "2026-06-04", doc: "R1", sku: "P1", name: "我方完全不同品名", qty: 10, unitPrice: 100, amount: 1000, supplier: "力榮" },
      { date: "2026-06-04", doc: "R1", sku: "P2", name: "第二項", qty: 20, unitPrice: 200, amount: 4000, supplier: "力榮" },
      { date: "2026-06-25", doc: "R2", sku: "P3", name: "第三項", qty: 10, unitPrice: 300, amount: 3000, supplier: "力榮" },
      { date: "2026-06-25", doc: "R2", sku: "P3", name: "第三項", qty: 20, unitPrice: 300, amount: 6000, supplier: "力榮" },
      { date: "2026-07-03", doc: "R3", sku: "P8", name: "七月商品", qty: 1, unitPrice: 50, amount: 50, supplier: "力榮" }
    ]);
    const analysis = core.analyzeMonthlyReports(aReport, bReport, { month: "2026-06", cutoff: "2026-07-10" });
    expect(analysis.totals).toMatchObject({ aItemCount: 3, bItemCount: 3, matchedCount: 3, passCount: 1, differenceCount: 2, aOnlyCount: 0, bOnlyCount: 0, aAmount: 14000, bAmount: 13400, absoluteDifference: 600 });
    expect(analysis.paired.find((row) => row.aSku === "P1").matchBasis).toContain("貨號完全一致");
    expect(analysis.paired.find((row) => row.aSku === "P3").auditExplanation).toContain("B表第12列");
    expect(analysis.paired.find((row) => row.aSku === "P3").auditAmountDifference).toBe(500);
    expect(analysis.bReport.rawRows.find((row) => row.sourceRow === 10).reason).toContain("整份帳款");
  });

  it("讀取上林品名對照表，以我方貨號配對並略過一對多衝突", () => {
    const mappingBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(mappingBook, XLSX.utils.aoa_to_sheet([
      ["貨號", "品名", "上林品名", "目前有進貨"],
      ["P100", "我方完整商品名稱", "上林短品名", "v"],
      ["P200", "停售商品甲", "停售", ""],
      ["P300", "停售商品乙", "停售", ""]
    ]), "上林對應");
    const mapping = core.parseNameMappingWorkbook(mappingBook, XLSX, { fileName: "上林品名對應.xlsx" });
    expect(mapping.usable).toHaveLength(1);
    expect(mapping.conflicts).toHaveLength(1);
    expect(mapping.conflicts[0]).toMatchObject({ bName: "停售", skus: ["P200", "P300"] });

    const aReport = {
      sourceType: "a", fileName: "A.xlsx", sheetName: "工作表1", headerRowIndex: 0,
      records: [{ sourceRow: 2, date: "2026-06-01", doc: "R1", sku: "P100", name: "我方完整商品名稱", qty: 3, unitPrice: 120, amount: 360, supplier: "上林" }],
      rawRows: [{ sourceRow: 2, date: "2026-06-01", doc: "R1", sku: "P100", name: "我方完整商品名稱", qty: 3, unitPrice: 120, amount: 360, supplier: "上林", included: true, reason: "納入比對" }]
    };
    const bReport = {
      sourceType: "b", fileName: "B.xlsx", sheetName: "請款單", headerRowIndex: 0,
      records: [{ sourceRow: 15, date: "2026-06-01", doc: "", sku: "", name: "上林短品名", qty: 3, unitPrice: 120, amount: 360, supplier: "上林" }],
      rawRows: [{ sourceRow: 15, date: "2026-06-01", doc: "", sku: "", name: "上林短品名", qty: 3, unitPrice: 120, amount: 360, supplier: "上林", included: true, reason: "商品明細" }]
    };
    const mappedB = core.applyNameMappingToBReport(bReport, mapping);
    expect(mappedB.records[0]).toMatchObject({ sku: "P100", nameMappingSourceRow: 2 });
    expect(mappedB.rawRows[0].reason).toContain("品名對照表第2列 → P100");
    expect(mappedB.nameMapping).toMatchObject({ mappedRecordCount: 1, mappedUniqueNameCount: 1, conflictCount: 1 });
    const analysis = core.analyzeMonthlyReports(aReport, mappedB, { month: "2026-06", cutoff: "2026-07-03" });
    expect(analysis.totals).toMatchObject({ matchedCount: 1, passCount: 1, aOnlyCount: 0, bOnlyCount: 0 });
    expect(analysis.paired[0].matchBasis).toContain("貨號完全一致");
    const output = core.buildOutputWorkbook(analysis, XLSX);
    const rules = XLSX.utils.sheet_to_json(output.Sheets["07_比對說明"], { header: 1, defval: "" });
    expect(rules.some((row) => row[0] === "品名對照表" && row[1].includes("1筆B明細"))).toBe(true);
    const rawB = XLSX.utils.sheet_to_json(output.Sheets["06_B表原始資料"], { defval: "" });
    expect(rawB[0]["排除／判斷原因"]).toContain("品名對照表第2列 → P100");
  });

  it("本機台帳會以固定供應商識別分開保存", () => {
    expect(core.inferLedgerVendor({ format: "shanglin", records: [] })).toEqual({ key: "shanglin", label: "上林" });
    expect(core.inferLedgerVendor({ format: "li-rong", records: [] })).toEqual({ key: "li-rong", label: "力榮" });
    expect(core.inferLedgerVendor({ format: "", fileName: "6月-普優瑪(B表供應商).xlsx", records: [] })).toEqual({ key: "puyuma", label: "普悠瑪" });
  });

  it("上林先核對整張訂單，再將月底A表與脈絡衝突候選分開提醒", () => {
    const makeReport = (sourceType, records, format = "") => ({
      sourceType, format, fileName: `${sourceType}.xlsx`, sheetName: "資料", headerRowIndex: 0,
      records: records.map((row, index) => ({ ...row, sourceRow: index + 2, included: true, reason: "納入比對" })),
      rawRows: records.map((row, index) => ({ ...row, source: sourceType.toUpperCase(), sourceFile: `${sourceType}.xlsx`, sheetName: "資料", sourceRow: index + 2, included: true, reason: "納入比對" }))
    });
    const aReport = makeReport("a", [
      { date: "2026-06-01", doc: "R1", sku: "P1", name: "商品一", qty: 3, unitPrice: 100, amount: 300, note: "請直送【倉庫】" },
      { date: "2026-06-01", doc: "R1", sku: "P2", name: "商品二", qty: 1, unitPrice: 200, amount: 200, note: "請直送【倉庫】" },
      { date: "2026-06-29", doc: "R2", sku: "P1", name: "商品一", qty: 2, unitPrice: 100, amount: 200, note: "請直送【倉庫】" },
      { date: "2026-06-29", doc: "R2", sku: "P3", name: "商品三", qty: 1, unitPrice: 300, amount: 300, note: "請直送【倉庫】" },
      { date: "2026-06-29", doc: "R3", sku: "G1", name: "候選商品", qty: 6, unitPrice: 1100, amount: 6600, note: "直送【文心門市】" }
    ]);
    const bReport = makeReport("b", [
      { date: "2026-06-01", doc: "S-20260601-001", sku: "P1", name: "供應商商品一", qty: 3, unitPrice: 100, amount: 300, recipient: "翔仔總倉" },
      { date: "2026-06-01", doc: "S-20260601-001", sku: "P2", name: "供應商商品二", qty: 1, unitPrice: 200, amount: 200, recipient: "翔仔總倉" },
      { date: "2026-06-10", doc: "S-20260624-005", sku: "G1", name: "供應商候選", qty: 6, unitPrice: 1000, amount: 6000, recipient: "台中誠品480店" }
    ], "shanglin");
    const analysis = core.analyzeMonthlyReports(aReport, bReport, { month: "2026-06", cutoff: "2026-07-10" });
    expect(analysis.vendorMode).toBe("shanglin-order");
    expect(analysis.totals).toMatchObject({
      aItemCount: 4, bItemCount: 3, matchedCount: 2, exactOrderCount: 1, exactLineCount: 2,
      suspectedNextPeriodCount: 2, suspectedCandidateCount: 1, aOnlyCount: 1, bOnlyCount: 0, attentionCount: 3
    });
    expect(analysis.paired.find((row) => row.aSku === "P1").status).toBe("本期完全通過＋疑似次期上林帳款");
    expect(analysis.reviewItems.find((row) => row.aSku === "G1")).toMatchObject({ status: "疑似配對待人工確認", unitPriceDifference: 100, aRows: "6", bRows: "4" });
    const output = core.buildOutputWorkbook(analysis, XLSX);
    const summary = XLSX.utils.sheet_to_json(output.Sheets["01_對帳總覽"], { header: 1, defval: "" });
    expect(summary.some((row) => row[0] === "⚠ 財務特別提醒" && row[1].includes("3項待確認"))).toBe(true);
    const rawA = XLSX.utils.sheet_to_json(output.Sheets["05_A表原始資料"], { defval: "" });
    expect(rawA[0]["備註"]).toBe("請直送【倉庫】");
  });

  it("上林第9頁籤會在下期先反查整單，通過的B明細不重複進入本期對帳", () => {
    const makeReport = (sourceType, records, extra = {}) => ({
      sourceType, fileName: `${sourceType}.xlsx`, sheetName: "資料", headerRowIndex: 0, ...extra,
      records: records.map((row, index) => ({ ...row, sourceRow: index + 2, included: true, reason: "納入比對" })),
      rawRows: records.map((row, index) => ({ ...row, source: sourceType.toUpperCase(), sourceFile: `${sourceType}.xlsx`, sheetName: "資料", sourceRow: index + 2, included: true, reason: "納入比對" }))
    });
    const juneA = makeReport("a", [
      { date: "2026-06-29", doc: "R2", sku: "P1", name: "商品一", qty: 2, unitPrice: 100, amount: 200, note: "請直送【倉庫】" },
      { date: "2026-06-29", doc: "R2", sku: "P3", name: "商品三", qty: 1, unitPrice: 300, amount: 300, note: "請直送【倉庫】" },
      { date: "2026-06-29", doc: "R3", sku: "G1", name: "候選商品", qty: 6, unitPrice: 1100, amount: 6600, note: "直送【文心門市】" }
    ]);
    const juneB = makeReport("b", [
      { date: "2026-06-10", doc: "S-20260624-005", sku: "G1", name: "錯誤候選", qty: 6, unitPrice: 1000, amount: 6000, recipient: "台中誠品480店" }
    ], { format: "shanglin" });
    const june = core.analyzeMonthlyReports(juneA, juneB, { month: "2026-06", cutoff: "2026-07-10" });
    const juneOutput = core.buildOutputWorkbook(june, XLSX);
    const priorShanglin = core.shanglinRowsFromWorkbook(juneOutput, XLSX);
    expect(priorShanglin).toHaveLength(3);
    expect(priorShanglin.find((row) => row.sku === "G1")).toMatchObject({ originalStatus: "疑似配對待人工確認", originalBDoc: "S-20260624-005", originalBUnitPrice: 1000 });

    const julyA = makeReport("a", [
      { date: "2026-07-10", doc: "R4", sku: "P4", name: "本期商品", qty: 1, unitPrice: 400, amount: 400, note: "請直送【倉庫】" }
    ]);
    const julyB = makeReport("b", [
      { date: "2026-06-30", doc: "S-20260701-001", sku: "P1", name: "商品一", qty: 2, unitPrice: 100, amount: 200, recipient: "翔仔總倉" },
      { date: "2026-06-30", doc: "S-20260701-001", sku: "P3", name: "商品三", qty: 1, unitPrice: 300, amount: 300, recipient: "翔仔總倉" },
      { date: "2026-06-30", doc: "S-20260701-002", sku: "G1", name: "候選商品", qty: 6, unitPrice: 1100, amount: 6600, recipient: "台中文心秀泰" },
      { date: "2026-07-10", doc: "S-20260710-001", sku: "P4", name: "本期商品", qty: 1, unitPrice: 400, amount: 400, recipient: "翔仔總倉" }
    ], { format: "shanglin", periodScope: "selected-month-statement", statementMonth: "2026-07" });
    const july = core.analyzeMonthlyReports(julyA, julyB, { month: "2026-07", cutoff: "2026-08-10", priorShanglin });
    expect(july.totals).toMatchObject({
      reverseResolvedOrderCount: 2, reverseResolvedLineCount: 3, reverseResolvedQty: 9, reverseResolvedAmount: 7100,
      reverseUnresolvedOrderCount: 0, bStatementItemCount: 4, bItemCount: 1, exactOrderCount: 1, exactLineCount: 1
    });
    expect(july.paired).toHaveLength(1);
    expect(july.paired[0].aSku).toBe("P4");
    expect(july.shanglinReverseRows.find((row) => row.aSku === "G1")).toMatchObject({ status: "A端已驗證／原B候選待確認", bDoc: "S-20260701-002", unitPriceDifference: 0 });
    const julyOutput = core.buildOutputWorkbook(july, XLSX);
    expect(core.shanglinRowsFromWorkbook(julyOutput, XLSX)).toHaveLength(0);
    const reverseRows = XLSX.utils.sheet_to_json(julyOutput.Sheets["09_上林反向跨月"], { defval: "" });
    expect(reverseRows).toHaveLength(3);
    expect(reverseRows.find((row) => row["A貨號"] === "G1")["處理說明"]).toContain("原上期B候選");
  });

  it("輸出九頁籤並保留原始資料、差異、說明與兩種跨月台帳", () => {
    const { aReport, bReport } = buildReports();
    const workbook = core.buildOutputWorkbook(core.analyzeReports(aReport, bReport), XLSX);
    expect(workbook.SheetNames).toEqual(["01_對帳總覽", "02_差異明細", "03_未配對品項", "04_完全通過", "05_A表原始資料", "06_B表原始資料", "07_比對說明", "08_跨月認列台帳", "09_上林反向跨月"]);
    expect(workbook.Sheets["02_差異明細"]["!autofilter"]).toBeTruthy();
    expect(workbook.Sheets["05_A表原始資料"]["!autofilter"]).toBeTruthy();
    const summary = XLSX.utils.sheet_to_json(workbook.Sheets["01_對帳總覽"], { header: 1, defval: "" });
    expect(summary.some((row) => row[0] === "A表對價" && row[1] === "A表4項＝成功配對3項＋僅A表1項")).toBe(true);
    expect(summary.some((row) => row[0] === "⚠ 財務特別提醒" && row[1] === "配對但有差異2項＋僅A表1項＋僅B表1項＝4項待確認")).toBe(true);
  });

  it("不同床包尺寸不會因名稱與單價相近而強制配對", () => {
    const a = { name: "晨曦5尺床包", canonicalName: core.canonicalizeName("晨曦5尺床包"), qty: 1, unitPrice: 100 };
    const b = { name: "晨曦6尺床包", canonicalName: core.canonicalizeName("晨曦6尺床包"), qty: 1, unitPrice: 100 };
    expect(core.matchScore(a, b).sizesCompatible).toBe(false);
    expect(core.findMatches([a], [b]).accepted).toHaveLength(0);
  });

  it("只用次月必要數量補足本月短少，並留下部分認列台帳", () => {
    const makeReport = (sourceType, records) => ({
      sourceType, fileName: `${sourceType}.xlsx`, sheetName: "資料", headerRowIndex: 0,
      records: records.map((row, index) => ({ ...row, sourceRow: index + 2, transactionType: "" })),
      rawRows: records.map((row, index) => ({ ...row, sourceRow: index + 2, included: true, reason: "商品明細", sourceFile: `${sourceType}.xlsx`, sheetName: "資料", transactionType: "" }))
    });
    const aReport = makeReport("a", [
      { date: "2026-06-30", doc: "R1", sku: "P1", name: "晨曦5尺床包", qty: 8, unitPrice: 100, amount: 800, supplier: "測試供應商" },
      { date: "2026-07-02", doc: "R2", sku: "P1", name: "晨曦5尺床包", qty: 5, unitPrice: 100, amount: 500, supplier: "測試供應商" },
      { date: "2026-07-02", doc: "R3", sku: "P9", name: "次月其他商品", qty: 9, unitPrice: 50, amount: 450, supplier: "測試供應商" }
    ]);
    const bReport = makeReport("b", [
      { date: "2026-06-30", doc: "S1", sku: "", name: "晨曦5尺床包", qty: 10, unitPrice: 100, amount: 1000, supplier: "測試供應商" }
    ]);
    const june = core.analyzeMonthlyReports(aReport, bReport, { month: "2026-06", cutoff: "2026-07-03" });
    expect(june.paired).toHaveLength(1);
    expect(june.paired[0].status).toBe("跨月完全通過");
    expect(june.crossMonthAllocations).toHaveLength(1);
    expect(june.crossMonthAllocations[0].recognizedQty).toBe(2);
    expect(june.aOnly).toHaveLength(0);
    expect(june.aItems[0].qty).toBe(10);

    const workbook = core.buildOutputWorkbook(june, XLSX);
    const importedLedger = core.ledgerRowsFromWorkbook(workbook, XLSX);
    expect(importedLedger).toHaveLength(1);
    expect(importedLedger[0].recognizedQty).toBe(2);

    const julyB = makeReport("b", [
      { date: "2026-07-03", doc: "S2", sku: "", name: "本月新品", qty: 1, unitPrice: 80, amount: 80, supplier: "測試供應商" }
    ]);
    const julyA = makeReport("a", [
      { date: "2026-07-02", doc: "R2", sku: "P1", name: "晨曦5尺床包", qty: 5, unitPrice: 100, amount: 500, supplier: "測試供應商" },
      { date: "2026-07-03", doc: "R4", sku: "P4", name: "本月新品", qty: 1, unitPrice: 80, amount: 80, supplier: "測試供應商" }
    ]);
    const july = core.analyzeMonthlyReports(julyA, julyB, { month: "2026-07", cutoff: "2026-08-03", priorLedger: importedLedger });
    expect(july.totals.priorExcludedQty).toBe(2);
    expect(july.aOnly.find((row) => row.aSku === "P1").aQty).toBe(3);
  });

  it("逐筆核對每張明細，即使月總量未短少也辨識跨月與疑似前期", () => {
    const makeReport = (sourceType, records) => ({
      sourceType, fileName: `${sourceType}.xlsx`, sheetName: "資料", headerRowIndex: 0,
      records: records.map((row, index) => ({ ...row, sourceRow: row.sourceRow || index + 2, transactionType: "" })),
      rawRows: records.map((row, index) => ({ ...row, sourceRow: row.sourceRow || index + 2, included: true, reason: "商品明細", sourceFile: `${sourceType}.xlsx`, sheetName: "資料", transactionType: "" }))
    });
    const product = "涼感-PINGU熊冷Let's Go Fishing-150*200cm涼被";
    const aReport = makeReport("a", [
      { sourceRow: 77, date: "2026-06-16", doc: "RP2026060011", sku: "F13053", name: product, qty: 10, unitPrice: 600, amount: 6000, supplier: "普悠瑪" },
      { sourceRow: 240, date: "2026-07-01", doc: "RP2026070007", sku: "F13053", name: product, qty: 30, unitPrice: 600, amount: 18000, supplier: "普悠瑪" },
      { sourceRow: 255, date: "2026-06-24", doc: "RP202606001H", sku: "F13053", name: product, qty: 40, unitPrice: 600, amount: 24000, supplier: "普悠瑪" },
      { sourceRow: 282, date: "2026-06-01", doc: "RP2026060002", sku: "F13053", name: product, qty: 70, unitPrice: 600, amount: 42000, supplier: "普悠瑪" }
    ]);
    const bReport = makeReport("b", [
      { sourceRow: 392, date: "2026-06-23", doc: "2011506230004", sku: "", name: product, qty: 40, unitPrice: 600, amount: 24000, supplier: "普悠瑪" },
      { sourceRow: 420, date: "2026-06-24", doc: "2011506240001", sku: "", name: product, qty: 10, unitPrice: 600, amount: 6000, supplier: "普悠瑪" },
      { sourceRow: 486, date: "2026-06-30", doc: "2011506300003", sku: "", name: product, qty: 30, unitPrice: 600, amount: 18000, supplier: "普悠瑪" }
    ]);
    const analysis = core.analyzeMonthlyReports(aReport, bReport, { month: "2026-06", cutoff: "2026-07-10" });
    const row = analysis.paired[0];
    expect(row.status).toBe("跨月配對＋疑似前期跨月");
    expect(row.aQty).toBe(120);
    expect(row.bQty).toBe(80);
    expect(row.qtyDifference).toBe(40);
    expect(row.recognizedQty).toBe(80);
    expect(row.crossMonthQty).toBe(30);
    expect(row.aMissingQty).toBe(0);
    expect(row.bMissingQty).toBe(70);
    expect(row.auditDifferenceQty).toBe(70);
    expect(row.suspectedPriorQty).toBe(70);
    expect(row.bMissingDetail).toContain("A表第282列");
    expect(row.crossMonthDetail).toContain("B表第486列");
    expect(row.crossMonthDetail).toContain("A表第240列");
    expect(analysis.crossMonthAllocations[0].recognizedQty).toBe(30);
  });

  it("差異頁籤提供A、B缺少明細列號與逐筆稽核欄位", () => {
    const { aReport, bReport } = buildReports();
    const analysis = core.analyzeMonthlyReports(aReport, bReport, { month: "2026-06", cutoff: "2026-07-10" });
    const workbook = core.buildOutputWorkbook(analysis, XLSX);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets["02_差異明細"], { header: 1, defval: "" });
    expect(rows[0]).toContain("逐筆已核對數量");
    expect(rows[0]).toContain("A表缺少時的B來源明細");
    expect(rows[0]).toContain("B表缺少時的A來源明細");
    expect(rows[0]).toContain("跨月配對明細");
    expect(rows[0]).toContain("稽核說明");
  });
});

describe("財務供應商對帳前台", () => {
  it("入口、CIS導覽、本機處理及Excel下載均完整", () => {
    const home = readFileSync("../index.html", "utf8");
    const html = readFileSync("../supplier-reconciliation/index.html", "utf8");
    const manual = readFileSync("../supplier-reconciliation/manual.html", "utf8");
    const app = readFileSync("../supplier-reconciliation/app.js", "utf8");
    expect(home).toContain('href="/supplier-reconciliation/"');
    expect(html).toContain("公司工具首頁");
    expect(html).toContain("← 返回公司工具首頁");
    expect(html).toContain("原始Excel不保存、不上傳");
    expect(html).toContain("A表「未稅進貨價」對應B表「單價」");
    expect(html).toContain('id="period-month"');
    expect(html).toContain('id="prior-file"');
    expect(html).toContain('id="local-ledger-status"');
    expect(html).toContain('id="clear-local-ledger"');
    expect(html).toContain("最多保留24個月");
    expect(html).toContain('src="ledger-store.js');
    expect(html).toContain('id="name-mapping-file"');
    expect(html).toContain('id="summary-notes"');
    expect(html).toContain("第8頁籤");
    expect(html).toContain("第9頁籤");
    expect(html).toContain("每筆都檢查跨月");
    expect(html).toContain("力榮帳款整份依選定月份認列");
    expect(html).toContain("原始列號、日期、單號與剩餘數量");
    expect(app).toContain("數量對價關係");
    expect(app).toContain("財務特別提醒");
    expect(app).toContain("applyNameMappingToBReport");
    expect(app).toContain("saveLocalLedger");
    expect(html).toContain("下載結果Excel");
    expect(html).toContain('href="manual.html"');
    expect(html).toContain('class="guide-link"');
    expect(html).toContain("操作手冊");
    expect(html).not.toContain("manual-entry-icon");
    expect(html).toContain("20260828-browser-ledger-r11");
    expect(manual).toContain("六步完成對帳");
    expect(manual).toContain("三家供應商注意事項");
    expect(manual).toContain("九個頁籤怎麼看");
    expect(manual).toContain('href="./">← 返回對帳工具');
    expect(manual).toContain("script-src 'none'");
    expect(manual).not.toContain("<script");
    expect(html).toContain("connect-src 'none'");
    expect(app).not.toContain("fetch(");
    expect(app).not.toContain("XMLHttpRequest");
  });
});

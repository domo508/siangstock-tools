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

  it("輸出八頁籤並保留原始資料、差異、說明與跨月台帳", () => {
    const { aReport, bReport } = buildReports();
    const workbook = core.buildOutputWorkbook(core.analyzeReports(aReport, bReport), XLSX);
    expect(workbook.SheetNames).toEqual(["01_對帳總覽", "02_差異明細", "03_未配對品項", "04_完全通過", "05_A表原始資料", "06_B表原始資料", "07_比對說明", "08_跨月認列台帳"]);
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
});

describe("財務供應商對帳前台", () => {
  it("入口、CIS導覽、本機處理及Excel下載均完整", () => {
    const home = readFileSync("../index.html", "utf8");
    const html = readFileSync("../supplier-reconciliation/index.html", "utf8");
    const app = readFileSync("../supplier-reconciliation/app.js", "utf8");
    expect(home).toContain('href="/supplier-reconciliation/"');
    expect(html).toContain("公司工具首頁");
    expect(html).toContain("← 返回公司工具首頁");
    expect(html).toContain("不上傳、不會修改原始檔");
    expect(html).toContain("A表「未稅進貨價」對應B表「單價」");
    expect(html).toContain('id="period-month"');
    expect(html).toContain('id="prior-file"');
    expect(html).toContain('id="summary-notes"');
    expect(html).toContain("第8頁籤");
    expect(app).toContain("數量對價關係");
    expect(app).toContain("財務特別提醒");
    expect(html).toContain("下載結果Excel");
    expect(html).toContain("connect-src 'none'");
    expect(app).not.toContain("fetch(");
    expect(app).not.toContain("XMLHttpRequest");
  });
});

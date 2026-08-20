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
    ["收貨單編碼", "貨號", "品名", "已收數量", "未稅進貨價", "未稅進貨額", "供應商名稱"],
    ["R1", "P1", "60天絲床包 [晨曦]", 10, 100, 1000, "測試供應商"],
    ["R2", "P2", "純棉薄被套 [暮雨]", 5, 200, 1000, "測試供應商"],
    ["R3", "P3", "熊冷被 [Soft Beige]", 5, 300, 1500, "測試供應商"],
    ["R4", "P4", "內部限定床架配件", 2, 80, 160, "測試供應商"],
    [4, "", "", 22, "", 3660, ""]
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

  it("輸出七頁籤並保留原始資料、差異與說明", () => {
    const { aReport, bReport } = buildReports();
    const workbook = core.buildOutputWorkbook(core.analyzeReports(aReport, bReport), XLSX);
    expect(workbook.SheetNames).toEqual(["01_對帳總覽", "02_差異明細", "03_未配對品項", "04_完全通過", "05_A表原始資料", "06_B表原始資料", "07_比對說明"]);
    expect(workbook.Sheets["02_差異明細"]["!autofilter"]).toBeTruthy();
    expect(workbook.Sheets["05_A表原始資料"]["!autofilter"]).toBeTruthy();
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
    expect(html).toContain("下載結果Excel");
    expect(html).toContain("connect-src 'none'");
    expect(app).not.toContain("fetch(");
    expect(app).not.toContain("XMLHttpRequest");
  });
});

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
const coreContext = loadBrowserScript("../inventory/core.js", { XLSX });
const core = coreContext.InventoryCore;
const rulesContext = loadBrowserScript("../inventory/rules.bundle.js");
const defaultRules = rulesContext.INVENTORY_RULES;

describe("既有 Excel 分類與四工作表", () => {
  it("保留正常商品、排除運費、待確認贈品，且三張明細有正確合計列", () => {
    const source = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(source, XLSX.utils.aoa_to_sheet([
      ["備註"],
      ["SKU", "品名", "庫存金額"],
      ["A1", "原木托盤", 100],
      ["A2", "宅配運費", 20],
      ["A3", "節慶贈品", 30]
    ]), "庫存");
    const analysis = core.analyzeWorkbook(source, XLSX, defaultRules, "測試.xlsx");
    expect(analysis.counts).toEqual({ 正常商品: 1, 排除項目: 1, 待人工確認: 1 });
    expect(analysis.totalRows).toBe(3);
    const output = core.buildOutputWorkbook(analysis, XLSX);
    expect(output.SheetNames).toEqual(["乾淨商品", "排除項目", "待確認項目", "分類統計"]);
    for (const name of output.SheetNames.slice(0, 3)) {
      const rows = XLSX.utils.sheet_to_json(output.Sheets[name], { header: 1, raw: true });
      const total = rows.at(-1);
      expect(rows[0]).toContain("實際庫存進貨額");
      expect(total).toContain("合計");
      expect(total.some((value) => value === "資料筆數：1")).toBe(true);
      expect(total).toContain("未辨識進貨價");
    }
    expect(XLSX.utils.sheet_to_json(output.Sheets["乾淨商品"], { header: 1, raw: true }).at(-1)[2]).toBe(100);
    expect(XLSX.utils.sheet_to_json(output.Sheets["排除項目"], { header: 1, raw: true }).at(-1)[2]).toBe(20);
    expect(XLSX.utils.sheet_to_json(output.Sheets["待確認項目"], { header: 1, raw: true }).at(-1)[2]).toBe(30);
  });

  it("完整品名白名單仍優先覆蓋排除與待確認", () => {
    const rules = core.cloneRules(defaultRules);
    rules.指定品名白名單 = ["運費贈品組"];
    const source = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(source, XLSX.utils.aoa_to_sheet([["品名"], ["運費贈品組"]]), "資料");
    const analysis = core.analyzeWorkbook(source, XLSX, rules, "白名單.xlsx");
    expect(analysis.categories).toEqual(["正常商品"]);
  });

  it("在實際庫存成本額後新增進貨額公式，並於三張明細加總", () => {
    const headers = Array.from({ length: 46 }, (_value, index) => `原始欄位${index + 1}`);
    headers[0] = "SKU";
    headers[1] = "品名";
    headers[19] = "實際庫存";
    headers[20] = "實際庫存成本額";
    headers[45] = "進貨價";
    const source = XLSX.utils.book_new();
    const makeRow = (sku, name, inventory, inventoryCost, purchasePrice) => {
      const row = Array(46).fill("");
      row[0] = sku;
      row[1] = name;
      row[19] = inventory;
      row[20] = inventoryCost;
      row[45] = purchasePrice;
      return row;
    };
    XLSX.utils.book_append_sheet(source, XLSX.utils.aoa_to_sheet([
      headers,
      makeRow("A1", "原木托盤", 2, 18, 10),
      makeRow("A2", "宅配運費", 3, 40, 15),
      makeRow("A3", "節慶贈品", 4, 16, 5)
    ]), "庫存");

    const analysis = core.analyzeWorkbook(source, XLSX, defaultRules, "寬表測試.xlsx");
    const output = core.buildOutputWorkbook(analysis, XLSX);
    const expected = {
      乾淨商品: 20,
      排除項目: 45,
      待確認項目: 20
    };
    for (const [name, value] of Object.entries(expected)) {
      const sheet = output.Sheets[name];
      expect(sheet.V1.v).toBe("實際庫存進貨額");
      expect(sheet.AU1.v).toBe("進貨價");
      expect(sheet.V2.f).toBe("IFERROR(T2*AU2,0)");
      expect(sheet.V2.v).toBe(value);
      expect(sheet.V3.f).toBe("SUM(V2:V2)");
      expect(sheet.V3.v).toBe(value);
    }
  });
});

describe("集中規則瀏覽器用戶端", () => {
  it("強制 no-store 取得並驗證最新版本", async () => {
    const client = loadBrowserScript("../inventory/rules-client.js").InventoryRulesClient;
    let options;
    const fetchImpl = async (_url, value) => { options = value; return { ok: true, json: async () => ({ version: 8, updatedAt: "2026-08-13T00:00:00Z", rules: defaultRules }) }; };
    const latest = await client.fetchLatest(fetchImpl, core);
    expect(latest.version).toBe(8);
    expect(options.cache).toBe("no-store");
  });

  it("API 失敗時拒絕提供舊規則", async () => {
    const client = loadBrowserScript("../inventory/rules-client.js").InventoryRulesClient;
    await expect(client.fetchLatest(async () => ({ ok: false, status: 503 }), core)).rejects.toThrow(/無法使用/);
  });
});

describe("前台導覽", () => {
  it("首頁提供一致的公司工具標題與分享卡片資訊", () => {
    const homeHtml = readFileSync("../index.html", "utf8");
    expect(homeHtml).toContain("<title>翔仔居家-公司工具</title>");
    expect(homeHtml).toContain('property="og:title" content="翔仔居家-公司工具"');
    expect(homeHtml).toContain('name="twitter:title" content="翔仔居家-公司工具"');
  });

  it("資料整理工具與規則頁都有清楚的名稱和上一層路徑", () => {
    const homeHtml = readFileSync("../index.html", "utf8");
    const inventoryHtml = readFileSync("../inventory/index.html", "utf8");
    const adminHtml = readFileSync("../inventory/rules-admin/index.html", "utf8");
    const costAnalysisHtml = readFileSync("../cost-analysis/index.html", "utf8");
    expect(homeHtml).toContain("期初期末庫存資料整理");
    expect(inventoryHtml).toContain("<title>期初期末庫存資料整理｜翔仔居家</title>");
    expect(inventoryHtml).toContain("公司工具首頁");
    expect(inventoryHtml).toContain("← 返回公司工具首頁");
    expect(adminHtml).toContain("期初期末庫存資料整理");
    expect(adminHtml).toContain("公司工具首頁");
    expect(adminHtml).toContain("← 返回資料整理工具");
    expect(adminHtml).toContain("完成設定，返回資料整理工具");
    expect(costAnalysisHtml).toContain("期初期末庫存資料整理");
  });

  it("操作手冊放在主要步驟後與選檔前，並提供鍵盤可操作的收合細節", () => {
    const inventoryHtml = readFileSync("../inventory/index.html", "utf8");
    const guideIndex = inventoryHtml.indexOf('id="operation-guide"');
    const heroIndex = inventoryHtml.indexOf('class="hero"');
    const rulesIndex = inventoryHtml.indexOf('id="rules-manager"');
    const toolIndex = inventoryHtml.indexOf('class="tool-card"');
    expect(guideIndex).toBeGreaterThan(heroIndex);
    expect(guideIndex).toBeLessThan(rulesIndex);
    expect(guideIndex).toBeLessThan(toolIndex);
    expect(inventoryHtml.match(/<details class="guide-detail"/g)).toHaveLength(6);
    expect(inventoryHtml).toContain('<details class="guide-detail" open>');
    expect(inventoryHtml).toContain("第一次使用，先看 2 分鐘");
    expect(inventoryHtml).toContain("實際庫存進貨額");
    expect(inventoryHtml).toContain("工具不會比較期初與期末差異");
  });

  it("前台手冊與審閱文件都說明成功判斷、四工作表與資料安全", () => {
    const inventoryHtml = readFileSync("../inventory/index.html", "utf8");
    const manual = readFileSync("../inventory/操作手冊.md", "utf8");
    for (const text of ["列數檢查", "乾淨商品", "排除項目", "待確認項目", "分類統計", "規則服務無法使用"]) {
      expect(inventoryHtml).toContain(text);
      expect(manual).toContain(text);
    }
    expect(inventoryHtml).toContain("網站不會上傳 Excel、檔名、商品列或輸出內容");
    expect(manual).toContain("網站不會上傳 Excel、檔名、商品列資料或輸出內容");
    expect(inventoryHtml).toContain("以畫面最新清單為準");
    expect(manual).toContain("請以工具畫面當下顯示的最新清單為準");
  });

  it("手冊表格只在局部捲動，收合標題有清楚的鍵盤焦點", () => {
    const style = readFileSync("../inventory/style.css", "utf8");
    expect(style).toContain(".guide-table-wrap");
    expect(style).toMatch(/\.guide-table-wrap\s*\{[^}]*overflow-x:\s*auto/s);
    expect(style).toContain(".guide-detail summary:focus-visible");
    expect(style).toMatch(/\.guide-concepts,[\s\S]*\.guide-quick-steps ol,[\s\S]*\.guide-problems\s*\{\s*grid-template-columns:\s*1fr/s);
  });
});

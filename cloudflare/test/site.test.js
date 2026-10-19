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

  it("週調撥以新版元件讀取輸入，並保留獨立的ERP樣式輸出元件", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const version = JSON.parse(readFileSync("../store-transfer/version.json", "utf8"));
    const writerIndex = html.indexOf("xlsx-style-runtime.js");
    const readerIndex = html.indexOf("inventory/assets/xlsx.full.min.js");
    const appIndex = html.indexOf(`app.js?v=${version.version}`);
    expect(writerIndex).toBeGreaterThan(-1);
    expect(readerIndex).toBeGreaterThan(writerIndex);
    expect(appIndex).toBeGreaterThan(readerIndex);
    expect(app).toContain("const inputXlsx = globalThis.XLSX");
    expect(app).toContain("const outputXlsx = globalThis.ProcurementXlsxWriter || inputXlsx");
    expect(app).toContain("inputXlsx.read(data");
    expect(app).toContain("outputXlsx.writeFile");
  });

  it("週調撥提供重新登入與切換帳號入口，登入頁回應不會被誤判為成功", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const style = readFileSync("../store-transfer/style.css", "utf8");
    expect(html).toContain('id="account-relogin"');
    expect(html).toContain('href="/cdn-cgi/access/logout"');
    expect(html).toContain("重新登入／切換帳號");
    expect(app).toContain('response.headers.get("Content-Type")');
    expect(app).toContain("登入已失效，請重新登入或切換至本店被指派的公司帳號。");
    expect(app).toContain("accountRecovery(error)");
    expect(style).toContain(".auth-recovery");
  });

  it("週調撥與規則管理會阻擋舊版操作，且巢狀入口不快取HTML", () => {
    const transferHtml = readFileSync("../store-transfer/index.html", "utf8");
    const transferApp = readFileSync("../store-transfer/app.js", "utf8");
    const transferVersion = JSON.parse(readFileSync("../store-transfer/version.json", "utf8"));
    const rulesHtml = readFileSync("../procurement-planning/rules-admin/index.html", "utf8");
    const rulesApp = readFileSync("../procurement-planning/rules-admin/admin.js", "utf8");
    const rulesVersion = JSON.parse(readFileSync("../procurement-planning/rules-admin/version.json", "utf8"));
    const transferRulesHtml = readFileSync("../store-transfer/rules/index.html", "utf8");
    const transferRulesApp = readFileSync("../store-transfer/rules/app.js", "utf8");
    const transferRulesVersion = JSON.parse(readFileSync("../store-transfer/rules/version.json", "utf8"));
    const headers = readFileSync("../_headers", "utf8");
    expect(transferHtml).toContain('<dialog id="version-warning"');
    expect(transferApp).toContain('warning.showModal()');
    expect(transferApp).toContain('if (!warning.open)');
    expect(transferHtml).toContain(`deploy=${rulesVersion.version}`);
    expect(transferApp).toContain(`const APP_VERSION = "${transferVersion.version}"`);
    expect(transferApp).toContain("version.json?check=${Date.now()}");
    expect(transferApp).toContain('url.searchParams.set("deploy"');
    expect(rulesHtml).toContain('id="version-warning"');
    expect(rulesApp).toContain(`const APP_VERSION = "${rulesVersion.version}"`);
    expect(rulesApp).toContain("version.json?check=${Date.now()}");
    expect(rulesApp).toContain(`../../store-transfer/?deploy=${transferVersion.version}`);
    expect(transferRulesHtml).toContain('id="version-warning"');
    expect(transferRulesApp).toContain(`const APP_VERSION = "${transferRulesVersion.version}"`);
    expect(transferRulesApp).toContain("version.json?check=${Date.now()}");
    expect(transferApp).toContain('window.addEventListener("focus", checkRuntimeVersion)');
    expect(rulesApp).toContain('window.addEventListener("focus", checkRuntimeVersion)');
    expect(headers).toContain("/store-transfer/index.html\n  Cache-Control: no-store, max-age=0, must-revalidate");
    expect(headers).toContain("/procurement-planning/rules-admin/index.html\n  Cache-Control: no-store, max-age=0, must-revalidate");
    expect(headers).toContain("/store-transfer/rules/index.html\n  Cache-Control: no-store, max-age=0, must-revalidate");
  });

  it("門市上方只列待處理批次，近一個月歷史預設收合", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const style = readFileSync("../store-transfer/style.css", "utf8");
    expect(html).toContain('<details id="store-history" class="batch-history-details" hidden>');
    expect(html).not.toContain('<details id="store-history" class="batch-history-details" hidden open>');
    expect(html).toContain("近一個月歷史批次");
    expect(app).toContain('return ["open", "review"].includes(batch.status) && ["pending", "saved", "submitted"].includes(batch.store_status)');
    expect(app).toContain("timestamp >= oneMonthAgo(now)");
    expect(app).toContain('renderBatchCards(pending, "目前沒有待處理批次。")');
    expect(style).toContain(".batch-list[hidden]");
    expect(style).toContain(".batch-history-details summary:focus-visible");
  });

  it("已核准週調撥只能由總部開啟更正或退回門市，並保留版本紀錄", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const style = readFileSync("../store-transfer/style.css", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    const migration = readFileSync("../cloudflare/worker/migrations/0037_store_transfer_approved_corrections.sql", "utf8");
    expect(html).toContain("核准後需要修改");
    expect(app).toContain("開啟總部更正");
    expect(app).toContain("退回門市修改");
    expect(app).toContain("data-correction-reason");
    expect(app).toContain("corrections/open");
    expect(app).toContain("${approvedCorrectionPanel(p)}${statusOverview(p)}${itemTable(p)}");
    expect(style).toContain(".approved-correction-panel");
    expect(worker).toContain("assertHq(who.role)");
    expect(worker).toContain("此門市已產生ERP檔，不能直接退回");
    expect(worker).toContain("退回門市修改的內容尚未重新送出");
    expect(migration).toContain("CREATE TABLE store_transfer_corrections");
    expect(migration).toContain("item_snapshot");
    expect(migration).toContain("correction_revision");
  });

  it("主採購完整呈現門市未配判斷並串接到貨與補配結案", () => {
    const html = readFileSync("../procurement-planning/index.html", "utf8");
    const app = readFileSync("../procurement-planning/app.js", "utf8");
    const procurementWorker = readFileSync("../cloudflare/worker/src/procurement.ts", "utf8");
    const transferWorker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    const migration = readFileSync("../cloudflare/worker/migrations/0019_store_shortage_resolution_lifecycle.sql", "utf8");
    expect(html).toContain("尚未採購覆蓋");
    expect(html).toContain("尚待門市補配");
    expect(app).toContain("已到貨待下次調撥");
    expect(app).toContain("已補配結案");
    expect(procurementWorker).toContain("b.status = 'erp_created'");
    expect(procurementWorker).toContain("date(b.updated_at) < date(?)");
    expect(transferWorker).toContain("later_transfer_fulfilled");
    expect(migration).toContain("fulfilled_quantity");
    expect(migration).toContain("manual_cancelled");
  });

  it("主採購台帳提供可展開的ERP閉環摘要", () => {
    const html = readFileSync("../procurement-planning/index.html", "utf8");
    const app = readFileSync("../procurement-planning/app.js", "utf8");
    const style = readFileSync("../procurement-planning/style.css", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/procurement.ts", "utf8");
    expect(html).toContain("完整採購檔若出現品項、數量或價格差異");
    expect(app).toContain("查看ERP閉環摘要");
    expect(app).toContain("ERP／調整後金額");
    expect(app).toContain("累計實收");
    expect(app).toContain("剩餘未到");
    expect(style).toContain(".ledger-closure-summary");
    expect(worker).toContain("closure_summary");
    expect(worker).toContain("originalApprovedAmount");
    expect(worker).toContain("remainingQuantity");
  });

  it("主採購必要資料卡以條列說明來源、勾選與期間，並依採購時點切換銷售期間", () => {
    const html = readFileSync("../procurement-planning/index.html", "utf8");
    const app = readFileSync("../procurement-planning/app.js", "utf8");
    const style = readFileSync("../procurement-planning/style.css", "utf8");
    for (const text of [
      "貨品歷史庫存資料",
      "採購單明細列表",
      "所有調撥單明細列表",
      "POS所有銷售資料",
      "本次資料截止日往前推三個月"
    ]) expect(html).toContain(text);
    expect(html.match(/class="upload-source-details"/g)).toHaveLength(4);
    expect(app).toContain('"銷售明細（月底驗證）"');
    expect(app).toContain('"本月1號至月底，共計一個月"');
    expect(style).toContain(".upload-source-details");
  });

  it("週調撥允許門市與總部人工新增或移除品項並保留原因", () => {
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const style = readFileSync("../store-transfer/style.css", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    expect(app).toContain("人工新增品項");
    expect(app).toContain("data-remove-item");
    expect(app).toContain("恢復此品項");
    expect(app).toContain("暫存覆核");
    expect(app).toContain("/hq-save");
    expect(app).toContain("待暫存");
    expect(app).toContain("數量已調整");
    expect(app).toContain("productName: row.dataset.productName");
    expect(style).toContain(".item-human-change");
    expect(style).toContain(".item-warning");
    expect(worker).toContain("門市人工新增");
    expect(worker).toContain("總部人工新增");
    expect(worker).toContain("hq_review_saved");
    expect(worker).toContain("hq-save");
    expect(worker).toContain("移除品項請使用移除按鈕");
    expect(worker).toContain("confirmed !== original.current || reason !== original.reason");
    expect(worker).toContain("approved !== original.previousApproved || reason !== original.previousReason");
  });

  it("人工新增品號會沿用批次快照顯示可售至並傳遞到總部覆核", () => {
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const core = readFileSync("../store-transfer/core.js", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    const migration = readFileSync("../cloudflare/worker/migrations/0033_store_transfer_manual_item_facts.sql", "utf8");
    const supplyMigration = readFileSync("../cloudflare/worker/migrations/0035_store_transfer_supply_snapshots.sql", "utf8");
    expect(app).toContain("data-manual-projection");
    expect(app).toContain("manual-item-fact");
    expect(app).toContain("申請後預估可售至");
    expect(app).toContain("refreshDialogQuantityWarnings");
    expect(app).toContain("系統未建議追加量");
    expect(app).toContain("quantityProjectionText(row, quantity)");
    expect(app).toContain('const stage = state.config.role === "store" ? "人工申請" : "總部核准"');
    expect(app).toContain("${stage}${quantity}件後，預估可售至");
    expect(app).toContain("受本輪供應條件限制，系統未建議追加");
    expect(app).toContain("無法以目前數量送出");
    expect(worker).toContain("storeFacingReason");
    expect(worker).toContain("無法以目前申請量送出");
    expect(app).toContain("hqSupplyCeiling");
    expect(app).toContain("系統未建議原因");
    expect(app).toContain("data-manual-system-reason");
    expect(app).toContain("舊批次未保存銷售基準，請重新建立批次");
    expect(core).toContain("manualItemFacts");
    expect(core).toContain("總倉不足，部分供應");
    expect(worker).toContain("store_transfer_manual_item_facts");
    expect(worker).toContain("store_transfer_batch_product_catalog");
    expect(worker).toContain("system_reason");
    expect(worker).toContain("supplyUsage");
    expect(worker).toContain("總倉本批可供應");
    expect(worker).toContain("沿用批次建立時的庫存與近42天銷售基準");
    expect(migration).toContain("PRIMARY KEY (batch_id, store_code, sku)");
    expect(migration).toContain("PRIMARY KEY (batch_id, sku)");
    expect(migration).toContain("ADD COLUMN system_reason");
    expect(migration).not.toMatch(/excel|file_name|raw_rows|transaction/i);
    expect(supplyMigration).toContain("ADD COLUMN hq_available");
    expect(supplyMigration).toContain("ADD COLUMN hq_reserve");
    expect(supplyMigration).toContain("ADD COLUMN hq_releasable");
  });

  it("採購核准與週調撥總部協作使用獨立權限名單", () => {
    const html = readFileSync("../procurement-planning/rules-admin/index.html", "utf8");
    const admin = readFileSync("../procurement-planning/rules-admin/admin.js", "utf8");
    const procurementWorker = readFileSync("../cloudflare/worker/src/procurement.ts", "utf8");
    const transferWorker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    const migration = readFileSync("../cloudflare/worker/migrations/0023_store_transfer_hq_access.sql", "utf8");
    expect(html).toContain("週調撥總部協作帳號");
    expect(html).toContain('id="store-transfer-hq-emails"');
    expect(admin).toContain("storeTransferHqEmails");
    expect(procurementWorker).toContain("store_transfer_hq_emails");
    expect(transferWorker).toContain("SELECT store_transfer_hq_emails FROM procurement_settings");
    expect(transferWorker).not.toContain("const HQ_EMAILS");
    expect(migration).toContain('"service1@siangapato.com.tw","sc00@siangapato.com.tw"');
    expect(migration).toContain('approver_emails = \'["mcpheeyin@siangapato.com.tw","elerin@siangapato.com.tw"]\'');
  });

  it("同週新版批次會取代舊的未完成批次並保留唯讀紀錄", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    expect(html).toContain("同週批次版本");
    expect(app).toContain("已取代・僅供查閱");
    expect(app).toContain("本批次已被新版取代");
    expect(worker).toContain("已由新版批次${id}取代，僅供查閱");
    expect(worker).toContain("status = 'cancelled'");
    expect(worker).toContain("status IN ('open', 'review')");
    expect(worker).toContain("'cancelled', ?, ?, ? FROM store_transfer_batches");
    expect(worker).not.toContain("'superseded'");
  });

  it("總部可刪除等待門市且尚未核准的批次，並保留12個月稽核", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    const migration = readFileSync("../cloudflare/worker/migrations/0015_store_transfer_batch_soft_delete.sql", "utf8");
    expect(html).toContain("刪除批次");
    expect(app).toContain("data-delete-batch");
    expect(app).toContain("刪除待確認批次");
    expect(app).toContain("稽核資料會保留12個月");
    expect(worker).toContain("canDeleteBatch");
    expect(worker).toContain('status === "open" && Number(batch.approved_store_count || 0) === 0');
    expect(worker).toContain("仍在等待門市且尚無任何門市核准");
    expect(worker).toContain("s.status = 'approved'");
    expect(worker).toContain("request.method === \"DELETE\"");
    expect(worker).toContain("deleted_at IS NULL");
    expect(migration).toContain("ADD COLUMN deleted_at");
  });

  it("總部可在建議預覽與批次詳細資料切換單一門市", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const style = readFileSync("../store-transfer/style.css", "utf8");
    expect(html).toContain('id="calculation-store-filter"');
    expect(app).toContain('storeFilterBar("calculation"');
    expect(app).toContain('storeFilterBar("batch"');
    expect(app).toContain('data-store-filter-scope="batch"');
    expect(app).toContain('data-store-row');
    expect(style).toContain('.store-filter-button.is-active');
    expect(style).toContain('[data-store-row][hidden]');
  });

  it("總部可用品號搜尋建議與批次分配並彙總門市及件數", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const style = readFileSync("../store-transfer/style.css", "utf8");
    expect(html).toContain('id="calculation-sku-filter"');
    expect(app).toContain('data-sku-filter-scope="${scope}"');
    expect(app).toContain('data-allocation-row');
    expect(app).toContain("分配${stores.size}間門市");
    expect(app).toContain('skuFilterBar("batch"');
    expect(app).toContain('if (state.config.role === "store") return ""');
    expect(style).toContain(".sku-search-toolbar");
  });

  it("週調撥決策欄位精簡且判斷依據預設收合，窄螢幕改為單品卡片", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const style = readFileSync("../store-transfer/style.css", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    const migration = readFileSync("../cloudflare/worker/migrations/0034_store_transfer_decision_snapshots.sql", "utf8");
    expect(html).toContain("摘要先顯示需要決策的欄位");
    expect(html).toContain("decision-summary-table");
    expect(app).toContain('aria-expanded="false" aria-label="展開判斷依據"');
    expect(app).toContain('button.textContent = open ? "−" : "+"');
    expect(app).toContain('class="decision-toggle-cell" data-label="判斷依據"');
    expect(app).toContain("data-decision-detail hidden");
    expect(app).toContain("toggleDecisionDetail");
    expect(app).toContain("decisionSnapshot");
    expect(app).toContain("舊批次未保存完整判斷明細");
    expect(style).toContain(".decision-evidence-grid");
    expect(style).toContain(".workflow-table { min-width: 0; table-layout: fixed; }");
    expect(style).toContain(".workflow-table tr:not(.decision-detail-row)");
    expect(style).toContain(".decision-warning-row");
    expect(style).toContain("overflow-wrap: anywhere");
    expect(style).toContain(".workflow-col-item { width: 18%; }");
    expect(style).toContain("textarea.reason-input");
    expect(app).toContain("workflowColgroup");
    expect(app).toContain("autoSizeReasonField");
    expect(app).toContain("<textarea data-reason");
    expect(app).toContain("<textarea data-hq-reason");
    expect(worker).toContain("decision_snapshot");
    expect(migration).toContain("ADD COLUMN decision_snapshot");
    const inventoryEvidenceMigration = readFileSync("../cloudflare/worker/migrations/0041_store_transfer_manual_inventory_evidence.sql", "utf8");
    expect(inventoryEvidenceMigration).toContain("physical_inventory");
    expect(inventoryEvidenceMigration).toContain("pending_submitted_quantity");
    expect(inventoryEvidenceMigration).toContain("in_transit_quantity");
    expect(worker).toContain("manualFactDecisionSnapshot");
    expect(app).toContain("inventoryEvidenceVersion");
  });

  it("周調撥適用與排除規則有獨立入口，並與展示最低庫存通用規則分開", () => {
    const transferHtml = readFileSync("../store-transfer/index.html", "utf8");
    const rulesHtml = readFileSync("../store-transfer/rules/index.html", "utf8");
    const rulesApp = readFileSync("../store-transfer/rules/app.js", "utf8");
    const generalHtml = readFileSync("../procurement-planning/rules-admin/index.html", "utf8");
    expect(transferHtml).toContain('id="transfer-rules-link"');
    expect(rulesHtml).toContain("周調撥適用／排除規則");
    expect(rulesHtml).toContain("ERP品號硬性排除永遠最優先");
    expect(rulesHtml).toContain('id="match-type"');
    expect(rulesHtml).toContain('id="schedule-mode"');
    expect(rulesApp).toContain('api("/applicability-rules"');
    expect(generalHtml).toContain("本頁只管理展示與最低庫存通用規則");
    expect(generalHtml).not.toContain('id="transfer-exclusion-sku"');
  });

  it("週調撥提供正式與A/B模式，且A/B模式不能發布批次", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    expect(html).toContain('name="calculation-mode" value="formal" checked');
    expect(html).toContain('name="calculation-mode" value="comparison"');
    expect(html).toContain('id="pending-transfer-results"');
    expect(app).toContain('state.calculation.calculationMode === "comparison"');
    expect(app).toContain("A/B測試比對只能預覽");
    expect(app).toContain('if (mode === "formal") await api("/consumable-snapshots"');
  });

  it("A/B模式可依本次選取門市分別下載差異分析表", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const core = readFileSync("../store-transfer/core.js", "utf8");
    expect(html).toContain('id="comparison-downloads"');
    expect(html).toContain('id="comparison-download-buttons"');
    expect(app).toContain('data-download-comparison');
    expect(app).toContain('buildComparisonWorkbook');
    expect(core).toContain('XLSX.utils.book_append_sheet(workbook, worksheet, section)');
    expect(core).toContain('三個比較區塊分頁顯示');
    expect(core).toContain('buildComparisonReport');
  });

  it("正式補貨可勾選門市並各自下載三頁籤報表", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    expect(html).toContain('id="formal-downloads"');
    expect(html).toContain('id="formal-download-options"');
    expect(html).toContain('id="download-formal-reports"');
    expect(app).toContain('buildFormalWorkbook');
    expect(app).toContain('正式補貨建議.xlsx');
  });

  it("正式批次以精簡欄位送出，後端用JSON批次展開大量品項", () => {
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    expect(app).toContain('compactBatchItems(state.calculation.rows)');
    expect(app).toContain('compactBatchShortages(state.calculation.shortageRows)');
    expect(worker).toContain('readBody(request, 10_000_000)');
    expect(worker).toContain("FROM json_each(?2)");
    expect(worker).toContain('chunks(normalizedShortages)');
  });

  it("門市送出與總部核准以集合式SQL處理大量明細", () => {
    const worker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    expect(worker).toContain("const existingUpdates: Record<string, unknown>[] = []");
    expect(worker).toContain("UPDATE store_transfer_items SET\n      store_confirmed_quantity = (SELECT json_extract(p.value, '$.confirmed') FROM json_each(?1)");
    expect(worker).toContain("UPDATE store_transfer_items SET\n      hq_approved_quantity = (SELECT json_extract(p.value, '$.approved') FROM json_each(?1)");
    expect(worker).toContain("FROM store_transfer_shortages WHERE batch_id = ? ON CONFLICT(store_code, sku) DO UPDATE");
    expect(worker).not.toContain("const bridge = approvedShortages.results.flatMap");
  });

  it("正式批次建立後逐店寄送可重試且防重複的門市通知", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    const migration = readFileSync("../cloudflare/worker/migrations/0032_store_transfer_notifications.sql", "utf8");
    expect(html).toContain("建立批次後通知");
    expect(app).toContain("data-send-batch-notifications");
    expect(app).toContain("X-Google-Access-Token");
    expect(app).toContain("await sendBatchNotifications(id, false)");
    expect(worker).toContain("store_transfer_notifications");
    expect(worker).toContain("status != 'sent'");
    expect(worker).toContain("gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(worker).toContain("Google授權帳號必須與目前公司登入帳號相同");
    expect(migration).toContain("UNIQUE (batch_id, store_code)");
    expect(migration).not.toMatch(/excel|file_name|raw_rows/i);
  });

  it("A/B差異分析把三個比較區塊分成獨立頁籤", () => {
    const transferContext = loadBrowserScript("../store-transfer/core.js", { XLSX });
    const transferCore = transferContext.StoreTransferCore;
    const calculation = {
      calculationMode: "comparison", proposalDate: "2026-09-29", latestSalesDate: "2026-09-24",
      pendingTransferRows: [
        { storeCode: "R00", status: "提交", sku: "BOTH", quantity: 1, documentCode: "T1" },
        { storeCode: "R00", status: "提交", sku: "ONLY-B", quantity: 2, documentCode: "T2" }
      ],
      comparisonFacts: [
        { storeCode: "R00", sku: "BOTH", productName: "共同品項", suggestedQuantity: 2, physicalInventory: 1, hqInventory: 5, displayQuantity: 0, inTransitQuantity: 0, localSales42: 2, dailySales: 1, baseSellableQuantity: 1, calculationDate: "2026-09-24", systemSellThroughDate: "2026-09-27", itemType: "regular" },
        { storeCode: "R00", sku: "ONLY-A", productName: "系統品項", suggestedQuantity: 1, physicalInventory: 0, hqInventory: 5, displayQuantity: 0, inTransitQuantity: 0, localSales42: 1, dailySales: 1, baseSellableQuantity: 0, calculationDate: "2026-09-24", systemSellThroughDate: "2026-09-25", itemType: "regular" },
        { storeCode: "R00", sku: "ONLY-B", productName: "人工品項", suggestedQuantity: 0, physicalInventory: 1, hqInventory: 5, displayQuantity: 0, inTransitQuantity: 0, localSales42: 0, dailySales: 0, baseSellableQuantity: 1, calculationDate: "2026-09-24", systemSellThroughDate: "近期無現場銷售", itemType: "regular" }
      ]
    };
    const workbook = transferCore.buildComparisonWorkbook(calculation, XLSX, "R00", "台北中山門市");
    expect(workbook.SheetNames).toEqual(["A、B都有", "僅A", "僅B"]);
    for (const sheetName of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true });
      expect(rows[9][0]).toContain(sheetName);
      expect(rows[10]).toEqual(expect.arrayContaining(["ERP品號", "系統建議量(A)", "人工調撥量(B)"]));
    }
    expect(workbook.Sheets["A、B都有"].K12.f).toBe("J12-I12");
  });

  it("正式補貨報表分列建議、缺貨未配及待發貨與在途", () => {
    const transferContext = loadBrowserScript("../store-transfer/core.js", { XLSX });
    const workbook = transferContext.StoreTransferCore.buildFormalWorkbook({
      calculationMode: "formal", proposalDate: "2026-10-12", latestSalesDate: "2026-10-12",
      rows: [{ storeCode: "R00", itemType: "regular", sku: "A001", productName: "測試品", physicalInventory: 0, pendingSubmittedQuantity: 1, inTransitQuantity: 2, localSales42: 4, targetQuantity: 5, displayQuantity: 1, suggestedQuantity: 2, currentArrivalDate: "2026-10-14", nextArrivalDate: "2026-10-21", systemSellThroughDate: "2026-10-20", ruleSummary: "測試判斷" }],
      shortageRows: [{ storeCode: "R00", itemType: "regular", sku: "B001", productName: "缺貨品", demandQuantity: 3, allocatedQuantity: 1, unfilledQuantity: 2, currentArrivalDate: "2026-10-14", nextArrivalDate: "2026-10-21", reason: "總倉不足", followUpStatus: "待回拋主採購" }],
      pendingTransferRows: [{ storeCode: "R00", sku: "A001", productName: "測試品", documentCode: "AT001", status: "提交", quantity: 1, openedDate: "2026-10-12", shippedDate: "", includedInCalculation: true }]
    }, XLSX, "R00", "台北中山門市");
    expect(workbook.SheetNames).toEqual(["本次調撥建議", "缺貨未配", "待發貨與在途"]);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets["本次調撥建議"], { header: 1, raw: true })[5]).toEqual(expect.arrayContaining(["A001", 1, 2, "測試判斷"]));
    expect(XLSX.utils.sheet_to_json(workbook.Sheets["缺貨未配"], { header: 1, raw: true })[5]).toEqual(expect.arrayContaining(["B001", 2, "總倉不足"]));
    expect(XLSX.utils.sheet_to_json(workbook.Sheets["待發貨與在途"], { header: 1, raw: true })[5]).toEqual(expect.arrayContaining(["AT001", "提交", "已納入抵扣"]));
  });

  it("A/B差異可發布共用協作批次，且僅兩個指定帳號可轉正式", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    const migration = readFileSync("../cloudflare/worker/migrations/0025_store_transfer_collaboration_drafts.sql", "utf8");
    expect(html).toContain('id="publish-collaboration-button"');
    expect(html).toContain('id="collaboration-dialog"');
    expect(app).toContain('/collaboration-drafts');
    expect(app).toContain('collaborationRevision');
    expect(app).toContain('expectedRevision');
    expect(worker).toContain('const COLLABORATION_FINALIZERS = new Set([ADMIN, "service1@siangapato.com.tw"])');
    expect(worker).toContain('assertCollaborationFinalizer(who.email)');
    expect(worker).toContain('canFinalizeCollaboration');
    expect(worker).toContain('已由其他同事更新');
    expect(migration).toContain('store_transfer_collaboration_one_active_week');
    expect(migration).toContain('source_collaboration_id');
    expect(migration).toContain('store_transfer_batches_source_collaboration');
  });

  it("尚未轉正式的A/B協作批次可安全刪除並保留12個月稽核", () => {
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    const migration = readFileSync("../cloudflare/worker/migrations/0036_store_transfer_removable_pending_batches.sql", "utf8");
    expect(app).toContain("data-delete-collaboration");
    expect(app).toContain("已轉正式的批次不能刪除");
    expect(worker).toContain("deleteCollaborationDraft");
    expect(worker).toContain("已轉為正式批次的A/B協作紀錄不能刪除");
    expect(worker).toContain('request.method === "DELETE"');
    expect(worker).toContain("removed_at IS NULL");
    expect(migration).toContain("ADD COLUMN removed_at");
    expect(migration).toContain("status = 'draft' AND removed_at IS NULL");
  });

  it("門市有獨立展示例外頁，且只能維護自己的精準ERP品號", () => {
    const html = readFileSync("../store-transfer/index.html", "utf8");
    const app = readFileSync("../store-transfer/app.js", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    const migration = readFileSync("../cloudflare/worker/migrations/0028_store_display_exceptions.sql", "utf8");
    expect(html).toContain('id="show-display-exceptions"');
    expect(html).toContain('id="display-exceptions-panel"');
    expect(html).toContain('id="display-exception-dialog"');
    expect(app).toContain('#display-exceptions');
    expect(app).toContain('/display-exceptions/');
    expect(app).toContain('storeDisplayExceptions: state.config.displayExceptions');
    expect(worker).toContain('who.role !== "store"');
    expect(worker).toContain('不可查看其它門市資料');
    expect(worker).toContain('不要以逗號串接');
    expect(migration).toContain('CREATE TABLE store_transfer_display_exceptions');
    expect(migration).toContain('CREATE TABLE store_transfer_display_exception_events');
    expect(migration).not.toMatch(/file_name|excel|raw_rows/i);
  });

  it("總部門市規則支援精準ERP品號並在儲存時依優先序排序", () => {
    const html = readFileSync("../procurement-planning/rules-admin/index.html", "utf8");
    const admin = readFileSync("../procurement-planning/rules-admin/admin.js", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/procurement.ts", "utf8");
    expect(html).toContain('ERP品號（精準）');
    expect(html).toContain('N00126,N00127');
    expect(admin).toContain('item.exactSkus');
    expect(admin).toContain('rules.sort');
    expect(worker).toContain('rule.exactSkus');
  });

  it("總部可在獨立頁以精準品號或品名關鍵字維護周調撥規則", () => {
    const html = readFileSync("../store-transfer/rules/index.html", "utf8");
    const admin = readFileSync("../store-transfer/rules/app.js", "utf8");
    const worker = readFileSync("../cloudflare/worker/src/procurement.ts", "utf8");
    const transferWorker = readFileSync("../cloudflare/worker/src/store-transfer.ts", "utf8");
    const core = readFileSync("../store-transfer/core.js", "utf8");
    expect(html).toContain('id="rule-sku"');
    expect(html).toContain('id="rule-keywords"');
    expect(html).toContain("商品品名（自動帶入）");
    expect(admin).toContain("loadLatestProductMaster");
    expect(admin).toContain("parseProductMasterWorkbook");
    expect(admin).toContain("drive.readonly");
    expect(admin).toContain("state.exclusions.unshift");
    expect(worker).toContain("storeInventory.transferExclusions");
    expect(worker).toContain("storeInventory.applicabilityRules");
    expect(transferWorker).toContain("saveTransferApplicabilityRules");
    expect(core).toContain("isTransferExcluded");
    expect(core).toContain("transferApplicabilityDecision");
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

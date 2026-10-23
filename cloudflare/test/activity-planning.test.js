import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const context = { console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Blob, URL, setTimeout, clearTimeout };
context.globalThis = context;
vm.createContext(context);
for (const path of ["../procurement-planning/assets/xlsx-js-style.bundle.js", "../procurement-planning/xlsx-style-runtime.js", "../inventory/assets/xlsx.full.min.js", "../procurement-planning/core.js", "../store-transfer/core.js", "../procurement-planning/activity-planning.js"]) vm.runInContext(readFileSync(path, "utf8"), context, { filename: path });
const { XLSX, ProcurementXlsxWriter: writer, ProcurementPlanningCore: core, ProcurementActivityPlanning: activity } = context;
function workbook(rows, name = "工作表1") { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name); return book; }
function roundtrip(book) { return XLSX.read(writer.write(book, { type: "array", bookType: "xlsx", compression: true }), core.ACTIVITY_HISTORY_READ_OPTIONS); }
function source() {
  const master = core.parseProductMasterWorkbook(roundtrip(workbook([
    ["貨號", "品名", "供應商貨號", "供應商簡稱", "進貨價", "最小配貨數", "貨品狀態", "已下架"],
    ["A1", "長絨棉5尺床包", "V1", "普優瑪", 100, 20, "尚可追加", "否"],
    ["A2", "羽絨被", "V2", "潤泰羽絨", 100, 1, "尚可追加", "否"],
    ["A3", "長絨棉枕套(S)", "V3", "普優瑪", 100, 1, "尚可追加", "否"]
  ])), XLSX);
  const inventory = core.parseInventoryWorkbook(roundtrip(workbook([
    ["店倉編號", "店倉名稱", "貨號", "品名", "實際庫存", "實際庫存成本額"],
    ["T00", "總部", "A1", "床包", 0, 0], ["R00", "門市", "A1", "床包", 0, 0],
    ["T00", "總部", "A2", "羽絨被", 0, 0], ["T00", "總部", "A3", "枕套", 0, 0]
  ])), XLSX);
  const consignment = core.parseConsignmentWorkbook(roundtrip(workbook([
    ["普優瑪系統", "產品編號", "編號", "貼標名稱", "商品名稱", "規格", "布用量", "配布用量", "成品價", "最新庫存08/20", "預計入庫"],
    ["", "V1", "A1", "", "長絨棉5尺床包", "", "", "", 100, 1000, 0],
    ["", "V3", "A3", "", "長絨棉枕套(S)", "", "", "", 100, 3, 0]
  ], "庫存+下單")), XLSX);
  const raw = [["銷別", "結帳時間", "貨號", "品名", "銷售量", "實收金額", "開單倉編號", "電商平台", "POS單"]];
  for (let d = "2024-01-01"; d <= "2026-10-23"; d = activity.add(d, 1)) {
    const peak = d.slice(5) >= "11-07" && d.slice(5) <= "11-11" ? 4 : 1;
    for (const sku of ["A1", "A2", "A3"]) {
      raw.push(["銷貨", `${d} 12:00:00`, sku, sku, peak * 2, peak * 200, "T00", "官網", `${d}-${sku}-T`]);
      raw.push(["訂貨", `${d} 13:00:00`, sku, sku, peak, peak * 100, "R00", "", `${d}-${sku}-R`]);
    }
  }
  const sales = core.parseSalesWorkbook(roundtrip(workbook(raw)), XLSX);
  const recent = { ...sales, records: sales.records.filter(r => r.date >= "2026-08-01"), minDate: "2026-08-01" };
  const builder = activity.createHistoryBuilder(); builder.ingest(sales, { id: "synthetic", modifiedTime: "2026-10-23" }); builder.ingest(recent);
  return { master, inventory, consignment, pendingReports: [], transferReports: [], salesReports: [recent], asOfDate: "2026-10-23", orderDate: "2026-10-23", analysisMonth: "2026-10", checkpoint: "mid-month", revenueChannels: [], blacklist: [], activityHistory: builder.finalize(), activityDemand: { enabled: true, method: "monthly-target", name: "合成雙11", startDate: "2026-11-11", endDate: "2026-11-15", scope: "all", monthlyTargets: { "2026-11": { amount: 40000 } } } };
}
const fixture = source();
const run = extra => core.buildProcurementRecommendations({ ...fixture, ...extra });

describe("跨月活動備貨與供貨", () => {
  it("未啟用活動時完全沿用既有計算，歷史缺漏不影響一般流程", () => {
    const ordinary = run({ activityDemand: { enabled: false }, activityHistory: null });
    const unchanged = run({ activityDemand: { ...fixture.activityDemand, enabled: false }, activityHistory: null });
    expect(unchanged.rows).toEqual(ordinary.rows);
    expect(unchanged.totals).toEqual(ordinary.totals);
  });
  it("10月可提前採購11月需求，不改分析月份或原日需求", () => {
    const ordinary = run({ activityDemand: { enabled: false } });
    const result = run();
    expect(result.rows.find(r => r.sku === "A1").activityPlanning.grossNeed).toBeGreaterThan(0);
    expect(result.rows.find(r => r.sku === "A1").forecastDailyQty).toBe(ordinary.rows.find(r => r.sku === "A1").forecastDailyQty);
    expect(result.appliedRules.activityDemand.monthlyTargets["2026-11"].amount).toBe(40000);
    expect(fixture.analysisMonth).toBe("2026-10");
    expect(result.rows.find(r => r.sku === "A1").activityDemandMultiplier).toBeNull();
  });
  it("各月分配守恆；跨月與跨年不能漏月份目標", () => {
    const settings = { ...fixture.activityDemand, startDate: "2026-11-28", endDate: "2026-12-03" };
    expect(() => run({ activityDemand: settings })).toThrow("2026-12");
    const result = run({ activityDemand: { ...settings, monthlyTargets: { "2026-11": 40000, "2026-12": 60000 } } });
    for (const row of result.appliedRules.activityDemand.monthlyForecasts) expect(row.channels.reduce((s, c) => s + c.target, 0)).toBeCloseTo(row.target, 8);
    const year = { ...fixture.activityDemand, startDate: "2026-12-30", endDate: "2027-01-03", monthlyTargets: { "2026-12": 40000, "2027-01": 60000 } };
    expect(run({ activityDemand: year }).appliedRules.activityDemand.months).toEqual(["2026-12", "2027-01"]);
  });
  it("整月日期分布合計為1，活動集中度不增加第二份整月需求", () => {
    const index = activity.buildIndex(fixture.activityHistory, [], fixture.asOfDate);
    const settings = activity.normalize(fixture.activityDemand, fixture.asOfDate);
    for (const online of [true, false]) {
      const shape = activity.distribution(index.channel.get(online ? "kc_web" : "R00"), "2026-11", settings, online, fixture.asOfDate, index.covered);
      expect(shape.weights.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
      expect(shape.weights[10]).toBeGreaterThan(shape.weights[0]);
      expect(shape.source).toContain(online ? "活動週期" : "活動區間");
    }
  });
  it("回測與需求不讀取截止日之後的交易", () => {
    const polluted = { ...fixture.activityHistory, cells: [...fixture.activityHistory.cells, ["2026-11-11", "kc_web", "A1", 1e8, 1e10]] };
    const original = run(), result = run({ activityHistory: polluted });
    expect(result.rows.map(r => r.suggestedPurchaseQty)).toEqual(original.rows.map(r => r.suggestedPurchaseQty));
    expect(result.appliedRules.activityDemand.monthlyForecasts).toEqual(original.appliedRules.activityDemand.monthlyForecasts);
    expect(result.appliedRules.activityDemand.monthlyForecasts[0].channels.every(r => r.samples >= 3)).toBe(true);
  });
  it("缺歷史、無效數字、結束日與超長期間均阻擋", () => {
    expect(() => run({ activityHistory: null })).toThrow("歷史銷售彙總");
    for (const amount of [0, -1, NaN, Infinity, "wrong"]) expect(() => run({ activityDemand: { ...fixture.activityDemand, monthlyTargets: { "2026-11": amount } } })).toThrow("整月營收目標");
    expect(() => run({ activityDemand: { ...fixture.activityDemand, endDate: "2026-11-01" } })).toThrow("結束日");
    expect(() => run({ activityDemand: { ...fixture.activityDemand, endDate: "2028-11-15" } })).toThrow("366");
  });
  it("未到貨晚於需要日與缺到貨日不抵活動前缺口，重匯不重複扣抵", () => {
    const pending = { records: [{ sku: "A1", supplier: "普優瑪", documentCode: "P1", quantity: 500, amount: 50000, expectedDeliveryDate: "2026-11-20", purchaseDate: "2026-10-01", name: "床包", sourceRow: 2 }] };
    const result = run({ pendingReports: [pending, pending] });
    const row = result.rows.find(r => r.sku === "A1");
    expect(row.pendingQty).toBe(500);
    expect(row.activityPlanning.pendingTimelyQty).toBe(0);
    expect(row.activityPlanning.pendingExcludedQty).toBe(500);
    const timely = run({ pendingReports: [{ records: [{ ...pending.records[0], expectedDeliveryDate: "2026-10-28" }] }] }).rows.find(r => r.sku === "A1");
    expect(timely.activityPlanning.pendingTimelyQty).toBe(500);
    expect(timely.activityPlanning.netNeed).toBeLessThan(row.activityPlanning.netNeed);
  });
  it("寄庫占用扣除、不將排程當現貨，失效來源不產生可拉量", () => {
    const result = run({ reservedConsignmentBySku: new Map([["A1", 980]]) });
    expect(result.rows.find(r => r.sku === "A1").activityPlanning.availableConsignment).toBe(20);
    const unavailable = run({ consignment: { records: [], dataAvailable: false, unavailable: true, exceptions: [], confirmedExclusions: [], styleAudit: {} } });
    const row = unavailable.rows.find(r => r.sku === "A1");
    expect(row.activityPlanning.pullQty).toBeNull();
    expect(row.activityPlanning.shortage).toBeNull();
    expect(row.activityPlanning.status).toBe("寄庫資料未驗證");
  });
  it("寄庫製作與國外交期趕不及時保留缺口，S品不新增生產", () => {
    const result = run();
    const abroad = result.rows.find(r => r.sku === "A2");
    expect(abroad.activityPlanning.shortage).toBeGreaterThan(0);
    expect(abroad.activityPlanning.expectedArrival > abroad.activityPlanning.hqDeadline).toBe(true);
    const stop = result.rows.find(r => r.sku === "A3");
    expect(stop.suggestedConsignmentQty).toBe(0);
    expect(stop.suggestedPurchaseQty).toBeLessThanOrEqual(3);
    const store = result.rows.find(r => r.sku === "A1").activityPlanning;
    expect(store.hqDeadline <= store.readyBy).toBe(true);
    expect(Object.values(store.storeReadyDates).every(d => d <= store.readyBy)).toBe(true);
  });
  it("當月目標先扣已實現營收；活動在更遠月份也包含中間月份正常消耗", () => {
    const lowGoal = run({ activityDemand: { ...fixture.activityDemand, startDate: "2026-10-25", endDate: "2026-10-29", monthlyTargets: { "2026-10": 1 } } });
    expect(lowGoal.rows.find(r => r.sku === "A1").activityPlanning.monthlyDetails.every(d => d.monthlyQty === 0)).toBe(true);
    const future = run({ activityDemand: { ...fixture.activityDemand, startDate: "2026-12-11", endDate: "2026-12-15", monthlyTargets: { "2026-12": 40000 } } });
    const details = future.rows.find(r => r.sku === "A1").activityPlanning.monthlyDetails;
    expect(details.some(d => d.month === "2026-11" && d.monthlyQty > 0)).toBe(true);
  });
  it("反推最晚下單日包含公司休假延後", () => {
    const rules = { workdayHolidays: ["2026-11-05", "2026-11-06"] };
    const last = activity.latestOrderDate("2026-11-10", 5, rules);
    expect(core.holidayCoverageAdjustment(last, 5, rules).adjustedDate <= "2026-11-10").toBe(true);
    expect(core.holidayCoverageAdjustment(activity.add(last, 1), 5, rules).adjustedDate > "2026-11-10").toBe(true);
  });
  it("實收單價變化明列校正，既有調撥無到店日不承諾可備妥", () => {
    const history = { ...fixture.activityHistory, cells: fixture.activityHistory.cells.map(c => c[0] >= "2026-08-01" ? [...c.slice(0, 4), c[4] * 2] : c) };
    const row = run({ activityHistory: history }).rows.find(r => r.sku === "A1");
    expect(row.activityPlanning.monthlyDetails.some(d => d.recentUnitPrice > d.modelUnitPrice && d.priceAdjustment < 1)).toBe(true);
    const transfer = { records: [{ sku: "A1", documentCode: "T-SYNTHETIC", status: "提交", sourceWarehouseCode: "T00", destinationWarehouseCode: "R00", quantity: 2, openedDate: "2026-10-22" }] };
    const pending = run({ transferReports: [transfer] }).rows.find(r => r.sku === "A1");
    expect(pending.activityPlanning.status).toBe("既有調撥到店日待確認");
    expect(pending.activityPlanning.shortage).toBeNull();
  });
  it("指定範圍外維持原建議，數量與金額合計守恆", () => {
    const ordinary = run({ activityDemand: { enabled: false } });
    const result = run({ activityDemand: { ...fixture.activityDemand, scope: "supplier-runtai" } });
    expect(result.rows.find(r => r.sku === "A1").suggestedPurchaseQty).toBe(ordinary.rows.find(r => r.sku === "A1").suggestedPurchaseQty);
    expect(result.suggestedRows.reduce((s, r) => s + r.suggestedPurchaseQty, 0)).toBe(result.totals.suggestedPurchaseQty);
    expect(result.suggestedRows.reduce((s, r) => s + r.suggestedPurchaseQty * r.unitCost, 0)).toBe(result.totals.suggestedPurchaseAmount);
  });
  it("及時供貨品項人工歸零會新增缺口，二次覆核仍保留同一缺口", () => {
    const result = run();
    const original = result.rows.find(r => r.sku === "A1");
    expect(original.activityPlanning.shortage).toBe(0);
    const report = core.buildRecommendationWorkbook(result, writer, { selectedSuppliers: [original.supplier] });
    for (const name of report.SheetNames.filter(name => /^03/.test(name))) {
      const sheet = report.Sheets[name], data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      const h = data.findIndex(r => r.includes("ERP品號")); if (h < 0) continue;
      const index = data.findIndex((r, i) => i > h && r[data[h].indexOf("ERP品號")] === "A1"); if (index < 0) continue;
      sheet[XLSX.utils.encode_cell({ r: index, c: data[h].indexOf("人工確認採購量") })] = { t: "n", v: 0 };
      sheet[XLSX.utils.encode_cell({ r: index, c: data[h].indexOf("人工調整原因類別") })] = { t: "s", v: "本次不採購" };
    }
    const first = core.reviewReturnedWorkbook(roundtrip(report), XLSX, { baselineBySku: new Map(result.rows.map(r => [r.sku, r])) });
    expect(first.errors).toEqual([]);
    expect(first.rows.find(r => r.sku === "A1").activityPlanning.approvedShortage).toBe(original.activityPlanning.netNeed);
    const second = core.reviewSecondApprovalWorkbook(roundtrip(core.buildSecondReviewWorkbook(first, writer)), XLSX, { baselineBySku: new Map(first.rows.map(r => [r.sku, r])) });
    expect(second.errors).toEqual([]);
    const reviewHeaders = XLSX.utils.sheet_to_json(roundtrip(core.buildSecondReviewWorkbook(first, writer)).Sheets["02_覆核與異動確認"], { header: 1 })[0];
    expect(reviewHeaders).toContain("活動前仍缺（覆核後）");
    expect(reviewHeaders).not.toContain("活動總部需用日");
    expect(reviewHeaders).not.toContain("活動備貨提醒");
    expect(second.rows.find(r => r.sku === "A1").activityPlanning.approvedShortage).toBe(original.activityPlanning.netNeed);
  });
  it("歷史重疊保留同列出現次數且去重，矛盾版本阻擋，不保存個資", () => {
    const row = { saleType: "銷貨", date: "2025-11-11", transactionTimestamp: "2025-11-11 10:00", sku: "A1", quantity: 2, actualAmount: 200, posOrder: "PRIVATE-ORDER", warehouseCode: "T00", ecommercePlatform: "官網", customerName: "PRIVATE-NAME" };
    const builder = activity.createHistoryBuilder();
    const report = { records: [row, row], minDate: row.date, maxDate: row.date };
    builder.ingest(report); builder.ingest(report);
    expect(builder.finalize().cells[0][3]).toBe(4);
    expect(builder.finalize().duplicateRows).toBe(2);
    expect(JSON.stringify(builder.finalize())).not.toMatch(/PRIVATE/);
    expect(() => builder.ingest({ ...report, records: [{ ...row, quantity: 9 }] })).toThrow("相同交易");
  });
  it("新版主明細只看含活動的建議量，細節集中附表，範圍外品項也不帶回空白活動欄", () => {
    const result = run({ activityDemand: { ...fixture.activityDemand, scope: "supplier-runtai" } });
    const snapshot = JSON.stringify(result.rows);
    const book = roundtrip(core.buildRecommendationWorkbook(result, writer));
    for (const name of book.SheetNames.filter(name => /^03/.test(name))) {
      const data = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: "" });
      if (!data[0].includes("ERP品號")) continue;
      expect(data[0].filter(h => /^(大)?活動/.test(h))).toEqual([]);
      expect(data[0]).toEqual(expect.arrayContaining(["建議採購量", "人工確認採購量", "建議來源"]));
      for (const row of data.slice(1)) {
        const sku = row[data[0].indexOf("ERP品號")], baseline = result.rows.find(r => r.sku === sku);
        if (!baseline) continue;
        expect(row[data[0].indexOf("建議採購量")]).toBe(baseline.suggestedPurchaseQty);
      }
    }
    const detail = XLSX.utils.sheet_to_json(book.Sheets["10_活動備貨檢查"], { defval: "" });
    expect(detail).toHaveLength(result.rows.filter(r => r.activityPlanning).length);
    expect(detail[0]).toMatchObject({ "ERP品號": "A2", "活動備貨需求": result.rows.find(r => r.sku === "A2").activityPlanning.grossNeed });
    expect(Object.keys(detail[0])).toEqual(expect.arrayContaining(["活動前可抵未到貨", "不能抵扣未到貨", "寄庫拉貨量（已含在採購建議內）", "銷售位置備妥日", "總部需用日", "最早製作補足日", "提醒"]));
    const summary = XLSX.utils.sheet_to_json(book.Sheets["01_採購摘要"], { header: 1, defval: "" });
    expect(summary.find(r => r[0] === "活動採購明細說明")[1]).toContain("建議採購量已含活動備貨");
    expect(JSON.stringify(result.rows)).toBe(snapshot);
  });
  it("真實xlsx往返：未改量、人工改量、歸零、二次覆核與ERP固定八欄", () => {
    const result = run({ activityDemand: { ...fixture.activityDemand, scope: "supplier-runtai" } });
    const book = core.buildRecommendationWorkbook(result, writer, { selectedSuppliers: ["潤泰羽絨"] });
    expect(book.SheetNames).toContain("10_活動備貨檢查");
    const baselineBySku = new Map(result.rows.map(r => [r.sku, r]));
    const original = result.rows.find(r => r.sku === "A2");
    const first = core.reviewReturnedWorkbook(roundtrip(book), XLSX, { baselineBySku });
    expect(first.errors).toEqual([]);
    expect(first.rows.reduce((s, r) => s + r.finalQty, 0)).toBe(original.suggestedPurchaseQty);
    const second = core.reviewSecondApprovalWorkbook(roundtrip(core.buildSecondReviewWorkbook(first, writer)), XLSX, { baselineBySku: new Map(first.rows.map(r => [r.sku, r])) });
    expect(second.errors).toEqual([]);
    expect(second.rows.reduce((s, r) => s + r.finalQty, 0)).toBe(first.rows.reduce((s, r) => s + r.finalQty, 0));
    const erp = core.buildErpPurchaseWorkbook(second, writer, { approved: true, batchId: "PP-SYNTHETIC-ACTIVITY" });
    const data = XLSX.utils.sheet_to_json(roundtrip(erp).Sheets[erp.SheetNames[0]], { header: 1, defval: "" });
    expect(data[0]).toHaveLength(8);
    const sheetName = book.SheetNames.find(name => /^03/.test(name));
    const sheet = book.Sheets[sheetName], list = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const header = list.findIndex(r => r.includes("人工確認採購量"));
    const q = list[header].indexOf("人工確認採購量"), reason = list[header].indexOf("人工調整原因類別");
    expect(q).toBeGreaterThanOrEqual(0); expect(reason).toBeGreaterThanOrEqual(0);
    for (const quantity of [original.suggestedPurchaseQty + 1, 0]) {
      sheet[XLSX.utils.encode_cell({ r: header + 1, c: q })] = { t: "n", v: quantity };
      sheet[XLSX.utils.encode_cell({ r: header + 1, c: reason })] = { t: "s", v: quantity === 0 ? "本次不採購" : "需求增加，人工提高數量" };
      const review = core.reviewReturnedWorkbook(roundtrip(book), XLSX, { baselineBySku, confirmedPurchaseUnitExceptions: true });
      expect(review.errors).toEqual([]);
      expect(review.rows.reduce((s, r) => s + r.finalQty, 0)).toBe(quantity);
      expect(review.totals.approvedAmount).toBe(quantity * original.unitCost);
      expect(review.rows[0].activityPlanning.approvedShortage).toBeGreaterThanOrEqual(Math.max(0, original.activityPlanning.netNeed - quantity));
      if (quantity === 0) expect(review.rows[0].activityPlanning.approvedShortage).toBeGreaterThan(0);
      const secondReview = core.reviewSecondApprovalWorkbook(roundtrip(core.buildSecondReviewWorkbook(review, writer)), XLSX, { baselineBySku: new Map(review.rows.map(r => [r.sku, r])) });
      expect(secondReview.errors).toEqual([]);
      expect(secondReview.rows[0].activityPlanning.approvedShortage).toBe(review.rows[0].activityPlanning.approvedShortage);
    }
  });
});

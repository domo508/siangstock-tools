import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';

const context = { console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer };
vm.createContext(context);
// Match the production page's reader, not the styling writer's parser.
vm.runInContext(readFileSync('../inventory/assets/xlsx.full.min.js', 'utf8'), context);
vm.runInContext(readFileSync('../procurement-planning/core.js', 'utf8'), context);
const { XLSX, ProcurementPlanningCore: core } = context;
const roundTrip = workbook => XLSX.read(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), {
  type: 'array', cellDates: true, cellStyles: true, nodim: true
});
const base = overrides => ({ sku: 'TEST-1', supplier: '力榮', name: '測試床包', unitCost: 100,
  suggestedPurchaseQty: 20, packSize: 10, pendingQty: 0, consignmentDataAvailable: false,
  consignmentCurrentQty: null, productStatusPendingReview: true, ...overrides });
function input(row, manual = '', reason = '') {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
    'ERP品號': row.sku, '供應商': row.supplier, '商品品名': row.name,
    '建議採購量': row.suggestedPurchaseQty, '進貨價': row.unitCost,
    '寄倉現貨': row.consignmentDataAvailable === false ? '資料未取得' : row.consignmentCurrentQty,
    '目前實際可採購量': row.consignmentDataAvailable === false ? '待寄庫資料恢復後確認' : 20,
    '人工確認採購量': manual, '人工調整原因類別': reason, '人工調整補充說明': ''
  }]), '03A_力榮採購');
  return roundTrip(workbook);
}
const options = row => ({ baselineBySku: new Map([[row.sku, row]]), asOfDate: '2026-11-02', orderDate: '2026-11-02' });

describe('主檔空白與缺寄庫回匯相容／輸出守恆', () => {
  it('跨工具與巢狀規則頁同步採購核心資產版本，不沿用舊快取網址', () => {
    const version = JSON.parse(readFileSync('../procurement-planning/version.json', 'utf8')).version;
    for (const file of ['../store-transfer/index.html', '../store-transfer/rules/index.html', '../procurement-planning/rules-admin/index.html']) {
      expect(readFileSync(file, 'utf8')).toContain(`core.js?v=${version}`);
    }
  });
  it.each(['', 20])('舊檔缺寄庫、狀態空白，人工量%s仍保留建議且不用原因', manual => {
    const row = base(), workbook = input(row, manual), opts = options(row);
    expect(core.listManualReasonCandidates(workbook, XLSX, opts)).toHaveLength(0);
    const first = core.reviewReturnedWorkbook(workbook, XLSX, opts);
    expect(first.errors).toEqual([]);
    expect(first.rows[0]).toMatchObject({ finalQty: 20, currentAvailableQty: 20,
      consignmentCurrentQty: null, consignmentSupplyUnverified: true, consignmentDataAvailable: false });
    expect(first.warnings.map(x => x.type)).toContain('consignment_supply_unverified');
    const secondBook = roundTrip(core.buildSecondReviewWorkbook(first, XLSX));
    const report = XLSX.utils.sheet_to_json(secondBook.Sheets['02_覆核與異動確認'])[0];
    expect(report['寄倉現貨']).toBe('資料未取得');
    expect(report['目前實際可採購量']).toBe(20);
    const second = core.reviewSecondApprovalWorkbook(secondBook, XLSX, {
      ...opts, baselineBySku: new Map(first.rows.map(x => [x.sku, x]))
    });
    expect(second.errors).toEqual([]);
    expect(second.rows[0].consignmentSupplyUnverified).toBe(true);
    expect(second.warnings.map(x => x.type)).toContain('consignment_supply_unverified');
    expect(second.totals).toEqual(first.totals);
    expect(() => core.buildErpPurchaseWorkbook(second, XLSX)).toThrow('尚未完成正式核准');
    const erp = roundTrip(core.buildErpPurchaseWorkbook(second, XLSX, { approved: true }));
    expect(XLSX.utils.sheet_to_json(erp.Sheets['通用貨品數量'])).toEqual([
      { '貨號': 'TEST-1', '品名': '測試床包', '顏色': '', '尺碼': '', '數量': 20, '價格': 100, '備註': '', '倉庫': '寬承總倉' }
    ]);
  });
  it.each([0, 10, 30])('實際改為%s件仍須原因，補填後不改人工量', manual => {
    const row = base(), opts = options(row);
    const workbook = input(row, manual);
    expect(core.listManualReasonCandidates(workbook, XLSX, opts)).toHaveLength(1);
    expect(core.reviewReturnedWorkbook(workbook, XLSX, opts).errors.some(x => /修改採購量/.test(x.message))).toBe(true);
    const reviewed = core.reviewReturnedWorkbook(input(row, manual, manual === 0 ? '本次不採購' : '庫存／銷售風險，人工降低數量'), XLSX, opts);
    expect(reviewed.errors).toEqual([]);
    expect(reviewed.rows[0].finalQty).toBe(manual);
    expect(reviewed.totals.approvedAmount).toBe(manual * 100);
  });
  it.each([null, '', '資料未取得', '待確認', -1])('舊快照缺少可用旗標且現貨%s，不轉為0或NaN', value => {
    const row = base({ consignmentDataAvailable: undefined, consignmentCurrentQty: value });
    const reviewed = core.reviewReturnedWorkbook(input(row), XLSX, options(row));
    expect(reviewed.errors).toEqual([]);
    expect(reviewed.rows[0]).toMatchObject({ finalQty: 20, currentAvailableQty: 20, consignmentSupplyUnverified: true });
    expect(Number.isFinite(reviewed.totals.approvedAmount)).toBe(true);
  });
  it.each([0, 10, 40])('現貨正常取得%s件時，沿用原寄庫與未到貨判斷', qty => {
    const row = base({ consignmentDataAvailable: true, consignmentCurrentQty: qty, pendingQty: 5 });
    const reviewed = core.reviewReturnedWorkbook(input(row), XLSX, options(row));
    expect(reviewed.errors).toEqual([]);
    expect(reviewed.rows[0].finalQty).toBe(Math.min(20, Math.max(qty - 5, 0)));
    expect(reviewed.rows[0].consignmentSupplyUnverified).toBe(false);
  });
  it('未知現貨不能放寬S品或全寄庫現貨清回；下架依舊阻擋', () => {
    for (const row of [base({ sellThroughStop: true, name: '測試(S)' }), base({ discontinued: true })]) {
      const reviewed = core.reviewReturnedWorkbook(input(row, 20), XLSX, options(row));
      expect(reviewed.rows[0].finalQty).toBe(0);
      expect(reviewed.rows[0].blockedReason).not.toBe('');
    }
    const row = base();
    const workbook = input(row, 20);
    const sheet = workbook.Sheets['03A_力榮採購'];
    const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0];
    // Legacy free-text full return reason must not infer unknown supply from the numeric fallback.
    delete sheet[XLSX.utils.encode_cell({ r: 1, c: headers.indexOf('人工調整原因類別') })];
    XLSX.utils.sheet_add_json(sheet, [{ '人工調整原因': core.FULL_CONSIGNMENT_RETURN_REASON }], { origin: 'K1' });
    expect(core.reviewReturnedWorkbook(roundTrip(workbook), XLSX, options(row)).errors.some(x => /可清回量/.test(x.message))).toBe(true);
  });
  it('已取得寄庫另有預留仍保留占用警示，且不改原人工量', () => {
    const row = base({ consignmentDataAvailable: true, consignmentCurrentQty: 40 });
    const reserved = new Map([[row.sku, 30]]);
    const reviewed = core.reviewReturnedWorkbook(input(row, 20), XLSX, { ...options(row), reservedConsignmentBySku: reserved });
    expect(reviewed.errors).toEqual([]);
    expect(reviewed.rows[0].finalQty).toBe(20);
    expect(reviewed.warnings.some(x => x.type === 'consignment_reservation_conflict')).toBe(true);
  });
  it('核准前缺寄庫須確認，取消不送出正式核准', () => {
    const app = readFileSync('../procurement-planning/app.js', 'utf8');
    expect(app.indexOf('const unverifiedSupply =')).toBeLessThan(app.indexOf('正在正式核准並建立通知工作'));
    expect(app).toContain('已取消核准；請先確認寄庫供貨');
    expect(app).toContain('供貨尚待總部確認');
  });
  it.each([false, true])('實際核准handler供貨確認=%s，不改量且取消不產生請求', async accept => {
    const app = readFileSync('../procurement-planning/app.js', 'utf8');
    const fn = app.slice(app.indexOf('  async function approveBatch()'), app.indexOf('  async function retryNotification()'));
    const posts = [], prompts = [];
    const sandbox = {
      state: { batchId: 'SYNTHETIC', config: { permissions: { canApprove: true } }, approved: false,
        review: { rows: [{ sku: 'TEST-1', finalQty: 20, consignmentSupplyUnverified: true }] } },
      elements: { approve: {}, erp: {}, retryNotification: {}, workflowStepApproval: {} },
      currentSummaryAction: () => ({ isCurrent: () => true }), checkRuntimeVersion: async () => true,
      checkSummaryAuthorization: async () => true, confirm: message => { prompts.push(message); return accept; },
      setWorkflowStatus: () => {}, setWorkflowStep: () => {},
      postJson: async url => { posts.push(url); }, loadLedger: async () => {},
      persistWorkflowDraft: async () => {}, saveCostSnapshot: async () => {},
      googleSources: { token: () => 'synthetic' }, retryNotification: () => {}
    };
    vm.createContext(sandbox);
    vm.runInContext(fn, sandbox);
    await sandbox.approveBatch();
    expect(prompts).toHaveLength(1);
    expect(sandbox.state.review.rows[0].finalQty).toBe(20);
    expect(posts).toEqual(accept ? ['/api/procurement/batches/SYNTHETIC/approve', '/api/procurement/batches/SYNTHETIC/notify'] : []);
    expect(sandbox.state.approved).toBe(accept);
    expect(sandbox.state.summaryActionBusy).toBe(false);
  });
  it.each([false, true])('另一位同仁由共用待核准清單亦須確認供貨=%s', async accept => {
    const app = readFileSync('../procurement-planning/app.js', 'utf8');
    const fn = app.slice(app.indexOf('  async function approveQueuedBatch('), app.indexOf('  async function loadProcurementRules('));
    const posts = [], prompts = [], button = {};
    const sandbox = {
      state: { ledger: { batches: [{ id: 'SYNTHETIC', status: 'pending_approval', warning_summary: '寄庫資料未取得1項；數量依原建議，供貨尚待總部確認' }] } },
      checkRuntimeVersion: async () => true, checkSummaryAuthorization: async () => true,
      loadLedger: async () => {}, confirm: message => { prompts.push(message); return accept; },
      setWorkflowStatus: () => {}, postJson: async url => { posts.push(url); }, googleSources: { token: () => 'synthetic' }
    };
    vm.createContext(sandbox);
    vm.runInContext(fn, sandbox);
    await sandbox.approveQueuedBatch('SYNTHETIC', button);
    expect(prompts).toHaveLength(1);
    expect(posts).toEqual(accept ? ['/api/procurement/batches/SYNTHETIC/approve', '/api/procurement/batches/SYNTHETIC/notify'] : []);
    expect(button.disabled).toBe(false);
  });
});

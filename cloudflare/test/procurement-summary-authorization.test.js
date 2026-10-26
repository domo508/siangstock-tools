import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
const app = readFileSync("../procurement-planning/app.js", "utf8");
function section(start, end) { return app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start))); }
function workflow() {
  const calls = [];
  const elements = Object.fromEntries(["summaryAuth", "summaryAuthMessage", "summaryAuthConnect", "googleConnect", "googleAuthStatus", "autoSource", "sourceStatus", "approve", "erp", "retryNotification", "workflowStepApproval"].map(key => [key, { hidden: true, disabled: false, scrollIntoView: () => {}, focus: () => {} }]));
  const controls = { valid: false, email: "approver@siangapato.com.tw", cancel: false, expireOnSend: false, version: true };
  const state = { config: { email: controls.email, permissions: { canApprove: true }, googleOAuthClientId: "test-client" }, batchId: "test-batch", review: { rows: [{ sku: "TEST", finalQty: 0 }], totals: { approvedAmount: 0 } }, approved: false, pendingSummaryAction: null };
  const sandbox = {
    state, elements, console,
    googleSources: {
      token: () => controls.valid ? "test-token" : "", canSendSummary: () => controls.valid,
      clearAuthorization: () => { controls.valid = false; }, initialize: () => {},
      authorize: async () => { if (controls.cancel) throw new Error("使用者取消授權"); controls.valid = true; },
      verifyCompanyIdentity: async () => ({ email: controls.email })
    },
    renderGoogleAuthorizationStatus: () => {}, updateModelControls: () => {},
    checkRuntimeVersion: async () => controls.version,
    loadApprovedSeasonalModel: async () => { calls.push("model"); },
    loadLedger: async () => {}, persistWorkflowDraft: async () => {}, saveCostSnapshot: async () => {},
    setWorkflowStatus: message => { calls.push(message); }, setWorkflowStep: () => {},
    postJson: async url => { calls.push(url); if (controls.expireOnSend && url.endsWith("/notify")) { controls.expireOnSend = false; throw Object.assign(new Error("授權已過期"), { status: 401 }); } return { status: "sent" }; }
  };
  vm.createContext(sandbox);
  vm.runInContext([
    section("  function clearSummaryAuthorization()", "  async function revokeLedgerBatch("),
    section("  async function approveQueuedBatch(", "  async function loadProcurementRules("),
    section("  async function connectGoogle()", "  async function loadAutomaticSources()"),
    section("  async function approveBatch()", "  function downloadErp()")
  ].join("\n"), sandbox);
  return { ...sandbox, calls, controls, posts: () => calls.filter(c => c.startsWith("/api/")) };
}
describe("採購摘要補授權與接續操作", () => {
  it("僅回匯授權檢查與補登入不會核准或寄信", async () => {
    const w = workflow(); expect(await w.checkSummaryAuthorization()).toBe(false);
    expect(w.elements.summaryAuth.hidden).toBe(false); await w.connectGoogle();
    expect(w.posts()).toEqual([]); expect(w.state.review.totals.approvedAmount).toBe(0);
  });
  it("過期先停住，補登入後核准與寄信各一次且回匯不變", async () => {
    const w = workflow(); const review = w.state.review;
    await w.approveBatch(); expect(w.posts()).toEqual([]); await w.connectGoogle();
    expect(w.posts()).toEqual(["/api/procurement/batches/test-batch/approve", "/api/procurement/batches/test-batch/notify"]);
    expect(w.state.review).toBe(review); expect(w.state.approved).toBe(true); expect(w.state.pendingSummaryAction).toBe(null);
  });
  it("取消授權保留回匯與待接續操作", async () => {
    const w = workflow(); await w.approveBatch(); w.controls.cancel = true; await w.connectGoogle();
    expect(w.posts()).toEqual([]); expect(w.state.review).toBeTruthy(); expect(w.state.pendingSummaryAction).toBeTruthy(); expect(w.elements.summaryAuthConnect.disabled).toBe(false);
  });
  it("不同帳號不能接續核准", async () => {
    const w = workflow(); await w.approveBatch(); w.controls.email = "other@siangapato.com.tw"; await w.connectGoogle();
    expect(w.posts()).toEqual([]); expect(w.state.googleAuthorized).toBe(false);
  });
  it("補授權期間切換批次或修改回匯不接續舊操作", async () => {
    for (const change of [w => { w.state.batchId = "another"; }, w => { w.state.review = { rows: [] }; }]) {
      const w = workflow(); await w.approveBatch(); change(w); await w.connectGoogle(); expect(w.posts()).toEqual([]);
    }
  });
  it("寄送時才過期，補授權只重送、不再核准", async () => {
    const w = workflow(); w.controls.valid = true; w.controls.expireOnSend = true; await w.approveBatch();
    expect(w.state.approved).toBe(true); expect(w.elements.erp.disabled).toBe(false); await w.connectGoogle();
    expect(w.posts().filter(x => x.endsWith("/approve"))).toHaveLength(1); expect(w.posts().filter(x => x.endsWith("/notify"))).toHaveLength(2);
  });
  it("共用待核准清單補授權後接續所選批次", async () => {
    const w = workflow(); await w.approveQueuedBatch("shared", {}); await w.connectGoogle();
    expect(w.posts()).toEqual(["/api/procurement/batches/shared/approve", "/api/procurement/batches/shared/notify"]);
  });
  it("共用核准寄送時失效，只接續該批通知", async () => {
    const w = workflow(); w.controls.valid = true; w.controls.expireOnSend = true;
    await w.approveQueuedBatch("shared", {}); await w.connectGoogle();
    expect(w.posts().filter(x => x.endsWith("/approve"))).toHaveLength(1);
    expect(w.posts().filter(x => x.endsWith("/notify"))).toEqual(["/api/procurement/batches/shared/notify", "/api/procurement/batches/shared/notify"]);
  });
  it("歷史摘要只重送所選批次", async () => {
    const w = workflow(); await w.retryLedgerNotification("history", {}); await w.connectGoogle(); expect(w.posts()).toEqual(["/api/procurement/batches/history/notify"]);
  });
  it("連按核准不並行寫入", async () => {
    const w = workflow(); w.controls.valid = true; await Promise.all([w.approveBatch(), w.approveBatch()]); expect(w.posts()).toHaveLength(2);
  });
  it("補授權後版本變更，不接續寫入", async () => {
    const w = workflow(); await w.approveBatch(); w.controls.version = false; await w.connectGoogle(); expect(w.posts()).toEqual([]);
  });
  it("兩次回匯成功均檢查授權", () => {
    expect(app).toContain('if (!state.firstReview.errors.length) { await persistWorkflowDraft("first_reviewed"); await checkSummaryAuthorization(); }');
    expect(app).toContain('if (!state.review.errors.length) { await persistWorkflowDraft("second_reviewed"); await checkSummaryAuthorization(); }');
  });
});
function sources({ expires = 3600, scope = "openid email https://www.googleapis.com/auth/gmail.send", status = 200 } = {}) {
  let now = 1000; let client;
  const sandbox = { console, setTimeout, clearTimeout, Date: { now: () => now },
    google: { accounts: { oauth2: { initTokenClient: () => {
      client = { requestAccessToken: () => client.callback({ access_token: "test-token", expires_in: expires, scope }) }; return client;
    } } } },
    fetch: async () => ({ ok: status === 200, status, json: async () => ({ email: "approver@siangapato.com.tw" }) })
  };
  vm.createContext(sandbox); vm.runInContext(readFileSync("../procurement-planning/google-sources.js", "utf8"), sandbox);
  return { api: sandbox.ProcurementGoogleSources, advance: ms => { now += ms; } };
}
describe("Google 授權有效時間與寄送範圍", () => {
  it("到期前保留一分鐘緩衝", async () => {
    const { api, advance } = sources(); api.initialize("test"); await api.authorize(); expect(api.canSendSummary()).toBe(true);
    advance(3540000); expect(api.token()).toBe(""); expect(api.canSendSummary()).toBe(false);
  });
  it("未授權Gmail不能寄摘要", async () => {
    const { api } = sources({ scope: "openid email" }); api.initialize("test"); await api.authorize(); expect(api.token()).toBeTruthy(); expect(api.canSendSummary()).toBe(false);
  });
  it("即時身份驗證401清除token", async () => {
    const { api } = sources({ status: 401 }); api.initialize("test"); await api.authorize();
    await expect(api.verifyCompanyIdentity()).rejects.toMatchObject({ status: 401 }); expect(api.token()).toBe("");
  });
});

 it("Google登入視窗關閉立即結束等待，晚到回呼不得寫入授權", async () => {
  let options; let client;
  const sandbox = { console, setTimeout, clearTimeout, google: { accounts: { oauth2: { initTokenClient: config => { options = config; client = { requestAccessToken: () => options.error_callback({ type: "popup_closed" }) }; return client; } } } } };
  vm.createContext(sandbox); vm.runInContext(readFileSync("../procurement-planning/google-sources.js", "utf8"), sandbox);
  const api = sandbox.ProcurementGoogleSources; api.initialize("test");
  await expect(api.authorize()).rejects.toThrow("已取消");
  client.callback({ access_token: "late-token", expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.send" });
  expect(api.token()).toBe("");
 });

 describe("補授權前後業務資料守恆", () => {
  for (const [name, qty] of [["未改量",21],["人工改量",22],["明確歸零",0]]) {
   it(name, async () => {
    const w=workflow(); w.state.review = { rows:[{sku:"TEST-1",suggestedQty:21,finalQty:qty,unitCost:100,approvedAmount:qty*100},{sku:"TEST-2",finalQty:0,unitCost:30,approvedAmount:0}],totals:{approvedAmount:qty*100} };
    const baseline=JSON.stringify(w.state.review); await w.approveBatch(); await w.connectGoogle();
    expect(JSON.stringify(w.state.review)).toBe(baseline); expect(w.posts().filter(x=>x.endsWith("/approve"))).toHaveLength(1);
   });
  }
  it("即時身份檢查期間切換批次不寫入新批次", async () => {
   const w=workflow();w.controls.valid=true;
   w.googleSources.verifyCompanyIdentity=async()=>{w.state.batchId="another";return {email:w.state.config.email};};
   await w.approveBatch();expect(w.posts()).toEqual([]);
  });
 });

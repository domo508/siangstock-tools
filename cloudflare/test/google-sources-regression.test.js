import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { describe, it, expect } from "vitest";

const source = readFileSync("../procurement-planning/google-sources.js", "utf8");
const xlsxContext = { console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer };
vm.createContext(xlsxContext);
vm.runInContext(readFileSync("../procurement-planning/assets/xlsx-js-style.bundle.js", "utf8"), xlsxContext);
const XLSX = xlsxContext.XLSX;
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function workbookBytes() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["貨號", "品名", "進貨價", "貨品狀態", "已下架"],
    ["TEST-001", "合成測試商品", 125, "尚可追加", "否"]
  ]), "工作表1");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}
function fixture({ files, status = 200, abortDownload = false } = {}) {
  const bytes = workbookBytes();
  const calls = [];
  let client;
  const sandbox = { console, URLSearchParams, File, Blob, TextEncoder, Uint8Array, ArrayBuffer,
    crypto: webcrypto, setTimeout, clearTimeout,
    google: { accounts: { oauth2: { initTokenClient: () => {
      client = { requestAccessToken: () => client.callback({ access_token: "synthetic-token", expires_in: 3600 }) };
      return client;
    } } } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (options.signal?.aborted || (abortDownload && url.includes("alt=media"))) throw new DOMException("Aborted", "AbortError");
      if (status !== 200) return { ok: false, status, json: async () => ({ error: { message: "synthetic denied" } }) };
      return { ok: true, status: 200,
        json: async () => ({ files: files ?? [
          { id: "new", name: "合成最新主檔.xlsx", mimeType: MIME, parents: ["master-folder"], modifiedTime: "2026-10-28T01:00:00Z" },
          { id: "wrong-parent", name: "別處.xlsx", mimeType: MIME, parents: ["another-folder"], modifiedTime: "2026-10-28T01:00:00Z" },
          { id: "old", name: "合成舊主檔.xlsx", mimeType: MIME, parents: ["master-folder"], modifiedTime: "2026-10-27T01:00:00Z" }
        ] }), blob: async () => new Blob([bytes], { type: MIME }) };
    }
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const api = sandbox.ProcurementGoogleSources;
  return { api, calls, login: async () => { api.initialize("synthetic-client"); await api.authorize(); } };
}
describe("正式共用 Google 來源回歸", () => {
  it("原本單參數呼叫可選取最新直屬主檔，實際 XLSX 下載重讀品號／金額守恆", async () => {
    const f = fixture(); await f.login();
    const result = await f.api.loadLatestMaster("master-folder");
    expect(result.file.name).toBe("合成最新主檔.xlsx");
    expect(result.metadata.id).toBe("new");
    expect(result.metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
    const workbook = XLSX.read(await result.file.arrayBuffer(), { type: "array", cellDates: true, cellStyles: true });
    expect(XLSX.utils.sheet_to_json(workbook.Sheets["工作表1"])).toEqual([
      { "貨號": "TEST-001", "品名": "合成測試商品", "進貨價": 125, "貨品狀態": "尚可追加", "已下架": "否" }
    ]);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1].url).toContain("/new?alt=media");
  });
  it("周調撥正式雙來源呼叫兩份均完成且不寫入來源", async () => {
    const f = fixture(); await f.login();
    const [master, marketing] = await Promise.all([
      f.api.loadLatestMaster("master-folder"), f.api.downloadDriveFile("marketing-file", "整體行銷策略.xlsx")
    ]);
    expect(master.file.size).toBeGreaterThan(0); expect(marketing.size).toBe(master.file.size);
    expect(f.calls).toHaveLength(3);
    expect(f.calls.every(c => !c.options.method || c.options.method === "GET")).toBe(true);
  });
  it("取消訊號同時傳到清單及檔案下載，不遺漏 options", async () => {
    const f = fixture(); await f.login(); const controller = new AbortController();
    await f.api.loadLatestMaster("master-folder", { signal: controller.signal });
    expect(f.calls.every(c => c.options.signal === controller.signal)).toBe(true);
    controller.abort();
    await expect(f.api.loadLatestMaster("master-folder", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(f.calls).toHaveLength(3);
  });
  it("未登入及401均停止，不回傳半份資料或繞過授權", async () => {
    const f = fixture({ status: 401 });
    await expect(f.api.loadLatestMaster("master-folder")).rejects.toMatchObject({ status: 401 });
    expect(f.calls).toHaveLength(0); await f.login();
    await expect(f.api.loadLatestMaster("master-folder")).rejects.toMatchObject({ status: 401 });
    expect(f.api.token()).toBe(""); expect(f.calls).toHaveLength(1);
  });
  it("無候選檔與同時多個最新檔明確阻擋，不下載錯誤主檔", async () => {
    for (const files of [[], ["a", "b"].map(id => ({ id, mimeType: MIME, parents: ["master-folder"], modifiedTime: "2026-10-28" }))]) {
      const f = fixture({ files }); await f.login();
      await expect(f.api.loadLatestMaster("master-folder")).rejects.toThrow(/候選/);
      expect(f.calls).toHaveLength(1);
    }
  });
  it("403明確失敗，不誤報為參數錯誤", async () => {
    const f = fixture({ status: 403 }); await f.login();
    await expect(f.api.loadLatestMaster("master-folder")).rejects.toMatchObject({ status: 403 });
    expect(f.calls).toHaveLength(1);
  });
  it("兩工具皆引用本次共用程式，防止周調撥長期沿用舊網址", () => {
    const version = JSON.parse(readFileSync("../procurement-planning/version.json", "utf8")).version;
    for (const path of ["../procurement-planning/index.html", "../store-transfer/index.html"]) {
      expect(readFileSync(path, "utf8")).toContain(`google-sources.js?v=${version}`);
    }
  });
});

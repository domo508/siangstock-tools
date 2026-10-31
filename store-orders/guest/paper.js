// store-orders/core.js
var VERSION = "20261031-store-orders-r36";
var READ_OPTIONS = Object.freeze({ type: "array", cellStyles: true, cellDates: false, raw: true });
var WRITE_OPTIONS = Object.freeze({ bookType: "biff8", type: "array" });
var POS_HEADERS = Object.freeze(["\u55AE\u865F", "\u7D50\u5E33\u65E5\u671F", "\u958B\u55AE\u5009\u5EAB", "\u51FA\u8CA8\u5009\u5EAB", "\u53D6\u8CA8\u5009\u5EAB", "\u6703\u54E1\u5361\u865F", "\u92B7\u5225", "\u5099\u8A3B", "\u8CA8\u865F", "\u984F\u8272", "\u984F\u8272\u7DE8\u78BC", "\u5C3A\u78BC", "\u5C3A\u78BC\u7DE8\u78BC", "\u662F\u5426\u8D08\u54C1", "\u5C0E\u8CFC", "\u5BE6\u6536\u7387", "\u6578\u91CF", "\u4E2D\u4FE1\u4FE1\u7528\u5361", "\u73FE\u91D1", "\u767E\u8CA8\u73FE\u91D1\u5377", "LinePay"]);
var PAYMENTS = Object.freeze(["\u4E2D\u4FE1\u4FE1\u7528\u5361", "\u73FE\u91D1", "\u767E\u8CA8\u73FE\u91D1\u5377", "LinePay"]);
var STORES = Object.freeze({ R00: "\u53F0\u5317\u4E2D\u5C71\u9580\u5E02", R01: "\u53F0\u4E2D\u5317\u5C6F\u9580\u5E02", R03: "\u65B0\u7AF9\u6771\u5340\u9580\u5E02", R10: "\u65B0\u838A\u9580\u5E02", R07: "\u8AA0\u54C1480\u9580\u5E02", R06: "\u6587\u5FC3\u79C0\u6CF0\u9580\u5E02" });
var STATUS = Object.freeze({ pending: "\u5F85\u8986\u6838", needs_info: "\u5F85\u88DC\u4EF6", reviewed: "\u5DF2\u8986\u6838", settled: "\u5DF2\u7D50\u7B97", exported: "\u5DF2\u7522\u6A94", import_unknown: "\u5F85\u78BA\u8A8D\u532F\u5165\u7D50\u679C", import_failed: "\u532F\u5165\u5931\u6557", erp_created: "ERP \u5DF2\u5EFA\u7ACB", cancelled: "\u5DF2\u53D6\u6D88" });

// store-orders/runtime.js
var VersionGuard = class {
  constructor(fetcher = (...args) => fetch(...args)) {
    this.fetcher = fetcher;
    this.blocked = true;
    this.current = "";
  }
  async check() {
    try {
      const r = await this.fetcher(`${typeof location !== "undefined" && location.pathname.startsWith("/store-orders/guest/") ? "/store-orders/guest" : "/store-orders"}/version.json?check=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
      if (!r.ok) throw Error();
      const v = await r.json();
      this.current = v.version;
      this.blocked = v.version !== VERSION;
    } catch {
      this.blocked = true;
    }
    return !this.blocked;
  }
  async require() {
    if (!await this.check()) throw new Error("\u7121\u6CD5\u78BA\u8A8D\u7248\u672C\u6216\u7248\u672C\u4E0D\u540C\uFF0C\u8ACB\u91CD\u65B0\u8F09\u5165\u6700\u65B0\u7248");
  }
  reloadUrl() {
    return `/store-orders/?deploy=${encodeURIComponent(this.current || VERSION)}&reload=${Date.now()}`;
  }
};

// store-orders/paper.js
var $ = (id) => document.getElementById(id);
var guard = new VersionGuard();
for (const [code, name] of Object.entries({ ...STORES, R14: STORES.R14 || "" })) {
  const option = document.createElement("option");
  option.value = code;
  option.textContent = `${code} ${name}`;
  $("paper-store").append(option);
}
$("paper-store").value = "R14";
function updateStore() {
  $("store-name").textContent = `${$("paper-store").value} ${STORES[$("paper-store").value] || ""}`;
}
for (let i = 0; i < 14; i++) {
  const row = document.createElement("tr");
  for (let c = 0; c < 6; c++) {
    const cell = document.createElement("td");
    if (c === 5) cell.textContent = "\u25A1\u92B7\u8CA8 \u25A1\u8A02\u8CA8";
    row.append(cell);
  }
  $("paper-lines").append(row);
}
async function checked(work) {
  try {
    await guard.require();
    work();
  } catch (e) {
    $("paper-warning").textContent = e.message;
    $("paper-reload").hidden = false;
  }
}
$("paper-store").onchange = () => checked(updateStore);
$("print").onclick = () => checked(() => window.print());
updateStore();
$("paper-reload").onclick = () => location.assign(`/store-orders/paper.html?deploy=${encodeURIComponent(guard.current)}&reload=${Date.now()}`);

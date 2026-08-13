(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.InventoryRulesClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const ENDPOINT = "/api/rules";

  async function fetchLatest(fetchImpl, core) {
    const response = await fetchImpl(ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`集中規則服務無法使用（HTTP ${response.status}）。`);
    const data = await response.json();
    if (!data || !Number.isInteger(data.version) || data.version < 1 || typeof data.updatedAt !== "string") {
      throw new Error("集中規則服務回傳的版本資料不完整。");
    }
    return { version: data.version, updatedAt: data.updatedAt, rules: core.cloneRules(data.rules) };
  }

  function formatUpdatedAt(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "時間未知" : date.toLocaleString("zh-TW", { hour12: false });
  }

  return { ENDPOINT, fetchLatest, formatUpdatedAt };
});

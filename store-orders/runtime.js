import { VERSION } from "./core.js?v=20261030-store-orders-r26";
export class VersionGuard {
  constructor(fetcher = (...args) => fetch(...args)) { this.fetcher = fetcher; this.blocked = true; this.current = ""; }
  async check() {
    try { const r = await this.fetcher(`${typeof location!=="undefined"&&location.pathname.startsWith("/store-orders/guest/")?"/store-orders/guest":"/store-orders"}/version.json?check=${Date.now()}`, { cache: "no-store", credentials: "same-origin" }); if (!r.ok) throw Error(); const v = await r.json(); this.current = v.version; this.blocked = v.version !== VERSION; }
    catch { this.blocked = true; }
    return !this.blocked;
  }
  async require() { if (!await this.check()) throw new Error("無法確認版本或版本不同，請重新載入最新版"); }
  reloadUrl() { return `/store-orders/?deploy=${encodeURIComponent(this.current || VERSION)}&reload=${Date.now()}`; }
}

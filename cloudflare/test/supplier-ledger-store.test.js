import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadLedgerStore() {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync("../supplier-reconciliation/ledger-store.js", "utf8"), sandbox);
  return sandbox.SupplierReconciliationLedgerStore;
}

describe("供應商對帳瀏覽器本機台帳", () => {
  it("只帶入同供應商、早於本期的最近一期快照", () => {
    const store = loadLedgerStore();
    const snapshots = [
      { vendorKey: "shanglin", period: "2026-06", updatedAt: "2026-07-01T00:00:00Z" },
      { vendorKey: "shanglin", period: "2026-07", updatedAt: "2026-08-01T00:00:00Z" },
      { vendorKey: "li-rong", period: "2026-07", updatedAt: "2026-08-01T00:00:00Z" }
    ];
    expect(store.selectPriorSnapshot(snapshots, "shanglin", "2026-07").period).toBe("2026-06");
    expect(store.selectPriorSnapshot(snapshots, "shanglin", "2026-08").period).toBe("2026-07");
    expect(store.selectPriorSnapshot(snapshots, "puyuma", "2026-08")).toBeNull();
  });

  it("每家供應商只保留最近24個月份，且同月使用固定識別碼覆蓋", () => {
    const store = loadLedgerStore();
    const snapshots = Array.from({ length: 26 }, (_, index) => ({
      id: `shanglin|2024-${String(index + 1).padStart(2, "0")}`,
      vendorKey: "shanglin", period: `${2024 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`, updatedAt: ""
    }));
    expect(store.snapshotsToDelete(snapshots)).toHaveLength(2);
    expect(store.snapshotId("shanglin", "2026-07")).toBe("shanglin|2026-07");
  });
});

(function (global) {
  "use strict";

  const DB_NAME = "siangstock-supplier-reconciliation";
  const DB_VERSION = 1;
  const STORE_NAME = "ledger-snapshots";
  const KEEP_MONTHS = 24;

  function snapshotId(vendorKey, period) {
    return `${vendorKey}|${period}`;
  }

  function selectPriorSnapshot(snapshots, vendorKey, period) {
    return snapshots
      .filter((row) => row.vendorKey === vendorKey && /^\d{4}-\d{2}$/.test(row.period) && row.period < period)
      .sort((left, right) => right.period.localeCompare(left.period) || String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] || null;
  }

  function snapshotsToDelete(snapshots, keepMonths = KEEP_MONTHS) {
    const grouped = new Map();
    for (const row of snapshots) {
      const rows = grouped.get(row.vendorKey) || [];
      rows.push(row); grouped.set(row.vendorKey, rows);
    }
    return [...grouped.values()].flatMap((rows) => rows
      .sort((left, right) => right.period.localeCompare(left.period) || String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(keepMonths));
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("瀏覽器台帳讀寫失敗"));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("瀏覽器台帳寫入失敗"));
      transaction.onabort = () => reject(transaction.error || new Error("瀏覽器台帳寫入已中止"));
    });
  }

  function createStore(indexedDb = global.indexedDB) {
    let dbPromise;
    function open() {
      if (!indexedDb) return Promise.reject(new Error("這個瀏覽器不支援本機台帳；仍可用Excel匯入備援。"));
      if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
        const request = indexedDb.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("無法開啟瀏覽器本機台帳"));
        request.onblocked = () => reject(new Error("本機台帳正被其他分頁使用，請關閉舊分頁後重試。"));
      });
      return dbPromise;
    }

    async function list() {
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readonly");
      return requestValue(transaction.objectStore(STORE_NAME).getAll());
    }

    async function save(snapshot) {
      const db = await open();
      const row = {
        ...snapshot,
        id: snapshotId(snapshot.vendorKey, snapshot.period),
        version: 1,
        updatedAt: new Date().toISOString()
      };
      let transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(row);
      await transactionDone(transaction);
      const expired = snapshotsToDelete(await list());
      if (expired.length) {
        transaction = db.transaction(STORE_NAME, "readwrite");
        const objectStore = transaction.objectStore(STORE_NAME);
        expired.forEach((item) => objectStore.delete(item.id));
        await transactionDone(transaction);
      }
      return row;
    }

    async function loadPrior(vendorKey, period) {
      return selectPriorSnapshot(await list(), vendorKey, period);
    }

    async function clearVendor(vendorKey) {
      const db = await open();
      const rows = (await list()).filter((row) => row.vendorKey === vendorKey);
      if (!rows.length) return 0;
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const objectStore = transaction.objectStore(STORE_NAME);
      rows.forEach((row) => objectStore.delete(row.id));
      await transactionDone(transaction);
      return rows.length;
    }

    return { list, save, loadPrior, clearVendor };
  }

  global.SupplierReconciliationLedgerStore = {
    DB_NAME, STORE_NAME, KEEP_MONTHS, snapshotId, selectPriorSnapshot, snapshotsToDelete, createStore
  };
})(globalThis);

CREATE TABLE store_transfer_supply_releases (
  batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  extra_quantity INTEGER NOT NULL CHECK(extra_quantity BETWEEN 0 AND 100000),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 300),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY(batch_id, sku)
);
CREATE TABLE store_transfer_supply_release_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  previous_quantity INTEGER NOT NULL,
  extra_quantity INTEGER NOT NULL,
  reason TEXT NOT NULL,
  batch_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE(batch_id,batch_revision)
);

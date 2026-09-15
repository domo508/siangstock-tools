CREATE TABLE store_transfer_items_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  store_code TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL CHECK (length(product_name) <= 300),
  suggested_quantity INTEGER NOT NULL CHECK (suggested_quantity >= 0),
  store_confirmed_quantity INTEGER CHECK (store_confirmed_quantity IS NULL OR store_confirmed_quantity >= 0),
  store_reason TEXT NOT NULL DEFAULT '' CHECK (length(store_reason) <= 300),
  hq_approved_quantity INTEGER CHECK (hq_approved_quantity IS NULL OR hq_approved_quantity >= 0),
  rule_summary TEXT NOT NULL DEFAULT '' CHECK (length(rule_summary) <= 500),
  item_type TEXT NOT NULL DEFAULT 'regular' CHECK (item_type IN ('regular', 'activity_gift', 'special_stock', 'consumable')),
  calculation_date TEXT NOT NULL DEFAULT '',
  base_quantity REAL NOT NULL DEFAULT 0 CHECK (base_quantity >= 0),
  daily_usage REAL NOT NULL DEFAULT 0 CHECK (daily_usage >= 0),
  system_projection TEXT NOT NULL DEFAULT '' CHECK (length(system_projection) <= 80),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (batch_id, store_code, sku, item_type)
);

INSERT INTO store_transfer_items_v3 (
  id, batch_id, store_code, sku, product_name, suggested_quantity,
  store_confirmed_quantity, store_reason, hq_approved_quantity,
  rule_summary, item_type, updated_at, updated_by
)
SELECT
  id, batch_id, store_code, sku, product_name, suggested_quantity,
  store_confirmed_quantity, store_reason, hq_approved_quantity,
  rule_summary, item_type, updated_at, updated_by
FROM store_transfer_items;

DROP TABLE store_transfer_items;
ALTER TABLE store_transfer_items_v3 RENAME TO store_transfer_items;

CREATE INDEX store_transfer_items_batch_store
ON store_transfer_items (batch_id, store_code, sku, item_type);

CREATE INDEX store_transfer_items_batch_type_store
ON store_transfer_items (batch_id, item_type, store_code, sku);

CREATE TABLE store_transfer_consumable_snapshots (
  snapshot_date TEXT NOT NULL,
  store_code TEXT NOT NULL,
  sku TEXT NOT NULL CHECK (sku IN ('P11041', 'P11042', 'P11043')),
  current_quantity REAL NOT NULL CHECK (current_quantity >= 0),
  inbound_quantity REAL NOT NULL DEFAULT 0 CHECK (inbound_quantity >= 0),
  outbound_quantity REAL NOT NULL DEFAULT 0 CHECK (outbound_quantity >= 0),
  weekly_consumption REAL CHECK (weekly_consumption IS NULL OR weekly_consumption >= 0),
  trusted INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0, 1)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (snapshot_date, store_code, sku)
);

CREATE INDEX store_transfer_consumable_history
ON store_transfer_consumable_snapshots (store_code, sku, snapshot_date DESC);

CREATE TABLE store_transfer_items_v2 (
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
  item_type TEXT NOT NULL DEFAULT 'regular' CHECK (item_type IN ('regular', 'activity_gift')),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (batch_id, store_code, sku, item_type)
);

INSERT INTO store_transfer_items_v2 (
  id, batch_id, store_code, sku, product_name, suggested_quantity,
  store_confirmed_quantity, store_reason, hq_approved_quantity,
  rule_summary, item_type, updated_at, updated_by
)
SELECT
  id, batch_id, store_code, sku, product_name, suggested_quantity,
  store_confirmed_quantity, store_reason, hq_approved_quantity,
  rule_summary, 'regular', updated_at, updated_by
FROM store_transfer_items;

DROP TABLE store_transfer_items;
ALTER TABLE store_transfer_items_v2 RENAME TO store_transfer_items;

CREATE INDEX store_transfer_items_batch_store
ON store_transfer_items (batch_id, store_code, sku, item_type);

CREATE INDEX store_transfer_items_batch_type_store
ON store_transfer_items (batch_id, item_type, store_code, sku);

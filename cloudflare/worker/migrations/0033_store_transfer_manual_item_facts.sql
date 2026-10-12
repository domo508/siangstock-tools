CREATE TABLE store_transfer_manual_item_facts (
  batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  store_code TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL CHECK (length(product_name) <= 300),
  calculation_date TEXT NOT NULL,
  base_quantity REAL NOT NULL DEFAULT 0 CHECK (base_quantity >= 0),
  display_gap INTEGER NOT NULL DEFAULT 0 CHECK (display_gap >= 0),
  daily_usage REAL NOT NULL DEFAULT 0 CHECK (daily_usage >= 0),
  system_projection TEXT NOT NULL DEFAULT '' CHECK (length(system_projection) <= 80),
  system_reason TEXT NOT NULL DEFAULT '' CHECK (length(system_reason) <= 500),
  created_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, store_code, sku)
);

CREATE INDEX store_transfer_manual_item_facts_lookup
ON store_transfer_manual_item_facts (batch_id, store_code, sku);

CREATE TABLE store_transfer_batch_product_catalog (
  batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL CHECK (length(product_name) <= 300),
  created_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, sku)
);

CREATE INDEX store_transfer_batch_product_catalog_lookup
ON store_transfer_batch_product_catalog (batch_id, sku);

ALTER TABLE store_transfer_items
ADD COLUMN system_reason TEXT NOT NULL DEFAULT '' CHECK (length(system_reason) <= 500);

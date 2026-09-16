ALTER TABLE store_transfer_batches ADD COLUMN arrival_schedule TEXT NOT NULL DEFAULT '{}';

CREATE TABLE store_transfer_shortages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  store_code TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'regular',
  demand_quantity INTEGER NOT NULL CHECK (demand_quantity >= 0),
  allocated_quantity INTEGER NOT NULL CHECK (allocated_quantity >= 0),
  unfilled_quantity INTEGER NOT NULL CHECK (unfilled_quantity >= 0),
  reason TEXT NOT NULL,
  follow_up_status TEXT NOT NULL DEFAULT '待回拋主採購',
  current_arrival_date TEXT,
  next_arrival_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES store_transfer_batches(id),
  UNIQUE (batch_id, store_code, sku, item_type)
);

CREATE INDEX store_transfer_shortages_batch_store
ON store_transfer_shortages (batch_id, store_code, sku);

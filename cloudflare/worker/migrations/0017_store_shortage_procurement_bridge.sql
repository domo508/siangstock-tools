CREATE TABLE store_transfer_procurement_needs (
  store_code TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  source_batch_id TEXT NOT NULL,
  approved_demand_quantity INTEGER NOT NULL CHECK (approved_demand_quantity >= 0),
  allocated_quantity INTEGER NOT NULL CHECK (allocated_quantity >= 0),
  unfilled_quantity INTEGER NOT NULL CHECK (unfilled_quantity >= 0),
  covered_quantity INTEGER NOT NULL DEFAULT 0 CHECK (covered_quantity >= 0),
  needed_by TEXT,
  reason TEXT NOT NULL,
  handling_mode TEXT NOT NULL DEFAULT 'pending_decision' CHECK (handling_mode IN ('pending_decision', 'merge_next', 'new_order')),
  status TEXT NOT NULL DEFAULT 'awaiting_decision' CHECK (status IN ('awaiting_decision', 'waiting_merge', 'new_order', 'covered_waiting', 'arrived', 'resolved', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (store_code, sku)
);

CREATE INDEX store_transfer_procurement_needs_status
ON store_transfer_procurement_needs (status, needed_by, store_code, sku);

CREATE TABLE store_transfer_procurement_need_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  store_code TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  approved_demand_quantity INTEGER NOT NULL CHECK (approved_demand_quantity >= 0),
  allocated_quantity INTEGER NOT NULL CHECK (allocated_quantity >= 0),
  unfilled_quantity INTEGER NOT NULL CHECK (unfilled_quantity >= 0),
  needed_by TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (batch_id, store_code, sku)
);

CREATE TABLE procurement_pending_purchase_snapshot (
  sku TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  pending_quantity REAL NOT NULL CHECK (pending_quantity >= 0),
  expected_delivery_date TEXT,
  source_date TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE procurement_batch_store_needs (
  batch_id TEXT NOT NULL,
  store_code TEXT NOT NULL,
  sku TEXT NOT NULL,
  covered_quantity INTEGER NOT NULL CHECK (covered_quantity >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, store_code, sku),
  FOREIGN KEY (batch_id) REFERENCES procurement_batches(id)
);

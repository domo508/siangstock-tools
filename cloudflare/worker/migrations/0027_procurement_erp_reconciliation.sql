ALTER TABLE procurement_batches ADD COLUMN erp_created_at TEXT;
ALTER TABLE procurement_batches ADD COLUMN erp_created_by TEXT;

CREATE TABLE procurement_batch_items (
  batch_id TEXT NOT NULL REFERENCES procurement_batches(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 300),
  supplier TEXT NOT NULL DEFAULT '' CHECK (length(supplier) <= 120),
  approved_quantity REAL NOT NULL CHECK (approved_quantity >= 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  approved_amount REAL NOT NULL CHECK (approved_amount >= 0),
  erp_quantity REAL NOT NULL DEFAULT 0 CHECK (erp_quantity >= 0),
  received_quantity REAL NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  remaining_quantity REAL NOT NULL DEFAULT 0 CHECK (remaining_quantity >= 0),
  lifecycle_status TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, sku)
);

CREATE INDEX procurement_batch_items_sku
ON procurement_batch_items (sku, batch_id);

CREATE TABLE procurement_erp_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES procurement_batches(id) ON DELETE CASCADE,
  erp_reference TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'source_error', 'superseded')),
  source_status TEXT NOT NULL DEFAULT '' CHECK (length(source_status) <= 120),
  amount_before REAL NOT NULL CHECK (amount_before >= 0),
  amount_after REAL NOT NULL CHECK (amount_after >= 0),
  amount_delta REAL NOT NULL,
  difference_count INTEGER NOT NULL CHECK (difference_count >= 0),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  confirmed_at TEXT,
  confirmed_by TEXT,
  reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  UNIQUE (batch_id, fingerprint)
);

CREATE INDEX procurement_erp_reconciliations_batch_status
ON procurement_erp_reconciliations (batch_id, status, created_at DESC);

CREATE TABLE procurement_erp_reconciliation_items (
  reconciliation_id INTEGER NOT NULL REFERENCES procurement_erp_reconciliations(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 300),
  difference_type TEXT NOT NULL CHECK (difference_type IN ('unchanged', 'added', 'removed', 'quantity', 'price')),
  approved_quantity REAL NOT NULL CHECK (approved_quantity >= 0),
  erp_quantity REAL NOT NULL CHECK (erp_quantity >= 0),
  unit_cost_before REAL NOT NULL CHECK (unit_cost_before >= 0),
  unit_cost_after REAL NOT NULL CHECK (unit_cost_after >= 0),
  received_quantity REAL NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  remaining_quantity REAL NOT NULL DEFAULT 0 CHECK (remaining_quantity >= 0),
  lifecycle_status TEXT NOT NULL DEFAULT '' CHECK (length(lifecycle_status) <= 120),
  amount_delta REAL NOT NULL,
  PRIMARY KEY (reconciliation_id, sku, difference_type)
);

CREATE INDEX procurement_erp_reconciliation_items_reconciliation
ON procurement_erp_reconciliation_items (reconciliation_id, sku);

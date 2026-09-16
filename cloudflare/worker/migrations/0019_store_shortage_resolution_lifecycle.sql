ALTER TABLE store_transfer_procurement_needs
ADD COLUMN fulfilled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0);

ALTER TABLE store_transfer_procurement_needs
ADD COLUMN resolution_note TEXT;

ALTER TABLE store_transfer_procurement_needs
ADD COLUMN resolved_at TEXT;

ALTER TABLE store_transfer_procurement_needs
ADD COLUMN resolved_by TEXT;

CREATE TABLE procurement_pending_purchase_runs (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source_date TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE store_transfer_procurement_need_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_code TEXT NOT NULL,
  sku TEXT NOT NULL,
  source_batch_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('arrival_detected', 'later_transfer_fulfilled', 'manual_resolved', 'manual_cancelled')),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  status_before TEXT NOT NULL,
  status_after TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX store_transfer_procurement_need_events_lookup
ON store_transfer_procurement_need_events (store_code, sku, created_at DESC);

CREATE TABLE store_transfer_batches (
  id TEXT PRIMARY KEY,
  week_key TEXT NOT NULL CHECK (week_key GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'),
  proposal_date TEXT NOT NULL,
  response_due_at TEXT NOT NULL,
  lock_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'review', 'approved', 'erp_created', 'closed', 'cancelled')),
  store_codes TEXT NOT NULL CHECK (length(store_codes) <= 512),
  item_count INTEGER NOT NULL CHECK (item_count >= 0),
  suggested_quantity INTEGER NOT NULL CHECK (suggested_quantity >= 0),
  approved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (approved_quantity >= 0),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE INDEX store_transfer_batches_week_status
ON store_transfer_batches (week_key, status, updated_at DESC);

CREATE TABLE store_transfer_items (
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
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (batch_id, store_code, sku)
);

CREATE INDEX store_transfer_items_batch_store
ON store_transfer_items (batch_id, store_code, sku);

CREATE TABLE store_transfer_store_status (
  batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  store_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'saved', 'submitted', 'locked', 'approved', 'closed')),
  submitted_at TEXT,
  submitted_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, store_code)
);

CREATE TABLE store_transfer_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  store_code TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'store_saved', 'store_submitted', 'hq_approved', 'erp_created', 'closed', 'cancelled')),
  summary TEXT NOT NULL CHECK (length(summary) <= 500),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX store_transfer_events_batch_created
ON store_transfer_events (batch_id, created_at DESC);

-- Workflow metadata only. Customer data and order lines belong in company Drive.
CREATE TABLE IF NOT EXISTS store_orders (
  id TEXT PRIMARY KEY,
  store_code TEXT NOT NULL,
  business_date TEXT NOT NULL,
  paper_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  version INTEGER NOT NULL DEFAULT 0,
  drive_id TEXT,
  content_hash TEXT,
  batch_id TEXT,
  erp_number TEXT,
  erp_created_at TEXT,
  recycled_at TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  operation_id TEXT,
  operation_hash TEXT,
  lock_until TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS store_orders_paper ON store_orders(store_code, paper_hash) WHERE paper_hash IS NOT NULL AND status != 'cancelled';
CREATE INDEX IF NOT EXISTS store_orders_queue ON store_orders(store_code, business_date, status);
CREATE TABLE IF NOT EXISTS store_order_sources (
  file_id TEXT PRIMARY KEY,
  store_code TEXT NOT NULL,
  digest TEXT NOT NULL,
  order_id TEXT,
  archived_id TEXT,
  created_at TEXT NOT NULL,
  duplicate_of TEXT,
  source_md5 TEXT
);
CREATE INDEX IF NOT EXISTS store_order_source_digest ON store_order_sources(store_code, digest);
CREATE TABLE IF NOT EXISTS store_order_batches (
  id TEXT PRIMARY KEY,
  store_code TEXT NOT NULL,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preparing',
  operation_id TEXT NOT NULL UNIQUE,
  operation_hash TEXT NOT NULL,
  manifest_id TEXT,
  manifest_hash TEXT,
  previous_batch_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  lock_until TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS store_order_day_lock ON store_order_batches(store_code, business_date) WHERE status = 'preparing';
CREATE TABLE IF NOT EXISTS store_order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  batch_id TEXT,
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  created_at TEXT NOT NULL
);

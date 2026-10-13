ALTER TABLE store_transfer_store_status ADD COLUMN correction_mode TEXT CHECK (correction_mode IS NULL OR correction_mode IN ('hq', 'store'));
ALTER TABLE store_transfer_store_status ADD COLUMN correction_reason TEXT CHECK (correction_reason IS NULL OR length(correction_reason) <= 300);
ALTER TABLE store_transfer_store_status ADD COLUMN correction_opened_at TEXT;
ALTER TABLE store_transfer_store_status ADD COLUMN correction_opened_by TEXT;
ALTER TABLE store_transfer_store_status ADD COLUMN correction_revision INTEGER NOT NULL DEFAULT 0 CHECK (correction_revision >= 0);

CREATE TABLE store_transfer_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  store_code TEXT NOT NULL,
  correction_revision INTEGER NOT NULL CHECK (correction_revision >= 1),
  mode TEXT NOT NULL CHECK (mode IN ('hq', 'store')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  item_snapshot TEXT NOT NULL CHECK (json_valid(item_snapshot)),
  status TEXT NOT NULL CHECK (status IN ('open', 'approved')),
  opened_at TEXT NOT NULL,
  opened_by TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT,
  UNIQUE (batch_id, store_code, correction_revision)
);

CREATE INDEX store_transfer_corrections_batch_store
ON store_transfer_corrections (batch_id, store_code, correction_revision DESC);

CREATE TABLE store_transfer_events_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  store_code TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created', 'store_saved', 'store_submitted', 'store_withdrawn',
    'hq_approved', 'erp_created', 'closed', 'cancelled',
    'hq_correction_opened', 'store_returned', 'correction_approved'
  )),
  summary TEXT NOT NULL CHECK (length(summary) <= 500),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

INSERT INTO store_transfer_events_v3 (id, batch_id, store_code, event_type, summary, created_at, created_by)
SELECT id, batch_id, store_code, event_type, summary, created_at, created_by
FROM store_transfer_events;

DROP TABLE store_transfer_events;
ALTER TABLE store_transfer_events_v3 RENAME TO store_transfer_events;

CREATE INDEX store_transfer_events_batch_created
ON store_transfer_events (batch_id, created_at DESC);

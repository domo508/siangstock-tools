ALTER TABLE store_transfer_store_status ADD COLUMN reply_deadline_at TEXT;
CREATE TABLE store_transfer_reply_extensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  store_code TEXT NOT NULL,
  previous_deadline_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  batch_revision INTEGER NOT NULL,
  UNIQUE (batch_id, batch_revision)
);
CREATE INDEX store_transfer_reply_extensions_store
ON store_transfer_reply_extensions(batch_id, store_code, id DESC);

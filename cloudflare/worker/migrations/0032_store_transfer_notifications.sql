CREATE TABLE store_transfer_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  store_code TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  provider_message_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_attempt_at TEXT,
  sent_at TEXT,
  error_summary TEXT CHECK (error_summary IS NULL OR length(error_summary) <= 500),
  created_at TEXT NOT NULL,
  UNIQUE (batch_id, store_code)
);

CREATE INDEX store_transfer_notifications_status_created
ON store_transfer_notifications (status, created_at);

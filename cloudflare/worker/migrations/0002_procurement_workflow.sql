CREATE TABLE procurement_batches (
  id TEXT PRIMARY KEY,
  analysis_month TEXT NOT NULL CHECK (analysis_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  supplier_summary TEXT NOT NULL CHECK (length(supplier_summary) <= 4096),
  status TEXT NOT NULL CHECK (status IN ('pending_approval', 'approved', 'erp_created', 'received', 'revoked')),
  suggested_amount REAL NOT NULL CHECK (suggested_amount >= 0),
  manual_amount REAL NOT NULL CHECK (manual_amount >= 0),
  blocked_amount REAL NOT NULL CHECK (blocked_amount >= 0),
  approved_amount REAL NOT NULL CHECK (approved_amount >= 0),
  adjustment_amount REAL NOT NULL,
  budget_amount REAL NOT NULL,
  payment_current_month REAL NOT NULL CHECK (payment_current_month >= 0),
  payment_future_months REAL NOT NULL CHECK (payment_future_months >= 0),
  payment_schedule TEXT NOT NULL CHECK (length(payment_schedule) <= 8192),
  warning_summary TEXT NOT NULL CHECK (length(warning_summary) <= 1024),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  approved_at TEXT,
  approved_by TEXT,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  idempotency_key TEXT NOT NULL UNIQUE,
  CHECK (ABS((manual_amount - blocked_amount) - approved_amount) < 0.01),
  CHECK (ABS((suggested_amount + adjustment_amount) - approved_amount) < 0.01),
  CHECK (ABS((payment_current_month + payment_future_months) - approved_amount) < 0.01)
);

CREATE INDEX procurement_batches_month_status
ON procurement_batches (analysis_month, status, updated_at DESC);

CREATE TABLE procurement_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES procurement_batches(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('submitted', 'approved', 'revoked', 'corrected', 'erp_created', 'received')),
  amount_before REAL NOT NULL,
  amount_delta REAL NOT NULL,
  amount_after REAL NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) <= 500),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  CHECK (ABS((amount_before + amount_delta) - amount_after) < 0.01)
);

CREATE INDEX procurement_events_batch_created
ON procurement_events (batch_id, created_at DESC);

CREATE TABLE procurement_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES procurement_batches(id),
  event_id INTEGER NOT NULL REFERENCES procurement_events(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('approved', 'revoked', 'corrected')),
  recipient TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  provider_message_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_attempt_at TEXT,
  sent_at TEXT,
  error_summary TEXT CHECK (error_summary IS NULL OR length(error_summary) <= 500),
  created_at TEXT NOT NULL,
  UNIQUE (event_id, recipient)
);

CREATE INDEX procurement_notifications_status_created
ON procurement_notifications (status, created_at);

CREATE TABLE procurement_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  notification_recipient TEXT NOT NULL,
  notification_retention_months INTEGER NOT NULL CHECK (notification_retention_months BETWEEN 1 AND 12),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT INTO procurement_settings (
  id, notification_recipient, notification_retention_months, updated_at, updated_by
) VALUES (
  1, 'siang01@siangapato.com.tw', 12, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system'
);

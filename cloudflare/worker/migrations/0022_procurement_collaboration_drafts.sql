CREATE TABLE procurement_collaboration_drafts (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 100),
  analysis_month TEXT NOT NULL CHECK (analysis_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  checkpoint TEXT NOT NULL CHECK (checkpoint IN ('month-start', 'mid-month', 'month-end')),
  workflow_type TEXT NOT NULL CHECK (length(workflow_type) BETWEEN 1 AND 40),
  stage TEXT NOT NULL CHECK (stage IN ('analysis', 'downloaded', 'first_reviewed', 'second_reviewed', 'pending_approval', 'approved', 'erp_created')),
  work_unit_label TEXT NOT NULL DEFAULT '' CHECK (length(work_unit_label) <= 300),
  supplier_summary TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(supplier_summary)),
  amount REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payload_encoding TEXT NOT NULL CHECK (payload_encoding IN ('gzip-base64', 'json')),
  payload TEXT NOT NULL CHECK (length(payload) BETWEEN 2 AND 6291456),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX procurement_collaboration_drafts_month_updated
ON procurement_collaboration_drafts (analysis_month, updated_at DESC);

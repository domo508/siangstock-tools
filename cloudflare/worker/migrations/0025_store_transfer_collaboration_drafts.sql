CREATE TABLE store_transfer_collaboration_drafts (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 100),
  week_key TEXT NOT NULL CHECK (week_key GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'),
  proposal_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  store_codes TEXT NOT NULL CHECK (json_valid(store_codes) AND length(store_codes) <= 512),
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  difference_count INTEGER NOT NULL DEFAULT 0 CHECK (difference_count >= 0),
  payload TEXT NOT NULL CHECK (json_valid(payload) AND length(payload) BETWEEN 2 AND 1572864),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  finalized_batch_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE UNIQUE INDEX store_transfer_collaboration_one_active_week
ON store_transfer_collaboration_drafts (week_key)
WHERE status = 'draft';

CREATE INDEX store_transfer_collaboration_updated
ON store_transfer_collaboration_drafts (updated_at DESC);

ALTER TABLE store_transfer_batches ADD COLUMN source_collaboration_id TEXT REFERENCES store_transfer_collaboration_drafts(id);

CREATE UNIQUE INDEX store_transfer_batches_source_collaboration
ON store_transfer_batches (source_collaboration_id)
WHERE source_collaboration_id IS NOT NULL;

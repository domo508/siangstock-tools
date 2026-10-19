-- The composite primary keys already provide these lookup indexes. Removing the
-- duplicates avoids maintaining the same B-tree twice on every snapshot write.
DROP INDEX IF EXISTS store_transfer_manual_item_facts_lookup;
DROP INDEX IF EXISTS store_transfer_batch_product_catalog_lookup;

-- Add the headquarters draft-save event introduced by the review workflow.
CREATE TABLE store_transfer_events_v4 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  store_code TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created', 'store_saved', 'store_submitted', 'store_withdrawn',
    'hq_approved', 'erp_created', 'closed', 'cancelled',
    'hq_correction_opened', 'store_returned', 'correction_approved',
    'hq_review_saved'
  )),
  summary TEXT NOT NULL CHECK (length(summary) <= 500),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

INSERT INTO store_transfer_events_v4 (id, batch_id, store_code, event_type, summary, created_at, created_by)
SELECT id, batch_id, store_code, event_type, summary, created_at, created_by
FROM store_transfer_events;

DROP TABLE store_transfer_events;
ALTER TABLE store_transfer_events_v4 RENAME TO store_transfer_events;

CREATE INDEX store_transfer_events_batch_created
ON store_transfer_events (batch_id, created_at DESC);

-- Extend only still-actionable legacy default deadlines (Taipei 09:00 -> 18:00).
-- Preserve original deadlines and revision for audit; never touch quantities,
-- arrival schedules, approval states, ERP records or completed/historical batches.
CREATE TABLE store_transfer_deadline_adjustments (
  batch_id TEXT PRIMARY KEY REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  previous_response_due_at TEXT NOT NULL,
  previous_lock_at TEXT NOT NULL,
  response_due_at TEXT NOT NULL,
  lock_at TEXT NOT NULL,
  previous_revision INTEGER NOT NULL,
  applied_at TEXT NOT NULL,
  reason TEXT NOT NULL
);

INSERT INTO store_transfer_deadline_adjustments
SELECT b.id, b.response_due_at, b.lock_at,
       substr(b.response_due_at, 1, 10) || 'T10:00:00.000Z',
       substr(b.lock_at, 1, 10) || 'T10:00:00.000Z',
       b.revision, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       '門市回覆預設期限由台北時間09:00調整至同日18:00；未變更數量及核准狀態'
FROM store_transfer_batches b
WHERE b.deleted_at IS NULL AND b.status IN ('open', 'review')
  AND b.response_due_at = b.lock_at
  AND substr(b.lock_at, 12) IN ('01:00:00.000Z', '01:00:00Z')
  AND date(b.lock_at) >= date('now', '+8 hours')
  AND EXISTS (SELECT 1 FROM store_transfer_store_status s
              WHERE s.batch_id = b.id AND s.status IN ('pending', 'saved', 'submitted')
                AND s.erp_created_at IS NULL);

UPDATE store_transfer_batches
SET response_due_at = (SELECT a.response_due_at FROM store_transfer_deadline_adjustments a WHERE a.batch_id = store_transfer_batches.id),
    lock_at = (SELECT a.lock_at FROM store_transfer_deadline_adjustments a WHERE a.batch_id = store_transfer_batches.id),
    revision = revision + 1,
    updated_at = (SELECT a.applied_at FROM store_transfer_deadline_adjustments a WHERE a.batch_id = store_transfer_batches.id),
    updated_by = 'system:reply-deadline-1800'
WHERE id IN (SELECT batch_id FROM store_transfer_deadline_adjustments);

ALTER TABLE store_transfer_collaboration_drafts ADD COLUMN removed_at TEXT;
ALTER TABLE store_transfer_collaboration_drafts ADD COLUMN removed_by TEXT;

DROP INDEX store_transfer_collaboration_one_active_week;

CREATE UNIQUE INDEX store_transfer_collaboration_one_active_week
ON store_transfer_collaboration_drafts (week_key)
WHERE status = 'draft' AND removed_at IS NULL;

CREATE INDEX store_transfer_collaboration_visible_updated
ON store_transfer_collaboration_drafts (removed_at, updated_at DESC);

ALTER TABLE procurement_collaboration_drafts ADD COLUMN removed_at TEXT;
ALTER TABLE procurement_collaboration_drafts ADD COLUMN removed_by TEXT;

CREATE INDEX procurement_collaboration_drafts_active_month_updated
ON procurement_collaboration_drafts (analysis_month, removed_at, updated_at DESC);

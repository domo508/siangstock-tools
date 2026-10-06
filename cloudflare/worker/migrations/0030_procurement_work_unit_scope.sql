ALTER TABLE procurement_batches ADD COLUMN checkpoint TEXT;
ALTER TABLE procurement_batches ADD COLUMN parent_batch_id TEXT;
ALTER TABLE procurement_batches ADD COLUMN work_unit_ids TEXT NOT NULL DEFAULT '[]';

CREATE INDEX procurement_batches_parent_scope
ON procurement_batches (analysis_month, checkpoint, parent_batch_id, status);

ALTER TABLE procurement_collaboration_drafts ADD COLUMN parent_batch_id TEXT;
ALTER TABLE procurement_collaboration_drafts ADD COLUMN work_unit_ids TEXT NOT NULL DEFAULT '[]';

CREATE INDEX procurement_collaboration_parent_scope
ON procurement_collaboration_drafts (analysis_month, checkpoint, parent_batch_id, stage);

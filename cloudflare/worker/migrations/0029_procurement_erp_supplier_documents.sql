CREATE TABLE procurement_batch_erp_documents (
  batch_id TEXT NOT NULL REFERENCES procurement_batches(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL CHECK (length(supplier) BETWEEN 1 AND 120),
  erp_reference TEXT CHECK (erp_reference IS NULL OR length(erp_reference) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'erp_created')),
  erp_created_at TEXT,
  erp_created_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, supplier)
);

CREATE UNIQUE INDEX procurement_batch_erp_documents_reference
ON procurement_batch_erp_documents (erp_reference)
WHERE erp_reference IS NOT NULL;

CREATE INDEX procurement_batch_erp_documents_batch_status
ON procurement_batch_erp_documents (batch_id, status);

ALTER TABLE procurement_collaboration_drafts ADD COLUMN batch_id TEXT;
CREATE INDEX procurement_collaboration_drafts_batch_id
ON procurement_collaboration_drafts (batch_id);

ALTER TABLE procurement_batches ADD COLUMN workflow_type TEXT NOT NULL DEFAULT 'system_recommendation';
ALTER TABLE procurement_batches ADD COLUMN erp_reference TEXT;

CREATE UNIQUE INDEX procurement_batches_erp_reference_unique
ON procurement_batches (erp_reference)
WHERE erp_reference IS NOT NULL AND length(trim(erp_reference)) > 0;

ALTER TABLE store_transfer_batches ADD COLUMN deleted_at TEXT;
ALTER TABLE store_transfer_batches ADD COLUMN deleted_by TEXT;

CREATE INDEX store_transfer_batches_visible_updated
ON store_transfer_batches (deleted_at, updated_at DESC, created_at DESC);

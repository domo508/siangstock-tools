-- Recognition metadata only. Full completed output remains in restricted company Drive.
ALTER TABLE store_order_recognitions ADD COLUMN upstream_id TEXT;
ALTER TABLE store_order_recognitions ADD COLUMN deadline_at TEXT;
ALTER TABLE store_order_recognitions ADD COLUMN page_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_order_recognitions ADD COLUMN result_drive_id TEXT;
ALTER TABLE store_order_recognitions ADD COLUMN result_file_hash TEXT;
ALTER TABLE store_order_recognitions ADD COLUMN error_code TEXT;
ALTER TABLE store_order_recognitions ADD COLUMN poll_until TEXT;
CREATE INDEX recognition_source_page ON store_order_recognitions(file_id,actor,page_index,created_at);

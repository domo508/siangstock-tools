-- Metadata only: no image, file name, extraction, customer details or API token.
CREATE TABLE IF NOT EXISTS store_order_recognitions (
 id TEXT PRIMARY KEY,
 store_code TEXT NOT NULL,
 file_id TEXT NOT NULL,
 actor TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 status TEXT NOT NULL,
 business_day TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 lock_until TEXT,
 result_hash TEXT
);
CREATE INDEX IF NOT EXISTS store_order_recognition_day ON store_order_recognitions(store_code,business_day);
CREATE INDEX IF NOT EXISTS store_order_recognition_lock ON store_order_recognitions(status,lock_until);

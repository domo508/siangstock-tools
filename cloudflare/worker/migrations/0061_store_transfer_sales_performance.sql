-- Numeric historical/current sales evidence, independent from batch workflow.
CREATE TABLE store_transfer_sales_performance (
 id TEXT PRIMARY KEY,
 batch_id TEXT REFERENCES store_transfer_batches(id),
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL
);
CREATE INDEX store_transfer_sales_performance_created ON store_transfer_sales_performance(created_at);

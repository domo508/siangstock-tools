-- Numeric, store-level summaries only. Original reports and remarks stay local.
CREATE TABLE store_transfer_performance_snapshots (
 batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id),
 store_code TEXT NOT NULL,
 inventory_date TEXT NOT NULL,
 sales_start TEXT NOT NULL,
 sales_end TEXT NOT NULL,
 remark_since TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 created_at TEXT NOT NULL,
 PRIMARY KEY(batch_id,store_code)
);
CREATE INDEX store_transfer_performance_date ON store_transfer_performance_snapshots(inventory_date,store_code);

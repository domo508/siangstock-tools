-- Metadata-only AI cost/idempotency ledger. Never store source text or tokens.
CREATE TABLE IF NOT EXISTS marketing_ai_operations (
 id TEXT PRIMARY KEY,
 actor_hash TEXT NOT NULL,
 input_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('started','completed','failed'))
);
CREATE INDEX IF NOT EXISTS marketing_ai_operations_day ON marketing_ai_operations(created_at,actor_hash);

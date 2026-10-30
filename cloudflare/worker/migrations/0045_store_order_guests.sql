-- Guest access metadata; never stores plaintext invitation codes, IPs or customer data.
ALTER TABLE store_orders ADD COLUMN created_actor TEXT NOT NULL DEFAULT '';
UPDATE store_orders SET created_actor=updated_by WHERE created_actor='';
CREATE TABLE IF NOT EXISTS store_order_invites (
 id TEXT PRIMARY KEY,store_code TEXT NOT NULL,code_hash TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL,max_uses INTEGER NOT NULL,uses INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,created_by TEXT NOT NULL,revoked_at TEXT,version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS store_order_guest_sessions (
 id TEXT PRIMARY KEY,invite_id TEXT NOT NULL,store_code TEXT NOT NULL,
 expires_at TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS store_order_guest_session_invite ON store_order_guest_sessions(invite_id);
CREATE TABLE IF NOT EXISTS store_order_guest_limits(bucket TEXT PRIMARY KEY,attempts INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS store_order_settings (
 key TEXT PRIMARY KEY,file_id TEXT NOT NULL,content_hash TEXT NOT NULL,
 source_version TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL
);

-- Staff authorization only; never customer or order content.
CREATE TABLE IF NOT EXISTS store_order_hq_access (
 id INTEGER PRIMARY KEY CHECK(id=1), emails TEXT NOT NULL,
 version INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
INSERT OR IGNORE INTO store_order_hq_access(id,emails,version,updated_at,updated_by)
 VALUES(1,'[]',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'migration');
CREATE TABLE IF NOT EXISTS store_order_hq_access_history (
 version INTEGER PRIMARY KEY, previous_emails TEXT NOT NULL, emails TEXT NOT NULL,
 updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS store_order_hq_access_audit AFTER UPDATE ON store_order_hq_access
BEGIN
 INSERT INTO store_order_hq_access_history(version,previous_emails,emails,updated_at,updated_by)
 VALUES(NEW.version,OLD.emails,NEW.emails,NEW.updated_at,NEW.updated_by);
END;

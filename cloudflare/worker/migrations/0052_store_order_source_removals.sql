-- Metadata only. Photo and reason remain in restricted company Drive.
CREATE TABLE store_order_source_controls (
 file_id TEXT PRIMARY KEY, store_code TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('removing','removed','restoring','active')),
 version INTEGER NOT NULL, operation_id TEXT NOT NULL, actor TEXT NOT NULL,
 record_id TEXT NOT NULL, updated_at TEXT NOT NULL, lease_token TEXT, lease_until TEXT
);
CREATE TABLE store_order_source_actions (
 operation_id TEXT PRIMARY KEY, file_id TEXT NOT NULL, store_code TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('remove','restore')), expected_version INTEGER NOT NULL,
 actor TEXT NOT NULL, record_id TEXT NOT NULL, record_hash TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX source_controls_store ON store_order_source_controls(store_code,state);
CREATE TRIGGER source_action_admit BEFORE INSERT ON store_order_source_actions BEGIN
 SELECT CASE WHEN NEW.expected_version != COALESCE((SELECT version FROM store_order_source_controls WHERE file_id=NEW.file_id),0)
 OR EXISTS(SELECT 1 FROM store_order_source_controls WHERE file_id=NEW.file_id AND (store_code!=NEW.store_code OR state IN ('removing','restoring')))
 OR (NEW.action='restore' AND NOT EXISTS(SELECT 1 FROM store_order_source_controls WHERE file_id=NEW.file_id AND state='removed'))
 OR (NEW.action='remove' AND EXISTS(SELECT 1 FROM store_order_source_controls WHERE file_id=NEW.file_id AND state='removed'))
 OR EXISTS(SELECT 1 FROM store_order_sources WHERE file_id=NEW.file_id AND (store_code!=NEW.store_code OR order_id IS NOT NULL OR duplicate_of IS NOT NULL))
 OR EXISTS(SELECT 1 FROM store_orders WHERE store_code=NEW.store_code AND lock_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 OR EXISTS(SELECT 1 FROM store_order_batches WHERE store_code=NEW.store_code AND status='preparing')
 OR EXISTS(SELECT 1 FROM store_order_recognitions WHERE file_id=NEW.file_id AND status='processing' AND lock_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 THEN RAISE(ABORT,'source_action_conflict') END;
END;
CREATE TRIGGER source_action_reserve AFTER INSERT ON store_order_source_actions BEGIN
 INSERT INTO store_order_source_controls(file_id,store_code,state,version,operation_id,actor,record_id,updated_at)
 VALUES(NEW.file_id,NEW.store_code,CASE NEW.action WHEN 'remove' THEN 'removing' ELSE 'restoring' END,NEW.expected_version+1,NEW.operation_id,NEW.actor,NEW.record_id,NEW.created_at)
 ON CONFLICT(file_id) DO UPDATE SET state=excluded.state,version=excluded.version,operation_id=excluded.operation_id,actor=excluded.actor,record_id=excluded.record_id,updated_at=excluded.updated_at,lease_token=NULL,lease_until=NULL;
END;
CREATE TRIGGER source_action_claim BEFORE UPDATE OF order_id ON store_order_sources
 WHEN NEW.order_id IS NOT NULL AND EXISTS(SELECT 1 FROM store_order_source_controls WHERE file_id=NEW.file_id AND state!='active')
 BEGIN SELECT RAISE(ABORT,'source_action_conflict'); END;
CREATE TRIGGER source_action_order_insert BEFORE INSERT ON store_orders
 WHEN EXISTS(SELECT 1 FROM store_order_source_controls WHERE store_code=NEW.store_code AND state IN ('removing','restoring'))
 BEGIN SELECT RAISE(ABORT,'source_action_conflict'); END;
CREATE TRIGGER source_action_order_lock BEFORE UPDATE OF lock_until ON store_orders
 WHEN NEW.lock_until IS NOT NULL AND EXISTS(SELECT 1 FROM store_order_source_controls WHERE store_code=NEW.store_code AND state IN ('removing','restoring'))
 BEGIN SELECT RAISE(ABORT,'source_action_conflict'); END;
CREATE TRIGGER source_action_settle BEFORE INSERT ON store_order_batches
 WHEN NEW.status='preparing' AND EXISTS(SELECT 1 FROM store_order_source_controls WHERE store_code=NEW.store_code AND state IN ('removing','restoring'))
 BEGIN SELECT RAISE(ABORT,'source_action_conflict'); END;
CREATE TRIGGER source_action_recognize BEFORE INSERT ON store_order_recognitions
 WHEN EXISTS(SELECT 1 FROM store_order_source_controls WHERE file_id=NEW.file_id AND state!='active')
 BEGIN SELECT RAISE(ABORT,'source_action_conflict'); END;

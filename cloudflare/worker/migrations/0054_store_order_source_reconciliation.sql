-- Metadata only; reasons and original evidence remain in restricted Drive.
ALTER TABLE store_order_source_actions ADD COLUMN hq_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_order_source_actions ADD COLUMN record_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_order_source_controls ADD COLUMN record_only INTEGER NOT NULL DEFAULT 0;
DROP TRIGGER source_action_admit;
DROP TRIGGER source_action_reserve;
CREATE TRIGGER source_action_admit BEFORE INSERT ON store_order_source_actions BEGIN
 SELECT CASE WHEN NEW.expected_version != COALESCE((SELECT version FROM store_order_source_controls WHERE file_id=NEW.file_id),0)
 OR EXISTS(SELECT 1 FROM store_order_source_controls WHERE file_id=NEW.file_id AND (store_code!=NEW.store_code OR state IN ('removing','restoring')))
 OR (NEW.action='restore' AND NOT EXISTS(SELECT 1 FROM store_order_source_controls WHERE file_id=NEW.file_id AND state='removed'))
 OR (NEW.action='remove' AND EXISTS(SELECT 1 FROM store_order_source_controls WHERE file_id=NEW.file_id AND state='removed'))
 OR EXISTS(SELECT 1 FROM store_order_sources WHERE file_id=NEW.file_id AND (store_code!=NEW.store_code OR (order_id IS NOT NULL AND duplicate_of IS NULL) OR (duplicate_of IS NOT NULL AND NEW.hq_review!=1)))
 OR (NEW.action='restore' AND EXISTS(SELECT 1 FROM store_order_sources original JOIN store_order_sources other ON other.store_code=original.store_code AND other.digest=original.digest AND other.file_id!=original.file_id WHERE original.file_id=NEW.file_id AND original.duplicate_of IS NULL AND other.duplicate_of IS NULL AND NOT EXISTS(SELECT 1 FROM store_order_source_controls cx WHERE cx.file_id=other.file_id AND cx.state!='active')))
 OR EXISTS(SELECT 1 FROM store_orders WHERE store_code=NEW.store_code AND lock_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 OR EXISTS(SELECT 1 FROM store_order_batches WHERE store_code=NEW.store_code AND status='preparing')
 OR EXISTS(SELECT 1 FROM store_order_recognitions WHERE file_id=NEW.file_id AND status='processing' AND lock_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 THEN RAISE(ABORT,'source_action_conflict') END;
END;
CREATE TRIGGER source_action_reserve AFTER INSERT ON store_order_source_actions BEGIN
 INSERT INTO store_order_source_controls(file_id,store_code,state,version,operation_id,actor,record_id,updated_at,record_only)
 VALUES(NEW.file_id,NEW.store_code,CASE NEW.action WHEN 'remove' THEN 'removing' ELSE 'restoring' END,NEW.expected_version+1,NEW.operation_id,NEW.actor,NEW.record_id,NEW.created_at,NEW.record_only)
 ON CONFLICT(file_id) DO UPDATE SET state=excluded.state,version=excluded.version,operation_id=excluded.operation_id,actor=excluded.actor,record_id=excluded.record_id,updated_at=excluded.updated_at,lease_token=NULL,lease_until=NULL,record_only=excluded.record_only;
END;
-- Registration cannot race an in-progress disposition for the same content.
CREATE TRIGGER source_registration_disposition BEFORE INSERT ON store_order_sources
 WHEN EXISTS(SELECT 1 FROM store_order_sources s JOIN store_order_source_controls x ON x.file_id=s.file_id WHERE s.store_code=NEW.store_code AND s.digest=NEW.digest AND x.state IN ('removing','restoring'))
 BEGIN SELECT RAISE(ABORT,'source_action_conflict'); END;

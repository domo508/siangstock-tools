CREATE TABLE IF NOT EXISTS procurement_activities (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), settings TEXT NOT NULL CHECK(json_valid(settings)),
 origin_parent_id TEXT UNIQUE, origin_month TEXT NOT NULL DEFAULT '', transfer_plan_id TEXT UNIQUE,
 change_reason TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS procurement_activity_identity ON procurement_activities(json_extract(settings,'$.name'),json_extract(settings,'$.scope'),substr(json_extract(settings,'$.startDate'),1,4));
CREATE TABLE IF NOT EXISTS procurement_activity_history (
 activity_id TEXT NOT NULL, revision INTEGER NOT NULL, settings TEXT NOT NULL, change_reason TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
 PRIMARY KEY(activity_id,revision)
);
CREATE TRIGGER IF NOT EXISTS procurement_activity_insert AFTER INSERT ON procurement_activities BEGIN
 INSERT INTO procurement_activity_history VALUES(NEW.id,NEW.revision,NEW.settings,NEW.change_reason,NEW.updated_at,NEW.updated_by);
END;
CREATE TRIGGER IF NOT EXISTS procurement_activity_update AFTER UPDATE OF settings,revision ON procurement_activities BEGIN
 INSERT INTO procurement_activity_history VALUES(NEW.id,NEW.revision,NEW.settings,NEW.change_reason,NEW.updated_at,NEW.updated_by);
END;
CREATE UNIQUE INDEX IF NOT EXISTS transfer_activity_registry_identity ON store_transfer_activity_plans(json_extract(source,'$.activityId')) WHERE json_extract(source,'$.activityId') IS NOT NULL;

CREATE TABLE IF NOT EXISTS procurement_activity_batches (
 batch_id TEXT PRIMARY KEY REFERENCES procurement_batches(id), activity_id TEXT NOT NULL REFERENCES procurement_activities(id), activity_revision INTEGER NOT NULL CHECK(activity_revision>0)
);
CREATE INDEX IF NOT EXISTS procurement_activity_batches_activity ON procurement_activity_batches(activity_id);

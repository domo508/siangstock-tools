CREATE TABLE IF NOT EXISTS store_transfer_activity_plans (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('draft','confirmed','cancelled')),
  source TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS store_transfer_activity_plan_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id TEXT NOT NULL,
  revision INTEGER NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL,
  config TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS store_transfer_activity_identity ON store_transfer_activity_plans
 (json_extract(source,'$.name'),json_extract(source,'$.startDate'),json_extract(source,'$.endDate'),json_extract(source,'$.scope'));
CREATE TRIGGER IF NOT EXISTS store_transfer_activity_plan_insert AFTER INSERT ON store_transfer_activity_plans
BEGIN
 INSERT INTO store_transfer_activity_plan_history(plan_id,revision,status,source,config,updated_at,updated_by)
 VALUES(NEW.id,NEW.revision,NEW.status,NEW.source,NEW.config,NEW.updated_at,NEW.updated_by);
END;
CREATE TRIGGER IF NOT EXISTS store_transfer_activity_plan_update AFTER UPDATE ON store_transfer_activity_plans
BEGIN
 INSERT INTO store_transfer_activity_plan_history(plan_id,revision,status,source,config,updated_at,updated_by)
 VALUES(NEW.id,NEW.revision,NEW.status,NEW.source,NEW.config,NEW.updated_at,NEW.updated_by);
END;

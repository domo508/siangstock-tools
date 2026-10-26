-- Department metadata only; no Excel, prices, customer data, or tool permissions.
CREATE TABLE homepage_departments (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 version INTEGER NOT NULL CHECK (version >= 1),
 payload TEXT NOT NULL CHECK (json_valid(payload) AND length(payload) <= 32768),
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL
);
CREATE TABLE homepage_department_history (
 version INTEGER PRIMARY KEY,
 payload TEXT NOT NULL CHECK (json_valid(payload) AND length(payload) <= 32768),
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL
);
CREATE TRIGGER homepage_departments_history
AFTER UPDATE OF version, payload, updated_at, updated_by ON homepage_departments
BEGIN
 INSERT INTO homepage_department_history(version,payload,updated_at,updated_by)
 VALUES(NEW.version,NEW.payload,NEW.updated_at,NEW.updated_by);
END;
INSERT INTO homepage_departments(id,version,payload,updated_at,updated_by)
VALUES(1,1,'[{"toolId":"cost-analysis","primary":"admin","collaborators":[]},{"toolId":"supplier-reconciliation","primary":"admin","collaborators":[]},{"toolId":"inventory","primary":"admin","collaborators":[]},{"toolId":"procurement-planning","primary":"merch","collaborators":[]},{"toolId":"competitive-analysis","primary":"merch","collaborators":["design"]},{"toolId":"store-transfer","primary":"merch","collaborators":["store"]},{"toolId":"store-orders","primary":"store","collaborators":["merch"]}]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'system');
INSERT INTO homepage_department_history SELECT version,payload,updated_at,updated_by FROM homepage_departments WHERE id=1;

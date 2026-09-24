CREATE TABLE store_transfer_display_exceptions (
  store_code TEXT NOT NULL,
  sku TEXT NOT NULL COLLATE NOCASE,
  display_quantity INTEGER NOT NULL CHECK (display_quantity BETWEEN 0 AND 100),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (store_code, sku)
);

CREATE INDEX store_transfer_display_exceptions_store_enabled
ON store_transfer_display_exceptions (store_code, enabled, sku);

CREATE TABLE store_transfer_display_exception_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_code TEXT NOT NULL,
  sku TEXT NOT NULL,
  display_quantity INTEGER NOT NULL,
  reason TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'disabled', 'enabled')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX store_transfer_display_exception_events_store_created
ON store_transfer_display_exception_events (store_code, created_at DESC);

UPDATE procurement_rules_current
SET version = version + 1,
    payload = replace(payload, '全部有銷售資料的營運門市', '近42天有該品號現場銷售的營運門市'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_by = 'system:migration-0028'
WHERE id = 1
  AND instr(payload, '全部有銷售資料的營運門市') > 0;

INSERT INTO procurement_rules_history (version, payload, change_reason, changed_at, changed_by)
SELECT version, payload, '門市週調撥：釐清42天銷售適用範圍並新增門市展示例外', updated_at, updated_by
FROM procurement_rules_current
WHERE id = 1 AND updated_by = 'system:migration-0028';

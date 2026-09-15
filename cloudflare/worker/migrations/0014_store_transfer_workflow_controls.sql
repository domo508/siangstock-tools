ALTER TABLE store_transfer_items ADD COLUMN hq_reason TEXT NOT NULL DEFAULT '' CHECK (length(hq_reason) <= 300);

ALTER TABLE store_transfer_store_status ADD COLUMN withdrawn_at TEXT;
ALTER TABLE store_transfer_store_status ADD COLUMN withdrawn_by TEXT;
ALTER TABLE store_transfer_store_status ADD COLUMN erp_created_at TEXT;
ALTER TABLE store_transfer_store_status ADD COLUMN erp_created_by TEXT;

CREATE TABLE store_transfer_events_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES store_transfer_batches(id) ON DELETE CASCADE,
  store_code TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created', 'store_saved', 'store_submitted', 'store_withdrawn',
    'hq_approved', 'erp_created', 'closed', 'cancelled'
  )),
  summary TEXT NOT NULL CHECK (length(summary) <= 500),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

INSERT INTO store_transfer_events_v2 (id, batch_id, store_code, event_type, summary, created_at, created_by)
SELECT id, batch_id, store_code, event_type, summary, created_at, created_by
FROM store_transfer_events;

DROP TABLE store_transfer_events;
ALTER TABLE store_transfer_events_v2 RENAME TO store_transfer_events;

CREATE INDEX store_transfer_events_batch_created
ON store_transfer_events (batch_id, created_at DESC);

UPDATE procurement_rules_current
SET version = version + 1,
    payload = json_set(
      payload,
      '$.storeInventory.status', 'active',
      '$.storeInventory.trialStores', json('["R00","R06"]'),
      '$.storeInventory.workdayHolidays', json('["2026-09-25","2026-09-28","2026-10-09","2026-10-26","2026-12-25"]'),
      '$.storeInventory.rules', json('[
        {"name":"獨立5尺商品","enabled":true,"scope":"R00、R06","matchText":"獨立5尺","inventoryRole":"不可售展示","quantity":1,"priority":120},
        {"name":"6×7尺雙人兩用被套","enabled":true,"scope":"R00、R06","matchText":"6×7尺|雙人兩用被套","inventoryRole":"不可售展示","quantity":1,"priority":115},
        {"name":"6×7尺雙人薄被套天絲／華爾紗","enabled":true,"scope":"全部有銷售資料的營運門市","matchText":"6×7尺|雙人薄被套|天絲、華爾紗","inventoryRole":"可售最低庫存","quantity":1,"priority":110},
        {"name":"獨立3.5尺、6尺、7尺商品","enabled":true,"scope":"全部有銷售資料的營運門市","matchText":"獨立3.5尺、6尺、7尺","inventoryRole":"可售最低庫存","quantity":1,"priority":105},
        {"name":"6×7尺雙人薄被套一般材質","enabled":true,"scope":"R00、R06","matchText":"6×7尺|雙人薄被套","inventoryRole":"不可售展示","quantity":1,"priority":100},
        {"name":"單人薄被套／單人兩用被套材質前2名","enabled":true,"scope":"R00、R06","matchText":"單人薄被套、單人兩用被套|各材質前2名","inventoryRole":"可售特殊備貨","quantity":1,"priority":90},
        {"name":"枕套2入組","enabled":true,"scope":"R00、R06","matchText":"枕套2入組","inventoryRole":"不可售展示","quantity":1,"priority":80},
        {"name":"枕套1入／單入","enabled":true,"scope":"R00、R06","matchText":"枕套1入、單入","inventoryRole":"不可售展示","quantity":2,"priority":80},
        {"name":"枕頭／枕芯","enabled":true,"scope":"R00、R06","matchText":"枕頭、枕芯","inventoryRole":"不可售展示","quantity":2,"priority":80},
        {"name":"抱枕、靠枕及相關套件","enabled":true,"scope":"R00、R06","matchText":"抱枕、靠枕及相關套件","inventoryRole":"不可售展示","quantity":1,"priority":80},
        {"name":"有尺寸配件","enabled":true,"scope":"R00、R06","matchText":"配件|有尺寸","inventoryRole":"不可售展示","quantity":1,"priority":70}
      ]'),
      '$.storeInventory.calendarSource', '行政院人事行政總處115年辦公日曆表；公司可依實際營業日調整'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_by = 'system:migration-0014'
WHERE id = 1;

INSERT INTO procurement_rules_history (version, payload, change_reason, changed_at, changed_by)
SELECT version, payload, '門市週調撥：更正展示／最低庫存規則並加入2026作業日曆', updated_at, updated_by
FROM procurement_rules_current WHERE id = 1;

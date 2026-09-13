CREATE TABLE procurement_rules_current (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL CHECK (version >= 1),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE procurement_rules_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL UNIQUE,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  change_reason TEXT NOT NULL CHECK (length(change_reason) BETWEEN 1 AND 500),
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL
);

INSERT INTO procurement_rules_current (id, version, payload, updated_at, updated_by) VALUES (
  1,
  1,
  json_object(
    'suppliers', json('[
      {"name":"家禾","aliases":[],"country":"國內","leadDays":40,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
      {"name":"上林","aliases":[],"country":"國內","leadDays":5,"reviewDays":28,"automaticPurchase":true,"exclusionReason":""},
      {"name":"力榮","aliases":[],"country":"國內","leadDays":14,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
      {"name":"普優瑪寢具有限公司","aliases":["普優瑪","普悠碼"],"country":"國內","leadDays":5,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
      {"name":"歐必斯","aliases":[],"country":"國內","leadDays":10,"reviewDays":0,"automaticPurchase":false,"exclusionReason":"接單後採購／客訂型供應商"},
      {"name":"昭元棉業","aliases":[],"country":"國內","leadDays":50,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
      {"name":"尚美","aliases":[],"country":"國內","leadDays":7,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
      {"name":"超越嗅覺","aliases":[],"country":"國內","leadDays":40,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
      {"name":"凱信達","aliases":[],"country":"國外","leadDays":70,"reviewDays":0,"automaticPurchase":false,"exclusionReason":"一次性採購供應商"},
      {"name":"寧波同一","aliases":[],"country":"國外","leadDays":70,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
      {"name":"潤泰羽絨","aliases":[],"country":"國外","leadDays":70,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
      {"name":"泰能脊康","aliases":[],"country":"國外","leadDays":70,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
      {"name":"逸寐","aliases":[],"country":"國外","leadDays":70,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
      {"name":"特娜鞋業","aliases":[],"country":"國外","leadDays":30,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
      {"name":"南通（小霞）包裝","aliases":["南通(小霞)包裝","南通小霞包裝"],"country":"國外","leadDays":30,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
      {"name":"禾鑫匠月","aliases":[],"country":"國外","leadDays":14,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""}
    ]'),
    'consignment', json('{"puyouma":{"pullLeadDays":5,"productionDays":45,"targetDays":{"熱銷":120,"穩定":105,"低銷":90}},"lirong":{"pullLeadDays":5,"productionDays":14,"deliveryAfterProductionDays":5,"targetDays":{"熱銷":90,"穩定":60,"低銷":60}}}'),
    'purchaseUnits', json('[
      {"supplier":"力榮","ruleName":"全品項","matchText":"","quantity":10,"enabled":true},
      {"supplier":"普優瑪寢具有限公司","ruleName":"床包3.5尺","matchText":"床包|3.5尺","quantity":10,"enabled":true},
      {"supplier":"普優瑪寢具有限公司","ruleName":"床包5尺","matchText":"床包|5尺","quantity":20,"enabled":true},
      {"supplier":"普優瑪寢具有限公司","ruleName":"床包6尺","matchText":"床包|6尺","quantity":20,"enabled":true},
      {"supplier":"普優瑪寢具有限公司","ruleName":"床包7尺","matchText":"床包|7尺","quantity":10,"enabled":true},
      {"supplier":"普優瑪寢具有限公司","ruleName":"單人薄被套4.5×6.5尺","matchText":"單人薄被套","quantity":10,"enabled":true},
      {"supplier":"普優瑪寢具有限公司","ruleName":"雙人薄被套6×7尺","matchText":"雙人薄被套","quantity":20,"enabled":true},
      {"supplier":"普優瑪寢具有限公司","ruleName":"單人兩用被套4.5×6.5尺","matchText":"單人兩用被套","quantity":10,"enabled":true},
      {"supplier":"普優瑪寢具有限公司","ruleName":"雙人兩用被套6×7尺","matchText":"雙人兩用被套","quantity":10,"enabled":true}
    ]'),
    'storeInventory', json('{"status":"configured_for_store_phase","trialStores":["R00","R06"],"rules":[
      {"name":"獨立5尺商品","enabled":true,"scope":"R00、R06","matchText":"獨立5尺","inventoryRole":"可售最低庫存","quantity":1,"priority":100},
      {"name":"6×7尺雙人兩用被套","enabled":true,"scope":"R00、R06","matchText":"6×7尺|雙人兩用被套","inventoryRole":"可售最低庫存","quantity":1,"priority":100},
      {"name":"6×7尺雙人薄被套一般材質","enabled":true,"scope":"R00、R06","matchText":"6×7尺|雙人薄被套","inventoryRole":"不可售展示","quantity":1,"priority":80},
      {"name":"6×7尺雙人薄被套天絲／華爾紗","enabled":true,"scope":"全部有銷售資料的營運門市","matchText":"6×7尺|雙人薄被套|天絲、華爾紗","inventoryRole":"可售最低庫存","quantity":1,"priority":110},
      {"name":"獨立3.5尺、6尺、7尺商品","enabled":true,"scope":"全部有銷售資料的營運門市","matchText":"獨立3.5尺、6尺、7尺","inventoryRole":"可售最低庫存","quantity":1,"priority":90},
      {"name":"單人薄被套／單人兩用被套材質前2名","enabled":true,"scope":"R00、R06","matchText":"單人薄被套、單人兩用被套|各材質前2名","inventoryRole":"可售特殊備貨","quantity":1,"priority":70},
      {"name":"枕套2入組","enabled":true,"scope":"R00、R06","matchText":"枕套2入組","inventoryRole":"不可售展示","quantity":1,"priority":80},
      {"name":"枕套1入／單入","enabled":true,"scope":"R00、R06","matchText":"枕套1入、單入","inventoryRole":"不可售展示","quantity":2,"priority":80},
      {"name":"枕頭／枕芯","enabled":true,"scope":"R00、R06","matchText":"枕頭、枕芯","inventoryRole":"不可售展示","quantity":2,"priority":80},
      {"name":"抱枕、靠枕及相關套件","enabled":true,"scope":"R00、R06","matchText":"抱枕、靠枕及相關套件","inventoryRole":"不可售展示","quantity":1,"priority":80}
    ]}'),
    'blacklist', json('["N00147"]')
  ),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'system'
);

INSERT INTO procurement_rules_history (version, payload, change_reason, changed_at, changed_by)
SELECT version, payload, '初始集中規則：依2026-09-14使用者確認', updated_at, updated_by
FROM procurement_rules_current WHERE id = 1;

ALTER TABLE procurement_settings ADD COLUMN approver_emails TEXT NOT NULL DEFAULT '["mcpheeyin@siangapato.com.tw","elerin@siangapato.com.tw"]' CHECK (json_valid(approver_emails));
ALTER TABLE procurement_settings ADD COLUMN notification_events TEXT NOT NULL DEFAULT '["approved","revoked","corrected"]' CHECK (json_valid(notification_events));

ALTER TABLE procurement_month_plans ADD COLUMN revenue_channels TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(revenue_channels));
ALTER TABLE procurement_month_plans ADD COLUMN full_budget_amount REAL NOT NULL DEFAULT 0 CHECK (full_budget_amount >= 0);

UPDATE procurement_month_plans
SET forecast_revenue = 7100102,
    revenue_channels = '[
      {"company":"寬承","channel":"官網","amount":2400000},
      {"company":"寬承","channel":"MOMO","amount":357946},
      {"company":"寬承","channel":"蝦皮","amount":1012156},
      {"company":"寬承","channel":"其它通路","amount":50000},
      {"company":"寬承","channel":"台北中山門市","amount":1000000},
      {"company":"寬承","channel":"台中北屯門市","amount":450000},
      {"company":"寬沐","channel":"新竹門市","amount":450000},
      {"company":"寬沐","channel":"文心門市","amount":600000},
      {"company":"寬沐","channel":"誠品門市","amount":540000},
      {"company":"寬沐","channel":"新莊門市","amount":100000},
      {"company":"寬沐","channel":"高雄快閃","amount":140000}
    ]',
    full_budget_amount = 2659538.30,
    source_note = '2026年9月中性情境：營收改由寬承與寬沐通路明細直接加總；整月額度2,659,538.30元，當時核准釋放額度1,329,769.15元。'
WHERE analysis_month = '2026-09';

UPDATE procurement_batches
SET manual_amount = 127380,
    approved_amount = 127380,
    adjustment_amount = 26604,
    payment_current_month = 127380,
    payment_schedule = '[{"supplier":"力榮","supplierCountry":"國內","paymentRule":"預計到貨100%","expectedArrivalDate":"2026-09-25","entries":[{"trigger":"預計到貨100%","date":"2026-09-25","month":"2026-09","amount":127380}]}]',
    warning_summary = '2026-09-11正式核准；人工回匯正確總額127,380元。ERP單號尚未回填；Dinosaur三品號為餘布重啟一次性生產。'
WHERE id = 'HIST-202609-LIRONG-0911';

UPDATE procurement_events
SET amount_delta = 127380,
    amount_after = 127380,
    reason = '歷史接續更正：2026-09-11正式核准金額為127,380元'
WHERE idempotency_key = 'history:event:lirong:0911';

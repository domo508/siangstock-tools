CREATE TABLE rules_current (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL CHECK (version >= 1),
  payload TEXT NOT NULL CHECK (length(payload) <= 65536),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE rules_history (
  version INTEGER PRIMARY KEY,
  payload TEXT NOT NULL CHECK (length(payload) <= 65536),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TRIGGER rules_current_history
AFTER UPDATE OF version, payload, updated_at, updated_by ON rules_current
BEGIN
  INSERT INTO rules_history (version, payload, updated_at, updated_by)
  VALUES (NEW.version, NEW.payload, NEW.updated_at, NEW.updated_by);
END;

INSERT INTO rules_current (id, version, payload, updated_at, updated_by)
VALUES (
  1,
  1,
  '{"表頭搜尋列數":20,"金額欄位最低數值比例":0.95,"排除關鍵字":["運費","折扣券","折扣劵","抵用券","抵用劵","紅利","退貨保留款","處理費","超取處理費","版費","保費","信用卡活動"],"待人工確認關鍵字":["贈品","樣品","展示","包裝","包裝袋","提袋","織標","水洗標","出清"],"指定品名白名單":[],"欄位辨識":{"品名":["品名","商品名稱","產品名稱","貨品名稱"],"庫存數量":["實際庫存","庫存數量","庫存量","可用庫存","數量"],"平均成本":["平均成本","庫存平均成本","單位成本","成本單價"],"庫存金額":["實際庫存成本額","庫存成本額","庫存成本","庫存金額","實際庫存金額","存貨金額","金額"]}}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'system'
);

INSERT INTO rules_history (version, payload, updated_at, updated_by)
SELECT version, payload, updated_at, updated_by FROM rules_current WHERE id = 1;

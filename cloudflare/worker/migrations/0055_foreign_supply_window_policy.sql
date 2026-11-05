-- Dated foreign supply policy; no approved batches, ERP or quantities are rewritten.
-- The temporary trigger makes the rule update and its audit entry one atomic statement.
CREATE TRIGGER IF NOT EXISTS migrate_0055_supply_window_audit
AFTER UPDATE ON procurement_rules_current
WHEN NEW.id = 1 AND NEW.version = OLD.version + 1
  AND NEW.updated_by = 'system-foreign-supply-window-v1'
BEGIN
  INSERT INTO procurement_rules_history (version, payload, change_reason, changed_at, changed_by)
  VALUES (NEW.version, NEW.payload,
    '使用者同意春節供應空窗規則：年前最後到貨回推完整交期；復工後完整交期估到貨；取消固定53天；到貨前流失不轉欠單，保留有效欠單並依時點扣庫存。2027日期為預估，供應商承諾優先。',
    NEW.updated_at, NEW.updated_by);
END;

UPDATE procurement_rules_current
SET version = version + 1,
    payload = json_set(payload,
      '$.springFestival.mode', 'supply-window-v1',
      '$.springFestival.closureStart', CASE WHEN json_extract(payload, '$.springFestival.closureStart') = '2027-01-16' THEN '2027-01-06' ELSE json_extract(payload, '$.springFestival.closureStart') END,
      '$.springFestival.recoveryDate', CASE WHEN json_extract(payload, '$.springFestival.recoveryDate') = '2027-02-28' THEN '2027-02-21' ELSE json_extract(payload, '$.springFestival.recoveryDate') END,
      '$.springFestival.lastArrivalDate', '2027-01-23',
      '$.springFestival.extraDays', 0),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_by = 'system-foreign-supply-window-v1'
WHERE id = 1 AND coalesce(json_extract(payload, '$.springFestival.mode'), '') != 'supply-window-v1'
  AND json_extract(payload, '$.springFestival.closureStart') <= '2027-01-23'
  AND json_extract(payload, '$.springFestival.recoveryDate') > '2027-01-23';

DROP TRIGGER migrate_0055_supply_window_audit;

-- 2026-09-14回測稽核：下列ERP品號為運費／配送服務，不是存貨採購商品。
-- 以精確品號加入集中黑名單，保留規則版本及變更歷史。
UPDATE procurement_rules_current
SET version = version + 1,
    payload = json_set(
      payload,
      '$.blacklist',
      json((
        SELECT json_group_array(value)
        FROM (
          SELECT value FROM json_each(json_extract(procurement_rules_current.payload, '$.blacklist'))
          UNION
          SELECT value FROM json_each(json('["C41723","Z00999","ZS1000","ZS1005","ZZ900"]'))
          ORDER BY value
        )
      ))
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_by = 'system-seasonal-service-exclusions'
WHERE id = 1;

INSERT INTO procurement_rules_history (version, payload, change_reason, changed_at, changed_by)
SELECT
  version,
  payload,
  '回測稽核確認5個運費／配送服務ERP品號，排除一般採購、寄庫與季節模型',
  updated_at,
  updated_by
FROM procurement_rules_current
WHERE id = 1;

-- 2026-09-14使用者確認：三筆缺ERP品號的涼感商品均為一次性代工，
-- 以供應商貨號加入公司共用黑名單，完全一致時排除一般採購與寄庫。
UPDATE procurement_rules_current
SET version = version + 1,
    payload = json_set(
      payload,
      '$.blacklist',
      json((
        SELECT json_group_array(value)
        FROM (
          SELECT value FROM json_each(json_extract(procurement_rules_current.payload, '$.blacklist'))
          UNION SELECT 'A068-PPB2-4875-00090'
          UNION SELECT 'A068-PCC1-1016-00091'
          UNION SELECT 'A068-PPF1-3030-00091'
          ORDER BY value
        )
      ))
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_by = 'system-confirmed-one-time-oem'
WHERE id = 1;

INSERT INTO procurement_rules_history (version, payload, change_reason, changed_at, changed_by)
SELECT
  version,
  payload,
  '確認三筆涼感商品為一次性代工，以供應商貨號排除一般採購與寄庫',
  updated_at,
  updated_by
FROM procurement_rules_current
WHERE id = 1;

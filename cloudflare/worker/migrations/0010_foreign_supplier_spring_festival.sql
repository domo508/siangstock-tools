-- 2026-09-14 國外供應商春節停工備貨規則。
-- 日期是公司年度作業設定，不代表政府公告假期；採購核准者可於規則管理頁逐年調整。
UPDATE procurement_rules_current
SET version = version + 1,
    payload = json_set(
      payload,
      '$.springFestival',
      json('{"enabled":true,"closureStart":"2027-01-16","recoveryDate":"2027-02-28","extraDays":53}')
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_by = 'system-add-foreign-supplier-spring-festival'
WHERE id = 1;

INSERT INTO procurement_rules_history (version, payload, change_reason, changed_at, changed_by)
SELECT
  version,
  payload,
  '新增國外供應商春節停工備貨：跨入年度停工區間時額外備貨53天，可於45至60天間調整',
  updated_at,
  updated_by
FROM procurement_rules_current
WHERE id = 1;

UPDATE procurement_rules_current
SET version = version + 1,
    payload = json_set(
      payload,
      '$.storeInventory.rules',
      (
        SELECT json_group_array(json(
          CASE
            WHEN json_extract(value, '$.name') = '6×7尺雙人薄被套天絲／華爾紗'
            THEN json_set(
              value,
              '$.name', '6×7尺雙人薄被套天絲／華爾紗／純棉／精梳純棉',
              '$.matchText', '6×7尺|雙人薄被套|天絲、華爾紗、純棉、精梳純棉'
            )
            ELSE value
          END
        ))
        FROM json_each(json_extract(payload, '$.storeInventory.rules'))
      )
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_by = 'system:migration-0024'
WHERE id = 1;

INSERT INTO procurement_rules_history (version, payload, change_reason, changed_at, changed_by)
SELECT version, payload, '門市週調撥：6×7尺天絲、華爾紗、純棉及精梳純棉薄被套改為可售最低庫存1件', updated_at, updated_by
FROM procurement_rules_current WHERE id = 1;

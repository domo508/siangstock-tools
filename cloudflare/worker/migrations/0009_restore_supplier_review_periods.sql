-- 2026-09-14 依已確認的0903供應商表恢復各廠商檢視期。
-- 上林沿用後續確認的28天；國內／國外分類沿用使用者2026-09-11最終確認。
UPDATE procurement_rules_current
SET version = version + 1,
    payload = json_set(
      payload,
      '$.suppliers',
      json('[
        {"name":"家禾","aliases":[],"country":"國內","leadDays":40,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
        {"name":"上林","aliases":[],"country":"國內","leadDays":5,"reviewDays":28,"automaticPurchase":true,"exclusionReason":""},
        {"name":"力榮","aliases":[],"country":"國內","leadDays":14,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
        {"name":"普優瑪寢具有限公司","aliases":["普優瑪","普悠碼"],"country":"國內","leadDays":5,"reviewDays":14,"automaticPurchase":true,"exclusionReason":""},
        {"name":"歐必斯","aliases":[],"country":"國內","leadDays":10,"reviewDays":0,"automaticPurchase":false,"exclusionReason":"接單後採購／客訂型供應商"},
        {"name":"昭元棉業","aliases":[],"country":"國內","leadDays":50,"reviewDays":90,"automaticPurchase":true,"exclusionReason":""},
        {"name":"尚美","aliases":[],"country":"國內","leadDays":7,"reviewDays":60,"automaticPurchase":true,"exclusionReason":""},
        {"name":"超越嗅覺","aliases":["超越嗅覺行銷有限公司"],"country":"國內","leadDays":40,"reviewDays":60,"automaticPurchase":true,"exclusionReason":""},
        {"name":"凱信達","aliases":[],"country":"國外","leadDays":70,"reviewDays":0,"automaticPurchase":false,"exclusionReason":"一次性採購供應商"},
        {"name":"寧波同一","aliases":[],"country":"國外","leadDays":70,"reviewDays":"90-120","automaticPurchase":true,"exclusionReason":""},
        {"name":"潤泰羽絨","aliases":[],"country":"國外","leadDays":70,"reviewDays":"90-120","automaticPurchase":true,"exclusionReason":""},
        {"name":"泰能脊康","aliases":["深圳市泰能脊康科技有限公司"],"country":"國外","leadDays":70,"reviewDays":"90-120","automaticPurchase":true,"exclusionReason":""},
        {"name":"逸寐","aliases":[],"country":"國外","leadDays":70,"reviewDays":"90-120","automaticPurchase":true,"exclusionReason":""},
        {"name":"特娜鞋業","aliases":["特娜鞋业"],"country":"國外","leadDays":30,"reviewDays":120,"automaticPurchase":true,"exclusionReason":""},
        {"name":"南通（小霞）包裝","aliases":["南通(小霞)包裝","南通小霞包裝","南通泰而逸纺织品有限公司"],"country":"國外","leadDays":30,"reviewDays":0,"automaticPurchase":true,"exclusionReason":""},
        {"name":"禾鑫匠月","aliases":["禾鑫匠月織麥"],"country":"國外","leadDays":14,"reviewDays":0,"automaticPurchase":true,"exclusionReason":""}
      ]'),
      '$.featuredSuppliers',
      json('["普優瑪寢具有限公司","力榮","上林","潤泰羽絨","泰能脊康"]')
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_by = 'system-restore-supplier-review-periods'
WHERE id = 1;

INSERT INTO procurement_rules_history (version, payload, change_reason, changed_at, changed_by)
SELECT
  version,
  payload,
  '依0903供應商表恢復各供應商檢視期；設定可管理的主要供應商顯示名單，其餘自動歸入其它',
  updated_at,
  updated_by
FROM procurement_rules_current
WHERE id = 1;

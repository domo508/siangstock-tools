ALTER TABLE procurement_settings
ADD COLUMN store_transfer_hq_emails TEXT NOT NULL
DEFAULT '["mcpheeyin@siangapato.com.tw","elerin@siangapato.com.tw"]'
CHECK (json_valid(store_transfer_hq_emails));

UPDATE procurement_settings
SET approver_emails = '["mcpheeyin@siangapato.com.tw","elerin@siangapato.com.tw"]',
    store_transfer_hq_emails = '["mcpheeyin@siangapato.com.tw","elerin@siangapato.com.tw","service1@siangapato.com.tw","sc00@siangapato.com.tw"]',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_by = 'system:migration:0023'
WHERE id = 1;

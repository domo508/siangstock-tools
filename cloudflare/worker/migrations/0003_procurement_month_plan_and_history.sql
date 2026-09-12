CREATE TABLE procurement_month_plans (
  analysis_month TEXT PRIMARY KEY CHECK (analysis_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  scenario TEXT NOT NULL CHECK (scenario = 'neutral'),
  forecast_revenue REAL NOT NULL CHECK (forecast_revenue >= 0),
  forecast_cost_outflow REAL NOT NULL CHECK (forecast_cost_outflow >= 0),
  target_ending_inventory_cost REAL NOT NULL CHECK (target_ending_inventory_cost >= 0),
  opening_inventory_cost REAL NOT NULL CHECK (opening_inventory_cost >= 0),
  expected_supplier_returns REAL NOT NULL,
  budget_amount REAL NOT NULL CHECK (budget_amount >= 0),
  source_note TEXT NOT NULL CHECK (length(source_note) <= 500),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT INTO procurement_month_plans (
  analysis_month, scenario, forecast_revenue, forecast_cost_outflow,
  target_ending_inventory_cost, opening_inventory_cost, expected_supplier_returns,
  budget_amount, source_note, created_at, created_by, updated_at, updated_by
) VALUES (
  '2026-09', 'neutral', 5936068.44, 2659538.30,
  0, 0, 0,
  1329769.15,
  '2026年9月月初歷史快照：預估營收與成本取自月初實測報表；可採購額度沿用截至9/10已確認的1,329,769.15元。歷史報表以月初50%釋放呈現，因此額度保留為核准快照，不以空白庫存欄位倒推。',
  '2026-09-12T00:00:00.000Z', 'history-import',
  '2026-09-12T00:00:00.000Z', 'history-import'
);

INSERT INTO procurement_batches (
  id, analysis_month, supplier_summary, status,
  suggested_amount, manual_amount, blocked_amount, approved_amount, adjustment_amount,
  budget_amount, payment_current_month, payment_future_months, payment_schedule,
  warning_summary, created_at, created_by, approved_at, approved_by, updated_at,
  revision, idempotency_key
) VALUES
(
  'HIST-202609-RECEIVED-0902-0907', '2026-09',
  '["普優瑪寢具有限公司","上林","力榮","超越嗅覺"]', 'received',
  166750.60, 166750.60, 0, 166750.60, 0,
  1329769.15, 166750.60, 0,
  '[{"trigger":"9/2～9/7實際到貨100%","date":"2026-09-07","month":"2026-09","amount":166750.60}]',
  '歷史接續基準；包含9/2～9/7已實際收貨，D1只保存批次金額摘要，不保存Excel逐列明細。',
  '2026-09-07T02:13:22.000Z', 'history-import',
  '2026-09-07T02:13:22.000Z', 'history-import',
  '2026-09-07T02:13:22.000Z', 1, 'history:2026-09:received:0902-0907'
),
(
  'HIST-202609-PUYOUMA-0907', '2026-09',
  '["普優瑪寢具有限公司"]', 'erp_created',
  84040, 84040, 0, 84040, 0,
  1329769.15, 84040, 0,
  '[{"supplier":"普優瑪寢具有限公司","supplierCountry":"國內","paymentRule":"預計到貨100%","expectedArrivalDate":"2026-09-12","entries":[{"trigger":"預計到貨100%","date":"2026-09-12","month":"2026-09","amount":84040}]}]',
  '歷史接續匯入；9/7普優瑪天絲正式採購，ERP匯入檔未載明正式單號。',
  '2026-09-07T00:00:00.000Z', 'history-import',
  '2026-09-07T00:00:00.000Z', 'history-import',
  '2026-09-07T00:00:00.000Z', 1, 'history:2026-09:puyouma:0907'
),
(
  'HIST-202609-PR202609000S', '2026-09',
  '["普優瑪寢具有限公司"]', 'erp_created',
  259110, 259110, 0, 259110, 0,
  1329769.15, 259110, 0,
  '[{"supplier":"普優瑪寢具有限公司","supplierCountry":"國內","paymentRule":"預計到貨100%","expectedArrivalDate":"2026-09-15","entries":[{"trigger":"預計到貨100%","date":"2026-09-15","month":"2026-09","amount":259110}]}]',
  '歷史接續匯入；9/10普優瑪正式採購單PR202609000S。',
  '2026-09-10T00:00:00.000Z', 'history-import',
  '2026-09-10T00:00:00.000Z', 'history-import',
  '2026-09-10T00:00:00.000Z', 1, 'history:2026-09:puyouma:PR202609000S'
),
(
  'HIST-202609-LIRONG-0911', '2026-09',
  '["力榮"]', 'approved',
  100776, 123380, 0, 123380, 22604,
  1329769.15, 123380, 0,
  '[{"supplier":"力榮","supplierCountry":"國內","paymentRule":"預計到貨100%","expectedArrivalDate":"2026-09-25","entries":[{"trigger":"預計到貨100%","date":"2026-09-25","month":"2026-09","amount":123380}]}]',
  '2026-09-11正式核准；12個正數品號、290件。ERP單號尚未回填；Dinosaur三品號為餘布重啟一次性生產。',
  '2026-09-11T00:00:00.000Z', 'history-import',
  '2026-09-11T00:00:00.000Z', 'siang01@siangapato.com.tw',
  '2026-09-11T00:00:00.000Z', 1, 'history:2026-09:lirong:0911'
);

INSERT INTO procurement_events (
  batch_id, event_type, amount_before, amount_delta, amount_after,
  reason, created_at, created_by, idempotency_key
) VALUES
('HIST-202609-RECEIVED-0902-0907', 'received', 166750.60, 0, 166750.60, '歷史接續匯入：9/2～9/7已實際收貨', '2026-09-07T02:13:22.000Z', 'history-import', 'history:event:received:0902-0907'),
('HIST-202609-PUYOUMA-0907', 'erp_created', 84040, 0, 84040, '歷史接續匯入：ERP匯入檔已建立', '2026-09-07T00:00:00.000Z', 'history-import', 'history:event:puyouma:0907'),
('HIST-202609-PR202609000S', 'erp_created', 259110, 0, 259110, '歷史接續匯入：ERP採購單PR202609000S', '2026-09-10T00:00:00.000Z', 'history-import', 'history:event:puyouma:PR202609000S'),
('HIST-202609-LIRONG-0911', 'approved', 0, 123380, 123380, '歷史接續匯入：2026-09-11已確認正式核准', '2026-09-11T00:00:00.000Z', 'siang01@siangapato.com.tw', 'history:event:lirong:0911');

-- 歷史匯入不建立通知工作，避免補寄過期核准郵件。

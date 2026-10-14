ALTER TABLE procurement_batches ADD COLUMN recognized_commitment_amount REAL NOT NULL DEFAULT 0 CHECK (recognized_commitment_amount >= 0);
ALTER TABLE procurement_batches ADD COLUMN pending_commitment_amount REAL NOT NULL DEFAULT 0 CHECK (pending_commitment_amount >= 0);
ALTER TABLE procurement_erp_reconciliation_items ADD COLUMN receipt_date TEXT NOT NULL DEFAULT '';

UPDATE procurement_batches
SET recognized_commitment_amount = approved_amount,
    pending_commitment_amount = 0
WHERE status IN ('approved', 'erp_created', 'received');

CREATE TABLE procurement_commitment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES procurement_batches(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL DEFAULT '' CHECK (length(supplier) <= 120),
  erp_reference TEXT NOT NULL DEFAULT '' CHECK (length(erp_reference) <= 120),
  event_type TEXT NOT NULL CHECK (event_type IN ('legacy_approval', 'domestic_approval', 'foreign_deposit', 'foreign_receipt', 'adjustment')),
  event_date TEXT NOT NULL CHECK (event_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  recognition_month TEXT NOT NULL CHECK (recognition_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  amount REAL NOT NULL,
  source_key TEXT NOT NULL UNIQUE CHECK (length(source_key) BETWEEN 8 AND 300),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX procurement_commitment_events_month
ON procurement_commitment_events (recognition_month, event_date, batch_id);

INSERT INTO procurement_commitment_events (
  batch_id, supplier, erp_reference, event_type, event_date, recognition_month, amount, source_key, created_at, created_by
)
SELECT id, '', COALESCE(erp_reference, ''), 'legacy_approval',
       substr(COALESCE(approved_at, created_at), 1, 10), analysis_month, approved_amount,
       'legacy:' || id || ':approval', COALESCE(approved_at, created_at), COALESCE(approved_by, created_by)
FROM procurement_batches
WHERE status IN ('approved', 'erp_created', 'received') AND approved_amount > 0;

CREATE TABLE procurement_payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES procurement_batches(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL DEFAULT '' CHECK (length(supplier) <= 120),
  erp_reference TEXT NOT NULL DEFAULT '' CHECK (length(erp_reference) <= 120),
  event_type TEXT NOT NULL CHECK (event_type IN ('foreign_deposit', 'domestic_receipt', 'foreign_receipt', 'adjustment')),
  event_date TEXT NOT NULL CHECK (event_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  payment_month TEXT NOT NULL CHECK (payment_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  amount REAL NOT NULL,
  source_key TEXT NOT NULL UNIQUE CHECK (length(source_key) BETWEEN 8 AND 300),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX procurement_payment_events_month
ON procurement_payment_events (payment_month, event_date, batch_id);

CREATE TABLE procurement_receipt_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES procurement_batches(id) ON DELETE CASCADE,
  erp_reference TEXT NOT NULL CHECK (length(erp_reference) BETWEEN 1 AND 120),
  sku TEXT NOT NULL CHECK (length(sku) BETWEEN 1 AND 80),
  supplier TEXT NOT NULL DEFAULT '' CHECK (length(supplier) <= 120),
  receipt_date TEXT NOT NULL CHECK (receipt_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  receipt_month TEXT NOT NULL CHECK (receipt_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  quantity_delta REAL NOT NULL CHECK (quantity_delta > 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  receipt_amount REAL NOT NULL CHECK (receipt_amount >= 0),
  commitment_amount REAL NOT NULL CHECK (commitment_amount >= 0),
  payment_amount REAL NOT NULL CHECK (payment_amount >= 0),
  cumulative_quantity REAL NOT NULL CHECK (cumulative_quantity >= 0),
  source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint) BETWEEN 16 AND 128),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (batch_id, sku, source_fingerprint)
);

CREATE INDEX procurement_receipt_events_month
ON procurement_receipt_events (receipt_month, receipt_date, batch_id, sku);

CREATE TABLE procurement_month_plan_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_month TEXT NOT NULL CHECK (analysis_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  checkpoint TEXT NOT NULL CHECK (checkpoint IN ('month-start', 'mid-month', 'month-end')),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX procurement_month_plan_history_period
ON procurement_month_plan_history (analysis_month, checkpoint, created_at DESC);

INSERT INTO procurement_month_plan_history (analysis_month, checkpoint, snapshot, created_at, created_by)
SELECT analysis_month, 'month-start', json_object(
  'analysisMonth', analysis_month,
  'checkpoint', 'month-start',
  'scenario', scenario,
  'forecastRevenue', forecast_revenue,
  'forecastCostOutflow', forecast_cost_outflow,
  'targetEndingInventoryCost', target_ending_inventory_cost,
  'openingInventoryCost', opening_inventory_cost,
  'expectedSupplierReturns', expected_supplier_returns,
  'budgetAmount', budget_amount,
  'releasedBudgetAmount', budget_amount,
  'fullBudgetAmount', full_budget_amount,
  'revenueChannels', json(revenue_channels),
  'sourceNote', source_note,
  'updatedAt', updated_at,
  'updatedBy', updated_by
), updated_at, updated_by
FROM procurement_month_plans;

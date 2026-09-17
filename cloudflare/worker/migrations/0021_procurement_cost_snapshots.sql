CREATE TABLE procurement_cost_snapshots (
  analysis_month TEXT PRIMARY KEY CHECK (analysis_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  checkpoint TEXT NOT NULL CHECK (checkpoint IN ('month-start', 'mid-month', 'month-end')),
  data_as_of_date TEXT NOT NULL CHECK (data_as_of_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  inventory_date TEXT NOT NULL CHECK (inventory_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  pending_date TEXT NOT NULL CHECK (pending_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  transfer_date TEXT NOT NULL CHECK (transfer_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sales_date TEXT NOT NULL CHECK (sales_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  forecast_cost REAL NOT NULL CHECK (forecast_cost >= 0),
  management_cost_to_date REAL NOT NULL CHECK (management_cost_to_date >= 0),
  actual_receipt_cost REAL NOT NULL CHECK (actual_receipt_cost >= 0),
  direct_cost REAL NOT NULL CHECK (direct_cost >= 0),
  kuanmu_base_cost REAL NOT NULL CHECK (kuanmu_base_cost >= 0),
  kuanmu_intercompany_revenue REAL NOT NULL CHECK (kuanmu_intercompany_revenue >= 0),
  current_inventory_cost REAL NOT NULL CHECK (current_inventory_cost >= 0),
  inventory_bridge_cost REAL,
  source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 40),
  max_sales_date TEXT,
  transfer_received_count INTEGER NOT NULL CHECK (transfer_received_count >= 0),
  b3_matched_count INTEGER NOT NULL CHECK (b3_matched_count >= 0),
  warnings TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warnings)),
  source_hashes TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_hashes)),
  calculation_version TEXT NOT NULL CHECK (length(calculation_version) BETWEEN 1 AND 80),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE procurement_cost_snapshot_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_month TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  data_as_of_date TEXT NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX idx_procurement_cost_snapshot_history_month
ON procurement_cost_snapshot_history (analysis_month, created_at DESC);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT UNIQUE,
  external_id TEXT UNIQUE,
  entry_date TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_name TEXT NOT NULL,
  location TEXT NOT NULL,
  pax INTEGER NOT NULL DEFAULT 0,
  event_days INTEGER NOT NULL DEFAULT 1,
  cost_per_pax REAL NOT NULL DEFAULT 0,
  total_billing REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'planning', 'completed', 'cancelled')),
  event_time TEXT,
  food_type TEXT CHECK (food_type IS NULL OR food_type IN ('jain', 'non-jain')),
  allergic_count INTEGER NOT NULL DEFAULT 0,
  allergic_notes TEXT,
  location_zone TEXT CHECK (location_zone IS NULL OR location_zone IN ('surat', 'ahmedabad', 'other')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  cycle_name TEXT NOT NULL,
  due_date TEXT,
  amount REAL NOT NULL DEFAULT 0,
  billing_type TEXT NOT NULL DEFAULT 'cash' CHECK (billing_type IN ('cash', 'online')),
  online_method TEXT CHECK (
    online_method IS NULL OR online_method IN ('UPI', 'Card', 'Cheque', 'Bank Transfer')
  ),
  is_advance INTEGER NOT NULL DEFAULT 0 CHECK (is_advance IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_kyc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE,
  client_name TEXT,
  mobile TEXT,
  email TEXT,
  gst_number TEXT,
  pan_number TEXT,
  aadhar_number TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  online_subtotal REAL NOT NULL DEFAULT 0,
  gst_rate REAL NOT NULL DEFAULT 5,
  gst_amount REAL NOT NULL DEFAULT 0,
  invoice_total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pre_cost_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE,
  planning_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'locked')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pre_cost_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  item_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  unit TEXT,
  unit_cost REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  vendor_name TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES pre_cost_plans(id) ON DELETE CASCADE
);

-- Master directory: department heads and their assigned persons.
CREATE TABLE IF NOT EXISTS master_heads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS master_persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  head_id TEXT NOT NULL,
  person_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (head_id) REFERENCES master_heads(id) ON DELETE CASCADE
);

-- Petty-cash page: per-event assigned payouts + petty expense rows.
CREATE TABLE IF NOT EXISTS petty_cash_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  row_type TEXT NOT NULL CHECK (row_type IN ('payout', 'petty')),
  head_id TEXT,
  person_name TEXT,
  purpose TEXT,
  amount REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Pre-cost planning page: per-event fixed cost inputs (1:1 with event).
CREATE TABLE IF NOT EXISTS pre_cost_inputs (
  event_id INTEGER PRIMARY KEY,
  food_cost_per_pax REAL NOT NULL DEFAULT 0,
  staff_count REAL NOT NULL DEFAULT 0,
  total_staff_cost REAL NOT NULL DEFAULT 0,
  equipment_depreciation REAL NOT NULL DEFAULT 0,
  third_party_vendor REAL NOT NULL DEFAULT 0,
  decor_charge REAL NOT NULL DEFAULT 0,
  miscellaneous_cost REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  profit_loss REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_client_id ON events(client_id);
CREATE INDEX IF NOT EXISTS idx_payment_cycles_event_id ON payment_cycles(event_id);
CREATE INDEX IF NOT EXISTS idx_pre_cost_items_plan_id ON pre_cost_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_master_persons_head_id ON master_persons(head_id);
CREATE INDEX IF NOT EXISTS idx_petty_cash_event_id ON petty_cash_rows(event_id);

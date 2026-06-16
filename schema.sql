-- Sites table
CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  site_id INTEGER REFERENCES sites(id),
  seq INTEGER,
  phone TEXT,
  call_date DATE,
  call_time TEXT,
  answered BOOLEAN DEFAULT FALSE,
  not_answered BOOLEAN DEFAULT FALSE,
  sms_sent BOOLEAN DEFAULT FALSE,
  total_deposit NUMERIC(12,2) DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily deposits table
CREATE TABLE IF NOT EXISTS daily_deposits (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  day_number INTEGER,
  deposit_amount NUMERIC(12,2) DEFAULT 0
);

-- Weekly summary table
CREATE TABLE IF NOT EXISTS weekly_summary (
  id SERIAL PRIMARY KEY,
  site_id INTEGER REFERENCES sites(id),
  week_start DATE,
  week_end DATE,
  total_calls INTEGER DEFAULT 0,
  answered INTEGER DEFAULT 0,
  not_answered INTEGER DEFAULT 0,
  return_customers INTEGER DEFAULT 0,
  return_deposit NUMERIC(12,2) DEFAULT 0,
  bonus NUMERIC(12,2) DEFAULT 0
);

-- Enable Row Level Security
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_summary ENABLE ROW LEVEL SECURITY;

-- Allow public read (anon key)
CREATE POLICY "Public read sites" ON sites FOR SELECT USING (true);
CREATE POLICY "Public read customers" ON customers FOR SELECT USING (true);
CREATE POLICY "Public read daily_deposits" ON daily_deposits FOR SELECT USING (true);
CREATE POLICY "Public read weekly_summary" ON weekly_summary FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  meta_lead_id TEXT NOT NULL UNIQUE,
  form_id TEXT,
  page_id TEXT,
  ad_id TEXT,
  ad_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  platform TEXT,
  customer_name TEXT,
  phone TEXT,
  email TEXT,
  region TEXT,
  answers_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new',
  is_quality INTEGER NOT NULL DEFAULT 0 CHECK (is_quality IN (0, 1)),
  manager TEXT,
  amount REAL,
  notes TEXT,
  whatsapp_url TEXT,
  google_sheet_row INTEGER,
  telegram_chat_id TEXT,
  telegram_message_id TEXT,
  quality_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);

CREATE TABLE IF NOT EXISTS lead_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_events(lead_id, created_at DESC);

ALTER TABLE leads ADD COLUMN meta_audience_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE leads ADD COLUMN meta_audience_error TEXT;
ALTER TABLE leads ADD COLUMN meta_audience_attempted_at TEXT;

UPDATE leads
SET meta_audience_status = CASE
  WHEN quality_sent_at IS NOT NULL THEN 'sent'
  WHEN is_quality = 1 THEN 'pending'
  ELSE 'idle'
END;

CREATE TABLE IF NOT EXISTS integration_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_meta_audience_status ON leads(meta_audience_status);

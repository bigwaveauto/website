-- Gmail OAuth token storage + gmail_message_id dedup column
-- Run in Supabase Dashboard → SQL Editor

-- Key-value store for server-side settings (OAuth tokens, etc.)
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Track which Gmail message each transaction came from (dedup + traceability)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_gmail_msg
  ON transactions(gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

-- Verify
SELECT 'app_settings' AS tbl, count(*) FROM app_settings
UNION ALL
SELECT 'gmail_message_id column', count(*) FROM transactions WHERE gmail_message_id IS NOT NULL;

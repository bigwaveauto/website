-- Plaid bank connection storage
-- Run in Supabase Dashboard → SQL Editor

-- One row per connected bank account (Item in Plaid terms)
CREATE TABLE IF NOT EXISTS plaid_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES transaction_accounts(id) ON DELETE CASCADE,
  plaid_item_id   TEXT NOT NULL UNIQUE,
  access_token    TEXT NOT NULL,          -- server-only, never sent to browser
  cursor          TEXT,                   -- for /transactions/sync pagination
  institution_name TEXT,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plaid_items_account ON plaid_items(account_id);

-- Verify
SELECT 'plaid_items' AS tbl, count(*) FROM plaid_items;

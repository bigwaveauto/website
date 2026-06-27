-- ============================================================
-- Transaction Reconciliation Module
-- Run in Supabase Dashboard → SQL Editor
-- All statements are idempotent — safe to re-run.
-- ============================================================

-- 1. Pre-configured bank/CC accounts (set up once, selected on import)
CREATE TABLE IF NOT EXISTS transaction_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name         TEXT NOT NULL,              -- "Chase Checking", "AMEX Gold"
  institution  TEXT NOT NULL DEFAULT '',   -- "Chase", "American Express"
  account_type TEXT NOT NULL DEFAULT 'checking', -- checking | credit_card
  last_four    TEXT,                       -- last 4 digits for reference
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(name)
);

-- 2. One row per CSV upload (linked to a pre-configured account)
CREATE TABLE IF NOT EXISTS transaction_imports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  account_id       UUID NOT NULL REFERENCES transaction_accounts(id) ON DELETE RESTRICT,
  filename         TEXT,
  row_count        INTEGER NOT NULL DEFAULT 0,
  new_count        INTEGER NOT NULL DEFAULT 0,
  duplicate_count  INTEGER NOT NULL DEFAULT 0,
  date_from        DATE,
  date_to          DATE,
  imported_by      TEXT
);

-- 3. Individual bank transactions
CREATE TABLE IF NOT EXISTS transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id        UUID NOT NULL REFERENCES transaction_imports(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Normalized bank data
  transaction_date DATE NOT NULL,
  post_date        DATE,
  description      TEXT NOT NULL,
  amount           NUMERIC(10,2) NOT NULL,  -- negative = expense, positive = credit/refund

  -- Categorization (populated by rule engine, AI, or user)
  category         TEXT,
  -- vin is plain TEXT (no FK) — may reference vAuto vehicles not in Supabase vehicles table
  vin              TEXT,

  -- Review workflow
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | ignored

  -- AI output (populated when user clicks "Run AI" button)
  ai_category      TEXT,
  ai_vin           TEXT,
  ai_confidence    NUMERIC(3,2),   -- 0.00 – 1.00
  ai_reasoning     TEXT,

  -- Rule engine (which rule_pattern fired, if any)
  rule_matched     TEXT,

  -- Dedup: prevents re-importing the same transaction twice
  -- Hash is SHA-256(transaction_date || '|' || amount || '|' || description || '|' || account_name)
  dedup_hash       TEXT NOT NULL,

  notes            TEXT,
  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,

  CONSTRAINT transactions_dedup_unique UNIQUE(dedup_hash)
);

CREATE INDEX IF NOT EXISTS idx_transactions_status      ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_vin         ON transactions(vin) WHERE vin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_import_id   ON transactions(import_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date        ON transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category    ON transactions(category) WHERE category IS NOT NULL;

-- 4. Vendor rule engine — grows over time as user categorizes transactions
CREATE TABLE IF NOT EXISTS transaction_vendor_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  vendor_pattern  TEXT NOT NULL,
  -- match_type: contains | starts_with | exact
  match_type      TEXT NOT NULL DEFAULT 'contains',
  category        TEXT NOT NULL,
  -- auto_approve: if true, matching transactions skip the review queue entirely
  auto_approve    BOOLEAN NOT NULL DEFAULT FALSE,
  use_count       INTEGER NOT NULL DEFAULT 0,

  UNIQUE(vendor_pattern, match_type)
);

-- Seed categories as a reference comment (enforced in app, not DB)
-- Transport, Auction Fee, Mechanical, Body/Paint, Detail, Registration,
-- Parts, Photography, Marketing, Overhead, Other

-- Verify tables were created
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'transaction_accounts',
    'transaction_imports',
    'transactions',
    'transaction_vendor_rules'
  )
ORDER BY table_name;

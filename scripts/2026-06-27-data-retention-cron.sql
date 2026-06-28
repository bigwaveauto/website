-- Automated data retention enforcement via pg_cron
-- Run in Supabase Dashboard → SQL Editor
-- Per BigWaveAuto-DataRetention-Policy.pdf:
--   financing/credit apps: 5 years
--   general customer leads: 3 years
--   website/transaction logs: 90 days (app_settings gmail tokens handled separately)

-- Step 1: Enable pg_cron (already enabled on most Supabase projects)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Step 2: Instead of hard-deleting SSNs (which removes the whole record),
-- we scrub ONLY the sensitive PII columns after 5 years while keeping the
-- lead record itself (so you know a deal happened). Full delete at 7 years.

-- Scrub sensitive PII from credit apps older than 5 years
-- Runs daily at 3:00 AM UTC
SELECT cron.schedule(
  'scrub-credit-app-pii',
  '0 3 * * *',
  $$
  UPDATE financing_leads SET
    ssn            = NULL,
    dob            = NULL,
    monthly_income = NULL,
    other_income   = NULL,
    rent_mortgage  = NULL,
    coborrower_data = NULL
  WHERE
    created_at < NOW() - INTERVAL '5 years'
    AND ssn IS NOT NULL;
  $$
);

-- Hard-delete entire credit app records older than 7 years
SELECT cron.schedule(
  'delete-old-credit-apps',
  '0 3 * * *',
  $$
  DELETE FROM financing_leads
  WHERE created_at < NOW() - INTERVAL '7 years';
  $$
);

-- Hard-delete Gmail/Plaid transaction imports older than 3 years
-- (keeps approved transactions but removes the raw import metadata)
SELECT cron.schedule(
  'delete-old-transaction-imports',
  '0 4 * * *',
  $$
  DELETE FROM transaction_imports
  WHERE created_at < NOW() - INTERVAL '3 years';
  $$
);

-- Verify cron jobs are registered
SELECT jobid, jobname, schedule, command
FROM cron.job
ORDER BY jobname;

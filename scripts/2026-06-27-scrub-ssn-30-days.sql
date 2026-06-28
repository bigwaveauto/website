-- Replace the 5-year SSN scrub with a 30-day scrub
-- Run in Supabase Dashboard → SQL Editor

-- Remove the old 5-year job first
SELECT cron.unschedule('scrub-credit-app-pii');

-- New job: null out SSN after 30 days regardless of anything else
SELECT cron.schedule(
  'scrub-ssn-30-days',
  '0 3 * * *',
  $$
  UPDATE financing_leads SET
    ssn = NULL
  WHERE
    created_at < NOW() - INTERVAL '30 days'
    AND ssn IS NOT NULL;
  $$
);

-- Verify
SELECT jobid, jobname, schedule FROM cron.job ORDER BY jobname;

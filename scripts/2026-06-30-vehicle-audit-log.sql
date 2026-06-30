-- General-purpose audit log for per-vehicle events
-- Captures task completions, document uploads, warranty changes, notes, etc.
-- Run in Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS public.vehicle_audit_log (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vin          text NOT NULL,
  event_type   text NOT NULL,  -- 'task_done' | 'carfax_uploaded' | 'warranty_enabled' | 'note'
  title        text NOT NULL,
  notes        text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_audit_log_vin_idx ON public.vehicle_audit_log (vin, created_at DESC);

ALTER TABLE public.vehicle_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "service role full access" ON public.vehicle_audit_log
  TO service_role USING (true) WITH CHECK (true);

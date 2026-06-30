-- Task list + warranty_enabled flag
-- Run in Supabase SQL Editor

-- 1. Task list — stores manual/recon tasks; auto-tasks are computed server-side
CREATE TABLE IF NOT EXISTS public.tasks (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vin           text,
  type          text NOT NULL,     -- 'missing_carfax' | 'missing_warranty' | 'recon' | 'manual'
  title         text NOT NULL,
  status        text NOT NULL DEFAULT 'open', -- 'open' | 'done' | 'dismissed'
  priority      text NOT NULL DEFAULT 'normal', -- 'high' | 'normal' | 'low'
  notes         text,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_vin_idx    ON public.tasks (vin);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON public.tasks (status);
CREATE INDEX IF NOT EXISTS tasks_type_idx   ON public.tasks (type);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "service role full access" ON public.tasks
  TO service_role USING (true) WITH CHECK (true);

-- 2. Add warranty_enabled to vehicle_pricing
--    When false (default), the warranty meter is hidden on the VDP
ALTER TABLE public.vehicle_pricing
  ADD COLUMN IF NOT EXISTS warranty_enabled boolean NOT NULL DEFAULT false;

-- Master vehicle inventory table — synced from vAuto CSV
-- Run in Supabase SQL Editor before deploying sync-vauto.mjs

CREATE TABLE IF NOT EXISTS public.vehicle_inventory (
  vin             text PRIMARY KEY,
  stock_number    text,
  year            integer,
  make            text,
  model           text,
  trim            text,
  body            text,
  condition       text,
  mileage         integer,
  price           numeric(10,2),
  msrp            numeric(10,2),
  exterior_color  text,
  interior_color  text,
  fuel            text,
  drivetrain      text,
  engine          text,
  transmission    text,
  featured_photo  text,
  photo_count     integer DEFAULT 0,
  status          text NOT NULL DEFAULT 'active',  -- 'active' | 'sold' | 'removed'
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  raw             jsonb
);

CREATE INDEX IF NOT EXISTS vehicle_inventory_status_idx  ON public.vehicle_inventory (status);
CREATE INDEX IF NOT EXISTS vehicle_inventory_make_idx    ON public.vehicle_inventory (make, model, year);
CREATE INDEX IF NOT EXISTS vehicle_inventory_price_idx   ON public.vehicle_inventory (price);

-- Allow the service role to read/write (already granted by default in Supabase)
-- RLS: no public access — internal use only
ALTER TABLE public.vehicle_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "service role full access"
  ON public.vehicle_inventory
  TO service_role
  USING (true)
  WITH CHECK (true);

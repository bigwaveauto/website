-- Index for /api/admin/stages/current which now queries WHERE exited_at IS NULL.
-- A partial index on open stages only keeps it tiny and fast regardless of history size.
CREATE INDEX IF NOT EXISTS idx_vehicle_stages_open
  ON vehicle_stages (vin, entered_at DESC)
  WHERE exited_at IS NULL;

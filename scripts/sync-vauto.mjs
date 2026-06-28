#!/usr/bin/env node
/**
 * sync-vauto.mjs
 * Reads the latest vAuto CSV from VAUTO_DIR, upserts new/updated vehicles
 * into Supabase vehicle_inventory, and marks VINs no longer in the feed as 'removed'.
 *
 * Run manually:   node scripts/sync-vauto.mjs
 * PM2 cron:       see ecosystem.config.cjs
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { parse as csvParse } from 'csv-parse/sync';

const VAUTO_DIR   = process.env.VAUTO_DIR         || '/home/vauto/inventory';
const SUPA_URL    = process.env.SUPABASE_URL;
const SUPA_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

// ── CSV column resolver (mirrors server.ts mapVautoRow) ─────────────────────
function makeGetter(row) {
  const keys = Object.keys(row);
  return (candidates) => {
    for (const k of candidates) {
      if (row[k] !== undefined) return row[k];
      const found = keys.find(
        rk => rk.toLowerCase().replace(/[\s_-]/g, '') === k.toLowerCase().replace(/[\s_-]/g, '')
      );
      if (found) return row[found];
    }
    return '';
  };
}

function mapRow(r) {
  const g = makeGetter(r);
  const vin = g(['VIN', 'vin']);
  if (!vin) return null;

  const photos = g(['Photos', 'PhotoURLs', 'Photo URLs', 'PhotoUrl', 'ImageURLs', 'Image URLs', 'ImageList']);
  const photoList = photos ? photos.split(/[|,;]/).map(p => p.trim()).filter(Boolean) : [];
  const series = g(['Series', 'Series Detail']);
  const condition = g(['New/Used', 'NewUsed', 'Condition', 'Type']);

  return {
    vin,
    stock_number:   g(['Stock #', 'StockNumber', 'Stock Number', 'Stock']) || null,
    year:           parseInt(g(['Year', 'ModelYear', 'Model Year']), 10)   || null,
    make:           g(['Make'])     || null,
    model:          g(['Model'])    || null,
    trim:           g(['Trim'])  || series || null,
    body:           g(['Body', 'BodyStyle', 'Body Style', 'BodyType']) || null,
    condition:      condition === 'U' ? 'Used' : condition === 'N' ? 'New' : condition || null,
    mileage:        parseInt(g(['Odometer', 'Mileage', 'Miles']), 10) || null,
    price:          parseFloat(g(['Price', 'InternetPrice', 'Internet Price', 'SellingPrice'])) || null,
    msrp:           parseFloat(g(['MSRP'])) || null,
    exterior_color: g(['Colour', 'ExteriorColorGeneric', 'Exterior Color Generic', 'ExteriorColor', 'Exterior Color']) || null,
    interior_color: g(['Interior Color', 'InteriorColorGeneric', 'Interior Color Generic', 'InteriorColor']) || null,
    fuel:           g(['Fuel', 'FuelType', 'Fuel Type']) || null,
    drivetrain:     g(['Drivetrain Desc', 'Drivetrain', 'DriveTrain', 'DriveType']) || null,
    engine:         g(['Engine', 'EngineDescription', 'Engine Description']) || null,
    transmission:   g(['Transmission', 'TransmissionType']) || null,
    featured_photo: photoList[0] || null,
    photo_count:    parseInt(g(['Photo Count']), 10) || photoList.length,
    status:         'active',
    last_seen_at:   new Date().toISOString(),
    raw:            r,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Find latest CSV
  let files;
  try {
    files = await readdir(VAUTO_DIR);
  } catch (e) {
    console.error(`Cannot read VAUTO_DIR (${VAUTO_DIR}):`, e.message);
    process.exit(1);
  }

  const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv')).sort();
  if (csvFiles.length === 0) {
    console.log('No CSV files found in', VAUTO_DIR);
    return;
  }

  const latest = csvFiles[csvFiles.length - 1];
  console.log(`Reading: ${join(VAUTO_DIR, latest)}`);

  const raw = await readFile(join(VAUTO_DIR, latest), 'utf-8');
  const records = csvParse(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true });

  const vehicles = records.map(mapRow).filter(Boolean);
  console.log(`Parsed ${vehicles.length} vehicles from CSV`);

  if (vehicles.length === 0) return;

  const csvVins = new Set(vehicles.map(v => v.vin));

  // 2. Upsert active vehicles
  const BATCH = 50;
  let upserted = 0;
  for (let i = 0; i < vehicles.length; i += BATCH) {
    const batch = vehicles.slice(i, i + BATCH);
    const { error } = await supabase
      .from('vehicle_inventory')
      .upsert(batch, { onConflict: 'vin', ignoreDuplicates: false });
    if (error) {
      console.error('Upsert error:', error.message);
    } else {
      upserted += batch.length;
    }
  }
  console.log(`Upserted ${upserted} vehicles`);

  // 3. Mark anything previously active but now missing as 'removed'
  const { data: active, error: fetchErr } = await supabase
    .from('vehicle_inventory')
    .select('vin')
    .eq('status', 'active');

  if (fetchErr) {
    console.error('Could not fetch active VINs:', fetchErr.message);
    return;
  }

  const removedVins = (active || []).map(r => r.vin).filter(vin => !csvVins.has(vin));
  if (removedVins.length > 0) {
    const { error: rmErr } = await supabase
      .from('vehicle_inventory')
      .update({ status: 'removed', last_seen_at: new Date().toISOString() })
      .in('vin', removedVins);
    if (rmErr) {
      console.error('Error marking removed:', rmErr.message);
    } else {
      console.log(`Marked ${removedVins.length} VINs as removed`);
    }
  }

  // 4. Report new additions
  const { data: newAdds } = await supabase
    .from('vehicle_inventory')
    .select('vin, year, make, model, trim, price, first_seen_at')
    .eq('status', 'active')
    .gte('first_seen_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('first_seen_at', { ascending: false });

  if (newAdds?.length) {
    console.log(`\nNew in last 24h (${newAdds.length} vehicles):`);
    newAdds.forEach(v => console.log(`  ${v.year} ${v.make} ${v.model} ${v.trim} — $${v.price} — VIN: ${v.vin}`));
  }

  console.log('\nSync complete.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

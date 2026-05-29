import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '/Users/bigwaveauto/Repos/big-wave-auto-main/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data } = await supabase
  .from('rivian_listings')
  .select('id, vin, model, year, trim, battery, asking_price, mileage, location, photos, source, status, description, exterior_color')
  .order('asking_price', { ascending: true, nullsFirst: false })
  .limit(20);

// Mirror the prod sort: by asking_price ascending, nulls (999999) at end.
const sorted = data.sort((a, b) => (a.asking_price || 999999) - (b.asking_price || 999999));

console.log('Top 20 by asking_price asc (matches what the UI shows first):\n');
for (const r of sorted) {
  const photo = r.photos?.[0];
  console.log(`#${r.id} ${r.source.padEnd(8)} ${(r.model||'-').padEnd(4)} ${String(r.year||'-').padEnd(4)} $${String(r.asking_price||'-').padEnd(8)} miles=${String(r.mileage||'-').padEnd(6)} loc=${(r.location||'-').slice(0,18).padEnd(18)} photos=${r.photos?.length||0} status=${r.status||'-'}`);
  if (photo) console.log(`     photo[0]: ${photo.slice(0, 90)}${photo.length > 90 ? '…' : ''}`);
}

// Quick photo health check: how many records have a photo with a URL that's clearly an FB CDN URL (likely to 403)?
const total = data.length;
const noPhoto = data.filter(r => !r.photos?.length).length;
const fbCdnPhoto = data.filter(r => r.photos?.[0]?.includes('fbcdn.net') || r.photos?.[0]?.includes('scontent')).length;
console.log(`\nAmong top 20: ${noPhoto} have no photo, ${fbCdnPhoto} have an FB CDN photo URL`);

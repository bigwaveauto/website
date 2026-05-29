import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

config({ path: '/Users/bigwaveauto/Repos/big-wave-auto-main/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CONFIRM = process.argv.includes('--confirm');

const { data, error } = await supabase
  .from('rivian_listings')
  .select('id, vin, model, year, asking_price, buy_now, photos, source, source_url, description, created_at');

if (error) { console.error('Query failed:', error.message); process.exit(1); }

const isJunk = (r) => {
  if (!r.model || !/^R1[STX]$/i.test(r.model)) return true;
  const hasYear = !!r.year;
  const hasPrice = !!(r.asking_price || r.buy_now);
  const hasPhoto = Array.isArray(r.photos) && r.photos.length > 0;
  return !hasYear && !hasPrice && !hasPhoto;
};

const junk = data.filter(isJunk);

console.log(`Total rows: ${data.length}`);
console.log(`Would delete: ${junk.length}`);
console.log(`Keep: ${data.length - junk.length}`);

// Break down WHY each junk row is junk
const reasons = { noModel: 0, sparse: 0 };
const bySource = {};
for (const r of junk) {
  if (!r.model || !/^R1[STX]$/i.test(r.model)) reasons.noModel++;
  else reasons.sparse++;
  bySource[r.source || 'unknown'] = (bySource[r.source || 'unknown'] || 0) + 1;
}
console.log('\nBreakdown:');
console.log('  No model (not R1S/R1T):', reasons.noModel);
console.log('  Has model but no year/price/photo:', reasons.sparse);
console.log('  By source:', bySource);

console.log('\nSample (first 8):');
for (const r of junk.slice(0, 8)) {
  console.log(`  #${r.id} src=${r.source} model=${r.model || 'NULL'} year=${r.year || 'NULL'} price=${r.asking_price || r.buy_now || 'NULL'} photos=${r.photos?.length || 0}`);
  if (r.description) console.log(`       desc: "${r.description.slice(0, 70)}${r.description.length > 70 ? '…' : ''}"`);
}

if (CONFIRM) {
  if (!junk.length) { console.log('\nNothing to delete.'); process.exit(0); }
  const ids = junk.map(r => r.id);
  // Delete in chunks of 500 to be safe
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { error: delErr } = await supabase.from('rivian_listings').delete().in('id', chunk);
    if (delErr) { console.error('Delete failed:', delErr.message); process.exit(1); }
    deleted += chunk.length;
  }
  console.log(`\nDeleted ${deleted} rows.`);
} else {
  console.log('\n(Dry run — pass --confirm to actually delete.)');
}

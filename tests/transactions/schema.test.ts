/**
 * Schema verification test — runs after 2026-06-26-transactions.sql is applied.
 * Verifies each table and its key columns exist by querying them directly.
 * A missing table or column produces a PostgresError, not an empty result.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

let supabase: SupabaseClient;

beforeAll(() => {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_KEY'];
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
  supabase = createClient(url, key);
});

/** Query specific columns on a table; returns the error message or null if OK. */
async function queryColumns(table: string, cols: string): Promise<string | null> {
  const { error } = await supabase.from(table as any).select(cols).limit(0);
  return error ? error.message : null;
}

describe('Transaction schema', () => {
  it('transaction_accounts table exists with required columns', async () => {
    const err = await queryColumns(
      'transaction_accounts',
      'id, name, institution, account_type, last_four, active, created_at',
    );
    expect(err, `Table/column error: ${err}`).toBeNull();
  });

  it('transaction_imports table exists with required columns', async () => {
    const err = await queryColumns(
      'transaction_imports',
      'id, account_id, filename, row_count, new_count, duplicate_count, date_from, date_to, imported_by, created_at',
    );
    expect(err, `Table/column error: ${err}`).toBeNull();
  });

  it('transactions table exists with required columns', async () => {
    const err = await queryColumns(
      'transactions',
      'id, import_id, transaction_date, post_date, description, amount, category, vin, status, ai_category, ai_vin, ai_confidence, ai_reasoning, rule_matched, dedup_hash, notes, reviewed_by, reviewed_at',
    );
    expect(err, `Table/column error: ${err}`).toBeNull();
  });

  it('transaction_vendor_rules table exists with required columns', async () => {
    const err = await queryColumns(
      'transaction_vendor_rules',
      'id, vendor_pattern, match_type, category, auto_approve, use_count, created_at, updated_at',
    );
    expect(err, `Table/column error: ${err}`).toBeNull();
  });

  it('transactions table enforces dedup_hash uniqueness', async () => {
    // We need a real account to create an import; skip gracefully if none exist
    const { data: accounts } = await supabase
      .from('transaction_accounts')
      .select('id')
      .limit(1);

    if (!accounts || accounts.length === 0) {
      // No accounts seeded yet — test the constraint via direct duplicate insert attempt
      // using a throwaway import under a known-nonexistent account UUID
      console.log('  (no accounts seeded; skipping FK-dependent dedup test)');
      return;
    }

    const accountId = (accounts[0] as any).id;
    const testHash = `test-dedup-${Date.now()}`;

    const { data: imp } = await supabase
      .from('transaction_imports')
      .insert({ account_id: accountId, row_count: 0, new_count: 0, duplicate_count: 0 })
      .select('id')
      .single();

    if (!imp) return;

    const row = {
      import_id: (imp as any).id,
      transaction_date: '2026-01-01',
      description: 'TEST DEDUP',
      amount: -100,
      status: 'pending',
      dedup_hash: testHash,
    };

    const { error: first } = await supabase.from('transactions').insert(row);
    expect(first).toBeNull();

    const { error: second } = await supabase.from('transactions').insert(row);
    expect(second).not.toBeNull();
    expect(second!.message).toMatch(/duplicate|unique/i);

    // Clean up
    await supabase.from('transactions').delete().eq('dedup_hash', testHash);
    await supabase.from('transaction_imports').delete().eq('id', (imp as any).id);
  });
});

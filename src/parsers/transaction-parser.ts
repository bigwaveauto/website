/**
 * Bank CSV parser — normalizes Chase Checking, Chase Credit, AMEX, Capital One,
 * and a generic fallback into a single ParsedTransaction shape.
 *
 * Sign convention (our internal standard):
 *   negative amount = money out (expense / purchase)
 *   positive amount = money in (refund / payment / credit)
 */

export interface ParsedTransaction {
  transactionDate: string;  // ISO YYYY-MM-DD
  postDate?: string;        // ISO YYYY-MM-DD, may be absent
  description: string;
  amount: number;           // negative = expense, positive = credit
  rawRow: Record<string, string>;
}

export type BankFormat =
  | 'chase-checking'
  | 'chase-credit'
  | 'amex'
  | 'capital-one'
  | 'generic';

export interface ParseResult {
  bank: BankFormat;
  transactions: ParsedTransaction[];
  /** Rows that could not be parsed — index + raw line */
  errors: Array<{ row: number; raw: string; reason: string }>;
  /** Validation warning when too many rows have $0 or null dates */
  validationWarning?: string;
}

// ── CSV tokenizer ────────────────────────────────────────────────────────────

/** Parses a CSV string into rows of string cells. Handles quoted fields. */
export function parseCSV(raw: string): string[][] {
  // Strip UTF-8 BOM if present
  const text = raw.startsWith('﻿') ? raw.slice(1) : raw;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell.trim());
        cell = '';
      } else if (ch === '\n') {
        row.push(cell.trim());
        cell = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else if (ch === '\r') {
        // skip \r in \r\n
      } else {
        cell += ch;
      }
    }
  }
  // Flush last cell / row
  row.push(cell.trim());
  if (row.some(c => c !== '')) rows.push(row);

  return rows;
}

// ── Bank fingerprinting ──────────────────────────────────────────────────────

const BANK_SIGNATURES: Array<{ format: BankFormat; must: string[]; any?: string[] }> = [
  {
    format: 'chase-checking',
    must: ['Details', 'Posting Date', 'Description', 'Amount', 'Type', 'Balance'],
  },
  {
    format: 'chase-credit',
    must: ['Transaction Date', 'Post Date', 'Description', 'Category', 'Type', 'Amount'],
  },
  {
    format: 'amex',
    // AMEX headers vary slightly; match on the distinctive combo
    must: ['Date', 'Description', 'Amount'],
    any: ['Extended Details', 'Appears On Your Statement As', 'Reference'],
  },
  {
    format: 'capital-one',
    must: ['Transaction Date', 'Posted Date', 'Card No.', 'Description', 'Debit', 'Credit'],
  },
];

export function detectBankFormat(headers: string[]): BankFormat {
  const hSet = new Set(headers.map(h => h.trim()));
  for (const sig of BANK_SIGNATURES) {
    const allMust = sig.must.every(h => hSet.has(h));
    if (!allMust) continue;
    if (sig.any && !sig.any.some(h => hSet.has(h))) continue;
    return sig.format;
  }
  return 'generic';
}

// ── Date normalizer ──────────────────────────────────────────────────────────

/**
 * Converts MM/DD/YYYY or MM/DD/YY or YYYY-MM-DD → YYYY-MM-DD.
 * Returns null for unparseable strings.
 */
export function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YYYY or M/D/YYYY
  const mdyFull = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyFull) {
    const [, m, d, y] = mdyFull;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // MM/DD/YY → assume 20xx
  const mdyShort = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdyShort) {
    const [, m, d, y] = mdyShort;
    return `20${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

// ── Amount normalizer ────────────────────────────────────────────────────────

/** Strips currency symbols, commas, and whitespace then parses as float. */
export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// ── Per-row parsers ──────────────────────────────────────────────────────────

function makeRow(headers: string[], cells: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  headers.forEach((h, i) => {
    row[h] = cells[i] ?? '';
  });
  return row;
}

function parseChaseChecking(headers: string[], cells: string[]): ParsedTransaction | null {
  const row = makeRow(headers, cells);
  const date = normalizeDate(row['Posting Date']);
  const amount = parseAmount(row['Amount']);
  const desc = row['Description'];
  if (!date || amount === null || !desc) return null;
  return { transactionDate: date, description: desc, amount, rawRow: row };
}

function parseChaseCredit(headers: string[], cells: string[]): ParsedTransaction | null {
  const row = makeRow(headers, cells);
  const txDate = normalizeDate(row['Transaction Date']);
  const postDate = normalizeDate(row['Post Date']) ?? undefined;
  const amount = parseAmount(row['Amount']);
  const desc = row['Description'];
  if (!txDate || amount === null || !desc) return null;
  // Chase CC: purchases are already negative, credits positive — matches our convention
  return { transactionDate: txDate, postDate, description: desc, amount, rawRow: row };
}

function parseAmex(headers: string[], cells: string[]): ParsedTransaction | null {
  const row = makeRow(headers, cells);
  const date = normalizeDate(row['Date']);
  const raw = parseAmount(row['Amount']);
  const desc = row['Description'];
  if (!date || raw === null || !desc) return null;
  // AMEX: positive = charge (money out). Flip so expenses are negative.
  const amount = -raw;
  return { transactionDate: date, description: desc, amount, rawRow: row };
}

function parseCapitalOne(headers: string[], cells: string[]): ParsedTransaction | null {
  const row = makeRow(headers, cells);
  const txDate = normalizeDate(row['Transaction Date']);
  const postDate = normalizeDate(row['Posted Date']) ?? undefined;
  const debit = parseAmount(row['Debit']);    // positive = money out
  const credit = parseAmount(row['Credit']);  // positive = money in
  const desc = row['Description'];
  if (!txDate || !desc) return null;
  let amount: number;
  if (debit !== null && debit !== 0) amount = -debit;  // expense → negative
  else if (credit !== null && credit !== 0) amount = credit; // refund → positive
  else return null;
  return { transactionDate: txDate, postDate, description: desc, amount, rawRow: row };
}

function parseGeneric(headers: string[], cells: string[]): ParsedTransaction | null {
  const row = makeRow(headers, cells);
  // Try common date column names
  const dateVal =
    row['Date'] || row['Transaction Date'] || row['Posting Date'] || row['Posted Date'] || '';
  const date = normalizeDate(dateVal);

  // Try common amount column names
  const amountRaw =
    row['Amount'] || row['Debit'] || row['Credit'] || row['Transaction Amount'] || '';
  const amount = parseAmount(amountRaw);

  // Try common description column names
  const desc =
    row['Description'] || row['Payee'] || row['Merchant'] || row['Name'] || '';

  if (!date || amount === null || !desc) return null;
  return { transactionDate: date, description: desc, amount, rawRow: row };
}

// ── Top-level parser ─────────────────────────────────────────────────────────

/**
 * Parse a raw CSV string from any supported bank.
 * Returns normalized transactions + detected bank format + any row errors.
 */
export function parseTransactionCSV(raw: string): ParseResult {
  const rows = parseCSV(raw);
  if (rows.length < 2) {
    return { bank: 'generic', transactions: [], errors: [] };
  }

  const headers = rows[0];
  const bank = detectBankFormat(headers);

  const parsers: Record<BankFormat, (h: string[], c: string[]) => ParsedTransaction | null> = {
    'chase-checking': parseChaseChecking,
    'chase-credit': parseChaseCredit,
    'amex': parseAmex,
    'capital-one': parseCapitalOne,
    'generic': parseGeneric,
  };
  const rowParser = parsers[bank];

  const transactions: ParsedTransaction[] = [];
  const errors: ParseResult['errors'] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    // Skip rows that look like bank-injected summary lines (fewer cells than headers)
    if (cells.length < Math.min(headers.length, 2)) continue;

    try {
      const tx = rowParser(headers, cells);
      if (tx) {
        transactions.push(tx);
      } else {
        errors.push({ row: i, raw: cells.join(','), reason: 'Missing required fields (date, amount, or description)' });
      }
    } catch (e: any) {
      errors.push({ row: i, raw: cells.join(','), reason: e.message ?? 'Unknown error' });
    }
  }

  // Validation: if >30% of rows have $0 amounts, warn about possible wrong column mapping
  const zeroCount = transactions.filter(t => t.amount === 0).length;
  const validationWarning =
    transactions.length > 0 && zeroCount / transactions.length > 0.3
      ? `Warning: ${zeroCount} of ${transactions.length} rows have $0.00 — verify this is the correct bank format`
      : undefined;

  return { bank, transactions, errors, validationWarning };
}

// ── SHA-256 dedup hash ───────────────────────────────────────────────────────

import { createHash } from 'crypto';

/**
 * Stable dedup hash for a transaction.
 * Uses: transactionDate | amount | normalized-description | accountName
 * Description is uppercased and whitespace-collapsed for resilience.
 */
export function buildDedupHash(
  tx: ParsedTransaction,
  accountName: string,
): string {
  const desc = tx.description.toUpperCase().replace(/\s+/g, ' ').trim();
  const payload = `${tx.transactionDate}|${tx.amount.toFixed(2)}|${desc}|${accountName}`;
  return createHash('sha256').update(payload).digest('hex');
}

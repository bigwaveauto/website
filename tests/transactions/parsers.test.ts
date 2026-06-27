/**
 * Parser unit tests — pure functions, no network/DB.
 * Covers all 4 bank formats + generic fallback + edge cases.
 */
import { describe, it, expect } from 'vitest';
import {
  parseCSV,
  detectBankFormat,
  normalizeDate,
  parseAmount,
  parseTransactionCSV,
  buildDedupHash,
} from '../../src/parsers/transaction-parser';

// ── parseCSV ─────────────────────────────────────────────────────────────────

describe('parseCSV', () => {
  it('splits simple comma-separated rows', () => {
    const result = parseCSV('a,b,c\n1,2,3');
    expect(result).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('handles quoted fields containing commas', () => {
    const result = parseCSV('"Hello, World",foo,bar\n1,2,3');
    expect(result[0][0]).toBe('Hello, World');
  });

  it('handles escaped quotes inside quoted fields', () => {
    const result = parseCSV('"He said ""hi""",test\n');
    expect(result[0][0]).toBe('He said "hi"');
  });

  it('strips UTF-8 BOM from start of file', () => {
    const result = parseCSV('﻿Col1,Col2\nval,2');
    expect(result[0][0]).toBe('Col1');
  });

  it('handles Windows-style \\r\\n line endings', () => {
    const result = parseCSV('a,b\r\n1,2\r\n');
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(['1', '2']);
  });

  it('skips blank lines', () => {
    const result = parseCSV('a,b\n\n1,2\n\n');
    expect(result).toHaveLength(2);
  });

  it('trims whitespace from cell values', () => {
    const result = parseCSV(' a , b \n 1 , 2 ');
    expect(result[0]).toEqual(['a', 'b']);
  });
});

// ── normalizeDate ─────────────────────────────────────────────────────────────

describe('normalizeDate', () => {
  it('passes through ISO dates unchanged', () => {
    expect(normalizeDate('2026-03-15')).toBe('2026-03-15');
  });

  it('converts MM/DD/YYYY to ISO', () => {
    expect(normalizeDate('03/15/2026')).toBe('2026-03-15');
  });

  it('converts M/D/YYYY to ISO (single-digit month/day)', () => {
    expect(normalizeDate('3/5/2026')).toBe('2026-03-05');
  });

  it('converts MM/DD/YY to ISO (assumes 20xx century)', () => {
    expect(normalizeDate('03/15/26')).toBe('2026-03-15');
  });

  it('returns null for empty string', () => {
    expect(normalizeDate('')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(normalizeDate('not-a-date')).toBeNull();
  });
});

// ── parseAmount ───────────────────────────────────────────────────────────────

describe('parseAmount', () => {
  it('parses plain negative number', () => {
    expect(parseAmount('-45.99')).toBe(-45.99);
  });

  it('parses plain positive number', () => {
    expect(parseAmount('100.00')).toBe(100);
  });

  it('strips dollar sign', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
  });

  it('strips commas in large amounts', () => {
    expect(parseAmount('1,000,000.00')).toBe(1000000);
  });

  it('handles AMEX-style positive charge amounts', () => {
    expect(parseAmount('2,500.00')).toBe(2500);
  });

  it('returns null for empty string', () => {
    expect(parseAmount('')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parseAmount('N/A')).toBeNull();
  });
});

// ── detectBankFormat ──────────────────────────────────────────────────────────

describe('detectBankFormat', () => {
  it('detects Chase Checking', () => {
    const headers = ['Details', 'Posting Date', 'Description', 'Amount', 'Type', 'Balance', 'Check or Slip #'];
    expect(detectBankFormat(headers)).toBe('chase-checking');
  });

  it('detects Chase Credit', () => {
    const headers = ['Transaction Date', 'Post Date', 'Description', 'Category', 'Type', 'Amount', 'Memo'];
    expect(detectBankFormat(headers)).toBe('chase-credit');
  });

  it('detects AMEX (with Extended Details column)', () => {
    const headers = ['Date', 'Description', 'Amount', 'Extended Details', 'Appears On Your Statement As', 'Address', 'City/State', 'Zip Code', 'Country', 'Reference', 'Category'];
    expect(detectBankFormat(headers)).toBe('amex');
  });

  it('detects Capital One (with separate Debit/Credit columns)', () => {
    const headers = ['Transaction Date', 'Posted Date', 'Card No.', 'Description', 'Category', 'Debit', 'Credit'];
    expect(detectBankFormat(headers)).toBe('capital-one');
  });

  it('falls back to generic for unknown headers', () => {
    const headers = ['Date', 'Payee', 'Amount', 'Balance'];
    expect(detectBankFormat(headers)).toBe('generic');
  });

  it('is not confused by Chase Credit vs Chase Checking (different date cols)', () => {
    // Chase Checking has "Posting Date"; Chase Credit has "Transaction Date" + "Post Date"
    const checking = ['Details', 'Posting Date', 'Description', 'Amount', 'Type', 'Balance'];
    const credit   = ['Transaction Date', 'Post Date', 'Description', 'Category', 'Type', 'Amount'];
    expect(detectBankFormat(checking)).toBe('chase-checking');
    expect(detectBankFormat(credit)).toBe('chase-credit');
  });
});

// ── parseTransactionCSV — Chase Checking ──────────────────────────────────────

describe('parseTransactionCSV — Chase Checking', () => {
  const csv = [
    'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #',
    'DEBIT,03/15/2026,COPART ONLINE BUYING,-2500.00,ACCT_XFER,12000.00,',
    'DEBIT,03/16/2026,JIFFY LUBE #4521,-89.95,ACCT_XFER,11910.05,',
    'CREDIT,03/17/2026,REFUND FROM VENDOR,150.00,ACCT_XFER,12060.05,',
  ].join('\n');

  it('detects chase-checking format', () => {
    const { bank } = parseTransactionCSV(csv);
    expect(bank).toBe('chase-checking');
  });

  it('parses 3 transactions', () => {
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions).toHaveLength(3);
  });

  it('normalizes dates to ISO format', () => {
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions[0].transactionDate).toBe('2026-03-15');
  });

  it('keeps expenses negative', () => {
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions[0].amount).toBe(-2500);
    expect(transactions[1].amount).toBe(-89.95);
  });

  it('keeps credits positive', () => {
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions[2].amount).toBe(150);
  });

  it('captures description', () => {
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions[0].description).toBe('COPART ONLINE BUYING');
  });

  it('has no parse errors', () => {
    const { errors } = parseTransactionCSV(csv);
    expect(errors).toHaveLength(0);
  });
});

// ── parseTransactionCSV — Chase Credit ───────────────────────────────────────

describe('parseTransactionCSV — Chase Credit Card', () => {
  const csv = [
    'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
    '03/10/2026,03/11/2026,AUTOZONE #1234,Auto Parts,Sale,-145.32,',
    '03/12/2026,03/13/2026,PAYMENT THANK YOU,Payment,Payment,2000.00,',
    '03/14/2026,03/15/2026,"O\'REILLY AUTO, PHOENIX AZ",Auto Parts,Sale,-67.80,',
  ].join('\n');

  it('detects chase-credit format', () => {
    expect(parseTransactionCSV(csv).bank).toBe('chase-credit');
  });

  it('parses all 3 rows', () => {
    expect(parseTransactionCSV(csv).transactions).toHaveLength(3);
  });

  it('handles description with comma inside quotes', () => {
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions[2].description).toBe("O'REILLY AUTO, PHOENIX AZ");
  });

  it('includes post date', () => {
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions[0].postDate).toBe('2026-03-11');
  });

  it('keeps purchase amounts negative', () => {
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions[0].amount).toBe(-145.32);
  });

  it('keeps payment amounts positive', () => {
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions[1].amount).toBe(2000);
  });
});

// ── parseTransactionCSV — AMEX ────────────────────────────────────────────────

describe('parseTransactionCSV — AMEX', () => {
  const csv = [
    'Date,Description,Amount,Extended Details,Appears On Your Statement As,Address,City/State,Zip Code,Country,Reference,Category',
    '03/10/2026,MANHEIM AUTO AUCTION,1500.00,,,,Phoenix AZ,85001,US,REF123,Auto',
    '03/11/2026,SHELL OIL 12345,65.40,,,,Phoenix AZ,85002,US,REF124,Gas',
    '03/12/2026,AMEX PAYMENT,-2000.00,,,,,,US,REF125,Payment',
  ].join('\n');

  it('detects amex format', () => {
    expect(parseTransactionCSV(csv).bank).toBe('amex');
  });

  it('flips AMEX positive charges to negative', () => {
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions[0].amount).toBe(-1500);   // charge → negative
    expect(transactions[1].amount).toBe(-65.40);  // charge → negative
  });

  it('flips AMEX negative payments to positive', () => {
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions[2].amount).toBe(2000);    // payment → positive
  });
});

// ── parseTransactionCSV — Capital One ────────────────────────────────────────

describe('parseTransactionCSV — Capital One', () => {
  const csv = [
    'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit',
    '2026-03-10,2026-03-11,1234,PEP BOYS #456,Auto Parts,89.99,',
    '2026-03-12,2026-03-13,1234,REFUND ADJUSTMENT,Other,,50.00',
    '2026-03-14,2026-03-15,1234,PAYMENT,Payment,,500.00',
  ].join('\n');

  it('detects capital-one format', () => {
    expect(parseTransactionCSV(csv).bank).toBe('capital-one');
  });

  it('converts Debit column to negative amount', () => {
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions[0].amount).toBe(-89.99);
  });

  it('converts Credit column to positive amount', () => {
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions[1].amount).toBe(50);
    expect(transactions[2].amount).toBe(500);
  });
});

// ── parseTransactionCSV — edge cases ─────────────────────────────────────────

describe('parseTransactionCSV — edge cases', () => {
  it('returns empty transactions for file with only a header row', () => {
    const csv = 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #';
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions).toHaveLength(0);
  });

  it('records error rows with missing required fields', () => {
    const csv = [
      'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #',
      'DEBIT,,MISSING DATE,-100.00,ACCT_XFER,1000,',  // blank date
    ].join('\n');
    const { errors } = parseTransactionCSV(csv);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/missing/i);
  });

  it('emits validationWarning when >30% of rows have $0 amount', () => {
    const rows = [
      'Details,Posting Date,Description,Amount,Type,Balance',
      'DEBIT,01/01/2026,Shop A,-100.00,ACH,1000',
      'DEBIT,01/02/2026,Shop B,0.00,ACH,1000',
      'DEBIT,01/03/2026,Shop C,0.00,ACH,1000',
      'DEBIT,01/04/2026,Shop D,0.00,ACH,1000',
    ];
    const { validationWarning } = parseTransactionCSV(rows.join('\n'));
    expect(validationWarning).toBeTruthy();
  });

  it('skips rows that are empty / whitespace only', () => {
    const csv = 'Details,Posting Date,Description,Amount,Type,Balance\nDEBIT,03/01/2026,Shop,-10.00,ACH,990\n\n  \n';
    const { transactions } = parseTransactionCSV(csv);
    expect(transactions).toHaveLength(1);
  });
});

// ── buildDedupHash ────────────────────────────────────────────────────────────

describe('buildDedupHash', () => {
  const tx = {
    transactionDate: '2026-03-15',
    description: 'COPART ONLINE BUYING',
    amount: -2500,
    rawRow: {},
  };

  it('produces a 64-char hex string', () => {
    const hash = buildDedupHash(tx, 'Chase Checking');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic — same input → same hash', () => {
    const a = buildDedupHash(tx, 'Chase Checking');
    const b = buildDedupHash(tx, 'Chase Checking');
    expect(a).toBe(b);
  });

  it('differs when account name differs', () => {
    const a = buildDedupHash(tx, 'Chase Checking');
    const b = buildDedupHash(tx, 'Chase Sapphire');
    expect(a).not.toBe(b);
  });

  it('differs when amount differs', () => {
    const a = buildDedupHash(tx, 'Chase Checking');
    const b = buildDedupHash({ ...tx, amount: -2499 }, 'Chase Checking');
    expect(a).not.toBe(b);
  });

  it('is case-insensitive on description', () => {
    const lower = { ...tx, description: 'copart online buying' };
    const upper = { ...tx, description: 'COPART ONLINE BUYING' };
    expect(buildDedupHash(lower, 'Chase Checking')).toBe(
      buildDedupHash(upper, 'Chase Checking'),
    );
  });

  it('collapses extra whitespace in description', () => {
    const extra = { ...tx, description: 'COPART  ONLINE   BUYING' };
    expect(buildDedupHash(extra, 'Chase Checking')).toBe(
      buildDedupHash(tx, 'Chase Checking'),
    );
  });
});

import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

interface TxDetail {
  dealNo: string;
  vehicle: string;
  stockNo: string;
  buyer: string;
  date: string;
  amount: number;
}

interface TaxResult {
  month: number;
  year: number;
  transactionCount: number;
  state: {
    totalSales: number;
    exemptCertificates: number;
    otherExempt: number;
    returnsAllowances: number;
    other: number;
    totalSubtractions: number;
    salesSubjectToTax: number;
    stateSalesTax: number;
  };
  transactions: {
    totalSales: TxDetail[];
    exemptCertificates: TxDetail[];
    otherExempt: TxDetail[];
    returnsAllowances: TxDetail[];
    salesSubjectToTax: TxDetail[];
    stateSalesTax: TxDetail[];
    milwaukee: TxDetail[];
  };
  counties: Array<{ name: string; salesSubjectToTax: number; transactions: TxDetail[] }>;
  milwaukee: { salesSubjectToCitySalesTax: number };
}

@Component({
  selector: 'app-tax-filing',
  templateUrl: './tax-filing.component.html',
  styleUrl: './tax-filing.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
})
export class TaxFilingComponent {
  private http = inject(HttpClient);

  selectedMonth = new Date().getMonth();
  selectedYear = new Date().getFullYear();
  selectedFile: File | null = null;

  processing = signal(false);
  error = signal('');
  result = signal<TaxResult | null>(null);
  copied = signal('');
  expanded = signal<Set<string>>(new Set());

  months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  get years(): number[] {
    const cur = new Date().getFullYear();
    return [cur, cur - 1, cur - 2];
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] || null;
    this.error.set('');
  }

  generate() {
    if (!this.selectedFile) { this.error.set('Please select an Excel file.'); return; }
    this.processing.set(true);
    this.error.set('');
    this.result.set(null);
    this.expanded.set(new Set());

    const fd = new FormData();
    fd.append('file', this.selectedFile);
    fd.append('month', String(Number(this.selectedMonth) + 1));
    fd.append('year', String(Number(this.selectedYear)));

    this.http.post<TaxResult>('/api/admin/tax/process', fd).subscribe({
      next: (r) => { this.result.set(r); this.processing.set(false); },
      error: (e) => {
        this.error.set(e.error?.error || 'Failed to process file.');
        this.processing.set(false);
      },
    });
  }

  toggleExpand(key: string) {
    const s = new Set(this.expanded());
    if (s.has(key)) s.delete(key); else s.add(key);
    this.expanded.set(s);
  }

  isExpanded(key: string): boolean {
    return this.expanded().has(key);
  }

  getTx(key: string): TxDetail[] {
    const r = this.result();
    if (!r) return [];
    const txMap: Record<string, TxDetail[]> = {
      l1: r.transactions.totalSales,
      l2: r.transactions.exemptCertificates,
      l3: r.transactions.otherExempt,
      l4: r.transactions.returnsAllowances,
      l7: r.transactions.salesSubjectToTax,
      l8: r.transactions.stateSalesTax,
      milwaukee: r.transactions.milwaukee,
    };
    // County keys
    if (key.startsWith('c-') && r.counties) {
      const county = r.counties.find(c => 'c-' + c.name === key);
      return county?.transactions || [];
    }
    return txMap[key] || [];
  }

  fmt(n: number): string {
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  }

  copyValue(value: number, label: string) {
    navigator.clipboard.writeText(value.toFixed(2));
    this.copied.set(label);
    setTimeout(() => this.copied.set(''), 1500);
  }

  copyAll() {
    const r = this.result();
    if (!r) return;
    const lines = [
      `Sales Tax - State`,
      `1. Total Sales: ${r.state.totalSales.toFixed(2)}`,
      `2. Exemption Certificates: ${r.state.exemptCertificates.toFixed(2)}`,
      `3. Other Exempt: ${r.state.otherExempt.toFixed(2)}`,
      `4. Returns/Allowances: ${r.state.returnsAllowances.toFixed(2)}`,
      `5. Other: ${r.state.other.toFixed(2)}`,
      `6. Total Subtractions: ${r.state.totalSubtractions.toFixed(2)}`,
      `7. Sales Subject to Tax: ${r.state.salesSubjectToTax.toFixed(2)}`,
      `8. State Sales Tax: ${r.state.stateSalesTax.toFixed(2)}`,
      ``,
      `County Sales and Use Tax`,
      ...r.counties.map(c => `${c.name}: ${c.salesSubjectToTax.toFixed(2)}`),
      ``,
      `City Sales and Use`,
      `Milwaukee: ${r.milwaukee.salesSubjectToCitySalesTax.toFixed(2)}`,
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    this.copied.set('all');
    setTimeout(() => this.copied.set(''), 2000);
  }

  printPdf() {
    const r = this.result();
    if (!r) return;

    const fmtAmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const txTable = (txs: TxDetail[]) => {
      if (!txs.length) return '<p style="color:#999;font-size:12px;">No transactions</p>';
      return `<table class="tx-table">
        <thead><tr><th>Deal #</th><th>Date</th><th>Vehicle</th><th>Buyer</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${txs.map(t => `<tr><td>${t.dealNo}</td><td>${t.date}</td><td>${t.vehicle}</td><td>${t.buyer}</td><td style="text-align:right">${fmtAmt(t.amount)}</td></tr>`).join('')}
        <tr class="tx-total"><td colspan="4"><b>Total</b></td><td style="text-align:right"><b>${fmtAmt(txs.reduce((s, t) => s + t.amount, 0))}</b></td></tr>
        </tbody></table>`;
    };

    const html = `<!DOCTYPE html><html><head><title>Sales Tax Report - ${this.months[r.month - 1]} ${r.year}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 13px; color: #111; max-width: 900px; margin: 0 auto; padding: 24px; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 2px solid #111; padding-bottom: 4px; }
      h3 { font-size: 14px; margin: 16px 0 6px; color: #333; }
      .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
      .summary-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
      .summary-table td { padding: 6px 8px; border-bottom: 1px solid #e5e5e5; }
      .summary-table .num { font-weight: 600; text-align: right; width: 140px; }
      .summary-table .label { color: #333; }
      .summary-table .gray td { color: #999; }
      .summary-table .bold td { font-weight: 700; border-top: 2px solid #333; }
      .tx-table { width: 100%; border-collapse: collapse; margin: 4px 0 16px; font-size: 11px; }
      .tx-table th { text-align: left; font-size: 10px; font-weight: 600; color: #666; padding: 4px 6px; border-bottom: 1px solid #ccc; }
      .tx-table td { padding: 3px 6px; border-bottom: 1px solid #eee; }
      .tx-total td { border-top: 1px solid #999; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <h1>Sales Tax Report</h1>
    <p class="meta">Big Wave Auto LLC &mdash; ${this.months[r.month - 1]} ${r.year} &mdash; ${r.transactionCount} transactions</p>

    <h2>Sales Tax - State</h2>
    <table class="summary-table">
      <tr><td class="label">1. Total sales</td><td class="num">${fmtAmt(r.state.totalSales)}</td></tr>
      <tr><td class="label">2. Exemption certificates</td><td class="num">${fmtAmt(r.state.exemptCertificates)}</td></tr>
      <tr><td class="label">3. Other exempt (out-of-state)</td><td class="num">${fmtAmt(r.state.otherExempt)}</td></tr>
      <tr><td class="label">4. Returns, allowances, bad debts</td><td class="num">${fmtAmt(r.state.returnsAllowances)}</td></tr>
      <tr><td class="label">5. Other</td><td class="num">${fmtAmt(r.state.other)}</td></tr>
      <tr class="gray"><td class="label">6. Total subtractions</td><td class="num">${fmtAmt(r.state.totalSubtractions)}</td></tr>
      <tr class="gray"><td class="label">7. Sales subject to state sales tax</td><td class="num">${fmtAmt(r.state.salesSubjectToTax)}</td></tr>
      <tr class="bold"><td class="label">8. State sales tax</td><td class="num">${fmtAmt(r.state.stateSalesTax)}</td></tr>
    </table>

    <h3>Line 1 &mdash; Total Sales (${r.transactions.totalSales.length})</h3>
    ${txTable(r.transactions.totalSales)}

    <h3>Line 2 &mdash; Exemption Certificates / Wholesale (${r.transactions.exemptCertificates.length})</h3>
    ${txTable(r.transactions.exemptCertificates)}

    <h3>Line 3 &mdash; Other Exempt / Out-of-State (${r.transactions.otherExempt.length})</h3>
    ${txTable(r.transactions.otherExempt)}

    <h3>Line 4 &mdash; Trade-In Allowances (${r.transactions.returnsAllowances.length})</h3>
    ${txTable(r.transactions.returnsAllowances)}

    <h3>Line 8 &mdash; State Sales Tax (${r.transactions.stateSalesTax.length})</h3>
    ${txTable(r.transactions.stateSalesTax)}

    <h2>Schedule CT &mdash; County Sales and Use Tax</h2>
    ${r.counties.map(c => `<h3>${c.name} (${c.transactions.length})</h3>${txTable(c.transactions)}`).join('')}

    <h2>City Sales and Use &mdash; Milwaukee</h2>
    ${txTable(r.transactions.milwaukee)}

    </body></html>`;

    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
    }
  }
}

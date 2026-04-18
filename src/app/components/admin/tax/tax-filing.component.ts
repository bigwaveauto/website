import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

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
  counties: Array<{ name: string; salesSubjectToTax: number }>;
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

  selectedMonth = new Date().getMonth(); // 0-indexed, will +1 for display
  selectedYear = new Date().getFullYear();
  selectedFile: File | null = null;

  processing = signal(false);
  error = signal('');
  result = signal<TaxResult | null>(null);
  copied = signal('');

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

    const fd = new FormData();
    fd.append('file', this.selectedFile);
    fd.append('month', String(this.selectedMonth + 1)); // 1-indexed
    fd.append('year', String(this.selectedYear));

    this.http.post<TaxResult>('/api/admin/tax/process', fd).subscribe({
      next: (r) => { this.result.set(r); this.processing.set(false); },
      error: (e) => {
        this.error.set(e.error?.error || 'Failed to process file.');
        this.processing.set(false);
      },
    });
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
}

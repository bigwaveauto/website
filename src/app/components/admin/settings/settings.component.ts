import { Component, signal, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
  'WV','WI','WY',
]);

const STATE_NAMES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',
  CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',
  LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',
  MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',
  NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',
  OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',
  WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
};

interface FinanceSettings {
  lowestRate: string;
  lowestRateTerm: string;
  defaultInterestRate: number;
  defaultLoanTerm: number;
  defaultOtherFees: number;
  defaultState: string;
  lendingPartnerCount: string;
  downOptions: string;
  preApprovalSpeed: string;
  notificationEmail: string;
}

@Component({
  selector: 'admin-settings',
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
})
export class AdminSettingsComponent implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  activeTab = signal<string>('finance');
  loading = signal(false);
  saving = signal(false);
  saved = signal(false);

  tabs = [
    { key: 'finance',  label: 'Finance',  icon: 'banknote' },
    { key: 'sales',    label: 'Sales Stats', icon: 'bar-chart-3' },
  ];

  finance: FinanceSettings = {
    lowestRate: '6.9%',
    lowestRateTerm: '60-month term',
    defaultInterestRate: 6.9,
    defaultLoanTerm: 60,
    defaultOtherFees: 1200,
    defaultState: 'Wisconsin',
    lendingPartnerCount: '10+',
    downOptions: '$0',
    preApprovalSpeed: 'Same Day',
    notificationEmail: 'dave@bigwaveauto.com',
  };

  readonly termOptions = [24, 36, 48, 60, 72, 84];

  ngOnInit() {
    this.loadSettings();
    this.loadSalesStats();
  }

  setTab(key: string) {
    this.activeTab.set(key);
    this.saved.set(false);
  }

  loadSettings() {
    this.http.get<{ settings: Record<string, any> }>('/api/admin/settings').subscribe({
      next: (res) => {
        if (res.settings?.['finance']) {
          this.finance = { ...this.finance, ...res.settings['finance'] };
        }
        this.loading.set(false);
      },
      error: () => {
        // Use defaults if no settings saved yet
        this.loading.set(false);
      },
    });
  }

  saveFinance() {
    this.saving.set(true);
    this.saved.set(false);
    this.http.post('/api/admin/settings', { category: 'finance', settings: this.finance }).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: () => {
        this.saving.set(false);
        alert('Failed to save settings. Please try again.');
      },
    });
  }

  // ── Sales Stats ──
  salesReportText = '';
  xlsDragOver = signal(false);
  xlsUploading = signal(false);
  salesByState = signal<Record<string, number>>({});
  totalSales = signal(0);
  salesParsed = signal(false);
  savingSales = signal(false);
  salesSaved = signal(false);

  readonly brandLogos: Record<string, string> = {
    'Acura': '/brands/acura.png', 'Alfa Romeo': '/brands/alfa-romeo.png',
    'Aston Martin': '/brands/aston-martin.png', 'Audi': '/brands/audi.png',
    'Bentley': '/brands/bentley.png', 'BMW': '/brands/bmw.png',
    'Buick': '/brands/buick.png', 'Cadillac': '/brands/cadillac.png',
    'Chevrolet': '/brands/chevrolet.png', 'Chrysler': '/brands/chrysler.png',
    'Dodge': '/brands/dodge.png', 'Ferrari': '/brands/ferrari.png',
    'Ford': '/brands/ford.png', 'Genesis': '/brands/genesis.png',
    'GMC': '/brands/gmc.png', 'Honda': '/brands/honda.png',
    'Hyundai': '/brands/hyundai.png', 'Infiniti': '/brands/infiniti.png',
    'Jaguar': '/brands/jaguar.png', 'Jeep': '/brands/jeep.png',
    'Kia': '/brands/kia.png', 'Lamborghini': '/brands/lamborghini.png',
    'Land Rover': '/brands/land-rover.png', 'Lexus': '/brands/lexus.png',
    'Lincoln': '/brands/lincoln.png', 'Lucid': '/brands/lucid.png',
    'Maserati': '/brands/maserati.png', 'Mazda': '/brands/mazda.png',
    'Mercedes-Benz': '/brands/mercedes-benz.png', 'Mini': '/brands/mini.png',
    'Mitsubishi': '/brands/mitsubishi.png', 'Nissan': '/brands/nissan.png',
    'Polestar': '/brands/polestar.png', 'Porsche': '/brands/porsche.png',
    'Ram': '/brands/ram.png', 'Rivian': '/brands/rivian.png',
    'Rolls-Royce': '/brands/rolls-royce.png', 'Subaru': '/brands/subaru.png',
    'Tesla': '/brands/tesla.png', 'Toyota': '/brands/toyota.png',
    'Volkswagen': '/brands/volkswagen.png', 'Volvo': '/brands/volvo.png',
  };
  topBrands = signal<{ name: string; count: number; logo: string }[]>([]);
  brandReportText = '';

  get salesStateList() {
    return Object.entries(this.salesByState())
      .map(([code, count]) => ({ code, name: STATE_NAMES[code] || code, count }))
      .sort((a, b) => b.count - a.count);
  }

  loadSalesStats() {
    this.http.get<any>('/api/sales-stats').subscribe({
      next: (data) => {
        if (!data) return;
        if (data.sales_by_state) {
          this.salesByState.set(data.sales_by_state);
          this.totalSales.set(data.total_sales || 0);
          this.salesParsed.set(true);
        }
        if (data.top_brands?.length) this.topBrands.set(data.top_brands);
      },
    });
  }

  onXlsDragOver(e: DragEvent) { e.preventDefault(); this.xlsDragOver.set(true); }

  onXlsDrop(e: DragEvent) {
    e.preventDefault();
    this.xlsDragOver.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) this.uploadXls(file);
  }

  onXlsSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) this.uploadXls(input.files[0]);
  }

  uploadXls(file: File) {
    this.xlsUploading.set(true);
    const formData = new FormData();
    formData.append('file', file);

    this.http.post<any>('/api/admin/sales-stats/upload', formData).subscribe({
      next: (res) => {
        if (res.salesByState) {
          this.salesByState.set(res.salesByState);
          this.totalSales.set(res.totalSales || 0);
          this.salesParsed.set(true);
        }
        if (res.topBrands?.length) this.topBrands.set(res.topBrands);
        this.xlsUploading.set(false);
      },
      error: () => {
        this.xlsUploading.set(false);
        alert('Failed to parse spreadsheet. Make sure it contains state codes or names with counts.');
      },
    });
  }

  parseSalesReport() {
    const text = this.salesReportText.trim();
    if (!text) return;

    const stateCount: Record<string, number> = {};
    // Try to find 2-letter state codes in the text
    // Supports formats like: "WI 81", "WI,81", "WI: 81", "Wisconsin 81", or just state codes per line
    const lines = text.split(/\n/);
    for (const line of lines) {
      // Try to match "STATE_CODE number" or "STATE_CODE, number"
      const match = line.match(/\b([A-Z]{2})\b[^A-Za-z0-9]*(\d+)/);
      if (match && US_STATES.has(match[1])) {
        stateCount[match[1]] = (stateCount[match[1]] || 0) + parseInt(match[2], 10);
        continue;
      }
      // Try to find full state names
      for (const [code, name] of Object.entries(STATE_NAMES)) {
        const re = new RegExp(`\\b${name}\\b[^A-Za-z0-9]*(\\d+)`, 'i');
        const nameMatch = line.match(re);
        if (nameMatch) {
          stateCount[code] = (stateCount[code] || 0) + parseInt(nameMatch[1], 10);
        }
      }
      // If no number paired with state, just count state mentions
      if (!Object.keys(stateCount).length || !line.match(/\d/)) {
        const codeMatch = line.match(/\b([A-Z]{2})\b/g);
        if (codeMatch) {
          for (const code of codeMatch) {
            if (US_STATES.has(code)) stateCount[code] = (stateCount[code] || 0) + 1;
          }
        }
      }
    }

    const total = Object.values(stateCount).reduce((s, n) => s + n, 0);
    this.salesByState.set(stateCount);
    this.totalSales.set(total);
    this.salesParsed.set(true);
  }

  parseBrandReport() {
    const text = this.brandReportText.trim();
    if (!text) return;
    const brandCount: Record<string, number> = {};
    const lines = text.split(/\n/);
    for (const line of lines) {
      const match = line.match(/(.+?)[,:\t]\s*(\d+)/);
      if (match) {
        const name = match[1].trim();
        brandCount[name] = (brandCount[name] || 0) + parseInt(match[2], 10);
      }
    }
    const brands = Object.entries(brandCount)
      .map(([name, count]) => ({ name, count, logo: this.brandLogos[name] || '' }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    this.topBrands.set(brands);
  }

  saveSalesStats() {
    this.savingSales.set(true);
    this.salesSaved.set(false);
    this.http.post('/api/admin/sales-stats', {
      salesByState: this.salesByState(),
      totalSales: this.totalSales(),
      topBrands: this.topBrands(),
    }).subscribe({
      next: () => {
        this.savingSales.set(false);
        this.salesSaved.set(true);
        setTimeout(() => this.salesSaved.set(false), 3000);
      },
      error: () => {
        this.savingSales.set(false);
        alert('Failed to save sales stats.');
      },
    });
  }
}

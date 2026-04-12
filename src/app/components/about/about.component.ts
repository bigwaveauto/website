import { Component, inject, OnInit, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';
import { RouterLink } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';
import { US_STATE_PATHS } from './us-state-paths';

interface StateDetail {
  count: number;
  zips: Record<string, number>;
  topVehicles: { name: string; count: number }[];
}

@Component({
  selector: 'about',
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink, HeaderComponent, FooterComponent]
})
export class AboutComponent implements OnInit {
  private http = inject(HttpClient);

  // Sales data by state — rich structure with zips and vehicles
  salesByState: Record<string, StateDetail | number> = {
    WI: 81, IL: 12, TX: 3, NJ: 2, KY: 2, MO: 2, MD: 2,
    CO: 1, MA: 1, ND: 1, FL: 1, AZ: 1, PA: 1, IN: 1, GA: 1, WA: 1, NY: 1, MN: 1,
  };

  totalSales = 174;
  statesReached = Object.keys(this.salesByState).length;

  // All US state paths for SVG map
  readonly stateEntries = Object.entries(US_STATE_PATHS).map(([code, path]) => ({ code, path }));

  // State code -> full name
  readonly stateNames: Record<string, string> = {
    AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',
    CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',
    IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',
    ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',
    MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
    NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',
    OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',
    TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',
    WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia',
  };

  // Tooltip state
  tooltipState = signal('');
  tooltipCount = signal(0);
  tooltipX = signal(0);
  tooltipY = signal(0);
  tooltipVisible = signal(false);

  // State detail modal
  detailOpen = signal(false);
  detailState = signal('');
  detailStateName = signal('');
  detailCount = signal(0);
  detailZips = signal<{ zip: string; count: number }[]>([]);
  detailVehicles = signal<{ name: string; count: number }[]>([]);

  /** Get count from salesByState entry (handles both old flat number and new rich object) */
  getStateCount(stateCode: string): number {
    const entry = this.salesByState[stateCode];
    if (!entry) return 0;
    if (typeof entry === 'number') return entry;
    return entry.count || 0;
  }

  getStateFill(stateCode: string): string {
    const count = this.getStateCount(stateCode);
    if (count === 0) return '#1e293b';
    if (count === 1) return '#1e4a6e';
    if (count <= 3) return '#1a78c2';
    if (count <= 12) return '#38bdf8';
    return '#7dd3fc'; // 80+ (WI)
  }

  onStateHover(e: MouseEvent, stateCode: string, stateName: string) {
    const count = this.getStateCount(stateCode);
    if (count === 0) return;
    this.tooltipState.set(stateName);
    this.tooltipCount.set(count);
    this.tooltipX.set(e.clientX);
    this.tooltipY.set(e.clientY - 40);
    this.tooltipVisible.set(true);
  }

  onStateLeave() {
    this.tooltipVisible.set(false);
  }

  onStateClick(stateCode: string) {
    const entry = this.salesByState[stateCode];
    if (!entry) return;
    const count = this.getStateCount(stateCode);
    if (count === 0) return;

    this.detailState.set(stateCode);
    this.detailStateName.set(this.stateNames[stateCode] || stateCode);
    this.detailCount.set(count);

    if (typeof entry === 'object') {
      // Rich data available
      const sortedZips = Object.entries(entry.zips || {})
        .map(([zip, cnt]) => ({ zip, count: cnt }))
        .sort((a, b) => b.count - a.count);
      this.detailZips.set(sortedZips);
      this.detailVehicles.set((entry.topVehicles || []).slice(0, 5));
    } else {
      // Flat number — no detail available
      this.detailZips.set([]);
      this.detailVehicles.set([]);
    }

    this.detailOpen.set(true);
    this.tooltipVisible.set(false);
  }

  closeDetail() {
    this.detailOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscKey() {
    if (this.detailOpen()) this.closeDetail();
  }

  // Top brands sold — defaults, overwritten by API
  topBrands: { name: string; count: number; logo: string }[] = [
    { name: 'Tesla', count: 34, logo: '/brands/tesla.png' },
    { name: 'Rivian', count: 25, logo: '/brands/rivian.png' },
    { name: 'BMW', count: 24, logo: '/brands/bmw.png' },
    { name: 'Porsche', count: 10, logo: '/brands/porsche.png' },
  ];

  ngOnInit() {
    this.http.get<any>('/api/sales-stats').subscribe({
      next: (data) => {
        if (!data) return;
        if (data.sales_by_state) {
          this.salesByState = data.sales_by_state;
          this.statesReached = Object.keys(this.salesByState).length;
        }
        if (data.total_sales) this.totalSales = data.total_sales;
        if (data.top_brands?.length) this.topBrands = data.top_brands.slice(0, 4);
      },
    });
  }
}

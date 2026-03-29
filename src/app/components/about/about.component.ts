import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { RouterLink } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';
import { US_STATE_PATHS } from './us-state-paths';

@Component({
  selector: 'about',
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink, HeaderComponent, FooterComponent]
})
export class AboutComponent {
  // Sales data by state (from sales tax report)
  salesByState: Record<string, number> = {
    WI: 81, IL: 12, TX: 3, NJ: 2, KY: 2, MO: 2, MD: 2,
    CO: 1, MA: 1, ND: 1, FL: 1, AZ: 1, PA: 1, IN: 1, GA: 1, WA: 1, NY: 1, MN: 1,
  };

  totalSales = 115; // known-state sales
  statesReached = Object.keys(this.salesByState).length;

  // All US state paths for SVG map
  readonly stateEntries = Object.entries(US_STATE_PATHS).map(([code, path]) => ({ code, path }));

  // State code → full name
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

  getStateFill(stateCode: string): string {
    const count = this.salesByState[stateCode] || 0;
    if (count === 0) return '#1e293b';
    if (count === 1) return '#1e4a6e';
    if (count <= 3) return '#1a78c2';
    if (count <= 12) return '#38bdf8';
    return '#7dd3fc'; // 80+ (WI)
  }

  onStateHover(e: MouseEvent, stateCode: string, stateName: string) {
    const count = this.salesByState[stateCode] || 0;
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

  // Top brands sold
  topBrands = [
    { name: 'Tesla', count: 34, logo: '/brands/tesla-logo.svg' },
    { name: 'Rivian', count: 25, logo: '/brands/rivian-logo.svg' },
    { name: 'BMW', count: 24, logo: '/brands/bmw-logo-2022.svg' },
    { name: 'Porsche', count: 10, logo: '/brands/porsche-logo.svg' },
    { name: 'Toyota', count: 10, logo: '' },
  ];
}

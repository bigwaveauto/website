import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'admin-appraisal',
  templateUrl: './appraisal.component.html',
  styleUrl: './appraisal.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
})
export class AdminAppraisalComponent implements OnInit {
  private http = inject(HttpClient);

  // Entry
  entryMode = signal<'vin' | 'manual'>('vin');
  vinInput = '';
  odometerInput = '';
  decoding = signal(false);
  decodeError = signal('');

  // Manual entry fields
  manualYear = '';
  manualMake = '';
  manualModel = '';
  manualTrim = '';

  readonly currentYear = new Date().getFullYear();
  readonly years = Array.from({ length: 30 }, (_, i) => this.currentYear + 1 - i);
  readonly makes = [
    'Acura','Alfa Romeo','Aston Martin','Audi','Bentley','BMW','Buick',
    'Cadillac','Chevrolet','Chrysler','Dodge','Ferrari','Ford',
    'Genesis','GMC','Honda','Hyundai','Infiniti','Jaguar','Jeep','Kia',
    'Lamborghini','Land Rover','Lexus','Lincoln','Lotus',
    'Lucid','Maserati','Mazda','McLaren','Mercedes-Benz','MINI',
    'Nissan','Polestar','Porsche','Ram','Rivian','Rolls-Royce',
    'Subaru','Tesla','Toyota','Volkswagen','Volvo',
  ];

  // Vehicle
  vehicle = signal<any>(null);
  activeTab = signal<'detailed' | 'comps'>('detailed');

  // Market data
  marketData = signal<any>(null);
  loadingMarket = signal(false);

  // NeoVIN data
  neovinData = signal<any>(null);
  loadingNeovin = signal(false);
  msrp = signal(0);
  cityMpg = signal(0);
  hwyMpg = signal(0);

  // Color picker
  availableColors = signal<{ color: string; count: number }[]>([]);
  showColorPicker = signal(false);

  // History
  vehicleHistory = signal<any>(null);
  loadingHistory = signal(false);

  // Condition adjustments
  exteriorColor = signal('');
  interiorColor = signal('');
  keyCount = signal(2);
  hasFrameDamage = signal(false);
  hasBadVhr = signal(false);
  owners = signal<'1' | '2' | '3+'>('1');
  serviceStatus = signal<'certified' | 'as-traded'>('as-traded');

  // Options — each has label + value adjustment
  selectedOptions = signal<{ label: string; value: number }[]>([]);

  // Disposition + costs
  disposition = signal<'retail' | 'wholesale'>('retail');
  appraisedValue = signal<number | null>(null);
  recon = signal<number | null>(null);
  transportation = signal<number | null>(null);
  auctionFee = signal<number | null>(null);
  otherCost = signal<number | null>(null);
  askingPrice = signal<number | null>(null);
  profitLocked = signal(false);
  lockedProfit = signal<number | null>(null);

  // History list
  appraisalHistory = signal<any[]>([]);
  loadingHistory2 = signal(false);
  historySearch = '';

  get filteredHistory(): any[] {
    const q = this.historySearch.toLowerCase();
    if (!q) return this.appraisalHistory();
    return this.appraisalHistory().filter(a => {
      const v = a.vehicle || {};
      return [v.year, v.make, v.model, v.trim, a.vin].join(' ').toLowerCase().includes(q);
    });
  }

  // Saving
  saving = signal(false);
  saved = signal(false);

  // Odometer base (from NHTSA/market) vs actual
  get odometerDelta(): number {
    const market = this.marketData()?.market_miles_mean || this.marketData()?.stats?.miles?.mean || 0;
    const actual = this.vehicle()?.mileage || 0;
    if (!market || !actual) return 0;
    return Math.round((market - actual) * 0.08);
  }

  get optionsTotal(): number {
    return this.selectedOptions().reduce((s, o) => s + o.value, 0);
  }

  get colorAdj(): number {
    // Common color adjustments
    const premiums: Record<string, number> = {
      'white': 200, 'black': 150, 'silver': 100, 'gray': 100,
      'red': -200, 'yellow': -300, 'orange': -400, 'green': -150,
    };
    const c = (this.exteriorColor() || '').toLowerCase();
    for (const [color, adj] of Object.entries(premiums)) {
      if (c.includes(color)) return adj;
    }
    return 0;
  }

  get keyAdj(): number {
    const k = this.keyCount();
    if (k === 0) return -500;
    if (k === 1) return -150;
    return 0;
  }

  get conditionAdj(): number {
    let adj = 0;
    if (this.hasFrameDamage()) adj -= 2000;
    if (this.hasBadVhr()) adj -= 1000;
    return adj;
  }

  get totalAdjustments(): number {
    return this.odometerDelta + this.optionsTotal + this.colorAdj + this.keyAdj + this.conditionAdj;
  }

  get mmr(): number { return this.marketData()?.mmr || 0; }
  get marketAvg(): number { return this.marketData()?.market_avg || 0; }
  get marketDaysSupply(): number { return this.marketData()?.market_days_supply || 0; }
  get activeComps(): any[] { return this.marketData()?.active_comps || []; }
  get soldComps(): any[] { return this.marketData()?.sold_comps || []; }
  get vinHistory(): any[] { return this.marketData()?.vin_history || []; }

  // AccuTrade-style computed offers
  get targetAuction(): number {
    if (!this.mmr) return 0;
    return Math.round((this.mmr + this.totalAdjustments) * 0.97 / 25) * 25;
  }

  get targetRetail(): number {
    if (!this.marketAvg) return 0;
    return Math.round((this.marketAvg + this.totalAdjustments) * 0.98 / 25) * 25;
  }

  get instantOffer(): number {
    if (!this.targetAuction) return 0;
    return Math.round(this.targetAuction * 0.96 / 25) * 25;
  }

  get totalCost(): number {
    return (this.appraisedValue() || 0)
      + (this.recon() || 0)
      + (this.transportation() || 0)
      + (this.auctionFee() || 0)
      + (this.otherCost() || 0);
  }

  get profit(): number {
    return (this.askingPrice() || 0) - this.totalCost;
  }

  get adjPctOfMarket(): number | null {
    if (!this.marketAvg || !this.askingPrice()) return null;
    return Math.round((this.askingPrice()! / this.marketAvg) * 100);
  }

  ngOnInit() { this.loadAppraisalHistory(); }

  loadAppraisalHistory() {
    this.loadingHistory2.set(true);
    this.http.get<any[]>('/api/admin/appraisals').subscribe({
      next: (data) => { this.appraisalHistory.set(data); this.loadingHistory2.set(false); },
      error: () => this.loadingHistory2.set(false),
    });
  }

  deleteAppraisal(id: string) {
    this.http.delete(`/api/admin/appraisals/${id}`).subscribe({
      next: () => this.appraisalHistory.update(list => list.filter(a => a.id !== id)),
    });
  }

  loadAppraisal(a: any) {
    const v = a.vehicle || {};
    this.vehicle.set(v);
    this.appraisedValue.set(a.appraised_value || null);
    this.askingPrice.set(a.asking_price || null);
    this.disposition.set(a.disposition || 'retail');
    if (v.mileage) this.odometerInput = String(v.mileage);
    if (a.vin) {
      this.loadMarketData(a.vin, v.year, v.make, v.model, v.trim, v.mileage);
      this.loadNeovinData(a.vin);
    }
  }

  decodeVin() {
    const vin = this.vinInput.trim().toUpperCase();
    if (vin.length !== 17) { this.decodeError.set('VIN must be 17 characters.'); return; }
    this.decoding.set(true);
    this.decodeError.set('');
    this.http.get<any>(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`).subscribe({
      next: (res) => {
        const r = res?.Results?.[0];
        if (!r?.ModelYear) { this.decodeError.set('VIN not found.'); this.decoding.set(false); return; }
        const mileage = parseInt(this.odometerInput.replace(/[^0-9]/g, ''), 10) || 0;
        this.vehicle.set({
          vin,
          year: r.ModelYear || '',
          make: r.Make ? r.Make.charAt(0) + r.Make.slice(1).toLowerCase() : '',
          model: r.Model || '',
          trim: r.Trim || r.Series || '',
          body: r.BodyClass || '',
          engine: r.DisplacementL ? `${parseFloat(r.DisplacementL).toFixed(1)}L ${r.EngineCylinders ? r.EngineCylinders + '-cyl' : ''}`.trim() : '',
          transmission: r.TransmissionStyle || '',
          drivetrain: r.DriveType || '',
          fuel: r.FuelTypePrimary || '',
          mileage,
        });
        this.decoding.set(false);
        this.loadMarketData(vin, r.ModelYear, r.Make, r.Model, r.Trim, mileage);
        this.loadNeovinData(vin);
      },
      error: () => { this.decodeError.set('Failed to decode VIN.'); this.decoding.set(false); },
    });
  }

  decodeManual() {
    if (!this.manualYear || !this.manualMake || !this.manualModel) {
      this.decodeError.set('Year, Make, and Model are required.');
      return;
    }
    const mileage = parseInt(this.odometerInput.replace(/[^0-9]/g, ''), 10) || 0;
    this.decodeError.set('');
    this.vehicle.set({
      vin: '',
      year: this.manualYear,
      make: this.manualMake,
      model: this.manualModel,
      trim: this.manualTrim,
      body: '', engine: '', transmission: '', drivetrain: '', fuel: '',
      mileage,
    });
    this.loadMarketData('', this.manualYear, this.manualMake, this.manualModel, this.manualTrim, mileage);
  }

  loadMarketData(vin: string, year: string, make: string, model: string, trim: string, mileage: number) {
    this.loadingMarket.set(true);
    this.http.post<any>('/api/admin/vehicle/market-data', { vin, year, make, model, trim, mileage }).subscribe({
      next: (data) => {
        this.marketData.set(data);
        this.loadingMarket.set(false);
        if (data.available_colors?.length) this.availableColors.set(data.available_colors);
      },
      error: () => this.loadingMarket.set(false),
    });
  }

  loadNeovinData(vin: string) {
    this.loadingNeovin.set(true);
    this.http.get<any>(`/api/admin/vehicle/neovin/${vin}`).subscribe({
      next: (data) => {
        this.neovinData.set(data);
        this.loadingNeovin.set(false);
        this.applyNeovinData(data);
      },
      error: () => this.loadingNeovin.set(false),
    });
  }

  applyNeovinData(nv: any) {
    // Auto-fill colors from factory data
    if (nv.exterior_color?.name) this.exteriorColor.set(nv.exterior_color.name);
    if (nv.interior_color?.name) this.interiorColor.set(nv.interior_color.name);

    // MSRP + MPG
    if (nv.combined_msrp || nv.msrp) this.msrp.set(nv.combined_msrp || nv.msrp);
    if (nv.city_mpg) this.cityMpg.set(nv.city_mpg);
    if (nv.highway_mpg) this.hwyMpg.set(nv.highway_mpg);

    // Build full text from installed options + high-value features + drivetrain
    const texts: string[] = [
      nv.drivetrain || '',
      nv.powertrain_type || '',
      ...(nv.installed_options || []).map((o: any) => o.name || ''),
      ...Object.values(nv.high_value_features || {}).flat().map((f: any) => (f as any).description || ''),
    ];
    const allText = texts.join(' ').toLowerCase();

    const detectionMap: { label: string; value: number; keywords: string[] }[] = [
      { label: 'Sunroof/Moonroof',  value:  400, keywords: ['sunroof', 'moonroof', 'panoramic roof', 'glass roof', 'sky'] },
      { label: 'Navigation',        value:  300, keywords: ['navigation', 'nav system', 'gps', 'infotainment nav'] },
      { label: 'Leather Seats',     value:  350, keywords: ['leather', 'leatherette', 'perforated leather', 'nappa'] },
      { label: 'Heated Seats',      value:  200, keywords: ['heated seat', 'heated front seat', 'seat heat'] },
      { label: 'AWD / 4WD',         value:  500, keywords: ['awd', 'all-wheel drive', 'all wheel drive', '4wd', '4x4', 'four-wheel drive', '4motion', 'quattro', 'xdrive', 'e-four'] },
      { label: 'Third Row',         value:  600, keywords: ['third row', '3rd row', 'third-row', '7 passenger', '8 passenger'] },
      { label: 'Tow Package',       value:  400, keywords: ['tow', 'trailer hitch', 'towing package', 'trailer brake'] },
      { label: 'Premium Audio',     value:  250, keywords: ['bose', 'harman', 'meridian', 'jbl', 'bang & olufsen', 'mark levinson', 'burmester', 'premium audio', 'premium sound'] },
      { label: 'Backup Camera',     value:  150, keywords: ['backup camera', 'rear camera', 'rearview camera', 'rear-view camera'] },
      { label: 'Remote Start',      value:  200, keywords: ['remote start', 'remote engine start'] },
      { label: 'Power Liftgate',    value:  300, keywords: ['power liftgate', 'power lift gate', 'hands-free liftgate', 'power tailgate'] },
      { label: 'Blind Spot Monitor',value:  250, keywords: ['blind spot', 'blind-spot', 'lane change assist', 'bsm', 'side assist'] },
    ];

    const detected = detectionMap
      .filter(({ keywords }) => keywords.some(kw => allText.includes(kw)))
      .map(({ label, value }) => ({ label, value }));

    if (detected.length > 0) this.selectedOptions.set(detected);
  }

  toggleOption(label: string, value: number) {
    const current = this.selectedOptions();
    const idx = current.findIndex(o => o.label === label);
    if (idx >= 0) {
      this.selectedOptions.set(current.filter((_, i) => i !== idx));
    } else {
      this.selectedOptions.set([...current, { label, value }]);
    }
  }

  isOptionSelected(label: string): boolean {
    return this.selectedOptions().some(o => o.label === label);
  }

  toggleLock() {
    if (!this.profitLocked()) {
      this.lockedProfit.set(this.profit);
      this.profitLocked.set(true);
    } else {
      this.profitLocked.set(false);
      this.lockedProfit.set(null);
    }
  }

  onCostChange() {
    if (this.profitLocked() && this.lockedProfit() !== null) {
      this.askingPrice.set(this.totalCost + this.lockedProfit()!);
    }
  }

  copyVin() {
    navigator.clipboard.writeText(this.vehicle()?.vin || '');
  }

  reset() {
    this.vinInput = '';
    this.odometerInput = '';
    this.manualYear = '';
    this.manualMake = '';
    this.manualModel = '';
    this.manualTrim = '';
    this.entryMode.set('vin');
    this.vehicle.set(null);
    this.marketData.set(null);
    this.neovinData.set(null);
    this.vehicleHistory.set(null);
    this.msrp.set(0);
    this.cityMpg.set(0);
    this.hwyMpg.set(0);
    this.availableColors.set([]);
    this.showColorPicker.set(false);
    this.decodeError.set('');
    this.selectedOptions.set([]);
    this.appraisedValue.set(null);
    this.recon.set(null);
    this.transportation.set(null);
    this.auctionFee.set(null);
    this.otherCost.set(null);
    this.askingPrice.set(null);
    this.profitLocked.set(false);
    this.exteriorColor.set('');
    this.interiorColor.set('');
    this.keyCount.set(2);
    this.hasFrameDamage.set(false);
    this.hasBadVhr.set(false);
  }

  saveAppraisal() {
    const v = this.vehicle();
    if (!v) return;
    this.saving.set(true);
    this.http.post('/api/admin/appraisals', {
      vin: v.vin, vehicle: v,
      disposition: this.disposition(),
      appraised_value: this.appraisedValue(),
      recon: this.recon(),
      transportation: this.transportation(),
      auction_fee: this.auctionFee(),
      other_cost: this.otherCost(),
      asking_price: this.askingPrice(),
      mmr: this.mmr,
      market_avg: this.marketAvg,
      target_auction: this.targetAuction,
      target_retail: this.targetRetail,
    }).subscribe({
      next: () => { this.saving.set(false); this.saved.set(true); setTimeout(() => this.saved.set(false), 3000); this.loadAppraisalHistory(); },
      error: () => { this.saving.set(false); },
    });
  }

  fmt(val: number | null): string {
    if (val === null || val === undefined || val === 0) return '';
    return val.toLocaleString('en-US');
  }

  fmtAdj(val: number): string {
    if (val === 0) return '$0';
    return (val > 0 ? '+' : '') + '$' + Math.abs(val).toLocaleString('en-US');
  }

  parse(val: string): number | null {
    const n = Number(val.replace(/[^0-9.-]/g, ''));
    return isNaN(n) || n === 0 ? null : n;
  }

  timeAgo(val: string | number): string {
    if (!val) return '';
    // MarketCheck returns Unix timestamps in seconds
    const ms = typeof val === 'number' || /^\d+$/.test(String(val))
      ? Number(val) * 1000
      : new Date(val).getTime();
    const diff = Date.now() - ms;
    if (diff < 0) return '';
    const days = Math.floor(diff / 86400000);
    if (days < 1) return 'Today';
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}yr ago`;
  }
}

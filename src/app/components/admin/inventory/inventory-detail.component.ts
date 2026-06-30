import { Component, computed, inject, OnInit, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { LucideAngularModule } from 'lucide-angular';

interface CostAdd {
  id?: string;
  description: string;
  category: string;
  cost: number;
  payment_method: string;
  vendor: string;
  date_added: string;
  memo: string;
}

interface FloorPlan {
  id?: string;
  lender: string;
  amount_floored: number;
  date_floored: string;
  interest_rate: number;
  plan_length: number;
  maturity_date: string;
  admin_fee: number;
  floor_fee: number;
  highline_fee: number;
  est_flooring: number;
  per_diem: number;
  status: string;
  payments: FloorPayment[];
}

interface FloorPayment {
  id?: string;
  date: string;
  amount: number;
  type: string; // 'curtailment' | 'payoff'
  notes: string;
}

interface VehiclePhoto {
  id?: string;
  url: string;
  sort_order: number;
  category?: string;
}

const PHOTO_CATEGORIES = ['Exterior', 'Interior', 'Mechanical', 'Damage', 'Miscellaneous'];

@Component({
  selector: 'admin-inventory-detail',
  templateUrl: './inventory-detail.component.html',
  styleUrl: './inventory-detail.component.scss',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, LucideAngularModule],
})
export class AdminInventoryDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);
  private tickInterval: any;

  vehicle = signal<any>(null);
  loading = signal(true);
  activeTab = signal('overview'); // overview | costs | flooring | photos | description

  // Editable price fields
  askingPrice = signal(0);
  advertisingPrice = signal(0);
  specialPrice = signal(0);
  msrp = signal(0);
  minDown = signal(0);

  // Vehicle detail fields
  stockNumber = signal('');
  vin = signal('');
  year = signal('');
  make = signal('');
  model = signal('');
  trim = signal('');
  body = signal('');
  engine = signal('');
  transmission = signal('');
  drivetrain = signal('');
  fuel = signal('');
  exteriorColor = signal('');
  interiorColor = signal('');
  mileage = signal(0);
  condition = signal('');
  status = signal('Intake');
  dateInStock = signal('');
  titleStatus = signal('Not Received');
  titleBrand = signal('');

  statusOptions = ['Intake', 'Inbound', 'In Recon', 'Ready', 'Active', 'Pending Sale', 'Sold'];
  conditionOptions = ['Excellent', 'Good', 'Fair', 'Needs Work'];
  titleStatusOptions = ['Not Received', 'In Transit', 'Received', 'At DMV', 'Clean'];
  titleBrandOptions = ['Clean', 'Salvage', 'Rebuilt', 'Flood', 'Lemon'];

  // Cost fields
  purchasePrice = signal(0);
  purchaseDate = signal('');

  // Cost adds
  costAdds = signal<CostAdd[]>([]);
  costAddCategories = ['Transportation', 'Repair', 'Detail', 'Inspection', 'Registration', 'Parts', 'Tow', 'Other'];
  paymentMethods = ['ACH', 'Check', 'Cash', 'Credit Card', 'Wire', 'Other'];

  // Receipt scanning
  scanningReceipt = signal(false);
  receiptDragOver = signal(false);

  // Floor plans
  floorPlans = signal<FloorPlan[]>([]);
  now = signal(Date.now()); // for live per-diem tracking

  // Photos
  photos = signal<VehiclePhoto[]>([]);
  uploadingPhoto = signal(false);
  photoDragOver = signal(false);
  photoCategories = PHOTO_CATEGORIES;
  photoCatPills = [
    { key: 'Exterior', short: 'EXT' },
    { key: 'Interior', short: 'INT' },
    { key: 'Mechanical', short: 'MECH' },
    { key: 'Damage', short: 'DMG' },
    { key: 'Miscellaneous', short: 'MSC' },
  ];
  photoCatFilter = signal('All');
  savingPhotoCats = signal(false);
  photoCatsSaved = signal(false);

  // Window sticker
  windowStickerUrl = signal<string | null>(null);
  uploadingSticker = signal(false);
  safeWindowStickerIframe = computed(() => {
    const url = this.windowStickerUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  // Carfax PDF
  carfaxPdfUrl = signal<string | null>(null);
  uploadingCarfax = signal(false);
  safeCarfaxIframe = computed(() => {
    const url = this.carfaxPdfUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  // Description
  description = signal('');
  generatingDesc = signal(false);
  carfaxOwners = signal('');
  carfaxAccidents = signal('');
  carfaxService = signal('');
  carfaxUse = signal('');

  warrantyEnabled = signal(false);
  warrantyToggling = signal(false);

  toggleWarranty(enabled: boolean) {
    const vin = this.vin();
    if (!vin) return;
    this.warrantyToggling.set(true);
    this.http.patch('/api/admin/vehicle/warranty-enabled', { vin, enabled }).subscribe({
      next: () => { this.warrantyEnabled.set(enabled); this.warrantyToggling.set(false); },
      error: () => this.warrantyToggling.set(false),
    });
  }
  descHighlights = signal('');

  // Market data
  mmrValue = signal(0);
  kbbValue = signal(0);
  marketAvg = signal(0);
  loadingMarket = signal(false);

  get pctToMarket(): number {
    const avg = this.marketAvg();
    if (!avg || !this.askingPrice()) return 0;
    return ((this.askingPrice() - avg) / avg) * 100;
  }

  // Pipeline stage
  currentStage = signal<any>(null);
  stageHistory = signal<any[]>([]);
  stageList = [
    'At Auction — Won, Awaiting Pickup', 'In Transport', 'Arrived — Needs Intake',
    'In Mechanical', 'In Body/Paint', 'In Detail', 'In Photos',
    'Listed', 'Jillian Driver', 'Offered/Negotiating', 'Sold — Pending Delivery', 'Sold — Delivered',
  ];
  stageNotes = signal('');
  movingStage = signal(false);
  backwardPrompt = signal('');

  get stageDays(): number {
    const s = this.currentStage();
    if (!s) return 0;
    return Math.floor((Date.now() - new Date(s.entered_at).getTime()) / 86400000);
  }

  isBeforeCurrent(stage: string): boolean {
    const cur = this.currentStage()?.stage;
    if (!cur) return false;
    return this.stageList.indexOf(stage) < this.stageList.indexOf(cur);
  }

  shortStage(stage: string): string {
    const map: Record<string, string> = {
      'At Auction — Won, Awaiting Pickup': 'Auction Won',
      'In Transport': 'Transport',
      'Arrived — Needs Intake': 'Intake',
      'In Mechanical': 'Mechanical',
      'In Body/Paint': 'Body/Paint',
      'In Detail': 'Detail',
      'In Photos': 'Photos',
      'Listed': 'Listed',
      'Jillian Driver': 'J. Driver',
      'Offered/Negotiating': 'Negotiating',
      'Sold — Pending Delivery': 'Sold (Pending)',
      'Sold — Delivered': 'Delivered',
    };
    return map[stage] || stage;
  }

  // Save state
  saving = signal(false);
  saved = signal(false);

  // Payment modal
  paymentModalOpen = signal(false);
  paymentFloorIndex = signal(0);
  paymentAmount = signal(0);
  paymentType = signal<'curtailment' | 'payoff'>('curtailment');
  paymentDate = signal(new Date().toISOString().split('T')[0]);
  paymentNotes = signal('');

  recentCostAdds(): CostAdd[] {
    return this.costAdds().slice(-3).reverse();
  }

  get totalCostAdds(): number {
    return this.costAdds().reduce((s, c) => s + (c.cost || 0), 0);
  }

  get totalCost(): number {
    return this.purchasePrice() + this.totalCostAdds;
  }

  get daysInStock(): number {
    const v = this.vehicle();
    const d = v?.dateinstock || v?.date_in_stock;
    if (!d) return 0;
    return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  }

  // Live flooring cost — recalculates with `now` signal
  liveFlooringCost(fp: FloorPlan): number {
    if (fp.status === 'Paid Off') return fp.est_flooring || 0;
    const daysOnFloor = Math.floor((this.now() - new Date(fp.date_floored).getTime()) / 86400000);
    const dailyInterest = (fp.amount_floored * (fp.interest_rate || 8.25) / 100) / 365;
    const totalPaid = (fp.payments || []).reduce((s, p) => s + p.amount, 0);
    const principal = fp.amount_floored - totalPaid;
    const interest = dailyInterest * daysOnFloor;
    const fees = (fp.admin_fee || 0) + (fp.floor_fee || 0) + (fp.highline_fee || 0);
    return Math.round((interest + fees) * 100) / 100;
  }

  get totalLiveFlooring(): number {
    return this.floorPlans().reduce((s, fp) => s + this.liveFlooringCost(fp), 0);
  }

  get estTotal(): number {
    return this.totalCost + this.totalLiveFlooring;
  }

  get potentialProfit(): number {
    return this.askingPrice() - this.estTotal;
  }

  ngOnInit() {
    const vin = this.route.snapshot.paramMap.get('vin');
    if (!vin) return;

    // Tick every minute for live cost updates
    this.tickInterval = setInterval(() => this.now.set(Date.now()), 60000);

    // Fetch vehicle — try Supabase first, fall back to vAuto
    this.http.get<any>(`/api/admin/vehicles/${vin}`).subscribe({
      next: (v) => {
        if (v) {
          this.vehicle.set(v);
          this.populateFields(v, 'supabase');
          this.loading.set(false);
        } else {
          this.fetchFromVauto(vin);
        }
      },
      error: () => this.fetchFromVauto(vin),
    });

    // Fetch pipeline stage
    this.loadStages(vin);

    // Fetch internal data
    this.http.get<any>(`/api/admin/vehicle/${vin}`).subscribe({
      next: (data) => {
        if (data.costAdds?.length) this.costAdds.set(data.costAdds);
        if (data.floorPlans?.length) this.floorPlans.set(data.floorPlans.map((fp: any) => ({ ...fp, payments: fp.payments || [] })));
        if (data.photos?.length) this.photos.set(data.photos);
        if (data.windowSticker) this.windowStickerUrl.set(data.windowSticker);
        if (data.carfaxPdf) this.carfaxPdfUrl.set(data.carfaxPdf);
        this.warrantyEnabled.set(data.warrantyEnabled ?? false);
        if (data.pricing) {
          this.askingPrice.set(data.pricing.asking_price ?? this.askingPrice());
          this.advertisingPrice.set(data.pricing.advertising_price ?? this.advertisingPrice());
          this.specialPrice.set(data.pricing.special_price ?? this.specialPrice());
          this.purchasePrice.set(data.pricing.purchase_price ?? this.purchasePrice());
          this.minDown.set(data.pricing.min_down ?? 0);
        }
        if (data.marketData) {
          this.mmrValue.set(data.marketData.mmr || 0);
          this.kbbValue.set(data.marketData.kbb || 0);
          this.marketAvg.set(data.marketData.market_avg || 0);
        }
      },
      error: () => {},
    });

    // Fetch saved photo categories
    this.http.get<any>(`/api/admin/vehicle/photos/categories/${vin}`).subscribe({
      next: (data) => {
        if (data.photos?.length) {
          this.photos.set(data.photos.map((p: any) => ({
            url: p.url,
            sort_order: p.sort_order,
            category: p.category,
          })));
        } else {
          // No saved categories — load from vAuto feed if no photos yet
          this.loadFeedPhotosIfEmpty(vin);
        }
      },
      error: () => this.loadFeedPhotosIfEmpty(vin),
    });
  }

  private loadFeedPhotosIfEmpty(vin: string) {
    // Wait a tick for other requests to settle, then check
    setTimeout(() => {
      if (this.photos().length) return;
      this.http.get<any>('/api/admin/vauto/inventory').subscribe({
        next: (data) => {
          const v = (data?.results || []).find((veh: any) => veh.vin.toLowerCase() === vin.toLowerCase());
          if (v?.photos?.length) {
            this.photos.set(
              v.photos
                .filter((url: any) => typeof url === 'string')
                .map((url: string, i: number) => ({ url, sort_order: i, category: 'Exterior' }))
            );
          }
        },
      });
    }, 500);
  }

  ngOnDestroy() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  loadStages(vin: string) {
    this.http.get<{ current: any; history: any[] }>(`/api/admin/vehicle/${vin}/stages`).subscribe({
      next: (data) => {
        this.currentStage.set(data.current);
        this.stageHistory.set(data.history);
      },
    });
  }

  quickMoveStage(stage: string) {
    if (this.movingStage()) return;
    // Check if backward move
    if (this.isBeforeCurrent(stage)) {
      this.backwardPrompt.set(stage);
      this.stageNotes.set('');
      return;
    }
    this.doMoveStage(stage, null);
  }

  confirmBackwardMove() {
    const stage = this.backwardPrompt();
    if (!stage || !this.stageNotes()) return;
    this.doMoveStage(stage, this.stageNotes());
    this.backwardPrompt.set('');
  }

  cancelBackwardMove() {
    this.backwardPrompt.set('');
    this.stageNotes.set('');
  }

  private doMoveStage(stage: string, notes: string | null) {
    const vin = this.vin();
    if (!vin) return;
    this.movingStage.set(true);
    this.http.post<any>(`/api/admin/vehicle/${vin}/stage`, { stage, notes }).subscribe({
      next: () => {
        this.stageNotes.set('');
        this.movingStage.set(false);
        this.loadStages(vin);
      },
      error: () => { this.movingStage.set(false); alert('Failed to update stage.'); },
    });
  }

  stageDuration(s: any): number {
    const entered = new Date(s.entered_at).getTime();
    const exited = s.exited_at ? new Date(s.exited_at).getTime() : Date.now();
    return Math.floor((exited - entered) / 86400000);
  }

  stageTimeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  private fetchFromVauto(vin: string) {
    this.http.get<any>('/api/admin/vauto/inventory').subscribe({
      next: (data) => {
        const v = (data?.results || []).find((veh: any) => veh.vin.toLowerCase() === vin.toLowerCase());
        if (v) {
          this.vehicle.set(v);
          this.populateFields(v, 'vauto');
          // Auto-load vAuto photos if no saved categories exist yet
          if (!this.photos().length && v.photos?.length) {
            const feedPhotos: VehiclePhoto[] = v.photos
              .filter((url: any) => typeof url === 'string')
              .map((url: string, i: number) => ({
                url,
                sort_order: i,
                category: 'Exterior',
              }));
            this.photos.set(feedPhotos);
          }
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private populateFields(v: any, source: 'supabase' | 'vauto') {
    if (source === 'supabase') {
      this.stockNumber.set(v.stock_number || '');
      this.vin.set(v.vin || '');
      this.year.set(v.year || '');
      this.make.set(v.make || '');
      this.model.set(v.model || '');
      this.trim.set(v.trim || '');
      this.body.set(v.body || '');
      this.engine.set(v.engine || '');
      this.transmission.set(v.transmission || '');
      this.drivetrain.set(v.drivetrain || '');
      this.fuel.set(v.fuel || '');
      this.exteriorColor.set(v.exterior_color || '');
      this.interiorColor.set(v.interior_color || '');
      this.mileage.set(v.mileage || 0);
      this.condition.set(v.condition || '');
      this.status.set(v.status || 'Intake');
      this.dateInStock.set(v.date_in_stock || '');
      this.askingPrice.set(v.asking_price || 0);
      this.msrp.set(v.msrp || 0);
      this.purchasePrice.set(v.purchase_price || 0);
      this.purchaseDate.set(v.purchase_date || '');
      this.description.set(v.description || '');
    } else {
      this.stockNumber.set(v.stocknumber || '');
      this.vin.set(v.vin || '');
      this.year.set(v.year || '');
      this.make.set(v.make || '');
      this.model.set(v.model || '');
      this.trim.set(v.trim || '');
      this.body.set(v.body || '');
      this.engine.set(v.engine || '');
      this.transmission.set(v.transmissionstandard || '');
      this.drivetrain.set(v.drivetrainstandard || '');
      this.fuel.set(v.fuel || '');
      this.exteriorColor.set(v.exteriorcolorstandard || '');
      this.interiorColor.set(v.interiorcolorstandard || '');
      this.mileage.set(v.mileage || 0);
      this.condition.set(v.condition || '');
      this.status.set('Active');
      this.dateInStock.set(v.dateinstock || '');
      this.askingPrice.set(v.price || 0);
      this.msrp.set(v.msrp || 0);
      this.purchasePrice.set(v.originalprice || v.price || 0);
      this.purchaseDate.set(v.dateinstock || '');
      this.description.set(v.description || v.vehicledescription || v.notes || '');
    }
  }

  // ── Cost Adds ──
  addCostAdd() {
    this.costAdds.update(list => [...list, {
      description: '', category: '', cost: 0,
      payment_method: '', vendor: '',
      date_added: new Date().toISOString().split('T')[0], memo: '',
    }]);
  }

  removeCostAdd(index: number) {
    this.costAdds.update(list => list.filter((_, i) => i !== index));
  }

  // ── Receipt Scanning ──
  onReceiptDragOver(e: DragEvent) { e.preventDefault(); this.receiptDragOver.set(true); }
  onReceiptDragLeave() { this.receiptDragOver.set(false); }

  onReceiptDrop(e: DragEvent) {
    e.preventDefault();
    this.receiptDragOver.set(false);
    const file = e.dataTransfer?.files[0];
    if (file) this.scanReceipt(file);
  }

  onReceiptSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.scanReceipt(file);
  }

  scanReceipt(file: File) {
    this.scanningReceipt.set(true);
    const formData = new FormData();
    formData.append('file', file);

    this.http.post<any>('/api/admin/scan/receipt', formData).subscribe({
      next: (res) => {
        const d = res.extracted;
        if (d) {
          this.costAdds.update(list => [...list, {
            description: d.description || '',
            category: d.category || 'Other',
            cost: d.amount || 0,
            payment_method: d.payment_method || '',
            vendor: d.vendor_name || '',
            date_added: d.date || new Date().toISOString().split('T')[0],
            memo: d.notes || '',
          }]);
        }
        this.scanningReceipt.set(false);
      },
      error: () => { this.scanningReceipt.set(false); alert('Failed to scan receipt.'); },
    });
  }

  // ── Floor Plans ──
  addFloorPlan() {
    this.addFloorPlanFor('NextGear');
  }

  addFloorPlanFor(lender: 'NextGear' | 'AFC') {
    const amt = this.purchasePrice();
    const dateFloored = this.purchaseDate() || new Date().toISOString().split('T')[0];
    const maturity = new Date(dateFloored);
    maturity.setDate(maturity.getDate() + 120);

    // Lender-specific fees
    let adminFee = 18;
    let docFee = 25;
    let rate = 8.25;
    let highlineFee = 0;

    if (lender === 'NextGear') {
      // NextGear: Admin $18, Doc $25, Highline 0.5% on vehicles over $50k
      adminFee = 18;
      docFee = 25;
      rate = 8.25; // Prime + 1.5%
      highlineFee = amt >= 50000 ? Math.round(amt * 0.005 * 100) / 100 : 0;
    } else {
      // AFC: Admin $18, Doc $25, Highline is manual (not a clean %)
      adminFee = 18;
      docFee = 25;
      rate = 8.25;
      highlineFee = 0; // AFC highline must be entered manually
    }

    this.floorPlans.update(list => [...list, {
      lender, amount_floored: amt,
      date_floored: dateFloored,
      interest_rate: rate, plan_length: 120,
      maturity_date: maturity.toISOString().split('T')[0],
      admin_fee: adminFee, floor_fee: docFee,
      highline_fee: highlineFee,
      est_flooring: 0, per_diem: 0,
      status: 'Active', payments: [],
    }]);
  }

  recalcFloorFees(fp: FloorPlan) {
    if (fp.lender === 'NextGear') {
      fp.highline_fee = fp.amount_floored >= 50000 ? Math.round(fp.amount_floored * 0.005 * 100) / 100 : 0;
    }
    this.touchFloorPlans();
  }

  floorPerDiem(fp: FloorPlan): number {
    return (fp.amount_floored * (fp.interest_rate || 8.25) / 100) / 365;
  }

  floorInterestAccrued(fp: FloorPlan): number {
    return this.floorPerDiem(fp) * this.daysOnFloor(fp);
  }

  floorPayoffTotal(fp: FloorPlan): number {
    const principal = fp.amount_floored;
    const interest = this.floorInterestAccrued(fp);
    const fees = (fp.admin_fee || 0) + (fp.floor_fee || 0) + (fp.highline_fee || 0);
    const paid = (fp.payments || []).reduce((s, p) => s + p.amount, 0);
    return Math.round((principal + interest + fees - paid) * 100) / 100;
  }

  payoffFloorPlan(index: number) {
    this.floorPlans.update(list => list.map((fp, i) => {
      if (i !== index) return fp;
      const totalCost = this.liveFlooringCost(fp);
      const updated = { ...fp, status: 'Paid Off', est_flooring: totalCost };
      // Lock flooring cost as a cost add
      this.costAdds.update(adds => [...adds, {
        description: `${fp.lender} Floor Plan Payoff`,
        category: 'Flooring',
        cost: totalCost,
        payment_method: '',
        vendor: fp.lender,
        date_added: new Date().toISOString().split('T')[0],
        memo: `${this.daysOnFloor(fp)} days on floor`,
      }]);
      return updated;
    }));
  }

  removeFloorPlan(index: number) {
    this.floorPlans.update(list => list.filter((_, i) => i !== index));
  }

  daysOnFloor(fp: FloorPlan): number {
    return Math.floor((this.now() - new Date(fp.date_floored).getTime()) / 86400000);
  }

  principalBalance(fp: FloorPlan): number {
    const totalPaid = (fp.payments || []).reduce((s, p) => s + p.amount, 0);
    return fp.amount_floored - totalPaid;
  }

  openPaymentModal(index: number) {
    this.paymentFloorIndex.set(index);
    this.paymentAmount.set(0);
    this.paymentType.set('curtailment');
    this.paymentDate.set(new Date().toISOString().split('T')[0]);
    this.paymentNotes.set('');
    this.paymentModalOpen.set(true);
  }

  recordPayment() {
    const idx = this.paymentFloorIndex();
    const payment: FloorPayment = {
      date: this.paymentDate(),
      amount: this.paymentAmount(),
      type: this.paymentType(),
      notes: this.paymentNotes(),
    };
    this.floorPlans.update(list => list.map((fp, i) => {
      if (i !== idx) return fp;
      const updated = { ...fp, payments: [...(fp.payments || []), payment] };
      if (this.paymentType() === 'payoff') {
        updated.status = 'Paid Off';
        // Lock in flooring cost as a cost add
        this.costAdds.update(adds => [...adds, {
          description: `${fp.lender} Floor Plan Payoff`,
          category: 'Flooring',
          cost: this.liveFlooringCost(fp),
          payment_method: '',
          vendor: fp.lender,
          date_added: this.paymentDate(),
          memo: `Flooring cost locked at payoff — ${this.daysOnFloor(fp)} days on floor`,
        }]);
      }
      return updated;
    }));
    this.paymentModalOpen.set(false);
  }

  // ── Photos ──
  onPhotoDragOver(e: DragEvent) { e.preventDefault(); this.photoDragOver.set(true); }
  onPhotoDragLeave() { this.photoDragOver.set(false); }

  onPhotoDrop(e: DragEvent) {
    e.preventDefault();
    this.photoDragOver.set(false);
    const files = e.dataTransfer?.files;
    if (files) this.uploadPhotos(files);
  }

  onPhotoSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) this.uploadPhotos(input.files);
  }

  uploadPhotos(files: FileList) {
    this.uploadingPhoto.set(true);
    const vin = this.vehicle()?.vin;
    let completed = 0;

    Array.from(files).forEach((file, i) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('vin', vin);
      formData.append('sort_order', String(this.photos().length + i));

      this.http.post<any>('/api/admin/vehicle/photo', formData).subscribe({
        next: (res) => {
          if (res.url) {
            this.photos.update(list => [...list, { url: res.url, sort_order: this.photos().length }]);
          }
          completed++;
          if (completed === files.length) this.uploadingPhoto.set(false);
        },
        error: () => {
          completed++;
          if (completed === files.length) this.uploadingPhoto.set(false);
        },
      });
    });
  }

  removePhoto(index: number) {
    this.photos.update(list => list.filter((_, i) => i !== index));
  }

  // ── Window Sticker ──
  onStickerSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) this.uploadSticker(input.files[0]);
  }

  uploadSticker(file: File) {
    this.uploadingSticker.set(true);
    const vin = this.vehicle()?.vin;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('vin', vin);

    this.http.post<any>('/api/admin/vehicle/window-sticker', formData).subscribe({
      next: (res) => {
        if (res.url) this.windowStickerUrl.set(res.url);
        this.uploadingSticker.set(false);
      },
      error: () => this.uploadingSticker.set(false),
    });
  }

  removeSticker() {
    const vin = this.vehicle()?.vin;
    this.http.delete(`/api/admin/vehicle/window-sticker/${vin}`).subscribe({
      next: () => this.windowStickerUrl.set(null),
    });
  }

  // ── Carfax PDF ──
  onCarfaxSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) this.uploadCarfax(input.files[0]);
  }

  uploadCarfax(file: File) {
    this.uploadingCarfax.set(true);
    const vin = this.vehicle()?.vin;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('vin', vin);

    this.http.post<any>('/api/admin/vehicle/carfax', formData).subscribe({
      next: (res) => {
        if (res.url) this.carfaxPdfUrl.set(res.url);
        this.uploadingCarfax.set(false);
      },
      error: () => this.uploadingCarfax.set(false),
    });
  }

  removeCarfax() {
    const vin = this.vehicle()?.vin;
    this.http.delete(`/api/admin/vehicle/carfax/${vin}`).subscribe({
      next: () => this.carfaxPdfUrl.set(null),
    });
  }

  // ── Import vAuto photos ──
  private feedImported = false;
  importVautoPhotos() {
    if (this.feedImported) { alert('Photos already imported from feed.'); return; }
    const v = this.vehicle();
    if (!v) return;
    const rawPhotos: string[] = v.photos || [];
    if (!rawPhotos.length) return;

    const existing = new Set(this.photos().map(p => p.url));
    const newPhotos: VehiclePhoto[] = rawPhotos
      .filter((url: string) => typeof url === 'string' && !existing.has(url))
      .map((url: string, i: number) => ({
        url,
        sort_order: this.photos().length + i,
        category: 'Exterior',
      }));

    if (newPhotos.length === 0) {
      alert('All photos are already imported.');
      this.feedImported = true;
      return;
    }

    this.photos.update(list => [...list, ...newPhotos]);
    this.feedImported = true;
  }

  setPhotoCategory(index: number, category: string) {
    this.photos.update(list =>
      list.map((p, i) => i === index ? { ...p, category } : p)
    );
  }

  filteredPhotos(): { photo: VehiclePhoto; index: number }[] {
    const cat = this.photoCatFilter();
    return this.photos()
      .map((photo, index) => ({ photo, index }))
      .filter(p => cat === 'All' || (p.photo.category || 'Exterior') === cat);
  }

  photoCategoryCounts(): { key: string; count: number }[] {
    const all = this.photos();
    const counts: Record<string, number> = {};
    all.forEach(p => {
      const c = p.category || 'Exterior';
      counts[c] = (counts[c] || 0) + 1;
    });
    return [
      { key: 'All', count: all.length },
      ...PHOTO_CATEGORIES.map(c => ({ key: c, count: counts[c] || 0 })).filter(c => c.count > 0),
    ];
  }

  savePhotoCategories() {
    this.savingPhotoCats.set(true);
    this.photoCatsSaved.set(false);
    const vin = this.vin();
    const photos = this.photos().map((p, i) => ({
      url: p.url,
      sort_order: i,
      category: p.category || 'Exterior',
    }));
    this.http.post('/api/admin/vehicle/photos/categories', { vin, photos }).subscribe({
      next: () => {
        this.savingPhotoCats.set(false);
        this.photoCatsSaved.set(true);
        setTimeout(() => this.photoCatsSaved.set(false), 3000);
      },
      error: () => {
        this.savingPhotoCats.set(false);
        alert('Failed to save photo categories.');
      },
    });
  }

  // ── Market Data ──
  fetchMarketData() {
    const v = this.vehicle();
    if (!v) return;
    this.loadingMarket.set(true);
    this.http.post<any>('/api/admin/vehicle/market-data', {
      vin: v.vin,
      year: this.year(),
      make: this.make(),
      model: this.model(),
      trim: this.trim(),
      mileage: this.mileage(),
    }).subscribe({
      next: (data) => {
        this.mmrValue.set(data.mmr || 0);
        this.kbbValue.set(data.kbb || 0);
        this.marketAvg.set(data.market_avg || 0);
        this.loadingMarket.set(false);
      },
      error: () => { this.loadingMarket.set(false); },
    });
  }

  // ── AI Description ──
  generateDescription() {
    this.generatingDesc.set(true);
    this.http.post<any>('/api/admin/generate-description', {
      year: this.year(), make: this.make(), model: this.model(), trim: this.trim(),
      mileage: this.mileage(), exterior_color: this.exteriorColor(),
      interior_color: this.interiorColor(), drivetrain: this.drivetrain(),
      engine: this.engine(), transmission: this.transmission(),
      fuel: this.fuel(), body: this.body(),
      owners: this.carfaxOwners(), accidents: this.carfaxAccidents(),
      service_history: this.carfaxService(), use_type: this.carfaxUse(),
      highlights: this.descHighlights(), asking_price: this.askingPrice(),
      title_status: this.titleStatus(), condition: this.condition(),
    }).subscribe({
      next: (res) => { this.description.set(res.description || ''); this.generatingDesc.set(false); },
      error: () => { this.generatingDesc.set(false); alert('Failed to generate description.'); },
    });
  }

  // Force floor plan signal to re-emit so computed properties recalculate
  touchFloorPlans() {
    this.floorPlans.set([...this.floorPlans()]);
  }

  // ── Price formatting ──
  formatPrice(val: number): string {
    if (!val) return '0';
    return val.toLocaleString('en-US');
  }

  parsePrice(val: string): number {
    return Number(val.replace(/[^0-9.]/g, '')) || 0;
  }

  // ── Save ──
  save() {
    this.saving.set(true);
    this.saved.set(false);
    const vin = this.vehicle()?.vin;
    const payload = {
      vin,
      pricing: {
        asking_price: this.askingPrice(),
        advertising_price: this.advertisingPrice(),
        special_price: this.specialPrice(),
        purchase_price: this.purchasePrice(),
        min_down: this.minDown(),
      },
      costAdds: this.costAdds(),
      floorPlans: this.floorPlans(),
      description: this.description(),
      photos: this.photos(),
    };
    this.http.post('/api/admin/vehicle/save', payload).subscribe({
      next: () => { this.saving.set(false); this.saved.set(true); setTimeout(() => this.saved.set(false), 3000); },
      error: () => { this.saving.set(false); alert('Failed to save.'); },
    });
  }
}

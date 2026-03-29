import { Component, inject, OnInit, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
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
  photoCatFilter = signal('All');
  savingPhotoCats = signal(false);
  photoCatsSaved = signal(false);

  // Description
  description = signal('');
  generatingDesc = signal(false);

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

    // Fetch internal data
    this.http.get<any>(`/api/admin/vehicle/${vin}`).subscribe({
      next: (data) => {
        if (data.costAdds?.length) this.costAdds.set(data.costAdds);
        if (data.floorPlans?.length) this.floorPlans.set(data.floorPlans.map((fp: any) => ({ ...fp, payments: fp.payments || [] })));
        if (data.photos?.length) this.photos.set(data.photos);
        if (data.pricing) {
          this.askingPrice.set(data.pricing.asking_price ?? this.askingPrice());
          this.advertisingPrice.set(data.pricing.advertising_price ?? this.advertisingPrice());
          this.specialPrice.set(data.pricing.special_price ?? this.specialPrice());
          this.purchasePrice.set(data.pricing.purchase_price ?? this.purchasePrice());
          this.minDown.set(data.pricing.min_down ?? 0);
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
        }
      },
      error: () => {},
    });
  }

  ngOnDestroy() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  private fetchFromVauto(vin: string) {
    this.http.get<any>('/api/admin/vauto/inventory').subscribe({
      next: (data) => {
        const v = (data?.results || []).find((veh: any) => veh.vin.toLowerCase() === vin.toLowerCase());
        if (v) {
          this.vehicle.set(v);
          this.populateFields(v, 'vauto');
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
    const dateFloored = new Date().toISOString().split('T')[0];
    const maturity = new Date();
    maturity.setDate(maturity.getDate() + 120);
    this.floorPlans.update(list => [...list, {
      lender: 'NextGear', amount_floored: this.purchasePrice(),
      date_floored: dateFloored,
      interest_rate: 8.25, plan_length: 120,
      maturity_date: maturity.toISOString().split('T')[0],
      admin_fee: 18, floor_fee: 0,
      highline_fee: this.purchasePrice() >= 50000 ? Math.round(this.purchasePrice() * 0.005 * 100) / 100 : 0,
      est_flooring: 0, per_diem: 0,
      status: 'Active', payments: [],
    }]);
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

  // ── Import vAuto photos ──
  importVautoPhotos() {
    const v = this.vehicle();
    if (!v) return;
    // vAuto vehicles have photos as string[] on the raw vehicle object
    const rawPhotos: string[] = v.photos || [];
    if (!rawPhotos.length) return;

    const existing = new Set(this.photos().map(p => p.url));
    const newPhotos: VehiclePhoto[] = rawPhotos
      .filter((url: string) => typeof url === 'string' && !existing.has(url))
      .map((url: string, i: number) => ({
        url,
        sort_order: this.photos().length + i,
        category: 'Exterior', // default, user can re-categorize
      }));

    if (newPhotos.length === 0) {
      alert('All photos are already imported.');
      return;
    }

    this.photos.update(list => [...list, ...newPhotos]);
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

  // ── AI Description ──
  generateDescription() {
    this.generatingDesc.set(true);
    const v = this.vehicle();
    this.http.post<any>('/api/admin/generate-description', {
      year: v?.year, make: v?.make, model: v?.model, trim: v?.trim,
      mileage: v?.mileage, exterior_color: v?.exteriorcolorstandard || v?.exterior_color,
      interior_color: v?.interiorcolorstandard || v?.interior_color,
      drivetrain: v?.drivetrainstandard || v?.drivetrain,
      engine: v?.engine, transmission: v?.transmissionstandard || v?.transmission,
      fuel: v?.fuel, features: '',
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

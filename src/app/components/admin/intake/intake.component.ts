import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'admin-intake',
  templateUrl: './intake.component.html',
  styleUrl: './intake.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink],
})
export class IntakeComponent {
  private http = inject(HttpClient);
  private router = inject(Router);

  // ── Steps ──
  step = signal(1); // 1=Upload, 2=Review, 3=Flooring, 4=Done

  // ── Upload state ──
  scanning = signal(false);
  scanError = signal('');
  fileName = signal('');
  dragOver = signal(false);

  // ── Vehicle data (populated by scan + VIN decode) ──
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
  purchasePrice = signal(0);
  purchaseDate = signal('');
  source = signal('');
  notes = signal('');

  // ── Seller data ──
  sellerName = signal('');
  sellerType = signal<'auction' | 'dealer' | 'private'>('private');
  sellerAddress = signal('');
  sellerCity = signal('');
  sellerState = signal('');
  sellerZip = signal('');
  auctionName = signal('');
  buyerFee = signal(0);

  // ── Flooring ──
  floorVehicle = signal(false);
  floorCompany = signal('NextGear');
  floorCompanies = ['NextGear', 'AFC'];
  includeBuyerFee = signal(true);

  // NextGear defaults
  primeRate = signal(6.75);
  rateAbovePrime = signal(1.5);
  floorInterestRate = signal(8.25); // prime + spread
  floorDayBasis = signal(365);
  floorPlanLength = signal(120);
  floorAdminFee = signal(18);
  floorFee = signal(0);
  includeHighlineFee = signal(false);
  highlineFeeRate = 0.005; // 0.5% for NextGear
  highlineThreshold = 50000; // NextGear threshold
  manualHighlineFee = signal(0); // For AFC — manual input

  // One-time fees (toggleable based on purchase type)
  includeDocProcessing = signal(true);
  docProcessingFee = 25;
  includeNonAuctionFee = signal(false);
  nonAuctionFee = 75;
  includeLienPayoff = signal(false);
  lienPayoffFee = 75;

  // Flooring company presets
  private companyDefaults: Record<string, any> = {
    NextGear: {
      primeRate: 6.75, rateAbovePrime: 1.5, interestRate: 8.25,
      dayBasis: 365, planLength: 120, adminFee: 18, floorFee: 0,
      curtailments: {
        standard: [
          { days: 60, feeFlat: 45, principalPct: 5 },
          { days: 90, feeFlat: 45, principalPct: 5 },
          { days: 120, feeFlat: 45, principalPct: 100 },
        ],
        highline: [
          { days: 60, feeFlat: 45, principalPct: 5 },
          { days: 90, feeFlat: 45, principalPct: 5 },
          { days: 120, feeFlat: 45, principalPct: 100 },
        ],
      },
    },
    AFC: {
      primeRate: 6.75, rateAbovePrime: 1.25, interestRate: 8.0,
      dayBasis: 365, planLength: 90, adminFee: 0, floorFee: 0,
      curtailments: {
        standard: [
          { days: 90, feeFlat: 0, principalPct: 100 },
        ],
        highline: [
          { days: 90, feeFlat: 0, principalPct: 100 },
        ],
      },
    },
  };

  get floorTotal(): number {
    return this.purchasePrice() + (this.includeBuyerFee() ? this.buyerFee() : 0);
  }

  get highlineFeeAmount(): number {
    if (!this.includeHighlineFee()) return 0;
    if (this.floorCompany() === 'AFC') return this.manualHighlineFee();
    return Math.round(this.floorTotal * this.highlineFeeRate * 100) / 100;
  }

  get maturityDate(): string {
    const start = this.purchaseDate() || new Date().toISOString().split('T')[0];
    const d = new Date(start);
    d.setDate(d.getDate() + this.floorPlanLength());
    return d.toISOString().split('T')[0];
  }

  get estDailyInterest(): number {
    return (this.floorTotal * (this.floorInterestRate() / 100)) / this.floorDayBasis();
  }

  get estTotalInterest(): number {
    return Math.round(this.estDailyInterest * this.floorPlanLength() * 100) / 100;
  }

  get activeCurtailments(): any[] {
    const defaults = this.companyDefaults[this.floorCompany()];
    if (!defaults?.curtailments) return [];
    const isHighline = this.floorTotal >= this.highlineThreshold;
    return isHighline ? defaults.curtailments.highline : defaults.curtailments.standard;
  }

  get totalCurtailmentFees(): number {
    return this.activeCurtailments.reduce((s: number, c: any) => s + (c.feeFlat || 0), 0);
  }

  get oneTimeFees(): number {
    let total = this.floorAdminFee();
    if (this.includeDocProcessing()) total += this.docProcessingFee;
    if (this.includeNonAuctionFee()) total += this.nonAuctionFee;
    if (this.includeLienPayoff()) total += this.lienPayoffFee;
    return total;
  }

  get estTotalFlooringCost(): number {
    return this.oneTimeFees + this.totalCurtailmentFees + this.highlineFeeAmount + this.estTotalInterest;
  }

  // Curtailment schedule from company presets
  get curtailmentTerms() {
    const amount = this.floorTotal;
    return this.activeCurtailments.map((c: any, i: number) => ({
      term: i + 1,
      days: c.days,
      fee: c.feeFlat,
      principalPct: c.principalPct,
      curtailment: Math.round(amount * (c.principalPct / 100) * 100) / 100,
    }));
  }

  onCompanyChange(company: string) {
    this.floorCompany.set(company);
    const defaults = this.companyDefaults[company];
    if (defaults) {
      this.primeRate.set(defaults.primeRate);
      this.rateAbovePrime.set(defaults.rateAbovePrime);
      this.floorInterestRate.set(defaults.interestRate);
      this.floorDayBasis.set(defaults.dayBasis);
      this.floorPlanLength.set(defaults.planLength);
      this.floorAdminFee.set(defaults.adminFee);
      this.floorFee.set(defaults.floorFee);
    }
    this.checkHighline();
  }

  checkHighline() {
    if (this.floorCompany() === 'NextGear') {
      this.includeHighlineFee.set(this.floorTotal >= this.highlineThreshold);
    } else {
      this.includeHighlineFee.set(false);
    }
  }

  // ── VIN decode state ──
  vinDecoding = signal(false);
  vinDecoded = signal(false);

  // ── Save state ──
  saving = signal(false);

  onDragOver(e: DragEvent) { e.preventDefault(); this.dragOver.set(true); }
  onDragLeave() { this.dragOver.set(false); }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragOver.set(false);
    const file = e.dataTransfer?.files[0];
    if (file) this.scanFile(file);
  }

  onFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.scanFile(file);
  }

  scanFile(file: File) {
    this.scanning.set(true);
    this.scanError.set('');
    this.fileName.set(file.name);

    const formData = new FormData();
    formData.append('file', file);

    this.http.post<any>('/api/admin/scan/bill-of-sale', formData).subscribe({
      next: (res) => {
        const d = res.extracted;
        if (!d) {
          this.scanError.set('Could not extract data from this document. Try a clearer image.');
          this.scanning.set(false);
          return;
        }

        // Populate fields from scan
        if (d.vin) this.vin.set(d.vin);
        if (d.purchase_price) this.purchasePrice.set(d.purchase_price);
        if (d.purchase_date) this.purchaseDate.set(d.purchase_date);
        if (d.odometer) this.mileage.set(d.odometer);
        if (d.seller_name) this.sellerName.set(d.seller_name);
        if (d.seller_address) this.sellerAddress.set(d.seller_address);
        if (d.seller_city) this.sellerCity.set(d.seller_city);
        if (d.seller_state) this.sellerState.set(d.seller_state);
        if (d.seller_zip) this.sellerZip.set(d.seller_zip);
        if (d.seller_type) this.sellerType.set(d.seller_type);
        if (d.auction_name) { this.auctionName.set(d.auction_name); this.source.set(d.auction_name); }
        if (d.buyer_fee) this.buyerFee.set(d.buyer_fee);
        if (d.notes) this.notes.set(d.notes);

        this.scanning.set(false);

        // Auto-decode VIN
        if (d.vin) this.decodeVin(d.vin);

        this.step.set(2);
      },
      error: () => {
        this.scanError.set('Failed to scan document. Please try again.');
        this.scanning.set(false);
      },
    });
  }

  decodeVin(vin?: string) {
    const v = (vin || this.vin()).trim().toUpperCase();
    if (v.length !== 17) return;
    this.vin.set(v);
    this.vinDecoding.set(true);

    this.http.get<any>(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${v}?format=json`).subscribe({
      next: (res) => {
        const r = res?.Results?.[0];
        if (r) {
          if (r.ModelYear) this.year.set(r.ModelYear);
          if (r.Make) this.make.set(r.Make);
          if (r.Model) this.model.set(r.Model);
          if (r.Trim) this.trim.set(r.Trim);
          if (r.BodyClass) this.body.set(r.BodyClass);
          if (r.EngineCylinders && r.DisplacementL) this.engine.set(`${r.EngineCylinders}-Cyl ${r.DisplacementL}L`);
          if (r.TransmissionStyle) this.transmission.set(r.TransmissionStyle);
          if (r.DriveType) this.drivetrain.set(r.DriveType);
          if (r.FuelTypePrimary) this.fuel.set(r.FuelTypePrimary);
        }
        this.vinDecoded.set(true);
        this.vinDecoding.set(false);
      },
      error: () => this.vinDecoding.set(false),
    });
  }

  skipToManual() {
    this.step.set(2);
  }

  goToFlooring() {
    this.checkHighline();
    this.step.set(3);
  }

  backToReview() {
    this.step.set(2);
  }

  save() {
    this.saving.set(true);
    const payload = {
      vehicle: {
        vin: this.vin(),
        year: this.year(),
        make: this.make(),
        model: this.model(),
        trim: this.trim(),
        body: this.body(),
        engine: this.engine(),
        transmission: this.transmission(),
        drivetrain: this.drivetrain(),
        fuel: this.fuel(),
        exterior_color: this.exteriorColor(),
        interior_color: this.interiorColor(),
        mileage: this.mileage(),
        purchase_price: this.purchasePrice(),
        asking_price: this.purchasePrice(), // default to purchase price
        purchase_date: this.purchaseDate(),
        date_in_stock: this.purchaseDate() || new Date().toISOString().split('T')[0],
        source: this.source(),
        notes: this.notes(),
        status: 'Intake',
      },
      seller: {
        name: this.sellerName(),
        type: this.sellerType(),
        address: this.sellerAddress(),
        city: this.sellerCity(),
        state: this.sellerState(),
        zip: this.sellerZip(),
      },
      flooring: this.floorVehicle() ? {
        lender: this.floorCompany(),
        amount_floored: this.floorTotal,
        date_floored: this.purchaseDate() || new Date().toISOString().split('T')[0],
        interest_rate: this.floorInterestRate(),
        plan_length: this.floorPlanLength(),
        maturity_date: this.maturityDate,
        admin_fee: this.floorAdminFee(),
        floor_fee: this.floorFee(),
        highline_fee: this.highlineFeeAmount,
        est_flooring: this.estTotalFlooringCost,
        per_diem: Math.round(this.estDailyInterest * 100) / 100,
        status: 'Active',
      } : null,
    };

    this.http.post<any>('/api/admin/vehicle/intake', payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.step.set(4);
      },
      error: () => {
        this.saving.set(false);
        alert('Failed to save vehicle. Please try again.');
      },
    });
  }

  addAnother() {
    // Reset everything
    this.step.set(1);
    this.vin.set(''); this.year.set(''); this.make.set(''); this.model.set('');
    this.trim.set(''); this.purchasePrice.set(0); this.purchaseDate.set('');
    this.mileage.set(0); this.sellerName.set(''); this.fileName.set('');
    this.vinDecoded.set(false); this.floorVehicle.set(false);
  }
}

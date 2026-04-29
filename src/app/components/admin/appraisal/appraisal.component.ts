import { Component, inject, signal } from '@angular/core';
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
export class AdminAppraisalComponent {
  private http = inject(HttpClient);

  // VIN entry
  vinInput = '';
  odometerInput = '';
  decoding = signal(false);
  decodeError = signal('');

  // Vehicle info (auto-filled + editable)
  vehicle = signal<any>(null);

  // Disposition
  disposition = signal<'retail' | 'wholesale'>('retail');

  // Cost inputs
  appraisedValue = signal<number | null>(null);
  recon = signal<number | null>(null);
  certification = signal<number | null>(null);
  transportation = signal<number | null>(null);
  auctionFee = signal<number | null>(null);
  pack = signal<number | null>(null);
  otherCost = signal<number | null>(null);

  // Asking price + lock
  askingPrice = signal<number | null>(null);
  profitLocked = signal(false);
  lockedProfit = signal<number | null>(null);

  // Market data (from APIs — placeholders until keys wired)
  mmr = signal<number | null>(null);
  marketAvg = signal<number | null>(null);
  marketDaysSupply = signal<number | null>(null);
  likeMine = signal<number | null>(null);
  priceRank = signal<{ rank: number; total: number } | null>(null);
  loadingMarket = signal(false);

  // Bumper / history
  vehicleHistory = signal<any>(null);
  loadingHistory = signal(false);

  get totalCost(): number {
    return (this.appraisedValue() || 0)
      + (this.recon() || 0)
      + (this.certification() || 0)
      + (this.transportation() || 0)
      + (this.auctionFee() || 0)
      + (this.pack() || 0)
      + (this.otherCost() || 0);
  }

  get profit(): number {
    return (this.askingPrice() || 0) - this.totalCost;
  }

  get adjPctOfMarket(): number | null {
    if (!this.marketAvg() || !this.askingPrice()) return null;
    return Math.round((this.askingPrice()! / this.marketAvg()!) * 100);
  }

  get adjCostToMarket(): number | null {
    if (!this.marketAvg() || !this.totalCost) return null;
    return Math.round((this.totalCost / this.marketAvg()!) * 100);
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
        this.vehicle.set({
          vin,
          year: r.ModelYear || '',
          make: r.Make || '',
          model: r.Model || '',
          trim: r.Trim || r.Series || '',
          body: r.BodyClass || '',
          engine: r.DisplacementL ? `${parseFloat(r.DisplacementL).toFixed(1)}L ${r.FuelTypePrimary || ''}`.trim() : (r.EngineCylinders ? `${r.EngineCylinders}-cyl` : ''),
          transmission: r.TransmissionStyle || '',
          drivetrain: r.DriveType || '',
          fuel: r.FuelTypePrimary || '',
          mileage: parseInt(this.odometerInput.replace(/[^0-9]/g, ''), 10) || 0,
          color: '',
        });
        this.decoding.set(false);
        this.loadMarketData(vin);
        this.loadHistory(vin);
      },
      error: () => { this.decodeError.set('Failed to decode VIN.'); this.decoding.set(false); },
    });
  }

  loadMarketData(vin: string) {
    this.loadingMarket.set(true);
    const v = this.vehicle();
    this.http.post<any>('/api/admin/vehicle/market-data', {
      vin,
      year: v?.year,
      make: v?.make,
      model: v?.model,
      trim: v?.trim,
      mileage: v?.mileage,
    }).subscribe({
      next: (data) => {
        if (data?.mmr) this.mmr.set(data.mmr);
        if (data?.market_avg) this.marketAvg.set(data.market_avg);
        if (data?.market_days_supply) this.marketDaysSupply.set(data.market_days_supply);
        if (data?.price_rank) this.priceRank.set(data.price_rank);
        this.loadingMarket.set(false);
      },
      error: () => this.loadingMarket.set(false),
    });
  }

  loadHistory(vin: string) {
    this.loadingHistory.set(true);
    this.http.get<any>(`/api/admin/vehicle/history/${vin}`).subscribe({
      next: (data) => { this.vehicleHistory.set(data); this.loadingHistory.set(false); },
      error: () => this.loadingHistory.set(false),
    });
  }

  onAskingPriceChange(val: string) {
    const n = this.parse(val);
    this.askingPrice.set(n);
    if (this.profitLocked()) {
      // Lock is on asking price side — don't recalc
    }
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
    // If profit is locked, back-calculate asking price
    if (this.profitLocked() && this.lockedProfit() !== null) {
      this.askingPrice.set(this.totalCost + this.lockedProfit()!);
    }
  }

  saveAppraisal() {
    const v = this.vehicle();
    if (!v) return;
    this.http.post('/api/admin/appraisals', {
      vin: v.vin,
      vehicle: v,
      disposition: this.disposition(),
      appraised_value: this.appraisedValue(),
      recon: this.recon(),
      certification: this.certification(),
      transportation: this.transportation(),
      auction_fee: this.auctionFee(),
      pack: this.pack(),
      other_cost: this.otherCost(),
      asking_price: this.askingPrice(),
      mmr: this.mmr(),
      market_avg: this.marketAvg(),
    }).subscribe({ next: () => {}, error: () => {} });
  }

  reset() {
    this.vinInput = '';
    this.odometerInput = '';
    this.vehicle.set(null);
    this.decodeError.set('');
    this.appraisedValue.set(null);
    this.recon.set(null);
    this.certification.set(null);
    this.transportation.set(null);
    this.auctionFee.set(null);
    this.pack.set(null);
    this.otherCost.set(null);
    this.askingPrice.set(null);
    this.profitLocked.set(false);
    this.mmr.set(null);
    this.marketAvg.set(null);
    this.vehicleHistory.set(null);
    this.marketDaysSupply.set(null);
    this.priceRank.set(null);
  }

  fmt(val: number | null): string {
    if (val === null || val === undefined) return '';
    if (!val && val !== 0) return '';
    return val.toLocaleString('en-US');
  }

  parse(val: string): number | null {
    const n = Number(val.replace(/[^0-9.-]/g, ''));
    return isNaN(n) || n === 0 ? null : n;
  }

  updateVehicleField(field: string, val: string) {
    this.vehicle.update(v => ({ ...v, [field]: val }));
  }
}

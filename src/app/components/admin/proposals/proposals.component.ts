import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'admin-proposals',
  templateUrl: './proposals.component.html',
  styleUrl: './proposals.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
})
export class AdminProposalsComponent implements OnInit {
  private http = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);

  proposals = signal<any[]>([]);
  loading = signal(true);
  selected = signal<any>(null);

  // Strategy data
  strategy = signal<any>(null);
  loadingStrategy = signal(false);

  // Send form
  sendEmail = signal('');
  sendMessage = signal('');
  sending = signal(false);
  sent = signal(false);

  // Edit
  saving = signal(false);
  saved = signal(false);

  ngOnInit() {
    this.http.get<any[]>('/api/admin/proposals').subscribe({
      next: (data) => { this.proposals.set(data || []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  selectProposal(p: any) {
    this.selected.set({ ...p, excluded_fields: p.excluded_fields || [] });
    this.sent.set(false);
    this.saved.set(false);
    this.loadStrategy(p.vin);
  }

  loadStrategy(vin: string) {
    this.loadingStrategy.set(true);
    this.strategy.set(null);

    // Fetch vehicle costs + market data in parallel
    const costs$ = this.http.get<any>(`/api/admin/vehicle/${vin}`);
    const market$ = this.http.post<any>('/api/admin/vehicle/market-data', {
      vin,
      year: this.selected()?.vehicle?.year,
      make: this.selected()?.vehicle?.make,
      model: this.selected()?.vehicle?.model,
      trim: this.selected()?.vehicle?.trim,
      mileage: this.selected()?.vehicle?.mileage,
    });

    costs$.subscribe({
      next: (data) => {
        const purchasePrice = data.pricing?.purchase_price || 0;
        const costAdds = (data.costAdds || []).reduce((s: number, c: any) => s + (c.cost || 0), 0);
        const costAddsList = data.costAdds || [];
        const floorPlans = data.floorPlans || [];
        const flooringCost = floorPlans.reduce((s: number, fp: any) => {
          if (fp.status === 'Paid Off') return s + (fp.est_flooring || 0);
          const days = Math.floor((Date.now() - new Date(fp.date_floored).getTime()) / 86400000);
          const interest = (fp.amount_floored * (fp.interest_rate || 8.25) / 100 / 365) * days;
          const fees = (fp.admin_fee || 0) + (fp.floor_fee || 0) + (fp.highline_fee || 0);
          return s + interest + fees;
        }, 0);

        this.strategy.update(s => ({
          ...s,
          purchase_price: purchasePrice,
          cost_adds: costAdds,
          cost_adds_list: costAddsList,
          flooring_cost: Math.round(flooringCost * 100) / 100,
          total_investment: Math.round((purchasePrice + costAdds + flooringCost) * 100) / 100,
        }));
        this.loadingStrategy.set(false);
      },
      error: () => this.loadingStrategy.set(false),
    });

    market$.subscribe({
      next: (data) => {
        this.strategy.update(s => ({
          ...s,
          mmr: data.mmr || 0,
          kbb: data.kbb || 0,
          market_avg: data.market_avg || 0,
        }));
      },
      error: () => {},
    });
  }

  totalInvestment(s: any): number {
    return (s.purchase_price || 0) + (s.transport_cost || 0) + (s.auction_fees || 0)
      + (s.recon_mechanical || 0) + (s.recon_body || 0) + (s.recon_tires || 0) + (s.recon_other || 0)
      + this.estFlooringCost(s);
  }

  estFlooringCost(s: any): number {
    const principal = s.purchase_price || 0;
    const days = s.est_days_to_sell || 45;
    const rate = 8.25;
    return Math.round((principal * rate / 100 / 365) * days);
  }

  grossProfit(s: any): number {
    return (s.asking_price || 0) - this.totalInvestment(s);
  }

  minGross(s: any): number {
    return (s.min_price || 0) - this.totalInvestment(s);
  }

  grossMargin(s: any): number {
    if (!s.asking_price) return 0;
    return (this.grossProfit(s) / s.asking_price) * 100;
  }

  pctToMMR(s: any): number {
    const mmr = s.auction?.mmr || s.mmr || 0;
    if (!mmr || !s.asking_price) return 0;
    return ((s.asking_price - mmr) / mmr) * 100;
  }

  close() {
    this.selected.set(null);
  }

  vehicleName(p: any): string {
    const v = p?.vehicle || {};
    return `${v.year || ''} ${v.make || ''} ${v.model || ''} ${v.trim || ''}`.trim() || p.vin;
  }

  proposalUrl(p: any): string {
    return `https://bigwaveauto.com/proposal/${p.id}`;
  }

  copyLink(p: any) {
    navigator.clipboard.writeText(this.proposalUrl(p));
  }

  toggleExclude(field: string) {
    const s = this.selected();
    if (!s) return;
    const ex = s.excluded_fields || [];
    if (ex.includes(field)) {
      s.excluded_fields = ex.filter((f: string) => f !== field);
    } else {
      s.excluded_fields = [...ex, field];
    }
    this.selected.set({ ...s });
  }

  isExcluded(field: string): boolean {
    return (this.selected()?.excluded_fields || []).includes(field);
  }

  saveProposal() {
    const s = this.selected();
    if (!s) return;
    this.saving.set(true);
    this.http.post(`/api/admin/proposal/${s.id}`, {
      vehicle: s.vehicle,
      condition: s.condition,
      excluded_fields: s.excluded_fields,
      custom_notes: s.custom_notes,
      asking_price: s.asking_price,
      status: s.status,
      line_items: s.line_items || [],
      trade_in: s.trade_in || null,
      tax_rate: s.tax_rate || 0,
      down_payment: s.down_payment || 0,
      carfax_url: s.carfax_url || null,
      purchase_price: s.purchase_price || 0,
      transport_cost: s.transport_cost || 0,
      auction_fees: s.auction_fees || 0,
      recon_mechanical: s.recon_mechanical || 0,
      recon_body: s.recon_body || 0,
      recon_tires: s.recon_tires || 0,
      recon_other: s.recon_other || 0,
      est_days_to_sell: s.est_days_to_sell || 45,
      min_price: s.min_price || 0,
    }).subscribe({
      next: () => { this.saving.set(false); this.saved.set(true); setTimeout(() => this.saved.set(false), 3000); },
      error: () => { this.saving.set(false); alert('Failed to save.'); },
    });
  }

  sendProposal() {
    const s = this.selected();
    if (!s || !this.sendEmail()) return;
    this.sending.set(true);
    this.http.post(`/api/admin/proposal/${s.id}/send`, {
      email: this.sendEmail(),
      message: this.sendMessage(),
    }).subscribe({
      next: () => {
        this.sending.set(false);
        this.sent.set(true);
        // Update status locally
        s.status = 'sent';
        this.selected.set({ ...s });
      },
      error: () => { this.sending.set(false); alert('Failed to send.'); },
    });
  }

  // ── Line Items ──
  getLineItems(s: any): any[] {
    if (!s.line_items) s.line_items = [];
    return s.line_items;
  }

  addLineItem(s: any, label: string, amount: number, taxable: boolean) {
    if (!s.line_items) s.line_items = [];
    s.line_items.push({ label, amount, taxable });
    this.selected.set({ ...s });
  }

  removeLineItem(s: any, index: number) {
    s.line_items = s.line_items.filter((_: any, i: number) => i !== index);
    this.selected.set({ ...s });
  }

  applyPreset(s: any) {
    const price = s.asking_price || 0;
    s.line_items = [
      { label: 'Dealer Retail Price', amount: price, taxable: true },
      { label: 'Service Fee', amount: 299, taxable: true },
      { label: 'Title & Registration', amount: 215, taxable: false },
    ];
    if (!s.tax_rate) s.tax_rate = 5.5;
    this.selected.set({ ...s });
  }

  // ── Trade-In ──
  getTradeIn(s: any): any {
    if (!s.trade_in) s.trade_in = { year: '', make: '', model: '', vin: '', mileage: '', allowance: 0, payoff: 0, payoff_to: '' };
    return s.trade_in;
  }

  // ── Carfax ──
  carfaxDragOver = signal(false);
  uploadingCarfax = signal(false);

  onCarfaxDragOver(e: DragEvent) { e.preventDefault(); this.carfaxDragOver.set(true); }

  onCarfaxDrop(e: DragEvent, s: any) {
    e.preventDefault();
    this.carfaxDragOver.set(false);
    const file = e.dataTransfer?.files[0];
    if (file && file.type === 'application/pdf') this.uploadCarfax(file, s);
  }

  onCarfaxSelect(e: Event, s: any) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.uploadCarfax(file, s);
  }

  uploadCarfax(file: File, s: any) {
    this.uploadingCarfax.set(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('proposal_id', s.id);
    formData.append('vin', s.vin);

    this.http.post<any>('/api/admin/proposal/carfax', formData).subscribe({
      next: (res) => {
        s.carfax_url = res.url;
        this.selected.set({ ...s });
        this.uploadingCarfax.set(false);
      },
      error: () => { this.uploadingCarfax.set(false); alert('Upload failed.'); },
    });
  }

  removeCarfax(s: any) {
    s.carfax_url = null;
    this.selected.set({ ...s });
  }

  safeCarfaxUrl(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  removePhoto(s: any, index: number) {
    s.photos = s.photos.filter((_: any, i: number) => i !== index);
    this.selected.set({ ...s });
  }

  timeAgo(date: string): string {
    if (!date) return '';
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }
}

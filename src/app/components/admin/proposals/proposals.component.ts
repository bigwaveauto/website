import { Component, inject, OnInit, signal, computed } from '@angular/core';
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
  searchQuery = signal('');

  filteredProposals = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.proposals();
    return this.proposals().filter(p => {
      return (
        p.vin?.toLowerCase().includes(q) ||
        p.vehicle?.year?.toString().includes(q) ||
        p.vehicle?.make?.toLowerCase().includes(q) ||
        p.vehicle?.model?.toLowerCase().includes(q) ||
        p.customer_name?.toLowerCase().includes(q) ||
        p.customer_phone?.includes(q) ||
        p.sent_to?.toLowerCase().includes(q) ||
        p.status?.toLowerCase().includes(q)
      );
    });
  });

  // Strategy data
  strategy = signal<any>(null);
  loadingStrategy = signal(false);

  // Send form
  sendEmail = signal('');
  sendMessage = signal('');
  sending = signal(false);
  sent = signal(false);

  // Mode toggle
  setMode(s: any, mode: 'info' | 'proposal') {
    s.proposal_mode = mode;
    this.selected.set({ ...s });
    this.autosave(s);
  }

  // Edit
  saving = signal(false);
  saved = signal(false);
  private autosaveTimer: any = null;

  // Auction fee tiers
  auctionFeeTiers = signal([
    { upTo: 20000, fee: 500 },
    { upTo: 50000, fee: 800 },
    { upTo: Infinity, fee: 1100 },
  ]);
  showFeeModal = signal(false);

  ngOnInit() {
    this.http.get<any[]>('/api/admin/proposals').subscribe({
      next: (data) => { this.proposals.set(data || []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  selectProposal(p: any) {
    const s = { ...p, excluded_fields: p.excluded_fields || [] };
    // Auto-apply default line items if none exist
    if (!s.line_items?.length) {
      s.line_items = [
        { label: 'Service Fee', amount: 299, taxable: true },
        { label: 'Title & Registration', amount: 215, taxable: false },
        { label: 'Transport', amount: null, taxable: false },
        { label: 'EV Surcharge', amount: null, taxable: false },
        { label: 'Loan Filing', amount: null, taxable: false },
      ];
      if (!s.tax_rate) s.tax_rate = 5.5;
    }
    // Pre-fill purchase price: buy_now > current_bid > mmr
    if (!s.purchase_price) {
      s.purchase_price = s.auction?.buy_now || s.auction?.current_bid || s.auction?.mmr || null;
    }
    // Auto-calc auction fee from tiers if not already set
    if (!s.auction_fees && s.purchase_price) {
      s.auction_fees = this.calcAuctionFee(s.purchase_price);
    }
    this.selected.set(s);
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
        // Push MMR into selected proposal so banner + pre-fill work
        if (data.mmr) {
          const s = this.selected();
          if (s) {
            if (!s.mmr) s.mmr = data.mmr;
            // Pre-fill purchase price if still empty
            if (!s.purchase_price) {
              s.purchase_price = s.auction?.buy_now || s.auction?.current_bid || data.mmr;
              s.auction_fees = this.calcAuctionFee(s.purchase_price);
            }
            this.selected.set({ ...s });
          }
        }
      },
      error: () => {},
    });
  }

  calcAuctionFee(price: number): number {
    const tiers = this.auctionFeeTiers();
    for (const tier of tiers) {
      if (price <= tier.upTo) return tier.fee;
    }
    return tiers[tiers.length - 1].fee;
  }

  onPurchasePriceChange(s: any, val: string) {
    s.purchase_price = this.parse(val);
    if (s.purchase_price) s.auction_fees = this.calcAuctionFee(s.purchase_price);
    this.selected.set({ ...s });
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

  lineItemGross(s: any): number {
    return (s.line_items || []).filter((li: any) => li.add_to_gross && li.amount).reduce((sum: number, li: any) => sum + (li.amount || 0), 0);
  }

  grossProfit(s: any): number {
    return (s.asking_price || 0) - this.totalInvestment(s) + this.lineItemGross(s);
  }

  minGross(s: any): number {
    return (s.min_price || 0) - this.totalInvestment(s);
  }

  grossMargin(s: any): number {
    if (!s.asking_price) return 0;
    return (this.grossProfit(s) / s.asking_price) * 100;
  }

  // ── Deal Math ──
  // WI law: trade allowance reduces the taxable base, not the sticker price.
  // totalOTD = (asking − allowance) + fees + tax.  Then add payoff (lender) after OTD.

  taxableGross(s: any): number {
    return (s.asking_price || 0) + (s.line_items || [])
      .filter((li: any) => li.taxable && li.amount)
      .reduce((sum: number, li: any) => sum + (li.amount || 0), 0);
  }

  // Tax base after WI trade deduction
  taxableBase(s: any): number {
    const tradeAllowance = s.trade_in?.allowance || 0;
    return Math.max(0, this.taxableGross(s) - tradeAllowance);
  }

  taxAmount(s: any): number {
    return Math.round(this.taxableBase(s) * ((s.tax_rate || 0) / 100));
  }

  nonTaxableTotal(s: any): number {
    return (s.line_items || []).filter((li: any) => !li.taxable && li.amount)
      .reduce((sum: number, li: any) => sum + (li.amount || 0), 0);
  }

  // OTD = (asking − trade_allowance) + all fees + tax.
  // Trade allowance is already baked in via taxableBase.
  totalOTD(s: any): number {
    return this.taxableBase(s) + this.taxAmount(s) + this.nonTaxableTotal(s);
  }

  // After OTD, add any trade payoff (dealer pays lender → adds to amount financed).
  amountFinanced(s: any): number {
    const payoff = s.trade_in?.payoff || 0;
    return Math.max(0, this.totalOTD(s) + payoff - (s.down_payment || 0));
  }

  // Display helper: trade allowance (shown under asking price in waterfall)
  tradeAllowance(s: any): number {
    return s.trade_in?.allowance || 0;
  }

  // Display helper: trade payoff shown after OTD (adds to what's financed)
  tradePayoff(s: any): number {
    return s.trade_in?.payoff || 0;
  }

  marineCuBackend(s: any): number {
    if (!s.marine_cu) return 0;
    return Math.round(this.amountFinanced(s) * 0.015);
  }

  totalGross(s: any): number {
    return this.grossProfit(s) + this.marineCuBackend(s);
  }

  // ── Formatting ──
  fmt(val: any): string {
    if (!val && val !== 0) return '';
    const n = Number(val);
    if (!n) return '';
    return n.toLocaleString('en-US');
  }

  parse(val: string): number | null {
    const n = Number(val.replace(/[^0-9.-]/g, ''));
    return n || null;
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

  printProposal(p: any) {
    const w = window.open(this.proposalUrl(p), '_blank');
    if (w) w.addEventListener('load', () => w.print());
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

  autosave(s?: any) {
    // Always update selected() first so saveProposal reads the latest state
    if (s) this.selected.set({ ...s });
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.saveProposal(), 1200);
  }

  saveProposal(override?: any) {
    const s = override || this.selected();
    if (!s) return;
    this.saving.set(true);
    this.http.post(`/api/admin/proposal/${s.id}`, {
      vehicle: s.vehicle,
      condition: s.condition,
      photos: s.photos || [],
      excluded_fields: s.excluded_fields,
      custom_notes: s.custom_notes,
      asking_price: s.asking_price,
      status: s.status,
      proposal_mode: s.proposal_mode || 'info',
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
      marine_cu: s.marine_cu || false,
      customer_name: s.customer_name || '',
      customer_phone: s.customer_phone || '',
      customer_address: s.customer_address || '',
      customer_zip: s.customer_zip || '',
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
        // Re-fetch from server so admin numbers match what's in DB (customer-facing)
        this.http.get<any[]>('/api/admin/proposals').subscribe({
          next: (data) => {
            this.proposals.set(data || []);
            const fresh = (data || []).find((p: any) => p.id === s.id);
            if (fresh) this.selected.set({ ...fresh });
          },
        });
      },
      error: (err) => { this.saving.set(false); alert('Failed to save: ' + (err?.error?.error || err?.status || 'unknown')); },
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
    this.autosave(s);
  }

  removeLineItem(s: any, index: number) {
    s.line_items = s.line_items.filter((_: any, i: number) => i !== index);
    this.selected.set({ ...s });
    this.autosave(s);
  }

  applyPreset(s: any) {
    const price = s.asking_price || 0;
    s.line_items = [
      { label: 'Service Fee', amount: 299, taxable: true },
      { label: 'Title & Registration', amount: 215, taxable: false },
      { label: 'Transport', amount: null, taxable: false },
      { label: 'EV Surcharge', amount: null, taxable: false },
      { label: 'Loan Filing', amount: null, taxable: false },
    ];
    if (!s.tax_rate) s.tax_rate = 5.5;
    this.selected.set({ ...s });
  }

  // ── Trade-In ──
  getTradeIn(s: any): any {
    if (!s.trade_in) {
      s.trade_in = { year: '', make: '', model: '', vin: '', mileage: '', allowance: null, payoff: null, payoff_to: '' };
    }
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
    this.autosave(s);
  }

  // ── Address Autocomplete (Nominatim / OpenStreetMap) ──
  addrSuggestions = signal<any[]>([]);
  private addrTimer: any = null;

  onAddressInput(s: any, val: string) {
    s.customer_address = val;
    clearTimeout(this.addrTimer);
    if (!val || val.length < 4) { this.addrSuggestions.set([]); return; }
    this.addrTimer = setTimeout(() => {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=us&limit=5&q=${encodeURIComponent(val)}`;
      fetch(url, { headers: { 'Accept-Language': 'en' } })
        .then(r => r.json())
        .then((results: any[]) => this.addrSuggestions.set(results))
        .catch(() => this.addrSuggestions.set([]));
    }, 350);
  }

  selectAddress(s: any, sug: any) {
    const a = sug.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    s.customer_address = street || sug.display_name;
    s.customer_zip = a.postcode || s.customer_zip || '';
    this.selected.set({ ...s });
    this.addrSuggestions.set([]);
    this.autosave();
  }

  clearAddrSuggestions() {
    setTimeout(() => this.addrSuggestions.set([]), 200);
  }

  deleteProposal(p: any, event: Event) {
    event.stopPropagation();
    this.http.delete(`/api/admin/proposal/${p.id}`).subscribe({
      next: () => {
        this.proposals.update(list => list.filter((x: any) => x.id !== p.id));
        if (this.selected()?.id === p.id) this.selected.set(null);
      },
      error: () => alert('Failed to delete proposal'),
    });
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

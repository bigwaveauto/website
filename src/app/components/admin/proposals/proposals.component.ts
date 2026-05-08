import { Component, inject, OnInit, OnDestroy, signal, computed, ViewChild, ElementRef } from '@angular/core';
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
export class AdminProposalsComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);

  proposals = signal<any[]>([]);
  deals = signal<any[]>([]);
  loading = signal(true);
  selected = signal<any>(null);
  selectedDeal = signal<any>(null);
  searchQuery = signal('');
  expandedDeals = signal<Set<string>>(new Set());

  // Deal editor state
  dealSaving = signal(false);
  dealSaved = signal(false);
  private dealAutosaveTimer: any = null;

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

  groupedView = computed(() => {
    const filtered = this.filteredProposals();
    const grouped = this.deals().map(d => ({
      deal: d,
      proposals: filtered.filter(p => p.deal_group_id === d.id),
    }));
    const ungrouped = filtered.filter(p => !p.deal_group_id);
    return { grouped, ungrouped };
  });

  // City/state from ZIP
  cityState = signal('');
  paymentTab = signal<'cash' | 'finance'>('finance');
  private zipTimer: any = null;

  fieldDefs = [
    { key: 'mileage',        label: 'Mileage',        icon: 'gauge' },
    { key: 'exterior_color', label: 'Ext. Color',     icon: 'palette' },
    { key: 'interior_color', label: 'Int. Color',     icon: 'paintbrush' },
    { key: 'engine',         label: 'Engine',         icon: 'zap' },
    { key: 'transmission',   label: 'Transmission',   icon: 'cog' },
    { key: 'drivetrain',     label: 'Drivetrain',     icon: 'car' },
    { key: 'fuel',           label: 'Fuel Type',      icon: 'droplets' },
    { key: 'body',           label: 'Body Style',     icon: 'box' },
    { key: 'grade',          label: 'Grade',          icon: 'star' },
    { key: 'announcements',  label: 'Announcements',  icon: 'megaphone' },
    { key: 'tires',          label: 'Tires',          icon: 'circle-dot' },
  ];

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
    this.loadProposals();
    this.loadDeals();
  }

  loadProposals() {
    this.loading.set(true);
    this.http.get<any[]>('/api/admin/proposals').subscribe({
      next: (data) => { this.proposals.set(data || []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  loadDeals() {
    this.http.get<any[]>('/api/admin/deal-groups').subscribe({
      next: (data) => this.deals.set(data || []),
      error: () => {},
    });
  }

  refresh() {
    this.loadProposals();
    this.loadDeals();
  }

  // ── Deal Group Methods ──

  createDeal() {
    this.http.post<any>('/api/admin/deal-groups', { label: 'New Deal' }).subscribe({
      next: (deal) => {
        this.deals.update(list => [deal, ...list]);
        this.selectDeal(deal);
        this.expandedDeals.update(s => { const ns = new Set(s); ns.add(deal.id); return ns; });
      },
      error: () => alert('Failed to create deal'),
    });
  }

  selectDeal(d: any) {
    this.selectedDeal.set({ ...d });
    this.selected.set(null);
    this.stopChatPoll();
  }

  autosaveDeal(d?: any) {
    if (d) this.selectedDeal.set({ ...d });
    clearTimeout(this.dealAutosaveTimer);
    this.dealAutosaveTimer = setTimeout(() => this.saveDeal(), 1200);
  }

  saveDeal() {
    const deal = this.selectedDeal();
    if (!deal) return;
    this.dealSaving.set(true);
    this.http.post(`/api/admin/deal-groups/${deal.id}`, {
      label: deal.label,
      customer_name: deal.customer_name,
      customer_phone: deal.customer_phone,
      customer_email: deal.customer_email,
      customer_address: deal.customer_address,
      customer_zip: deal.customer_zip,
      tax_rate: deal.tax_rate,
      trade_in: deal.trade_in,
    }).subscribe({
      next: () => {
        this.dealSaving.set(false);
        this.dealSaved.set(true);
        setTimeout(() => this.dealSaved.set(false), 3000);
        this.deals.update(list => list.map(x => x.id === deal.id ? { ...deal } : x));
      },
      error: () => { this.dealSaving.set(false); alert('Failed to save deal'); },
    });
  }

  deleteDeal(d: any, event: Event) {
    event.stopPropagation();
    if (!confirm(`Delete deal "${d.label}"? Proposals will become ungrouped.`)) return;
    this.http.delete(`/api/admin/deal-groups/${d.id}`).subscribe({
      next: () => {
        this.deals.update(list => list.filter(x => x.id !== d.id));
        if (this.selectedDeal()?.id === d.id) this.selectedDeal.set(null);
        this.proposals.update(list => list.map(p => p.deal_group_id === d.id ? { ...p, deal_group_id: null } : p));
      },
      error: () => alert('Failed to delete deal'),
    });
  }

  toggleDealExpand(id: string, event: Event) {
    event.stopPropagation();
    this.expandedDeals.update(s => {
      const ns = new Set(s);
      if (ns.has(id)) ns.delete(id); else ns.add(id);
      return ns;
    });
  }

  isDealExpanded(id: string): boolean {
    return this.expandedDeals().has(id);
  }

  assignToGroup(s: any, groupId: string | null) {
    s.deal_group_id = groupId || null;
    this.selected.set({ ...s });
    this.http.post(`/api/admin/proposal/${s.id}`, { deal_group_id: groupId || null }).subscribe({
      next: () => {
        this.proposals.update(list => list.map(p => p.id === s.id ? { ...p, deal_group_id: groupId || null } : p));
      },
      error: () => alert('Failed to assign to deal'),
    });
  }

  applyDealToProposal(s: any) {
    const deal = this.deals().find(d => d.id === s.deal_group_id);
    if (!deal) return;
    if (deal.customer_name) s.customer_name = deal.customer_name;
    if (deal.customer_phone) s.customer_phone = deal.customer_phone;
    if (deal.customer_address) s.customer_address = deal.customer_address;
    if (deal.customer_zip) s.customer_zip = deal.customer_zip;
    if (deal.tax_rate) s.tax_rate = deal.tax_rate;
    if (deal.trade_in) s.trade_in = { ...deal.trade_in };
    this.selected.set({ ...s });
    this.autosave(s);
  }

  getDealTradeIn(d: any): any {
    if (!d.trade_in) {
      d.trade_in = { year: '', make: '', model: '', vin: '', mileage: '', allowance: null, payoff: null, payoff_to: '' };
    }
    return d.trade_in;
  }

  proposalsForDeal(dealId: string): any[] {
    return this.groupedView().grouped.find(g => g.deal.id === dealId)?.proposals || [];
  }

  ngOnDestroy() {
    this.stopChatPoll();
  }

  // ── Admin Chat ──
  @ViewChild('adminChatBody') adminChatBodyEl!: ElementRef<HTMLElement>;
  adminChatMessages = signal<any[]>([]);
  adminChatInput = signal('');
  adminChatSending = signal(false);
  adminUnreadCount = signal(0);
  private chatPollTimer: any = null;
  private chatProposalId = '';

  private startChatPoll(proposalId: string) {
    this.stopChatPoll();
    this.chatProposalId = proposalId;
    this.adminChatMessages.set([]);
    this.adminUnreadCount.set(0);
    this.fetchAdminChat();
    this.chatPollTimer = setInterval(() => this.fetchAdminChat(), 5000);
    // Mark customer messages as read
    this.http.post(`/api/admin/proposal/${proposalId}/chat/read`, {}).subscribe();
  }

  private stopChatPoll() {
    clearInterval(this.chatPollTimer);
    this.chatPollTimer = null;
  }

  private fetchAdminChat() {
    if (!this.chatProposalId) return;
    this.http.get<any[]>(`/api/proposal/${this.chatProposalId}/chat`).subscribe({
      next: (msgs) => {
        const prev = this.adminChatMessages();
        this.adminChatMessages.set(msgs);
        const prevCustomer = prev.filter(m => m.sender === 'customer').length;
        const newCustomer = msgs.filter(m => m.sender === 'customer').length;
        if (newCustomer > prevCustomer) {
          this.adminUnreadCount.update(n => n + (newCustomer - prevCustomer));
          // Auto-mark read since panel is open
          this.http.post(`/api/admin/proposal/${this.chatProposalId}/chat/read`, {}).subscribe();
        }
        setTimeout(() => {
          const el = this.adminChatBodyEl?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        }, 30);
      },
    });
  }

  sendAdminChat(s: any) {
    const msg = this.adminChatInput().trim();
    if (!msg || this.adminChatSending()) return;
    this.adminChatSending.set(true);
    this.http.post<any>(`/api/admin/proposal/${s.id}/chat`, { message: msg }).subscribe({
      next: (saved) => {
        this.adminChatMessages.update(msgs => [...msgs, saved]);
        this.adminChatInput.set('');
        this.adminChatSending.set(false);
        setTimeout(() => {
          const el = this.adminChatBodyEl?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        }, 30);
      },
      error: () => this.adminChatSending.set(false),
    });
  }

  selectProposal(p: any) {
    this.selectedDeal.set(null);
    this.paymentTab.set('finance');
    if (p.customer_zip) this.lookupCityState(p.customer_zip); else this.cityState.set('');
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
    this.startChatPoll(p.id);
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

  lookupCityState(zip: string) {
    if (!zip || zip.length < 5) { this.cityState.set(''); return; }
    clearTimeout(this.zipTimer);
    this.zipTimer = setTimeout(() => {
      const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=1&postalcode=${encodeURIComponent(zip)}`;
      fetch(url, { headers: { 'Accept-Language': 'en' } })
        .then(r => r.json())
        .then((results: any[]) => {
          if (results[0]) {
            const parts = (results[0].display_name || '').split(',');
            this.cityState.set(parts.slice(0, 2).map((p: string) => p.trim()).join(', '));
          } else { this.cityState.set(''); }
        })
        .catch(() => this.cityState.set(''));
    }, 500);
  }

  mileageNum(p: any): number | null {
    const raw = p?.vehicle?.mileage;
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') return raw;
    const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : n;
  }

  vehicleSpecs(p: any): string {
    const v = p?.vehicle || {};
    const mi = this.mileageNum(p);
    return [
      mi ? `${mi.toLocaleString('en-US')} mi` : null,
      v.drivetrain, v.engine, v.fuel, v.transmission,
    ].filter(Boolean).join(' · ');
  }

  tradeEquity(s: any): number {
    return (s.trade_in?.allowance || 0) - (s.trade_in?.payoff || 0);
  }

  setMileage(s: any, val: any) {
    s.vehicle = { ...(s.vehicle || {}), mileage: val || null };
    this.autosave(s);
  }

  cashAtDelivery(s: any): number {
    return Math.max(0, this.totalOTD(s) - (s.security_deposit || 0));
  }

  onProfitTargetChange(s: any, val: string) {
    s.profit_target = this.parse(val) ?? 0;
    const ti = this.totalInvestment(s);
    if (ti > 0 || s.profit_target) {
      s.asking_price = Math.round((ti + (s.profit_target || 0)) * 100) / 100 || null;
    }
    this.selected.set({ ...s });
    this.autosave(s);
  }

  onAskingPriceChange(s: any, val: string) {
    s.asking_price = this.parse(val);
    const ti = this.totalInvestment(s);
    if (ti > 0 && s.asking_price) {
      s.profit_target = Math.round((s.asking_price - ti) * 100) / 100;
    }
    this.selected.set({ ...s });
    this.autosave(s);
  }

  onPurchasePriceChange(s: any, val: string) {
    s.purchase_price = this.parse(val);
    if (s.purchase_price) s.auction_fees = this.calcAuctionFee(s.purchase_price);
    // If profit target is set, keep asking price in sync
    if (s.profit_target != null && this.totalInvestment(s) > 0) {
      s.asking_price = Math.round((this.totalInvestment(s) + s.profit_target) * 100) / 100;
    }
    this.selected.set({ ...s });
    this.autosave(s);
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

  // After OTD, add trade payoff + lien payoff, subtract down payment.
  amountFinanced(s: any): number {
    const tradePayoff = s.trade_in?.payoff || 0;
    const lienPayoff = s.lien_payoff || 0;
    return Math.max(0, this.totalOTD(s) + tradePayoff + lienPayoff - (s.down_payment || 0));
  }

  // Display helper: trade allowance (shown under asking price in waterfall)
  tradeAllowance(s: any): number {
    return s.trade_in?.allowance || 0;
  }

  // Display helper: trade payoff shown after OTD (adds to what's financed)
  tradePayoff(s: any): number {
    return s.trade_in?.payoff || 0;
  }

  lienPayoff(s: any): number {
    return s.lien_payoff || 0;
  }

  monthlyPaymentEst(s: any): number {
    const principal = this.amountFinanced(s);
    const apr = s.apr || 0;
    const n = s.term_months || 0;
    if (principal <= 0 || n <= 0) return 0;
    if (apr <= 0) return Math.round(principal / n);
    const r = apr / 100 / 12;
    return Math.round(principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
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
      lien_payoff: s.lien_payoff || 0,
      apr: s.apr ?? null,
      term_months: s.term_months ?? null,
      window_sticker_url: s.window_sticker_url || null,
      profit_target: s.profit_target ?? null,
      security_deposit: s.security_deposit || 0,
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

  // ── Window Sticker ──
  stickerDragOver = signal(false);
  uploadingSticker = signal(false);

  onStickerDragOver(e: DragEvent) { e.preventDefault(); this.stickerDragOver.set(true); }

  onStickerDrop(e: DragEvent, s: any) {
    e.preventDefault();
    this.stickerDragOver.set(false);
    const file = e.dataTransfer?.files[0];
    if (file) this.uploadSticker(file, s);
  }

  onStickerSelect(e: Event, s: any) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.uploadSticker(file, s);
  }

  uploadSticker(file: File, s: any) {
    this.uploadingSticker.set(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('proposal_id', s.id);
    formData.append('vin', s.vin);
    this.http.post<any>('/api/admin/proposal/window-sticker', formData).subscribe({
      next: (res) => {
        s.window_sticker_url = res.url;
        this.selected.set({ ...s });
        this.uploadingSticker.set(false);
      },
      error: () => { this.uploadingSticker.set(false); alert('Upload failed.'); },
    });
  }

  removeSticker(s: any) {
    s.window_sticker_url = null;
    this.selected.set({ ...s });
  }

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

  photoDragIdx = -1;
  photoDropIdx = -1;

  onPhotoDragStart(index: number) {
    this.photoDragIdx = index;
  }

  onPhotoDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    this.photoDropIdx = index;
  }

  onPhotoDragLeave(event: DragEvent) {
    const el = event.currentTarget as HTMLElement;
    if (!el.contains(event.relatedTarget as Node)) {
      this.photoDropIdx = -1;
    }
  }

  onPhotoDrop(s: any, index: number) {
    const from = this.photoDragIdx;
    if (from === -1 || from === index) { this.photoDragIdx = -1; this.photoDropIdx = -1; return; }
    const photos = [...s.photos];
    const [moved] = photos.splice(from, 1);
    photos.splice(index, 0, moved);
    s.photos = photos;
    this.selected.set({ ...s });
    this.autosave(s);
    this.photoDragIdx = -1;
    this.photoDropIdx = -1;
  }

  onPhotoDragEnd() {
    this.photoDragIdx = -1;
    this.photoDropIdx = -1;
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

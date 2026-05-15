import { Component, inject, OnInit, OnDestroy, signal, ElementRef, ViewChild, PLATFORM_ID } from '@angular/core';
import { CommonModule, SlicePipe, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-proposal',
  templateUrl: './proposal.component.html',
  styleUrl: './proposal.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
})
export class ProposalComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  proposal = signal<any>(null);
  loading = signal(true);
  notFound = signal(false);
  selectedPhoto = signal(0);
  lightboxOpen = signal(false);
  lightboxIndex = signal(0);

  // Financing estimate (customer-adjustable, local only)
  finDown = signal(0);
  finApr = signal(6.9);
  finTerm = signal(60);

  get finPrincipal(): number { return this.totalDue; }

  get finMonthly(): number {
    const p = this.finPrincipal;
    const apr = this.finApr();
    const n = this.finTerm();
    if (p <= 0 || n <= 0) return 0;
    if (apr <= 0) return Math.round(p / n);
    const r = apr / 100 / 12;
    return Math.round(p * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
  }

  // Feedback signals (Info Only mode)
  interest = signal<'yes' | 'meh' | 'no' | null>(null);
  reason = signal('');
  feedbackSent = signal(false);
  feedbackSending = signal(false);

  // Cash / Finance tabs (Proposal mode)
  propTab = signal<'cash' | 'finance'>('cash');
  cashConfirmed = signal(false);
  cashConfirming = signal(false);

  confirmCash() {
    const id = this.proposal()?.id;
    if (!id) return;
    this.cashConfirming.set(true);
    this.http.post(`/api/proposal/${id}/feedback`, {
      interest: 'cash',
      reason: 'Customer confirmed: Pay Cash',
    }).subscribe({
      next: () => { this.cashConfirming.set(false); this.cashConfirmed.set(true); },
      error: () => { this.cashConfirming.set(false); },
    });
  }

  get financingUrl(): string {
    const id = this.proposal()?.id;
    return id ? `/financing?proposal=${id}` : '/financing';
  }

  safeCarfaxUrl(): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.proposal()?.carfax_url || '');
  }

  // Question modal
  showQuestion = signal(false);
  questionText = signal('');
  questionSent = signal(false);
  questionSending = signal(false);

  // Chat widget
  @ViewChild('chatBody') chatBodyEl!: ElementRef<HTMLElement>;
  chatOpen = signal(false);
  chatMessages = signal<any[]>([]);
  chatInput = signal('');
  chatName = signal('');
  chatNameSet = signal(false);
  chatSending = signal(false);
  chatUnread = signal(0);
  private chatPollTimer: any = null;
  private chatProposalId = '';

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.notFound.set(true); this.loading.set(false); return; }

    this.chatProposalId = id;
    this.http.get<any>(`/api/proposal/${id}`).subscribe({
      next: (data) => {
        this.proposal.set(data);
        this.loading.set(false);
        if (data.down_payment) this.finDown.set(data.down_payment);
        if (data.apr) this.finApr.set(data.apr);
        if (data.term_months) this.finTerm.set(data.term_months);
        if (data.customer_name) {
          const firstName = data.customer_name.trim().split(' ')[0];
          this.chatName.set(firstName);
          this.chatNameSet.set(true);
        }
        this.startChatPoll();
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }

  ngOnDestroy() {
    clearInterval(this.chatPollTimer);
  }

  private startChatPoll() {
    if (!this.isBrowser) return;
    this.fetchChatMessages();
    this.chatPollTimer = setInterval(() => this.fetchChatMessages(), 5000);
  }

  private fetchChatMessages() {
    this.http.get<any[]>(`/api/proposal/${this.chatProposalId}/chat`).subscribe({
      next: (msgs) => {
        const prev = this.chatMessages();
        this.chatMessages.set(msgs);
        if (!this.chatOpen()) {
          const prevCount = prev.filter(m => m.sender === 'admin').length;
          const newCount = msgs.filter(m => m.sender === 'admin').length;
          if (newCount > prevCount) this.chatUnread.update(n => n + (newCount - prevCount));
        }
        this.scrollChatToBottom();
      },
      error: () => {},
    });
  }

  toggleChat() {
    this.chatOpen.update(v => !v);
    if (this.chatOpen()) {
      this.chatUnread.set(0);
      setTimeout(() => this.scrollChatToBottom(), 50);
    }
  }

  setChatName() {
    if (this.chatName().trim()) this.chatNameSet.set(true);
  }

  sendChatMessage() {
    const msg = this.chatInput().trim();
    if (!msg || this.chatSending()) return;
    this.chatSending.set(true);
    this.http.post<any>(`/api/proposal/${this.chatProposalId}/chat`, {
      message: msg,
      sender_name: this.chatName().trim() || 'Customer',
    }).subscribe({
      next: (saved) => {
        this.chatMessages.update(msgs => [...msgs, saved]);
        this.chatInput.set('');
        this.chatSending.set(false);
        this.scrollChatToBottom();
      },
      error: () => this.chatSending.set(false),
    });
  }

  onChatKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendChatMessage(); }
  }

  private scrollChatToBottom() {
    setTimeout(() => {
      const el = this.chatBodyEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 30);
  }

  get v(): any { return this.proposal()?.vehicle || {}; }
  get cr(): any { return this.proposal()?.condition || {}; }
  get photos(): string[] { return this.proposal()?.photos || []; }
  get excluded(): string[] { return this.proposal()?.excluded_fields || []; }
  get lineItems(): any[] { return this.proposal()?.line_items || []; }
  get tradeIn(): any { return this.proposal()?.trade_in || null; }

  get askingPrice(): number { return this.proposal()?.asking_price || 0; }

  get taxableLineItems(): any[] {
    return this.lineItems.filter((li: any) => li.taxable && li.amount);
  }

  // Gross taxable before trade deduction (shown in price section)
  get taxableGross(): number {
    return this.askingPrice + this.taxableLineItems.reduce((s: number, li: any) => s + (li.amount || 0), 0);
  }

  // Net taxable after trade allowance (WI law: trade reduces tax base)
  get taxableAmount(): number {
    const tradeAllowance = this.tradeIn?.allowance || 0;
    return Math.max(0, this.taxableGross - tradeAllowance);
  }

  get taxAmount(): number {
    const rate = this.proposal()?.tax_rate || 0;
    return Math.round(this.taxableAmount * (rate / 100));
  }

  get nonTaxableItems(): any[] {
    return this.lineItems.filter((li: any) => !li.taxable && li.amount);
  }

  get nonTaxableTotal(): number {
    return this.nonTaxableItems.reduce((s: number, li: any) => s + (li.amount || 0), 0);
  }

  // OTD = (asking − trade_allowance) + fees + tax  (trade allowance baked into taxableAmount)
  get cashPrice(): number {
    return this.taxableAmount + this.taxAmount + this.nonTaxableTotal;
  }

  get tradePayoff(): number {
    return this.tradeIn?.payoff || 0;
  }

  get lienPayoff(): number {
    return this.proposal()?.lien_payoff || 0;
  }

  // Display helper: net trade equity shown in the trade section
  get tradeEquity(): number {
    if (!this.tradeIn) return 0;
    return (this.tradeIn.allowance || 0) - (this.tradeIn.payoff || 0);
  }

  // Pre-financing gross balance (OTD + payoffs, no down payment deducted)
  get grossBalance(): number {
    return this.cashPrice + this.tradePayoff + this.lienPayoff;
  }

  // Balance due = gross balance − customer's cash down (finDown is reactive)
  get totalDue(): number {
    return Math.max(0, this.grossBalance - this.finDown());
  }

  prevPhoto() {
    const total = this.photos.length;
    this.selectedPhoto.update(i => (i - 1 + total) % total);
  }

  nextPhoto() {
    const total = this.photos.length;
    this.selectedPhoto.update(i => (i + 1) % total);
  }

  openLightbox(index: number) {
    this.lightboxIndex.set(index);
    this.lightboxOpen.set(true);
  }

  lightboxPrev() {
    const total = this.photos.length;
    this.lightboxIndex.update(i => (i - 1 + total) % total);
  }

  lightboxNext() {
    const total = this.photos.length;
    this.lightboxIndex.update(i => (i + 1) % total);
  }

  closeLightbox() {
    this.lightboxOpen.set(false);
  }

  get isInfoMode(): boolean {
    const mode = this.proposal()?.proposal_mode;
    return !mode || mode === 'info';
  }

  submitQuestion() {
    const id = this.proposal()?.id;
    if (!id || !this.questionText().trim()) return;
    this.questionSending.set(true);
    this.http.post(`/api/proposal/${id}/feedback`, {
      interest: 'question',
      reason: this.questionText(),
    }).subscribe({
      next: () => { this.questionSending.set(false); this.questionSent.set(true); },
      error: () => { this.questionSending.set(false); },
    });
  }

  submitFeedback() {
    const id = this.proposal()?.id;
    if (!id || !this.interest()) return;
    this.feedbackSending.set(true);
    this.http.post(`/api/proposal/${id}/feedback`, {
      interest: this.interest(),
      reason: this.reason(),
    }).subscribe({
      next: () => { this.feedbackSending.set(false); this.feedbackSent.set(true); },
      error: () => { this.feedbackSending.set(false); },
    });
  }

  isExcluded(field: string): boolean {
    return this.excluded.includes(field);
  }

  visibleDamage(): string[] {
    return (this.cr.damage || []).filter((_: string, i: number) => !this.excluded.includes(`damage_${i}`));
  }

  visibleOptions(): string[] {
    return (this.cr.options || []).filter((_: string, i: number) => !this.excluded.includes(`option_${i}`));
  }

  get visiblePackages(): { name: string; items: string[] }[] {
    return (this.cr.packages || []).filter((p: any) => p.items?.length);
  }

  get visibleEquipment(): string[] {
    return this.cr.equipment || [];
  }

  get hasPackagesOrEquipment(): boolean {
    return this.visiblePackages.length > 0 || this.visibleEquipment.length > 0;
  }

  private static readonly BRAND_SLUG: Record<string, string> = {
    'alfa romeo': 'alfa-romeo', 'aston martin': 'aston-martin', 'land rover': 'land-rover',
    'mercedes benz': 'mercedes-benz', 'mercedes-benz': 'mercedes-benz',
    'rolls royce': 'rolls-royce', 'rolls-royce': 'rolls-royce',
  };
  brandLogoUrl(make: string): string | null {
    if (!make) return null;
    const lower = make.toLowerCase().trim();
    const slug = ProposalComponent.BRAND_SLUG[lower] ?? lower.replace(/\s+/g, '-');
    return `/brands/${slug}.png`;
  }
}

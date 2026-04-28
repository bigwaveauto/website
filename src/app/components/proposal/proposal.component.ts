import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule, SlicePipe } from '@angular/common';
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
export class ProposalComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);

  private sanitizer = inject(DomSanitizer);

  proposal = signal<any>(null);
  loading = signal(true);
  notFound = signal(false);
  selectedPhoto = signal(0);
  carfaxExpanded = signal(false);

  // Feedback signals (Info Only mode)
  interest = signal<'yes' | 'no' | null>(null);
  reason = signal('');
  feedbackSent = signal(false);
  feedbackSending = signal(false);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.notFound.set(true); this.loading.set(false); return; }

    this.http.get<any>(`/api/proposal/${id}`).subscribe({
      next: (data) => {
        this.proposal.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }

  get v(): any { return this.proposal()?.vehicle || {}; }
  get cr(): any { return this.proposal()?.condition || {}; }
  get photos(): string[] { return this.proposal()?.photos || []; }
  get excluded(): string[] { return this.proposal()?.excluded_fields || []; }
  get lineItems(): any[] { return this.proposal()?.line_items || []; }
  get tradeIn(): any { return this.proposal()?.trade_in || null; }

  get cashPrice(): number {
    return this.lineItems
      .filter((li: any) => li.type !== 'credit')
      .reduce((s: number, li: any) => s + (li.amount || 0), 0);
  }

  get taxableAmount(): number {
    return this.lineItems
      .filter((li: any) => li.taxable)
      .reduce((s: number, li: any) => s + (li.amount || 0), 0);
  }

  get taxAmount(): number {
    const rate = this.proposal()?.tax_rate || 0;
    return Math.round(this.taxableAmount * rate) / 100;
  }

  get nonTaxableTotal(): number {
    return this.lineItems
      .filter((li: any) => !li.taxable && li.type !== 'credit')
      .reduce((s: number, li: any) => s + (li.amount || 0), 0);
  }

  get tradeEquity(): number {
    if (!this.tradeIn) return 0;
    return (this.tradeIn.allowance || 0) - (this.tradeIn.payoff || 0);
  }

  get totalDue(): number {
    return this.cashPrice + this.taxAmount - this.tradeEquity - (this.proposal()?.down_payment || 0);
  }

  prevPhoto() {
    const total = this.photos.length;
    this.selectedPhoto.update(i => (i - 1 + total) % total);
  }

  nextPhoto() {
    const total = this.photos.length;
    this.selectedPhoto.update(i => (i + 1) % total);
  }

  safeUrl(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  get isInfoMode(): boolean {
    const mode = this.proposal()?.proposal_mode;
    return !mode || mode === 'info';
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
}

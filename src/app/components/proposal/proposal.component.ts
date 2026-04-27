import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule, SlicePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-proposal',
  templateUrl: './proposal.component.html',
  styleUrl: './proposal.component.scss',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
})
export class ProposalComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);

  proposal = signal<any>(null);
  loading = signal(true);
  notFound = signal(false);
  selectedPhoto = signal(0);

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

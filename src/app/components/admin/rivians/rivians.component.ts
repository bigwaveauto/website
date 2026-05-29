import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

type SortMode = 'best-deal' | 'newest' | 'price-asc' | 'price-desc' | 'miles-asc';

@Component({
  selector: 'admin-rivians',
  templateUrl: './rivians.component.html',
  styleUrl: './rivians.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
})
export class AdminRiviansComponent implements OnInit {
  private http = inject(HttpClient);

  listings = signal<any[]>([]);
  loading = signal(true);
  expandedId = signal<number | null>(null);
  saving = signal<number | null>(null);
  bulkBusy = signal(false);

  // Selection (for bulk actions)
  selectedIds = signal<Set<number>>(new Set());
  // Listings whose photo failed to load — fall back to badge
  photoFailed = signal<Set<number>>(new Set());

  // View controls
  sortMode = signal<SortMode>('best-deal');
  showHidden = signal(false);

  // Filters
  search = signal('');
  modelFilter = signal('all');
  trimFilter = signal('all');
  batteryFilter = signal('all');
  sourceFilter = signal('all');
  maxPrice = signal<number | null>(null);
  maxMileage = signal<number | null>(null);
  colorFilter = signal('');

  // Listings after filters but before sort/hide-hidden — used for deal-score median baseline
  private matched = computed(() => {
    let list = this.listings();
    const q = this.search().toLowerCase().trim();
    const model = this.modelFilter();
    const trim = this.trimFilter();
    const battery = this.batteryFilter();
    const source = this.sourceFilter();
    const maxP = this.maxPrice();
    const maxM = this.maxMileage();
    const color = this.colorFilter().toLowerCase().trim();

    if (q) list = list.filter(l =>
      (l.vin || '').toLowerCase().includes(q) ||
      (l.model || '').toLowerCase().includes(q) ||
      (l.trim || '').toLowerCase().includes(q) ||
      (l.exterior_color || '').toLowerCase().includes(q) ||
      (l.description || '').toLowerCase().includes(q) ||
      (l.location || '').toLowerCase().includes(q)
    );
    if (model !== 'all') list = list.filter(l => l.model === model);
    if (trim !== 'all') list = list.filter(l => l.trim === trim);
    if (battery !== 'all') list = list.filter(l => l.battery === battery);
    if (source !== 'all') list = list.filter(l => (l.source || 'manheim') === source);
    if (maxP) list = list.filter(l => !l.asking_price || l.asking_price <= maxP);
    if (maxM) list = list.filter(l => !l.mileage || l.mileage <= maxM);
    if (color) list = list.filter(l => (l.exterior_color || '').toLowerCase().includes(color));

    return list;
  });

  // Median price keyed by `model|year-band` so deal score adapts to mix on screen.
  // Year band: groups adjacent years to get enough samples (2022–2023 = one bucket, 2024–2025 = another).
  private medianByBucket = computed(() => {
    const buckets: Record<string, number[]> = {};
    for (const l of this.matched()) {
      const p = l.asking_price || l.buy_now;
      if (!p || !l.model) continue;
      const key = this.bucketKey(l);
      (buckets[key] ||= []).push(p);
    }
    const medians: Record<string, number> = {};
    for (const [k, arr] of Object.entries(buckets)) {
      arr.sort((a, b) => a - b);
      const mid = Math.floor(arr.length / 2);
      medians[k] = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    }
    return medians;
  });

  // Duplicate detection — groups by (model, trim, year, mileage rounded to nearest 5k)
  private dupeGroups = computed(() => {
    const groups: Record<string, number> = {};
    for (const l of this.listings()) {
      const key = this.dupeKey(l);
      if (!key) continue;
      groups[key] = (groups[key] || 0) + 1;
    }
    return groups;
  });

  visible = computed(() => {
    let list = this.matched();
    if (!this.showHidden()) list = list.filter(l => l.status !== 'hidden');

    const mode = this.sortMode();
    const medians = this.medianByBucket();
    const decorated = list.map(l => ({ ...l, _deal: this.computeDealRatio(l, medians) }));

    switch (mode) {
      case 'best-deal':
        // Lower ratio = better deal. Items without a ratio sink to the bottom.
        decorated.sort((a, b) => {
          if (a._deal == null && b._deal == null) return 0;
          if (a._deal == null) return 1;
          if (b._deal == null) return -1;
          return a._deal - b._deal;
        });
        break;
      case 'newest':
        decorated.sort((a, b) => +new Date(b.created_at || 0) - +new Date(a.created_at || 0));
        break;
      case 'price-asc':
        decorated.sort((a, b) => (a.asking_price || 1e9) - (b.asking_price || 1e9));
        break;
      case 'price-desc':
        decorated.sort((a, b) => (b.asking_price || 0) - (a.asking_price || 0));
        break;
      case 'miles-asc':
        decorated.sort((a, b) => (a.mileage || 1e9) - (b.mileage || 1e9));
        break;
    }
    return decorated;
  });

  hiddenCount = computed(() => this.matched().filter(l => l.status === 'hidden').length);

  // Stats for the summary strip
  stats = computed(() => {
    const all = this.listings();
    const r1s = all.filter(l => l.model === 'R1S');
    const r1t = all.filter(l => l.model === 'R1T');
    const withLeads = all.filter(l => l.rivian_unlocks?.length).length;
    const avg = (arr: any[]) => {
      const prices = arr.map(l => l.asking_price).filter((p): p is number => typeof p === 'number' && p > 0);
      if (!prices.length) return null;
      return Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    };
    return {
      total: all.length,
      r1s: r1s.length, r1sAvg: avg(r1s),
      r1t: r1t.length, r1tAvg: avg(r1t),
      hidden: all.filter(l => l.status === 'hidden').length,
      withLeads,
    };
  });

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.http.get<any[]>('/api/admin/rivian').subscribe({
      next: (data) => {
        this.listings.set(data);
        this.loading.set(false);
        this.clearSelection();
      },
      error: () => this.loading.set(false),
    });
  }

  clearFilters() {
    this.search.set(''); this.modelFilter.set('all'); this.trimFilter.set('all');
    this.batteryFilter.set('all'); this.sourceFilter.set('all');
    this.maxPrice.set(null); this.maxMileage.set(null); this.colorFilter.set('');
  }

  get activeFilterCount() {
    let n = 0;
    if (this.search()) n++;
    if (this.modelFilter() !== 'all') n++;
    if (this.trimFilter() !== 'all') n++;
    if (this.batteryFilter() !== 'all') n++;
    if (this.sourceFilter() !== 'all') n++;
    if (this.maxPrice()) n++;
    if (this.maxMileage()) n++;
    if (this.colorFilter()) n++;
    return n;
  }

  // ── Bulk selection ──────────────────────────────────────────
  toggleSelect(id: number, event?: Event) {
    event?.stopPropagation();
    const next = new Set(this.selectedIds());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selectedIds.set(next);
  }
  isSelected(id: number) { return this.selectedIds().has(id); }
  selectAllVisible() {
    const ids = new Set(this.selectedIds());
    for (const l of this.visible()) ids.add(l.id);
    this.selectedIds.set(ids);
  }
  clearSelection() { this.selectedIds.set(new Set()); }
  selectedCount() { return this.selectedIds().size; }

  bulkAction(action: 'hide' | 'show' | 'delete') {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    if (action === 'delete' && !confirm(`Delete ${ids.length} listing${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;

    this.bulkBusy.set(true);
    this.http.post('/api/admin/rivian/bulk', { action, ids }).subscribe({
      next: () => {
        if (action === 'delete') {
          this.listings.update(list => list.filter(l => !ids.includes(l.id)));
        } else {
          const status = action === 'hide' ? 'hidden' : 'active';
          this.listings.update(list => list.map(l => ids.includes(l.id) ? { ...l, status } : l));
        }
        this.clearSelection();
        this.bulkBusy.set(false);
      },
      error: () => this.bulkBusy.set(false),
    });
  }

  // ── Per-listing actions ─────────────────────────────────────
  toggleStatus(listing: any, event?: Event) {
    event?.stopPropagation();
    const newStatus = listing.status === 'active' ? 'hidden' : 'active';
    this.http.patch(`/api/admin/rivian/${listing.id}`, { status: newStatus }).subscribe(() => {
      this.listings.update(list => list.map(l => l.id === listing.id ? { ...l, status: newStatus } : l));
    });
  }

  toggleExpand(id: number, event?: Event) {
    event?.stopPropagation();
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  saveNotes(listing: any) {
    this.saving.set(listing.id);
    this.http.patch(`/api/admin/rivian/${listing.id}`, { notes: listing.notes, asking_price: listing.asking_price }).subscribe(() => {
      this.saving.set(null);
    });
  }

  deleteListing(listing: any, event?: Event) {
    event?.stopPropagation();
    const label = this.title(listing);
    if (!confirm(`Delete ${label}?`)) return;
    this.http.delete(`/api/admin/rivian/${listing.id}`).subscribe(() => {
      this.listings.update(list => list.filter(l => l.id !== listing.id));
    });
  }

  onPhotoError(id: number) {
    const next = new Set(this.photoFailed());
    next.add(id);
    this.photoFailed.set(next);
  }
  hasPhoto(l: any) { return l.photos?.length && !this.photoFailed().has(l.id); }

  // ── Display helpers ─────────────────────────────────────────
  title(l: any) {
    const parts = [l.year, 'Rivian', l.model, l.trim].filter(Boolean);
    if (parts.length > 2) return parts.join(' ');
    if (l.description) return l.description.slice(0, 80);
    if (l.vin) return `Rivian ${l.model || ''} · ${l.vin}`;
    return `Rivian ${l.model || '(unknown)'}`;
  }

  modelBadgeColor(l: any) {
    // Distinct color per model for the photo-fallback badge
    return l.model === 'R1S' ? '#1e40af' : l.model === 'R1T' ? '#14532d' : '#475569';
  }

  sourceLabel(l: any) { return l.source === 'facebook' ? 'Facebook' : 'Manheim'; }
  sourceUrl(l: any) { return l.source_url || null; }
  leadCount(listing: any) { return listing.rivian_unlocks?.length || 0; }
  fmt(n: number | null | undefined) { return n ? '$' + n.toLocaleString() : '—'; }
  fmtMi(n: number | null | undefined) { return n ? n.toLocaleString() + ' mi' : '—'; }

  isNew(l: any) {
    if (!l.created_at) return false;
    const ageHr = (Date.now() - +new Date(l.created_at)) / 3600000;
    return ageHr < 24;
  }
  dupeCount(l: any) {
    const key = this.dupeKey(l);
    if (!key) return 0;
    return Math.max(0, (this.dupeGroups()[key] || 0) - 1);
  }

  dealBadge(l: any): { label: string; cls: string } | null {
    const ratio = l._deal;
    if (ratio == null) return null;
    if (ratio <= 0.85) return { label: 'Great deal', cls: 'deal-great' };
    if (ratio <= 0.93) return { label: 'Good price', cls: 'deal-good' };
    if (ratio >= 1.15) return { label: 'Over market', cls: 'deal-high' };
    return null;
  }

  changeSort(mode: SortMode) { this.sortMode.set(mode); }
  toggleShowHidden() { this.showHidden.set(!this.showHidden()); }

  trackById(_: number, l: any) { return l.id; }

  // ── Internal ────────────────────────────────────────────────
  private bucketKey(l: any) {
    if (!l.model || !l.year) return `${l.model || 'X'}|none`;
    // Group consecutive years to get enough samples
    const band = Math.floor((l.year - 2022) / 2);
    return `${l.model}|${band}`;
  }

  private dupeKey(l: any) {
    if (!l.model) return '';
    const mi5k = l.mileage ? Math.round(l.mileage / 5000) * 5000 : 'na';
    return `${l.model}|${l.year || 'X'}|${l.trim || 'X'}|${mi5k}`;
  }

  private computeDealRatio(l: any, medians: Record<string, number>): number | null {
    const price = l.asking_price || l.buy_now;
    if (!price) return null;
    const median = medians[this.bucketKey(l)];
    if (!median || median <= 0) return null;
    return price / median;
  }
}

import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

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

  // Filters
  search = signal('');
  modelFilter = signal('all');
  trimFilter = signal('all');
  batteryFilter = signal('all');
  sourceFilter = signal('all');
  maxPrice = signal<number | null>(null);
  maxMileage = signal<number | null>(null);
  colorFilter = signal('');

  filtered = computed(() => {
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
      (l.description || '').toLowerCase().includes(q)
    );
    if (model !== 'all') list = list.filter(l => l.model === model);
    if (trim !== 'all') list = list.filter(l => l.trim === trim);
    if (battery !== 'all') list = list.filter(l => l.battery === battery);
    if (source !== 'all') list = list.filter(l => (l.source || 'manheim') === source);
    if (maxP) list = list.filter(l => !l.asking_price || l.asking_price <= maxP);
    if (maxM) list = list.filter(l => !l.mileage || l.mileage <= maxM);
    if (color) list = list.filter(l => (l.exterior_color || '').toLowerCase().includes(color));

    return list.sort((a, b) => (a.asking_price || 999999) - (b.asking_price || 999999));
  });

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.http.get<any[]>('/api/admin/rivian').subscribe({
      next: (data) => { this.listings.set(data); this.loading.set(false); },
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

  toggleStatus(listing: any) {
    const newStatus = listing.status === 'active' ? 'hidden' : 'active';
    this.http.patch(`/api/admin/rivian/${listing.id}`, { status: newStatus }).subscribe(() => {
      this.listings.update(list => list.map(l => l.id === listing.id ? { ...l, status: newStatus } : l));
    });
  }

  toggleExpand(id: number) {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  saveNotes(listing: any) {
    this.saving.set(listing.id);
    this.http.patch(`/api/admin/rivian/${listing.id}`, { notes: listing.notes, asking_price: listing.asking_price }).subscribe(() => {
      this.saving.set(null);
    });
  }

  deleteListing(listing: any) {
    const label = `${listing.year || ''} Rivian ${listing.model || ''} ${listing.trim || ''}`.trim();
    if (!confirm(`Delete ${label}?`)) return;
    this.http.delete(`/api/admin/rivian/${listing.id}`).subscribe(() => {
      this.listings.update(list => list.filter(l => l.id !== listing.id));
    });
  }

  sourceLabel(l: any) { return l.source === 'facebook' ? 'Facebook' : 'Manheim'; }
  sourceUrl(l: any) { return l.source_url || null; }
  leadCount(listing: any) { return listing.rivian_unlocks?.length || 0; }
  fmt(n: number) { return n ? '$' + n.toLocaleString() : '—'; }
  fmtMi(n: number) { return n ? n.toLocaleString() + ' mi' : '—'; }
  trackById(_: number, l: any) { return l.id; }
}

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
  search = signal('');
  statusFilter = signal('all');
  expandedId = signal<number | null>(null);
  saving = signal<number | null>(null);

  filtered = computed(() => {
    let list = this.listings();
    const q = this.search().toLowerCase().trim();
    const status = this.statusFilter();

    if (q) list = list.filter(l =>
      (l.vin || '').toLowerCase().includes(q) ||
      (l.model || '').toLowerCase().includes(q) ||
      (l.trim || '').toLowerCase().includes(q) ||
      (l.exterior_color || '').toLowerCase().includes(q)
    );

    if (status !== 'all') list = list.filter(l => l.status === status);

    return list;
  });

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.http.get<any[]>('/api/admin/rivian').subscribe({
      next: (data) => { this.listings.set(data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
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
    const label = `${listing.year} Rivian ${listing.model} ${listing.trim || ''}`.trim();
    if (!confirm(`Delete ${label}?`)) return;
    this.http.delete(`/api/admin/rivian/${listing.id}`).subscribe(() => {
      this.listings.update(list => list.filter(l => l.id !== listing.id));
    });
  }

  leadCount(listing: any) { return listing.rivian_unlocks?.length || 0; }
  fmt(n: number) { return n ? '$' + n.toLocaleString() : '—'; }
  fmtMi(n: number) { return n ? n.toLocaleString() + ' mi' : '—'; }
  trackById(_: number, l: any) { return l.id; }
}

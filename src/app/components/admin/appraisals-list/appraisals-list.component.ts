import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'admin-appraisals-list',
  templateUrl: './appraisals-list.component.html',
  styleUrl: './appraisals-list.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink],
})
export class AdminAppraisalsListComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);

  appraisals = signal<any[]>([]);
  loading = signal(true);
  search = signal('');
  statusFilter = signal<string>('all');
  sortBy = signal<'date' | 'value' | 'vehicle'>('date');

  readonly statuses = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'purchased', label: 'Purchased' },
    { key: 'passed', label: 'Passed' },
  ];

  filtered = computed(() => {
    let list = this.appraisals();
    const q = this.search().toLowerCase();
    const s = this.statusFilter();
    const sort = this.sortBy();

    if (q) {
      list = list.filter(a => {
        const v = a.vehicle || {};
        return [v.year, v.make, v.model, v.trim, a.vin].join(' ').toLowerCase().includes(q);
      });
    }
    if (s !== 'all') {
      list = list.filter(a => a.status === s);
    }
    if (sort === 'date') {
      list = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (sort === 'value') {
      list = [...list].sort((a, b) => (b.appraised_value || 0) - (a.appraised_value || 0));
    } else if (sort === 'vehicle') {
      list = [...list].sort((a, b) => {
        const va = `${a.vehicle?.year} ${a.vehicle?.make} ${a.vehicle?.model}`;
        const vb = `${b.vehicle?.year} ${b.vehicle?.make} ${b.vehicle?.model}`;
        return va.localeCompare(vb);
      });
    }
    return list;
  });

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.http.get<any[]>('/api/admin/appraisals').subscribe({
      next: (data) => { this.appraisals.set(data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  openAppraisal(a: any) {
    // Navigate to appraisal tool with the record pre-loaded via query param
    this.router.navigate(['/admin/appraisal'], { queryParams: { id: a.id } });
  }

  deleteAppraisal(id: string, e: Event) {
    e.stopPropagation();
    if (!confirm('Delete this appraisal?')) return;
    this.http.delete(`/api/admin/appraisals/${id}`).subscribe({
      next: () => this.appraisals.update(list => list.filter(a => a.id !== id)),
    });
  }

  timeAgo(val: string): string {
    if (!val) return '';
    const diff = Date.now() - new Date(val).getTime();
    const days = Math.floor(diff / 86400000);
    if (days < 1) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}yr ago`;
  }

  pctOfMarket(a: any): number | null {
    if (!a.market_avg || !a.asking_price) return null;
    return Math.round((a.asking_price / a.market_avg) * 100);
  }

  profit(a: any): number {
    return (a.asking_price || 0) - (a.appraised_value || 0) - (a.recon || 0) - (a.transportation || 0) - (a.auction_fee || 0) - (a.other_cost || 0);
  }
}

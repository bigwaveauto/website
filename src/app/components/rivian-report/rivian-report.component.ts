import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

interface RivianListing {
  id: number;
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  mileage: number;
  buy_now: number;
  mmr: number;
  exterior_color: string;
  photos: string[];
  notes: string;
  asking_price: number;
  source_url: string;
}

const MINDSET_OPTIONS = [
  { value: 'browsing', label: 'Just browsing' },
  { value: 'research', label: 'Doing research' },
  { value: 'ready', label: 'Ready to buy soon' },
  { value: 'questions', label: 'Have more questions' },
];

@Component({
  selector: 'app-rivian-report',
  templateUrl: './rivian-report.component.html',
  styleUrl: './rivian-report.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule],
})
export class RivianReportComponent implements OnInit {
  private http = inject(HttpClient);

  listings = signal<RivianListing[]>([]);
  loading = signal(true);
  error = signal(false);

  modelFilter = signal('');
  maxMileage = signal(0);

  unlockOpen = signal(false);
  unlockListingId = signal<number | null>(null);
  unlockListingLabel = signal('');
  unlockSubmitting = signal(false);
  unlockDone = signal(false);
  unlockError = signal('');

  form = { name: '', email: '', phone: '', mindset: '' };
  readonly mindsetOptions = MINDSET_OPTIONS;

  unlockedIds = signal<Set<number>>(new Set());

  filtered = computed(() => {
    let list = this.listings();
    const model = this.modelFilter();
    const maxMi = this.maxMileage();
    if (model) list = list.filter(l => l.model === model || (l.trim || '').includes(model));
    if (maxMi > 0) list = list.filter(l => !l.mileage || l.mileage <= maxMi);
    return list;
  });

  models = computed(() => {
    const set = new Set(this.listings().map(l => l.model).filter(Boolean));
    return [...set].sort();
  });

  ngOnInit() {
    const stored = localStorage.getItem('rr_unlocked');
    if (stored) {
      try { this.unlockedIds.set(new Set(JSON.parse(stored))); } catch {}
    }
    this.http.get<RivianListing[]>('/api/rivian-report').subscribe({
      next: (data) => { this.listings.set(data); this.loading.set(false); },
      error: () => { this.loading.set(false); this.error.set(true); },
    });
  }

  isUnlocked(id: number) { return this.unlockedIds().has(id); }

  openUnlock(listing: RivianListing) {
    this.unlockListingId.set(listing.id);
    this.unlockListingLabel.set(`${listing.year} Rivian ${listing.model} ${listing.trim || ''}`.trim());
    this.unlockDone.set(false);
    this.unlockError.set('');
    this.form = { name: '', email: '', phone: '', mindset: '' };
    this.unlockOpen.set(true);
  }

  closeUnlock() { this.unlockOpen.set(false); }

  submitUnlock() {
    if (!this.form.name.trim() || !this.form.email.trim()) {
      this.unlockError.set('Name and email are required.');
      return;
    }
    this.unlockSubmitting.set(true);
    this.unlockError.set('');
    this.http.post('/api/rivian-report/unlock', {
      listing_id: this.unlockListingId(),
      ...this.form,
    }).subscribe({
      next: () => {
        this.unlockSubmitting.set(false);
        this.unlockDone.set(true);
        const current = new Set(this.unlockedIds());
        const id = this.unlockListingId();
        if (id != null) current.add(id);
        this.unlockedIds.set(current);
        localStorage.setItem('rr_unlocked', JSON.stringify([...current]));
        setTimeout(() => this.unlockOpen.set(false), 4000);
      },
      error: () => {
        this.unlockSubmitting.set(false);
        this.unlockError.set('Something went wrong — please try again.');
      },
    });
  }

  fmt(n: number) { return n ? '$' + n.toLocaleString() : '—'; }
  fmtMi(n: number) { return n ? n.toLocaleString() + ' mi' : '—'; }
}

import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
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

  proposals = signal<any[]>([]);
  loading = signal(true);
  selected = signal<any>(null);

  // Send form
  sendEmail = signal('');
  sendMessage = signal('');
  sending = signal(false);
  sent = signal(false);

  // Edit
  saving = signal(false);
  saved = signal(false);

  ngOnInit() {
    this.http.get<any[]>('/api/admin/proposals').subscribe({
      next: (data) => { this.proposals.set(data || []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  selectProposal(p: any) {
    this.selected.set({ ...p, excluded_fields: p.excluded_fields || [] });
    this.sent.set(false);
    this.saved.set(false);
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

  saveProposal() {
    const s = this.selected();
    if (!s) return;
    this.saving.set(true);
    this.http.post(`/api/admin/proposal/${s.id}`, {
      vehicle: s.vehicle,
      condition: s.condition,
      excluded_fields: s.excluded_fields,
      custom_notes: s.custom_notes,
      asking_price: s.asking_price,
      status: s.status,
    }).subscribe({
      next: () => { this.saving.set(false); this.saved.set(true); setTimeout(() => this.saved.set(false), 3000); },
      error: () => { this.saving.set(false); alert('Failed to save.'); },
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

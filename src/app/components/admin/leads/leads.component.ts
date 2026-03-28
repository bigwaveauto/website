import { Component, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

interface Lead {
  id: number;
  _type: string;
  _name: string;
  _email: string;
  _phone: string;
  status?: string;
  admin_notes?: string;
  created_at: string;
  // Financing
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  employment_status?: string;
  employer_name?: string;
  monthly_income?: string;
  coborrower?: boolean;
  // Trade-in
  year?: number;
  make?: string;
  model?: string;
  mileage?: number;
  condition?: string;
  vin?: string;
  // Test drive
  preferred_date?: string;
  preferred_time?: string;
  stock?: string;
  // Offer
  offer_amount?: number;
  listed_price?: number;
  financing?: string;
  // Contact
  topic?: string;
  preferred_method?: string;
  message?: string;
  notes?: string;
}

@Component({
  selector: 'admin-leads',
  templateUrl: './leads.component.html',
  styleUrl: './leads.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
})
export class AdminLeadsComponent implements OnInit {
  private http = inject(HttpClient);

  allLeads = signal<Lead[]>([]);
  leads = signal<Lead[]>([]);
  loading = signal(true);
  selectedType = signal('all');
  selectedStatus = signal('all');
  searchQuery = signal('');
  expandedId = signal<number | null>(null);
  savingNotes = signal(false);

  types = [
    { key: 'all',        label: 'All',         icon: 'inbox' },
    { key: 'contact',    label: 'Contact',     icon: 'mail' },
    { key: 'test-drive', label: 'Test Drives', icon: 'car' },
    { key: 'offer',      label: 'Offers',      icon: 'tag' },
    { key: 'financing',  label: 'Financing',   icon: 'landmark' },
    { key: 'trade-in',   label: 'Trade-Ins',   icon: 'refresh-cw' },
  ];

  statuses = [
    { key: 'all',          label: 'All' },
    { key: 'new',          label: 'New' },
    { key: 'contacted',    label: 'Contacted' },
    { key: 'in-progress',  label: 'In Progress' },
    { key: 'won',          label: 'Won' },
    { key: 'lost',         label: 'Lost' },
  ];

  readonly statusColors: Record<string, string> = {
    'new': 'blue',
    'contacted': 'teal',
    'in-progress': 'purple',
    'won': 'green',
    'lost': 'red',
  };

  ngOnInit() {
    this.loadLeads();
  }

  loadLeads() {
    this.loading.set(true);
    this.http.get<{ leads: Lead[] }>('/api/admin/leads?type=all').subscribe({
      next: (res) => {
        this.allLeads.set(res.leads);
        this.applyTypeFilter();
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  private applyTypeFilter() {
    const type = this.selectedType();
    if (type === 'all') {
      this.leads.set(this.allLeads());
    } else {
      this.leads.set(this.allLeads().filter(l => l._type === type));
    }
  }

  setType(key: string) {
    this.selectedType.set(key);
    this.expandedId.set(null);
    this.applyTypeFilter();
  }

  setStatus(key: string) {
    this.selectedStatus.set(key);
  }

  filteredLeads(): Lead[] {
    let list = this.leads();
    const status = this.selectedStatus();
    if (status !== 'all') {
      list = list.filter(l => (l.status || 'new') === status);
    }
    const q = this.searchQuery().toLowerCase().trim();
    if (q) {
      list = list.filter(l =>
        l._name.toLowerCase().includes(q) ||
        l._email.toLowerCase().includes(q) ||
        l._phone.includes(q) ||
        (l.vin && l.vin.toLowerCase().includes(q)) ||
        (l.make && l.make.toLowerCase().includes(q)) ||
        (l.model && l.model.toLowerCase().includes(q))
      );
    }
    return list;
  }

  toggleExpand(id: number) {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  typeLabel(type: string): string {
    return this.types.find(t => t.key === type)?.label || type;
  }

  typeIcon(type: string): string {
    return this.types.find(t => t.key === type)?.icon || 'inbox';
  }

  statusLabel(status: string): string {
    return this.statuses.find(s => s.key === status)?.label || status;
  }

  statusColor(status: string): string {
    return this.statusColors[status] || 'blue';
  }

  timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }

  updateStatus(lead: Lead, newStatus: string) {
    this.http.post(`/api/admin/leads/${lead._type}/${lead.id}/status`, { status: newStatus }).subscribe({
      next: () => { lead.status = newStatus; },
      error: () => { alert('Failed to update status'); },
    });
  }

  saveNotes(lead: Lead) {
    this.savingNotes.set(true);
    this.http.post(`/api/admin/leads/${lead._type}/${lead.id}/notes`, { admin_notes: lead.admin_notes }).subscribe({
      next: () => { this.savingNotes.set(false); },
      error: () => { this.savingNotes.set(false); alert('Failed to save notes'); },
    });
  }

  countByType(type: string): number {
    if (type === 'all') return this.allLeads().length;
    return this.allLeads().filter(l => l._type === type).length;
  }

  newCountByType(type: string): number {
    const list = type === 'all' ? this.allLeads() : this.allLeads().filter(l => l._type === type);
    return list.filter(l => !l.status || l.status === 'new').length;
  }

  newCount(): number {
    return this.allLeads().filter(l => !l.status || l.status === 'new').length;
  }
}

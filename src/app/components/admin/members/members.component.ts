import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

interface Member {
  id: string;
  email: string;
  fullName: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
  provider: string;
  createdAt: string;
  lastSignIn: string;
  leadCount: number;
}

interface MemberDetail {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string;
  provider: string;
  createdAt: string;
  lastSignIn: string;
  leads: any[];
}

@Component({
  selector: 'admin-members',
  templateUrl: './members.component.html',
  styleUrl: './members.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
})
export class AdminMembersComponent implements OnInit {
  private http = inject(HttpClient);

  members = signal<Member[]>([]);
  loading = signal(true);
  search = '';
  selectedMember = signal<MemberDetail | null>(null);
  detailLoading = signal(false);

  ngOnInit() {
    this.loadMembers();
  }

  loadMembers() {
    this.loading.set(true);
    this.http.get<{ total: number; members: Member[] }>('/api/admin/members').subscribe({
      next: (r) => { this.members.set(r.members); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  get filtered(): Member[] {
    const q = this.search.toLowerCase();
    if (!q) return this.members();
    return this.members().filter(m =>
      m.email.toLowerCase().includes(q) ||
      m.fullName.toLowerCase().includes(q) ||
      m.firstName.toLowerCase().includes(q) ||
      m.lastName.toLowerCase().includes(q)
    );
  }

  openDetail(m: Member) {
    this.detailLoading.set(true);
    this.selectedMember.set(null);
    this.http.get<MemberDetail>(`/api/admin/members/${m.id}`).subscribe({
      next: (d) => { this.selectedMember.set(d); this.detailLoading.set(false); },
      error: () => { this.detailLoading.set(false); },
    });
  }

  closeDetail() {
    this.selectedMember.set(null);
  }

  timeAgo(dateStr: string): string {
    if (!dateStr) return 'Never';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  leadTypeLabel(type: string): string {
    const map: Record<string, string> = {
      'financing': 'Financing',
      'offer': 'Offer',
      'test-drive': 'Test Drive',
      'trade-in': 'Trade-In',
      'contact': 'Contact',
    };
    return map[type] || type;
  }

  leadTypeIcon(type: string): string {
    const map: Record<string, string> = {
      'financing': 'landmark',
      'offer': 'tag',
      'test-drive': 'car',
      'trade-in': 'refresh-cw',
      'contact': 'mail',
    };
    return map[type] || 'mail';
  }
}

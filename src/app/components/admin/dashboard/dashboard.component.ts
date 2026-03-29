import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

interface InventoryAgeRow {
  label: string;
  count: number;
  pct: number;
  totalCost: number;
  totalPrice: number;
}

interface VautoStatus {
  dirExists: boolean;
  directory: string;
  fileCount: number;
  latestFile: string | null;
  latestModified: string | null;
  vehicleCount: number;
}

interface DashboardData {
  inventory: {
    ageRows: InventoryAgeRow[];
    totalVehicles: number;
    totalCost: number;
    totalPrice: number;
    avgMileage: number;
  };
  leads: {
    total: number;
    newToday: number;
    testDrives: number;
    offers: number;
    financing: number;
    tradeIns: number;
  };
  topSellers: { model: string; count: number }[];
}

@Component({
  selector: 'admin-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
})
export class DashboardComponent implements OnInit {
  private http = inject(HttpClient);
  readonly router = inject(Router);

  data = signal<DashboardData | null>(null);
  vauto = signal<VautoStatus | null>(null);
  loading = signal(true);
  selectedPeriod = signal('last_30');
  today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  periods = [
    { key: 'today', label: 'Today' },
    { key: 'last_7', label: 'Last 7 Days' },
    { key: 'last_30', label: 'Last 30 Days' },
    { key: 'last_60', label: 'Last 60 Days' },
    { key: 'last_90', label: 'Last 90 Days' },
    { key: 'last_365', label: 'Last 365 Days' },
  ];

  ngOnInit() {
    this.loadDashboard();
    this.loadVautoStatus();
  }

  loadDashboard() {
    this.loading.set(true);
    this.http.get<DashboardData>('/api/admin/dashboard').subscribe({
      next: (data) => { this.data.set(data); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  loadVautoStatus() {
    this.http.get<VautoStatus>('/api/admin/vauto/status').subscribe({
      next: (status) => this.vauto.set(status),
      error: () => {},
    });
  }

  vautoTimeAgo(): string {
    const v = this.vauto();
    if (!v?.latestModified) return '';
    const diff = Date.now() - new Date(v.latestModified).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  selectPeriod(key: string) {
    this.selectedPeriod.set(key);
  }
}

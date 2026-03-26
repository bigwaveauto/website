import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

interface InventoryAgeRow {
  label: string;
  count: number;
  pct: number;
  totalCost: number;
  totalPrice: number;
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

  data = signal<DashboardData | null>(null);
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
  }

  loadDashboard() {
    this.loading.set(true);
    this.http.get<DashboardData>('/api/admin/dashboard').subscribe({
      next: (data) => { this.data.set(data); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  selectPeriod(key: string) {
    this.selectedPeriod.set(key);
  }
}

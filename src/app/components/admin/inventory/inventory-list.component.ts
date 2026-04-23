import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

interface StageThreshold {
  stage: string;
  sort_order: number;
  yellow_days: number;
  red_days: number;
}

@Component({
  selector: 'admin-inventory-list',
  templateUrl: './inventory-list.component.html',
  styleUrl: './inventory-list.component.scss',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, LucideAngularModule],
})
export class AdminInventoryListComponent implements OnInit {
  private http = inject(HttpClient);

  vehicles = signal<any[]>([]);
  filtered = signal<any[]>([]);
  loading = signal(true);
  search = signal('');
  sortCol = signal('dateinstock');
  sortDir = signal<'asc' | 'desc'>('desc');
  stageFilter = signal('');

  stages = signal<Record<string, any>>({});
  thresholds = signal<StageThreshold[]>([]);

  stageList = [
    'At Auction — Won, Awaiting Pickup', 'In Transport', 'Arrived — Needs Intake',
    'In Mechanical', 'In Body/Paint', 'In Detail', 'In Photos',
    'Listed', 'Offered/Negotiating', 'Sold — Pending Delivery', 'Sold — Delivered',
  ];

  columns = [
    { key: 'stage', label: 'Stage', width: '140px' },
    { key: 'stageDays', label: 'Days', width: '50px' },
    { key: 'stocknumber', label: 'Stock #', width: '80px' },
    { key: 'year', label: 'Year', width: '45px' },
    { key: 'make', label: 'Make', width: '85px' },
    { key: 'model', label: 'Model', width: '80px' },
    { key: 'trim', label: 'Trim', width: '100px' },
    { key: 'daysinstock', label: 'Lot Days', width: '50px' },
    { key: 'mileage', label: 'Miles', width: '65px' },
    { key: 'exteriorcolorstandard', label: 'Ext', width: '75px' },
    { key: 'price', label: 'Ask', width: '85px' },
  ];

  ngOnInit() {
    let vautoVehicles: any[] = [];
    let supabaseVehicles: any[] = [];
    let loaded = 0;

    const merge = () => {
      loaded++;
      if (loaded < 2) return;

      const supaVins = new Set(supabaseVehicles.map(v => v.vin));
      const combined = [
        ...supabaseVehicles.map(v => ({
          ...v,
          stocknumber: v.stock_number,
          dateinstock: v.date_in_stock,
          price: v.asking_price,
          originalprice: v.purchase_price,
          exteriorcolorstandard: v.exterior_color,
          interiorcolorstandard: v.interior_color,
          daysinstock: v.date_in_stock
            ? Math.floor((Date.now() - new Date(v.date_in_stock).getTime()) / 86400000)
            : 0,
          _source: 'supabase',
        })),
        ...vautoVehicles
          .filter(v => !supaVins.has(v.vin))
          .map(v => ({
            ...v,
            daysinstock: v.age || (v.dateinstock
              ? Math.floor((Date.now() - new Date(v.dateinstock).getTime()) / 86400000)
              : 0),
            _source: 'vauto',
          })),
      ];
      this.vehicles.set(combined);
      this.applyFilter();
      this.loading.set(false);
    };

    // Load vehicles, stages, and thresholds in parallel
    this.http.get<any>('/api/admin/vauto/inventory').subscribe({
      next: (data) => { vautoVehicles = data?.results || []; merge(); },
      error: () => merge(),
    });

    this.http.get<any>('/api/admin/vehicles').subscribe({
      next: (data) => { supabaseVehicles = data || []; merge(); },
      error: () => merge(),
    });

    this.http.get<Record<string, any>>('/api/admin/stages/current').subscribe({
      next: (data) => { this.stages.set(data || {}); this.applyFilter(); },
    });

    this.http.get<StageThreshold[]>('/api/admin/stages/thresholds').subscribe({
      next: (data) => { this.thresholds.set(data || []); },
    });
  }

  getStage(vin: string): string {
    return this.stages()[vin]?.stage || '';
  }

  getStageDays(vin: string): number {
    const s = this.stages()[vin];
    if (!s) return 0;
    return Math.floor((Date.now() - new Date(s.entered_at).getTime()) / 86400000);
  }

  getStageAlert(vin: string): 'red' | 'yellow' | '' {
    const stage = this.getStage(vin);
    if (!stage) return '';
    const days = this.getStageDays(vin);
    const t = this.thresholds().find(th => th.stage === stage);
    if (!t || (t.yellow_days === 0 && t.red_days === 0)) return '';
    if (t.red_days > 0 && days >= t.red_days) return 'red';
    if (t.yellow_days > 0 && days >= t.yellow_days) return 'yellow';
    return '';
  }

  applyFilter() {
    const q = this.search().toLowerCase();
    const sf = this.stageFilter();
    let list = this.vehicles();

    if (q) {
      list = list.filter(v =>
        `${v.stocknumber} ${v.vin} ${v.year} ${v.make} ${v.model} ${v.trim}`.toLowerCase().includes(q)
      );
    }

    if (sf) {
      if (sf === '__none__') {
        list = list.filter(v => !this.getStage(v.vin));
      } else {
        list = list.filter(v => this.getStage(v.vin) === sf);
      }
    }

    // Sort — flagged cars (red, then yellow) first
    const col = this.sortCol();
    const dir = this.sortDir();
    list = [...list].sort((a, b) => {
      // Alert priority: red=2, yellow=1, none=0
      const alertPriority = (vin: string) => {
        const alert = this.getStageAlert(vin);
        return alert === 'red' ? 2 : alert === 'yellow' ? 1 : 0;
      };
      const ap = alertPriority(b.vin) - alertPriority(a.vin);
      if (ap !== 0) return ap;

      let av = col === 'stage' ? this.getStage(a.vin) : col === 'stageDays' ? this.getStageDays(a.vin) : a[col];
      let bv = col === 'stage' ? this.getStage(b.vin) : col === 'stageDays' ? this.getStageDays(b.vin) : b[col];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    this.filtered.set(list);
  }

  toggleSort(col: string) {
    if (this.sortCol() === col) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortCol.set(col);
      this.sortDir.set('asc');
    }
    this.applyFilter();
  }

  onSearch(val: string) {
    this.search.set(val);
    this.applyFilter();
  }

  onStageFilter(val: string) {
    this.stageFilter.set(val);
    this.applyFilter();
  }

  formatCurrency(val: number | null) {
    if (!val) return '$0';
    return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  formatNumber(val: any) {
    if (!val) return '0';
    return Number(val).toLocaleString('en-US');
  }

  shortStage(stage: string): string {
    const map: Record<string, string> = {
      'At Auction — Won, Awaiting Pickup': 'Auction Won',
      'In Transport': 'Transport',
      'Arrived — Needs Intake': 'Intake',
      'In Mechanical': 'Mechanical',
      'In Body/Paint': 'Body/Paint',
      'In Detail': 'Detail',
      'In Photos': 'Photos',
      'Listed': 'Listed',
      'Offered/Negotiating': 'Negotiating',
      'Sold — Pending Delivery': 'Sold (Pending)',
      'Sold — Delivered': 'Delivered',
    };
    return map[stage] || stage;
  }
}

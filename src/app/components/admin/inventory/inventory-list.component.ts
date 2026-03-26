import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

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

  columns = [
    { key: 'stocknumber', label: 'Stock #', width: '80px' },
    { key: 'vin', label: 'VIN', width: '145px' },
    { key: 'year', label: 'Year', width: '45px' },
    { key: 'make', label: 'Make', width: '85px' },
    { key: 'model', label: 'Model', width: '80px' },
    { key: 'trim', label: 'Trim', width: '100px' },
    { key: 'dateinstock', label: 'Stocked', width: '80px' },
    { key: 'daysinstock', label: 'Days', width: '40px' },
    { key: 'mileage', label: 'Miles', width: '65px' },
    { key: 'exteriorcolorstandard', label: 'Ext', width: '75px' },
    { key: 'interiorcolorstandard', label: 'Int', width: '75px' },
    { key: 'price', label: 'Ask', width: '85px' },
    { key: 'originalprice', label: 'Cost', width: '85px' },
  ];

  ngOnInit() {
    // Fetch from both Overfuel and Supabase, merge results
    let overfuelVehicles: any[] = [];
    let supabaseVehicles: any[] = [];
    let loaded = 0;

    const merge = () => {
      loaded++;
      if (loaded < 2) return;

      // Supabase vehicles keyed by VIN take priority
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
        ...overfuelVehicles
          .filter(v => !supaVins.has(v.vin))
          .map(v => ({
            ...v,
            daysinstock: v.dateinstock
              ? Math.floor((Date.now() - new Date(v.dateinstock).getTime()) / 86400000)
              : 0,
            _source: 'overfuel',
          })),
      ];
      this.vehicles.set(combined);
      this.applyFilter();
      this.loading.set(false);
    };

    this.http.get<any>('/api/dealers/1367/vehicles?rows=200').subscribe({
      next: (data) => { overfuelVehicles = data?.results || []; merge(); },
      error: () => merge(),
    });

    this.http.get<any>('/api/admin/vehicles').subscribe({
      next: (data) => { supabaseVehicles = data || []; merge(); },
      error: () => merge(),
    });
  }

  applyFilter() {
    const q = this.search().toLowerCase();
    let list = this.vehicles();
    if (q) {
      list = list.filter(v =>
        `${v.stocknumber} ${v.vin} ${v.year} ${v.make} ${v.model} ${v.trim}`.toLowerCase().includes(q)
      );
    }
    // Sort
    const col = this.sortCol();
    const dir = this.sortDir();
    list = [...list].sort((a, b) => {
      let av = a[col], bv = b[col];
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

  formatCurrency(val: number | null) {
    if (!val) return '$0.00';
    return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  formatNumber(val: any) {
    if (!val) return '0';
    return Number(val).toLocaleString('en-US');
  }
}

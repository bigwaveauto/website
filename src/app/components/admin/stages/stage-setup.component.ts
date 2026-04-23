import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

interface VehicleRow {
  vin: string;
  stocknumber: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  selectedStage: string;
}

@Component({
  selector: 'admin-stage-setup',
  templateUrl: './stage-setup.component.html',
  styleUrl: './stage-setup.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
})
export class StageSetupComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);

  vehicles = signal<VehicleRow[]>([]);
  loading = signal(true);
  saving = signal(false);
  saved = signal(false);

  stageList = [
    '', // no selection
    'At Auction — Won, Awaiting Pickup', 'In Transport', 'Arrived — Needs Intake',
    'In Mechanical', 'In Body/Paint', 'In Detail', 'In Photos',
    'Listed', 'Offered/Negotiating', 'Sold — Pending Delivery', 'Sold — Delivered',
  ];

  ngOnInit() {
    // Load vehicles from vAuto feed
    this.http.get<any>('/api/admin/vauto/inventory').subscribe({
      next: (data) => {
        const results = data?.results || [];
        const rows: VehicleRow[] = results.map((v: any) => ({
          vin: v.vin,
          stocknumber: v.stocknumber || '',
          year: v.year || '',
          make: v.make || '',
          model: v.model || '',
          trim: v.trim || '',
          selectedStage: '',
        }));
        this.vehicles.set(rows);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  setAll(stage: string) {
    this.vehicles.update(vs => vs.map(v => ({ ...v, selectedStage: stage })));
  }

  saveAll() {
    const assignments = this.vehicles()
      .filter(v => v.selectedStage)
      .map(v => ({ vin: v.vin, stage: v.selectedStage }));

    if (assignments.length === 0) { alert('No stages selected.'); return; }

    this.saving.set(true);
    this.http.post('/api/admin/stages/bulk', { assignments }).subscribe({
      next: () => {
        this.saved.set(true);
        this.saving.set(false);
        setTimeout(() => this.router.navigate(['/admin/inventory']), 1500);
      },
      error: () => { this.saving.set(false); alert('Failed to save stages.'); },
    });
  }

  get assignedCount(): number {
    return this.vehicles().filter(v => v.selectedStage).length;
  }
}

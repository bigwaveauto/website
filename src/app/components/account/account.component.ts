import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';

interface CustomerProposal {
  id: string;
  vin: string;
  vehicle: { year?: string | number; make?: string; model?: string; trim?: string } | null;
  asking_price: number | null;
  status: string | null;
  sent_at: string | null;
  created_at: string;
  photo: string | null;
  deal_group_id: string | null;
}

export interface GarageVehicleLoan {
  monthlyPayment: number | null;
  interestRate: number | null;
  remainingTermMonths: number | null;
}

export interface GarageVehicle {
  vin: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  mileage: number;
  condition: string;
  loan?: GarageVehicleLoan;
}

@Component({
  selector: 'app-account',
  templateUrl: './account.component.html',
  styleUrl: './account.component.scss',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, ReactiveFormsModule, HeaderComponent, FooterComponent],
})
export class AccountComponent implements OnInit {
  readonly auth = inject(AuthService);
  private route  = inject(ActivatedRoute);
  private fb     = inject(FormBuilder);
  private http   = inject(HttpClient);

  activeTab = 'proposals';
  tabs = [
    { id: 'proposals', label: 'My Proposals',    icon: 'file-text' },
    { id: 'requests',  label: 'Find My Car',     icon: 'search'    },
    { id: 'saved',     label: 'Saved Vehicles',  icon: 'heart'     },
    { id: 'searches',  label: 'Saved Searches',  icon: 'bell'      },
  ];

  // ── Proposals state ──
  proposals       = signal<CustomerProposal[]>([]);
  proposalsLoaded = signal(false);
  proposalsError  = signal<string | null>(null);

  // Garage state
  showAddForm    = signal(false);
  garageVehicles = signal<GarageVehicle[]>([]);
  addMode        = signal<'vin' | 'manual'>('vin');
  editIndex      = signal<number | null>(null);

  editForm: FormGroup = this.fb.group({
    year:               ['', Validators.required],
    make:               ['', Validators.required],
    model:              ['', Validators.required],
    trim:               [''],
    monthlyPayment:     [null],
    interestRate:       [null],
    remainingTermMonths:[null],
  });
  vinLoading     = signal(false);
  vinError       = signal('');
  vinDecoded     = signal<{ year: string; make: string; model: string; trim: string } | null>(null);

  garageForm: FormGroup = this.fb.group({
    vin:       ['', [Validators.minLength(17), Validators.maxLength(17), Validators.pattern(/^[A-HJ-NPR-Z0-9]{17}$/i)]],
    year:      [''],
    make:      [''],
    model:     [''],
    trim:      [''],
    mileage:   ['', [Validators.required, Validators.min(0)]],
    condition: ['good', Validators.required],
  });

  readonly years = Array.from({ length: new Date().getFullYear() - 1989 }, (_, i) => new Date().getFullYear() + 1 - i);

  readonly makes = [
    'Acura','Audi','BMW','Buick','Cadillac','Chevrolet','Chrysler','Dodge','Ford',
    'GMC','Honda','Hyundai','Infiniti','Jeep','Kia','Land Rover','Lexus','Lincoln',
    'Lucid','Mazda','Mercedes-Benz','Nissan','Polestar','Porsche','Ram','Rivian',
    'Subaru','Tesla','Toyota','Volkswagen','Volvo',
  ];

  readonly conditions = [
    { value: 'excellent', label: 'Excellent — Like new, no issues' },
    { value: 'good',      label: 'Good — Minor wear, well maintained' },
    { value: 'fair',      label: 'Fair — Visible wear, needs minor work' },
    { value: 'poor',      label: 'Poor — High mileage or damage' },
  ];

  decodeVin() {
    const vin = this.garageForm.get('vin')?.value?.trim().toUpperCase();
    if (!vin || vin.length !== 17) return;

    this.vinLoading.set(true);
    this.vinError.set('');
    this.vinDecoded.set(null);

    this.http.get<any>(`/api/vin/${vin}`).subscribe({
      next: (res) => {
        if (!res?.make || !res?.model) {
          this.vinError.set('Could not decode this VIN. Please check and try again.');
          this.vinLoading.set(false);
          return;
        }
        this.vinDecoded.set({ year: res.year, make: res.make, model: res.model, trim: res.trim });
        this.vinLoading.set(false);
      },
      error: () => {
        this.vinError.set('VIN lookup failed. Please try again.');
        this.vinLoading.set(false);
      },
    });
  }

  switchMode(mode: 'vin' | 'manual') {
    this.addMode.set(mode);
    this.vinDecoded.set(null);
    this.vinError.set('');
    this.garageForm.reset({ condition: 'good' });
  }

  addVehicle() {
    const form = this.garageForm.value;
    const mode = this.addMode();

    if (mode === 'vin') {
      if (!this.vinDecoded()) return;
      const decoded = this.vinDecoded()!;
      if (!form.mileage) return;
      this.garageVehicles.update(list => [...list, {
        vin: form.vin.toUpperCase(),
        mileage: form.mileage,
        condition: form.condition,
        ...decoded,
      }]);
    } else {
      if (!form.year || !form.make || !form.model || !form.mileage) return;
      this.garageVehicles.update(list => [...list, {
        vin: form.vin?.toUpperCase() || '',
        year: form.year,
        make: form.make,
        model: form.model,
        trim: form.trim || '',
        mileage: form.mileage,
        condition: form.condition,
      }]);
    }

    this.garageForm.reset({ condition: 'good' });
    this.vinDecoded.set(null);
    this.vinError.set('');
    this.showAddForm.set(false);
  }

  get canSubmit(): boolean {
    const form = this.garageForm.value;
    if (this.addMode() === 'vin') return !!this.vinDecoded() && !!form.mileage;
    return !!form.year && !!form.make && !!form.model && !!form.mileage;
  }

  removeVehicle(index: number) {
    this.garageVehicles.update(list => list.filter((_, i) => i !== index));
  }

  openEdit(index: number) {
    const v = this.garageVehicles()[index];
    this.editForm.patchValue({
      year:  v.year,
      make:  v.make,
      model: v.model,
      trim:  v.trim,
      monthlyPayment:      v.loan?.monthlyPayment ?? null,
      interestRate:        v.loan?.interestRate ?? null,
      remainingTermMonths: v.loan?.remainingTermMonths ?? null,
    });
    this.editIndex.set(index);
  }

  closeEdit() { this.editIndex.set(null); }

  saveEdit() {
    const idx = this.editIndex();
    if (idx === null || this.editForm.invalid) return;
    const f = this.editForm.value;
    this.garageVehicles.update(list => list.map((v, i) => i !== idx ? v : {
      ...v,
      year:  f.year,
      make:  f.make,
      model: f.model,
      trim:  f.trim,
      loan: {
        monthlyPayment:      f.monthlyPayment,
        interestRate:        f.interestRate,
        remainingTermMonths: f.remainingTermMonths,
      },
    }));
    this.closeEdit();
  }

  resetForm() {
    this.showAddForm.set(false);
    this.vinDecoded.set(null);
    this.vinError.set('');
    this.garageForm.reset({ condition: 'good' });
  }

  async loadProposals() {
    if (!this.auth.isLoggedIn()) return;
    this.proposalsError.set(null);
    try {
      const token = await this.auth.getAccessToken();
      if (!token) { this.proposalsError.set('Sign in to view your proposals.'); return; }
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
      const list = await firstValueFrom(this.http.get<CustomerProposal[]>('/api/customer/proposals', { headers }));
      this.proposals.set(list || []);
      this.proposalsLoaded.set(true);
    } catch (err: any) {
      this.proposalsError.set(err?.error?.error || 'Failed to load your proposals.');
      this.proposalsLoaded.set(true);
    }
  }

  proposalTitle(p: CustomerProposal): string {
    const v = p.vehicle || {};
    const parts = [v.year, v.make, v.model, v.trim].filter(Boolean).map(String);
    return parts.join(' ') || `Proposal ${p.id}`;
  }

  setActiveTab(id: string) {
    this.activeTab = id;
    // Lazy-load proposals the first time the tab is opened (or whenever the
    // user explicitly clicks it again — gives them a way to refresh).
    if (id === 'proposals') this.loadProposals();
  }

  ngOnInit() {
    if (!this.auth.isLoggedIn() && !this.auth.loading()) {
      this.auth.openAuthModal();
    }
    const allValidTabs = [...this.tabs.map(t => t.id), 'garage', 'settings'];
    this.route.queryParamMap.subscribe(params => {
      const tab = params.get('tab');
      if (tab && allValidTabs.includes(tab)) {
        this.activeTab = tab;
      }
    });

    // Auto-fetch proposals once on initial load if user is already signed in
    // (covers reload-while-logged-in; tab clicks handle the rest).
    if (this.auth.isLoggedIn()) this.loadProposals();
  }

}

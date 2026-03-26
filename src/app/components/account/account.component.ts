import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';

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

  activeTab = 'reservations';
  tabs = [
    { id: 'reservations', label: 'My Reservations', icon: 'list-checks' },
    { id: 'offers',       label: 'My Offers',       icon: 'tag'         },
    { id: 'saved',        label: 'Saved Vehicles',  icon: 'heart'       },
    { id: 'searches',     label: 'Saved Searches',  icon: 'bell'        },
  ];

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

    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`;
    this.http.get<any>(url).subscribe({
      next: (res) => {
        const r = res?.Results?.[0];
        const year  = r?.ModelYear || '';
        const make  = r?.Make || '';
        const model = r?.Model || '';
        const trim  = r?.Trim || r?.Series || '';

        if (!make || !model) {
          this.vinError.set('Could not decode this VIN. Please check and try again.');
          this.vinLoading.set(false);
          return;
        }
        this.vinDecoded.set({ year, make, model, trim });
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

  ngOnInit() {
    if (!this.auth.isLoggedIn() && !this.auth.loading()) {
      this.auth.openAuthModal();
    }
    const allValidTabs = [...this.tabs.map(t => t.id), 'garage', 'referral', 'wavecash', 'settings'];
    this.route.queryParamMap.subscribe(params => {
      const tab = params.get('tab');
      if (tab && allValidTabs.includes(tab)) {
        this.activeTab = tab;
      }
    });
  }

  shareReferral() {
    const url = 'https://bigwaveauto.com';
    const msg = `Check out Big Wave Auto at: ${url}`;
    if (navigator.share) {
      navigator.share({ title: 'Big Wave Auto', text: msg });
    } else {
      navigator.clipboard.writeText(msg);
      alert('Message copied to clipboard!');
    }
  }
}

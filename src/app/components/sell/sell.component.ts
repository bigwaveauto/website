import { Component, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';
import { RouterLink } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';

@Component({
  selector: 'app-sell',
  templateUrl: './sell.component.html',
  styleUrl: './sell.component.scss',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule, RouterLink, HeaderComponent, FooterComponent]
})
export class SellComponent implements OnInit {
  private http = inject(HttpClient);
  submitted  = signal(false);
  submitting = signal(false);

  // ── Business-configurable stats ─────────────────────────────────────────
  vehiclesPurchased = 200;   // update as inventory grows
  avgOffer          = '$18,400';
  // ────────────────────────────────────────────────────────────────────────

  // Hero VIN lookup
  heroVin        = signal('');
  heroVinLoading = signal(false);
  heroVinError   = signal('');
  heroVinDecoded = signal<{ year: string; make: string; model: string } | null>(null);

  // Make/Model dropdown data
  makes        = signal<string[]>([]);
  models       = signal<string[]>([]);
  loadingMakes = signal(false);
  loadingModels = signal(false);

  form: FormGroup;
  years      = Array.from({ length: 30 }, (_, i) => new Date().getFullYear() - i);
  conditions = ['Excellent', 'Good', 'Fair', 'Needs Work'];

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      year:      ['', Validators.required],
      make:      ['', Validators.required],
      model:     ['', Validators.required],
      mileage:   ['', Validators.required],
      condition: ['', Validators.required],
      vin:       [''],
      firstname: ['', Validators.required],
      lastname:  ['', Validators.required],
      email:     ['', [Validators.required, Validators.email]],
      phone:     ['', Validators.required],
      notes:     [''],
    });
  }

  ngOnInit() {
    this.loadMakes();

    // When year or make changes, reload models
    this.form.get('year')?.valueChanges.subscribe(() => {
      this.form.get('model')?.setValue('');
      this.loadModels();
    });
    this.form.get('make')?.valueChanges.subscribe(() => {
      this.form.get('model')?.setValue('');
      this.loadModels();
    });
  }

  private loadMakes() {
    this.loadingMakes.set(true);
    this.http.get<any>('https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car?format=json').subscribe({
      next: (res) => {
        const makes = (res?.Results || [])
          .map((m: any) => m.MakeName)
          .filter((n: string) => !!n)
          .sort();
        // Dedupe
        this.makes.set([...new Set<string>(makes)]);
        this.loadingMakes.set(false);
      },
      error: () => this.loadingMakes.set(false),
    });
  }

  private loadModels() {
    const year = this.form.get('year')?.value;
    const make = this.form.get('make')?.value;
    if (!year || !make) {
      this.models.set([]);
      return;
    }
    this.loadingModels.set(true);
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`;
    this.http.get<any>(url).subscribe({
      next: (res) => {
        const models = (res?.Results || [])
          .map((m: any) => m.Model_Name)
          .filter((n: string) => !!n)
          .sort();
        this.models.set([...new Set<string>(models)]);
        this.loadingModels.set(false);
      },
      error: () => this.loadingModels.set(false),
    });
  }

  decodeHeroVin() {
    const vin = this.heroVin().trim().toUpperCase();
    if (vin.length !== 17) return;
    this.heroVinLoading.set(true);
    this.heroVinError.set('');
    this.heroVinDecoded.set(null);
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`;
    this.http.get<any>(url).subscribe({
      next: (res) => {
        const r     = res?.Results?.[0];
        const year  = r?.ModelYear || '';
        const make  = r?.Make      || '';
        const model = r?.Model     || '';
        if (!make || !model) {
          this.heroVinError.set('Could not decode this VIN. Please check and try again.');
          this.heroVinLoading.set(false);
          return;
        }
        this.heroVinDecoded.set({ year, make, model });
        this.heroVinLoading.set(false);
      },
      error: () => {
        this.heroVinError.set('VIN lookup failed. Please try again.');
        this.heroVinLoading.set(false);
      },
    });
  }

  startWithVin() {
    const decoded = this.heroVinDecoded();
    if (!decoded) return;
    this.form.patchValue({
      vin:   this.heroVin().toUpperCase(),
      year:  decoded.year,
      make:  decoded.make,
      model: decoded.model,
    });
    document.getElementById('sell-form-anchor')?.scrollIntoView({ behavior: 'smooth' });
  }

  submit() {
    if (this.form.invalid || this.submitting()) return;
    this.submitting.set(true);
    this.http.post('/api/leads/trade-in', this.form.value).subscribe({
      next:  () => { this.submitted.set(true);  this.submitting.set(false); },
      error: () => { this.submitting.set(false); alert('Something went wrong. Please try again.'); },
    });
  }
}

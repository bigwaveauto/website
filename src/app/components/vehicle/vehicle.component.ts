import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatDividerModule } from '@angular/material/divider';
import { FlexLayoutModule } from 'ngx-flexible-layout';
import { ActivatedRoute, ParamMap, RouterLink, RouterOutlet } from '@angular/router';
import { CommonModule, SlicePipe, UpperCasePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, of, Subject, switchMap, takeUntil, tap } from 'rxjs';
import { VehicleService } from '../../services/vehicleSearch';
import { VehicleApiResponse } from '../../models/vehicleExtended';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';
import { AuthService } from '../../services/auth.service';
import { ReservationService } from '../../services/reservation.service';


@Component({
  selector: 'vehicle',
  templateUrl: './vehicle.component.html',
  styleUrl: './vehicle.component.scss',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    LucideAngularModule,
    MatButtonModule,
    MatToolbarModule,
    FlexLayoutModule,
    MatDividerModule,
    RouterLink,
    HeaderComponent,
    FooterComponent
  ],
  providers: [
    VehicleService
  ]
})
export class VehicleComponent implements OnInit, OnDestroy {
  readonly activatedRoute = inject(ActivatedRoute);
  readonly vehicleService = inject(VehicleService);
  readonly auth    = inject(AuthService);
  readonly reserve = inject(ReservationService);
  private http = inject(HttpClient);
  private fb   = inject(FormBuilder);

  fullVehicle = signal<VehicleApiResponse | null>(null);
  selectedPhotoIndex = signal(0);
  lightboxOpen = signal(false);
  singlePhotoOpen = signal(false);
  zoomLevel = signal(1);

  // Photo gallery categories
  galleryCategory = signal('All');
  galleryCategories = signal<{ key: string; count: number }[]>([]);
  photoCategories = signal<Record<number, string>>({});

  // ── Modal state ──
  testDriveOpen = signal(false);
  makeOfferOpen = signal(false);
  testDriveSubmitted = signal(false);
  makeOfferSubmitted = signal(false);
  testDriveSubmitting = signal(false);
  makeOfferSubmitting = signal(false);

  // ── Offer protection ──
  // Minimum acceptable offer as % of listed price (will be configurable from DMS)
  offerFloorPct = 0.75;
  offerTooLow = signal(false);

  testDriveForm: FormGroup = this.fb.group({
    firstname:      ['', Validators.required],
    lastname:       ['', Validators.required],
    email:          ['', [Validators.required, Validators.email]],
    phone:          ['', Validators.required],
    preferred_date: [''],
    preferred_time: [''],
    notes:          [''],
  });

  makeOfferForm: FormGroup = this.fb.group({
    firstname:    [''],
    lastname:     [''],
    email:        [''],
    phone:        [''],
    offer_amount: [''],
    financing:    ['undecided'],
    notes:        [''],
  });

  timeSlots = [
    '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
    '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM',
    '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM',
  ];

  openTestDrive() {
    this.testDriveOpen.set(true);
    this.testDriveSubmitted.set(false);
    this.testDriveForm.reset();
  }

  openMakeOffer() {
    this.offerTooLow.set(false);
    this.makeOfferOpen.set(true);
    this.makeOfferSubmitted.set(false);
    this.makeOfferForm.reset({ financing: 'undecided' });
  }

  closeTestDrive() { this.testDriveOpen.set(false); }
  closeMakeOffer() { this.makeOfferOpen.set(false); this.offerTooLow.set(false); }

  submitTestDrive() {
    if (this.testDriveForm.invalid || this.testDriveSubmitting()) return;
    this.testDriveSubmitting.set(true);
    const v = this.fullVehicle()?.results;
    const payload = {
      ...this.testDriveForm.value,
      vin: v?.vin, year: v?.year, make: v?.make, model: v?.model, stock: v?.stocknumber,
    };
    this.http.post('/api/leads/test-drive', payload).subscribe({
      next:  () => { this.testDriveSubmitted.set(true); this.testDriveSubmitting.set(false); },
      error: () => { this.testDriveSubmitting.set(false); alert('Something went wrong. Please try again.'); },
    });
  }

  submitMakeOffer() {
    if (this.makeOfferForm.invalid || this.makeOfferSubmitting()) return;

    const v = this.fullVehicle()?.results;
    const listedPrice = v?.price || 0;
    const offerAmount = Number(this.makeOfferForm.value.offer_amount);
    const floor = listedPrice * this.offerFloorPct;

    if (offerAmount < floor) {
      this.offerTooLow.set(true);
      return;
    }

    this.offerTooLow.set(false);
    this.makeOfferSubmitting.set(true);
    const payload = {
      ...this.makeOfferForm.value,
      vin: v?.vin, year: v?.year, make: v?.make, model: v?.model,
      stock: v?.stocknumber, listed_price: listedPrice,
    };
    this.http.post('/api/leads/make-offer', payload).subscribe({
      next:  () => { this.makeOfferSubmitted.set(true); this.makeOfferSubmitting.set(false); },
      error: () => { this.makeOfferSubmitting.set(false); alert('Something went wrong. Please try again.'); },
    });
  }

  selectGalleryPhoto(index: number) { this.selectedPhotoIndex.set(index); }

  openLightbox() {
    this.lightboxOpen.set(true);
    this.galleryCategory.set('All');
    this.buildPhotoCategories();
    setTimeout(() => document.querySelector<HTMLElement>('.vdp-lb')?.focus(), 50);
  }

  closeLightbox() { this.lightboxOpen.set(false); }

  openSinglePhoto(index: number) {
    this.selectedPhotoIndex.set(index);
    this.openLightbox();
  }

  prevPhoto(total: number) { this.selectedPhotoIndex.update(i => (i - 1 + total) % total); this.zoomLevel.set(1); }
  nextPhoto(total: number) { this.selectedPhotoIndex.update(i => (i + 1) % total); this.zoomLevel.set(1); }
  zoomIn() { this.zoomLevel.update(z => Math.min(z + 0.5, 3)); }
  zoomOut() { this.zoomLevel.update(z => Math.max(z - 0.5, 1)); }

  setGalleryCategory(cat: string) {
    this.galleryCategory.set(cat);
    // Select first photo in the new category
    if (cat === 'All') return;
    const cats = this.photoCategories();
    const first = Object.entries(cats).find(([_, c]) => c === cat);
    if (first) this.selectedPhotoIndex.set(Number(first[0]));
  }

  filteredPhotos(): { index: number; photo: any }[] {
    const v = this.fullVehicle()?.results;
    if (!v) return [];
    const cat = this.galleryCategory();
    const cats = this.photoCategories();
    return v.photos
      .map((photo: any, index: number) => ({ index, photo }))
      .filter(p => cat === 'All' || cats[p.index] === cat);
  }

  getPhotoCategory(index: number): string {
    return this.photoCategories()[index] || 'Exterior';
  }

  private buildPhotoCategories() {
    const v = this.fullVehicle()?.results;
    if (!v) return;
    const total = v.photos.length;
    const cats: Record<number, string> = {};

    // Check if API returned real categories
    const hasRealCats = v.photos.some((p: any) => p.category);

    if (hasRealCats) {
      // Use real categories from admin-assigned data
      for (let i = 0; i < total; i++) {
        cats[i] = v.photos[i].category || 'Exterior';
      }
    } else {
      // Auto-categorize by position — typical dealer photo order:
      // First ~55% exterior, next ~30% interior, last ~15% mechanical/other
      const extEnd = Math.ceil(total * 0.55);
      const intEnd = Math.ceil(total * 0.85);

      for (let i = 0; i < total; i++) {
        if (i < extEnd) cats[i] = 'Exterior';
        else if (i < intEnd) cats[i] = 'Interior';
        else cats[i] = 'Mechanical';
      }
    }

    this.photoCategories.set(cats);

    // Build category list with counts
    const counts: Record<string, number> = {};
    Object.values(cats).forEach(c => counts[c] = (counts[c] || 0) + 1);
    const order = ['All', 'Exterior', 'Interior', 'Mechanical', 'Damage', 'Miscellaneous'];
    const list = order
      .map(key => ({ key, count: key === 'All' ? total : (counts[key] || 0) }))
      .filter(c => c.count > 0);
    this.galleryCategories.set(list);
  }

  reserveVehicle(v: any) {
    if (!this.auth.isLoggedIn()) {
      this.auth.openAuthModal(v.vin);
      return;
    }
    this.reserve.open({ vin: v.vin, year: v.year, make: v.make, model: v.model, price: v.price });
  }

  detailsItems: any = [
    { displayName: 'Condition', datacol: 'condition' },
    { displayName: 'Body Type', datacol: 'body' },
    { displayName: 'Trim', datacol: 'trim' },
    { displayName: 'Stock #', datacol: 'stocknumber' },
    { displayName: 'VIN', datacol: 'vin' },
    { displayName: 'Exterior Color', datacol: 'exteriorcolorstandard' },
    { displayName: 'Interior Color', datacol: 'interiorcolorstandard' },
    { displayName: 'Passengers', datacol: 'seatingcapacity' },
    { displayName: 'Drivetrain', datacol: 'drivetrainstandard' },
    { displayName: 'Horsepower', datacol: 'maxhorsepower' },
    { displayName: 'Torque', datacol: 'maxtorque' },
    { displayName: 'Fuel Type', datacol: 'fuel' },
    { displayName: 'Fuel Capacity', datacol: 'fueltank' },
    { displayName: 'Transmission', datacol: 'transmissionstandard' },
    { displayName: 'Engine', datacol: 'engine' },
    { displayName: 'Cylinders', datacol: 'cylinders' },
    { displayName: 'Displacement', datacol: 'displacement' },
    { displayName: 'Wheelbase', datacol: 'wheelbase' },
    { displayName: 'Front Tire', datacol: 'fronttire' },
    { displayName: 'Rear Tire', datacol: 'reartire' },

  ]
  private destroy$ = new Subject<void>();


  ngOnInit() {
    this.activatedRoute.paramMap
      .pipe(takeUntil(this.destroy$), // Unsubscribe when component is destroyed
        switchMap((parammap: ParamMap) => {
          const vin = parammap.get('vin');
          if (vin) {
            return this.vehicleService.getVehicle(vin);
          }
          return of(null);
        })).subscribe((vehicle) => {
          this.selectedPhotoIndex.set(0);
          this.fullVehicle.set(vehicle);
        });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

import { Component, inject, OnDestroy, OnInit, signal, computed } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatDividerModule } from '@angular/material/divider';
import { FlexLayoutModule } from 'ngx-flexible-layout';
import { ActivatedRoute, ParamMap, RouterLink, RouterOutlet } from '@angular/router';
import { CommonModule, SlicePipe, UpperCasePipe } from '@angular/common';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
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
    FormsModule,
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
  offerFloorPct = 0.75;
  offerTooLow = signal(false);

  // ── Deal Calculator ──
  dealTab = signal<'cash' | 'finance'>('finance');
  dealDocFee = signal(299);
  dealTitleFee = signal(214.50);
  dealLicenseFee = signal(85);
  dealLienFee = signal(10);
  dealTaxRate = signal(5.43); // WI default
  dealZip = signal('53089');
  dealDownPayment = signal(0);
  dealTradeIn = signal(0);
  dealCreditTier = signal('good');
  dealTerm = signal(60);
  dealPlateTransfer = signal(false);
  dealTransport = signal(false);
  dealTransportMiles = signal(0);
  dealTransportRate = 1.00; // $/mile

  readonly creditTiers = [
    { key: 'excellent', label: 'Excellent', range: '750+', rate: 5.49 },
    { key: 'good', label: 'Good', range: '700–749', rate: 7.49 },
    { key: 'fair', label: 'Fair', range: '600–699', rate: 10.99 },
  ];

  readonly termOptions = [36, 48, 60, 72, 84];

  // WI county tax rates by zip prefix
  readonly zipTaxRates: Record<string, number> = {
    '530': 5.5, '531': 5.5, '532': 5.5, '534': 5.5, '535': 5.0,
    '537': 5.5, '538': 5.0, '539': 5.5, '540': 5.5, '541': 5.5,
    '542': 5.5, '543': 5.5, '544': 5.0, '545': 5.5, '546': 5.0,
    '547': 5.5, '548': 5.0, '549': 5.5,
  };

  get selectedRate(): number {
    return this.creditTiers.find(t => t.key === this.dealCreditTier())?.rate || 7.49;
  }

  get dealLicenseActual(): number {
    return this.dealPlateTransfer() ? 0 : this.dealLicenseFee();
  }

  get dealNonTaxFees(): number {
    return this.dealTitleFee() + this.dealLicenseActual +
      (this.dealTab() === 'finance' ? this.dealLienFee() : 0);
  }

  get dealTransportCost(): number {
    return this.dealTransport() ? this.dealTransportMiles() * this.dealTransportRate : 0;
  }

  get dealTaxableAmount(): number {
    const v = this.fullVehicle()?.results;
    return (v?.price || 0) + this.dealDocFee() + this.dealTransportCost;
  }

  get dealTaxAmount(): number {
    if (!this.isWisconsinZip) return 0;
    return this.dealTaxableAmount * (this.dealTaxRate() / 100);
  }

  get dealTotal(): number {
    if (!this.isWisconsinZip) {
      // Out-of-state: just purchase price + service fee
      return this.dealTaxableAmount;
    }
    return this.dealTaxableAmount + this.dealTaxAmount + this.dealNonTaxFees;
  }

  get dealAmountFinanced(): number {
    return Math.max(0, this.dealTotal - this.dealDownPayment() - this.dealTradeIn());
  }

  get dealMonthly(): number {
    const principal = this.dealAmountFinanced;
    const r = (this.selectedRate / 100) / 12;
    const n = this.dealTerm();
    if (r === 0) return principal / n;
    return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  }

  get isWisconsinZip(): boolean {
    const prefix = this.dealZip().substring(0, 3);
    return !!this.zipTaxRates[prefix];
  }

  onZipChange() {
    const zip = this.dealZip();
    const prefix = zip.substring(0, 3);
    const rate = this.zipTaxRates[prefix];
    if (rate) this.dealTaxRate.set(rate);
    // Estimate distance from Sussex, WI (53089) for transport
    if (zip.length === 5) this.estimateDistance(zip);
  }

  private estimateDistance(zip: string) {
    // Use the free ZIP code distance API
    const from = '53089';
    if (zip === from) { this.dealTransportMiles.set(0); return; }
    // Approximate using lat/lon lookup from ZIP prefix centroids
    // For now use a rough estimation based on ZIP prefix regions
    const fromLat = 43.17, fromLon = -88.22; // Sussex, WI
    const zipLats: Record<string, [number, number]> = {
      '530': [43.0, -89.4], '531': [42.7, -87.8], '532': [42.6, -88.6], '534': [44.5, -88.0],
      '535': [43.8, -89.8], '537': [43.1, -89.4], '538': [43.8, -91.2], '539': [44.9, -89.6],
      '540': [44.5, -88.0], '541': [45.0, -87.6], '542': [44.3, -90.1], '543': [46.7, -92.1],
      '544': [44.8, -91.5], '545': [44.9, -89.6], '546': [46.0, -89.5], '547': [45.8, -88.1],
      '548': [43.3, -90.9], '549': [45.6, -89.4],
      // Major US metro areas
      '100': [40.7, -74.0], '101': [40.7, -74.0], '606': [41.9, -87.6], '600': [41.9, -87.6],
      '900': [34.1, -118.2], '330': [25.8, -80.2], '770': [29.8, -95.4], '852': [33.4, -112.0],
      '802': [39.7, -105.0], '981': [47.6, -122.3], '303': [33.7, -84.4], '021': [42.4, -71.1],
      '481': [42.3, -83.0], '553': [44.9, -93.3], '631': [38.6, -90.2], '462': [39.8, -86.2],
      '432': [40.0, -83.0], '372': [36.2, -86.8], '278': [35.8, -78.6], '231': [36.8, -76.0],
      '191': [40.0, -75.2], '850': [33.4, -112.0], '787': [30.3, -97.7], '801': [39.7, -105.0],
      '641': [41.6, -93.6], '681': [41.3, -96.0], '672': [39.1, -94.6], '402': [38.3, -85.8],
    };
    const prefix = zip.substring(0, 3);
    const dest = zipLats[prefix];
    if (!dest) {
      // Very rough: use first digit for general region distance
      const regionMiles: Record<string, number> = {
        '0': 1000, '1': 850, '2': 800, '3': 900, '4': 500,
        '5': 300, '6': 200, '7': 1000, '8': 1400, '9': 1800,
      };
      this.dealTransportMiles.set(regionMiles[zip[0]] || 500);
      return;
    }
    // Haversine distance
    const R = 3959; // miles
    const dLat = (dest[0] - fromLat) * Math.PI / 180;
    const dLon = (dest[1] - fromLon) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(fromLat*Math.PI/180) * Math.cos(dest[0]*Math.PI/180) * Math.sin(dLon/2)**2;
    const miles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    this.dealTransportMiles.set(Math.round(miles * 1.2)); // 1.2x for road vs straight-line
  }

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

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
  openLightbox() { this.lightboxOpen.set(true); }
  closeLightbox() { this.lightboxOpen.set(false); this.singlePhotoOpen.set(false); }
  openSinglePhoto(index: number) { this.selectedPhotoIndex.set(index); this.singlePhotoOpen.set(true); this.zoomLevel.set(1); }
  closeSinglePhoto() { this.singlePhotoOpen.set(false); }
  prevPhoto(total: number) { this.selectedPhotoIndex.update(i => (i - 1 + total) % total); this.zoomLevel.set(1); }
  nextPhoto(total: number) { this.selectedPhotoIndex.update(i => (i + 1) % total); this.zoomLevel.set(1); }
  zoomIn() { this.zoomLevel.update(z => Math.min(z + 0.5, 3)); }
  zoomOut() { this.zoomLevel.update(z => Math.max(z - 0.5, 1)); }

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

import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatDividerModule } from '@angular/material/divider';
import { FlexLayoutModule } from 'ngx-flexible-layout';
import { ActivatedRoute, ParamMap, RouterLink, RouterOutlet } from '@angular/router';
import { CommonModule, SlicePipe, UpperCasePipe } from '@angular/common';
import { BehaviorSubject, of, Subject, switchMap, takeUntil, tap } from 'rxjs';
import { VehicleService } from '../../services/vehicleSearch';
import { VehicleApiResponse } from '../../models/vehicleExtended';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';


@Component({
  selector: 'vehicle',
  templateUrl: './vehicle.component.html',
  styleUrl: './vehicle.component.scss',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
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
  fullVehicle = signal<VehicleApiResponse | null>(null);
  selectedPhotoIndex = signal(0);
  lightboxOpen = signal(false);

  selectPhoto(index: number) { this.selectedPhotoIndex.set(index); }
  prevPhoto(total: number) { this.selectedPhotoIndex.update(i => (i - 1 + total) % total); }
  nextPhoto(total: number) { this.selectedPhotoIndex.update(i => (i + 1) % total); }
  openLightbox(index: number) { this.selectedPhotoIndex.set(index); this.lightboxOpen.set(true); }
  closeLightbox() { this.lightboxOpen.set(false); }

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

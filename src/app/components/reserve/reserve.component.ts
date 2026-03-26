import { Component, inject, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ReservationService } from '../../services/reservation.service';
import { VehicleService } from '../../services/vehicleSearch';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';

@Component({
  selector: 'app-reserve',
  standalone: true,
  imports: [HeaderComponent, FooterComponent],
  providers: [VehicleService],
  template: `
    <header></header>
    <div style="display:flex;align-items:center;justify-content:center;min-height:60vh;color:#555;font-size:15px">
      <span>Loading…</span>
    </div>
    <footer></footer>
  `,
})
export class ReserveComponent implements OnInit {
  private route      = inject(ActivatedRoute);
  private router     = inject(Router);
  private auth       = inject(AuthService);
  private reserve    = inject(ReservationService);
  private vehicles   = inject(VehicleService);
  private platformId = inject(PLATFORM_ID);

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;
    const vin = this.route.snapshot.paramMap.get('vin');
    if (!vin) { this.router.navigate(['/']); return; }

    if (!this.auth.isLoggedIn()) {
      this.auth.openAuthModal(vin);
      this.router.navigate(['/showroom', vin]);
      return;
    }

    this.vehicles.getVehicle(vin).subscribe({
      next: (res) => {
        const v = res?.results;
        if (!v) { this.router.navigate(['/showroom', vin]); return; }
        this.reserve.open({ vin: v.vin, year: v.year, make: v.make, model: v.model, price: v.price });
        this.router.navigate(['/showroom', vin]);
      },
      error: () => this.router.navigate(['/showroom', vin]),
    });
  }
}

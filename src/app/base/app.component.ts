import { Component, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FlexLayoutModule } from 'ngx-flexible-layout';
import { CommonModule } from '@angular/common';
import { FlexLayoutServerModule } from 'ngx-flexible-layout/server';
import { RouterOutlet } from '@angular/router';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../services/auth.service';
import { AuthModalComponent } from '../components/auth-modal/auth-modal.component';
import { ReservationPanelComponent } from '../components/reservation-panel/reservation-panel.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  host: { style: 'flex: 1;overflow:hidden' },
  standalone: true,
  imports: [
    FlexLayoutServerModule,
    FlexLayoutModule,
    CommonModule,
    RouterOutlet,
    MatSelectModule,
    MatIconModule,
    MatButtonModule,
    AuthModalComponent,
    ReservationPanelComponent,
  ]
})
export class AppComponent {
  private auth       = inject(AuthService);
  private platformId = inject(PLATFORM_ID);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.auth.initAuth();
    }
  }
}

import { Component, inject, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;color:#555;font-size:15px;font-family:inherit">
      <mat-icon style="font-size:36px;width:36px;height:36px;animation:spin 1s linear infinite">autorenew</mat-icon>
      <span>Signing you in…</span>
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `,
})
export class AuthCallbackComponent implements OnInit {
  private auth       = inject(AuthService);
  private router     = inject(Router);
  private platformId = inject(PLATFORM_ID);

  async ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;
    await this.auth.handleOAuthCallback();
    const vin = sessionStorage.getItem('reserve_vin');
    const returnTo = sessionStorage.getItem('auth_return_to');
    sessionStorage.removeItem('reserve_vin');
    sessionStorage.removeItem('auth_return_to');
    if (vin) this.router.navigate(['/reserve', vin]);
    else if (returnTo) this.router.navigate([returnTo]);
    else this.router.navigate(['/']);
  }
}

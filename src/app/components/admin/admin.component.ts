import { Component, signal, inject, OnInit, PLATFORM_ID, ChangeDetectorRef, afterNextRender } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-admin',
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
  standalone: true,
  host: { ngSkipHydration: 'true' },
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, LucideAngularModule],
})
export class AdminComponent implements OnInit {
  readonly auth = inject(AuthService);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);

  // Whitelisted admin emails — add your team members here
  readonly adminEmails = ['dave@bigwaveauto.com', 'dlucas589@gmail.com'];

  authorized = signal(false);
  checking = signal(true);

  navItems = [
    { label: 'Home',       icon: 'home',        route: '/admin' },
    { label: 'Add Vehicle', icon: 'plus',       route: '/admin/intake' },
    { label: 'Inventory',  icon: 'car',         route: '/admin/inventory' },
    { label: 'Leads',      icon: 'users',       route: '/admin/customers' },
    { label: 'Settings',   icon: 'settings',    route: '/admin/settings' },
  ];

  loginError = signal('');

  constructor() {
    afterNextRender(async () => {
      // Wait for auth to initialize (max 5s)
      for (let i = 0; i < 50; i++) {
        if (!this.auth.loading()) break;
        await new Promise(r => setTimeout(r, 100));
      }
      this.checkAccess();
      this.cdr.markForCheck();
    });
  }

  ngOnInit() {}

  private checkAccess() {
    const email = this.auth.user()?.email?.toLowerCase();
    if (email && this.adminEmails.includes(email)) {
      this.authorized.set(true);
      this.loginError.set('');
    } else if (email) {
      // Logged in but not authorized
      this.authorized.set(false);
      this.loginError.set(`${email} is not authorized for admin access.`);
    } else {
      this.authorized.set(false);
    }
    this.checking.set(false);
  }

  async adminSignIn() {
    this.loginError.set('');
    // Pass return path via the OAuth redirect URL
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    await this.auth.signInWithGoogleTo(`${origin}/auth/callback?returnTo=/admin`);
  }

  async adminSignOut() {
    await this.auth.signOut();
    this.authorized.set(false);
    this.checking.set(false);
  }
}

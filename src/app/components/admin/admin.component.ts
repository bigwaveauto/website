import { Component, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-admin',
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, LucideAngularModule],
})
export class AdminComponent implements OnInit {
  readonly auth = inject(AuthService);
  private router = inject(Router);

  // Whitelisted admin emails — add your team members here
  readonly adminEmails = ['dave@bigwaveauto.com', 'dlucas589@gmail.com'];

  authorized = signal(false);
  checking = signal(true);

  navItems = [
    { label: 'Home',       icon: 'home',        route: '/admin' },
    { label: 'Add Vehicle', icon: 'plus',       route: '/admin/intake' },
    { label: 'Reports',    icon: 'file-text',   route: '/admin/reports' },
    { label: 'Inventory',  icon: 'car',         route: '/admin/inventory' },
    { label: 'Customer',   icon: 'users',       route: '/admin/customers' },
    { label: 'Deal',       icon: 'list-checks', route: '/admin/deals' },
    { label: 'Marketing',  icon: 'tag',         route: '/admin/marketing' },
    { label: 'Accounting', icon: 'landmark',    route: '/admin/accounting' },
    { label: 'Settings',   icon: 'settings',    route: '/admin/settings' },
  ];

  async ngOnInit() {
    // Wait for auth to initialize
    await new Promise<void>(resolve => {
      const check = () => {
        if (!this.auth.loading()) { resolve(); return; }
        setTimeout(check, 100);
      };
      check();
    });

    const email = this.auth.user()?.email?.toLowerCase();
    console.log('[Admin] Auth check — email:', email, '| logged in:', this.auth.isLoggedIn());
    if (email && this.adminEmails.includes(email)) {
      this.authorized.set(true);
    } else {
      this.authorized.set(false);
    }
    this.checking.set(false);
  }
}

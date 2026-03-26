import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'footer',
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink]
})
export class FooterComponent {
  currentYear = new Date().getFullYear();

  quickLinks = [
    { name: 'Home', route: '/' },
    { name: 'Available Inventory', route: '/showroom' },
    { name: 'Financing', route: '/financing' },
    { name: 'Sell / Trade-In', route: '/sell' },
    { name: 'About Us', route: '/about' },
  ];
}

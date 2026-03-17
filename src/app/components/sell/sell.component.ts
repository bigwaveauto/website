import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';

@Component({
  selector: 'app-sell',
  templateUrl: './sell.component.html',
  styleUrl: './sell.component.scss',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatIconModule, RouterLink, HeaderComponent, FooterComponent]
})
export class SellComponent {
  submitted = signal(false);

  steps = [
    { number: 1, icon: 'directions_car', title: 'Tell us about your vehicle', desc: 'Enter your VIN or license plate, or fill in the year, make, model, and mileage manually.' },
    { number: 2, icon: 'photo_camera', title: 'Share the details', desc: 'Describe your vehicle\'s condition and any standout features. The more we know, the better the offer.' },
    { number: 3, icon: 'local_offer', title: 'Get your offer', desc: 'Our team reviews your info and reaches out with a competitive, no-pressure offer. No obligations.' },
  ];

  reasons = [
    { icon: 'payments', title: 'Fair Market Value', desc: 'We research current market conditions to give you a competitive offer — no low-balling.' },
    { icon: 'schedule', title: 'Fast Process', desc: 'From submission to offer, we move quickly. Most customers hear back within 1 business day.' },
    { icon: 'handshake', title: 'No Dealer Fees', desc: 'What we offer is what you get. No hidden fees, no commissions, no surprises.' },
    { icon: 'swap_horiz', title: 'Trade-In Welcome', desc: 'Apply your vehicle\'s value directly toward a purchase from our inventory and simplify the transaction.' },
  ];

  form: FormGroup;

  years = Array.from({ length: 30 }, (_, i) => new Date().getFullYear() - i);

  conditions = ['Excellent', 'Good', 'Fair', 'Needs Work'];

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      year:       ['', Validators.required],
      make:       ['', Validators.required],
      model:      ['', Validators.required],
      mileage:    ['', Validators.required],
      condition:  ['', Validators.required],
      vin:        [''],
      firstname:  ['', Validators.required],
      lastname:   ['', Validators.required],
      email:      ['', [Validators.required, Validators.email]],
      phone:      ['', Validators.required],
      notes:      [''],
    });
  }

  submit() {
    if (this.form.valid) {
      this.submitted.set(true);
    }
  }
}

import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';

@Component({
  selector: 'app-financing',
  templateUrl: './financing.component.html',
  styleUrl: './financing.component.scss',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatIconModule, RouterLink, HeaderComponent, FooterComponent]
})
export class FinancingComponent {
  step = signal(1);
  totalSteps = 4;
  submitted = signal(false);
  coborrower = signal(false);

  steps = [
    { number: 1, label: 'Contact Information' },
    { number: 2, label: 'Current Address' },
    { number: 3, label: 'Employment Information' },
    { number: 4, label: 'Consent & Verification' },
  ];

  benefits = [
    { icon: 'check_circle', title: 'Know Your Auto Loan Terms', desc: 'We take the time to explain everything—APR, loan terms, down payments, and monthly payments—so you can make an informed choice with confidence.' },
    { icon: 'speed', title: 'Get In A Car Fast', desc: 'Apply online in minutes and get pre-approved before you visit. Our quick approval process is designed to save you time and get you behind the wheel faster.' },
    { icon: 'handshake', title: 'Car Loans Made Simple', desc: 'Our finance specialists handle all the details, working with trusted lenders to find competitive rates and flexible terms—even if your credit isn\'t perfect.' },
    { icon: 'directions_car', title: 'Buy The Car For You', desc: 'From reliable sedans and SUVs to powerful trucks, our wide selection of used vehicles ensures you\'ll find the right fit—with financing that matches your lifestyle.' },
    { icon: 'verified', title: 'Easy Auto Financing', desc: 'Whether you have great credit, challenged credit, or no credit at all, Big Wave Auto works hard to find a financing solution that makes sense for you.' },
    { icon: 'location_on', title: 'Apply & Drive Near You', desc: 'Located in Sussex, WI, Big Wave Auto proudly serves drivers from Milwaukee, Waukesha, Menomonee Falls, Brookfield, and surrounding Wisconsin communities.' },
  ];

  contactForm: FormGroup;
  addressForm: FormGroup;
  employmentForm: FormGroup;
  consentForm: FormGroup;

  constructor(private fb: FormBuilder) {
    this.contactForm = this.fb.group({
      firstname: ['', Validators.required],
      lastname: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', Validators.required],
      dob: ['', Validators.required],
    });

    this.addressForm = this.fb.group({
      street: ['', Validators.required],
      city: ['', Validators.required],
      state: ['', Validators.required],
      zip: ['', Validators.required],
      yearsAtAddress: ['', Validators.required],
      housingStatus: ['', Validators.required],
    });

    this.employmentForm = this.fb.group({
      employerName: ['', Validators.required],
      employmentStatus: ['', Validators.required],
      monthlyIncome: ['', Validators.required],
      yearsEmployed: ['', Validators.required],
    });

    this.consentForm = this.fb.group({
      agreeTerms: [false, Validators.requiredTrue],
      agreeCreditCheck: [false, Validators.requiredTrue],
    });
  }

  selectBorrower(withCo: boolean) {
    this.coborrower.set(withCo);
    this.nextStep();
  }

  nextStep() {
    if (this.step() < this.totalSteps) {
      this.step.update(s => s + 1);
    }
  }

  prevStep() {
    if (this.step() > 1) {
      this.step.update(s => s - 1);
    }
  }

  submitForm() {
    this.submitted.set(true);
  }

  currentStepValid(): boolean {
    switch (this.step()) {
      case 1: return this.contactForm.valid;
      case 2: return this.addressForm.valid;
      case 3: return this.employmentForm.valid;
      case 4: return this.consentForm.valid;
      default: return false;
    }
  }
}

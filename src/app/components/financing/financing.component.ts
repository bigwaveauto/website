import { Component, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';

@Component({
  selector: 'app-financing',
  templateUrl: './financing.component.html',
  styleUrl: './financing.component.scss',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule, RouterLink, HeaderComponent, FooterComponent]
})
export class FinancingComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  lowestRate = '4.99%';
  lowestRateTerm = '60-month term';
  private buyerId = '';

  ngOnInit() {
    this.buyerId = this.route.snapshot.queryParamMap.get('buyerId') || '';
    this.http.get<any>('/api/settings/finance').subscribe({
      next: (s) => {
        if (s.lowestRate) this.lowestRate = s.lowestRate;
        if (s.lowestRateTerm) this.lowestRateTerm = s.lowestRateTerm;
      },
      error: () => {},
    });
  }

  step = signal(1);
  submitted = signal(false);
  submitting = signal(false);
  coborrower = signal(false);

  get consentStep() { return this.coborrower() ? 7 : 4; }
  get totalSteps() { return this.consentStep; }

  get dynamicSteps() {
    const base = [
      { number: 1, label: 'Contact Info' },
      { number: 2, label: 'Address' },
      { number: 3, label: 'Employment' },
    ];
    if (this.coborrower()) {
      base.push(
        { number: 4, label: 'Co-Borrower' },
        { number: 5, label: 'Co-Borrower Addr.' },
        { number: 6, label: 'Co-Borrower Emp.' },
        { number: 7, label: 'Consent' },
      );
    } else {
      base.push({ number: 4, label: 'Consent' });
    }
    return base;
  }

  // ── Primary Borrower Forms ──
  contactForm: FormGroup;
  addressForm: FormGroup;
  employmentForm: FormGroup;

  // ── Co-Borrower Forms ──
  coContactForm: FormGroup;
  coAddressForm: FormGroup;
  coEmploymentForm: FormGroup;

  // ── Consent ──
  consentForm: FormGroup;

  // Helpers for conditional previous sections
  get needsPrevAddress(): boolean {
    const y = Number(this.addressForm.get('addressYears')?.value);
    return !isNaN(y) && y < 2;
  }

  get needsPrevEmployer(): boolean {
    const y = Number(this.employmentForm.get('employmentYears')?.value);
    return !isNaN(y) && y < 2;
  }

  get coNeedsPrevAddress(): boolean {
    const y = Number(this.coAddressForm.get('addressYears')?.value);
    return !isNaN(y) && y < 2;
  }

  get coNeedsPrevEmployer(): boolean {
    const y = Number(this.coEmploymentForm.get('employmentYears')?.value);
    return !isNaN(y) && y < 2;
  }

  constructor(private fb: FormBuilder) {
    this.contactForm = this.fb.group({
      firstname: ['', Validators.required],
      lastname: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', Validators.required],
      dob: ['', Validators.required],
      ssn: ['', Validators.required],
    });

    this.addressForm = this.fb.group({
      street: ['', Validators.required],
      city: ['', Validators.required],
      state: ['', Validators.required],
      zip: ['', Validators.required],
      county: [''],
      addressYears: ['', Validators.required],
      addressMonths: ['0'],
      housingStatus: ['', Validators.required],
      rentMortgageAmount: [''],
      // Previous address (shown when < 2 years at current)
      prevStreet: [''],
      prevCity: [''],
      prevState: [''],
      prevZip: [''],
      prevCounty: [''],
    });

    this.employmentForm = this.fb.group({
      employmentStatus: ['', Validators.required],
      employerName: ['', Validators.required],
      jobTitle: [''],
      monthlyIncome: ['', Validators.required],
      employmentYears: ['', Validators.required],
      employmentMonths: ['0'],
      otherIncome: [''],
      otherIncomeSource: [''],
      // Previous employer (shown when < 2 years at current)
      prevEmployerName: [''],
      prevJobTitle: [''],
      prevEmploymentYears: [''],
      prevEmploymentMonths: ['0'],
    });

    this.coContactForm = this.fb.group({
      firstname: ['', Validators.required],
      lastname: ['', Validators.required],
      relation: ['', Validators.required],
      dob: ['', Validators.required],
      ssn: ['', Validators.required],
      email: [''],
      phone: [''],
    });

    this.coAddressForm = this.fb.group({
      street: ['', Validators.required],
      city: ['', Validators.required],
      state: ['', Validators.required],
      zip: ['', Validators.required],
      county: [''],
      addressYears: ['', Validators.required],
      addressMonths: ['0'],
      housingStatus: ['', Validators.required],
      rentMortgageAmount: [''],
      prevStreet: [''],
      prevCity: [''],
      prevState: [''],
      prevZip: [''],
    });

    this.coEmploymentForm = this.fb.group({
      employmentStatus: ['', Validators.required],
      employerName: ['', Validators.required],
      jobTitle: [''],
      monthlyIncome: ['', Validators.required],
      employmentYears: ['', Validators.required],
      employmentMonths: ['0'],
      otherIncome: [''],
      otherIncomeSource: [''],
      prevEmployerName: [''],
      prevJobTitle: [''],
      prevEmploymentYears: [''],
      prevEmploymentMonths: ['0'],
    });

    this.consentForm = this.fb.group({
      agreeTerms: [false, Validators.requiredTrue],
      agreeCreditCheck: [false, Validators.requiredTrue],
    });
  }

  selectBorrower(withCo: boolean) {
    this.coborrower.set(withCo);
    // If switching to solo mid-application, reset step if past step 3
    if (!withCo && this.step() > 3) this.step.set(this.consentStep);
  }

  nextStep() {
    if (this.step() < this.totalSteps) this.step.update(s => s + 1);
  }

  prevStep() {
    if (this.step() > 1) this.step.update(s => s - 1);
  }

  currentStepValid(): boolean {
    switch (this.step()) {
      case 1: return this.contactForm.valid;
      case 2: return this.addressForm.valid;
      case 3: return this.employmentForm.valid;
      case 4: return this.coborrower() ? this.coContactForm.valid : this.consentForm.valid;
      case 5: return this.coAddressForm.valid;
      case 6: return this.coEmploymentForm.valid;
      case 7: return this.consentForm.valid;
      default: return false;
    }
  }

  submitForm() {
    if (this.submitting()) return;
    this.submitting.set(true);

    const addrYrs = this.addressForm.get('addressYears')?.value;
    const empYrs = this.employmentForm.get('employmentYears')?.value;
    const coAddrYrs = this.coAddressForm.get('addressYears')?.value;
    const coEmpYrs = this.coEmploymentForm.get('employmentYears')?.value;

    const payload: any = {
      ...this.contactForm.value,
      ...this.addressForm.value,
      ...this.employmentForm.value,
      coborrower: this.coborrower(),
      ...(this.buyerId ? { buyer_id: this.buyerId } : {}),
    };

    // Strip previous fields if not applicable
    if (Number(addrYrs) >= 2) {
      delete payload.prevStreet; delete payload.prevCity;
      delete payload.prevState; delete payload.prevZip; delete payload.prevCounty;
    }
    if (Number(empYrs) >= 2) {
      delete payload.prevEmployerName; delete payload.prevJobTitle;
      delete payload.prevEmploymentYears; delete payload.prevEmploymentMonths;
    }

    if (this.coborrower()) {
      const co: any = {
        ...this.coContactForm.value,
        ...this.coAddressForm.value,
        ...this.coEmploymentForm.value,
      };
      if (Number(coAddrYrs) >= 2) {
        delete co.prevStreet; delete co.prevCity; delete co.prevState; delete co.prevZip;
      }
      if (Number(coEmpYrs) >= 2) {
        delete co.prevEmployerName; delete co.prevJobTitle;
        delete co.prevEmploymentYears; delete co.prevEmploymentMonths;
      }
      payload.coborrower_data = co;
    }

    this.http.post('/api/leads/financing', payload).subscribe({
      next: () => { this.submitted.set(true); this.submitting.set(false); },
      error: () => { this.submitting.set(false); alert('Something went wrong. Please try again.'); }
    });
  }
}

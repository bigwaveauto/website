import { Component, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';

// Average combined state + local sales tax rates (Tax Foundation 2024)
const STATE_TAX_RATES: Record<string, number> = {
  'Alabama': 9.22, 'Alaska': 1.76, 'Arizona': 8.37, 'Arkansas': 9.47,
  'California': 8.68, 'Colorado': 7.77, 'Connecticut': 6.35, 'Delaware': 0,
  'Florida': 7.02, 'Georgia': 7.35, 'Hawaii': 4.44, 'Idaho': 6.03,
  'Illinois': 8.83, 'Indiana': 7.0, 'Iowa': 6.94, 'Kansas': 8.7,
  'Kentucky': 6.0, 'Louisiana': 9.55, 'Maine': 5.5, 'Maryland': 6.0,
  'Massachusetts': 6.25, 'Michigan': 6.0, 'Minnesota': 7.49, 'Mississippi': 7.07,
  'Missouri': 8.28, 'Montana': 0, 'Nebraska': 6.94, 'Nevada': 8.23,
  'New Hampshire': 0, 'New Jersey': 6.6, 'New Mexico': 7.83, 'New York': 8.52,
  'North Carolina': 6.99, 'North Dakota': 6.96, 'Ohio': 7.24, 'Oklahoma': 8.95,
  'Oregon': 0, 'Pennsylvania': 6.34, 'Rhode Island': 7.0, 'South Carolina': 7.44,
  'South Dakota': 6.4, 'Tennessee': 9.55, 'Texas': 8.2, 'Utah': 7.19,
  'Vermont': 6.22, 'Virginia': 5.75, 'Washington': 9.23, 'West Virginia': 6.55,
  'Wisconsin': 5.0, 'Wyoming': 5.36, 'District of Columbia': 6.0,
};

interface AmortizationRow {
  month: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

interface CalcResult {
  vehiclePrice: number;
  monthlyPayment: number;
  loanAmount: number;
  salesTaxAmount: number;
  upfrontPayment: number;
  totalPayments: number;
  totalInterest: number;
  totalCost: number;
  principalPct: number;
  interestPct: number;
  schedule: AmortizationRow[];
}

@Component({
  selector: 'app-calculator',
  templateUrl: './calculator.component.html',
  styleUrl: './calculator.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule, HeaderComponent, FooterComponent, DecimalPipe],
})
export class CalculatorComponent {
  // ── Mode ────────────────────────────────────────────────────────────────
  mode = signal<'price' | 'payment'>('price');

  // ── Inputs ───────────────────────────────────────────────────────────────
  autoPrice        = 35000;
  desiredPayment   = 600;
  loanTerm         = 60;
  interestRate     = 6.9;
  cashIncentives   = 0;
  downPayment      = 0;
  tradeInValue     = 0;
  amountOwedTrade  = 0;
  salesTaxPct      = 5.0;
  otherFees        = 1200;
  includeTaxInLoan = false;

  scheduleView = signal<'monthly' | 'annual'>('monthly');
  result       = signal<CalcResult | null>(null);

  // Step 1 open by default, rest collapsed
  stepOpen = signal([true, false, false, false, false]);
  toggleStep(i: number) {
    this.stepOpen.update(arr => arr.map((v, idx) => idx === i ? !v : v));
  }

  readonly termOptions = [24, 36, 48, 60, 72, 84];

  // ── US States ─────────────────────────────────────────────────────────
  states = Object.keys(STATE_TAX_RATES).sort();
  selectedState = 'Wisconsin';

  onStateChange() {
    const rate = STATE_TAX_RATES[this.selectedState];
    if (rate !== undefined) this.salesTaxPct = rate;
  }

  calculate() {
    const r = (this.interestRate / 100) / 12;
    const n = this.loanTerm;
    const taxRate = this.salesTaxPct / 100;
    const netTrade = Math.max(0, this.tradeInValue - this.amountOwedTrade);
    const baseDown = this.downPayment + netTrade + this.cashIncentives;

    let vehiclePrice: number;
    let loanAmount: number;
    let monthlyPayment: number;
    let salesTaxAmount: number;

    if (this.mode() === 'price') {
      // Known: vehicle price → solve for monthly payment
      vehiclePrice = this.autoPrice;
      salesTaxAmount = vehiclePrice * taxRate;
      loanAmount = vehiclePrice - baseDown;
      if (this.includeTaxInLoan) loanAmount += salesTaxAmount + this.otherFees;
      loanAmount = Math.max(0, loanAmount);
      monthlyPayment = r === 0
        ? loanAmount / n
        : loanAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    } else {
      // Known: desired monthly payment → solve for vehicle price
      monthlyPayment = this.desiredPayment;
      // First get the raw loan amount from the payment
      const rawLoan = r === 0
        ? monthlyPayment * n
        : monthlyPayment * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n));

      if (this.includeTaxInLoan) {
        // rawLoan = (vehiclePrice - baseDown) + vehiclePrice * taxRate + otherFees
        // rawLoan - otherFees + baseDown = vehiclePrice * (1 + taxRate)
        vehiclePrice = (rawLoan - this.otherFees + baseDown) / (1 + taxRate);
      } else {
        vehiclePrice = rawLoan + baseDown;
      }
      vehiclePrice = Math.max(0, vehiclePrice);
      salesTaxAmount = vehiclePrice * taxRate;
      loanAmount = this.includeTaxInLoan ? rawLoan : Math.max(0, vehiclePrice - baseDown);
    }

    const totalPayments  = monthlyPayment * n;
    const totalInterest  = Math.max(0, totalPayments - loanAmount);
    const upfrontPayment = baseDown + (this.includeTaxInLoan ? 0 : salesTaxAmount + this.otherFees);
    const totalCost      = upfrontPayment + totalPayments;
    const principalPct   = totalPayments > 0 ? Math.round((loanAmount / totalPayments) * 100) : 100;

    const schedule: AmortizationRow[] = [];
    let balance = loanAmount;
    for (let m = 1; m <= n; m++) {
      const intPmt  = balance * r;
      const prinPmt = monthlyPayment - intPmt;
      balance       = Math.max(0, balance - prinPmt);
      schedule.push({ month: m, payment: monthlyPayment, interest: intPmt, principal: prinPmt, balance });
    }

    this.result.set({
      vehiclePrice, monthlyPayment, loanAmount,
      salesTaxAmount,
      upfrontPayment, totalPayments, totalInterest, totalCost,
      principalPct, interestPct: 100 - principalPct, schedule,
    });
  }

  annualSchedule(schedule: AmortizationRow[]): { year: number; interest: number; principal: number; balance: number }[] {
    const years: { year: number; interest: number; principal: number; balance: number }[] = [];
    for (let i = 0; i < schedule.length; i += 12) {
      const chunk = schedule.slice(i, i + 12);
      years.push({
        year: Math.floor(i / 12) + 1,
        interest:  chunk.reduce((s, r) => s + r.interest, 0),
        principal: chunk.reduce((s, r) => s + r.principal, 0),
        balance:   chunk[chunk.length - 1].balance,
      });
    }
    return years;
  }

  donutPath(pct: number, radius: number, cx: number, cy: number, startAngle = 0): string {
    const angle    = (pct / 100) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const x1 = cx + radius * Math.sin(startAngle);
    const y1 = cy - radius * Math.cos(startAngle);
    const x2 = cx + radius * Math.sin(endAngle);
    const y2 = cy - radius * Math.cos(endAngle);
    const large = angle > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
  }

  principalStartAngle = 0;
  get interestStartAngle() {
    const r = this.result();
    if (!r) return 0;
    return (r.principalPct / 100) * 2 * Math.PI;
  }
}

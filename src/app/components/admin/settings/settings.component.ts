import { Component, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

interface FinanceSettings {
  lowestRate: string;
  lowestRateTerm: string;
  defaultInterestRate: number;
  defaultLoanTerm: number;
  defaultOtherFees: number;
  defaultState: string;
  lendingPartnerCount: string;
  downOptions: string;
  preApprovalSpeed: string;
  notificationEmail: string;
}

@Component({
  selector: 'admin-settings',
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
})
export class AdminSettingsComponent implements OnInit {
  private http = inject(HttpClient);

  activeTab = signal<string>('finance');
  loading = signal(true);
  saving = signal(false);
  saved = signal(false);

  tabs = [
    { key: 'finance',  label: 'Finance',  icon: 'banknote' },
    { key: 'general',  label: 'General',  icon: 'globe' },
    { key: 'leads',    label: 'Leads',    icon: 'mail' },
    { key: 'seo',      label: 'SEO',      icon: 'search' },
  ];

  finance: FinanceSettings = {
    lowestRate: '6.9%',
    lowestRateTerm: '60-month term',
    defaultInterestRate: 6.9,
    defaultLoanTerm: 60,
    defaultOtherFees: 1200,
    defaultState: 'Wisconsin',
    lendingPartnerCount: '10+',
    downOptions: '$0',
    preApprovalSpeed: 'Same Day',
    notificationEmail: 'dave@bigwaveauto.com',
  };

  readonly termOptions = [24, 36, 48, 60, 72, 84];

  ngOnInit() {
    this.loadSettings();
  }

  setTab(key: string) {
    this.activeTab.set(key);
    this.saved.set(false);
  }

  loadSettings() {
    this.loading.set(true);
    this.http.get<{ settings: Record<string, any> }>('/api/admin/settings').subscribe({
      next: (res) => {
        if (res.settings?.['finance']) {
          this.finance = { ...this.finance, ...res.settings['finance'] };
        }
        this.loading.set(false);
      },
      error: () => {
        // Use defaults if no settings saved yet
        this.loading.set(false);
      },
    });
  }

  saveFinance() {
    this.saving.set(true);
    this.saved.set(false);
    this.http.post('/api/admin/settings', { category: 'finance', settings: this.finance }).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: () => {
        this.saving.set(false);
        alert('Failed to save settings. Please try again.');
      },
    });
  }
}

import { Component, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../services/auth.service';
import { ReservationService } from '../../services/reservation.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-reservation-panel',
  templateUrl: './reservation-panel.component.html',
  styleUrl: './reservation-panel.component.scss',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule],
})
export class ReservationPanelComponent {
  readonly auth    = inject(AuthService);
  readonly reserve = inject(ReservationService);
  private  fb      = inject(FormBuilder);
  private  platformId = inject(PLATFORM_ID);

  personaLoading = signal(false);

  // ── Info form ──
  infoForm = this.fb.group({
    firstName:    ['', Validators.required],
    lastName:     ['', Validators.required],
    email:        ['', [Validators.required, Validators.email]],
    phone:        ['', Validators.required],
    coRegistrant: [false],
    coRegName:    [''],
    street:       ['', Validators.required],
    city:         ['', Validators.required],
    state:        ['', Validators.required],
    zip:          ['', Validators.required],
  });

  // ── Coverage form ──
  coverageSelected = signal<string | null>(null);
  coverageOptions = [
    { id: 'none',      label: 'No thanks',         sub: 'I\'ll skip coverage for now',        price: 0   },
    { id: 'basic',     label: 'Basic Protection',  sub: 'Powertrain warranty (36 mo)',         price: 995 },
    { id: 'standard',  label: 'Standard Shield',   sub: 'Bumper-to-bumper + tire & wheel',     price: 1495 },
    { id: 'premium',   label: 'Premium Care+',     sub: 'Full coverage + GAP + roadside',      price: 2195 },
  ];

  // ── Delivery form ──
  deliveryMethod = signal<'pickup' | 'delivery'>('pickup');
  deliveryForm = this.fb.group({
    street: [''],
    city:   [''],
    state:  [''],
    zip:    [''],
  });

  ngOnInit() {
    const u = this.auth.user();
    if (u) {
      this.infoForm.patchValue({
        email:     u.email ?? '',
        firstName: u.user_metadata?.['first_name'] ?? '',
        lastName:  u.user_metadata?.['last_name']  ?? '',
      });
    }
  }

  submitInfo() {
    if (this.infoForm.invalid) { this.infoForm.markAllAsTouched(); return; }
    this.reserve.saveInfo(this.infoForm.value);
  }

  submitCoverage() {
    if (!this.coverageSelected()) return;
    this.reserve.saveCoverage({ plan: this.coverageSelected() });
  }

  submitDelivery() {
    const data: any = { method: this.deliveryMethod() };
    if (this.deliveryMethod() === 'delivery') {
      data.address = this.deliveryForm.value;
    }
    this.reserve.saveDelivery(data);
  }

  async startPersona() {
    if (!isPlatformBrowser(this.platformId)) return;
    this.personaLoading.set(true);
    try {
      const { default: Persona } = await import('persona') as any;
      const client = new Persona.EmbeddedClient({
        templateId: environment.personaTemplateId,
        environment: 'production',
        containerId: 'persona-container',
        onReady: () => { this.personaLoading.set(false); client.open(); },
        onComplete: ({ inquiryId }: any) => { this.reserve.saveVerify(inquiryId); },
        onFail: () => { this.personaLoading.set(false); },
        onExit: () => { this.personaLoading.set(false); },
      });
    } catch (e) {
      this.personaLoading.set(false);
      console.error('Persona load error', e);
    }
  }

  get isTouched() { return (c: string) => this.infoForm.get(c)?.touched && this.infoForm.get(c)?.invalid; }
}

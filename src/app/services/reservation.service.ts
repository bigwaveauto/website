import { Injectable, signal, computed } from '@angular/core';

export type ReserveStep = 'overview' | 'info' | 'coverage' | 'delivery' | 'verify';

export interface ReservationStepDef {
  id: ReserveStep;
  label: string;
  sub: string;
}

export interface ReservationData {
  vin: string;
  year: number;
  make: string;
  model: string;
  price: number;
}

@Injectable({ providedIn: 'root' })
export class ReservationService {
  // ── Panel state ──
  panelOpen    = signal(false);
  currentStep  = signal<ReserveStep>('overview');
  vehicle      = signal<ReservationData | null>(null);

  // ── Step completion ──
  infoComplete     = signal(false);
  coverageComplete = signal(false);
  deliveryComplete = signal(false);
  verifyComplete   = signal(false);

  allComplete = computed(() =>
    this.infoComplete() && this.coverageComplete() && this.deliveryComplete() && this.verifyComplete()
  );

  // ── Form data ──
  infoData     = signal<any>(null);
  coverageData = signal<any>(null);
  deliveryData = signal<any>(null);
  inquiryId    = signal<string | null>(null);  // Persona inquiry ID

  readonly steps: ReservationStepDef[] = [
    { id: 'info',     label: 'Your Information',    sub: 'Name, contact & address'         },
    { id: 'coverage', label: 'Protection Plans',    sub: 'Warranty & coverage options'     },
    { id: 'delivery', label: 'Pickup or Delivery',  sub: 'Whichever is easiest for you'    },
    { id: 'verify',   label: 'Verify Your Identity', sub: 'Upload your driver\'s license'  },
  ];

  stepComplete(id: ReserveStep): boolean {
    if (id === 'info')     return this.infoComplete();
    if (id === 'coverage') return this.coverageComplete();
    if (id === 'delivery') return this.deliveryComplete();
    if (id === 'verify')   return this.verifyComplete();
    return false;
  }

  open(v: ReservationData) {
    this.vehicle.set(v);
    this.currentStep.set('overview');
    this.panelOpen.set(true);
  }

  close() { this.panelOpen.set(false); }

  goToStep(step: ReserveStep) { this.currentStep.set(step); }
  goToOverview()              { this.currentStep.set('overview'); }

  saveInfo(data: any)     { this.infoData.set(data);     this.infoComplete.set(true);     this.currentStep.set('overview'); }
  saveCoverage(data: any) { this.coverageData.set(data); this.coverageComplete.set(true); this.currentStep.set('overview'); }
  saveDelivery(data: any) { this.deliveryData.set(data); this.deliveryComplete.set(true); this.currentStep.set('overview'); }
  saveVerify(id: string)  { this.inquiryId.set(id);      this.verifyComplete.set(true);   this.currentStep.set('overview'); }

  cancel() {
    this.panelOpen.set(false);
    this.infoComplete.set(false);
    this.coverageComplete.set(false);
    this.deliveryComplete.set(false);
    this.verifyComplete.set(false);
    this.vehicle.set(null);
    this.infoData.set(null);
    this.coverageData.set(null);
    this.deliveryData.set(null);
    this.inquiryId.set(null);
  }
}

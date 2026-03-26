import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ReservationService } from '../../services/reservation.service';

type ModalStep = 'entry' | 'signin' | 'signup';

@Component({
  selector: 'app-auth-modal',
  templateUrl: './auth-modal.component.html',
  styleUrl: './auth-modal.component.scss',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule],
})
export class AuthModalComponent {
  readonly auth    = inject(AuthService);
  readonly reserve = inject(ReservationService);
  readonly router  = inject(Router);
  private  fb      = inject(FormBuilder);

  step     = signal<ModalStep>('entry');
  loading  = signal(false);
  error    = signal<string | null>(null);
  enteredEmail = signal('');

  entryForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  passwordForm = this.fb.group({
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  signupForm = this.fb.group({
    firstName: ['', Validators.required],
    lastName:  ['', Validators.required],
    password:  ['', [Validators.required, Validators.minLength(6)]],
  });

  close() { this.auth.closeAuthModal(); this.reset(); }

  reset() {
    this.step.set('entry');
    this.error.set(null);
    this.loading.set(false);
    this.entryForm.reset();
    this.passwordForm.reset();
    this.signupForm.reset();
  }

  async continueWithEmail() {
    if (this.entryForm.invalid) return;
    this.enteredEmail.set(this.entryForm.value.email!);
    this.step.set('signin');
    this.error.set(null);
  }

  switchToSignup() { this.step.set('signup'); this.error.set(null); }
  switchToSignin()  { this.step.set('signin');  this.error.set(null); }

  async signIn() {
    if (this.passwordForm.invalid) return;
    this.loading.set(true);
    this.error.set(null);
    const result = await this.auth.signInWithPassword(this.enteredEmail(), this.passwordForm.value.password!);
    this.loading.set(false);
    if ((result as any)?.error) {
      this.error.set('Incorrect password. Try again or create a new account.');
      return;
    }
    this.onAuthSuccess();
  }

  async signUp() {
    if (this.signupForm.invalid) return;
    const { firstName, lastName, password } = this.signupForm.value as any;
    this.loading.set(true);
    this.error.set(null);
    const result = await this.auth.signUp(this.enteredEmail(), password, firstName, lastName);
    this.loading.set(false);
    if ((result as any)?.error) {
      this.error.set((result as any).error.message ?? 'Sign up failed. Try again.');
      return;
    }
    this.onAuthSuccess();
  }

  async continueWithGoogle() {
    const vin = this.auth.authRedirectVin();
    this.auth.closeAuthModal();
    await this.auth.signInWithGoogle(vin ?? undefined);
  }

  private onAuthSuccess() {
    const vin = this.auth.authRedirectVin();
    this.auth.closeAuthModal();
    this.reset();
    if (vin) this.router.navigate(['/reserve', vin]);
  }
}

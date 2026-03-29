import { Injectable, signal, computed, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import type { SupabaseClient, User, Session } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  private supabase: SupabaseClient | null = null;
  private _ready: Promise<void> = Promise.resolve();
  private _readyResolve!: () => void;

  // ── Public state ──
  user    = signal<User | null>(null);
  session = signal<Session | null>(null);
  loading = signal(true);

  // ── Modal / flow state ──
  authModalOpen   = signal(false);
  authRedirectVin = signal<string | null>(null);  // VIN to go to after auth

  // ── Avatar dropdown ──
  accountMenuOpen = signal(false);

  isLoggedIn = computed(() => this.user() !== null);

  constructor() {
    this._ready = new Promise(resolve => { this._readyResolve = resolve; });
  }

  /** Call once from AppComponent (browser only). */
  async initAuth(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) { this._readyResolve(); return; }

    const { createClient } = await import('@supabase/supabase-js');

    const safStorage = {
      getItem:    (k: string) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k)    : null),
      setItem:    (k: string, v: string) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); },
      removeItem: (k: string) => { if (typeof localStorage !== 'undefined') localStorage.removeItem(k); },
    };

    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: { storage: safStorage, detectSessionInUrl: true, persistSession: true },
    });

    const { data } = await this.supabase.auth.getSession();
    this.session.set(data.session);
    this.user.set(data.session?.user ?? null);
    this.loading.set(false);

    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
      this.user.set(session?.user ?? null);
      this.loading.set(false);
    });

    this._readyResolve();
  }

  // ── Modal helpers ──
  openAuthModal(redirectVin?: string) {
    this.authRedirectVin.set(redirectVin ?? null);
    this.authModalOpen.set(true);
    this.accountMenuOpen.set(false);
  }
  closeAuthModal() { this.authModalOpen.set(false); }

  toggleAccountMenu() { this.accountMenuOpen.update(v => !v); }
  closeAccountMenu()  { this.accountMenuOpen.set(false); }

  // ── Auth methods ──
  async signInWithGoogle(redirectVin?: string) {
    if (!this.supabase) return;
    if (redirectVin) sessionStorage.setItem('reserve_vin', redirectVin);
    const origin = typeof window !== 'undefined' ? window.location.origin : environment.startupUrl;
    await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${origin}/auth/callback` },
    });
  }

  async signInWithGoogleTo(redirectUrl: string) {
    if (!this.supabase) return;
    await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUrl },
    });
  }

  async signInWithPassword(email: string, password: string) {
    if (!this.supabase) return { error: new Error('Not initialised') };
    return this.supabase.auth.signInWithPassword({ email, password });
  }

  async signUp(email: string, password: string, firstName: string, lastName: string) {
    if (!this.supabase) return { error: new Error('Not initialised') };
    return this.supabase.auth.signUp({
      email, password,
      options: { data: { first_name: firstName, last_name: lastName, full_name: `${firstName} ${lastName}` } },
    });
  }

  async signOut() {
    if (!this.supabase) return;
    await this.supabase.auth.signOut();
    this.accountMenuOpen.set(false);
    this.router.navigate(['/']);
  }

  async handleOAuthCallback() {
    await this._ready;
    if (!this.supabase) return;
    await this.supabase.auth.getSession();
  }

  async getAccessToken(): Promise<string | null> {
    return this.session()?.access_token ?? null;
  }
}

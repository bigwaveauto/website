import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

// Matches Big Wave Auto LLC QuickBooks chart of accounts (verified against Transaction List 2025–2026)
const CATEGORIES = [
  // COGS — vehicle-specific (need a VIN)
  'Auction Fees',
  'Detailing',
  'Fuel',
  'Inspection',
  'Listing Fees',
  'Reconditioning',
  'Repairs & Parts',
  'Supplies',
  'Tires',
  'Transportation',
  'Vehicle History Reports',
  'Warranty Coverage',
  // Operating expenses — overhead (no vehicle needed)
  'Advertising',
  'Bank Fees',
  'Insurance',
  'Internet',
  'Licenses & Permits',
  'Miscellaneous',
  'Office Expenses',
  'Professional Fees',
  'Rent',
  'Shipping & Postage',
  'Small Tools & Equipment',
  'Software & Subscriptions',
  'Telephone',
  'Website',
];

@Component({
  selector: 'admin-transactions',
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
})
export class TransactionsComponent implements OnInit {
  private http = inject(HttpClient);

  // ── Tab state ──────────────────────────────────────────────────────────────
  activeTab = signal<'review' | 'accounts' | 'rules' | 'report'>('review');

  // ── Accounts ───────────────────────────────────────────────────────────────
  accounts = signal<any[]>([]);
  newAccount = signal({ name: '', institution: '', account_type: 'checking', last_four: '' });
  accountSaving = signal(false);

  // ── Import ─────────────────────────────────────────────────────────────────
  selectedAccountId = signal('');
  importing = signal(false);
  importResult = signal<any>(null);
  importError = signal('');

  // ── Transactions ───────────────────────────────────────────────────────────
  transactions = signal<any[]>([]);
  txLoading = signal(false);
  statusFilter = signal<'pending' | 'approved' | 'ignored'>('pending');

  vehicles = signal<any[]>([]);
  selectedIds = signal<Set<string>>(new Set());

  pendingCount  = computed(() => this.transactions().filter(t => t.status === 'pending').length);
  approvedCount = computed(() => this.transactions().filter(t => t.status === 'approved').length);

  // ── AI ─────────────────────────────────────────────────────────────────────
  aiRunning = signal(false);
  aiError   = signal('');

  // ── Approve batch ──────────────────────────────────────────────────────────
  approveRunning = signal(false);
  approveResult  = signal<any>(null);

  /** Transactions not yet reviewed by user (pending + no AI confidence block) */
  blockedFromApprove = computed(() =>
    this.transactions().filter(t =>
      this.selectedIds().has(t.id) &&
      t.status === 'pending' &&
      (t.ai_confidence !== null && t.ai_confidence !== undefined) &&
      t.ai_confidence < 0.5 &&
      !t.category
    ).length
  );

  // ── Rules ──────────────────────────────────────────────────────────────────
  rules = signal<any[]>([]);
  newRule = signal({ vendor_pattern: '', match_type: 'contains', category: '', auto_approve: false });
  ruleSaving = signal(false);

  // ── Report ─────────────────────────────────────────────────────────────────
  reportFrom = signal('');
  reportTo   = signal('');

  readonly categories = CATEGORIES;

  // ── Imports history ────────────────────────────────────────────────────────
  imports = signal<any[]>([]);

  ngOnInit() {
    this.loadAccounts();
    this.loadTransactions();
    this.loadVehicles();
    this.loadRules();
    this.loadImports();
  }

  // ── Loaders ────────────────────────────────────────────────────────────────

  loadAccounts() {
    this.http.get<any[]>('/api/admin/transaction-accounts').subscribe({
      next: data => this.accounts.set(data || []),
    });
  }

  loadTransactions() {
    this.txLoading.set(true);
    this.selectedIds.set(new Set());
    this.http.get<any[]>(`/api/admin/transactions?status=${this.statusFilter()}&limit=300`).subscribe({
      next: data => { this.transactions.set(data || []); this.txLoading.set(false); },
      error: () => this.txLoading.set(false),
    });
  }

  loadVehicles() {
    this.http.get<any[]>('/api/admin/vehicles').subscribe({
      next: data => this.vehicles.set(data || []),
    });
  }

  loadRules() {
    this.http.get<any[]>('/api/admin/transaction-rules').subscribe({
      next: data => this.rules.set(data || []),
    });
  }

  loadImports() {
    this.http.get<any[]>('/api/admin/transactions/imports').subscribe({
      next: data => this.imports.set(data || []),
    });
  }

  // ── Account management ─────────────────────────────────────────────────────

  saveAccount() {
    const a = this.newAccount();
    if (!a.name.trim()) return;
    this.accountSaving.set(true);
    this.http.post('/api/admin/transaction-accounts', a).subscribe({
      next: () => {
        this.newAccount.set({ name: '', institution: '', account_type: 'checking', last_four: '' });
        this.accountSaving.set(false);
        this.loadAccounts();
      },
      error: err => {
        alert(err.error?.error || 'Failed to save account');
        this.accountSaving.set(false);
      },
    });
  }

  deleteAccount(id: string) {
    if (!confirm('Delete this account? This cannot be undone.')) return;
    this.http.delete(`/api/admin/transaction-accounts/${id}`).subscribe({
      next: () => this.loadAccounts(),
      error: err => alert(err.error?.error || 'Cannot delete account'),
    });
  }

  // ── CSV Import ─────────────────────────────────────────────────────────────

  onFileSelect(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!this.selectedAccountId()) { alert('Select an account first'); return; }
    this.importFile(file);
  }

  importFile(file: File) {
    this.importing.set(true);
    this.importResult.set(null);
    this.importError.set('');

    const form = new FormData();
    form.append('file', file);
    form.append('accountId', this.selectedAccountId());

    this.http.post<any>('/api/admin/transactions/import', form).subscribe({
      next: result => {
        this.importResult.set(result);
        this.importing.set(false);
        this.loadTransactions();
        this.loadImports();
      },
      error: err => {
        this.importError.set(err.error?.error || 'Import failed');
        this.importing.set(false);
      },
    });
  }

  onDropFile(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) this.importFile(file);
  }

  onDragOver(event: DragEvent) { event.preventDefault(); }

  // ── Selection ──────────────────────────────────────────────────────────────

  toggleSelect(id: string) {
    const s = new Set(this.selectedIds());
    s.has(id) ? s.delete(id) : s.add(id);
    this.selectedIds.set(s);
  }

  toggleSelectAll() {
    const all = this.transactions().map(t => t.id);
    const current = this.selectedIds();
    if (current.size === all.length) {
      this.selectedIds.set(new Set());
    } else {
      this.selectedIds.set(new Set(all));
    }
  }

  isSelected(id: string) { return this.selectedIds().has(id); }
  isAllSelected() { return this.selectedIds().size === this.transactions().length && this.transactions().length > 0; }

  // ── Inline edit ────────────────────────────────────────────────────────────

  updateField(id: string, field: string, value: any) {
    this.http.patch(`/api/admin/transactions/${id}`, { [field]: value }).subscribe({
      next: (updated: any) => {
        this.transactions.update(list => list.map(t => t.id === id ? { ...t, ...updated } : t));
      },
    });
  }

  // ── AI Suggest ─────────────────────────────────────────────────────────────

  runAI() {
    const ids = [...this.selectedIds()];
    if (!ids.length) { alert('Select transactions first'); return; }
    if (ids.length > 50) { alert('Select 50 or fewer at a time for AI'); return; }
    this.aiRunning.set(true);
    this.aiError.set('');
    this.http.post<any>('/api/admin/transactions/ai-suggest', { ids }).subscribe({
      next: result => {
        this.aiRunning.set(false);
        this.loadTransactions();
      },
      error: err => {
        this.aiError.set(err.error?.error || 'AI failed');
        this.aiRunning.set(false);
      },
    });
  }

  // ── Approve / Ignore ───────────────────────────────────────────────────────

  approveBatch() {
    const ids = [...this.selectedIds()];
    if (!ids.length) { alert('Select transactions to approve'); return; }
    if (this.blockedFromApprove() > 0) {
      alert(`${this.blockedFromApprove()} selected transactions have low AI confidence (<50%) and no category set. Set categories first or deselect them.`);
      return;
    }
    if (!confirm(`Approve ${ids.length} transactions? Vehicle-linked ones will be written to vehicle cost adds.`)) return;

    this.approveRunning.set(true);
    this.http.post<any>('/api/admin/transactions/approve-batch', { ids }).subscribe({
      next: result => {
        this.approveResult.set(result);
        this.approveRunning.set(false);
        this.loadTransactions();
      },
      error: err => {
        alert(err.error?.error || 'Approve failed');
        this.approveRunning.set(false);
      },
    });
  }

  ignoreBatch() {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    if (!confirm(`Ignore ${ids.length} transactions? They won't appear in reports.`)) return;
    this.http.post('/api/admin/transactions/ignore-batch', { ids }).subscribe({
      next: () => this.loadTransactions(),
    });
  }

  // ── Rules ──────────────────────────────────────────────────────────────────

  saveRule() {
    const r = this.newRule();
    if (!r.vendor_pattern.trim() || !r.category) return;
    this.ruleSaving.set(true);
    this.http.post('/api/admin/transaction-rules', r).subscribe({
      next: () => {
        this.newRule.set({ vendor_pattern: '', match_type: 'contains', category: '', auto_approve: false });
        this.ruleSaving.set(false);
        this.loadRules();
      },
      error: err => {
        alert(err.error?.error || 'Failed to save rule');
        this.ruleSaving.set(false);
      },
    });
  }

  deleteRule(id: string) {
    if (!confirm('Delete this rule?')) return;
    this.http.delete(`/api/admin/transaction-rules/${id}`).subscribe({
      next: () => this.loadRules(),
    });
  }

  // ── Report ─────────────────────────────────────────────────────────────────

  downloadReport() {
    const params = new URLSearchParams();
    if (this.reportFrom()) params.set('from', this.reportFrom());
    if (this.reportTo())   params.set('to', this.reportTo());
    window.location.href = `/api/admin/transactions/report?${params}`;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  formatCurrency(n: number) {
    return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  confidenceClass(tx: any): string {
    if (!tx.ai_confidence && tx.ai_confidence !== 0) return '';
    if (tx.ai_confidence >= 0.85) return 'tx-conf--green';
    if (tx.ai_confidence >= 0.5)  return 'tx-conf--yellow';
    return 'tx-conf--red';
  }

  vehicleLabel(vin: string): string {
    if (!vin) return '';
    const v = this.vehicles().find((x: any) => x.vin === vin);
    return v ? `${v.year} ${v.make} ${v.model}` : vin.slice(-6);
  }

  accountName(tx: any): string {
    return tx.transaction_imports?.transaction_accounts?.name || '—';
  }

  onStatusFilterChange(val: string) {
    this.statusFilter.set(val as any);
    this.loadTransactions();
  }

  /** Save a rule from a transaction row's current category */
  saveRuleFromRow(tx: any) {
    if (!tx.category || !tx.description) return;
    const pattern = tx.description.substring(0, 20).trim();
    this.newRule.set({ vendor_pattern: pattern, match_type: 'contains', category: tx.category, auto_approve: false });
    this.activeTab.set('rules');
  }

  /** Quick-set category from the AI suggestion */
  acceptAI(tx: any) {
    if (!tx.ai_category) return;
    this.updateField(tx.id, 'category', tx.ai_category);
    if (tx.ai_vin) this.updateField(tx.id, 'vin', tx.ai_vin);
  }

  updateNewAccount(field: string, value: string) {
    this.newAccount.update(a => ({ ...a, [field]: value }));
  }

  updateNewRule(field: string, value: any) {
    this.newRule.update(r => ({ ...r, [field]: value }));
  }

  pendingCountOf(status: string) {
    return this.transactions().filter(t => t.status === status).length;
  }
}

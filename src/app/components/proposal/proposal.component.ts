import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-proposal',
  templateUrl: './proposal.component.html',
  styleUrl: './proposal.component.scss',
  standalone: true,
  imports: [CommonModule],
})
export class ProposalComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);

  proposal = signal<any>(null);
  loading = signal(true);
  notFound = signal(false);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.notFound.set(true); this.loading.set(false); return; }

    this.http.get<any>(`/api/proposal/${id}`).subscribe({
      next: (data) => {
        this.proposal.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }

  get v(): any { return this.proposal()?.vehicle || {}; }
  get cr(): any { return this.proposal()?.condition || {}; }
  get photos(): string[] { return this.proposal()?.photos || []; }
  get excluded(): string[] { return this.proposal()?.excluded_fields || []; }

  isExcluded(field: string): boolean {
    return this.excluded.includes(field);
  }

  visibleDamage(): string[] {
    return (this.cr.damage || []).filter((_: string, i: number) => !this.excluded.includes(`damage_${i}`));
  }

  visibleOptions(): string[] {
    return (this.cr.options || []).filter((_: string, i: number) => !this.excluded.includes(`option_${i}`));
  }
}

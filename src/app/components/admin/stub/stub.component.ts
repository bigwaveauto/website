import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'admin-stub',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="stub">
      <lucide-icon name="wrench" class="stub-icon" />
      <h1>{{ title }}</h1>
      <p>This section is under construction. Coming soon.</p>
    </div>
  `,
  styles: [`
    .stub {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 60vh; text-align: center; gap: 12px;
    }
    .stub-icon { width: 48px; height: 48px; color: rgba(0,0,0,0.2); }
    h1 { font-size: 24px; font-weight: 800; color: #111; margin: 0; }
    p { color: rgba(0,0,0,0.4); font-size: 15px; margin: 0; }
  `],
})
export class AdminStubComponent {
  private route = inject(ActivatedRoute);
  title = this.route.snapshot.data['title'] || 'Coming Soon';
}

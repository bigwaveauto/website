import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { TasksService, Task } from '../../../services/tasks.service';

@Component({
  selector: 'admin-tasks',
  templateUrl: './tasks.component.html',
  styleUrl: './tasks.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
})
export class TasksComponent {
  readonly tasks = inject(TasksService);
  private router = inject(Router);

  filter = signal<'all' | 'missing_carfax' | 'missing_warranty' | 'recon' | 'manual'>('all');
  completing = signal<Set<string>>(new Set());

  newTaskVin = signal('');
  newTaskTitle = signal('');
  newTaskNotes = signal('');
  newTaskPriority = signal('normal');
  addingTask = signal(false);
  showAdd = signal(false);

  filteredAuto = computed(() => {
    const f = this.filter();
    const all = this.tasks.autoTasks();
    if (f === 'all') return all;
    if (f === 'missing_carfax') return all.filter(t => t.type === 'missing_carfax');
    if (f === 'missing_warranty') return all.filter(t => t.type === 'missing_warranty');
    return [];
  });

  filteredManual = computed(() => {
    const f = this.filter();
    const all = this.tasks.manualTasks();
    if (f === 'all') return all;
    if (f === 'recon') return all.filter(t => t.type === 'recon');
    if (f === 'manual') return all.filter(t => t.type === 'manual');
    return [];
  });

  typeIcon(type: string): string {
    const map: Record<string, string> = {
      missing_carfax: 'file-search',
      missing_warranty: 'shield-alert',
      recon: 'wrench',
      manual: 'clipboard-list',
    };
    return map[type] || 'circle-dot';
  }

  typeLabel(type: string): string {
    const map: Record<string, string> = {
      missing_carfax: 'Carfax',
      missing_warranty: 'Warranty',
      recon: 'Recon',
      manual: 'Manual',
    };
    return map[type] || type;
  }

  complete(task: Task) {
    const s = new Set(this.completing());
    s.add(task.id);
    this.completing.set(s);
    // Brief flash then remove
    setTimeout(() => {
      this.tasks.complete(task);
      const s2 = new Set(this.completing());
      s2.delete(task.id);
      this.completing.set(s2);
    }, 400);
  }

  dismiss(task: Task) {
    this.tasks.dismiss(task);
  }

  goToVehicle(vin: string | null) {
    if (vin) this.router.navigate(['/admin/inventory', vin]);
  }

  addTask() {
    const title = this.newTaskTitle().trim();
    if (!title) return;
    this.addingTask.set(true);
    this.tasks.addManual({
      vin: this.newTaskVin().trim() || undefined,
      title,
      priority: this.newTaskPriority(),
      notes: this.newTaskNotes().trim() || undefined,
    }).subscribe({
      next: (task) => {
        this.tasks.pushManual(task);
        this.newTaskTitle.set('');
        this.newTaskVin.set('');
        this.newTaskNotes.set('');
        this.newTaskPriority.set('normal');
        this.addingTask.set(false);
        this.showAdd.set(false);
      },
      error: () => this.addingTask.set(false),
    });
  }
}

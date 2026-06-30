import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

interface Task {
  id: string;
  vin: string | null;
  type: string;
  title: string;
  status: string;
  priority: string;
  notes?: string;
  auto?: boolean;
  created_at?: string;
}

@Component({
  selector: 'admin-tasks',
  templateUrl: './tasks.component.html',
  styleUrl: './tasks.component.scss',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink],
})
export class TasksComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);

  loading = signal(true);
  autoTasks = signal<Task[]>([]);
  manualTasks = signal<Task[]>([]);
  completing = signal<Set<string>>(new Set());

  filter = signal<'all' | 'missing_carfax' | 'missing_warranty' | 'recon' | 'manual'>('all');

  newTaskVin = signal('');
  newTaskTitle = signal('');
  newTaskNotes = signal('');
  newTaskPriority = signal('normal');
  addingTask = signal(false);
  showAdd = signal(false);

  filteredAuto = computed(() => {
    const f = this.filter();
    const tasks = this.autoTasks();
    if (f === 'all' || f === 'missing_carfax') {
      const carfax = tasks.filter(t => t.type === 'missing_carfax');
      if (f === 'missing_carfax') return carfax;
    }
    if (f === 'missing_warranty') return tasks.filter(t => t.type === 'missing_warranty');
    if (f === 'all') return tasks;
    return [];
  });

  filteredManual = computed(() => {
    const f = this.filter();
    const tasks = this.manualTasks();
    if (f === 'all') return tasks;
    if (f === 'recon') return tasks.filter(t => t.type === 'recon');
    if (f === 'manual') return tasks.filter(t => t.type === 'manual');
    return [];
  });

  totalOpen = computed(() => this.autoTasks().length + this.manualTasks().length);

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

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.http.get<{ auto: Task[]; manual: Task[] }>('/api/admin/tasks').subscribe({
      next: (data) => {
        this.autoTasks.set(data.auto || []);
        this.manualTasks.set(data.manual || []);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  complete(task: Task) {
    const completing = new Set(this.completing());
    completing.add(task.id);
    this.completing.set(completing);

    if (task.auto) {
      // Auto-tasks can only be dismissed (resolved by fixing the underlying issue)
      // We just remove them from the local list optimistically
      this.autoTasks.update(ts => ts.filter(t => t.id !== task.id));
      completing.delete(task.id);
      this.completing.set(new Set(completing));

      // Navigate to the vehicle so they can fix it
      if (task.vin) this.router.navigate(['/admin/inventory', task.vin]);
      return;
    }

    this.http.patch(`/api/admin/tasks/${task.id}`, { status: 'done' }).subscribe({
      next: () => {
        this.manualTasks.update(ts => ts.filter(t => t.id !== task.id));
        completing.delete(task.id);
        this.completing.set(new Set(completing));
      },
      error: () => {
        completing.delete(task.id);
        this.completing.set(new Set(completing));
      },
    });
  }

  dismiss(task: Task) {
    if (task.auto) {
      this.autoTasks.update(ts => ts.filter(t => t.id !== task.id));
      return;
    }
    this.http.patch(`/api/admin/tasks/${task.id}`, { status: 'dismissed' }).subscribe({
      next: () => this.manualTasks.update(ts => ts.filter(t => t.id !== task.id)),
    });
  }

  goToVehicle(vin: string | null) {
    if (vin) this.router.navigate(['/admin/inventory', vin]);
  }

  addTask() {
    const title = this.newTaskTitle().trim();
    if (!title) return;
    this.addingTask.set(true);
    this.http.post<Task>('/api/admin/tasks', {
      vin: this.newTaskVin().trim() || null,
      type: 'manual',
      title,
      priority: this.newTaskPriority(),
      notes: this.newTaskNotes().trim() || null,
    }).subscribe({
      next: (task) => {
        this.manualTasks.update(ts => [task, ...ts]);
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

import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface Task {
  id: string;
  vin: string | null;
  type: string;
  title: string;
  status: string;
  priority: string;
  notes?: string;
  auto?: boolean;
  created_at?: string;
  vehicle?: { year?: number; make?: string; model?: string; label: string };
}

@Injectable({ providedIn: 'root' })
export class TasksService {
  private http = inject(HttpClient);

  autoTasks = signal<Task[]>([]);
  manualTasks = signal<Task[]>([]);
  loading = signal(false);
  loaded = signal(false);

  totalOpen = computed(() => this.autoTasks().length + this.manualTasks().length);

  load() {
    if (this.loading()) return;
    this.loading.set(true);
    this.http.get<{ auto: Task[]; manual: Task[] }>('/api/admin/tasks').subscribe({
      next: (data) => {
        this.autoTasks.set(data.auto || []);
        this.manualTasks.set(data.manual || []);
        this.loading.set(false);
        this.loaded.set(true);
      },
      error: () => {
        this.loading.set(false);
        this.loaded.set(true);
      },
    });
  }

  complete(task: Task) {
    // Optimistically remove from list
    this.autoTasks.update(ts => ts.filter(t => t.id !== task.id));
    this.manualTasks.update(ts => ts.filter(t => t.id !== task.id));

    // Persist completion on stored tasks
    if (!task.auto) {
      this.http.patch(`/api/admin/tasks/${task.id}`, { status: 'done' }).subscribe();
    }

    // Write to audit log for any task linked to a VIN
    if (task.vin) {
      const vehicleLabel = task.vehicle?.label || task.vin;
      this.http.post('/api/admin/vehicle/audit', {
        vin: task.vin,
        event_type: 'task_done',
        title: `✓ ${task.title} — ${vehicleLabel}`,
        notes: task.notes || null,
      }).subscribe();
    }
  }

  dismiss(task: Task) {
    this.autoTasks.update(ts => ts.filter(t => t.id !== task.id));
    this.manualTasks.update(ts => ts.filter(t => t.id !== task.id));
    if (!task.auto) {
      this.http.patch(`/api/admin/tasks/${task.id}`, { status: 'dismissed' }).subscribe();
    }
  }

  addManual(payload: { vin?: string; title: string; priority: string; notes?: string }) {
    return this.http.post<Task>('/api/admin/tasks', { type: 'manual', ...payload });
  }

  pushManual(task: Task) {
    this.manualTasks.update(ts => [task, ...ts]);
  }
}

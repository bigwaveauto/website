import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'admin-acquisitions',
  templateUrl: './acquisitions.component.html',
  styleUrl: './acquisitions.component.scss',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
})
export class AdminAcquisitionsComponent {}

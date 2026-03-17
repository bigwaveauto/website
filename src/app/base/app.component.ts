import { Component, signal } from '@angular/core';
import { FlexLayoutModule } from 'ngx-flexible-layout';
import { CommonModule } from '@angular/common';
import { FlexLayoutServerModule } from 'ngx-flexible-layout/server';
import { RouterOutlet } from '@angular/router';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

interface OperatingHours {
  dayOfWeek: string;
  isRange: boolean;
  isOpen: boolean;
  from: string;
  to: string;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  host: { style: 'flex: 1;overflow:hidden' },
  standalone: true,
  imports: [
    FlexLayoutServerModule,
    FlexLayoutModule,
    CommonModule,
    RouterOutlet,
    MatSelectModule,
    MatIconModule,
    MatButtonModule
  ]
})
export class AppComponent {

}

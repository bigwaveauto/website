import { Component, inject, signal, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FlexLayoutModule } from 'ngx-flexible-layout';
import { NavigationStart, Router, RouterModule, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { filter } from 'rxjs/operators';
import { FloatInOnScrollDirective } from '../../services/observeVisibilityDirective';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { FlexLayoutServerModule } from 'ngx-flexible-layout/server';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';
import { InventoryComponent } from '../inventory/inventory.component';


@Component({
  selector: 'home',
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  host: { style: 'flex-direction:column' },
  standalone: true,
  imports: [
    FlexLayoutServerModule,
    FlexLayoutModule,
    CommonModule,
    MatMenuModule,
    LucideAngularModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    RouterModule,
    FloatInOnScrollDirective,
    ReactiveFormsModule,
    HeaderComponent,
    FooterComponent,
    InventoryComponent
  ]
})
export class HomeComponent implements OnDestroy {
  readonly router = inject(Router);
  protected readonly menuOpen = signal(false);
  today = new Date();
  showFilters = signal<boolean>(false);
  carModel = signal<string | undefined>(undefined);
  carMake = signal<string | undefined>(undefined);
  carCondition = signal<string | undefined>(undefined);
  carSearch = new FormControl('');

  heroPhotos = [
    '/_SLC0012.webp',
    '/SLC00303-5.webp',
    '/_SLC0181-2.webp',
    '/_SLC0056.webp',
  ];
  currentSlide = signal(0);
  private slideInterval: ReturnType<typeof setInterval> | undefined;
  private platformId = inject(PLATFORM_ID);

  openSections = new BehaviorSubject<string[]>([]);

  constructor() {
    this.router.events.pipe(
      filter(event => event instanceof NavigationStart))
      .subscribe((event: NavigationStart) => {
        this.closeAllPanels();
      });

    if (isPlatformBrowser(this.platformId)) {
      this.slideInterval = setInterval(() => {
        this.currentSlide.update(i => (i + 1) % this.heroPhotos.length);
      }, 5000);
    }
  }

  ngOnDestroy() {
    clearInterval(this.slideInterval);
  }

  goToSlide(index: number) {
    this.currentSlide.set(index);
  }

  toggleSection(sectionname: string) {
    let curr = [...this.openSections.value];
    const ind = curr.indexOf(sectionname);
    if (ind !== -1) {
      curr.splice(ind, 1);
    } else {
      curr.push(sectionname);
    }
    this.openSections.next(curr);
  }

  isSectionOpen(sectionname: string) {
    return this.openSections.value.indexOf(sectionname) !== -1;
  }

  closeAllPanels() {
    this.menuOpen.set(false);
  }
}

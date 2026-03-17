import { ChangeDetectorRef, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatDividerModule } from '@angular/material/divider';
import { FlexLayoutModule } from 'ngx-flexible-layout';
import { ActivatedRoute, ParamMap, Router, RouterLink, RouterOutlet } from '@angular/router';
import { CommonModule, UpperCasePipe } from '@angular/common';
import { BehaviorSubject, map, Observable, Subject, switchMap, takeUntil, tap, withLatestFrom } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatSliderModule } from '@angular/material/slider';
import { FormsModule } from '@angular/forms';
import { MatListModule, MatSelectionList } from '@angular/material/list';
import { FlexLayoutServerModule } from 'ngx-flexible-layout/server';
import { Vehicle, InventoryResponse, InventoryFiltersResult, DetailedFiltersResult, } from '../../models/searchModels';
import { InventoryService } from '../../services/inventorySearch';
import { FilterKey, FilterTypes } from '../../models/filterTypes';
import { HeaderComponent } from '../header/header.component';
import { FooterComponent } from '../footer/footer.component';


@Component({
  selector: 'inventory',
  templateUrl: './inventory.component.html',
  styleUrl: './inventory.component.scss',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatToolbarModule,
    FlexLayoutModule,
    FlexLayoutServerModule,
    MatDividerModule,
    MatCardModule,
    MatChipsModule,
    MatSliderModule,
    FormsModule,
    MatListModule,
    RouterLink,
    HeaderComponent,
    FooterComponent
  ],
  providers: [
    InventoryService
  ]
})
export class InventoryComponent implements OnInit {

  private readonly brandLogoMap: Record<string, string> = {
    'audi':          '/brands/Audi_Logo.svg',
    'bmw':           '/brands/bmw-logo-2022.svg',
    'mercedes-benz': '/brands/mercedes-benz-logo.svg',
    'mercedes':      '/brands/mercedes-benz-logo.svg',
    'porsche':       '/brands/porsche-logo.svg',
    'rivian':        '/brands/rivian-logo.svg',
    'tesla':         '/brands/tesla-logo.svg',
  };

  getBrandLogo(makeKey: string): string | null {
    return this.brandLogoMap[makeKey.toLowerCase()] ?? null;
  }

  private readonly brandOrder = ['rivian', 'tesla', 'bmw'];

  sortedMakes(counts: Record<string, number>): { key: string; value: number }[] {
    const entries = Object.entries(counts).map(([key, value]) => ({ key, value }));
    return entries.sort((a, b) => {
      const ai = this.brandOrder.indexOf(a.key.toLowerCase());
      const bi = this.brandOrder.indexOf(b.key.toLowerCase());
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.key.localeCompare(b.key);
    });
  }
  private readonly inventoryService = inject(InventoryService);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly cd = inject(ChangeDetectorRef);
  showFilters = input<boolean>(true);
  pathRoot = input<string>('.');
  featured = input<boolean>(false);
  vehicles = signal<Vehicle[]>([]);
  inventory = signal<InventoryResponse | null>(null);
  filters = signal<InventoryFiltersResult | null>(null);
  priceRange = signal<any>(null);
  financeTerms = signal<any>(null);
  priceMin!: number;
  priceMax!: number;
  financeMonths!: number;

  financePercent!: number;
  openSections = new BehaviorSubject<string[]>([]);
  currParams = signal<any>(null);
  heroDims = signal<any>({});
  tempmin!: number | null;
  tempmax!: number | null;
  focusPictureMap = new BehaviorSubject<any>({});
  htmlstring = "\u003Cp\u003E?? For Sale: 2014 Audi A4 Premium Plus ??\u003Cbr\u003E?? 94,939 miles | Available now at \u003Ca href='http://bigwaveauto.com' target='_new'\u003EBigWaveAuto.com\u003C/a\u003E\u003C/p\u003E\u003Cp\u003ESporty, sleek, and built for drivers who appreciate European luxury  this \u003Cstrong\u003E2014 Audi A4 Premium Plus\u003C/strong\u003E delivers style and performance without breaking the bank.\u003C/p\u003E\u003Cp\u003E?? Vehicle Highlights:\u003Cbr\u003E?? \u003Cstrong\u003E2.0T Turbocharged Engine\u003C/strong\u003E\u003Cbr\u003E?? \u003Cstrong\u003E94,939 miles\u003C/strong\u003E\u003Cbr\u003E?? \u003Cstrong\u003EPremium Plus Package\u003C/strong\u003E  includes leather seating, sunroof, heated front seats, and Bang &amp; Olufsen premium audio\u003Cbr\u003E?? \u003Cstrong\u003ECold Air Intake\u003C/strong\u003E for enhanced throttle response and sound\u003Cbr\u003E?? Professionally installed \u003Cstrong\u003Ewindow tint\u003C/strong\u003E for added style and privacy\u003Cbr\u003E?? Automatic transmission with Quattro all-wheel drive capability\u003C/p\u003E\u003Cp\u003E?? Clean, well-maintained, and tastefully modified  the perfect daily driver or weekend cruiser.\u003C/p\u003E\u003Cp\u003E?? Runs and drives great, no major issues, priced to sell!\u003C/p\u003E\u003Cp\u003E?? DM us or visit \u003Cstrong\u003EBigWaveAuto.com\u003C/strong\u003E to schedule a test drive today.\u003C/p\u003E";
  formattedString = this.htmlstring.replace('\u003C', '<').replace('\u003E', '>');
  formatSliderLabel(value: number): string {
    if (value >= 1000) {
      return Math.round(value / 1000) + 'k';
    }

    return `${value}`;
  }
  private destroy$ = new Subject<void>();
  filterTypes: FilterTypes =
    {
      'year': { displayName: 'Year', include: false },
      'price': { displayName: 'Price', include: false },
      'condition': { displayName: 'Condition', include: true, highlightifone: true },
      'body': { displayName: 'Body Style', include: true },
      'make': { displayName: 'Make', include: false },
      'model': { displayName: 'Model', include: false },
      'highlights': { displayName: 'Features', include: true },
      'seatingcapacity': { displayName: 'Seating Capacity', include: true },
      'interiorcolorstandard': { displayName: 'Interior Color', include: true },
      'exteriorcolorstandard': { displayName: 'Exterior Color', include: true },
      'fuel': { displayName: 'Fuel Type', include: true },
      'transmissionstandard': { displayName: 'Transmission', include: true },
      'drivetrainstandard': { displayName: 'Drive Train', include: true },
      'engine': { displayName: 'Engine', include: true },
    };

  getDisplay(filter: any) {
    const splitval = filter.key.split('[')[0]
    const keyval: keyof FilterTypes = splitval;
    const dkeyval: keyof DetailedFiltersResult = splitval;
    const counts = this.getCountsForFilter(dkeyval);
    const isstring = typeof (filter.value) === 'string';
    let filterValues = isstring ? [filter.value] : filter.value;
    if (counts) {
      filterValues = filterValues.filter((t: string) => Object.keys(counts).some(s => s.toLowerCase() === t.toLowerCase()));
    }
    if (keyval !== 'price' && filterValues.length > 0 && this.filterTypes[keyval]) {
      return {
        ...this.filterTypes[keyval],
        filterValues,
        deliniator: filter.key.includes('[lt]') ? '<' : filter.key.includes('[gt]') ? '>' : ':',
        moneyPipe: filter.key.includes('price')
      }
    }
    return null;
  }

  onImageLoad(event: Event, index: number) {
    const img = event.target as HTMLImageElement;
    let curr = {
      ...this.heroDims(),
      [index]: { width: img.offsetWidth, height: img.offsetHeight }
    };
    this.heroDims.set(curr);
    this.cd.detectChanges();
  }

  ngOnInit() {
    this.inventoryService.getUnboundedFilters().pipe(withLatestFrom(this.activatedRoute.queryParamMap)).subscribe(([filters, qparams]) => {
      this.setOpenSections(qparams);
      this.setPriceRange(filters.results.filters, qparams, true);
    });

    this.activatedRoute.queryParamMap
      .pipe(takeUntil(this.destroy$), // Unsubscribe when component is destroyed
        switchMap((parammap: ParamMap) => {
          const pobj = this.paramMapToObject(parammap);
          this.currParams.set(pobj);
          return this.inventoryService.searchInventoryWithFilters(parammap).pipe(tap((response) => {
            this.inventory.set(response.inventory);
            this.filterTypes
            if (this.featured()) {
              this.getFeaturedVehicles(response.inventory.results);
            } else {
              this.vehicles.set(response.inventory.results.sort((a, b) => b.price - a.price));
            }
            this.filters.set(response.filters.results);
            this.setPriceRange(response.filters.results.filters, parammap, false)
          }));
        })).subscribe();

  }

  getFeaturedVehicles(allvehicles: Vehicle[]) {
    this.vehicles.set(allvehicles.filter(t => t.photos.length > 1).sort((a, b) => b.price - a.price).slice(0, 6));
  }

  setFocusedImage(vin: string, increment: number) {
    let curr = {
      ...this.focusPictureMap.value,
      [vin]: (this.focusPictureMap.value[vin] || 0) + increment
    };
    this.focusPictureMap.next(curr);
  }

  removeFilter(filt: any, targetValue: string) {
    let fullfilt = this.filters();
    const targetKey = filt.key;
    let truekey = filt.key.split('[')[0];
    const newParams = { ...this.currParams() };
    if (truekey === 'make') {
      this.removeMakeAndModels(newParams, targetValue, fullfilt?.filters.modelgroups);
    } else {
      if (!(targetKey in newParams)) {
        return newParams; // Key not present
      }

      const value = newParams[targetKey];

      if (Array.isArray(value)) {
        const filtered = value.filter(v => v !== targetValue);
        if (filtered.length > 0) {
          newParams[targetKey] = filtered;
        } else {
          delete newParams[targetKey];
        }
      } else {
        if (value === targetValue) {
          delete newParams[targetKey];
        }
      }
      this.searchInventory(newParams);
    }

  }

  removeMakeAndModels(params: any, makeToRemove: string, makeModelMap: any) {
    const newParams = { ...params };

    // Remove make from make[]
    if (Array.isArray(newParams["make[]"])) {
      newParams["make[]"] = newParams["make[]"].filter(make => make !== makeToRemove);
      if (newParams["make[]"].length === 0) {
        delete newParams["make[]"];
      }
    } else if (newParams["make[]"] === makeToRemove) {
      delete newParams["make[]"];
    }

    // Remove all models belonging to the removed make
    const childModels = makeModelMap[makeToRemove];
    if (childModels && newParams["model[]"]) {
      if (Array.isArray(newParams["model[]"])) {
        newParams["model[]"] = newParams["model[]"].filter(
          model => !childModels.hasOwnProperty(model)
        );
        if (newParams["model[]"].length === 0) {
          delete newParams["model[]"];
        }
      } else {
        // model[] is a string, check if it's one of the child models
        if (childModels.hasOwnProperty(newParams["model[]"])) {
          delete newParams["model[]"];
        }
      }
    }
    this.searchInventory(newParams);
  }

  getCountsForFilter(key: FilterKey): Record<string, number> | null {
    const filter = this.filters()?.filters[key];

    // Defensive check for expected structure
    if (!filter) return null;

    if ('counts' in filter && typeof filter.counts === 'object') {
      return filter.counts;
    }

    // Special case: highlights (which is not wrapped in { counts: ... })
    if (key === 'highlights' && typeof filter === 'object') {
      return filter as Record<string, number>;
    }

    return null;
  }

  clearFilters() {
    this.router.navigate(['inventory']);
  }

  paramMapToObject(paramMap: ParamMap) {
    return paramMap.keys.reduce((obj: any, key) => {
      const values = paramMap.getAll(key);
      // If there's only one value, store it directly; otherwise, store as an array
      obj[key] = values.length === 1 ? values[0] : values;
      return obj;
    }, {});
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }


  setPriceRange(filters: any, params: ParamMap, isinit: boolean = false) {
    let pricebounds = isinit ? { min: filters.price ? this.roundToNearestThous(filters.price.min - 500) : 0, max: filters.price ? this.roundToNearestThous(filters.price.max + 500) : 100000 } : this.priceRange();

    this.priceMin = params.get('price[gt]') ? parseFloat(params.get('price[gt]') || '') : 0;
    this.priceMax = params.get('price[lt]') ? parseFloat(params.get('price[lt]') || '') : pricebounds?.max ?? 0;
    if (isinit) {
      this.priceRange.set(pricebounds);
    }
  }

  setOpenSections(params: ParamMap) {
    const pobj = this.paramMapToObject(params);
    Object.keys(pobj).forEach(p => {
      const splitval = p.split('[')[0];
      let finalval = splitval === 'make' || splitval == 'model' ? 'makemodel' : splitval;
      if (finalval) {
        this.toggleSection(finalval, true);
      }
    })
  }


  changeSlider(isMax: boolean, event: number) {
    this.updateFilters(['price[lt]', 'price[gt]'], [{ type: 'price[gt]', value: isMax ? this.priceMin : event }, { type: 'price[lt]', value: !isMax ? this.priceMax : event }]);
  }

  roundToNearestThous(value: number) {
    return Math.round(value / 1000) * 1000;
  }

  isSectionOpen(name: string) {
    return this.openSections.value.indexOf(name) !== -1;
  }


  toggleSection(name: string, forceopen: boolean = false) {
    let curr = [...this.openSections.value];
    const ind = curr.indexOf(name);
    if (ind !== -1) {
      if (!forceopen) {
        curr.splice(ind, 1);
      }
    } else {
      curr.push(name);
    }
    this.openSections.next(curr);
  }

  updateFilters(sections: string[], values: any, replaceInput: boolean = true) {
    let curr = {
      ...this.currParams()
    };
    sections.forEach(e => delete curr[e]);

    values.forEach((v: any) => {
      if (curr[v.type]) {
        curr[v.type].push(v.value);
      } else {
        curr = {
          ...curr,
          [v.type]: [v.value]
        }
      }
    });
    this.searchInventory(curr);
  }

  changeSelection(selected: MatSelectionList, sections: string[]) {
    let vals = selected.selectedOptions.selected.map(t => t.value);
    //make sure the parent is selected if child model is selected
    vals = vals.filter(t => {
      if (Object(t).hasOwnProperty('parent')) {
        return vals.findIndex(r => r.type === t.parent.type && r.value === t.parent.value) !== -1;
      }
      return true;
    })
    this.updateFilters(sections, vals);
  }

  optionSelected(value: any) {
    let curr = {
      ...this.currParams()
    };

    return curr && curr[value.type] && (typeof (curr[value.type]) === 'string' ? curr[value.type].toString().toLowerCase() === value.value.toString().toLowerCase() : curr[value.type].findIndex((z: any) => z.toString().toLowerCase() === value.value.toString().toLowerCase()) !== -1);
  }

  searchInventory(filters: any) {
    this.router.navigate(
      [],
      {
        relativeTo: this.activatedRoute,
        queryParams: filters,
        queryParamsHandling: 'replace', // remove to replace all query params by provided
      }
    );
  }


}

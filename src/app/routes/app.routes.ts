import { Routes } from '@angular/router';
import { HomeComponent } from '../components/home/home.component';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    component: HomeComponent
  },
  {
    path: 'showroom',
    loadComponent: () => import('../components/inventory/inventory.component').then(mod => mod.InventoryComponent),
  },
  {
    path: 'showroom/:vin',
    loadComponent: () => import('../components/vehicle/vehicle.component').then(mod => mod.VehicleComponent),
  },
  {
    path: 'about',
    loadComponent: () => import('../components/about/about.component').then(mod => mod.AboutComponent),
  },
  {
    path: 'financing',
    loadComponent: () => import('../components/financing/financing.component').then(mod => mod.FinancingComponent),
  }
];

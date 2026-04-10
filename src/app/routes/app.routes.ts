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
  },
  {
    path: 'sell',
    loadComponent: () => import('../components/sell/sell.component').then(mod => mod.SellComponent),
  },
  {
    path: 'calculator',
    loadComponent: () => import('../components/calculator/calculator.component').then(mod => mod.CalculatorComponent),
  },
  {
    path: 'search',
    loadComponent: () => import('../components/search/search.component').then(mod => mod.SearchComponent),
  },
  {
    path: 'account',
    loadComponent: () => import('../components/account/account.component').then(m => m.AccountComponent),
  },
  {
    path: 'auth/callback',
    loadComponent: () => import('../components/auth-callback/auth-callback.component').then(m => m.AuthCallbackComponent),
  },
  {
    path: 'reserve/:vin',
    loadComponent: () => import('../components/reserve/reserve.component').then(m => m.ReserveComponent),
  },
  {
    path: 'admin',
    loadComponent: () => import('../components/admin/admin.component').then(m => m.AdminComponent),
    children: [
      { path: '', loadComponent: () => import('../components/admin/dashboard/dashboard.component').then(m => m.DashboardComponent) },
      { path: 'reports', loadComponent: () => import('../components/admin/stub/stub.component').then(m => m.AdminStubComponent), data: { title: 'Reports' } },
      { path: 'intake', loadComponent: () => import('../components/admin/intake/intake.component').then(m => m.IntakeComponent) },
      { path: 'inventory', loadComponent: () => import('../components/admin/inventory/inventory-list.component').then(m => m.AdminInventoryListComponent) },
      { path: 'inventory/:vin', loadComponent: () => import('../components/admin/inventory/inventory-detail.component').then(m => m.AdminInventoryDetailComponent) },
      { path: 'customers', loadComponent: () => import('../components/admin/leads/leads.component').then(m => m.AdminLeadsComponent) },
      { path: 'deals', loadComponent: () => import('../components/admin/stub/stub.component').then(m => m.AdminStubComponent), data: { title: 'Deal' } },
      { path: 'marketing', loadComponent: () => import('../components/admin/stub/stub.component').then(m => m.AdminStubComponent), data: { title: 'Marketing' } },
      { path: 'accounting', loadComponent: () => import('../components/admin/stub/stub.component').then(m => m.AdminStubComponent), data: { title: 'Accounting' } },
      { path: 'settings', loadComponent: () => import('../components/admin/settings/settings.component').then(m => m.AdminSettingsComponent) },
    ],
  },
];

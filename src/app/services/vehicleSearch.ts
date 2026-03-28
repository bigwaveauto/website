import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { VehicleApiResponse } from '../models/vehicleExtended';
import { environment } from '../../environments/environment';


@Injectable()
export class VehicleService {
    readonly http = inject(HttpClient);

    // vAuto-powered inventory served from our own backend
    private get apiUrl(): string {
      const isBrowser = typeof window !== 'undefined';
      return isBrowser
        ? '/api/inventory'
        : `http://localhost:${process.env?.['PORT'] || 4000}/api/inventory`;
    }

  getVehicle(vin: string): Observable<VehicleApiResponse> {
    return this.http.get<VehicleApiResponse>(`${this.apiUrl}/${vin}`);
  }
}
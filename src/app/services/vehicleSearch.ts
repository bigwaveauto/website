import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { VehicleApiResponse } from '../models/vehicleExtended';
import { environment } from '../../environments/environment';


@Injectable()
export class VehicleService {
    readonly http = inject(HttpClient);

    private get apiUrl(): string {
      const isBrowser = typeof window !== 'undefined';
      return isBrowser
        ? `/api/dealers/${environment.dealerId}`
        : `${environment.externalApi}/${environment.dealerId}`;
    }
    
  getVehicle(vin: string): Observable<VehicleApiResponse> {
    return this.http.get<VehicleApiResponse>(`${this.apiUrl}/inventory/${vin}`);
  }
}
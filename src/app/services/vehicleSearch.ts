import { HttpClient } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { Observable } from 'rxjs';
import { VehicleApiResponse } from '../models/vehicleExtended';
import { environment } from '../../environments/environment';


@Injectable()
export class VehicleService {
    readonly http = inject(HttpClient);
    private isServer = isPlatformServer(inject(PLATFORM_ID));

    private get apiUrl(): string {
      return this.isServer
        ? `${environment.externalApi}/${environment.dealerId}`
        : `/api/dealers/${environment.dealerId}`;
    }
    
  getVehicle(vin: string): Observable<VehicleApiResponse> {
    return this.http.get<VehicleApiResponse>(`${this.apiUrl}/inventory/${vin}`);
  }
}
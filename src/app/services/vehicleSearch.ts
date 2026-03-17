import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { VehicleApiResponse } from '../models/vehicleExtended';
import { environment } from '../../environments/environment';


@Injectable()
export class VehicleService {
    readonly http = inject(HttpClient);
    private apiUrl = `${environment.externalApi}/${environment.dealerId}`; 
    
  getVehicle(vin: string): Observable<VehicleApiResponse> {
    return this.http.get<VehicleApiResponse>(`${this.apiUrl}/inventory/${vin}`);
  }
}
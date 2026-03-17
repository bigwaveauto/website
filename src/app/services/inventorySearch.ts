// src/app/services/inventory.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ParamMap } from '@angular/router';
import { InventoryFiltersResponse, InventoryQueryParams, InventorySearchResponse, InventoryResponse } from '../models/searchModels';
import { environment } from '../../environments/environment';

@Injectable()
export class InventoryService {
    private http = inject(HttpClient);

    // Replace with your actual Overfuel API base
    private apiUrl = `${environment.externalApi}/${environment.dealerId}`; 
  
    public buildParams(params: InventoryQueryParams): HttpParams {
      let httpParams = new HttpParams();
  
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
  
        if (typeof value === 'object' && !Array.isArray(value)) {
          // Range (gt/lt)
          const range = value as { gt?: number; lt?: number };
          if (range.gt !== undefined) {
            httpParams = httpParams.set(`${key}[gt]`, String(range.gt));
          }
          if (range.lt !== undefined) {
            httpParams = httpParams.set(`${key}[lt]`, String(range.lt));
          }
        } else if (Array.isArray(value)) {
          value.forEach(v => {
            httpParams = httpParams.append(`${key}[]`, String(v));
          });
        } else {
          httpParams = httpParams.set(`${key}[]`, String(value));
        }
      }
      return httpParams;
    }

    private paramMapToQueryString(paramMap: ParamMap): string {
      const params: string[] = [];
      paramMap.keys.forEach(key => {
        const values = paramMap.getAll(key); // Get all values for a given key
        values.forEach(value => {
          params.push(`${key}=${encodeURIComponent(value)}`); // Encode values for URL safety
        });
      });
      return params.join('&');
    }

    getUnboundedFilters(){
      return this.http.get<InventoryFiltersResponse>(`${this.apiUrl}/filters`);
    }
  
    // Get both inventory + filters together
    searchInventoryWithFilters(
      params: ParamMap
    ): Observable<InventorySearchResponse> {
      const querystring = this.paramMapToQueryString(params);
      return new Observable<InventorySearchResponse>(subscriber => {
        let inventory!: InventoryResponse;
        let filters!: InventoryFiltersResponse;
  
        this.http
          .get<InventoryResponse>(`${this.apiUrl}/search?` + querystring)
          .subscribe({
            next: inv => {
              inventory = inv;
              if (filters) {
                subscriber.next({ inventory, filters });
                subscriber.complete();
              }
            },
            error: err => subscriber.error(err),
          });
  
        this.http
          .get<InventoryFiltersResponse>(`${this.apiUrl}/filters?` + querystring)
          .subscribe({
            next: f => {
              filters = f;
              if (inventory) {
                subscriber.next({ inventory, filters });
                subscriber.complete();
              }
            },
            error: err => subscriber.error(err),
          });
          
          
      });
    }
  }
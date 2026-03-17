import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/base/app.config';
import {  AppComponent } from './app/base/app.component';

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));

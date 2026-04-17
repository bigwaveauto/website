import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withRouterConfig, withInMemoryScrolling } from '@angular/router';

import { routes } from '../routes/app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { authInterceptor } from '../services/auth.interceptor';
import {
  LUCIDE_ICONS, LucideIconProvider,
  MapPin, User, Users, UserPlus, X, Menu, ArrowRight, ArrowLeft,
  CircleCheck, Check, Send, Car, CarFront, Heart, Tag, Bell, BellOff,
  Settings, LogOut, CircleHelp, Smartphone, Mail, Zap, Gauge, RefreshCw,
  Handshake, Phone, Plus, Pencil, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  ChevronDown, Landmark, IdCard, Shield, Leaf, Fuel, PiggyBank, Clock,
  Headphones, Waves, BadgeCheck, Lock, Wrench, ListChecks, FileText,
  Calculator, Search, ChevronUp, Home,
  Palette, CircleDot, Hash, Fingerprint, Armchair, Cog, Trophy,
  Activity, Droplets, GaugeCircle, Ruler, Eye, Maximize2, Upload,
  BarChart3, Thermometer, Weight, Box, HandCoins, MessageCircle, Calendar,
  Truck, DollarSign, ShieldCheck,
} from 'lucide-angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    {
      provide: LUCIDE_ICONS, multi: true,
      useValue: new LucideIconProvider({
        MapPin, User, Users, UserPlus, X, Menu, ArrowRight, ArrowLeft,
        CircleCheck, Check, Send, Car, CarFront, Heart, Tag, Bell, BellOff,
        Settings, LogOut, CircleHelp, Smartphone, Mail, Zap, Gauge, RefreshCw,
        Handshake, Phone, Plus, Pencil, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
        ChevronDown, Landmark, IdCard, Shield, Leaf, Fuel, PiggyBank, Clock,
        Headphones, Waves, BadgeCheck, Lock, Wrench, ListChecks, FileText,
        Calculator, Search, ChevronUp, Home,
        Palette, CircleDot, Hash, Fingerprint, Armchair, Cog, Trophy,
        Activity, Droplets, GaugeCircle, Ruler, Eye, Maximize2, Upload,
        BarChart3, Thermometer, Weight, Box, HandCoins, MessageCircle, Calendar,
        Truck, DollarSign, ShieldCheck,
      }),
    },
    provideRouter(routes, withRouterConfig({ onSameUrlNavigation: 'reload' }), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideClientHydration(),
  ]
};

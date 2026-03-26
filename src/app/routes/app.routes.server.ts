import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: 'account',       renderMode: RenderMode.Client },
  { path: 'auth/callback', renderMode: RenderMode.Client },
  { path: 'reserve/:vin',  renderMode: RenderMode.Client },
  { path: 'admin',         renderMode: RenderMode.Client },
  { path: 'admin/**',      renderMode: RenderMode.Client },
  { path: '**',            renderMode: RenderMode.Server  },
];

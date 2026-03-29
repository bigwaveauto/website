import { HttpInterceptorFn } from '@angular/common/http';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Only attach token to admin API requests
  if (!req.url.includes('/api/admin')) {
    return next(req);
  }

  // Get Supabase session token from localStorage
  const isBrowser = typeof window !== 'undefined';
  if (!isBrowser) return next(req);

  try {
    // Supabase stores session under a key like sb-<project>-auth-token
    const keys = Object.keys(localStorage);
    const sbKey = keys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (sbKey) {
      const stored = JSON.parse(localStorage.getItem(sbKey) || '{}');
      const token = stored?.access_token;
      if (token) {
        req = req.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        });
      }
    }
  } catch {
    // If we can't get the token, proceed without it
  }

  return next(req);
};

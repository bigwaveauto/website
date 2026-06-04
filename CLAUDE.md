# Big Wave Auto

Angular 20 SSR app + Express server + Supabase. Two Chrome extensions
(`chrome-extension/` for the Auction Grabber, `chrome-extension-scout/`
for the Rivian Scout) talk to the server via `X-API-Key`.

## Deploying — DO NOT assume `git push` is enough

There is **no auto-deploy on push**. Production lives on a DigitalOcean
droplet at `root@104.236.238.131`, served by `nginx` → `pm2` process
`bigwaveauto` running `node dist/MotorDeal/server/server.mjs`.

To ship a change to https://bigwaveauto.com, run:

```bash
./deploy.sh
```

That script builds locally, pushes to GitHub, SSHes to the droplet,
pulls, `npm install`, rebuilds on the server, and `pm2 restart`s.

If you only `git push`, the code sits in GitHub and prod stays on the
old build. This has bitten us — verify after a deploy with:

```bash
curl -s https://bigwaveauto.com/ | grep -oE 'whatever-string-you-added' | head -1
```

## Database schema changes

There are no migration files in the repo. Schema changes live in
`scripts/YYYY-MM-DD-<name>.sql` and **must be run manually in the
Supabase Dashboard → SQL Editor** before the dependent server code goes
live. Write SQL to be idempotent (`ADD COLUMN IF NOT EXISTS`,
`CREATE OR REPLACE FUNCTION`, etc.) so re-runs are safe.

The `auth` schema is not exposed via PostgREST. To let the Node server
look up a user by email, define a `SECURITY DEFINER` RPC in `public`
and grant `EXECUTE` only to `service_role`. See
`get_user_id_by_email` in
`scripts/2026-05-31-attach-proposals-to-users.sql` for the pattern.

## Chrome extensions

Both extensions need a **manual reload** after file edits before the
new code is live in the browser:

1. `chrome://extensions`
2. Click the 🔄 (reload) icon on the extension
3. Then refresh the page you're testing on

A pushed change to `chrome-extension/content.js` is not running in
anyone's browser until they reload the extension. The `deploy.sh` flow
above does not touch the extensions — those are local-only artifacts
checked into the repo.

When adding new `host_permissions` to a published extension, Chrome
treats them as **withheld** until the user explicitly enables Site
Access for the extension. Tell the user to set "On all sites" or
allow-list the new host under chrome://extensions → Details.

## Secrets

Server secrets live in `.env` (gitignored). `.env.example` documents
what's required. The Supabase **publishable** anon key lives in
`src/environments/environment.ts` and is intentionally public — that's
how the browser talks to Supabase. The **service** key is server-only.

## Local dev quirks

- `ng serve` runs on `:4000`. Cache lives at `.angular/cache/` — if you
  see Vite "outdated pre-bundle" 500 errors, kill the process and
  `rm -rf .angular/cache`.
- Auth on `localhost:4000` requires either adding `localhost:4000` to
  Supabase's redirect URL allowlist or copying a session token from
  prod into localStorage. OAuth flows started on localhost won't
  redirect back to localhost otherwise.

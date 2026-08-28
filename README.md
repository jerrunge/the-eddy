# The Eddy

A phone PWA for the minute an OCD rumination loop plus ADHD has Jeremy. One tap,
dump the loop by voice or thumbs, and a guide grounded in his own record answers
with the next real move. Spec and rulings live in the jr-os-docs vault
(docs/strategy/the-eddy-spec-2026-08-28.html; RULINGS 2026-08-28).

- App: `eddy-4f2a9c/` (unguessable path, noindex; GitHub Pages serves it).
- Backend: Supabase project shared with the estate; `eddy_` tables, RLS enabled
  with zero policies, reached only through the edge functions.
- Functions: `supabase/functions/eddy-api` (data door), `eddy-guide` (Claude,
  grounded), `eddy-dispatch` (park knocks via Web Push, driven by pg_cron).
- Auth: device token pairing (the room-cabinet pattern); no sessions, so capture
  can never hit a login wall. Token and hashes are local-only, gitignored.
- Laws: no rule installs without Jeremy's explicit OK (the reassurance law ships
  built but OFF); nothing scores or narrates him; no crisis floor by his word;
  no em dashes anywhere.

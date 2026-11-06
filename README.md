# CloseCall — Private video calling (Phase 1)

A mobile-first frontend foundation for a private two-person video calling website.

## Current status

**Phase 1 only: responsive frontend and project structure.**

The landing page, create/join entry points, and temporary nickname dialog are implemented. The buttons intentionally stop before creating or joining a room. There are no mock video streams, fake room IDs, fake chat messages, or simulated connections.

## Project structure

- `index.html` — landing page and nickname dialog.
- `assets/css/main.css` — responsive dark-theme styling.
- `assets/js/app.js` — frontend interactions and input validation.
- `supabase/migrations/` — reserved for database migrations in Phase 2.
- `supabase/functions/` — reserved for trusted backend operations in Phase 2.

## Run locally

1. Extract the ZIP.
2. Open the folder in VS Code.
3. Use the VS Code Live Server extension, or run any static local web server.
4. Open the local address in a modern browser.

You can also open `index.html` directly for a quick visual preview. A local server is recommended for later browser APIs and development.

## Next phases

1. Supabase schema, RLS policies, and secure room authorization.
2. Secure invitation token generation and atomic two-participant admission.
3. Supabase Realtime signaling and WebRTC peer connection.
4. WebRTC DataChannel chat and call controls.
5. Expiry/cleanup and security testing.
6. Real two-device testing before claiming calls work.

## Configuration and security notes

- Do not put a Supabase `service_role` key or any other secret in frontend JavaScript.
- A Supabase project URL and publishable/anon key may be used in a browser only with correctly designed RLS policies. No Supabase credentials are configured in this Phase 1 scaffold.
- Room creation, invitation validation, participant limits, and expiry must be enforced by trusted backend logic, not only by frontend checks.
- Production WebRTC may require STUN and, for reliable connectivity across restrictive networks, TURN infrastructure. TURN credentials must be short-lived and issued securely.
- Camera/microphone access requires HTTPS (localhost is generally treated as a secure context during development).

## Verification

Phase 1 is a static frontend. It has not been tested as a video calling system, and no real calling capability is claimed.

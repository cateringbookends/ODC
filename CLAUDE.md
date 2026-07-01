# ODC — Codebase Graph

Outdoor-catering (ODC) **Sales Event Dashboard**. Multi-page web app (plain HTML + non-module `<script src>` JS, no framework/build). Front-end is offline-tolerant: reads run against an in-memory cache (hydrated from `localStorage`, refreshed from the API); writes update the cache and persist to the server in the background. **Repo lives under the `cateringbookends` GitHub/Google/Vercel accounts** — see [[reference-github]].

> This map exists to avoid re-reading files. Trust it; open a file only when changing it. Regenerate after structural edits. This file was significantly out of date as of 2026-07 (claimed SQLite/no-auth/6 pages when reality was Postgres+Sheets/full auth/16 pages) — if something here looks wrong, believe the code over this doc and fix the doc.

## ⚠️ Two independent live backends, one shared frontend contract
The same static frontend is deployed against **two completely different backends** depending on target — pick the right mental model before debugging an API issue:

1. **Vercel (`cateringbookends` project, linked via `.vercel/project.json`) — the real public-site deployment.** `vercel.json` builds only `api/[...path].js` (a Node serverless function) + static files. Every `/api/*` call is proxied (`api/[...path].js` → `callScript()`) to a deployed **Google Apps Script Web App** (`apps-script/Code.gs`, scriptId in gitignored `apps-script/.clasp.json`), which reads/writes a **Google Sheet** (one tab per entity — no relational integrity, no transactions, hand-rolled autoincrement via `LockService`). Sessions are stateless HMAC-signed cookies (`api/[...path].js`'s `makeSession`/`readSession`, key = `GOOGLE_SCRIPT_API_KEY` env var, mirrored locally in gitignored `google-sync-config.json`). `server.js` is never invoked here — it's inert dead weight in the Vercel bundle.
2. **Self-hosted VPS (`172.16.45.125`, pushed via the git `server` remote, ownership/role not fully confirmed).** `node server.js` against **Postgres** (`pg` dependency; `Pool` defaults to Docker-Compose-style host `"postgres"`). DB-backed session rows, login rate-limiting, admin force-logout. Completely separate codebase path from (1) that happens to expose an identical `/api/auth/*`, `/api/events`, etc. contract — that's *why* the same frontend works unmodified against either one.

Both implement the same endpoint contract; **when changing an endpoint, check whether it needs updating in both `server.js` AND `apps-script/Code.gs`** — they are hand-kept-in-sync, not shared code.

## Run it
- **Local dev (Postgres path):** `npm start` / `node server.js` → http://localhost:5050. Needs `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` env vars (or a local Postgres named `postgres`, matching the Docker-Compose-style default). Node ≥20. `npm test` does **not** exist as a script — run `node smoke-test.js` directly.
- `node launcher.js` — dev convenience: spawns `server.js` + a bundled `cloudflared.exe` tunnel for a public `*.trycloudflare.com` dev URL (prints default creds `aiops`/`AIops` — legacy seed admin, see Security).
- **Vercel deploy (Sheets path):** `vercel --prod` (or the `vercel:deploy` skill) from this repo, already linked to the `cateringbookends` team project. Needs `GOOGLE_SCRIPT_URL` + `GOOGLE_SCRIPT_API_KEY` env vars set in the Vercel project (same values as local `google-sync-config.json`, gitignored).
- **Apps Script side:** edit `apps-script/Code.gs`, then `clasp push --user catering` / `clasp deploy --user catering` from `apps-script/` — the `--user` flag is mandatory every time (clasp has no per-project default user; omitting it silently uses whatever the machine's default `clasp login` account is).
- Browser/UI checks: `browser-check.js`, `verify-ui.js` (Playwright; needs `NODE_PATH`/`PW_CHROME` set to a local install). `scripts/` holds ~24 more one-off Playwright audit/verify scripts from past debugging sessions — not part of the app, gitignored.

## Pages (16 — html ↔ controller js)
| Page | HTML | JS | Purpose |
|---|---|---|---|
| Login | `login.html` | `login.js` | Username/password → `POST /api/auth/login`; redirects via `?next=` on success |
| Dashboard (home) | `dashboard.html` | `dashboard.js` | KPI cards, Upcoming Events (30d), Overdue Payment Cycles, quick links |
| Sales Intake | `index.html` | `app.js` | Event intake, billing, payment schedule, online invoice+KYC, DD-MM-YYYY masked dates, food type/allergic precautions, Zone. `?edit=<id>` deep-link |
| Saved Events | `saved-events.html` | `saved-events.js` | List/search/status-change/CSV export/delete; Edit → `index.html?edit=<id>` |
| Event Dashboard | `event-dashboard.html` | `event-dashboard.js` | Single-event 360°: header, payment-schedule cards w/ inline "Mark Received", pre-cost P&L, petty-cash summary |
| Event Log | `event-log.html` | `event-log.js` | Read-only per-event field-change audit trail, dynamic section filters |
| Pre Cost Planning | `pre-cost-planning.html` | `pre-cost-planning.js` | Pick event, enter costs → total cost & profit/loss, Save Plan |
| Petty Cash | `petty-cash.html` | `petty-cash.js` | Pick event, payouts + petty expenses → cash vs billing, Save |
| Financial Control | `financial-control.html` | `financial-control.js` | Per-event money cockpit: collections received, petty-by-person balances, in-house charges, P&L, client "payment received" mail flow |
| Bill Submission | `bill-submission.html` | `bill-submission.js` | Staff expense submission w/ Tesseract.js OCR receipt scan + admin approve/reject queue |
| Analytics | `analytics.html` | `analytics.js` | Chart.js/SheetJS BI dashboard (read-only, client-side over cached events): trends, KPIs, leaderboards, CSV/XLSX/PDF export |
| Admin | `admin.html` | `admin.js` | Users, Active Sessions, Audit Log, System status tabs (admin-role gated) |
| Master Persons | `master-persons.html` | `master-persons.js` | CRUD heads & persons |
| FAQ | `faq.html` | — | Static help |

All write flows still route through `event-store.js`/`master-data.js`'s cache-then-API pattern, **except** `financial-control.js`, `bill-submission.js`, `event-dashboard.js`, which call `fetch`/`apiFetch` directly for endpoints those two modules don't cover (payment-received, in-house-charges, bills).

## Auth — one live system, two dead ones
- **Live, on all 12 app pages:** `auth-guard.js` (loaded first, before `store.js`). Hides document until `GET /api/auth/me` resolves; 401 → redirect to `login.html?next=<path>`; renders full nav from a hardcoded list (filters out Admin link for non-admins); shows `[data-admin-only]` elements only to admins; fire-and-forget `POST /api/admin/page-hit` telemetry (feeds Admin's Sessions tab "last page"); logout clears session + `POST /api/auth/logout`.
- **Dead code — do not use or extend:** `auth-check.js` (older, simpler duplicate of auth-guard.js; zero pages reference it). `firebase-auth.js` / `firebase-backend.js` / `firebase-config.js` / `firestore.rules` — a complete alternate Firestore+Firebase-Auth backend from an abandoned pivot (commit `b619faf`), **never activated**: `firebase-config.js` still has literal `"REPLACE_ME"` placeholders so `window.FIREBASE_READY` is hardcoded `false`, and no HTML page loads any Firebase script. `report_print.html` (a generated report artifact) falsely claims Firebase Auth is live — don't trust it as documentation.

## Key calculations
- `total = floor(pax) * costPerPax * (days||1)`; server always recomputes `totalBilling = base + base*0.05` (hardcoded GST) on every save, overwriting whatever the client sent — client-side `event-store.js` mirrors the same formula only as an optimistic preview.
- Advance (`app.js`): `total*0.5`, locked row, due `eventDate−3d`; recalcs live on pax/cost/days/date change.
- Online invoice: `subtotal = Σ online`, `gst = subtotal*0.05`, `total = subtotal*1.05`. KYC required when any cycle is Online. Server KYC regexes (both backends should match): `mobile /^\d{10}$/`, `pan /^[A-Z]{5}\d{4}[A-Z]$/`, `aadhar /^\d{12}$/`, `gst /^\d{2}[A-Z0-9]{13}$/`, `email /^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
- Pre-cost: `staffCost = staffCount * staffCostPerDay * days`; `totalCost = food+staff+equip+vendor+decor+misc`; `profitLoss = totalBilling − totalCost`; auto `decor = totalBilling*decorRate`.
- Petty: `required = payouts + petty`; `billingAfterRelease = billing − required`.
- Financial Control: `actualCost = approvedBillTotal + directPettyTotal + inHouseTotal`; `actualPL = billing − actualCost` (vs. `plannedPL` from pre-cost).
- Event Dashboard: a payment cycle is "Paid" once `Σ payment_received for that cycle index ≥ cycle.amount`.

## Security posture
- All user data rendered via `textContent`/DOM/`escapeHtml` — no stored XSS. KYC validated client + server side. Strict CSP on every page.
- **Auth now exists** (session cookie `odc_session`, 8h TTL) on both backends — the old "no auth" note is stale. Postgres path adds login rate-limiting (10 attempts/15min → 30min lock) and DB-backed sessions; Sheets/Vercel path uses stateless signed cookies instead (no rate limiting seen there — verify before relying on it).
- ⚠️ Still no encryption-at-rest for KYC PII (Aadhaar/PAN/GST) on either backend — a Google Sheet is arguably a *weaker* PII store than Postgres (broader human access via Sheet sharing settings) — worth a deliberate look if compliance matters.
- `launcher.js` prints a hardcoded default credential (`aiops`/`AIops`) — rotate/remove before any real external exposure via its Cloudflare tunnel.
- Secrets are correctly gitignored: `google-sync-config.json`, `apps-script/.clasp.json`, `.vercel/`, `.ssh/` (a committed-looking `odc_key`/`odc_key.pub` pair lives at repo root but is git-ignored, not tracked).

## DB
- **Postgres (`server.js`'s `initSchema()`, authoritative for the VPS path)** — do NOT trust `database/schema.sql`, it's a stale SQLite-era schema missing `in_house_charges` entirely and missing several runtime-only columns (`payment_cycles.pay_amount/pay_received`, `payment_received.mode/receiver_type/mail_sent_*`). Core tables: `events` (client_id-keyed), `payment_cycles`, `invoice_kyc` (1:1), `master_heads`/`master_persons`, `petty_cash_rows`, `pre_cost_inputs` (1:1), `users`, `sessions`, `audit_log`, `bill_submissions`, `event_field_log`, `payment_received`, `in_house_charges` — all child tables FK → `events.id ON DELETE CASCADE`. Dead/unused tables: `invoices`, `pre_cost_plans`, `pre_cost_items` (schema exists, no endpoint touches them).
- **Google Sheets (Vercel/Apps Script path)** — `apps-script/Code.gs` implements the same entities as sheet tabs (`sheet_()`/`syncSheet()` helpers), with hand-rolled autoincrement and `LockService`-guarded writes instead of real transactions — a save that fails partway can leave a sheet inconsistent (no rollback).

## Legacy / dead files (cleanup candidates — confirmed unused by current code, kept only as history)
- **Firebase pivot** (never activated): `firebase-auth.js`, `firebase-backend.js`, `firebase-config.js`, `firestore.rules`, `firebase-debug.log`, `auth-check.js`.
- **SQLite-era one-off scripts** (not called by current Postgres `server.js`): `google-sync.js`, `setup-google-sheets.js`, `export-data.js`, `fix-master-persons.js` — all use `node:sqlite`/`odc.db`, meant to be run manually, not part of any live request path.
- **Abandoned PaaS deploy configs** (predate the current Vercel+VPS setup, reference stale `DB_PATH=/data/odc.db` SQLite paths): `Dockerfile`, `fly.toml`, `railway.toml`, `nixpacks.toml`, `.dockerignore`.
- `database/schema.sql`, `database/queries.sql` — stale, see DB section above.
- Generated report artifacts (some factually wrong, don't use as docs): `report_print.html`, `ODC_Executive_One_Page_Report.*`, `ODC_Product_OnePager.*`, produced by `gen_report.py`/`generate_report.py`.
- Root-level dev-session clutter (mostly gitignored already): assorted `*.png` screenshots, `Empl list.xlsx`, a `.docx` spec doc, `server.log`/`tunnel.log`, `odc.db` (regenerated).

## Client data layer (globals; load order matters)
- `auth-guard.js` — loaded **first** on every protected page (before `store.js`); see Auth section.
- `store.js` → `window.ODC`: `api()`, `escapeHtml()`, `lsGet/lsSet` cache, `addBoot/registerSync/notifySync`, `ready`, date helpers `dmyToIso()`/`isoToDmy()`/`attachDateMask(input)`. Pages defer init via `ODC.ready.then(init)`, re-render via `ODC.registerSync(...)`.
- `data.js` → `window.ODC_DATA` `{events[], defaults}` — offline first-run fallback only.
- `event-store.js` → events cache + API (`getSavedEvents/getAllEvents/getEventById/upsertEvent/deleteEvent` + petty-cash/pre-cost helpers). Key `odcSavedEvents`.
- `master-data.js` → `getMasterPersons/saveMasterPersons`. Key `odcMasterPersons`.

## Files
Core: `server.js` (Postgres backend), `api/[...path].js` + `apps-script/Code.gs` (Sheets backend via Vercel), `store.js`, `package.json`, `vercel.json`, 16 html + ~30 client js, `styles.css`. Ops: `launcher.js`, `smoke-test.js`, `browser-check.js`, `verify-ui.js`, `scripts/` (dev audits). See "Legacy / dead files" above for what to ignore.

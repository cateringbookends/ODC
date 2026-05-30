# ODC — Codebase Graph

Outdoor-catering (ODC) **Sales Event Dashboard**. Multi-page web app (plain HTML + non-module `<script src>` JS, no framework/build) backed by a **zero-dependency Node + SQLite server** with live reload. Front-end is offline-tolerant: reads run against an in-memory cache (hydrated from `localStorage`, refreshed from the API); writes update the cache and persist to the server in the background.

> This map exists to avoid re-reading files. Trust it; open a file only when changing it. Regenerate after structural edits.

## Run it
- `npm start` (or `node server.js`) → http://localhost:5050  (PORT env overrides; **3000 was busy**, default is 5050).
- Requires Node ≥ 22.5 (uses built-in `node:sqlite`). DB auto-created at `odc.db`, schema from `database/schema.sql`, seeded with 3 sample events + default master persons on first run.
- Live reload: server watches the folder and pushes reloads over SSE (`/__livereload`, injected as external `/__livereload.js` so CSP stays strict).
- Tests: `npm test` (API smoke = `smoke-test.js`). Browser check = `browser-check.js` (needs Playwright; set `NODE_PATH` to the npx playwright cache + `PW_CHROME` to an installed chromium exe).

## Server (`server.js`)
REST API + static file server + live reload. Maps front-end **camelCase ↔ DB snake_case** in one place (resolves the prior data-model mismatch). Validates KYC/numeric input server-side (PAN/Aadhaar/GST/mobile/email formats; empty allowed). All event writes are transactional; children cascade.
Endpoints:
- `GET /api/events` (list, nested `paymentSchedule` + `invoiceKyc`), `POST /api/events` (upsert by `client_id`, recomputes `total_billing`), `DELETE /api/events/:id`.
- `GET|PUT /api/master-persons` (PUT replaces whole heads array).
- `GET|PUT /api/events/:id/petty-cash`, `GET|PUT /api/events/:id/pre-cost`.

## Pages (html ↔ controller js)
| Page | HTML | JS controller | Purpose |
|---|---|---|---|
| Sales Intake (home) | `index.html` | `app.js` | Event intake, billing, payment schedule, online invoice+KYC, **save/edit/delete, status, search, CSV export**; event time, food type (jain/non-jain), allergic count + notes → live "Precautions" readout |
| Pre Cost Planning | `pre-cost-planning.html` | `pre-cost-planning.js` | Pick event, enter costs → total cost & profit/loss, **Save Plan** (persists) |
| Petty Cash | `petty-cash.html` | `petty-cash.js` | Pick event, payouts + petty expenses → cash vs billing, **Save Petty Cash** (persists) |
| Master Persons | `master-persons.html` | `master-persons.js` | CRUD heads & persons |
| FAQ | `faq.html` | — | Static help |

## Client data layer (globals; load order matters)
- `store.js` (**loaded first everywhere**) → `window.ODC`: `api()`, `escapeHtml()`, `lsGet/lsSet` cache, `addBoot/registerSync/notifySync`, and `ready` (promise; resolves after first server hydration on `DOMContentLoaded`). Pages defer init via `ODC.ready.then(init)` and re-render via `ODC.registerSync(...)`.
- `data.js` → `window.ODC_DATA` `{events[], defaults{gstRate .05, advanceRate .5, decorRate .05, staffCostPerDay 1000}}` — now only an **offline first-run fallback** (server is source of truth).
- `event-store.js` → events cache + API: `getSavedEvents/getAllEvents/getEventById/createEventId/createExternalId/upsertEvent/deleteEvent` + `getPettyCash/savePettyCash/getPreCost/savePreCost`. Key `odcSavedEvents`.
- `master-data.js` → `getMasterPersons/saveMasterPersons` (cache + `/api/master-persons`). Key `odcMasterPersons`.

## Load order per page (`store.js` first; cache-bust `?v=3`)
```
store → data → event-store → app                      (index.html)
store → data → event-store → pre-cost-planning         (pre-cost-planning.html)
store → data → event-store → master-data → petty-cash  (petty-cash.html)
store → master-data → master-persons                   (master-persons.html)
```

## Key calculations
- `total = floor(pax) * costPerPax * (days||1)` = `totalBilling`.
- Advance (app.js): `total*0.5`, locked row, due `eventDate−3d`; auto-recalcs again when pax/cost/days/date change (was frozen-after-edit bug — fixed).
- Online invoice: `subtotal = Σ online`, `gst = subtotal*0.05`, `total = subtotal*1.05`. KYC required when any cycle is Online.
- Pre-cost: `staffCost = staffCount * staffCostPerDay * days` (auto, overridable) — staffCount now actually used (was ignored). `totalCost = food + staff + equip + vendor + decor + misc`; `profitLoss = totalBilling − totalCost`; auto `decor = totalBilling*decorRate` (null-guarded).
- Petty: `required = payouts + petty`; `billingAfterRelease = billing − required`.

## Security posture (hardened)
- All user data rendered via `textContent`/DOM nodes or `escapeHtml` — **no stored XSS** (was injectable in event/person names).
- KYC validated client + server side. Strict **CSP** meta on every page (`script-src 'self'`, no inline handlers; fonts allowlisted to googleapis/gstatic).
- ⚠️ Still no auth / no encryption-at-rest for KYC PII (Aadhaar/PAN/GST) — KYC now lives in SQLite, not just localStorage, but a real deployment needs auth + per-user isolation + encryption.

## DB (`database/schema.sql`, SQLite, FKs ON) — now wired to the app
Root `events`; children FK → `events.id ON DELETE CASCADE`. Added `client_id TEXT UNIQUE` (the app's string id) so the app id model maps cleanly.
- `events` (+`event_time`, `food_type` jain|non-jain, `allergic_count`, `allergic_notes` — server `migrate()` ALTERs these into pre-existing DBs), `payment_cycles`(+`is_advance`), `invoice_kyc`(1:1), `invoices`, `pre_cost_plans`/`pre_cost_items` (generic, unused by app).
- **Added:** `master_heads` + `master_persons`, `petty_cash_rows`(payout|petty), `pre_cost_inputs`(1:1 fixed cost fields).

## Files
`server.js` `store.js` `package.json` `smoke-test.js` `browser-check.js` `odc.db`(gitignore-worthy, regenerated) + the 5 html / 7 client js / `styles.css` / `database/{schema,queries}.sql` + `README.md`.

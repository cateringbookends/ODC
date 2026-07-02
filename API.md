# ODC Agent API

A scoped, token-authenticated REST surface that lets an external agent (e.g. an AI
assistant or a script) read and create/update ODC data **without** touching code,
user accounts, or anything destructive. Separate from the app's login sessions and
from the internal Vercel↔Apps Script proxy key.

## What it can and cannot do

| | |
|---|---|
| **Allowed methods** | `GET` (read), `POST` (create), `PUT` (update) |
| **Blocked** | `DELETE` (no deletes at all) |
| **Reachable data** | Events (+ payment schedule, KYC, payment-received, in-house charges), Bills, Petty Cash, Pre-Cost, Master Persons |
| **Blocked paths** | `/api/auth/*` (login, user accounts), `/api/admin/*`, `/api/audit-log`, `/api/mail-log`, `/api/agent-token`, and any `…/mail` email-send endpoint |
| **Rate limit** | 60 requests/minute (HTTP 429 when exceeded) |
| **Audit** | Every write (POST/PUT) is recorded in the Audit Log as user `api-agent` |

## Authentication

An admin generates the token in the app: **Admin → API Access → Generate Token**.
It is shown once — store it securely. Rotating it immediately invalidates the old one.

The agent calls the Apps Script Web App URL directly (shown in Admin → API Access as
**Endpoint**). Every request is a `POST` with a JSON envelope:

```json
{
  "action": "agent_api",
  "agentToken": "odc_agent_xxxxxxxx…",
  "method": "GET|POST|PUT",
  "path": "/api/events",
  "body": { }
}
```

- `method` + `path` describe the REST operation you want.
- `body` is the payload for POST/PUT (ignored for GET). Do not include credentials in it.
- The response is the same JSON the app's own frontend receives for that endpoint,
  or `{ "error": "…" }` with an appropriate HTTP status (403 not permitted, 429 rate
  limited, 400 validation/other).

## Endpoints

| Operation | method | path | body |
|---|---|---|---|
| List events | GET | `/api/events` | — |
| Get one event | GET | `/api/events/<id>` | — |
| Create/update event | POST | `/api/events` | event object (`name`, `date`, `location`, `pax`, `costPerPax`, `paymentSchedule[]`, `invoiceKyc{}`, …) |
| Petty cash (read/save) | GET / PUT | `/api/events/<id>/petty-cash` | `{ payouts:[], petty:[] }` |
| Pre-cost (read/save) | GET / PUT | `/api/events/<id>/pre-cost` | pre-cost fields |
| Payment received | GET / POST | `/api/events/<id>/payment-received` | `{ cycleIndex, amount, mode, receivedBy, … }` |
| In-house charges | GET / POST | `/api/events/<id>/in-house-charges` | `{ head, person, amount, description }` |
| Master persons | GET / PUT | `/api/master-persons` | heads array (with per-person `email`) |
| Bills | GET / POST | `/api/bills` | `{ eventId, headId, personName, amount, category, description }` |

Server-side validation still applies (e.g. KYC formats, required event fields, GST
recompute) — the agent path enforces the exact same rules as the normal app.

## Examples (curl)

Read all events:

```bash
curl -sS -L -X POST "$ODC_ENDPOINT" -H "Content-Type: application/json" \
  --data-binary '{"action":"agent_api","agentToken":"'"$ODC_AGENT_TOKEN"'","method":"GET","path":"/api/events"}'
```

Create/update an event:

```bash
curl -sS -L -X POST "$ODC_ENDPOINT" -H "Content-Type: application/json" \
  --data-binary '{"action":"agent_api","agentToken":"'"$ODC_AGENT_TOKEN"'","method":"POST","path":"/api/events",
    "body":{"name":"Test Event","date":"2026-08-01","location":"Surat","pax":120,"costPerPax":1500,"status":"planning"}}'
```

Attempting a blocked action (returns 403):

```bash
# DELETE is never allowed; user/admin/mail/log paths are never allowed.
curl ... '{"action":"agent_api","agentToken":"…","method":"DELETE","path":"/api/events/EVT-1"}'
# -> {"error":"Agent token cannot use method DELETE (read + create/update only)."}
```

## Notes

- The Apps Script Web App follows a 302 redirect to `script.googleusercontent.com`;
  use a client that follows redirects (`curl -L`) and sends a `Content-Length`.
- Deletes and user management are intentionally not exposed. If a record must be
  removed, do it through the app UI by an authenticated admin.

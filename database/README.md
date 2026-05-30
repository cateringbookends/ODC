# SQLite Storage

This folder is the local storage foundation for the dashboard.

Create a database when SQLite is installed:

```powershell
sqlite3 odc.db ".read database/schema.sql"
```

Main tables:

- `events`: Sales intake event records. Use `status != 'completed'` for Pre Cost Planning dropdowns.
- `payment_cycles`: Advance, cash, and online payment parts for each event.
- `invoice_kyc`: KYC details only for events with online billing.
- `invoices`: Online subtotal, 5% GST, and invoice total.
- `pre_cost_plans`: One planning record per event.
- `pre_cost_items`: Cost line items under a pre cost plan.

Later Google Apps Script mapping:

- One Google Sheet tab can map to each table.
- `external_id` can become the stable sync key between SQLite, Sheets, and Drive folders.
- Generated invoices or uploaded documents can be stored in Google Drive and referenced by `external_id`.

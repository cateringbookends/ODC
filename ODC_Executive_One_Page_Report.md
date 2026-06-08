# ODC Event Dashboard - Executive One Page Report

## Purpose
- Built a centralized event finance and operations dashboard for catering/event teams, covering the complete workflow from booking to final financial control.
- Replaces scattered Excel files, WhatsApp updates, manual receipt tracking, and person-dependent follow-ups with one controlled system.

## What The System Centralizes
- Sales Intake: event booking, PAX, billing, advance schedule, GST, food/allergy notes.
- Pre Cost Planning: food, staff, vendor, decor, equipment, miscellaneous, additional charges, projected profit/loss.
- Petty Cash: assigned payouts by person, small expenses, usage visibility, remaining balance.
- Bill Submission: receipt upload, bill category, head/person mapping, event-wise expense capture.
- Financial Control: payment received, client balance, actual cost, planned vs actual P&L, in-house charges.
- Analytics: revenue, event pipeline, food preference, zone/event contribution, top events.
- Admin Controls: users, active sessions, IP/device visibility, audit logs, system status.
- Google Backend: data stored centrally through Google Sheets/Drive/Apps Script, with Vercel as the production frontend.

## Business Impact
- Single source of truth for event money movement: sales, advance, petty cash, bills, in-house charges, and final P&L are linked to the same event.
- Management can see who changed what, from which login/device/IP, improving accountability and reducing disputes.
- Event profitability can be reviewed before, during, and after execution instead of waiting for manual reconciliation.
- Receipt and bill data becomes event-linked, reducing missing bills and delayed settlement.
- Admin team can monitor active sessions and user access directly from the UI.

## Estimated Time Savings
- Event creation and billing calculation: saves ~10-15 minutes per event by auto-calculating billing, GST, advance, and balance.
- Pre-cost planning: saves ~20-30 minutes per event versus manual spreadsheet formulas and repeated recalculation.
- Petty cash tracking: saves ~20-40 minutes per event by recording person-wise allocation and usage in one place.
- Bill and expense reconciliation: saves ~30-60 minutes per event by tying bills, heads, users, and receipts to the event.
- Monthly management reporting: saves ~1-2 working days per month by replacing manual consolidation with analytics and system reports.
- For 50 events/month, estimated operational saving is ~60-100 staff hours/month.

## Cost Avoidance
- Building this externally as a custom web app with admin, audit logs, event finance modules, Google Drive/Sheets backend, responsive UI, deployment, and testing would typically cost approximately ₹4-8 lakh for an MVP and ₹10-18 lakh for a polished production version.
- Ongoing external maintenance would likely cost ₹40,000-₹1,00,000/month depending on support scope, feature changes, and integrations.
- In-house development avoided vendor lock-in, reduced iteration cost, and allowed fast changes based on real workflow feedback.

## Control And Compliance Benefits
- Every critical action can be logged with user, time, device/browser, IP, and changed entity.
- Active sessions allow admin review of how many places one account is logged in and force logout if needed.
- Centralized roles reduce uncontrolled access to financial and operational records.
- Google Drive/Sheets backend keeps data in a familiar business ecosystem while the Vercel frontend provides a professional web experience.

## Current Status
- Core modules are live: Sales Intake, Saved Events, Pre Cost, Petty Cash, Bill Submission, Financial Control, Analytics, Master Persons, Admin, and FAQ.
- Recent stability fixes removed full-page refresh behavior in Admin live sections.
- Audit Log and Active Sessions now update live without rebuilding the full panel.
- Frontend is maintained only in GitHub/Vercel; Apps Script is kept backend-only.

## Next High-Value Upgrades
- Improve mobile and wide-screen layouts for faster daily use.
- Add stronger validations for negative/over-limit amounts, duplicate entries, and required fields.
- Add exportable event-wise P&L and settlement reports.
- Add email receipt templates and one-click client payment confirmation mails.
- Add dashboard filters by date, event status, sales person, food type, and department head.

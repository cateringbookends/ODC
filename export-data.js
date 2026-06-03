/**
 * export-data.js — export all SQLite data to JSON for Firebase import
 * Run: node export-data.js
 * Output: odc-export.json
 */
"use strict";
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const db = new DatabaseSync(path.join(__dirname, "odc.db"));
db.exec("PRAGMA foreign_keys = ON;");

const events = db.prepare("SELECT * FROM events ORDER BY event_date").all();
const cycles = db.prepare("SELECT * FROM payment_cycles ORDER BY event_id, id").all();
const kycs   = db.prepare("SELECT * FROM invoice_kyc").all();
const cycleMap = {}, kycMap = {};
for (const c of cycles) { (cycleMap[c.event_id] = cycleMap[c.event_id] || []).push(c); }
for (const k of kycs)   { kycMap[k.event_id] = k; }

const exportEvents = events.map(r => {
  const cs = (cycleMap[r.id] || []).map(c => ({
    label: c.cycle_name, dueDate: c.due_date || "", amount: c.amount,
    billing: c.billing_type, method: c.online_method || "", isAdvance: !!c.is_advance
  }));
  const k = kycMap[r.id];
  return {
    id: r.client_id, externalId: r.external_id || "",
    entryDate: r.entry_date, date: r.event_date,
    name: r.event_name, location: r.location,
    locationZone: r.location_zone || "", pax: r.pax, days: r.event_days,
    costPerPax: r.cost_per_pax, totalBilling: r.total_billing,
    status: r.status, time: r.event_time || "",
    foodType: r.food_type || "", allergicCount: r.allergic_count || 0,
    allergicNotes: r.allergic_notes || "",
    paymentSchedule: cs,
    invoiceKyc: k ? { name: k.client_name||"", mobile: k.mobile||"", email: k.email||"", gst: k.gst_number||"", pan: k.pan_number||"", aadhar: k.aadhar_number||"" } : {},
    createdAt: r.created_at, updatedAt: r.updated_at
  };
});

const heads = db.prepare("SELECT * FROM master_heads ORDER BY sort_order").all();
const masterPersons = heads.map(h => ({
  id: h.id, name: h.name,
  persons: db.prepare("SELECT * FROM master_persons WHERE head_id = ? ORDER BY sort_order, id").all(h.id).map(p => ({
    name: p.person_name, code: p.person_code||"",
    designation: p.person_designation||"", department: p.person_department||"",
    location: p.person_location||""
  }))
}));

const pettyRows = db.prepare("SELECT pc.*, e.client_id as event_client_id FROM petty_cash_rows pc JOIN events e ON e.id = pc.event_id").all();
const pettyCash = {};
for (const r of pettyRows) {
  const eid = r.event_client_id;
  if (!pettyCash[eid]) pettyCash[eid] = { payouts: [], petty: [] };
  if (r.row_type === "payout") pettyCash[eid].payouts.push({ headId: r.head_id||"", person: r.person_name||"", purpose: r.purpose||"", amount: r.amount });
  else pettyCash[eid].petty.push({ expense: r.person_name||"", purpose: r.purpose||"", amount: r.amount });
}

const PRECOST_COLS = ["food_cost_per_pax","staff_count","total_staff_cost","equipment_depreciation","third_party_vendor","decor_charge","miscellaneous_cost","staff_transportation_charge","staff_accommodation_charge","staff_food_cost","refervan_charge","equipment_transportation_charge","total_cost","profit_loss"];
const CAMEL = ["foodCostPerPax","staffCount","totalStaffCost","equipmentDepreciation","thirdPartyVendor","decorCharge","miscellaneousCost","staffTransportationCharge","staffAccommodationCharge","staffFoodCost","refervanCharge","equipmentTransportationCharge","totalCost","profitLoss"];
const preCostRows = db.prepare("SELECT pc.*, e.client_id as eid FROM pre_cost_inputs pc JOIN events e ON e.id = pc.event_id").all();
const preCost = {};
for (const r of preCostRows) {
  preCost[r.eid] = Object.fromEntries(CAMEL.map((f, i) => [f, r[PRECOST_COLS[i]] || 0]));
}

const bills = db.prepare("SELECT bs.*, e.client_id as event_client_id, e.event_name FROM bill_submissions bs JOIN events e ON e.id = bs.event_id").all().map(r => ({
  eventId: r.event_client_id, eventName: r.event_name,
  headId: r.head_id, personName: r.person_name,
  amount: r.amount, description: r.description||"",
  category: r.category, status: r.status,
  submittedAt: r.submitted_at, reviewedBy: r.reviewed_by||"", reviewedAt: r.reviewed_at||""
}));

const output = { events: exportEvents, masterPersons, pettyCash, preCost, bills };
fs.writeFileSync("odc-export.json", JSON.stringify(output, null, 2));
console.log(`Exported:`);
console.log(`  Events: ${exportEvents.length}`);
console.log(`  Heads:  ${masterPersons.length}`);
console.log(`  Bills:  ${bills.length}`);
console.log(`  File:   odc-export.json`);

#!/usr/bin/env node
"use strict";

/**
 * setup-google-sheets.js — one-time setup + full data sync to Google Sheets
 *
 * Usage:
 *   node setup-google-sheets.js           — setup sheets + full sync
 *   node setup-google-sheets.js --status  — check Apps Script connectivity
 *   node setup-google-sheets.js --sync    — full sync only (no setup)
 */

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, "google-sync-config.json");
const DB_PATH = path.join(ROOT, "odc.db");
const GST_RATE = 0.05;

/* ---- Load config ---- */
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`\nConfig file not found: ${CONFIG_PATH}`);
  console.error("Create it from google-sync-config.example.json and fill in your details.\n");
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8").replace(/^\uFEFF/, ""));
if (!cfg.scriptUrl || !cfg.apiKey) {
  console.error("google-sync-config.json must have scriptUrl and apiKey.\n");
  process.exit(1);
}

/* ---- DB access ---- */
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");

/* ---- HTTP helper (with redirect following) ---- */
function post(action, payload) {
  return fetch(cfg.scriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "ODC-Setup/1.0" },
    body: JSON.stringify({ apiKey: cfg.apiKey, action, ...payload }),
    redirect: "follow"
  }).then(async (res) => {
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }
    if (!res.ok || data.error || data.raw) throw new Error(data.error || `Google setup HTTP ${res.status}: ${raw.slice(0, 160)}`);
    return data;
  });
}

function getStatus() {
  const url = new URL(cfg.scriptUrl);
  url.searchParams.set("apiKey", cfg.apiKey);
  url.searchParams.set("action", "status");
  return fetch(url, { headers: { "User-Agent": "ODC-Setup/1.0" }, redirect: "follow" }).then(async (res) => {
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }
    if (!res.ok || data.error || data.raw) throw new Error(data.error || `Google status HTTP ${res.status}: ${raw.slice(0, 160)}`);
    return data;
  });
}

/* ---- Read all data from SQLite ---- */
function getAllEvents() {
  const rows = db.prepare("SELECT * FROM events ORDER BY event_date").all();
  const cycles = db.prepare("SELECT * FROM payment_cycles ORDER BY event_id, id").all();
  const kycs = db.prepare("SELECT * FROM invoice_kyc").all();

  const cycleMap = new Map();
  for (const c of cycles) {
    if (!cycleMap.has(c.event_id)) cycleMap.set(c.event_id, []);
    cycleMap.get(c.event_id).push(c);
  }
  const kycMap = new Map(kycs.map((k) => [k.event_id, k]));

  return rows.map((r) => {
    const cs = cycleMap.get(r.id) || [];
    const k = kycMap.get(r.id);
    return {
      id: r.client_id, externalId: r.external_id, entryDate: r.entry_date,
      date: r.event_date, name: r.event_name, location: r.location,
      locationZone: r.location_zone || "", pax: r.pax, days: r.event_days,
      costPerPax: r.cost_per_pax, totalBilling: r.total_billing, status: r.status,
      time: r.event_time || "", foodType: r.food_type || "",
      allergicCount: r.allergic_count || 0, allergicNotes: r.allergic_notes || "",
      paymentSchedule: cs.map((c) => ({
        label: c.cycle_name, dueDate: c.due_date || "", amount: c.amount,
        billing: c.billing_type, method: c.online_method || "", isAdvance: !!c.is_advance
      })),
      invoiceKyc: k
        ? { name: k.client_name || "", mobile: k.mobile || "", email: k.email || "",
            gst: k.gst_number || "", pan: k.pan_number || "", aadhar: k.aadhar_number || "" }
        : {}
    };
  });
}

function getMasterPersons() {
  const heads = db.prepare("SELECT * FROM master_heads ORDER BY sort_order").all();
  return heads.map((h) => ({
    id: h.id, name: h.name,
    persons: db.prepare(
      "SELECT * FROM master_persons WHERE head_id = ? ORDER BY sort_order, id"
    ).all(h.id).map((p) => ({
      name: p.person_name, code: p.person_code || "",
      designation: p.person_designation || "", department: p.person_department || "",
      location: p.person_location || ""
    }))
  }));
}

function getAllPettyCash(events) {
  return events.map((ev) => {
    const evRow = db.prepare("SELECT id FROM events WHERE client_id = ?").get(ev.id);
    if (!evRow) return { eventId: ev.id, eventName: ev.name, data: { payouts: [], petty: [] } };
    const rows = db.prepare("SELECT * FROM petty_cash_rows WHERE event_id = ? ORDER BY row_type, sort_order").all(evRow.id);
    const payouts = [], petty = [];
    for (const r of rows) {
      if (r.row_type === "payout") payouts.push({ headId: r.head_id, person: r.person_name, purpose: r.purpose, amount: r.amount });
      else petty.push({ expense: r.person_name, purpose: r.purpose, amount: r.amount });
    }
    return { eventId: ev.id, eventName: ev.name, data: { payouts, petty } };
  });
}

function getAllPreCost(events) {
  const PRECOST_FIELDS = ["food_cost_per_pax","staff_count","total_staff_cost","equipment_depreciation","third_party_vendor","decor_charge","miscellaneous_cost","staff_transportation_charge","staff_accommodation_charge","staff_food_cost","refervan_charge","equipment_transportation_charge","total_cost","profit_loss"];
  const CAMEL = ["foodCostPerPax","staffCount","totalStaffCost","equipmentDepreciation","thirdPartyVendor","decorCharge","miscellaneousCost","staffTransportationCharge","staffAccommodationCharge","staffFoodCost","refervanCharge","equipmentTransportationCharge","totalCost","profitLoss"];
  return events.map((ev) => {
    const evRow = db.prepare("SELECT id FROM events WHERE client_id = ?").get(ev.id);
    const row = evRow ? db.prepare("SELECT * FROM pre_cost_inputs WHERE event_id = ?").get(evRow.id) : null;
    const data = Object.fromEntries(CAMEL.map((f, i) => [f, row ? (row[PRECOST_FIELDS[i]] || 0) : 0]));
    return { eventId: ev.id, eventName: ev.name, data };
  });
}

function getAllBills() {
  const rows = db.prepare(`
    SELECT bs.*, e.event_name, e.client_id AS event_client_id, mh.name AS head_name
    FROM bill_submissions bs
    JOIN events e ON e.id = bs.event_id
    LEFT JOIN master_heads mh ON mh.id = bs.head_id
    ORDER BY bs.submitted_at DESC
  `).all();
  return rows.map((r) => ({
    id: r.id, eventName: r.event_name, eventClientId: r.event_client_id,
    submittedByUserId: r.submitted_by_user_id, headId: r.head_id, headName: r.head_name || r.head_id,
    personName: r.person_name, amount: r.amount, description: r.description || "",
    category: r.category, status: r.status, submittedAt: r.submitted_at,
    reviewedBy: r.reviewed_by || "", reviewedAt: r.reviewed_at || "",
    receiptFileName: r.receipt_file_name || "", receiptDriveUrl: r.receipt_drive_url || ""
  }));
}

/* ---- Main ---- */
const args = process.argv.slice(2);
const doSetup = !args.includes("--sync");
const statusOnly = args.includes("--status");

(async () => {
  console.log("\n ODC → Google Sheets Setup");
  console.log("─".repeat(40));

  if (statusOnly) {
    console.log("Checking connectivity...");
    try {
      const res = await getStatus();
      console.log("Response:", JSON.stringify(res));
    } catch (e) {
      console.error("Failed:", e.message);
      // Try GET status
      console.log("Try opening in browser:", cfg.scriptUrl + "?apiKey=" + cfg.apiKey + "&action=status");
    }
    return;
  }

  try {
    // 1. Setup sheet tabs
    if (doSetup) {
      process.stdout.write("Creating sheet tabs...");
      const r = await post("setup", {});
      console.log(" " + (r.ok ? "done" : JSON.stringify(r)));
    }

    // 2. Load all data
    console.log("Loading data from SQLite...");
    const events = getAllEvents();
    const heads = getMasterPersons();
    const pettyCash = getAllPettyCash(events);
    const preCost = getAllPreCost(events);
    const bills = getAllBills();
    console.log(`  Events: ${events.length}  |  Heads: ${heads.length}  |  Bills: ${bills.length}`);

    // 3. Sync each table
    const tables = [
      ["Events", "sync", { sheet: "Events", rows: events.map((e) => [e.id, e.externalId||"", e.entryDate||"", e.date, e.name, e.location, e.locationZone||"", e.pax, e.days, e.costPerPax, e.totalBilling, e.status, e.time||"", e.foodType||"", e.allergicCount||0, e.allergicNotes||""]) }],
      ["PaymentSchedule", "sync", { sheet: "PaymentSchedule", rows: events.flatMap((ev) => (ev.paymentSchedule||[]).map((c) => [ev.id, c.label, c.dueDate||"", c.amount, c.billing, c.method||"", c.isAdvance?"Yes":"No"])) }],
      ["InvoiceKYC", "sync", { sheet: "InvoiceKYC", rows: events.filter((ev) => Object.values(ev.invoiceKyc||{}).some((v)=>String(v||"").trim())).map((ev) => { const k=ev.invoiceKyc||{}; return [ev.id, k.name||"", k.mobile||"", k.email||"", k.gst||"", k.pan||"", k.aadhar||""]; }) }],
      ["MasterPersons", "sync", { sheet: "MasterPersons", rows: heads.flatMap((h) => h.persons.length ? h.persons.map((p)=>[h.id,h.name,p.name,p.code||"",p.designation||"",p.department||"",p.location||""]) : [[h.id,h.name,"","","","",""]]) }],
      ["PettyCash", "sync", { sheet: "PettyCash", rows: pettyCash.flatMap(({eventId,eventName,data}) => [...(data.payouts||[]).map((r)=>[eventId,eventName||"","Payout",r.headId||"",r.person||"",r.purpose||"",r.amount]), ...(data.petty||[]).map((r)=>[eventId,eventName||"","Petty","",r.expense||"",r.purpose||"",r.amount])]) }],
      ["PreCost", "sync", { sheet: "PreCost", rows: preCost.map(({eventId,eventName,data:d})=>[eventId,eventName||"",d.foodCostPerPax,d.staffCount,d.totalStaffCost,d.equipmentDepreciation,d.thirdPartyVendor,d.decorCharge,d.miscellaneousCost,d.staffTransportationCharge,d.staffAccommodationCharge,d.staffFoodCost,d.refervanCharge,d.equipmentTransportationCharge,d.totalCost,d.profitLoss]) }],
      ["BillSubmissions", "sync", { sheet: "BillSubmissions", rows: bills.map((b)=>[b.id,b.eventName||b.eventClientId||"",b.submittedByUserId||"",b.headName||b.headId,b.personName,b.amount,b.description||"",b.category,b.status,b.submittedAt,b.reviewedBy||"",b.reviewedAt||"",b.receiptFileName||"",b.receiptDriveUrl||""]) }]
    ];

    for (const [label, action, payload] of tables) {
      process.stdout.write(`  Syncing ${label} (${(payload.rows||[]).length} rows)...`);
      const r = await post(action, payload);
      console.log(" " + (r.ok ? "ok" : JSON.stringify(r)));
    }

    console.log("\n All done! Open your Google Sheet to see the data.");
    console.log(" From now on, the server auto-syncs in the background after every write.\n");

  } catch (err) {
    console.error("\nError:", err.message);
    console.error("Check: script URL is correct, API_KEY matches, web app is deployed as Anyone.\n");
    process.exit(1);
  }
})();

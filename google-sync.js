"use strict";

/**
 * google-sync.js — async background sync from SQLite → Google Sheets
 *
 * All push() calls use setImmediate so they never block API responses.
 * Failed syncs log a warning but do NOT crash the server.
 *
 * Config file: google-sync-config.json (gitignored)
 * {
 *   "scriptUrl": "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec",
 *   "apiKey": "your-secret-api-key"
 * }
 */

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.join(__dirname, "google-sync-config.json");
let cfg = null;

/* ----------------------------------------------------------------------- */
/* Init                                                                      */
/* ----------------------------------------------------------------------- */

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8").replace(/^\uFEFF/, ""));
    if (!raw.scriptUrl || !raw.apiKey) return false;
    cfg = raw;
    console.log("[google-sync] enabled — syncing to Google Sheets");
    return true;
  } catch (e) {
    console.warn("[google-sync] config error:", e.message);
    return false;
  }
}

function isEnabled() { return !!cfg; }

/* ----------------------------------------------------------------------- */
/* HTTP (follows redirects — Apps Script uses 302)                          */
/* ----------------------------------------------------------------------- */

function httpsPost(urlStr, bodyBuf) {
  fetch(urlStr, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "ODC-Sync/1.0" },
    body: bodyBuf,
    redirect: "follow"
  }).then(async (res) => {
    const raw = await res.text();
    if (!res.ok) console.warn(`[google-sync] HTTP ${res.status}: ${raw.slice(0, 120)}`);
    else {
      try {
        const data = raw ? JSON.parse(raw) : {};
        if (data.error) console.warn("[google-sync]", data.error);
      } catch {
        if (raw) console.warn("[google-sync] unexpected response:", raw.slice(0, 120));
      }
    }
  }).catch((e) => console.warn("[google-sync] request error:", e.message));
}

function push(action, payload) {
  if (!cfg) return;
  const body = Buffer.from(JSON.stringify({ apiKey: cfg.apiKey, action, ...payload }));
  setImmediate(() => httpsPost(cfg.scriptUrl, body, 0));
}

function httpsPostJson(urlStr, payload) {
  return fetch(urlStr, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "ODC-Sync/1.0" },
    body: JSON.stringify(payload),
    redirect: "follow"
  }).then(async (res) => {
    const raw = await res.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    if (!res.ok || data.error || data.raw) {
      throw new Error(data.error || `Google sync HTTP ${res.status}: ${raw.slice(0, 120)}`);
    }
    return data;
  });
}

/* ----------------------------------------------------------------------- */
/* Public sync functions — called from server.js after writes               */
/* ----------------------------------------------------------------------- */

function syncEvents(events) {
  const rows = events.map((e) => [
    e.id, e.externalId || "", e.entryDate || "", e.date, e.name, e.location,
    e.locationZone || "", e.pax, e.days, e.costPerPax, e.totalBilling,
    e.status, e.time || "", e.foodType || "", e.allergicCount || 0, e.allergicNotes || ""
  ]);
  push("sync", { sheet: "Events", rows });
}

function syncPaymentSchedule(events) {
  const rows = [];
  for (const ev of events) {
    for (const c of (ev.paymentSchedule || [])) {
      rows.push([ev.id, c.label, c.dueDate || "", c.amount, c.billing, c.method || "", c.isAdvance ? "Yes" : "No"]);
    }
  }
  push("sync", { sheet: "PaymentSchedule", rows });
}

function syncInvoiceKYC(events) {
  const rows = [];
  for (const ev of events) {
    const k = ev.invoiceKyc || {};
    if ([k.name, k.mobile, k.pan, k.gst, k.aadhar].some((v) => String(v || "").trim())) {
      rows.push([ev.id, k.name || "", k.mobile || "", k.email || "", k.gst || "", k.pan || "", k.aadhar || ""]);
    }
  }
  push("sync", { sheet: "InvoiceKYC", rows });
}

function syncMasterPersons(heads) {
  const rows = [];
  for (const h of heads) {
    if (!h.persons || h.persons.length === 0) {
      rows.push([h.id, h.name, "", "", "", "", ""]);
    } else {
      for (const p of h.persons) {
        rows.push([h.id, h.name, p.name, p.code || "", p.designation || "", p.department || "", p.location || ""]);
      }
    }
  }
  push("sync", { sheet: "MasterPersons", rows });
}

function syncPettyCash(allCashData) {
  // allCashData: [{ eventId, eventName, data: { payouts, petty } }]
  const rows = [];
  for (const { eventId, eventName, data } of allCashData) {
    for (const r of (data.payouts || [])) {
      rows.push([eventId, eventName || "", "Payout", r.headId || "", r.person || "", r.purpose || "", r.amount]);
    }
    for (const r of (data.petty || [])) {
      rows.push([eventId, eventName || "", "Petty", "", r.expense || "", r.purpose || "", r.amount]);
    }
  }
  push("sync", { sheet: "PettyCash", rows });
}

function syncPreCost(allPreCost) {
  // allPreCost: [{ eventId, eventName, data: {...} }]
  const rows = allPreCost.map(({ eventId, eventName, data: d }) => [
    eventId, eventName || "",
    d.foodCostPerPax, d.staffCount, d.totalStaffCost,
    d.equipmentDepreciation, d.thirdPartyVendor, d.decorCharge,
    d.miscellaneousCost, d.staffTransportationCharge, d.staffAccommodationCharge,
    d.staffFoodCost, d.refervanCharge, d.equipmentTransportationCharge,
    d.totalCost, d.profitLoss
  ]);
  push("sync", { sheet: "PreCost", rows });
}

function syncBills(bills) {
  const rows = bills.map((b) => [
    b.id, b.eventName || b.eventClientId || "", b.submittedByUserId || "",
    b.headName || b.headId, b.personName, b.amount,
    b.description || "", b.category, b.status,
    b.submittedAt, b.reviewedBy || "", b.reviewedAt || "",
    b.receiptFileName || "", b.receiptDriveUrl || ""
  ]);
  push("sync", { sheet: "BillSubmissions", rows });
}

async function uploadReceipt(file) {
  if (!cfg) throw new Error("Google sync is not configured.");
  return httpsPostJson(cfg.scriptUrl, {
    apiKey: cfg.apiKey,
    action: "upload_receipt",
    fileName: file.fileName,
    mimeType: file.mimeType,
    base64: file.base64,
    eventName: file.eventName || "",
    billId: file.billId || ""
  });
}

function appendAuditLog(entry) {
  if (!entry) return;
  push("append_audit", {
    row: [
      entry.id || "", entry.username || "", entry.action || "",
      entry.entity_type || "", entry.entity_id || "", entry.detail || "",
      entry.ip_address || "", (entry.user_agent || "").slice(0, 80), entry.ts || ""
    ]
  });
}

module.exports = {
  loadConfig,
  isEnabled,
  syncEvents,
  syncPaymentSchedule,
  syncInvoiceKYC,
  syncMasterPersons,
  syncPettyCash,
  syncPreCost,
  syncBills,
  uploadReceipt,
  appendAuditLog
};

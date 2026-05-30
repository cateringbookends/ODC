"use strict";

/**
 * ODC Sales Event Dashboard — zero-dependency Node server.
 *  - Serves the static front-end with live-reload (SSE + fs.watch).
 *  - REST API backed by SQLite (node:sqlite, built into Node >= 22.5).
 *  - Maps the front-end's camelCase shapes to the snake_case DB schema
 *    (resolves the camelCase/snake_case data-model mismatch in one place).
 *  - Validates KYC / numeric input server-side.
 *
 * Run:  node server.js   (or: npm start)
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5050;
const DB_PATH = path.join(ROOT, "odc.db");

/* ----------------------------------------------------------------------- *
 * Database
 * ----------------------------------------------------------------------- */

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");
db.exec(fs.readFileSync(path.join(ROOT, "database", "schema.sql"), "utf8"));

// Idempotent migrations for DBs created before a column existed.
function migrate() {
  const stmts = [
    "ALTER TABLE events ADD COLUMN event_time TEXT",
    "ALTER TABLE events ADD COLUMN food_type TEXT",
    "ALTER TABLE events ADD COLUMN allergic_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE events ADD COLUMN allergic_notes TEXT"
  ];
  for (const sql of stmts) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }
}
migrate();

// Seed sample events + master persons on first run (mirrors data.js / master-data.js).
function seed() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
  if (count === 0) {
    const samples = [
      { client_id: "1", external_id: "EVT-2026-001", entry_date: "2026-05-01", event_date: "2026-06-28", event_name: "Grand Royal Wedding Reception", location: "Elysian Palace, Bangalore", pax: 350, event_days: 2, cost_per_pax: 1500, status: "planning" },
      { client_id: "2", external_id: "EVT-2026-002", entry_date: "2026-05-01", event_date: "2026-07-12", event_name: "Tech Summit Corporate Dinner", location: "Ritz-Carlton, Bangalore", pax: 150, event_days: 1, cost_per_pax: 2200, status: "open" },
      { client_id: "3", external_id: "EVT-2026-003", entry_date: "2026-05-01", event_date: "2026-05-30", event_name: "Annual Gala Dinner", location: "Lakeside Pavilion, Hyderabad", pax: 500, event_days: 1, cost_per_pax: 1800, status: "open" }
    ];
    const ins = db.prepare(
      `INSERT INTO events (client_id, external_id, entry_date, event_date, event_name, location, pax, event_days, cost_per_pax, total_billing, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const s of samples) {
      ins.run(s.client_id, s.external_id, s.entry_date, s.event_date, s.event_name, s.location, s.pax, s.event_days, s.cost_per_pax, s.pax * s.event_days * s.cost_per_pax, s.status);
    }
  }

  const heads = db.prepare("SELECT COUNT(*) AS n FROM master_heads").get().n;
  if (heads === 0) {
    const defaults = [
      { id: "head-operations", name: "Operations Head", persons: ["Floor Manager", "Logistics Lead", "Service Supervisor"] },
      { id: "head-kitchen", name: "Kitchen Head", persons: ["Head Chef", "Food Runner Lead", "Utility Lead"] }
    ];
    writeMasterPersons(defaults);
  }
}

/* ---- Event mapping (DB row <-> API JSON) ---- */

function mapEventRow(row) {
  const cycles = db.prepare("SELECT * FROM payment_cycles WHERE event_id = ? ORDER BY id").all(row.id);
  const kyc = db.prepare("SELECT * FROM invoice_kyc WHERE event_id = ?").get(row.id);
  return {
    id: row.client_id,
    externalId: row.external_id,
    entryDate: row.entry_date,
    date: row.event_date,
    name: row.event_name,
    location: row.location,
    pax: row.pax,
    days: row.event_days,
    costPerPax: row.cost_per_pax,
    totalBilling: row.total_billing,
    status: row.status,
    time: row.event_time || "",
    foodType: row.food_type || "",
    allergicCount: row.allergic_count || 0,
    allergicNotes: row.allergic_notes || "",
    paymentSchedule: cycles.map((c) => ({
      label: c.cycle_name,
      dueDate: c.due_date || "",
      amount: c.amount,
      billing: c.billing_type,
      method: c.online_method || "UPI",
      isAdvance: !!c.is_advance
    })),
    invoiceKyc: kyc
      ? { name: kyc.client_name || "", mobile: kyc.mobile || "", email: kyc.email || "", gst: kyc.gst_number || "", pan: kyc.pan_number || "", aadhar: kyc.aadhar_number || "" }
      : { name: "", mobile: "", email: "", gst: "", pan: "", aadhar: "" }
  };
}

function getAllEvents() {
  return db.prepare("SELECT * FROM events ORDER BY event_date").all().map(mapEventRow);
}

function findEventRow(clientId) {
  return db.prepare("SELECT * FROM events WHERE client_id = ?").get(String(clientId));
}

/* ---- Validation ---- */

const PATTERNS = {
  mobile: /^\d{10}$/,
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  aadhar: /^\d{12}$/,
  gst: /^\d{2}[A-Z0-9]{13}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
};

function validateEvent(e) {
  const errors = [];
  const s = (v) => (v == null ? "" : String(v)).trim();
  if (!s(e.name)) errors.push("Event name is required.");
  if (!s(e.date)) errors.push("Event date is required.");
  if (!s(e.location)) errors.push("Location is required.");
  if (!(Number(e.pax) > 0)) errors.push("PAX must be greater than 0.");
  if (!(Number(e.costPerPax) > 0)) errors.push("Cost per PAX must be greater than 0.");
  const status = s(e.status) || "open";
  if (!["open", "planning", "completed", "cancelled"].includes(status)) errors.push("Invalid status.");
  const foodType = s(e.foodType);
  if (foodType && !["jain", "non-jain"].includes(foodType)) errors.push("Food type must be Jain or Non-Jain.");
  if (e.allergicCount !== undefined && e.allergicCount !== null && e.allergicCount !== "" && !(Number(e.allergicCount) >= 0)) errors.push("Allergic count must be 0 or more.");

  const k = e.invoiceKyc || {};
  const checkFmt = (val, key, label) => {
    const v = s(val).toUpperCase();
    const raw = s(val);
    if (raw && !PATTERNS[key].test(key === "email" ? raw : v)) errors.push(`${label} format is invalid.`);
  };
  checkFmt(k.mobile, "mobile", "Mobile");
  checkFmt(k.pan, "pan", "PAN");
  checkFmt(k.aadhar, "aadhar", "Aadhaar");
  checkFmt(k.gst, "gst", "GST");
  if (s(k.email) && !PATTERNS.email.test(s(k.email))) errors.push("Email format is invalid.");
  return errors;
}

/* ---- Event write (upsert by client_id, transactional) ---- */

function upsertEvent(e) {
  const errors = validateEvent(e);
  if (errors.length) {
    const err = new Error(errors.join(" "));
    err.statusCode = 400;
    throw err;
  }

  const pax = Math.floor(Number(e.pax)) || 0;
  const days = Number(e.days) > 0 ? Math.floor(Number(e.days)) : 1;
  const costPerPax = Number(e.costPerPax) || 0;
  const totalBilling = pax * days * costPerPax;
  const status = (e.status && String(e.status).trim()) || "open";
  const clientId = String(e.id || `EVT-${Date.now()}`);
  const eventTime = (e.time && String(e.time).trim()) || null;
  const foodType = (e.foodType && String(e.foodType).trim()) || null;
  const allergicCount = Math.max(Math.floor(Number(e.allergicCount) || 0), 0);
  const allergicNotes = (e.allergicNotes != null ? String(e.allergicNotes).trim() : "") || null;

  db.exec("BEGIN");
  try {
    const existing = findEventRow(clientId);
    let eventId;
    if (existing) {
      db.prepare(
        `UPDATE events SET external_id=?, entry_date=?, event_date=?, event_name=?, location=?, pax=?, event_days=?, cost_per_pax=?, total_billing=?, status=?, event_time=?, food_type=?, allergic_count=?, allergic_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).run(e.externalId || existing.external_id, e.entryDate || "", e.date, e.name.trim(), e.location.trim(), pax, days, costPerPax, totalBilling, status, eventTime, foodType, allergicCount, allergicNotes, existing.id);
      eventId = existing.id;
      db.prepare("DELETE FROM payment_cycles WHERE event_id = ?").run(eventId);
      db.prepare("DELETE FROM invoice_kyc WHERE event_id = ?").run(eventId);
    } else {
      const info = db.prepare(
        `INSERT INTO events (client_id, external_id, entry_date, event_date, event_name, location, pax, event_days, cost_per_pax, total_billing, status, event_time, food_type, allergic_count, allergic_notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(clientId, e.externalId || "", e.entryDate || "", e.date, e.name.trim(), e.location.trim(), pax, days, costPerPax, totalBilling, status, eventTime, foodType, allergicCount, allergicNotes);
      eventId = info.lastInsertRowid;
    }

    const cycles = Array.isArray(e.paymentSchedule) ? e.paymentSchedule : [];
    const insCycle = db.prepare(
      `INSERT INTO payment_cycles (event_id, cycle_name, due_date, amount, billing_type, online_method, is_advance)
       VALUES (?,?,?,?,?,?,?)`
    );
    for (const c of cycles) {
      const billing = c.billing === "online" ? "online" : "cash";
      const method = billing === "online" ? (["UPI", "Card", "Cheque", "Bank Transfer"].includes(c.method) ? c.method : "UPI") : null;
      insCycle.run(eventId, String(c.label || "Payment").trim() || "Payment", c.dueDate || null, Number(c.amount) || 0, billing, method, c.isAdvance ? 1 : 0);
    }

    const k = e.invoiceKyc || {};
    const hasKyc = ["name", "mobile", "email", "gst", "pan", "aadhar"].some((key) => String(k[key] || "").trim());
    if (hasKyc) {
      db.prepare(
        `INSERT INTO invoice_kyc (event_id, client_name, mobile, email, gst_number, pan_number, aadhar_number)
         VALUES (?,?,?,?,?,?,?)`
      ).run(eventId, String(k.name || "").trim(), String(k.mobile || "").trim(), String(k.email || "").trim(), String(k.gst || "").trim().toUpperCase(), String(k.pan || "").trim().toUpperCase(), String(k.aadhar || "").trim());
    }

    db.exec("COMMIT");
    return mapEventRow(findEventRow(clientId));
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function deleteEvent(clientId) {
  const row = findEventRow(clientId);
  if (!row) return false;
  db.prepare("DELETE FROM events WHERE id = ?").run(row.id);
  return true;
}

/* ---- Master persons ---- */

function readMasterPersons() {
  const heads = db.prepare("SELECT * FROM master_heads ORDER BY sort_order, name").all();
  return heads.map((h) => ({
    id: h.id,
    name: h.name,
    persons: db.prepare("SELECT person_name FROM master_persons WHERE head_id = ? ORDER BY sort_order, id").all(h.id).map((p) => p.person_name)
  }));
}

function writeMasterPersons(heads) {
  if (!Array.isArray(heads)) {
    const err = new Error("Expected an array of heads.");
    err.statusCode = 400;
    throw err;
  }
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM master_persons; DELETE FROM master_heads;");
    const insHead = db.prepare("INSERT INTO master_heads (id, name, sort_order) VALUES (?,?,?)");
    const insPerson = db.prepare("INSERT INTO master_persons (head_id, person_name, sort_order) VALUES (?,?,?)");
    heads.forEach((h, hi) => {
      const id = String(h.id || `head-${hi}`).trim();
      const name = String(h.name || "").trim();
      if (!name) return;
      insHead.run(id, name, hi);
      (Array.isArray(h.persons) ? h.persons : []).forEach((p, pi) => {
        const person = String(p || "").trim();
        if (person) insPerson.run(id, person, pi);
      });
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return readMasterPersons();
}

/* ---- Petty cash (per event) ---- */

function readPettyCash(clientId) {
  const ev = findEventRow(clientId);
  const empty = { payouts: [], petty: [] };
  if (!ev) return empty;
  const rows = db.prepare("SELECT * FROM petty_cash_rows WHERE event_id = ? ORDER BY row_type, sort_order, id").all(ev.id);
  const out = { payouts: [], petty: [] };
  for (const r of rows) {
    if (r.row_type === "payout") out.payouts.push({ headId: r.head_id || "", person: r.person_name || "", purpose: r.purpose || "", amount: r.amount });
    else out.petty.push({ expense: r.person_name || "", purpose: r.purpose || "", amount: r.amount });
  }
  return out;
}

function writePettyCash(clientId, data) {
  const ev = findEventRow(clientId);
  if (!ev) {
    const err = new Error("Unknown event.");
    err.statusCode = 404;
    throw err;
  }
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM petty_cash_rows WHERE event_id = ?").run(ev.id);
    const ins = db.prepare("INSERT INTO petty_cash_rows (event_id, row_type, head_id, person_name, purpose, amount, sort_order) VALUES (?,?,?,?,?,?,?)");
    (data.payouts || []).forEach((r, i) => ins.run(ev.id, "payout", String(r.headId || ""), String(r.person || ""), String(r.purpose || ""), Number(r.amount) || 0, i));
    (data.petty || []).forEach((r, i) => ins.run(ev.id, "petty", "", String(r.expense || ""), String(r.purpose || ""), Number(r.amount) || 0, i));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return readPettyCash(clientId);
}

/* ---- Pre-cost inputs (per event) ---- */

const PRECOST_FIELDS = ["foodCostPerPax", "staffCount", "totalStaffCost", "equipmentDepreciation", "thirdPartyVendor", "decorCharge", "miscellaneousCost", "totalCost", "profitLoss"];
const PRECOST_COLS = ["food_cost_per_pax", "staff_count", "total_staff_cost", "equipment_depreciation", "third_party_vendor", "decor_charge", "miscellaneous_cost", "total_cost", "profit_loss"];

function readPreCost(clientId) {
  const ev = findEventRow(clientId);
  const empty = Object.fromEntries(PRECOST_FIELDS.map((f) => [f, 0]));
  if (!ev) return empty;
  const row = db.prepare("SELECT * FROM pre_cost_inputs WHERE event_id = ?").get(ev.id);
  if (!row) return empty;
  return Object.fromEntries(PRECOST_FIELDS.map((f, i) => [f, row[PRECOST_COLS[i]]]));
}

function writePreCost(clientId, data) {
  const ev = findEventRow(clientId);
  if (!ev) {
    const err = new Error("Unknown event.");
    err.statusCode = 404;
    throw err;
  }
  const vals = PRECOST_FIELDS.map((f) => Number(data[f]) || 0);
  db.prepare(
    `INSERT INTO pre_cost_inputs (event_id, ${PRECOST_COLS.join(", ")}, updated_at)
     VALUES (?, ${PRECOST_COLS.map(() => "?").join(", ")}, CURRENT_TIMESTAMP)
     ON CONFLICT(event_id) DO UPDATE SET ${PRECOST_COLS.map((c) => `${c}=excluded.${c}`).join(", ")}, updated_at=CURRENT_TIMESTAMP`
  ).run(ev.id, ...vals);
  return readPreCost(clientId);
}

/* ----------------------------------------------------------------------- *
 * Live reload (SSE + fs.watch)
 * ----------------------------------------------------------------------- */

const reloadClients = new Set();
let reloadTimer = null;

function notifyReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const res of reloadClients) {
      try { res.write("data: reload\n\n"); } catch { /* ignore */ }
    }
  }, 120);
}

try {
  fs.watch(ROOT, { recursive: true }, (_evt, filename) => {
    if (!filename) return;
    const f = String(filename);
    if (f.endsWith("odc.db") || f.includes("node_modules") || f.startsWith(".")) return;
    if (/\.(html|css|js)$/i.test(f)) notifyReload();
  });
} catch (e) {
  console.warn("File watch unavailable (live reload off):", e.message);
}

const LIVERELOAD_JS =
  `(function(){try{var s=new EventSource("/__livereload");s.onmessage=function(e){if(e.data==="reload")location.reload();};` +
  `s.onerror=function(){s.close();setTimeout(function(){location.reload();},1500);};}catch(_){}})();`;

/* ----------------------------------------------------------------------- *
 * HTTP server
 * ----------------------------------------------------------------------- */

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".sql": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 5_000_000) { reject(new Error("Payload too large")); req.destroy(); }
    });
    req.on("end", () => {
      if (!data) return resolve(null);
      try { resolve(JSON.parse(data)); } catch (e) { reject(Object.assign(new Error("Invalid JSON"), { statusCode: 400 })); }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const sub = parts.slice(1);
  const m = req.method;

  try {
    // /api/events
    if (sub[0] === "events" && sub.length === 1) {
      if (m === "GET") return sendJson(res, 200, getAllEvents());
      if (m === "POST") return sendJson(res, 200, upsertEvent(await readBody(req) || {}));
    }
    // /api/events/:id  and sub-resources
    if (sub[0] === "events" && sub.length >= 2) {
      const id = decodeURIComponent(sub[1]);
      if (sub.length === 2) {
        if (m === "DELETE") return deleteEvent(id) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "Not found" });
      }
      if (sub.length === 3 && sub[2] === "petty-cash") {
        if (m === "GET") return sendJson(res, 200, readPettyCash(id));
        if (m === "PUT") return sendJson(res, 200, writePettyCash(id, (await readBody(req)) || {}));
      }
      if (sub.length === 3 && sub[2] === "pre-cost") {
        if (m === "GET") return sendJson(res, 200, readPreCost(id));
        if (m === "PUT") return sendJson(res, 200, writePreCost(id, (await readBody(req)) || {}));
      }
    }
    // /api/master-persons
    if (sub[0] === "master-persons" && sub.length === 1) {
      if (m === "GET") return sendJson(res, 200, readMasterPersons());
      if (m === "PUT") return sendJson(res, 200, writeMasterPersons((await readBody(req)) || []));
    }
    return sendJson(res, 404, { error: "Unknown endpoint" });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code === 500) console.error("API error:", err);
    return sendJson(res, code, { error: err.message || "Server error" });
  }
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  if (pathname === "/__livereload.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    return res.end(LIVERELOAD_JS);
  }

  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if (ext === ".html") {
      let html = fs.readFileSync(filePath, "utf8");
      const tag = '<script src="/__livereload.js"></script>';
      html = html.includes("</body>") ? html.replace("</body>", `  ${tag}\n</body>`) : html + tag;
      headers["Content-Length"] = Buffer.byteLength(html);
      headers["Cache-Control"] = "no-cache";
      res.writeHead(200, headers);
      return res.end(html);
    }
    headers["Cache-Control"] = "no-cache";
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/__livereload") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("retry: 1500\n\n");
    reloadClients.add(res);
    req.on("close", () => reloadClients.delete(res));
    return;
  }

  if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  if (req.method !== "GET") { res.writeHead(405); return res.end("Method not allowed"); }
  return serveStatic(req, res, url);
});

seed();
server.listen(PORT, () => {
  console.log(`ODC dashboard running:  http://localhost:${PORT}`);
  console.log(`SQLite DB: ${DB_PATH}  |  live-reload: on`);
});

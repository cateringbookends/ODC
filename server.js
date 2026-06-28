"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const gSync = require("./google-sync.js");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5050;
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "odc.db");
const GST_RATE = 0.05;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const SCRYPT_N   = 16384;
const SCRYPT_R   = 8;
const SCRYPT_P   = 1;
const SCRYPT_LEN = 64;

/* ----------------------------------------------------------------------- *
 * Database
 * ----------------------------------------------------------------------- */

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");
db.exec(fs.readFileSync(path.join(ROOT, "database", "schema.sql"), "utf8"));

function migrate() {
  const stmts = [
    "ALTER TABLE events ADD COLUMN event_time TEXT",
    "ALTER TABLE events ADD COLUMN food_type TEXT",
    "ALTER TABLE events ADD COLUMN allergic_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE events ADD COLUMN allergic_notes TEXT",
    "ALTER TABLE events ADD COLUMN location_zone TEXT",
    "ALTER TABLE bill_submissions ADD COLUMN receipt_file_name TEXT",
    "ALTER TABLE bill_submissions ADD COLUMN receipt_drive_file_id TEXT",
    "ALTER TABLE bill_submissions ADD COLUMN receipt_drive_url TEXT"
  ];
  for (const sql of stmts) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }
}
migrate();

function ensureFlexibleCityColumn() {
  const createSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'").get()?.sql || "";
  if (!createSql.includes("location_zone IN ('surat', 'ahmedabad', 'other')")) return;

  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE events_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT UNIQUE,
        external_id TEXT UNIQUE,
        entry_date TEXT NOT NULL,
        event_date TEXT NOT NULL,
        event_name TEXT NOT NULL,
        location TEXT NOT NULL,
        pax INTEGER NOT NULL DEFAULT 0,
        event_days INTEGER NOT NULL DEFAULT 1,
        cost_per_pax REAL NOT NULL DEFAULT 0,
        total_billing REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'planning', 'completed', 'cancelled')),
        event_time TEXT,
        food_type TEXT CHECK (food_type IS NULL OR food_type IN ('jain', 'non-jain')),
        allergic_count INTEGER NOT NULL DEFAULT 0,
        allergic_notes TEXT,
        location_zone TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO events_new SELECT * FROM events;
      DROP TABLE events;
      ALTER TABLE events_new RENAME TO events;
    `);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
}
ensureFlexibleCityColumn();

function ensurePreCostColumns() {
  const cols = new Set(db.prepare("PRAGMA table_info(pre_cost_inputs)").all().map((row) => row.name));
  const additions = [
    ["staff_transportation_charge", "REAL NOT NULL DEFAULT 0"],
    ["staff_accommodation_charge", "REAL NOT NULL DEFAULT 0"],
    ["staff_food_cost", "REAL NOT NULL DEFAULT 0"],
    ["refervan_charge", "REAL NOT NULL DEFAULT 0"],
    ["equipment_transportation_charge", "REAL NOT NULL DEFAULT 0"]
  ];
  for (const [name, ddl] of additions) {
    if (!cols.has(name)) db.exec(`ALTER TABLE pre_cost_inputs ADD COLUMN ${name} ${ddl}`);
  }
}
ensurePreCostColumns();

function ensureMasterPersonColumns() {
  const cols = new Set(db.prepare("PRAGMA table_info(master_persons)").all().map((row) => row.name));
  const additions = [
    ["person_code", "TEXT"],
    ["person_designation", "TEXT"],
    ["person_department", "TEXT"],
    ["person_location", "TEXT"]
  ];
  for (const [name, ddl] of additions) {
    if (!cols.has(name)) db.exec(`ALTER TABLE master_persons ADD COLUMN ${name} ${ddl}`);
  }
}
ensureMasterPersonColumns();

function ensureEventFieldLog() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_field_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      event_client_id TEXT NOT NULL,
      event_name      TEXT,
      username        TEXT NOT NULL,
      action          TEXT NOT NULL,
      section         TEXT NOT NULL,
      field           TEXT,
      old_value       TEXT,
      new_value       TEXT,
      ip_address      TEXT,
      user_agent      TEXT,
      ts              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payment_received (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id    INTEGER NOT NULL,
      cycle_index INTEGER NOT NULL,
      cycle_name  TEXT,
      amount      REAL NOT NULL DEFAULT 0,
      mode        TEXT NOT NULL DEFAULT 'cash',
      receiver_type TEXT NOT NULL DEFAULT 'sales',
      received_by TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notes       TEXT,
      mail_sent_at TEXT,
      mail_sent_to TEXT,
      mail_sent_by TEXT,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS in_house_charges (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id    INTEGER NOT NULL,
      head        TEXT,
      category    TEXT,
      person      TEXT,
      description TEXT,
      amount      REAL NOT NULL DEFAULT 0,
      created_by  TEXT,
      created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_event_field_log_client ON event_field_log(event_client_id);
    CREATE INDEX IF NOT EXISTS idx_event_field_log_ts     ON event_field_log(ts);
    CREATE INDEX IF NOT EXISTS idx_payment_received_event ON payment_received(event_id);
    CREATE INDEX IF NOT EXISTS idx_in_house_charges_event ON in_house_charges(event_id);
  `);
  const paymentCols = new Set(db.prepare("PRAGMA table_info(payment_received)").all().map((row) => row.name));
  for (const [name, ddl] of [
    ["mode", "TEXT NOT NULL DEFAULT 'cash'"],
    ["receiver_type", "TEXT NOT NULL DEFAULT 'sales'"],
    ["mail_sent_at", "TEXT"],
    ["mail_sent_to", "TEXT"],
    ["mail_sent_by", "TEXT"]
  ]) {
    if (!paymentCols.has(name)) db.exec(`ALTER TABLE payment_received ADD COLUMN ${name} ${ddl}`);
  }
}
ensureEventFieldLog();

// backfillGstInclusiveTotals removed — ran every startup, recalculating all rows unnecessarily.

/* ----------------------------------------------------------------------- *
 * Authentication — in-memory sessions, SHA-256 password hashing
 * ----------------------------------------------------------------------- */

// Sessions stored in SQLite so they survive server restarts (Fly.io machine sleep/wake).
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    username   TEXT NOT NULL,
    role       TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    login_at   INTEGER NOT NULL
  );
`);
// Purge expired sessions on startup.
db.exec(`DELETE FROM sessions WHERE expires_at <= ${Date.now()}`);

// Thin compatibility shim so the rest of the code reads like a Map.
const sessions = {
  set(token, s) {
    db.prepare("INSERT OR REPLACE INTO sessions (token,user_id,username,role,expires_at,login_at) VALUES (?,?,?,?,?,?)")
      .run(token, s.userId, s.username, s.role, s.expiresAt, s.loginAt);
  },
  get(token) {
    const row = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
    if (!row) return undefined;
    return { userId: row.user_id, username: row.username, role: row.role, expiresAt: row.expires_at, loginAt: row.login_at };
  },
  delete(token) { db.prepare("DELETE FROM sessions WHERE token = ?").run(token); },
  entries() {
    return db.prepare("SELECT * FROM sessions").all().map(row => [
      row.token,
      { userId: row.user_id, username: row.username, role: row.role, expiresAt: row.expires_at, loginAt: row.login_at }
    ]);
  }
};

function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pw), salt, SCRYPT_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPw(pw, stored) {
  if (!stored || !stored.startsWith("scrypt:")) {
    // Legacy SHA-256 — verify, then caller will migrate the hash.
    return crypto.createHash("sha256").update(String(pw)).digest("hex") === stored;
  }
  const parts = stored.split(":");
  if (parts.length !== 3) return false;
  const [, salt, hash] = parts;
  const candidate = crypto.scryptSync(String(pw), salt, SCRYPT_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
  } catch { return false; }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    try {
      out[decodeURIComponent(part.slice(0, idx).trim())] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch { /* ignore bad encoding */ }
  }
  return out;
}

function createSession(userId, username, role) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId, username, role, expiresAt: Date.now() + SESSION_TTL_MS, loginAt: Date.now() });
  return token;
}

function getSession(token) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { sessions.delete(token); return null; }
  return s;
}

function deleteSession(token) { sessions.delete(token); }

/* ----------------------------------------------------------------------- *
 * Login rate limiter — in-memory, per source IP
 * ----------------------------------------------------------------------- */
const loginAttempts = new Map(); // ip -> { count, firstAt, lockedUntil }
const LOGIN_MAX       = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15-minute sliding window
const LOGIN_LOCK_MS   = 30 * 60 * 1000; // 30-minute lockout after too many failures

function checkLoginRate(ip) {
  const now = Date.now();
  const e = loginAttempts.get(ip) || { count: 0, firstAt: now, lockedUntil: 0 };
  if (e.lockedUntil > now) return false;
  if (now - e.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAt: now, lockedUntil: 0 });
    return true;
  }
  e.count++;
  if (e.count > LOGIN_MAX) {
    e.lockedUntil = now + LOGIN_LOCK_MS;
    loginAttempts.set(ip, e);
    return false;
  }
  loginAttempts.set(ip, e);
  return true;
}
function resetLoginRate(ip) { loginAttempts.delete(ip); }

function sessionFromReq(req) {
  const token = parseCookies(req).odc_session;
  return token ? getSession(token) : null;
}

/* ----------------------------------------------------------------------- *
 * Users
 * ----------------------------------------------------------------------- */

function getUser(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(String(username).toLowerCase());
}

function seedUsers() {
  const n = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (n === 0) {
    db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)")
      .run("aiops", hashPw("AIops"), "Admin", "admin");
    console.log("Default admin created  →  username: aiops  password: AIops");
  }
}

/* ----------------------------------------------------------------------- *
 * Audit log
 * ----------------------------------------------------------------------- */

function auditLog(sess, req, action, entityType, entityId, detail) {
  try {
    db.prepare(
      "INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, detail, ip_address, user_agent) VALUES (?,?,?,?,?,?,?,?)"
    ).run(
      sess.userId,
      sess.username,
      action,
      entityType,
      entityId != null ? String(entityId) : null,
      detail != null ? String(detail) : null,
      req.socket.remoteAddress || req.headers["x-forwarded-for"] || null,
      req.headers["user-agent"] || null
    );
  } catch (e) { console.warn("audit log write failed:", e.message); }
}

function auditLogLogin(username, userId, req, action) {
  try {
    db.prepare(
      "INSERT INTO audit_log (user_id, username, action, entity_type, ip_address, user_agent) VALUES (?,?,?,?,?,?)"
    ).run(
      userId, username, action, "auth",
      req.socket.remoteAddress || req.headers["x-forwarded-for"] || null,
      req.headers["user-agent"] || null
    );
  } catch (e) { console.warn("audit log write failed:", e.message); }
}

/* ----------------------------------------------------------------------- *
 * Bill submissions
 * ----------------------------------------------------------------------- */

function mapBillRow(r) {
  return {
    id: r.id,
    eventClientId: r.event_client_id,
    eventName: r.event_name,
    eventDate: r.event_date || "",
    eventPax: r.event_pax || 0,
    eventCostPerPax: r.event_cost_per_pax || 0,
    submittedByUserId: r.submitted_by_user_id,
    headId: r.head_id,
    headName: r.head_name || r.head_id,
    personName: r.person_name,
    amount: r.amount,
    description: r.description || "",
    category: r.category,
    receiptFileName: r.receipt_file_name || "",
    receiptDriveFileId: r.receipt_drive_file_id || "",
    receiptDriveUrl: r.receipt_drive_url || "",
    status: r.status,
    submittedAt: r.submitted_at,
    reviewedBy: r.reviewed_by || "",
    reviewedAt: r.reviewed_at || ""
  };
}

const BILLS_SQL = `
  SELECT bs.*, e.event_name, e.client_id AS event_client_id,
         e.event_date, e.pax AS event_pax, e.cost_per_pax AS event_cost_per_pax,
         mh.name AS head_name
  FROM bill_submissions bs
  JOIN events e ON e.id = bs.event_id
  LEFT JOIN master_heads mh ON mh.id = bs.head_id
`;

function getAllBills() {
  return db.prepare(BILLS_SQL + " ORDER BY bs.submitted_at DESC").all().map(mapBillRow);
}

function getUserBills(userId) {
  return db.prepare(BILLS_SQL + " WHERE bs.submitted_by_user_id = ? ORDER BY bs.submitted_at DESC").all(userId).map(mapBillRow);
}

function createBill(sess, data) {
  const ev = findEventRow(String(data.eventId || ""));
  if (!ev) { const e = new Error("Unknown event."); e.statusCode = 404; throw e; }
  if (!data.headId || !String(data.personName || "").trim()) {
    const e = new Error("Head and person name are required."); e.statusCode = 400; throw e;
  }
  const amount = Number(data.amount);
  if (!(amount > 0)) { const e = new Error("Amount must be greater than 0."); e.statusCode = 400; throw e; }
  const validCategories = ["food", "transport", "equipment", "accommodation", "misc"];
  const category = validCategories.includes(data.category) ? data.category : "misc";
  const receiptFileName = String(data.receipt?.fileName || "").trim().slice(0, 180);
  const info = db.prepare(
    "INSERT INTO bill_submissions (event_id, submitted_by_user_id, head_id, person_name, amount, description, category, receipt_file_name) VALUES (?,?,?,?,?,?,?,?)"
  ).run(ev.id, sess.userId, String(data.headId), String(data.personName).trim(), amount, String(data.description || "").trim(), category, receiptFileName);
  return { id: info.lastInsertRowid, eventName: ev.event_name };
}

function attachBillReceipt(billId, receipt) {
  if (!receipt || !receipt.fileName || !receipt.base64) return Promise.resolve(null);
  if (!gSync.isEnabled()) return Promise.resolve(null);
  return gSync.uploadReceipt({
    billId,
    fileName: String(receipt.fileName).slice(0, 180),
    mimeType: String(receipt.mimeType || "application/octet-stream").slice(0, 120),
    base64: String(receipt.base64),
    eventName: String(receipt.eventName || "")
  }).then((uploaded) => {
    db.prepare("UPDATE bill_submissions SET receipt_file_name=?, receipt_drive_file_id=?, receipt_drive_url=? WHERE id=?")
      .run(uploaded.name || receipt.fileName, uploaded.fileId || "", uploaded.url || "", Number(billId));
    return uploaded;
  });
}

function reviewBill(billId, status, reviewerUsername) {
  if (!["approved", "rejected"].includes(status)) {
    const e = new Error("Status must be 'approved' or 'rejected'."); e.statusCode = 400; throw e;
  }
  const info = db.prepare(
    "UPDATE bill_submissions SET status=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?"
  ).run(status, reviewerUsername, Number(billId));
  if (info.changes === 0) { const e = new Error("Bill not found."); e.statusCode = 404; throw e; }
}

/* ----------------------------------------------------------------------- *
 * Event mapping (DB row <-> API JSON)
 * ----------------------------------------------------------------------- */

function mapEventRowWithChildren(row, cycles, kyc) {
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
    locationZone: row.location_zone || "",
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

function mapEventRow(row) {
  const cycles = db.prepare("SELECT * FROM payment_cycles WHERE event_id = ? ORDER BY id").all(row.id);
  const kyc = db.prepare("SELECT * FROM invoice_kyc WHERE event_id = ?").get(row.id);
  return mapEventRowWithChildren(row, cycles, kyc);
}

function getAllEvents() {
  const rows = db.prepare("SELECT * FROM events ORDER BY event_date").all();
  if (rows.length === 0) return [];

  const cyclesByEvent = new Map();
  for (const cycle of db.prepare("SELECT * FROM payment_cycles ORDER BY event_id, id").all()) {
    if (!cyclesByEvent.has(cycle.event_id)) cyclesByEvent.set(cycle.event_id, []);
    cyclesByEvent.get(cycle.event_id).push(cycle);
  }

  const kycByEvent = new Map();
  for (const kyc of db.prepare("SELECT * FROM invoice_kyc").all()) {
    kycByEvent.set(kyc.event_id, kyc);
  }

  return rows.map((row) => mapEventRowWithChildren(row, cyclesByEvent.get(row.id) || [], kycByEvent.get(row.id)));
}

function findEventRow(clientId) {
  return db.prepare("SELECT * FROM events WHERE client_id = ?").get(String(clientId));
}

/* ----------------------------------------------------------------------- *
 * Validation
 * ----------------------------------------------------------------------- */

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
  const city = s(e.locationZone);
  if (city.length > 80) errors.push("City must be 80 characters or fewer.");
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

/* ----------------------------------------------------------------------- *
 * Event field-level change logging
 * ----------------------------------------------------------------------- */

const CORE_FIELDS = [
  { key: "name",          col: "event_name",     label: "Event Name" },
  { key: "date",          col: "event_date",      label: "Event Date" },
  { key: "entryDate",     col: "entry_date",      label: "Entry Date" },
  { key: "location",      col: "location",        label: "Location" },
  { key: "locationZone",  col: "location_zone",   label: "Zone / City" },
  { key: "pax",           col: "pax",             label: "PAX" },
  { key: "days",          col: "event_days",      label: "No. of Days" },
  { key: "costPerPax",    col: "cost_per_pax",    label: "Cost per PAX" },
  { key: "status",        col: "status",          label: "Status" },
  { key: "time",          col: "event_time",      label: "Event Time" },
  { key: "foodType",      col: "food_type",       label: "Food Type" },
  { key: "allergicCount", col: "allergic_count",  label: "Allergic Count" },
  { key: "allergicNotes", col: "allergic_notes",  label: "Allergy Notes" }
];

const KYC_FIELDS = [
  { col: "client_name",   key: "name",    label: "KYC: Client Name" },
  { col: "mobile",        key: "mobile",  label: "KYC: Mobile" },
  { col: "email",         key: "email",   label: "KYC: Email" },
  { col: "gst_number",    key: "gst",     label: "KYC: GST" },
  { col: "pan_number",    key: "pan",     label: "KYC: PAN" },
  { col: "aadhar_number", key: "aadhar",  label: "KYC: Aadhaar" }
];

function logFieldChange(insStmt, clientId, eventName, username, action, section, field, oldVal, newVal, ip, ua) {
  const o = String(oldVal == null ? "" : oldVal);
  const n = String(newVal == null ? "" : newVal);
  if (o === n) return; // no change
  try {
    insStmt.run(clientId, eventName || "", username, action, section, field, o || null, n || null, ip, ua);
  } catch (e) { console.warn("field log write failed:", e.message); }
}

function writeFieldLog(clientId, eventName, existingRow, e, cycles, kyc, sess, req) {
  const ip = req ? (req.socket.remoteAddress || req.headers["x-forwarded-for"] || null) : null;
  const ua = req ? ((req.headers["user-agent"] || "").slice(0, 200) || null) : null;
  const username = sess ? sess.username : "system";
  const isCreate = !existingRow;
  const action = isCreate ? "create" : "update";

  const ins = db.prepare(
    "INSERT INTO event_field_log (event_client_id,event_name,username,action,section,field,old_value,new_value,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)"
  );

  // ── Core fields ──────────────────────────────────────────────────────────
  for (const f of CORE_FIELDS) {
    const oldVal = isCreate ? null : (existingRow[f.col] == null ? "" : String(existingRow[f.col]));
    // Get new value from the normalized form
    let newVal;
    if (f.key === "name")          newVal = String(e.name || "").trim();
    else if (f.key === "date")     newVal = String(e.date || "");
    else if (f.key === "entryDate") newVal = String(e.entryDate || "");
    else if (f.key === "location") newVal = String(e.location || "").trim();
    else if (f.key === "locationZone") newVal = String(e.locationZone || "").trim();
    else if (f.key === "pax")      newVal = String(Math.floor(Number(e.pax)) || 0);
    else if (f.key === "days")     newVal = String(Number(e.days) > 0 ? Math.floor(Number(e.days)) : 1);
    else if (f.key === "costPerPax") newVal = String(Number(e.costPerPax) || 0);
    else if (f.key === "status")   newVal = String(e.status || "open");
    else if (f.key === "time")     newVal = String(e.time || "").trim();
    else if (f.key === "foodType") newVal = String(e.foodType || "").trim();
    else if (f.key === "allergicCount") newVal = String(Math.max(Math.floor(Number(e.allergicCount) || 0), 0));
    else if (f.key === "allergicNotes") newVal = String(e.allergicNotes || "").trim();
    else newVal = "";

    if (isCreate) {
      if (newVal !== "" && newVal !== "0") logFieldChange(ins, clientId, e.name, username, action, "core", f.label, null, newVal, ip, ua);
    } else {
      logFieldChange(ins, clientId, e.name, username, action, "core", f.label, oldVal, newVal, ip, ua);
    }
  }

  // ── KYC fields ───────────────────────────────────────────────────────────
  const newKyc = e.invoiceKyc || {};
  for (const f of KYC_FIELDS) {
    const oldVal = isCreate ? null : (kyc ? (kyc[f.col] || "") : "");
    const newVal = String(newKyc[f.key] || "").trim();
    if (isCreate) {
      if (newVal) logFieldChange(ins, clientId, e.name, username, action, "kyc", f.label, null, newVal, ip, ua);
    } else {
      logFieldChange(ins, clientId, e.name, username, action, "kyc", f.label, oldVal, newVal, ip, ua);
    }
  }

  // ── Payment schedule ─────────────────────────────────────────────────────
  const newCycles = Array.isArray(e.paymentSchedule) ? e.paymentSchedule : [];
  if (isCreate) {
    if (newCycles.length) {
      ins.run(clientId, e.name || "", username, action, "payment_schedule", "Payment Schedule",
        null, `${newCycles.length} cycle(s): ${newCycles.map(c => `${c.label} ₹${c.amount}`).join(", ")}`, ip, ua);
    }
  } else {
    const oldSummary = cycles.map(c => `${c.cycle_name}:${c.amount}:${c.billing_type}`).join("|");
    const newSummary = newCycles.map(c => `${c.label}:${c.amount}:${c.billing}`).join("|");
    if (oldSummary !== newSummary) {
      ins.run(clientId, e.name || "", username, "update", "payment_schedule", "Payment Schedule",
        cycles.map(c => `${c.cycle_name} ₹${c.amount} (${c.billing_type})`).join(", ") || "—",
        newCycles.map(c => `${c.label} ₹${c.amount} (${c.billing})`).join(", ") || "—",
        ip, ua);
    }
  }
}

/* ----------------------------------------------------------------------- *
 * Event write (upsert by client_id, transactional)
 * ----------------------------------------------------------------------- */

function upsertEvent(e, sess, req) {
  const errors = validateEvent(e);
  if (errors.length) {
    const err = new Error(errors.join(" "));
    err.statusCode = 400;
    throw err;
  }

  const pax = Math.floor(Number(e.pax)) || 0;
  const days = Number(e.days) > 0 ? Math.floor(Number(e.days)) : 1;
  const costPerPax = Number(e.costPerPax) || 0;
  const baseBilling = pax * days * costPerPax;
  const totalBilling = baseBilling + (baseBilling * GST_RATE);
  const status = (e.status && String(e.status).trim()) || "open";
  const clientId = String(e.id || `EVT-${Date.now()}`);
  const eventTime = (e.time && String(e.time).trim()) || null;
  const foodType = (e.foodType && String(e.foodType).trim()) || null;
  const allergicCount = Math.max(Math.floor(Number(e.allergicCount) || 0), 0);
  const allergicNotes = (e.allergicNotes != null ? String(e.allergicNotes).trim() : "") || null;
  const locationZone = (e.locationZone && String(e.locationZone).trim()) || null;

  db.exec("BEGIN");
  try {
    const existing = findEventRow(clientId);
    let eventId;

    // Snapshot old cycles + KYC before we delete them (needed for diff)
    const oldCycles = existing ? db.prepare("SELECT * FROM payment_cycles WHERE event_id = ? ORDER BY id").all(existing.id) : [];
    const oldKyc    = existing ? db.prepare("SELECT * FROM invoice_kyc WHERE event_id = ?").get(existing.id) : null;

    if (existing) {
      db.prepare(
        `UPDATE events SET external_id=?, entry_date=?, event_date=?, event_name=?, location=?, pax=?, event_days=?, cost_per_pax=?, total_billing=?, status=?, event_time=?, food_type=?, allergic_count=?, allergic_notes=?, location_zone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).run(e.externalId || existing.external_id, e.entryDate || "", e.date, e.name.trim(), e.location.trim(), pax, days, costPerPax, totalBilling, status, eventTime, foodType, allergicCount, allergicNotes, locationZone, existing.id);
      eventId = existing.id;
      db.prepare("DELETE FROM payment_cycles WHERE event_id = ?").run(eventId);
      db.prepare("DELETE FROM invoice_kyc WHERE event_id = ?").run(eventId);
    } else {
      const info = db.prepare(
        `INSERT INTO events (client_id, external_id, entry_date, event_date, event_name, location, pax, event_days, cost_per_pax, total_billing, status, event_time, food_type, allergic_count, allergic_notes, location_zone)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(clientId, e.externalId || "", e.entryDate || "", e.date, e.name.trim(), e.location.trim(), pax, days, costPerPax, totalBilling, status, eventTime, foodType, allergicCount, allergicNotes, locationZone);
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

    // Write field-level change log (inside transaction so it rolls back on error)
    writeFieldLog(clientId, e.name || "", existing, e, oldCycles, oldKyc, sess, req);

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

/* ----------------------------------------------------------------------- *
 * Master persons
 * ----------------------------------------------------------------------- */

function readMasterPersons() {
  const heads = db.prepare("SELECT * FROM master_heads ORDER BY sort_order, name").all();
  return heads.map((h) => ({
    id: h.id,
    name: h.name,
    persons: db.prepare("SELECT person_name, person_code, person_designation, person_department, person_location FROM master_persons WHERE head_id = ? ORDER BY sort_order, id").all(h.id).map((p) => ({
      name: p.person_name,
      code: p.person_code || "",
      designation: p.person_designation || "",
      department: p.person_department || "",
      location: p.person_location || ""
    }))
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
    const insPerson = db.prepare("INSERT INTO master_persons (head_id, person_name, person_code, person_designation, person_department, person_location, sort_order) VALUES (?,?,?,?,?,?,?)");
    heads.forEach((h, hi) => {
      const id = String(h.id || `head-${hi}`).trim();
      const name = String(h.name || "").trim();
      if (!name) return;
      insHead.run(id, name, hi);
      (Array.isArray(h.persons) ? h.persons : []).forEach((p, pi) => {
        const person = typeof p === "string" ? { name: p } : (p || {});
        const personName = String(person.name || person.personName || "").trim();
        if (!personName) return;
        insPerson.run(
          id,
          personName,
          String(person.code || person.employeeCode || "").trim() || null,
          String(person.designation || "").trim() || null,
          String(person.department || "").trim() || null,
          String(person.location || "").trim() || null,
          pi
        );
      });
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return readMasterPersons();
}

/* ----------------------------------------------------------------------- *
 * Petty cash (per event)
 * ----------------------------------------------------------------------- */

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

/* ----------------------------------------------------------------------- *
 * Pre-cost inputs (per event)
 * ----------------------------------------------------------------------- */

const PRECOST_FIELDS = ["foodCostPerPax", "staffCount", "totalStaffCost", "equipmentDepreciation", "thirdPartyVendor", "decorCharge", "miscellaneousCost", "staffTransportationCharge", "staffAccommodationCharge", "staffFoodCost", "refervanCharge", "equipmentTransportationCharge", "totalCost", "profitLoss"];
const PRECOST_COLS = ["food_cost_per_pax", "staff_count", "total_staff_cost", "equipment_depreciation", "third_party_vendor", "decor_charge", "miscellaneous_cost", "staff_transportation_charge", "staff_accommodation_charge", "staff_food_cost", "refervan_charge", "equipment_transportation_charge", "total_cost", "profit_loss"];

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
 * Seed
 * ----------------------------------------------------------------------- */

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
      const baseBilling = s.pax * s.event_days * s.cost_per_pax;
      ins.run(s.client_id, s.external_id, s.entry_date, s.event_date, s.event_name, s.location, s.pax, s.event_days, s.cost_per_pax, baseBilling + (baseBilling * GST_RATE), s.status);
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

// Added to every response so ngrok skips its browser-warning interstitial.
const NGROK_HDR = { "ngrok-skip-browser-warning": "true" };

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), ...NGROK_HDR });
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
    // ================================================================
    // PUBLIC AUTH ROUTES (no session required)
    // ================================================================

    // POST /api/auth/login
    if (sub[0] === "auth" && sub[1] === "login" && m === "POST") {
      const body = await readBody(req);
      const username = String(body?.username || "").trim().toLowerCase();
      const user = getUser(username);
      const ip = req.socket.remoteAddress || req.headers["x-forwarded-for"] || "unknown";
      if (!checkLoginRate(ip)) {
        return sendJson(res, 429, { error: "Too many login attempts. Try again in 30 minutes." });
      }
      if (!user || !verifyPw(body?.password || "", user.password_hash)) {
        return sendJson(res, 401, { error: "Invalid username or password." });
      }
      resetLoginRate(ip);
      // Migrate legacy SHA-256 hash to scrypt on first successful login.
      if (user.password_hash && !user.password_hash.startsWith("scrypt:")) {
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPw(body.password || ""), user.id);
      }
      const token = createSession(user.id, user.username, user.role);
      auditLogLogin(user.username, user.id, req, "LOGIN");
      res.setHeader("Set-Cookie", `odc_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
      return sendJson(res, 200, { username: user.username, role: user.role, fullName: user.full_name });
    }

    // GET /api/auth/me
    if (sub[0] === "auth" && sub[1] === "me" && m === "GET") {
      const s = sessionFromReq(req);
      if (!s) return sendJson(res, 401, { error: "Not authenticated" });
      const user = db.prepare("SELECT full_name FROM users WHERE id = ?").get(s.userId);
      return sendJson(res, 200, { username: s.username, role: s.role, fullName: user?.full_name || "" });
    }

    // POST /api/auth/logout
    if (sub[0] === "auth" && sub[1] === "logout" && m === "POST") {
      const token = parseCookies(req).odc_session;
      const s = token ? getSession(token) : null;
      if (s) {
        auditLogLogin(s.username, s.userId, req, "LOGOUT");
        deleteSession(token);
      }
      res.setHeader("Set-Cookie", "odc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
      return sendJson(res, 200, { ok: true });
    }

    // ================================================================
    // PUBLIC READ-ONLY: event log + event header (no session needed)
    // ================================================================
    if (sub[0] === "events" && sub.length === 3 && sub[2] === "log" && m === "GET") {
      const id = decodeURIComponent(sub[1]);
      return sendJson(res, 200, db.prepare(
        "SELECT id,event_client_id,event_name,username,action,section,field,old_value,new_value,ip_address,user_agent,ts FROM event_field_log WHERE event_client_id = ? ORDER BY ts DESC LIMIT 500"
      ).all(id));
    }
    if (sub[0] === "events" && sub.length === 3 && sub[2] === "header" && m === "GET") {
      const id = decodeURIComponent(sub[1]);
      const row = findEventRow(id);
      if (!row) return sendJson(res, 404, { error: "Not found" });
      return sendJson(res, 200, { id: row.client_id, name: row.event_name, date: row.event_date, location: row.location, status: row.status, locationZone: row.location_zone || "", pax: row.pax, days: row.event_days, costPerPax: row.cost_per_pax });
    }

    // ================================================================
    // ALL OTHER ROUTES REQUIRE A VALID SESSION
    // ================================================================
    const sess = sessionFromReq(req);
    if (!sess) return sendJson(res, 401, { error: "Not authenticated" });

    // ================================================================
    // ADMIN: User management  /api/auth/users[/:username[/password]]
    // ================================================================
    if (sub[0] === "auth" && sub[1] === "users") {
      if (sess.role !== "admin") return sendJson(res, 403, { error: "Admin only." });

      // GET /api/auth/users
      if (sub.length === 2 && m === "GET") {
        const users = db.prepare("SELECT id, username, full_name, role, created_at FROM users ORDER BY id").all();
        return sendJson(res, 200, users.map((u) => ({ id: u.id, username: u.username, fullName: u.full_name, role: u.role, createdAt: u.created_at })));
      }

      // POST /api/auth/users  (create)
      if (sub.length === 2 && m === "POST") {
        const body = await readBody(req);
        const uname = String(body?.username || "").trim().toLowerCase();
        const pw = String(body?.password || "");
        if (!uname || pw.length < 4) return sendJson(res, 400, { error: "Username and password (min 4 chars) required." });
        const role = body?.role === "admin" ? "admin" : "user";
        try {
          db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)")
            .run(uname, hashPw(pw), String(body?.fullName || "").trim(), role);
          auditLog(sess, req, "CREATE", "user", uname, null);
          return sendJson(res, 200, { ok: true });
        } catch (e) {
          if (e.message.includes("UNIQUE")) return sendJson(res, 409, { error: "Username already exists." });
          throw e;
        }
      }

      // DELETE /api/auth/users/:username
      if (sub.length === 3 && m === "DELETE") {
        const target = decodeURIComponent(sub[2]);
        if (target === "aiops") return sendJson(res, 400, { error: "Cannot delete the default admin account." });
        db.prepare("DELETE FROM users WHERE username = ?").run(target);
        auditLog(sess, req, "DELETE", "user", target, null);
        return sendJson(res, 200, { ok: true });
      }

      // PUT /api/auth/users/:username/password
      if (sub.length === 4 && sub[3] === "password" && m === "PUT") {
        const target = decodeURIComponent(sub[2]);
        const body = await readBody(req);
        const pw = String(body?.password || "");
        if (pw.length < 4) return sendJson(res, 400, { error: "Password must be at least 4 characters." });
        db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(hashPw(pw), target);
        auditLog(sess, req, "UPDATE", "user", target, "password changed");
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { error: "Unknown auth/users endpoint" });
    }

    // ================================================================
    // ADMIN: Audit log  GET /api/audit-log
    // ================================================================
    if (sub[0] === "audit-log" && m === "GET") {
      if (sess.role !== "admin") return sendJson(res, 403, { error: "Admin only." });
      const limit    = Math.min(Number(url.searchParams.get("limit")) || 500, 5000);
      const username = url.searchParams.get("user") || null;
      const action   = url.searchParams.get("action") || null;
      const from     = url.searchParams.get("from") || null;
      const to       = url.searchParams.get("to") || null;
      let sql = "SELECT * FROM audit_log WHERE 1=1";
      const params = [];
      if (username) { sql += " AND username = ?"; params.push(username); }
      if (action)   { sql += " AND action = ?";   params.push(action); }
      if (from)     { sql += " AND ts >= ?";       params.push(from); }
      if (to)       { sql += " AND ts <= ?";       params.push(to + "T23:59:59"); }
      sql += " ORDER BY ts DESC LIMIT ?";
      params.push(limit);
      return sendJson(res, 200, db.prepare(sql).all(...params));
    }

    // ================================================================
    // ADMIN: Active sessions  GET /api/admin/sessions
    //                        DELETE /api/admin/sessions/:username
    // ================================================================
    if (sub[0] === "admin" && sub[1] === "sessions") {
      if (sess.role !== "admin") return sendJson(res, 403, { error: "Admin only." });
      if (m === "GET") {
        const now    = Date.now();
        const active = [];
        for (const [, s] of sessions.entries()) {
          if (s.expiresAt > now) {
            active.push({
              username: s.username, role: s.role,
              loginAt:   new Date(s.loginAt  || (s.expiresAt - SESSION_TTL_MS)).toISOString(),
              expiresAt: new Date(s.expiresAt).toISOString()
            });
          }
        }
        return sendJson(res, 200, active);
      }
      if (m === "DELETE" && sub[2]) {
        const target = decodeURIComponent(sub[2]);
        for (const [token, s] of sessions.entries()) {
          if (s.username === target) sessions.delete(token);
        }
        auditLog(sess, req, "FORCE_LOGOUT", "session", target, null);
        return sendJson(res, 200, { ok: true });
      }
    }

    // ================================================================
    // Bill submissions  /api/bills[/:id]
    // ================================================================
    if (sub[0] === "bills") {
      if (sub.length === 1) {
        if (m === "GET") {
          return sendJson(res, 200, sess.role === "admin" ? getAllBills() : getUserBills(sess.userId));
        }
        if (m === "POST") {
          const body = await readBody(req);
          const created = createBill(sess, body || {});
          const billId = created.id;
          let receipt = null;
          try {
            receipt = await attachBillReceipt(billId, {
              ...(body?.receipt || {}),
              eventName: created.eventName || ""
            });
          } catch (e) {
            console.warn("receipt upload failed:", e.message);
          }
          auditLog(sess, req, "CREATE", "bill", String(billId), null);
          if (gSync.isEnabled()) gSync.syncBills(getAllBills());
          return sendJson(res, 200, { ok: true, id: billId, receipt });
        }
      }
      if (sub.length === 2 && m === "PUT") {
        if (sess.role !== "admin") return sendJson(res, 403, { error: "Admin only." });
        const body = await readBody(req);
        reviewBill(Number(sub[1]), body?.status, sess.username);
        auditLog(sess, req, "UPDATE", "bill", sub[1], body?.status);
        if (gSync.isEnabled()) gSync.syncBills(getAllBills());
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { error: "Unknown bills endpoint" });
    }

    // ================================================================
    // Events
    // ================================================================
    if (sub[0] === "events" && sub.length === 1) {
      if (m === "GET") return sendJson(res, 200, getAllEvents());
      if (m === "POST") {
        const body = await readBody(req) || {};
        const existed = body.id ? !!findEventRow(String(body.id)) : false;
        const result = upsertEvent(body, sess, req);
        auditLog(sess, req, existed ? "UPDATE" : "CREATE", "event", result.id, null);
        if (gSync.isEnabled()) {
          const evs = getAllEvents();
          gSync.syncEvents(evs);
          gSync.syncPaymentSchedule(evs);
          gSync.syncInvoiceKYC(evs);
        }
        return sendJson(res, 200, result);
      }
    }

    if (sub[0] === "events" && sub.length >= 2) {
      const id = decodeURIComponent(sub[1]);
      if (sub.length === 2) {
        if (m === "GET") {
          const row = findEventRow(id);
          return row ? sendJson(res, 200, mapEventRow(row)) : sendJson(res, 404, { error: "Not found" });
        }
        if (m === "DELETE") {
          const ok = deleteEvent(id);
          if (ok) {
            auditLog(sess, req, "DELETE", "event", id, null);
            if (gSync.isEnabled()) {
              const evs = getAllEvents();
              gSync.syncEvents(evs);
              gSync.syncPaymentSchedule(evs);
              gSync.syncInvoiceKYC(evs);
            }
          }
          return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "Not found" });
        }
      }
      if (sub.length === 3 && sub[2] === "petty-cash") {
        if (m === "GET") return sendJson(res, 200, readPettyCash(id));
        if (m === "PUT") {
          const result = writePettyCash(id, (await readBody(req)) || {});
          auditLog(sess, req, "UPDATE", "petty-cash", id, null);
          // Log petty cash save to field log
          const evRow = findEventRow(id);
          if (evRow) {
            const ip = req.socket.remoteAddress || req.headers["x-forwarded-for"] || null;
            const data = result;
            const summary = `${(data.payouts||[]).length} payout(s), ${(data.petty||[]).length} expense(s), total ₹${[...(data.payouts||[]),...(data.petty||[])].reduce((s,r)=>s+(r.amount||0),0)}`;
            db.prepare("INSERT INTO event_field_log (event_client_id,event_name,username,action,section,field,old_value,new_value,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)")
              .run(id, evRow.event_name, sess.username, "petty_cash", "petty_cash", "Petty Cash Saved", null, summary, ip, (req.headers["user-agent"]||"").slice(0,200));
          }
          if (gSync.isEnabled()) {
            const evs = getAllEvents();
            gSync.syncPettyCash(evs.map((ev) => ({ eventId: ev.id, eventName: ev.name, data: readPettyCash(ev.id) })));
          }
          return sendJson(res, 200, result);
        }
      }
      if (sub.length === 3 && sub[2] === "pre-cost") {
        if (m === "GET") return sendJson(res, 200, readPreCost(id));
        if (m === "PUT") {
          const result = writePreCost(id, (await readBody(req)) || {});
          auditLog(sess, req, "UPDATE", "pre-cost", id, null);
          // Log pre-cost save to field log
          const evRow = findEventRow(id);
          if (evRow) {
            const ip = req.socket.remoteAddress || req.headers["x-forwarded-for"] || null;
            db.prepare("INSERT INTO event_field_log (event_client_id,event_name,username,action,section,field,old_value,new_value,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)")
              .run(id, evRow.event_name, sess.username, "pre_cost", "pre_cost", "Pre-Cost Plan Saved", null,
                `Total Cost ₹${result.totalCost||0}, P&L ₹${result.profitLoss||0}`,
                ip, (req.headers["user-agent"]||"").slice(0,200));
          }
          if (gSync.isEnabled()) {
            const evs = getAllEvents();
            gSync.syncPreCost(evs.map((ev) => ({ eventId: ev.id, eventName: ev.name, data: readPreCost(ev.id) })));
          }
          return sendJson(res, 200, result);
        }
      }

      // GET /api/events/:id/log — field-level change history
      if (sub.length === 3 && sub[2] === "log" && m === "GET") {
        return sendJson(res, 200, db.prepare(
          "SELECT * FROM event_field_log WHERE event_client_id = ? ORDER BY ts DESC LIMIT 500"
        ).all(id));
      }

      // GET/POST /api/events/:id/payment-received
      if (sub.length === 3 && sub[2] === "payment-received") {
        const evRow = findEventRow(id);
        if (!evRow) return sendJson(res, 404, { error: "Not found" });
        if (m === "GET") {
          return sendJson(res, 200, db.prepare("SELECT * FROM payment_received WHERE event_id = ? ORDER BY received_at").all(evRow.id));
        }
        if (m === "POST") {
          const body = (await readBody(req)) || {};
          const amount = Number(body.amount);
          if (!(amount > 0)) return sendJson(res, 400, { error: "Amount required." });
          const receiver = String(body.receivedBy || "").trim() || sess.username;
          const info = db.prepare(
            "INSERT INTO payment_received (event_id, cycle_index, cycle_name, amount, mode, receiver_type, received_by, notes) VALUES (?,?,?,?,?,?,?,?)"
          ).run(evRow.id, Number(body.cycleIndex)||0, String(body.cycleName||"").trim(), amount, String(body.mode || "cash"), String(body.receiverType || "sales"), receiver, String(body.notes||"").trim()||null);
          auditLog(sess, req, "CREATE", "payment-received", id, `₹${amount} for ${body.cycleName||"cycle"}`);
          // Log to field log too
          const ip = req.socket.remoteAddress || req.headers["x-forwarded-for"] || null;
          db.prepare("INSERT INTO event_field_log (event_client_id,event_name,username,action,section,field,old_value,new_value,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)")
            .run(id, evRow.event_name, sess.username, "update", "payment_schedule",
              `Payment Received: ${body.cycleName||"cycle"}`, null, `₹${amount} marked received`, ip, (req.headers["user-agent"]||"").slice(0,200));
          return sendJson(res, 200, { ok: true, id: info.lastInsertRowid });
        }
      }
      if (sub.length === 5 && sub[2] === "payment-received" && sub[4] === "mail" && m === "POST") {
        const evRow = findEventRow(id);
        if (!evRow) return sendJson(res, 404, { error: "Not found" });
        const paymentId = Number(decodeURIComponent(sub[3]));
        const payment = db.prepare("SELECT * FROM payment_received WHERE id = ? AND event_id = ?").get(paymentId, evRow.id);
        if (!payment) return sendJson(res, 404, { error: "Payment not found." });
        const ev = mapEventRow(evRow);
        const email = ev.invoiceKyc?.email || "";
        if (!email) return sendJson(res, 400, { error: "Client email is not available for this event." });
        db.prepare("UPDATE payment_received SET mail_sent_at=CURRENT_TIMESTAMP, mail_sent_to=?, mail_sent_by=? WHERE id=?").run(email, sess.username, paymentId);
        auditLog(sess, req, "SEND_MAIL", "payment-received", id, `receipt mail to ${email}`);
        return sendJson(res, 200, { ok: true, to: email, localOnly: true });
      }
      if (sub.length === 3 && sub[2] === "in-house-charges") {
        const evRow = findEventRow(id);
        if (!evRow) return sendJson(res, 404, { error: "Not found" });
        if (m === "GET") {
          return sendJson(res, 200, db.prepare("SELECT * FROM in_house_charges WHERE event_id = ? ORDER BY created_at").all(evRow.id));
        }
        if (m === "POST") {
          const body = (await readBody(req)) || {};
          const amount = Number(body.amount);
          if (!(amount > 0)) return sendJson(res, 400, { error: "Amount required." });
          const info = db.prepare("INSERT INTO in_house_charges (event_id, head, category, person, description, amount, created_by) VALUES (?,?,?,?,?,?,?)")
            .run(evRow.id, String(body.head || body.category || "Other"), String(body.category || body.head || "Other"), String(body.person || ""), String(body.description || ""), amount, sess.username);
          auditLog(sess, req, "CREATE", "in-house-charge", id, `₹${amount}`);
          return sendJson(res, 200, { ok: true, id: info.lastInsertRowid });
        }
      }
    }

    // Master persons
    if (sub[0] === "master-persons" && sub.length === 1) {
      if (m === "GET") return sendJson(res, 200, readMasterPersons());
      if (m === "PUT") {
        const result = writeMasterPersons((await readBody(req)) || []);
        auditLog(sess, req, "UPDATE", "master-persons", null, null);
        if (gSync.isEnabled()) gSync.syncMasterPersons(result);
        return sendJson(res, 200, result);
      }
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
  if (pathname === "/") pathname = "/dashboard.html";

  if (pathname === "/__livereload.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    return res.end(LIVERELOAD_JS);
  }

  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream", ...NGROK_HDR };
    if (ext === ".html") {
      fs.readFile(filePath, "utf8", (readErr, html) => {
        if (readErr) { res.writeHead(500, { "Content-Type": "text/plain" }); return res.end("Read error"); }
        const tag = '<script src="/__livereload.js"></script>';
        html = html.includes("</body>") ? html.replace("</body>", `  ${tag}\n</body>`) : html + tag;
        headers["Content-Length"] = Buffer.byteLength(html);
        headers["Cache-Control"] = "no-cache";
        res.writeHead(200, headers);
        res.end(html);
      });
      return;
    }
    headers["Cache-Control"] = url.search ? "public, max-age=31536000, immutable" : "public, max-age=3600";
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
seedUsers();
gSync.loadConfig();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`ODC dashboard running:  http://0.0.0.0:${PORT}`);
  console.log(`SQLite DB: ${DB_PATH}  |  live-reload: on`);
});

"use strict";

const http = require("node:http");
const fs   = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool, types } = require("pg");

// pg returns BIGSERIAL/BIGINT as strings by default; parse as numbers.
types.setTypeParser(20, (v) => parseInt(v, 10));

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5050;
const GST_RATE = 0.05;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SCRYPT_N   = 16384;
const SCRYPT_R   = 8;
const SCRYPT_P   = 1;
const SCRYPT_LEN = 64;

/* ----------------------------------------------------------------------- *
 * PostgreSQL connection pool
 * ----------------------------------------------------------------------- */

const pool = new Pool({
  host:     process.env.PGHOST     || "postgres",
  port:     Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "odc",
  user:     process.env.PGUSER     || "ticketops",
  password: process.env.PGPASSWORD || "Ticketops@2024!",
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Convert SQLite-style ? placeholders to PostgreSQL $1, $2, …
function q(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Thin query helpers (use pool by default, or a client for transactions)
async function qGet(sql, params = [], db = pool) {
  const { rows } = await db.query(q(sql), params);
  return rows[0] || null;
}
async function qAll(sql, params = [], db = pool) {
  const { rows } = await db.query(q(sql), params);
  return rows;
}
async function qRun(sql, params = [], db = pool) {
  return db.query(q(sql), params);
}

/* ----------------------------------------------------------------------- *
 * Startup: init schema + sessions cleanup
 * ----------------------------------------------------------------------- */

async function initSchema() {
  const q = (sql) => pool.query(sql);
  await q(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    username TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    expires_at BIGINT NOT NULL,
    login_at BIGINT NOT NULL
  )`);
  await q(`CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
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
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','planning','completed','cancelled')),
    event_time TEXT,
    food_type TEXT CHECK (food_type IS NULL OR food_type IN ('jain','non-jain')),
    allergic_count INTEGER NOT NULL DEFAULT 0,
    allergic_notes TEXT,
    location_zone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS payment_cycles (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    cycle_name TEXT NOT NULL,
    due_date TEXT,
    amount REAL NOT NULL DEFAULT 0,
    billing_type TEXT NOT NULL DEFAULT 'cash' CHECK (billing_type IN ('cash','online')),
    online_method TEXT CHECK (online_method IS NULL OR online_method IN ('UPI','Card','Cheque','Bank Transfer')),
    is_advance INTEGER NOT NULL DEFAULT 0 CHECK (is_advance IN (0,1)),
    pay_amount REAL,
    pay_received INTEGER NOT NULL DEFAULT 0 CHECK (pay_received IN (0,1)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS invoice_kyc (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
    client_name TEXT,
    mobile TEXT,
    email TEXT,
    gst_number TEXT,
    pan_number TEXT,
    aadhar_number TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS invoices (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    online_subtotal REAL NOT NULL DEFAULT 0,
    gst_rate REAL NOT NULL DEFAULT 5,
    gst_amount REAL NOT NULL DEFAULT 0,
    invoice_total REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','paid','cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS pre_cost_plans (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
    planning_date TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','locked')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS pre_cost_items (
    id BIGSERIAL PRIMARY KEY,
    plan_id BIGINT NOT NULL REFERENCES pre_cost_plans(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    item_name TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    unit TEXT,
    unit_cost REAL NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    vendor_name TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS master_heads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  await q(`CREATE TABLE IF NOT EXISTS master_persons (
    id BIGSERIAL PRIMARY KEY,
    head_id TEXT NOT NULL REFERENCES master_heads(id) ON DELETE CASCADE,
    person_name TEXT NOT NULL,
    person_code TEXT,
    person_designation TEXT,
    person_department TEXT,
    person_location TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  await q(`CREATE TABLE IF NOT EXISTS petty_cash_rows (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    row_type TEXT NOT NULL CHECK (row_type IN ('payout','petty')),
    head_id TEXT,
    person_name TEXT,
    purpose TEXT,
    amount REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  await q(`CREATE TABLE IF NOT EXISTS pre_cost_inputs (
    event_id BIGINT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    food_cost_per_pax REAL NOT NULL DEFAULT 0,
    staff_count REAL NOT NULL DEFAULT 0,
    total_staff_cost REAL NOT NULL DEFAULT 0,
    equipment_depreciation REAL NOT NULL DEFAULT 0,
    third_party_vendor REAL NOT NULL DEFAULT 0,
    decor_charge REAL NOT NULL DEFAULT 0,
    miscellaneous_cost REAL NOT NULL DEFAULT 0,
    staff_transportation_charge REAL NOT NULL DEFAULT 0,
    staff_accommodation_charge REAL NOT NULL DEFAULT 0,
    staff_food_cost REAL NOT NULL DEFAULT 0,
    refervan_charge REAL NOT NULL DEFAULT 0,
    equipment_transportation_charge REAL NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    profit_loss REAL NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    detail TEXT,
    ip_address TEXT,
    user_agent TEXT,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS bill_submissions (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    submitted_by_user_id BIGINT,
    head_id TEXT NOT NULL,
    person_name TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'misc' CHECK (category IN ('food','transport','equipment','accommodation','misc')),
    receipt_file_name TEXT,
    receipt_drive_file_id TEXT,
    receipt_drive_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ
  )`);
  await q(`CREATE TABLE IF NOT EXISTS event_field_log (
    id BIGSERIAL PRIMARY KEY,
    event_client_id TEXT NOT NULL,
    event_name TEXT,
    username TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('create','update','petty_cash','pre_cost','delete')),
    section TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    ip_address TEXT,
    user_agent TEXT,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS payment_received (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    cycle_index INTEGER NOT NULL,
    cycle_name TEXT,
    amount REAL NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'cash',
    receiver_type TEXT NOT NULL DEFAULT 'sales',
    received_by TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT,
    mail_sent_at TIMESTAMPTZ,
    mail_sent_to TEXT,
    mail_sent_by TEXT
  )`);
  await q(`CREATE TABLE IF NOT EXISTS in_house_charges (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    head TEXT NOT NULL DEFAULT 'Other',
    category TEXT NOT NULL DEFAULT 'Other',
    person TEXT,
    description TEXT,
    amount REAL NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_events_status ON events(status)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_events_client_id ON events(client_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_payment_cycles_event_id ON payment_cycles(event_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_master_persons_head_id ON master_persons(head_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_petty_cash_event_id ON petty_cash_rows(event_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_bill_submissions_event ON bill_submissions(event_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_event_field_log_client ON event_field_log(event_client_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_payment_received_event ON payment_received(event_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_in_house_charges_event ON in_house_charges(event_id)`);
}

async function initDb() {
  // Purge expired sessions
  await pool.query(`DELETE FROM sessions WHERE expires_at <= ${Date.now()}`);
}

/* ----------------------------------------------------------------------- *
 * Authentication — DB-backed sessions
 * ----------------------------------------------------------------------- */

const sessions = {
  async set(token, s) {
    await qRun(
      "INSERT INTO sessions (token,user_id,username,role,expires_at,login_at) VALUES (?,?,?,?,?,?) ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id,username=EXCLUDED.username,role=EXCLUDED.role,expires_at=EXCLUDED.expires_at,login_at=EXCLUDED.login_at",
      [token, s.userId, s.username, s.role, s.expiresAt, s.loginAt]
    );
  },
  async get(token) {
    const row = await qGet("SELECT * FROM sessions WHERE token = ?", [token]);
    if (!row) return undefined;
    return { userId: row.user_id, username: row.username, role: row.role, expiresAt: row.expires_at, loginAt: row.login_at };
  },
  async delete(token) { await qRun("DELETE FROM sessions WHERE token = ?", [token]); },
  async entries() {
    const rows = await qAll("SELECT * FROM sessions");
    return rows.map((row) => [
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
    return crypto.createHash("sha256").update(String(pw)).digest("hex") === stored;
  }
  const [, salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(String(pw), salt, SCRYPT_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString("hex");
  try { return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex")); }
  catch { return false; }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    try { out[decodeURIComponent(part.slice(0, idx).trim())] = decodeURIComponent(part.slice(idx + 1).trim()); }
    catch { /* ignore */ }
  }
  return out;
}

async function createSession(userId, username, role) {
  const token = crypto.randomBytes(32).toString("hex");
  await sessions.set(token, { userId, username, role, expiresAt: Date.now() + SESSION_TTL_MS, loginAt: Date.now() });
  return token;
}

async function getSession(token) {
  const s = await sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { await sessions.delete(token); return null; }
  return s;
}

async function deleteSession(token) { await sessions.delete(token); }

async function sessionFromReq(req) {
  const token = parseCookies(req).odc_session;
  return token ? getSession(token) : null;
}

/* ----------------------------------------------------------------------- *
 * Login rate limiter — in-memory
 * ----------------------------------------------------------------------- */

const loginAttempts = new Map();
const LOGIN_MAX       = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS   = 30 * 60 * 1000;

function checkLoginRate(ip) {
  const now = Date.now();
  const e = loginAttempts.get(ip) || { count: 0, firstAt: now, lockedUntil: 0 };
  if (e.lockedUntil > now) return false;
  if (now - e.firstAt > LOGIN_WINDOW_MS) { loginAttempts.set(ip, { count: 1, firstAt: now, lockedUntil: 0 }); return true; }
  e.count++;
  if (e.count > LOGIN_MAX) { e.lockedUntil = now + LOGIN_LOCK_MS; loginAttempts.set(ip, e); return false; }
  loginAttempts.set(ip, e);
  return true;
}
function resetLoginRate(ip) { loginAttempts.delete(ip); }

/* ----------------------------------------------------------------------- *
 * Users
 * ----------------------------------------------------------------------- */

async function getUser(username) {
  return qGet("SELECT * FROM users WHERE username = ?", [String(username).toLowerCase()]);
}

async function seedUsers() {
  const row = await qGet("SELECT COUNT(*) AS n FROM users");
  if (Number(row.n) === 0) {
    await qRun("INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)",
      ["aiops", hashPw("AIops"), "Admin", "admin"]);
    console.log("Default admin created  →  username: aiops  password: AIops");
  }
}

/* ----------------------------------------------------------------------- *
 * Audit log
 * ----------------------------------------------------------------------- */

async function auditLog(sess, req, action, entityType, entityId, detail) {
  try {
    await qRun(
      "INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, detail, ip_address, user_agent) VALUES (?,?,?,?,?,?,?,?)",
      [sess.userId, sess.username, action, entityType,
       entityId != null ? String(entityId) : null, detail != null ? String(detail) : null,
       req.socket.remoteAddress || req.headers["x-forwarded-for"] || null,
       req.headers["user-agent"] || null]
    );
  } catch (e) { console.warn("audit log write failed:", e.message); }
}

async function auditLogLogin(username, userId, req, action) {
  try {
    await qRun(
      "INSERT INTO audit_log (user_id, username, action, entity_type, ip_address, user_agent) VALUES (?,?,?,?,?,?)",
      [userId, username, action, "auth",
       req.socket.remoteAddress || req.headers["x-forwarded-for"] || null,
       req.headers["user-agent"] || null]
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
    submittedAt: r.submitted_at instanceof Date ? r.submitted_at.toISOString() : (r.submitted_at || ""),
    reviewedBy: r.reviewed_by || "",
    reviewedAt: r.reviewed_at instanceof Date ? r.reviewed_at.toISOString() : (r.reviewed_at || "")
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

async function getAllBills() {
  return (await qAll(BILLS_SQL + " ORDER BY bs.submitted_at DESC")).map(mapBillRow);
}

async function getUserBills(userId) {
  return (await qAll(BILLS_SQL + " WHERE bs.submitted_by_user_id = ? ORDER BY bs.submitted_at DESC", [userId])).map(mapBillRow);
}

async function createBill(sess, data) {
  const ev = await findEventRow(String(data.eventId || ""));
  if (!ev) { const e = new Error("Unknown event."); e.statusCode = 404; throw e; }
  if (!data.headId || !String(data.personName || "").trim()) {
    const e = new Error("Head and person name are required."); e.statusCode = 400; throw e;
  }
  const amount = Number(data.amount);
  if (!(amount > 0)) { const e = new Error("Amount must be greater than 0."); e.statusCode = 400; throw e; }
  const validCategories = ["food", "transport", "equipment", "accommodation", "misc"];
  const category = validCategories.includes(data.category) ? data.category : "misc";
  const receiptFileName = String(data.receipt?.fileName || "").trim().slice(0, 180);
  const result = await qRun(
    "INSERT INTO bill_submissions (event_id, submitted_by_user_id, head_id, person_name, amount, description, category, receipt_file_name) VALUES (?,?,?,?,?,?,?,?) RETURNING id",
    [ev.id, sess.userId, String(data.headId), String(data.personName).trim(), amount, String(data.description || "").trim(), category, receiptFileName]
  );
  return { id: result.rows[0].id, eventName: ev.event_name };
}

async function reviewBill(billId, status, reviewerUsername) {
  if (!["approved", "rejected"].includes(status)) {
    const e = new Error("Status must be 'approved' or 'rejected'."); e.statusCode = 400; throw e;
  }
  const result = await qRun(
    "UPDATE bill_submissions SET status=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?",
    [status, reviewerUsername, Number(billId)]
  );
  if (result.rowCount === 0) { const e = new Error("Bill not found."); e.statusCode = 404; throw e; }
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

async function mapEventRow(row, db = pool) {
  const cycles = await qAll("SELECT * FROM payment_cycles WHERE event_id = ? ORDER BY id", [row.id], db);
  const kyc    = await qGet("SELECT * FROM invoice_kyc WHERE event_id = ?", [row.id], db);
  return mapEventRowWithChildren(row, cycles, kyc);
}

async function getAllEvents() {
  const rows = await qAll("SELECT * FROM events ORDER BY event_date");
  if (rows.length === 0) return [];

  const allCycles = await qAll("SELECT * FROM payment_cycles ORDER BY event_id, id");
  const cyclesByEvent = new Map();
  for (const c of allCycles) {
    if (!cyclesByEvent.has(c.event_id)) cyclesByEvent.set(c.event_id, []);
    cyclesByEvent.get(c.event_id).push(c);
  }

  const allKyc = await qAll("SELECT * FROM invoice_kyc");
  const kycByEvent = new Map(allKyc.map((k) => [k.event_id, k]));

  return rows.map((row) => mapEventRowWithChildren(row, cyclesByEvent.get(row.id) || [], kycByEvent.get(row.id)));
}

async function findEventRow(clientId, db = pool) {
  return qGet("SELECT * FROM events WHERE client_id = ?", [String(clientId)], db);
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

async function logFieldChange(db, clientId, eventName, username, action, section, field, oldVal, newVal, ip, ua) {
  const o = String(oldVal == null ? "" : oldVal);
  const n = String(newVal == null ? "" : newVal);
  if (o === n) return;
  try {
    await qRun(
      "INSERT INTO event_field_log (event_client_id,event_name,username,action,section,field,old_value,new_value,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [clientId, eventName || "", username, action, section, field, o || null, n || null, ip, ua],
      db
    );
  } catch (e) { console.warn("field log write failed:", e.message); }
}

async function writeFieldLog(db, clientId, eventName, existingRow, e, cycles, kyc, sess, req) {
  const ip = req ? (req.socket.remoteAddress || req.headers["x-forwarded-for"] || null) : null;
  const ua = req ? ((req.headers["user-agent"] || "").slice(0, 200) || null) : null;
  const username = sess ? sess.username : "system";
  const isCreate = !existingRow;
  const action = isCreate ? "create" : "update";

  for (const f of CORE_FIELDS) {
    const oldVal = isCreate ? null : (existingRow[f.col] == null ? "" : String(existingRow[f.col]));
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
      if (newVal !== "" && newVal !== "0") await logFieldChange(db, clientId, e.name, username, action, "core", f.label, null, newVal, ip, ua);
    } else {
      await logFieldChange(db, clientId, e.name, username, action, "core", f.label, oldVal, newVal, ip, ua);
    }
  }

  const newKyc = e.invoiceKyc || {};
  for (const f of KYC_FIELDS) {
    const oldVal = isCreate ? null : (kyc ? (kyc[f.col] || "") : "");
    const newVal = String(newKyc[f.key] || "").trim();
    if (isCreate) {
      if (newVal) await logFieldChange(db, clientId, e.name, username, action, "kyc", f.label, null, newVal, ip, ua);
    } else {
      await logFieldChange(db, clientId, e.name, username, action, "kyc", f.label, oldVal, newVal, ip, ua);
    }
  }

  const newCycles = Array.isArray(e.paymentSchedule) ? e.paymentSchedule : [];
  if (isCreate) {
    if (newCycles.length) {
      await qRun(
        "INSERT INTO event_field_log (event_client_id,event_name,username,action,section,field,old_value,new_value,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [clientId, e.name || "", username, action, "payment_schedule", "Payment Schedule",
         null, `${newCycles.length} cycle(s): ${newCycles.map(c => `${c.label} ₹${c.amount}`).join(", ")}`, ip, ua],
        db
      );
    }
  } else {
    const oldSummary = cycles.map(c => `${c.cycle_name}:${c.amount}:${c.billing_type}`).join("|");
    const newSummary = newCycles.map(c => `${c.label}:${c.amount}:${c.billing}`).join("|");
    if (oldSummary !== newSummary) {
      await qRun(
        "INSERT INTO event_field_log (event_client_id,event_name,username,action,section,field,old_value,new_value,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [clientId, e.name || "", username, "update", "payment_schedule", "Payment Schedule",
         cycles.map(c => `${c.cycle_name} ₹${c.amount} (${c.billing_type})`).join(", ") || "—",
         newCycles.map(c => `${c.label} ₹${c.amount} (${c.billing})`).join(", ") || "—",
         ip, ua],
        db
      );
    }
  }
}

/* ----------------------------------------------------------------------- *
 * Event write (upsert by client_id, transactional)
 * ----------------------------------------------------------------------- */

async function upsertEvent(e, sess, req) {
  const errors = validateEvent(e);
  if (errors.length) { const err = new Error(errors.join(" ")); err.statusCode = 400; throw err; }

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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await findEventRow(clientId, client);
    let eventId;

    const oldCycles = existing ? await qAll("SELECT * FROM payment_cycles WHERE event_id = ? ORDER BY id", [existing.id], client) : [];
    const oldKyc    = existing ? await qGet("SELECT * FROM invoice_kyc WHERE event_id = ?", [existing.id], client) : null;

    if (existing) {
      await qRun(
        "UPDATE events SET external_id=?,entry_date=?,event_date=?,event_name=?,location=?,pax=?,event_days=?,cost_per_pax=?,total_billing=?,status=?,event_time=?,food_type=?,allergic_count=?,allergic_notes=?,location_zone=?,updated_at=NOW() WHERE id=?",
        [e.externalId || existing.external_id, e.entryDate || "", e.date, e.name.trim(), e.location.trim(), pax, days, costPerPax, totalBilling, status, eventTime, foodType, allergicCount, allergicNotes, locationZone, existing.id],
        client
      );
      eventId = existing.id;
      await qRun("DELETE FROM payment_cycles WHERE event_id = ?", [eventId], client);
      await qRun("DELETE FROM invoice_kyc WHERE event_id = ?", [eventId], client);
    } else {
      const result = await qRun(
        "INSERT INTO events (client_id,external_id,entry_date,event_date,event_name,location,pax,event_days,cost_per_pax,total_billing,status,event_time,food_type,allergic_count,allergic_notes,location_zone) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id",
        [clientId, e.externalId || "", e.entryDate || "", e.date, e.name.trim(), e.location.trim(), pax, days, costPerPax, totalBilling, status, eventTime, foodType, allergicCount, allergicNotes, locationZone],
        client
      );
      eventId = result.rows[0].id;
    }

    const cycles = Array.isArray(e.paymentSchedule) ? e.paymentSchedule : [];
    for (const c of cycles) {
      const billing = c.billing === "online" ? "online" : "cash";
      const method = billing === "online" ? (["UPI", "Card", "Cheque", "Bank Transfer"].includes(c.method) ? c.method : "UPI") : null;
      await qRun(
        "INSERT INTO payment_cycles (event_id,cycle_name,due_date,amount,billing_type,online_method,is_advance) VALUES (?,?,?,?,?,?,?)",
        [eventId, String(c.label || "Payment").trim() || "Payment", c.dueDate || null, Number(c.amount) || 0, billing, method, !!c.isAdvance],
        client
      );
    }

    const k = e.invoiceKyc || {};
    const hasKyc = ["name", "mobile", "email", "gst", "pan", "aadhar"].some((key) => String(k[key] || "").trim());
    if (hasKyc) {
      await qRun(
        "INSERT INTO invoice_kyc (event_id,client_name,mobile,email,gst_number,pan_number,aadhar_number) VALUES (?,?,?,?,?,?,?)",
        [eventId, String(k.name || "").trim(), String(k.mobile || "").trim(), String(k.email || "").trim(), String(k.gst || "").trim().toUpperCase(), String(k.pan || "").trim().toUpperCase(), String(k.aadhar || "").trim()],
        client
      );
    }

    await writeFieldLog(client, clientId, e.name || "", existing, e, oldCycles, oldKyc, sess, req);

    await client.query("COMMIT");
    return mapEventRow(await findEventRow(clientId), client);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function deleteEvent(clientId) {
  const row = await findEventRow(clientId);
  if (!row) return false;
  await qRun("DELETE FROM events WHERE id = ?", [row.id]);
  return true;
}

/* ----------------------------------------------------------------------- *
 * Master persons
 * ----------------------------------------------------------------------- */

async function readMasterPersons(db = pool) {
  const heads = await qAll("SELECT * FROM master_heads ORDER BY sort_order, name", [], db);
  const result = [];
  for (const h of heads) {
    const persons = await qAll(
      "SELECT person_name,person_code,person_designation,person_department,person_location FROM master_persons WHERE head_id = ? ORDER BY sort_order, id",
      [h.id], db
    );
    result.push({
      id: h.id, name: h.name,
      persons: persons.map((p) => ({ name: p.person_name, code: p.person_code || "", designation: p.person_designation || "", department: p.person_department || "", location: p.person_location || "" }))
    });
  }
  return result;
}

async function writeMasterPersons(heads) {
  if (!Array.isArray(heads)) { const e = new Error("Expected an array of heads."); e.statusCode = 400; throw e; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM master_persons");
    await client.query("DELETE FROM master_heads");
    for (let hi = 0; hi < heads.length; hi++) {
      const h = heads[hi];
      const id = String(h.id || `head-${hi}`).trim();
      const name = String(h.name || "").trim();
      if (!name) continue;
      await qRun("INSERT INTO master_heads (id, name, sort_order) VALUES (?,?,?)", [id, name, hi], client);
      const persons = Array.isArray(h.persons) ? h.persons : [];
      for (let pi = 0; pi < persons.length; pi++) {
        const p = typeof persons[pi] === "string" ? { name: persons[pi] } : (persons[pi] || {});
        const personName = String(p.name || p.personName || "").trim();
        if (!personName) continue;
        await qRun(
          "INSERT INTO master_persons (head_id,person_name,person_code,person_designation,person_department,person_location,sort_order) VALUES (?,?,?,?,?,?,?)",
          [id, personName, String(p.code || p.employeeCode || "").trim() || null, String(p.designation || "").trim() || null, String(p.department || "").trim() || null, String(p.location || "").trim() || null, pi],
          client
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return readMasterPersons();
}

/* ----------------------------------------------------------------------- *
 * Petty cash (per event)
 * ----------------------------------------------------------------------- */

async function readPettyCash(clientId) {
  const ev = await findEventRow(clientId);
  const empty = { payouts: [], petty: [] };
  if (!ev) return empty;
  const rows = await qAll("SELECT * FROM petty_cash_rows WHERE event_id = ? ORDER BY row_type, sort_order, id", [ev.id]);
  const out = { payouts: [], petty: [] };
  for (const r of rows) {
    if (r.row_type === "payout") out.payouts.push({ headId: r.head_id || "", person: r.person_name || "", purpose: r.purpose || "", amount: r.amount });
    else out.petty.push({ expense: r.person_name || "", purpose: r.purpose || "", amount: r.amount });
  }
  return out;
}

async function writePettyCash(clientId, data) {
  const ev = await findEventRow(clientId);
  if (!ev) { const err = new Error("Unknown event."); err.statusCode = 404; throw err; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await qRun("DELETE FROM petty_cash_rows WHERE event_id = ?", [ev.id], client);
    const payouts = data.payouts || [];
    const petty   = data.petty || [];
    for (let i = 0; i < payouts.length; i++) {
      const r = payouts[i];
      await qRun("INSERT INTO petty_cash_rows (event_id,row_type,head_id,person_name,purpose,amount,sort_order) VALUES (?,?,?,?,?,?,?)",
        [ev.id, "payout", String(r.headId || ""), String(r.person || ""), String(r.purpose || ""), Number(r.amount) || 0, i], client);
    }
    for (let i = 0; i < petty.length; i++) {
      const r = petty[i];
      await qRun("INSERT INTO petty_cash_rows (event_id,row_type,head_id,person_name,purpose,amount,sort_order) VALUES (?,?,?,?,?,?,?)",
        [ev.id, "petty", "", String(r.expense || ""), String(r.purpose || ""), Number(r.amount) || 0, i], client);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return readPettyCash(clientId);
}

/* ----------------------------------------------------------------------- *
 * Pre-cost inputs (per event)
 * ----------------------------------------------------------------------- */

const PRECOST_FIELDS = ["foodCostPerPax", "staffCount", "totalStaffCost", "equipmentDepreciation", "thirdPartyVendor", "decorCharge", "miscellaneousCost", "staffTransportationCharge", "staffAccommodationCharge", "staffFoodCost", "refervanCharge", "equipmentTransportationCharge", "totalCost", "profitLoss"];
const PRECOST_COLS   = ["food_cost_per_pax", "staff_count", "total_staff_cost", "equipment_depreciation", "third_party_vendor", "decor_charge", "miscellaneous_cost", "staff_transportation_charge", "staff_accommodation_charge", "staff_food_cost", "refervan_charge", "equipment_transportation_charge", "total_cost", "profit_loss"];

async function readPreCost(clientId) {
  const ev = await findEventRow(clientId);
  const empty = Object.fromEntries(PRECOST_FIELDS.map((f) => [f, 0]));
  if (!ev) return empty;
  const row = await qGet("SELECT * FROM pre_cost_inputs WHERE event_id = ?", [ev.id]);
  if (!row) return empty;
  return Object.fromEntries(PRECOST_FIELDS.map((f, i) => [f, row[PRECOST_COLS[i]]]));
}

async function writePreCost(clientId, data) {
  const ev = await findEventRow(clientId);
  if (!ev) { const err = new Error("Unknown event."); err.statusCode = 404; throw err; }
  const vals = PRECOST_FIELDS.map((f) => Number(data[f]) || 0);
  await qRun(
    `INSERT INTO pre_cost_inputs (event_id,${PRECOST_COLS.join(",")},updated_at) VALUES (?,${PRECOST_COLS.map(() => "?").join(",")},NOW()) ON CONFLICT(event_id) DO UPDATE SET ${PRECOST_COLS.map((c) => `${c}=EXCLUDED.${c}`).join(",")},updated_at=NOW()`,
    [ev.id, ...vals]
  );
  return readPreCost(clientId);
}

/* ----------------------------------------------------------------------- *
 * Seed
 * ----------------------------------------------------------------------- */

async function seed() {
  const row = await qGet("SELECT COUNT(*) AS n FROM events");
  if (Number(row.n) === 0) {
    const samples = [
      { client_id: "1", external_id: "EVT-2026-001", entry_date: "2026-05-01", event_date: "2026-06-28", event_name: "Grand Royal Wedding Reception", location: "Elysian Palace, Bangalore", pax: 350, event_days: 2, cost_per_pax: 1500, status: "planning" },
      { client_id: "2", external_id: "EVT-2026-002", entry_date: "2026-05-01", event_date: "2026-07-12", event_name: "Tech Summit Corporate Dinner", location: "Ritz-Carlton, Bangalore", pax: 150, event_days: 1, cost_per_pax: 2200, status: "open" },
      { client_id: "3", external_id: "EVT-2026-003", entry_date: "2026-05-01", event_date: "2026-05-30", event_name: "Annual Gala Dinner", location: "Lakeside Pavilion, Hyderabad", pax: 500, event_days: 1, cost_per_pax: 1800, status: "open" }
    ];
    for (const s of samples) {
      const baseBilling = s.pax * s.event_days * s.cost_per_pax;
      await qRun(
        "INSERT INTO events (client_id,external_id,entry_date,event_date,event_name,location,pax,event_days,cost_per_pax,total_billing,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [s.client_id, s.external_id, s.entry_date, s.event_date, s.event_name, s.location, s.pax, s.event_days, s.cost_per_pax, baseBilling + (baseBilling * GST_RATE), s.status]
      );
    }
  }

  const heads = await qGet("SELECT COUNT(*) AS n FROM master_heads");
  if (Number(heads.n) === 0) {
    await writeMasterPersons([
      { id: "head-operations", name: "Operations Head", persons: ["Floor Manager", "Logistics Lead", "Service Supervisor"] },
      { id: "head-kitchen",    name: "Kitchen Head",    persons: ["Head Chef", "Food Runner Lead", "Utility Lead"] }
    ]);
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
    for (const res of reloadClients) { try { res.write("data: reload\n\n"); } catch { /* ignore */ } }
  }, 120);
}

try {
  fs.watch(ROOT, { recursive: true }, (_evt, filename) => {
    if (!filename) return;
    const f = String(filename);
    if (f.includes("node_modules") || f.startsWith(".")) return;
    if (/\.(html|css|js)$/i.test(f)) notifyReload();
  });
} catch (e) { console.warn("File watch unavailable (live reload off):", e.message); }

const LIVERELOAD_JS =
  `(function(){try{var s=new EventSource("/__livereload");s.onmessage=function(e){if(e.data==="reload")location.reload();};` +
  `s.onerror=function(){s.close();setTimeout(function(){location.reload();},1500);};}catch(_){}})();`;

/* ----------------------------------------------------------------------- *
 * HTTP server
 * ----------------------------------------------------------------------- */

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".sql": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };
const NGROK_HDR = { "ngrok-skip-browser-warning": "true" };

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), ...NGROK_HDR });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 5_000_000) { reject(new Error("Payload too large")); req.destroy(); } });
    req.on("end", () => {
      if (!data) return resolve(null);
      try { resolve(JSON.parse(data)); } catch { reject(Object.assign(new Error("Invalid JSON"), { statusCode: 400 })); }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const sub = parts.slice(1);
  const m = req.method;

  try {
    // POST /api/auth/login
    if (sub[0] === "auth" && sub[1] === "login" && m === "POST") {
      const body = await readBody(req);
      const username = String(body?.username || "").trim().toLowerCase();
      const user = await getUser(username);
      const ip = req.socket.remoteAddress || req.headers["x-forwarded-for"] || "unknown";
      if (!checkLoginRate(ip)) return sendJson(res, 429, { error: "Too many login attempts. Try again in 30 minutes." });
      if (!user || !verifyPw(body?.password || "", user.password_hash)) return sendJson(res, 401, { error: "Invalid username or password." });
      resetLoginRate(ip);
      if (user.password_hash && !user.password_hash.startsWith("scrypt:")) {
        await qRun("UPDATE users SET password_hash = ? WHERE id = ?", [hashPw(body.password || ""), user.id]);
      }
      const token = await createSession(user.id, user.username, user.role);
      await auditLogLogin(user.username, user.id, req, "LOGIN");
      res.setHeader("Set-Cookie", `odc_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
      return sendJson(res, 200, { username: user.username, role: user.role, fullName: user.full_name });
    }

    // GET /api/auth/me
    if (sub[0] === "auth" && sub[1] === "me" && m === "GET") {
      const s = await sessionFromReq(req);
      if (!s) return sendJson(res, 401, { error: "Not authenticated" });
      const user = await qGet("SELECT full_name FROM users WHERE id = ?", [s.userId]);
      return sendJson(res, 200, { username: s.username, role: s.role, fullName: user?.full_name || "" });
    }

    // POST /api/auth/logout
    if (sub[0] === "auth" && sub[1] === "logout" && m === "POST") {
      const token = parseCookies(req).odc_session;
      const s = token ? await getSession(token) : null;
      if (s) { await auditLogLogin(s.username, s.userId, req, "LOGOUT"); await deleteSession(token); }
      res.setHeader("Set-Cookie", "odc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
      return sendJson(res, 200, { ok: true });
    }

    // Public read: event log + header
    if (sub[0] === "events" && sub.length === 3 && sub[2] === "log" && m === "GET") {
      const id = decodeURIComponent(sub[1]);
      return sendJson(res, 200, await qAll(
        "SELECT id,event_client_id,event_name,username,action,section,field,old_value,new_value,ip_address,user_agent,ts FROM event_field_log WHERE event_client_id = ? ORDER BY ts DESC LIMIT 500",
        [id]
      ));
    }
    if (sub[0] === "events" && sub.length === 3 && sub[2] === "header" && m === "GET") {
      const id = decodeURIComponent(sub[1]);
      const row = await findEventRow(id);
      if (!row) return sendJson(res, 404, { error: "Not found" });
      return sendJson(res, 200, { id: row.client_id, name: row.event_name, date: row.event_date, location: row.location, status: row.status, locationZone: row.location_zone || "", pax: row.pax, days: row.event_days, costPerPax: row.cost_per_pax });
    }

    // All other routes require session
    const sess = await sessionFromReq(req);
    if (!sess) return sendJson(res, 401, { error: "Not authenticated" });

    // ADMIN: User management
    if (sub[0] === "auth" && sub[1] === "users") {
      if (sess.role !== "admin") return sendJson(res, 403, { error: "Admin only." });
      if (sub.length === 2 && m === "GET") {
        const users = await qAll("SELECT id, username, full_name, role, created_at FROM users ORDER BY id");
        return sendJson(res, 200, users.map((u) => ({ id: u.id, username: u.username, fullName: u.full_name, role: u.role, createdAt: u.created_at })));
      }
      if (sub.length === 2 && m === "POST") {
        const body = await readBody(req);
        const uname = String(body?.username || "").trim().toLowerCase();
        const pw = String(body?.password || "");
        if (!uname || pw.length < 4) return sendJson(res, 400, { error: "Username and password (min 4 chars) required." });
        const role = body?.role === "admin" ? "admin" : "user";
        try {
          await qRun("INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)", [uname, hashPw(pw), String(body?.fullName || "").trim(), role]);
          await auditLog(sess, req, "CREATE", "user", uname, null);
          return sendJson(res, 200, { ok: true });
        } catch (e) {
          if (e.code === "23505") return sendJson(res, 409, { error: "Username already exists." });
          throw e;
        }
      }
      if (sub.length === 3 && m === "DELETE") {
        const target = decodeURIComponent(sub[2]);
        if (target === "aiops") return sendJson(res, 400, { error: "Cannot delete the default admin account." });
        await qRun("DELETE FROM users WHERE username = ?", [target]);
        await auditLog(sess, req, "DELETE", "user", target, null);
        return sendJson(res, 200, { ok: true });
      }
      if (sub.length === 4 && sub[3] === "password" && m === "PUT") {
        const target = decodeURIComponent(sub[2]);
        const body = await readBody(req);
        const pw = String(body?.password || "");
        if (pw.length < 4) return sendJson(res, 400, { error: "Password must be at least 4 characters." });
        await qRun("UPDATE users SET password_hash = ? WHERE username = ?", [hashPw(pw), target]);
        await auditLog(sess, req, "UPDATE", "user", target, "password changed");
        return sendJson(res, 200, { ok: true });
      }
      if (sub.length === 3 && sub[3] !== "password" && m === "PUT") {
        const target = decodeURIComponent(sub[2]);
        const body = await readBody(req);
        const updates = [];
        const vals = [];
        if (body?.fullName !== undefined) { updates.push("full_name=?"); vals.push(String(body.fullName).trim()); }
        if (body?.role !== undefined && ["admin", "user"].includes(body.role)) { updates.push("role=?"); vals.push(body.role); }
        if (updates.length) {
          vals.push(target);
          await qRun(`UPDATE users SET ${updates.join(",")} WHERE username=?`, vals);
        }
        await auditLog(sess, req, "UPDATE", "user", target, null);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { error: "Unknown auth/users endpoint" });
    }

    // ADMIN: Audit log
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
      return sendJson(res, 200, await qAll(sql, params));
    }

    // ADMIN: Sessions
    if (sub[0] === "admin" && sub[1] === "sessions") {
      if (sess.role !== "admin") return sendJson(res, 403, { error: "Admin only." });
      if (m === "GET") {
        const now = Date.now();
        const active = [];
        for (const [, s] of await sessions.entries()) {
          if (s.expiresAt > now) {
            active.push({ username: s.username, role: s.role, loginAt: new Date(s.loginAt || (s.expiresAt - SESSION_TTL_MS)).toISOString(), expiresAt: new Date(s.expiresAt).toISOString() });
          }
        }
        return sendJson(res, 200, active);
      }
      if (m === "DELETE" && sub[2]) {
        const target = decodeURIComponent(sub[2]);
        for (const [token, s] of await sessions.entries()) {
          if (s.username === target) await sessions.delete(token);
        }
        await auditLog(sess, req, "FORCE_LOGOUT", "session", target, null);
        return sendJson(res, 200, { ok: true });
      }
    }

    // ADMIN: Status
    if (sub[0] === "admin" && sub[1] === "status" && m === "GET") {
      const evCount = await qGet("SELECT COUNT(*) AS n FROM events");
      const usCount = await qGet("SELECT COUNT(*) AS n FROM users");
      return sendJson(res, 200, { events: Number(evCount.n), users: Number(usCount.n), db: "postgresql" });
    }

    // ADMIN: Page hit telemetry
    if (sub[0] === "admin" && sub[1] === "page-hit" && m === "POST") {
      return sendJson(res, 200, { ok: true });
    }

    // Bills
    if (sub[0] === "bills") {
      if (sub.length === 1) {
        if (m === "GET") return sendJson(res, 200, sess.role === "admin" ? await getAllBills() : await getUserBills(sess.userId));
        if (m === "POST") {
          const body = await readBody(req);
          const created = await createBill(sess, body || {});
          await auditLog(sess, req, "CREATE", "bill", String(created.id), null);
          return sendJson(res, 200, { ok: true, id: created.id });
        }
      }
      if (sub.length === 2 && m === "PUT") {
        if (sess.role !== "admin") return sendJson(res, 403, { error: "Admin only." });
        const body = await readBody(req);
        await reviewBill(Number(sub[1]), body?.status, sess.username);
        await auditLog(sess, req, "UPDATE", "bill", sub[1], body?.status);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { error: "Unknown bills endpoint" });
    }

    // Events
    if (sub[0] === "events" && sub.length === 1) {
      if (m === "GET") return sendJson(res, 200, await getAllEvents());
      if (m === "POST") {
        const body = await readBody(req) || {};
        const existed = body.id ? !!(await findEventRow(String(body.id))) : false;
        const result = await upsertEvent(body, sess, req);
        await auditLog(sess, req, existed ? "UPDATE" : "CREATE", "event", result.id, null);
        return sendJson(res, 200, result);
      }
    }

    if (sub[0] === "events" && sub.length >= 2) {
      const id = decodeURIComponent(sub[1]);
      if (sub.length === 2) {
        if (m === "GET") {
          const row = await findEventRow(id);
          return row ? sendJson(res, 200, await mapEventRow(row)) : sendJson(res, 404, { error: "Not found" });
        }
        if (m === "DELETE") {
          const ok = await deleteEvent(id);
          if (ok) await auditLog(sess, req, "DELETE", "event", id, null);
          return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "Not found" });
        }
      }
      if (sub.length === 3 && sub[2] === "petty-cash") {
        if (m === "GET") return sendJson(res, 200, await readPettyCash(id));
        if (m === "PUT") {
          const result = await writePettyCash(id, (await readBody(req)) || {});
          await auditLog(sess, req, "UPDATE", "petty-cash", id, null);
          const evRow = await findEventRow(id);
          if (evRow) {
            const ip = req.socket.remoteAddress || req.headers["x-forwarded-for"] || null;
            const summary = `${(result.payouts||[]).length} payout(s), ${(result.petty||[]).length} expense(s), total ₹${[...(result.payouts||[]),...(result.petty||[])].reduce((s,r)=>s+(r.amount||0),0)}`;
            await qRun(
              "INSERT INTO event_field_log (event_client_id,event_name,username,action,section,field,old_value,new_value,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)",
              [id, evRow.event_name, sess.username, "petty_cash", "petty_cash", "Petty Cash Saved", null, summary, ip, (req.headers["user-agent"]||"").slice(0,200)]
            );
          }
          return sendJson(res, 200, result);
        }
      }
      if (sub.length === 3 && sub[2] === "pre-cost") {
        if (m === "GET") return sendJson(res, 200, await readPreCost(id));
        if (m === "PUT") {
          const result = await writePreCost(id, (await readBody(req)) || {});
          await auditLog(sess, req, "UPDATE", "pre-cost", id, null);
          const evRow = await findEventRow(id);
          if (evRow) {
            const ip = req.socket.remoteAddress || req.headers["x-forwarded-for"] || null;
            await qRun(
              "INSERT INTO event_field_log (event_client_id,event_name,username,action,section,field,old_value,new_value,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)",
              [id, evRow.event_name, sess.username, "pre_cost", "pre_cost", "Pre-Cost Plan Saved", null, `Total Cost ₹${result.totalCost||0}, P&L ₹${result.profitLoss||0}`, ip, (req.headers["user-agent"]||"").slice(0,200)]
            );
          }
          return sendJson(res, 200, result);
        }
      }
      if (sub.length === 3 && sub[2] === "log" && m === "GET") {
        return sendJson(res, 200, await qAll(
          "SELECT * FROM event_field_log WHERE event_client_id = ? ORDER BY ts DESC LIMIT 500", [id]
        ));
      }
      if (sub.length === 3 && sub[2] === "payment-received") {
        const evRow = await findEventRow(id);
        if (!evRow) return sendJson(res, 404, { error: "Not found" });
        if (m === "GET") return sendJson(res, 200, await qAll("SELECT * FROM payment_received WHERE event_id = ? ORDER BY received_at", [evRow.id]));
        if (m === "POST") {
          const body = (await readBody(req)) || {};
          const amount = Number(body.amount);
          if (!(amount > 0)) return sendJson(res, 400, { error: "Amount required." });
          const receiver = String(body.receivedBy || "").trim() || sess.username;
          const result = await qRun(
            "INSERT INTO payment_received (event_id,cycle_index,cycle_name,amount,mode,receiver_type,received_by,notes) VALUES (?,?,?,?,?,?,?,?) RETURNING id",
            [evRow.id, Number(body.cycleIndex)||0, String(body.cycleName||"").trim(), amount, String(body.mode || "cash"), String(body.receiverType || "sales"), receiver, String(body.notes||"").trim()||null]
          );
          await auditLog(sess, req, "CREATE", "payment-received", id, `₹${amount} for ${body.cycleName||"cycle"}`);
          const ip = req.socket.remoteAddress || req.headers["x-forwarded-for"] || null;
          await qRun(
            "INSERT INTO event_field_log (event_client_id,event_name,username,action,section,field,old_value,new_value,ip_address,user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [id, evRow.event_name, sess.username, "update", "payment_schedule", `Payment Received: ${body.cycleName||"cycle"}`, null, `₹${amount} marked received`, ip, (req.headers["user-agent"]||"").slice(0,200)]
          );
          return sendJson(res, 200, { ok: true, id: result.rows[0].id });
        }
      }
      if (sub.length === 5 && sub[2] === "payment-received" && sub[4] === "mail" && m === "POST") {
        const evRow = await findEventRow(id);
        if (!evRow) return sendJson(res, 404, { error: "Not found" });
        const paymentId = Number(decodeURIComponent(sub[3]));
        const payment = await qGet("SELECT * FROM payment_received WHERE id = ? AND event_id = ?", [paymentId, evRow.id]);
        if (!payment) return sendJson(res, 404, { error: "Payment not found." });
        const ev = await mapEventRow(evRow);
        const email = ev.invoiceKyc?.email || "";
        if (!email) return sendJson(res, 400, { error: "Client email is not available for this event." });
        await qRun("UPDATE payment_received SET mail_sent_at=NOW(),mail_sent_to=?,mail_sent_by=? WHERE id=?", [email, sess.username, paymentId]);
        await auditLog(sess, req, "SEND_MAIL", "payment-received", id, `receipt mail to ${email}`);
        return sendJson(res, 200, { ok: true, to: email, localOnly: true });
      }
      if (sub.length === 3 && sub[2] === "in-house-charges") {
        const evRow = await findEventRow(id);
        if (!evRow) return sendJson(res, 404, { error: "Not found" });
        if (m === "GET") return sendJson(res, 200, await qAll("SELECT * FROM in_house_charges WHERE event_id = ? ORDER BY created_at", [evRow.id]));
        if (m === "POST") {
          const body = (await readBody(req)) || {};
          const amount = Number(body.amount);
          if (!(amount > 0)) return sendJson(res, 400, { error: "Amount required." });
          const result = await qRun(
            "INSERT INTO in_house_charges (event_id,head,category,person,description,amount,created_by) VALUES (?,?,?,?,?,?,?) RETURNING id",
            [evRow.id, String(body.head || body.category || "Other"), String(body.category || body.head || "Other"), String(body.person || ""), String(body.description || ""), amount, sess.username]
          );
          await auditLog(sess, req, "CREATE", "in-house-charge", id, `₹${amount}`);
          return sendJson(res, 200, { ok: true, id: result.rows[0].id });
        }
      }
    }

    // Master persons
    if (sub[0] === "master-persons" && sub.length === 1) {
      if (m === "GET") return sendJson(res, 200, await readMasterPersons());
      if (m === "PUT") {
        const result = await writeMasterPersons((await readBody(req)) || []);
        await auditLog(sess, req, "UPDATE", "master-persons", null, null);
        return sendJson(res, 200, result);
      }
    }

    // Live version check (for store.js)
    if (sub[0] === "live" && sub[1] === "version" && m === "GET") {
      return sendJson(res, 200, { version: "pg-1.0" });
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

(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("PostgreSQL connected");
    await initSchema();
    await initDb();
    await seedUsers();
    await seed();
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`ODC dashboard running:  http://0.0.0.0:${PORT}`);
      console.log(`PostgreSQL DB: ${process.env.PGDATABASE || "odc"}  |  live-reload: on`);
    });
  } catch (err) {
    console.error("Startup failed:", err);
    process.exit(1);
  }
})();

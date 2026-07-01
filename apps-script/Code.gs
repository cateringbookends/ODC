/**
 * ODC Event Dashboard — Google Apps Script Database
 *
 * SETUP STEPS (one time):
 *  1. Go to script.google.com → New project → paste this code
 *  2. Click the gear icon (Project Settings) → Script Properties
 *     → Add property: API_KEY = (any strong random string, e.g. 32 random chars)
 *  3. Deploy → New deployment → Web app
 *     → Execute as: Me   |   Who has access: Anyone
 *  4. Copy the web app URL → paste into google-sync-config.json on the server
 *  5. Run: node setup-google-sheets.js   (one-time initial setup + full sync)
 */

// ---- Sheet headers ----
var HEADERS = {
  Events: [
    "ID", "External ID", "Entry Date", "Event Date", "Event Name",
    "Location", "Zone", "PAX", "Days", "Cost/PAX (Rs)",
    "Total Billing (Rs)", "Status", "Time", "Food Type",
    "Allergic Count", "Allergic Notes"
  ],
  PaymentSchedule: [
    "Event ID", "Cycle Name", "Due Date", "Amount (Rs)",
    "Billing Type", "Method", "Is Advance"
  ],
  InvoiceKYC: [
    "Event ID", "Client Name", "Mobile", "Email", "GST", "PAN", "Aadhaar"
  ],
  MasterPersons: [
    "Head ID", "Head Name", "Person Name", "Code",
    "Designation", "Department", "Location", "Email"
  ],
  PettyCash: [
    "Event ID", "Event Name", "Type",
    "Head ID", "Person / Expense", "Purpose", "Amount (Rs)"
  ],
  PreCost: [
    "Event ID", "Event Name", "Food Cost/PAX", "Staff Count", "Staff Cost",
    "Equipment Dep.", "3rd Party Vendor", "Decor", "Misc",
    "Staff Transport", "Staff Accom.", "Staff Food",
    "Refervan", "Equip Transport", "Total Cost", "Profit / Loss"
  ],
  BillSubmissions: [
    "ID", "Event", "Submitted By", "Head", "Person Name",
    "Amount (Rs)", "Description", "Category", "Status",
    "Submitted At", "Reviewed By", "Reviewed At", "Receipt File", "Receipt Drive URL"
  ],
  AuditLog: [
    "ID", "Username", "Action", "Entity Type", "Entity ID",
    "Detail", "IP Address", "User Agent", "Timestamp"
  ],
  Users: [
    "Username", "Full Name", "Role", "Password Hash", "Created At", "Updated At", "Active"
  ],
  Sessions: [
    "Session ID", "Username", "Role", "IP Address", "User Agent",
    "Login At", "Last Seen At", "Expires At", "Last Page", "Active"
  ]
};

// ---- Main entry points ----

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    var storedKey = PropertiesService.getScriptProperties().getProperty("API_KEY");
    if (!storedKey && body.action === "bootstrap_key" && body.apiKey) {
      PropertiesService.getScriptProperties().setProperty("API_KEY", String(body.apiKey));
      return out(200, { ok: true, message: "API key configured" });
    }

    // Auth
    if (!storedKey || body.apiKey !== storedKey) {
      return out(403, { error: "Unauthorized" });
    }

    var action = body.action;

    if (action === "setup") {
      setupAllSheets();
      return out(200, { ok: true, message: "All sheets ready" });
    }

    if (action === "proxy_api") {
      return out(200, api(body.method || "GET", body.path || "", body.body || {}));
    }

    if (action === "sync") {
      var sheetName = body.sheet;
      if (!HEADERS[sheetName]) return out(400, { error: "Unknown sheet: " + sheetName });
      syncSheet(sheetName, body.rows || []);
      return out(200, { ok: true, sheet: sheetName, rows: (body.rows || []).length });
    }

    if (action === "append_audit") {
      appendAuditRow(body.row || []);
      return out(200, { ok: true });
    }

    if (action === "upload_receipt") {
      return out(200, uploadReceiptToDrive(body));
    }

    if (action === "run_digest_now") {
      return out(200, runDailyManagerDigest_());
    }

    if (action === "ensure_digest_trigger") {
      return out(200, ensureDailyDigestTrigger_());
    }

    return out(400, { error: "Unknown action: " + action });
  } catch (err) {
    return out(500, { error: err.toString() });
  }
}

function requireAdmin_(body) {
  var user = body && body._user;
  if (!user || user.role !== "admin") throw new Error("Admin only.");
}

function api(method, path, body) {
  method = String(method || "GET").toUpperCase();
  path = String(path || "");
  body = body || {};

  if (path === "/api/auth/me" && method === "GET") {
    throw new Error("Not authenticated");
  }
  if (path === "/api/live/version" && method === "GET") return getLiveVersionForApi_();
  if (path === "/api/auth/login" && method === "POST") {
    var username = String(body.username || "").trim().toLowerCase();
    var password = String(body.password || "");
    var rateKey = "LOGIN_ATTEMPTS_" + username;
    var rateProps = PropertiesService.getScriptProperties();
    var rawState = rateProps.getProperty(rateKey);
    var state = rawState ? JSON.parse(rawState) : { count: 0, firstAttempt: 0, lockedUntil: 0 };
    var now = Date.now();
    if (state.lockedUntil && now < state.lockedUntil) {
      throw new Error("Too many login attempts. Try again in " + Math.ceil((state.lockedUntil - now) / 60000) + " minutes.");
    }
    if (!state.firstAttempt || now - state.firstAttempt > 15 * 60 * 1000) {
      state = { count: 0, firstAttempt: now, lockedUntil: 0 };
    }
    var user = findUserForApi_(username);
    if (user && user.active && verifyPasswordForApi_(password, user.passwordHash)) {
      rateProps.deleteProperty(rateKey);
      if (user.passwordHash.indexOf("pbkdf2:") !== 0) {
        upgradeUserPasswordHashForApi_(user.username, passwordHashForApi_(password));
      }
      return { username: user.username, fullName: user.fullName || user.username, role: user.role || "user" };
    }
    state.count += 1;
    if (state.count >= 10) state.lockedUntil = now + 30 * 60 * 1000;
    rateProps.setProperty(rateKey, JSON.stringify(state));
    throw new Error("Invalid username or password.");
  }
  if (path === "/api/auth/logout" && method === "POST") return { ok: true };
  if (path === "/api/auth/users") {
    if (method === "GET") { requireAdmin_(body); return getUsersForApi_(); }
    if (method === "POST") { requireAdmin_(body); return createUserForApi_(body); }
  }
  var userPasswordMatch = path.match(/^\/api\/auth\/users\/([^\/]+)\/password$/);
  if (userPasswordMatch && method === "PUT") { requireAdmin_(body); return updateUserPasswordForApi_(decodeURIComponent(userPasswordMatch[1]), body); }
  var userMatch = path.match(/^\/api\/auth\/users\/([^\/]+)$/);
  if (userMatch) {
    if (method === "PUT") { requireAdmin_(body); return updateUserForApi_(decodeURIComponent(userMatch[1]), body); }
    if (method === "DELETE") { requireAdmin_(body); return deleteUserForApi_(decodeURIComponent(userMatch[1])); }
  }
  // Session lifecycle calls (create/validate/logout) run for every logged-in user on every
  // request — NOT admin-gated. Only the admin *console* views (list/force-logout) are.
  if (path === "/api/admin/sessions" && method === "GET") { requireAdmin_(body); return getSessionsForApi_(); }
  if (path === "/api/admin/sessions" && method === "POST") return createSessionForApi_(body);
  if (path === "/api/admin/sessions/validate" && method === "POST") return validateSessionForApi_(body);
  if (path === "/api/admin/sessions/logout" && method === "POST") return logoutSessionForApi_(body);
  var adminSessionMatch = path.match(/^\/api\/admin\/sessions\/([^\/]+)$/);
  if (adminSessionMatch && method === "DELETE") { requireAdmin_(body); return revokeSessionsForApi_(decodeURIComponent(adminSessionMatch[1])); }
  // Page-hit telemetry is written by every user viewing any page — not admin-gated.
  if (path === "/api/admin/page-hit" && method === "POST") return recordPageHitForApi_(body);
  if (path === "/api/admin/status" && method === "GET") { requireAdmin_(body); return getAdminStatusForApi_(); }
  if (path.indexOf("/api/audit-log") === 0) {
    // Reading the full audit log is admin-only; every user's own actions still get
    // logged via the POST path below (called after nearly every mutating request).
    if (method === "GET") { requireAdmin_(body); return getAuditLogForApi_(path); }
    if (method === "POST") return appendAuditForApi_(body);
  }

  if (path === "/api/events" && method === "GET") return getEventsForApi_();
  if (path === "/api/events" && method === "POST") return upsertEventForApi_(body);

  var eventMatch = path.match(/^\/api\/events\/([^\/]+)(?:\/([^\/]+))?$/);
  if (eventMatch) {
    var eventId = decodeURIComponent(eventMatch[1]);
    var child = eventMatch[2] || "";
    if (!child && method === "GET") return findEventForApi_(eventId);
    if (!child && method === "DELETE") return deleteEventForApi_(eventId);
    if (child === "header" && method === "GET") {
      var ev = findEventForApi_(eventId);
      if (!ev) throw new Error("Not found");
      return { id: ev.id, name: ev.name, date: ev.date, location: ev.location, status: ev.status, locationZone: ev.locationZone || "", pax: ev.pax, days: ev.days, costPerPax: ev.costPerPax };
    }
    if (child === "log" && method === "GET") return getEventLogForApi_(eventId);
    if (child === "petty-cash") {
      if (method === "GET") return getJsonRowForApi_("PettyCashJson", eventId, { payouts: [], petty: [] });
      if (method === "PUT") return putJsonRowForApi_("PettyCashJson", eventId, body);
    }
    if (child === "pre-cost") {
      if (method === "GET") return getJsonRowForApi_("PreCostJson", eventId, {});
      if (method === "PUT") return putJsonRowForApi_("PreCostJson", eventId, body);
    }
    if (child === "payment-received") {
      if (method === "GET") return getJsonRowForApi_("PaymentReceivedJson", eventId, []);
      if (method === "POST") return appendPaymentReceivedForApi_(eventId, body);
      if (method === "PUT") return putJsonRowForApi_("PaymentReceivedJson", eventId, body);
    }
    if (child === "in-house-charges") {
      if (method === "GET") return getJsonRowForApi_("InHouseChargesJson", eventId, []);
      if (method === "POST") return appendInHouseChargeForApi_(eventId, body);
      if (method === "PUT") return putJsonRowForApi_("InHouseChargesJson", eventId, body);
    }
  }

  var paymentMailMatch = path.match(/^\/api\/events\/([^\/]+)\/payment-received\/([^\/]+)\/mail$/);
  if (paymentMailMatch && method === "POST") {
    return sendPaymentMailForApi_(decodeURIComponent(paymentMailMatch[1]), decodeURIComponent(paymentMailMatch[2]), body);
  }

  var pettyCashMailMatch = path.match(/^\/api\/events\/([^\/]+)\/petty-cash\/([^\/]+)\/mail$/);
  if (pettyCashMailMatch && method === "POST") {
    return sendPettyCashMailForApi_(decodeURIComponent(pettyCashMailMatch[1]), decodeURIComponent(pettyCashMailMatch[2]), body);
  }

  if (path === "/api/master-persons") {
    if (method === "GET") return getMasterPersonsForApi_();
    if (method === "PUT") return putMasterPersonsForApi_(body);
  }

  if (path === "/api/bills" && method === "GET") return getBillsForApi_();
  if (path === "/api/bills" && method === "POST") return createBillForApi_(body);
  var billMatch = path.match(/^\/api\/bills\/([^\/]+)$/);
  if (billMatch && method === "PUT") return reviewBillForApi_(decodeURIComponent(billMatch[1]), body.status, body._user);

  throw new Error("Unsupported API route: " + method + " " + path);
}

function doGet(e) {
  var storedKey = PropertiesService.getScriptProperties().getProperty("API_KEY");
  if (e && e.parameter && e.parameter.action === "authorize_mail") {
    if (!storedKey || e.parameter.apiKey !== storedKey) {
      return out(403, { error: "Unauthorized" });
    }
    return out(200, authorizeMailForSetup());
  }
  if (e && e.parameter && e.parameter.action === "cleanup_orphans") {
    if (!storedKey || e.parameter.apiKey !== storedKey) {
      return out(403, { error: "Unauthorized" });
    }
    return out(200, cleanupOrphanEventDataForSetup());
  }
  if (e && e.parameter && e.parameter.action === "status") {
    if (!storedKey || e.parameter.apiKey !== storedKey) {
      return out(403, { error: "Unauthorized" });
    }
    return out(200, { ok: true, sheets: Object.keys(HEADERS), ts: new Date().toISOString() });
  }

  return out(200, {
    ok: true,
    service: "ODC Apps Script backend API",
    frontend: "https://cateringbookends.vercel.app",
    message: "Frontend is served only from Vercel. This Apps Script deployment is backend-only."
  });
}

function setApiKeyForSetup(apiKey) {
  if (!apiKey || String(apiKey).length < 24) {
    throw new Error("API key must be at least 24 characters");
  }
  PropertiesService.getScriptProperties().setProperty("API_KEY", String(apiKey));
  return { ok: true };
}

function authorizeMailForSetup() {
  return { ok: true, remainingDailyQuota: MailApp.getRemainingDailyQuota() };
}

function uploadReceiptToDrive(body) {
  if (!body.base64 || !body.fileName) throw new Error("fileName and base64 are required");
  var folderId = PropertiesService.getScriptProperties().getProperty("RECEIPTS_FOLDER_ID");
  var folder = folderId ? DriveApp.getFolderById(folderId) : ensureReceiptFolder();
  var bytes = Utilities.base64Decode(body.base64);
  var safeName = String(body.fileName).replace(/[\\/:*?"<>|]/g, "_");
  var prefix = body.billId ? ("Bill-" + body.billId + "_") : "";
  var blob = Utilities.newBlob(bytes, body.mimeType || "application/octet-stream", prefix + safeName);
  var file = folder.createFile(blob);
  return {
    ok: true,
    fileId: file.getId(),
    url: file.getUrl(),
    name: file.getName()
  };
}

function ensureReceiptFolder() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty("RECEIPTS_FOLDER_ID");
  if (existing) return DriveApp.getFolderById(existing);
  var folder = DriveApp.createFolder("ODC Bill Receipts");
  props.setProperty("RECEIPTS_FOLDER_ID", folder.getId());
  return folder;
}

// ---- Sheet helpers ----

function syncSheet(name, rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    applyHeaderStyle(sheet, HEADERS[name]);
  }

  // Clear old data (keep row 1 = header)
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, HEADERS[name].length).clearContent();
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }

  // Auto-resize columns
  sheet.autoResizeColumns(1, HEADERS[name].length);
}

function appendAuditRow(row) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("AuditLog");
  if (!sheet) {
    sheet = ss.insertSheet("AuditLog");
    applyHeaderStyle(sheet, HEADERS["AuditLog"]);
  }
  sheet.appendRow(row);
}

function applyHeaderStyle(sheet, headers) {
  var range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight("bold");
  range.setFontSize(10);
  range.setBackground("#0f172a");
  range.setFontColor("#f8fafc");
  range.setHorizontalAlignment("center");
  sheet.setFrozenRows(1);

  // Alternating row colors via banding — only if sheet is fresh
  if (sheet.getLastRow() <= 1) {
    try {
      var banding = sheet.getRange("A2:Z1000").applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
      banding.setHeaderRowColor("#0f172a");
    } catch (e) { /* ignore if banding already applied */ }
  }
}

function setupAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Rename spreadsheet
  ss.rename("ODC Event Dashboard");

  for (var name in HEADERS) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    applyHeaderStyle(sheet, HEADERS[name]);
    sheet.setColumnWidths(1, HEADERS[name].length, 140);
  }

  // Remove default Sheet1 if exists and we have others
  var allSheets = ss.getSheets();
  var defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && allSheets.length > 1) {
    ss.deleteSheet(defaultSheet);
  }
}

function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers) applyHeaderStyle(sheet, headers);
  }
  return sheet;
}

function values_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
}

function eventFromRow_(r) {
  var pax = Number(r[7]) || 0;
  var days = Number(r[8]) || 1;
  var cost = Number(r[9]) || 0;
  var total = Number(r[10]) || (pax * days * cost * 1.05);
  return {
    id: String(r[0] || ""),
    externalId: String(r[1] || ""),
    entryDate: isoDateForApi_(r[2]),
    date: isoDateForApi_(r[3]),
    name: String(r[4] || ""),
    location: String(r[5] || ""),
    locationZone: String(r[6] || ""),
    pax: pax,
    days: days,
    costPerPax: cost,
    totalBilling: total,
    status: String(r[11] || "open"),
    time: String(r[12] || ""),
    foodType: String(r[13] || ""),
    allergicCount: Number(r[14]) || 0,
    allergicNotes: String(r[15] || ""),
    paymentSchedule: getPaymentScheduleForApi_(String(r[0] || "")),
    invoiceKyc: getInvoiceKycForApi_(String(r[0] || ""))
  };
}

function isoDateForApi_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "dd-MM-yyyy");
  }
  var text = String(value);
  var isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[3] + "-" + isoMatch[2] + "-" + isoMatch[1];
  var dmyMatch = text.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (dmyMatch) return dmyMatch[0];
  return text;
}

var KYC_PATTERNS_ = {
  mobile: /^\d{10}$/,
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  aadhar: /^\d{12}$/,
  gst: /^\d{2}[A-Z0-9]{13}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
};

function sheetSafe_(value) {
  var s = String(value === null || value === undefined ? "" : value);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function validateEventForApi_(e) {
  var errors = [];
  if (!String(e.name || e.eventName || "").trim()) errors.push("Event name is required.");
  if (!String(e.date || e.eventDate || "").trim()) errors.push("Event date is required.");
  if (!String(e.location || "").trim()) errors.push("Location is required.");
  if (!(Number(e.pax) > 0)) errors.push("PAX must be greater than 0.");
  if (!(Number(e.costPerPax) > 0)) errors.push("Cost per PAX must be greater than 0.");
  var status = String(e.status || "open").trim();
  if (status && ["open", "planning", "completed", "cancelled"].indexOf(status) === -1) errors.push("Invalid status.");
  var foodType = String(e.foodType || "").trim();
  if (foodType && ["jain", "non-jain"].indexOf(foodType) === -1) errors.push("Food type must be Jain or Non-Jain.");
  if (String(e.locationZone || "").length > 80) errors.push("City must be 80 characters or fewer.");
  if (e.allergicCount !== undefined && e.allergicCount !== null && e.allergicCount !== "" && !(Number(e.allergicCount) >= 0)) {
    errors.push("Allergic count must be 0 or more.");
  }
  var k = e.invoiceKyc || {};
  ["mobile", "pan", "aadhar", "gst"].forEach(function (field) {
    var v = String(k[field] || "").trim();
    if (v && !KYC_PATTERNS_[field].test(v.toUpperCase())) {
      var label = field === "pan" ? "PAN" : field === "gst" ? "GST" : field.charAt(0).toUpperCase() + field.slice(1);
      errors.push(label + " format is invalid.");
    }
  });
  var email = String(k.email || "").trim();
  if (email && !KYC_PATTERNS_.email.test(email)) errors.push("Email format is invalid.");
  if (errors.length) throw new Error(errors.join(" "));
}

function eventToRow_(e) {
  var pax = Number(e.pax) || 0;
  var days = Number(e.days) || 1;
  var cost = Number(e.costPerPax) || 0;
  var total = Number(e.totalBilling) || (pax * days * cost * 1.05);
  return [
    String(e.id || e.clientId || ("EVT-" + Date.now())),
    e.externalId || "",
    e.entryDate || "",
    e.date || e.eventDate || "",
    sheetSafe_(e.name || e.eventName || ""),
    sheetSafe_(e.location || ""),
    sheetSafe_(e.locationZone || ""),
    pax,
    days,
    cost,
    total,
    e.status || "open",
    e.time || "",
    e.foodType || "",
    Number(e.allergicCount) || 0,
    sheetSafe_(e.allergicNotes || "")
  ];
}

function getEventsForApi_() {
  var sheet = sheet_("Events", HEADERS.Events);
  return values_(sheet).map(eventFromRow_).filter(function (e) { return e.id; });
}

function findEventForApi_(id) {
  var events = getEventsForApi_();
  for (var i = 0; i < events.length; i++) {
    if (String(events[i].id) === String(id) || String(events[i].externalId) === String(id)) return events[i];
  }
  return null;
}

function upsertEventForApi_(event) {
  validateEventForApi_(event || {});
  var sheet = sheet_("Events", HEADERS.Events);
  var row = eventToRow_(event);
  var rows = values_(sheet);
  var index = -1;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(row[0])) { index = i + 2; break; }
  }
  if (index > -1) sheet.getRange(index, 1, 1, row.length).setValues([row]);
  else sheet.appendRow(row);
  syncPaymentScheduleForApi_(row[0], event.paymentSchedule || []);
  syncInvoiceKycForApi_(row[0], event.invoiceKyc || {});
  markLiveChange_("events");
  return eventFromRow_(row);
}

function deleteEventForApi_(id) {
  var sheet = sheet_("Events", HEADERS.Events);
  var rows = values_(sheet);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]) === String(id)) sheet.deleteRow(i + 2);
  }
  deleteRowsByFirstColumn_("PaymentSchedule", String(id));
  deleteRowsByFirstColumn_("InvoiceKYC", String(id));
  deleteRowsByFirstColumn_("PettyCashJson", String(id));
  deleteRowsByFirstColumn_("PreCostJson", String(id));
  deleteRowsByFirstColumn_("PaymentReceivedJson", String(id));
  deleteRowsByFirstColumn_("InHouseChargesJson", String(id));
  markLiveChange_("events");
  return { ok: true };
}

function deleteRowsByFirstColumn_(sheetName, id) {
  var sheet = sheet_(sheetName, null);
  var rows = values_(sheet);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]) === String(id)) sheet.deleteRow(i + 2);
  }
}

function cleanupOrphanEventDataForSetup() {
  var eventIds = {};
  values_(sheet_("Events", HEADERS.Events)).forEach(function (r) {
    if (r[0]) eventIds[String(r[0])] = true;
  });
  var cleaned = {};
  [
    "PaymentSchedule",
    "InvoiceKYC",
    "PettyCashJson",
    "PreCostJson",
    "PaymentReceivedJson",
    "InHouseChargesJson"
  ].forEach(function (sheetName) {
    var sheet = sheet_(sheetName, null);
    var rows = values_(sheet);
    var count = 0;
    for (var i = rows.length - 1; i >= 0; i--) {
      var id = String(rows[i][0] || "");
      if (id && !eventIds[id]) {
        sheet.deleteRow(i + 2);
        count += 1;
      }
    }
    cleaned[sheetName] = count;
  });
  return { ok: true, cleaned: cleaned };
}

function getPaymentScheduleForApi_(eventId) {
  var rows = values_(sheet_("PaymentSchedule", HEADERS.PaymentSchedule));
  return rows.filter(function (r) { return String(r[0]) === String(eventId); }).map(function (r) {
    return { label: r[1] || "", dueDate: r[2] || "", amount: Number(r[3]) || 0, billing: r[4] || "", method: r[5] || "", isAdvance: String(r[6] || "").toLowerCase() === "yes" };
  });
}

function syncPaymentScheduleForApi_(eventId, cycles) {
  var sheet = sheet_("PaymentSchedule", HEADERS.PaymentSchedule);
  var rows = values_(sheet);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]) === String(eventId)) sheet.deleteRow(i + 2);
  }
  (cycles || []).forEach(function (c) {
    sheet.appendRow([eventId, c.label || "", c.dueDate || "", Number(c.amount) || 0, c.billing || "", c.method || "", c.isAdvance ? "Yes" : "No"]);
  });
}

function getInvoiceKycForApi_(eventId) {
  var rows = values_(sheet_("InvoiceKYC", HEADERS.InvoiceKYC));
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(eventId)) {
      return { name: rows[i][1] || "", mobile: rows[i][2] || "", email: rows[i][3] || "", gst: rows[i][4] || "", pan: rows[i][5] || "", aadhar: rows[i][6] || "" };
    }
  }
  return {};
}

function syncInvoiceKycForApi_(eventId, k) {
  var sheet = sheet_("InvoiceKYC", HEADERS.InvoiceKYC);
  var rows = values_(sheet);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]) === String(eventId)) sheet.deleteRow(i + 2);
  }
  if (Object.keys(k || {}).some(function (key) { return String(k[key] || "").trim(); })) {
    sheet.appendRow([
      eventId,
      sheetSafe_(k.name || ""),
      k.mobile || "",
      sheetSafe_(k.email || ""),
      String(k.gst || "").trim().toUpperCase(),
      String(k.pan || "").trim().toUpperCase(),
      k.aadhar || ""
    ]);
  }
}

var PASSWORD_HASH_ITERATIONS = 10000;

function bytesToHex_(bytes) {
  return bytes.map(function (b) {
    var v = b < 0 ? b + 256 : b;
    return ("0" + v.toString(16)).slice(-2);
  }).join("");
}

function legacyPasswordHash_(password) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password || ""), Utilities.Charset.UTF_8));
}

// Salted, iterated HMAC-SHA256 (Apps Script V8 has no native scrypt/bcrypt/PBKDF2).
// Stored as "pbkdf2:<salt>:<hash>" so legacy unsalted-SHA256 rows (no prefix) are
// still recognized and transparently upgraded on next successful login.
function iteratedHmac_(password, salt) {
  var value = String(password || "") + ":" + String(salt || "");
  for (var i = 0; i < PASSWORD_HASH_ITERATIONS; i++) {
    value = bytesToHex_(Utilities.computeHmacSha256Signature(value, salt));
  }
  return value;
}

function passwordHashForApi_(password, existingSalt) {
  var salt = existingSalt || (Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, ""));
  return "pbkdf2:" + salt + ":" + iteratedHmac_(password, salt);
}

function verifyPasswordForApi_(password, storedHash) {
  var value = String(storedHash || "");
  if (value.indexOf("pbkdf2:") === 0) {
    var parts = value.split(":");
    return iteratedHmac_(password, parts[1]) === parts[2];
  }
  return legacyPasswordHash_(password) === value;
}

function ensureUsersForApi_() {
  var sheet = sheet_("Users", HEADERS.Users);
  var rows = values_(sheet);
  var seen = {};
  for (var i = rows.length - 1; i >= 0; i--) {
    var username = String(rows[i][0] || "").trim().toLowerCase();
    if (!username) continue;
    if (seen[username]) sheet.deleteRow(i + 2);
    else seen[username] = true;
  }
  rows = values_(sheet);
  // First-run bootstrap ONLY — this never re-fires once any user row exists, so a
  // bootstrap admin created here can be safely renamed/deleted afterward without it
  // silently reappearing (previously this recreated a hardcoded "aiops"/"AIops"
  // account on every login lookup, forever, with an undeletable guard elsewhere).
  if (rows.length === 0) {
    var now = new Date().toISOString();
    var tempPassword = Utilities.getUuid().replace(/-/g, "").slice(0, 12);
    sheet.appendRow(["aiops", "aiops", "admin", passwordHashForApi_(tempPassword), now, now, "Yes"]);
    Logger.log("Bootstrap admin created - username: aiops, one-time password: " + tempPassword +
      ". Log in, create your own named admin account, then delete/rename this one.");
  }
}

function userFromRow_(r) {
  return {
    username: String(r[0] || "").trim().toLowerCase(),
    fullName: String(r[1] || "").trim(),
    role: String(r[2] || "user").trim() === "admin" ? "admin" : "user",
    passwordHash: String(r[3] || ""),
    createdAt: isoTimestampForApi_(r[4]),
    updatedAt: isoTimestampForApi_(r[5]),
    active: String(r[6] || "Yes").toLowerCase() !== "no"
  };
}

function getUsersForApi_() {
  ensureUsersForApi_();
  var seen = {};
  return values_(sheet_("Users", HEADERS.Users)).map(userFromRow_).filter(function (u) {
    if (!u.username || seen[u.username]) return false;
    seen[u.username] = true;
    return true;
  }).map(function (u) {
    return { username: u.username, fullName: u.fullName, role: u.role, createdAt: u.createdAt, updatedAt: u.updatedAt, active: u.active };
  });
}

function findUserForApi_(username) {
  ensureUsersForApi_();
  var target = String(username || "").trim().toLowerCase();
  var rows = values_(sheet_("Users", HEADERS.Users));
  for (var i = 0; i < rows.length; i++) {
    var user = userFromRow_(rows[i]);
    if (user.username === target) return user;
  }
  return null;
}

function createUserForApi_(body) {
  ensureUsersForApi_();
  var username = String(body.username || "").trim().toLowerCase();
  var password = String(body.password || "");
  if (!username || password.length < 4) throw new Error("Username and password (min 4 chars) required.");
  if (findUserForApi_(username)) throw new Error("Username already exists.");
  var now = new Date().toISOString();
  sheet_("Users", HEADERS.Users).appendRow([
    username,
    String(body.fullName || "").trim(),
    body.role === "admin" ? "admin" : "user",
    passwordHashForApi_(password),
    now,
    now,
    "Yes"
  ]);
  markLiveChange_("users");
  return { ok: true };
}

function updateUserForApi_(username, body) {
  ensureUsersForApi_();
  var sheet = sheet_("Users", HEADERS.Users);
  var rows = values_(sheet);
  var target = String(username || "").trim().toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || "").toLowerCase() === target) {
      sheet.getRange(i + 2, 2, 1, 6).setValues([[
        String(body.fullName || rows[i][1] || "").trim(),
        body.role === "admin" ? "admin" : "user",
        rows[i][3] || "",
        rows[i][4] || new Date().toISOString(),
        new Date().toISOString(),
        body.active === false ? "No" : "Yes"
      ]]);
      markLiveChange_("users");
      return { ok: true };
    }
  }
  throw new Error("User not found.");
}

function upgradeUserPasswordHashForApi_(username, newHash) {
  var sheet = sheet_("Users", HEADERS.Users);
  var rows = values_(sheet);
  var target = String(username || "").trim().toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || "").toLowerCase() === target) {
      sheet.getRange(i + 2, 4, 1, 1).setValues([[newHash]]);
      return;
    }
  }
}

function updateUserPasswordForApi_(username, body) {
  ensureUsersForApi_();
  var password = String(body.password || "");
  if (password.length < 4) throw new Error("Password must be at least 4 characters.");
  var sheet = sheet_("Users", HEADERS.Users);
  var rows = values_(sheet);
  var target = String(username || "").trim().toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || "").toLowerCase() === target) {
      sheet.getRange(i + 2, 4, 1, 3).setValues([[passwordHashForApi_(password), rows[i][4] || new Date().toISOString(), new Date().toISOString()]]);
      markLiveChange_("users");
      return { ok: true };
    }
  }
  throw new Error("User not found.");
}

function deleteUserForApi_(username) {
  ensureUsersForApi_();
  var target = String(username || "").trim().toLowerCase();
  var sheet = sheet_("Users", HEADERS.Users);
  var rows = values_(sheet);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0] || "").toLowerCase() === target) sheet.deleteRow(i + 2);
  }
  markLiveChange_("users");
  return { ok: true };
}

function getAdminStatusForApi_() {
  return {
    ok: true,
    users: getUsersForApi_().length,
    events: getEventsForApi_().length,
    masterHeads: getMasterPersonsForApi_().length,
    bills: getBillsForApi_().length,
    auditEntries: values_(sheet_("AuditLog", HEADERS.AuditLog)).length,
    mailRemainingDailyQuota: MailApp.getRemainingDailyQuota(),
    scriptTimeZone: Session.getScriptTimeZone(),
    spreadsheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
    updatedAt: new Date().toISOString()
  };
}

function getLiveVersionForApi_() {
  var props = PropertiesService.getScriptProperties();
  var version = props.getProperty("LIVE_VERSION") || props.getProperty("LAST_CHANGE_TS") || new Date().toISOString();
  return { ok: true, version: version, checkedAt: new Date().toISOString() };
}

function markLiveChange_(entity) {
  var now = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperties({
    LIVE_VERSION: now + ":" + String(entity || "data"),
    LAST_CHANGE_TS: now
  }, false);
}

function sessionFromRow_(r) {
  return {
    sessionId: String(r[0] || ""),
    username: String(r[1] || ""),
    role: String(r[2] || ""),
    ipAddress: String(r[3] || ""),
    userAgent: String(r[4] || ""),
    loginAt: isoTimestampForApi_(r[5]),
    lastSeenAt: isoTimestampForApi_(r[6]),
    expiresAt: isoTimestampForApi_(r[7]),
    lastPage: String(r[8] || ""),
    active: String(r[9] || "Yes").toLowerCase() !== "no"
  };
}

function sessionIsLive_(s) {
  if (!s.active) return false;
  if (!s.expiresAt) return true;
  return new Date(s.expiresAt).getTime() > Date.now();
}

function getSessionsForApi_() {
  var rows = values_(sheet_("Sessions", HEADERS.Sessions)).map(sessionFromRow_);
  return rows.filter(sessionIsLive_).sort(function (a, b) {
    return String(b.lastSeenAt || b.loginAt || "").localeCompare(String(a.lastSeenAt || a.loginAt || ""));
  });
}

function createSessionForApi_(body) {
  var sessionId = String(body.sessionId || "");
  if (!sessionId) throw new Error("Session ID required.");
  var username = (body._user && body._user.username) || body.username || "";
  var role = (body._user && body._user.role) || body.role || "";
  var now = new Date().toISOString();
  sheet_("Sessions", HEADERS.Sessions).appendRow([
    sessionId,
    username,
    role,
    body.ipAddress || "",
    body.userAgent || "",
    body.loginAt || now,
    now,
    body.expiresAt || "",
    "",
    "Yes"
  ]);
  return { ok: true };
}

function findSessionRow_(sessionId) {
  var sheet = sheet_("Sessions", HEADERS.Sessions);
  var rows = values_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || "") === String(sessionId || "")) {
      return { sheet: sheet, rowNumber: i + 2, row: rows[i], session: sessionFromRow_(rows[i]) };
    }
  }
  return null;
}

function validateSessionForApi_(body) {
  var found = findSessionRow_(body.sessionId);
  if (!found) return { active: true };
  var active = sessionIsLive_(found.session);
  found.sheet.getRange(found.rowNumber, 4, 1, 4).setValues([[
    body.ipAddress || found.session.ipAddress,
    body.userAgent || found.session.userAgent,
    found.session.loginAt || new Date().toISOString(),
    new Date().toISOString()
  ]]);
  if (!active) found.sheet.getRange(found.rowNumber, 10).setValue("No");
  return { active: active };
}

function logoutSessionForApi_(body) {
  var found = findSessionRow_(body.sessionId);
  if (found) {
    found.sheet.getRange(found.rowNumber, 7, 1, 4).setValues([[new Date().toISOString(), found.session.expiresAt || "", found.session.lastPage || "", "No"]]);
  }
  return { ok: true };
}

function revokeSessionsForApi_(username) {
  var sheet = sheet_("Sessions", HEADERS.Sessions);
  var rows = values_(sheet);
  var target = String(username || "").toLowerCase();
  var count = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1] || "").toLowerCase() === target && String(rows[i][9] || "Yes").toLowerCase() !== "no") {
      sheet.getRange(i + 2, 10).setValue("No");
      count += 1;
    }
  }
  if (count) markLiveChange_("sessions");
  return { ok: true, revoked: count };
}

function recordPageHitForApi_(body) {
  var page = String(body.page || "").slice(0, 120);
  var title = String(body.title || "").slice(0, 120);
  var sessionId = String(body.sessionId || "");
  var user = body._user || {};
  var found = sessionId ? findSessionRow_(sessionId) : null;
  if (found) {
    found.sheet.getRange(found.rowNumber, 4, 1, 6).setValues([[
      body.ipAddress || found.session.ipAddress,
      body.userAgent || found.session.userAgent,
      found.session.loginAt || new Date().toISOString(),
      new Date().toISOString(),
      found.session.expiresAt || "",
      page
    ]]);
  }
  appendAuditForApi_({
    username: user.username || "",
    action: "PAGE_VIEW",
    entityType: "page",
    entityId: page,
    detail: title ? (page + " | " + title) : page,
    ipAddress: body.ipAddress || "",
    userAgent: body.userAgent || ""
  });
  return { ok: true };
}

function getJsonRowForApi_(name, id, fallback) {
  var sheet = sheet_(name, ["ID", "JSON"]);
  var rows = values_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      try { return JSON.parse(rows[i][1] || "{}"); } catch (e) { return fallback; }
    }
  }
  return fallback;
}

function putJsonRowForApi_(name, id, data) {
  var sheet = sheet_(name, ["ID", "JSON"]);
  var rows = values_(sheet);
  var payload = JSON.stringify(data || {});
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.getRange(i + 2, 1, 1, 2).setValues([[id, payload]]);
      markLiveChange_(name);
      return data;
    }
  }
  sheet.appendRow([id, payload]);
  markLiveChange_(name);
  return data;
}

function getMasterPersonsForApi_() {
  var rows = values_(sheet_("MasterPersons", HEADERS.MasterPersons));
  var map = {};
  rows.forEach(function (r) {
    var id = String(r[0] || "");
    if (!id) return;
    if (!map[id]) map[id] = { id: id, name: String(r[1] || id), persons: [] };
    if (String(r[2] || "").trim()) {
      map[id].persons.push({ name: r[2] || "", code: r[3] || "", designation: r[4] || "", department: r[5] || "", location: r[6] || "", email: r[7] || "" });
    }
  });
  return Object.keys(map).map(function (id) { return map[id]; });
}

function putMasterPersonsForApi_(heads) {
  var sheet = sheet_("MasterPersons", HEADERS.MasterPersons);
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.MasterPersons.length).clearContent();
  (heads || []).forEach(function (h) {
    if (!h.persons || !h.persons.length) sheet.appendRow([h.id, h.name, "", "", "", "", "", ""]);
    else h.persons.forEach(function (p) { sheet.appendRow([h.id, h.name, p.name || "", p.code || "", p.designation || "", p.department || "", p.location || "", p.email || ""]); });
  });
  markLiveChange_("master-persons");
  return heads || [];
}

function getBillsForApi_() {
  var rows = values_(sheet_("BillSubmissions", HEADERS.BillSubmissions));
  return rows.map(function (r) {
    return { id: r[0], eventName: r[1], eventClientId: r[1], submittedByUserId: r[2], headName: r[3], headId: r[3], personName: r[4], amount: Number(r[5]) || 0, description: r[6] || "", category: r[7] || "misc", status: r[8] || "pending", submittedAt: r[9] || "", reviewedBy: r[10] || "", reviewedAt: r[11] || "", receiptFileName: r[12] || "", receiptDriveUrl: r[13] || "" };
  });
}

function createBillForApi_(bill) {
  var id = "BILL-" + Date.now();
  var ev = findEventForApi_(bill.eventId) || {};
  var receipt = bill.receipt ? uploadReceiptToDrive({ fileName: bill.receipt.fileName, mimeType: bill.receipt.mimeType, base64: bill.receipt.base64, billId: id }) : null;
  var username = (bill._user && bill._user.username) || "unknown";
  sheet_("BillSubmissions", HEADERS.BillSubmissions).appendRow([
    id, ev.name || bill.eventId || "", username, bill.headId || "", bill.personName || "",
    Number(bill.amount) || 0, bill.description || "", bill.category || "misc", "pending",
    new Date().toISOString(), "", "", receipt ? receipt.name : (bill.receipt && bill.receipt.fileName) || "", receipt ? receipt.url : ""
  ]);
  markLiveChange_("bills");
  return { ok: true, id: id, receipt: receipt };
}

function reviewBillForApi_(id, status) {
  var sheet = sheet_("BillSubmissions", HEADERS.BillSubmissions);
  var rows = values_(sheet);
  var username = (arguments[2] && arguments[2].username) || "unknown";
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.getRange(i + 2, 9, 1, 4).setValues([[status || "pending", rows[i][9] || "", username, new Date().toISOString()]]);
      markLiveChange_("bills");
      return { ok: true };
    }
  }
  return { ok: false };
}

function appendPaymentReceivedForApi_(eventId, body) {
  var rows = getJsonRowForApi_("PaymentReceivedJson", eventId, []);
  if (!Array.isArray(rows)) rows = [];
  var amount = Number(body.amount) || 0;
  if (!(amount > 0)) throw new Error("Amount must be greater than 0.");
  var receiver = String(body.receivedBy || "").trim() || ((body._user && body._user.username) || "unknown");
  var entry = {
    id: "PAY-" + Date.now(),
    cycle_index: Number(body.cycleIndex) || 0,
    cycle_name: body.cycleName || "",
    amount: amount,
    mode: body.mode || "cash",
    receiver_type: body.receiverType || "sales",
    received_by: receiver,
    notes: body.notes || "",
    received_at: new Date().toISOString()
  };
  rows.push(entry);
  putJsonRowForApi_("PaymentReceivedJson", eventId, rows);
  markLiveChange_("payments");
  return entry;
}

function appendInHouseChargeForApi_(eventId, body) {
  var rows = getJsonRowForApi_("InHouseChargesJson", eventId, []);
  if (!Array.isArray(rows)) rows = [];
  var amount = Number(body.amount) || 0;
  if (!(amount > 0)) throw new Error("Amount must be greater than 0.");
  var entry = {
    id: "IH-" + Date.now(),
    head: body.head || body.category || "Other",
    category: body.category || body.head || "Other",
    person: body.person || "",
    description: body.description || "",
    amount: amount,
    created_by: (body._user && body._user.username) || "unknown",
    created_at: new Date().toISOString()
  };
  rows.push(entry);
  putJsonRowForApi_("InHouseChargesJson", eventId, rows);
  markLiveChange_("in-house");
  return entry;
}

function sendPaymentMailForApi_(eventId, paymentId, body) {
  var ev = findEventForApi_(eventId);
  if (!ev) throw new Error("Event not found.");
  var payments = getJsonRowForApi_("PaymentReceivedJson", eventId, []);
  if (!Array.isArray(payments)) payments = [];
  var payment = null;
  var index = -1;
  for (var i = 0; i < payments.length; i++) {
    if (String(payments[i].id) === String(paymentId)) {
      payment = payments[i];
      index = i;
      break;
    }
  }
  if (!payment) throw new Error("Payment not found.");
  var to = (body && body.email) || (ev.invoiceKyc && ev.invoiceKyc.email) || "";
  if (!to) throw new Error("Client email is not available for this event.");
  var subject = "Payment received - " + (ev.name || ev.externalId || eventId);
  var amount = Number(payment.amount) || 0;
  var bodyText = [
    "Dear " + ((ev.invoiceKyc && ev.invoiceKyc.name) || "Client") + ",",
    "",
    "We have received your payment of Rs. " + amount.toLocaleString("en-IN") + " for " + (ev.name || eventId) + ".",
    "Payment cycle: " + (payment.cycle_name || "Payment"),
    "Mode: " + (payment.mode || "cash"),
    "Received by: " + (payment.received_by || ""),
    "Event date: " + (ev.date || ""),
    "",
    "Regards,",
    "ODC"
  ].join("\n");
  MailApp.sendEmail(to, subject, bodyText);
  payments[index].mail_sent_at = new Date().toISOString();
  payments[index].mail_sent_to = to;
  payments[index].mail_sent_by = (body && body._user && body._user.username) || "unknown";
  putJsonRowForApi_("PaymentReceivedJson", eventId, payments);
  markLiveChange_("payments");
  return { ok: true, to: to };
}

function sendPettyCashMailForApi_(eventId, payoutId, body) {
  var ev = findEventForApi_(eventId);
  if (!ev) throw new Error("Event not found.");
  var petty = getJsonRowForApi_("PettyCashJson", eventId, { payouts: [], petty: [] });
  var payouts = Array.isArray(petty.payouts) ? petty.payouts : [];
  var payout = null;
  var index = -1;
  for (var i = 0; i < payouts.length; i++) {
    if (String(payouts[i].id) === String(payoutId)) {
      payout = payouts[i];
      index = i;
      break;
    }
  }
  if (!payout) throw new Error("Payout not found.");
  var to = (body && body.email) || payout.mail_sent_to || "";
  if (!to) throw new Error("No email address provided.");
  var amount = Number(payout.amount) || 0;
  var subject = "Petty Cash Acknowledgment - " + (ev.name || ev.externalId || eventId);
  var bodyText = [
    "Dear " + (payout.person || "") + ",",
    "",
    "This is to confirm Rs. " + amount.toLocaleString("en-IN") + " has been released to you as petty cash for " +
      (ev.name || eventId) + (payout.purpose ? " (" + payout.purpose + ")" : "") + ".",
    "Please treat this email as acknowledgment of the above amount received.",
    "",
    "Regards,",
    "ODC"
  ].join("\n");
  MailApp.sendEmail(to, subject, bodyText);
  payouts[index].mail_sent_at = new Date().toISOString();
  payouts[index].mail_sent_to = to;
  payouts[index].mail_sent_by = (body && body._user && body._user.username) || "unknown";
  petty.payouts = payouts;
  putJsonRowForApi_("PettyCashJson", eventId, petty);
  markLiveChange_("petty-cash");
  return { ok: true, to: to };
}

function getEventLogForApi_(eventId) {
  return getAuditLogForApi_("/api/audit-log?limit=500").filter(function (entry) {
    return String(entry.entity_id || "") === String(eventId) || String(entry.detail || "").indexOf("/api/events/" + eventId) >= 0;
  }).map(function (entry) {
    return {
      id: entry.id,
      event_client_id: eventId,
      event_name: "",
      username: entry.username,
      action: String(entry.action || "").toLowerCase(),
      section: entry.entity_type || "event",
      field: entry.entity_id || "",
      old_value: "",
      new_value: entry.detail || "",
      ip_address: entry.ip_address || "",
      user_agent: entry.user_agent || "",
      ts: entry.ts
    };
  });
}

function appendAuditForApi_(entry) {
  var row = [
    "AUD-" + Date.now(),
    entry.username || "",
    entry.action || "",
    entry.entityType || entry.entity_type || "",
    entry.entityId || entry.entity_id || "",
    entry.detail || "",
    entry.ipAddress || entry.ip_address || "",
    entry.userAgent || "",
    new Date().toISOString()
  ];
  appendAuditRow(row);
  if (String(entry.action || "") !== "PAGE_VIEW") markLiveChange_("audit");
  return { ok: true };
}

function getAuditLogForApi_(path) {
  var query = {};
  var question = String(path || "").indexOf("?");
  if (question >= 0) {
    String(path).slice(question + 1).split("&").forEach(function (part) {
      var pieces = part.split("=");
      if (pieces[0]) query[decodeURIComponent(pieces[0])] = decodeURIComponent(pieces.slice(1).join("=") || "");
    });
  }
  var limit = Math.min(Math.max(Number(query.limit) || 200, 1), 500);
  var user = String(query.user || "").toLowerCase();
  var from = String(query.from || "");
  var to = String(query.to || "");
  var rows = values_(sheet_("AuditLog", HEADERS.AuditLog)).map(function (r) {
    return {
      id: r[0] || "",
      username: r[1] || "",
      action: r[2] || "",
      entity_type: r[3] || "",
      entity_id: r[4] || "",
      detail: r[5] || "",
      ip_address: r[6] || "",
      user_agent: r[7] || "",
      ts: isoTimestampForApi_(r[8])
    };
  }).filter(function (entry) {
    if (user && String(entry.username || "").toLowerCase().indexOf(user) === -1) return false;
    var day = String(entry.ts || "").slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
  rows.sort(function (a, b) { return String(b.ts || "").localeCompare(String(a.ts || "")); });
  return rows.slice(0, limit);
}

function isoTimestampForApi_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") return value.toISOString();
  return String(value);
}

// ---- Daily per-manager bill digest ----

function resolveManagerEmail_(headId) {
  var heads = getMasterPersonsForApi_();
  var head = null;
  for (var i = 0; i < heads.length; i++) {
    if (String(heads[i].id) === String(headId)) { head = heads[i]; break; }
  }
  if (!head) return "";
  var persons = head.persons || [];
  var manager = null;
  for (var j = 0; j < persons.length; j++) {
    if (/\bhead\b/i.test(String(persons[j].designation || persons[j].name || ""))) { manager = persons[j]; break; }
  }
  if (!manager) manager = persons[0];
  return (manager && manager.email) ? String(manager.email).trim() : "";
}

function getDigestWatermark_(headId) {
  return PropertiesService.getScriptProperties().getProperty("DIGEST_LAST_TS_" + headId) || "";
}

function setDigestWatermark_(headId, iso) {
  PropertiesService.getScriptProperties().setProperty("DIGEST_LAST_TS_" + headId, iso);
}

function personBalances_(petty, approvedBills) {
  return (petty.payouts || []).map(function (p) {
    var spent = approvedBills.filter(function (b) {
      return String(b.personName || "").toLowerCase() === String(p.person || "").toLowerCase();
    }).reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
    var payout = Number(p.amount) || 0;
    return { person: p.person || "", payout: payout, spent: spent, balance: payout - spent };
  });
}

function computeEventReconciliation_(eventId, allBills) {
  var ev = findEventForApi_(eventId) || { id: eventId, name: eventId, totalBilling: 0 };
  var petty = getJsonRowForApi_("PettyCashJson", eventId, { payouts: [], petty: [] });
  var preCost = getJsonRowForApi_("PreCostJson", eventId, {});
  var inHouse = getJsonRowForApi_("InHouseChargesJson", eventId, []);
  var eventBills = allBills.filter(function (b) {
    return String(b.eventClientId) === String(eventId) || b.eventName === ev.name;
  });
  var approvedBills = eventBills.filter(function (b) { return b.status === "approved"; });
  var approvedBillTotal = approvedBills.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
  var directPettyTotal = (petty.petty || []).reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
  var inHouseTotal = (inHouse || []).reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
  var billing = Number(ev.totalBilling) || 0;
  var preCostTotal = Number(preCost.totalCost) || 0;
  var actualCost = approvedBillTotal + directPettyTotal + inHouseTotal;
  return {
    event: ev,
    billing: billing,
    preCostTotal: preCostTotal,
    actualCost: actualCost,
    plannedPL: billing - preCostTotal,
    actualPL: billing - actualCost,
    overspend: actualCost > preCostTotal,
    persons: personBalances_(petty, approvedBills)
  };
}

// Pure rule-based narrative — no AI API, just thresholds over numbers
// computeEventReconciliation_ already produced. Kept intentionally simple
// (a few sentences, not a report) so it stays cheap to run per digest.
function buildNarrativeSentences_(r, eventBills, headName) {
  var sentences = [];
  var eventLabel = r.event.name || r.event.id;

  if (r.overspend && r.preCostTotal > 0) {
    var byCategory = {};
    eventBills.forEach(function (b) {
      var cat = b.category || "misc";
      byCategory[cat] = (byCategory[cat] || 0) + (Number(b.amount) || 0);
    });
    var topCategory = "";
    var topAmount = 0;
    Object.keys(byCategory).forEach(function (cat) {
      if (byCategory[cat] > topAmount) { topAmount = byCategory[cat]; topCategory = cat; }
    });
    var countInTop = eventBills.filter(function (b) { return (b.category || "misc") === topCategory; }).length;
    var overPct = Math.round(((r.actualCost - r.preCostTotal) / r.preCostTotal) * 100);
    sentences.push(
      headName + " is " + overPct + "% over budget on " + eventLabel +
      (topCategory ? ", driven by " + countInTop + " " + topCategory + " bill" + (countInTop === 1 ? "" : "s") +
        " totaling Rs. " + topAmount.toLocaleString("en-IN") : "") + "."
    );
  } else if (r.preCostTotal > 0) {
    var underPct = Math.round(((r.preCostTotal - r.actualCost) / r.preCostTotal) * 100);
    if (underPct > 0) sentences.push(headName + " is tracking within budget on " + eventLabel + " (" + underPct + "% under Pre-Cost).");
  }

  r.persons.forEach(function (p) {
    if (p.payout <= 0) return;
    if (p.balance < 0) {
      sentences.push(p.person + " has spent Rs. " + Math.abs(p.balance).toLocaleString("en-IN") +
        " more than the petty cash assigned for " + eventLabel + ".");
    } else {
      var utilization = Math.round((p.spent / p.payout) * 100);
      if (utilization > 90) sentences.push(p.person + "'s petty cash utilization on " + eventLabel + " is " + utilization + "%.");
    }
  });

  return sentences;
}

function buildDigestPdf_(headName, bills, reconciliation) {
  var doc = DocumentApp.create("ODC Digest - " + headName + " - " + new Date().toISOString());
  var body = doc.getBody();
  body.appendParagraph("Daily Bill Digest - " + headName).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph("Generated " + new Date().toLocaleString());

  body.appendParagraph("New Bills").setHeading(DocumentApp.ParagraphHeading.HEADING2);
  var billTable = [["Event", "Category", "Amount", "Status", "Description"]];
  bills.forEach(function (b) {
    billTable.push([
      b.eventName || "", b.category || "",
      "Rs. " + (Number(b.amount) || 0).toLocaleString("en-IN"),
      b.status || "", b.description || ""
    ]);
  });
  body.appendTable(billTable);

  bills.forEach(function (b) {
    if (!b.receiptDriveUrl) return;
    var match = String(b.receiptDriveUrl).match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) return;
    try {
      var blob = DriveApp.getFileById(match[1]).getBlob();
      body.appendParagraph((b.eventName || "") + " - receipt").setBold(true);
      body.appendImage(blob).setWidth(360);
    } catch (e) { /* not an image or inaccessible — skip embedding, table row above still lists it */ }
  });

  body.appendParagraph("Spend vs Budget").setHeading(DocumentApp.ParagraphHeading.HEADING2);
  reconciliation.forEach(function (r) {
    var title = body.appendParagraph(r.event.name || r.event.id);
    title.setBold(true);
    body.appendParagraph(
      "Billing: Rs. " + r.billing.toLocaleString("en-IN") +
      " | Budget (Pre-Cost): Rs. " + r.preCostTotal.toLocaleString("en-IN") +
      " | Actual Cost: Rs. " + r.actualCost.toLocaleString("en-IN") +
      " | Actual P&L: Rs. " + r.actualPL.toLocaleString("en-IN") +
      (r.overspend ? "  [OVER BUDGET]" : "")
    );
    if (r.persons.length) {
      var personTable = [["Person", "Payout", "Spent (Approved Bills)", "Balance"]];
      r.persons.forEach(function (p) {
        personTable.push([
          p.person,
          "Rs. " + p.payout.toLocaleString("en-IN"),
          "Rs. " + p.spent.toLocaleString("en-IN"),
          "Rs. " + p.balance.toLocaleString("en-IN")
        ]);
      });
      body.appendTable(personTable);
    }

    var eventBills = bills.filter(function (b) {
      return String(b.eventClientId) === String(r.event.id) || b.eventName === r.event.name;
    });
    buildNarrativeSentences_(r, eventBills, headName).forEach(function (sentence) {
      body.appendParagraph(sentence).setItalic(true);
    });
  });

  doc.saveAndClose();
  var pdf = DriveApp.getFileById(doc.getId()).getAs("application/pdf").setName(headName + " - Daily Digest.pdf");
  DriveApp.getFileById(doc.getId()).setTrashed(true);
  return pdf;
}

function runDailyManagerDigest_() {
  var allBills = getBillsForApi_();
  var heads = getMasterPersonsForApi_();
  var headIds = [];
  allBills.forEach(function (b) {
    if (b.headId && headIds.indexOf(b.headId) === -1) headIds.push(b.headId);
  });

  var headsProcessed = 0;
  var emailsSent = 0;
  var skippedNoEmail = [];

  headIds.forEach(function (headId) {
    var to = resolveManagerEmail_(headId);
    if (!to) { skippedNoEmail.push(headId); return; }

    var watermark = getDigestWatermark_(headId);
    var newBills = allBills.filter(function (b) {
      return String(b.headId) === String(headId) && b.submittedAt && b.submittedAt > watermark;
    });
    if (!newBills.length) return;

    var eventIds = [];
    newBills.forEach(function (b) {
      if (eventIds.indexOf(b.eventClientId) === -1) eventIds.push(b.eventClientId);
    });
    var reconciliation = eventIds.map(function (eid) { return computeEventReconciliation_(eid, allBills); });

    var maxTs = watermark;
    newBills.forEach(function (b) { if (b.submittedAt > maxTs) maxTs = b.submittedAt; });

    var headName = (heads.filter(function (h) { return String(h.id) === String(headId); })[0] || {}).name || headId;
    var pdfBlob = buildDigestPdf_(headName, newBills, reconciliation);
    var subject = "Daily Bill Digest - " + headName + " - " + new Date().toISOString().slice(0, 10);
    var htmlBody = "Attached is the daily bill summary for " + headName + " (" + newBills.length +
      " new bill" + (newBills.length === 1 ? "" : "s") + ").";
    MailApp.sendEmail(to, subject, "", { htmlBody: htmlBody, attachments: [pdfBlob] });
    setDigestWatermark_(headId, maxTs);
    headsProcessed += 1;
    emailsSent += 1;
  });

  return { ok: true, headsProcessed: headsProcessed, emailsSent: emailsSent, skippedNoEmail: skippedNoEmail };
}

function ensureDailyDigestTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "runDailyManagerDigest_") return { ok: true, alreadyExists: true };
  }
  ScriptApp.newTrigger("runDailyManagerDigest_").timeBased().atHour(8).everyDays(1).create();
  return { ok: true, created: true };
}

function out(code, data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

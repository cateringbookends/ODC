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
    "Designation", "Department", "Location"
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
    "Submitted At", "Reviewed By", "Reviewed At"
  ],
  AuditLog: [
    "ID", "Username", "Action", "Entity Type", "Entity ID",
    "Detail", "IP Address", "User Agent", "Timestamp"
  ]
};

// ---- Main entry points ----

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    // Auth
    var storedKey = PropertiesService.getScriptProperties().getProperty("API_KEY");
    if (!storedKey || body.apiKey !== storedKey) {
      return out(403, { error: "Unauthorized" });
    }

    var action = body.action;

    if (action === "setup") {
      setupAllSheets();
      return out(200, { ok: true, message: "All sheets ready" });
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

    return out(400, { error: "Unknown action: " + action });
  } catch (err) {
    return out(500, { error: err.toString() });
  }
}

function doGet(e) {
  var storedKey = PropertiesService.getScriptProperties().getProperty("API_KEY");
  if (!storedKey || e.parameter.apiKey !== storedKey) {
    return out(403, { error: "Unauthorized" });
  }
  if (e.parameter.action === "status") {
    return out(200, { ok: true, sheets: Object.keys(HEADERS), ts: new Date().toISOString() });
  }
  return out(400, { error: "Provide action=status" });
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

function out(code, data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

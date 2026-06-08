const trigger = document.querySelector("#eventPickerTrigger");
const menu = document.querySelector("#eventPickerMenu");
const search = document.querySelector("#eventSearch");
const list = document.querySelector("#eventPickerList");
const selectedEventId = document.querySelector("#selectedEventId");
const planningPax = document.querySelector("#planningPax");
const planningCostPerPax = document.querySelector("#planningCostPerPax");
const planningDays = document.querySelector("#planningDays");
const staffTransportationCharge = document.querySelector("#staffTransportationCharge");
const staffAccommodationCharge = document.querySelector("#staffAccommodationCharge");
const staffFoodCost = document.querySelector("#staffFoodCost");
const refervanCharge = document.querySelector("#refervanCharge");
const equipmentTransportationCharge = document.querySelector("#equipmentTransportationCharge");
const foodCostPerPax = document.querySelector("#foodCostPerPax");
const totalFoodCost = document.querySelector("#totalFoodCost");
const staffCount = document.querySelector("#staffCount");
const staffDataFile = document.querySelector("#staffDataFile");
const staffDataFileButton = document.querySelector("#staffDataFileButton");
const staffFileStatus = document.querySelector("#staffFileStatus");
const totalStaffCostInput = document.querySelector("#totalStaffCostInput");
const equipmentDepreciation = document.querySelector("#equipmentDepreciation");
const thirdPartyVendor = document.querySelector("#thirdPartyVendor");
const decorCharge = document.querySelector("#decorCharge");
const miscellaneousCost = document.querySelector("#miscellaneousCost");
const totalPlanningCost = document.querySelector("#totalPlanningCost");
const profitLoss = document.querySelector("#profitLoss");
const planningForm = document.querySelector("#planningForm");

let selectedEvent = null;
let decorChargeTouched = false;
let staffCostTouched = false;
let staffFoodCostTouched = false;
let saveStatusEl = null;
let lastComputedTotalCost = 0;
let lastComputedProfitLoss = 0;
let sheetParserPromise = null;

const DEFAULTS = window.ODC_DATA?.defaults || { decorRate: 0.05, staffCostPerDay: 1000 };

const moneyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function readNumber(input) {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function nonSundayDaysInMonth(dateIso) {
  const date = dateIso ? new Date(`${dateIso}T00:00:00`) : new Date();
  const year = date.getFullYear();
  const month = date.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= lastDay; day += 1) {
    if (new Date(year, month, day).getDay() !== 0) count += 1;
  }
  return count || 1;
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeCell(value) {
  return String(value ?? "").trim();
}

function parseLooseNumber(value) {
  const n = Number.parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  row.push(cell);
  rows.push(row);
  const headers = (rows.shift() || []).map((h) => String(h || "").trim());
  return rows.filter((r) => r.some((v) => String(v || "").trim())).map((r) => {
    const out = {};
    headers.forEach((h, i) => { out[h] = r[i] || ""; });
    return out;
  });
}

function csvToMatrix(text) {
  const objects = parseCsv(text);
  const headers = objects.length ? Object.keys(objects[0]) : [];
  return [headers, ...objects.map((row) => headers.map((header) => row[header]))];
}

function loadSheetParser() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (sheetParserPromise) return sheetParserPromise;
  sheetParserPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("Excel parser could not load."));
    document.head.append(script);
  });
  return sheetParserPromise;
}

async function readStaffRows(file) {
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "csv") return extractStaffRowsFromSheets([{ name: file.name, rows: csvToMatrix(await file.text()) }]);
  const XLSX = await loadSheetParser();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "" })
  }));
  return extractStaffRowsFromSheets(sheets);
}

function scoreHeader(value, type) {
  const h = normalizeHeader(value);
  if (!h) return 0;
  if (type === "code") {
    if (h === "employeecode" || h === "empcode" || h === "staffcode" || h === "code") return 12;
    if (h.includes("employee") && (h.includes("code") || h.includes("id") || h.includes("no"))) return 10;
    if (h.includes("emp") && (h.includes("code") || h.includes("id") || h.includes("no"))) return 9;
    if (h.includes("staff") && (h.includes("code") || h.includes("id") || h.includes("no"))) return 8;
  }
  if (type === "name") {
    if (h === "name" || h === "employeename" || h === "staffname") return 10;
    if (h.includes("name") && !h.includes("company")) return 8;
  }
  if (type === "days") {
    if (h === "noofdays" || h === "nodays" || h === "days" || h === "dutyday" || h === "dutydays") return 12;
    if (h.includes("day") && (h.includes("no") || h.includes("count") || h.includes("duty") || h.includes("work"))) return 10;
    if (h.includes("present") || h.includes("attendance")) return 7;
  }
  if (type === "salary") {
    if (h === "salary" || h === "monthlysalary" || h === "grosssalary") return 12;
    if (h.includes("salary") || h.includes("wage") || h.includes("pay") || h.includes("gross") || h.includes("ctc")) return 9;
    if (h.includes("amount") || h.includes("rate")) return 5;
  }
  return 0;
}

function bestColumn(headerRow, type, used) {
  let best = { index: -1, score: 0 };
  headerRow.forEach((value, index) => {
    if (used.has(index)) return;
    const score = scoreHeader(value, type);
    if (score > best.score) best = { index, score };
  });
  return best.score >= 5 ? best.index : -1;
}

function looksLikeEmployeeCode(value) {
  const v = normalizeCell(value);
  return /^[a-z0-9][a-z0-9/-]{1,20}$/i.test(v) && !/^\d{1,2}(\.\d+)?$/.test(v);
}

function detectColumns(rows) {
  const scanLimit = Math.min(rows.length, 25);
  let best = null;
  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const used = new Set();
    const code = bestColumn(row, "code", used); if (code >= 0) used.add(code);
    const name = bestColumn(row, "name", used); if (name >= 0) used.add(name);
    const days = bestColumn(row, "days", used); if (days >= 0) used.add(days);
    const salary = bestColumn(row, "salary", used); if (salary >= 0) used.add(salary);
    const score = [code, name, days, salary].filter((i) => i >= 0).length;
    if (!best || score > best.score) best = { rowIndex, code, name, days, salary, score };
    if (score >= 3 && code >= 0 && days >= 0 && salary >= 0) break;
  }

  if (best && best.code >= 0 && best.days >= 0 && best.salary >= 0) return best;

  // Fallback for files with no real header: infer by values from first data rows.
  const sampleRows = rows.slice(0, Math.min(rows.length, 30));
  const maxCols = Math.max(...sampleRows.map((r) => r.length), 0);
  const stats = Array.from({ length: maxCols }, (_, index) => ({ index, code: 0, numeric: 0, largeNumeric: 0, text: 0 }));
  sampleRows.forEach((row) => {
    row.forEach((value, index) => {
      const text = normalizeCell(value);
      if (!text) return;
      if (looksLikeEmployeeCode(text)) stats[index].code += 1;
      const num = parseLooseNumber(text);
      if (num > 0) stats[index].numeric += 1;
      if (num >= 1000) stats[index].largeNumeric += 1;
      if (!num && /[a-z]/i.test(text)) stats[index].text += 1;
    });
  });
  const codeCol = [...stats].sort((a, b) => b.code - a.code)[0]?.index ?? -1;
  const salaryCol = [...stats].filter((s) => s.index !== codeCol).sort((a, b) => b.largeNumeric - a.largeNumeric)[0]?.index ?? -1;
  const daysCol = [...stats].filter((s) => s.index !== codeCol && s.index !== salaryCol).sort((a, b) => b.numeric - a.numeric)[0]?.index ?? -1;
  const nameCol = [...stats].filter((s) => s.index !== codeCol && s.index !== salaryCol && s.index !== daysCol).sort((a, b) => b.text - a.text)[0]?.index ?? -1;
  return { rowIndex: -1, code: codeCol, name: nameCol, days: daysCol, salary: salaryCol, score: 0 };
}

function extractStaffRowsFromSheets(sheets) {
  const candidates = [];
  sheets.forEach((sheet) => {
    const rows = (sheet.rows || []).filter((row) => row && row.some((value) => normalizeCell(value)));
    if (!rows.length) return;
    const cols = detectColumns(rows);
    if (cols.code < 0 || cols.days < 0 || cols.salary < 0) return;
    const dataRows = rows.slice(cols.rowIndex >= 0 ? cols.rowIndex + 1 : 0);
    const mapped = dataRows.map((row, idx) => ({
      code: normalizeCell(row[cols.code]),
      name: cols.name >= 0 ? normalizeCell(row[cols.name]) : "",
      days: row[cols.days],
      salary: row[cols.salary],
      sourceRow: (cols.rowIndex >= 0 ? cols.rowIndex + 2 : 1) + idx,
      sheet: sheet.name
    })).filter((row) => row.code || row.name || row.days || row.salary);
    const validish = mapped.filter((row) => normalizeCell(row.code) && parseLooseNumber(row.days) > 0 && parseLooseNumber(row.salary) > 0);
    candidates.push({ sheet: sheet.name, rows: mapped, validCount: validish.length });
  });
  candidates.sort((a, b) => b.validCount - a.validCount);
  return candidates[0]?.rows || [];
}

async function handleStaffFile(file) {
  if (!file) return;
  if (!selectedEvent) {
    staffFileStatus.textContent = "Select an event first.";
    staffDataFile.value = "";
    return;
  }

  staffFileStatus.textContent = "Reading staff file...";
  try {
    const rows = await readStaffRows(file);
    const monthDays = nonSundayDaysInMonth(selectedEvent.date);
    const seen = new Set();
    const duplicates = [];
    const accepted = [];
    let total = 0;

    rows.forEach((row, index) => {
      const code = String(row.code || "").trim();
      if (!code) return;
      if (seen.has(code.toLowerCase())) {
        duplicates.push(code);
        return;
      }
      seen.add(code.toLowerCase());
      const name = String(row.name || "").trim();
      const days = parseLooseNumber(row.days);
      const salary = parseLooseNumber(row.salary);
      if (!(days > 0) || !(salary > 0)) return;
      const cost = (salary / monthDays) * days;
      total += cost;
      accepted.push({ code, name, days, salary, cost, row: row.sourceRow || index + 1, sheet: row.sheet || "" });
    });

    if (!accepted.length) {
      staffFileStatus.textContent = "No valid staff rows found.";
      return;
    }

    staffCount.value = String(accepted.length);
    totalStaffCostInput.value = total.toFixed(2);
    staffCostTouched = true;
    updateCostTotals();
    const eventMonth = new Date(`${selectedEvent.date}T00:00:00`).toLocaleString("en-IN", { month: "short", year: "numeric" });
    staffFileStatus.textContent = `${accepted.length} staff loaded, ${moneyFormatter.format(total)} for ${eventMonth} (${monthDays} non-Sunday days)` +
      (duplicates.length ? `; ${duplicates.length} duplicate employee code(s) skipped` : "");
  } catch (err) {
    staffFileStatus.textContent = err.message || "Could not read staff file.";
  }
}

function formatEventDate(dateValue) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${dateValue}T00:00:00`));
}

function renderEvents(query = "") {
  const normalizedQuery = query.trim().toLowerCase();
  const results = getAllEvents().filter((event) => {
    if (event.status === "completed" || event.status === "cancelled") return false;
    const searchable = `${event.name} ${event.location} ${event.date}`.toLowerCase();
    return searchable.includes(normalizedQuery);
  });

  list.innerHTML = "";

  if (results.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-events";
    empty.style.cssText = "padding:10px;text-align:center;color:var(--muted);font-size:0.85rem;";
    empty.textContent = "No open events found";
    list.append(empty);
    return;
  }

  results.forEach((event) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "event-option";
    option.setAttribute("role", "option");
    option.dataset.eventId = event.id;

    const name = document.createElement("span");
    name.textContent = event.name;
    const meta = document.createElement("small");
    meta.textContent = `${ODC.eventContextText(event, { includeDays: true })} | ${event.location}`;
    option.append(name, meta);

    option.addEventListener("click", () => {
      selectedEvent = event;
      selectedEventId.value = event.id;
      trigger.textContent = event.name;
      trigger.setAttribute("aria-label", event.name);
      updatePlanningContext();
      loadPreCost(event.id);
      closeMenu();
    });

    list.append(option);
  });
}

function updatePlanningContext() {
  const pax = selectedEvent?.pax || 0;
  const days = selectedEvent?.days || 0;
  const billing = (selectedEvent?.totalBilling || 0) / 1.05;

  planningPax.textContent = pax.toLocaleString("en-IN");
  planningCostPerPax.textContent = moneyFormatter.format(selectedEvent?.costPerPax || 0);
  planningDays.textContent = days.toLocaleString("en-IN");
  const billingEl = document.getElementById("planningTotalBilling");
  if (billingEl) billingEl.textContent = billing > 0 ? moneyFormatter.format(billing) : "—";
}

function updateCostTotals() {
  const pax = selectedEvent?.pax || 0;
  const days = selectedEvent?.days || 0;
  const totalBilling = (selectedEvent?.totalBilling || 0) / 1.05; // pre-GST revenue for P&L planning
  const foodTotal = pax * readNumber(foodCostPerPax);

  // Staff cost is driven by Staff No. * per-day rate * days, unless manually overridden.
  if (!staffCostTouched && document.activeElement !== totalStaffCostInput) {
    const computed = readNumber(staffCount) * (DEFAULTS.staffCostPerDay || 0) * (days || 1);
    if (computed > 0) totalStaffCostInput.value = computed.toFixed(2);
  }
  if (!staffFoodCostTouched && document.activeElement !== staffFoodCost) {
    const computed = readNumber(staffCount) * 1000;
    staffFoodCost.value = computed > 0 ? computed.toFixed(2) : "";
  }
  const staffTotal = readNumber(totalStaffCostInput);
  const additionalTotal =
    readNumber(staffTransportationCharge) +
    readNumber(staffAccommodationCharge) +
    readNumber(staffFoodCost) +
    readNumber(refervanCharge) +
    readNumber(equipmentTransportationCharge);

  if (!decorChargeTouched && document.activeElement !== decorCharge) {
    decorCharge.value = (totalBilling * (DEFAULTS.decorRate ?? 0.05)).toFixed(2);
  }

  const totalCost =
    foodTotal +
    staffTotal +
    readNumber(equipmentDepreciation) +
    readNumber(thirdPartyVendor) +
    readNumber(decorCharge) +
    readNumber(miscellaneousCost) +
    additionalTotal;
  const profitLossAmount = totalBilling - totalCost;

  lastComputedTotalCost = totalCost;
  lastComputedProfitLoss = profitLossAmount;
  totalFoodCost.value = moneyFormatter.format(foodTotal);
  totalPlanningCost.value = moneyFormatter.format(totalCost);
  profitLoss.value = moneyFormatter.format(profitLossAmount);
  profitLoss.classList.toggle("loss-output", profitLossAmount < 0);
}

function collectPreCost() {
  return {
    foodCostPerPax: readNumber(foodCostPerPax),
    staffCount: readNumber(staffCount),
    totalStaffCost: readNumber(totalStaffCostInput),
    equipmentDepreciation: readNumber(equipmentDepreciation),
    thirdPartyVendor: readNumber(thirdPartyVendor),
    decorCharge: readNumber(decorCharge),
    miscellaneousCost: readNumber(miscellaneousCost),
    staffTransportationCharge: readNumber(staffTransportationCharge),
    staffAccommodationCharge: readNumber(staffAccommodationCharge),
    staffFoodCost: readNumber(staffFoodCost),
    refervanCharge: readNumber(refervanCharge),
    equipmentTransportationCharge: readNumber(equipmentTransportationCharge),
    totalCost: lastComputedTotalCost,
    profitLoss: lastComputedProfitLoss
  };
}

async function loadPreCost(eventId) {
  let data = null;
  try { data = await getPreCost(eventId); } catch { /* offline */ }

  decorChargeTouched = false;
  staffCostTouched = false;
  staffFoodCostTouched = false;

  const set = (input, value) => { input.value = value ? String(value) : ""; };
  if (data) {
    set(foodCostPerPax, data.foodCostPerPax);
    set(staffCount, data.staffCount);
    set(totalStaffCostInput, data.totalStaffCost);
    set(equipmentDepreciation, data.equipmentDepreciation);
    set(thirdPartyVendor, data.thirdPartyVendor);
    set(miscellaneousCost, data.miscellaneousCost);
    set(staffTransportationCharge, data.staffTransportationCharge);
    set(staffAccommodationCharge, data.staffAccommodationCharge);
    set(staffFoodCost, data.staffFoodCost);
    set(refervanCharge, data.refervanCharge);
    set(equipmentTransportationCharge, data.equipmentTransportationCharge);
    if (Number(data.totalStaffCost) > 0) staffCostTouched = true;
    if (Number(data.staffFoodCost) > 0) staffFoodCostTouched = true;
    if (Number(data.decorCharge) > 0) { decorCharge.value = String(data.decorCharge); decorChargeTouched = true; }
  } else {
    [foodCostPerPax, staffCount, totalStaffCostInput, equipmentDepreciation, thirdPartyVendor, miscellaneousCost, staffTransportationCharge, staffAccommodationCharge, staffFoodCost, refervanCharge, equipmentTransportationCharge].forEach((i) => { i.value = ""; });
  }

  updateCostTotals();
}

function savePreCostNow() {
  if (!selectedEvent) { setStatus("Select an event before saving.", true); return; }
  savePreCost(selectedEvent.id, collectPreCost())
    .then(() => setStatus(`Saved pre-cost plan for ${selectedEvent.externalId || selectedEvent.name}.`))
    .catch(() => setStatus("Saved locally; server sync failed.", true));
}

function setStatus(message, isError = false) {
  if (!saveStatusEl) return;
  saveStatusEl.textContent = message;
  saveStatusEl.classList.toggle("error", isError);
}

function ensureSaveBar() {
  if (saveStatusEl) return;
  const bar = document.createElement("div");
  bar.className = "save-bar";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "primary-button";
  saveBtn.textContent = "Save Plan";
  saveBtn.addEventListener("click", savePreCostNow);
  saveStatusEl = document.createElement("p");
  saveStatusEl.className = "form-status";
  saveStatusEl.setAttribute("aria-live", "polite");
  bar.append(saveBtn, saveStatusEl);
  (document.querySelector("#planningFinalRow") || planningForm).append(bar);
}

function openMenu() {
  menu.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  search.value = "";
  renderEvents();
  search.focus();
}

function closeMenu({ restoreFocus = false } = {}) {
  const wasOpen = !menu.hidden;
  menu.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  if (restoreFocus && wasOpen) trigger.focus();
}

trigger.addEventListener("click", () => { if (menu.hidden) openMenu(); else closeMenu({ restoreFocus: true }); });
search.addEventListener("input", () => renderEvents(search.value));
foodCostPerPax.addEventListener("input", updateCostTotals);
staffCount.addEventListener("input", () => { staffCostTouched = false; updateCostTotals(); });
totalStaffCostInput.addEventListener("input", () => { staffCostTouched = true; updateCostTotals(); });
staffDataFileButton.addEventListener("click", () => staffDataFile.click());
staffDataFile.addEventListener("change", () => handleStaffFile(staffDataFile.files && staffDataFile.files[0]));
equipmentDepreciation.addEventListener("input", updateCostTotals);
thirdPartyVendor.addEventListener("input", updateCostTotals);
decorCharge.addEventListener("input", () => { decorChargeTouched = true; updateCostTotals(); });
miscellaneousCost.addEventListener("input", updateCostTotals);
staffTransportationCharge.addEventListener("input", updateCostTotals);
staffAccommodationCharge.addEventListener("input", updateCostTotals);
staffFoodCost.addEventListener("input", () => { staffFoodCostTouched = true; updateCostTotals(); });
refervanCharge.addEventListener("input", updateCostTotals);
equipmentTransportationCharge.addEventListener("input", updateCostTotals);
if (planningForm) planningForm.addEventListener("submit", (e) => e.preventDefault());

document.addEventListener("click", (event) => { if (!event.target.closest(".event-picker")) closeMenu(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu({ restoreFocus: true }); });

function init() {
  document.querySelectorAll(".date-dmy").forEach((el) => ODC.attachDateMask(el));
  ensureSaveBar();
  renderEvents();
  updatePlanningContext();
  updateCostTotals();
}

ODC.ready.then(init);
ODC.registerSync(() => renderEvents(search.value || ""));

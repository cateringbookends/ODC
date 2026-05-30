const eventDateInput = document.querySelector("#eventDate");
const entryDateInput = document.querySelector("#entryDate");
const eventNameInput = document.querySelector("#eventName");
const locationInput = document.querySelector("#location");
const paxInput = document.querySelector("#pax");
const costInput = document.querySelector("#costPerPax");
const totalBilling = document.querySelector("#totalBilling");
const summaryPax = document.querySelector("#summaryPax");
const summaryCost = document.querySelector("#summaryCost");
const minimumAdvance = document.querySelector("#minimumAdvance");
const advanceDueDate = document.querySelector("#advanceDueDate");
const paymentRows = document.querySelector("#paymentRows");
const addPaymentButton = document.querySelector("#addPayment");
const scheduledTotal = document.querySelector("#scheduledTotal");
const balancePending = document.querySelector("#balancePending");
const cashScheduled = document.querySelector("#cashScheduled");
const onlineScheduled = document.querySelector("#onlineScheduled");
const invoicePanel = document.querySelector("#invoicePanel");
const invoiceLines = document.querySelector("#invoiceLines");
const onlineGst = document.querySelector("#onlineGst");
const invoiceSubtotal = document.querySelector("#invoiceSubtotal");
const invoiceGstAmount = document.querySelector("#invoiceGstAmount");
const invoiceTotal = document.querySelector("#invoiceTotal");
const salesShell = document.querySelector(".sales-shell");
const salesForm = document.querySelector("#salesForm");
const saveEventButton = document.querySelector("#saveEvent");
const saveStatus = document.querySelector("#saveStatus");
const savedEventsList = document.querySelector("#savedEventsList");
const eventDaysInput = document.querySelector("#eventDays");
const eventTimeInput = document.querySelector("#eventTime");
const foodTypeInput = document.querySelector("#foodType");
const allergicCountInput = document.querySelector("#allergicCount");
const allergicNotesInput = document.querySelector("#allergicNotes");
const summaryFoodType = document.querySelector("#summaryFoodType");
const summaryAllergicCount = document.querySelector("#summaryAllergicCount");
const summaryAllergicNotes = document.querySelector("#summaryAllergicNotes");

const FOOD_LABELS = { jain: "Jain", "non-jain": "Non-Jain" };

const invoiceKycInputs = {
  name: document.querySelector("#invoiceName"),
  mobile: document.querySelector("#invoiceMobile"),
  email: document.querySelector("#invoiceEmail"),
  gst: document.querySelector("#invoiceGst"),
  pan: document.querySelector("#invoicePan"),
  aadhar: document.querySelector("#invoiceAadhar")
};

const moneyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const billingDefaults = window.ODC_DATA?.defaults || { advanceRate: 0.5, gstRate: 0.05 };

// Client-side KYC validation (mirrors server-side rules; empty is allowed).
const KYC_RULES = {
  mobile: { re: /^\d{10}$/, label: "Mobile (10 digits)" },
  pan: { re: /^[A-Z]{5}\d{4}[A-Z]$/, label: "PAN (ABCDE1234F)" },
  aadhar: { re: /^\d{12}$/, label: "Aadhaar (12 digits)" },
  gst: { re: /^\d{2}[A-Z0-9]{13}$/, label: "GST (15 chars)" },
  email: { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, label: "Email" }
};

let editing = null; // currently-edited saved event, or null for a new entry
let savedQuery = "";
let savedControlsReady = false;

function readNumber(input) {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatDateValue(dateValue) {
  if (!dateValue) return "No date";
  return formatDate(new Date(`${dateValue}T00:00:00`));
}

function getAdvanceDueDate() {
  if (!eventDateInput.value) return "Select event date";
  const eventDate = new Date(`${eventDateInput.value}T00:00:00`);
  eventDate.setDate(eventDate.getDate() - 3);
  return formatDate(eventDate);
}

function getAdvanceDueInputValue() {
  if (!eventDateInput.value) return "";
  const eventDate = new Date(`${eventDateInput.value}T00:00:00`);
  eventDate.setDate(eventDate.getDate() - 3);
  const year = eventDate.getFullYear();
  const month = String(eventDate.getMonth() + 1).padStart(2, "0");
  const day = String(eventDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPaymentRows() {
  return [...paymentRows.querySelectorAll(".payment-row")];
}

function createPaymentRow({ label, amount, dueDate, isAdvance = false, billing = "cash", method = "UPI", touched = false }) {
  const row = document.createElement("div");
  row.className = "payment-row";
  row.dataset.advance = String(isAdvance);
  row.dataset.touched = String(touched);

  // Note: user-controlled values are assigned via .value (never interpolated into HTML) to avoid injection.
  row.innerHTML = `
    <label>
      <span>Cycle Name</span>
      <input type="text" class="cycle-name">
    </label>
    <label>
      <span>Due Date</span>
      <input type="date" class="cycle-date">
    </label>
    <label>
      <span>Amount</span>
      <input type="number" class="cycle-amount" min="0" step="0.01">
    </label>
    <label>
      <span>Billing</span>
      <select class="cycle-billing">
        <option value="cash">Cash</option>
        <option value="online">Online</option>
      </select>
    </label>
    <label class="online-method-field" hidden>
      <span>Online Method</span>
      <select class="online-method">
        <option value="UPI">UPI</option>
        <option value="Card">Card</option>
        <option value="Cheque">Cheque</option>
        <option value="Bank Transfer">Bank Transfer</option>
      </select>
    </label>
    <button type="button" class="remove-payment" aria-label="Remove payment cycle">Remove</button>
  `;

  row.querySelector(".cycle-name").value = label;
  row.querySelector(".cycle-date").value = dueDate || "";
  row.querySelector(".cycle-amount").value = Number(amount || 0).toFixed(2);
  row.querySelector(".cycle-billing").value = billing;
  row.querySelector(".online-method").value = method;

  row.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", updateBilling);
    input.addEventListener("change", updateBilling);
  });

  row.querySelector(".cycle-amount").addEventListener("input", () => {
    row.dataset.touched = "true";
  });

  row.querySelector(".remove-payment").addEventListener("click", () => {
    row.remove();
    updateBilling();
  });

  if (isAdvance) {
    row.querySelector(".remove-payment").style.visibility = "hidden";
  }

  row.querySelector(".cycle-billing").addEventListener("change", (e) => {
    const isOnline = e.target.value === "online";
    row.querySelector(".online-method-field").hidden = !isOnline;
    updateBilling();
  });

  paymentRows.append(row);
  return row;
}

function syncAdvanceRow(advance, dueDate) {
  let advanceRow = paymentRows.querySelector("[data-advance='true']");

  if (!advanceRow) {
    advanceRow = createPaymentRow({
      label: "Advance",
      amount: advance,
      dueDate: eventDateInput.value ? getAdvanceDueInputValue() : "",
      isAdvance: true
    });
  }

  const advanceAmountInput = advanceRow.querySelector(".cycle-amount");
  if (advanceRow.dataset.touched !== "true" && document.activeElement !== advanceAmountInput) {
    advanceAmountInput.value = advance.toFixed(2);
  }
  advanceRow.querySelector(".cycle-date").value = dueDate;
}

// When the billing base changes, let the advance row auto-recalculate again
// (fixes: advance stayed frozen forever after a single manual edit).
function resetAdvanceAuto() {
  const advanceRow = paymentRows.querySelector("[data-advance='true']");
  if (advanceRow) advanceRow.dataset.touched = "false";
}

function getScheduledTotal() {
  return getPaymentRows().reduce((sum, row) => sum + readNumber(row.querySelector(".cycle-amount")), 0);
}

function getBillingTotals() {
  return getPaymentRows().reduce(
    (totals, row) => {
      const amount = readNumber(row.querySelector(".cycle-amount"));
      const billing = row.querySelector(".cycle-billing").value;
      totals[billing] += amount;
      return totals;
    },
    { cash: 0, online: 0 }
  );
}

function syncOnlineMethodFields() {
  getPaymentRows().forEach((row) => {
    const isOnline = row.querySelector(".cycle-billing").value === "online";
    const methodField = row.querySelector(".online-method-field");
    methodField.hidden = !isOnline;
    methodField.querySelector("select").disabled = !isOnline;
  });
}

function renderInvoice() {
  const onlineRows = getPaymentRows().filter((row) => row.querySelector(".cycle-billing").value === "online");
  const subtotal = onlineRows.reduce((sum, row) => sum + readNumber(row.querySelector(".cycle-amount")), 0);
  const gst = subtotal * billingDefaults.gstRate;
  const total = subtotal + gst;

  invoicePanel.hidden = onlineRows.length === 0;
  salesShell.classList.toggle("has-online", onlineRows.length > 0);
  invoiceLines.innerHTML = "";

  onlineRows.forEach((row) => {
    const name = row.querySelector(".cycle-name").value || "Online Payment";
    const method = row.querySelector(".online-method").value;
    const dateValue = row.querySelector(".cycle-date").value;
    const dueDate = dateValue ? formatDate(new Date(`${dateValue}T00:00:00`)) : "No due date";
    const amount = readNumber(row.querySelector(".cycle-amount"));

    const line = document.createElement("div");
    const nameText = document.createElement("span");
    const detailText = document.createElement("small");
    const amountText = document.createElement("strong");

    line.className = "invoice-line";
    nameText.textContent = name;
    detailText.textContent = `${method} | ${dueDate}`;
    amountText.textContent = moneyFormatter.format(amount);

    nameText.appendChild(detailText);
    line.append(nameText, amountText);
    invoiceLines.append(line);
  });

  invoiceSubtotal.textContent = moneyFormatter.format(subtotal);
  invoiceGstAmount.textContent = moneyFormatter.format(gst);
  invoiceTotal.textContent = moneyFormatter.format(total);
}

function addCustomPaymentCycle() {
  const balance = Math.max(getCurrentTotal() - getScheduledTotal(), 0);
  createPaymentRow({ label: "Balance Payment", amount: balance, dueDate: eventDateInput.value, isAdvance: false });
  updateBilling();
}

function getCurrentTotal() {
  const pax = Math.floor(readNumber(paxInput));
  const days = Math.floor(readNumber(eventDaysInput)) || 1;
  const costPerPax = readNumber(costInput);
  return pax * costPerPax * days;
}

function getPaymentSchedulePayload() {
  return getPaymentRows().map((row) => ({
    label: row.querySelector(".cycle-name").value.trim(),
    dueDate: row.querySelector(".cycle-date").value,
    amount: readNumber(row.querySelector(".cycle-amount")),
    billing: row.querySelector(".cycle-billing").value,
    method: row.querySelector(".online-method").value,
    isAdvance: row.dataset.advance === "true"
  }));
}

function getInvoiceKycPayload() {
  return Object.fromEntries(Object.entries(invoiceKycInputs).map(([key, input]) => [key, input.value.trim()]));
}

function validateKyc() {
  const kyc = getInvoiceKycPayload();
  for (const [key, rule] of Object.entries(KYC_RULES)) {
    const value = kyc[key];
    if (!value) continue;
    const test = key === "email" ? value : value.toUpperCase();
    if (!rule.re.test(test)) return `${rule.label} is invalid.`;
  }
  return null;
}

function setSaveStatus(message, isError = false) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle("error", isError);
}

function getAllergicCount() {
  return Math.max(parseInt(allergicCountInput.value, 10) || 0, 0);
}

function renderPrecautions() {
  summaryFoodType.textContent = FOOD_LABELS[foodTypeInput.value] || "—";
  summaryAllergicCount.textContent = getAllergicCount().toLocaleString("en-IN");
  summaryAllergicNotes.textContent = allergicNotesInput.value.trim(); // textContent => safe
}

function eventsMatching(query) {
  const q = query.trim().toLowerCase();
  return getSavedEvents().filter((e) => `${e.name} ${e.location} ${e.externalId}`.toLowerCase().includes(q)).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

const STATUSES = ["open", "planning", "completed", "cancelled"];

function renderSavedEvents() {
  ensureSavedControls();
  const events = eventsMatching(savedQuery);
  savedEventsList.innerHTML = "";

  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "form-status";
    empty.textContent = savedQuery ? "No matching events." : "No events saved yet.";
    savedEventsList.append(empty);
    return;
  }

  events.forEach((event) => {
    const item = document.createElement("article");
    item.className = "saved-event-item";

    const info = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = event.name;
    const span = document.createElement("span");
    span.textContent = `${event.externalId} | ${formatDateValue(event.date)} | ${event.location}`;
    info.append(strong, span);

    const out = document.createElement("output");
    out.textContent = moneyFormatter.format(event.totalBilling);

    const controls = document.createElement("div");
    controls.className = "saved-event-controls";

    const statusSelect = document.createElement("select");
    statusSelect.className = "saved-status";
    statusSelect.setAttribute("aria-label", "Event status");
    STATUSES.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s.charAt(0).toUpperCase() + s.slice(1);
      statusSelect.append(opt);
    });
    statusSelect.value = event.status || "open";
    statusSelect.addEventListener("change", () => {
      upsertEvent({ ...event, status: statusSelect.value });
      renderSavedEvents();
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "secondary-button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => loadEventIntoForm(event.id));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "secondary-button danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => {
      if (!confirm(`Delete ${event.externalId} — ${event.name}?`)) return;
      deleteEvent(event.id);
      if (editing && editing.id === event.id) clearForm();
      renderSavedEvents();
    });

    controls.append(statusSelect, editBtn, delBtn);
    item.append(info, out, controls);
    savedEventsList.append(item);
  });
}

function ensureSavedControls() {
  if (savedControlsReady) return;
  const section = savedEventsList.closest(".payment-schedule") || savedEventsList.parentElement;

  const bar = document.createElement("div");
  bar.className = "saved-controls";

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search saved events";
  searchInput.className = "saved-search";
  searchInput.value = savedQuery;
  searchInput.addEventListener("input", () => { savedQuery = searchInput.value; renderSavedEvents(); searchInput.focus(); });

  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "secondary-button";
  newBtn.textContent = "New Event";
  newBtn.addEventListener("click", clearForm);

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "secondary-button";
  exportBtn.textContent = "Export CSV";
  exportBtn.addEventListener("click", exportCsv);

  bar.append(searchInput, newBtn, exportBtn);
  section.insertBefore(bar, savedEventsList);
  savedControlsReady = true;
}

function exportCsv() {
  const rows = getSavedEvents();
  const headers = ["externalId", "name", "date", "time", "location", "pax", "days", "costPerPax", "totalBilling", "status", "foodType", "allergicCount", "allergicNotes"];
  const csvCell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  rows.forEach((e) => lines.push(headers.map((h) => csvCell(e[h])).join(",")));
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "odc-events.csv";
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function loadEventIntoForm(id) {
  const event = getEventById(id);
  if (!event) return;
  editing = event;

  entryDateInput.value = event.entryDate || "";
  eventDateInput.value = event.date || "";
  eventNameInput.value = event.name || "";
  locationInput.value = event.location || "";
  paxInput.value = event.pax || "";
  eventDaysInput.value = event.days || 1;
  costInput.value = event.costPerPax || "";
  eventTimeInput.value = event.time || "";
  foodTypeInput.value = event.foodType || "";
  allergicCountInput.value = event.allergicCount || "";
  allergicNotesInput.value = event.allergicNotes || "";

  const kyc = event.invoiceKyc || {};
  Object.entries(invoiceKycInputs).forEach(([key, input]) => { input.value = kyc[key] || ""; });

  paymentRows.innerHTML = "";
  const schedule = Array.isArray(event.paymentSchedule) ? event.paymentSchedule : [];
  if (schedule.length === 0) {
    // No saved cycles: let updateBilling seed a fresh advance row.
  } else {
    schedule.forEach((c) => createPaymentRow({
      label: c.label || "Payment",
      amount: c.amount || 0,
      dueDate: c.dueDate || "",
      isAdvance: !!c.isAdvance,
      billing: c.billing === "online" ? "online" : "cash",
      method: c.method || "UPI",
      touched: true // preserve saved amounts (incl. advance) on recompute
    }));
  }

  updateBilling();
  saveEventButton.textContent = "Update Event";
  setSaveStatus(`Editing ${event.externalId}. Change fields and click Update Event.`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearForm() {
  editing = null;
  salesForm.reset();
  eventDaysInput.value = 1;
  Object.values(invoiceKycInputs).forEach((input) => { input.value = ""; });
  paymentRows.innerHTML = "";
  saveEventButton.textContent = "Save Event";
  setSaveStatus("");
  updateBilling();
}

function saveCurrentEvent() {
  const eventName = eventNameInput.value.trim();
  const location = locationInput.value.trim();
  const eventDate = eventDateInput.value;
  const pax = Math.floor(readNumber(paxInput));
  const days = Math.floor(readNumber(eventDaysInput)) || 1;
  const costPerPax = readNumber(costInput);

  if (!eventName || !location || !eventDate || pax <= 0 || costPerPax <= 0) {
    setSaveStatus("Complete event name, date, location, PAX and cost per PAX before saving.", true);
    return;
  }

  const kycError = validateKyc();
  if (kycError) { setSaveStatus(kycError, true); return; }

  const savedEvent = upsertEvent({
    id: editing ? editing.id : createEventId(),
    externalId: editing ? editing.externalId : createExternalId(),
    entryDate: entryDateInput.value,
    name: eventName,
    date: eventDate,
    location,
    pax,
    days,
    costPerPax,
    status: editing ? editing.status || "open" : "open",
    time: eventTimeInput.value,
    foodType: foodTypeInput.value,
    allergicCount: getAllergicCount(),
    allergicNotes: allergicNotesInput.value.trim(),
    paymentSchedule: getPaymentSchedulePayload(),
    invoiceKyc: getInvoiceKycPayload()
  });

  const verb = editing ? "updated" : "saved";
  editing = savedEvent;
  saveEventButton.textContent = "Update Event";
  setSaveStatus(`${savedEvent.externalId} ${verb}. Available in Pre Cost Planning and Petty Cash.`);
  renderSavedEvents();
}

function updateBilling() {
  const pax = Math.floor(readNumber(paxInput));
  const costPerPax = readNumber(costInput);
  const total = getCurrentTotal();
  const advance = total * billingDefaults.advanceRate;

  syncAdvanceRow(advance, getAdvanceDueInputValue());

  const scheduled = getScheduledTotal();
  const billingTotals = getBillingTotals();
  const balance = total - scheduled;

  syncOnlineMethodFields();
  renderInvoice();

  totalBilling.value = moneyFormatter.format(total);
  summaryPax.textContent = pax.toLocaleString("en-IN");
  summaryCost.textContent = moneyFormatter.format(costPerPax);
  minimumAdvance.textContent = moneyFormatter.format(advance);
  advanceDueDate.textContent = getAdvanceDueDate();
  scheduledTotal.textContent = moneyFormatter.format(scheduled);
  cashScheduled.textContent = moneyFormatter.format(billingTotals.cash);
  onlineScheduled.textContent = moneyFormatter.format(billingTotals.online);
  onlineGst.textContent = moneyFormatter.format(billingTotals.online * billingDefaults.gstRate);
  balancePending.textContent = moneyFormatter.format(balance);
  balancePending.classList.toggle("overpaid", balance < 0);

  renderPrecautions();
}

// Inputs that change the billing base also re-enable advance auto-calc.
[eventDateInput, paxInput, costInput, eventDaysInput].forEach((input) => {
  input.addEventListener("input", () => { resetAdvanceAuto(); updateBilling(); });
});
addPaymentButton.addEventListener("click", addCustomPaymentCycle);
saveEventButton.addEventListener("click", saveCurrentEvent);
salesForm.addEventListener("submit", (e) => e.preventDefault());
Object.values(invoiceKycInputs).forEach((input) => input.addEventListener("input", updateBilling));
[eventTimeInput, foodTypeInput, allergicCountInput, allergicNotesInput].forEach((el) => {
  el.addEventListener("input", updateBilling);
  el.addEventListener("change", updateBilling);
});

function init() {
  updateBilling();
  renderSavedEvents();
}

ODC.ready.then(init);
ODC.registerSync(renderSavedEvents);

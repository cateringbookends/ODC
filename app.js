const entryDateInput = document.querySelector("#entryDate");
const eventDateInput = document.querySelector("#eventDate");
const eventNameInput = document.querySelector("#eventName");
const locationInput = document.querySelector("#location");
const locationZoneInput = document.querySelector("#locationZone");
const paxInput = document.querySelector("#pax");
const costInput = document.querySelector("#costPerPax");
const eventDaysInput = document.querySelector("#eventDays");
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
const newEventButton = document.querySelector("#newEvent");
const saveStatus = document.querySelector("#saveStatus");

// 12-hour time control (custom; native <input type=time> shows 24h/locale per browser)
const timeEl = document.querySelector("#eventTime");
const hourSel = timeEl.querySelector(".t-hour");
const minSel = timeEl.querySelector(".t-min");
const ampmSel = timeEl.querySelector(".t-ampm");

// Catering precaution fields
const eventTimeHidden = null; // (time is read from the selects)
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

const moneyFormatter = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const billingDefaults = window.ODC_DATA?.defaults || { advanceRate: 0.5, gstRate: 0.05 };

const KYC_RULES = {
  mobile: { re: /^\d{10}$/, label: "Mobile (10 digits)" },
  pan: { re: /^[A-Z]{5}\d{4}[A-Z]$/, label: "PAN (ABCDE1234F)" },
  aadhar: { re: /^\d{12}$/, label: "Aadhaar (12 digits)" },
  gst: { re: /^\d{2}[A-Z0-9]{13}$/, label: "GST (15 chars)" },
  email: { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, label: "Email" }
};

let editing = null;

function readNumber(input) {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

// --- Dates: form fields hold DD-MM-YYYY; everything internal uses ISO yyyy-mm-dd ---
function eventIso() { return ODC.dmyToIso(eventDateInput.value); }
function entryIso() { return ODC.dmyToIso(entryDateInput.value); }

function getAdvanceDueDate() {
  const iso = eventIso();
  if (!iso) return "Select event date";
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - 3);
  return formatDate(d);
}

function getAdvanceDueInputValue() {
  const iso = eventIso();
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - 3);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// --- 12-hour time control ---
function populateTimeOptions() {
  let html = `<option value="">--</option>`;
  for (let h = 1; h <= 12; h++) html += `<option value="${h}">${h}</option>`;
  hourSel.innerHTML = html;
  let mins = "";
  for (let m = 0; m < 60; m++) { const mm = String(m).padStart(2, "0"); mins += `<option value="${mm}">${mm}</option>`; }
  minSel.innerHTML = mins;
  ampmSel.value = "AM";
}

function getTime12() {
  if (!hourSel.value) return "";
  return `${hourSel.value}:${minSel.value || "00"} ${ampmSel.value}`;
}

function setTime12(str) {
  const m = String(str || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) { hourSel.value = ""; minSel.value = "00"; ampmSel.value = "AM"; return; }
  hourSel.value = String(Number(m[1]));
  minSel.value = m[2];
  ampmSel.value = m[3].toUpperCase();
}

function getPaymentRows() {
  return [...paymentRows.querySelectorAll(".payment-row")];
}

function createPaymentRow({ label, amount, dueDate, isAdvance = false, billing = "cash", method = "UPI", touched = false }) {
  const row = document.createElement("div");
  row.className = "payment-row";
  row.dataset.advance = String(isAdvance);
  row.dataset.touched = String(touched);

  row.innerHTML = `
    <label><span>Cycle Name</span><input type="text" class="cycle-name"></label>
    <label><span>Due Date</span><input type="date" class="cycle-date"></label>
    <label><span>Amount</span><input type="number" class="cycle-amount" min="0" step="0.01"></label>
    <label><span>Billing</span>
      <select class="cycle-billing"><option value="cash">Cash</option><option value="online">Online</option></select>
    </label>
    <label class="online-method-field" hidden><span>Online Method</span>
      <select class="online-method"><option value="UPI">UPI</option><option value="Card">Card</option><option value="Cheque">Cheque</option><option value="Bank Transfer">Bank Transfer</option></select>
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
  row.querySelector(".cycle-amount").addEventListener("input", () => { row.dataset.touched = "true"; });
  row.querySelector(".remove-payment").addEventListener("click", () => { row.remove(); updateBilling(); });
  if (isAdvance) row.querySelector(".remove-payment").style.visibility = "hidden";
  row.querySelector(".cycle-billing").addEventListener("change", (e) => {
    row.querySelector(".online-method-field").hidden = e.target.value !== "online";
    updateBilling();
  });

  paymentRows.append(row);
  return row;
}

function syncAdvanceRow(advance, dueDate) {
  let advanceRow = paymentRows.querySelector("[data-advance='true']");
  if (!advanceRow) {
    advanceRow = createPaymentRow({ label: "Advance", amount: advance, dueDate: getAdvanceDueInputValue(), isAdvance: true });
  }
  const advanceAmountInput = advanceRow.querySelector(".cycle-amount");
  if (advanceRow.dataset.touched !== "true" && document.activeElement !== advanceAmountInput) {
    advanceAmountInput.value = advance.toFixed(2);
  }
  advanceRow.querySelector(".cycle-date").value = dueDate;
}

function resetAdvanceAuto() {
  const advanceRow = paymentRows.querySelector("[data-advance='true']");
  if (advanceRow) advanceRow.dataset.touched = "false";
}

function getScheduledTotal() {
  return getPaymentRows().reduce((sum, row) => sum + readNumber(row.querySelector(".cycle-amount")), 0);
}

function getBillingTotals() {
  return getPaymentRows().reduce((totals, row) => {
    const amount = readNumber(row.querySelector(".cycle-amount"));
    totals[row.querySelector(".cycle-billing").value] += amount;
    return totals;
  }, { cash: 0, online: 0 });
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
  invoiceTotal.textContent = moneyFormatter.format(subtotal + gst);
}

function addCustomPaymentCycle() {
  const balance = Math.max(getCurrentTotal() - getScheduledTotal(), 0);
  createPaymentRow({ label: "Balance Payment", amount: balance, dueDate: eventIso(), isAdvance: false });
  updateBilling();
}

function getCurrentTotal() {
  const pax = Math.floor(readNumber(paxInput));
  const days = Math.floor(readNumber(eventDaysInput)) || 1;
  return pax * readNumber(costInput) * days;
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
    if (!rule.re.test(key === "email" ? value : value.toUpperCase())) return `${rule.label} is invalid.`;
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

function loadEventIntoForm(id) {
  const event = getEventById(id);
  if (!event) return;
  editing = event;

  entryDateInput.value = ODC.isoToDmy(event.entryDate);
  eventDateInput.value = ODC.isoToDmy(event.date);
  setTime12(event.time);
  eventNameInput.value = event.name || "";
  locationInput.value = event.location || "";
  locationZoneInput.value = ["surat", "ahmedabad", "other"].includes(event.locationZone) ? event.locationZone : "other";
  paxInput.value = event.pax || "";
  eventDaysInput.value = event.days || 1;
  costInput.value = event.costPerPax || "";
  foodTypeInput.value = event.foodType || "";
  allergicCountInput.value = event.allergicCount || "";
  allergicNotesInput.value = event.allergicNotes || "";

  const kyc = event.invoiceKyc || {};
  Object.entries(invoiceKycInputs).forEach(([key, input]) => { input.value = kyc[key] || ""; });

  paymentRows.innerHTML = "";
  (Array.isArray(event.paymentSchedule) ? event.paymentSchedule : []).forEach((c) => createPaymentRow({
    label: c.label || "Payment",
    amount: c.amount || 0,
    dueDate: c.dueDate || "",
    isAdvance: !!c.isAdvance,
    billing: c.billing === "online" ? "online" : "cash",
    method: c.method || "UPI",
    touched: true
  }));

  updateBilling();
  saveEventButton.textContent = "Update Event";
  setSaveStatus(`Editing ${event.externalId}. Change fields and click Update Event.`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearForm() {
  editing = null;
  salesForm.reset();
  eventDaysInput.value = 1;
  setTime12("");
  locationZoneInput.value = "other";
  entryDateInput.value = "";
  eventDateInput.value = "";
  Object.values(invoiceKycInputs).forEach((input) => { input.value = ""; });
  paymentRows.innerHTML = "";
  saveEventButton.textContent = "Save Event";
  setSaveStatus("");
  updateBilling();
}

function saveCurrentEvent() {
  const eventName = eventNameInput.value.trim();
  const location = locationInput.value.trim();
  const dateIso = eventIso();
  const pax = Math.floor(readNumber(paxInput));
  const days = Math.floor(readNumber(eventDaysInput)) || 1;
  const costPerPax = readNumber(costInput);

  if (!eventName || !location || !dateIso || pax <= 0 || costPerPax <= 0) {
    setSaveStatus("Complete event name, valid event date (DD-MM-YYYY), location, PAX and cost per PAX before saving.", true);
    return;
  }
  if (entryDateInput.value && !entryIso()) { setSaveStatus("Entry date must be a valid DD-MM-YYYY date.", true); return; }

  const kycError = validateKyc();
  if (kycError) { setSaveStatus(kycError, true); return; }

  const savedEvent = upsertEvent({
    id: editing ? editing.id : createEventId(),
    externalId: editing ? editing.externalId : createExternalId(),
    entryDate: entryIso(),
    name: eventName,
    date: dateIso,
    time: getTime12(),
    location,
    locationZone: locationZoneInput.value || "other",
    pax,
    days,
    costPerPax,
    status: editing ? editing.status || "open" : "open",
    foodType: foodTypeInput.value,
    allergicCount: getAllergicCount(),
    allergicNotes: allergicNotesInput.value.trim(),
    paymentSchedule: getPaymentSchedulePayload(),
    invoiceKyc: getInvoiceKycPayload()
  });

  const verb = editing ? "updated" : "saved";
  editing = savedEvent;
  saveEventButton.textContent = "Update Event";
  setSaveStatus(`${savedEvent.externalId} ${verb}. See it in Saved Events, Pre Cost Planning and Petty Cash.`);
}

function updateBilling() {
  const pax = Math.floor(readNumber(paxInput));
  const total = getCurrentTotal();
  const advance = total * billingDefaults.advanceRate;

  syncAdvanceRow(advance, getAdvanceDueInputValue());

  const scheduled = getScheduledTotal();
  const billingTotals = getBillingTotals();

  syncOnlineMethodFields();
  renderInvoice();

  totalBilling.value = moneyFormatter.format(total);
  summaryPax.textContent = pax.toLocaleString("en-IN");
  summaryCost.textContent = moneyFormatter.format(readNumber(costInput));
  minimumAdvance.textContent = moneyFormatter.format(advance);
  advanceDueDate.textContent = getAdvanceDueDate();
  scheduledTotal.textContent = moneyFormatter.format(scheduled);
  cashScheduled.textContent = moneyFormatter.format(billingTotals.cash);
  onlineScheduled.textContent = moneyFormatter.format(billingTotals.online);
  onlineGst.textContent = moneyFormatter.format(billingTotals.online * billingDefaults.gstRate);
  balancePending.textContent = moneyFormatter.format(total - scheduled);
  balancePending.classList.toggle("overpaid", total - scheduled < 0);

  renderPrecautions();
}

[eventDateInput, paxInput, costInput, eventDaysInput].forEach((input) => {
  input.addEventListener("input", () => { resetAdvanceAuto(); updateBilling(); });
});
[hourSel, minSel, ampmSel, foodTypeInput, allergicCountInput, allergicNotesInput, locationZoneInput].forEach((el) => {
  el.addEventListener("input", updateBilling);
  el.addEventListener("change", updateBilling);
});
addPaymentButton.addEventListener("click", addCustomPaymentCycle);
saveEventButton.addEventListener("click", saveCurrentEvent);
newEventButton.addEventListener("click", clearForm);
salesForm.addEventListener("submit", (e) => e.preventDefault());
Object.values(invoiceKycInputs).forEach((input) => input.addEventListener("input", updateBilling));

function init() {
  ODC.attachDateMask(entryDateInput);
  ODC.attachDateMask(eventDateInput);
  populateTimeOptions();
  updateBilling();
  const editId = new URLSearchParams(location.search).get("edit");
  if (editId) loadEventIntoForm(editId);
}

ODC.ready.then(init);

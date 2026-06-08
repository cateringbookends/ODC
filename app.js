const entryDateInput = document.querySelector("#entryDate");
const eventDateInput = document.querySelector("#eventDate");
const eventNameInput = document.querySelector("#eventName");
const locationInput = document.querySelector("#location");
const eventTimeWrap = document.querySelector("#eventTime");
const eventTimeTrigger = document.querySelector("#eventTimeTrigger");
const eventTimeDisplay = document.querySelector("#eventTimeDisplay");
const eventTimePopover = document.querySelector("#eventTimePopover");
const eventTimeHourList = document.querySelector("#eventTimeHourList");
const eventTimeMinuteList = document.querySelector("#eventTimeMinuteList");
const eventTimeAmPmList = document.querySelector("#eventTimeAmPmList");
const paxInput = document.querySelector("#pax");
const costInput = document.querySelector("#costPerPax");
const eventDaysInput = document.querySelector("#eventDays");
const totalBilling = document.querySelector("#totalBilling");
const summaryPax = document.querySelector("#summaryPax");
const summaryCost = document.querySelector("#summaryCost");
const baseBilling = document.querySelector("#baseBilling");
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

// Catering precaution fields
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
function setDmyDate(input, dmy) {
  input.value = dmy || "";
  ODC.syncDmyDatePicker(input);
}

function getCityValue() {
  return "";
}

function syncCityField() {
}

function getAdvanceDueDate() {
  const iso = entryIso();
  if (!iso) return "Select entry date";
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 7);
  return formatDate(d);
}

function getAdvanceDueInputValue() {
  const iso = entryIso();
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// --- 12-hour time control ---
function getTime12() {
  const hour = eventTimeWrap.dataset.hour || "";
  const minute = eventTimeWrap.dataset.minute || "";
  const ampm = eventTimeWrap.dataset.ampm || "";
  if (!hour || !minute || !ampm) return "";
  return `${hour}:${minute} ${ampm}`;
}

function setTime12(str) {
  const parsed = parseEventTime(str);
  eventTimeWrap.dataset.hour = parsed.hour;
  eventTimeWrap.dataset.minute = parsed.minute;
  eventTimeWrap.dataset.ampm = parsed.ampm;
  updateTimeSelection();
  syncEventTime();
}

function parseEventTime(value) {
  const raw = String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  if (!raw) return { hour: "", minute: "", ampm: "" };

  const twelveHour = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/);
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2] || "0");
    const suffix = twelveHour[3];
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return { hour: "", minute: "", ampm: "" };
    return {
      hour: String(hour).padStart(2, "0"),
      minute: String(minute).padStart(2, "0"),
      ampm: suffix,
    };
  }

  const twentyFourHour = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHour) {
    let hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return { hour: "", minute: "", ampm: "" };
    const suffix = hour >= 12 ? "PM" : "AM";
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return {
      hour: String(hour).padStart(2, "0"),
      minute: String(minute).padStart(2, "0"),
      ampm: suffix,
    };
  }

  return { hour: "", minute: "", ampm: "" };
}

function syncEventTime() {
  const value = getTime12();
  eventTimeDisplay.textContent = value || "--:-- --";
  eventTimeTrigger.classList.toggle("is-empty", !value);
  eventTimeWrap.dataset.hasValue = value ? "true" : "false";
  updateBilling();
}

function setTimePopover(open) {
  eventTimePopover.hidden = !open;
  eventTimeTrigger.setAttribute("aria-expanded", open ? "true" : "false");
}

function buildTimeColumn(container, values, selectedValue) {
  container.innerHTML = "";
  values.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "time-option";
    button.textContent = value;
    button.dataset.value = value;
    button.setAttribute("aria-pressed", String(value === selectedValue));
    if (value === selectedValue) button.classList.add("is-selected");
    container.appendChild(button);
  });
}

function buildTimePicker() {
  buildTimeColumn(eventTimeHourList, ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"], eventTimeWrap.dataset.hour || "");
  buildTimeColumn(eventTimeMinuteList, Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")), eventTimeWrap.dataset.minute || "");
  buildTimeColumn(eventTimeAmPmList, ["AM", "PM"], eventTimeWrap.dataset.ampm || "");
}

function updateTimeSelection() {
  const selected = {
    hour: eventTimeWrap.dataset.hour || "",
    minute: eventTimeWrap.dataset.minute || "",
    ampm: eventTimeWrap.dataset.ampm || "",
  };
  [
    [eventTimeHourList, selected.hour],
    [eventTimeMinuteList, selected.minute],
    [eventTimeAmPmList, selected.ampm],
  ].forEach(([container, current]) => {
    container.querySelectorAll(".time-option").forEach((button) => {
      const isSelected = button.dataset.value === current;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    });
  });
  syncEventTime();
}

function getPaymentRows() {
  return [...paymentRows.querySelectorAll(".payment-row")];
}

function createPaymentRow({ label, amount, dueDate, isAdvance = false, billing = "cash", method = "UPI", touched = false }) {
  const row = document.createElement("div");
  row.className = "payment-row";
  row.dataset.advance = String(isAdvance);
  row.dataset.touched = String(touched);
  row.dataset.dateTouched = "false";

  row.innerHTML = `
    <label class="cycle-name-field"><span>Cycle Name</span><input type="text" class="cycle-name"></label>
    <label class="cycle-date-field"><span>Due Date</span><input type="text" class="cycle-date date-dmy" placeholder="DD-MM-YYYY" autocomplete="off"></label>
    <label class="cycle-amount-field"><span>Amount</span><input type="number" class="cycle-amount" min="0" step="0.01"></label>
    <label class="cycle-billing-field"><span>Billing</span>
      <select class="cycle-billing"><option value="cash">Cash</option><option value="online">Online</option></select>
    </label>
    <label class="online-method-field" hidden><span>Online Method</span>
      <select class="online-method"><option value="UPI">UPI</option><option value="Card">Card</option><option value="Cheque">Cheque</option><option value="Bank Transfer">Bank Transfer</option></select>
    </label>
    <button type="button" class="remove-payment" aria-label="Remove payment cycle">Remove</button>
  `;

  row.querySelector(".cycle-name").value = label;
  row.querySelector(".cycle-date").value = ODC.isoToDmy(dueDate);
  row.querySelector(".cycle-amount").value = Number(amount || 0).toFixed(2);
  row.querySelector(".cycle-billing").value = billing;
  row.querySelector(".online-method").value = method;
  ODC.attachDateMask(row.querySelector(".cycle-date"));
  ODC.syncDmyDatePicker(row.querySelector(".cycle-date"));

  row.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", updateBilling);
    input.addEventListener("change", updateBilling);
  });
  row.querySelector(".cycle-amount").addEventListener("input", () => { row.dataset.touched = "true"; });
  row.querySelector(".cycle-date").addEventListener("input", () => { row.dataset.dateTouched = "true"; }, { capture: true });
  row.querySelector(".cycle-date").addEventListener("change", () => { row.dataset.dateTouched = "true"; }, { capture: true });
  row.querySelector(".remove-payment").addEventListener("click", () => { row.remove(); updateBilling(); });
  if (isAdvance) row.querySelector(".remove-payment").hidden = true;
  row.classList.toggle("has-remove", !isAdvance);
  row.classList.toggle("is-online", row.querySelector(".cycle-billing").value === "online");
  row.querySelector(".cycle-billing").addEventListener("change", (e) => {
    row.querySelector(".online-method-field").hidden = e.target.value !== "online";
    row.classList.toggle("is-online", e.target.value === "online");
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
  const advanceDateInput = advanceRow.querySelector(".cycle-date");
  if (advanceRow.dataset.dateTouched !== "true" && document.activeElement !== advanceDateInput) {
    setDmyDate(advanceDateInput, ODC.isoToDmy(dueDate));
  }
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
  const invoiceTotalAmount = onlineRows.reduce((sum, row) => sum + readNumber(row.querySelector(".cycle-amount")), 0);
  const taxableSubtotal = invoiceTotalAmount / (1 + billingDefaults.gstRate);
  const gst = invoiceTotalAmount - taxableSubtotal;

  invoicePanel.hidden = onlineRows.length === 0;
  salesShell.classList.toggle("has-online", onlineRows.length > 0);
  invoiceLines.innerHTML = "";

  onlineRows.forEach((row) => {
    const name = row.querySelector(".cycle-name").value || "Online Payment";
    const method = row.querySelector(".online-method").value;
    const dateValue = ODC.dmyToIso(row.querySelector(".cycle-date").value);
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

  invoiceSubtotal.textContent = moneyFormatter.format(taxableSubtotal);
  invoiceGstAmount.textContent = moneyFormatter.format(gst);
  invoiceTotal.textContent = moneyFormatter.format(invoiceTotalAmount);
}

function addCustomPaymentCycle() {
  const total = getCurrentTotal();
  const balance = Math.max(total + (total * billingDefaults.gstRate) - getScheduledTotal(), 0);
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
    dueDate: ODC.dmyToIso(row.querySelector(".cycle-date").value),
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

  setDmyDate(entryDateInput, ODC.isoToDmy(event.entryDate));
  setDmyDate(eventDateInput, ODC.isoToDmy(event.date));
  setTime12(event.time);
  setTimePopover(false);
  eventNameInput.value = event.name || "";
  locationInput.value = event.location || "";
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
  setTimePopover(false);
  setDmyDate(entryDateInput, "");
  setDmyDate(eventDateInput, "");
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
    locationZone: getCityValue(),
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
  const baseTotal = getCurrentTotal();
  const gstAmount = baseTotal * billingDefaults.gstRate;
  const total = baseTotal + gstAmount;
  const advance = total * billingDefaults.advanceRate;

  syncAdvanceRow(advance, getAdvanceDueInputValue());

  const scheduled = getScheduledTotal();
  const billingTotals = getBillingTotals();

  syncOnlineMethodFields();
  renderInvoice();

  totalBilling.value = moneyFormatter.format(total);
  summaryPax.textContent = pax.toLocaleString("en-IN");
  summaryCost.textContent = moneyFormatter.format(readNumber(costInput));
  baseBilling.textContent = moneyFormatter.format(baseTotal);
  minimumAdvance.textContent = moneyFormatter.format(advance);
  advanceDueDate.textContent = getAdvanceDueDate();
  scheduledTotal.textContent = moneyFormatter.format(scheduled);
  cashScheduled.textContent = moneyFormatter.format(billingTotals.cash);
  onlineScheduled.textContent = moneyFormatter.format(billingTotals.online);
  onlineGst.textContent = moneyFormatter.format(gstAmount);
  balancePending.textContent = moneyFormatter.format(total - scheduled);
  balancePending.classList.toggle("overpaid", total - scheduled < 0);

  renderPrecautions();
}

[entryDateInput, eventDateInput, paxInput, costInput, eventDaysInput].forEach((input) => {
  input.addEventListener("input", () => { resetAdvanceAuto(); updateBilling(); });
});
[
  eventTimeHourList,
  eventTimeMinuteList,
  eventTimeAmPmList,
].forEach((container) => {
  container.addEventListener("click", (e) => {
    const button = e.target.closest(".time-option");
    if (!button) return;
    const value = button.dataset.value;
    if (container === eventTimeHourList) eventTimeWrap.dataset.hour = value;
    if (container === eventTimeMinuteList) eventTimeWrap.dataset.minute = value;
    if (container === eventTimeAmPmList) eventTimeWrap.dataset.ampm = value;
    updateTimeSelection();
  });
});

eventTimeTrigger.addEventListener("click", () => {
  setTimePopover(eventTimePopover.hidden);
});

document.addEventListener("click", (e) => {
  if (!eventTimeWrap.contains(e.target)) setTimePopover(false);
});

eventTimePopover.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    setTimePopover(false);
    eventTimeTrigger.focus();
  }
});

[foodTypeInput, allergicCountInput, allergicNotesInput].forEach((el) => {
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
  buildTimePicker();
  syncCityField();
  updateBilling();
  const editId = new URLSearchParams(location.search).get("edit");
  if (editId) loadEventIntoForm(editId);
}

ODC.ready.then(init);

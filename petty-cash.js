const trigger = document.querySelector("#eventPickerTrigger");
const menu = document.querySelector("#eventPickerMenu");
const search = document.querySelector("#eventSearch");
const list = document.querySelector("#eventPickerList");
const selectedEventId = document.querySelector("#selectedEventId");
const prepDate = document.querySelector("#prepDate");
const eventDateText = document.querySelector("#eventDateText");
const eventBillingText = document.querySelector("#eventBillingText");
const payoutRows = document.querySelector("#payoutRows");
const pettyCashRows = document.querySelector("#pettyCashRows");
const addPayoutButton = document.querySelector("#addPayout");
const addPettyCashButton = document.querySelector("#addPettyCash");
const totalCashRequired = document.querySelector("#totalCashRequired");
const assignedTotal = document.querySelector("#assignedTotal");
const pettyTotal = document.querySelector("#pettyTotal");
const summaryBilling = document.querySelector("#summaryBilling");
const billingAfterRelease = document.querySelector("#billingAfterRelease");
const pettyCashForm = document.querySelector("#pettyCashForm");

let selectedEvent = null;
let masterHeads = getMasterPersons();
let saveStatusEl = null;

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

function formatDate(dateValue) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${dateValue}T00:00:00`));
}

function getOneDayBefore(dateValue) {
  if (!dateValue) return "";
  const eventDate = new Date(`${dateValue}T00:00:00`);
  eventDate.setDate(eventDate.getDate() - 1);
  const year = eventDate.getFullYear();
  const month = String(eventDate.getMonth() + 1).padStart(2, "0");
  const day = String(eventDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderEvents(query = "") {
  const normalizedQuery = query.trim().toLowerCase();
  const results = getAllEvents().filter((event) => {
    const searchable = `${event.name} ${event.location} ${event.date}`.toLowerCase();
    return searchable.includes(normalizedQuery);
  });

  list.innerHTML = "";

  if (results.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-events";
    empty.style.cssText = "padding:10px;text-align:center;color:var(--muted);font-size:0.85rem;";
    empty.textContent = "No events found";
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
    meta.textContent = `${formatDate(event.date)} | ${event.location} | ${event.pax.toLocaleString("en-IN")} PAX`;
    option.append(name, meta);

    option.addEventListener("click", () => {
      selectedEvent = event;
      selectedEventId.value = event.id;
      trigger.textContent = event.name;
      prepDate.value = getOneDayBefore(event.date);
      updateEventContext();
      loadPettyCash(event.id);
      closeMenu();
    });

    list.append(option);
  });
}

function createCashRow(container, type, values = {}) {
  const row = document.createElement("div");
  row.className = "cash-row";

  if (type === "payout") {
    row.classList.add("payout-row");
    row.innerHTML = `
      <label><span>Head</span><select class="cash-head"></select></label>
      <label><span>Person</span><select class="cash-name"></select></label>
      <label><span>Purpose</span><input type="text" class="cash-purpose" placeholder="Vendor balance, staff advance"></label>
      <label><span>Amount</span><input type="number" class="cash-amount" min="0" step="0.01" placeholder="0.00"></label>
      <button type="button" class="remove-payment" aria-label="Remove row">Remove</button>
    `;
    populatePayoutSelectors(row, values);
    row.querySelector(".cash-purpose").value = values.purpose || "";
    if (values.amount) row.querySelector(".cash-amount").value = values.amount;
  } else {
    row.innerHTML = `
      <label><span>Expense</span><input type="text" class="cash-name" placeholder="Local purchase"></label>
      <label><span>Purpose</span><input type="text" class="cash-purpose" placeholder="Transport, ice, loading"></label>
      <label><span>Amount</span><input type="number" class="cash-amount" min="0" step="0.01" placeholder="0.00"></label>
      <button type="button" class="remove-payment" aria-label="Remove row">Remove</button>
    `;
    row.querySelector(".cash-name").value = values.expense || "";
    row.querySelector(".cash-purpose").value = values.purpose || "";
    if (values.amount) row.querySelector(".cash-amount").value = values.amount;
  }

  row.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", updateTotals);
    input.addEventListener("change", updateTotals);
  });
  row.querySelector(".remove-payment").addEventListener("click", () => {
    row.remove();
    updateTotals();
  });

  container.append(row);
  return row;
}

function populatePayoutSelectors(row, values = {}) {
  const headSelect = row.querySelector(".cash-head");
  const personSelect = row.querySelector(".cash-name");

  headSelect.innerHTML = "";
  masterHeads.forEach((head) => {
    const opt = document.createElement("option");
    opt.value = head.id;
    opt.textContent = head.name; // textContent => safe against HTML injection
    headSelect.append(opt);
  });

  function syncPersons(preferredPerson) {
    const head = masterHeads.find((item) => item.id === headSelect.value) || masterHeads[0];
    const persons = head?.persons || [];
    personSelect.innerHTML = "";
    persons.forEach((person) => {
      const opt = document.createElement("option");
      opt.value = person;
      opt.textContent = person;
      personSelect.append(opt);
    });
    if (preferredPerson) personSelect.value = preferredPerson;
  }

  headSelect.addEventListener("change", () => syncPersons());
  if (values.headId) headSelect.value = values.headId;
  syncPersons(values.person);
}

function getRowTotal(container) {
  return [...container.querySelectorAll(".cash-amount")].reduce((sum, input) => sum + readNumber(input), 0);
}

function updateEventContext() {
  const totalBilling = selectedEvent?.totalBilling || 0;
  eventDateText.textContent = selectedEvent ? formatDate(selectedEvent.date) : "Select event";
  eventBillingText.textContent = moneyFormatter.format(totalBilling);
  summaryBilling.textContent = moneyFormatter.format(totalBilling);
}

function updateTotals() {
  const assigned = getRowTotal(payoutRows);
  const petty = getRowTotal(pettyCashRows);
  const required = assigned + petty;
  const billing = selectedEvent?.totalBilling || 0;
  const remaining = billing - required;

  assignedTotal.textContent = moneyFormatter.format(assigned);
  pettyTotal.textContent = moneyFormatter.format(petty);
  totalCashRequired.value = moneyFormatter.format(required);
  billingAfterRelease.textContent = moneyFormatter.format(remaining);
  billingAfterRelease.classList.toggle("overpaid", remaining < 0);
}

function collectPettyCash() {
  const payouts = [...payoutRows.querySelectorAll(".cash-row")].map((row) => ({
    headId: row.querySelector(".cash-head").value,
    person: row.querySelector(".cash-name").value,
    purpose: row.querySelector(".cash-purpose").value.trim(),
    amount: readNumber(row.querySelector(".cash-amount"))
  }));
  const petty = [...pettyCashRows.querySelectorAll(".cash-row")].map((row) => ({
    expense: row.querySelector(".cash-name").value.trim(),
    purpose: row.querySelector(".cash-purpose").value.trim(),
    amount: readNumber(row.querySelector(".cash-amount"))
  }));
  return { payouts, petty };
}

async function loadPettyCash(eventId) {
  let data = { payouts: [], petty: [] };
  try { data = (await getPettyCash(eventId)) || data; } catch { /* offline */ }

  payoutRows.innerHTML = "";
  pettyCashRows.innerHTML = "";

  if (data.payouts.length) data.payouts.forEach((p) => createCashRow(payoutRows, "payout", p));
  else createCashRow(payoutRows, "payout");

  if (data.petty.length) data.petty.forEach((p) => createCashRow(pettyCashRows, "petty", p));
  else createCashRow(pettyCashRows, "petty");

  updateTotals();
}

function savePettyCashNow() {
  if (!selectedEvent) { setStatus("Select an event before saving.", true); return; }
  const data = collectPettyCash();
  savePettyCash(selectedEvent.id, data)
    .then(() => setStatus(`Saved petty cash for ${selectedEvent.externalId || selectedEvent.name}.`))
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
  saveBtn.textContent = "Save Petty Cash";
  saveBtn.addEventListener("click", savePettyCashNow);
  saveStatusEl = document.createElement("p");
  saveStatusEl.className = "form-status";
  saveStatusEl.setAttribute("aria-live", "polite");
  bar.append(saveBtn, saveStatusEl);
  pettyCashForm.append(bar);
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
addPayoutButton.addEventListener("click", () => createCashRow(payoutRows, "payout"));
addPettyCashButton.addEventListener("click", () => createCashRow(pettyCashRows, "petty"));
if (pettyCashForm) pettyCashForm.addEventListener("submit", (e) => e.preventDefault());

document.addEventListener("click", (event) => { if (!event.target.closest(".event-picker")) closeMenu(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu({ restoreFocus: true }); });

function init() {
  masterHeads = getMasterPersons();
  ensureSaveBar();
  createCashRow(payoutRows, "payout");
  createCashRow(pettyCashRows, "petty");
  renderEvents();
  updateEventContext();
  updateTotals();
}

ODC.ready.then(init);
ODC.registerSync(() => {
  masterHeads = getMasterPersons();
  renderEvents(search.value || "");
});

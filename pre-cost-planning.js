const trigger = document.querySelector("#eventPickerTrigger");
const menu = document.querySelector("#eventPickerMenu");
const search = document.querySelector("#eventSearch");
const list = document.querySelector("#eventPickerList");
const selectedEventId = document.querySelector("#selectedEventId");
const planningPax = document.querySelector("#planningPax");
const planningDays = document.querySelector("#planningDays");
const foodCostPerPax = document.querySelector("#foodCostPerPax");
const totalFoodCost = document.querySelector("#totalFoodCost");
const staffCount = document.querySelector("#staffCount");
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
let saveStatusEl = null;

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
    meta.textContent = `${formatEventDate(event.date)} | ${event.location} | ${event.pax.toLocaleString("en-IN")} PAX`;
    option.append(name, meta);

    option.addEventListener("click", () => {
      selectedEvent = event;
      selectedEventId.value = event.id;
      trigger.textContent = event.name;
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
  planningPax.textContent = pax.toLocaleString("en-IN");
  planningDays.textContent = days.toLocaleString("en-IN");
}

function updateCostTotals() {
  const pax = selectedEvent?.pax || 0;
  const days = selectedEvent?.days || 0;
  const totalBilling = selectedEvent?.totalBilling || 0;
  const foodTotal = pax * readNumber(foodCostPerPax);

  // Staff cost is driven by Staff No. * per-day rate * days, unless manually overridden.
  if (!staffCostTouched && document.activeElement !== totalStaffCostInput) {
    const computed = readNumber(staffCount) * (DEFAULTS.staffCostPerDay || 0) * (days || 1);
    if (computed > 0) totalStaffCostInput.value = computed.toFixed(2);
  }
  const staffTotal = readNumber(totalStaffCostInput);

  if (!decorChargeTouched && document.activeElement !== decorCharge) {
    decorCharge.value = (totalBilling * (DEFAULTS.decorRate ?? 0.05)).toFixed(2);
  }

  const totalCost =
    foodTotal +
    staffTotal +
    readNumber(equipmentDepreciation) +
    readNumber(thirdPartyVendor) +
    readNumber(decorCharge) +
    readNumber(miscellaneousCost);
  const profitLossAmount = totalBilling - totalCost;

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
    totalCost: (selectedEvent?.totalBilling || 0) - Number.parseFloat(profitLoss.value.replace(/[^0-9.-]/g, "")) || 0,
    profitLoss: Number.parseFloat(profitLoss.value.replace(/[^0-9.-]/g, "")) || 0
  };
}

async function loadPreCost(eventId) {
  let data = null;
  try { data = await getPreCost(eventId); } catch { /* offline */ }

  decorChargeTouched = false;
  staffCostTouched = false;

  const set = (input, value) => { input.value = value ? String(value) : ""; };
  if (data) {
    set(foodCostPerPax, data.foodCostPerPax);
    set(staffCount, data.staffCount);
    set(totalStaffCostInput, data.totalStaffCost);
    set(equipmentDepreciation, data.equipmentDepreciation);
    set(thirdPartyVendor, data.thirdPartyVendor);
    set(miscellaneousCost, data.miscellaneousCost);
    if (Number(data.totalStaffCost) > 0) staffCostTouched = true;
    if (Number(data.decorCharge) > 0) { decorCharge.value = String(data.decorCharge); decorChargeTouched = true; }
  } else {
    [foodCostPerPax, staffCount, totalStaffCostInput, equipmentDepreciation, thirdPartyVendor, miscellaneousCost].forEach((i) => { i.value = ""; });
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
  planningForm.append(bar);
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
equipmentDepreciation.addEventListener("input", updateCostTotals);
thirdPartyVendor.addEventListener("input", updateCostTotals);
decorCharge.addEventListener("input", () => { decorChargeTouched = true; updateCostTotals(); });
miscellaneousCost.addEventListener("input", updateCostTotals);
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

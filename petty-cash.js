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
      trigger.setAttribute("aria-label", event.name);
      prepDate.value = ODC.isoToDmy(getOneDayBefore(event.date));
      ODC.syncDmyDatePicker(prepDate);
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
      <label class="cash-picker-field"><span>Head</span><select class="cash-head native-picker"></select><div class="smart-select" data-picker="head"></div></label>
      <label class="cash-picker-field"><span>Person</span><select class="cash-name native-picker"></select><div class="smart-select" data-picker="person"></div></label>
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
  const headPicker = row.querySelector('[data-picker="head"]');
  const personPicker = row.querySelector('[data-picker="person"]');

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function personName(person) {
    return typeof person === "string" ? person : String(person?.name || "");
  }

  function personLabel(person) {
    if (typeof person === "string") return person;
    const name = String(person?.name || "");
    const code = String(person?.code || "");
    return code ? `${name} (${code})` : name;
  }

  function personSearchText(person) {
    if (typeof person === "string") return person;
    return [
      person.name,
      person.code,
      person.designation,
      person.department,
      person.location
    ].filter(Boolean).join(" ");
  }

  function optionMatches(text, query) {
    return normalizeText(text).includes(normalizeText(query));
  }

  function selectedHead() {
    return masterHeads.find((item) => item.id === headSelect.value) || masterHeads[0];
  }

  function buildHiddenHeadOptions(preferredHeadId = headSelect.value) {
    headSelect.innerHTML = "";
    masterHeads.forEach((head) => {
      const opt = document.createElement("option");
      opt.value = head.id;
      opt.textContent = head.name;
      headSelect.append(opt);
    });
    if (preferredHeadId && masterHeads.some((head) => head.id === preferredHeadId)) headSelect.value = preferredHeadId;
  }

  function buildHiddenPersonOptions(preferredPerson = personSelect.value) {
    const head = selectedHead();
    const persons = head?.persons || [];
    personSelect.innerHTML = "";
    persons.forEach((person) => {
      const name = personName(person);
      if (!name) return;
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = personLabel(person);
      personSelect.append(opt);
    });
    if (preferredPerson && persons.some((person) => personName(person) === preferredPerson)) {
      personSelect.value = preferredPerson;
    }
  }

  function initSmartSelect(root, config) {
    root.innerHTML = `
      <button type="button" class="smart-select-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span></span>
      </button>
      <div class="smart-select-menu" hidden>
        <input type="search" class="smart-select-search" placeholder="${config.placeholder}">
        <div class="smart-select-list" role="listbox"></div>
      </div>
    `;

    const trigger = root.querySelector(".smart-select-trigger");
    const triggerText = trigger.querySelector("span");
    const menuEl = root.querySelector(".smart-select-menu");
    const searchEl = root.querySelector(".smart-select-search");
    const listEl = root.querySelector(".smart-select-list");

    function close() {
      menuEl.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }

    function open() {
      document.querySelectorAll(".smart-select-menu:not([hidden])").forEach((openMenu) => {
        if (openMenu !== menuEl) {
          openMenu.hidden = true;
          openMenu.previousElementSibling?.setAttribute("aria-expanded", "false");
        }
      });
      menuEl.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      searchEl.value = "";
      renderOptions();
      searchEl.focus();
    }

    function selectItem(item) {
      config.onSelect(item);
      close();
      renderLabel();
      config.afterSelect?.();
    }

    function renderLabel() {
      triggerText.textContent = config.label() || config.emptyLabel;
    }

    function renderOptions() {
      const query = searchEl.value;
      const items = config.items().filter((item) => optionMatches(config.searchText(item), query));
      listEl.innerHTML = "";

      if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "smart-select-empty";
        empty.textContent = "No match found";
        listEl.append(empty);
        return;
      }

      items.forEach((item) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "smart-select-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", config.isSelected(item) ? "true" : "false");
        option.innerHTML = config.optionHtml(item);
        option.addEventListener("click", () => selectItem(item));
        listEl.append(option);
      });
    }

    trigger.addEventListener("click", () => {
      if (menuEl.hidden) open();
      else close();
    });
    searchEl.addEventListener("input", renderOptions);
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
        trigger.focus();
      }
    });

    return { renderLabel, renderOptions, close };
  }

  buildHiddenHeadOptions(values.headId);
  buildHiddenPersonOptions(values.person);

  let personSmartSelect;
  const headSmartSelect = initSmartSelect(headPicker, {
    placeholder: "Search head",
    emptyLabel: "Select head",
    items: () => masterHeads,
    label: () => selectedHead()?.name || "",
    searchText: (head) => head.name,
    isSelected: (head) => head.id === headSelect.value,
    optionHtml: (head) => `<strong>${head.name}</strong><small>${(head.persons || []).length} people</small>`,
    onSelect: (head) => {
      headSelect.value = head.id;
      buildHiddenPersonOptions();
    },
    afterSelect: () => {
      personSmartSelect.renderLabel();
      personSmartSelect.renderOptions();
    }
  });

  personSmartSelect = initSmartSelect(personPicker, {
    placeholder: "Search name, code or role",
    emptyLabel: "Select person",
    items: () => selectedHead()?.persons || [],
    label: () => personSelect.selectedOptions[0]?.textContent || "",
    searchText: personSearchText,
    isSelected: (person) => personName(person) === personSelect.value,
    optionHtml: (person) => {
      const name = personName(person);
      const code = typeof person === "string" ? "" : String(person?.code || "");
      const role = typeof person === "string" ? "" : String(person?.designation || "");
      return `<strong>${code ? `${name} (${code})` : name}</strong>${role ? `<small>${role}</small>` : ""}`;
    },
    onSelect: (person) => { personSelect.value = personName(person); }
  });

  headSmartSelect.renderLabel();
  personSmartSelect.renderLabel();
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

document.addEventListener("click", (event) => {
  if (!event.target.closest(".event-picker")) closeMenu();
  if (!event.target.closest(".smart-select")) {
    document.querySelectorAll(".smart-select-menu:not([hidden])").forEach((openMenu) => {
      openMenu.hidden = true;
      openMenu.previousElementSibling?.setAttribute("aria-expanded", "false");
    });
  }
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu({ restoreFocus: true }); });

function init() {
  document.querySelectorAll(".date-dmy").forEach((el) => ODC.attachDateMask(el));
  masterHeads = getMasterPersons();
  ensureSaveBar();
  createCashRow(payoutRows, "payout");
  createCashRow(pettyCashRows, "petty");
  renderEvents();
  updateEventContext();
  updateTotals();

  // Deep-link: ?event=EVT-xxx pre-selects the event
  const preId = new URLSearchParams(location.search).get("event");
  if (preId) {
    const ev = getAllEvents().find((e) => String(e.id) === String(preId));
    if (ev) {
      selectedEvent = ev;
      selectedEventId.value = ev.id;
      trigger.textContent = ev.name;
      trigger.setAttribute("aria-label", ev.name);
      prepDate.value = ODC.isoToDmy(getOneDayBefore(ev.date));
      ODC.syncDmyDatePicker(prepDate);
      updateEventContext();
      loadPettyCash(ev.id);
    }
  }
}

ODC.ready.then(init);
ODC.registerSync(() => {
  masterHeads = getMasterPersons();
  renderEvents(search.value || "");
});

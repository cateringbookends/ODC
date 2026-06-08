const savedEventsList = document.querySelector("#savedEventsList");
const savedSearch = document.querySelector("#savedSearch");
const exportButton = document.querySelector("#exportCsv");
const newEventLink = document.querySelector("#newEventLink");

const moneyFormatter = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const STATUSES = ["open", "planning", "completed", "cancelled"];

let query = "";
let filterStatus = "";
let filterDateMode = "all"; // "all" | "week" | "month" | "custom"
let filterFrom = "";
let filterTo = "";

function todayIso() { return new Date().toISOString().slice(0, 10); }
function thisWeekStart() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}
function thisMonthStart() { return new Date().toISOString().slice(0, 8) + "01"; }
function thisMonthEnd() {
  const d = new Date(); d.setMonth(d.getMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

function isOverdue(event) {
  if (event.status === "completed" || event.status === "cancelled") return false;
  const today = todayIso();
  return (event.paymentSchedule || []).some(c => c.dueDate && c.dueDate < today);
}

function eventsMatching() {
  const q = query.trim().toLowerCase();
  let from = filterFrom, to = filterTo;
  if (filterDateMode === "week") { from = thisWeekStart(); to = todayIso(); }
  else if (filterDateMode === "month") { from = thisMonthStart(); to = thisMonthEnd(); }

  return getSavedEvents()
    .filter(e => {
      if (q && !`${e.name} ${e.location} ${e.externalId}`.toLowerCase().includes(q)) return false;
      if (filterStatus && (e.status || "open") !== filterStatus) return false;
      if (from && e.date && e.date < from) return false;
      if (to && e.date && e.date > to) return false;
      return true;
    })
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function buildFilters() {
  const existing = document.getElementById("savedFilters");
  if (existing) return;

  const container = document.createElement("div");
  container.id = "savedFilters";
  container.style.cssText = "display:flex;flex-direction:column;gap:10px;margin-bottom:10px";

  // Single row: status pills + date pills
  const row2 = document.createElement("div");
  row2.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center";

  // Status: inline label + dropdown
  const statusLabel = document.createElement("span");
  statusLabel.style.cssText = "font-size:0.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;flex-shrink:0";
  statusLabel.textContent = "Status:";
  const statusSel = document.createElement("select");
  statusSel.id = "filterStatus";
  statusSel.style.cssText = "width:auto;font-size:0.81rem;padding:3px 8px;min-height:30px;flex-shrink:0";
  [["", "All"], ...STATUSES.map(s => [s, s.charAt(0).toUpperCase() + s.slice(1)])].forEach(([v, t]) => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = t;
    statusSel.append(opt);
  });
  statusSel.addEventListener("change", () => { filterStatus = statusSel.value; renderList(); });
  row2.append(statusLabel, statusSel);

  // Divider
  const divider = document.createElement("span");
  divider.style.cssText = "width:1px;height:20px;background:var(--line);flex-shrink:0;margin:0 4px";
  row2.append(divider);

  const dateLabel = document.createElement("span");
  dateLabel.style.cssText = "font-size:0.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;flex-shrink:0";
  dateLabel.textContent = "Date:";
  row2.append(dateLabel);

  [["all", "All Time"], ["week", "This Week"], ["month", "This Month"]].forEach(([mode, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary-button date-mode-btn" + (mode === "all" ? " active-filter" : "");
    btn.style.cssText = "font-size:0.75rem;padding:3px 10px";
    btn.textContent = label;
    btn.dataset.mode = mode;
    btn.addEventListener("click", () => {
      filterDateMode = mode;
      document.querySelectorAll(".date-mode-btn").forEach(b => b.classList.toggle("active-filter", b.dataset.mode === mode));
      document.getElementById("customDateRange").hidden = mode !== "custom";
      renderList();
    });
    row2.append(btn);
  });

  const customBtn = document.createElement("button");
  customBtn.type = "button";
  customBtn.className = "secondary-button date-mode-btn";
  customBtn.style.cssText = "font-size:0.75rem;padding:3px 10px";
  customBtn.textContent = "Custom";
  customBtn.dataset.mode = "custom";
  customBtn.addEventListener("click", () => {
    filterDateMode = "custom";
    document.querySelectorAll(".date-mode-btn").forEach(b => b.classList.toggle("active-filter", b.dataset.mode === "custom"));
    document.getElementById("customDateRange").hidden = false;
    renderList();
  });
  row2.append(customBtn);
  container.append(row2);

  // Custom date range (hidden by default)
  const customRange = document.createElement("div");
  customRange.id = "customDateRange";
  customRange.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end";
  customRange.hidden = true;

  ["From", "To"].forEach((lbl, i) => {
    const label = document.createElement("label");
    label.className = "field";
    label.style.flex = "1 1 140px";
    const span = document.createElement("span");
    span.textContent = "Event Date " + lbl;
    const input = document.createElement("input");
    input.type = "date";
    input.id = i === 0 ? "filterFrom" : "filterTo";
    input.addEventListener("change", () => {
      filterFrom = document.getElementById("filterFrom").value;
      filterTo = document.getElementById("filterTo").value;
      renderList();
    });
    label.append(span, input);
    customRange.append(label);
  });
  container.append(customRange);

  const savedControls = document.querySelector(".saved-controls");
  if (savedControls) {
    savedControls.insertAdjacentElement("afterend", container);
  }
}

function metaLine(event) {
  const parts = [event.externalId, ODC.eventContextText(event, { includeDays: true })];
  if (event.time) parts.push(event.time);
  parts.push(event.location);
  if (event.locationZone) parts.push(event.locationZone);
  return parts.join(" | ");
}

function renderList() {
  const events = eventsMatching();
  savedEventsList.innerHTML = "";

  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "form-status";
    empty.textContent = query || filterStatus || filterDateMode !== "all" ? "No matching events." : "No events saved yet.";
    savedEventsList.append(empty);
    return;
  }

  events.forEach((event) => {
    const item = document.createElement("article");
    item.className = "saved-event-item";

    const info = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = event.name;

    const overdueFlag = isOverdue(event);
    if (overdueFlag) {
      const badge = document.createElement("span");
      badge.className = "overdue-badge";
      badge.style.marginLeft = "8px";
      badge.textContent = "Payment overdue";
      strong.append(badge);
    }

    const span = document.createElement("span");
    span.textContent = metaLine(event);
    info.append(strong, span);

    if (Number(event.allergicCount) > 0 || event.foodType) {
      const tag = document.createElement("span");
      tag.className = "precaution-tag";
      const bits = [];
      if (event.foodType) bits.push(event.foodType === "jain" ? "Jain" : "Non-Jain");
      if (Number(event.allergicCount) > 0) bits.push(`${event.allergicCount} allergic`);
      tag.textContent = "⚠ " + bits.join(" · ");
      info.append(tag);
    }

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
    statusSelect.addEventListener("change", () => { upsertEvent({ ...event, status: statusSelect.value }); renderList(); });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "secondary-button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => { window.location.href = `index.html?edit=${encodeURIComponent(event.id)}`; });

    const dashBtn = document.createElement("button");
    dashBtn.type = "button";
    dashBtn.className = "secondary-button";
    dashBtn.textContent = "Dashboard";
    dashBtn.addEventListener("click", () => { window.location.href = `event-dashboard.html?id=${encodeURIComponent(event.id)}`; });

    const logBtn = document.createElement("button");
    logBtn.type = "button";
    logBtn.className = "secondary-button";
    logBtn.textContent = "Log";
    logBtn.title = "View full change history";
    logBtn.addEventListener("click", () => { window.location.href = `event-log.html?id=${encodeURIComponent(event.id)}`; });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "secondary-button danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`Delete ${event.externalId} — ${event.name}?`)) return;
      delBtn.disabled = true;
      try {
        await deleteEvent(event.id);
        renderList();
      } catch (err) {
        alert(`Delete failed: ${err.message}`);
      } finally {
        delBtn.disabled = false;
      }
    });

    controls.append(statusSelect, editBtn, dashBtn, logBtn, delBtn);
    item.append(info, out, controls);
    savedEventsList.append(item);
  });
}

function exportCsv() {
  const rows = getSavedEvents();
  const headers = ["externalId", "name", "date", "time", "location", "locationZone", "pax", "days", "costPerPax", "totalBilling", "status", "foodType", "allergicCount", "allergicNotes"];
  const cell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  rows.forEach((e) => lines.push(headers.map((h) => cell(h === "date" ? ODC.isoToDmy(e.date) : e[h])).join(",")));
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

savedSearch.addEventListener("input", () => { query = savedSearch.value; renderList(); });
exportButton.addEventListener("click", exportCsv);
newEventLink.addEventListener("click", () => { window.location.href = "index.html"; });

ODC.ready.then(() => { buildFilters(); renderList(); });
ODC.registerSync(renderList);

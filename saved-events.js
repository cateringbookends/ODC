const savedEventsList = document.querySelector("#savedEventsList");
const savedSearch = document.querySelector("#savedSearch");
const exportButton = document.querySelector("#exportCsv");
const newEventLink = document.querySelector("#newEventLink");

const moneyFormatter = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUSES = ["open", "planning", "completed", "cancelled"];
let query = "";

function eventsMatching() {
  const q = query.trim().toLowerCase();
  return getSavedEvents()
    .filter((e) => `${e.name} ${e.location} ${e.externalId}`.toLowerCase().includes(q))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function metaLine(event) {
  const parts = [event.externalId, ODC.isoToDmy(event.date) || "No date"];
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
    empty.textContent = query ? "No matching events." : "No events saved yet.";
    savedEventsList.append(empty);
    return;
  }

  events.forEach((event) => {
    const item = document.createElement("article");
    item.className = "saved-event-item";

    const info = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = event.name; // textContent => XSS-safe
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

    controls.append(statusSelect, editBtn, dashBtn, delBtn);
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

ODC.ready.then(renderList);
ODC.registerSync(renderList);

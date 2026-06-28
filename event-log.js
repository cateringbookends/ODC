const params = new URLSearchParams(location.search);
const eventId = params.get("id");
const logContent = document.getElementById("logContent");
const statusEl = document.getElementById("logStatus");

if (!eventId) {
  statusEl.textContent = "No event specified.";
} else {
  loadLog();
}

if (window.ODC && eventId) {
  ODC.registerSync(() => {
    if (!document.hidden) loadLog();
  });
}

let allEntries = [];
let activeSection = "all";

async function loadLog() {
  statusEl.textContent = "Loading…";
  try {
    const [headerRes, logRes] = await Promise.all([
      fetch("api/events/" + encodeURIComponent(eventId) + "/header", { credentials: "same-origin" }),
      fetch("api/events/" + encodeURIComponent(eventId) + "/log", { credentials: "same-origin" })
    ]);

    const header = headerRes.ok ? await headerRes.json() : null;
    allEntries = logRes.ok ? await logRes.json() : [];

    statusEl.hidden = true;
    render(header);
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
  }
}

function render(header) {
  logContent.innerHTML = "";

  const topRow = document.createElement("div");
  topRow.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap";

  const backBtn = document.createElement("a");
  backBtn.href = "event-dashboard.html?id=" + encodeURIComponent(eventId);
  backBtn.className = "secondary-button";
  backBtn.style.fontSize = "0.78rem";
  backBtn.textContent = "← Event Dashboard";
  topRow.append(backBtn);

  const savedBtn = document.createElement("a");
  savedBtn.href = "saved-events.html";
  savedBtn.className = "secondary-button";
  savedBtn.style.fontSize = "0.78rem";
  savedBtn.textContent = "← All Events";
  topRow.append(savedBtn);

  logContent.append(topRow);

  const panelHeader = document.createElement("div");
  panelHeader.className = "panel-header";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Audit Trail";
  panelHeader.append(eyebrow);

  const title = document.createElement("h1");
  title.style.fontSize = "1.5rem";
  title.textContent = header ? header.name : eventId;
  panelHeader.append(title);

  if (header) {
    const metaP = document.createElement("p");
    metaP.style.cssText = "font-size:0.82rem;color:var(--muted);margin-top:6px";
    metaP.textContent = [
      ODC.eventContextText(header, { includeDays: true }),
      header.location,
      header.status
    ].filter(Boolean).join(" · ");
    panelHeader.append(metaP);
  }

  logContent.append(panelHeader);

  if (allEntries.length === 0) {
    const p = document.createElement("p");
    p.className = "form-status";
    p.textContent = "No change history found for this event.";
    logContent.append(p);
    return;
  }

  // Section filter buttons
  const sections = ["all", ...new Set(allEntries.map(e => e.section).filter(Boolean))];
  const filterRow = document.createElement("div");
  filterRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin:16px 0 14px";

  sections.forEach(sec => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary-button log-filter-btn" + (sec === activeSection ? " active" : "");
    btn.style.cssText = "font-size:0.75rem;padding:3px 10px";
    btn.textContent = sec === "all" ? "All" : sec.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    btn.dataset.section = sec;
    btn.addEventListener("click", () => {
      activeSection = sec;
      document.querySelectorAll(".log-filter-btn").forEach(b => b.classList.toggle("active", b.dataset.section === sec));
      renderTable();
    });
    filterRow.append(btn);
  });

  logContent.append(filterRow);

  const tableWrap = document.createElement("div");
  tableWrap.id = "logTableWrap";
  tableWrap.className = "dash-table-wrap";
  logContent.append(tableWrap);

  renderTable();
}

function renderTable() {
  const wrap = document.getElementById("logTableWrap");
  if (!wrap) return;
  wrap.innerHTML = "";

  const entries = activeSection === "all" ? allEntries : allEntries.filter(e => e.section === activeSection);

  if (entries.length === 0) {
    const p = document.createElement("p");
    p.className = "form-status";
    p.textContent = "No entries for this section.";
    wrap.append(p);
    return;
  }

  const table = document.createElement("table");
  table.className = "dash-table";

  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  ["Time", "User", "Section", "Field", "Old Value", "New Value"].forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    hrow.append(th);
  });
  thead.append(hrow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  entries.forEach(entry => {
    const tr = document.createElement("tr");
    const ts = entry.ts ? new Date(entry.ts).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "";
    [ts, entry.username, entry.section, entry.field, entry.old_value, entry.new_value].forEach((val, i) => {
      const td = document.createElement("td");
      td.textContent = val == null ? "—" : String(val);
      if (i === 4) td.style.cssText = "color:var(--muted);font-size:0.8rem;max-width:180px;word-break:break-all";
      if (i === 5) td.style.cssText = "color:var(--accent-dark);font-size:0.8rem;max-width:180px;word-break:break-all";
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);
  wrap.append(table);
}

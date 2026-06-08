const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 });

function todayIso() { return new Date().toISOString().slice(0, 10); }
function thisMonthPrefix() { return new Date().toISOString().slice(0, 7); }
function daysFromNow(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }

function statusBadge(status) {
  const el = document.createElement("span");
  el.className = "status-badge status-" + (status || "open");
  el.textContent = status ? status.charAt(0).toUpperCase() + status.slice(1) : "Open";
  return el;
}

function renderStats(events) {
  const today = todayIso();
  const month = thisMonthPrefix();
  const active = events.filter(e => e.status === "open" || e.status === "planning");
  const thisMonth = events.filter(e => (e.date || "").startsWith(month));
  const activeBilling = active.reduce((s, e) => s + (e.totalBilling || 0), 0);

  document.getElementById("statTotal").textContent = events.length;
  document.getElementById("statActive").textContent = active.length;
  document.getElementById("statThisMonth").textContent = thisMonth.length;
  document.getElementById("statBilling").textContent = money.format(activeBilling);
}

function renderUpcoming(events) {
  const today = todayIso();
  const limit = daysFromNow(30);
  const upcoming = events
    .filter(e => e.date >= today && e.date <= limit && e.status !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date));

  document.getElementById("upcomingCount").textContent = "(" + upcoming.length + ")";
  const wrap = document.getElementById("upcomingList");
  wrap.innerHTML = "";

  if (upcoming.length === 0) {
    const p = document.createElement("p");
    p.className = "form-status";
    p.textContent = "No upcoming events in the next 30 days.";
    wrap.append(p);
    return;
  }

  const table = document.createElement("table");
  table.className = "dash-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Date", "Event", "Location", "PAX", "Cost/PAX", "Billing", "Status", ""].forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    headerRow.append(th);
  });
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  upcoming.forEach(ev => {
    const tr = document.createElement("tr");
    const cells = [
      ODC.isoToDmy(ev.date) + (ev.time ? " " + ev.time : ""),
      null,
      ev.location + (ev.locationZone ? " (" + ev.locationZone + ")" : ""),
      ev.pax,
      money.format(ev.costPerPax || 0),
      money.format(ev.totalBilling || 0),
      null,
      null
    ];
    cells.forEach((val, i) => {
      const td = document.createElement("td");
      if (i === 1) {
        const strong = document.createElement("strong");
        strong.textContent = ev.name;
        const small = document.createElement("small");
        small.style.cssText = "display:block;color:var(--muted);font-size:0.74rem;margin-top:2px";
        small.textContent = ODC.eventContextText(ev, { includeDays: true });
        td.append(strong, small);
      } else if (i === 6) {
        td.append(statusBadge(ev.status));
      } else if (i === 7) {
        const a = document.createElement("a");
        a.href = "event-dashboard.html?id=" + encodeURIComponent(ev.id);
        a.className = "secondary-button";
        a.style.fontSize = "0.75rem";
        a.style.padding = "3px 8px";
        a.textContent = "View";
        td.append(a);
      } else {
        td.textContent = val;
      }
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);
  wrap.append(table);
}

function renderOverdue(events) {
  const today = todayIso();
  const overdueItems = [];

  events.forEach(ev => {
    if (ev.status === "completed" || ev.status === "cancelled") return;
    (ev.paymentSchedule || []).forEach((cycle, idx) => {
      if (cycle.dueDate && cycle.dueDate < today) {
        const daysOver = Math.floor((Date.now() - new Date(cycle.dueDate).getTime()) / 86400000);
        overdueItems.push({ ev, cycle, idx, daysOver });
      }
    });
  });

  overdueItems.sort((a, b) => a.cycle.dueDate.localeCompare(b.cycle.dueDate));
  document.getElementById("overdueCount").textContent = "(" + overdueItems.length + ")";
  const wrap = document.getElementById("overdueList");
  wrap.innerHTML = "";

  if (overdueItems.length === 0) {
    const p = document.createElement("p");
    p.className = "form-status";
    p.textContent = "No overdue payment cycles.";
    wrap.append(p);
    return;
  }

  const table = document.createElement("table");
  table.className = "dash-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Event", "Cycle", "Due Date", "Amount", "Days Overdue", ""].forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    headerRow.append(th);
  });
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  overdueItems.forEach(({ ev, cycle, daysOver }) => {
    const tr = document.createElement("tr");
    tr.className = "overdue-row";

    const cells = [null, cycle.label || "Payment", ODC.isoToDmy(cycle.dueDate), money.format(cycle.amount || 0), null, null];
    cells.forEach((val, i) => {
      const td = document.createElement("td");
      if (i === 0) {
        const strong = document.createElement("strong");
        strong.textContent = ev.name;
        const small = document.createElement("small");
        small.style.cssText = "display:block;color:var(--muted);font-size:0.74rem;margin-top:2px";
        small.textContent = ODC.eventContextText(ev, { includeDays: true });
        td.append(strong, small);
      } else if (i === 4) {
        const badge = document.createElement("span");
        badge.className = "overdue-badge";
        badge.textContent = daysOver + "d overdue";
        td.append(badge);
      } else if (i === 5) {
        const a = document.createElement("a");
        a.href = "event-dashboard.html?id=" + encodeURIComponent(ev.id);
        a.className = "secondary-button";
        a.style.fontSize = "0.75rem";
        a.style.padding = "3px 8px";
        a.textContent = "View";
        td.append(a);
      } else {
        td.textContent = val;
      }
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);
  wrap.append(table);
}

function init() {
  if (window.ODC_USER) {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const name = window.ODC_USER.fullName || window.ODC_USER.username || "";
    document.getElementById("dashGreeting").textContent = greeting + (name ? ", " + name : "");
  }
  const now = new Date();
  const clock = document.getElementById("dashClock");
  const todayLabel = document.getElementById("dashTodayLabel");
  if (clock) clock.textContent = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (todayLabel) todayLabel.textContent = now.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short" });

  const events = getSavedEvents();
  renderStats(events);
  renderUpcoming(events);
  renderOverdue(events);
}

ODC.ready.then(init);
ODC.registerSync(init);

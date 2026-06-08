const contentEl = document.getElementById("adminContent");
const statusEl = document.getElementById("adminStatus");
let activeTab = "users";
let liveRefreshTimer = null;
let renderToken = 0;
const LIVE_REFRESH_MS = 7000;

document.getElementById("adminTabs").addEventListener("click", e => {
  const btn = e.target.closest(".admin-tab");
  if (!btn) return;
  document.querySelectorAll(".admin-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  activeTab = btn.dataset.tab;
  loadTab(activeTab);
});

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = "form-status" + (isError ? " error" : "");
  statusEl.hidden = !msg;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
}

function compactAgent(agent) {
  if (!agent) return "-";
  const browser = agent.includes("Edg/") ? "Edge" : agent.includes("Chrome/") ? "Chrome" : agent.includes("Safari/") ? "Safari" : agent.includes("Firefox/") ? "Firefox" : "Browser";
  const os = agent.includes("Windows") ? "Windows" : agent.includes("Mac OS X") ? "macOS" : agent.includes("Android") ? "Android" : agent.includes("iPhone") || agent.includes("iPad") ? "iOS" : "";
  return browser + (os ? " / " + os : "");
}

function appendLiveIndicator(parent) {
  const live = document.createElement("span");
  live.className = "admin-live-indicator";
  live.textContent = "Live";
  parent.append(live);
}

async function loadTab(tab) {
  activeTab = tab;
  stopLiveRefresh();
  await refreshTab(tab, false);
  startLiveRefresh(tab);
}

async function refreshTab(tab, silent) {
  const token = ++renderToken;
  contentEl.innerHTML = "";
  if (!silent) {
    statusEl.hidden = false;
    statusEl.className = "form-status";
    statusEl.textContent = "Loading...";
    contentEl.append(statusEl);
  }

  try {
    if (tab === "users") await renderUsers(token);
    else if (tab === "sessions") await renderSessions(token);
    else if (tab === "audit") await renderAudit(token);
    else if (tab === "system") await renderSystem(token);
  } catch (err) {
    if (token !== renderToken) return;
    setStatus("Error: " + err.message, true);
  }
}

function isCurrentRender(token) {
  return token === renderToken;
}

function startLiveRefresh(tab) {
  if (!["sessions", "audit", "system"].includes(tab)) return;
  liveRefreshTimer = window.setInterval(() => {
    if (document.hidden || activeTab !== tab) return;
    const active = document.activeElement;
    if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return;
    refreshLiveTab(tab);
  }, LIVE_REFRESH_MS);
}

async function refreshLiveTab(tab) {
  try {
    if (tab === "sessions") await patchSessions();
    else if (tab === "audit") await patchAudit();
    else if (tab === "system") return;
  } catch (err) {
    setStatus("Live refresh error: " + err.message, true);
  }
}

function stopLiveRefresh() {
  if (liveRefreshTimer) {
    window.clearInterval(liveRefreshTimer);
    liveRefreshTimer = null;
  }
}

// ── USERS ──────────────────────────────────────────────────────────────
async function renderUsers(token = renderToken) {
  const users = await api("GET", "/api/auth/users");
  if (!isCurrentRender(token) || activeTab !== "users") return;
  statusEl.hidden = true;

  const createSection = document.createElement("div");
  createSection.style.marginBottom = "24px";

  const createTitle = document.createElement("h2");
  createTitle.style.marginBottom = "12px";
  createTitle.textContent = "Create User";
  createSection.append(createTitle);

  const form = document.createElement("div");
  form.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end";

  const fields = [
    { id: "newUsername", label: "Username", type: "text", placeholder: "username" },
    { id: "newFullName", label: "Full Name", type: "text", placeholder: "Full name" },
    { id: "newPassword", label: "Password", type: "password", placeholder: "Min 4 chars" }
  ];

  fields.forEach(f => {
    const lbl = document.createElement("label");
    lbl.className = "field";
    lbl.style.flex = "1 1 160px";
    const span = document.createElement("span");
    span.textContent = f.label;
    const input = document.createElement("input");
    input.type = f.type;
    input.id = f.id;
    input.placeholder = f.placeholder;
    input.autocomplete = "off";
    lbl.append(span, input);
    form.append(lbl);
  });

  const roleLbl = document.createElement("label");
  roleLbl.className = "field";
  roleLbl.style.flex = "0 0 120px";
  const roleSpan = document.createElement("span");
  roleSpan.textContent = "Role";
  const roleSelect = document.createElement("select");
  roleSelect.id = "newRole";
  [["user", "Staff"], ["admin", "Admin"]].forEach(([v, t]) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = t;
    roleSelect.append(opt);
  });
  roleLbl.append(roleSpan, roleSelect);
  form.append(roleLbl);

  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "primary-button";
  createBtn.style.alignSelf = "flex-end";
  createBtn.textContent = "Create User";
  createBtn.addEventListener("click", async () => {
    const username = document.getElementById("newUsername").value.trim();
    const fullName = document.getElementById("newFullName").value.trim();
    const password = document.getElementById("newPassword").value;
    const role = document.getElementById("newRole").value;
    if (!username || !password) { setStatus("Username and password required.", true); return; }
    createBtn.disabled = true;
    try {
      await api("POST", "/api/auth/users", { username, fullName, password, role });
      await refreshTab("users", true);
      setStatus("User created: " + username, false);
    } catch (err) {
      setStatus("Error: " + err.message, true);
    } finally { createBtn.disabled = false; }
  });
  form.append(createBtn);
  createSection.append(form);
  contentEl.append(createSection);

  const listTitle = document.createElement("h2");
  listTitle.style.marginBottom = "12px";
  listTitle.textContent = "Users (" + users.length + ")";
  contentEl.append(listTitle);

  const table = document.createElement("table");
  table.className = "dash-table";
  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  ["Username", "Full Name", "Role", "Active", "Created", "Actions"].forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    hrow.append(th);
  });
  thead.append(hrow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  users.forEach(u => {
    const tr = document.createElement("tr");
    [u.username, u.fullName || "—", u.role, u.active === false ? "No" : "Yes", u.createdAt ? new Date(u.createdAt).toLocaleDateString("en-IN") : "—"].forEach(v => {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    });

    const actTd = document.createElement("td");
    actTd.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";

    const pwBtn = document.createElement("button");
    pwBtn.type = "button";
    pwBtn.className = "secondary-button";
    pwBtn.style.fontSize = "0.75rem";
    pwBtn.textContent = "Change PW";
    pwBtn.addEventListener("click", async () => {
      const pw = window.prompt("New password for " + u.username + " (min 4 chars):");
      if (!pw) return;
      try {
        await api("PUT", "/api/auth/users/" + encodeURIComponent(u.username) + "/password", { password: pw });
        setStatus("Password changed for " + u.username, false);
      } catch (err) { setStatus("Error: " + err.message, true); }
    });
    actTd.append(pwBtn);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "secondary-button";
    editBtn.style.fontSize = "0.75rem";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", async () => {
      const fullName = window.prompt("Full name", u.fullName || u.username);
      if (fullName === null) return;
      const role = window.prompt("Role: admin or user", u.role || "user");
      if (role === null) return;
      const active = window.confirm("Should this user be active? OK = Active, Cancel = Inactive");
      try {
        await api("PUT", "/api/auth/users/" + encodeURIComponent(u.username), {
          fullName,
          role: String(role).toLowerCase() === "admin" ? "admin" : "user",
          active
        });
        await refreshTab("users", true);
        setStatus("Updated: " + u.username, false);
      } catch (err) { setStatus("Error: " + err.message, true); }
    });
    actTd.append(editBtn);

    if (u.username !== "aiops") {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "secondary-button danger";
      delBtn.style.fontSize = "0.75rem";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", async () => {
        if (!confirm("Delete user " + u.username + "?")) return;
        delBtn.disabled = true;
        try {
          await api("DELETE", "/api/auth/users/" + encodeURIComponent(u.username));
          await refreshTab("users", true);
          setStatus("Deleted: " + u.username, false);
        } catch (err) { setStatus("Error: " + err.message, true); delBtn.disabled = false; }
      });
      actTd.append(delBtn);
    }

    tr.append(actTd);
    tbody.append(tr);
  });
  table.append(tbody);
  contentEl.append(table);
}

// ── SESSIONS ───────────────────────────────────────────────────────────
async function renderSessions(token = renderToken) {
  const sessions = await api("GET", "/api/admin/sessions");
  if (!isCurrentRender(token) || activeTab !== "sessions") return;
  statusEl.hidden = true;

  const title = document.createElement("h2");
  title.style.marginBottom = "12px";
  title.id = "sessionsTitle";
  title.textContent = "Active Sessions (" + sessions.length + ")";
  appendLiveIndicator(title);
  contentEl.append(title);

  const summary = document.createElement("div");
  summary.id = "sessionsSummary";
  summary.className = "admin-session-summary";
  contentEl.append(summary);

  if (sessions.length === 0) {
    const p = document.createElement("p");
    p.id = "sessionsEmpty";
    p.className = "form-status";
    p.textContent = "No active sessions.";
    contentEl.append(p);
  }

  const table = document.createElement("table");
  table.id = "sessionsTable";
  table.className = "dash-table";
  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  ["Username", "Role", "IP", "Device / Browser", "Logged In", "Last Seen", "Last Page", "Expires", "Action"].forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    hrow.append(th);
  });
  thead.append(hrow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  table.append(tbody);
  contentEl.append(table);
  patchSessionDom(sessions);
}

async function patchSessions() {
  const sessions = await api("GET", "/api/admin/sessions");
  patchSessionDom(sessions);
}

function patchSessionDom(sessions) {
  const title = document.getElementById("sessionsTitle");
  if (title) {
    title.childNodes[0].nodeValue = "Active Sessions (" + sessions.length + ")";
  }
  const summary = document.getElementById("sessionsSummary");
  if (summary) {
    const counts = sessions.reduce((map, s) => {
      map[s.username] = (map[s.username] || 0) + 1;
      return map;
    }, {});
    summary.replaceChildren();
    Object.keys(counts).sort().forEach(username => {
      const chip = document.createElement("span");
      chip.textContent = username + ": " + counts[username] + " place" + (counts[username] === 1 ? "" : "s");
      summary.append(chip);
    });
    summary.hidden = sessions.length === 0;
  }
  const empty = document.getElementById("sessionsEmpty");
  if (empty) empty.hidden = sessions.length !== 0;
  const table = document.getElementById("sessionsTable");
  if (table) table.hidden = sessions.length === 0;
  const tbody = table?.querySelector("tbody");
  if (!tbody) return;
  tbody.replaceChildren(...sessions.map(sessionRow));
}

function sessionRow(s) {
  const tr = document.createElement("tr");
  [
    s.username,
    s.role,
    s.ipAddress || "-",
    compactAgent(s.userAgent || ""),
    formatDateTime(s.loginAt),
    formatDateTime(s.lastSeenAt),
    s.lastPage || "-",
    formatDateTime(s.expiresAt)
  ].forEach(v => {
    const td = document.createElement("td");
    td.textContent = v;
    tr.append(td);
  });

  const actTd = document.createElement("td");
  const forceBtn = document.createElement("button");
  forceBtn.type = "button";
  forceBtn.className = "secondary-button danger";
  forceBtn.style.fontSize = "0.75rem";
  forceBtn.textContent = "Force Logout";
  forceBtn.addEventListener("click", async () => {
    if (!confirm("Force logout " + s.username + "?")) return;
    forceBtn.disabled = true;
    try {
      await api("DELETE", "/api/admin/sessions/" + encodeURIComponent(s.username));
      setStatus("Force logged out all active sessions for: " + s.username, false);
      await patchSessions();
    } catch (err) { setStatus("Error: " + err.message, true); forceBtn.disabled = false; }
  });
  actTd.append(forceBtn);
  tr.append(actTd);
  return tr;
}

// ── AUDIT LOG ──────────────────────────────────────────────────────────
async function renderAudit(token = renderToken) {
  if (!isCurrentRender(token) || activeTab !== "audit") return;
  statusEl.hidden = true;

  const title = document.createElement("h2");
  title.style.marginBottom = "12px";
  title.textContent = "Audit Log";
  appendLiveIndicator(title);
  contentEl.append(title);

  const filterRow = document.createElement("div");
  filterRow.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;align-items:flex-end";

  const fields = [
    { id: "auditUser", label: "User", type: "text", placeholder: "Filter by username" },
    { id: "auditFrom", label: "From Date", type: "date" },
    { id: "auditTo", label: "To Date", type: "date" }
  ];
  fields.forEach(f => {
    const lbl = document.createElement("label");
    lbl.className = "field";
    lbl.style.flex = "1 1 160px";
    const span = document.createElement("span");
    span.textContent = f.label;
    const input = document.createElement("input");
    input.type = f.type;
    input.id = f.id;
    if (f.placeholder) input.placeholder = f.placeholder;
    lbl.append(span, input);
    filterRow.append(lbl);
  });

  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "primary-button";
  searchBtn.style.alignSelf = "flex-end";
  searchBtn.textContent = "Search";
  searchBtn.addEventListener("click", () => patchAudit({ showLoading: true, token }));
  filterRow.append(searchBtn);
  contentEl.append(filterRow);

  const tableWrap = document.createElement("div");
  tableWrap.id = "auditTableWrap";
  tableWrap.className = "dash-table-wrap";
  contentEl.append(tableWrap);
  await patchAudit({ showLoading: true, token });
}

async function patchAudit(options = {}) {
  const token = options.token || renderToken;
  const user = document.getElementById("auditUser")?.value?.trim() || "";
  const from = document.getElementById("auditFrom")?.value || "";
  const to = document.getElementById("auditTo")?.value || "";
  const q = new URLSearchParams({ limit: "200" });
  if (user) q.set("user", user);
  if (from) q.set("from", from);
  if (to) q.set("to", to);

  const wrap = document.getElementById("auditTableWrap");
  if (!wrap) return;
  if (options.showLoading && !wrap.querySelector("table")) wrap.textContent = "Loading...";

  try {
    const entries = await api("GET", "/api/audit-log?" + q.toString());
    if (!isCurrentRender(token) || activeTab !== "audit") return;
    patchAuditDom(entries);
  } catch (err) {
    if (options.showLoading) wrap.textContent = "Error: " + err.message;
    else setStatus("Audit live refresh error: " + err.message, true);
  }
}

function ensureAuditTable() {
  const wrap = document.getElementById("auditTableWrap");
  if (!wrap) return null;
  let table = document.getElementById("auditTable");
  if (table) return table;
  wrap.innerHTML = "";
  table = document.createElement("table");
  table.id = "auditTable";
  table.className = "dash-table";
  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  ["Time", "User", "Action", "Entity", "Detail", "IP", "Device"].forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    hrow.append(th);
  });
  thead.append(hrow);
  table.append(thead, document.createElement("tbody"));
  wrap.append(table);
  return table;
}

function patchAuditDom(entries) {
  const wrap = document.getElementById("auditTableWrap");
  if (!wrap) return;
  if (!entries.length) {
    wrap.innerHTML = "";
    const p = document.createElement("p");
    p.className = "form-status";
    p.textContent = "No audit entries found.";
    wrap.append(p);
    return;
  }
  const table = ensureAuditTable();
  const tbody = table?.querySelector("tbody");
  if (!tbody) return;
  tbody.replaceChildren(...entries.map(auditRow));
}

function auditRow(e) {
  const tr = document.createElement("tr");
  const ts = formatDateTime(e.ts);
  [ts, e.username, e.action, e.entity_type + (e.entity_id ? " #" + e.entity_id : ""), e.detail || "-", e.ip_address || "-", compactAgent(e.user_agent || "")].forEach(v => {
    const td = document.createElement("td");
    td.textContent = v;
    tr.append(td);
  });
  return tr;
}

async function renderSystem(token = renderToken) {
  const status = await api("GET", "/api/admin/status");
  if (!isCurrentRender(token) || activeTab !== "system") return;
  statusEl.hidden = true;

  const title = document.createElement("h2");
  title.style.marginBottom = "12px";
  title.textContent = "System Status";
  appendLiveIndicator(title);
  contentEl.append(title);

  const grid = document.createElement("div");
  grid.className = "admin-status-grid";
  [
    ["Users", status.users],
    ["Events", status.events],
    ["Master Heads", status.masterHeads],
    ["Bills", status.bills],
    ["Audit Entries", status.auditEntries],
    ["Mail Quota", status.mailRemainingDailyQuota]
  ].forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "financial-metric";
    const span = document.createElement("span");
    span.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value == null ? "—" : String(value);
    card.append(span, strong);
    grid.append(card);
  });
  contentEl.append(grid);

  const info = document.createElement("div");
  info.className = "admin-system-info";
  const sheetUrl = String(status.spreadsheetUrl || "");
  info.innerHTML = `
    <p><strong>Google Sheet:</strong> ${sheetUrl ? `<a href="${sheetUrl}" target="_blank" rel="noreferrer">Open Sheet</a>` : "—"}</p>
    <p><strong>Script timezone:</strong> ${status.scriptTimeZone || "—"}</p>
    <p><strong>Last checked:</strong> ${status.updatedAt ? new Date(status.updatedAt).toLocaleString("en-IN") : "—"}</p>
  `;
  contentEl.append(info);
}

// Boot
document.addEventListener("DOMContentLoaded", () => {
  const odcUser = window.ODC_USER;
  if (odcUser && odcUser.role !== "admin") {
    document.getElementById("adminContent").innerHTML = "";
    const p = document.createElement("p");
    p.className = "form-status error";
    p.textContent = "Admin access required.";
    document.getElementById("adminContent").append(p);
    return;
  }
  loadTab("users");
});

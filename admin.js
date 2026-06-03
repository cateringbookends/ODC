"use strict";
(function () {
  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };

  /* ---- Guard: admin only ---- */
  function waitForUser(cb) {
    if (window.ODC_USER) return cb();
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (window.ODC_USER) { clearInterval(t); cb(); }
      if (tries > 50)      { clearInterval(t); document.body.innerHTML = "<p style='padding:2rem'>Access denied.</p>"; }
    }, 100);
  }

  waitForUser(function () {
    if (window.ODC_USER.role !== "admin") {
      document.querySelector("main").innerHTML = "<div class='panel' style='padding:2rem;text-align:center'><h2>Admin Only</h2><p style='color:var(--muted);margin-top:.5rem'>You do not have permission to view this page.</p></div>";
      return;
    }
    initTabs();
    loadUsers();
    loadSessions();
    loadAudit();
    setupAddUser();
    setupAuditFilters();
    document.getElementById("refreshSessions").addEventListener("click", loadSessions);
  });

  /* ================================================================
   * TABS
   * ================================================================ */
  function initTabs() {
    document.querySelectorAll(".admin-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".admin-tab").forEach(function (b) {
          b.style.borderBottomColor = "transparent";
          b.style.color = "var(--muted)";
          b.classList.remove("active");
        });
        document.querySelectorAll(".admin-tab-content").forEach(function (c) { c.hidden = true; });
        btn.style.borderBottomColor = "var(--accent)";
        btn.style.color = "var(--accent-dark)";
        btn.classList.add("active");
        document.getElementById("tab-" + btn.dataset.tab).hidden = false;
      });
    });
  }

  /* ================================================================
   * USERS
   * ================================================================ */
  function loadUsers() {
    fetch("/api/auth/users", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(renderUsers)
      .catch(function (e) { console.error("users load:", e); });
  }

  function renderUsers(users) {
    var wrap = document.getElementById("usersTableWrap");
    if (!users || !users.length) { wrap.innerHTML = '<p class="empty-state">No users found.</p>'; return; }

    var html = '<table class="users-table" style="width:100%">' +
      '<thead><tr>' +
        th("Username") + th("Full Name") + th("Role") + th("Created") + th("Actions") +
      '</tr></thead><tbody>';

    users.forEach(function (u) {
      var isProtected = u.username === "aiops";
      html += '<tr>' +
        '<td style="' + cellS + 'font-weight:600">' + esc(u.username) + '</td>' +
        '<td style="' + cellS + '">' + esc(u.fullName || "—") + '</td>' +
        '<td style="' + cellS + '">' +
          '<span class="bill-status-badge ' + (u.role === "admin" ? "bill-status-badge-approved" : "bill-status-badge-pending") + '" style="font-size:.7rem">' + esc(u.role) + '</span>' +
        '</td>' +
        '<td style="' + cellS + 'color:var(--muted);font-size:.8rem">' + esc((u.createdAt || "").slice(0, 10)) + '</td>' +
        '<td style="' + cellS + '">' +
          '<div style="display:flex;gap:.4rem;flex-wrap:wrap">' +
            (isProtected ? '' : '<button class="secondary-button" style="font-size:.75rem;padding:.25rem .6rem" data-del-user="' + esc(u.username) + '">Delete</button>') +
            '<button class="secondary-button" style="font-size:.75rem;padding:.25rem .6rem" data-chpw-user="' + esc(u.username) + '">Change Password</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;

    wrap.addEventListener("click", function (e) {
      var delBtn  = e.target.closest("[data-del-user]");
      var chpwBtn = e.target.closest("[data-chpw-user]");
      if (delBtn)  handleDeleteUser(delBtn.dataset.delUser, delBtn);
      if (chpwBtn) handleChangePassword(chpwBtn.dataset.chpwUser);
    });
  }

  function handleDeleteUser(username, btn) {
    if (!confirm("Delete user \"" + username + "\"? This cannot be undone.")) return;
    btn.disabled = true;
    fetch("/api/auth/users/" + encodeURIComponent(username), { method: "DELETE", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.ok) loadUsers(); else { alert(d.error || "Failed."); btn.disabled = false; } })
      .catch(function () { btn.disabled = false; });
  }

  function handleChangePassword(username) {
    var newPw = prompt("New password for \"" + username + "\" (min 4 chars):");
    if (!newPw || newPw.length < 4) { if (newPw !== null) alert("Password too short."); return; }
    fetch("/api/auth/users/" + encodeURIComponent(username) + "/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ password: newPw })
    }).then(function (r) { return r.json(); })
      .then(function (d) { alert(d.ok ? "Password changed for " + username : (d.error || "Failed.")); })
      .catch(function () { alert("Network error."); });
  }

  function setupAddUser() {
    document.getElementById("addUserBtn").addEventListener("click", function () {
      var msg      = document.getElementById("userMsg");
      var username = document.getElementById("newUsername").value.trim();
      var fullName = document.getElementById("newFullName").value.trim();
      var password = document.getElementById("newPassword").value;
      var role     = document.getElementById("newRole").value;
      msg.hidden = true;
      if (!username || password.length < 4) {
        msg.textContent = "Username required and password must be at least 4 characters.";
        msg.style.color = "#dc2626"; msg.hidden = false; return;
      }
      var btn = this; btn.disabled = true; btn.textContent = "Adding…";
      fetch("/api/auth/users", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ username: username, fullName: fullName, password: password, role: role })
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          btn.disabled = false; btn.textContent = "Add User";
          msg.hidden = false;
          if (res.ok) {
            msg.textContent = "✓ User \"" + username + "\" added successfully.";
            msg.style.color = "#059669";
            document.getElementById("newUsername").value = "";
            document.getElementById("newFullName").value = "";
            document.getElementById("newPassword").value = "";
            loadUsers();
          } else {
            msg.textContent = "✗ " + (res.data.error || "Failed.");
            msg.style.color = "#dc2626";
          }
        })
        .catch(function () { btn.disabled = false; btn.textContent = "Add User"; });
    });
  }

  /* ================================================================
   * ACTIVE SESSIONS
   * ================================================================ */
  function loadSessions() {
    fetch("/api/admin/sessions", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(renderSessions)
      .catch(function () { document.getElementById("sessionsWrap").innerHTML = '<p style="color:#dc2626">Could not load sessions.</p>'; });
  }

  function renderSessions(sessions) {
    var wrap = document.getElementById("sessionsWrap");
    if (!sessions || !sessions.length) {
      wrap.innerHTML = '<p class="empty-state">No active sessions right now.</p>';
      return;
    }
    var html = '<div style="display:flex;flex-direction:column;gap:.6rem">';
    sessions.forEach(function (s) {
      var loginTime = new Date(s.loginAt);
      var expTime   = new Date(s.expiresAt);
      var minsLeft  = Math.round((expTime - Date.now()) / 60000);
      html += '<div style="display:flex;align-items:center;gap:1rem;padding:.75rem 1rem;background:var(--surface-soft);border-radius:var(--radius-md);border-left:3px solid ' + (s.role === "admin" ? "var(--accent)" : "var(--line)") + '">' +
        '<div style="width:36px;height:36px;border-radius:50%;background:' + (s.role === "admin" ? "var(--accent)" : "#64748b") + ';display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:.85rem;flex-shrink:0">' +
          esc(s.username.charAt(0).toUpperCase()) +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:700;font-size:.9rem">' + esc(s.username) + ' <span style="font-size:.7rem;color:var(--muted);font-weight:400">(' + esc(s.role) + ')</span></div>' +
          '<div style="font-size:.78rem;color:var(--muted)">Logged in: ' + loginTime.toLocaleString("en-IN") + ' · Expires in ' + minsLeft + ' min</div>' +
        '</div>' +
        (s.username !== window.ODC_USER.username
          ? '<button class="secondary-button" style="font-size:.75rem;padding:.25rem .7rem;color:#dc2626;border-color:#fecaca" data-force-logout="' + esc(s.username) + '">Force Logout</button>'
          : '<span style="font-size:.75rem;color:var(--accent)">You</span>') +
        '</div>';
    });
    html += '</div>';
    wrap.innerHTML = html;

    wrap.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-force-logout]");
      if (!btn) return;
      var username = btn.dataset.forceLogout;
      if (!confirm("Force logout " + username + "?")) return;
      btn.disabled = true;
      fetch("/api/admin/sessions/" + encodeURIComponent(username), { method: "DELETE", credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d.ok) loadSessions(); else btn.disabled = false; })
        .catch(function () { btn.disabled = false; });
    });
  }

  /* ================================================================
   * AUDIT LOG
   * ================================================================ */
  function loadAudit(params) {
    var qs = params ? "?" + new URLSearchParams(params).toString() : "";
    fetch("/api/audit-log" + qs, { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(renderAudit)
      .catch(function () { document.getElementById("auditFeed").innerHTML = '<p style="color:#dc2626">Could not load audit log.</p>'; });
  }

  var ACTION_COLORS = {
    LOGIN: "#3b82f6", LOGOUT: "#64748b", FORCE_LOGOUT: "#ef4444",
    CREATE: "#059669", UPDATE: "#f59e0b", DELETE: "#dc2626",
    UPSERT: "#10b981", UPDATE_MASTER: "#8b5cf6"
  };
  var ACTION_ICONS = {
    LOGIN: "🔑", LOGOUT: "🚪", FORCE_LOGOUT: "⛔",
    CREATE: "✅", UPDATE: "✏️", DELETE: "🗑️",
    "upsertEvent": "✏️", "savePettyCash": "💰", "savePreCost": "📊",
    "saveMasterPersons": "👥", "createBill": "🧾", "reviewBill": "✔️"
  };

  function renderAudit(rows) {
    var feed  = document.getElementById("auditFeed");
    var count = document.getElementById("auditCount");
    count.textContent = rows.length + " entries";
    if (!rows || !rows.length) { feed.innerHTML = '<p class="empty-state">No activity found.</p>'; return; }

    var byDay = {};
    rows.forEach(function (r) {
      var day = (r.ts || "").slice(0, 10);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(r);
    });

    var html = "";
    Object.keys(byDay).forEach(function (day) {
      html += '<div style="font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;padding:.5rem 0;margin-top:.5rem">' +
        new Date(day).toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) +
        '</div>';

      byDay[day].forEach(function (r) {
        var action = (r.action || "").toUpperCase();
        var color  = ACTION_COLORS[action] || "#64748b";
        var icon   = ACTION_ICONS[r.action] || ACTION_ICONS[action] || "🔄";
        var time   = r.ts ? new Date(r.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
        var ua     = (r.user_agent || "").replace(/\(.*?\)/g, "").trim().split(" ")[0];
        var ip     = r.ip_address || "";

        var entityLabel = "";
        if (r.entity_type && r.entity_type !== "auth") {
          entityLabel = '<span style="background:var(--surface-soft);border-radius:4px;padding:1px 6px;font-size:.72rem;color:var(--muted)">' + esc(r.entity_type) + (r.entity_id ? ": " + esc(r.entity_id) : "") + '</span>';
        }
        if (r.detail) entityLabel += ' <span style="font-size:.78rem;color:var(--muted)">→ ' + esc(r.detail) + '</span>';

        html += '<div style="display:flex;gap:.75rem;padding:.6rem 0;border-bottom:1px solid var(--surface-border);align-items:flex-start">' +
          '<div style="width:32px;text-align:center;font-size:.85rem;flex-shrink:0;padding-top:2px">' + icon + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">' +
              '<span style="font-weight:700;font-size:.85rem">' + esc(r.username) + '</span>' +
              '<span style="font-size:.75rem;font-weight:700;color:' + color + ';background:' + color + '18;border-radius:4px;padding:1px 7px">' + esc(r.action) + '</span>' +
              entityLabel +
            '</div>' +
            '<div style="font-size:.75rem;color:var(--muted);margin-top:2px">' +
              time + (ip ? ' · ' + esc(ip) : '') + (ua ? ' · ' + esc(ua) : '') +
            '</div>' +
          '</div>' +
        '</div>';
      });
    });

    feed.innerHTML = html;
  }

  function setupAuditFilters() {
    var today = new Date().toISOString().slice(0, 10);
    document.getElementById("auditFilterTo").value = today;
    var past = new Date(); past.setDate(past.getDate() - 30);
    document.getElementById("auditFilterFrom").value = past.toISOString().slice(0, 10);

    document.getElementById("auditSearch").addEventListener("click", function () {
      var params = {};
      var u = document.getElementById("auditFilterUser").value.trim();
      var a = document.getElementById("auditFilterAction").value;
      var f = document.getElementById("auditFilterFrom").value;
      var t = document.getElementById("auditFilterTo").value;
      if (u) params.user   = u;
      if (a) params.action = a;
      if (f) params.from   = f;
      if (t) params.to     = t;
      loadAudit(params);
    });

    document.getElementById("auditClear").addEventListener("click", function () {
      document.getElementById("auditFilterUser").value   = "";
      document.getElementById("auditFilterAction").value = "";
      document.getElementById("auditFilterFrom").value   = past.toISOString().slice(0, 10);
      document.getElementById("auditFilterTo").value     = today;
      loadAudit();
    });
  }

  /* ---- helpers ---- */
  var cellS = "padding:10px 12px;border-bottom:1px solid var(--surface-border);font-size:.84rem;";
  function th(t) { return '<th style="text-align:left;padding:8px 12px;font-size:.78rem;font-weight:600;color:var(--muted);border-bottom:2px solid var(--surface-border)">' + t + '</th>'; }

  var past = new Date(); past.setDate(past.getDate() - 30);
}());

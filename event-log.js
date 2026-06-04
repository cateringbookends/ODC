"use strict";
(function () {
  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };

  var id = new URLSearchParams(location.search).get("id");
  var allLogs = [];
  var activeFilter = "all";

  var SECTION_LABELS = {
    core: "Event Details", kyc: "KYC / Client Info",
    payment_schedule: "Payment Schedule", petty_cash: "Petty Cash", pre_cost: "Pre-Cost Plan"
  };
  var ACTION_STYLE = {
    create:      { color: "#059669", bg: "#f0fdf4", label: "Created"    },
    update:      { color: "#3b82f6", bg: "#eff6ff", label: "Updated"    },
    petty_cash:  { color: "#8b5cf6", bg: "#f5f3ff", label: "Petty Cash" },
    pre_cost:    { color: "#f59e0b", bg: "#fffbeb", label: "Pre-Cost"   },
    delete:      { color: "#dc2626", bg: "#fef2f2", label: "Deleted"    }
  };

  if (!id) {
    document.getElementById("logBody").innerHTML = '<p style="color:#dc2626;padding:2rem">No event ID in URL. Add ?id=EVT-xxx to the URL.</p>';
    return;
  }

  // Update back link to event dashboard
  document.getElementById("backLink").href = "event-dashboard.html?id=" + encodeURIComponent(id);

  // Load event header + logs in parallel
  Promise.all([
    fetch("/api/events/" + encodeURIComponent(id) + "/header", { headers: { "ngrok-skip-browser-warning": "true" } }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch("/api/events/" + encodeURIComponent(id) + "/log",    { headers: { "ngrok-skip-browser-warning": "true" } }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
  ]).then(function (results) {
    var ev  = results[0];
    var log = results[1] || [];

    // Render event header
    if (ev) {
      document.title = ev.name + " — Event Log";
      document.getElementById("eventName").textContent = ev.name;
      var statusBadge = document.getElementById("eventStatus");
      statusBadge.textContent = ev.status;
      statusBadge.className = "bill-status-badge bill-status-badge-" + ev.status;
      var meta = [ev.date, ev.location, ev.locationZone, ev.pax + " PAX", ev.days + " day(s)"].filter(Boolean).join(" · ");
      document.getElementById("eventMeta").textContent = meta;
    } else {
      document.getElementById("eventName").textContent = "Event " + id;
    }

    allLogs = log;
    renderLog();
  });

  function renderLog() {
    var query   = (document.getElementById("logSearch").value || "").toLowerCase().trim();
    var filtered = allLogs.filter(function (r) {
      if (activeFilter !== "all" && r.section !== activeFilter) return false;
      if (query) {
        var searchable = [r.field, r.old_value, r.new_value, r.username, r.section].join(" ").toLowerCase();
        if (!searchable.includes(query)) return false;
      }
      return true;
    });

    var body = document.getElementById("logBody");

    if (!filtered.length) {
      body.innerHTML = '<div class="panel" style="padding:2rem;text-align:center;color:var(--muted)">' +
        (allLogs.length === 0 ? "No changes recorded for this event yet." : "No entries match the current filter.") +
        '</div>';
      return;
    }

    // Group by date
    var byDay = {};
    filtered.forEach(function (r) {
      var day = (r.ts || "").slice(0, 10);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(r);
    });

    var html = '<div class="panel" style="padding:0">';

    Object.keys(byDay).sort().reverse().forEach(function (day, dayIdx) {
      // Day separator
      var dayLabel;
      try { dayLabel = new Date(day + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
      catch (e) { dayLabel = day; }

      html += '<div style="padding:.6rem 1.25rem;background:var(--surface-soft);border-bottom:1px solid var(--surface-border);' + (dayIdx === 0 ? "border-radius:var(--radius-md) var(--radius-md) 0 0;" : "") + '">' +
        '<span style="font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">' + esc(dayLabel) + '</span>' +
        '<span style="margin-left:.75rem;font-size:.72rem;color:var(--muted)">' + byDay[day].length + ' change(s)</span>' +
      '</div>';

      byDay[day].forEach(function (r, idx) {
        var style  = ACTION_STYLE[r.action] || { color: "#64748b", bg: "#f8fafc", label: r.action };
        var secLabel = SECTION_LABELS[r.section] || r.section;
        var time   = r.ts ? new Date(r.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
        var ua     = (r.user_agent || "").replace(/\(.*?\)/g, "").trim().split(/\s+/)[0];
        var ip     = r.ip_address || "";
        var isLast = idx === byDay[day].length - 1;

        html += '<div style="display:grid;grid-template-columns:100px 1fr auto;gap:1rem;padding:.85rem 1.25rem;border-bottom:' + (isLast ? "none" : "1px solid var(--surface-border)") + ';align-items:start">' +

          // Col 1: action badge + section
          '<div>' +
            '<span style="display:inline-block;font-size:.68rem;font-weight:700;color:' + style.color + ';background:' + style.bg + ';border-radius:4px;padding:2px 7px;margin-bottom:3px">' + style.label + '</span>' +
            '<div style="font-size:.72rem;color:var(--muted);margin-top:1px">' + esc(secLabel) + '</div>' +
          '</div>' +

          // Col 2: field + old → new
          '<div>' +
            (r.field ? '<div style="font-weight:600;font-size:.85rem;color:var(--ink);margin-bottom:3px">' + esc(r.field) + '</div>' : '') +
            (r.old_value != null && r.new_value != null && String(r.old_value) !== String(r.new_value)
              ? '<div style="font-size:.8rem;display:flex;flex-wrap:wrap;align-items:center;gap:.3rem">' +
                  (r.old_value
                    ? '<span style="background:#fef2f2;color:#dc2626;padding:2px 6px;border-radius:3px;font-family:monospace">' + esc(String(r.old_value).slice(0, 100)) + '</span>' +
                      '<span style="color:var(--muted)">→</span>'
                    : '<span style="color:var(--muted);font-style:italic">—</span><span style="color:var(--muted)">→</span>') +
                  '<span style="background:#f0fdf4;color:#059669;padding:2px 6px;border-radius:3px;font-family:monospace">' + esc(String(r.new_value || "—").slice(0, 100)) + '</span>' +
                '</div>'
              : (r.new_value ? '<div style="font-size:.8rem;color:var(--muted)">' + esc(String(r.new_value).slice(0, 120)) + '</div>' : '')) +
          '</div>' +

          // Col 3: who + when + IP
          '<div style="text-align:right;min-width:120px">' +
            '<div style="font-size:.82rem;font-weight:700;color:var(--ink)">' + esc(r.username) + '</div>' +
            '<div style="font-size:.72rem;color:var(--muted);margin-top:1px">' + esc(time) + '</div>' +
            (ip   ? '<div style="font-size:.68rem;color:var(--muted);margin-top:1px">' + esc(ip) + '</div>'   : '') +
            (ua   ? '<div style="font-size:.65rem;color:var(--muted)">' + esc(ua) + '</div>' : '') +
          '</div>' +

        '</div>';
      });
    });

    html += '</div>';
    body.innerHTML = html;
  }

  // Filter buttons
  document.querySelectorAll(".filter-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".filter-btn").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      activeFilter = btn.dataset.filter;
      renderLog();
    });
  });

  document.getElementById("logSearch").addEventListener("input", renderLog);

}());

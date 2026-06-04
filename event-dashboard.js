"use strict";
(function () {
  var fmt  = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  var fmtN = function (n) { return fmt.format(n || 0); };
  var esc  = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };

  function getEventId() {
    return new URLSearchParams(window.location.search).get("id");
  }

  async function init() {
    var id = getEventId();
    if (!id) { document.getElementById("loadingState").textContent = "No event ID in URL."; return; }

    var [ev, pettyCash, preCost, bills, heads, changeLog] = await Promise.all([
      ODC.api("GET", "/api/events/" + encodeURIComponent(id)).catch(function () { return null; }),
      ODC.api("GET", "/api/events/" + encodeURIComponent(id) + "/petty-cash").catch(function () { return { payouts: [], petty: [] }; }),
      ODC.api("GET", "/api/events/" + encodeURIComponent(id) + "/pre-cost").catch(function () { return null; }),
      ODC.api("GET", "/api/bills").then(function (b) { return (b || []).filter(function (x) { return x.eventClientId === id; }); }),
      ODC.api("GET", "/api/master-persons"),
      ODC.api("GET", "/api/events/" + encodeURIComponent(id) + "/log").catch(function () { return []; })
    ]);

    if (!ev) { document.getElementById("loadingState").textContent = "Event not found."; return; }

    document.title = ev.name + " — ODC Dashboard";
    renderDashboard(ev, pettyCash, preCost, bills, heads || [], changeLog || []);
  }

  function renderDashboard(ev, pc, preCost, bills, heads, changeLog) {
    var main = document.getElementById("mainContent");

    var approvedBills = bills.filter(function (b) { return b.status === "approved"; }).reduce(function (s, b) { return s + b.amount; }, 0);
    var pendingBills  = bills.filter(function (b) { return b.status === "pending";  }).reduce(function (s, b) { return s + b.amount; }, 0);
    var preCostTotal  = preCost ? (preCost.totalCost || 0) : 0;
    var totalPayout   = (pc.payouts || []).reduce(function (s, r) { return s + r.amount; }, 0);
    var baseRevenue = ev.totalBilling / 1.05; // strip GST — planning uses pre-GST revenue
    var estPL = baseRevenue - preCostTotal;
    var actPL = baseRevenue - preCostTotal - approvedBills;
    var plColor = function (v) { return v >= 0 ? "#059669" : "#dc2626"; };

    main.innerHTML = [
      // Back link + header
      '<div style="margin-bottom:1.5rem">',
        '<a href="saved-events.html" style="color:var(--muted);font-size:.82rem;text-decoration:none">← Back to Events</a>',
        '<div style="display:flex;align-items:baseline;gap:1rem;margin-top:.5rem;flex-wrap:wrap">',
          '<h1 style="font-size:1.6rem;margin:0">' + esc(ev.name) + '</h1>',
          '<span class="bill-status-badge bill-status-badge-' + ev.status + '">' + ev.status + '</span>',
        '</div>',
        '<p style="color:var(--muted);font-size:.85rem;margin-top:.3rem">',
          esc(ev.date) + ' · ' + esc(ev.location) + (ev.locationZone ? ' · ' + esc(ev.locationZone) : '') + ' · ' + ev.pax + ' PAX · ' + ev.days + ' day(s)',
        '</p>',
      '</div>',

      // P&L Summary cards
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;margin-bottom:1.5rem">',
        card("Total Billing", fmtN(ev.totalBilling), "#3b82f6"),
        card("Revenue (ex GST)", fmtN(baseRevenue), "#0ea5e9"),
        card("Pre-Cost",      preCostTotal ? fmtN(preCostTotal) : "Not planned", "#f59e0b"),
        card("Est. P&L",      fmtN(estPL), plColor(estPL)),
        card("Approved Bills",fmtN(approvedBills), "#8b5cf6"),
        card("Pending Bills", fmtN(pendingBills), "#f59e0b"),
        card("Actual P&L",    fmtN(actPL), plColor(actPL)),
      '</div>',

      // Petty cash tracker
      renderPettyCashSection(ev, pc, bills, heads, totalPayout, approvedBills),

      // Bills list
      renderBillsSection(bills, heads),

      // Payment schedule
      renderPaymentSection(ev),

      // Change history log
      renderChangeLog(changeLog),

    ].join("");
  }

  function card(label, value, color) {
    return '<div class="panel" style="text-align:center;padding:1rem">' +
      '<div style="font-size:.75rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.3rem">' + label + '</div>' +
      '<div style="font-size:1.25rem;font-weight:800;color:' + color + '">' + esc(value) + '</div>' +
      '</div>';
  }

  function renderPettyCashSection(ev, pc, bills, heads, totalPayout, totalApproved) {
    var rows = pc.payouts || [];
    if (!rows.length && !(pc.petty || []).length) {
      return '<div class="panel" style="margin-bottom:1.5rem"><div class="panel-header"><h2>Petty Cash Tracker</h2></div>' +
        '<p class="empty-state" style="padding:1rem">No petty cash assigned for this event yet. <a href="petty-cash.html">Set up petty cash →</a></p></div>';
    }

    // Build tracker: per person (head + person name)
    var tracker = rows.map(function (payout) {
      var headName = (heads.find(function (h) { return h.id === payout.headId; }) || { name: payout.headId }).name;
      var personBills = bills.filter(function (b) {
        return b.headId === payout.headId && b.personName === payout.person;
      });
      var spent   = personBills.filter(function (b) { return b.status === "approved"; }).reduce(function (s, b) { return s + b.amount; }, 0);
      var pending = personBills.filter(function (b) { return b.status === "pending";  }).reduce(function (s, b) { return s + b.amount; }, 0);
      var remaining = payout.amount - spent;
      return { headName: headName, person: payout.person, purpose: payout.purpose, allocated: payout.amount, spent: spent, pending: pending, remaining: remaining };
    });

    // Also track direct bills (no matching petty cash)
    var directBills = bills.filter(function (b) {
      return !rows.some(function (r) { return r.headId === b.headId && r.person === b.personName; });
    });

    var tbTh = function (h) { return '<th style="text-align:left;padding:8px 10px;font-size:.78rem;font-weight:600;color:var(--muted);border-bottom:1px solid var(--surface-border);white-space:nowrap">' + h + '</th>'; };

    var trs = tracker.map(function (t) {
      var barPct = t.allocated > 0 ? Math.min(100, (t.spent / t.allocated) * 100) : 0;
      var barColor = barPct > 90 ? "#dc2626" : barPct > 70 ? "#f59e0b" : "#059669";
      var remColor = t.remaining < 0 ? "#dc2626" : "#059669";
      return '<tr>' +
        '<td style="padding:8px 10px;font-size:.83rem;border-bottom:1px solid var(--surface-border)">' + esc(t.headName) + '</td>' +
        '<td style="padding:8px 10px;font-size:.83rem;border-bottom:1px solid var(--surface-border);font-weight:600">' + esc(t.person) + '</td>' +
        '<td style="padding:8px 10px;font-size:.82rem;color:var(--muted);border-bottom:1px solid var(--surface-border)">' + esc(t.purpose || "—") + '</td>' +
        '<td style="padding:8px 10px;font-size:.83rem;border-bottom:1px solid var(--surface-border)">' + fmtN(t.allocated) + '</td>' +
        '<td style="padding:8px 10px;font-size:.83rem;border-bottom:1px solid var(--surface-border)">' +
          '<div style="display:flex;align-items:center;gap:.5rem">' +
            '<div style="flex:1;background:var(--surface-border);border-radius:4px;height:6px">' +
              '<div style="width:' + barPct + '%;background:' + barColor + ';height:6px;border-radius:4px;transition:.3s"></div>' +
            '</div>' +
            '<span>' + fmtN(t.spent) + '</span>' +
          '</div>' +
        '</td>' +
        '<td style="padding:8px 10px;font-size:.83rem;font-weight:700;color:' + remColor + ';border-bottom:1px solid var(--surface-border)">' + fmtN(t.remaining) + '</td>' +
        (t.pending > 0 ? '<td style="padding:8px 10px;font-size:.82rem;color:#f59e0b;border-bottom:1px solid var(--surface-border)">+' + fmtN(t.pending) + ' pending</td>' : '<td style="border-bottom:1px solid var(--surface-border)"></td>') +
        '</tr>';
    }).join("");

    var totRemaining = tracker.reduce(function (s, t) { return s + t.remaining; }, 0);

    var directSection = directBills.length ? (
      '<div style="margin-top:1rem;padding:.75rem;background:var(--surface-soft);border-radius:8px;font-size:.83rem">' +
      '<strong>Direct Bills (no petty cash allocation):</strong> ' + directBills.length + ' bill(s), Total: ' + fmtN(directBills.reduce(function (s, b) { return s + b.amount; }, 0)) +
      '</div>'
    ) : "";

    return '<div class="panel" style="margin-bottom:1.5rem">' +
      '<div class="panel-header" style="margin-bottom:1rem">' +
        '<h2>Petty Cash Tracker — Live</h2>' +
        '<a href="petty-cash.html?event=' + encodeURIComponent(ev.id) + '" style="font-size:.8rem;color:var(--accent)">Edit Petty Cash →</a>' +
      '</div>' +
      '<div style="overflow-x:auto">' +
        '<table style="width:100%;border-collapse:collapse">' +
          '<thead><tr>' + [tbTh("Dept"), tbTh("Person"), tbTh("Purpose"), tbTh("Allocated"), tbTh("Spent"), tbTh("Remaining"), tbTh("")].join("") + '</tr></thead>' +
          '<tbody>' + trs + '</tbody>' +
          '<tfoot><tr style="background:var(--surface-soft)">' +
            '<td colspan="3" style="padding:10px;font-weight:700;font-size:.85rem">Total</td>' +
            '<td style="padding:10px;font-weight:700">' + fmtN(totalPayout) + '</td>' +
            '<td style="padding:10px;font-weight:700">' + fmtN(totalApproved) + '</td>' +
            '<td style="padding:10px;font-weight:800;color:' + (totRemaining >= 0 ? "#059669" : "#dc2626") + '">' + fmtN(totRemaining) + '</td>' +
            '<td></td>' +
          '</tr></tfoot>' +
        '</table>' +
      '</div>' +
      directSection +
    '</div>';
  }

  function renderBillsSection(bills, heads) {
    if (!bills.length) return '<div class="panel" style="margin-bottom:1.5rem"><div class="panel-header"><h2>Submitted Bills</h2></div><p class="empty-state" style="padding:1rem">No bills submitted yet.</p></div>';

    var rows = bills.map(function (b) {
      var hname = (heads.find(function (h) { return h.id === b.headId; }) || { name: b.headId || "Direct" }).name;
      return '<tr>' +
        '<td style="padding:8px 10px;font-size:.83rem;border-bottom:1px solid var(--surface-border)">' + esc(hname) + '</td>' +
        '<td style="padding:8px 10px;font-size:.83rem;border-bottom:1px solid var(--surface-border);font-weight:600">' + esc(b.personName) + '</td>' +
        '<td style="padding:8px 10px;font-size:.83rem;border-bottom:1px solid var(--surface-border)">' + esc(b.category) + '</td>' +
        '<td style="padding:8px 10px;font-size:.83rem;border-bottom:1px solid var(--surface-border)">' + esc(b.description || "—") + '</td>' +
        '<td style="padding:8px 10px;font-size:.83rem;font-weight:700;border-bottom:1px solid var(--surface-border)">' + fmtN(b.amount) + '</td>' +
        '<td style="padding:8px 10px;border-bottom:1px solid var(--surface-border)"><span class="bill-status-badge bill-status-badge-' + b.status + '">' + b.status + '</span></td>' +
        '<td style="padding:8px 10px;font-size:.78rem;color:var(--muted);border-bottom:1px solid var(--surface-border)">' + esc((b.submittedAt || "").slice(0, 10)) + '</td>' +
        '</tr>';
    }).join("");

    return '<div class="panel" style="margin-bottom:1.5rem">' +
      '<div class="panel-header" style="margin-bottom:1rem"><h2>Submitted Bills (' + bills.length + ')</h2></div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
        '<thead><tr>' + ["Dept", "Person", "Category", "Description", "Amount", "Status", "Date"].map(function (h) {
          return '<th style="text-align:left;padding:8px 10px;font-size:.78rem;font-weight:600;color:var(--muted);border-bottom:1px solid var(--surface-border)">' + h + '</th>';
        }).join("") + '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
    '</div>';
  }

  function renderPaymentSection(ev) {
    var cycles = ev.paymentSchedule || [];
    if (!cycles.length) return "";

    var rows = cycles.map(function (c) {
      return '<tr>' +
        '<td style="padding:8px 10px;font-size:.83rem;border-bottom:1px solid var(--surface-border)">' + esc(c.label) + (c.isAdvance ? ' <span class="bill-status-badge" style="font-size:.68rem;background:#f0fdf4;color:#059669;border-color:#bbf7d0">Advance</span>' : '') + '</td>' +
        '<td style="padding:8px 10px;font-size:.83rem;border-bottom:1px solid var(--surface-border)">' + esc(c.dueDate || "—") + '</td>' +
        '<td style="padding:8px 10px;font-size:.83rem;font-weight:700;border-bottom:1px solid var(--surface-border)">' + fmtN(c.amount) + '</td>' +
        '<td style="padding:8px 10px;font-size:.83rem;border-bottom:1px solid var(--surface-border)">' + esc(c.billing) + (c.method ? ' · ' + esc(c.method) : '') + '</td>' +
        '</tr>';
    }).join("");

    return '<div class="panel">' +
      '<div class="panel-header" style="margin-bottom:1rem"><h2>Payment Schedule</h2></div>' +
      '<table style="width:100%;border-collapse:collapse">' +
        '<thead><tr>' + ["Cycle", "Due Date", "Amount", "Type"].map(function (h) {
          return '<th style="text-align:left;padding:8px 10px;font-size:.78rem;font-weight:600;color:var(--muted);border-bottom:1px solid var(--surface-border)">' + h + '</th>';
        }).join("") + '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
  }

  var SECTION_LABELS = { core: "Event Details", kyc: "KYC / Client Info", payment_schedule: "Payment Schedule", petty_cash: "Petty Cash", pre_cost: "Pre-Cost Plan" };
  var ACTION_BADGE  = { create: ["#059669","#f0fdf4","Created"], update: ["#3b82f6","#eff6ff","Updated"], petty_cash: ["#8b5cf6","#f5f3ff","Petty Cash"], pre_cost: ["#f59e0b","#fffbeb","Pre-Cost"], delete: ["#dc2626","#fef2f2","Deleted"] };

  function renderChangeLog(log) {
    var evId = getEventId();
    var header = '<div class="panel" style="margin-top:1.5rem">' +
      '<div class="panel-header" style="margin-bottom:1rem">' +
        '<h2>Change History</h2>' +
        '<div style="display:flex;align-items:center;gap:1rem">' +
          '<span style="font-size:.78rem;color:var(--muted)">' + (log.length) + ' entries</span>' +
          '<a href="event-log.html?id=' + encodeURIComponent(evId) + '" style="font-size:.78rem;color:var(--accent)" target="_blank">Open Full Log ↗</a>' +
        '</div>' +
      '</div>';

    if (!log || !log.length) {
      return header + '<p class="empty-state" style="padding:1rem">No changes recorded yet.</p></div>';
    }

    // Group by date
    var byDay = {};
    log.forEach(function (r) {
      var day = (r.ts || "").slice(0, 10);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(r);
    });

    var html = header;

    Object.keys(byDay).sort().reverse().forEach(function (day) {
      var label;
      try { label = new Date(day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }
      catch (e) { label = day; }

      html += '<div style="font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;padding:.4rem 0 .2rem;margin-top:.75rem;border-bottom:1px solid var(--surface-border)">' + label + '</div>';

      byDay[day].forEach(function (r) {
        var badge = ACTION_BADGE[r.action] || ["#64748b","#f8fafc","—"];
        var time  = r.ts ? new Date(r.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
        var sectionLabel = SECTION_LABELS[r.section] || r.section;
        var ua    = (r.user_agent || "").replace(/\(.*?\)/g, "").trim().split(" ")[0] || "";
        var ip    = r.ip_address || "";

        html += '<div style="display:flex;gap:.75rem;padding:.55rem 0;border-bottom:1px solid var(--surface-border);align-items:flex-start">' +

          // Left: action badge + section
          '<div style="min-width:90px;flex-shrink:0">' +
            '<span style="display:inline-block;font-size:.68rem;font-weight:700;color:' + badge[0] + ';background:' + badge[1] + ';border-radius:4px;padding:2px 6px;margin-bottom:2px">' + badge[2] + '</span><br>' +
            '<span style="font-size:.7rem;color:var(--muted)">' + esc(sectionLabel) + '</span>' +
          '</div>' +

          // Middle: field + old/new values
          '<div style="flex:1;min-width:0">' +
            (r.field ? '<div style="font-weight:600;font-size:.82rem;color:var(--ink)">' + esc(r.field) + '</div>' : '') +
            (r.old_value != null && r.new_value != null && r.old_value !== r.new_value
              ? '<div style="font-size:.78rem;margin-top:2px">' +
                  (r.old_value ? '<span style="color:#dc2626;background:#fef2f2;border-radius:3px;padding:1px 5px;margin-right:4px">' + esc(String(r.old_value).slice(0,80)) + '</span>' +
                  '<span style="color:var(--muted);margin-right:4px">→</span>' : '') +
                  '<span style="color:#059669;background:#f0fdf4;border-radius:3px;padding:1px 5px">' + esc(String(r.new_value).slice(0,120)) + '</span>' +
                '</div>'
              : (r.new_value ? '<div style="font-size:.78rem;color:var(--muted);margin-top:2px">' + esc(String(r.new_value).slice(0,120)) + '</div>' : '')) +
          '</div>' +

          // Right: who + when + device
          '<div style="min-width:130px;text-align:right;flex-shrink:0">' +
            '<div style="font-size:.8rem;font-weight:700;color:var(--ink)">' + esc(r.username) + '</div>' +
            '<div style="font-size:.72rem;color:var(--muted);margin-top:1px">' + time + '</div>' +
            (ip ? '<div style="font-size:.68rem;color:var(--muted);margin-top:1px" title="' + esc(r.user_agent||"") + '">' + esc(ip) + (ua ? ' · ' + esc(ua) : '') + '</div>' : '') +
          '</div>' +

        '</div>';
      });
    });

    return html + '</div>';
  }

  ODC.ready.then(init);
}());

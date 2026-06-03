"use strict";
(function () {
  var allEvents = [], allBills = [], allPreCost = {}, allPettyCash = {}, heads = [];
  var filtered = [];
  var activeGroup = "month";

  var fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  var fmtN = (n) => fmt.format(n || 0);
  var fmtPct = (n) => (n >= 0 ? "+" : "") + (n || 0).toFixed(1) + "%";

  /* ---- Init ---- */
  function init() {
    setDefaultDates();
    loadData().then(function () {
      populateDeptFilter();
      applyFilters();
      bindEvents();
    });
  }

  function setDefaultDates() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, "0");
    document.getElementById("filterTo").value = y + "-" + m;
    var past = new Date(now);
    past.setMonth(past.getMonth() - 5);
    document.getElementById("filterFrom").value =
      past.getFullYear() + "-" + String(past.getMonth() + 1).padStart(2, "0");
  }

  async function loadData() {
    try {
      allEvents = await ODC.api("GET", "/api/events") || [];
      allBills  = await ODC.api("GET", "/api/bills") || [];
      heads     = (await ODC.api("GET", "/api/master-persons")) || [];

      // Pre-cost per event
      for (var ev of allEvents) {
        try {
          allPreCost[ev.id] = await ODC.api("GET", "/api/events/" + encodeURIComponent(ev.id) + "/pre-cost");
        } catch { allPreCost[ev.id] = null; }
      }
    } catch (e) {
      console.error("Analytics data load:", e);
    }
  }

  /* ---- Filters ---- */
  function applyFilters() {
    var from   = document.getElementById("filterFrom").value;
    var to     = document.getElementById("filterTo").value;
    var zone   = document.getElementById("filterZone").value;
    var status = document.getElementById("filterStatus").value;
    var dept   = document.getElementById("filterDept").value;

    filtered = allEvents.filter(function (ev) {
      var evMonth = (ev.date || "").slice(0, 7);
      if (from && evMonth < from) return false;
      if (to   && evMonth > to)   return false;
      if (zone   && ev.locationZone !== zone)   return false;
      if (status && ev.status      !== status)  return false;
      if (dept) {
        // Check if event has bills from this dept or petty cash from this dept
        var hasDept = allBills.some(function (b) { return b.eventClientId === ev.id && b.headId === dept; });
        if (!hasDept) return false;
      }
      return true;
    });

    renderSummary();
    renderChart();
    renderTable();
  }

  /* ---- Summary cards ---- */
  function renderSummary() {
    var revenue = 0, cost = 0, bills = 0, events = filtered.length;
    for (var ev of filtered) {
      revenue += (ev.totalBilling || 0) / 1.05; // pre-GST revenue only
      var pc = allPreCost[ev.id];
      cost += (pc && pc.totalCost) ? pc.totalCost : 0;
      bills += allBills
        .filter(function (b) { return b.eventClientId === ev.id && b.status === "approved"; })
        .reduce(function (s, b) { return s + (b.amount || 0); }, 0);
    }
    var totalCost = cost + bills;
    var pl = revenue - totalCost;
    var plPct = revenue > 0 ? (pl / revenue) * 100 : 0;

    var cards = [
      { label: "Events", value: events, color: "#059669", raw: true },
      { label: "Revenue (ex GST)", value: fmtN(revenue), color: "#3b82f6" },
      { label: "Total Cost", value: fmtN(totalCost), color: "#f59e0b" },
      { label: "Gross P&L", value: fmtN(pl), color: pl >= 0 ? "#059669" : "#dc2626" },
      { label: "P&L %", value: fmtPct(plPct), color: plPct >= 0 ? "#059669" : "#dc2626" },
      { label: "Approved Bills", value: fmtN(bills), color: "#8b5cf6" }
    ];

    var el = document.getElementById("summaryCards");
    el.innerHTML = "";
    for (var c of cards) {
      el.innerHTML += '<div class="panel" style="text-align:center;padding:1rem">' +
        '<div style="font-size:.78rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.4rem">' + c.label + '</div>' +
        '<div style="font-size:1.4rem;font-weight:800;color:' + c.color + '">' + c.value + '</div>' +
        '</div>';
    }
  }

  /* ---- Chart (pure SVG bar chart) ---- */
  function renderChart() {
    var groups = buildGroups();
    var title  = { month: "Monthly Breakdown", zone: "Zone / Location Breakdown", dept: "Department Expenses", status: "By Status" }[activeGroup];
    document.getElementById("chartTitle").textContent = title;

    if (!groups.length) {
      document.getElementById("chartArea").innerHTML = '<p class="empty-state">No data for selected filters.</p>';
      return;
    }

    var W = Math.max(groups.length * 90 + 80, 400);
    var H = 220;
    var PAD = { t: 20, r: 20, b: 60, l: 70 };
    var chartW = W - PAD.l - PAD.r;
    var chartH = H - PAD.t - PAD.b;
    var maxVal = Math.max(...groups.map(g => Math.max(g.revenue, g.cost)), 1);
    var barW   = Math.min(chartW / groups.length * 0.35, 32);

    function yScale(v) { return PAD.t + chartH - (v / maxVal) * chartH; }

    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" style="font-family:system-ui,sans-serif">';

    // Y axis gridlines + labels
    for (var i = 0; i <= 4; i++) {
      var yv = maxVal * i / 4;
      var ypx = yScale(yv);
      svg += '<line x1="' + PAD.l + '" y1="' + ypx + '" x2="' + (W - PAD.r) + '" y2="' + ypx + '" stroke="#e2e8f0" stroke-width="1"/>';
      svg += '<text x="' + (PAD.l - 6) + '" y="' + (ypx + 4) + '" text-anchor="end" font-size="10" fill="#94a3b8">' + (yv >= 1000 ? Math.round(yv / 1000) + "k" : Math.round(yv)) + '</text>';
    }

    // Bars
    groups.forEach(function (g, i) {
      var x = PAD.l + (i + 0.5) * (chartW / groups.length);
      var bx = x - barW;

      // Revenue bar
      var rh = (g.revenue / maxVal) * chartH;
      svg += '<rect x="' + bx + '" y="' + yScale(g.revenue) + '" width="' + barW + '" height="' + rh + '" fill="#3b82f6" rx="3" opacity=".85" title="Revenue: ' + fmtN(g.revenue) + '"/>';

      // Cost bar
      if (g.cost > 0) {
        var ch = (g.cost / maxVal) * chartH;
        svg += '<rect x="' + (bx + barW + 3) + '" y="' + yScale(g.cost) + '" width="' + barW + '" height="' + ch + '" fill="#f59e0b" rx="3" opacity=".85" title="Cost: ' + fmtN(g.cost) + '"/>';
      }

      // Label
      svg += '<text x="' + x + '" y="' + (H - PAD.b + 16) + '" text-anchor="middle" font-size="10" fill="#64748b">' + escX(g.label) + '</text>';
    });

    // Legend
    svg += '<rect x="' + PAD.l + '" y="' + (H - 16) + '" width="10" height="10" fill="#3b82f6" rx="2"/>';
    svg += '<text x="' + (PAD.l + 14) + '" y="' + (H - 7) + '" font-size="10" fill="#64748b">Revenue</text>';
    svg += '<rect x="' + (PAD.l + 80) + '" y="' + (H - 16) + '" width="10" height="10" fill="#f59e0b" rx="2"/>';
    svg += '<text x="' + (PAD.l + 94) + '" y="' + (H - 7) + '" font-size="10" fill="#64748b">Cost</text>';

    svg += '</svg>';
    document.getElementById("chartArea").innerHTML = svg;
  }

  function buildGroups() {
    var map = {};

    for (var ev of filtered) {
      var key;
      if      (activeGroup === "month")  key = (ev.date || "").slice(0, 7);
      else if (activeGroup === "zone")   key = ev.locationZone || "unknown";
      else if (activeGroup === "status") key = ev.status;
      else if (activeGroup === "dept") {
        var evBills = allBills.filter(function (b) { return b.eventClientId === ev.id && b.status === "approved"; });
        var deptMap = {};
        for (var b of evBills) {
          deptMap[b.headId || "direct"] = (deptMap[b.headId || "direct"] || 0) + b.amount;
        }
        for (var dk in deptMap) {
          var hname = (heads.find(function (h) { return h.id === dk; }) || { name: dk }).name;
          if (!map[dk]) map[dk] = { label: hname, revenue: 0, cost: 0 };
          map[dk].cost += deptMap[dk];
        }
        continue;
      }
      if (!key) continue;
      if (!map[key]) map[key] = { label: activeGroup === "month" ? key : key.charAt(0).toUpperCase() + key.slice(1), revenue: 0, cost: 0 };
      map[key].revenue += (ev.totalBilling || 0) / 1.05;
      var pc = allPreCost[ev.id];
      if (pc && pc.totalCost) map[key].cost += pc.totalCost;
      map[key].cost += allBills
        .filter(function (b) { return b.eventClientId === ev.id && b.status === "approved"; })
        .reduce(function (s, b) { return s + (b.amount || 0); }, 0);
    }

    return Object.keys(map).sort().map(function (k) { return map[k]; });
  }

  /* ---- Detail table ---- */
  function renderTable() {
    var head = document.getElementById("detailHead");
    var body = document.getElementById("detailBody");

    head.innerHTML = '<tr>' + ["Event", "Date", "Location", "Zone", "PAX", "Billing", "Pre-Cost", "Bills", "P&L", "Status"].map(function (h) {
      return '<th style="text-align:left;padding:8px 10px;font-size:.78rem;font-weight:600;color:var(--muted);border-bottom:1px solid var(--surface-border)">' + h + '</th>';
    }).join("") + '</tr>';

    var rows = filtered.map(function (ev) {
      var pc    = allPreCost[ev.id];
      var cost  = (pc && pc.totalCost) ? pc.totalCost : 0;
      var bills = allBills.filter(function (b) { return b.eventClientId === ev.id && b.status === "approved"; })
                          .reduce(function (s, b) { return s + (b.amount || 0); }, 0);
      var pl    = (ev.totalBilling || 0) / 1.05 - cost - bills;
      var plColor = pl >= 0 ? "#059669" : "#dc2626";
      return '<tr onclick="window.location=\'event-dashboard.html?id=' + encodeURIComponent(ev.id) + '\'" style="cursor:pointer" onmouseover="this.style.background=\'var(--surface-soft)\'" onmouseout="this.style.background=\'\'">' +
        td(ev.name) + td(ev.date || "") + td(ev.location) + td(ev.locationZone || "—") + td(ev.pax) +
        td(fmtN(ev.totalBilling / 1.05)) + td(cost ? fmtN(cost) : "—") + td(bills ? fmtN(bills) : "—") +
        '<td style="padding:8px 10px;color:' + plColor + ';font-weight:700">' + fmtN(pl) + '</td>' +
        td(ev.status) + '</tr>';
    }).join("");

    body.innerHTML = rows || '<tr><td colspan="10" style="padding:2rem;text-align:center;color:var(--muted)">No events match filters.</td></tr>';
  }

  function td(v) { return '<td style="padding:8px 10px;border-bottom:1px solid var(--surface-border);font-size:.83rem">' + escX(v) + '</td>'; }
  function escX(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  /* ---- Dept filter population ---- */
  function populateDeptFilter() {
    var sel = document.getElementById("filterDept");
    for (var h of heads) {
      sel.innerHTML += '<option value="' + escX(h.id) + '">' + escX(h.name) + '</option>';
    }
  }

  /* ---- Events ---- */
  function bindEvents() {
    document.getElementById("applyFilters").addEventListener("click", applyFilters);
    document.getElementById("resetFilters").addEventListener("click", function () {
      setDefaultDates();
      document.getElementById("filterZone").value = "";
      document.getElementById("filterStatus").value = "";
      document.getElementById("filterDept").value = "";
      applyFilters();
    });

    document.querySelectorAll(".group-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".group-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        activeGroup = btn.dataset.group;
        renderChart();
      });
    });

    document.getElementById("exportCsv").addEventListener("click", exportCsv);
  }

  function exportCsv() {
    var rows = [["Event","Date","Location","Zone","PAX","Billing","PreCost","ApprovedBills","PL","Status"]];
    for (var ev of filtered) {
      var pc   = allPreCost[ev.id];
      var cost = (pc && pc.totalCost) ? pc.totalCost : 0;
      var bills = allBills.filter(function (b) { return b.eventClientId === ev.id && b.status === "approved"; })
                          .reduce(function (s, b) { return s + b.amount; }, 0);
      var baseRev = ev.totalBilling / 1.05;
      rows.push([ev.name, ev.date, ev.location, ev.locationZone, ev.pax, Math.round(baseRev), cost, bills, Math.round(baseRev - cost - bills), ev.status]);
    }
    var csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
    var a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "odc-analytics-" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
  }

  ODC.ready.then(init);
}());

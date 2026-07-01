/* =========================================================
   analytics.js  v7 — multi-dimension analytics with Chart.js
   ========================================================= */

const AN = {
  money:   new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  compact: new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }),
  num:  (v) => Number(v) || 0,
  pct:  (n, d) => d ? Math.round((n / d) * 100) : 0,
  esc:  (v) => ODC.escapeHtml(v == null ? "" : String(v)),
  titleCase: (v) => String(v || "Unknown").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
};

const statusEl  = document.getElementById("analyticsStatus");
const contentEl = document.getElementById("analyticsContent");

let allEvents    = [];
let filterMode   = "all";
let customFrom   = "";
let customTo     = "";
let chartInstances = {};
let filterBarEl  = null;

function applyDateFilter(events) {
  const today = new Date();
  let from = null, to = null;
  if (filterMode === "3m") { from = new Date(today); from.setMonth(from.getMonth() - 3); }
  else if (filterMode === "6m") { from = new Date(today); from.setMonth(from.getMonth() - 6); }
  else if (filterMode === "1y") { from = new Date(today); from.setFullYear(from.getFullYear() - 1); }
  else if (filterMode === "custom") {
    if (customFrom) from = new Date(customFrom);
    if (customTo)   to   = new Date(customTo);
  }
  if (!from && !to) return events;
  return events.filter((ev) => {
    if (!ev.date) return false;
    const d = new Date(ev.date);
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  });
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload  = resolve;
    s.onerror = () => reject(new Error("Failed to load: " + url));
    document.head.appendChild(s);
  });
}
function loadChartJs() { return window.Chart ? Promise.resolve() : loadScript("https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"); }
function loadSheetJs() { return window.XLSX  ? Promise.resolve() : loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"); }

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
}

function groupBy(arr, keyFn) {
  const out = {};
  arr.forEach((item) => {
    const key = keyFn(item) || "Unknown";
    if (!out[key]) out[key] = { count: 0, billing: 0, pax: 0 };
    out[key].count++;
    out[key].billing += AN.num(item.totalBilling);
    out[key].pax     += AN.num(item.pax);
  });
  return out;
}

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

// Reuses the existing Chart instance (same canvas, same chart type) via .update()
// instead of destroy+recreate — avoids a full teardown/GC/repaint of every chart on
// each filter interaction, now that the surrounding shell is only built once (see render()).
function makeChart(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas || !window.Chart) return;
  const existing = chartInstances[id];
  if (existing && existing.config.type === config.type) {
    existing.data = config.data;
    existing.options = config.options;
    existing.update();
    return;
  }
  destroyChart(id);
  chartInstances[id] = new Chart(canvas.getContext("2d"), config);
}

const C = {
  blue:   "#2563eb", purple: "#7c3aed", green:  "#059669", amber:  "#d97706",
  red:    "#dc2626", slate:  "#64748b", teal:   "#0891b2", pink:   "#db2777",
  palette: ["#2563eb","#7c3aed","#059669","#d97706","#0891b2","#db2777","#dc2626","#64748b"],
  status: { open: "#2563eb", planning: "#7c3aed", completed: "#059669", cancelled: "#64748b" },
};

const CD = { responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, plugins: { legend: { labels: { font: { size: 11 }, padding: 12 } } } };

function buildFilterBar() {
  const bar = document.createElement("div");
  bar.className = "an-filter-bar";
  bar.innerHTML =
    '<div class="an-filter-pills">' +
      '<button class="an-pill an-pill-active" data-mode="all">All Time</button>' +
      '<button class="an-pill" data-mode="3m">Last 3M</button>' +
      '<button class="an-pill" data-mode="6m">Last 6M</button>' +
      '<button class="an-pill" data-mode="1y">Last 1Y</button>' +
      '<button class="an-pill" data-mode="custom">Custom</button>' +
    '</div>' +
    '<div class="an-custom-range" id="anCustomRange" hidden>' +
      '<label class="an-range-label">From <input type="date" id="anFrom" class="an-date-input"></label>' +
      '<span class="an-range-sep">-</span>' +
      '<label class="an-range-label">To <input type="date" id="anTo" class="an-date-input"></label>' +
      '<button class="primary-button an-apply-btn" id="anApply">Apply</button>' +
    '</div>' +
    '<div class="an-export-btns">' +
      '<span class="an-export-label">Export:</span>' +
      '<button class="secondary-button an-export-btn" id="exportCsv">CSV</button>' +
      '<button class="secondary-button an-export-btn" id="exportXlsx">XLSX</button>' +
      '<button class="secondary-button an-export-btn" id="exportPdf">PDF</button>' +
    '</div>';

  bar.querySelectorAll(".an-pill").forEach(function(btn) {
    btn.addEventListener("click", function() {
      bar.querySelectorAll(".an-pill").forEach(function(b) { b.classList.remove("an-pill-active"); });
      btn.classList.add("an-pill-active");
      filterMode = btn.dataset.mode;
      var range = document.getElementById("anCustomRange");
      if (range) range.hidden = filterMode !== "custom";
      if (filterMode !== "custom") render(allEvents);
    });
  });
  var applyBtn = bar.querySelector("#anApply");
  if (applyBtn) {
    applyBtn.addEventListener("click", function() {
      customFrom = (bar.querySelector("#anFrom") || {}).value || "";
      customTo   = (bar.querySelector("#anTo")   || {}).value || "";
      render(allEvents);
    });
  }
  return bar;
}

function buildShell(total) {
  return '<div class="an-page-header"><div>' +
    '<p class="eyebrow">Operational Analytics</p>' +
    '<h1 class="an-page-title">Event Intelligence</h1>' +
    '<p class="an-page-sub" id="anEventCount">' + total + ' event' + (total !== 1 ? "s" : "") + ' in selected range</p>' +
    '</div></div>' +
    '<div class="an-kpi-grid" id="anKpiGrid"></div>' +
    '<div class="an-chart-row">' +
      '<div class="an-chart-card an-chart-wide"><div class="an-chart-head"><p class="eyebrow">Revenue</p><h2>Monthly Billing Trend</h2></div><div class="an-chart-body"><canvas id="chartRevenue"></canvas></div></div>' +
      '<div class="an-chart-card"><div class="an-chart-head"><p class="eyebrow">Pipeline</p><h2>Status Distribution</h2></div><div class="an-chart-body an-doughnut-body"><canvas id="chartStatus"></canvas></div></div>' +
    '</div>' +
    '<div class="an-chart-row">' +
      '<div class="an-chart-card"><div class="an-chart-head"><p class="eyebrow">Scale</p><h2>PAX Size Buckets</h2></div><div class="an-chart-body"><canvas id="chartPax"></canvas></div></div>' +
      '<div class="an-chart-card"><div class="an-chart-head"><p class="eyebrow">Value</p><h2>Billing Tier Mix</h2></div><div class="an-chart-body an-doughnut-body"><canvas id="chartBillingTier"></canvas></div></div>' +
      '<div class="an-chart-card"><div class="an-chart-head"><p class="eyebrow">Menu</p><h2>Food Preference</h2></div><div class="an-chart-body"><canvas id="chartFood"></canvas></div></div>' +
    '</div>' +
    '<div class="an-chart-row">' +
      '<div class="an-chart-card an-chart-wide"><div class="an-chart-head"><p class="eyebrow">Volume</p><h2>Monthly Count &amp; Avg Revenue</h2></div><div class="an-chart-body an-chart-body-tall"><canvas id="chartMonthCount"></canvas></div></div>' +
      '<div class="an-chart-card"><div class="an-chart-head"><p class="eyebrow">Geography</p><h2>Zone Billing</h2></div><div class="an-chart-body"><canvas id="chartZone"></canvas></div></div>' +
    '</div>' +
    '<div class="an-table-card" id="anOverdueSection" style="display:none"><div class="an-chart-head"><p class="eyebrow">Risk</p><h2>Overdue Payment Cycles</h2></div><div id="anOverdueBody"></div></div>' +
    '<div class="an-table-card"><div class="an-chart-head"><p class="eyebrow">Leaderboard</p><h2>Top 20 Events by Billing</h2></div><div id="anTopBody"></div></div>';
}

let shellBuilt = false;
let currentFiltered = [];
let tabsBarEl = null;
let insightsBuilt = false;

function buildTabsBar() {
  var bar = document.createElement("div");
  bar.className = "admin-tabs an-tabs";
  bar.innerHTML =
    '<button type="button" class="admin-tab active" data-tab="charts">Charts</button>' +
    '<button type="button" class="admin-tab" data-tab="insights">Insights</button>';
  bar.addEventListener("click", function(e) {
    var btn = e.target.closest(".admin-tab");
    if (!btn) return;
    bar.querySelectorAll(".admin-tab").forEach(function(b) { b.classList.remove("active"); });
    btn.classList.add("active");
    var tab = btn.dataset.tab;
    var chartsPanel = document.getElementById("anChartsPanel");
    var insightsPanel = document.getElementById("anInsightsPanel");
    if (chartsPanel) chartsPanel.hidden = tab !== "charts";
    if (insightsPanel) {
      insightsPanel.hidden = tab !== "insights";
      if (tab === "insights" && !insightsBuilt) {
        insightsBuilt = true;
        buildInsights(allEvents);
      }
    }
  });
  return bar;
}

function render(events) {
  var filtered = applyDateFilter(events);
  currentFiltered = filtered;
  statusEl.hidden = true;
  if (!shellBuilt) {
    contentEl.innerHTML = '<div id="anChartsPanel">' + buildShell(filtered.length) + '</div><div id="anInsightsPanel" hidden></div>';
    shellBuilt = true;
    bindExport();
  } else {
    var countEl = document.getElementById("anEventCount");
    if (countEl) countEl.textContent = filtered.length + " event" + (filtered.length !== 1 ? "s" : "") + " in selected range";
  }
  buildKpis(filtered);
  buildRevenueChart(filtered);
  buildStatusChart(filtered);
  buildPaxChart(filtered);
  buildBillingTierChart(filtered);
  buildFoodChart(filtered);
  buildMonthCountChart(filtered);
  buildZoneChart(filtered);
  buildOverdueTable(filtered);
  buildTopEventsTable(filtered);
}

function buildKpis(filtered) {
  var grid = document.getElementById("anKpiGrid");
  if (!grid) return;
  var totalBilling = filtered.reduce(function(s, e) { return s + AN.num(e.totalBilling); }, 0);
  var totalPax     = filtered.reduce(function(s, e) { return s + AN.num(e.pax); }, 0);
  var completed    = filtered.filter(function(e) { return e.status === "completed"; });
  var active       = filtered.filter(function(e) { return e.status === "open" || e.status === "planning"; });
  var cancelled    = filtered.filter(function(e) { return e.status === "cancelled"; });
  var today        = new Date().toISOString().slice(0, 10);
  var overdueCycles = filtered.reduce(function(acc, e) {
    (e.paymentSchedule || []).forEach(function(c) { if (c.dueDate && c.dueDate < today) acc.push(c); });
    return acc;
  }, []);
  var overdueAmt  = overdueCycles.reduce(function(s, c) { return s + AN.num(c.amount); }, 0);
  var activeBilling = active.reduce(function(s, e) { return s + AN.num(e.totalBilling); }, 0);
  var avgPax     = filtered.length ? Math.round(totalPax / filtered.length) : 0;
  var avgBilling = filtered.length ? Math.round(totalBilling / filtered.length) : 0;

  grid.innerHTML = [
    kpi("Total Billing",    AN.money.format(totalBilling),  filtered.length + " events in range",          ""),
    kpi("Avg / Event",      AN.money.format(avgBilling),    "average billing per event",                   ""),
    kpi("Total PAX",        totalPax.toLocaleString("en-IN"), avgPax + " avg per event",                   ""),
    kpi("Avg PAX / Event",  String(avgPax),                 "average headcount",                           ""),
    kpi("Completion Rate",  AN.pct(completed.length, filtered.length) + "%", completed.length + " of " + filtered.length + " completed", completed.length > 0 ? "good" : ""),
    kpi("Active Pipeline",  AN.money.format(activeBilling), active.length + " active events",              active.length > 0 ? "focus" : ""),
    kpi("Overdue Exposure", AN.money.format(overdueAmt),    overdueCycles.length + " overdue cycles",     overdueAmt > 0 ? "risk" : "ok"),
    kpi("Cancelled",        String(cancelled.length),       AN.pct(cancelled.length, filtered.length) + "% of total", cancelled.length > 0 ? "muted" : "ok"),
  ].join("");
}

function kpi(label, value, sub, tone) {
  return '<div class="an-kpi' + (tone ? " an-kpi-" + tone : "") + '">' +
    '<span class="an-kpi-label">' + AN.esc(label) + '</span>' +
    '<strong class="an-kpi-value">' + AN.esc(value) + '</strong>' +
    '<span class="an-kpi-sub">' + AN.esc(sub) + '</span>' +
    '</div>';
}

function buildRevenueChart(events) {
  var byMonth = groupBy(events.filter(function(e) { return !!e.date; }), function(e) { return e.date.slice(0, 7); });
  var months  = Object.keys(byMonth).sort().slice(-18);
  makeChart("chartRevenue", {
    type: "bar",
    data: { labels: months.map(monthLabel), datasets: [{ label: "Monthly Billing", data: months.map(function(m) { return byMonth[m].billing; }), backgroundColor: C.blue + "bb", borderColor: C.blue, borderWidth: 1, borderRadius: 5 }] },
    options: { ...CD, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return AN.money.format(ctx.raw); } } } }, scales: { y: { ticks: { callback: function(v) { return AN.compact.format(v); } }, grid: { color: "rgba(0,0,0,0.05)" } }, x: { grid: { display: false } } } }
  });
}

function buildStatusChart(events) {
  var byStatus = groupBy(events, function(e) { return e.status || "open"; });
  var labels   = Object.keys(byStatus);
  makeChart("chartStatus", {
    type: "doughnut",
    data: { labels: labels.map(AN.titleCase), datasets: [{ data: labels.map(function(l) { return byStatus[l].count; }), backgroundColor: labels.map(function(l) { return C.status[l] || C.slate; }), borderWidth: 2, borderColor: "#fff" }] },
    options: { ...CD, cutout: "68%", plugins: { legend: { position: "bottom", labels: { padding: 14, font: { size: 11 } } }, tooltip: { callbacks: { label: function(ctx) { return ctx.label + ": " + ctx.raw + " events"; } } } } }
  });
}

function buildPaxChart(events) {
  var buckets = { "< 50": 0, "50-100": 0, "101-200": 0, "201-500": 0, "500+": 0 };
  events.forEach(function(e) {
    var p = AN.num(e.pax);
    if (p < 50) buckets["< 50"]++; else if (p <= 100) buckets["50-100"]++; else if (p <= 200) buckets["101-200"]++; else if (p <= 500) buckets["201-500"]++; else buckets["500+"]++;
  });
  makeChart("chartPax", {
    type: "bar",
    data: { labels: Object.keys(buckets), datasets: [{ label: "Events", data: Object.values(buckets), backgroundColor: C.palette.slice(0,5).map(function(c){return c+"bb";}), borderColor: C.palette.slice(0,5), borderWidth: 1, borderRadius: 4 }] },
    options: { ...CD, indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return ctx.raw + " events"; } } } }, scales: { x: { ticks: { stepSize: 1 }, grid: { color: "rgba(0,0,0,0.05)" } }, y: { grid: { display: false } } } }
  });
}

function buildBillingTierChart(events) {
  var tiers = { "< 1L": 0, "1L-5L": 0, "5L-10L": 0, "10L+": 0 };
  events.forEach(function(e) {
    var b = AN.num(e.totalBilling);
    if (b < 100000) tiers["< 1L"]++; else if (b < 500000) tiers["1L-5L"]++; else if (b < 1000000) tiers["5L-10L"]++; else tiers["10L+"]++;
  });
  makeChart("chartBillingTier", {
    type: "doughnut",
    data: { labels: Object.keys(tiers), datasets: [{ data: Object.values(tiers), backgroundColor: [C.slate+"cc", C.blue+"cc", C.purple+"cc", C.green+"cc"], borderWidth: 2, borderColor: "#fff" }] },
    options: { ...CD, cutout: "68%", plugins: { legend: { position: "bottom", labels: { padding: 14, font: { size: 11 } } }, tooltip: { callbacks: { label: function(ctx) { return ctx.label + ": " + ctx.raw + " events"; } } } } }
  });
}

function buildFoodChart(events) {
  var byFood = groupBy(events, function(e) { return e.foodType || "not-set"; });
  var labels = Object.keys(byFood);
  makeChart("chartFood", {
    type: "bar",
    data: { labels: labels.map(AN.titleCase), datasets: [{ label: "Events", data: labels.map(function(l){return byFood[l].count;}), backgroundColor: [C.green+"bb",C.amber+"bb",C.purple+"bb",C.slate+"bb"], borderColor: [C.green,C.amber,C.purple,C.slate], borderWidth: 1, borderRadius: 4 }] },
    options: { ...CD, indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return ctx.raw + " events"; } } } }, scales: { x: { ticks: { stepSize: 1 }, grid: { color: "rgba(0,0,0,0.05)" } }, y: { grid: { display: false } } } }
  });
}

function buildMonthCountChart(events) {
  var byMonth = groupBy(events.filter(function(e){return !!e.date;}), function(e){return e.date.slice(0,7);});
  var months  = Object.keys(byMonth).sort().slice(-18);
  makeChart("chartMonthCount", {
    type: "bar",
    data: {
      labels: months.map(monthLabel),
      datasets: [
        { type: "bar",  label: "Event Count", data: months.map(function(m){return byMonth[m].count;}),   backgroundColor: C.purple+"88", borderColor: C.purple, borderWidth: 1, borderRadius: 4, yAxisID: "yCount" },
        { type: "line", label: "Avg Billing",  data: months.map(function(m){return byMonth[m].count ? byMonth[m].billing/byMonth[m].count : 0;}), borderColor: C.amber, backgroundColor: C.amber+"22", borderWidth: 2, pointRadius: 4, pointBackgroundColor: C.amber, tension: 0.4, fill: true, yAxisID: "yAvg" }
      ]
    },
    options: {
      ...CD,
      plugins: { legend: { position: "top", labels: { padding: 14, font: { size: 11 } } }, tooltip: { callbacks: { label: function(ctx) { return ctx.dataset.yAxisID === "yAvg" ? AN.money.format(ctx.raw) : ctx.raw + " events"; } } } },
      scales: { yCount: { position: "left", ticks: { stepSize: 1 }, grid: { color: "rgba(0,0,0,0.05)" } }, yAvg: { position: "right", ticks: { callback: function(v){return AN.compact.format(v);} }, grid: { drawOnChartArea: false } }, x: { grid: { display: false } } }
    }
  });
}

function buildZoneChart(events) {
  var byZone = groupBy(events, function(e){return e.locationZone || "not-set";});
  var labels = Object.keys(byZone).sort(function(a,b){return byZone[b].billing-byZone[a].billing;});
  makeChart("chartZone", {
    type: "bar",
    data: { labels: labels.map(AN.titleCase), datasets: [{ label: "Billing", data: labels.map(function(l){return byZone[l].billing;}), backgroundColor: C.teal+"bb", borderColor: C.teal, borderWidth: 1, borderRadius: 4 }] },
    options: { ...CD, indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx){return AN.money.format(ctx.raw);} } } }, scales: { x: { ticks: { callback: function(v){return AN.compact.format(v);} }, grid: { color: "rgba(0,0,0,0.05)" } }, y: { grid: { display: false } } } }
  });
}

function buildOverdueTable(events) {
  var body    = document.getElementById("anOverdueBody");
  var section = document.getElementById("anOverdueSection");
  if (!body || !section) return;
  var today = new Date().toISOString().slice(0, 10);
  var overdue = [];
  events.forEach(function(e) {
    (e.paymentSchedule || []).forEach(function(c) { if (c.dueDate && c.dueDate < today) overdue.push({ event: e, cycle: c }); });
  });
  overdue.sort(function(a,b){ return String(a.cycle.dueDate).localeCompare(String(b.cycle.dueDate)); });
  if (!overdue.length) { section.style.display = "none"; return; }
  section.style.display = "";
  var total = overdue.reduce(function(s,item){return s+AN.num(item.cycle.amount);}, 0);
  var rows = overdue.map(function(item) {
    var ev = item.event; var cycle = item.cycle;
    return '<tr><td>' + AN.esc(ev.name||ev.id) + '</td><td>' + AN.esc(cycle.label||"Payment") + '</td>' +
      '<td class="bad-text">' + AN.esc(ODC.isoToDmy(cycle.dueDate)) + '</td>' +
      '<td class="an-cell-money bad-text">' + AN.money.format(AN.num(cycle.amount)) + '</td>' +
      '<td><span class="status-badge status-' + AN.esc(ev.status||"open") + '">' + AN.titleCase(ev.status||"open") + '</span></td>' +
      '<td><a href="financial-control.html?event=' + encodeURIComponent(ev.id) + '" class="secondary-button an-table-link">View</a></td></tr>';
  }).join("");
  body.innerHTML = '<p class="an-overdue-total">Total overdue: <strong class="bad-text">' + AN.money.format(total) + '</strong> across ' + overdue.length + ' cycle' + (overdue.length!==1?"s":"") + '</p>' +
    '<div class="responsive-table"><table class="dash-table"><thead><tr><th>Event</th><th>Cycle</th><th>Due Date</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function buildTopEventsTable(events) {
  var body = document.getElementById("anTopBody");
  if (!body) return;
  var top = events.slice().sort(function(a,b){return AN.num(b.totalBilling)-AN.num(a.totalBilling);}).slice(0,20);
  if (!top.length) { body.innerHTML = '<p class="form-status">No events in this range.</p>'; return; }
  var rows = top.map(function(e,i) {
    return '<tr><td class="an-rank">'+(i+1)+'</td>' +
      '<td>'+AN.esc(e.name||e.id)+'</td>' +
      '<td>'+AN.esc(ODC.isoToDmy(e.date||""))+'</td>' +
      '<td class="an-cell-num">'+AN.esc(String(e.pax||"—"))+'</td>' +
      '<td>'+AN.esc(AN.titleCase(e.locationZone||e.location||"unknown"))+'</td>' +
      '<td class="an-cell-money">'+AN.money.format(AN.num(e.totalBilling))+'</td>' +
      '<td><span class="status-badge status-'+AN.esc(e.status||"open")+'">'+AN.titleCase(e.status||"open")+'</span></td>' +
      '<td><a href="financial-control.html?event='+encodeURIComponent(e.id)+'" class="secondary-button an-table-link">View</a></td></tr>';
  }).join("");
  body.innerHTML = '<div class="responsive-table"><table class="dash-table"><thead><tr><th>#</th><th>Event</th><th>Date</th><th>PAX</th><th>Zone</th><th>Billing</th><th>Status</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

function toExportRows(events) {
  return events.map(function(e) {
    return {
      "Event ID": e.externalId||e.id||"", "Event Name": e.name||"", "Date": ODC.isoToDmy(e.date||""),
      "PAX": AN.num(e.pax), "Days": AN.num(e.days)||1, "Cost/PAX": AN.num(e.costPerPax),
      "Total Billing (INR)": AN.num(e.totalBilling), "Status": e.status||"open",
      "Zone": e.locationZone||"", "Location": e.location||"", "Food Type": e.foodType||"",
      "Scheduled (INR)": (e.paymentSchedule||[]).reduce(function(s,c){return s+AN.num(c.amount);},0)
    };
  });
}

function exportCsv(events) {
  var rows = toExportRows(events);
  if (!rows.length) return;
  var headers = Object.keys(rows[0]);
  var csv = [headers.join(",")].concat(rows.map(function(r) {
    return headers.map(function(h) { return '"'+String(r[h]).replace(/"/g,'""')+'"'; }).join(",");
  })).join("\n");
  var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a"); a.href = url; a.download = "odc-analytics.csv"; a.click();
  URL.revokeObjectURL(url);
}

async function exportXlsx(events) {
  var btn = document.getElementById("exportXlsx");
  var orig = btn ? btn.textContent : "XLSX";
  if (btn) btn.textContent = "Loading...";
  try {
    await loadSheetJs();
    var rows = toExportRows(events);
    var ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0]||{}).map(function(k){ return { wch: Math.max(k.length,12) }; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Analytics");
    XLSX.writeFile(wb, "odc-analytics.xlsx");
  } catch(err) { alert("XLSX export failed: " + err.message); }
  finally { if (btn) btn.textContent = orig; }
}

function exportPdf() { window.print(); }

// ── Insights tab (pure rule-based thresholds over already-cached data — no AI API) ──
function periodEvents(events, monthsBack, offsetMonths) {
  var today = new Date();
  var to = new Date(today); to.setMonth(to.getMonth() - offsetMonths);
  var from = new Date(to); from.setMonth(from.getMonth() - monthsBack);
  return events.filter(function(e) {
    if (!e.date) return false;
    var d = new Date(e.date);
    return d >= from && d < to;
  });
}

function pctChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function insightCard(text, tone) {
  return '<div class="an-insight-card' + (tone ? " an-insight-" + tone : "") + '">' + AN.esc(text) + '</div>';
}

function buildInsights(events) {
  var panel = document.getElementById("anInsightsPanel");
  if (!panel) return;

  // Fixed rolling window (last 3 months vs prior 3), independent of the Charts tab's
  // filter pills — insights need a stable, always-comparable baseline.
  var current  = periodEvents(events, 3, 0);
  var previous = periodEvents(events, 3, 3);
  var cards = [];

  var curBilling  = current.reduce(function(s,e){ return s + AN.num(e.totalBilling); }, 0);
  var prevBilling = previous.reduce(function(s,e){ return s + AN.num(e.totalBilling); }, 0);
  if (previous.length) {
    var billingDelta = pctChange(curBilling, prevBilling);
    cards.push(insightCard(
      "Billing is " + (billingDelta >= 0 ? "up" : "down") + " " + Math.abs(billingDelta) +
      "% vs the prior 3 months (" + AN.money.format(curBilling) + " vs " + AN.money.format(prevBilling) + ").",
      billingDelta >= 0 ? "good" : "risk"
    ));
  }

  var curZone  = groupBy(current, function(e){ return e.locationZone || "not-set"; });
  var prevZone = groupBy(previous, function(e){ return e.locationZone || "not-set"; });
  Object.keys(curZone).forEach(function(zone) {
    var prevZoneBilling = (prevZone[zone] || { billing: 0 }).billing;
    if (prevZoneBilling <= 0) return;
    var delta = pctChange(curZone[zone].billing, prevZoneBilling);
    if (Math.abs(delta) >= 25) {
      cards.push(insightCard(
        AN.titleCase(zone) + " billing " + (delta >= 0 ? "up" : "down") + " " + Math.abs(delta) + "% vs the prior 3 months.",
        delta >= 0 ? "good" : "risk"
      ));
    }
  });

  var curStatus = groupBy(current, function(e){ return e.status || "open"; });
  var cancelledCount = curStatus.cancelled ? curStatus.cancelled.count : 0;
  if (current.length && AN.pct(cancelledCount, current.length) >= 15) {
    cards.push(insightCard(AN.pct(cancelledCount, current.length) + "% of events in the last 3 months were cancelled.", "risk"));
  }

  var curAvgPax  = current.length  ? current.reduce(function(s,e){ return s + AN.num(e.pax); }, 0) / current.length : 0;
  var prevAvgPax = previous.length ? previous.reduce(function(s,e){ return s + AN.num(e.pax); }, 0) / previous.length : 0;
  if (previous.length && prevAvgPax > 0) {
    var paxDelta = pctChange(curAvgPax, prevAvgPax);
    if (Math.abs(paxDelta) >= 15) {
      cards.push(insightCard(
        "Average event size is " + (paxDelta >= 0 ? "up" : "down") + " " + Math.abs(paxDelta) +
        "% (" + Math.round(curAvgPax) + " vs " + Math.round(prevAvgPax) + " avg PAX).", ""
      ));
    }
  }

  if (!cards.length) {
    cards.push(insightCard("Not enough data in the last 3 months to surface trends yet.", ""));
  }

  panel.innerHTML = '<div class="an-insights-grid">' + cards.join("") + '</div>' +
    '<div class="an-budget-insights"><button type="button" class="secondary-button" id="anLoadBudget">Load Budget Insights</button>' +
    '<div id="anBudgetResult"></div></div>';

  var loadBtn = document.getElementById("anLoadBudget");
  if (loadBtn) loadBtn.addEventListener("click", function() { loadBudgetInsights(currentFiltered.length ? currentFiltered : events); });
}

// Manual, opt-in only — fans out per-event API calls (pre-cost/petty-cash/in-house),
// which the Charts tab intentionally never does automatically (Apps Script quota risk).
async function loadBudgetInsights(events) {
  var resultEl = document.getElementById("anBudgetResult");
  var btn = document.getElementById("anLoadBudget");
  if (!resultEl || !btn) return;
  var CAP = 40;
  var targets = events.filter(function(e){ return e.status !== "cancelled"; }).slice(0, CAP);
  btn.disabled = true;
  btn.textContent = "Loading…";
  resultEl.innerHTML = "";
  try {
    var bills = (await ODC.api("GET", "/api/bills")) || [];
    var rows = await Promise.all(targets.map(async function(ev) {
      var preCost, petty, inHouse;
      try {
        var results = await Promise.all([
          ODC.api("GET", "/api/events/" + encodeURIComponent(ev.id) + "/pre-cost").catch(function(){ return {}; }),
          ODC.api("GET", "/api/events/" + encodeURIComponent(ev.id) + "/petty-cash").catch(function(){ return { payouts: [], petty: [] }; }),
          ODC.api("GET", "/api/events/" + encodeURIComponent(ev.id) + "/in-house-charges").catch(function(){ return []; })
        ]);
        preCost = results[0]; petty = results[1]; inHouse = results[2];
      } catch { preCost = {}; petty = { payouts: [], petty: [] }; inHouse = []; }
      var eventBills = bills.filter(function(b){ return b.eventClientId === ev.id || b.eventName === ev.name; });
      var approvedBillTotal = eventBills.filter(function(b){ return b.status === "approved"; }).reduce(function(s,b){ return s + AN.num(b.amount); }, 0);
      var directPettyTotal = (petty.petty || []).reduce(function(s,r){ return s + AN.num(r.amount); }, 0);
      var inHouseTotal = (inHouse || []).reduce(function(s,r){ return s + AN.num(r.amount); }, 0);
      var actualCost = approvedBillTotal + directPettyTotal + inHouseTotal;
      var preCostTotal = AN.num(preCost.totalCost);
      return { ev: ev, preCostTotal: preCostTotal, actualCost: actualCost, overspend: preCostTotal > 0 && actualCost > preCostTotal };
    }));
    var overBudget = rows.filter(function(r){ return r.overspend; });
    if (overBudget.length) {
      resultEl.innerHTML = '<div class="an-insights-grid">' + overBudget.map(function(r) {
        return insightCard((r.ev.name || r.ev.id) + ": actual cost " + AN.money.format(r.actualCost) + " vs budget " + AN.money.format(r.preCostTotal), "risk");
      }).join("") + '</div>';
    } else {
      resultEl.innerHTML = '<p class="form-status">No events over budget' + (targets.length < events.length ? " (checked first " + CAP + " events)" : "") + '.</p>';
    }
  } catch (err) {
    resultEl.textContent = "Could not load budget insights: " + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Load Budget Insights";
  }
}

function bindExport() {
  var c = document.getElementById("exportCsv");
  var x = document.getElementById("exportXlsx");
  var p = document.getElementById("exportPdf");
  if (c) c.addEventListener("click", function(){ exportCsv(currentFiltered); });
  if (x) x.addEventListener("click", function(){ exportXlsx(currentFiltered); });
  if (p) p.addEventListener("click", exportPdf);
}

async function init() {
  try { await loadChartJs(); }
  catch(err) {
    statusEl.textContent = "Charts unavailable (CDN unreachable). Tables still shown.";
    statusEl.hidden = false;
  }
  if (!filterBarEl) {
    filterBarEl = buildFilterBar();
    contentEl.parentNode.insertBefore(filterBarEl, contentEl);
  }
  if (!tabsBarEl) {
    tabsBarEl = buildTabsBar();
    contentEl.parentNode.insertBefore(tabsBarEl, contentEl);
  }
  allEvents = getSavedEvents();
  render(allEvents);
}

function reload() {
  allEvents = getSavedEvents();
  render(allEvents);
  var insightsPanel = document.getElementById("anInsightsPanel");
  if (insightsPanel && !insightsPanel.hidden) buildInsights(allEvents);
  else insightsBuilt = false;
}

ODC.ready.then(init);
ODC.registerSync(reload);

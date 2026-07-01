const TYPE_LABELS = {
  payment_received: "Payment Received",
  petty_cash_ack: "Petty Cash Ack",
  daily_digest: "Daily Digest",
  test: "Test"
};

const contentEl = document.getElementById("mailCenterContent");
const statusEl = document.getElementById("mailCenterStatus");
const quotaGrid = document.getElementById("mailQuotaGrid");

let renderFrame = 0;
let renderToken = 0;
let lastRenderKey = "";
let allRows = [];

async function api(method, path, body) {
  const res = await fetch(path.replace(/^\//, ""), {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
}

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = "form-status" + (isError ? " error" : "");
  statusEl.hidden = !msg;
}

async function loadQuota() {
  try {
    const status = await api("GET", "/api/admin/status");
    quotaGrid.innerHTML = "";
    [
      ["Mail Quota Remaining Today", status.mailRemainingDailyQuota],
      ["Script Timezone", status.scriptTimeZone]
    ].forEach(([label, value]) => {
      const card = document.createElement("div");
      card.className = "financial-metric";
      const span = document.createElement("span");
      span.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = value == null ? "—" : String(value);
      card.append(span, strong);
      quotaGrid.append(card);
    });
  } catch (err) {
    quotaGrid.textContent = "";
  }
}

function buildFilterRow() {
  const filterRow = document.createElement("div");
  filterRow.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;align-items:flex-end";

  const typeLbl = document.createElement("label");
  typeLbl.className = "field";
  typeLbl.style.flex = "1 1 160px";
  const typeSpan = document.createElement("span");
  typeSpan.textContent = "Type";
  const typeSel = document.createElement("select");
  typeSel.id = "mailType";
  [["", "All"], ["payment_received", "Payment Received"], ["petty_cash_ack", "Petty Cash Ack"], ["daily_digest", "Daily Digest"], ["test", "Test"]]
    .forEach(([v, t]) => {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = t;
      typeSel.append(opt);
    });
  typeLbl.append(typeSpan, typeSel);
  filterRow.append(typeLbl);

  [["mailFrom", "From Date"], ["mailTo", "To Date"]].forEach(([id, label]) => {
    const lbl = document.createElement("label");
    lbl.className = "field";
    lbl.style.flex = "1 1 160px";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("input");
    input.type = "date";
    input.id = id;
    lbl.append(span, input);
    filterRow.append(lbl);
  });

  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "primary-button";
  searchBtn.style.alignSelf = "flex-end";
  searchBtn.textContent = "Search";
  searchBtn.addEventListener("click", fetchAndRender);
  filterRow.append(searchBtn);

  return filterRow;
}

async function fetchAndRender() {
  const type = document.getElementById("mailType")?.value || "";
  const from = document.getElementById("mailFrom")?.value || "";
  const to = document.getElementById("mailTo")?.value || "";
  const q = new URLSearchParams({ limit: "200" });
  if (type) q.set("type", type);
  if (from) q.set("from", from);
  if (to) q.set("to", to);

  const wrap = document.getElementById("mailTableWrap");
  if (wrap && !wrap.querySelector("table")) wrap.textContent = "Loading…";

  try {
    allRows = await api("GET", "/api/mail-log?" + q.toString());
    lastRenderKey = "";
    scheduleRender();
  } catch (err) {
    if (wrap) wrap.textContent = "Error: " + err.message;
  }
}

function scheduleRender() {
  if (renderFrame) cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    renderTable();
  });
}

function ensureTable() {
  const wrap = document.getElementById("mailTableWrap");
  if (!wrap) return null;
  let table = document.getElementById("mailTable");
  if (table) return table;
  wrap.innerHTML = "";
  table = document.createElement("table");
  table.id = "mailTable";
  table.className = "dash-table";
  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  ["Sent At", "Type", "To", "Context", "Sent By", "Status"].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    hrow.append(th);
  });
  thead.append(hrow);
  table.append(thead, document.createElement("tbody"));
  wrap.append(table);
  return table;
}

function mailRow(entry) {
  const tr = document.createElement("tr");
  const cells = [
    formatDateTime(entry.sentAt),
    TYPE_LABELS[entry.type] || entry.type,
    entry.to || "-",
    entry.context || "-",
    entry.sentBy || "-",
    null
  ];
  cells.forEach((v, i) => {
    const td = document.createElement("td");
    if (i === 5) {
      const badge = document.createElement("span");
      badge.className = "status-badge " + (entry.status === "failed" ? "status-badge-danger" : "status-completed");
      badge.textContent = entry.status === "failed" ? "Failed" : "Sent";
      if (entry.status === "failed" && entry.error) badge.title = entry.error;
      td.append(badge);
    } else {
      td.textContent = v;
    }
    tr.append(td);
  });
  return tr;
}

function renderTable() {
  const renderKey = String(allRows.length) + "|" + (allRows[0]?.id || "");
  if (renderKey === lastRenderKey) return;
  lastRenderKey = renderKey;
  const token = ++renderToken;

  const wrap = document.getElementById("mailTableWrap");
  if (!wrap) return;

  if (!allRows.length) {
    wrap.innerHTML = "";
    const p = document.createElement("p");
    p.className = "form-status";
    p.textContent = "No mail sent yet.";
    wrap.append(p);
    return;
  }

  const table = ensureTable();
  const tbody = table?.querySelector("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const batchSize = 30;
  let index = 0;
  function appendBatch() {
    if (token !== renderToken) return;
    const fragment = document.createDocumentFragment();
    const end = Math.min(index + batchSize, allRows.length);
    for (; index < end; index += 1) fragment.append(mailRow(allRows[index]));
    tbody.append(fragment);
    if (index < allRows.length) requestAnimationFrame(appendBatch);
  }
  appendBatch();
}

async function init() {
  setStatus("Loading…");
  loadQuota();
  contentEl.innerHTML = "";
  contentEl.append(buildFilterRow());
  const tableWrap = document.createElement("div");
  tableWrap.id = "mailTableWrap";
  tableWrap.className = "dash-table-wrap";
  contentEl.append(tableWrap);
  setStatus("");
  await fetchAndRender();
}

init();

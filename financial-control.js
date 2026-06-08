const moneyFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const qs = new URLSearchParams(location.search);
const eventSelect = document.querySelector("#eventSelect");
const statusBox = document.querySelector("#financialStatus");
const content = document.querySelector("#financialContent");
let events = [];

function money(value) { return moneyFmt.format(Number(value) || 0); }
function num(value) { return Number(value) || 0; }
function esc(value) { return ODC.escapeHtml(value == null ? "" : value); }
function clientEmail(ev) { return String(ev.invoiceKyc?.email || "").trim(); }
function mailSubject(ev) { return `Payment received - ${ev.name || ev.externalId || ev.id}`; }
function mailBody(ev, payment) {
  const amount = money(payment.amount);
  return [
    `Dear ${ev.invoiceKyc?.name || "Client"},`,
    "",
    `We have received your payment of ${amount} for ${ev.name || ev.id}.`,
    `Payment cycle: ${payment.cycle_name || payment.cycleName || "Payment"}`,
    `Mode: ${payment.mode || "cash"}`,
    `Received by: ${payment.received_by || ""}`,
    `Event date: ${ev.date || ""}`,
    "",
    "Regards,",
    "ODC"
  ].join("\n");
}

async function init() {
  statusBox.textContent = "Loading events...";
  events = await ODC.api("GET", "/api/events");
  events.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  eventSelect.innerHTML = events.map((ev) => `<option value="${esc(ev.id)}">${esc(ev.externalId || ev.id)} - ${esc(ev.name)} (${esc(ODC.eventContextText(ev, { includeDays: true }))})</option>`).join("");
  const requested = qs.get("event") || qs.get("id");
  if (requested && events.some((ev) => ev.id === requested)) eventSelect.value = requested;
  eventSelect.addEventListener("change", loadSelected);
  await loadSelected();
}

async function loadSelected() {
  const ev = events.find((item) => item.id === eventSelect.value);
  if (!ev) {
    statusBox.textContent = "No event selected.";
    content.hidden = true;
    return;
  }
  history.replaceState(null, "", "financial-control.html?event=" + encodeURIComponent(ev.id));
  statusBox.hidden = false;
  statusBox.textContent = "Loading financials...";
  content.hidden = true;

  const [preCost, petty, received, bills, inHouse] = await Promise.all([
    ODC.api("GET", `/api/events/${encodeURIComponent(ev.id)}/pre-cost`).catch(() => ({})),
    ODC.api("GET", `/api/events/${encodeURIComponent(ev.id)}/petty-cash`).catch(() => ({ payouts: [], petty: [] })),
    ODC.api("GET", `/api/events/${encodeURIComponent(ev.id)}/payment-received`).catch(() => []),
    ODC.api("GET", "/api/bills").catch(() => []),
    ODC.api("GET", `/api/events/${encodeURIComponent(ev.id)}/in-house-charges`).catch(() => [])
  ]);
  render(ev, preCost || {}, petty || {}, received || [], bills || [], inHouse || []);
}

function render(ev, preCost, petty, received, bills, inHouse) {
  window.__lastFinancialReceived = received;
  const eventBills = bills.filter((bill) => bill.eventClientId === ev.id || bill.eventName === ev.name);
  const approvedBills = eventBills.filter((bill) => bill.status === "approved");
  const receivedTotal = received.reduce((s, row) => s + num(row.amount), 0);
  const scheduledTotal = (ev.paymentSchedule || []).reduce((s, row) => s + num(row.amount), 0);
  const preCostTotal = num(preCost.totalCost);
  const payoutTotal = (petty.payouts || []).reduce((s, row) => s + num(row.amount), 0);
  const directPettyTotal = (petty.petty || []).reduce((s, row) => s + num(row.amount), 0);
  const approvedBillTotal = approvedBills.reduce((s, row) => s + num(row.amount), 0);
  const inHouseTotal = inHouse.reduce((s, row) => s + num(row.amount), 0);
  const billing = num(ev.totalBilling);
  const actualCost = approvedBillTotal + directPettyTotal + inHouseTotal;
  const balance = billing - receivedTotal;
  const plannedPL = billing - preCostTotal;
  const actualPL  = billing - actualCost;

  content.innerHTML = `
    <!-- Event header -->
    <div class="fc-event-header">
      <div class="fc-event-meta">
        <p class="eyebrow">${esc(ev.externalId || ev.id)}</p>
        <h2>${esc(ev.name)}</h2>
        <p class="fc-event-sub">${esc(ODC.eventContextText(ev, { includeDays: true }))} &nbsp;·&nbsp; ${esc(ev.location || "")}</p>
      </div>
      <a class="secondary-button" href="event-dashboard.html?id=${encodeURIComponent(ev.id)}">Event Dashboard →</a>
    </div>

    <!-- KPI groups -->
    <div class="fc-kpi-groups">
      <div class="fc-kpi-group">
        <p class="fc-kpi-group-label">Billing &amp; Payments</p>
        <div class="fc-kpi-row">
          ${metric("Total Billing", billing)}
          ${metric("Scheduled", scheduledTotal)}
          ${metric("Received", receivedTotal, "good")}
          ${metric("Balance Due", balance, balance > 0 ? "bad" : "good")}
        </div>
      </div>
      <div class="fc-kpi-group">
        <p class="fc-kpi-group-label">Cost &amp; Profitability</p>
        <div class="fc-kpi-row">
          ${metric("Pre-Cost Plan", preCostTotal)}
          ${metric("Actual Cost", actualCost)}
          ${metric("Planned P&L", plannedPL, plannedPL >= 0 ? "good" : "bad")}
          ${metric("Actual P&L",  actualPL,  actualPL  >= 0 ? "good" : "bad")}
        </div>
      </div>
    </div>

    <!-- Payment received -->
    <div class="fc-card">
      <div class="fc-card-head">
        <div><p class="eyebrow">Collections</p><h3>Payment Received From Client</h3></div>
        <span class="fc-badge">${money(receivedTotal)} received</span>
      </div>
      <div class="financial-mail-context">
        <div><span>Mail From</span><strong>cateringbookends@gmail.com</strong></div>
        <div><span>Default Mail To</span><strong>${clientEmail(ev) ? esc(clientEmail(ev)) : "No client email saved"}</strong></div>
        <div><span>Subject</span><strong>${esc(mailSubject(ev))}</strong></div>
      </div>
      <div class="responsive-table"><table><thead><tr><th>Cycle</th><th>Amount</th><th>Mode</th><th>Received By</th><th>Date</th><th>Mail To</th><th>Mail</th></tr></thead><tbody>${received.length ? received.map((row) => paymentRow(row, ev)).join("") : `<tr><td colspan="7">No payment received yet.</td></tr>`}</tbody></table></div>
    </div>

    <!-- Record payment -->
    <div class="fc-card">
      <div class="fc-card-head">
        <div><p class="eyebrow">Add Entry</p><h3>Record Payment</h3></div>
        <span class="fc-badge fc-badge-muted">Sales by default, others allowed</span>
      </div>
      <form class="financial-form fc-inline-form" id="paymentForm">
        <label><span>Cycle</span><select id="payCycle">${(ev.paymentSchedule || []).map((c, i) => `<option value="${i}" data-amount="${num(c.amount)}">${esc(c.label || "Payment")} - ${money(c.amount)}</option>`).join("") || `<option value="0" data-amount="0">Payment</option>`}</select></label>
        <label><span>Amount</span><input id="payAmount" type="number" min="1" step="1" required></label>
        <label><span>Mode</span><select id="payMode"><option value="cash">Cash</option><option value="online">Online</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
        <label><span>Received Type</span><select id="payReceiverType"><option value="sales">Sales</option><option value="other">Other</option></select></label>
        <label><span>Received By</span><input id="payReceiver" placeholder="Name"></label>
        <label><span>Notes</span><input id="payNotes" placeholder="Reference / remarks"></label>
        <button class="primary-button fc-form-btn" type="submit">Save</button>
      </form>
    </div>

    <!-- Petty cash -->
    <div class="fc-card">
      <div class="fc-card-head">
        <div><p class="eyebrow">Staff &amp; Field</p><h3>Petty Cash By Person</h3></div>
        <span class="fc-badge">${money(payoutTotal)} assigned</span>
      </div>
      ${personTable(petty.payouts || [], approvedBills)}
    </div>

    <!-- In-house charges -->
    <div class="fc-card">
      <div class="fc-card-head">
        <div><p class="eyebrow">Internal</p><h3>In-House Charges</h3></div>
        <span class="fc-badge">${money(inHouseTotal)} total</span>
      </div>
      <form class="financial-form fc-inline-form" id="inHouseForm">
        <label><span>Head / Category</span><input id="ihHead" placeholder="Food, per head, other"></label>
        <label><span>Person / Unit</span><input id="ihPerson" placeholder="In-house / name"></label>
        <label><span>Amount</span><input id="ihAmount" type="number" min="1" step="1" required></label>
        <label class="financial-wide"><span>Description</span><input id="ihDescription" placeholder="Charge details"></label>
        <button class="primary-button fc-form-btn" type="submit">Add</button>
      </form>
      <div class="responsive-table"><table><thead><tr><th>Head</th><th>Person / Unit</th><th>Description</th><th>Amount</th><th>Added By</th></tr></thead><tbody>${inHouse.length ? inHouse.map((row) => `<tr><td>${esc(row.head || row.category)}</td><td>${esc(row.person || "")}</td><td>${esc(row.description || "")}</td><td>${money(row.amount)}</td><td>${esc(row.created_by || "")}</td></tr>`).join("") : `<tr><td colspan="5">No in-house charges yet.</td></tr>`}</tbody></table></div>
    </div>
  `;

  statusBox.hidden = true;
  content.hidden = false;
  bindForms(ev);
}

function metric(label, value, tone) {
  return `<div class="financial-metric ${tone || ""}"><span>${esc(label)}</span><strong>${money(value)}</strong></div>`;
}

function paymentRow(row, ev) {
  const email = row.mail_sent_to || clientEmail(ev);
  return `<tr>
    <td>${esc(row.cycle_name || row.cycleName || "Payment")}</td>
    <td>${money(row.amount)}</td>
    <td>${esc(row.mode || "cash")}</td>
    <td>${esc(row.received_by || "")}${row.receiver_type ? ` <small>(${esc(row.receiver_type)})</small>` : ""}</td>
    <td>${esc(ODC.isoToDmy(row.received_at || row.receivedAt || ""))}</td>
    <td>${email ? esc(email) : `<span class="bad-text">Missing email</span>`}${row.mail_sent_at ? `<small class="financial-mail-sent">Sent ${esc(ODC.isoToDmy(row.mail_sent_at))}</small>` : ""}</td>
    <td><button type="button" class="secondary-button financial-mail-btn" data-payment-id="${esc(row.id || "")}" data-email="${esc(email)}">${row.mail_sent_at ? "Sent" : "Preview & Send"}</button></td>
  </tr>`;
}

function personTable(payouts, approvedBills) {
  const rows = payouts.map((p) => {
    const spent = approvedBills.filter((bill) => String(bill.personName || "").toLowerCase() === String(p.person || "").toLowerCase()).reduce((s, bill) => s + num(bill.amount), 0);
    const balance = num(p.amount) - spent;
    return `<tr><td>${esc(p.person || "")}</td><td>${esc([p.headName || p.headId || "", p.purpose || ""].filter(Boolean).join(" - "))}</td><td>${money(p.amount)}</td><td>${money(spent)}</td><td class="${balance < 0 ? "bad-text" : "good-text"}">${money(balance)}</td></tr>`;
  });
  return `<div class="responsive-table"><table><thead><tr><th>Person</th><th>Purpose</th><th>Assigned</th><th>Approved Bills</th><th>Balance</th></tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="5">No assigned payouts yet.</td></tr>`}</tbody></table></div>`;
}

function bindForms(ev) {
  const cycleSelect = document.querySelector("#payCycle");
  const amountInput = document.querySelector("#payAmount");
  const setCycleAmount = () => { amountInput.value = cycleSelect.selectedOptions[0]?.dataset.amount || ""; };
  cycleSelect.addEventListener("change", setCycleAmount);
  setCycleAmount();
  document.querySelector("#payReceiver").value = window.ODC_USER?.username || "";

  document.querySelector("#paymentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const option = cycleSelect.selectedOptions[0];
    await ODC.api("POST", `/api/events/${encodeURIComponent(ev.id)}/payment-received`, {
      cycleIndex: Number(cycleSelect.value) || 0,
      cycleName: option ? option.textContent.replace(/\s+-\s+.*$/, "") : "Payment",
      amount: num(amountInput.value),
      mode: document.querySelector("#payMode").value,
      receiverType: document.querySelector("#payReceiverType").value,
      receivedBy: document.querySelector("#payReceiver").value,
      notes: document.querySelector("#payNotes").value
    });
    await loadSelected();
  });

  document.querySelector("#inHouseForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await ODC.api("POST", `/api/events/${encodeURIComponent(ev.id)}/in-house-charges`, {
      head: document.querySelector("#ihHead").value,
      person: document.querySelector("#ihPerson").value,
      amount: num(document.querySelector("#ihAmount").value),
      description: document.querySelector("#ihDescription").value
    });
    await loadSelected();
  });

  content.querySelectorAll(".financial-mail-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!btn.dataset.paymentId || btn.textContent === "Sent") return;
      const to = window.prompt("Send payment mail to:", btn.dataset.email || clientEmail(ev) || "");
      if (to === null) return;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
        alert("Enter a valid client email before sending.");
        return;
      }
      const row = (window.__lastFinancialReceived || []).find((item) => String(item.id) === String(btn.dataset.paymentId)) || {};
      const preview = `From: cateringbookends@gmail.com\nTo: ${to.trim()}\nSubject: ${mailSubject(ev)}\n\n${mailBody(ev, row)}`;
      if (!window.confirm(preview + "\n\nSend this email now?")) return;
      btn.disabled = true;
      btn.textContent = "Sending...";
      try {
        await ODC.api("POST", `/api/events/${encodeURIComponent(ev.id)}/payment-received/${encodeURIComponent(bt
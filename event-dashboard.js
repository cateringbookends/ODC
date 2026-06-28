const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const params = new URLSearchParams(location.search);
const eventId = params.get("id");
const content = document.getElementById("eventDashContent");
const statusEl = document.getElementById("evDashStatus");

if (!eventId) {
  statusEl.textContent = "No event specified. Go back to Saved Events.";
} else {
  loadDashboard();
}

if (window.ODC && eventId) {
  ODC.registerSync(() => {
    if (!document.hidden) loadDashboard();
  });
}

async function loadDashboard() {
  statusEl.textContent = "Loading event…";
  content.innerHTML = "";
  content.append(statusEl);

  try {
    const [evRes, receivedRes, preCostRes, pettyRes] = await Promise.all([
      fetch("api/events/" + encodeURIComponent(eventId), { credentials: "same-origin" }),
      fetch("api/events/" + encodeURIComponent(eventId) + "/payment-received", { credentials: "same-origin" }),
      fetch("api/events/" + encodeURIComponent(eventId) + "/pre-cost", { credentials: "same-origin" }),
      fetch("api/events/" + encodeURIComponent(eventId) + "/petty-cash", { credentials: "same-origin" })
    ]);

    if (!evRes.ok) {
      statusEl.textContent = evRes.status === 404 ? "Event not found." : "Failed to load event.";
      return;
    }

    const ev = await evRes.json();
    const received = receivedRes.ok ? await receivedRes.json() : [];
    const preCost = preCostRes.ok ? await preCostRes.json() : null;
    const petty = pettyRes.ok ? await pettyRes.json() : null;

    statusEl.hidden = true;
    render(ev, received, preCost, petty);
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
  }
}

function render(ev, received, preCost, petty) {
  content.innerHTML = "";

  // ── Header ────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "panel-header";
  header.style.marginBottom = "24px";

  const backRow = document.createElement("div");
  backRow.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap";

  const backBtn = document.createElement("a");
  backBtn.href = "saved-events.html";
  backBtn.className = "secondary-button";
  backBtn.style.fontSize = "0.78rem";
  backBtn.textContent = "← Back to Events";
  backRow.append(backBtn);

  const editBtn = document.createElement("a");
  editBtn.href = "index.html?edit=" + encodeURIComponent(ev.id);
  editBtn.className = "secondary-button";
  editBtn.style.fontSize = "0.78rem";
  editBtn.textContent = "Edit Event";
  backRow.append(editBtn);

  const logBtn = document.createElement("a");
  logBtn.href = "event-log.html?id=" + encodeURIComponent(ev.id);
  logBtn.className = "secondary-button";
  logBtn.style.fontSize = "0.78rem";
  logBtn.textContent = "Change Log";
  backRow.append(logBtn);

  const pettyCashBtn = document.createElement("a");
  pettyCashBtn.href = "petty-cash.html?event=" + encodeURIComponent(ev.id);
  pettyCashBtn.className = "secondary-button";
  pettyCashBtn.style.fontSize = "0.78rem";
  pettyCashBtn.textContent = "Petty Cash";
  backRow.append(pettyCashBtn);

  const financeBtn = document.createElement("a");
  financeBtn.href = "financial-control.html?event=" + encodeURIComponent(ev.id);
  financeBtn.className = "secondary-button";
  financeBtn.style.fontSize = "0.78rem";
  financeBtn.textContent = "Financial Control";
  backRow.append(financeBtn);

  header.append(backRow);

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = ev.externalId || "";
  header.append(eyebrow);

  const title = document.createElement("h1");
  title.style.fontSize = "1.6rem";
  title.textContent = ev.name;
  header.append(title);

  const meta = document.createElement("div");
  meta.style.cssText = "display:flex;flex-wrap:wrap;gap:16px;margin-top:12px";
  const metaItems = [
    ["Date", ODC.isoToDmy(ev.date) + (ev.time ? " · " + ev.time : "")],
    ["Location", ev.location + (ev.locationZone ? " (" + ev.locationZone + ")" : "")],
    ["PAX", ev.pax + " plates × " + ev.days + " day(s)"],
    ["Cost / PAX", money.format(ev.costPerPax || 0)],
    ["Total Billing", money.format(ev.totalBilling || 0)],
    ["Status", ev.status]
  ];
  metaItems.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "ev-meta-item";
    const lbl = document.createElement("span");
    lbl.className = "ev-meta-label";
    lbl.textContent = label;
    const val = document.createElement("strong");
    val.className = "ev-meta-value";
    if (label === "Status") {
      val.className += " status-badge status-" + (ev.status || "open");
    }
    val.textContent = value;
    item.append(lbl, val);
    meta.append(item);
  });
  header.append(meta);
  content.append(header);

  // ── Payment Schedule ──────────────────────────────────────────────────
  const paySection = document.createElement("section");
  paySection.style.marginBottom = "28px";

  const payTitle = document.createElement("h2");
  payTitle.style.marginBottom = "14px";
  payTitle.textContent = "Payment Schedule";
  paySection.append(payTitle);

  const cycles = ev.paymentSchedule || [];
  const today = new Date().toISOString().slice(0, 10);

  // Group received by cycle index
  const receivedByIdx = {};
  received.forEach(r => {
    if (!receivedByIdx[r.cycle_index]) receivedByIdx[r.cycle_index] = [];
    receivedByIdx[r.cycle_index].push(r);
  });

  if (cycles.length === 0) {
    const p = document.createElement("p");
    p.className = "form-status";
    p.textContent = "No payment cycles added.";
    paySection.append(p);
  } else {
    const totalReceived = received.reduce((s, r) => s + (r.amount || 0), 0);
    const totalPending = (ev.totalBilling || 0) - totalReceived;

    const summaryRow = document.createElement("div");
    summaryRow.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;padding:12px 14px;background:var(--surface-soft);border-radius:var(--radius-sm);border:1px solid var(--surface-border)";
    [["Total Billing", money.format(ev.totalBilling || 0)], ["Received", money.format(totalReceived)], ["Pending", money.format(totalPending)]].forEach(([l, v]) => {
      const d = document.createElement("div");
      const lEl = document.createElement("span");
      lEl.style.cssText = "font-size:0.75rem;font-weight:600;color:var(--muted);display:block";
      lEl.textContent = l;
      const vEl = document.createElement("strong");
      vEl.style.cssText = "font-size:0.95rem";
      if (l === "Pending" && totalPending > 0) vEl.style.color = "#dc2626";
      if (l === "Received") vEl.style.color = "var(--accent)";
      vEl.textContent = v;
      d.append(lEl, vEl);
      summaryRow.append(d);
    });
    paySection.append(summaryRow);

    cycles.forEach((cycle, idx) => {
      const cycleRecs = receivedByIdx[idx] || [];
      const cycleReceived = cycleRecs.reduce((s, r) => s + (r.amount || 0), 0);
      const isOverdue = cycle.dueDate && cycle.dueDate < today;
      const isPaid = cycleReceived >= (cycle.amount || 0);

      const card = document.createElement("div");
      card.className = "ev-cycle-card" + (isOverdue && !isPaid ? " ev-cycle-overdue" : "") + (isPaid ? " ev-cycle-paid" : "");

      const cardTop = document.createElement("div");
      cardTop.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap";

      const info = document.createElement("div");
      const nameEl = document.createElement("strong");
      nameEl.style.cssText = "display:block;font-size:0.9rem";
      nameEl.textContent = cycle.label || "Payment";
      info.append(nameEl);

      const metaSpan = document.createElement("span");
      metaSpan.style.cssText = "font-size:0.78rem;color:var(--muted)";
      const parts = [cycle.billing === "online" ? "Online · " + (cycle.method || "UPI") : "Cash"];
      if (cycle.dueDate) parts.push("Due: " + ODC.isoToDmy(cycle.dueDate));
      if (cycle.isAdvance) parts.push("Advance");
      metaSpan.textContent = parts.join(" · ");
      info.append(metaSpan);
      cardTop.append(info);

      const amtDiv = document.createElement("div");
      amtDiv.style.cssText = "text-align:right;flex-shrink:0";
      const amtEl = document.createElement("strong");
      amtEl.style.fontSize = "1rem";
      amtEl.textContent = money.format(cycle.amount || 0);
      amtDiv.append(amtEl);

      if (cycleReceived > 0) {
        const recEl = document.createElement("span");
        recEl.style.cssText = "display:block;font-size:0.75rem;color:var(--accent)";
        recEl.textContent = money.format(cycleReceived) + " received";
        amtDiv.append(recEl);
      }

      if (isOverdue && !isPaid) {
        const badge = document.createElement("span");
        badge.className = "overdue-badge";
        badge.textContent = "Overdue";
        amtDiv.append(badge);
      }

      if (isPaid) {
        const badge = document.createElement("span");
        badge.className = "paid-badge";
        badge.textContent = "Paid";
        amtDiv.append(badge);
      }

      cardTop.append(amtDiv);
      card.append(cardTop);

      if (cycleRecs.length > 0) {
        const recList = document.createElement("div");
        recList.style.cssText = "margin-top:8px;padding-top:8px;border-top:1px dashed var(--surface-border)";
        cycleRecs.forEach(r => {
          const recRow = document.createElement("div");
          recRow.style.cssText = "display:flex;justify-content:space-between;font-size:0.78rem;padding:2px 0";
          const rInfo = document.createElement("span");
          rInfo.textContent = new Date(r.received_at).toLocaleDateString("en-IN") + " · " + (r.received_by || "") + (r.notes ? " · " + r.notes : "");
          const rAmt = document.createElement("span");
          rAmt.style.color = "var(--accent)";
          rAmt.textContent = money.format(r.amount);
          recRow.append(rInfo, rAmt);
          recList.append(recRow);
        });
        card.append(recList);
      }

      if (!isPaid) {
        const markBtn = document.createElement("button");
        markBtn.type = "button";
        markBtn.className = "secondary-button";
        markBtn.style.cssText = "margin-top:10px;font-size:0.78rem;padding:4px 10px";
        markBtn.textContent = "Mark Received";
        markBtn.dataset.cycleIdx = idx;
        markBtn.dataset.cycleName = cycle.label || "Payment";
        markBtn.dataset.cycleAmount = cycle.amount || 0;
        markBtn.addEventListener("click", () => markReceived(markBtn));
        card.append(markBtn);
      }

      paySection.append(card);
    });
  }
  content.append(paySection);

  // ── Pre-Cost Summary ──────────────────────────────────────────────────
  if (preCost && preCost.totalCost > 0) {
    const pcSection = document.createElement("section");
    pcSection.style.marginBottom = "28px";
    const pcTitle = document.createElement("h2");
    pcTitle.style.marginBottom = "14px";
    pcTitle.textContent = "Pre-Cost Plan";
    pcSection.append(pcTitle);

    const pcCard = document.createElement("div");
    pcCard.style.cssText = "display:flex;flex-wrap:wrap;gap:16px;padding:14px;background:var(--surface-soft);border-radius:var(--radius-sm);border:1px solid var(--surface-border)";
    const pl = preCost.profitLoss || 0;
    const plColor = pl >= 0 ? "var(--accent)" : "#dc2626";
    [
      ["Total Cost", money.format(preCost.totalCost || 0), ""],
      ["Profit / Loss", money.format(Math.abs(pl)) + (pl < 0 ? " Loss" : " Profit"), plColor]
    ].forEach(([l, v, color]) => {
      const d = document.createElement("div");
      const lEl = document.createElement("span");
      lEl.style.cssText = "font-size:0.75rem;font-weight:600;color:var(--muted);display:block";
      lEl.textContent = l;
      const vEl = document.createElement("strong");
      vEl.style.fontSize = "0.95rem";
      if (color) vEl.style.color = color;
      vEl.textContent = v;
      d.append(lEl, vEl);
      pcCard.append(d);
    });

    const pcLink = document.createElement("a");
    pcLink.href = "pre-cost-planning.html?event=" + encodeURIComponent(ev.id);
    pcLink.className = "secondary-button";
    pcLink.style.cssText = "align-self:center;font-size:0.78rem;padding:4px 10px;text-decoration:none";
    pcLink.textContent = "Edit Plan";
    pcCard.append(pcLink);

    pcSection.append(pcCard);
    content.append(pcSection);
  }

  // ── Petty Cash Summary ────────────────────────────────────────────────
  if (petty && (petty.payouts.length > 0 || petty.petty.length > 0)) {
    const ptSection = document.createElement("section");
    ptSection.style.marginBottom = "28px";
    const ptTitle = document.createElement("h2");
    ptTitle.style.marginBottom = "14px";
    ptTitle.textContent = "Petty Cash";
    ptSection.append(ptTitle);

    const totalPayouts = petty.payouts.reduce((s, r) => s + (r.amount || 0), 0);
    const totalPetty = petty.petty.reduce((s, r) => s + (r.amount || 0), 0);
    const totalRequired = totalPayouts + totalPetty;

    const ptCard = document.createElement("div");
    ptCard.style.cssText = "display:flex;flex-wrap:wrap;gap:16px;padding:14px;background:var(--surface-soft);border-radius:var(--radius-sm);border:1px solid var(--surface-border)";
    [
      ["Payouts (" + petty.payouts.length + ")", money.format(totalPayouts)],
      ["Petty Expenses (" + petty.petty.length + ")", money.format(totalPetty)],
      ["Total Required", money.format(totalRequired)]
    ].forEach(([l, v]) => {
      const d = document.createElement("div");
      const lEl = document.createElement("span");
      lEl.style.cssText = "font-size:0.75rem;font-weight:600;color:var(--muted);display:block";
      lEl.textContent = l;
      const vEl = document.createElement("strong");
      vEl.style.fontSize = "0.95rem";
      vEl.textContent = v;
      d.append(lEl, vEl);
      ptCard.append(d);
    });

    const ptLink = document.createElement("a");
    ptLink.href = "petty-cash.html?event=" + encodeURIComponent(ev.id);
    ptLink.className = "secondary-button";
    ptLink.style.cssText = "align-self:center;font-size:0.78rem;padding:4px 10px;text-decoration:none";
    ptLink.textContent = "Edit Petty Cash";
    ptCard.append(ptLink);

    ptSection.append(ptCard);
    content.append(ptSection);
  }
}

async function markReceived(btn) {
  const cycleIdx = Number(btn.dataset.cycleIdx);
  const cycleName = btn.dataset.cycleName;
  const cycleAmount = Number(btn.dataset.cycleAmount);

  const amtStr = window.prompt("Amount received for \"" + cycleName + "\" (max " + cycleAmount + "):", String(cycleAmount));
  if (amtStr === null) return;
  const amount = Number(amtStr);
  if (!(amount > 0)) { alert("Invalid amount."); return; }

  const notes = window.prompt("Notes (optional, press OK to skip):", "") || "";

  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const res = await fetch("api/events/" + encodeURIComponent(eventId) + "/payment-received", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ cycleIndex: cycleIdx, cycleName, amount, notes })
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert("Failed: " + (d.error || res.status));
      btn.disabled = false;
      btn.textContent = "Mark Received";
      return;
    }
    loadDashboard();
  } catch (err) {
    alert("Error: " + err.message);
    btn.disabled = false;
    btn.textContent = "Mark Received";
  }
}

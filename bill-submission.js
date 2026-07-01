const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const CATEGORIES = ["food", "transport", "equipment", "accommodation", "misc"];
let tesseractLoadPromise = null;

function isBillHeadMaster(head) {
  return !!String(head?.id || head?.name || "").trim();
}

async function apiFetch(method, path, body) {
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

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error("OCR library could not load."));
    document.head.append(script);
  });
  return tesseractLoadPromise;
}

function parseReceiptText(text) {
  const lines = String(text || "").toLowerCase().split("\n");
  const patterns = [
    /(?:grand\s*total|net\s*amount|total\s*amount|total\s*payable|amount\s*due|total)[:\s]*(?:rs\.?|₹|inr)?\s*([0-9,]+\.?\d*)/i,
    /(?:rs\.?|₹|inr)\s*([0-9,]+\.?\d*)/i,
    /([0-9,]+\.?\d*)\s*\/?\s*(?:rs\.?|₹|inr)/i
  ];
  const amounts = [];
  lines.forEach((line) => {
    patterns.forEach((pattern) => {
      const match = line.match(pattern);
      if (!match) return;
      const value = Number.parseFloat(match[1].replace(/,/g, ""));
      if (value > 0 && value < 1000000) amounts.push(value);
    });
  });

  const full = String(text || "").toLowerCase();
  let category = "misc";
  if (/restaurant|food|meal|lunch|dinner|breakfast|snack|tea|coffee|catering/.test(full)) category = "food";
  else if (/taxi|uber|ola|cab|petrol|diesel|fuel|auto|bus|train|flight|transport|toll/.test(full)) category = "transport";
  else if (/equipment|rental|hire|machine|generator|tool|material/.test(full)) category = "equipment";
  else if (/hotel|lodge|room|stay|accommodation|resort/.test(full)) category = "accommodation";

  return {
    amount: amounts.length ? Math.max(...amounts) : null,
    category
  };
}

function compressImageDataUrl(dataUrl, maxDim = 1600, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = img.naturalWidth;
      let height = img.naturalHeight;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Could not decode image for compression."));
    img.src = dataUrl;
  });
}

function buildOcrCard(onReceiptReady) {
  const wrap = document.createElement("div");
  wrap.className = "receipt-ocr-card";

  const row = document.createElement("div");
  row.className = "receipt-ocr-row";

  const label = document.createElement("label");
  label.className = "receipt-upload-btn";
  label.htmlFor = "receiptFile";
  label.textContent = "Scan Receipt";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.id = "receiptFile";
  fileInput.accept = "image/*,application/pdf";
  fileInput.hidden = true;
  label.append(fileInput);

  const hint = document.createElement("span");
  hint.className = "receipt-ocr-hint";
  hint.textContent = "Upload receipt photo to auto-fill amount and category";

  const status = document.createElement("span");
  status.id = "ocrStatus";
  status.className = "receipt-ocr-status";

  row.append(label, hint, status);

  const result = document.createElement("div");
  result.id = "ocrResult";
  result.className = "receipt-ocr-result";
  result.hidden = true;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    onReceiptReady?.(null);
    status.textContent = "Loading OCR...";
    result.hidden = true;
    try {
      const Tesseract = await loadTesseract();
      let dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = () => reject(new Error("Could not read receipt file."));
        reader.readAsDataURL(file);
      });
      const isImage = (file.type || "").startsWith("image/");
      if (isImage) {
        try { dataUrl = await compressImageDataUrl(dataUrl); } catch { /* fall back to original */ }
      }
      onReceiptReady?.({
        fileName: file.name,
        mimeType: isImage ? "image/jpeg" : (file.type || "application/octet-stream"),
        base64: String(dataUrl).split(",")[1] || ""
      });
      status.textContent = "Scanning receipt...";
      const ocr = await Tesseract.recognize(dataUrl, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text") status.textContent = "Scanning... " + Math.round(m.progress * 100) + "%";
        }
      });
      const text = ocr.data.text || "";
      const parsed = parseReceiptText(text);
      if (parsed.amount) document.getElementById("billAmount").value = parsed.amount;
      if (parsed.category) document.getElementById("billCategory").value = parsed.category;
      status.textContent = "Done";
      result.textContent = "Extracted: " + text.replace(/\n+/g, " ").slice(0, 220);
      result.hidden = false;
    } catch (err) {
      onReceiptReady?.(null);
      status.textContent = "Scan failed. Enter manually.";
      result.textContent = err.message || "OCR failed.";
      result.hidden = false;
    }
  });

  wrap.append(row, result);
  return wrap;
}

// ── Form ───────────────────────────────────────────────────────────────
function buildForm(events, masterPersons) {
  const formEl = document.getElementById("billForm");
  formEl.innerHTML = "";
  let selectedReceipt = null;
  const billHeadMasters = (masterPersons || []).filter(isBillHeadMaster);
  const headMap = {};
  billHeadMasters.forEach((head) => { headMap[head.id] = head; });

  const statusEl = document.createElement("p");
  statusEl.className = "form-status";
  statusEl.id = "billFormStatus";
  formEl.append(buildOcrCard((receipt) => { selectedReceipt = receipt; }));

  // Event select
  const evLbl = document.createElement("label");
  evLbl.className = "field";
  evLbl.style.marginBottom = "12px";
  const evSpan = document.createElement("span");
  evSpan.textContent = "Event";
  const evSel = document.createElement("select");
  evSel.id = "billEvent";
  const evDefault = document.createElement("option");
  evDefault.value = "";
  evDefault.textContent = "Select event…";
  evSel.append(evDefault);
  events.filter(e => e.status !== "cancelled").forEach(ev => {
    const opt = document.createElement("option");
    opt.value = ev.id;
    opt.textContent = ev.name + " - " + ODC.eventContextText(ev, { includeDays: true });
    evSel.append(opt);
  });
  evLbl.append(evSpan, evSel);
  formEl.append(evLbl);

  // Head select
  const headLbl = document.createElement("label");
  headLbl.className = "field";
  headLbl.style.marginBottom = "12px";
  const headSpan = document.createElement("span");
  headSpan.textContent = "Head";
  const headSel = document.createElement("select");
  headSel.id = "billHead";
  const headDefault = document.createElement("option");
  headDefault.value = "";
  headDefault.textContent = "Select head…";
  headSel.append(headDefault);
  const headHint = document.createElement("span");
  headHint.id = "headHint";
  headHint.className = "field-hint";
  headLbl.append(headSpan, headSel);
  headLbl.append(headHint);
  formEl.append(headLbl);

  function populateHeads(headIds, payouts) {
    headSel.innerHTML = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = "Select department head...";
    headSel.append(first);

    if (headIds.length) {
      headIds.forEach((headId) => {
        const head = headMap[headId] || (masterPersons || []).find((item) => String(item.id) === String(headId));
        const opt = document.createElement("option");
        const allocated = (payouts || []).filter((p) => p.headId === headId).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        opt.value = headId;
        opt.textContent = (head ? head.name : headId) + " - " + money.format(allocated) + " allocated";
        headSel.append(opt);
      });
      headHint.textContent = "Only heads with petty cash for this event are shown.";
    } else {
      billHeadMasters.forEach((head) => {
        const persons = Array.isArray(head.persons) ? head.persons : [];
        const headPersons = persons.filter((person) => {
          const text = typeof person === "string" ? person : [person.name, person.personName, person.designation].filter(Boolean).join(" ");
          return /\bhead\b/i.test(String(text || ""));
        });
        if (headPersons.length) {
          headPersons.forEach((person) => {
            const name = typeof person === "string" ? person : person.name || person.personName || "";
            if (!name) return;
            const opt = document.createElement("option");
            opt.value = head.id;
            opt.dataset.personName = name;
            opt.textContent = name;
            headSel.append(opt);
          });
          return;
        }
        const opt = document.createElement("option");
        opt.value = head.id;
        opt.textContent = head.name;
        headSel.append(opt);
      });
      headHint.textContent = billHeadMasters.length
        ? "No petty cash assigned for this event. Showing all Master Persons posts."
        : "No names found. Add posts and people in Master Persons.";
    }
    resetPersonField();
  }

  // Person name
  const personLbl = document.createElement("label");
  personLbl.className = "field";
  personLbl.style.marginBottom = "12px";
  const personSpan = document.createElement("span");
  personSpan.textContent = "Your Name";
  const personSel = document.createElement("select");
  personSel.id = "billPerson";
  const personText = document.createElement("input");
  personText.type = "text";
  personText.id = "billPersonText";
  personText.placeholder = "Enter your name";
  personText.style.display = "none";
  personLbl.append(personSpan, personSel, personText);
  formEl.append(personLbl);

  function resetPersonField() {
    personSel.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Select your name...";
    personSel.append(opt);
    personSel.style.display = "";
    personText.style.display = "none";
    personText.value = "";
  }

  function getPersonName() {
    if (personSel.style.display !== "none" && personSel.value && personSel.value !== "__other__") return personSel.value;
    return personText.value.trim();
  }

  evSel.addEventListener("change", async () => {
    if (!evSel.value) {
      populateHeads([], []);
      return;
    }
    try {
      const pettyCash = await apiFetch("GET", "/api/events/" + encodeURIComponent(evSel.value) + "/petty-cash");
      const payouts = pettyCash.payouts || [];
      const headIds = [...new Set(payouts.map((p) => p.headId).filter(Boolean))];
      populateHeads(headIds, payouts);
    } catch {
      populateHeads([], []);
    }
  });

  headSel.addEventListener("change", () => {
    const selectedPersonName = headSel.selectedOptions[0]?.dataset.personName || "";
    if (selectedPersonName) {
      personSel.style.display = "none";
      personText.style.display = "";
      personText.value = selectedPersonName;
      return;
    }
    const head = headMap[headSel.value];
    if (!head || !Array.isArray(head.persons) || !head.persons.length) {
      personSel.style.display = "none";
      personText.style.display = "";
      personText.focus();
      return;
    }
    personSel.innerHTML = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = "Select your name...";
    personSel.append(first);
    head.persons.forEach((person) => {
      const name = typeof person === "string" ? person : person.name || person.personName || "";
      if (!name) return;
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name + (person.designation ? " - " + person.designation : "");
      personSel.append(opt);
    });
    const other = document.createElement("option");
    other.value = "__other__";
    other.textContent = "Other (type name)";
    personSel.append(other);
    personSel.style.display = "";
    personText.style.display = "none";
  });

  personSel.addEventListener("change", () => {
    if (personSel.value === "__other__") {
      personText.style.display = "";
      personText.value = "";
      personText.focus();
    } else {
      personText.style.display = "none";
    }
  });

  // Amount + Category row
  const amtRow = document.createElement("div");
  amtRow.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px";

  const amtLbl = document.createElement("label");
  amtLbl.className = "field";
  const amtSpan = document.createElement("span");
  amtSpan.textContent = "Amount (₹)";
  const amtInput = document.createElement("input");
  amtInput.type = "number";
  amtInput.id = "billAmount";
  amtInput.min = "1";
  amtInput.step = "0.01";
  amtInput.placeholder = "0.00";
  amtLbl.append(amtSpan, amtInput);
  amtRow.append(amtLbl);

  const catLbl = document.createElement("label");
  catLbl.className = "field";
  const catSpan = document.createElement("span");
  catSpan.textContent = "Category";
  const catSel = document.createElement("select");
  catSel.id = "billCategory";
  CATEGORIES.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c.charAt(0).toUpperCase() + c.slice(1);
    catSel.append(opt);
  });
  catLbl.append(catSpan, catSel);
  amtRow.append(catLbl);
  formEl.append(amtRow);

  // Description
  const descLbl = document.createElement("label");
  descLbl.className = "field";
  descLbl.style.marginBottom = "16px";
  const descSpan = document.createElement("span");
  descSpan.textContent = "Description";
  const descTa = document.createElement("textarea");
  descTa.id = "billDesc";
  descTa.rows = 2;
  descTa.placeholder = "What is this bill for?";
  descLbl.append(descSpan, descTa);
  formEl.append(descLbl);

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "primary-button";
  submitBtn.style.cssText = "width:100%;padding:10px;font-size:0.95rem";
  submitBtn.textContent = "Submit Bill";
  submitBtn.addEventListener("click", async () => {
    const eventId = document.getElementById("billEvent").value;
    const headId = document.getElementById("billHead").value;
    const personName = getPersonName();
    const amount = Number(document.getElementById("billAmount").value);
    const category = document.getElementById("billCategory").value;
    const description = document.getElementById("billDesc").value.trim();

    const fStatus = document.getElementById("billFormStatus");
    fStatus.className = "form-status";
    if (!eventId || !headId || !personName || !(amount > 0)) {
      fStatus.textContent = "Event, head, name, and amount are required.";
      fStatus.className = "form-status error";
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    try {
      const saved = await apiFetch("POST", "/api/bills", { eventId, headId, personName, amount, category, description, receipt: selectedReceipt });
      fStatus.textContent = saved.receipt?.url ? "Bill submitted and receipt saved to Drive." : "Bill submitted successfully.";
      document.getElementById("billAmount").value = "";
      document.getElementById("billDesc").value = "";
      document.getElementById("billCategory").value = "misc";
      selectedReceipt = null;
      const receiptFile = document.getElementById("receiptFile");
      if (receiptFile) receiptFile.value = "";
      document.getElementById("ocrStatus").textContent = "";
      const ocrResult = document.getElementById("ocrResult");
      if (ocrResult) ocrResult.hidden = true;
      loadBills();
    } catch (err) {
      fStatus.textContent = "Error: " + err.message;
      fStatus.className = "form-status error";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Bill";
    }
  });
  formEl.append(submitBtn, statusEl);
  populateHeads([], []);
}

// ── Bills List ─────────────────────────────────────────────────────────
let billsLoading = false;
async function loadBills() {
  if (billsLoading) return;
  billsLoading = true;
  const listEl = document.getElementById("billList");
  const statusEl = document.getElementById("billListStatus");
  statusEl.textContent = "Loading…";
  statusEl.hidden = false;
  listEl.innerHTML = "";

  try {
    const bills = await apiFetch("GET", "/api/bills");
    statusEl.hidden = true;

    if (bills.length === 0) {
      const p = document.createElement("p");
      p.className = "form-status";
      p.textContent = "No bills submitted yet.";
      listEl.append(p);
      return;
    }

    const isAdmin = window.ODC_USER && window.ODC_USER.role === "admin";

    bills.forEach(bill => {
      const card = document.createElement("div");
      card.className = "bill-card bill-status-" + (bill.status || "pending");
      card.style.cssText = "padding:12px 14px;border:1px solid var(--surface-border);border-radius:var(--radius-sm);margin-bottom:8px;background:var(--surface-soft)";

      const topRow = document.createElement("div");
      topRow.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:8px";

      const info = document.createElement("div");
      const nameEl = document.createElement("strong");
      nameEl.style.display = "block";
      nameEl.textContent = bill.eventName || bill.eventClientId;
      const eventMetaEl = document.createElement("span");
      eventMetaEl.style.cssText = "display:block;font-size:0.76rem;color:var(--muted);margin-top:2px";
      eventMetaEl.textContent = ODC.eventContextText({ date: bill.eventDate, pax: bill.eventPax, costPerPax: bill.eventCostPerPax });
      const metaEl = document.createElement("span");
      metaEl.style.cssText = "display:block;font-size:0.78rem;color:var(--muted);margin-top:2px";
      metaEl.textContent = [bill.headName, bill.personName, bill.category].filter(Boolean).join(" · ");
      info.append(nameEl, eventMetaEl, metaEl);
      topRow.append(info);

      const rightCol = document.createElement("div");
      rightCol.style.cssText = "text-align:right;flex-shrink:0";
      const amtEl = document.createElement("strong");
      amtEl.style.fontSize = "0.95rem";
      amtEl.textContent = money.format(bill.amount || 0);
      const statusBadge = document.createElement("span");
      statusBadge.style.cssText = "display:block;font-size:0.72rem;font-weight:700;text-transform:uppercase;margin-top:2px";
      statusBadge.style.color = bill.status === "approved" ? "var(--accent)" : bill.status === "rejected" ? "#dc2626" : "var(--muted)";
      statusBadge.textContent = bill.status || "pending";
      rightCol.append(amtEl, statusBadge);
      topRow.append(rightCol);
      card.append(topRow);

      if (bill.description) {
        const descEl = document.createElement("p");
        descEl.style.cssText = "font-size:0.8rem;margin-top:6px;color:var(--ink)";
        descEl.textContent = bill.description;
        card.append(descEl);
      }

      if (bill.receiptDriveUrl) {
        const receiptLink = document.createElement("a");
        receiptLink.className = "bill-receipt-link";
        receiptLink.href = bill.receiptDriveUrl;
        receiptLink.target = "_blank";
        receiptLink.rel = "noopener";
        receiptLink.textContent = "Receipt: " + (bill.receiptFileName || "Open in Drive");
        card.append(receiptLink);
      }

      const dateEl = document.createElement("p");
      dateEl.style.cssText = "font-size:0.75rem;color:var(--muted);margin-top:4px";
      dateEl.textContent = bill.submittedAt ? new Date(bill.submittedAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "";
      if (bill.reviewedBy) dateEl.textContent += " · Reviewed by " + bill.reviewedBy;
      card.append(dateEl);

      if (isAdmin && bill.status === "pending") {
        const actRow = document.createElement("div");
        actRow.style.cssText = "display:flex;gap:8px;margin-top:8px";

        const approveBtn = document.createElement("button");
        approveBtn.type = "button";
        approveBtn.className = "primary-button";
        approveBtn.style.cssText = "font-size:0.75rem;padding:4px 10px";
        approveBtn.textContent = "Approve";
        approveBtn.addEventListener("click", async () => {
          approveBtn.disabled = true;
          rejectBtn.disabled = true;
          try {
            await apiFetch("PUT", "/api/bills/" + bill.id, { status: "approved" });
            loadBills();
          } catch (err) { alert("Error: " + err.message); approveBtn.disabled = false; rejectBtn.disabled = false; }
        });

        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "secondary-button danger";
        rejectBtn.style.cssText = "font-size:0.75rem;padding:4px 10px";
        rejectBtn.textContent = "Reject";
        rejectBtn.addEventListener("click", async () => {
          approveBtn.disabled = true;
          rejectBtn.disabled = true;
          try {
            await apiFetch("PUT", "/api/bills/" + bill.id, { status: "rejected" });
            loadBills();
          } catch (err) { alert("Error: " + err.message); approveBtn.disabled = false; rejectBtn.disabled = false; }
        });

        actRow.append(approveBtn, rejectBtn);
        card.append(actRow);
      }

      listEl.append(card);
    });
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
    statusEl.className = "form-status error";
  } finally {
    billsLoading = false;
  }
}

document.getElementById("billRefresh").addEventListener("click", loadBills);

async function loadBillSubmissionPage() {
  try {
    const [events, masterPersons] = await Promise.all([
      ODC.api("GET", "/api/events"),
      ODC.api("GET", "/api/master-persons")
    ]);
    buildForm(events || [], masterPersons || []);
  } catch (err) {
    document.getElementById("billForm").textContent = "Failed to load form data: " + err.message;
  }
  loadBills();
}

ODC.ready.then(loadBillSubmissionPage);
ODC.registerSync(() => {
  if (document.hidden) return;
  const active = document.activeElement;
  if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return;
  loadBillSubmissionPage();
});

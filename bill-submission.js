"use strict";
(function () {
  var headMap = {};        // headId -> { name, persons }
  var pettyCashByEvent = {}; // eventId -> { payouts: [] }
  var allEvents = [];

  function esc(s) { return ODC.escapeHtml(s); }

  /* ================================================================
   * Init
   * ================================================================ */
  function init() {
    loadEvents();
    loadHeads();
    loadBills();
    setupBillsListDelegate();
    setupSubmitBtn();
    setupOCR();
    setupEventChange();
    setupHeadChange();

    var user = window.ODC_USER;
    if (user && user.role === "admin") {
      document.getElementById("billsEyebrow").textContent = "All Submissions";
      document.getElementById("billsTitle").textContent = "All Submitted Bills";
      var ap = document.getElementById("adminUsersPanel");
      if (ap) { ap.hidden = false; loadUsers(); setupAddUserBtn(); }
    }
  }

  /* ---- Events ---- */
  function loadEvents() {
    fetch("/api/events", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (events) {
        allEvents = events || [];
        var sel = document.getElementById("billEvent");
        allEvents.forEach(function (ev) {
          var opt = document.createElement("option");
          opt.value = ev.id;
          opt.textContent = (ev.externalId || ev.id) + " — " + ev.name;
          sel.appendChild(opt);
        });
      }).catch(function () {});
  }

  /* ---- Heads (all) ---- */
  function loadHeads() {
    fetch("/api/master-persons", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (heads) {
        headMap = {};
        (heads || []).forEach(function (h) { headMap[h.id] = h; });
      }).catch(function () {});
  }

  /* ---- On event change: load heads filtered to petty cash for that event ---- */
  function setupEventChange() {
    document.getElementById("billEvent").addEventListener("change", function () {
      var eventId = this.value;
      if (!eventId) { populateHeads([]); return; }
      fetch("/api/events/" + encodeURIComponent(eventId) + "/petty-cash", { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (pc) {
          pettyCashByEvent[eventId] = pc;
          var pcHeadIds = new Set((pc.payouts || []).map(function (p) { return p.headId; }));
          populateHeads(Array.from(pcHeadIds), pc.payouts || []);
        })
        .catch(function () { populateHeads([]); });
    });
  }

  function populateHeads(pcHeadIds, payouts) {
    var sel  = document.getElementById("billHead");
    var hint = document.getElementById("headHint");
    sel.innerHTML = '<option value="">— Select department head —</option>';

    if (pcHeadIds.length > 0) {
      // Only petty cash heads — no other departments shown
      pcHeadIds.forEach(function (hid) {
        var h = headMap[hid];
        var opt = document.createElement("option");
        opt.value = hid;
        var allocated = (payouts || []).filter(function (p) { return p.headId === hid; }).reduce(function (s, p) { return s + p.amount; }, 0);
        opt.textContent = (h ? h.name : hid) + "  —  ₹" + allocated.toLocaleString("en-IN") + " allocated";
        sel.appendChild(opt);
      });
      hint.textContent = "Only department heads with petty cash for this event are shown.";
    } else {
      // No petty cash — show all heads as fallback
      Object.keys(headMap).forEach(function (hid) {
        var opt = document.createElement("option");
        opt.value = hid;
        opt.textContent = headMap[hid].name;
        sel.appendChild(opt);
      });
      hint.textContent = "No petty cash assigned for this event.";
    }

    // Reset person field — dropdown visible, text hidden
    resetPersonField();
  }

  function resetPersonField() {
    var personSel  = document.getElementById("billPerson");
    var personText = document.getElementById("billPersonText");
    personSel.innerHTML = '<option value="">— Select your name —</option>';
    personSel.style.display = "";
    personText.style.display = "none";
    personText.value = "";
  }

  /* ---- On head change: load persons under that head ---- */
  function setupHeadChange() {
    document.getElementById("billHead").addEventListener("change", function () {
      var headId = this.value;
      var personSel  = document.getElementById("billPerson");
      var personText = document.getElementById("billPersonText");

      if (!headId || headId === "direct") {
        // Direct — free text only
        personSel.style.display = "none";
        personText.style.display = "";
        personText.placeholder = "Enter your name";
        return;
      }

      var head = headMap[headId];
      if (!head || !head.persons || !head.persons.length) {
        // Head has no persons listed — free text
        personSel.style.display = "none";
        personText.style.display = "";
        personText.placeholder = "Enter your name";
        return;
      }

      // Show dropdown from master persons
      personSel.innerHTML = '<option value="">— Select your name —</option>';
      head.persons.forEach(function (p) {
        var pname = typeof p === "string" ? p : (p.name || "");
        var opt = document.createElement("option");
        opt.value = pname;
        opt.textContent = pname + (p.designation ? " · " + p.designation : "");
        personSel.appendChild(opt);
      });
      var other = document.createElement("option");
      other.value = "__other__";
      other.textContent = "Other (type name)";
      personSel.appendChild(other);

      personSel.style.display = "";
      personText.style.display = "none";

      personSel.onchange = function () {
        if (this.value === "__other__") {
          personText.style.display = "";
          personText.value = "";
          personText.focus();
        } else {
          personText.style.display = "none";
        }
      };
    });
  }

  function getPersonName() {
    var sel  = document.getElementById("billPerson");
    var text = document.getElementById("billPersonText");
    if (sel.style.display !== "none" && sel.value && sel.value !== "__other__") return sel.value;
    return text.value.trim();
  }

  /* ================================================================
   * Receipt OCR (Tesseract.js)
   * ================================================================ */
  function setupOCR() {
    var fileInput = document.getElementById("receiptFile");
    if (!fileInput) return;

    fileInput.addEventListener("change", function () {
      var file = this.files[0];
      if (!file) return;
      if (typeof Tesseract === "undefined") {
        document.getElementById("ocrStatus").textContent = "OCR library loading…";
        return;
      }
      var status = document.getElementById("ocrStatus");
      var resultEl = document.getElementById("ocrResult");
      status.textContent = "Scanning receipt…";
      resultEl.hidden = true;

      var reader = new FileReader();
      reader.onload = function (e) {
        Tesseract.recognize(e.target.result, "eng", {
          logger: function (m) { if (m.status === "recognizing text") status.textContent = "Scanning… " + Math.round(m.progress * 100) + "%"; }
        }).then(function (result) {
          var text = result.data.text;
          var parsed = parseReceiptText(text);
          status.textContent = "Done!";

          if (parsed.amount) {
            document.getElementById("billAmount").value = parsed.amount;
          }
          if (parsed.category) {
            document.getElementById("billCategory").value = parsed.category;
          }

          resultEl.innerHTML = "<strong>Extracted:</strong> " + esc(text.replace(/\n+/g, " ").slice(0, 200));
          resultEl.hidden = false;
        }).catch(function (e) {
          status.textContent = "Scan failed — enter manually.";
          console.error("OCR error:", e);
        });
      };
      reader.readAsDataURL(file);
    });
  }

  function parseReceiptText(text) {
    var amount = null;
    var lines = text.toLowerCase().split("\n");

    // Find the largest amount that looks like a total
    var patterns = [
      /(?:grand\s*total|net\s*amount|total\s*amount|total\s*payable|total|amount\s*due)[:\s]*(?:rs\.?|₹|inr)?\s*([0-9,]+\.?\d*)/i,
      /(?:rs\.?|₹|inr)\s*([0-9,]+\.?\d*)/i,
      /([0-9,]+\.?\d*)\s*\/?\s*(?:rs\.?|₹|inr)/i
    ];

    var amounts = [];
    for (var line of lines) {
      for (var pat of patterns) {
        var m = line.match(pat);
        if (m) {
          var v = parseFloat(m[1].replace(/,/g, ""));
          if (v > 0 && v < 1000000) amounts.push(v);
        }
      }
    }
    // Take the maximum (most likely total)
    if (amounts.length) amount = Math.max.apply(null, amounts);

    // Detect category
    var full = text.toLowerCase();
    var category = "misc";
    if (/restaurant|food|meal|lunch|dinner|breakfast|snack|tea|coffee|hotel food|catering/.test(full)) category = "food";
    else if (/taxi|uber|ola|cab|petrol|diesel|fuel|auto rickshaw|bus|train|flight|transport|toll/.test(full)) category = "transport";
    else if (/equipment|rental|hire|machine|generator|tool|material/.test(full)) category = "equipment";
    else if (/hotel|lodge|room|stay|accommodation|resort/.test(full)) category = "accommodation";

    return { amount: amount, category: category };
  }

  /* ================================================================
   * Bills list
   * ================================================================ */
  function loadBills() {
    fetch("/api/bills", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(renderBills)
      .catch(function () { renderBills([]); });
  }

  function renderBills(bills) {
    var container = document.getElementById("billsList");
    container.innerHTML = "";
    if (!bills || !bills.length) {
      var p = document.createElement("p");
      p.className = "empty-state";
      p.textContent = "No bills submitted yet.";
      container.appendChild(p);
      return;
    }

    var user = window.ODC_USER;
    bills.forEach(function (bill) {
      var card = document.createElement("div");
      card.className = "bill-card bill-status-" + bill.status;

      var head = document.createElement("div");
      head.className = "bill-card-head";

      var info = document.createElement("div");
      info.className = "bill-card-info";

      var strong = document.createElement("strong");
      strong.textContent = bill.eventName || bill.eventClientId || "—";
      info.appendChild(strong);

      var metaSpan = document.createElement("span");
      metaSpan.className = "bill-meta";
      metaSpan.textContent = bill.personName + " · " + (headMap[bill.headId] ? headMap[bill.headId].name : (bill.headId || "Direct")) + " · " + bill.category;
      info.appendChild(metaSpan);

      var amountDiv = document.createElement("div");
      amountDiv.className = "bill-card-amount";
      amountDiv.textContent = "₹" + Number(bill.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 });

      var badge = document.createElement("span");
      badge.className = "bill-status-badge bill-status-badge-" + bill.status;
      badge.textContent = bill.status.charAt(0).toUpperCase() + bill.status.slice(1);

      head.appendChild(info);
      head.appendChild(amountDiv);
      head.appendChild(badge);
      card.appendChild(head);

      if (bill.description) {
        var descP = document.createElement("p");
        descP.className = "bill-desc";
        descP.textContent = bill.description;
        card.appendChild(descP);
      }

      var metaDiv = document.createElement("div");
      metaDiv.className = "bill-card-meta";
      var dt = bill.submittedAt ? new Date(bill.submittedAt).toLocaleString("en-IN") : "";
      metaDiv.textContent = dt + (bill.reviewedBy ? " · Reviewed by " + bill.reviewedBy : "");
      card.appendChild(metaDiv);

      if (user && user.role === "admin" && bill.status === "pending") {
        var actions = document.createElement("div");
        actions.className = "bill-card-actions";
        ["approved", "rejected"].forEach(function (status) {
          var btn = document.createElement("button");
          btn.className = status === "approved" ? "btn-approve" : "btn-reject";
          btn.type = "button";
          btn.textContent = status === "approved" ? "Approve" : "Reject";
          btn.dataset.billId = bill.id;
          btn.dataset.billAction = status;
          actions.appendChild(btn);
        });
        card.appendChild(actions);
      }
      container.appendChild(card);
    });
  }

  function setupBillsListDelegate() {
    document.getElementById("billsList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-bill-action]");
      if (!btn) return;
      btn.disabled = true;
      fetch("/api/bills/" + btn.dataset.billId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ status: btn.dataset.billAction })
      }).then(function (r) { return r.json(); })
        .then(function (d) { if (d.ok) loadBills(); else btn.disabled = false; })
        .catch(function () { btn.disabled = false; });
    });
  }

  /* ================================================================
   * Submit
   * ================================================================ */
  function setupSubmitBtn() {
    document.getElementById("billSubmitBtn").addEventListener("click", function () {
      var errEl = document.getElementById("billError");
      var okEl  = document.getElementById("billSuccess");
      var btn   = this;
      errEl.hidden = true;
      okEl.hidden  = true;

      var eventId     = document.getElementById("billEvent").value;
      var headId      = document.getElementById("billHead").value;
      var personName  = getPersonName();
      var amount      = Number(document.getElementById("billAmount").value);
      var category    = document.getElementById("billCategory").value;
      var description = document.getElementById("billDescription").value.trim();
      var ev          = allEvents.find(function (e) { return e.id === eventId; });

      if (!eventId || !personName || !(amount > 0)) {
        errEl.textContent = "Event, your name, and amount > 0 are required.";
        errEl.hidden = false;
        return;
      }

      btn.disabled = true;
      btn.textContent = "Submitting…";

      fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          eventId: eventId,
          eventName: ev ? ev.name : "",
          headId: headId || "direct",
          personName: personName,
          amount: amount,
          category: category,
          description: description
        })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          btn.disabled = false;
          btn.textContent = "Submit Bill";
          if (res.ok) {
            okEl.textContent = "Bill submitted! ₹" + amount.toLocaleString("en-IN") + " — " + category;
            okEl.hidden = false;
            document.getElementById("billEvent").value = "";
            document.getElementById("billHead").innerHTML = '<option value="">— Select head (from petty cash) —</option>';
            document.getElementById("billPerson").style.display = "none";
            document.getElementById("billPersonText").value = "";
            document.getElementById("billAmount").value = "";
            document.getElementById("billDescription").value = "";
            document.getElementById("billCategory").value = "misc";
            document.getElementById("ocrStatus").textContent = "";
            document.getElementById("ocrResult").hidden = true;
            loadBills();
          } else {
            errEl.textContent = res.data.error || "Submission failed.";
            errEl.hidden = false;
          }
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = "Submit Bill";
          errEl.textContent = "Network error.";
          errEl.hidden = false;
        });
    });
  }

  /* ================================================================
   * Admin: Users management (unchanged)
   * ================================================================ */
  function loadUsers() {
    fetch("/api/auth/users", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(renderUsers)
      .catch(function () {});
  }

  function renderUsers(users) {
    var container = document.getElementById("usersList");
    if (!container) return;
    container.innerHTML = "";
    if (!users || !users.length) return;
    var table = document.createElement("table");
    table.className = "users-table";
    table.innerHTML = "<thead><tr><th>Username</th><th>Full Name</th><th>Role</th><th>Created</th><th></th></tr></thead>";
    var tbody = document.createElement("tbody");
    users.forEach(function (u) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + esc(u.username) + "</td><td>" + esc(u.fullName || "—") + "</td><td>" + esc(u.role) + "</td>" +
        "<td style='font-size:.8rem;color:var(--muted)'>" + esc((u.createdAt || "").split("T")[0]) + "</td>";
      var td = document.createElement("td");
      if (u.username !== "aiops") {
        var db = document.createElement("button");
        db.className = "secondary-button"; db.type = "button"; db.textContent = "Delete";
        db.style.cssText = "font-size:.78rem;padding:3px 10px";
        db.dataset.delUser = u.username;
        td.appendChild(db);
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
    container.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-del-user]");
      if (!btn) return;
      if (!confirm("Delete user " + btn.dataset.delUser + "?")) return;
      btn.disabled = true;
      fetch("/api/auth/users/" + encodeURIComponent(btn.dataset.delUser), { method: "DELETE", credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d.ok) loadUsers(); else btn.disabled = false; })
        .catch(function () { btn.disabled = false; });
    });
  }

  function setupAddUserBtn() {
    var ab = document.getElementById("addUserBtn");
    if (!ab) return;
    ab.addEventListener("click", function () {
      var errEl = document.getElementById("userError");
      var okEl  = document.getElementById("userSuccess");
      errEl.hidden = true; okEl.hidden = true;
      var username = document.getElementById("newUsername").value.trim();
      var fullName = document.getElementById("newFullName").value.trim();
      var password = document.getElementById("newPassword").value;
      var role     = document.getElementById("newRole").value;
      if (!username || !password) { errEl.textContent = "Username and password required."; errEl.hidden = false; return; }
      ab.disabled = true; ab.textContent = "Adding…";
      fetch("/api/auth/users", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ username: username, fullName: fullName, password: password, role: role })
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          ab.disabled = false; ab.textContent = "Add User";
          if (res.ok) { okEl.textContent = "User " + username + " added."; okEl.hidden = false; document.getElementById("newUsername").value = ""; document.getElementById("newFullName").value = ""; document.getElementById("newPassword").value = ""; loadUsers(); }
          else { errEl.textContent = res.data.error || "Failed."; errEl.hidden = false; }
        }).catch(function () { ab.disabled = false; ab.textContent = "Add User"; errEl.textContent = "Network error."; errEl.hidden = false; });
    });
  }

  ODC.ready.then(init);
}());

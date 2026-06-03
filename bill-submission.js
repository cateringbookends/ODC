"use strict";
(function () {
  var headMap = {};

  function esc(s) { return ODC.escapeHtml(s); }

  function init() {
    loadEvents();
    loadHeads();
    loadBills();
    setupSubmitBtn();
    setupBillsListDelegate();

    var user = window.ODC_USER;
    if (user && user.role === "admin") {
      document.getElementById("billsEyebrow").textContent = "All Submissions";
      document.getElementById("billsTitle").textContent = "All Submitted Bills";
      var adminPanel = document.getElementById("adminUsersPanel");
      adminPanel.hidden = false;
      loadUsers();
      setupAddUserBtn();
    }
  }

  // ---- Events dropdown ----
  function loadEvents() {
    fetch("/api/events", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (events) {
        var sel = document.getElementById("billEvent");
        events.forEach(function (ev) {
          var opt = document.createElement("option");
          opt.value = ev.id;
          opt.textContent = (ev.externalId || ev.id) + " — " + ev.name;
          sel.appendChild(opt);
        });
      })
      .catch(function () { /* offline — options stay empty */ });
  }

  // ---- Heads dropdown ----
  function loadHeads() {
    fetch("/api/master-persons", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (heads) {
        headMap = {};
        var sel = document.getElementById("billHead");
        heads.forEach(function (h) {
          headMap[h.id] = h.name;
          var opt = document.createElement("option");
          opt.value = h.id;
          opt.textContent = h.name;
          sel.appendChild(opt);
        });
      })
      .catch(function () { /* offline */ });
  }

  // ---- Bills list ----
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
      metaSpan.textContent = bill.personName + " · " + (headMap[bill.headId] || bill.headId) + " · " + bill.category;
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
      var submittedDate = bill.submittedAt ? new Date(bill.submittedAt).toLocaleString("en-IN") : "";
      metaDiv.textContent = submittedDate + (bill.reviewedBy ? " · Reviewed by " + bill.reviewedBy : "");
      card.appendChild(metaDiv);

      if (user && user.role === "admin" && bill.status === "pending") {
        var actions = document.createElement("div");
        actions.className = "bill-card-actions";

        var approveBtn = document.createElement("button");
        approveBtn.className = "btn-approve";
        approveBtn.type = "button";
        approveBtn.textContent = "Approve";
        approveBtn.dataset.billId = bill.id;
        approveBtn.dataset.billAction = "approved";

        var rejectBtn = document.createElement("button");
        rejectBtn.className = "btn-reject";
        rejectBtn.type = "button";
        rejectBtn.textContent = "Reject";
        rejectBtn.dataset.billId = bill.id;
        rejectBtn.dataset.billAction = "rejected";

        actions.appendChild(approveBtn);
        actions.appendChild(rejectBtn);
        card.appendChild(actions);
      }

      container.appendChild(card);
    });
  }

  function setupBillsListDelegate() {
    document.getElementById("billsList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-bill-action]");
      if (!btn) return;
      var id = Number(btn.dataset.billId);
      var status = btn.dataset.billAction;
      if (!id || !status) return;
      btn.disabled = true;
      fetch("/api/bills/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ status: status })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d.ok) loadBills(); else btn.disabled = false; })
        .catch(function () { btn.disabled = false; });
    });
  }

  // ---- Submit bill form ----
  function setupSubmitBtn() {
    document.getElementById("billSubmitBtn").addEventListener("click", function () {
      var errEl = document.getElementById("billError");
      var okEl = document.getElementById("billSuccess");
      var btn = this;
      errEl.hidden = true;
      okEl.hidden = true;

      var eventId = document.getElementById("billEvent").value;
      var headId = document.getElementById("billHead").value;
      var personName = document.getElementById("billPerson").value.trim();
      var amount = Number(document.getElementById("billAmount").value);
      var category = document.getElementById("billCategory").value;
      var description = document.getElementById("billDescription").value.trim();

      if (!eventId || !headId || !personName || !(amount > 0)) {
        errEl.textContent = "Event, head, your name, and amount > 0 are required.";
        errEl.hidden = false;
        return;
      }

      btn.disabled = true;
      btn.textContent = "Submitting…";

      fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ eventId: eventId, headId: headId, personName: personName, amount: amount, category: category, description: description })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result) {
          btn.disabled = false;
          btn.textContent = "Submit Bill";
          if (result.ok) {
            okEl.textContent = "Bill submitted successfully!";
            okEl.hidden = false;
            document.getElementById("billEvent").value = "";
            document.getElementById("billHead").value = "";
            document.getElementById("billPerson").value = "";
            document.getElementById("billAmount").value = "";
            document.getElementById("billDescription").value = "";
            document.getElementById("billCategory").value = "misc";
            loadBills();
          } else {
            errEl.textContent = result.data.error || "Submission failed.";
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

  // ---- Admin: Users management ----
  function loadUsers() {
    fetch("/api/auth/users", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(renderUsers)
      .catch(function () { /* ignore */ });
  }

  function renderUsers(users) {
    var container = document.getElementById("usersList");
    container.innerHTML = "";
    if (!users || !users.length) return;

    var table = document.createElement("table");
    table.className = "users-table";
    table.innerHTML = "<thead><tr><th>Username</th><th>Full Name</th><th>Role</th><th>Created</th><th></th></tr></thead>";
    var tbody = document.createElement("tbody");

    users.forEach(function (u) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + esc(u.username) + "</td>" +
        "<td>" + esc(u.fullName || "—") + "</td>" +
        "<td>" + esc(u.role) + "</td>" +
        "<td style='font-size:0.8rem;color:var(--muted)'>" + esc((u.createdAt || "").split("T")[0]) + "</td>";

      var actionTd = document.createElement("td");
      if (u.username !== "aiops") {
        var delBtn = document.createElement("button");
        delBtn.className = "secondary-button";
        delBtn.type = "button";
        delBtn.textContent = "Delete";
        delBtn.style.fontSize = "0.78rem";
        delBtn.style.padding = "3px 10px";
        delBtn.dataset.delUser = u.username;
        actionTd.appendChild(delBtn);
      }
      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);

    container.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-del-user]");
      if (!btn) return;
      var username = btn.dataset.delUser;
      if (!confirm("Delete user " + username + "?")) return;
      btn.disabled = true;
      fetch("/api/auth/users/" + encodeURIComponent(username), { method: "DELETE", credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d.ok) loadUsers(); else btn.disabled = false; })
        .catch(function () { btn.disabled = false; });
    });
  }

  function setupAddUserBtn() {
    document.getElementById("addUserBtn").addEventListener("click", function () {
      var errEl = document.getElementById("userError");
      var okEl = document.getElementById("userSuccess");
      var btn = this;
      errEl.hidden = true;
      okEl.hidden = true;

      var username = document.getElementById("newUsername").value.trim();
      var fullName = document.getElementById("newFullName").value.trim();
      var password = document.getElementById("newPassword").value;
      var role = document.getElementById("newRole").value;

      if (!username || !password) {
        errEl.textContent = "Username and password are required.";
        errEl.hidden = false;
        return;
      }

      btn.disabled = true;
      btn.textContent = "Adding…";

      fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: username, fullName: fullName, password: password, role: role })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result) {
          btn.disabled = false;
          btn.textContent = "Add User";
          if (result.ok) {
            okEl.textContent = "User " + username + " added.";
            okEl.hidden = false;
            document.getElementById("newUsername").value = "";
            document.getElementById("newFullName").value = "";
            document.getElementById("newPassword").value = "";
            document.getElementById("newRole").value = "user";
            loadUsers();
          } else {
            errEl.textContent = result.data.error || "Failed to add user.";
            errEl.hidden = false;
          }
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = "Add User";
          errEl.textContent = "Network error.";
          errEl.hidden = false;
        });
    });
  }

  ODC.ready.then(init);
}());

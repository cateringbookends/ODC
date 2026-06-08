"use strict";
(function () {
  var form  = document.getElementById("loginForm");
  var errEl = document.getElementById("loginError");
  var btn   = document.getElementById("loginBtn");

  function getNextUrl() {
    var params = new URLSearchParams(location.search);
    var next = params.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) return next;
    return "dashboard.html";
  }

  function setLoading(isLoading) {
    btn.disabled = isLoading;
    btn.textContent = isLoading ? "Opening workspace..." : "Sign In";
  }

  // ---- LOCAL SERVER fallback (Firebase not configured) ----
  if (!window.FIREBASE_READY) {
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(function (r) { if (r.ok) window.location.replace(getNextUrl()); })
      .catch(function () {});

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errEl.hidden = true;
      setLoading(true);

      var username = document.getElementById("username").value.trim();
      var password = document.getElementById("password").value;

      fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: username, password: password })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (res.ok) {
            try { sessionStorage.setItem("odcCurrentUser", JSON.stringify(res.data)); } catch (e) {}
            window.location.replace(getNextUrl());
          } else {
            errEl.textContent = res.data.error || "Invalid username or password.";
            errEl.hidden = false;
            setLoading(false);
          }
        })
        .catch(function () {
          errEl.textContent = "Network error. Is the server running?";
          errEl.hidden = false;
          setLoading(false);
        });
    });
    return;
  }

  // ---- FIREBASE path ----
  ODC_AUTH.onAuthStateChanged(function (user) {
    if (user) window.location.replace(getNextUrl());
  });

  FB.ensureAdminExists().catch(function () {});

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errEl.hidden = true;
    setLoading(true);

    var username = document.getElementById("username").value.trim().toLowerCase();
    var password = document.getElementById("password").value;

    ODC_AUTH.signInWithEmailAndPassword(username + "@odc.local", password)
      .then(function () { window.location.replace(getNextUrl()); })
      .catch(function (err) {
        var msg = "Invalid username or password.";
        if (err.code === "auth/too-many-requests") msg = "Too many attempts. Try again later.";
        errEl.textContent = msg;
        errEl.hidden = false;
        setLoading(false);
      });
  });
}());

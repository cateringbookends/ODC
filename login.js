"use strict";
(function () {
  var form = document.getElementById("loginForm");
  var errEl = document.getElementById("loginError");
  var btn = document.getElementById("loginBtn");

  // Already logged in → redirect home
  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function (r) { if (r.ok) window.location.replace("/"); })
    .catch(function () { /* ignore */ });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = "Signing in…";

    var username = document.getElementById("username").value.trim();
    var password = document.getElementById("password").value;

    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (result) {
        if (result.ok) {
          window.location.replace("/");
        } else {
          errEl.textContent = result.data.error || "Login failed.";
          errEl.hidden = false;
          btn.disabled = false;
          btn.textContent = "Sign in";
        }
      })
      .catch(function () {
        errEl.textContent = "Network error. Please try again.";
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = "Sign in";
      });
  });
}());

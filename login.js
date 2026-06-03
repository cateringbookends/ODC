"use strict";
(function () {
  // Wait for Firebase SDK
  function ready(cb) {
    if (window.ODC_AUTH) return cb();
    window.addEventListener("load", function () {
      const check = setInterval(function () {
        if (window.ODC_AUTH) { clearInterval(check); cb(); }
      }, 100);
    });
  }

  ready(function () {
    // Already logged in → go home
    ODC_AUTH.onAuthStateChanged(function (user) {
      if (user) window.location.replace("index.html");
    });

    // Ensure default admin exists on first visit
    FB.ensureAdminExists().catch(function () {});

    var form = document.getElementById("loginForm");
    var errEl = document.getElementById("loginError");
    var btn   = document.getElementById("loginBtn");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errEl.hidden = true;
      btn.disabled = true;
      btn.textContent = "Signing in…";

      var username = document.getElementById("username").value.trim().toLowerCase();
      var password = document.getElementById("password").value;
      var email    = username + "@odc.local";

      ODC_AUTH.signInWithEmailAndPassword(email, password)
        .then(function () {
          window.location.replace("index.html");
        })
        .catch(function (err) {
          var msg = "Invalid username or password.";
          if (err.code === "auth/too-many-requests") msg = "Too many attempts. Try again later.";
          errEl.textContent = msg;
          errEl.hidden = false;
          btn.disabled = false;
          btn.textContent = "Sign in";
        });
    });
  });
}());

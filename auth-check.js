"use strict";
(function () {
  document.documentElement.style.visibility = "hidden";

  function restore() { document.documentElement.style.visibility = ""; }

  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function (r) {
      if (r.status === 401) { window.location.replace("login.html"); throw null; }
      if (!r.ok) { restore(); throw null; }
      return r.json();
    })
    .then(function (user) {
      if (!user) return;
      window.ODC_USER = user;
      restore();

      function populateNav() {
        var el = document.getElementById("nav-user");
        if (!el) return;
        el.replaceChildren();

        var span = document.createElement("span");
        span.className = "nav-username";
        span.textContent = user.fullName || user.username;

        if (user.role === "admin") {
          var badge = document.createElement("span");
          badge.className = "nav-role-badge";
          badge.textContent = "Admin";
          span.appendChild(document.createTextNode(" "));
          span.appendChild(badge);
        }

        var btn = document.createElement("button");
        btn.className = "btn-logout";
        btn.type = "button";
        btn.textContent = "Logout";
        btn.addEventListener("click", function () {
          fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
            .finally(function () { window.location.replace("login.html"); });
        });

        el.appendChild(span);
        el.appendChild(btn);
      }

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", populateNav);
      } else {
        populateNav();
      }
    })
    .catch(function (e) { if (e !== null) restore(); });
}());

"use strict";
(function () {
  document.documentElement.style.visibility = "hidden";
  function restore() { document.documentElement.style.visibility = ""; }

  // ---- LOCAL SERVER fallback (Firebase not configured) ----
  if (!window.FIREBASE_READY) {
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(function (r) {
        if (r.status === 401) { window.location.replace("login.html"); return null; }
        return r.json();
      })
      .then(function (user) {
        if (!user) return;
        window.ODC_USER = user;
        restore();
        populateNav(user);
      })
      .catch(function () { restore(); });
    return;
  }

  // ---- FIREBASE path ----
  ODC_AUTH.onAuthStateChanged(function (user) {
    if (!user) { window.location.replace("login.html"); return; }

    ODC_DB.collection("users").doc(user.uid).get().then(function (doc) {
      var profile = doc.exists ? doc.data() : {};
      window.ODC_USER = {
        uid: user.uid,
        username: profile.username || user.email,
        role: profile.role || "user",
        fullName: profile.fullName || ""
      };
      restore();
      populateNav(window.ODC_USER);
    }).catch(function () { restore(); });
  });

  function populateNav(user) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { buildNav(user); });
    } else {
      buildNav(user);
    }
  }

  function buildNav(user) {
    var el = document.getElementById("nav-user");
    if (!el) return;

    var span = document.createElement("span");
    span.className = "nav-username";
    span.textContent = user.username;

    if (user.role === "admin") {
      var badge = document.createElement("span");
      badge.className = "nav-role-badge";
      badge.textContent = "Admin";
      span.appendChild(document.createTextNode(" "));
      span.appendChild(badge);
    }

    var btn = document.createElement("button");
    btn.className = "btn-logout";
    btn.type = "button";
    btn.textContent = "Logout";
    btn.addEventListener("click", function () {
      if (window.FIREBASE_READY && window.ODC_AUTH) {
        ODC_AUTH.signOut().then(function () { window.location.replace("login.html"); });
      } else {
        fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
          .finally(function () { window.location.replace("login.html"); });
      }
    });

    el.appendChild(span);
    el.appendChild(btn);
  }
}());

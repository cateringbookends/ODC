"use strict";
/**
 * firebase-auth.js — replaces auth-check.js
 * Loaded first in <head> on all protected pages.
 * Hides page until Firebase Auth confirms user is logged in.
 */
(function () {
  document.documentElement.style.visibility = "hidden";

  function restore() { document.documentElement.style.visibility = ""; }

  // Wait for Firebase to initialise
  function waitForFirebase(cb) {
    if (window.ODC_AUTH) return cb();
    document.addEventListener("DOMContentLoaded", () => {
      if (window.ODC_AUTH) cb();
      else setTimeout(() => window.ODC_AUTH ? cb() : window.location.replace("/login.html"), 1500);
    });
  }

  waitForFirebase(function () {
    ODC_AUTH.onAuthStateChanged(function (user) {
      if (!user) {
        window.location.replace("login.html");
        return;
      }

      ODC_DB.collection("users").doc(user.uid).get().then(function (doc) {
        const profile = doc.exists ? doc.data() : {};
        window.ODC_USER = {
          uid: user.uid,
          username: profile.username || user.email,
          role: profile.role || "user",
          fullName: profile.fullName || ""
        };

        restore();

        function populateNav() {
          const el = document.getElementById("nav-user");
          if (!el) return;

          const span = document.createElement("span");
          span.className = "nav-username";
          span.textContent = window.ODC_USER.username;

          if (window.ODC_USER.role === "admin") {
            const badge = document.createElement("span");
            badge.className = "nav-role-badge";
            badge.textContent = "Admin";
            span.appendChild(document.createTextNode(" "));
            span.appendChild(badge);
          }

          const btn = document.createElement("button");
          btn.className = "btn-logout";
          btn.type = "button";
          btn.textContent = "Logout";
          btn.addEventListener("click", function () {
            ODC_AUTH.signOut().then(function () {
              window.location.replace("login.html");
            });
          });

          el.appendChild(span);
          el.appendChild(btn);
        }

        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", populateNav);
        } else {
          populateNav();
        }
      }).catch(function () { restore(); });
    });
  });
}());

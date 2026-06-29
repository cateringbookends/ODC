(async function () {
  const USER_CACHE_KEY = "odcCurrentUser";
  const NAV_ITEMS = [
    ["Dashboard", "dashboard.html", ""],
    ["Sales Intake", "index.html", ""],
    ["Saved Events", "saved-events.html", ""],
    ["Pre Cost", "pre-cost-planning.html", ""],
    ["Petty Cash", "petty-cash.html", ""],
    ["Bill Submission", "bill-submission.html", ""],
    ["Financial Control", "financial-control.html", ""],
    ["Analytics", "analytics.html", ""],
    ["Master Persons", "master-persons.html", ""],
    ["Admin", "admin.html", "admin"],
    ["FAQ", "faq.html", ""]
  ];
  let cachedUser = null;
  try { cachedUser = JSON.parse(sessionStorage.getItem(USER_CACHE_KEY) || "null"); } catch { cachedUser = null; }
  if (!cachedUser) document.body.style.visibility = "hidden";

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function ensureLoader() {
    let loader = document.getElementById("odcPageLoader");
    if (loader) return loader;
    loader = document.createElement("div");
    loader.id = "odcPageLoader";
    loader.className = "odc-page-loader";
    loader.innerHTML = '<div class="odc-loader-mark"></div><span>Loading workspace</span>';
    document.body.append(loader);
    return loader;
  }

  function showLoader(text) {
    const loader = ensureLoader();
    const label = loader.querySelector("span");
    if (label && text) label.textContent = text;
    loader.classList.add("is-visible");
  }

  function hideLoader() {
    const loader = document.getElementById("odcPageLoader");
    if (loader) loader.classList.remove("is-visible");
  }

  function renderNavigation(user) {
    const nav = document.querySelector(".top-nav-links");
    if (!nav) return;
    const current = location.pathname.split("/").pop() || "dashboard.html";
    const wanted = NAV_ITEMS.filter(([, , role]) => !(role === "admin" && user.role !== "admin"));
    const existing = [...nav.querySelectorAll("a")].map((link) => [link.textContent.trim(), link.getAttribute("href") || ""]);
    const sameNav = existing.length === wanted.length && wanted.every(([label, href], index) => existing[index] && existing[index][0] === label && existing[index][1] === href);
    if (!sameNav) nav.replaceChildren();
    wanted.forEach(([label, href, role]) => {
      if (role === "admin" && user.role !== "admin") return;
      let link = sameNav ? [...nav.querySelectorAll("a")].find((item) => item.getAttribute("href") === href) : null;
      if (!link) {
        link = document.createElement("a");
        link.href = href;
        link.textContent = label;
        nav.append(link);
      }
      link.className = "";
      if (role === "admin") link.dataset.adminOnly = "";
      if (href === current || (current === "" && href === "dashboard.html")) link.className = "active";
      link.onclick = (event) => {
        const target = new URL(href, location.href);
        if (target.pathname === location.pathname && target.search === location.search) {
          event.preventDefault();
          return;
        }
        showLoader("Opening " + label);
      };
    });
    ensureNavScroller(nav);
    nav.dataset.ready = "true";
  }

  function ensureNavScroller(nav) {
    const host = nav.closest(".top-nav");
    if (!host || host.querySelector(".nav-scroll-btn")) return;
    const makeBtn = (dir) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-scroll-btn nav-scroll-" + dir;
      btn.setAttribute("aria-label", dir === "left" ? "Scroll navigation left" : "Scroll navigation right");
      btn.textContent = dir === "left" ? "<" : ">";
      btn.addEventListener("click", () => {
        nav.scrollBy({ left: dir === "left" ? -220 : 220, behavior: "smooth" });
      });
      return btn;
    };
    host.append(makeBtn("left"), makeBtn("right"));
  }

  function renderUser(user) {
    document.body.classList.add("odc-app-ready");
    ensureLoader();
    renderNavigation(user);
    const navUser = document.getElementById("nav-user");
    if (navUser) {
      navUser.replaceChildren();
      const avatar = document.createElement("span");
      avatar.className = "nav-avatar";
      avatar.textContent = String(user.fullName || user.username || "U").trim().charAt(0).toUpperCase();
      const identity = document.createElement("span");
      identity.className = "nav-identity";
      const nameEl = document.createElement("span");
      nameEl.className = "nav-username";
      nameEl.textContent = user.fullName || user.username;
      const roleEl = document.createElement("span");
      roleEl.className = "nav-role nav-role-" + user.role;
      roleEl.textContent = user.role === "admin" ? "Admin" : "Staff";
      identity.append(nameEl, roleEl);
      const logoutBtn = document.createElement("button");
      logoutBtn.className = "nav-logout-btn";
      logoutBtn.type = "button";
      logoutBtn.textContent = "Logout";
      logoutBtn.addEventListener("click", async () => {
        showLoader("Signing out");
        sessionStorage.removeItem(USER_CACHE_KEY);
        try { await fetch("api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch { /* ignore */ }
        location.href = "login.html";
      });
      navUser.append(avatar, identity, logoutBtn);
    }
    if (user.role !== "admin") {
      document.querySelectorAll("[data-admin-only]").forEach(el => { el.hidden = true; });
    }
    window.setTimeout(hideLoader, 180);
  }

  function recordPageView(user) {
    if (!user) return;
    const payload = {
      page: location.pathname.split("/").pop() || "dashboard.html",
      title: document.title || ""
    };
    try {
      fetch("api/admin/page-hit", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(() => {});
    } catch { /* ignore telemetry failure */ }
  }

  if (cachedUser) {
    window.ODC_USER = cachedUser;
    onReady(() => { renderUser(cachedUser); });
  }

  try {
    const res = await fetch("api/auth/me", { credentials: "same-origin" });
    if (res.status === 401) {
      sessionStorage.removeItem(USER_CACHE_KEY);
      const next = encodeURIComponent(location.pathname + location.search);
      location.replace("login.html?next=" + next);
      return;
    }
    if (res.ok) {
      const user = await res.json();
      window.ODC_USER = user;
      sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
      onReady(() => {
        renderUser(user);
        window.setTimeout(() => recordPageView(user), 300);
      });
    }
  } catch {
    sessionStorage.removeItem(USER_CACHE_KEY);
    location.replace("login.html");
    return;
  }
  document.body.style.visibility = "";
  onReady(() => window.setTimeout(hideLoader, 220));
})();

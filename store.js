/**
 * ODC shared client core — loaded first on every page.
 * Provides: REST API client, offline localStorage cache helpers, HTML escaping,
 * a `ready` promise (resolves after the first server hydration attempt), and a
 * sync-callback registry so views re-render when fresh server data arrives.
 *
 * Design: reads stay synchronous against an in-memory cache (hydrated from
 * localStorage instantly, then refreshed from the server), so existing page
 * code keeps working. Writes update the cache + localStorage immediately and
 * persist to the server in the background (offline-tolerant).
 */
window.ODC = (function () {
  const boots = [];
  const syncFns = [];
  const liveFns = [];
  let online = true;
  let liveVersion = "";
  let liveTimer = null;
  let resolveReady;
  const ready = new Promise((res) => { resolveReady = res; });

  // api() — local server fetch when Firebase not configured, Firestore otherwise.
  async function api(method, pathName, body) {
    // ---- LOCAL SERVER fallback (Firebase not configured) ----
    if (!window.FIREBASE_READY) {
      const res = await fetch(pathName, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: "same-origin"
      });
      if (!res.ok) {
        let msg = `${res.status}`;
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch { /* ignore */ }
        throw new Error(msg);
      }
      if (res.status === 204) return null;
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
    // ---- FIREBASE path ----
    if (!window.FB) throw new Error("Firebase backend not loaded");
    const m = method.toUpperCase();
    // Events
    if (pathName === "/api/events" && m === "GET")  return FB.getAllEvents();
    if (pathName === "/api/events" && m === "POST") return FB.upsertEvent(body);
    if (pathName.match(/^\/api\/events\/([^/]+)$/) && m === "GET") {
      const id = decodeURIComponent(pathName.split("/")[3]);
      return FB.getEventById ? FB.getEventById(id) : FB.getAllEvents().then((evs) => (evs || []).find((e) => e.id === id) || null);
    }
    if (pathName.match(/^\/api\/events\/([^/]+)$/) && m === "DELETE") {
      const id = decodeURIComponent(pathName.split("/")[3]);
      return FB.deleteEvent(id);
    }
    if (pathName.match(/^\/api\/events\/([^/]+)\/petty-cash$/)) {
      const id = decodeURIComponent(pathName.split("/")[3]);
      if (m === "GET") return FB.getPettyCash(id);
      if (m === "PUT") return FB.savePettyCash(id, body);
    }
    if (pathName.match(/^\/api\/events\/([^/]+)\/pre-cost$/)) {
      const id = decodeURIComponent(pathName.split("/")[3]);
      if (m === "GET") return FB.getPreCost(id);
      if (m === "PUT") return FB.savePreCost(id, body);
    }
    // Master persons
    if (pathName === "/api/master-persons" && m === "GET") return FB.getMasterPersons();
    if (pathName === "/api/master-persons" && m === "PUT") return FB.saveMasterPersons(body);
    // Bills
    if (pathName === "/api/bills" && m === "GET")  return FB.getBills(window.ODC_USER && window.ODC_USER.role === "admin");
    if (pathName === "/api/bills" && m === "POST") return FB.createBill(body);
    if (pathName.match(/^\/api\/bills\/([^/]+)$/) && m === "PUT") {
      const id = pathName.split("/")[3];
      return FB.reviewBill(id, body.status, window.ODC_USER ? window.ODC_USER.username : "admin");
    }
    // Users
    if (pathName === "/api/auth/users" && m === "GET") return FB.getAllUsers();
    if (pathName === "/api/auth/users" && m === "POST") return FB.createUser(body.username, body.password, body.fullName, body.role);
    if (pathName.match(/^\/api\/auth\/users\/([^/]+)$/) && m === "DELETE") {
      const uid = decodeURIComponent(pathName.split("/")[4]);
      return FB.deleteUser(uid);
    }
    throw new Error("Unknown API path: " + pathName);
  }

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ESC[c]);
  }

  // ---- Strict DD-MM-YYYY date handling (browser-independent; native <input type=date> shows OS locale) ----
  function dmyToIso(dmy) {
    const m = String(dmy == null ? "" : dmy).trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!m) return "";
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    const dt = new Date(`${iso}T00:00:00`);
    if (dt.getFullYear() !== y || dt.getMonth() + 1 !== mo || dt.getDate() !== d) return ""; // rejects 31-02 etc.
    return iso;
  }
  function isoToDmy(iso) {
    const text = String(iso == null ? "" : iso).trim();
    const dmy = text.match(/^(\d{2})-(\d{2})-(\d{4})/);
    if (dmy) return dmy[0];
    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
  }
  function syncDatePicker(input, picker) {
    const iso = dmyToIso(input.value);
    picker.value = iso || "";
  }
  function syncDmyDatePicker(input) {
    if (input?._dmyPicker) syncDatePicker(input, input._dmyPicker);
  }
  function attachDatePicker(input) {
    if (!input || input.dataset.dmyPicker) return null;
    input.dataset.dmyPicker = "1";

    const wrap = document.createElement("div");
    wrap.className = "dmy-date-control";
    input.parentNode.insertBefore(wrap, input);
    wrap.append(input);

    const picker = document.createElement("input");
    picker.type = "date";
    picker.className = "dmy-picker";
    picker.value = "";
    picker.tabIndex = -1;
    picker.setAttribute("aria-label", `${input.closest("label")?.querySelector("span")?.textContent || "Date"} calendar`);
    picker.addEventListener("change", () => {
      input.value = isoToDmy(picker.value);
      input.classList.remove("invalid-date");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      picker.blur();
    });
    picker.addEventListener("keyup", (event) => {
      if (event.key === "Escape" || event.key === "Enter") picker.blur();
    });
    input._dmyPicker = picker;
    wrap.append(picker);
    return picker;
  }
  // Turn a text input into an auto-formatting DD-MM-YYYY field (digits -> DD-MM-YYYY).
  function attachDateMask(input) {
    if (!input || input.dataset.dmyMask) return;
    input.dataset.dmyMask = "1";
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("maxlength", "10");
    if (!input.placeholder) input.placeholder = "DD-MM-YYYY";
    const picker = attachDatePicker(input);
    const reformat = () => {
      const digits = input.value.replace(/\D/g, "").slice(0, 8);
      let out = digits.slice(0, 2);
      if (digits.length > 2) out += "-" + digits.slice(2, 4);
      if (digits.length > 4) out += "-" + digits.slice(4, 8);
      input.value = out;
      input.classList.toggle("invalid-date", input.value.length === 10 && !dmyToIso(input.value));
      if (picker) syncDatePicker(input, picker);
    };
    input.addEventListener("input", reformat);
    input.addEventListener("change", () => { if (picker) syncDatePicker(input, picker); });
    input.addEventListener("blur", () => {
      input.classList.toggle("invalid-date", !!input.value && !dmyToIso(input.value));
      if (picker) syncDatePicker(input, picker);
    });
    if (picker) syncDatePicker(input, picker);
  }

  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn("localStorage write failed:", e && e.message); }
  }

  const inrCompact = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  function eventContextText(event, options = {}) {
    const date = isoToDmy(event?.date || event?.eventDate || "") || "No date";
    const pax = Number(event?.pax) || 0;
    const cost = Number(event?.costPerPax) || 0;
    const parts = [
      date,
      `${pax.toLocaleString("en-IN")} PAX`,
      `${inrCompact.format(cost)} / PAX`
    ];
    if (options.includeDays && Number(event?.days) > 1) parts.splice(2, 0, `${Number(event.days)} days`);
    return parts.join(" | ");
  }

  function addBoot(fn) { boots.push(fn); }
  function addLiveRefresh(fn) { liveFns.push(fn); }
  function registerSync(fn) { syncFns.push(fn); }
  function notifySync() {
    syncFns.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }
  async function refreshLiveData() {
    if (!liveFns.length) return;
    await Promise.all(liveFns.map((fn) => Promise.resolve().then(fn).catch((e) => console.warn("Live refresh failed:", e && e.message))));
    window.dispatchEvent(new CustomEvent("odc:live-data", { detail: { version: liveVersion } }));
  }
  async function checkLiveVersion() {
    if (document.hidden || !navigator.onLine) return;
    try {
      const data = await api("GET", "/api/live/version");
      const next = String(data && data.version || "");
      if (!next) return;
      if (!liveVersion) {
        liveVersion = next;
        return;
      }
      if (next !== liveVersion) {
        liveVersion = next;
        await refreshLiveData();
      }
    } catch { /* live polling should never disturb normal page work */ }
  }
  function startLivePolling() {
    if (liveTimer) return;
    window.addEventListener("odc:live-data", () => {
      document.body.dataset.liveUpdatedAt = new Date().toISOString();
    });
    checkLiveVersion();
    liveTimer = window.setInterval(checkLiveVersion, 6000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkLiveVersion();
    });
  }

  function boot() {
    resolveReady();
    notifySync();
    Promise.all(boots.map((b) => b()))
      .then(() => { online = true; notifySync(); startLivePolling(); })
      .catch((e) => {
        online = false;
        console.warn("ODC running offline (using local cache):", e && e.message);
        startLivePolling();
      });
  }
  // Boot after all in-body scripts (and their addBoot/registerSync calls) have run.
  window.addEventListener("DOMContentLoaded", boot);

  return { ready, api, escapeHtml, dmyToIso, isoToDmy, eventContextText, attachDateMask, syncDmyDatePicker, lsGet, lsSet, addBoot, addLiveRefresh, registerSync, notifySync, isOnline: () => online };
})();

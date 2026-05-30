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
  let online = true;
  let resolveReady;
  const ready = new Promise((res) => { resolveReady = res; });

  async function api(method, pathName, body) {
    const res = await fetch(pathName, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
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

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ESC[c]);
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

  function addBoot(fn) { boots.push(fn); }
  function registerSync(fn) { syncFns.push(fn); }
  function notifySync() {
    syncFns.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }

  async function boot() {
    try {
      await Promise.all(boots.map((b) => b()));
      online = true;
    } catch (e) {
      online = false;
      console.warn("ODC running offline (using local cache):", e && e.message);
    } finally {
      resolveReady();
      notifySync();
    }
  }
  // Boot after all in-body scripts (and their addBoot/registerSync calls) have run.
  window.addEventListener("DOMContentLoaded", boot);

  return { ready, api, escapeHtml, lsGet, lsSet, addBoot, registerSync, notifySync, isOnline: () => online };
})();

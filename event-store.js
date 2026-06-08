/**
 * Event data layer — server (SQLite) backed with an offline localStorage cache.
 * Synchronous reads run against the in-memory cache (hydrated from localStorage
 * instantly, refreshed from the server at boot). Writes update the cache + cache
 * mirror immediately and persist to the server in the background.
 */
const ODC_EVENTS_KEY = "odcSavedEvents";
const ODC_EVENTS_SEEDED_KEY = "odcSavedEventsSeeded";

let _events = ODC.lsGet(ODC_EVENTS_KEY, []);

function normalizeEvent(event) {
  const pax = Number(event.pax) || 0;
  const rawDays = Number(event.days);
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.floor(rawDays) : 1; // 0/blank/NaN -> 1 (an event spans >= 1 day)
  const costPerPax = Number(event.costPerPax) || 0;
  const baseBilling = pax * days * costPerPax;
  const gstRate = window.ODC_DATA?.defaults?.gstRate ?? 0.05;

  return {
    ...event,
    pax,
    days,
    costPerPax,
    totalBilling: baseBilling + (baseBilling * gstRate)
  };
}

function byDate(a, b) {
  return String(a.date || "").localeCompare(String(b.date || ""));
}

function getSavedEvents() {
  return _events.map(normalizeEvent);
}

function getAllEvents() {
  const saved = getSavedEvents();
  if (saved.length) return saved.sort(byDate);
  if (ODC.lsGet(ODC_EVENTS_SEEDED_KEY, false)) return [];
  // Offline first-run fallback: seed data shipped in data.js.
  const seeds = (window.ODC_DATA?.events || []).map(normalizeEvent);
  return seeds.sort(byDate);
}

function getEventById(id) {
  return getSavedEvents().find((e) => String(e.id) === String(id)) || getAllEvents().find((e) => String(e.id) === String(id)) || null;
}

function createEventId() {
  return `EVT-${Date.now()}`;
}

function createExternalId(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const prefix = `EVT-${year}${month}${day}-`;
  // Count only events already numbered for THIS day, so same-day saves stay unique.
  const count = _events.filter((e) => String(e.externalId || "").startsWith(prefix)).length + 1;
  return `${prefix}${String(count).padStart(3, "0")}`;
}

function _cacheUpsert(normalized) {
  const i = _events.findIndex((item) => String(item.id) === String(normalized.id));
  if (i >= 0) _events[i] = normalized;
  else _events.unshift(normalized);
  ODC.lsSet(ODC_EVENTS_KEY, _events);
  ODC.lsSet(ODC_EVENTS_SEEDED_KEY, true);
}

function upsertEvent(event) {
  const normalized = normalizeEvent(event);
  ODC.lsSet(ODC_EVENTS_SEEDED_KEY, true);
  _cacheUpsert(normalized);

  ODC.api("POST", "/api/events", normalized)
    .then((saved) => {
      if (saved) { _cacheUpsert(normalizeEvent(saved)); ODC.notifySync(); }
    })
    .catch((e) => console.warn("Event saved locally; server sync failed:", e.message));

  return normalized;
}

function deleteEvent(id) {
  ODC.lsSet(ODC_EVENTS_SEEDED_KEY, true);
  _events = _events.filter((e) => String(e.id) !== String(id));
  ODC.lsSet(ODC_EVENTS_KEY, _events);
  return ODC.api("DELETE", `/api/events/${encodeURIComponent(id)}`)
    .then(() => ODC.notifySync())
    .catch((e) => console.warn("Deleted locally; server sync failed:", e.message));
}

/* ---- Petty cash + pre-cost persistence (per event, server-backed) ---- */

async function getPettyCash(eventId) {
  try { return await ODC.api("GET", `/api/events/${encodeURIComponent(eventId)}/petty-cash`); }
  catch { return ODC.lsGet(`odcPetty:${eventId}`, { payouts: [], petty: [] }); }
}
function savePettyCash(eventId, data) {
  ODC.lsSet(`odcPetty:${eventId}`, data);
  return ODC.api("PUT", `/api/events/${encodeURIComponent(eventId)}/petty-cash`, data);
}

async function getPreCost(eventId) {
  const cached = ODC.lsGet(`odcPreCost:${eventId}`, null);
  try {
    const remote = await ODC.api("GET", `/api/events/${encodeURIComponent(eventId)}/pre-cost`);
    if (remote && cached && typeof remote === "object" && typeof cached === "object") return { ...cached, ...remote };
    return remote;
  } catch {
    return cached;
  }
}
function savePreCost(eventId, data) {
  ODC.lsSet(`odcPreCost:${eventId}`, data);
  return ODC.api("PUT", `/api/events/${encodeURIComponent(eventId)}/pre-cost`, data);
}

// Hydrate event cache from the server at boot.
async function refreshEventsFromServer() {
  const data = await ODC.api("GET", "/api/events");
  if (Array.isArray(data)) {
    _events = data;
    ODC.lsSet(ODC_EVENTS_KEY, _events);
    ODC.lsSet(ODC_EVENTS_SEEDED_KEY, true);
  }
}

ODC.addBoot(refreshEventsFromServer);
ODC.addLiveRefresh(refreshEventsFromServer);

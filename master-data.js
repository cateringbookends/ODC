/**
 * Master persons data layer — server (SQLite) backed with offline cache.
 * Keeps the synchronous getMasterPersons()/saveMasterPersons() API the pages
 * already use; persists to /api/master-persons in the background.
 */
const ODC_MASTER_KEY = "odcMasterPersons";

const ODC_MASTER_DEFAULTS = [
  {
    id: "head-operations",
    name: "Operations Head",
    persons: [
      { name: "Floor Manager" },
      { name: "Logistics Lead" },
      { name: "Service Supervisor" }
    ]
  },
  {
    id: "head-kitchen",
    name: "Kitchen Head",
    persons: [
      { name: "Head Chef" },
      { name: "Food Runner Lead" },
      { name: "Utility Lead" }
    ]
  }
];

let _heads = ODC.lsGet(ODC_MASTER_KEY, null);

function normalizePerson(person) {
  if (typeof person === "string") return { name: person, code: "", designation: "", department: "", location: "" };
  const p = person || {};
  return {
    name: String(p.name || p.personName || "").trim(),
    code: String(p.code || p.employeeCode || "").trim(),
    designation: String(p.designation || "").trim(),
    department: String(p.department || "").trim(),
    location: String(p.location || "").trim()
  };
}

function normalizeHead(head) {
  const h = head || {};
  return {
    id: String(h.id || "").trim(),
    name: String(h.name || "").trim(),
    persons: Array.isArray(h.persons) ? h.persons.map(normalizePerson).filter((p) => p.name) : []
  };
}

function getMasterPersons() {
  const source = Array.isArray(_heads) && _heads.length ? _heads : ODC_MASTER_DEFAULTS;
  return source.map(normalizeHead);
}

function saveMasterPersons(heads) {
  _heads = Array.isArray(heads) ? heads.map(normalizeHead) : [];
  ODC.lsSet(ODC_MASTER_KEY, _heads);
  ODC.api("PUT", "/api/master-persons", _heads)
    .then(() => ODC.notifySync())
    .catch((e) => console.warn("Master persons saved locally; server sync failed:", e.message));
}

ODC.addBoot(async () => {
  const data = await ODC.api("GET", "/api/master-persons");
  if (Array.isArray(data) && data.length) {
    _heads = data.map(normalizeHead);
    ODC.lsSet(ODC_MASTER_KEY, _heads);
  }
});

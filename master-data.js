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
    persons: ["Floor Manager", "Logistics Lead", "Service Supervisor"]
  },
  {
    id: "head-kitchen",
    name: "Kitchen Head",
    persons: ["Head Chef", "Food Runner Lead", "Utility Lead"]
  }
];

let _heads = ODC.lsGet(ODC_MASTER_KEY, null);

function getMasterPersons() {
  return Array.isArray(_heads) && _heads.length ? _heads : ODC_MASTER_DEFAULTS;
}

function saveMasterPersons(heads) {
  _heads = heads;
  ODC.lsSet(ODC_MASTER_KEY, heads);
  ODC.api("PUT", "/api/master-persons", heads)
    .then(() => ODC.notifySync())
    .catch((e) => console.warn("Master persons saved locally; server sync failed:", e.message));
}

ODC.addBoot(async () => {
  const data = await ODC.api("GET", "/api/master-persons");
  if (Array.isArray(data) && data.length) {
    _heads = data;
    ODC.lsSet(ODC_MASTER_KEY, _heads);
  }
});

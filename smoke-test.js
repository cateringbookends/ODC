"use strict";

/** End-to-end smoke test for the ODC API. Assumes `node server.js` is running. */
const BASE = `http://localhost:${process.env.PORT || 5050}`;

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); }
  else { fail++; console.error(`  FAIL- ${name}${extra ? "  :: " + extra : ""}`); }
}
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch { /* may be empty */ }
  return { status: res.status, json };
}

(async () => {
  console.log(`Smoke testing ${BASE}`);

  // 1. seed events present
  let r = await api("GET", "/api/events");
  check("GET /api/events returns array", Array.isArray(r.json), JSON.stringify(r.json));
  check("seed events present (>=3)", r.json.length >= 3, `len=${r.json.length}`);

  // 2. create event with schedule + online + KYC
  const id = `EVT-TEST-${Date.now()}`;
  const payload = {
    id,
    externalId: "EVT-TEST-001",
    entryDate: "2026-05-30",
    date: "2026-08-15",
    name: "Smoke <b>Test</b> Event",
    location: "Test Hall",
    pax: 100,
    days: 2,
    costPerPax: 500,
    status: "open",
    time: "6:30 PM",
    foodType: "jain",
    allergicCount: 7,
    allergicNotes: "5 no nuts, 2 no dairy",
    locationZone: "surat",
    paymentSchedule: [
      { label: "Advance", dueDate: "2026-08-12", amount: 50000, billing: "cash", method: "UPI", isAdvance: true },
      { label: "Balance", dueDate: "2026-08-15", amount: 50000, billing: "online", method: "Card", isAdvance: false }
    ],
    invoiceKyc: { name: "Acme", mobile: "9876543210", email: "a@b.com", gst: "29ABCDE1234F1Z5", pan: "ABCDE1234F", aadhar: "123456789012" }
  };
  r = await api("POST", "/api/events", payload);
  check("POST event -> 200", r.status === 200, JSON.stringify(r.json));
  check("total_billing computed (100*2*500=100000)", r.json && r.json.totalBilling === 100000, r.json && String(r.json.totalBilling));
  check("payment schedule round-trips with isAdvance", r.json && r.json.paymentSchedule.length === 2 && r.json.paymentSchedule[0].isAdvance === true);
  check("online method preserved", r.json && r.json.paymentSchedule[1].method === "Card");
  check("KYC mapped back (camelCase)", r.json && r.json.invoiceKyc.pan === "ABCDE1234F" && r.json.invoiceKyc.aadhar === "123456789012");
  check("new fields round-trip (time/food/allergic/zone)", r.json && r.json.time === "6:30 PM" && r.json.foodType === "jain" && r.json.allergicCount === 7 && r.json.allergicNotes === "5 no nuts, 2 no dairy" && r.json.locationZone === "surat", JSON.stringify({ t: r.json && r.json.time, f: r.json && r.json.foodType, c: r.json && r.json.allergicCount, z: r.json && r.json.locationZone }));

  // invalid food type / zone rejected
  r = await api("POST", "/api/events", { ...payload, id: id + "-badfood", foodType: "vegan" });
  check("invalid foodType -> 400", r.status === 400, JSON.stringify(r.json));
  r = await api("POST", "/api/events", { ...payload, id: id + "-badzone", locationZone: "mumbai" });
  check("invalid zone -> 400", r.status === 400, JSON.stringify(r.json));
  r = await api("POST", "/api/events", payload); // re-create the canonical test event for later steps

  // 3. event listed
  r = await api("GET", "/api/events");
  check("created event appears in list", r.json.some((e) => e.id === id));

  // 4. update same event (upsert by client_id, not duplicate)
  const beforeLen = (await api("GET", "/api/events")).json.length;
  await api("POST", "/api/events", { ...payload, location: "Updated Hall" });
  r = await api("GET", "/api/events");
  check("upsert does not duplicate", r.json.length === beforeLen, `before=${beforeLen} after=${r.json.length}`);
  check("update persisted", r.json.find((e) => e.id === id).location === "Updated Hall");

  // 5. validation rejects bad PAN
  r = await api("POST", "/api/events", { ...payload, id: id + "-bad", invoiceKyc: { ...payload.invoiceKyc, pan: "BADPAN" } });
  check("invalid PAN -> 400", r.status === 400, JSON.stringify(r.json));

  // 6. master persons
  const heads = [{ id: "head-x", name: "Test Head", persons: ["P1", "P2"] }];
  r = await api("PUT", "/api/master-persons", heads);
  check("PUT master-persons -> 200", r.status === 200);
  r = await api("GET", "/api/master-persons");
  check("master-persons round-trips", r.json.length === 1 && r.json[0].persons.length === 2, JSON.stringify(r.json));

  // 7. pre-cost
  r = await api("PUT", `/api/events/${encodeURIComponent(id)}/pre-cost`, { foodCostPerPax: 200, staffCount: 5, totalStaffCost: 5000, decorCharge: 5000, totalCost: 30000, profitLoss: 70000 });
  check("PUT pre-cost -> 200", r.status === 200);
  check("pre-cost round-trips", r.json && r.json.foodCostPerPax === 200 && r.json.totalStaffCost === 5000, JSON.stringify(r.json));

  // 8. petty-cash
  r = await api("PUT", `/api/events/${encodeURIComponent(id)}/petty-cash`, { payouts: [{ headId: "head-x", person: "P1", purpose: "advance", amount: 1000 }], petty: [{ expense: "Ice", purpose: "cooling", amount: 300 }] });
  check("PUT petty-cash -> 200", r.status === 200);
  check("petty-cash round-trips", r.json && r.json.payouts.length === 1 && r.json.petty.length === 1, JSON.stringify(r.json));

  // 9. delete cascade
  r = await api("DELETE", `/api/events/${encodeURIComponent(id)}`);
  check("DELETE event -> 200", r.status === 200);
  r = await api("GET", "/api/events");
  check("event removed after delete", !r.json.some((e) => e.id === id));

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("Smoke test crashed:", e); process.exit(1); });

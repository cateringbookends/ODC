/**
 * fix-master-persons.js
 * Consolidates duplicate designation heads, fixes spelling/capitalization.
 * Run: node fix-master-persons.js
 */
"use strict";
const https = require("node:http");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

const db = new DatabaseSync(path.join(__dirname, "odc.db"));

// ---- Normalization map (lowercase key → canonical name) ----
const NORM = {
  // Junior Line Cook variants
  "jr line cook":              "Junior Line Cook",
  "jr. line cook":             "Junior Line Cook",
  "jr. line cook (bakery)":    "Junior Line Cook (Bakery)",
  "jr. line cook 2":           "Junior Line Cook",

  // Senior Line Cook variants
  "sr. line cook":             "Senior Line Cook",
  "sr. line cook (bakery)":    "Senior Line Cook (Bakery)",
  "sr. line cook 2":           "Senior Line Cook",
  "sr line cook":              "Senior Line Cook",

  // Material
  "material handlers":         "Material Handler",
  "material handler":          "Material Handler",

  // Accounts/Reservation duplicates
  "account executive":         "Accounts Executive",
  "accounts executive":        "Accounts Executive",
  "reservation":               "Reservationist",
  "reservationist":            "Reservationist",
  "reservations":              "Reservationist",

  // Welfare Manager
  "welfare manager":           "Welfare Manager",
  "welfare manager, surat":    "Welfare Manager",

  // GRE → full title
  "gre":                       "Guest Relationship Executive",
  "guest relationship executive": "Guest Relationship Executive",

  // Watchman → professional
  "watchman":                  "Security Guard",

  // Maintenance consolidation
  "maintenance":               "Maintenance Staff",
  "maintenance team member":   "Maintenance Staff",
  "maintenance worker":        "Maintenance Staff",

  // Customer Advocacy consolidation
  "customer advocacy team":         "Customer Advocacy Executive",
  "customer advocacy team member":  "Customer Advocacy Executive",

  // Kitchen Execution
  "kitchen execution team member":  "Kitchen Execution Staff",

  // Keep these exact
  "assistant moh":             "Assistant MOH",
  "bar operation leader":      "Bar Operation Leader",
  "barista":                   "Barista",
  "bakery head":               "Bakery Head",
  "catering head":             "Catering Head",
  "cod":                       "COD",
  "data analyst":              "Data Analyst",
  "data entry":                "Data Entry Operator",
  "driver":                    "Driver",
  "head chef":                 "Head Chef",
  "housekeeping":              "Housekeeping Staff",
  "housekeeping head":         "Housekeeping Head",
  "hr assistant":              "HR Assistant",
  "hr executive":              "HR Executive",
  "hr head":                   "HR Head",
  "kitchen execution head":    "Kitchen Execution Head",
  "kitchen execution staff":   "Kitchen Execution Staff",
  "logistics coordinator":     "Logistics Coordinator",
  "master of the house":       "Master of the House",
  "odc logistics executive":   "ODC Logistics Executive",
  "pastry chef":               "Pastry Chef",
  "prep team head":            "Prep Team Head",
  "r&d head":                  "R&D Head",
  "r&d team member":           "R&D Team Member",
  "sales executive":           "Sales Executive",
  "sales head":                "Sales Head",
  "server":                    "Server",
  "sourcing":                  "Sourcing Executive",
  "sourcing head":             "Sourcing Head",
  "steward":                   "Steward",
  "stock control":             "Stock Controller",
  "store executive":           "Store Executive",
  "store keeper":              "Store Keeper",
  "store manager":             "Store Manager",
  "tally data entry executive":"Tally Data Entry Executive",
  "welfare manager":           "Welfare Manager",
  "brand development manager (ghaslet)": "Brand Development Manager",
  "customer advocacy head":    "Customer Advocacy Head",
  "customer advocacy executive": "Customer Advocacy Executive",
};

function normalizeDesignation(d) {
  if (!d) return d;
  const key = d.trim().toLowerCase();
  return NORM[key] || d.trim();
}

// ---- Read current data directly from SQLite ----
function getCurrentPersons() {
  const heads = db.prepare("SELECT * FROM master_heads ORDER BY sort_order").all();
  return heads.map(h => ({
    id: h.id,
    name: h.name,
    persons: db.prepare("SELECT * FROM master_persons WHERE head_id = ? ORDER BY sort_order, id").all(h.id).map(p => ({
      name: p.person_name,
      code: p.person_code || "",
      designation: p.person_designation || "",
      department: p.person_department || "",
      location: p.person_location || ""
    }))
  }));
}

// ---- Build consolidated list ----
function consolidate(heads) {
  const map = new Map(); // canonical name → { id, persons[] }

  for (const h of heads) {
    const canonical = normalizeDesignation(h.name);

    if (!map.has(canonical)) {
      map.set(canonical, { id: h.id, name: canonical, persons: [] });
    }
    const entry = map.get(canonical);

    for (const p of h.persons) {
      // Avoid exact duplicates (same name + code)
      const isDup = entry.persons.some(ep => ep.name === p.name && ep.code === p.code);
      if (!isDup) {
        entry.persons.push({
          ...p,
          designation: canonical // standardise designation field to match head name
        });
      }
    }
  }

  // Sort by canonical name, keep id from first occurrence
  return Array.from(map.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((h, i) => ({
      id: "post-" + h.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""),
      name: h.name,
      persons: h.persons
    }));
}

// ---- Write back via API ----
function putMasterPersons(data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);

    // First login
    const loginBody = JSON.stringify({ username: "aiops", password: "AIops" });
    const loginReq = https.request({
      hostname: "localhost", port: 5050, path: "/api/auth/login",
      method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(loginBody) }
    }, res => {
      let cookie = "";
      const setCookie = res.headers["set-cookie"];
      if (setCookie) {
        const m = setCookie.join(";").match(/odc_session=[^;]+/);
        if (m) cookie = m[0];
      }
      res.resume();

      // Then PUT
      const putReq = https.request({
        hostname: "localhost", port: 5050, path: "/api/master-persons",
        method: "PUT", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "Cookie": cookie }
      }, res2 => {
        let out = "";
        res2.on("data", d => out += d);
        res2.on("end", () => resolve(JSON.parse(out)));
      });
      putReq.on("error", reject);
      putReq.write(body);
      putReq.end();
    });
    loginReq.on("error", reject);
    loginReq.write(loginBody);
    loginReq.end();
  });
}

// ---- Main ----
(async () => {
  console.log("\n Consolidating Master Persons...\n");

  const current = getCurrentPersons();
  console.log(` Before: ${current.length} head groups`);

  // Show duplicates found
  const normNames = current.map(h => normalizeDesignation(h.name));
  const seen = new Set(), dups = [];
  for (const n of normNames) {
    if (seen.has(n)) dups.push(n);
    seen.add(n);
  }
  if (dups.length) {
    console.log(` Duplicates to merge: ${[...new Set(dups)].join(", ")}`);
  }

  const fixed = consolidate(current);
  console.log(` After:  ${fixed.length} head groups`);

  const totalPersons = fixed.reduce((s, h) => s + h.persons.length, 0);
  console.log(` Total persons: ${totalPersons}\n`);

  try {
    const result = await putMasterPersons(fixed);
    if (Array.isArray(result)) {
      console.log(` Success! ${result.length} heads saved.\n`);
      result.forEach(h => console.log(`  [${h.persons.length.toString().padStart(3)}] ${h.name}`));
    } else {
      console.log(" Response:", JSON.stringify(result));
    }
  } catch (e) {
    console.error(" Error:", e.message);
  }
})();

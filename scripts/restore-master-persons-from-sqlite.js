"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.join(__dirname, "..");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "google-sync-config.json"), "utf8").replace(/^\uFEFF/, ""));
const db = new DatabaseSync(path.join(ROOT, "odc.db"));

function getMasterRows() {
  const heads = db.prepare("SELECT * FROM master_heads ORDER BY sort_order").all();
  const rows = [];
  for (const h of heads) {
    const persons = db.prepare("SELECT * FROM master_persons WHERE head_id = ? ORDER BY sort_order, id").all(h.id);
    if (!persons.length) {
      rows.push([h.id, h.name, "", "", "", "", ""]);
      continue;
    }
    for (const p of persons) {
      rows.push([
        h.id,
        h.name,
        p.person_name || "",
        p.person_code || "",
        p.person_designation || "",
        p.person_department || "",
        p.person_location || ""
      ]);
    }
  }
  return rows;
}

async function main() {
  const rows = getMasterRows();
  const heads = new Set(rows.map((row) => row[0])).size;
  const people = rows.filter((row) => row[2]).length;
  if (!heads || !people) throw new Error(`Local master data is empty: heads=${heads}, people=${people}`);
  const res = await fetch(cfg.scriptUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "ODC-Restore/1.0" },
    body: JSON.stringify({ apiKey: cfg.apiKey, action: "sync", sheet: "MasterPersons", rows }),
    redirect: "follow"
  });
  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!res.ok || data.error) throw new Error(data.error || raw);
  console.log(JSON.stringify({ ok: true, heads, people, syncedRows: rows.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

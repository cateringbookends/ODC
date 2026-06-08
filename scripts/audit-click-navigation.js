"use strict";

const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5050}`;
const clicks = [
  "Dashboard",
  "Sales Intake",
  "Saved Events",
  "Pre Cost Planning",
  "Petty Cash",
  "Master Persons",
  "Bill Submission",
  "Analytics",
  "Admin",
  "FAQ"
];

async function login(ctx) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: process.env.ODC_USER || "aiops",
      password: process.env.ODC_PASS || "AIops"
    })
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const match = (res.headers.get("set-cookie") || "").match(/odc_session=([^;]+)/);
  if (!match) throw new Error("Login did not return odc_session cookie");
  await ctx.addCookies([{ name: "odc_session", value: match[1], url: BASE, httpOnly: true, sameSite: "Strict" }]);
}

(async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "odc-click-profile-"));
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: process.env.HEADED === "0" ? true : false,
    ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {})
  });
  await login(ctx);

  const page = await ctx.newPage();
  const consoleErrors = [];
  const failed = [];
  let closed = false;
  page.on("close", () => { closed = true; });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (!url.includes("/__livereload")) failed.push(`${req.failure()?.errorText || "failed"} ${url}`);
  });

  await page.goto(`${BASE}/dashboard.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".top-nav-links", { timeout: 10000 });

  const timings = [];
  for (let cycle = 1; cycle <= 3; cycle++) {
    for (const label of clicks) {
      if (closed) {
        timings.push({ cycle, label, from: "closed", to: "closed", ms: -1, visibleBeforeClick: "closed", visibleAfterDom: "closed", visibleAfter100: "closed" });
        continue;
      }
      const before = page.url();
      const t0 = Date.now();
      try {
        const visibleBeforeClick = await page.evaluate(() => getComputedStyle(document.body).visibility);
        const href = await page.getByRole("link", { name: label, exact: true }).evaluate((a) => a.href);
        const samePage = href === before;
        if (samePage) {
          await page.getByRole("link", { name: label, exact: true }).click();
        } else {
          await Promise.all([
            page.waitForURL((url) => url.href !== before, { timeout: 10000 }).catch(() => null),
            page.getByRole("link", { name: label, exact: true }).click()
          ]);
        }
        await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => null);
        await page.waitForSelector(".top-nav-links", { timeout: 10000 });
        const visibleAfterDom = await page.evaluate(() => getComputedStyle(document.body).visibility);
        await page.waitForTimeout(100);
        const visibleAfter100 = await page.evaluate(() => getComputedStyle(document.body).visibility);
        timings.push({
          cycle,
          label,
          from: before.replace(BASE, ""),
          to: page.url().replace(BASE, ""),
          ms: Date.now() - t0,
          visibleBeforeClick,
          visibleAfterDom,
          visibleAfter100
        });
      } catch (err) {
        timings.push({
          cycle,
          label,
          from: before.replace(BASE, ""),
          to: closed ? "closed" : page.url().replace(BASE, ""),
          ms: Date.now() - t0,
          visibleBeforeClick: "error",
          visibleAfterDom: "error",
          visibleAfter100: String(err.message || err).split("\n")[0]
        });
      }
    }
  }

  await ctx.close();
  timings.sort((a, b) => b.ms - a.ms);
  const valid = timings.filter((row) => row.ms >= 0);
  const avg = Math.round(valid.reduce((sum, row) => sum + row.ms, 0) / Math.max(valid.length, 1));
  console.log(`click navigation: ${clicks.length} links x 3 cycles = ${timings.length} clicks`);
  console.log(`avg=${avg}ms slowest=${timings[0].ms}ms ${timings[0].label} cycle=${timings[0].cycle}`);
  console.log("slowest 12:");
  for (const row of timings.slice(0, 12)) {
    console.log(`  ${row.ms}ms cycle=${row.cycle} ${row.label} ${row.from} -> ${row.to} body=${row.visibleBeforeClick}/${row.visibleAfterDom}/${row.visibleAfter100}`);
  }
  console.log(`failed=${failed.length} consoleErrors=${consoleErrors.length}`);
  for (const err of failed.slice(0, 10)) console.log(`  failed ${err}`);
  for (const err of consoleErrors.slice(0, 10)) console.log(`  console-error ${err}`);
  console.log(`profile=${profileDir}`);
})();

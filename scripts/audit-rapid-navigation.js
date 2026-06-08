"use strict";

const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5050}`;
const CYCLES = Number(process.env.CYCLES || 4);
const pages = [
  "/dashboard.html",
  "/index.html",
  "/saved-events.html",
  "/pre-cost-planning.html",
  "/petty-cash.html",
  "/master-persons.html",
  "/bill-submission.html",
  "/analytics.html",
  "/admin.html",
  "/event-dashboard.html",
  "/event-log.html",
  "/faq.html"
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
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "odc-chrome-profile-"));
  const launchOptions = {
    headless: process.env.HEADED === "0" ? true : false,
    ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {})
  };
  const ctx = await chromium.launchPersistentContext(profileDir, launchOptions);
  await login(ctx);

  const page = await ctx.newPage();
  const failed = [];
  const consoleErrors = [];
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (!url.includes("/__livereload")) failed.push(`${req.failure()?.errorText || "failed"} ${url}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("__livereload")) consoleErrors.push(msg.text());
  });

  const timings = [];
  const start = Date.now();
  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    for (const pathname of pages) {
      const t0 = Date.now();
      await page.goto(`${BASE}${pathname}`, { waitUntil: "domcontentloaded", timeout: 10000 });
      timings.push({ cycle, page: pathname, ms: Date.now() - t0 });
    }
  }
  const totalMs = Date.now() - start;
  await ctx.close();

  timings.sort((a, b) => b.ms - a.ms);
  const avg = Math.round(timings.reduce((sum, row) => sum + row.ms, 0) / timings.length);
  console.log(`rapid navigation: ${pages.length} pages x ${CYCLES} cycles = ${timings.length} navigations`);
  console.log(`total=${totalMs}ms avg=${avg}ms slowest=${timings[0].ms}ms ${timings[0].page} cycle=${timings[0].cycle}`);
  console.log("slowest 10:");
  for (const row of timings.slice(0, 10)) console.log(`  ${row.ms}ms cycle=${row.cycle} ${row.page}`);
  console.log(`failed=${failed.length} consoleErrors=${consoleErrors.length}`);
  for (const err of failed.slice(0, 5)) console.log(`  failed ${err}`);
  for (const err of consoleErrors.slice(0, 5)) console.log(`  console-error ${err}`);
  console.log(`profile=${profileDir}`);
})();

"use strict";

const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5050}`;

async function login(ctx) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.ODC_USER || "aiops", password: process.env.ODC_PASS || "AIops" })
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const match = (res.headers.get("set-cookie") || "").match(/odc_session=([^;]+)/);
  await ctx.addCookies([{ name: "odc_session", value: match[1], url: BASE, httpOnly: true, sameSite: "Strict" }]);
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
  const ctx = await browser.newContext();
  await login(ctx);
  const page = await ctx.newPage();

  const requests = [];
  page.on("request", (req) => requests.push({ url: req.url(), type: req.resourceType(), start: Date.now() }));
  page.on("requestfinished", (req) => {
    const row = requests.find((r) => r.url === req.url() && !r.end);
    if (row) row.end = Date.now();
  });

  const t0 = Date.now();
  await page.goto(`${BASE}/master-persons.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#masterList", { timeout: 10000 });
  await page.waitForTimeout(1000);
  const metrics = await page.evaluate(() => ({
    bodyVisibility: getComputedStyle(document.body).visibility,
    groups: document.querySelectorAll(".master-group").length,
    rows: document.querySelectorAll(".master-person-row").length,
    peopleRows: Math.max(0, document.querySelectorAll(".master-person-row").length - document.querySelectorAll(".master-person-row-head").length),
    departmentOptions: document.querySelectorAll("#masterDepartmentFilter option").length,
    htmlLength: document.querySelector("#masterList")?.innerHTML.length || 0,
    now: performance.now()
  }));
  const slow = requests
    .filter((r) => r.end && r.end - r.start > 100)
    .map((r) => `${r.end - r.start}ms ${r.type} ${r.url.replace(BASE, "")}`);

  await browser.close();
  console.log(`master-persons total=${Date.now() - t0}ms`);
  console.log(JSON.stringify(metrics, null, 2));
  console.log("slow requests:");
  slow.forEach((line) => console.log(`  ${line}`));
})();

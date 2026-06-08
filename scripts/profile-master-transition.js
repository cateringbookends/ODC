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
  if (!match) throw new Error("Login did not return cookie");
  await ctx.addCookies([{ name: "odc_session", value: match[1], url: BASE, httpOnly: true, sameSite: "Strict" }]);
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
  const ctx = await browser.newContext();
  await login(ctx);
  const page = await ctx.newPage();

  await page.addInitScript(() => {
    window.__odcPerf = [];
    const mark = (name) => window.__odcPerf.push({ name, t: performance.now() });
    mark("init-script");
    document.addEventListener("DOMContentLoaded", () => mark("domcontentloaded"));
    window.addEventListener("load", () => mark("load"));
    const oldFetch = window.fetch;
    window.fetch = async (...args) => {
      const label = typeof args[0] === "string" ? args[0] : args[0]?.url || "fetch";
      mark("fetch-start:" + label);
      try {
        const result = await oldFetch(...args);
        mark("fetch-end:" + label + ":" + result.status);
        return result;
      } catch (err) {
        mark("fetch-error:" + label);
        throw err;
      }
    };
  });

  await page.goto(`${BASE}/petty-cash.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".top-nav-links");
  const t0 = Date.now();
  await page.getByRole("link", { name: "Master Persons", exact: true }).click();
  await page.waitForURL(/master-persons\.html/);
  await page.waitForSelector("#masterList");
  await page.waitForTimeout(1000);
  const data = await page.evaluate(() => ({
    elapsedFromClickApprox: performance.now(),
    perf: window.__odcPerf || [],
    nav: performance.getEntriesByType("navigation")[0]?.toJSON?.() || null,
    resources: performance.getEntriesByType("resource")
      .filter((r) => r.name.includes("master") || r.name.includes("auth") || r.name.includes("store") || r.name.includes("styles"))
      .map((r) => ({
        name: r.name.replace(location.origin, ""),
        start: Math.round(r.startTime),
        duration: Math.round(r.duration),
        transferSize: r.transferSize,
        decodedBodySize: r.decodedBodySize
      })),
    rows: document.querySelectorAll(".master-person-row").length,
    groups: document.querySelectorAll(".master-group").length,
    bodyVisibility: getComputedStyle(document.body).visibility
  }));
  await browser.close();

  console.log(`wallClickToSample=${Date.now() - t0}ms`);
  console.log(JSON.stringify(data, null, 2));
})();

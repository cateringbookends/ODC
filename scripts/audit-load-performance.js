"use strict";

const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5050}`;
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

function round(n) {
  return Math.round(Number(n) || 0);
}

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
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/odc_session=([^;]+)/);
  if (!match) throw new Error("Login did not return odc_session cookie");
  await ctx.addCookies([{
    name: "odc_session",
    value: match[1],
    url: BASE,
    httpOnly: true,
    sameSite: "Strict"
  }]);
}

async function auditPage(ctx, pathname) {
  const page = await ctx.newPage();
  const requests = new Map();
  const failed = [];
  const consoleErrors = [];

  page.on("request", (req) => {
    requests.set(req, { url: req.url(), type: req.resourceType(), start: Date.now() });
  });
  page.on("requestfinished", (req) => {
    const row = requests.get(req);
    if (row) row.end = Date.now();
  });
  page.on("requestfailed", (req) => {
    const row = requests.get(req);
    if (row) row.end = Date.now();
    failed.push({ url: req.url(), error: req.failure()?.errorText || "failed" });
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const started = Date.now();
  await page.goto(`${BASE}${pathname}`, { waitUntil: "domcontentloaded", timeout: 20000 });
  const domMs = Date.now() - started;
  await page.waitForLoadState("load", { timeout: 20000 }).catch(() => null);
  const loadMs = Date.now() - started;
  await page.waitForTimeout(750);
  const settledMs = Date.now() - started;

  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return n ? {
      ttfb: n.responseStart - n.requestStart,
      domContentLoaded: n.domContentLoadedEventEnd,
      load: n.loadEventEnd,
      transferSize: n.transferSize,
      decodedBodySize: n.decodedBodySize
    } : {};
  });

  const slowRequests = Array.from(requests.values())
    .filter((r) => r.end && r.end - r.start > 250)
    .map((r) => ({
      ms: r.end - r.start,
      type: r.type,
      url: r.url.replace(BASE, "")
    }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 8);

  const requestSummary = Array.from(requests.values()).reduce((acc, r) => {
    const key = r.type || "other";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  await page.close();
  return {
    page: pathname,
    domMs,
    loadMs,
    settledMs,
    nav: {
      ttfb: round(nav.ttfb),
      domContentLoaded: round(nav.domContentLoaded),
      load: round(nav.load),
      transferKB: round((nav.transferSize || 0) / 1024),
      decodedKB: round((nav.decodedBodySize || 0) / 1024)
    },
    requests: requestSummary,
    slowRequests,
    failed,
    consoleErrors
  };
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
  const ctx = await browser.newContext();
  await login(ctx);

  const results = [];
  for (const page of pages) {
    results.push(await auditPage(ctx, page));
  }
  await browser.close();

  for (const row of results) {
    console.log(`${row.page} dom=${row.domMs}ms load=${row.loadMs}ms settled=${row.settledMs}ms ttfb=${row.nav.ttfb}ms requests=${JSON.stringify(row.requests)}`);
    if (row.slowRequests.length) {
      for (const req of row.slowRequests) console.log(`  slow ${req.ms}ms ${req.type} ${req.url}`);
    }
    if (row.failed.length) {
      for (const req of row.failed) console.log(`  failed ${req.error} ${req.url}`);
    }
    if (row.consoleErrors.length) {
      for (const err of row.consoleErrors.slice(0, 3)) console.log(`  console-error ${err}`);
    }
  }
})();

"use strict";

const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://cateringbookends.vercel.app";
const pages = [
  "/dashboard.html",
  "/index.html",
  "/saved-events.html",
  "/pre-cost-planning.html",
  "/petty-cash.html",
  "/bill-submission.html",
  "/financial-control.html",
  "/analytics.html",
  "/master-persons.html",
  "/admin.html",
  "/event-log.html",
  "/event-dashboard.html"
];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login.html`, { waitUntil: "load" });
  await page.fill("#username", "aiops");
  await page.fill("#password", "AIops");
  await page.click("#loginBtn");
  await page.waitForURL(/dashboard\.html/, { timeout: 15000 });

  const rows = [];
  for (const path of pages) {
    await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(250);
    const metrics = await page.evaluate(() => {
      const shell = document.querySelector(".app-shell");
      const panel = document.querySelector(".panel");
      const sr = shell ? shell.getBoundingClientRect() : null;
      const pr = panel ? panel.getBoundingClientRect() : null;
      return {
        viewport: document.documentElement.clientWidth,
        shellWidth: sr ? Math.round(sr.width) : 0,
        shellLeft: sr ? Math.round(sr.left) : 0,
        panelWidth: pr ? Math.round(pr.width) : 0,
        panelLeft: pr ? Math.round(pr.left) : 0,
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
      };
    });
    rows.push({ page: path, ...metrics });
  }
  console.table(rows);
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

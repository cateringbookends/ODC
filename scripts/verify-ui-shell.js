"use strict";

const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://127.0.0.1:5050";
const pages = [
  "/dashboard.html",
  "/master-persons.html",
  "/financial-control.html",
  "/bill-submission.html"
];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await context.newPage();
  const errors = [];
  const failedResources = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("response", (res) => {
    if (res.status() >= 400) failedResources.push(`${res.status()} ${res.url()}`);
  });

  await page.goto(`${BASE}/login.html`, { waitUntil: "domcontentloaded" });
  await page.fill("#username", "aiops");
  await page.fill("#password", "AIops");
  await page.click("#loginBtn");
  await page.waitForURL(/dashboard\.html/, { timeout: 15000 });
  await page.waitForSelector(".top-nav-links a", { timeout: 10000 });

  const nav = await page.$$eval(".top-nav-links a", (links) => links.map((a) => a.textContent.trim()));
  const expected = ["Dashboard", "Sales Intake", "Saved Events", "Pre Cost", "Petty Cash", "Bill Submission", "Financial Control", "Analytics", "Master Persons", "Admin", "FAQ"];
  if (nav.join("|") !== expected.join("|")) throw new Error(`Unexpected nav order: ${nav.join(" > ")}`);

  const greeting = await page.textContent("#dashGreeting");
  if (!/Good/.test(greeting || "")) throw new Error(`Missing dashboard greeting: ${greeting}`);
  const loaderExists = await page.locator("#odcPageLoader").count();
  if (!loaderExists) throw new Error("Missing page loader");

  for (const path of pages) {
    await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector(".top-nav-links a", { timeout: 10000 });
    const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    if (overflow > 2) throw new Error(`${path} desktop overflow ${overflow}px`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of pages) {
    await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector(".top-nav-links a", { timeout: 10000 });
    const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    if (overflow > 2) throw new Error(`${path} mobile overflow ${overflow}px`);
  }

  await browser.close();
  const realErrors = errors.filter((msg) => !/Failed to load resource/.test(msg));
  const realFailures = failedResources.filter((item) => !/\/api\/auth\/me/.test(item) && !/favicon\.ico/.test(item));
  if (realErrors.length || realFailures.length) throw new Error(`Browser issues: ${realErrors.concat(realFailures).join(" | ")}`);
  console.log("UI shell verification passed.");
})().catch(async (err) => {
  console.error(err.message || err);
  process.exit(1);
});

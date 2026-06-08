"use strict";

const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://127.0.0.1:5050";

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login.html`, { waitUntil: "load" });
  await page.fill("#username", "aiops");
  await page.fill("#password", "AIops");
  await page.click("#loginBtn");
  await page.waitForURL(/dashboard\.html/, { timeout: 15000 });
  await page.goto(`${BASE}/pre-cost-planning.html`, { waitUntil: "load" });
  const cursor = await page.locator("#staffDataFileButton").evaluate((el) => getComputedStyle(el).cursor);
  const hiddenInput = await page.locator("#staffDataFile").evaluate((el) => ({
    type: el.type,
    hiddenByDisplay: getComputedStyle(el).display === "none",
    accept: el.getAttribute("accept")
  }));
  await browser.close();
  if (cursor !== "pointer") throw new Error(`Expected pointer cursor, got ${cursor}`);
  if (hiddenInput.type !== "file" || !hiddenInput.hiddenByDisplay) throw new Error("Staff file input is not wired as expected");
  console.log(`Staff file cursor OK (${cursor}); accept=${hiddenInput.accept}`);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

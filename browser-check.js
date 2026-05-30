"use strict";
/* Headless front-end verification. Requires the running server + cached Playwright.
   Run via run-browser-check (sets NODE_PATH to the npx playwright cache). */
const { chromium } = require("playwright");

const BASE = `http://localhost:${process.env.PORT || 5050}`;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log(`  ok  - ${n}`); } else { fail++; console.error(`  FAIL- ${n}${x ? " :: " + x : ""}`); } };

function watch(page) {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("dialog", (d) => d.accept()); // auto-accept confirm() (delete) + surface any XSS alert via __xss
  return errors;
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
  const ctx = await browser.newContext();

  // ---------- Sales Intake (index) ----------
  let page = await ctx.newPage();
  let errors = watch(page);
  await page.goto(`${BASE}/index.html`, { waitUntil: "load" });
  await page.waitForSelector(".saved-search", { timeout: 8000 });
  ok("index: init ran (controls present)", true);
  ok("index: seed events rendered", (await page.locator("#savedEventsList .saved-event-item").count()) >= 3);

  // XSS attempt via event name
  const xss = `<img src=x onerror="window.__xss=1">PWN`;
  await page.fill("#entryDate", "2026-05-30");
  await page.fill("#eventDate", "2026-09-01");
  await page.fill("#eventName", xss);
  await page.fill("#location", "QA Venue");
  await page.fill("#pax", "10");
  await page.fill("#costPerPax", "100");
  await page.fill("#eventTime", "18:30");
  await page.selectOption("#foodType", "jain");
  await page.fill("#allergicCount", "7");
  const notesXss = `<img src=x onerror="window.__xss3=1">no nuts`;
  await page.fill("#allergicNotes", notesXss);
  await page.waitForTimeout(150);
  ok("index: precautions summary updates", (await page.locator("#summaryFoodType").textContent()).includes("Jain") && (await page.locator("#summaryAllergicCount").textContent()).trim() === "7");
  ok("index: notes XSS NOT executed", (await page.evaluate(() => window.__xss3)) !== 1);
  ok("index: notes rendered as text", (await page.locator("#summaryAllergicNotes").textContent()).includes("no nuts") && (await page.locator("#summaryAllergicNotes img").count()) === 0);
  await page.click("#saveEvent");
  await page.waitForTimeout(600);
  ok("index: save shows confirmation", /saved|updated/i.test(await page.locator("#saveStatus").textContent()));
  const xssFlag = await page.evaluate(() => window.__xss);
  ok("index: XSS NOT executed", xssFlag !== 1, "window.__xss=" + xssFlag);
  ok("index: no <img> injected into saved list", (await page.locator("#savedEventsList img").count()) === 0);
  ok("index: event name stored as text", (await page.locator("#savedEventsList strong", { hasText: "PWN" }).count()) >= 1);

  // Edit loads the event back into the form
  await page.locator("#savedEventsList .saved-event-item", { hasText: "PWN" }).locator("button", { hasText: "Edit" }).first().click();
  await page.waitForTimeout(300);
  ok("index: Edit loads event into form", (await page.inputValue("#eventName")) === xss && (await page.inputValue("#location")) === "QA Venue");
  ok("index: Edit reloads new fields", (await page.inputValue("#eventTime")) === "18:30" && (await page.inputValue("#foodType")) === "jain" && (await page.inputValue("#allergicCount")) === "7" && (await page.inputValue("#allergicNotes")) === notesXss);

  // Delete removes it
  const before = await page.locator("#savedEventsList .saved-event-item").count();
  await page.locator("#savedEventsList .saved-event-item", { hasText: "PWN" }).locator("button", { hasText: "Delete" }).first().click();
  await page.waitForTimeout(500);
  ok("index: Delete removes event", (await page.locator("#savedEventsList .saved-event-item").count()) === before - 1);
  ok("index: no console/page errors", errors.length === 0, errors.join(" | "));
  await page.close();

  // ---------- Pre Cost Planning ----------
  page = await ctx.newPage();
  errors = watch(page);
  await page.goto(`${BASE}/pre-cost-planning.html`, { waitUntil: "load" });
  await page.waitForSelector(".save-bar", { timeout: 8000 });
  await page.click("#eventPickerTrigger");
  await page.waitForSelector("#eventPickerList .event-option");
  await page.locator("#eventPickerList .event-option").first().click();
  await page.waitForTimeout(200);
  ok("pre-cost: event selected (PAX shown)", (await page.locator("#planningPax").textContent()).trim() !== "0");
  await page.fill("#foodCostPerPax", "250");
  await page.waitForTimeout(150);
  ok("pre-cost: totals compute", /[1-9]/.test(await page.locator("#totalFoodCost").textContent()));
  await page.fill("#staffCount", "5");
  await page.waitForTimeout(150);
  ok("pre-cost: staffCount drives staff cost", Number((await page.inputValue("#totalStaffCostInput")).replace(/[^0-9.]/g, "")) > 0);
  await page.locator(".save-bar button", { hasText: "Save Plan" }).click();
  await page.waitForTimeout(500);
  ok("pre-cost: save status shown", /saved/i.test(await page.locator(".save-bar .form-status").textContent()));
  ok("pre-cost: no console/page errors", errors.length === 0, errors.join(" | "));
  await page.close();

  // ---------- Petty Cash ----------
  page = await ctx.newPage();
  errors = watch(page);
  await page.goto(`${BASE}/petty-cash.html`, { waitUntil: "load" });
  await page.waitForSelector(".save-bar", { timeout: 8000 });
  await page.click("#eventPickerTrigger");
  await page.waitForSelector("#eventPickerList .event-option");
  await page.locator("#eventPickerList .event-option").first().click();
  await page.waitForTimeout(200);
  ok("petty-cash: payout row has head options", (await page.locator("#payoutRows .cash-head option").count()) >= 1);
  await page.fill("#payoutRows .cash-amount", "1500");
  await page.fill("#pettyCashRows .cash-amount", "300");
  await page.waitForTimeout(150);
  ok("petty-cash: totals update", Number((await page.locator("#totalCashRequired").textContent()).replace(/[^0-9.]/g, "")) === 1800);
  await page.locator(".save-bar button", { hasText: "Save Petty Cash" }).click();
  await page.waitForTimeout(500);
  ok("petty-cash: save status shown", /saved/i.test(await page.locator(".save-bar .form-status").textContent()));
  ok("petty-cash: no console/page errors", errors.length === 0, errors.join(" | "));
  await page.close();

  // ---------- Master Persons (XSS on person name) ----------
  page = await ctx.newPage();
  errors = watch(page);
  await page.goto(`${BASE}/master-persons.html`, { waitUntil: "load" });
  await page.waitForSelector("#masterList .master-group", { timeout: 8000 });
  ok("master: default heads rendered", (await page.locator("#masterList .master-group").count()) >= 2);
  await page.fill("#headName", "QA Head");
  await page.fill("#personName", `<img src=x onerror="window.__xss2=1">Bob`);
  await page.click("#addPerson");
  await page.waitForTimeout(400);
  ok("master: person XSS NOT executed", (await page.evaluate(() => window.__xss2)) !== 1);
  ok("master: person name stored as text", (await page.locator("#masterList span", { hasText: "Bob" }).count()) >= 1);
  ok("master: no <img> injected", (await page.locator("#masterList img").count()) === 0);
  ok("master: no console/page errors", errors.length === 0, errors.join(" | "));
  await page.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("Browser check crashed:", e); process.exit(1); });

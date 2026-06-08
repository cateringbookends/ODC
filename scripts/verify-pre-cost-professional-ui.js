const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://cateringbookends.vercel.app";

async function login(page) {
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
  await page.fill("#username", "aiops");
  await page.fill("#password", "AIops");
  await Promise.all([
    page.waitForURL(/dashboard\.html/, { timeout: 15000 }),
    page.click("button[type=submit]")
  ]);
}

async function inspect(viewport, name) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport });
  await login(page);
  await page.goto(BASE + "/pre-cost-planning.html", { waitUntil: "networkidle" });
  await page.waitForSelector(".planning-cost-workbench", { timeout: 15000 });
  await page.waitForSelector("#planningFinalRow .save-bar", { timeout: 15000 });
  await page.screenshot({ path: `output/${name}.png`, fullPage: true });
  const result = await page.evaluate(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top) };
    };
    const workbench = rect(".planning-cost-workbench");
    const finalRow = rect(".planning-final-row");
    const base = rect(".base-costs");
    const additional = rect(".outstation-costs");
    const save = rect("#planningFinalRow .save-bar");
    const topRow = rect(".planning-top-row");
    const dateControl = rect(".planning-date-field .dmy-date-control");
    const overflow = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
    const totalOutputs = [...document.querySelectorAll(".planning-final-row .cost-output")].map((el) => Math.round(el.getBoundingClientRect().height));
    return {
      workbench,
      finalRow,
      base,
      additional,
      save,
      topRow,
      dateControl,
      overflow,
      totalOutputs,
      finalHasSave: !!document.querySelector("#planningFinalRow .primary-button")
    };
  });
  await browser.close();
  return { viewport, ...result };
}

async function main() {
  const desktop = await inspect({ width: 1680, height: 900 }, "pre-cost-desktop");
  const mobile = await inspect({ width: 390, height: 844 }, "pre-cost-mobile");
  const bad = [desktop, mobile].find((r) => !r.workbench || !r.finalRow || !r.base || !r.additional || !r.save || !r.topRow || r.overflow > 2 || !r.finalHasSave || r.totalOutputs.some((h) => h > 54) || (r.dateControl && r.dateControl.height > 42));
  if (bad) throw new Error(JSON.stringify(bad, null, 2));
  console.log(JSON.stringify({ ok: true, desktop, mobile }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

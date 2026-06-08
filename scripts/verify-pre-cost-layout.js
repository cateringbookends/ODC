const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://cateringbookends.vercel.app";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1680, height: 900 } });
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
  await page.fill("#username", "aiops");
  await page.fill("#password", "AIops");
  await Promise.all([
    page.waitForURL(/dashboard\.html/, { timeout: 15000 }),
    page.click("button[type=submit]")
  ]);
  await page.goto(BASE + "/pre-cost-planning.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".planning-panel", { timeout: 10000 });
  const metrics = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top) };
    };
    const shell = rect(".planning-shell");
    const panel = rect(".planning-panel");
    const workspace = rect(".planning-panel .payment-schedule");
    const save = rect("#planningForm > .save-bar");
    const total = rect(".total-cost-output");
    return {
      shell,
      panel,
      workspace,
      save,
      total,
      overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      saveIsHuge: save ? save.height > 80 : true,
      totalVisible: !!total && total.height >= 60
    };
  });
  await browser.close();
  if (!metrics.shell || metrics.shell.width < 1500 || metrics.overflow > 2 || metrics.saveIsHuge || !metrics.totalVisible) {
    throw new Error(JSON.stringify(metrics, null, 2));
  }
  console.log(JSON.stringify({ ok: true, ...metrics }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

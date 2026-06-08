const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://cateringbookends.vercel.app";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
  await page.fill("#username", "aiops");
  await page.fill("#password", "AIops");
  await Promise.all([
    page.waitForURL(/dashboard\.html/, { timeout: 15000 }),
    page.click("button[type=submit]")
  ]);
  await page.goto(BASE + "/admin.html", { waitUntil: "domcontentloaded" });
  await page.click("[data-tab='sessions']");
  await page.waitForSelector("#sessionsTable", { timeout: 15000 });
  await page.evaluate(() => {
    window.__sessionTable = document.querySelector("#sessionsTable");
    window.__adminMutationCount = 0;
    const target = document.querySelector("#adminContent");
    window.__adminObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => {
          if (node === window.__sessionTable || (node.contains && node.contains(window.__sessionTable))) {
            window.__adminMutationCount += 1;
          }
        });
      });
    });
    window.__adminObserver.observe(target, { childList: true, subtree: true });
  });
  await page.waitForTimeout(8200);
  const result = await page.evaluate(() => ({
    sameTable: window.__sessionTable === document.querySelector("#sessionsTable"),
    removedCount: window.__adminMutationCount,
    rows: document.querySelectorAll("#sessionsTable tbody tr").length
  }));
  await browser.close();
  if (!result.sameTable || result.removedCount !== 0 || result.rows < 1) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

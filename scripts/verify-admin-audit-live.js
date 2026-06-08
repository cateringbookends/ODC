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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);
  await page.goto(BASE + "/admin.html", { waitUntil: "domcontentloaded" });
  await page.click("[data-tab='audit']");
  await page.waitForSelector("#auditTable", { timeout: 15000 });

  await page.evaluate(() => {
    window.__auditTable = document.querySelector("#auditTable");
    window.__auditRemovedCount = 0;
    const target = document.querySelector("#adminContent");
    window.__auditObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => {
          if (node === window.__auditTable || (node.contains && node.contains(window.__auditTable))) {
            window.__auditRemovedCount += 1;
          }
        });
      });
    });
    window.__auditObserver.observe(target, { childList: true, subtree: true });
  });

  const before = await page.locator("#auditTable tbody tr").count();
  const secondContext = await browser.newContext({ viewport: { width: 1200, height: 760 } });
  const secondPage = await secondContext.newPage();
  await login(secondPage);
  await secondContext.close();

  await page.waitForTimeout(8500);
  const result = await page.evaluate((beforeRows) => {
    const rows = [...document.querySelectorAll("#auditTable tbody tr")];
    const text = document.querySelector("#adminContent")?.innerText || "";
    return {
      sameTable: window.__auditTable === document.querySelector("#auditTable"),
      removedCount: window.__auditRemovedCount,
      beforeRows,
      afterRows: rows.length,
      hasLoginEntry: text.includes("LOGIN"),
      active: document.querySelector(".admin-tab.active")?.dataset.tab || ""
    };
  }, before);

  await browser.close();
  if (!result.sameTable || result.removedCount !== 0 || result.active !== "audit" || !result.hasLoginEntry || result.afterRows < 1) {
    throw new Error(JSON.stringify(result));
  }
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

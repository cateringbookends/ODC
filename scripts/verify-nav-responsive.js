const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://cateringbookends.vercel.app";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 820, height: 720 } });
  await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
  await page.fill("#username", "aiops");
  await page.fill("#password", "AIops");
  await Promise.all([
    page.waitForURL(/dashboard\.html/, { timeout: 15000 }),
    page.click("button[type=submit]")
  ]);
  await page.waitForSelector(".top-nav-links[data-ready='true']", { timeout: 10000 });
  const result = await page.evaluate(() => {
    const nav = document.querySelector(".top-nav-links");
    const left = document.querySelector(".nav-scroll-left");
    const right = document.querySelector(".nav-scroll-right");
    const before = nav.scrollLeft;
    right.click();
    return new Promise((resolve) => {
      setTimeout(() => resolve({
        ready: nav.dataset.ready === "true",
        hasLeft: !!left,
        hasRight: !!right,
        overflow: nav.scrollWidth > nav.clientWidth,
        moved: nav.scrollLeft > before,
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth
      }), 450);
    });
  });
  await browser.close();
  if (!result.ready || !result.hasLeft || !result.hasRight || !result.overflow || !result.moved || result.bodyOverflow > 2) {
    throw new Error(JSON.stringify(result));
  }
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

"use strict";

const { chromium } = require("playwright");

const pages = [
  "bill-submission.html",
  "analytics.html",
  "admin.html"
];

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
  { name: "small-mobile", width: 320, height: 740 }
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const pageName of pages) {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      await page.goto(`https://cateringbookends.vercel.app/${pageName}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1800);
      const result = await page.evaluate(() => {
        const docWidth = document.documentElement.clientWidth;
        const offenders = [...document.querySelectorAll("body *")]
          .map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              tag: el.tagName.toLowerCase(),
              className: String(el.className || ""),
              id: el.id || "",
              text: String(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 70),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth
            };
          })
          .filter((item) => item.right > docWidth + 1 || item.scrollWidth > item.clientWidth + 1)
          .sort((a, b) => Math.max(b.right - docWidth, b.scrollWidth - b.clientWidth) - Math.max(a.right - docWidth, a.scrollWidth - a.clientWidth))
          .slice(0, 10);
        return {
          bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          offenders
        };
      });
      results.push({ page: pageName, viewport, ...result });
      await page.screenshot({ path: `output/responsive-${pageName.replace(".html", "")}-${viewport.name}.png`, fullPage: true });
      await page.close();
    }
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})();

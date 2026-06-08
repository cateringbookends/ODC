"use strict";

const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 740 } });
  await page.goto("https://cateringbookends.vercel.app/master-persons.html", { waitUntil: "networkidle" });
  await page.waitForSelector(".master-list", { timeout: 30000 });
  await page.waitForTimeout(1500);
  const offenders = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    return [...document.querySelectorAll("body *")]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          className: String(el.className || ""),
          id: el.id || "",
          text: String(el.textContent || "").trim().slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth
        };
      })
      .filter((item) => item.right > docWidth + 1 || item.scrollWidth > item.clientWidth + 1)
      .sort((a, b) => (b.right - docWidth) - (a.right - docWidth))
      .slice(0, 30);
  });
  await browser.close();
  console.log(JSON.stringify(offenders, null, 2));
})();

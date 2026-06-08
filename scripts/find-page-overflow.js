"use strict";

const { chromium } = require("playwright");

const pageName = process.argv[2] || "bill-submission.html";
const width = Number(process.argv[3]) || 320;
const height = Number(process.argv[4]) || 740;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`https://cateringbookends.vercel.app/${pageName}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  const out = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    return {
      docWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll("body *")]
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            className: String(el.className || ""),
            id: el.id || "",
            text: String(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            overflowX: getComputedStyle(el).overflowX
          };
        })
        .filter((item) => item.right > docWidth + 1 || item.scrollWidth > item.clientWidth + 1)
        .sort((a, b) => (b.right - docWidth) - (a.right - docWidth))
        .slice(0, 25)
    };
  });
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})();

"use strict";

const { chromium } = require("playwright");

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
  { name: "small-mobile", width: 320, height: 740 }
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    await page.goto("https://cateringbookends.vercel.app/master-persons.html", { waitUntil: "networkidle" });
    await page.waitForSelector(".master-list", { timeout: 30000 });
    await page.waitForTimeout(1500);
    const result = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".master-person-row")];
      const list = document.querySelector(".master-list");
      const overflowingRows = rows.filter((row) => row.scrollWidth > row.clientWidth + 1).length;
      const clippedButtons = [...document.querySelectorAll(".edit-master-person,.remove-master-person,.remove-master-head")]
        .filter((button) => button.scrollWidth > button.clientWidth + 1).length;
      const bodyOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const listOverflow = list ? list.scrollWidth - list.clientWidth : 0;
      const sample = rows.find((row) => row.scrollWidth > row.clientWidth + 1);
      return {
        bodyOverflow,
        listOverflow,
        rows: rows.length,
        overflowingRows,
        clippedButtons,
        sampleColumns: sample ? getComputedStyle(sample).gridTemplateColumns : ""
      };
    });
    results.push({ viewport, ...result });
    await page.screenshot({ path: `output/master-persons-${viewport.name}.png`, fullPage: true });
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})();

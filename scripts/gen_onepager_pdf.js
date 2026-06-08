/**
 * Generates ODC_Product_OnePager.pdf from ODC_Product_OnePager.html
 * using Playwright. Run: node scripts/gen_onepager_pdf.js
 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const htmlPath = path.resolve(__dirname, '..', 'ODC_Product_OnePager.html');
  const pdfPath  = path.resolve(__dirname, '..', 'ODC_Product_OnePager.pdf');

  const browser = await chromium.launch();
  const page    = await browser.newPage();

  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });

  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });

  await browser.close();
  console.log('PDF saved:', pdfPath);
})();

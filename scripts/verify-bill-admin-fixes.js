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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(page);

  await page.goto(BASE + "/bill-submission.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#billHead", { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll("#billHead option").length > 0, null, { timeout: 15000 });
  const bill = await page.evaluate(() => ({
    headOptions: [...document.querySelectorAll("#billHead option")].map((option) => option.textContent.trim()).filter(Boolean),
    hint: document.querySelector("#headHint")?.textContent || ""
  }));
  if (bill.headOptions.length <= 1 || /No names found/i.test(bill.hint)) {
    throw new Error("Bill head options not populated: " + JSON.stringify(bill));
  }

  await page.goto(BASE + "/admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".dash-table tbody tr", { timeout: 15000 });
  const admin = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".dash-table tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
    const usernames = rows.map((cols) => cols[0]).filter(Boolean);
    return {
      usernames,
      aiopsCount: usernames.filter((name) => name === "aiops").length,
      createUserPanels: [...document.querySelectorAll("h2")].filter((h) => h.textContent.trim() === "Create User").length
    };
  });
  if (admin.aiopsCount !== 1 || admin.createUserPanels !== 1) {
    throw new Error("Admin render duplicate issue: " + JSON.stringify(admin));
  }

  await browser.close();
  console.log(JSON.stringify({ ok: true, bill, admin }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

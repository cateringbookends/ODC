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
  await page.waitForSelector("#adminTabs", { timeout: 10000 });

  for (const tab of ["system", "users", "sessions", "audit", "users"]) {
    await page.click(`[data-tab='${tab}']`);
    await page.waitForTimeout(180);
  }
  await page.waitForFunction(() => [...document.querySelectorAll("h2")].some((h) => h.textContent.trim() === "Create User"), null, { timeout: 15000 });

  const result = await page.evaluate(() => {
    const text = document.querySelector("#adminContent")?.innerText || "";
    return {
      active: document.querySelector(".admin-tab.active")?.dataset.tab || "",
      createUserCount: [...document.querySelectorAll("h2")].filter((h) => h.textContent.trim() === "Create User").length,
      hasSystemStatus: text.includes("System Status"),
      hasActiveSessions: text.includes("Active Sessions"),
      hasAuditLog: text.includes("Audit Log")
    };
  });

  await browser.close();
  if (result.active !== "users" || result.createUserCount !== 1 || result.hasSystemStatus || result.hasActiveSessions || result.hasAuditLog) {
    throw new Error(JSON.stringify(result));
  }
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

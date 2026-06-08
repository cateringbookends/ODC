const BASE = process.env.BASE || "https://cateringbookends.vercel.app";

async function main() {
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "aiops", password: "AIops" })
  });
  const cookie = login.headers.get("set-cookie") || "";
  if (!login.ok || !cookie) throw new Error("Login failed: " + login.status);
  const sessionCookie = cookie.split(";")[0];

  const headers = { Cookie: sessionCookie, "Content-Type": "application/json" };
  const hit = await fetch(BASE + "/api/admin/page-hit", {
    method: "POST",
    headers,
    body: JSON.stringify({ page: "admin.html", title: "Admin" })
  });
  if (!hit.ok) throw new Error("Page hit failed: " + hit.status);

  const sessionsRes = await fetch(BASE + "/api/admin/sessions", { headers: { Cookie: sessionCookie } });
  if (!sessionsRes.ok) throw new Error("Sessions failed: " + sessionsRes.status);
  const sessions = await sessionsRes.json();
  const current = sessions.find(s => s.username === "aiops");
  if (!current) throw new Error("Current session not returned.");
  if (!("ipAddress" in current) || !("userAgent" in current) || !("lastPage" in current)) {
    throw new Error("Session fields missing: " + JSON.stringify(current));
  }

  const auditRes = await fetch(BASE + "/api/audit-log?limit=20&user=aiops", { headers: { Cookie: sessionCookie } });
  if (!auditRes.ok) throw new Error("Audit failed: " + auditRes.status);
  const audit = await auditRes.json();
  const pageView = audit.find(e => e.action === "PAGE_VIEW" && e.entity_id === "admin.html");
  if (!pageView) throw new Error("PAGE_VIEW audit row not found.");

  console.log(JSON.stringify({
    ok: true,
    activeSessions: sessions.length,
    currentSession: {
      username: current.username,
      ipAddress: current.ipAddress,
      device: current.userAgent ? "captured" : "missing",
      lastPage: current.lastPage
    },
    pageViewLogged: true
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

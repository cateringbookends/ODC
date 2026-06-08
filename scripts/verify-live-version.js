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

  const beforeRes = await fetch(BASE + "/api/live/version", { headers: { Cookie: sessionCookie } });
  if (!beforeRes.ok) throw new Error("Live version before failed: " + beforeRes.status);
  const before = await beforeRes.json();

  const audit = await fetch(BASE + "/api/audit-log", {
    method: "POST",
    headers,
    body: JSON.stringify({
      username: "aiops",
      action: "LIVE_TEST",
      entityType: "system",
      entityId: "live-version",
      detail: "Production live version smoke test"
    })
  });
  if (!audit.ok) throw new Error("Audit write failed: " + audit.status);

  await new Promise((resolve) => setTimeout(resolve, 1200));
  const afterRes = await fetch(BASE + "/api/live/version", { headers: { Cookie: sessionCookie } });
  if (!afterRes.ok) throw new Error("Live version after failed: " + afterRes.status);
  const after = await afterRes.json();
  if (!before.version || !after.version || before.version === after.version) {
    throw new Error("Live version did not change: " + JSON.stringify({ before, after }));
  }

  console.log(JSON.stringify({ ok: true, before: before.version, after: after.version }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

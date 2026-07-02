"use strict";

const crypto = require("node:crypto");

const SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const API_KEY = process.env.GOOGLE_SCRIPT_API_KEY;
const SESSION_COOKIE = "odc_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function parseCookies(header) {
  return Object.fromEntries(String(header || "").split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function sign(value) {
  return crypto.createHmac("sha256", API_KEY || "missing-key").update(value).digest("base64url");
}

function makeSession(user) {
  const sessionId = crypto.randomUUID();
  const payload = Buffer.from(JSON.stringify({
    sid: sessionId,
    username: user.username,
    fullName: user.fullName || user.username,
    role: user.role || "staff",
    exp: Date.now() + SESSION_TTL_MS
  })).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, sessionId };
}

function readSession(req) {
  const token = parseCookies(req.headers?.cookie)[SESSION_COOKIE];
  if (!token || !token.includes(".")) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac || sign(payload) !== mac) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!user.exp || user.exp < Date.now()) return null;
    return { sessionId: user.sid || "", username: user.username, fullName: user.fullName || user.username, role: user.role || "staff" };
  } catch {
    return null;
  }
}

function setSessionCookie(res, user) {
  const session = makeSession(user);
  user.sessionId = session.sessionId;
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`);
}

function audit(req, action, entityType, entityId, detail, user) {
  const ip = String(req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"] || "").split(",")[0].trim();
  callScript("POST", "/api/audit-log", {
    username: user?.username || "",
    action,
    entityType,
    entityId: entityId || "",
    detail: detail || "",
    ipAddress: ip,
    userAgent: String(req.headers?.["user-agent"] || "").slice(0, 80)
  }, user).catch(() => {});
}

function clientInfo(req) {
  return {
    ipAddress: String(req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"] || "").split(",")[0].trim(),
    userAgent: String(req.headers?.["user-agent"] || "").slice(0, 240)
  };
}

function auditForRequest(req, pathName, body, user) {
  if (!user || req.method === "GET" || pathName.startsWith("/api/auth/") || pathName.startsWith("/api/audit-log")) return;
  const parts = pathName.split("?")[0].split("/").filter(Boolean);
  const entityType = parts[1] || "api";
  const entityId = parts[2] || "";
  const action = req.method === "POST" ? "CREATE" : req.method === "PUT" ? "UPDATE" : req.method === "DELETE" ? "DELETE" : req.method;
  let detail = pathName;
  if (body && typeof body === "object") {
    const keys = Object.keys(body).filter((key) => key !== "_user" && key !== "receipt").slice(0, 8);
    if (keys.length) detail += " | " + keys.map((key) => `${key}=${JSON.stringify(body[key]).slice(0, 80)}`).join(", ");
  }
  audit(req, action, entityType, entityId, detail, user);
}

function isAdminOnlyRoute(method, pathName) {
  const path = pathName.split("?")[0];
  if (path === "/api/auth/users") return method === "GET" || method === "POST";
  if (/^\/api\/auth\/users\/[^/]+\/password$/.test(path)) return method === "PUT";
  if (/^\/api\/auth\/users\/[^/]+$/.test(path)) return method === "PUT" || method === "DELETE";
  if (path === "/api/admin/sessions") return method === "GET";
  if (/^\/api\/admin\/sessions\/[^/]+$/.test(path)) return method === "DELETE";
  if (path === "/api/admin/status") return method === "GET";
  if (path.indexOf("/api/audit-log") === 0) return method === "GET";
  if (path.indexOf("/api/mail-log") === 0) return method === "GET";
  if (path.indexOf("/api/agent-token") === 0) return true;
  return false;
}

async function callScript(method, pathName, body, user) {
  const response = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "ODC-Vercel/1.0" },
    body: JSON.stringify({
      apiKey: API_KEY,
      action: "proxy_api",
      method,
      path: pathName,
      body: { ...(body || {}), _user: user || null }
    }),
    redirect: "follow"
  });

  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { error: raw || "Invalid backend response" }; }
  if (!response.ok || (data && data.error)) {
    const error = new Error((data && data.error) || "Backend error");
    error.statusCode = response.ok ? 500 : response.status;
    error.data = data;
    throw error;
  }
  return data;
}

module.exports = async function handler(req, res) {
  if (!SCRIPT_URL || !API_KEY) {
    res.status(500).json({ error: "Google Apps Script backend is not configured." });
    return;
  }

  const parts = Array.isArray(req.query.path)
    ? req.query.path
    : String(req.query.path || "").split("/").filter(Boolean);
  const apiPath = "/api/" + parts.map(encodeURIComponent).join("/");
  const query = new URLSearchParams(req.query || {});
  query.delete("path");
  const pathName = query.toString() ? `${apiPath}?${query}` : apiPath;

  try {
    if (pathName === "/api/auth/me" && req.method === "GET") {
      const user = readSession(req);
      if (!user) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      res.status(200).json(user);
      return;
    }

    if (pathName === "/api/auth/logout" && req.method === "POST") {
      const user = readSession(req);
      clearSessionCookie(res);
      if (user?.sessionId) {
        callScript("POST", "/api/admin/sessions/logout", { sessionId: user.sessionId }, user).catch(() => {});
      }
      if (user) audit(req, "LOGOUT", "auth", user.username, "", user);
      res.status(200).json({ ok: true });
      return;
    }

    if (pathName === "/api/auth/login" && req.method === "POST") {
      const user = await callScript(req.method, pathName, { ...(req.body || {}), ...clientInfo(req) });
      setSessionCookie(res, user);
      await callScript("POST", "/api/admin/sessions", {
        sessionId: user.sessionId,
        ...clientInfo(req),
        loginAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
      }, user);
      audit(req, "LOGIN", "auth", user.username, "", user);
      res.status(200).json(user);
      return;
    }

    const currentUser = readSession(req);
    if (!currentUser && !pathName.startsWith("/api/auth/")) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (currentUser?.sessionId) {
      const valid = await callScript("POST", "/api/admin/sessions/validate", {
        sessionId: currentUser.sessionId,
        ...clientInfo(req)
      }, currentUser).catch(() => ({ active: true }));
      if (valid && valid.active === false) {
        clearSessionCookie(res);
        res.status(401).json({ error: "Session expired or force logged out." });
        return;
      }
    }

    if (isAdminOnlyRoute(req.method, pathName) && currentUser?.role !== "admin") {
      res.status(403).json({ error: "Admin only." });
      return;
    }

    if (pathName === "/api/admin/sessions" && req.method === "GET") {
      const sessions = await callScript(req.method, pathName, req.body || {}, currentUser);
      res.status(200).json(sessions);
      return;
    }

    if (pathName === "/api/admin/page-hit" && req.method === "POST") {
      const data = await callScript("POST", pathName, {
        ...(req.body || {}),
        sessionId: currentUser.sessionId,
        ...clientInfo(req)
      }, currentUser);
      res.status(200).json(data);
      return;
    }

    const forceSessionMatch = pathName.match(/^\/api\/admin\/sessions\/([^/]+)$/);
    if (forceSessionMatch && req.method === "DELETE") {
      const target = decodeURIComponent(forceSessionMatch[1]);
      await callScript(req.method, pathName, req.body || {}, currentUser);
      audit(req, "FORCE_LOGOUT", "session", target, "", currentUser);
      res.status(200).json({ ok: true });
      return;
    }

    const data = await callScript(req.method, pathName, req.body || {}, currentUser);
    auditForRequest(req, pathName, req.body || {}, currentUser);
    res.status(200).json(data);
  } catch (error) {
    if (pathName === "/api/auth/login") {
      res.status(401).json({ error: error.message || "Invalid username or password." });
      return;
    }
    res.status(error.statusCode || 502).json(error.data || { error: error.message || "Google Apps Script request failed." });
  }
};

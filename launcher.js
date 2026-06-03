#!/usr/bin/env node
"use strict";
/**
 * launcher.js — starts Node server + Cloudflare tunnel, shows public URL clearly
 * Usage: node launcher.js
 */
const { spawn } = require("node:child_process");
const fs   = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;

// Start ODC server
const server = spawn("node", ["server.js"], { cwd: ROOT, stdio: "inherit" });
server.on("error", (e) => console.error("Server error:", e.message));

// Start Cloudflare tunnel
const cf = spawn(path.join(ROOT, "cloudflared.exe"), [
  "tunnel", "--url", "http://localhost:5050", "--no-autoupdate"
], { cwd: ROOT });

cf.stderr.on("data", (data) => {
  const str = data.toString();
  const match = str.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match) {
    const url = match[0];
    const pad = (s, n) => String(s).padEnd(n);
    console.log("\n");
    console.log("  ╔══════════════════════════════════════════════════════════╗");
    console.log("  ║       ODC EVENT DASHBOARD  ·  LIVE & ONLINE             ║");
    console.log("  ╠══════════════════════════════════════════════════════════╣");
    console.log(`  ║  🌐  ${pad(url, 54)}║`);
    console.log("  ║  🔑  Username: aiops    Password: AIops                 ║");
    console.log("  ╚══════════════════════════════════════════════════════════╝");
    console.log("  Share the URL above with your team!\n");
    fs.writeFileSync(path.join(ROOT, "current-url.txt"), url + "\n");
  }
});

cf.on("error", () => {
  console.log("  [tunnel] cloudflared.exe not found — local only: http://localhost:5050");
});

process.on("SIGINT", () => { server.kill(); cf.kill(); process.exit(0); });
process.on("SIGTERM", () => { server.kill(); cf.kill(); process.exit(0); });

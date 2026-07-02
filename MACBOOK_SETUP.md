# ODC — MacBook Setup & Handoff

Everything you need to continue developing and deploying ODC on a Mac. All accounts
are **cateringbookends** (GitHub, Google/clasp, Vercel) — the same identity used on
the old Windows machine. This project is intentionally isolated to that identity.

## 1. What's in this zip

- Full source: 16 HTML pages, ~30 client JS files, `styles.css`, `server.js`
  (Postgres backend, VPS path), `api/[...path].js` (Vercel proxy), `apps-script/`
  (Google Apps Script backend — the live production backend).
- Config needed to deploy (normally gitignored, included here so you don't have to
  reconfigure): `google-sync-config.json`, `apps-script/.clasp.json`,
  `.vercel/project.json`.
- Docs: `CLAUDE.md` (architecture map — read this first), `API.md` (agent API),
  `AUDIT_REPORT_2026-07.md` (full audit + roadmap), this file.
- `.git/` history is included.

**Not included** (regenerate/reinstall on Mac): `node_modules/` (run `npm install`),
`cloudflared.exe` (Windows-only; grab the Mac build if you want the dev tunnel),
`odc.db` (regenerated), screenshots/logs, and the VPS SSH key (see §6).

> These config files are secrets — keep the zip private, don't commit the files
> (they're already in `.gitignore`), don't share them.

## 2. Prerequisites on the Mac

```bash
# Homebrew if you don't have it: https://brew.sh
brew install node git            # Node ≥ 20
npm i -g @google/clasp vercel    # Apps Script CLI + Vercel CLI
```

## 3. Get the project onto the Mac

Either unzip this folder anywhere, **or** (cleaner) clone fresh and copy the config
files in:

```bash
# Option A — use this zip as-is:
unzip ODC-macbook.zip && cd ODC

# Option B — clone fresh, then copy the 3 config files from the zip into place:
git clone git@github.com:cateringbookends/ODC.git && cd ODC
#   then copy google-sync-config.json, apps-script/.clasp.json, .vercel/project.json
```

## 4. Reconnect the accounts (one-time on the Mac)

### Git / GitHub (cateringbookends)
The old machine pushed via a custom SSH host alias. On the Mac, simplest is a normal
key + HTTPS or a fresh alias:

```bash
# repo-local identity (do NOT rely on a global identity — keeps this repo isolated)
git config user.name  "cateringbookends"
git config user.email "cateringbookends@gmail.com"

# generate a Mac SSH key for this account and add the PUBLIC key at
# github.com/settings/keys (logged in as cateringbookends):
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_catering -C "cateringbookends-github-mac"
cat ~/.ssh/id_ed25519_catering.pub   # paste into GitHub

# point origin at the account over SSH (or just use https and log in as cateringbookends):
git remote set-url origin git@github.com:cateringbookends/ODC.git
```

### clasp / Google Apps Script (cateringbookends@gmail.com)
```bash
clasp login --user catering   # browser opens — pick cateringbookends@gmail.com
```
Then always deploy with the flag (clasp has no per-project default user):
```bash
cd apps-script
clasp push  --user catering
clasp deploy --user catering --deploymentId <LIVE_DEPLOYMENT_ID> --description "…"
```
The live deployment id is in `google-sync-config.json`'s `scriptUrl`
(`…/macros/s/<DEPLOYMENT_ID>/exec`). Reuse that same id so the production URL never
changes. `.clasp.json` already carries the `scriptId` + bound Sheet id.

### Vercel (cateringbookends)
```bash
vercel login          # log in as cateringbookends
vercel link           # confirm the cateringbookends/cateringbookends project
vercel --prod         # deploy the static frontend + api proxy
```
`.vercel/project.json` already links the project. The Vercel project's env vars
(`GOOGLE_SCRIPT_URL`, `GOOGLE_SCRIPT_API_KEY`) are set in the Vercel dashboard, not
in this repo — you don't need to re-add them.

## 5. Develop & deploy loop

- **Frontend** (HTML/JS/CSS): edit → `vercel --prod` to publish. Bump the `?v=N`
  cache-buster on any file you change so browsers pick it up (convention used
  throughout — see recent commits).
- **Backend logic** (`apps-script/Code.gs`): edit → `clasp push --user catering`
  → `clasp deploy --user catering --deploymentId <id>` to make it live.
- **Local Postgres path** (`server.js`) is a separate/secondary deployment (VPS) and
  isn't needed for normal work — production runs on Vercel + Apps Script + Google Sheet.
- Quick backend check: `curl -sS -L <scriptUrl>` should return the JSON banner.

## 6. Notes / gotchas carried over

- **clasp `--user catering` is mandatory every command** — omitting it silently uses
  the machine's default Google login.
- The Apps Script Web App follows a 302 to `script.googleusercontent.com`; any client
  hitting it directly must follow redirects and send `Content-Length`.
- The **VPS SSH key** (`.ssh/odc_key`) was not included in the zip. You only need it
  if you deploy the Postgres/`server.js` path to the VPS (`git push server main`) —
  not required for the Vercel/Sheets production path.
- Read `CLAUDE.md` for the full architecture (two backends, one frontend contract)
  and `AUDIT_REPORT_2026-07.md` for the outstanding roadmap (backups, soft-delete,
  KYC encryption, 2FA, etc.).

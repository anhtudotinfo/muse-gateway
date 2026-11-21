<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Release runbook — publishing `muse-gateway` to npm

The npm package `muse-gateway` ships the standalone build as `app/` —
`npm/` alone is NOT publishable (it lacks the app payload; `npm pack` there
produces a broken install). Always publish the tarball `package.mjs` produces.

### 1. Bump version in BOTH files (keep them equal)

- `package.json` (root)
- `npm/package.json` — this is the version npmjs sees

### 2. Build + pack

```powershell
npm run package   # = next build + scripts/package.mjs --zip
```

Produces in `dist/`:
- `muse-gateway-<ver>.tgz` — the publishable npm package
- `muse-gateway-win-x64.zip` + `muse-gateway/` — SEA exe distribution

Verify before publishing:

```powershell
tar -tzf dist\muse-gateway-<ver>.tgz | Select-String "app/server.js|bin/|tray/"
```

Must contain `package/app/server.js`, `package/app/.next/node_modules/*`
as REAL dirs (hashed externals — links are silently dropped by npm pack
and 500 every puppeteer route), `package/bin/muse-gateway.cjs`, `package/tray/*`.
`package.mjs` already throws if externals are still links.

### 3. Publish — account `bbqqvv` uses a WebAuthn security key ONLY

There is no TOTP app on the account, so `--otp` does not work. Use web auth:

```powershell
npm publish dist\muse-gateway-<ver>.tgz --auth-type=web
```

Browser opens → the user confirms with the security key (Windows Hello).

NEVER use a recovery code for login or publish: npm treats recovery-code
usage as a lost-2FA signal and suspends the account read-only for 72h.
It happened once — publish resumed only after the hold expired.

`npm login` also uses `--auth-type=web`; a stale `~/.npmrc` token shows
as `whoami` → 401 / publish → 404 or EOTP.

### 4. After publish

```powershell
npm view muse-gateway version   # expect the new version
git commit -am "chore(release): muse-gateway v<ver>"   # match history style
```

### Windows autostart design (do not regress)

The `HKCU\...\Run` entry must NEVER invoke `node.exe` or `muse-gateway.exe`
directly — both are console-subsystem binaries, so Windows allocates a
terminal at every login and closing it kills the server. Both autostart
paths (`npm/bin/muse-gateway.cjs` `toggleAutostart`, and the SEA launcher
template in `scripts/package.mjs`) write a `muse-gateway-autostart.vbs`
and register `wscript.exe "<vbs>"` (window style 0) instead. Keep them
in sync when changing startup behavior.

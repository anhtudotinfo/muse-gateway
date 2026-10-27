# Muse License Server — VENDOR-SIDE ONLY (never ship to customers)

The gateway client verifies licenses via Ed25519-SIGNED verdicts returned by
this service. Signed responses are unforgeable even over plain HTTP; TLS is
still recommended.

## Endpoints

| Endpoint | Body | Purpose |
|---|---|---|
| `POST /activate` | `{key, hwid, nonce}` | first activation — auto-binds HWID |
| `POST /verify` | `{key, hwid, nonce}` | hourly heartbeat / dashboard "Kiểm tra lại" |
| `POST /revoke` | `{keyId|key}` | admin: kill a key permanently |
| `POST /unrevoke` | `{keyId|key}` | admin: undo a revoke |
| `POST /unbind` | `{keyId|key, hwid?}` | admin: free machine seat(s) — empty `hwid` clears all |
| `GET /admin/list` | — | admin: every key + hwids + lastSeen |

Admin endpoints require header `x-admin-token: $MUSE_ADMIN_TOKEN`.

## Variant A — Cloudflare Workers (recommended)

Free tier covers this workload: 100k req/day, KV included, HTTPS on a stable
`*.workers.dev` URL, zero maintenance, no cold-start pain.

```bash
npx wrangler login
npx wrangler kv namespace create LICENSE_KV        # paste id → wrangler.toml
npx wrangler secret put MUSE_LICENSE_PRIVATE       # data/.license-private.pem
npx wrangler secret put MUSE_LICENSE_PUBLIC        # the public PEM
npx wrangler secret put MUSE_ADMIN_TOKEN           # any strong random string
npx wrangler deploy license-server/wrangler.toml
```

Vars (optional, edit `wrangler.toml`): `VERDICT_TTL_H` (default 24),
`MAX_HWIDS` (default 1).

KV writes are throttled — `lastSeen` refreshes at most once per key per day,
so free-tier write quotas stay far away.

## Variant B — plain Node (any VPS / Render / Fly / home machine)

```bash
MUSE_ADMIN_TOKEN=<secret> node license-server/server.mjs   # :3210
# env: PORT, VERDICT_TTL_H (default 24), MAX_HWIDS (default 1),
#      MUSE_LICENSE_PRIVATE (default reads data/.license-private.pem)
```

State lives in `license-server/db.json` — back it up; losing it only means
keys re-bind on next activation (self-healing), but revoke history resets.

## After deploy — bake the URL into the app

```ts
// src/lib/licenseOnline.ts
const BAKED_SERVER = 'https://muse-license.<subdomain>.workers.dev';
```

Then `npm run package`. Any install built after that requires the server for
activation and re-verifies hourly; verdicts cover 24h of offline use.

## Admin CLI (works with both variants)

```bash
LICENSE_SERVER=https://muse-license.<sub>.workers.dev MUSE_ADMIN_TOKEN=<t> \
  node license-server/admin.mjs list
node license-server/admin.mjs revoke  <keyId|MUSE1.key…>
node license-server/admin.mjs unrevoke <keyId|MUSE1.key…>
node license-server/admin.mjs unbind  <keyId|MUSE1.key…> [hwid]
```

## Security notes

- `MUSE_ADMIN_TOKEN` protects list/revoke/unbind — pick a strong random one.
- The server holds the vendor PRIVATE key to sign verdicts — same key that
  mints licenses. Keep it in Cloudflare secrets / env, never in the repo.
- `db.json` / KV only store: keyId (hash of sig), email, expiry, bound hwids,
  revoke flag, lastSeen. No license keys in plaintext.

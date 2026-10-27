# Muse Gateway

Local Muse session pool + OpenAI-compatible gateway (`/v1/chat/completions`, `/v1/responses`, `/v1/models`) with a web dashboard and Windows system-tray integration.

> **License required.** Anyone can install and open the dashboard, but the `/v1/*`
> gateway API stays locked (HTTP 402) until you activate a purchased license key.
> Contact the vendor to buy a key (floating or HWID-bound, time-limited).

## Install

```bash
npm install -g muse-gateway
```

## Run

```bash
muse-gateway
```

Opens an interactive menu:

```
=======================================================
  Muse Gateway  v1.0.0
  Server:  http://localhost:3000   ● running — pro
=======================================================
> Open Dashboard (Web UI)
  Hide to Tray (Background)
  Run in this terminal (foreground)
  Enter License Key…
  Stop Server
  Exit
```

- **Open Dashboard** — starts the server if needed, opens http://localhost:3000
- **Hide to Tray** — runs in background with a system-tray icon (Open Dashboard / Auto-start / Quit)
- **Run in this terminal** — foreground server, Ctrl+C to stop
- **Enter License Key** — paste a `MUSE1.…` key, activates without opening the dashboard

## Activate a license

Three ways — all equivalent:

1. `muse-gateway` menu → **Enter License Key…** → paste the key
2. Dashboard → **Bản quyền** tab → paste key → **Kích hoạt**
3. `curl -X POST http://localhost:3000/api/license -H "content-type: application/json" -d '{"action":"activate","licenseKey":"MUSE1.…"}'`

Until a valid key is activated, every `/v1/*` request returns `402 license_required`.
The dashboard and `/api/*` management routes always remain available.

## Client usage (after activation)

```bash
curl http://localhost:3000/v1/models

curl http://localhost:3000/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"muse-video","messages":[{"role":"user","content":"a cat playing piano"}]}'
```

Works with the OpenAI SDK — point `baseURL` to `http://localhost:3000/v1`.

## Commands

| Command | Effect |
|---|---|
| `muse-gateway` | interactive menu |
| `muse-gateway stop` | stop the background instance |
| `muse-gateway --open` | open the dashboard |
| `muse-gateway --serve` | run server in foreground (used internally) |
| `muse-gateway --version` | print version |
| `PORT=4000 muse-gateway` | custom port (default 3000) |

## Data location

All runtime state (sessions, license, API keys, usage, media, logs) lives in
`~/.muse-gateway` — never inside the installed package. Uninstalling keeps data;
delete `~/.muse-gateway` for a full reset.

- `~/.muse-gateway/server.log` — background server log
- `~/.muse-gateway/data/` — sessions, license.json, keys.json, pool, media

## Requirements

- Windows 10/11, Node.js ≥ 20.9
- Chrome or Edge installed (used for Muse account login capture)

## License

Commercial — `UNLICENSED`. The gateway API requires a purchased activation key.

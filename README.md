# Muse Gateway

Self-hosted gateway that exposes your muse.ai accounts as an OpenAI-compatible API, with a dashboard for accounts, API keys, usage and tunnels.

**Users:** install, activation and the full API reference are in [npm/README.md](npm/README.md), which ships as the package README.

## Development

```bash
npm install
npm run dev
```

The dashboard opens at http://localhost:3000 and the API lives under `/v1`. Runtime data goes to `./data`; set `MUSE_DATA_DIR` to use another folder. `data/` never ships in a release.

Run the tests, which need no browser or Muse account:

```bash
npm test
```

## Project layout

| Path | Contents |
|---|---|
| `src/app/v1/` | Public API: chat completions, responses, images, models, tasks |
| `src/app/api/` | Dashboard API and media delivery |
| `src/lib/museDriver.ts` | Drives muse.ai in a browser |
| `src/lib/musePool.ts` | Account selection, cooldowns, idempotency |
| `src/lib/modelKind.ts` | What each model returns (chat / image / video); the only place that decides it |
| `src/lib/tasks.ts` | Background tasks and webhooks |
| `npm/` | Published package: CLI, tray and user README |
| `license-server/` | License service |
| `extension/` | Chrome/Edge extension |

## Release

Follow the runbook in [AGENTS.md](AGENTS.md). Always publish the tarball produced by `npm run package`.

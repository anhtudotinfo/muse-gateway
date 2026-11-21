# Contributing

Thanks for helping. Bug reports, fixes and features are all welcome.

## Set up

```bash
npm install
npm run dev
```

The dashboard opens at http://localhost:3000. Runtime data goes to `./data`; set `MUSE_DATA_DIR` to keep a separate folder for development. Don't point a dev server at the same Muse accounts as a gateway that is already running, because both will drive the same sessions.

## Before you open a pull request

```bash
npx tsc --noEmit -p .
npm test
```

CI runs the same two checks. The tests need no browser and no Muse account.

- Keep a pull request to one change, and say in the description what it fixes and how you checked it.
- Add or update a test in `src/lib/*.test.ts` when you change API behaviour.
- Never commit anything from `data/`, API keys, cookies or license keys.

## Where things live

See the project layout in [README.md](README.md#project-layout). The model a request uses decides what it returns (`src/lib/modelKind.ts`), and the browser automation lives in `src/lib/museDriver.ts`.

## License

By contributing you agree that your contribution is released under the [MIT License](LICENSE).

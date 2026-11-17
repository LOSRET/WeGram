# AGENTS.md — apps/desktop/src/main

Scope: the Electron main process (protocol adapter, IPC, stores, media protocol).
Read the root `../../../../CLAUDE.md` and `docs/HANDOFF.md` first; this file only
adds what is specific to this layer.

## Layering

```
index.ts            app lifecycle, window, adapter wiring, media scheme
ipc/router.ts       per-channel zod validation, Result envelope
ipc/handlers.ts     one handler per invoke channel
telegram/           adapter.ts (the seam) / tdlib/ (real adapter) / mock.ts / updates.ts / events.ts
media/              registry.ts (token → path) / protocol.ts (wx-media://) / image-size.ts
store/              ui-db.ts (all SQL) / settings.ts (proxy only)
proxy*.ts           proxy DTO ↔ stored config
security/secrets.ts safeStorage (DPAPI) seal/unseal
```

Everything except `telegram/tdlib/**` (the real adapter folder) talks to the `TelegramAdapter` interface.
**ESLint enforces this**: importing `tdl` or `prebuilt-tdlib` anywhere else is an
error (`eslint.config.mjs` → "architecture"). If a change seems to need it, the
change belongs in the adapter.

## Rules that have already cost a debugging session

- **All `node:sqlite` calls live in `store/ui-db.ts`** (also lint-enforced).
  `settings.json` keeps only the proxy config, because it carries a sealed
  secret.
- **The renderer never sees a filesystem path.** Only the adapters may call
  `media/registry.ts` to mint a `wx-media://f/<token>` URL; `media/protocol.ts`
  resolves tokens and never request paths, and it must keep Range support.
- **`messagesByChat` entries are created only by `setHistory`/`prependHistory`**
  (that is renderer state, but the adapter decides what triggers it): a read
  marker for a chat whose history was never loaded must not look like a loaded
  chat, or groups open empty and never page back.
- Events are emitted as domain `AdapterEvent`s and batched by `telegram/updates.ts`
  (60 ms, monotonic `seq`). Do not push IPC events directly from the adapter.
- Password / MTProxy secret are sealed with `safeStorage` (`security/secrets.ts`).
- Packaging constraint: `tdjson.dll` cannot load from inside `app.asar`
  (`electron-builder.yml` unpacks it), and TDLib data dirs live under
  `app.getPath('userData')`, which `index.ts` pins to `%APPDATA%\WechatGram`.

## Verify

```powershell
pnpm typecheck
pnpm test
cd apps\desktop; pnpm ui:db-check     # headless ui.db check (node:sqlite)
cd apps\desktop; pnpm tdlib:smoke     # READ-ONLY real TDLib: getMe/getChats/history
pwsh apps\desktop\scripts\launch-detached.ps1 -Mock   # Electron + mock adapter
```

`spikes/tdlib/data` is a **real account**. Never send, delete, forward or
mark-read against it from a script — use the mock adapter (`-Mock`, or
`WECHATGRAM_ADAPTER=mock`) for anything that writes.

Never start Electron from an agent shell: Chromium cannot initialise inside the
job object. Use `launch-detached.ps1` (creates the process via WMI); logs land in
`.cache/app.log`.

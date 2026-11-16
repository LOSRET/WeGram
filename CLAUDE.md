# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

> **New session? Read `docs/HANDOFF.md` first** — current state, hard rules, measured surprises and next steps.

pnpm workspace with W1 + W2 implemented:

- `docs/技术方案.md` — authoritative design (Chinese). Change the design here first, then the code.
- `packages/protocol` — IPC contract: DTO zod schemas, channel tables, `AppError`. Single source of truth shared by main, preload and renderer. Exported straight from source (`src/index.ts`), no build step.
- `apps/desktop` — Electron app: `src/main` (adapter + IPC + store), `src/preload` (whitelisted `window.tg`), `src/renderer` (React 19 + Tailwind v4 UI).
- `spikes/tdlib` — measured TDLib behaviour on this machine; `RESULTS.md` holds packaging constraints that only fail at build time.

W2 scope is in: virtualised message list (`@tanstack/react-virtual`), anchored prepend, message send / reply / edit / delete / forward, per-chat drafts persisted in `ui.db`, and a dev acceptance panel (`?perf=1` on the preview server) that measures FPS and the pixel drift of the anchored row.

`ui.db` uses the built-in `node:sqlite` (Electron 38 ships Node 22.22) instead of better-sqlite3, so there is no native module to rebuild for the Electron ABI. All SQL is confined to `apps/desktop/src/main/store/ui-db.ts`; `settings.json` keeps only the proxy config because it carries a sealed secret.

Still deferred: `ui.db` scroll-anchor wiring (columns and API exist), media send/receive, stickers, search.

W1 is verified by `pnpm typecheck`, `pnpm build` and the browser preview (`pnpm web`). The Electron window has also been exercised end-to-end on this machine, but only when launched detached and with `--no-sandbox` (both are environment workarounds — see Environment quirks).

The real TDLib adapter is verified headlessly instead: `pnpm tdlib:smoke` runs the same `TdlibAdapter` under Node against an authorized session and checks `getMe` / `getChats` / history paging. See `spikes/tdlib/RESULTS.md` (Spike 2) for the measured findings, including why a proxy is mandatory and how `getChatHistory` anchoring works.

## Commands

```powershell
pnpm install                     # allowBuilds is configured in pnpm-workspace.yaml
pnpm typecheck                   # protocol + main/preload + renderer
pnpm build                       # electron-vite build → apps/desktop/out
cd apps\desktop; pnpm dev       # Electron dev (needs ELECTRON_RUN_AS_NODE unset, see below)
cd apps\desktop; pnpm web       # renderer-only preview at http://localhost:5174 (?perf=1 → W2 acceptance panel)
cd apps\desktop; pnpm tdlib:smoke   # headless real-TDLib check (see below)
cd apps\desktop; pnpm ui:db-check   # headless ui.db check (node:sqlite)
cd apps\desktop; pwsh scripts\launch-detached.ps1 -NoSandbox   # only way Electron starts here (-Mock for the fake adapter)
```

`WECHATGRAM_ADAPTER=mock` forces the mock adapter even when credentials exist — use it for any UI work that must not touch the real account (the launch script exposes it as `-Mock`).

`tdlib:smoke` reads `apps/desktop/.env` (`TELEGRAM_API_ID` / `TELEGRAM_API_HASH`) and these optional variables:

- `WECHATGRAM_TDLIB_DIR` — session dir override, used by both the app and the smoke script (the script defaults to `spikes/tdlib/data`, i.e. the session created by `login.mjs`, so no second login is needed).
- `TDLIB_PROXY` — `socks5://host:port`, `socks5://user:pass@host:port` or `mtproto://host:port?secret=...`. Without a proxy `getChats` hangs even though `getMe` succeeds.
- `SMOKE_DEBUG=1` — extra per-chat/history diagnostics.

Spike commands (unchanged):

```powershell
cd spikes\tdlib
node probe.mjs    # no credentials needed: proves tdjson loads, native addon runs, update stream works
node login.mjs    # interactive; requires TELEGRAM_API_ID / TELEGRAM_API_HASH in .env
```

## Environment quirks (Windows, this machine)

- **Never start Electron from the agent shell.** Shell commands run inside a Windows job object; Chromium cannot initialise there and aborts (sandbox on → `0x80000003`, sandbox off → `0xC0000005` inside `electron.exe`, logged by WER as APPCRASH). A minimal Electron app reproduces it, so it is not project code. Launch detached instead — `pwsh scripts/launch-detached.ps1` creates the process through WMI (parent `WmiPrvSE`, outside the job) and redirects logs to `.cache/app.log`.
- **Chromium's sandbox does not work on this machine at all**, independent of the launcher: Electron 30.5.1, 38.8.6 and 45.3.3 all crash with the sandbox enabled and all render fine with `--no-sandbox`. Treat `-NoSandbox` as a local-only workaround (Kaspersky 21.27 is running; Windows is an Insider build 10.0.26300). Never ship `--no-sandbox`; verify the sandboxed path on a clean machine before release.
- `ELECTRON_RUN_AS_NODE=1` is set globally; Electron then runs as plain Node and `require('electron')` is undefined. Always `Remove-Item Env:ELECTRON_RUN_AS_NODE` before launching Electron.
- pnpm 12 reads build-script permissions from `allowBuilds:` in `pnpm-workspace.yaml` (a name → bool map), not from the old `pnpm` field in `package.json`.
- The pnpm store and lock files live outside the workspace; installing needs full filesystem access.
- Editors save atomically through `*.tmpdir` folders. Vite's watcher dies with `EBUSY` on those, so both Vite configs ignore `**/*.tmpdir/**` and `**/*.tmp`.
- **Real-account safety:** the session in `spikes/tdlib/data` is a real Telegram account. Never send messages, delete, forward or mark-as-read against it while testing — use the mock adapter or the browser preview. Reading (getMe/getChats/getChatHistory) is acceptable.

## Architecture rules

- Only `apps/desktop/src/main/telegram/tdlib.ts` may import `tdl`. Everything else talks to the `TelegramAdapter` interface in `telegram/adapter.ts`.
- The renderer must not see raw TDLib JSON: map into protocol DTOs at the adapter boundary. Adding a field means adding it to `packages/protocol/src/dto.ts` first.
- New IPC channels go into `invokeChannels`/`invokeSchemas` (commands) or `eventChannels`/`eventSchemas` (events) in `packages/protocol/src/channels.ts`; preload and the router pick them up automatically. Never build channel names by concatenation.
- Every event carries `seq`; the renderer is expected to detect gaps and re-sync.
- Password/MTProxy-secret values cross IPC only as `MASK` (`'***'`) and are stored through `main/security/secrets.ts` (Windows DPAPI via `safeStorage`).
- UI state that is protocol-independent lives in `ui.db` through `main/store/ui-db.ts` (drafts, theme, scroll anchor, media cache). `main/store/settings.ts` keeps only the proxy config, because it carries a DPAPI-sealed secret. All `node:sqlite` calls stay inside `ui-db.ts`.
- Without `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` the app runs the mock adapter; with them it runs TDLib. `WECHATGRAM_ADAPTER=mock` forces the mock anyway. The mock is what keeps UI work unblocked without touching the real account.
- `src/renderer/src/lib/preview-bridge.ts` is browser-preview-only tooling. Do not let app logic depend on it.

## Conventions

- Code, identifiers, and comments in English. New documentation in English too — do not translate the existing Chinese design doc.
- The protocol layer is TDLib, via `tdl` + `prebuilt-tdlib`. Do not add the `telegram` (GramJS) package: its upstream repo is archived. `teleproto` is a fallback only, and only under the trigger conditions in `docs/技术方案.md` §3.3.
- Never reuse an `api_id`/`api_hash` from an official client or another project — that violates the Telegram API Terms and gets the app banned. Each deployment uses its own credentials from my.telegram.org.
- Packaging constraint: `tdjson.dll` cannot be loaded from inside `app.asar`, so `electron-builder.yml` unpacks `@prebuilt-tdlib`/`prebuilt-tdlib`; TDLib data directories must live under `app.getPath('userData')`.

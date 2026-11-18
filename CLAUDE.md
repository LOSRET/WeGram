# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

> **New session? Read `docs/HANDOFF.md` first** — current state, hard rules, measured surprises and next steps. For anything under `src/renderer`, read **`docs/UI-HANDOFF.md`** as well: the WeChat 4.x tokens/metrics that were measured off the real client, the icon provenance, the known deltas and the pitfalls.
>
> **Then read the layer notes** for the directory you are about to touch — they are short and they hold the rules that are specific to that layer: `packages/protocol/AGENTS.md`, `apps/desktop/src/main/AGENTS.md`, `apps/desktop/src/renderer/AGENTS.md`.
>
> **Restructuring or splitting files? Read `docs/REFACTOR-HANDOFF.md` first** — what already moved and why, the conventions the code now enforces mechanically, and the batches still pending (`mock.ts`, `preview-bridge.ts`, `styles/index.css`, `packages/protocol`).
>
> **`pnpm verify` is the one command that decides whether a change is done** (lint → typecheck → test → build). It must pass before you report success.

pnpm workspace with W1 + W2 + the W3 main body implemented:

- `docs/技术方案.md` — authoritative design (Chinese). Change the design here first, then the code.
- `packages/protocol` — IPC contract: DTO zod schemas, channel tables, `AppError`. Single source of truth shared by main, preload and renderer. Exported straight from source (`src/index.ts`), no build step.
- `apps/desktop` — Electron app: `src/main` (adapter + IPC + store + media protocol), `src/preload` (whitelisted `window.tg`), `src/renderer` (React 19 + Tailwind v4 UI).
- `spikes/tdlib` — measured TDLib behaviour on this machine; `RESULTS.md` holds packaging constraints that only fail at build time.

W2 scope is in: virtualised message list (`@tanstack/react-virtual`), anchored prepend, message send / reply / edit / delete / forward, per-chat drafts persisted in `ui.db`, and a dev acceptance panel (`?perf=1` on the preview server) that measures FPS and the pixel drift of the anchored row.

W3 main body is in: media send/receive (photo + document, upload/download progress over `evt:file`), media files served to the renderer through the `wx-media://` protocol (never raw paths), the three sticker formats (WebP `<img>`, TGS → `DecompressionStream('gzip')` + lottie-web, WebM `<video>`), a sticker picker backed by `getInstalledStickerSets`, TL entity rendering (bold/italic/code/pre/link/spoiler), day separators, the unread divider, read receipts, and a typing indicator that expires. The mock adapter generates real PNG/WebP/TGS fixture media under `userData/mock-media`.

The login is its **own window**, like WeChat's: a frameless 280×373 `BrowserWindow` (`main/login-window.ts`, renderer `screens/LoginWindow.tsx` via the `#login` hash) shows a **QR code** fed by TDLib (`requestQrCodeAuthentication` → `AuthState.waitQr`, rendered locally with the approved `qrcode` dependency). A user-driven sign-in — the QR, or the 用手机号登录 fallback — opens the shell **directly**; only a session restored at startup stops on the profile step first. `login:enter` opens the shell from that step, and signing out recreates the login window before closing the shell. TDLib cannot cancel a pending QR confirmation, so the phone fallback goes through `auth:reset` (destroy + rebuild the auth client). Design and the measured metrics: `docs/技术方案.md` §9.6, `docs/UI-HANDOFF.md` §2.2.

`ui.db` uses the built-in `node:sqlite` (Electron 38 ships Node 22.22) instead of better-sqlite3, so there is no native module to rebuild for the Electron ABI. All SQL is confined to `apps/desktop/src/main/store/ui-db.ts`; `settings.json` keeps only the proxy config because it carries a sealed secret.

Still deferred: search (global + in-chat), pinning/mute controls, settings page. Release packaging lives in `.github/workflows/release.yml` (tag → NSIS installer → GitHub Release), proven by `v0.1.0`; the installer itself has never been installed or code-signed.
`ui.db` reading positions (`scroll_anchor_id`/`scroll_offset`) are wired: MessageList writes them,
ChatPane restores them when the reader was not at the bottom.

W1 is verified by `pnpm typecheck`, `pnpm build` and the browser preview (`pnpm web`). The Electron window has also been exercised end-to-end on this machine, but only when launched detached and with `--no-sandbox` (both are environment workarounds — see Environment quirks).

The real TDLib adapter is verified headlessly instead: `pnpm tdlib:smoke` runs the same `TdlibAdapter` under Node against an authorized session and checks `getMe` / `getChats` / history paging. See `spikes/tdlib/RESULTS.md` (Spike 2) for the measured findings, including why a proxy is mandatory and how `getChatHistory` anchoring works.

**Real-account pass (same day):** the adapter was then driven end-to-end in the Electron window behind the mandatory SOCKS proxy, which surfaced three defects that the mock cannot reproduce — history paging stopped on short TDLib answers, read receipts poisoned every chat's cache, and an occluded window could freeze the transcript's visibility gate. All three are fixed; the rail and the chat rows now load real profile photos, and both long panes use WeChat's floating overlay scrollbar. Details: `docs/HANDOFF.md` → "Real-account session" and "Non-obvious facts".

## Coding standards

Ported from the rules that already run the rustracker project (`D:\vibe-coding\rustracker\CLAUDE.md` and `.trae/rules/project_rules.md`), re-expressed for this stack. They bias toward caution over speed; they never override the architecture rules further down. The layer notes (`packages/protocol/AGENTS.md`, `src/main/AGENTS.md`, `src/renderer/AGENTS.md`) are more specific and win for their subtree.

### Working agreements

- **State assumptions; ask when the request has more than one reading.** If a simpler design exists, say so before implementing it the hard way.
- **Never guess an API, flag or config from memory.** Check the installed types (`node_modules`), the Electron/TDLib docs, or an existing call site first. A wrong TDLib field name is exactly the kind of thing that type-checks and fails at runtime.
- **Every changed line traces to the request.** No drive-by renaming, reformatting or refactoring of code that is not broken; match the surrounding style even when you'd write it differently.
- **Clean up only your own orphans.** Remove the imports/variables your change made unused; leave pre-existing dead code in place and mention it.
- **Don't delete code you don't understand.** Surface the suspicion instead of acting on it.

### Non-negotiable code rules

The TypeScript/Electron equivalent of rustracker's "no `.unwrap()` in production code" — a crash is a crash, whether it comes from a panic or from an `undefined`:

- No non-null assertions (`x!`) and no `as` used to silence the checker. Narrow with a runtime check; `!` just moves the failure into the renderer, where it surfaces as a blank pane far from the cause.
- No new `any`. Lint leaves `no-explicit-any` off on purpose, so this is review discipline: use `unknown` plus a zod parse at the boundary.
- Validate every external input where it enters: IPC payloads through the zod schemas in `packages/protocol`, TDLib JSON in the `map/*` layer, media and TGS bytes as untrusted (§10).
- No empty `catch {}` and no catch that only logs. Errors cross the boundary as `AppError`; the renderer gets a code, never a stack.
- No `console.log` on shipped paths — use the existing logger/error channel. Existing occurrences are not a licence to add more.
- No new dependency without asking. No `electron`, `node:*`, `tdl` or `prebuilt-tdlib` import outside the folders the architecture rules allow.
- Protocol first: a new field or channel goes into `dto.ts` / `channels.ts` before the implementation.
- Keep side effects at the edges; pure logic belongs in testable modules (`lib/`, `*.test.ts`), because `pnpm test` is DOM-free and Electron-free by design.

**Done means** `pnpm verify` green (lint → typecheck → test → build) with zero warnings. While iterating, use the narrow command (`pnpm vitest run <file>`, `pnpm typecheck`); when reporting, say exactly what you ran and what you skipped — never claim success on a subset.

**Git.** Verify before committing (at least `pnpm typecheck && pnpm lint`). One logical change per commit, Conventional Commit messages. Small fix → current branch; multi-file feature or refactor → new branch.

## Commands

```powershell
pnpm install                     # allowBuilds is configured in pnpm-workspace.yaml
pnpm verify                      # THE gate: lint → typecheck → test → build
pnpm lint                        # eslint, architecture rules included (0 warnings allowed)
pnpm test                        # vitest, pure modules only (no DOM, no Electron)
pnpm format                      # prettier --write .  (pnpm format:check to verify only)
pnpm typecheck                   # protocol + main/preload + renderer
pnpm build                       # electron-vite build → apps/desktop/out
cd apps\desktop; pnpm dev       # Electron dev (needs ELECTRON_RUN_AS_NODE unset, see below)
cd apps\desktop; pnpm web       # renderer-only preview at http://localhost:5174 (?perf=1 → W2 acceptance panel)
cd apps\desktop; pnpm tdlib:smoke   # headless real-TDLib check (see below)
cd apps\desktop; pnpm ui:db-check   # headless ui.db check (node:sqlite)
cd apps\desktop; pwsh scripts\launch-detached.ps1 -NoSandbox   # only way Electron starts here (-Mock for the fake adapter, -RemoteDebugPort 9224 for CDP checks)
```

`WEGRAM_ADAPTER=mock` forces the mock adapter even when credentials exist — use it for any UI work that must not touch the real account (the launch script exposes it as `-Mock`).

`tdlib:smoke` reads `apps/desktop/.env` (`TELEGRAM_API_ID` / `TELEGRAM_API_HASH`) and these optional variables:

- `WEGRAM_TDLIB_DIR` — session dir override, used by both the app and the smoke script (the script defaults to `spikes/tdlib/data`, i.e. the session created by `login.mjs`, so no second login is needed).
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

- Only `apps/desktop/src/main/telegram/tdlib/**` (the adapter folder: `index.ts`, `client.ts`, `actions.ts`, `updates.ts`, `avatar-cache.ts`, `stickers.ts`, `proxy.ts`, `map/*`) may import `tdl` / `prebuilt-tdlib`. Everything else talks to the `TelegramAdapter` interface in `telegram/adapter.ts`. **ESLint enforces this** (`eslint.config.mjs`, "architecture"): importing `tdl`, `prebuilt-tdlib` or `node:sqlite` outside its one allowed file is a lint error, and so is importing Electron / Node / TDLib from the renderer.
- The renderer must not see raw TDLib JSON: map into protocol DTOs at the adapter boundary. Adding a field means adding it to `packages/protocol/src/dto.ts` first.
- New IPC channels go into `invokeChannels`/`invokeSchemas` (commands) or `eventChannels`/`eventSchemas` (events) in `packages/protocol/src/channels.ts`; preload and the router pick them up automatically. Never build channel names by concatenation.
- Every event carries `seq`; the renderer is expected to detect gaps and re-sync.
- Password/MTProxy-secret values cross IPC only as `MASK` (`'***'`) and are stored through `main/security/secrets.ts` (Windows DPAPI via `safeStorage`).
- UI state that is protocol-independent lives in `ui.db` through `main/store/ui-db.ts` (drafts, theme, scroll anchor, media cache). `main/store/settings.ts` keeps only the proxy config, because it carries a DPAPI-sealed secret. All `node:sqlite` calls stay inside `ui-db.ts`.
- `messagesByChat` entries are created **only** by `setHistory`/`prependHistory`. `applyMessageOps` must not create one for a chat whose history was never loaded: `ChatPane` reads "an entry exists" as "already cached" and would then skip the first-page fetch for good. (Read receipts fire for every chat, so this poisons the whole list — it is exactly the bug that made groups open empty.)
- Long scroll panes (chat list, transcript) use `components/OverlayScrollbar.tsx`; never reintroduce a native scrollbar there — Chromium gives those a layout gutter, so the rows re-flow whenever the bar appears. Popovers keep native thin bars on purpose.
- Never gate content visibility on `requestAnimationFrame` alone (the list's `--pending` class): Electron throttles rAF while the window is occluded, and the pane then stays invisible with its data loaded. Always pair a frame-based reveal with a `setTimeout` fallback.
- **Window lifetime follows authorization, and a completed sign-in opens the shell directly.** Only `main/login-window.ts`'s window exists until authorization; `syncWindowsToAuth` creates the shell immediately when a user-driven login becomes `ready` (closing the login window at once), while a session restored at startup waits for `login:enter`. It always creates the next window before closing the old one, or `window-all-closed` would quit mid-swap. The login window must not hydrate the chat store — it only follows `evt:auth`.
- Credentials decide the adapter: with `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` (environment, dev `.env`, or the value a release build inlined) the app runs TDLib; a development build without them runs the mock adapter, which is what keeps UI work unblocked without touching the real account. `WEGRAM_ADAPTER=mock` forces the mock in development only — a packaged build refuses to start without credentials rather than serve fixtures.
- `src/renderer/src/lib/preview-bridge.ts` is browser-preview-only tooling. Do not let app logic depend on it.
- Local media reaches the renderer only as a `wx-media://f/<token>` URL registered by `main/media/registry.ts`; only the adapters (and the mock) may register a path. The `wx-media` handler in `main/media/protocol.ts` resolves tokens, never request paths, and streams with Range support.
- The custom scheme is declared with `protocol.registerSchemesAsPrivileged` before `app.whenReady()`; the CSP in `renderer/index.html` must keep `wx-media:` in `img-src`, `media-src` and `connect-src` (TGS is fetched, then gunzipped in the renderer).
- Sticker rendering depends on `lottie-web` (renderer only, TGS path). Keep the decompression guards in `lib/tgs.ts`: TGS is user-controlled input (§10).

## Conventions

- Code, identifiers, and comments in English. New documentation in English too — do not translate the existing Chinese design doc.
- The protocol layer is TDLib, via `tdl` + `prebuilt-tdlib`. Do not add the `telegram` (GramJS) package: its upstream repo is archived. `teleproto` is a fallback only, and only under the trigger conditions in `docs/技术方案.md` §3.3.
- Never reuse an `api_id`/`api_hash` from an official client or another project — that violates the Telegram API Terms and gets the app banned. Each deployment uses its own credentials from my.telegram.org.
- Packaging constraint: `tdjson.dll` cannot be loaded from inside `app.asar`, so `electron-builder.yml` unpacks `@prebuilt-tdlib`/`prebuilt-tdlib`; TDLib data directories must live under `app.getPath('userData')`.
- Release artifacts carry the deployment's own `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`: `electron.vite.config.ts` inlines them into the main bundle from the environment (CI feeds repository secrets), so never hard-code them and never expect the release to read a local `.env`. A packaged build with no credentials shows an error and quits — the mock adapter is development-only and `WEGRAM_ADAPTER=mock` is ignored when packaged.

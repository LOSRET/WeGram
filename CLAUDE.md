# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

> **New session? Read `docs/HANDOFF.md` first** — current state, hard rules, measured surprises and next steps. For anything under `src/renderer`, read **`docs/UI-HANDOFF.md`** as well: the WeChat 4.x tokens/metrics that were measured off the real client, the icon provenance, the known deltas and the pitfalls.
>
> **Then read the layer notes** for the directory you are about to touch — they are short and they hold the rules that are specific to that layer: `packages/protocol/AGENTS.md`, `apps/desktop/src/main/AGENTS.md`, `apps/desktop/src/renderer/AGENTS.md`.
>
> **Restructuring or splitting files? Read `docs/REFACTOR-HANDOFF.md` first** — what already moved and why, the conventions the code now enforces mechanically, and the one batch still pending (`packages/protocol`). The split rules themselves are in "Agent-maintainable code" below.
>
> **`pnpm verify` is the one command that decides whether a change is done** (lint → typecheck → test → build). It must pass before you report success.

pnpm workspace with W1 + W2 + the W3 main body implemented:

- `docs/技术方案.md` — authoritative design (Chinese). Change the design here first, then the code.
- `packages/protocol` — IPC contract: DTO zod schemas, channel tables, `AppError`. Single source of truth shared by main, preload and renderer. Exported straight from source (`src/index.ts`), no build step.
- `packages/adapter-contract` — the `TelegramAdapter` seam (`adapter.ts`: interface, events, `AdapterEmitter`) shared by the TDLib adapter and the fake one, so the mock implements the seam without importing app code. Types plus a 20-line emitter only.
- `packages/mock-adapter` — the fake `TelegramAdapter` (auth flow, chats, history, search, stickers, media), plus the generated PNG/WebP/TGS/WebM fixtures; main injects the `wx-media://` registry and the image-size probe. Development only.
- `packages/mock-session` — the fake session's pure rules (paging, read marker, comment access, chat-list order), shared by the main mock adapter and the browser preview. Imports nothing: it is bundled into the renderer.
- `packages/mock-fixtures` — the demo account both fakes serve (chats, messages, comment threads, contact fields); each side injects its media and clock.
- `apps/desktop` — Electron app: `src/main` (adapter + IPC + store + media protocol), `src/preload` (whitelisted `window.tg`), `src/renderer` (React 19 + Tailwind v4 UI).
- `spikes/tdlib` — measured TDLib behaviour on this machine; `RESULTS.md` holds packaging constraints that only fail at build time.

W2 scope is in: virtualised message list (`@tanstack/react-virtual`), anchored prepend, message send / reply / edit / delete / forward, per-chat drafts persisted in `ui.db`, and a dev acceptance panel (`?perf=1` on the preview server) that measures FPS and the pixel drift of the anchored row.

W3 main body is in: media send/receive (photo + document, upload/download progress over `evt:file`), media files served to the renderer through the `wx-media://` protocol (never raw paths), the three sticker formats (WebP `<img>`, TGS → `DecompressionStream('gzip')` + lottie-web, WebM `<video>`), the client's 表情 panel (a 464 px card with 最近使用 over a 10-column emoji grid, a 搜索 tab and one tab per installed sticker set from `getInstalledStickerSets`; recents persist in `ui.db`), one-emoji messages drawn as their AnimatedEmoji sticker (no bubble, one pass, click replays with its sound), TL entity rendering (bold/italic/code/pre/link/spoiler, mentions that open the person's chat — `mentionName` by id, `@username` through `chats:openUsername` — and Telegram links that open the chat/post inside the app — `t.me`/`tg://`), day separators, the unread divider, read receipts, and a typing indicator that expires. The mock adapter generates real PNG/WebP/TGS fixture media under `userData/mock-media`.

The login is its **own window**, like WeChat's: a frameless 280×373 `BrowserWindow` (`main/login-window.ts`, renderer `screens/LoginWindow.tsx` via the `#login` hash) shows a **QR code** fed by TDLib (`requestQrCodeAuthentication` → `AuthState.waitQr`, rendered locally with the approved `qrcode` dependency). A user-driven sign-in — the QR, or the 用手机号登录 fallback — opens the shell **directly**; only a session restored at startup stops on the profile step first. `login:enter` opens the shell from that step, and signing out recreates the login window before closing the shell. TDLib cannot cancel a pending QR confirmation, so the phone fallback goes through `auth:reset` (destroy + rebuild the auth client). Design and the measured metrics: `docs/技术方案.md` §9.6, `docs/UI-HANDOFF.md` §2.2.

`ui.db` uses the built-in `node:sqlite` (Electron 45 ships Node 24.22) instead of better-sqlite3, so there is no native module to rebuild for the Electron ABI. All SQL is confined to `apps/desktop/src/main/store/ui-db.ts`; `settings.json` keeps what must exist before any window does — the proxy config (sealed secret) and the TDLib network options (`prefer_ipv6`).

Search is wired end to end: the chat-list pill is a Telegram-style panel with 聊天 / 频道 tabs (conversation hits via `searchChats`, and message hits across chats via `searchMessages` with TDLib's chat-type filter, cursor-paged), and the 聊天信息 panel's 查找聊天内容 uses `search:inChat` (`searchChatMessages`). Still deferred: pinning chat controls, settings page. Release packaging lives in `.github/workflows/release.yml` (a version bump on `main` → NSIS installer → GitHub Release; pushing a `v*` tag still works), proven by `v0.1.0`–`v0.1.2`; the installer itself has never been installed or code-signed.
`ui.db` reading positions (`scroll_anchor_id`/`scroll_offset`) are wired: MessageList writes them,
ChatPane restores them when the reader was not at the bottom. A row older than the
newest page is loaded *around* itself (`messages:around`), and a window that stops
short of the latest message (`hasNewer`) is extended with `messages:newer` instead of
splicing live arrivals into a gap.

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

**Git.** Verify before committing (at least `pnpm typecheck && pnpm lint`). One logical change per commit, Conventional Commit messages. Commits are GPG-signed (`commit.gpgsign=true`): never pass `--no-gpg-sign`, and check `git log -1 --format=%G?` prints `G`. Small fix → current branch; multi-file feature or refactor → new branch.

**Version.** The root `package.json` is the only place a version is written down. `pnpm sync-version` copies it into `apps/desktop` (what Electron and electron-builder read) and `packages/protocol`; `pnpm check:version`, the first step of `pnpm verify`, fails on drift. Bump with `pnpm version 0.2.1 --no-git-tag-version && pnpm sync-version`; the renderer gets the value inlined as `__WEGRAM_VERSION__` at build time, main uses `app.getVersion()`, and a release tag re-stamps the root manifest in CI.

**Release.** `.github/workflows/release.yml` packages on **push to `main`**: it reads the root version, and if `v<version>` does not exist yet it builds the NSIS installer once, creates the tag at that commit and publishes the GitHub Release. The same version pushed again is skipped (one release per version), so a version bump + `git push` is the whole release procedure. Pushing a `v*` tag or running the workflow manually still works and refreshes that release's assets.

### Agent-maintainable code (the split rules)

The tree was split on 2026-11-19 so that an agent can read a whole module before editing
it — what moved, why, and the checks that were run are in `docs/REFACTOR-HANDOFF.md`.
These rules keep it that way:

- **One file = one reason to change.** A component owns its render tree; data fetching,
  scroll/geometry, IPC and pure rules live beside it in their own module. When a file
  starts acquiring a second concern, split it instead of adding another branch.
- **Size budget: ~350 lines is normal, 1100 is the hard cap.** ESLint enforces
  `max-lines: 1100` on `apps/desktop/src/**` and `packages/protocol/src/**` (generated
  `WechatIcons.tsx` is exempt; the cap was 550 until 2026-11-22). It counts neither
  blank nor comment-only lines (`skipBlankLines` + `skipComments`), so the number
  measures logic density rather than reading volume — imports still count, and so does a
  trailing comment on a line that has code. The cap is the backstop that stops a giant
  file from reappearing — the ~350-line budget and "one file = one reason to change" are
  still the working rules. Hitting the cap is a design signal, not a formatting problem.
- **Core logic may break the 1100 cap — deliberately, once, and in writing.** A file whose
  single concern is one indivisible algorithm (a state machine, a reducer over one data
  shape, a protocol table whose keys cannot be partitioned without inventing a boundary)
  may run past the cap, because splitting it would trade one long file for cross-module
  plumbing plus a "why is this in three places" question. The exemption takes all three,
  in the same change: a top-of-file `/* eslint-disable max-lines -- <the one concern this
  file owns> */` carrying the reason, a row in the layer's `AGENTS.md` naming the file
  and its concern, and a design-doc sentence recording what is deliberately not split.
  It is re-justified as soon as the file grows a second concern, and at ~700 counted
  lines the split question reopens on readability alone. Feature growth never takes it: a
  component that is merely getting bigger still splits.
- **Split by responsibility, never by line count.** Keep the public import path stable
  with a directory index (`viewer/`, `picker/`, `login/`, `history/`,
  `tdlib/actions/index.ts`, `mock/index.ts`). No `utils.ts` / `helpers.ts` dumping
  grounds.
- **Pure rules leave, and get a test.** Time, size, geometry, ordering and "may this be
  cached" rules go to React-free / Electron-free modules (`renderer/src/lib/`, plain
  functions in `main/**`) so `pnpm test` can pin them; a refactor that extracts a rule
  adds its test in the same batch.
- **Comments are part of the module.** The load-bearing explanations (scroll timing,
  cold-cache retries, QR cancellation, read-marker rules) travel with the code they
  describe. A move that drops them is a regression even when the tests pass.
- **A split changes no behaviour and no contract.** No channel/DTO/`wx-*` renames, no
  drive-by edits, one logical batch per commit, `pnpm verify` before each.
- **A move updates the map.** Update the touched layer note (`renderer/AGENTS.md`,
  `main/AGENTS.md`, `packages/protocol/AGENTS.md`) and `docs/REFACTOR-HANDOFF.md` in
  the same batch, or the next session rediscovers the layout the hard way.
- **New features share the budget.** Prefer a new module plus a small call site over
  growing an existing component; run `pnpm lint` (it includes the cap) before opening a
  PR.

## Commands

```powershell
pnpm install                     # allowBuilds is configured in pnpm-workspace.yaml
pnpm electron:install            # Electron 45 has no postinstall: fetch its binary (dev only)
pnpm verify                      # THE gate: lint → typecheck → test → build
pnpm lint                        # eslint, architecture rules included (0 warnings allowed)
pnpm test                        # vitest, pure modules only (no DOM, no Electron)
pnpm format                      # prettier --write .  (pnpm format:check to verify only)
pnpm typecheck                   # protocol + main/preload + renderer
pnpm build                       # electron-vite build → apps/desktop/out
cd apps\desktop; pnpm dev       # Electron dev (needs ELECTRON_RUN_AS_NODE unset, see below)
cd apps\desktop; pnpm web       # renderer-only preview at http://localhost:5174 (?perf=1 → W2 acceptance panel)
cd apps\desktop; pnpm tdlib:smoke   # headless real-TDLib check (see below)
cd apps\desktop; pnpm tdlib:test-dc # READ/WRITE check against Telegram's test data centers
cd apps\desktop; pnpm ui:db-check   # headless ui.db check (node:sqlite)
cd apps\desktop; pwsh scripts\launch-detached.ps1 -NoSandbox   # only way Electron starts here (-Mock for the fake adapter, -RemoteDebugPort 9224 for CDP checks)
```

`WEGRAM_ADAPTER=mock` forces the mock adapter even when credentials exist (the launch
script exposes it as `-Mock`). It is the fixture path for UI work — browser preview,
demos, a machine with no credentials. Write-path checks against real TDLib belong on the
test DCs now, see the three tiers under Environment quirks.

`tdlib:smoke` reads `apps/desktop/.env` (`TELEGRAM_API_ID` / `TELEGRAM_API_HASH`) and these optional variables:

- `WEGRAM_TDLIB_DIR` — session dir override, used by both the app and the smoke script (the script defaults to `spikes/tdlib/data`, i.e. the session created by `login.mjs`, so no second login is needed).
- `TDLIB_PROXY` — `socks5://host:port`, `socks5://user:pass@host:port`, `http://host:port` or `mtproto://host:port?secret=...`. Without a proxy `getChats` hangs even though `getMe` succeeds.
- `SMOKE_DEBUG=1` — extra per-chat/history diagnostics.
- `WEGRAM_TDLIB_TEST_DC=1` — points the smoke script (and the app) at Telegram's test
  data centers: a separate account space where send / edit / delete cannot reach a real
  chat. The session is its own directory (`userData/tdlib/test`, or
  `spikes/tdlib/test-data` for the scripts). `pnpm tdlib:test-dc` drives the write
  paths there, but see the note below.

**Test-DC accounts are created by an official app, then used by TDLib (verified
end-to-end 2026-11-20).** The reserved `99966XYYYY` numbers on
core.telegram.org/api/auth#test-accounts are dead — TDLib's maintainer on tdlib/td#3083:
*"Test accounts were disabled due to extensive abuse of them. Now a real phone number is
required to create an account in Test DC"* and *"an official mobile application is
required to create an account"* (iOS Debug menu, Android beta; Telegram Desktop beta
works too). A real number gets `authenticationCodeTypeTelegramMessage`, so the code is
delivered into the **test-DC session of that official app** and `resend` is refused for
that type. Recipe: hold Alt+Shift, right click "Add account" → **Test server** in Telegram
Desktop (beta build), sign the number in there; then
`WEGRAM_TEST_PHONE=+... WEGRAM_TEST_ALLOW_REAL_PHONE=1 pnpm tdlib:test-dc` drives the
TDLib login and, with `WEGRAM_TEST_CODE=<the 6-digit code from that session>`, runs the
write checks. Measured on a fresh test account: authorization → `ready`, 3 chats,
send → edit → photo upload → delete all pass.

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
- **Electron 45 no longer downloads its binary from a `postinstall`** (the downloader is the `install-electron` bin on purpose). A fresh checkout runs `pnpm electron:install` before `pnpm dev` / `launch-detached.ps1`; `pnpm build` and electron-builder fetch their own copy. Electron 45 also replaced `clipboard.writeImage()` with the async web clipboard, so `viewer:copy` writes a PNG `ClipboardItem`.
- pnpm 12 reads build-script permissions from `allowBuilds:` in `pnpm-workspace.yaml` (a name → bool map), not from the old `pnpm` field in `package.json`.
- The pnpm store and lock files live outside the workspace; installing needs full filesystem access.
- Editors save atomically through `*.tmpdir` folders. Vite's watcher dies with `EBUSY` on those, so both Vite configs ignore `**/*.tmpdir/**` and `**/*.tmp`.
- **Writes never touch the real account.** Three tiers: (1) the session in
  `spikes/tdlib/data` is a real Telegram account and stays **read-only** — `getMe` /
  `getChats` / `getChatHistory` only; (2) anything that sends, edits, deletes, forwards or
  marks read with real TDLib runs on Telegram's test DCs (`pnpm tdlib:test-dc`, or
  `WEGRAM_TDLIB_TEST_DC=1` for the app) — a separate account space that can never reach a
  real chat; (3) the mock adapter (`WEGRAM_ADAPTER=mock` / the launch script's `-Mock` /
  the browser preview) is now only the UI-fixture path, for work that should not talk to a
  Telegram account at all.

## Architecture rules

- Only `apps/desktop/src/main/telegram/tdlib/**` (the adapter folder: `index.ts`, `client.ts`, `actions/`, `updates.ts`, `avatar-cache.ts`, `stickers.ts`, `proxy.ts`, `map/*`) may import `tdl` / `prebuilt-tdlib`. Everything else talks to the `TelegramAdapter` interface in `telegram/adapter.ts`. **ESLint enforces this** (`eslint.config.mjs`, "architecture"): importing `tdl`, `prebuilt-tdlib` or `node:sqlite` outside its one allowed file is a lint error, and so is importing Electron / Node / TDLib from the renderer.
- The renderer must not see raw TDLib JSON: map into protocol DTOs at the adapter boundary. Adding a field means adding it to `packages/protocol/src/dto.ts` first.
- New IPC channels go into `invokeChannels`/`invokeSchemas` (commands, `channels.ts` plus the domain tables it spreads — `chats.ts`, `qr.ts`, `send.ts`, `presence.ts`, `network.ts`) or `eventChannels`/`eventSchemas` (events, `packages/protocol/src/events.ts`); preload and the router pick them up automatically. Never build channel names by concatenation.
- Every event carries `seq`; the renderer is expected to detect gaps and re-sync.
- Password/MTProxy-secret values cross IPC only as `MASK` (`'***'`) and are stored through `main/security/secrets.ts` (Windows DPAPI via `safeStorage`).
- UI state that is protocol-independent lives in `ui.db` through `main/store/ui-db.ts` (drafts, theme, scroll anchor, media cache). `main/store/settings.ts` keeps only what must exist before any window does: the proxy config (its secret is DPAPI-sealed) and the TDLib network options (`prefer_ipv6`). All `node:sqlite` calls stay inside `ui-db.ts`.
- `messagesByChat` entries are created **only** by `setHistory`/`prependHistory`. `applyMessageOps` must not create one for a chat whose history was never loaded: `ChatPane` reads "an entry exists" as "already cached" and would then skip the first-page fetch for good. (Read receipts fire for every chat, so this poisons the whole list — it is exactly the bug that made groups open empty.)
- Long scroll panes (chat list, transcript) use `components/OverlayScrollbar.tsx`; never reintroduce a native scrollbar there — Chromium gives those a layout gutter, so the rows re-flow whenever the bar appears. Popovers keep native thin bars on purpose.
- Never gate content visibility on `requestAnimationFrame` alone (the list's `--pending` class): Electron throttles rAF while the window is occluded, and the pane then stays invisible with its data loaded. Always pair a frame-based reveal with a `setTimeout` fallback.
- **Window lifetime follows authorization, and a completed sign-in opens the shell directly.** Only `main/login-window.ts`'s window exists until authorization; `syncWindowsToAuth` creates the shell immediately when a user-driven login becomes `ready` (closing the login window at once), while a session restored at startup waits for `login:enter`. It always creates the next window before closing the old one, or `window-all-closed` would quit mid-swap. The login window must not hydrate the chat store — it only follows `evt:auth`.
- Credentials decide the adapter: with `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` (environment, dev `.env`, or the value a release build inlined) the app runs TDLib; a development build without them runs the mock adapter, which is what keeps UI work unblocked without touching the real account. `WEGRAM_ADAPTER=mock` forces the mock in development only — a packaged build refuses to start without credentials rather than serve fixtures.
- `src/renderer/src/lib/preview-bridge.ts` (implementation under `lib/preview/`) is browser-preview-only tooling. Do not let app logic depend on it.
- Local media reaches the renderer only as a `wx-media://f/<token>` URL registered by `main/media/registry.ts`; only the adapters (and the mock) may register a path. The `wx-media` handler in `main/media/protocol.ts` resolves tokens, never request paths, and streams with Range support.
- The custom scheme is declared with `protocol.registerSchemesAsPrivileged` before `app.whenReady()`; the CSP in `renderer/index.html` must keep `wx-media:` in `img-src`, `media-src` and `connect-src` (TGS is fetched, then gunzipped in the renderer).
- Sticker rendering depends on `lottie-web` (renderer only, TGS path). Keep the decompression guards in `lib/tgs.ts`: TGS is user-controlled input (§10).

## Conventions

- Code, identifiers, and comments in English. New documentation in English too — do not translate the existing Chinese design doc.
- The protocol layer is TDLib, via `tdl` + `prebuilt-tdlib`. Do not add the `telegram` (GramJS) package: its upstream repo is archived. `teleproto` is a fallback only, and only under the trigger conditions in `docs/技术方案.md` §3.3.
- Never reuse an `api_id`/`api_hash` from an official client or another project — that violates the Telegram API Terms and gets the app banned. Each deployment uses its own credentials from my.telegram.org.
- Packaging constraint: `tdjson.dll` cannot be loaded from inside `app.asar`, so `electron-builder.yml` unpacks `@prebuilt-tdlib`/`prebuilt-tdlib`; TDLib data directories must live under `app.getPath('userData')`.
- Release artifacts carry the deployment's own `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`: `electron.vite.config.ts` inlines them into the main bundle from the environment (CI feeds repository secrets), so never hard-code them and never expect the release to read a local `.env`. A packaged build with no credentials shows an error and quits — the mock adapter is development-only and `WEGRAM_ADAPTER=mock` is ignored when packaged.

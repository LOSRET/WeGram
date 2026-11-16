# Handoff — WechatGram

Written 2026-11-17 at the end of the W1/W2 session. Read this first, then
`docs/技术方案.md` (authoritative design, Chinese) and `spikes/tdlib/RESULTS.md`
(measured TDLib behaviour). `CLAUDE.md` holds the rules that must not drift.

## Where things stand

Greenfield → working skeleton in two milestones:

- **W1** Electron shell, `packages/protocol` IPC contract, mock adapter, real TDLib
  adapter with manual auth state machine, SOCKS5/MTProxy proxy support, WeChat-style
  login screen + three-column shell.
- **W2** virtualised message list, anchored history paging, send / reply / edit /
  delete / forward, per-chat drafts, `ui.db` (drafts, theme, scroll-anchor columns).
- Spike 2 (real login + session reuse) is **done and verified**; the session lives in
  `spikes/tdlib/data`.

Verified at the end of the session: `pnpm typecheck`, `pnpm build`, `pnpm tdlib:smoke`,
`pnpm ui:db-check`, and the browser acceptance panel (`?perf=1`) — 5000 messages at
60 fps, 0 px viewport drift when prepending a page.

Follow-up session (same day), after the import below: repo created, `senderChatId` fix
for channel posts, the dark title-bar overlay verified end-to-end plus a login-screen
drag strip, and the `ui.db` reading-position wiring (details in "Known gaps"). The
`git log --oneline` of `main` is the source of truth for those commits.

**Git exists now**: `main`, root commit `262996a` ("chore: initial import of the W1/W2
skeleton"), 69 files, clean tree. `.gitignore` covers `.env*`, `node_modules`, `out`,
`.cache`, `spikes/*/data`; `.gitattributes` pins `eol=lf` so the machine's global
`core.autocrlf=true` cannot rewrite the whole tree on the next checkout.

Two gotchas from that commit:

- `commit.gpgsign=true` is set globally, but gpg cannot reach `keyboxd` from the agent
  shell ("can't create … sentinel.lock"). The root commit was made with
  `git -c commit.gpgsign=false`; re-sign in a normal terminal with
  `git commit --amend -S --no-edit` if signed history matters.
- `AGENTS.md` is a symlink to `CLAUDE.md` and is stored as one (mode `120000`). This
  machine cannot create symlinks without admin/Developer Mode, so `core.symlinks=false`
  is in effect — a `git checkout`/`git restore` of that path would replace the link with
  a one-line text file containing `CLAUDE.md`. Don't restore it casually; recreate the
  link with `New-Item -ItemType SymbolicLink` from an elevated shell.

## Hard rules

1. **The Telegram account in `spikes/tdlib/data` is real and read-only.** Never send,
   edit, delete, forward or mark-as-read against it while testing. Reading
   (`getMe`/`getChats`/`getChatHistory`) is fine. For any UI work that could write,
   force the fake adapter: `WECHATGRAM_ADAPTER=mock` (the launch script's `-Mock`).
2. **Never start Electron from the agent shell.** Shell commands run inside a Windows
   job object; Chromium aborts there (see Environment). Use
   `pwsh scripts/launch-detached.ps1`.
3. **`--no-sandbox` is a local workaround only.** It must never reach a release build.
   The sandboxed path has to be verified on a clean machine before shipping.
4. `api_id`/`api_hash` are per-deployment from my.telegram.org. `apps/desktop/.env`
   and `spikes/tdlib/.env` are gitignored; do not copy them anywhere else.

## Environment (this machine)

| Symptom | Cause | Workaround |
|---|---|---|
| `electron.exe --version` exits `0x80000003`; the app exits `0xC0000005` (WER: APPCRASH in `electron.exe`) | Chromium cannot initialise inside the agent shell's job object | launch detached via WMI (`scripts/launch-detached.ps1`) |
| Same crash with the sandbox on, even when launched detached | Chromium's sandbox is broken on this machine — Electron 30.5.1 / 38.8.6 / 45.3.3 all reproduce it. Kaspersky 21.27 is running; Windows is an Insider build 10.0.26300 | `-NoSandbox` locally; verify the real path on another machine |
| `require('electron')` is `undefined` | `ELECTRON_RUN_AS_NODE=1` is set globally | `Remove-Item Env:ELECTRON_RUN_AS_NODE` before launching |
| `pnpm install` fails / ignored builds | pnpm 12 reads `allowBuilds:` (name → bool map) from `pnpm-workspace.yaml`, store lives outside the workspace | already configured; needs full filesystem access |
| Vite watcher dies with `EBUSY` | editors save through `*.tmpdir` folders | both Vite configs ignore `**/*.tmpdir/**` and `**/*.tmp` |
| `getChats` hangs, `getMe` works | no proxy → TDLib reads users/chats from the local DB but cannot reach the network | set a proxy; `socks5://127.0.0.1:7890` worked here (Clash mixed port) |

## How to run and verify

```powershell
pnpm install
pnpm typecheck                  # protocol + main/preload + renderer
pnpm build                      # → apps/desktop/out

cd apps\desktop
pnpm web                        # renderer-only preview; ?perf=1 shows the W2 panel
pnpm tdlib:smoke                # real adapter headlessly (needs .env + proxy env)
pnpm ui:db-check                # ui.db via node:sqlite, headless
pwsh scripts\launch-detached.ps1 -NoSandbox -Mock   # the only way Electron starts here
```

- `tdlib:smoke` env: `TDLIB_PROXY=socks5://host:port`, `WECHATGRAM_TDLIB_DIR`,
  `SMOKE_DEBUG=1`. It defaults to the spike session, so no second login is needed.
- The browser preview installs `lib/preview-bridge.ts` when `window.tg` is missing.
  It mirrors the mock adapter for the UI only — never let app logic depend on it.
- Expected smoke output: `auth state : ready`, 20 chats, `history: 10 messages,
  hasMore=true`. Without a proxy it times out on `listChats` — that is the known
  network behaviour, not a code bug.

## Architecture map

```
packages/protocol/src/       dto.ts (zod schemas + types), channels.ts (channel tables,
                             schemas, TgBridge), errors.ts (AppError), index.ts
apps/desktop/src/main/
  index.ts                   app lifecycle, window, theme overlay, adapter wiring
  ipc/router.ts              per-channel zod validation, Result envelope
  ipc/handlers.ts            one handler per invoke channel
  telegram/adapter.ts        TelegramAdapter interface + event types (the seam)
  telegram/tdlib.ts          ONLY file allowed to import `tdl`
  telegram/mock.ts           fake adapter incl. a 5000-message chat (id 99)
  telegram/updates.ts        EventBus: 60 ms batching, monotonic seq
  telegram/events.ts         AdapterEvent → evt:* channels
  telegram/index.ts          adapter selection (mock / tdlib, WECHATGRAM_ADAPTER)
  store/ui-db.ts             ALL node:sqlite access (drafts, theme, anchors, media cache)
  store/settings.ts          JSON store for the proxy only (DPAPI-sealed secret)
  proxy.ts, proxy-url.ts     stored ↔ view/masked config, URL parsing
  security/secrets.ts        safeStorage seal/unseal
  preload/index.ts           window.tg.invoke / window.tg.on, channel whitelist
apps/desktop/src/renderer/src/
  App.tsx                    bootstrap + event subscription (one place)
  store/useAppStore.ts       zustand state (chats, messages, drafts of UI state)
  components/MessageList.tsx virtualiser + anchored prepend + context menu
  lib/useAnchoredScroll.ts   ready gate, 40px stick-to-bottom, resize compensation
  components/Composer.tsx    IME guard, reply bar, edit mode, draft debounce
  components/PerfPanel.tsx   dev-only acceptance panel (?perf=1)
  lib/preview-bridge.ts      browser-preview-only fake IPC
scripts/                     launch-detached.ps1, tdlib-smoke.ts, ui-db-check.ts
```

Rules that keep it maintainable: only `telegram/tdlib.ts` knows TDLib JSON; new fields
start in `dto.ts`; new channels go into the channel tables in `channels.ts` (preload and
router pick them up); all `node:sqlite` calls stay in `ui-db.ts`.

## Non-obvious facts, already measured — do not re-derive

- **`getChatHistory` anchoring**: `from_message_id = 0` does **not** fetch from the
  server, it returns only the locally cached last message. The first page must anchor
  on `chat.last_message.id`; paging older means anchoring on the oldest loaded id and
  filtering `id < anchor`. A negative `offset` returns *newer* messages, so it cannot
  page backwards. First server fetch of 50 messages took ~3.4 s.
- **Virtualised prepend needs two stages**: rough compensation from the height delta
  for a few frames (the virtualizer remeasures rows over several frames), then exact
  correction against the anchor row's DOM offset. Anchor-only fails because right after
  a prepend the anchor row is outside the rendered window and has no DOM node.
- **Never put a percentage `max-width` on the bubble itself** — on a flex child it
  resolves against the content size and collapses to min-content. It lives on
  `.wx-message-stack`.
- **`titleBarOverlay` buttons are painted above web content**, so the title bar must
  reserve space with `padding-right: calc(16px + (100% - env(titlebar-area-x, 0px) -
  env(titlebar-area-width, 100%)))`. A fixed spacer only pushes content into the buttons.
  The overlay colour also has to be repainted from the main process on theme change.
  **Whatever sits under the controls must use `--wx-bg-list`** (the colour
  `applyTitleBarTheme` sends) or the bitmap shows a seam — that is why the login screen
  (`wx-login::before`) got a 60 px strip of its own. The overlay covers only the
  right-hand control area, not the whole 60 px strip, so the strip keeps the rest of the
  window looking consistent.
- **`node:sqlite` exists in Electron 38** (bundled Node 22.22) — no better-sqlite3, no
  Electron-ABI rebuild. It is flagged experimental upstream, hence the single-file
  confinement. Expect an `ExperimentalWarning` in the log.
- **`sender_id` has two shapes.** It is `messageSenderUser { user_id }` **or**
  `messageSenderChat { chat_id }`; channel posts and anonymous admins only fill
  `chat_id`. Reading `user_id` alone left those at `未知`. `Message` now carries an
  optional `senderChatId`, `senderName` falls back to the chat title, and the adapter
  caches titles (`chatTitles`, filled from `mapChat` and `updateChatTitle`) next to
  `userNames`. Measured on the real account: 20/20 messages in a channel use
  `messageSenderChat` (`senderChat` line in `tdlib:smoke`).
- **Restoring a reading position needs all three pieces.** (a) the list must not mount
  before the stored anchor is known — a cached chat otherwise captures the bottom as its
  position; (b) `scrollToIndex` is only an estimate with dynamic row heights, so the
  position is corrected against the anchor row's DOM node, the same way prepends are;
  (c) `unpin()` must be called before restoring or the stick-to-bottom `ResizeObserver`
  undoes it. The anchor is "first visible slot + its offset", and *no row at all* (a
  null anchor) means "was at the bottom".
- **Real unread counts are large** (hundreds of thousands on unfollowed groups); that
  is data, not a mapping bug.
- `userData` is pinned to `%APPDATA%\WechatGram` via `app.setName`/`setPath`, because
  the package name is `@wechatgram/desktop` and would otherwise create a nested folder.

## Decisions already locked (design doc §15)

Single account in v1 (multi-account is v2; session dir already shaped
`tdlib/<accountId>/`), animated stickers in v1 (WebP + TGS + WebM), Electron (Tauri only
if bundle size becomes a real pain), built-in SOCKS5 + MTProxy with a connectivity test,
5-week schedule instead of 4.

## Known gaps / suggested next steps

1. ~~**Unverified:** the dark-mode window-controls overlay~~ — **verified** (Electron 38,
   `-NoSandbox -Mock`, mock login `+8613800000000` / `12345` / `wechatgram`). Measured
   pixels: light title bar `#F7F7F7` with `#171717` glyphs, dark title bar `#1A1A1A`
   (JPEG of `#191919`) with `#E4E4E4` glyphs, overlay strip identical to the title bar in
   both themes, and a dark profile restarts dark from `ready-to-show`. Fixing the
   comparison exposed a real gap: the login screen has no title bar, so the controls sat
   on `#111111`/`#EDEDED` — about 8/255 off the overlay colour, a faint but visible
   rectangle in the corner. `.wx-login::before` now paints a 60 px `--wx-bg-list` strip
   with a divider (same as the shell), which also gives the login window its **only drag
   region** (it could not be moved before logging in).
2. ~~**`ui.db` scroll-anchor wiring**~~ — **done** with the decided UX ("restore only when
   the reader was not at the bottom"):
   - `MessageList` measures the first visible `.wx-message-slot` (id + offset relative to
     the viewport top, which may be negative) after a 250 ms scroll debounce and on
     unmount, and sends `ui:saveAnchor`. At the bottom (≤ 40 px) it sends
     `messageId: null`, which is what makes a reopen land on the newest message.
   - `ChatPane` resolves `ui:getAnchor` **before** mounting the list (a cached chat would
     otherwise capture its position at the bottom and miss the restore), pages back up to
     6 pages / 10 s until the anchor message is loaded, and passes it down as
     `initialAnchor`.
   - `MessageList` restores with `scrollToIndex` + correction against the anchor row's DOM
     node (the virtualizer only estimates row heights), then reveals itself.
   Verified with the mock adapter (Electron, `-NoSandbox -Mock`): chat switch restores the
   exact row, a full app restart restores it from `ui.db`, a seeded deep anchor (#4771,
   4 pages behind) paged back automatically, and scrolling to the bottom cleared the row
   (`scroll_anchor_id = NULL`).
   Limitation worth knowing: an anchor further back than that budget is unreachable
   (history is fetched by paging, not from an anchor), so the chat opens at the bottom and
   the anchor is dropped. Fixing that properly needs a "load around message" fetch, which
   is a W3 jump-to-message feature.
3. **W3 scope**: media send/receive (files, images, progress events), sticker renderer
   (WebP `<img>`, TGS → `DecompressionStream` + lottie-web, WebM `<video>`), search
   (global + in-chat), day separators, unread divider, sticker panel.
4. ~~**Channel posts show senderName `未知`**~~ — **done**: `senderChatId` in the DTO,
   `mapMessage` resolves `messageSenderChat` through the chat-title cache, verified on
   the real account by the `senderChat` line of `tdlib:smoke`. Mock + preview fixtures
   grew a channel-post example (chat 5, message 502).
5. **Packaging has never been produced**: `electron-builder` config exists
   (`asarUnpack` for `@prebuilt-tdlib`/`prebuilt-tdlib`), but NSIS build + auto-update +
   sandbox-on-clean-machine are all unverified.
6. Minor: the preload bundle is 187 kB because it imports the protocol index (zod). If it
   matters, split a channels-only entry point.
7. Minor: `tdlib:smoke` only checks the *first* channel of the chat list for
   `messageSenderChat`; groups with anonymous admins are not covered by a fixture.
8. Minor: the login strip is a fixed 60 px (`--wx-titlebar-h`), so the browser preview
   (`pnpm web`) shows an empty strip above the login card too. Detecting the real overlay
   would need `env(titlebar-area-height)`; not worth it while the strip stays harmless.

## Open questions for the product owner

- W3 order: media first or search first?
- Scroll-position restore: WeChat restores where you left; do we follow that or always
  land at the bottom?
- Multi-account stays v2 — confirm nothing in W3 needs it.

## Session leftovers

All processes started during the session (Electron windows, wrapper consoles, the Vite
preview server) were closed, and the test `%APPDATA%\WechatGram` profile was removed. The
`.cache/` folder keeps logs and is gitignored.

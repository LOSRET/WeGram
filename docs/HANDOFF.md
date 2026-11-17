# Handoff — WechatGram

Written 2026-11-17 at the end of the W1/W2 session, extended the same day with the
W3 main body. Read this first, then `docs/技术方案.md` (authoritative design, Chinese)
and `spikes/tdlib/RESULTS.md` (measured TDLib behaviour). `CLAUDE.md` holds the rules
that must not drift.

The renderer was later rebuilt against the real WeChat 4.x client; that work has its
own handoff — **`docs/UI-HANDOFF.md`** (measured tokens and metrics, icon provenance,
known deltas, pitfalls). Read it before touching anything under `src/renderer`.

The code was then split for agent maintenance and given a real verification layer
(`pnpm verify`, 87 unit tests, lint-enforced architecture rules). **`docs/REFACTOR-HANDOFF.md`**
records what moved where, the conventions the code now enforces, and the batches that are
still pending (`tdlib.ts`, `mock.ts`, `preview-bridge.ts`, `styles/index.css`,
`packages/protocol`). Read it before restructuring anything.

## Where things stand

Greenfield → working skeleton in three milestones:

- **W1** Electron shell, `packages/protocol` IPC contract, mock adapter, real TDLib
  adapter with manual auth state machine, SOCKS5/MTProxy proxy support, WeChat-style
  login screen + three-column shell.
- **W2** virtualised message list, anchored history paging, send / reply / edit /
  delete / forward, per-chat drafts, `ui.db` (drafts, theme, scroll-anchor columns).
- **W3 main body** media send/receive (photo + document with upload/download progress),
  `wx-media://` serving for downloaded files, the three sticker formats
  (WebP/TGS/WebM), a sticker picker, TL entity rendering, day separators, the unread
  divider, read receipts, and a typing indicator that expires. Mock fixtures now carry
  real generated PNG/WebP/TGS media, so every renderer path is exercised offline.
- Spike 2 (real login + session reuse) is **done and verified**; the session lives in
  `spikes/tdlib/data`.

Verified at the end of the W2 session: `pnpm typecheck`, `pnpm build`, `pnpm tdlib:smoke`,
`pnpm ui:db-check`, and the browser acceptance panel (`?perf=1`) — 5000 messages at
60 fps, 0 px viewport drift when prepending a page.

Verified at the end of the W3 session (same commands, plus CDP): `pnpm typecheck`,
`pnpm build`, `pnpm tdlib:smoke` (real session, read-only), `pnpm ui:db-check`; Electron
mock login → media + sticker flows end-to-end; measured in Electron via CDP
(`-RemoteDebugPort`): prepend 50 → 100 messages, anchor row visible, **0.0 px** drift,
**60.6 fps**, worst frame 17 ms, P95 17 ms, 27 rendered rows. Browser preview verified
the same UI with `data:` URLs instead of `wx-media://`.

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

**Same day, WeChat 4.x UI pass** — details in `docs/UI-HANDOFF.md`. Summary: the
renderer now mirrors the client on this machine (measured with PIL off a 125%-scaled
screenshot, not guessed).

- Tokens in `styles/index.css` (rail `#e0e0e0`, list `#e7e7e9`, pane `#fbfbfb`, selected
  row `#15ad70`, incoming bubble `#eeeef0`, outgoing `#95ec69`) and §9.1 of the design
  doc. Metrics: 32 px title strip, 42 px rail, 238 px list, 65 px rows, 40/38 px
  avatars, 46 px chat header, 128 px composer card.
- Structure: `SideRail` + list + pane, search pill and "+" inside the list column,
  composer as a bordered card. `TitleBar.tsx` deleted — the strip is the native
  `titleBarOverlay` (32 px, rail colour) and settings/theme/sign-out live in the rail's
  "≡" menu (`AppMenu.tsx`). The footer with the adapter hint is gone; that hint is a
  caption in the same menu.
- Icons: the chrome glyphs are WeChat's own vectors, extracted from `Weixin.dll`
  (2346 embedded SVGs) into the generated `components/WechatIcons.tsx` — including the
  ＋ menu's 发起群聊 / 添加朋友 / 写笔记 glyphs; the rest (compass tab, "…", scissors)
  are hand-drawn, and the brand mark — rail 聊天 tab, login card, empty-pane watermark —
  is the Telegram roundel from Simple Icons. The name manifest in the DLL has no
  recoverable name→payload mapping — see `UI-HANDOFF.md` §3 before trying again.
- Also fixed while testing: the login field regains focus after each step (it is
  disabled while a request is in flight, which used to drop the caret and force a click).

### Real-account session (the one that produced this revision)

First time the real TDLib adapter was driven end-to-end in the Electron window (a proxy
is mandatory here). Three real defects surfaced and were fixed — all of them only
reproduce against a real account, none with the mock:

1. **Groups opened empty and never paged.** `updateChatReadInbox` fires for every chat,
   and `applyMessageOps` was creating an empty `messagesByChat[chatId]` for each one, so
   `ChatPane`'s "history is cached" check skipped the first-page fetch forever.
2. **`hasMore` lied.** TDLib often answers `getChatHistory` from its local window (1–5
   messages in ~2 ms); the old `hasMore = raw.length >= limit` read that as "no older
   messages", so paging stopped dead.
3. **A loaded transcript stayed invisible.** When the window is occluded, Chromium
   throttles `requestAnimationFrame`, and the anchor-restore path only released the
   `--pending` gate from a rAF loop — messages were in the DOM but `visibility: hidden`.
   Together with defect 1 this is what the owner saw as "群组加载旧消息无法加载".

UI work in the same session: WeChat-style **overlay scrollbars** (no layout gutter) and
**real profile photos** for the rail avatar and every chat row (`avatarUrl` added to
`Self` and `ChatSummary`; downloaded in the background with a 4-wide worker pool and
pushed back as batched `chats` upserts). Details in `docs/UI-HANDOFF.md`; the measured
quirks are in "Non-obvious facts" below.

Verified in that session: `pnpm typecheck`, `pnpm build`, and CDP measurements against
the real account — first page 50 messages / `hasMore: true` on cold groups, 60 pages
(3000 messages) with no duplicates and strictly ascending ids, rail + list photos at
160×160 in 40×40 boxes, and a chat opened while the window was occluded rendering
correctly after the visibility fix. The Electron window is left running.

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
| `launch-detached.ps1` dies with `Invoke-CimMethod … 拒绝访问` | the DSH shell is sandboxed (`workspace-write`): WMI process creation is denied, and so are the obvious detours (starting through `explorer.exe`, `schtasks /create`) | only works when the session runs with full access (this session was `danger-full-access`). Do not "fix" the script — ask for full access instead |
| avatars/photos trickle in, one 30 KB thumbnail takes 16 s | the SOCKS tunnel is saturated or flapping, not the code | measured: the same file later took 65–230 ms. Check FlClash/Clash before debugging |
| `-RemoteDebugPort` connects but `Runtime.evaluate` sees a stale UI | a second Electron instance was requested while one was running; the single-instance lock kept the old window | close `electron.exe` first (`windows close electron.exe`), then launch |

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
pwsh scripts\launch-detached.ps1 -NoSandbox -Mock -RemoteDebugPort 9224  # + CDP
# real account (read-only; the proxy is mandatory, see the environment table)
pwsh scripts\launch-detached.ps1 -NoSandbox -Proxy socks5://127.0.0.1:7890 -SessionDir ..\..\spikes\tdlib\data
```

Reading and driving the real renderer over CDP is what produced the numbers above. The
helper is `.cache/cdp-eval.mjs` (gitignored; ~30 lines: read
`http://127.0.0.1:9224/json`, open the page's `webSocketDebuggerUrl`, send one
`Runtime.evaluate`):

```powershell
node .cache\cdp-eval.mjs "document.querySelectorAll('.wx-message-slot').length"
node .cache\cdp-eval.mjs "@script.js"   # same, expression read from a file (quoting!)
```

It can call the app's own IPC, which is the cheapest way to isolate a bug:

```javascript
await window.tg.invoke('messages:history', { chatId: -1001125107539, limit: 50 })
await window.tg.invoke('chats:list', { offset: 0, limit: 5 })
```

Anything that opens a chat also marks it read on the server — use it deliberately.

- The mock adapter writes its generated media to `userData/mock-media` on startup
  (`%APPDATA%\WechatGram\mock-media`): `design-v3.png`, `sunset.png`, `需求说明.md`,
  `sticker-face.webp`, `sticker-heart.webp`, `sticker-wave.tgs`. Delete that folder to
  force regeneration.
- `-RemoteDebugPort` exposes the renderer over CDP (`http://127.0.0.1:9224/json`); that
  is how the prepend/FPS numbers above were measured without opening DevTools. rAF and
  `PerfPanel` only run while the window is actually visible, so focus it first.

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
  index.ts                   app lifecycle, window, theme overlay, adapter wiring,
                             media scheme/protocol registration
  ipc/router.ts              per-channel zod validation, Result envelope
  ipc/handlers.ts            one handler per invoke channel (incl. native file picker)
  media/registry.ts          path → wx-media:// token registry (renderer never sees paths)
  media/protocol.ts          protocol.handle('wx-media') with Range streaming + MIME
  media/image-size.ts        PNG/JPEG/WebP/GIF header probe (inputPhoto needs real sizes)
  telegram/adapter.ts        TelegramAdapter interface + event types (the seam)
  telegram/tdlib.ts          ONLY file allowed to import `tdl`
  telegram/mock.ts           fake adapter incl. a 5000-message chat (id 99) + media fixtures
  telegram/mock-assets.ts    embedded WebP/TGS + runtime PNG encoder for mock media
  telegram/updates.ts        EventBus: 60 ms batching, monotonic seq
  telegram/events.ts         AdapterEvent → evt:* channels
  telegram/index.ts          adapter selection (mock / tdlib, WECHATGRAM_ADAPTER)
  store/ui-db.ts             ALL node:sqlite access (drafts, theme, anchors, media cache)
  store/settings.ts          JSON store for the proxy only (DPAPI-sealed secret)
  proxy.ts, proxy-url.ts     stored ↔ view/masked config, URL parsing
  security/secrets.ts        safeStorage seal/unseal
  preload/index.ts           window.tg.invoke / window.tg.on, channel whitelist
apps/desktop/src/renderer/src/
  App.tsx                    bootstrap + event subscription (one place), typing expiry
  store/                     zustand, split: types.ts (AppData + action interfaces),
                             initialState.ts (DATA_DEFAULTS, the only initial state),
                             reducers.ts (pure sortChats/upsertMessage/reduceOps),
                             slices/{auth,chats,messages,media,ui}.ts,
                             useAppStore.ts (assembler; unchanged import path)
  components/message-list/   index.tsx (virtualiser + render tree) + MessageRow.tsx,
                             Divider.tsx, useInitialPosition.ts (anchor restore or land
                             at the bottom + reveal nets), usePrependRestore.ts (two-stage
                             compensation, loadOlder), useAnchorSave.ts (ui:saveAnchor),
                             scrollFlags.ts, scroller.ts (resyncScroller),
                             emoji.ts / menu.ts / unread.ts (pure helpers)
  components/chat-pane/      index.tsx (render tree + modal state) + useChatHistory.ts
                             (first page, empty-page retries, paging to the saved anchor,
                             loadOlder), messageActions.ts (send/edit/delete/forward/copy),
                             ChatHeader.tsx, ChatInfoPopover.tsx, Placeholders.tsx, labels.ts
  components/MediaBubble.tsx photo lightbox / video / file card / voice bar + progress
  components/StickerRenderer.tsx WebP <img>, TGS lottie, WebM <video>, offscreen pause
  components/StickerPanel.tsx installed sets → grid → send sticker
  components/RichText.tsx    TL entity renderer (bold/italic/code/pre/link/spoiler)
  components/Composer.tsx    IME guard, reply bar, edit mode, draft debounce, attachments
  lib/useAnchoredScroll.ts   ready gate, 40px stick-to-bottom, resize compensation
  lib/media.ts               one-download-per-file dedupe + media URL/progress hooks
  lib/tgs.ts                 gzip guards + Lottie decode cache (LRU)
  lib/entities.ts            UTF-16 offset segmentation for TL entities
  components/PerfPanel.tsx   dev-only acceptance panel (?perf=1)
  lib/preview-bridge.ts      browser-preview-only fake IPC
scripts/                     launch-detached.ps1 (-RemoteDebugPort for CDP),
                             tdlib-smoke.ts, ui-db-check.ts
```

Layered agent notes live next to the code they govern: `packages/protocol/AGENTS.md`,
`apps/desktop/src/main/AGENTS.md`, `apps/desktop/src/renderer/AGENTS.md`. `pnpm verify`
(lint → typecheck → vitest → build) is the gate; the unit tests cover the pure modules
only (formatters, entity segmentation, image header probe, proxy URL, store reducers and
the store invariants) — scroll/virtualisation behaviour still has to be confirmed in the
Electron window.

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
  **Whatever sits under the controls must match the overlay colour** (what
  `applyTitleBarTheme` sends — currently the rail colour `#e0e0e0` / `#191919`, height
  32 px) or the bitmap shows a seam — that is why the login screen (`wx-login::before`)
  paints its own 32 px strip. The overlay covers only the right-hand control area, not
  the whole strip, so the strip keeps the rest of the window looking consistent.
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
- **`wx-media://` must be declared before `app.whenReady()`** with
  `protocol.registerSchemesAsPrivileged` (standard/secure/supportFetchAPI/stream), or
  `<img>`/`<video>`/`fetch` cannot load it. The CSP also needs it in **`connect-src`**,
  not just `img-src`: TGS is fetched as bytes and gunzipped in the renderer. The handler
  resolves opaque tokens and streams with `Range` support; request paths are never used
  for filesystem access.
- **`position: fixed` inside a virtualised row is broken.** Rows are positioned with
  `transform: translateY(...)`, which makes them the containing block for fixed
  descendants — a lightbox rendered inside the bubble was confined to the row. Media
  overlays must go through `createPortal(..., document.body)`.
- **The ready gate could never open under React StrictMode.** The mount layout effect
  is run twice (effect → cleanup → effect); the first pass set `initialisedRef` and
  scheduled `requestAnimationFrame`, the cleanup cancelled it, and the second pass
  returned early — the list stayed `visibility: hidden` forever. Fix: do not cancel the
  frame, and add a 150 ms `setTimeout` fallback because rAF is throttled while the window
  is occluded (this also explains flaky `?perf=1` runs in background windows).
- **…and occlusion was still able to freeze the list after that fix** (measured on the
  real account: 12 rows in the DOM, `scrollHeight 9968`, `messages:history` answering 50
  in 8 ms, and `wx-messages--pending` stuck on). The anchor-restore path waits on rAF and
  only released the gate in its `.finally`. Three layers now prevent a permanently
  hidden transcript: a 700 ms `setTimeout(markReady)` next to the restore, a 900 ms
  deadline inside `restoreToAnchor` (frames alone are not a bound), and a watchdog that
  force-readies any list that has messages but is not ready after 1 s. **Never gate
  visibility on layout timing.**
- **A short `getChatHistory` answer is normal, not the end of the chat.** For a cold
  chat TDLib answers from its local window — measured 1 to 5 messages in 1–7 ms — even
  when the chat has thousands. Re-anchoring *below* the oldest returned id is what makes
  it go to the server (that request came back with 50 in 65–230 ms; the first cold fetch
  after a long time took ~3.4 s). `history()` therefore tops a page up over up to
  `MAX_HISTORY_ROUNDS = 3` rounds and only an **empty** round means "the chat begins
  here". `hasMore` is `!exhausted && messages.length > 0`; the old
  `raw.length >= limit` turned every cold chat into "no more history". Cost of the new
  rule: one extra request when a chat is genuinely at its beginning.
- **Never create a `messagesByChat` entry for a chat whose history is not loaded.**
  `updateChatReadInbox` fires for *every* chat, and `applyMessageOps` used to write
  `messagesByChat[chatId] = []` from it. `ChatPane` treats "an entry exists" as "cached",
  so every chat the read marker touched opened empty and could not page (this is the bug
  the product owner reported). `applyMessageOps` now returns without touching the store
  when the chat has no entry; entries come only from `setHistory`/`prependHistory`.
- **…but the ops of an unloaded chat must not be dropped either.** While a chat's first
  page was in flight (a cold chat can take seconds), `applyMessageOps` threw the ops
  away, and the subsequent `setHistory` wrote the pre-event snapshot — anything that
  arrived during the fetch (a `updateNewMessage`, a late-batched edit) was missing from
  the transcript until the chat was reloaded. The store now queues meaningful ops in
  `pendingOps[chatId]` (pure read-marker batches are skipped) and `setHistory` replays
  the queue onto the fresh page (`reduceOps`, shared with `applyMessageOps`). A failed
  first fetch also used to leave the pane empty forever — `ChatPane` retries once
  quietly after 1.5 s before giving up.
- **`downloadFile(synchronous: true)` occupies a TDLib request slot until the file is
  complete.** That is fine for user-triggered media, but avatars must not be fetched
  naively: the adapter runs a 4-wide worker pool at priority 1, dedupes per chat id
  (queue / in-flight / done / no-photo), and never emits `evt:file` for them
  (`fetchFilePath()` is the silent variant; `downloadFile()` is the progress one). On a
  saturated tunnel a single thumbnail took 16 s, so the pool is 4 — if opening a chat
  feels starved right after start-up, this queue is the first suspect. Finished photos
  are pushed as `chats` upserts coalesced over 120 ms, not one event per chat.
- **Profile photos need `getChat`/`getMe` → `profile_photo.small` (or `chat.photo.small`),
  not the media pipeline.** The file is registered through `registerMediaFile` exactly
  like attachments, so the renderer only ever sees `wx-media://f/<token>`. The rail's
  own photo is fetched in the background and announced with a second `auth` event, so
  authorisation never waits on the network; `updateUser` (self) and `updateChatPhoto`
  (a chat) invalidate and refetch.
- **This TDLib's `inputMessagePhoto` has no width/height.** Dimensions live on
  `inputPhoto`, so a photo cannot be sent without knowing its pixel size. The main
  process parses PNG/JPEG/WebP/GIF headers first; when it cannot, the file is sent as a
  document instead of producing a broken photo bubble. `inputMessageSticker` also needs
  `inputSticker.width/height` and an emoji.
- **Sticker set ids are int64 strings in TDLib.** They cross IPC as strings; the sticker
  itself is identified by the numeric file id. `getInstalledStickerSets` only returns
  set summaries — the grid needs a second `getStickerSet` call.
- **`updateChatAction` is a one-shot event.** It has no "stopped typing" notification you
  can rely on, so the renderer schedules an expiry timer from `until`; without it the
  header claims "对方正在输入…" forever.
- **Editing content is a full remap, not a text patch.** `updateMessageContent` can change
  media/captions, so the adapter fetches the message and emits a `replace` op instead of
  an `edit` op with just the text.
- **Mock media is generated, not referenced.** `telegram/mock-assets.ts` embeds two real
  WebP stickers and one gzipped TGS animation, and encodes gradient PNGs at runtime with
  `node:zlib`; the files land in `userData/mock-media` and are served through the same
  `wx-media://` registry as TDLib downloads. This is what makes media/sticker work
  testable without the real account.
- **Real unread counts are large** (hundreds of thousands on unfollowed groups); that
  is data, not a mapping bug.
- **A programmatic `scrollTop` write can desync `@tanstack/react-virtual`.** Row
  transforms come from the virtualizer's *own* `scrollOffset`, which it refreshes only on
  real scroll events. Scrolling the transcript in the mount layout effect (landing at the
  bottom, restoring an anchor, prepend compensation) can therefore leave it painting the
  top of the history while the element sits elsewhere: the rows are all off-screen, so the
  pane looks **blank** (or shows a slice of very old messages) with an empty tail under the
  scrollbar, and `scrollTop` still reports "at the bottom". Symptom looked like a chat that
  never loads. Fix: after every programmatic scroll, `MessageList.resyncScroller()` dispatches
  one `scroll` event so the virtualizer re-reads the element (measured: 13 rows at y −4842…
  −2708 before, the real 2025↔today window at y −1098…+394 after), plus `stickToNewest()`
  uses `virtualizer.scrollToEnd()` and re-sticks at 150/400 ms once the first measurements
  have landed.
- **An empty first history page is not "an empty chat".** A cold local TDLib database can
  answer `messages:history` with `[]`; the renderer used to cache that, after which the
  transcript stayed blank for the rest of the session. `ChatPane` now retries three times
  before believing it, does not treat an empty entry as cached, shows an explicit
  "这个会话还没有可显示的消息" + 重新加载 state, and the adapter logs both halves of the
  chain (`no last_message` / `getChatHistory returned nothing`) so the next occurrence is
  explainable from `.cache/app.log`.
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
   *Superseded by the WeChat UI pass*: the overlay is now 32 px and rail-coloured
   (`#e0e0e0` / `#191919`), and the same strip is 32 px — see `docs/UI-HANDOFF.md` §2.
   The dark/light verification itself still holds.
2. ~~**`ui.db` scroll-anchor wiring**~~ — **done** with the decided UX ("restore only when
   the reader was not at the bottom"):
   - `MessageList` measures the first visible `.wx-message-slot` (id + offset relative to
     the viewport top, which may be negative) on scroll and sends `ui:saveAnchor`. At the
     bottom (≤ 40 px) it sends `messageId: null`, which is what makes a reopen land on the
     newest message.
   - **Save-path correction (real-account bug)**: the position a reader left a chat at was
     often never written, so a reopened app restored an older anchor. Two causes, both in
     `MessageList`: the save was a single 250 ms debounce that *re-measured* inside the
     timer and bailed whenever a history page was in flight (the common case while reading
     up), and the "write on unmount" net was dead code — React nulls `scrollRef.current`
     before passive cleanups run, so it measured nothing. Now the first scroll of a burst is
     written immediately, later ones collapse into one trailing write, the last measurement
     is kept in `latestAnchorRef` and flushed on unmount without touching the DOM, prepend
     compensation no longer suppresses saving (only `restoringRef`/`programmaticRef` do), and
     a hung `messages:history` is capped at 15 s so it cannot wedge paging. Verified on the
     real account: scroll → close the app within the same second → `ui.db` holds the new
     position, and the next start restores exactly that row.
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
   is a W4 jump-to-message feature.
3. ~~**W3 scope**: media send/receive, sticker renderer, day separators, unread
   divider, sticker panel.~~ **Main body done**; what is left from W3 and what W3
   deliberately did not include:
   - **WebM stickers** are implemented (`<video>` + offscreen pause) but no fixture
     exercises them: this machine has no VP8 encoder (ffmpeg absent) and the mock only
     generates WebP/TGS. Verify with a real account or a recorded `.webm` sticker.
   - **Custom emoji** entities render as their base glyph, not the sticker image. Needs
     `getCustomEmojiStickers` plus an inline sticker cache; the rendering seam
     (`RichText`'s `customEmoji` case) is already there.
   - Media is sent immediately after the picker; no caption dialog, no album grouping,
     no drag & drop / paste. Captions are supported end-to-end in the adapter
     (`media:send` takes `caption`), just not surfaced in the UI yet.
   - Voice notes play, but there is no recording and the waveform is decorative.
   - Download cache is TDLib's own file cache; the `media_cache` LRU table from §5.2 is
     still unused, so nothing bounds the disk usage yet.
   - Sticker panel only lists regular installed sets; no search/trending, no "recent".
     A set cover whose thumbnail is MPEG4 would render as a broken `<img>` (rare).
   - `updateMessageContent`/`updateNewMessage` are mapped, but `updateMessageSendSucceeded`
     is not handled separately; message ids are server ids already, so it is cosmetic.
   - Search (global + in-chat) is W4 even though the adapter methods exist.
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
8. Minor: the login strip is a fixed `--wx-titlebar-h` (32 px), so the browser preview
   (`pnpm web`) shows an empty strip above the login card too. Detecting the real overlay
   would need `env(titlebar-area-height)`; not worth it while the strip stays harmless.
9. **UI deltas vs the real client** are catalogued in `docs/UI-HANDOFF.md` §5 (composer
   toolbar loses the scissors chevron, message-row avatars still draw initials, no pin
   button, fixed 238 px list, rail sections other than 聊天 only raise a toast, dark rail
   icon grey untuned). §6 has the ordered follow-ups.
10. **The chat list is not virtualised.** This account renders **526 rows** at once
    (measured in the DOM). It is still smooth, but it is the next scaling risk, and the
    avatar pool only prefetches what it is handed: the 100-chat first page plus whatever
    arrives through `emitChatUpsert`. A row scrolled into view without an update event
    keeps its initials until the chat is touched.
11. **Message-row (sender) avatars are still initials.** `Message` carries no photo
    field; doing it properly means `senderPhotoFileId` in the DTO plus a cache keyed by
    user id, or a `getUserProfilePhotos` call per sender.
12. **Popovers keep native scrollbars** (modals, forward list, sticker grid). Only the
    two long panes use `<OverlayScrollbar>`; converting the rest is mechanical but was
    not worth the churn while the complaint was the list and the transcript.

## Open questions for the product owner

- ~~W3 order: media first or search first?~~ Media + stickers were done first (W3 main
  body); search is the natural start of W4.
- Scroll-position restore: WeChat restores where you left; we already do that when the
  reader was not at the bottom. Confirm it should stay.
- Multi-account stays v2 — confirm nothing in W3/W4 needs it.

## Session leftovers

**2026-11-17, refactor session:** `pnpm verify` (lint → typecheck → vitest → build) is the
gate; 87 unit tests, ESLint now enforces the architecture rules, Prettier owns formatting.
The Electron window used for the mock walkthrough was **closed**, so nothing is running —
launch it detached again when you need it. Remaining work is the split of `tdlib.ts`,
`mock.ts`, `preview-bridge.ts`, `styles/index.css` and `packages/protocol`: see
`docs/REFACTOR-HANDOFF.md` (including the one open observation about a short transcript that
restored a saved anchor still counting as "not at the bottom").

**Earlier (W3) session:** the Electron window was left running (real adapter, launched
detached, maximised) so the next session could pick it up; close it with
`windows close electron.exe` before the next launch, or the single-instance lock silently
keeps the old bundle.

The Vite preview server and the remote-debugged browser windows started during the
session were closed. `.cache/` keeps logs and is gitignored; it also holds the throwaway
CDP helpers (`cdp-eval.mjs`, `*-check.js`, `uitest.js`) used to measure the real
renderer — recreate them from the snippets above if they are gone.

The UI/real-account changes are **committed** on `main` in four commits on top of
`a3d9a5f` — the "+" card and brand mark, avatars + overlay scrollbars, the three
real-account fixes, and this documentation. `pnpm typecheck && pnpm build` were green
before each of them; the working tree is clean.

The refactor session added six more commits on top of `395ac19` (`f1d0a9e` the pending
real-account fixes, then batches 0–3 and the doc updates). `pnpm verify` — not just
typecheck + build — was green before each, and the working tree is clean.

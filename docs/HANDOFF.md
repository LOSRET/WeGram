# Handoff — WeGram

**One document, consolidated 2026-11-23.** It absorbs the four earlier handoffs —
`docs/HANDOFF.md` (project state + measured pitfalls), `docs/UI-HANDOFF.md` (the
WeChat 4.x contract), `docs/PRIVATE-CHAT-HANDOFF.md` (the 1:1 gap audit, kept here as a
status + API map) and `docs/REFACTOR-HANDOFF.md` (the split). Duplicated narration was
dropped; every measured number, hard rule, API and open gap is kept. The originals remain in
git history — `git log --diff-filter=D -- docs/` finds them.

Companions this document does **not** replace:

- `docs/技术方案.md` — authoritative design (Chinese). Change the design there first, then
  the code.
- `spikes/tdlib/RESULTS.md` — the raw TDLib spike measurements and packaging constraints.
- `CLAUDE.md` (root; `AGENTS.md` is a symlink to it) — the coding rules and the split
  rules. Read it before writing code.
- Layer notes, short and specific, win for their subtree: `packages/protocol/AGENTS.md`,
  `apps/desktop/src/main/AGENTS.md`, `apps/desktop/src/renderer/AGENTS.md`.

## Contents

- [0. How to use this document](#0-how-to-use-this-document)
- [1. Status at a glance](#1-status-at-a-glance)
- [2. Hard rules](#2-hard-rules)
- [3. Environment, commands, verification](#3-environment-commands-verification)
- [4. Architecture map](#4-architecture-map)
- [5. The measured WeChat 4.x UI contract](#5-the-measured-wechat-4x-ui-contract)
- [6. Measured behaviour and pitfalls — do not re-derive](#6-measured-behaviour-and-pitfalls--do-not-re-derive)
- [7. Private chat (1:1): gap audit, API map, status](#7-private-chat-11-gap-audit-api-map-status)
- [8. Code organisation: the split and what it enforces](#8-code-organisation-the-split-and-what-it-enforces)
- [9. Known gaps and next steps](#9-known-gaps-and-next-steps)
- [Appendix A — TDLib 1.8.70 signatures cited here](#appendix-a--tdlib-1870-signatures-cited-here)
- [Appendix B — dated history (what shipped when)](#appendix-b--dated-history-what-shipped-when)

---

## 0. How to use this document

| You are about to… | Read this first |
|---|---|
| start any session | §1 (state), §2 (rules), §3 (how to run/verify) |
| touch `src/renderer` or judge a visual | §5 (tokens, metrics, deltas) and §6 (pitfalls) |
| touch the TDLib adapter or paging | §6 (every entry was measured against a real account) |
| implement a private-chat gap | §7 (API map + status) then §8 (layering recipe) |
| split / move files | §8 and the "Agent-maintainable code" rules in `CLAUDE.md` |
| report work as done | `pnpm verify` green; say exactly what you ran and what you skipped |

The rule that matters most in this repo: **only what `pnpm verify` proves counts as done**,
and anything that writes to Telegram is unproven until it ran on a test DC (§3.4).

---

## 1. Status at a glance

pnpm workspace, W1 + W2 + the W3 main body implemented, plus the private-chat P0/P1 batches.

- `packages/protocol` — IPC contract (zod DTOs, channel tables, `AppError`), the single
  source of truth shared by main, preload and renderer; exported straight from source.
- `packages/adapter-contract` — the `TelegramAdapter` seam (`adapter.ts`) shared by the
  TDLib adapter and the fake one.
- `packages/mock-adapter` — the fake `TelegramAdapter` with generated PNG/WebP/TGS/WebM/WAV
  fixtures; development only.
- `packages/mock-session` — the fake session's pure rules (paging, read marker, comment
  access, chat-list order), bundled into the renderer for the preview. Imports nothing.
- `packages/mock-fixtures` — the demo account both fakes serve; each side injects its media
  and clock.
- `apps/desktop` — Electron 45 + React 19 + Tailwind v4: `src/main` (adapter, IPC, store,
  media protocol), `src/preload` (`window.tg`), `src/renderer` (the UI).
- `spikes/tdlib` — measured TDLib behaviour; `RESULTS.md` holds build-time packaging
  constraints.

### 1.1 Shipped

| Area | State |
|---|---|
| Shell | WeChat 4.x three-column shell (native 32 px `titleBarOverlay`), rail with four real sections, 通讯录, 收藏/朋友圈 placeholders, overlay scrollbars on both long panes, 设置 as its own window |
| Chat list | virtualised 65 px rows (sizer + overscan 8), **paged on approach** (100-row slices, `mergeChats` by id) and **on-demand row photos** (`chats:prefetchAvatars` for the visible window), search pill → global search, chat right-click menu (置顶/免打扰/标为未读/删除聊天), unread dot, 已归档会话 row + archive page |
| Transcript | virtualised list, anchored prepend, load-around anchors, day/unread separators, real sender photos, read receipts, typing + presence, reply/edit/delete/forward, polls, comments bar, channel post composition, pinned bar, reaction chips |
| Media | photo/document send+receive with progress, `wx-media://` Range streaming (including a file TDLib is still downloading), viewer window for photos **and** videos, 表情 panel, 贴纸包盒子, album send, caption edit |
| Stickers / emoji | WebP `<img>`, TGS → lottie-web (transcript) or one ThorVG canvas (grids), WebM `<video>`, animated-emoji messages (no bubble, one pass, click sound), premium sticker effects, custom emoji entities, Apple emoji as a CBDT colour font |
| Polls | `PollBubble` + `lib/poll.ts`, `messages:vote` / `messages:addPollOption`, option order vs position |
| Login | own frameless 280×373 window: TDLib QR (local `qrcode`), 用手机号登录 fallback via `auth:reset`, profile step only for a restored session |
| 通讯录 | TDLib address book (`getContacts` + `getUser`), pinyin initials via ICU, contact card with 备注/DC/phone, 发消息 creates the private chat |
| Comments | 评论 N 条 handle on channel posts, Telegram discussion view panel (paged, anchored, joins to send), the full composer card as its input |
| 聊天信息 | overlaying 314 px sheet: private/group/channel layouts, member search, rename, pinned announcement, invite QR in its own 360×560 window, clear, leave |
| Channels | 服务号 bottom card, 加入/申请加入 for an unjoined channel, keyboard switch for admins |
| Settings | batch A (账号与安全 / 通用 / 网络与代理 / 关于) + batch B's first group 消息通知 (桌面通知 + 私聊/群聊/频道的 免打扰 / 提示音 / 预览); the rest of B and C pending (§9) |
| Private chat P0/P1 | send failure + 重试, outgoing typing, online/last-seen, delete chat / mark unread, notifications + tray, voice notes (recorded in-renderer, OGG/Opus muxed in-repo), albums, pinned bar, speech-to-text, reactions (display only), block/report, profile card with 备注 + 共同群聊, caption edit, add/remove contact |
| Proxy | 跟随系统代理 by default, `proxy:refresh` / `evt:proxy`, probe + 30 s retry, DPAPI-sealed secrets |
| Packaging | `.github/workflows/release.yml`: version bump on `main` → NSIS installer → GitHub Release (proven by v0.1.0–v0.1.2); the installer has never been installed or signed |

### 1.2 What is proven, and what is not

| Claim | Evidence |
|---|---|
| The build is sound | `pnpm verify` = lint → typecheck → test → build, zero warnings. Last recorded green run: 2026-11-23, 104 files / 804 tests (the count grows; read the run) |
| The UI behaves | mock Electron passes (`launch-detached.ps1 -NoSandbox -Mock`) and the browser preview; the numbers in §5 were measured off those windows |
| Paging / scroll / FPS | CDP against the real account: 5000 messages at 60 fps, **0.0 px** drift when prepending, 60 pages with no duplicates |
| The read path against real TDLib | `pnpm tdlib:smoke` (read-only) + real-account Electron sessions |
| **Writes** to Telegram | the §9.1 matrix now runs on the test DCs: `pnpm tdlib:test-dc` (text / edit / photo / voice / delete) and `pnpm tdlib:test-dc:writes` (album, caption edit, pin, 标为未读, 备注, 联系人, 拉黑, 举报, 转文字, 删除聊天) — last run 9 pass / 3 partial / 1 skip / 0 fail. The partials and the skip are named in §9.1 |
| The QR login with a real phone | **not yet** — mapping, encoding and fallback are mock-verified only |
| Windows toasts, tray icon | **not yet** on this machine (no Start-Menu shortcut; `Shell_NotifyIcon` refused in the agent session) |
| The installer, code signing, auto-update, sandboxed launch on a clean machine | **not yet** (v0.1.0 artifact predates the inlined credentials, so it still boots the mock) |
| Settings batch A against a real account | **not yet** — mock only |

---

## 2. Hard rules

1. **Writes never touch the real account.** The session in `spikes/tdlib/data` is a real
   Telegram account and stays **read-only** (`getMe` / `getChats` / `getChatHistory`).
   Anything that sends, edits, deletes, forwards or marks read with real TDLib runs on
   Telegram's **test DCs**: `pnpm tdlib:test-dc`, or `WEGRAM_TDLIB_TEST_DC=1` for the app
   (its own session under `userData/tdlib/test`). The mock adapter is the UI-fixture path
   only.
2. **Never start Electron from the agent shell.** Shell commands run inside a Windows job
   object and Chromium aborts there. Use `pwsh scripts/launch-detached.ps1` (§3.2).
3. **`--no-sandbox` is a local workaround only.** It must never reach a release build; the
   sandboxed path has to be verified on a clean machine before shipping.
4. **Credentials are per deployment** (`api_id`/`api_hash` from my.telegram.org, in
   env / dev `.env` / the value a release build inlined). `apps/desktop/.env` and
   `spikes/tdlib/.env` are gitignored; never copy them elsewhere, never reuse another
   client's credentials.
5. **The code rules in `CLAUDE.md` are hard too**: no non-null assertions, no `as` to
   silence the checker, no new `any`, no empty `catch`, no `console.log` on shipped
   paths, validate every external input at its boundary, protocol first, no dependency
   without asking.
6. **One logical change per commit**, Conventional Commit messages, GPG-signed
   (`git log -1 --format=%G?` must print `G`).

---

## 3. Environment, commands, verification

### 3.1 This machine — measured quirks

| Symptom | Cause | Workaround |
|---|---|---|
| `electron.exe --version` exits `0x80000003`; the app exits `0xC0000005` (WER: APPCRASH in `electron.exe`) | Chromium cannot initialise inside the agent shell's job object | launch detached via WMI (`scripts/launch-detached.ps1`) |
| Same crash **with** the sandbox, even detached | Chromium's sandbox is broken on this machine (Electron 30.5.1 / 38.8.6 / 45.3.3 all reproduce it; Kaspersky 21.27, Windows Insider 10.0.26300) | `-NoSandbox` locally; verify the real path elsewhere |
| `require('electron')` is `undefined` | `ELECTRON_RUN_AS_NODE=1` is global | `Remove-Item Env:ELECTRON_RUN_AS_NODE` before launching |
| `pnpm install` ignores build scripts / fails | pnpm 12 reads `allowBuilds:` from `pnpm-workspace.yaml`; the store lives outside the workspace | already configured; needs full filesystem access |
| Vite watcher dies with `EBUSY` | editors save through `*.tmpdir` folders | both Vite configs ignore `**/*.tmpdir/**` and `**/*.tmp` |
| `getChats` hangs, `getMe` works | no proxy: TDLib reads users/chats locally but cannot reach the network | configure a proxy; `socks5://127.0.0.1:7890` worked (Clash mixed port) |
| `launch-detached.ps1` dies with `Invoke-CimMethod … 拒绝访问` | the DSH shell is sandboxed (`workspace-write`): WMI creation and its detours (`explorer.exe`, `schtasks`) are denied | only works with full access; do not "fix" the script |
| Avatars/photos trickle in (one 30 KB thumbnail took 16 s) | saturated or flapping SOCKS tunnel, not the code | measured 65–230 ms on a healthy tunnel — check FlClash/Clash first |
| `-RemoteDebugPort` connects but `Runtime.evaluate` sees a stale UI | a second instance was requested while one ran; the single-instance lock kept the old window | `windows close electron.exe`, then launch |
| `node:sqlite` warning in the log | Electron 45 ships Node 24.22, the module is experimental | expected; that is why better-sqlite3 is not used |
| A fresh checkout cannot launch Electron | Electron 45 dropped its `postinstall` downloader | `pnpm electron:install` (dev only) |

### 3.2 Commands

```powershell
pnpm install                     # allowBuilds configured in pnpm-workspace.yaml
pnpm electron:install            # Electron 45: fetch the binary (dev only)
pnpm verify                      # THE gate: lint → typecheck → test → build, 0 warnings
pnpm lint / pnpm test / pnpm typecheck / pnpm build
pnpm format                      # prettier --write .   (format:check to verify only)

cd apps\desktop
pnpm dev                                                  # Electron dev (unset ELECTRON_RUN_AS_NODE)
pnpm web                                                  # renderer preview :5174 (?perf=1 → acceptance panel)
pnpm tdlib:smoke                                          # headless real-TDLib read check
pnpm tdlib:test-dc                                        # write checks on Telegram's test DCs
pnpm tdlib:test-dc:writes                                 # the §9.1 write matrix (album/pin/note/contacts/…)
pnpm ui:db-check                                          # headless ui.db check (node:sqlite)
pwsh scripts\launch-detached.ps1 -NoSandbox -Mock         # mock adapter in the real shell
pwsh scripts\launch-detached.ps1 -NoSandbox -Mock -RemoteDebugPort 9224   # + CDP
pwsh scripts\launch-detached.ps1 -NoSandbox -Proxy socks5://127.0.0.1:7890 -SessionDir ..\..\spikes\tdlib\data
```

The launcher logs to `.cache/app.log` and spawns a WindowsTerminal wrapper: **minimise** it
(closing the console takes the app down). Close any running `electron.exe` first — the
single-instance lock silently keeps the old bundle on screen.

### 3.3 Adapter selection and fixtures

- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` (env, dev `.env`, or a release build's inlined
  value) select TDLib. A development build without them runs the mock adapter.
  `WEGRAM_ADAPTER=mock` forces the mock **in development only**; a packaged build refuses to
  start without credentials and ignores the variable.
- The mock adapter generates its media into `%APPDATA%\WeGram\mock-media`
  (`design-v3.png`, `sunset.png`, `需求说明.md`, `sticker-face.webp`, `sticker-heart.webp`,
  `sticker-wave.tgs`, `premium-sticker-effect.tgs`, the video WebM, `emoji-click.wav`).
  Delete the folder to force regeneration.
- Browser preview: `pnpm web` → `http://localhost:5174` (shell) and `/#login`, `/#viewer`,
  `/#qr` (the standalone windows). It fakes IPC through `lib/preview-bridge.ts`; app logic
  must never depend on it.
- Dev flags that make unprovable paths testable: `WEGRAM_MOCK_FAIL_SEND=1` (fails the next
  text send once), `WEGRAM_MOCK_NOTIFY=1` (ambient arrivals become notifications), and
  Chromium's `--use-fake-device-for-media-stream` (voice recording without a microphone).
  There is **no** `WEGRAM_USER_DATA` in the tree today: a second instance shares
  `%APPDATA%\WeGram` and the single-instance lock makes it a no-op.
- `tdlib:smoke` env: `TDLIB_PROXY`, `WEGRAM_TDLIB_DIR` (defaults to the spike session),
  `SMOKE_DEBUG=1`. Expected output: `auth state : ready`, 20 chats,
  `history: 10 messages, hasMore=true`. Without a proxy it times out on `listChats` — known
  behaviour, not a bug.

### 3.4 Test-DC writes (the only place writes may run)

The reserved `99966XYYYY` test numbers are **dead** (TDLib maintainer, tdlib/td#3083:
test accounts were disabled for abuse; a real number and an official app are required). A
test-DC account is created by an **official app**, then used by TDLib:

1. Telegram Desktop **beta**: hold Alt+Shift, right click "Add account" → **Test server**,
   sign a real number in there.
2. `WEGRAM_TEST_PHONE=+... WEGRAM_TEST_ALLOW_REAL_PHONE=1 pnpm tdlib:test-dc` drives the
   TDLib login; the 6-digit code arrives **inside that official session**
   (`authenticationCodeTypeTelegramMessage`; `resend` is refused).
3. `WEGRAM_TEST_CODE=<code>` runs the write checks. Measured on a fresh account:
   authorization → `ready`, 3 chats, send → edit → photo upload → delete all pass; voice
   note accepted with an empty waveform.

`pnpm tdlib:test-dc` needs the test session **exclusively** (`db/td_test.binlog`): close
the app first, and a torn/VSS copy of the DB loses authorization. If no test DC is
available, say so and mark the write path **unverified** — never probe writes against the
real session.

**Two scripts, one session.** `pnpm tdlib:test-dc` proves the baseline chain (text → edit →
photo → voice → delete); `pnpm tdlib:test-dc:writes` drives the §9.1 matrix — album + caption
edit, pin, 标为未读, 备注, 联系人, 拉黑, 举报, 转文字, 重试, 删除聊天 — one
PASS / PARTIAL / SKIP / FAIL line per path (`PARTIAL` = the call and TDLib's answer were
exercised but this account has no fixture for the round trip; `SKIP` = the API refuses on
that target). `WEGRAM_TEST_KEEP=1` leaves the probe rows behind; otherwise they are deleted.
Both share `scripts/testdc/harness.ts` for the credential / session / number guards, so
neither can drift onto the real session. The script recreates the 777000 fixture chat when a
previous run's 删除聊天 check removed it, and deletes the *bot's* chat rather than a real
conversation.

### 3.5 Driving the real renderer over CDP

```powershell
node .cache\cdp-eval.mjs "document.querySelectorAll('.wx-message-slot').length"
node .cache\cdp-eval.mjs "@script.js"   # expression from a file (quoting)
```

`.cache/cdp-eval.mjs` (gitignored, ~30 lines) reads `http://127.0.0.1:9224/json`, opens the
page's `webSocketDebuggerUrl` and sends one `Runtime.evaluate`. It can call the app's own
IPC, the cheapest way to isolate a bug:

```javascript
await window.tg.invoke('messages:history', { chatId: -1001125107539, limit: 50 })
await window.tg.invoke('chats:list', { offset: 0, limit: 5 })
```

Anything that opens a chat also marks it read on the server — use it deliberately. rAF and
`PerfPanel` only run while the window is visible, so focus it first.

### 3.6 Checklist used to verify UI work

1. `pnpm typecheck && pnpm build`.
2. Mock Electron pass: login window (QR → mock confirms after 10 s; phone fallback
   `+8613800000000` / `12345` / `wegram`), then the shell: rail icons, list header, row
   spacing, selected row, bubbles both sides, day/unread separators, composer card, hover
   timestamp, context menus, delete confirm, forward sheet, sticker panel, app menu, chat-info
   panel, settings window, dark mode, empty-pane watermark.
3. For a visual judgement, crop the same region from app and reference, scale to the same
   width, paste side by side, read once. Reference crops live in `.cache/wxref` (gitignored).
4. `pnpm web` is fine for CSS iteration, but **do not judge the pane there**: Chrome's
   "save password" bubble sits over the transcript and DSH refuses clicks on it.

`pnpm test` is DOM-free by design (node environment); rendering, hook order and
scroll/virtualisation timing must be verified in the Electron window, `wx-media://` has no
handler in the preview, and anything touching `ui.db` needs `pnpm ui:db-check`.

---

## 4. Architecture map

```
packages/protocol/src/        dto.ts (message + ops zod schemas), channels.ts + the domain
                             tables it spreads (chats.ts, qr.ts, send.ts, presence.ts,
                             network.ts, settings.ts, voice.ts, poll.ts, comment.ts,
                             search.ts, user.ts, reaction.ts, stickers.ts, chat.ts,
                             contact.ts), events.ts, errors.ts, index.ts
packages/adapter-contract/src/  the seam: TelegramAdapter + AdapterEvent/Emitter
packages/mock-adapter/src/      the fake adapter + generated fixture media
packages/mock-session/src/      the fake session's pure rules (shared with the preview)
packages/mock-fixtures/src/     the demo account both fakes serve
apps/desktop/src/main/
  index.ts                   lifecycle, adapter wiring, theme overlay, the login↔shell hand-over
  windows.ts                 window factory, openExternal, storedTheme, applyTitleBarTheme
  app-window.ts              createAppWindow + attachNavigationPolicy (all three factories)
  login-window.ts            frameless 280×373 login BrowserWindow (#login)
  viewer.ts, viewer-size.ts  the 图片和视频 BrowserWindow and its measured size maths
  qr-window.ts               the 群/频道二维码 sheet (frameless 360×560, child of the shell)
  settings-window.ts         the 设置 window (640×558, no parent, single instance)
  system-proxy.ts            Chromium resolveProxy + registry fallback
  system-proxy-rules.ts      (pure) PAC/static/registry parsers
  ipc/router.ts              per-channel zod validation, Result envelope
  ipc/handlers.ts            one handler per invoke channel (IpcHandlerMap typed by InvokeResponse)
  media/registry.ts          token → path | fileId registry (renderer never sees paths)
  media/protocol.ts          protocol.handle('wx-media'): Range streams + still-downloading tail
  media/stream.ts, leases.ts (pure) the byte pump; refcounted download leases
  media/image-size.ts        PNG/JPEG/WebP/GIF header probe (inputPhoto needs real sizes)
  media/voice-file.ts        materialises recorded OGG under userData/voice
  notifications.ts, tray.ts  Electron Notification + task-bar flash; best-effort tray
  telegram/adapter.ts        re-export of the seam
  telegram/tdlib/            ONLY folder allowed to import tdl (index, client, boot, lifecycle,
                             chat-api, send-api, user-api, actions/, updates, avatar-cache,
                             stickers, proxy, map/)
  telegram/updates.ts        EventBus: 60 ms batching, monotonic seq
  telegram/events.ts         AdapterEvent → evt:* channels
  telegram/index.ts          adapter selection (mock / tdlib, WEGRAM_ADAPTER)
  store/ui-db.ts             ALL node:sqlite access (drafts, theme, anchors, media cache)
  store/settings.ts          JSON store for what must exist before a window (proxy, prefer_ipv6)
  proxy.ts, proxy-url.ts     stored ↔ view/masked config, URL parsing
  security/secrets.ts        safeStorage (DPAPI) seal/unseal
  preload/index.ts           window.tg.invoke / window.tg.on, channel whitelist
apps/desktop/src/renderer/src/
  main.tsx                   route by hash: plain shell, #viewer, #login, #qr, #settings
  App.tsx                    shell only (auth ready) + event subscription, typing expiry, locate
  screens/{LoginWindow,QrWindow,SettingsWindow}.tsx
  components/MainShell.tsx   three columns, toast, app menu
  components/SideRail.tsx, SectionPlaceholder.tsx, ChatList.tsx, ChatListItem
  components/chat-list/chatMenu.ts   the row context menu
  components/chat-pane/      index (render tree + state), useChatHistory, history/,
                             messageActions, ChatHeader, ChatInfoPanel/Rows/Dialogs/Search,
                             CommentPanel, CommentComposer, ChannelBar, PinnedBar,
                             Placeholders, labels
  components/message-list/   index (virtualiser + reveal), MessageRow, Divider, rows.ts,
                             useInitialPosition / usePrependRestore / useAnchorSave /
                             useJumpToLatest / useLocateScroll / useLandingSave,
                             scrollFlags, scroller, emoji/menu/unread (pure), PollBubble,
                             CommentBar, ChannelMeta, PremiumStickerEffect
  components/composer/       ComposerCard (the ONE input card), useComposerInput,
                             useVoiceRecording, VoiceControls
  components/contacts/       ContactsList, ContactDetail
  components/viewer/         MediaViewer, VideoCanvas, ViewerToolbar/Grid/Icons, useViewer*
  components/{ExpressionPicker,StickerRenderer,StickerCanvasLayer,MediaBubble,VoiceBubble,
              RichText,Avatar,ContextMenu,AppMenu,PlusMenu,Icon,WechatIcons,OverlayScrollbar,
              SearchField,AnchoredPopup,ProfileCard,ReportDialog,QrCode,PerfPanel}.tsx
  store/                     types, initialState (DATA_DEFAULTS), reducers, slices/{auth,
                             chats,messages,media,ui}, useAppStore (assembler)
  lib/                       pure rules + hooks: format, entities, media, mediaVariant,
                             mediaPriority, tgs, poll, comments, presence, typingPing,
                             albumSend, editTarget, voice/ (recorder + oggOpus), qr, zoom,
                             player, viewer, chatInfo, listMetrics, scrollGeometry,
                             telegramLink, stickerMedia, stickerSetLink, customEmoji,
                             preview/ (browser preview only)
scripts/                     launch-detached.ps1, tdlib-smoke.ts, tdlib-test-dc.ts,
                             ui-db-check.ts, style-contract.test.ts
```

Per-directory detail (what each module owns and why it exists) is in the layer notes; the
split history and the invariants it preserved are in §8.

Rules that keep this maintainable: only `telegram/tdlib/**` knows TDLib JSON and only
`store/ui-db.ts` touches `node:sqlite` — both enforced by ESLint; a new field starts in
`dto.ts`; new channels go into the channel tables; every event carries `seq`.

---

## 5. The measured WeChat 4.x UI contract

Status: layout, colours, typography, chrome and dialogs match the client **on this
machine**; the chrome glyphs are WeChat's own vector artwork (§5.12). Everything in §5.13 is a
deliberate, documented difference. Do not re-derive these numbers — measure a **new**
reference only if the client itself changes.

### 5.1 How the numbers were obtained

Everything was read off the running client: colours sampled with PIL, control boxes measured
from a screenshot, converted to CSS px. The display is 1920×1080 at **125 % scaling**; DSH
returns screenshots at 1366×768 (×0.7115), so **CSS px = screenshot px × 1.1245** for the
shell. The measured WeChat window sat at (276,105)–(1145,656) in that screenshot space.
Other windows have their own scale factor — it is stated per subsection.

For dark mode the client window was captured with `PrintWindow(hwnd, dc, 2)`
(`PW_RENDERFULLCONTENT`) and histogrammed per surface, because the DSH overlay card sits on
top of the screen and `ImageGrab` captures *it*; the computer-tool screenshot excludes the
card but is a re-encoded JPEG. `PrintWindow` needs `SetProcessDpiAwareness(2)` first or
`GetWindowRect` answers in virtualised pixels and the bottom of the window is cut off.

### 5.2 Shell: tokens and metrics

| Token | Light | Dark |
|---|---|---|
| rail / title strip | `#e0e0e0` | `#2d2d2e` |
| conversation list | `#e7e7e9` | `#3b3b3d` |
| chat pane | `#fbfbfb` | `#1e1e1f` |
| composer card | `#fcfcfc` | `#1e1e1f` + 1 px `#2f2f30` border |
| 表情 panel / selected tab pill | `#fbfbfb` / `#ececec` | `#2f2f30` / `#3a3a3c` (inferred) |
| selected row | `#15ad70` | `#0da869` |
| incoming bubble | `#eeeef0` | `#2f2f30` |
| outgoing bubble | `#95ec69` | `#35d28d` |
| brand | `#07c160` | `#07c160` |
| search pill | `#fbfbfb` | `#454547` |
| text / secondary / tertiary | `#191919` / `#9a9a9a` / `#b7b7b7` | `#e1e1e5` / `#7b7b80` / `#7b7b80` |
| hairline / strong / pane line | `#ececec` / `#dedede` / `#f2f2f2` | `#2f2f30` / `#3a3a3c` / `#1e1e1f` (no header divider) |
| rail glyphs | `#5c5c5c` | `#969697` |
| pane-header + composer glyphs / list "+" | `#6f6f6f` / `#8a8a8a` | `#a5a5a5` / `#b1b1b1` |
| disabled fill / ink | `#ececec` / `#b7b7b7` | `#29292a` / `#6a6a6a` |

The dark scheme is a **lifted** grey scheme, not near-black (re-measured 2026-11-18): the
previous `#191919` / `#1f1f1f` / `#111111` block with muted greens was wrong, the real
client lifts surfaces and keeps the vivid light-theme accents. There is **no divider under
the pane header** in dark. Dark mode has only two text greys, so
`--wx-text-tertiary` equals `--wx-text-secondary` there (day labels, timestamps, the search
placeholder all sample `#7B7B80`).

| Metric | Value |
|---|---|
| title strip | 32 px (native `titleBarOverlay`, rail colour) |
| rail width | **61 px**; avatar 32 px (radius 8), 21–24 px glyphs, 48 px pitch |
| rail glyph ink | core `#5a–#5d` (`--wx-rail-icon`); the lighter `#8a8a8a` read thinner *and* smaller at the same stroke width |
| list column | 238 px; header row 43 px; search pill 29 px tall, radius 5; rows 65 px |
| list avatar / type | 40 px, radius 6; title 14 px, preview 12 px, time 11 px |
| pane header | 46 px, title 15 px/500, left padding 18 |
| message avatar | 38 px, radius 6; 8 px gap to the bubble; row padding-bottom 14 px |
| transcript inset | 22 px on **both** sides (client 21–25, symmetric); the 跳转到最新消息 pill shares it |
| bubble | `padding: 8px 12px`, radius 6, 14 px/1.45, max-width `min(560px, 66%)` |
| composer card | radius 8, 1 px `#ececec`, margins 6/9 px, input min-height 84, toolbar 42 |
| channel bar (服务号 card) | 54 px tall, radius 8, 1 px border, same 6/9 px margins; each item is a full-height equal-width segment (whole segment is the hit target, highlight fills edge to edge); keyboard glyph 20 px in a 46 px right strip |
| send button | 72×30, radius 4; disabled `#ececec` on tertiary text, enabled brand green |
| day separator | 12 px centred, no pill; message meta 11 px, hover-only |
| popup card | fill `#fafafa`, radius 6, 5 px padding; the ＋ card is 143×144 with 45 px rows |
| popup hover | **brand green `#07c160` fill with white label *and* white glyph** — never a grey wash |
| overlay scrollbar | 6 px wide, `right: 2px`, radius 3, thumb `rgba(0,0,0,.22)` → `.38` on hover/drag (dark: white, same alphas); fades in on hover / for 900 ms after a wheel scroll; **no gutter** |

`wx-list__plus` draws no circle of its own — the button *is* WeChat's circle-plus SVG, in
`--wx-icon-strong`.

### 5.3 The 图片和视频 window (photo + video)

Measured off a live viewer window (screenshot 1366×768, CSS = ×1.1245). The window sat at
(93,17)–(1113,705): **1147 × 774 CSS px on a 1536×864 display** — 75 % of the screen width,
90 % of its height, *not* sized to the photo (which was 591 px wide with ~309 px gutters).

| Token / metric | Value |
|---|---|
| toolbar strip | 40 px, `#e6e6e6` (lighter than the shell's `#e0e0e0`), 1 px `#ececec` bottom line |
| canvas | `#f7f7f7`, **no padding**: a height-limited photo touches the toolbar and the bottom edge |
| buttons | 32 × 32, 8 px gap (40 px pitch), 18 px glyphs, radius 4, hover `rgba(0,0,0,.045)` |
| group dividers | 1 px × 18 px `#dedede`, 3 px either side (→ 54 px between groups) |
| first button | 45 px from the window edge |
| toolbar order | 📌 ｜ ← → ▦ ｜ ⊕ ⊖ 1:1 ｜ ↻ ｜ ⇩ ｜ … 更多 ｜ native window controls |
| 预览 board | the client docks it in its **own** window; here a 268 px column of 4 × 62 px cells inside the viewer |
| 更多 menu | 复制 / 打印 / 转发… / 收藏 / 定位到聊天位置 / 使用系统默认方式打开; 132 px min width |
| active state | 置顶 and 预览 turn **brand green** — the only coloured glyphs in the strip |

Dark (**measured on a live dark viewer**, 2026-11-18): bar `#3b3b3d` — the conversation
list's grey and *lighter* than the canvas, the opposite of the light theme — canvas
`#242424`, glyphs `#b1b1b1`, hairlines `#4f4f51`, and a 1 px `#2d2d2d` line under the bar.
That is why the viewer uses `--wx-viewer-icon` / `--wx-viewer-sep` rather than the general
`--wx-text` / `--wx-line-strong`; the native overlay is repainted from `main/viewer.ts` and
must equal `--wx-viewer-bar` or the strip shows a seam.

The video window is **the same window** (the client titles both 图片和视频). Measured off a
second live window showing a 9:16 clip (screenshot 1538×978; the button pitch measures 50
screenshot px against our 40 CSS px, so **CSS px = screenshot px ÷ 1.25**):

| Token / metric | Value |
|---|---|
| window | **1230 × 782 CSS px** — 80 % of the 1536 px CSS width, same 90 % height; we still create 75 % (delta 17) |
| toolbar | identical to the photo window (40 px, `#e6e6e6`), pin 45 px from the edge |
| toolbar order | 📌 ｜ ← → ▦ ｜ ⇩ ｜ … ｜ window controls — **no zoom group, no rotate**, no 查看原视频 pill |
| canvas | `#f7f7f7`, clip fitted **by height with no padding** (410 × 728 CSS for 9:16 there) |
| player bar | 40 px tall, **84 px from the left, 82 px from the right, 20 px above the bottom**, radius 8, `rgba(0,0,0,.45)` — samples `#888888` over the canvas |
| bar contents | ▶/❚❚ 32 px icon, elapsed `00:01` 13 px tabular, timeline (2 px track, played part white, 10 px white thumb), total `00:51`, 倍速 text button, speaker |
| 音量 capsule | point/click the speaker and the client lifts a **34 × 128 px** capsule above it (radius 17, `rgba(0,0,0,.4)`), a 2 px white track with a 22 px knob, the **top** of the track being 100 % (measured 1:1 off a 1253 × 820 capture, 2026-11-23; the player bar is 40 px in that shot, so CSS px = screenshot px) |
| bar behaviour | floats over the clip, hides after 2.4 s of playback without pointer movement; visible while paused, while dragging the timeline, while 倍速 is open and while the 音量 capsule is up |
| 音量 persistence | the level is stored in `ui.db` (`app_settings.viewer_volume`, one value for the app) and reused by the next window; 静音 is per-session — it slides the capsule to the bottom and clicking again puts it back, the level itself never changes |
| keyboard | Space / K play-pause, ←/→ seek ±5 s, M mute, Escape closes the menu / 预览 / window |

### 5.4 The login window

The client's login is a **separate window**, not a page inside the shell. Measured off two
reference screenshots (366×487 and 365×487 at 125 %, so **CSS = screenshot ÷ 1.25**; both
windows are 350×466 device px):

- **Window 280 × 373 CSS px**, frameless — the client draws its own × and has no
  minimise/maximise — centred in the work area, flat `#fafafa`, OS-rounded corners.
- **Title strip 32 px**: `微信` 12 px from the left, 14 px `#6e6e73`; gear and × are 1.2 px
  `#4d4d4d` hairlines in 28 px hit boxes on a 44 px pitch (centres 214 / 258), 8 px from the
  right edge. The whole strip drags the window.
- **QR step**: QR 136 × 136 at (72, 80); green 扫码登录 14 px `#00c375` centred at y 255;
  footer link 14 px `#304b82` centred at y 341. Our 136 px is the **whole square, quiet zone
  included** — the client's code can borrow its white sheet, ours cannot (delta 21).
- **Profile step**: avatar 80 × 80, radius 12, at (100, 70); name 16 px `#191919` at y 180;
  **168 × 36, radius 6, `#00c375`** button, 16 px white text, at (56, 272); footer
  `切换账号 | 仅传输文件` at y 341, 1 px `#dedede` divider, 17 px gaps.
- Dark was **not** measured on the client; `--wx-login-*` follows the shell's scheme.

What we built: the same QR step, driven by TDLib. `requestQrCodeAuthentication` yields a
`tg://login?token=…` link (`AuthState.waitQr`), encoded locally with `qrcode` into a 136 px
SVG — near-black on white, **never inverted** in dark mode; the token never leaves the app.
The footer's right link is 登录帮助 instead of 仅传输文件; the left is 用手机号登录, which
rebuilds the auth client (`auth:reset`) because TDLib cannot leave a pending QR confirmation.
The gear opens the proxy settings. A user-driven sign-in ends in the shell; only a session
restored at startup shows the profile step.

### 5.5 The 表情 panel and the 贴纸包盒子

**表情 panel ≈ 464 × 464**, radius 8, `#fbfbfb`, no border, soft shadow. It floats above the
input, **centred on the 表情 toolbar button**, its bottom edge 18 px above the toolbar glyph
centres — so it overlaps the input but leaves the toolbar row visible, and on a 1000 px
window it **overhangs the conversation list** by ~200 px (the client does the same).
Section labels 12 px `#9a9a9a`, 22 px from the card's edge, 20 px above the first row, 8 px
between a label and its grid; 最近使用 is one row of the same grid. Emoji grid **10 columns ×
44 px**, 12 px side inset, art **24 px**. Tab strip 45 px tall, 14 px inset, 5 px gaps,
**44 px slots**, selected pill **32 × 32** radius 7 `#ececec`; order 搜索 / 表情 / installed
sets, paged by 上一页/下一页 at the row's ends (nine slots: eight tabs with one arrow, seven
between two; the last page clamps and only shows the left arrow — maths in
`lib/pickerTabs.ts`). No scrollbar in the card; grid columns are `1fr` so a bar could never
clip the tenth column.

- **Every tab shows a picture**: `getInstalledStickerSets` leaves `thumbnail` null for most
  sets but always ships `covers`, so the adapter resolves thumbnail → first sticker →
  `covers[0]` like tdesktop's `lookupThumbnailDocument`; the tab paints that sticker's
  **static** thumbnail (a TGS/WebM pack shows one frame at 28 px), downloaded only when the
  tab is on screen. The two-character fallback remains for a cover TDLib has not sent yet.
- The installed list arrives in two steps (`evt:stickerSets` + `stickerSetsVersion`): 14
  cached sets on cold start, 192 about a minute later. Without the bump the panel kept the
  14-set cache for the whole session.
- Emoji are real Unicode characters (a Telegram message carries text, not WeChat's closed
  emoticon set), so the grid paints the same glyph the transcript will. 最近使用 persists in
  `ui.db` → `app_settings['emoji.recent']`.
- Dark has no measured counterpart: `#2f2f30` card, `#3a3a3c` pill.

**Animated-cell budget.** A 120-sticker pack is 120 TGS/WebM files; Telegram Desktop animates
with `lib_lottie`'s MultiPlayer (one render pass, 30 fps cap, objects dropped two screens
away, ≤10 MB frame caches). lottie-web cannot, so the **grids** (the panel's set body and the
贴纸包盒子) use `@thorvg/webcanvas`: one WebGL canvas, every TGS cell a `TVG.Animation`, one
`canvas.render()` per frame capped at 30 fps. Cells parse two screens ahead/behind, two at a
time with a main-thread yield, 120 ms after the last scroll. Painting does **not** pause while
scrolling (one immediate frame when a cell becomes visible); off screen a sticker only
pauses, three screens away its scene is released but its last frame is first read back into
an `<img>` (`savedFrame`) so a revisit never flashes the thumbnail. The scene is disposed
when the panel closes or another set opens. Measured with 120 copies of one TGS on a
464 × 1968 canvas: **56.5 fps, `render()` 1.83 ms average**. WebM cells mount a `<video>`
only while inside their panel's scroller (0 px margin, nearest scroll container — not the
window). The canvas layer sits above the cells with `pointer-events: none`; a ready cell
hides its thumbnail. The ThorVG wasm is inlined as a `data:` URL, the CSP carries
`'wasm-unsafe-eval'`, and an init failure falls back to per-cell hover animation. The
transcript keeps lottie-web with `setSubframe(false)`.

**贴纸包盒子 464 × 558** (the client measured 462 × 558). Clicking a sticker in a message
opens the box of its pack, floating **un-dimmed** over the conversation in a transparent
full-window layer (click outside or Esc closes): a **52 px** title row (title / ⋮ / ×), the
pack in a **4-column grid at 104 px cells** — the same cell the 表情 panel's set body uses.
WeChat itself packs 5 × 82 px; the owner asked for 4 so the box and the picker agree — and a
**58 px** footer with **移除贴纸包** in
`--wx-danger` (or **添加贴纸包** in `--wx-brand` for an uninstalled pack) beside a count pill.
Title → ⋮ → 分享表情包 / 复制链接 / 归档贴纸 (归档 only while installed); the link is
`https://t.me/addstickers/<name>` from TDLib's `stickerSet.name`. The grid is display-only.
It needs `MessageMedia.stickerSetId` (TDLib `sticker.set_id`) so one `stickers:set` call opens
it; removing or archiving closes it and main emits `evt:stickerSets`.

Missing on purpose: the **自定义表情** (heart) tab — favourites are TDLib custom-emoji sets,
whose messages are custom-emoji entities, and the protocol has no send path for them yet.

### 5.6 Transcript rows that are Telegram, not WeChat

**Animated-emoji message** (one-emoji message → `messageAnimatedEmoji`): drawn as the
AnimatedEmoji sticker, **no bubble**, longest edge **112 px** (our text emoji is 48 px). Plays
**one pass** when it appears and does not loop; a click replays it and plays the click sound
(`animated_emoji.sound`, fetched on that first click). Stickers keep looping — the difference
is `StickerRenderer`'s `playback` prop. A custom emoji whose sticker TDLib has not resolved
falls back to the 48 px glyph until `updateMessageContent` remaps the row. Not every emoji has
an animated version (✨, 😀, 🥺 answered 404 on the test DC) — the 48 px big emoji is then the
**correct** rendering; use ❤️ or 🎉 when checking that path.

**Premium sticker effect**: the effect is a second TGS, painted in a square **1.49×** the
sticker (tdesktop's `kPremiumMultiplier = 1 + 0.245 * 2`), centred, mouse-transparent: a
140 px sticker row draws 209 × 209. One pass per sticker instance, replay on tap (opacity
transition, not an unmount, so no re-decode). No badge in messages (the official client marks
premium only in the picker/panels, and our picker has no premium mark). It is decoration: a
bad or missing file hides itself and never surfaces an error.

**Custom emoji in text**: **20 px inside 14 px body text**, 0.32 em below the baseline
(`.wx-custom-emoji`). The box is square (custom-emoji stickers are 512 × 512) and the line
height does not change. The glyph is the fallback everywhere — until the sticker arrives, for
an unknown id, offline — so nothing is ever a hole. Lookups batch per frame and cache for the
session (eight premium emoji in a post = one IPC call; scrolling back in = none). A message
that is one custom emoji is a different path (`messageAnimatedEmoji`, §5.6 above).

### 5.7 通讯录 (contacts)

Measured off the owner's address book at 1377×892 **physical** px, 125 % (`CSS = ÷1.25`);
the list column measured 238.4 CSS px — the same 238 px used here.

| Metric | Value |
|---|---|
| list column | 238 px, `--wx-list` background |
| contacts header | 85 px: 12 top + **26 px search pill** + 12 + **35 px 通讯录管理 card** |
| 通讯录管理 card | full width minus 12 px insets, radius 8, 16 px label, 21 px payload glyph |
| service rows | **36 px**, 16 px label, 12 px chevron (16 px inset), count 13 px right (10 px inset) |
| group header | **30 px**, 13 px, 36 px left inset |
| contact row | **54 px**, 30 px avatar (radius 4), 36 px left inset, 8 px gap, 16 px name |
| detail card | fixed **310 px** wide, centred, 59 px top padding |
| detail avatar | **60 px**, radius 6; name 17 px/500; 微信号 14 px, 4 px below the 24 px name line |
| detail rules | 19 px below the header block, 1 px `#f0f0f0` |
| detail sections | 20 px top / 10 px bottom (更多信息 16); label 14 px; rows 24 px line-height, 72 px label column |
| detail actions | three 96 px columns, 11 px insets (centres 59/155/251), 30 px above, 24 px glyph + 8 px + 14 px label |

Colours (light; dark inferred): action blue `#304b82` (`--wx-link`, the login-link ink),
section labels / chevrons / 微信号 `#6e6e73`, trailing counts `#9f9fa6`, hairline `#f0f0f0`.
A selected contact row is a neutral `rgba(0,0,0,.08)`, never the chat list's green.

The card's vertical layout is exact: avatar top 91, header rule 170, 朋友资料 label 191,
备注 219, 更多信息 label 273, 来源 303, 添加时间 329, action icons 397, labels 429 (CSS px from
the window top). Our DOM measures 91 / 170 / 191 / 219 / 273 / 301 / 367 with the same
paddings. The one deliberate change: Telegram has no 添加时间 / 来源, so **数据中心** (DC N,
decoded from the profile photo; 未知 without one) and **手机号** (with the leading `+` Telegram
omits) take those rows.

### 5.8 聊天信息 panel and the QR window

| what | value |
|---|---|
| panel | 314 px wide, starts under the 46 px header, left hairline `#f0f0f0` |
| insets | left 19, right 18 (rules 18/19); rows reserve 33 on the right for the switch |
| participant grid | 66 px cells, 47 px avatar (radius 4), caption 12 px `#9f9fa6` 4 px below, single line |
| 搜索群成员 | search pill 32 px tall, 19 px sides, 12 px above the grid |
| 群聊名称 / 群公告 | label 14/20 over hint 12/16 (clamped to two lines), 9–10 px vertical padding |
| 群二维码 | 64 px row; QR pictogram then chevron, both `#b7b7b7` |
| 查找聊天内容 | 64 px row, 14 px label, trailing chevron |
| mute / pin block | 10 px above and below, two 41 px rows, no rule between |
| 清空聊天记录 / 退出群聊 | 64 px rows, centred, `#fa5151` |
| switch | 36 × 20, 16 px white knob inset 2, off `#ededed`, on `#00c375` |

- **It overlays; it must not push.** The owner corrected this (2026-11-21: "这个信息面板是压在
  消息上面的"): the sheet slides over the transcript and the composer, which keep their width
  underneath. A push layout re-lays-out every virtualised row each frame. The animation is
  only `translateX(100% → 0)` (200 ms); `lib/chatInfo.ts` owns the duration and
  `style-contract.test.ts` pins the stylesheet to it.
- **Private chat**: peer face, 查找聊天内容, 消息免打扰, 置顶聊天, 清空聊天记录.
- **Group**: 搜索群成员 over the grid + dashed 添加, 群聊名称, 群公告, 群二维码, 查找聊天内容,
  mute/pin, 清空聊天记录, 退出群聊.
- **Channel** reuses the group layout with channel nouns (频道名称 / 频道公告 / 频道二维码 /
  退出频道). The participant block is **administrator-only**: the panel asks
  `chats:canGetMembers` (`supergroupFullInfo.can_get_members`) and draws 搜索群成员 + the grid
  only when true, otherwise the block is absent (never a fake one-row grid).
- 搜索群成员 is a **server** search (`searchChatMembers`, 260 ms debounce), not a filter over
  the visible tiles; a query with no hits draws no tiles.
- 群聊名称 opens `RenameDialog` → `chats:setTitle` (`setChatTitle`, needs `can_change_info`);
  the dialog owns the draft so a refusal keeps the typed name.
- 群公告 is the newest **pinned** message (`chats:pinned` → `getChatPinnedMessage`; a 404 is
  "nothing pinned"); tapping it locates that message.
- 清空聊天记录 → `deleteChatHistory` with `revoke: false` (this account's copy only); the
  store's history is emptied in place. 退出群聊 → `leaveChat` + a `remove` op.
- 查找聊天内容 switches the panel to its own search view (`search:inChat`, 260 ms debounce);
  picking a result closes the panel and rides the locate path.
- **群二维码 is its own window** (frameless 360 × 560, child of the shell so it closes and
  minimises with it): member collage (up to six faces, else the chat photo), 群聊：first three
  names, a 280 px code, a validity line, 转发给朋友 / 复制图片 / 保存图片. The code is a
  **temporary invite link** (`createChatInviteLink`, 7 days) so the line reads 该二维码 7
  天内（M月D日前）有效，重新进入将更新 — and it is true, every open mints a fresh code;
  without invite rights it falls back to the public username and reads 该链接长期有效. The
  actions work on a 1024 px PNG the window rasterises itself from the same `qrMatrix`:
  复制图片 (main clipboard), 保存图片 (native dialog into 图片), 转发给朋友 (in-window chat
  list, then `qr:share` sends a temporary PNG as a **photo message**). Esc closes the chat
  list first, then the window; the frameless × goes through `qr:close`.
- Esc ordering everywhere: dialog → search view → panel → chat list → window.

### 5.9 Global search

- **The pill is the entry, not a filter.** Typing swaps the list column's body for the search
  panel, 260 ms debounce, newest request wins; an empty box restores the conversation list.
- **Two tabs, 聊天 / 频道** (private + groups vs channels). Both scopes are fetched for one
  query, so switching tabs is instant.
- **Each tab is two sections**: conversations whose name matches (`search:global` →
  `searchChats`), then the messages themselves (`search:messages` → `searchMessages` with
  `chat_type_filter`, the 聊天 tab merging the private and group streams) under a
  `找到 N 条消息` line. A hit row is the chat's 32 px face, its title with the time, and the
  preview; picking it opens that chat at that message through the pane's locate path.
- **Paging** is cursor-based (TDLib's `next_offset` per stream), asked for within 160 px of
  the scroller's end; empty offsets exhaust the scope. Results are drawn plainly (no
  virtualiser), 20 rows appended per page.
- **Hit emphasis**: the matched run of a conversation title is `--wx-brand`; on the selected
  row it turns white and underlined.
- The pill grows a 14 px × only while it has text; Esc clears it too (and stops there).

### 5.10 The 设置 window

微信 4.x's 设置 is a **separate top-level window**, not an overlay: the chat behind it is not
dimmed and keeps working, the 8 px radius and drop shadow are the window's (DWM), the × is
self-drawn and there is no title strip. Measured at 125 % (800×698 device px → 640×558 CSS):

| Metric | Device px | CSS |
|---|---|---|
| window | 800×698 | 640×558 |
| nav column | 200 | 160 |
| nav row height | 50 | 40 |
| content padding (left/right) | 50 | 40 |
| row, single line | 63 | 50 |
| row, with a caption | 78 | 62 |
| group heading | 16 | 13 |
| nav icon | 20 | 16 |

| Element | Light | Dark |
|---|---|---|
| content background | `#FAFAFA` | `#1E1E1F` |
| nav background | `#EEEEF0` | `#2F2F30` |
| selected nav row | `#15AC70` | `#0DA869` |
| primary text (row label, group heading) | `#19191A` | `#E1E1E5` |
| caption / description | `#9F9FA6` | `#7B7B80` |
| divider | `#F0F0F0` | `#272728` |
| select pill | `#F2F2F2` | `#303031` |
| switch on / off | `#00C375` / `#EDEDED` | `#00A361` / `#29292A` |

Both columns run the full window height; there is no rule under a title strip, and the top
40 px is empty drag space on both sides. Group headings are the primary colour at 13 px,
**not grey**. Do not draw the card's radius/shadow in CSS — they belong to the window. Select
pills are 28 px high with a 12 px label and a green chevron badge; switches are 40×22 with a
white knob; the 快捷键 capture control is the same pill with `按下...` as its empty state.

**Window rules that are easy to break**: the window has **no parent on purpose** (the shell
must be able to cover it and it must drag on its own), and nothing closes it for us — the
shell's `closed`, `auth:logout` and `before-quit` each call `closeSettingsWindow()`; drop one
and `window-all-closed` never fires. A theme change must repaint **four** things: the shell's
native title strip, the viewer, the settings window and both renderers through `evt:theme`
(`applyTheme()` is the one place). `appSettings.theme` is always the **resolved**
`light`/`dark`; `themePreference` is what is stored, and `nativeTheme.on('updated')` only acts
while the preference is `system`. 关闭主窗口 defaults to **quit**, not tray. 发送消息 is read
**at keydown time** (`useComposerInput` reads the store), never captured in a render.

**消息通知 (batch B's first group, 2026-11-23)**: 桌面通知 is the only local switch on
that panel — it belongs to this installation (`ui.db`, key `notifications.desktop`, default
on), and `NotificationCenter` reads it at delivery time, so turning it off stops the next
toast without a restart. The three scope groups are the account's state
(`getScopeNotificationSettings` / `setScopeNotificationSettings`), one per chat kind, and they
are **defaults**: a chat's own 免打扰 wins, which is what the panel's note says. 消息免打扰
is written as `mute_for = 2^31-1` (TDLib counts down to unmute; a flag would expire), and the
adapter reads the scope first because the setter **replaces the whole struct** — the story
and mention fields the panel does not show are copied back, not reset. 声音 is `sound_id`
(`'-1'` default, `'0'` off) and 预览 is `show_preview`.

**通用组的补全(2026-11-23):消息字号 / 开机自启**。消息字号是四档(小/标准/大/超大),存 `ui.db` 的
`messageTextSize`,默认「标准」就是既有的 14 px 正文——升级不改任何人的行高。它只缩放**消息文本**
(气泡正文、富文本块、图片说明、代码块),通道是 shell 写在 `<html>` 上的 `data-msg-size` →
`--wx-msg-scale`(`tokens.css`);**不要改成缩放 `:root` 字号**,那会连带放大会话列表、时间戳与
输入框,而客户端不这么做。富文本的 px 尺寸因此改成 `em`(含 `RichMessage` 的 `SECTION_SIZE`),
否则一条 Telegram 页面消息不会跟着缩放;虚拟列表靠 `measureElement` 重测,所以换档后行高自己收敛,
不需要手动 `measure()`。开机自启**没有本地配置**:真相是操作系统的登录项
(`app.getLoginItemSettings()`),每次 `settings:get` 读回、`settings:set` 直接写
`setLoginItemSettings`;**只有打包版可写**,开发运行里 `process.execPath` 是 `node_modules` 的
electron.exe,写进去就是一条打不开应用的启动项,所以 `canLaunchAtLogin=false` 时面板禁用该行。
两项的写入都发一条携带**整对** `{ sendKey, messageTextSize }` 的 `evt:settings`(`settings:set` 里
一次读齐再发)——半份事件是这个面板最容易留下的 bug。

### 5.11 How a channel post is composed

The owner's instruction (2026-11-20): "依旧是微信的气泡，但是像 Telegram 一样把图片、消息和
评论嵌入到一块". A channel has one author, so a post is one WeChat bubble (same fill, 6 px
radius, avatar column, hover row) whose *inside* is Telegram's composition: the media gets a
3 px inset of the bubble's own colour, the caption continues on the same surface, 评论 N 条 is
the last row (hairline above, the bubble's own bottom corners, no card of its own), and the
view counter with the time closes it (`ChannelMeta`). The hover timestamp is suppressed for
channels (no read receipt; counters are part of the post). Channel photos may grow to
420×480, every other chat keeps WeChat's 240×300. Two measured traps: the bubble's width is
taken **from the media** (`channelMediaWidth` + the 3 px inset), otherwise a long caption wins
the `fit-content` race and leaves empty bubble right of the picture; and the 评论 row is
`calc(100% + 2 × inset)` with negative margins — `width: auto` shrank it to its label.

### 5.12 Icon provenance (the part people get wrong)

**Where the artwork came from.**
`C:\Program Files\Tencent\Weixin\4.2.0.13\Weixin.dll` embeds **2346 complete SVG documents
as plain text** (`<svg viewBox="0 0 24 24">…`), outlines already expanded. Not compressed,
not obfuscated — a byte scan for `<svg` finds all of them.

**Dead ends — do not repeat:**

- The DLL also contains a 618-entry **zip** (`PK\x03\x04`): the web bundle, not icons.
- There **is** a 2615-entry manifest of asset names (UTF-16LE, sorted, with a `u16` and a
  `u32` per record). It does not index the payload block: `payload_offset − field` gives five
  different bases for five identified icons, and the two manifest copies disagree. The
  manifest's `u32` is not a hash with a lookup table either (`scissor_regular`'s tag occurs
  exactly once, at its own record; 2615 records, 2615 names, 2280 unique tags). **No
  name→payload mapping is recoverable from this build.**
- The `:/gui/svg/...` strings (238) are a runtime path table, not a static map.

**How icons were picked.** Crop each icon from the live client, binarise to a 24×24 ink mask,
render each candidate SVG at 24 px headless, compare by IoU / symmetric Chamfer distance on
outer contours, confirm the top hit by eye. Scripts: `.cache/wxsvg/*.py` (gitignored).

| Component | payload | Component | payload |
|---|---|---|---|
| `ContactsTabIcon` | `#1213` | `PlusIcon` | `#1435` |
| `CubeTabIcon` | `#1268` | `EmojiIcon` | `#0717` |
| `DeviceIcon` | `#0498` | `FolderIcon` | `#0436` |
| `MenuIcon` (≡) | `#0158` | `MicIcon` | `#0768` |
| `SearchIcon` | `#0760` | `CallBubbleIcon` | `#1206` |
| `NewGroupIcon` (＋) | `#0698` | `AddFriendIcon` (＋) | `#1463` |
| `NoteIcon` (＋) | `#0391` | `KeyboardIcon` (频道底栏) | `#1065` |
| `MoreIcon` (…) | `#0846` | `ScissorsIcon` | `#0859` |
| `CallIcon` | `#0300` | `ChevronDownIcon` | `#0555` (12×12) |
| `ContactsManageIcon` | `#0345` | `MessageOutlineIcon` (发消息) | `#0579` |
| `CallOutlineIcon` (语音聊天) | `#0079` | `VideoCallOutlineIcon` | `#0310` |

Viewer toolbar (eight of nine buttons are payload art): 置顶 `#0531` (`pushpin_regular`),
上一张/下一张 `#2344`/`#2336` (16), 放大/缩小 `#2341`/`#2342` (16), 原始大小 `#2337`
(`picture_original_normal`, literally a 1:1 pill), 旋转 `#2340` (`image_rotate_normal`, 24,
its `transform="scale(-1 1) translate(-24 0)"` is load-bearing), 保存 `#0776`
(`download_regular`). 预览 (3×3 board) has **no payload** and is traced. All are filled
`evenodd` outlines painted at `fill-opacity="0.9"` in the client; `ViewerIcons.tsx` drops
the opacity and fills `currentColor`.

- **Weight is per family**, not per library: regular/medium/heavy siblings differ only in
  stroke (measured at 24-unit scale: 1.12 / 1.38 / 1.88, with 0.88 and 1.62 in the tails).
  Match the lightest sibling — the cube, scissors and call bubble had to move down a weight
  or one icon read visibly bolder than its neighbours.
- The service-row `›` and the 联系人 `⌄` are `ChevronDownIcon` rotated −90°, not new art. The
  composer's filled `CallIcon`/`CallBubbleIcon` are a different weight from the outline family
  — do not swap them.
- `WechatIcons.tsx` is **generated** by `.cache/wxsvg/gen_icons.py` (drop width/height, strip
  `style`, `fill="black"` → `currentColor`, hyphenated attrs → JSX, one element per line),
  then `pnpm exec prettier --write`. Never hand-edit; the script's `ICONS` list is the
  complete set (`KeyboardIcon` was once lost by a regeneration).
- `MomentsTabIcon` uses WeChat's design-system compass
  (`.cache/wxres/tabBar_icons_outlined_discover.svg`) — the DLL has no compass with that
  needle. The rail's 聊天 tab, the login mark and the empty-pane watermark are the **Telegram**
  roundel (Simple Icons, CC0), tinted through `currentColor`.
- **`masks.npz` can be clobbered**: `render.py <file…>` rewrites the archive with only the
  named files; re-render before trusting a mask.
- **Licence:** the extracted artwork is Tencent's. Fine for this local clone, **not for
  redistribution** — do not ship it in a package.

### 5.13 Deliberate deltas vs the client

| Delta | Why |
|---|---|
| Composer toolbar keeps WeChat's five buttons (表情 / 收藏 cube / 文件夹 / 剪刀+chevron / 麦克风); 收藏, 剪刀 and the tool-row 麦克风 toast "还没有接入" | favourites and screenshot have no protocol source; the tool-row mic is the client's **dictation**, not voice notes (§7). The client's right-hand 语音输入 circle is left out — 发送 follows the toolbar. Voice notes live on the circled mic beside 发送 |
| Avatars are real where the protocol carries them, initials elsewhere | `Self.avatarUrl`, `ChatSummary.avatarUrl`, `Message.senderAvatarUrl` + `evt:avatars`; a cold row shows its initial for a moment — intended, not a missing image |
| 通讯录 is Telegram's address book, not the chat list | `getContacts` + `getUser`: a person you never wrote to still has a card; 发消息 creates the chat. Service rows are kept for the silhouette (公众号、服务号 shows the channel count; the rest toast) |
| Chinese initials come from ICU, not a pinyin table | `contactInitial` compares the first Han character against 23 boundary characters with `Intl.Collator('zh-Hans-CN')`; polyphones (重/长) can land a letter off |
| The contact card shows Telegram号 (= username) / 数据中心 / 手机号 | WeChat's 微信号 / 来源 / 添加时间 do not exist; the DC is decoded from the photo's persistent file id (`tdlib/file-dc.ts`, approximate — 未知 without a photo) |
| No pin (always-on-top) button in the title strip; window controls are the native overlay ones (~46 px vs the client's ~30) | not implemented / native |
| List column is a fixed 238 px | the client lets you drag it |
| Search is a server search with 聊天 / 频道 only | missing vs the client: 应用/贴文/图片/视频/音频/链接 filters, 联系人 hits, archived chats (the pill asks `chatListMain`) |
| The only inferred dark value is the link blue (`#576b95`, kept from light) | everything else was sampled |
| Re-selecting the open conversation closes it; the rail switches sections | requested 2026-11-17; the client's filled tab payloads are not in the extracted set, so `Icon.tsx` rebuilds the three filled glyphs from the outlined geometry |
| The ＋ card matches the client's three entries but none is wired | no create-chat / contact-search / notes channel |
| Viewer: no 编辑 and no "用 AI 处理" block; 预览 is a 268 px column, not a second window; 定位到聊天位置 keeps the viewer open and raises the shell instead | no editor / no AI / one window / the viewer is a plain top-level window (see below) |
| One window size for photos and videos; no 查看原视频 pill; video never zooms or pans; 保存 goes to 视频 | the video window is 80 % wide vs the photo window's 75 % in the client, but a strip can mix both; TDLib hands over one file per video, so the pill would be dead |
| The viewer is a **plain top-level window**, not a child of the shell | that is what makes the task bar match the client (one button whose preview lists both windows). Ownership never grouped them differently anyway; what ownership gave is now explicit — the shell hide/show/closes the viewer itself |
| Login: QR produced locally, footer is 用手机号登录 ｜ 登录帮助, gear and × hand-drawn, fixed 280×373, centred on the primary display | `仅传输文件` has no Telegram counterpart; the glyphs are not in the payload set; the client also is not resizable but remembers its position |
| Comments = Telegram's discussion view, not WeChat's inline expansion | owner's call 2026-11-20; rows are the transcript's own `MessageRow`, input is the shared composer card, footer gates on join-to-send; no 赞/在看/收藏 reactions |
| 聊天信息 maps the client's group rows onto Telegram: 群公告 = newest pinned message, 群二维码 = invite link, 添加 = invite sheet; 备注 / 我在本群的昵称 / 保存到通讯录 / 显示群成员昵称 are absent | no Telegram counterpart (the profile name is shown, groups are already in the list) |
| A channel's bottom card is 加入 / 申请加入 until the account subscribes | a public channel is readable before joining; 静音 on an unjoined channel muted nothing |
| Emoji are Apple artwork as a CBDT colour font (`WeGramEmoji.ttf`, 25 MB, built by `scripts/emoji-font.py`), family first in `--wx-font` | Apple's own sbix file does not paint in Chromium on Windows; CBDT does. ASCII digits, `#` and `*` are kept out of the cmap so a digit cannot resolve to a blank keycap — keycaps fall back to the system font. Provenance and licensing: `renderer/src/assets/fonts/NOTICE.md` |

---

## 6. Measured behaviour and pitfalls — do not re-derive

Every entry below was measured on this machine, most of them against the real account. They
are grouped by the layer that owns the rule; the code comments carry the same facts.

### 6.1 History, paging, and the message store

- **`getChatHistory` anchoring.** `from_message_id = 0` does **not** fetch from the server —
  it returns only the locally cached last message. The first page anchors on
  `chat.last_message.id`; paging older anchors on the oldest loaded id and filters
  `id < anchor`. A negative `offset` returns *newer* messages, so it cannot page backwards.
  First server fetch of 50 messages took ~3.4 s.
- **`from_message_id` is exclusive** (measured 2026-11-17). A first page anchored exactly on
  `last_message.id` never contained the newest message, and `openChat` marked the message
  *below* it as read — so every chat kept a badge of at least 1 (reproduced on 心惊报:
  `last_read_inbox_message_id` stayed one post behind, `from=4975493120` answered
  `4974444544`). Fixed: the implicit first-page anchor is `last_message.id + 1`, and
  `openChat` reads up to `getChat.last_message.id` directly instead of trusting a page. The
  renderer additionally reports the newest message as read while the chat is open in a
  focused, visible window. `mapChat` omits `lastReadInboxMessageId` when TDLib reports 0 —
  0 means "nothing read yet", not message 0 — so the divider falls back to the unread counter.
- **A short answer is normal, not the end of the chat.** For a cold chat TDLib answers from
  its local window — measured 1 to 5 messages in 1–7 ms — even when the chat has thousands.
  Re-anchoring *below* the oldest returned id is what makes it go to the server (50 in
  65–230 ms). `history()` therefore tops a page up over up to `MAX_HISTORY_ROUNDS = 3` rounds
  and only an **empty** round means "the chat begins here"; `hasMore` is
  `!exhausted && messages.length > 0`. The old `raw.length >= limit` turned every cold chat
  into "no more history" (this is the owner's "群组加载旧消息无法加载").
- **An empty first page is not an empty chat.** A cold local database can answer `[]`; the
  renderer used to cache that and the transcript stayed blank all session. Now the page is
  retried three times *and* an empty answer is not cached at all while the chat list says the
  chat has messages (`ChatSummary.lastMessageAt`) — the entry simply stays absent, so the
  next open asks again, and the placeholder says 消息还没从服务器同步下来 instead of claiming
  the chat is empty. A genuinely empty chat still caches its page. The adapter logs both
  halves (`no last_message` / `getChatHistory returned nothing`).
- **Never create a `messagesByChat` entry for an unloaded chat.** `updateChatReadInbox` fires
  for *every* chat; `applyMessageOps` used to write `messagesByChat[chatId] = []`, and
  `ChatPane` reads "an entry exists" as "cached", so every chat the read marker touched
  opened empty and could never page. Entries come only from
  `setHistory`/`prependHistory`.
- **…but the ops of an unloaded chat must not be dropped.** While a first page was in flight,
  ops were thrown away and the later `setHistory` wrote the pre-event snapshot. The store
  queues meaningful ops in `pendingOps[chatId]` (pure read-marker batches are skipped) and
  `setHistory` replays the queue onto the fresh page (`reduceOps`, shared with
  `applyMessageOps`). A failed first fetch retries once quietly after 1.5 s before giving up.
- **`updateDeleteMessages` is not always a deletion.** The update carries `is_permanent` and
  `from_cache`; `from_cache: true` means "removed from the local cache, retrievable later".
  TDLib emits those while the app idles in the background: leaving the window occluded for
  ~2 minutes produced `{from_cache: true, is_permanent: false}` for **all 50** cached
  messages of the open chat, and the adapter treated it as a user deletion — the
  "切到后台再切回来消息就没了" bug. Only `from_cache !== true` removes rows; evictions are
  logged, and the renderer refetches once when a transcript that *had* rows goes empty.
- **Editing content is a full remap.** `updateMessageContent` can change media/captions, so
  the adapter fetches the message and emits a `replace` op, not an `edit` with just text.
- **`updateChatAction` is one-shot** — there is no "stopped typing" you can rely on, so the
  renderer schedules an expiry from `until`; without it the header claims 对方正在输入… forever.
- **`sender_id` has two shapes**: `messageSenderUser { user_id }` **or**
  `messageSenderChat { chat_id }`; channel posts and anonymous admins fill only the latter.
  Reading `user_id` alone left them 未知. `Message.senderChatId` + a chat-title cache
  (`chatTitles`, filled from `mapChat` and `updateChatTitle`) fixed it. Measured on the real
  account: 20/20 channel messages use `messageSenderChat`.
- **A comment thread is a TDLib message thread and the count is free.**
  `message.interaction_info.reply_info.reply_count` is filled only for channel posts with a
  linked discussion group and for the posts inside that group.
  `getMessageThreadHistory` takes the *commented* message's `chat_id`; for a channel post
  TDLib routes to the linked supergroup itself. It answers newest-first with an exclusive
  `from_message_id`. Four measured facts: (a) `message.properties` **does not exist** in
  1.8.70 — that read was always `undefined`, so "this post owns a thread" is
  `reply_info` being present, which is true from `reply_count: 0` (a 0-comment thread draws
  the bar as 写评论, or nobody could be first); (b) a 0-comment thread answers
  **"Receive messages in an unexpected chat"**, so the panel seeds an empty page instead of
  asking; (c) `updateMessageInteractionInfo` fires on every view and may carry **no**
  `reply_info`, so the `interaction` op is a partial patch — the old `?? { comments: 0 }`
  fallback zeroed a real count and the bar vanished; (d) the handle is a **channel-post**
  feature, not a `reply_info` one — group rows inside a discussion group also report
  `reply_info`, and a count-only test drew 写评论 under ordinary group messages. The
  official clients gate on the post (tdesktop `checkDiscussionLink`), and so does
  `isCommentablePost`: channel chats only.
- **`sendMessage` answers with TDLib's local id** and `editMessageText`/`deleteMessages` on
  that id fail ("Message not found") until `updateMessageSendSucceeded` swaps in the server
  id (`td-5242881` → `6291456`). The swap is real and is handled as a re-key: the
  `replaceId` op keeps the row in place.
- **A vote is not echoed by the command.** `setPollAnswer` answers `Ok`; the changed poll
  arrives later as `updateMessageContent` (a `replace`), so the renderer must not invent
  counters locally. Quiz correct answers stay empty until the account answers or the poll
  closes.
- **The poll schema is newer than the version number suggests**: 1.8.70 (c8828d50) already
  has `pollOption.id`, `option_order`, `can_see_results`, `can_add_option`,
  `vote_restriction_reason`. `setPollAnswer` takes `chat_id`/`message_id`/`option_ids`, and
  `option_ids` are **positions**, not id strings; a poll whose `option_order` is non-empty is
  drawn in that order while still voting by position.
- **Real unread counts are large** (hundreds of thousands on unfollowed groups) — data, not a
  mapping bug.

### 6.2 Scroll, anchors and virtualisation

- **Virtualised prepend needs two stages**: rough compensation from the height delta for a
  few frames (the virtualizer remeasures over several frames), then exact correction against
  the anchor row's DOM offset. Anchor-only fails because right after a prepend the anchor row
  is outside the rendered window and has no DOM node.
- **Older history has to be *prefetched*, not fetched at the top.** The fetch itself is the
  jank: a page comes from TDLib's cache or the server (~3.4 s cold, which is why
  `LOAD_OLDER_TIMEOUT_MS` exists), while a wheel gesture covers the last screen in about a
  second — the reader hits `scrollTop < 160` and the wheel goes dead until the page lands.
  `useChatHistory.prefetchOlder` keeps one page in `olderPagesByChat` (on mount and after
  every landing); `loadOlder` only prepends it, so 正在加载更早的消息… no longer shows in
  normal reading. The buffer is a *snapshot*: dropped when a buffered row is deleted/edited,
  when `setHistory` replaces the window, and an empty answer is never buffered.
- **A programmatic `scrollTop` write desyncs `@tanstack/react-virtual`.** Row transforms come
  from the virtualizer's own `scrollOffset`, refreshed only on real scroll events, so landing
  at the bottom / restoring an anchor / compensating a prepend can leave it painting the top
  of the history while the element sits elsewhere — rows off-screen, pane looks blank (or
  shows a slice of very old messages) with an empty tail, while `scrollTop` still reports
  "at the bottom". Fix: `MessageList.resyncScroller()` dispatches one `scroll` event after
  every programmatic scroll (measured: 13 rows at y −4842…−2708 before, the real
  2025↔today window at −1098…+394 after), and `stickToNewest()` uses
  `virtualizer.scrollToEnd()` and re-sticks at 150/400 ms.
- **The chat list pages on approach, and asks for the photos of what it shows.** The
  conversation rows have been virtualised since 2026-11-18 (`ChatList.tsx`: `CHAT_ROW_H` 65,
  `LIST_OVERSCAN` 8, sizer + translated slots; `ArchivePage.tsx` the same), so the old
  "526 rows render at once" note was stale. What was missing was *data*: the shell fetched
  one 100-row page and stopped, so a chat below it only appeared when TDLib pushed an update
  (measured on this account: **321 chats**, 100/100/100/21 across offsets with **0 overlap**).
  The virtual window now asks for the next slice within `CHAT_LOAD_AHEAD` (30) rows of the
  loaded end and merges it by id; the event-gap resync merges the first page the same way, so
  a repair no longer drops the pages the reader had loaded. Photos: the adapter's pool only
  prefetches the page it is handed, and `ChatRow` draws `chat.avatarUrl` alone, so rows paged
  in would keep their initials — the list now hands the missing ids of the visible window to
  `chats:prefetchAvatars`, and the finished photos arrive as ordinary `chats` upserts
  (measured: the 4 ids asked for came back as 4 avatar upserts).
- **Restoring a reading position needs all three pieces**: (a) the list must not mount before
  the stored anchor is known, or a cached chat captures the bottom as its position; (b)
  `scrollToIndex` is only an estimate with dynamic heights, so the position is corrected
  against the anchor row's DOM node; (c) `unpin()` must run before restoring or the
  stick-to-bottom `ResizeObserver` undoes it. The anchor is "first visible slot + its offset",
  and *no row at all* means "was at the bottom".
- **"Anchor known" must be reset during render, not in an effect.** An effect reset let the
  render for a *new* chat carry the old chat's `true`, so `ChatPane` mounted the list one
  frame early at the bottom and wrote `bottom` into `ui.db` before the new chat's
  `ui:getAnchor` answered (measured: stored `{14958, -46}` read back as `null` on the next
  open — every *cached* chat reopened at the bottom). The reset is now an in-render state
  adjustment (`stateChatId !== activeChatId`). The cold path was never affected.
- **The stick-to-bottom pin is a function of geometry, not of scroll events.**
  `lib/scrollGeometry.ts` (`readScrollPin`) is the single rule; `useAnchoredScroll`
  re-derives it from both `ResizeObserver`s (content *and* container) and after a restore, and
  `useAnchorSave` uses the same predicate. A transcript shorter than the viewport never
  scrolls, so waiting for a scroll event leaves `atBottom === false` forever — the next
  message raises "↓ N 条新消息" over a message the reader can see, and the list stops
  following. Three measured ways in: a restored anchor whose rows measure shorter than
  `estimateSize: 68`, a window grown until the transcript fits, a transcript that shrank. A
  layout change is also when a stored anchor becomes unusable, so the list then records
  "bottom" once.
- **Saving the anchor**: the save path is corrected for a real-account bug — the position was
  often never written. Two causes: a single 250 ms debounce that *re-measured* in the timer
  and bailed whenever a page was in flight (the common case while reading up), and a dead
  "write on unmount" net (React nulls `scrollRef.current` before passive cleanups). Now the
  first scroll of a burst writes immediately, later ones collapse into one trailing write,
  the last measurement is kept in `latestAnchorRef` and flushed on unmount without touching
  the DOM, prepend compensation no longer suppresses saving (only
  `restoringRef`/`programmaticRef` do), and a hung `messages:history` is capped at 15 s.
  Verified: scroll → close the app within the same second → `ui.db` holds the new position.
- **Load-around beats a page budget.** When the saved row or the unread boundary is older
  than the newest page, `useChatHistory` asks for a window *around* it (`messages:around`):
  the adapter merges an older page, `getMessage` for the anchor (`getChatHistory` is
  exclusive) and a *negative-offset* `getChatHistory` for the newer half. The window stops
  short of the newest message and `hasNewer` says so; live arrivals are queued instead of
  spliced under the window's last row, reaching the window end appends `messages:newer`, and
  the buoy / every send path replace the window with the newest page before acting.
- **`position: fixed` inside a virtualised row is broken**: rows are positioned with
  `transform: translateY(...)`, which makes them the containing block for fixed descendants
  (a lightbox was confined to the row). Media overlays go through
  `createPortal(..., document.body)`.
- **Never put a percentage `max-width` on the bubble itself** — on a flex child it resolves
  against the content size and collapses to min-content. It lives on `.wx-message-stack`.

### 6.3 The visibility gate (never gate content on layout timing)

- **The gate could never open under React StrictMode**: the mount layout effect runs twice;
  the first pass set `initialisedRef` and scheduled a frame, the cleanup cancelled it, the
  second pass returned early — `visibility: hidden` forever. Do not cancel the frame, and add
  a 150 ms `setTimeout` fallback because rAF is throttled while the window is occluded.
- **Occlusion still froze the list after that fix** (real account: 12 rows in the DOM,
  `scrollHeight 9968`, `messages:history` answering 50 in 8 ms, `wx-messages--pending` stuck
  on) because the anchor-restore path waited on rAF and released the gate in its
  `.finally`. Three layers now prevent a permanently hidden transcript: a 700 ms
  `setTimeout(markReady)` beside the restore, a 900 ms deadline inside `restoreToAnchor`
  (frames alone are not a bound), and a watchdog that force-readies any list that has
  messages but is not ready after 1 s.
- **Diagnosis recipe for a "blank" transcript**: check
  `document.querySelector('[data-testid="message-scroller"]').className`; if it still has
  `wx-messages--pending` while `.wx-message-slot` rows exist, the messages are there and
  only the gate is stuck. Look at `restoreToAnchor` first, not at the data.

### 6.4 Media: protocol, downloads, streaming, avatars

- **`wx-media://` must be declared before `app.whenReady()`** with
  `protocol.registerSchemesAsPrivileged` (standard/secure/supportFetchAPI/stream/**corsEnabled**),
  or `<img>`/`<video>`/`fetch` cannot load it, and the CSP needs it in **`connect-src`**, not
  just `img-src` (TGS is fetched as bytes then gunzipped). Without `corsEnabled` a renderer on
  `file://` counts as another origin and Chromium refuses the fetch outright ("Cross origin
  requests are only supported for protocol schemes…"), after which every TGS sticker fell
  back to its glyph. The handler answers `access-control-allow-origin: *` and streams with
  Range support; it resolves opaque tokens only — request paths are never used for file
  access. Only adapters (and the mock) register a path.
- **`downloadFile(synchronous: true)` occupies a TDLib request slot** until the file is
  complete. Fine for user-triggered media, fatal for avatars: the adapter runs a **4-wide
  worker pool at priority 1**, dedupes per chat id (queue / in-flight / done / no-photo), and
  never emits `evt:file` for them (`fetchFilePath()` is the silent variant,
  `downloadFile()` the progress one). On a saturated tunnel one thumbnail took 16 s; if
  opening a chat feels starved after start-up, this queue is the first suspect. Finished
  photos are pushed as `chats` upserts coalesced over 120 ms.
- **Profile photos use `getChat`/`getMe` → `profile_photo.small`** (or `chat.photo.small`),
  not the media pipeline; the file is registered exactly like an attachment, so the renderer
  only sees `wx-media://f/<token>`. The rail's own photo is fetched in the background and
  announced with a second `auth` event, so authorisation never waits on the network;
  `updateUser` (self) and `updateChatPhoto` invalidate and refetch.
- **Sender photos ride the same pool and a second event.** `mapMessage` never waits for a
  photo: it copies the cached URL then queues the sender through the pool; finished ones are
  batched into `evt:avatars` keyed by user id (one person's photo serves every chat) instead
  of re-emitting messages — a page cannot patch 40 rows without a refetch. Consequences: the
  pool is shared with chat photos (a big group right after start-up queues dozens of
  senders); "no photo" is remembered for the session; `updateUser` for somebody else refetches
  only when the file id changed (it also fires for name-only changes).
- **A bubble must ask for the photo size its box needs, not the original.** `photoMedia` maps
  the whole `photo.sizes` table and `lib/mediaVariant.ts` picks the smallest variant covering
  `box × devicePixelRatio` — a 240 px bubble on a 100 % display wants the 320 px file, not the
  1280 px one (this was the biggest single cost of opening a cold chat). `fileId` still names
  the largest (保存 / 复制 / viewer).
- **The bytes TDLib has written are a sparse file**: `stat().size` is the *full* size.
  Streaming therefore asks `getFileDownloadedPrefixSize(fileId, offset)` for the contiguous
  run and reads the file directly (main and TDLib share one process, so `readFilePart` is
  unnecessary). `downloadFile(offset, limit: 0, synchronous: false)` starts or re-targets the
  transfer; a *different* offset is a seek and cancels the previous range; on a stall the pump
  re-sends the same offset once a second.
- **The first `downloadFile` answer describes the file *before* the transfer was queued**: a
  cold clip comes back with empty `local.path` and `expected_size: 0` (both arrive with the
  next `updateFile`). The first click used to answer "File 1304 cannot be streamed yet" while
  the download was starting; the path appeared **500 ms** after the click. `beginStream` now
  polls `getFile` (100 ms, 4 s cap) until the state is usable.
- **A cancel must be refcounted, or two windows cancel each other.**
  `media/leases.ts` counts holders per file: `media:download` holds, `media:cancel` drops,
  `cancelDownloadFile` runs only when the last holder leaves. Owners are per hook instance:
  a StrictMode remount runs cleanup→setup, so the cleanup's cancel waits
  `RELEASE_GRACE_MS` (250 ms) and a re-hold clears the timer. Without it the second mount
  waits on the promise its own cleanup killed and the picture never appears (dev only).
- **A video bubble must not download the clip.** It used to call `media:download` at priority
  6 on mount, so a chat with a few videos queued every clip and starved the requests the
  reader waited for. The bubble fetches only the poster (`thumbFileId`); the viewer streams
  the file, so playback starts after a few hundred kB.
- **`inputMessagePhoto` has no width/height in this TDLib.** Dimensions live on `inputPhoto`,
  so a photo cannot be sent without knowing its pixel size: main parses PNG/JPEG/WebP/GIF
  headers first, and when it cannot, the file is sent as a document instead of drawing a
  broken photo bubble. `inputMessageSticker` also needs `width`/`height` and an emoji.
- **`userData` is pinned to `%APPDATA%\WeGram`** via `app.setName`/`setPath`, because the package
  name is `@wegram/desktop` and would otherwise create a nested folder.

### 6.5 Stickers, emoji and effects

- **Sticker set ids are int64 strings** — they cross IPC as strings; a sticker is identified
  by its numeric file id. `getInstalledStickerSets` returns only summaries; the grid needs a
  second `getStickerSet`.
- **The installed list ships a tab icon in `covers`, not `thumbnail`** (measured: `thumbnail`
  was null for 6 of 8 visible sets, `covers` held the first sticker every time; all 192 sets
  had an icon after the tdesktop-style lookup).
- **A sticker's thumbnail is not the sticker's format.** TDLib serves a static WebP as
  `sticker.thumbnail` even for TGS/WebM stickers, so a grid that paints the thumbnail must
  switch on `thumbFormat` (`MessageMedia.stickerThumbFormat`); reusing `stickerFormat` sent
  WebP bytes through lottie-web (gzip throw → emoji fallback, **38/38** cells of a TGS pack)
  and through `<video>` (`MEDIA_ERR_SRC_NOT_SUPPORTED`, `videoWidth === 0` → blank, **120/120**
  cells of a WebM pack). Chat bubbles were fine because they draw the full file. Static WebP
  packs were the only ones that ever worked — that is the whole "some packs load, some don't".
- **One emoji is not a text message**: `can_be_animated_emoji` (client side) turns a message
  whose whole text is one emoji (or one custom-emoji entity covering it) into
  `messageAnimatedEmoji` carrying the AnimatedEmoji sticker plus a click sound (an
  OGG/Opus file downloaded only on the first click). Rendering per §5.6.
- **Custom emoji are stickers keyed by an id, not characters**: `textEntityTypeCustomEmoji`
  carries only `custom_emoji_id`; `getCustomEmojiStickers` answers **in arbitrary order and
  only for the ids it knows**, so the response must be keyed by `full_type.custom_emoji_id`,
  never by position. Up to 200 ids per call.
- **A premium sticker's effect is a second file and `is_premium` is the switch**: the effect
  is `sticker.full_type.premium_animation`, and the mapper only carries
  `MessageMedia.premiumEffectFileId` when both say yes (the flag can stand while the file is
  unknown). Fixture lesson: a first TGS effect built from polystar/ellipse shapes with animated
  position/scale parsed fine and drew **nothing** (every layer's bbox 0 × 0); rounded rects
  with animated opacity/rotation render. Keep fixture TGS art to constructs the existing
  fixture proves.

### 6.6 Proxy, login, windows, process

- **A pending QR login cannot be cancelled in TDLib.** `requestQrCodeAuthentication` works from
  `waitPhoneNumber`, then TDLib keeps re-sending `authorizationStateWaitOtherDeviceConfirmation`
  with a fresh link. `setAuthenticationPhoneNumber` is refused in that state and there is no
  cancel call, so the phone fallback restarts the client (`auth:reset` → destroy + new
  client). Do not "optimise" that into a direct phone submit.
- **The login window is a real second window.** Before sign-in completes the shell does not
  exist, so closing the login window (× / Alt+F4) quits through `window-all-closed`; after the
  hand-over the shell is the only window, and signing out recreates the login window *before*
  closing the shell. If a run leaves two windows or none, check `syncWindowsToAuth` /
  `showMainWindow`.
- **Login needs three submits**; the field is re-focused after each step by a focus effect —
  if that regresses, typing goes nowhere.
- **`titleBarOverlay` buttons are painted above web content**, so the title bar reserves space
  with `padding-right: calc(16px + (100% - env(titlebar-area-x, 0px) -
  env(titlebar-area-width, 100%)))`; a fixed spacer only pushes content into the buttons. The
  overlay colour must be repainted from main on theme change, and **whatever sits under the
  controls must match it** (rail colour, 32 px) or the bitmap shows a seam. The overlay covers
  only the right-hand control area. The login window is a separate case: `frame: false`,
  its own × and gear, no overlay.
- A hidden transcript, a slow avatar, or a sender photo that never appears are §6.3/§6.4
  symptoms, not data bugs — read those before touching the list or the pool.
- **Electron 45 changed two things this code depended on**: `clipboard.writeImage()` is gone
  (the clipboard is the web-standard async API, so 复制图片 writes `new ClipboardItem({
  'image/png': blob })` through `clipboard.write()`), and the binary no longer comes from a
  `postinstall` (`install-electron` bin → `pnpm electron:install`).
- **The mock adapter floods new messages** every few seconds (`(mock) 新消息 #n`) and unread
  counters grow — the fixture, not a regression.
- **A response shape is checked by the handler map, not at runtime.** `chats:inviteLink` was
  declared `{ link: string }` while the adapter returned a bare string; `answer?.link`
  resolved to **`String.prototype.link`**, and passing that function to `useState` made React
  call it as an updater — the renderer crashed and the window closed. The map is now typed by
  `InvokeResponse<C>`; if a response ever looks like a function, suspect this class of
  mismatch, not React.

### 6.7 Private-chat behaviour that was measured (P0/P1 batches)

- **Typing is renderer-side throttled, never thrown**: `lib/typingPing.ts` sends one
  `messages:typing` immediately and at most one refresh per 3.5 s; emptying the box, send,
  chat switch or blur sends the cancel. The adapter swallows TDLib failures on purpose
  (ambient presence must not raise the error bar). The mock has no peer, so the indicator is
  only observable against a real account.
- **标为未读 is a flag, not a counter** (`chat.is_marked_as_unread`); the row draws a bare dot
  when there is no count, and opening the chat clears the flag.
- **删除聊天 is local**: `deleteChatHistory(remove_from_chat_list: true, revoke: false)` —
  never `deleteChat`, which deletes the history for every member. The `remove` op drops the
  transcript, queued ops, paging state and the selection with the row.
- **Presence is a stream, not a chat field**: `users:status` answers once per open private
  chat, `evt:status` keeps it live, copy in `lib/presence.ts` (在线 / 刚刚在线 / 今天 HH:mm /
  昨天 HH:mm / M月D日 HH:mm / coarse). It sits **after the name inside the 48 px header**,
  styled like the typing label, so the transcript never re-flows; typing wins when both exist.
- **Notifications come from TDLib's notification objects**, not `updateNewMessage`:
  `updateNotification` and `updateNotificationGroup.added_notifications` are forwarded as a
  main-only `notification` adapter event (`notificationTypeNewMessage` only). Main builds the
  Electron `Notification`, flashes the task bar, suppresses the toast for the chat the focused
  shell is showing (`ui:setActiveChat`, null when the pane is closed or 通讯录 is showing),
  and a click raises the shell and publishes `evt:locate`; a chat not yet in the list is
  fetched with `chats:get` first.
- **相册发送 is one call** (`sendMessageAlbum`, 2–10 photos); every row carries the album id, so
  the transcript folds them into the bubble it already draws for a received album. Documents
  still send one message per file (`rows.ts` only folds photo/video).
- **The 置顶消息 bar sits above the transcript**, never inside the scroller (it must not
  re-measure the virtualised list): text + 定位 + ×, the menu item flips to 取消置顶 for the
  pinned row, and an unpin resolves the current pin because `unpinChatMessage` wants its id.
- **语音转文字 streams through the voice note's own content**: `recognizeSpeech` answers
  `Ok`, and the finished text arrives as a content update through the ordinary `replace` op —
  no polling, no extra event; `pending` keeps the partial text on screen. Gated on
  `can_recognize_speech`.
- **Reactions arrive as a full list** (`updateMessageReactions`): replace wholesale (an empty
  list removes the chips), tint the chosen ones, draw a Premium custom-emoji reaction as its
  sticker art. Display only — WeChat has no reactions and the picker is still an open product
  decision.
- **`reportChat` is two-phase and the reason list is the server's**: empty `option_id` →
  `reportChatResultOptionRequired { title, options }` → the chosen id (+ optional
  `message_ids` / `text`), and `reportChatResultTextRequired.is_optional` may skip the
  comment. Ids are TDLib `bytes`, passed through verbatim as base64; the labels are already
  localized by Telegram and cannot be re-derived (1.8.70 has no `type` field). **Which chats
  are reportable is TDLib's rule**: a user only if `is_bot`, a basic group never, a
  channel/supergroup unless the account is its creator — so 举报 appears on channel/supergroup
  posts and in a bot's chat, nowhere else.
- **The profile card never patches a field locally**: every write (`setUserNote`,
  `setMessageSenderBlockList`, `addContact`, `removeContacts`) answers the refreshed card.
  共同群聊 shows `group_in_common_count` and fetches one page of rows (`getGroupsInCommon`,
  `limit: 50`, `offset` = `offset_chat_id`) only when the reader opens the row.
- **Caption edit reads `show_caption_above_media` back first** (`getMessage`), so an edit never
  moves a caption from above the picture to below it; an empty caption clears it.
- **Voice notes**: WebCodecs `AudioEncoder` gives raw Opus and the OGG container is written
  in-repo (`renderer/lib/voice/oggOpus.ts`), so no dependency was added and `MediaRecorder`'s
  inability to emit `audio/ogg` (`isTypeSupported` false on this machine) is moot. Bytes cross
  IPC (base64 + duration + replyTo), main writes `userData/voice/voice-<stamp>-<rand>.ogg`
  and prunes files older than 6 h at the next start (a failed send deletes at once — the
  upload starts *after* `sendMessage` answers, so the file must outlive the call). The
  waveform is sent **empty on purpose** (the 5-bit packing is undefined and the bubble's wave
  is decorative); the server accepted it on the test DC. A cancel pressed while the
  microphone is still opening is remembered in the session ref and applied when it lands;
  60 s auto-sends. Mic permission is narrowed to the shell window
  (`setPermissionRequestHandler` + `setPermissionCheckHandler`); the login, 群二维码 and viewer
  windows cannot open a device. The comment composer shares the card but passes no
  `onSendVoice`, so its mic still toasts.
- **`addContact` answers before `user.is_contact` flips** (measured ~1.2 s on the test DC):
  a card painted from one `getUser` kept showing 添加为联系人 after the toast had already said
  已添加. `setUserContact` waits for the flag (150 ms polls, 3 s cap) and answers the settled
  card; the same lag applies to `removeContacts`.
- **`setUserNote` needs a contact**: TDLib answers `User isn't a contact` for anybody outside
  the address book, so the 资料卡 opens its 备注 row only for `isContact` and explains the
  order otherwise ("添加为联系人后可写备注"). WeChat writes a remark on anyone; Telegram does
  not, and pretending otherwise is an error toast.
- **`reportChat` can need more than two phases**: a *bot* report goes reason list →
  "what is wrong with this bot?" (a second option list with **new** ids) → filed. The sheet
  already treats any non-final answer as "the list again", which is what makes the chain work;
  the ids must come from the last answer only, never be cached across phases.
- **举报 is reachable for bots only** (confirmed against the test DC): @spambot's chat reports
  and files, while a human's private chat answers `can_report_chat: false` — which is why a
  person's card carries no 举报 button.
- **A dead proxy does not fail a send** (measured 2026-11-23): pointing TDLib at a closed port
  left the message `pending` for 120 s — TDLib queues and retries instead of raising
  `updateMessageSendFailed`, so 重试 cannot be forced that way. A failed row needs a *server*
  rejection, which the test DC does not produce on demand.
- **The test DC's speech recogniser is intermittent**: the same clip produced a finished
  transcript ("[en-US]") once and `TRANSCRIPTION_FAILED` on the later runs. The check retries
  with a freshly uploaded clip; a permanent failure is the server, not the mapping.

---

## 7. Private chat (1:1): gap audit, API map, status

This section is the audit of 2026-11-22, kept as a status map. Every API name was read from
the **TDLib 1.8.70 scheme pinned by the installed `prebuilt-tdlib`**, not from memory.

### 7.1 API source of truth

- `apps/desktop/package.json` → `prebuilt-tdlib: 0.1008070.0`; that package's metadata says
  `tdlib.version: 1.8.70`, `tdlib.commit: c8828d50f5eac2fc7089ce1089d7ce9095c61b5e`.
- The matching scheme is the authority:
  [`td_api.tl` @ c8828d5](https://github.com/tdlib/td/blob/c8828d50f5eac2fc7089ce1089d7ce9095c61b5e/td/generate/scheme/td_api.tl).
  Fetch it to the gitignored `.cache/` and grep instead of trusting memory:

```powershell
Invoke-WebRequest -UseBasicParsing `
  -Uri 'https://raw.githubusercontent.com/tdlib/td/c8828d50f5eac2fc7089ce1089d7ce9095c61b5e/td/generate/scheme/td_api.tl' `
  -OutFile '.cache/td_api.tl'
```

- Read the `//@description` block above a constructor, not just the signature. Three examples
  that move an estimate: `inputVoiceNote` requires Opus in an OGG container;
  `inputVideoNote` requires MPEG4/H.264 with `length <= 640`;
  `messageSchedulingStateSendWhenOnline` and `messageSendOptions.effect_id` are private-chat
  only.
- If TDLib is upgraded, re-run the audit against the new commit: the seam still typechecks
  when a field was renamed, because `actions/` talks in `TdObject`.

### 7.2 Gap inventory

Legend: P0 daily use · P1 next · P2 later · scope-out decided against. Each row says what
is actually in the tree today, not what the 2026-11-22 audit found missing.

| P | Gap | Status | TDLib 1.8.70 API |
|---|---|---|---|
| P0 | Send failure + 重试 | **done** — `sendingState/sendError/canRetry`, ops `sendState`/`replaceId`, `messages:resend`, 未发送 row | `updateMessageSendFailed`/`Succeeded`, `messageSendingStateFailed`, `resendMessages` |
| P0 | Outgoing typing | **done** — `messages:typing`, `lib/typingPing.ts` | `sendChatAction` + `chatActionTyping`/`chatActionCancel` |
| P0 | Online / last seen | **done** — `users:status` + `evt:status`, `map/status.ts`, `lib/presence.ts`, header line | `user.status`, `updateUserStatus`, `userStatusOnline/Offline/Recently/LastWeek/LastMonth` |
| P0 | 删除聊天 / 标为未读 | **done** — `chats:delete`, `chats:setUnread`, `ChatSummary.markedUnread`, row context menu | `deleteChatHistory`, `toggleChatIsMarkedAsUnread` + update |
| P0 | Notifications / tray | **done (toast/tray unverified here)** — adapter `notification` event, `main/notifications.ts`, `main/tray.ts`, `ui:setActiveChat` suppression | `updateNotification`, `updateNotificationGroup` |
| P1 | Voice notes | **done** (mock + test DC); waveform empty | `inputMessageVoiceNote` + `inputVoiceNote` + `chatActionRecordingVoiceNote` |
| P1 | Reactions | **display done**; picker needs the owner | `addMessageReaction`/`removeMessageReaction`/`setMessageReactions`, `getMessageAvailableReactions`, `updateMessageReactions` |
| P1 | Peer profile card | **done** — card, 共同群聊 list, 聊天信息 face | `getUserFullInfo` (bio, note, `group_in_common_count`, `block_list`), `getGroupsInCommon` |
| P1 | Block / unblock | **done** (资料卡 加入黑名单 / 取消拉黑) | `setMessageSenderBlockList` (null unblocks), `getBlockedMessageSenders` |
| P1 | Report chat / message | **done for the API-allowed paths**; a human's only path is the chat action bar (unwired) | `reportChat` (two-phase), `chat.can_be_reported`, `messageProperties.can_report_chat` |
| P1 | Add/remove contact, 备注 | **done** | `addContact` + `importedContact`, `removeContacts`, `setUserNote` |
| P1 | Album send | **done** — 2–10 photos, one call | `sendMessageAlbum` (returns `Messages`) |
| P1 | Caption edit | **done** — menu 编辑 / 编辑说明 | `editMessageCaption` |
| P1 | Speech-to-text | **done** for received voice notes | `recognizeSpeech` + `can_recognize_speech` + `speech_recognition_result` |
| P1 | Pinned message bar | **bar done**, product call open (WeChat has no such bar) | `pinChatMessage`/`unpinChatMessage` + `can_be_pinned` |
| P2 | Location / venue / live location / contact card / poll / dice **sending** | received only (locations flatten to `📍 lat, lon`) | `inputMessageLocation`, `inputMessageLiveLocation`, `inputMessageVenue`, `inputMessageContact`, `inputMessagePoll`, `inputMessageDice` |
| P2 | Message effects | none | `getMessageEffect` + `messageSendOptions.effect_id` |
| P2 | Scheduled / silent send | none | `messageSchedulingStateSendAtDate`, `...SendWhenOnline`, `disable_notification` |
| P2 | Shared media / search filters | text search only | `searchChatMessages(filter: Photo/Video/Document/Url)` |
| P2 | Archived chats | **done (2026-11-23)** — `chats:list { list: 'archive' }`, `chats:setArchived`, 已归档会话 row + page; **global search still reads the main list** | `chatListArchive`, `addChatToList`, `chat.action_bar.can_unarchive` |
| P2 | More 举报 entries | chat + message wired; spam banners, photo and reaction reports not | `chatActionBarReportSpam`, `chatActionBarReportAddBlock`, `reportChatPhoto`, `reportMessageReactions` |
| P2 | Draft cloud sync | local `ui.db` only | `setChatDraftMessage` + `updateChatDraftMessage` |
| P2 | Multi-select / batch forward / forward-as-copy | one message at a time | `forwardMessages` array + `messageCopyOptions` |
| P2 | Translate | none | `translateText` |
| P2 | Chat background / theme | none | `setChatBackground`, `setChatTheme` |
| P2 | Screenshot / 收藏 | placeholders | `desktopCapturer`; 收藏 can map to Saved Messages |
| scope-out | 1:1 voice / video calls | header buttons disabled | `createCall` / `acceptCall` / `discardCall` / `updateNewCallSignalingData` (the API **does** exist; the blocker is the media stack) |
| scope-out | Secret chats | v1 out of scope | `createNewSecretChat` exists; E2E unverified here |

Notes that move an estimate: **reactions** and **online status** have no WeChat counterpart,
so they are product decisions as much as engineering ones; **notifications** must come from
TDLib's notification API or mute/mention rules will be wrong; **round video notes** need
MPEG4/H.264 ≤ 640 and a capture spike first.

**Test-DC status (2026-11-23).** Every write in this table that had only a compile/mock proof
was driven on Telegram's test DCs by `pnpm tdlib:test-dc:writes` — album, caption edit,
pin/unpin, 标为未读, 备注, 联系人, 拉黑, 举报 (filed against a bot, two phases), 转文字,
删除聊天 — 9 pass / 3 partial / 1 skip / 0 fail. It found three real defects, now fixed with
tests: `markedUnread` was never mapped (so 标为未读 set nothing), `setUserContact` read
`is_contact` before TDLib flipped it (~1.2 s), and 备注 was offered to a non-contact (TDLib
refuses it). Still unproven: `resendMessages` (no failed row can be produced — see §6.7),
`getGroupsInCommon` (this account's only group has no second member, so it needs a second
test account), and whether `sendChatAction` actually reaches the peer (the adapter swallows
its errors by design, so only the call path is proven).

### 7.3 Recipe: adding one send type (the pattern for most P1/P2 items)

Follow the layers in order; each step is a compile error until the next is done, which is the
point.

1. **Protocol first** — `packages/protocol/src/channels.ts` (channel + zod request/response)
   or the domain module it spreads (`chats.ts`, `send.ts`, `poll.ts`, `comment.ts`,
   `search.ts`, `user.ts`, `voice.ts`, `reaction.ts`). New `Message` fields go in `dto.ts`;
   when a module starts carrying a second concern, split it instead.
2. **Adapter seam** — `packages/adapter-contract/src/adapter.ts`: the method and any event;
   both adapters implement it in the same batch.
3. **TDLib action** — `main/telegram/tdlib/actions/<domain>.ts`, re-exported from
   `actions/index.ts` and bound in `tdlib/index.ts` (or `chat-api.ts` / `send-api.ts` /
   `user-api.ts` for that domain). Outgoing messages start from `message-input.ts`
   `sendAndMap` plus a content builder next to `mediaContent` / `stickerContent`.
4. **Mock adapter** — `packages/mock-adapter/src/` (the seam typecheck forces this); keep pure
   rules in `packages/mock-session` when the preview needs the same behaviour.
5. **Browser preview** — `renderer/src/lib/preview/index.ts` invoke switch (+ `sends.ts`,
   `messages.ts`, `chats.ts`), typed against the same protocol.
6. **Renderer** — composer/menu/panel entry, store op handling (`reducers.ts` `reduceOps`
   **and** the `pendingOps` replay path in `setHistory`), then the component.
7. **Tests** — a pure rule gets `lib/*.test.ts`; an action gets the fake-invoke pattern in
   `tdlib/actions*.test.ts`.
8. **Docs** — the layer `AGENTS.md` and this file's status table.
9. **Verify** — `pnpm verify`, then mock Electron for UI and **test DC for any write path**.

For a new event instead: `AdapterEvent` in `adapter.ts`, mapping in
`telegram/events.ts`, `eventChannels`/`eventSchemas`, a subscriber in `App.tsx`, a store
slice. Every event is wrapped in `envelope(seq)`.

### 7.4 Corrections to older statements (kept so nobody re-inherits them)

- `docs/技术方案.md` §1 says calls are "not on TDLib's public API". In 1.8.70 the signalling
  API exists (`createCall`, `acceptCall`, `discardCall`, `callStateReady`,
  `updateNewCallSignalingData`); the non-goal stands, but the reason is the media stack
  (WebRTC/SRTP/Opus) and the test burden.
- The same section's MVP list includes **在线状态** — implemented now (§7.2).
- The old note "the send-id swap is cosmetic" was wrong: the id changes (§6.1).
- MVP says media "含相册"; received-album grouping landed long ago, sending landed in P1.

---

## 8. Code organisation: the split and what it enforces

The tree was split on 2026-11-19 so that an agent can read a whole module before editing it.
The rules live in `CLAUDE.md` ("Agent-maintainable code"); this section records what was done,
the invariants the moves preserved, and the one batch still pending.

### 8.1 The rules in one paragraph

One file = one reason to change; ~350 lines is normal, **1100 is the hard cap** (ESLint
`max-lines` with `skipBlankLines` + `skipComments`; imports count, blank and comment-only
lines do not). A file whose single concern is one indivisible algorithm may exceed the cap —
only with a top-of-file `/* eslint-disable max-lines -- <the concern> */`, a row in the layer's
`AGENTS.md` and a design-doc sentence, all in the same change; the split question reopens at
~700 counted lines. Split by responsibility (keep the import path stable with a directory
`index`), never by line count; no `utils.ts` dumping grounds. Pure rules leave the component
and get a test. Comments travel with the code. A split changes no behaviour and no contract,
one logical batch per commit, `pnpm verify` before each, and the touched layer note plus this
document are updated in the same batch.

### 8.2 What moved (and where)

| Was | Now |
|---|---|
| `telegram/tdlib.ts` (1527) | `tdlib/`: `index` (composition root), `client`, `boot`, `lifecycle`, `avatar-cache`, `updates`, `actions/` (`chats`, `history`, `files`, `send`, `search`, `contacts`, `users`, `message-input`, `errors`, `deps`), `chat-api`, `send-api`, `user-api`, `stickers`, `proxy`, `map/` (`chat`, `message`, `content`, `service`, `media`, `entities`, `buttons`, `rich`, `sticker`, `user`, `status`, `deletion`, `resolvers`) |
| `renderer/store/useAppStore.ts` (293) | `store/types`, `initialState` (`DATA_DEFAULTS`, the only initial state), `reducers` (`sortChats`/`upsertMessage`/`reduceOps`), `slices/{auth,chats,messages,media,ui}`, `useAppStore` (assembler, import path unchanged) |
| `MessageList.tsx` (705) | `message-list/index` (composition + render) + `MessageRow`, `Divider`, `useInitialPosition`, `usePrependRestore`, `useAnchorSave`, `useJumpToLatest`, `useLocateScroll`, `useLandingSave`, `useViewportSeen`, `scrollFlags`, `scroller`, `emoji`/`menu`/`unread` (pure) |
| `ChatPane.tsx` (415) | `chat-pane/index` (render tree + modal state) + `useChatHistory` (+ `history/`: `readFirstPage`, `types`, `useLocateRequest`, `usePrefetchOlder`, `usePaging`), `messageActions` (a factory, not a hook), `ChatHeader`, `ChatInfoPanel/Rows/Dialogs/Search`, `CommentPanel`, `CommentComposer`, `ChannelBar`, `Placeholders`, `labels` |
| `viewer/MediaViewer.tsx` (586) | `MediaViewer` + `useViewerItem`, `useViewerZoom`, `useViewerNotice`, `ViewerToolbar`, `ViewerGrid`, `viewerActions`, `viewerMenu` (tested) |
| `ExpressionPicker.tsx` (449) | `ExpressionPicker` + `picker/`: `useStickerSets`, `useActiveStickerSet`, `useRecentEmoji`, `usePickerDismiss`, `EmojiBody`, `SearchBody`, `StickerBody`, `PickerTabs`, `EmojiGrid`, `types` |
| `Composer.tsx` | `composer/ComposerCard` (the ONE bordered card) + `Composer` (chat send path) + `chat-pane/CommentComposer` (thread send path) |
| `LoginWindow.tsx` (491) | `LoginWindow` (chrome + bodies) + `login/`: `useLoginFlow`, `QrStep`, `ProfileStep`, `PhoneForm`, `LoginFooter`, `LoginHelp`, `loginCopy` (pure, tested) |
| `telegram/mock.ts` (1122) | `packages/mock-adapter` (16 files) + `main/telegram/mock/{transcript,effects}` |
| `lib/preview-bridge.ts` (775) | `lib/preview/` (`index`, `fixtures`, `sends`, `messages`, `chats`) behind a two-line entry point so the dev-only import stays visible |
| `styles/index.css` (3206) | 14 files under `styles/`, imported in source order (`tokens` first). The compiled CSS came out byte-identical (same hash, 60.32 kB) — that is the check to repeat after any order edit |
| `protocol/dto.ts` / `channels.ts` at cap | per-domain modules: `settings.ts`, `viewer.ts`, `chats.ts`, `chat.ts`, `comment.ts`, `stickers.ts`, `poll.ts`, `voice.ts`, `user.ts`, `reaction.ts`, `events.ts`, `message-ops.ts`. `index.ts` still exports every type, so no consumer import changed |
| `mock-fixtures/data.ts` at cap | `seed.ts` (types) + `stress.ts` (the 5000-message chat) |
| `tdlib/index.ts` at cap | `chat-api.ts` / `send-api.ts` / `user-api.ts`: `createXxxApi` returns a domain's seam methods as one object the class binds as fields, lazily reading `actionDeps` |
| `MediaBubble.tsx` at cap | `VoiceBubble.tsx` (voice geometry shares nothing with photo/video/file) |

### 8.3 Invariants the split (and the code) must keep

1. **Slices return actions only.** State is seeded from `DATA_DEFAULTS`, so `reset()` cannot
   forget a field; adding a state field means adding it to `AppData` **and** `DATA_DEFAULTS`.
2. **`messagesByChat[chatId]` is created only by `setHistory`/`prependHistory`**; ops for a
   chat without an entry queue in `pendingOps` (read-only batches are skipped by
   `hasReplayableOps`) and replay in `setHistory`.
3. **`resyncScroller()` after every programmatic `scrollTop` write** (§6.2).
4. **Pure helpers stay React-free** so vitest can import them in the node environment (that
   is why `isEmojiOnly` lives in `emoji.ts`: importing the row pulls `lottie-web`). `menu.ts`
   imports `MenuItem` with `import type` on purpose.
5. **`useChatHistory` is called before ChatPane's early return** (hooks order), and
   `MessageList` must not mount before `anchorKnown`.
6. `messageActions` is a factory rather than a hook: built only when a chat is active, call
   sites need no null guards.
7. **The renderer never sees raw TDLib JSON** and never a filesystem path: map at the adapter
   boundary, serve media as `wx-media://f/<token>`.
8. **A new channel goes into the tables**, never a concatenated name; **a new field starts in
   `dto.ts`**. Every event carries `seq`.

### 8.4 Dedupe and contract passes (done — do not redo)

One-off duplication audits merged the real duplicates and left the look-alikes alone:

- **Merged**: the three `BrowserWindow` factories → `main/app-window.ts`; the mock's
  "append a message and announce it" (4 copies) → `mock/transcript.ts`; the send envelope +
  thread resolver → `actions/message-input.ts`; the media field table → `map/media.ts`;
  "a missing array means empty" (24 sites) → `json.ts asArray`; the newer-messages page →
  `fetchNewerThan`; avatar boxes (7 copies) → `components/Avatar.tsx`; the search pill + query
  rule (4 panels) → `SearchField` + `lib/search.ts`; Enter/Shift+Enter/IME →
  `lib/composerInput.ts` + `useComposerInput`; popup placement → `lib/popupPlacement.ts` +
  `AnchoredPopup`; the reserved media box → `lib/mediaBox.ts`; the signed-in identity →
  `lib/self.ts`; calendar-day maths → `lib/format.ts calendarDaysAgo`; the fake session's
  rules → `@wegram/mock-session`; the demo account (two drifted copies) →
  `@wegram/mock-fixtures`.
- **Contracts written once**: invoke request shapes (one zod schema; `IpcHandlerMap` typed by
  `InvokeResponse<C>`, the only cast left is the channel loop in `router.ts`); the comment
  contract → `protocol/comment.ts`; `AppErrorCode` → `appErrorCodeSchema` + `z.infer`;
  `EventBus.publish` typed by event channel; row height 65 and the 250 ms panel slide →
  `lib/listMetrics.ts` / `lib/comments.ts` pinned by `scripts/style-contract.test.ts`; the
  recent-emoji limit, sticker-format enum, viewer bound and unread types each to one place.
- **Deliberately not merged** (they only look duplicated): the two `TelegramAdapter`
  implementations; the seam's forwarding chain; `store/settings.ts` vs `store/ui-db.ts` and
  the three proxy modules (different formats by rule); the two `map/*` dispatch switches;
  `setError(errorMessage(e))` at ~28 sites (where an error goes depends on the call site);
  per-panel skeletons and CSS blocks (`wx-*` is a measured contract); the preview's invoke
  switch vs `main/ipc/handlers.ts` (handlers need Electron, the preview may not import main).
- Removing the casts found a real defect: `ui:saveDraft` declared an `entities` field nobody
  sent or kept — deleted.

### 8.5 Pending and not-to-do

- **Pending**: `packages/protocol` is the one batch from the original plan still open (split by
  domain with an identical export surface, because preload bundles the index). Partially done
  already (§8.2). Measured now: no non-exempt file exceeds ~393 counted lines, so it is
  housekeeping, not an emergency.
- **Not done, on purpose**: `mock/index.ts` and the generated `WechatIcons.tsx` are the two
  genuinely large files; the mock adapter and the renderer's preview bridge are still imported
  statically (excluding fixtures from a release would be a build-time change covering both
  sides at once).
- **Do not**, while refactoring: change IPC channel names, DTO field names, `wx-*` class names
  or the `wx-media://f/<token>` scheme; rewrite a scroll algorithm while moving it (the 250 ms
  save window, 150/400 ms re-stick, 700/1000 ms reveal nets and the 15 s load cap are
  load-bearing); add a DOM test environment without deciding it explicitly (the node-only
  suite is intentional — the real bugs are timing and measurement bugs jsdom cannot
  reproduce); bypass `pnpm verify` when reporting a change as done.
- Traps that cost an hour: zustand v5 `StateCreator` takes **three** arguments
  (`slice(set, get, api)`); a node-env test importing any `.tsx` that reaches media/lottie
  drags the whole stack in; `pnpm format` must not reach `spikes/` or `*.md`
  (`.prettierignore`); closing the launcher's console kills the app (minimise it).

---

## 9. Known gaps and next steps

### 9.1 Verification debt (highest value — close these before building more)

1. **Test-DC writes — mostly closed 2026-11-23.** `pnpm tdlib:test-dc:writes` exercised
   `sendMessageAlbum`, `editMessageCaption`, `pinChatMessage`/`unpinChatMessage`,
   `toggleChatIsMarkedAsUnread`, `setUserNote`, `addContact`/`removeContacts`,
   `setMessageSenderBlockList`, `reportChat` (bot, two phases, filed),
   `deleteChatHistory` and `recognizeSpeech`; the baseline script keeps text/edit/photo/voice/
   delete. Three defects surfaced and are fixed (§1.2, §7.2). What is still open:
   - `resendMessages`: no failed row can be produced — a dead proxy leaves the message
     `pending` for 120 s (§6.7). Either accept the compile/mock proof or build a
     server-rejection fixture.
   - `getGroupsInCommon`: the test account's only group has ourselves in it, so this needs a
     second test account (or a member added to the group).
   - `sendChatAction`: the call is sent on every keystroke path, but the adapter swallows its
     errors on purpose, so nothing observable proves the peer saw the indicator.
   - `recognizeSpeech`: proven once, then the server refused the same clip (`TRANSCRIPTION_
     FAILED`); the failure mapping itself is proven by those runs.
2. **The TDLib QR login with a real phone** — link mapping, encoding, QR-first UI and the
   phone fallback are mock-verified; the `requestQrCodeAuthentication` → scan → ready / 2FA
   chain and `auth:reset`'s rebuild need one real scan (design doc §14).
3. **Windows toasts and the tray icon** on this machine (no Start-Menu shortcut for an
   unpackaged build; `Shell_NotifyIcon` refused in the agent session). `createTray` logs and
   carries on, so neither failure can stop the app.
4. **The installer** — install / uninstall / per-user vs per-machine, code signing (currently
   skipped, SmartScreen will complain), auto-update (no `publish` config, no
   `electron-updater`), the sandboxed launch on a clean machine, and the inlined-credentials
   path end to end (v0.1.0 predates it and still boots the mock).
5. **Settings batch A against a real account**: profile photo, @username, 退出登录; and
   `nativeTheme.on('updated')` with the OS theme actually switching; `pingProxy` against a
   real proxy instead of the mock's fixed 3 ms.
6. **The real-account pass for a 5 000-message-deep anchor** (the load-around path is
   unit-tested only) and the 群二维码 window in its real Electron form.
7. **A real microphone** for voice notes (only the fake device was measured), and Electron 45's
   `AudioEncoder` opus support (measured on Edge 157 only).

### 9.2 Functional gaps, in a sensible order

| # | Gap | Notes |
|---|---|---|
| 1 | Search-face virtualisation | The conversation list is virtualised (2026-11-18) and, since 2026-11-23, pages on approach and prefetches the visible window's photos — measured on this account: 321 chats, 100/100/100/21 with no overlap. What is left is the search face: conversation hits and message hits still `.map` their page instead of virtualising it (they are paged, so the count is bounded — mechanical, not urgent) |
| 2 | Reactions picker | display is done; WeChat has no reactions, so it needs the owner's sign-off (§9.3) |
| 3 | Settings batches B and C | **B1 消息通知 landed 2026-11-23** (desktop switch + three scopes), **B2 通用补全 landed the same day** (消息字号 four steps through `data-msg-size` / `--wx-msg-scale`; 开机自启 read from and written to the OS login item, packaged builds only). B still open: six 隐私 rules + 黑名单, 登录设备, 存储统计/清理, 自动下载, 角标未读数. C: 两步验证, 本地锁, 全局快捷键, 检查更新, 保存目录, 贴纸管理, 恢复默认. Each adds panels to the same nav table; prefer per-domain channels over growing `settings:set` (消息通知's are `notifications:get` / `setScope` / `setDesktop` in `packages/protocol/src/notification.ts`). 清理缓存 must invalidate `media/registry.ts` tokens or bubbles keep retrying deleted files |
| 4 | Private-chat P2 list | translate (`translateText`), scheduled/silent send, shared-media tabs, draft cloud sync, multi-select forward, location/contact/poll sending, message effects, chat background, screenshot, 收藏 → Saved Messages |
| 5 | Search depth | missing 应用/贴文/图片/视频/音频/链接 filters, 联系人 hits, archived chats (global search still reads `chatListMain`) |
| 6 | Viewer breadth | no 编辑, no AI block, no 查看原视频, no pin button anywhere |
| 7 | Composer parity | the 收藏 cube and 剪刀 (screenshot) still toast; the ＋ card's three entries are unwired; no drag & drop / paste; captions are supported by the adapter (`media:send` takes `caption`) but not surfaced at send time |
| 8 | Chat info follow-ups | a member card on avatar click; a local 备注 (Telegram's is cloud-synced now); a chat-wide in-chat search view (the panel's 查找聊天内容 hosts it today) |
| 9 | Storage bounds | downloads are TDLib's own cache; the `media_cache` LRU table is still unused, so nothing bounds disk usage |
| 10 | Sticker breadth | panel lists regular installed sets only (no search/trending/recent); a set cover whose thumbnail is MPEG4 would render as a broken `<img>`; no premium mark in the picker; sending a premium pack without a subscription is left to TDLib's error |
| 11 | WebM fixtures | `<video>` stickers are implemented but no fixture exercises them (no VP8 encoder here, ffmpeg absent) |
| 12 | Preload size | 187 kB because it imports the protocol index (zod); splitting a channels-only entry point would fix it |
| 13 | Popovers | modals, the forward list and the sticker grid still use native thin scrollbars; converting to `<OverlayScrollbar>` is mechanical |
| 14 | `tdlib:smoke` coverage | it checks only the first channel for `messageSenderChat`; anonymous-admin groups have no fixture |

### 9.3 Open product decisions

1. **Scroll-position restore** — WeChat restores where you left; we do it when the reader was
   not at the bottom. Confirm it stays.
2. **Reactions** — display only, or let the user add them? (DTO work is needed either way.)
3. **Online status placement** — WeChat has no slot; the header second line was chosen, confirm
   it, or move it to the profile card only.
4. **Notifications** — all messages or unmuted only? Sender + preview text (privacy) or just
   新消息? Currently TDLib's stream with title + preview.
5. **删除聊天** — confirm "local removal only" (`deleteChatHistory`), never "for everyone".
6. **Pinned-message bar** — WeChat has none; the bar is built and unreviewed.
7. **Calls / secret chats** — stay out of v1; only the wording of the reason changes (§7.4).
8. **Multi-account** — v2; the session dir is already shaped `tdlib/<accountId>/`, and the
   adapter does not model it (the login window has no account picker).

### 9.3 话题(论坛群): protocol + adapter landed, UI pending

**Done (2026-11-23):** `packages/protocol/src/topic.ts`, `Message.topicId`,
`ChatSummary.forum` / `canCreateTopic`, the eight `chats:topic*` channels, `topicId` on the
message/media/voice/typing/search channels, `evt:topics`; the TDLib side (`map/topic.ts`,
`actions/topics.ts`, `topic-api.ts`, topic-aware `getForumTopicHistory`, `topic_id` on every
send, `messageSourceForumTopicHistory` reads, `searchChatMessages.topic_id`, both topic
updates); main handlers; `ui.db`'s `topic_ui_state`; the mock (`topics.ts`, a forum fixture
chat 12, topic-aware history/sends/read/search). Design: 技术方案 §9.12.

**Renderer (also landed):** `chat-list/TopicsSidebar.tsx` — the 已归档会话 gesture one
column to the left: while a forum is open the CONVERSATION column shows its topics
(same 20 ms mount / 200 ms slide, `TOPICS_PAGE_ANIM_MS` pinned by `style-contract.test.ts`)
and the message pane keeps the chosen topic's transcript,
`useChatTopics` (cursor paging + 搜索话题 + `evt:topics` debounced re-read), the store's
`activeTopicId` / `historyTopicByChat` / `topicsByChat` (`setActiveTopic` drops the cached
transcript, so a page is never reused for another topic), header back + group subtitle,
per-topic drafts / anchors / read marker, the topic context menu (pin, close, mark read,
copy link, delete), 新建话题 (name + six icon colours), 以聊天方式查看 both ways (topics ⋮ and
the 聊天信息 row), and the browser-preview bridge. Verified visually in `pnpm web` (forum
fixture chat 12): list order, topic switching with the row highlighted, back to the
conversations, empty new topic, closed topic bar, flat view round-trip, search.

**Two traps that cost a debugging pass here:** (1) `setActiveTopic` must NOT drop the cached
transcript — `historyTopicByChat` says which topic the page belongs to, and the pane draws a
loading state while it does not match the selection; clearing the rows instead made a reopened
forum sit on "not synced". (2) The query client is `staleTime: Infinity` (the store is the
source of truth), so a topic that reuses a query key with a store that now holds another topic
would never refetch; the history query sets `staleTime: 0` (with focus/reconnect refetch off)
so `enabled: false → true` fetches again.

**Now also in:** per-topic mute (`setForumTopicNotificationSettings`), the notification and
`evt:locate` paths carrying `topicId` (a toast opens its topic first), the icon-emoji picker
(`getForumTopicDefaultIcons` + the shared `TopicDialog`), a per-topic pinned bar
(`searchChatMessages` + `searchMessagesFilterPinned`), and the `has_forum_tabs` chips layout
(`chats:forumLayout` + `TopicsTabs`). Still open: the finer per-topic notification switches
(sound / stories / mentions) and the viewer's 定位, which knows the chat but not the topic.

**Test DC (2026-11-23), `pnpm tdlib:test-dc:topics`:** 15 checks passed, 2 warnings. Passed:
group→forum, `forumLayout` sidebar, topic create/list, send with `topic_id` (the row came back with
topicId 2), `getForumTopicHistory`, the around window, rename, mute read-back, topic link
(`https://t.me/c/…/2`), topic pin read-back, mark-read, delete. Warnings: `toggleForumTopicIsClosed`
and `has_forum_tabs` returned `ok` but the list/full-info kept the old state (test-DC sync lag).
`getForumTopicDefaultIcons` is empty there, so the icon picker is hidden on the test DC only.
Two traps measured: `createNewSupergroupChat{is_forum:true}` builds a **channel** there (a channel
can never become a forum) — use createNewBasicGroupChat → upgrade → toggleSupergroupIsForum; and
repeated group creation trips a 429 (`retry after 243/297`), which the probe now waits out. The
proxy is mandatory on this machine: `TDLIB_PROXY=http://127.0.0.1:7892`.

**Read state is per topic (2026-11-23):** TDLib's `chat.last_read_inbox/outbox_message_id`
describe the General topic; each `forumTopic` carries its own pair and
`updateForumTopic` reports it. The transcript's "N 条新消息" buoy and its 已读/未读
receipt now take the pair from the topic row (`ChatTopic.lastReadOutboxMessageId` was
added for the receipt) through `transcriptReadMarkers`; reading a topic used to keep
counting against the forum's General marker, so a fully read topic still offered
"N 条新消息" and its own rows stayed on 未读. The mock and browser preview apply the
same `nextReadState` rule to one topic's rows.

**Measured caveats to keep:** `chat.view_as_topics` (not `chat.is_forum`) is what picks the
view; General is id 1 and may be hidden/closed so the list can lack it; `getChatPinnedMessage`
and `pinChatMessage` have no topic parameter (pins stay chat-level); `editForumTopic` cannot
change the icon colour; a short `getForumTopics` page is normal and `next_offset_date == 0`
means "end".

### 9.4 Housekeeping

- `AGENTS.md` is a **symlink** to `CLAUDE.md` stored as mode `120000`; this machine cannot
  create symlinks without admin/Developer Mode, so `core.symlinks=false` is in effect — a
  `git checkout`/`git restore` of that path would replace the link with a one-line text file
  containing `CLAUDE.md`. Recreate it with `New-Item -ItemType SymbolicLink` from an elevated
  shell.
- The root commit (`262996a`) was made with `commit.gpgsign=false` because gpg could not reach
  `keyboxd` from the agent shell; signing works in a normal terminal
  (`git commit --amend -S --no-edit` if signed history matters).
- `.gitignore` covers `.env*`, `node_modules`, `out`, `.cache`, `spikes/*/data`;
  `.gitattributes` pins `eol=lf` so `core.autocrlf=true` cannot rewrite the tree.
- `.cache/` keeps logs and throwaway CDP helpers (`cdp-eval.mjs`, `*-check.js`, `uitest.js`) —
  recreate them from §3.5 if they are gone.
- The root `package.json` is the only place a version is written; `pnpm sync-version` copies it
  to `apps/desktop` and `packages/protocol`, and `check:version` is the first step of
  `pnpm verify`.
- **Release procedure**: bump the root version and `git push` to `main` — the workflow reads the
  version, and if `v<version>` does not exist it builds the NSIS installer once, creates the tag
  and publishes the Release (the same version pushed again is skipped). A `v*` tag push or a
  manual run still works and refreshes that release's assets. Two repository secrets are
  required (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`); `electron.vite.config.ts` inlines them into
  the **main bundle only**.

---

## Appendix A — TDLib 1.8.70 signatures cited here

```text
sendMessage chat_id:int53 topic_id:MessageTopic reply_to:InputMessageReplyTo options:messageSendOptions reply_markup:ReplyMarkup input_message_content:InputMessageContent = Message;
sendMessageAlbum chat_id:int53 topic_id:MessageTopic reply_to:InputMessageReplyTo options:messageSendOptions input_message_contents:vector<InputMessageContent> = Messages;
forwardMessages chat_id:int53 topic_id:MessageTopic from_chat_id:int53 message_ids:vector<int53> options:messageSendOptions send_copy:Bool remove_caption:Bool = Messages;
resendMessages chat_id:int53 message_ids:vector<int53> quote:inputTextQuote paid_message_star_count:int53 = Messages;
updateMessageSendSucceeded message:message old_message_id:int53 = Update;
updateMessageSendFailed message:message old_message_id:int53 error:error = Update;
messageSendingStateFailed error:error can_retry:Bool need_another_sender:Bool need_another_reply_quote:Bool need_drop_reply:Bool required_paid_message_star_count:int53 retry_after:double = MessageSendingState;

sendChatAction chat_id:int53 topic_id:MessageTopic business_connection_id:string action:ChatAction = Ok;
chatActionTyping = ChatAction;
chatActionRecordingVoiceNote = ChatAction;
chatActionRecordingVideoNote = ChatAction;

getForumTopics chat_id:int53 query:string offset_date:int32 offset_message_id:int53 offset_forum_topic_id:int53 limit:int32 = ForumTopics;
getForumTopicHistory chat_id:int53 forum_topic_id:int53 from_message_id:int53 offset:int32 limit:int32 = Messages;
getForumTopic chat_id:int53 forum_topic_id:int53 = ForumTopic;
createForumTopic chat_id:int53 name:string is_name_implicit:Bool icon:forumTopicIcon = ForumTopicInfo;
editForumTopic chat_id:int53 forum_topic_id:int53 name:string edit_icon_custom_emoji:Bool icon_custom_emoji_id:int64 = Ok;
toggleForumTopicIsPinned chat_id:int53 forum_topic_id:int53 is_pinned:Bool = Ok;
toggleForumTopicIsClosed chat_id:int53 forum_topic_id:int53 is_closed:Bool = Ok;
deleteForumTopic chat_id:int53 forum_topic_id:int53 = Ok;
getForumTopicLink chat_id:int53 forum_topic_id:int53 = MessageLink;
toggleChatViewAsTopics chat_id:int53 view_as_topics:Bool = Ok;
setForumTopicNotificationSettings chat_id:int53 forum_topic_id:int53 notification_settings:chatNotificationSettings = Ok;
getForumTopicDefaultIcons = Stickers;
getSupergroupFullInfo supergroup_id:int53 = SupergroupFullInfo;  // has_forum_tabs / has_forum_sidebar / is_forum
toggleSupergroupIsForum supergroup_id:int53 is_forum:Bool has_forum_tabs:Bool has_forum_sidebar:Bool = Ok;
createNewSupergroupChat title:string is_forum:Bool is_channel:Bool description:string = Chat;
createNewBasicGroupChat user_ids:vector<int53> title:string = CreatedBasicGroupChat;
upgradeBasicGroupChatToSupergroupChat chat_id:int53 = Chat;
searchChatMessages chat_id:int53 topic_id:MessageTopic … filter:SearchMessagesFilter = Messages;  // filter: searchMessagesFilterPinned reads a topic's pin
viewMessages chat_id:int53 message_ids:vector<int53> source:MessageSource force_read:Bool = Ok;
message.topic_id:MessageTopic; messageTopicForum forum_topic_id:int53 = MessageTopic;
chat.view_as_topics:Bool; chat.permissions.can_create_topics:Bool; supergroupFullInfo.is_forum:Bool;
forumTopicInfo{chat_id, forum_topic_id, name, icon{color, custom_emoji_id}, creation_date, creator_id, is_general, is_outgoing, is_closed, is_hidden, is_name_implicit};
forumTopic{info, last_message, order, is_pinned, unread_count, last_read_inbox_message_id, last_read_outbox_message_id, unread_mention_count, unread_reaction_count, unread_poll_vote_count, notification_settings, draft_message};
forumTopics{total_count, topics, next_offset_date, next_offset_message_id, next_offset_forum_topic_id};
updateForumTopicInfo info:forumTopicInfo = Update;
updateForumTopic chat_id:int53 forum_topic_id:int53 is_pinned:Bool last_read_inbox_message_id:int53 last_read_outbox_message_id:int53 unread_mention_count:int32 unread_reaction_count:int32 unread_poll_vote_count:int32 notification_settings:chatNotificationSettings draft_message:draftMessage = Update;
updateChatViewAsTopics chat_id:int53 view_as_topics:Bool = Update;

inputMessageVoiceNote voice_note:inputVoiceNote caption:formattedText self_destruct_type:MessageSelfDestructType = InputMessageContent;
inputVoiceNote voice_note:InputFile duration:int32 waveform:bytes = InputVoiceNote;
inputMessageVideoNote video_note:inputVideoNote self_destruct_type:MessageSelfDestructType = InputMessageContent;
inputVideoNote video_note:InputFile thumbnail:inputThumbnail duration:int32 length:int32 = InputVideoNote;
inputMessageLocation location:location = InputMessageContent;
inputMessageLiveLocation location:liveLocation = InputMessageContent;
inputMessageVenue venue:venue = InputMessageContent;
inputMessageContact contact:contact = InputMessageContent;
inputMessagePoll question:formattedText options:vector<inputPollOption> description:formattedText media:InputPollMedia is_anonymous:Bool allows_multiple_answers:Bool allows_revoting:Bool members_only:Bool country_codes:vector<string> shuffle_options:Bool hide_results_until_closes:Bool type:InputPollType open_period:int32 close_date:int32 is_closed:Bool = InputMessageContent;
inputMessageDice emoji:string clear_draft:Bool = InputMessageContent;

messageSendOptions suggested_post_info:inputSuggestedPostInfo disable_notification:Bool from_background:Bool protect_content:Bool allow_paid_broadcast:Bool paid_message_star_count:int53 update_order_of_installed_sticker_sets:Bool scheduling_state:MessageSchedulingState effect_id:int64 sending_id:int32 only_preview:Bool = MessageSendOptions;
messageSchedulingStateSendAtDate send_date:int32 repeat_period:int32 = MessageSchedulingState;
messageSchedulingStateSendWhenOnline = MessageSchedulingState;

updateUserStatus user_id:int53 status:UserStatus = Update;
userStatusOnline expires:int32 = UserStatus;
userStatusOffline was_online:int32 = UserStatus;
userStatusRecently by_my_privacy_settings:Bool = UserStatus;
userStatusLastWeek by_my_privacy_settings:Bool = UserStatus;
userStatusLastMonth by_my_privacy_settings:Bool = UserStatus;

deleteChatHistory chat_id:int53 remove_from_chat_list:Bool revoke:Bool = Ok;
deleteChat chat_id:int53 = Ok;
toggleChatIsMarkedAsUnread chat_id:int53 is_marked_as_unread:Bool = Ok;
updateChatIsMarkedAsUnread chat_id:int53 is_marked_as_unread:Bool = Update;
pinChatMessage chat_id:int53 message_id:int53 disable_notification:Bool only_for_self:Bool = Ok;
unpinChatMessage chat_id:int53 message_id:int53 = Ok;
getChatPinnedMessage chat_id:int53 = Message;
setChatDraftMessage chat_id:int53 topic_id:MessageTopic draft_message:draftMessage = Ok;
updateChatDraftMessage chat_id:int53 draft_message:draftMessage positions:vector<chatPosition> = Update;

addMessageReaction chat_id:int53 message_id:int53 reaction_type:ReactionType is_big:Bool update_recent_reactions:Bool = Ok;
removeMessageReaction chat_id:int53 message_id:int53 reaction_type:ReactionType = Ok;
setMessageReactions chat_id:int53 message_id:int53 reaction_types:vector<ReactionType> is_big:Bool = Ok;
getMessageAvailableReactions chat_id:int53 message_id:int53 row_size:int32 = AvailableReactions;
updateMessageReactions chat_id:int53 message_id:int53 date:int32 reactions:vector<messageReaction> = Update;

getUserFullInfo user_id:int53 = UserFullInfo;
getGroupsInCommon user_id:int53 offset_chat_id:int53 limit:int32 = Chats;
setUserNote user_id:int53 note:formattedText = Ok;
setMessageSenderBlockList sender_id:MessageSender block_list:BlockList = Ok;
getBlockedMessageSenders block_list:BlockList offset:int32 limit:int32 = MessageSenders;
reportChat chat_id:int53 option_id:bytes message_ids:vector<int53> text:string = ReportChatResult;
addContact user_id:int53 contact:importedContact share_phone_number:Bool = Ok;
removeContacts user_ids:vector<int53> = Ok;
importedContact phone_number:string first_name:string last_name:string note:formattedText = ImportedContact;

searchChatMessages chat_id:int53 topic_id:MessageTopic query:string sender_id:MessageSender from_message_id:int53 offset:int32 limit:int32 filter:SearchMessagesFilter = FoundChatMessages;
editMessageCaption chat_id:int53 message_id:int53 reply_markup:ReplyMarkup caption:formattedText show_caption_above_media:Bool = Message;
translateText text:formattedText to_language_code:string tone:string = FormattedText;
recognizeSpeech chat_id:int53 message_id:int53 = Ok;
getMessageEffect effect_id:int64 = MessageEffect;

createCall user_id:int53 protocol:callProtocol is_video:Bool = CallId;
acceptCall call_id:int32 protocol:callProtocol = Ok;
discardCall call_id:int32 is_disconnected:Bool invite_link:string duration:int32 is_video:Bool connection_id:int64 = Ok;
updateNewCallSignalingData call_id:int32 data:bytes = Update;
createNewSecretChat user_id:int53 = Chat;
```

If a line here disagrees with `.cache/td_api.tl`, the scheme wins.

---

## Appendix B — dated history (what shipped when)

The commit log is the source of truth; this is the short version, for judging how fresh a
claim is. Nothing here replaces §1 (state) or §9 (gaps).

**2026-11-17 — import and first design pass**
- W1 (shell, protocol, mock, TDLib adapter, proxy, login page), W2 (virtualised list, anchored
  paging, send/reply/edit/delete/forward, drafts, `ui.db`) and the W3 main body (media,
  stickers, entity rendering, day/unread separators, read receipts, typing) were in.
- Image viewer window (75 %×90 %, toolbar, 预览 column), titleBarOverlay theming, dark overlay
  verified, `ui.db` scroll-anchor wiring + load-around, then the refactor batches 0–4
  (`pnpm verify`, ESLint-enforced architecture, 132→322 tests).
- Repository created; root commit `262996a`; `eol=lf` pinned.

**2026-11-18 — WeChat 4.x UI pass**
- Tokens and metrics measured with PIL, `TitleBar.tsx` deleted (native overlay), WeChat icons
  extracted from `Weixin.dll`, rail/list/pane structure rebuilt.
- Login became its own 280×373 window with the QR step; dark palette re-measured with
  `PrintWindow`; load-around replaced the 6-page anchor budget.
- Real-account pass behind the SOCKS proxy surfaced three defects (empty groups, lying
  `hasMore`, frozen visibility gate) — all fixed; profile photos and overlay scrollbars landed.

**2026-11-19 — refactor P0/P1, contacts, richer messages**
- Viewer/picker/composer/login/message-list/chat-pane/mock splits; preview and styles splits;
  `main/windows.ts`; `max-lines` enforced.
- 通讯录 (address book, pinyin initials, contact card), sender photos (`evt:avatars`),
  custom emoji, the `covers` tab-icon rule, older-page prefetch, the 5000-message fixture.

**2026-11-20 — comments, packages, dedupe**
- Message comments (bar → Telegram discussion view, join-to-send, per-thread anchor),
  `@wegram/mock-adapter` + `@wegram/adapter-contract` extracted, dedupe and contract passes,
  premium sticker effects, animated-emoji messages, custom emoji entities.
- Test-DC account created through Telegram Desktop beta (the reserved numbers are dead);
  send → edit → photo → delete proven; the send-id swap measured.

**2026-11-21 — composer card, chat info, search, polls**
- `ComposerCard` shared by the chat and the comment thread; 聊天信息 panel (overlay, private /
  group / channel), 群二维码 window, 未加入频道的底栏.
- Global search (聊天/频道, conversations + messages, cursor paging), polls, clickable
  mentions, in-app `t.me`/`tg://` links, archive-less chat list.

**2026-11-22 — settings, proxy, private chat**
- 设置 batch A as its own window; HTTP CONNECT proxy; 跟随系统代理 as the default with probe +
  retry.
- Private-chat P0 (typing, mark-unread, delete chat + context menu, send failure/retry,
  presence, notifications + tray) and P1 (albums, pinned bar, speech-to-text, reaction
  display, block/report, profile card, caption edit, voice notes with an in-repo OGG muxer).
- `max-lines` moved to 1100 with `skipBlankLines`/`skipComments`; measured 48 768 raw lines =
  34 724 code + 8 184 comment + 3 902 blank + 1 958 import across 437 ts/tsx files.

**2026-11-23 — archive, sticker budget, this consolidation**
- Archived chats (`chats:list { list: 'archive' }`, `chats:setArchived`, the 已归档会话 row and
  page). The row is the conversation list's own first row — inside the scroller, so it
  scrolls away — and the list rests one row further down (`scrollMargin` on the
  virtualiser), which is why it starts out of view and the reader scrolls up to find it.
- The animated-cell budget (ThorVG canvas, 30 fps, savedFrame, two-screen parse window) and
  the 贴纸包盒子 (464 × 558, 4-column grid).
- The four handoff documents were consolidated into this one.
- The §9.1 write matrix was driven on the test DC (`pnpm tdlib:test-dc:writes`: 9 pass /
  3 partial / 1 skip, 0 fail). It found three defects — `markedUnread` never mapped,
  `addContact`'s flag lagging ~1.2 s, 备注 offered to a non-contact — all fixed with tests;
  举报 was filed end to end against a bot (two phases) and 删除聊天 proven with its own
  disposable chat.

**2026-11-23 (evening) — 设置 B 批第一组:消息通知**
- `notifications:get` / `notifications:setScope` / `notifications:setDesktop` over TDLib's
  `scopeNotificationSettings`, with the local 桌面通知 switch in `ui.db`
  (`notifications.desktop`) read by `NotificationCenter` on every delivery. The adapter
  reads a scope before writing it (the setter replaces the whole struct, story/mention
  fields included) and mute is `mute_for = 2^31-1`.
- Panel: `components/settings/NotificationPanel.tsx`; nav order follows §9.11.3 (消息通知
  after 通用). The mock adapter and the browser preview implement the same three channels.
- `pnpm verify` green.

**2026-11-23 (night) — 设置 B 批第二组:通用补全(消息字号 / 开机自启)**
- 消息字号: four steps (`small` / `standard` / `large` / `xlarge`) in `ui.db`
  (`messageTextSize`, default 标准 = the existing 14 px body), painted through
  `data-msg-size` on `<html>` → `--wx-msg-scale`. It scales message text only — bubbles,
  rich blocks, photo/album captions, code blocks — so the chat list, timestamps and the
  composer keep their measured sizes. The rich-message sizes (and `SECTION_SIZE`) became
  `em` for that reason.
- 开机自启: read from and written to the OS login item (`app.getLoginItemSettings()` /
  `setLoginItemSettings`), never stored in `ui.db`; `canLaunchAtLogin` is false in a
  development run, where the row is disabled instead of registering
  `node_modules/electron.exe` as a startup entry.
- `evt:settings` now carries the whole `{ sendKey, messageTextSize }` pair, and
  `settings:set` validates against the new `appSettingsPatchSchema` (a capability flag is an
  answer, never a patch). The browser preview publishes the same event.
- `scripts/style-contract.test.ts` pins every protocol step to a `[data-msg-size]` rule and
  the bubble's `calc(14px * var(--wx-msg-scale))`.
- `pnpm verify` green.

**2026-11-23 (night, after 0.2.4) — 开关不再自己播放动画**
- Reported from the running client: entering 设置 → 消息通知 (and 网络与代理) showed a switch
  animating 关 → 开 by itself. Cause: those panels painted a guessed value
  (`desktop === true`, `mode ?? 'system'`, `preferIpv6` default false) and the read
  landed a frame later; the 150 ms transition turned the correction into an animation.
- Fix, in two layers: `Switch` now carries `is-static` until the reader clicks it (the
  stylesheet keeps that state transition-free, so a value that arrives without a click
  changes in place), and 消息通知 / 网络与代理 no longer paint a switch before their read
  answers (a switch is not drawn with a value the panel has not seen).
- `pnpm verify` green. Not in the v0.2.4 installer (that build predates the fix).





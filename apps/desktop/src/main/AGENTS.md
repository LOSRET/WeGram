# AGENTS.md — apps/desktop/src/main

Scope: the Electron main process (protocol adapter, IPC, stores, media protocol).
Read the root `../../../../CLAUDE.md` and `docs/HANDOFF.md` first; this file only
adds what is specific to this layer.

## Layering

```
index.ts            app lifecycle, adapter wiring, media scheme, login↔shell hand-over
                    (syncWindowsToAuth / showMainWindow)
app-window.ts       the ONE BrowserWindow factory (security webPreferences, route load,
                    navigation policy) + the shell's title-bar overlay + the placement
                    helpers every sheet uses (displayForWindow / displayForCursor,
                    centerOnDisplay, showWhenReady) and repaintWindowChrome (background +
                    title strip after a theme switch)
windows.ts          the shell window: geometry, theme repaint, minimize↔viewer wiring
login-window.ts     the frameless 280×373 login BrowserWindow (#login), close/refocus
viewer.ts           the 图片和视频 window; unowned on purpose (see below), pins/hides it
settings-window.ts  the 设置 window: frameless 640×558, NOT parented (design doc §9.11);
                    the shell's close, 退出登录 and before-quit close it explicitly
qr-window.ts        the 群二维码 window: frameless 360×560, parented to the shell (closes
                    with it), owns the chat it draws for qr:info and the window's ×
report-window.ts    举报 (§9.13): frameless 380×560, parented to WHOEVER opened it — the
                    Mini App window for its ⋯ card, the shell for the 资料卡 / message
                    menu — so the app no longer has to be closed to report its bot.
                    One window re-targeted (reload); report:state hands the renderer
                    its target, the phased reportChat calls stay users:report /
                    messages:report
instant-view-window.ts  即时预览 (§8.9): the reader as its own top-level window (route
                    #instantview), one target held in memory for `web:state`, reloaded
                    to re-target; the shell closes it on quit like the viewer. It borrows
                    the viewer's chrome: `titleBarStyle: hidden` + its own 40 px strip
                    (title only; the page tools are a 36 px second row, or the zoom and
                    the window buttons collide), so no default menu bar, and
                    `titleBarOverlay` follows the theme
mini-app-bridge.ts   the guest's `web_app_*` table: parses the preload's JSON and dispatches
                    close / sendData / theme / viewport / popup / native buttons /
                    CloudStorage / Biometry. No Electron imports; tests pin the wire shape.
mini-app-controls.ts (pure) partial BottomButton/BackButton/SettingsButton patches and the
                    exact native action-bar height; `mini-app-controls.test.ts` pins it.
mini-app-cloud-storage.ts (pure) validates the four CloudStorage custom methods and their
                    TDLib results; unknown custom methods never leave main.
mini-app-biometry.ts Windows Hello service: user+bot consent, DPAPI-sealed tokens in ui.db,
                    and async bridge results. `biometry-worker.ts` runs synchronous
                    `win-hello` in a worker thread; retarget/reload invalidates results.
mini-app-theme.ts    the Mini App palette shared by SDK theme events and TDLib's signed
                     `themeParameters`; `mini-app-theme.test.ts` pins both mappings.
mini-app-window.ts  小程序 / Telegram Mini Apps (§9.4.1): the one frameless 560×780 window
                    (route #miniapp) with a 48 px strip, optional native bottom-button bar,
                    and a sandboxed WebContentsView between them; the signed URL stays here,
                    `TelegramWebviewProxy` events
                    (`src/preload/miniapp.ts`) become close / sendWebAppData / openLink,
                    and 举报 opens the report window parented to this one (the app is
                    not closed). The ⋯ card is NOT a native menu: it is
                    the client's own `.wx-context-menu` card, drawn by a second, transparent
                    `WebContentsView` (route `#miniappmenu`) layered over the guest, because
                    the guest's view paints above the window's DOM (`miniapp:menuState` /
                    `miniapp:menuPick`; main owns the rows). One window, re-targeted;
                    `closeWebApp` releases an `openWebApp` launch
notifications.ts    desktop toasts from TDLib's notification stream; suppresses the chat
                    the focused shell shows (ui:setActiveChat), flashes the task bar, and
                    stops at once when 设置 → 消息通知's 桌面通知 switch is off (read per
                    delivery through store/prefs.ts)
autostart.ts        设置 → 通用 → 开机自启: the OS login item is the source of truth (read on
                    every settings:get, never mirrored in ui.db); writing it needs a packaged
                    build, because a dev run's execPath is node_modules' electron.exe
tray.ts / tray-icon.ts  the Windows notification-area icon (best-effort: logs and carries
                    on when the session has no notification area)
ipc/router.ts       per-channel zod validation, typed handler map, Result envelope
ipc/handlers.ts     one handler per invoke channel
telegram/           adapter.ts (re-export of the seam) / tdlib/ (real adapter) /
                    updates.ts / events.ts / comment-access.ts (the comment permission rule)
                    The seam and the fake adapter are workspace packages:
                    @wegram/adapter-contract (TelegramAdapter + AdapterEvent/Emitter) and
                    @wegram/mock-adapter (fixture adapter; main injects registerMediaFile
                    and probeImageSize, so the package imports no app code)
telegram/tdlib/     lifecycle.ts (create / crash / restart the client, reports BootState) /
                    boot.ts (that state machine) / client / updates / json.ts (the one
                    "missing array" read) / map/* (content, service.ts holds the one
                    service-copy table and is max-lines exempt, see docs/技术方案.md §8.3;
                    rich, poll, media.ts holds the one media field table)
telegram/tdlib/actions/  TDLib requests as functions over ActionDeps, grouped into
                    chats / pins / history / files / send / comments / poll / users /
                    notification-settings (消息通知's per-scope defaults) and web
                    (即时预览's getWebPageInstantView)
                    (index.ts re-exports); `poll.ts` also owns the visible-poll read
                    (`messages:refreshPoll`): `getMessage` for an ordinary row, plus
                    `getMessageThreadHistory` (one row, server) when the row names its
                    comment thread — a discussion group is not the open chat, so TDLib
                    unloads its rows and `getMessage` would answer from the local store.
                    The server answer is painted as a `poll` patch.
                    message-input.ts holds the one send
                    envelope. pins.ts owns 群公告 + 置顶消息 (one pinned message per
                    chat, and an unpin has to resolve the current id)
telegram/tdlib/chat-api.ts  createChatApi: the chat seam methods (list/open/mute/pin/
                    members/title/join) as one object the adapter class binds; split
                    out of index.ts when the 频道底栏 methods hit its line budget
telegram/tdlib/topic-api.ts  createTopicApi: 话题 (design doc §9.12) — list, create/edit,
                    pin/close/delete, mute, icons, forum layout and 以聊天方式查看 — bound
                    the way chat-api does. `TdlibAdapter.rawInvoke` exists for the test-DC
                    probes only (createNewBasicGroupChat / toggleSupergroupIsForum)
telegram/tdlib/send-api.ts  createSendApi: the message seam methods (send/edit/delete/
                    forward/read/typing/retry/media/album/sticker/voice), split out of
                    index.ts at the same budget when 语音消息's send landed
telegram/tdlib/bot-api.ts  createBotApi: the bot seam methods (bots:commands / bots:callback /
                    bots:inlineQuery / bots:inlineSend), split out the way user-api.ts was;
                    actions/bots.ts holds the TDLib requests (bot_info.commands + description + the
                    Web App menu that feeds the composer's 小程序 button, getCallbackQueryAnswer,
                    searchPublicChat + getInlineQueryResults,
                    sendInlineQueryResultMessage), and map/inline.ts folds the twelve
                    inlineQueryResult* shapes into one row. A bot's profile page is not a bot
                    channel — map/user.ts reads userFullInfo.bot_info into UserProfile.bot
telegram/tdlib/user-api.ts  createUserApi: the person seam methods (userStatus, 资料卡,
                    共同群聊, 举报 and the note / contact writes) as one bound object,
                    split out of index.ts at the same budget
media/              registry.ts (token → path | fileId) / protocol.ts (wx-media://: disk
                    Range streams, plus the branch that tails a download) / stream.ts
                    (the byte pump, pure) / leases.ts (per-file download holders, pure) /
                    image-size.ts / video-meta.ts (an MP4/MOV's size + duration for
                    inputVideo, read from the ISO BMFF boxes; null → send as a document) /
                    voice-file.ts (a recorded 语音消息's temporary OGG: written by the
                    handler, pruned at startup once stale)
store/              ui-db.ts (all SQL) / settings.ts (proxy + TDLib network options) /
                    prefs.ts (ui.db-backed 关闭主窗口 · 发送消息 · 消息字号 · 桌面通知 ·
                    缓存上限, read on demand)
storage-usage.ts    数据与存储's pure rule: 缓存上限 → bytes
proxy*.ts           proxy DTO ↔ stored config
proxy-controller.ts the ONE place that decides the proxy in force (§6.4): manual →
                    WEGRAM_PROXY (dev) → system → direct, plus the 30 s retry that
                    keeps a dead OS proxy from leaving the client offline
system-proxy.ts     reads the OS proxy (Chromium `resolveProxy` on a private,
                    memory-only partition; `reg query` fallback) and the TCP
                    liveness check the pre-TDLib decision needs
system-proxy-rules.ts  the pure parsers above, pinned by `pnpm test`
security/secrets.ts safeStorage (DPAPI) seal/unseal
```

Everything except `telegram/tdlib/**` (the real adapter folder) talks to the `TelegramAdapter` interface.
**ESLint enforces this**: importing `tdl` or `prebuilt-tdlib` anywhere else is an
error (`eslint.config.mjs` → "architecture"). If a change seems to need it, the
change belongs in the adapter.

## Rules that have already cost a debugging session

- **A dead OS proxy must not leave the client offline.** 跟随系统代理 is the
  default mode, and a proxy the user did *not* choose (the OS's, or `WEGRAM_PROXY`)
  is probed before it is applied — `pingProxy` once the client exists, a TCP connect
  before it does — falling back to a direct connection with a 30 s retry. Only a
  manual configuration is applied as written. `proxy-controller.ts` owns that
  decision; the renderer only paints `ProxyState`, and `proxy:get`/`proxy:set` never
  talk to TDLib themselves.
- **All `node:sqlite` calls live in `store/ui-db.ts`** (also lint-enforced).
  `settings.json` keeps only what must be known before any window exists: the
  proxy config (sealed secret) and the TDLib network options (`prefer_ipv6`).
- **`ui.db` uses DELETE journaling, not WAL, on purpose.** When the OS refuses a
  write-open SQLite opens the database read-only *without an error*: reads work and
  only writes answer `attempt to write a readonly database` (the 2026-11-26 settings
  window). On this machine the dev `electron.exe` carries a **Low mandatory-integrity
  label** (inherited from the project folder), while WAL's `-wal`/`-shm` sidecars left
  by a higher-integrity process are Medium — Low can read them but not write them, and
  no restart helps while they exist. DELETE mode has no persistent sidecar: the
  rollback journal is created by the writer and removed on commit. The data folder
  should keep its Low label **inheritable** (`/setintegritylevel (OI)(CI)Low`) so files
  created there by a shell or backup tool are still writable by the app. Every write
  still goes through `UiDatabase.write`, which reopens once on `SQLITE_READONLY` and
  retries, and the connection has a 5 s busy timeout; do not call `db.prepare(...).run`
  directly from a new store method, or it bypasses that recovery.
- **A `wx-media://` token is a local path *or* a file id.** A file id means "TDLib is still
  downloading this": `protocol.ts` tails the file and must measure readable bytes with
  `getFileDownloadedPrefixSize`, never with `stat().size` (the file is sparse). Stopping a
  transfer goes through `media/leases.ts`, so the shell's bubble and the viewer's window
  cannot cancel each other's download. **The first `downloadFile` answer is the file's state
  *before* the transfer was queued** — empty `local.path` for a cold clip, sometimes a zero
  `expected_size` — so `beginStream` waits for `getFile` to report the path; the first answer
  is never "this file cannot be streamed".
- **A recorded voice note outlives its send call.** `messages:sendVoice` writes the
  renderer's base64 to `userData/voice/…ogg` and TDLib uploads from that path
  *after* `sendMessage` answers the pending row, so deleting the file in the handler
  would race the upload; the handler deletes only on failure, and
  `media/voice-file.ts` prunes recordings older than 6 h at startup. The microphone
  is granted to the shell window only (`index.ts`, both the request and the check
  handler): Electron's default with no handler is "allow everything", which would
  let the login / 群二维码 / viewer windows open a device.
- **The renderer never sees a filesystem path.** Only the adapters may call
  `media/registry.ts` to mint a `wx-media://f/<token>` URL; `media/protocol.ts`
  resolves tokens and never request paths, and it must keep Range support.
- **The cache belongs to TDLib.** 数据与存储 never deletes a file itself: `actions/storage.ts`
  reads the exact `getStorageStatistics` (+ fast for the database) and writes through
  `optimizeStorage`, with `file_types` naming the ticked kinds' TDLib types — that table is
  what makes 贴纸 clearable while thumbnails, profile photos and wallpapers stay out. Every
  write answers a fresh exact read; the per-type rows cannot be patched from an aggregate
  "freed" number. 缓存上限 is a local `ui.db` preference, enforced when it changes and once per
  signed-in session (`main/index.ts` `applyCacheLimit` — TDLib republishes `ready` for avatar
  updates, so "once per event" would scan the cache repeatedly). TDLib reports deleted files as
  size/count only, never ids, so a deletion publishes `evt:mediaCleared` (the shell drops its
  cached URLs) and reloads the viewer; `media_cache` in `ui.db` stays unused.
- **`messagesByChat` entries are created only by `setHistory`/`prependHistory`**
  (that is renderer state, but the adapter decides what triggers it): a read
  marker for a chat whose history was never loaded must not look like a loaded
  chat, or groups open empty and never page back.
- Events are emitted as domain `AdapterEvent`s and batched by `telegram/updates.ts`
  (60 ms, monotonic `seq`). Do not push IPC events directly from the adapter.
- **Notifications come from TDLib's notification objects, not from
  `updateNewMessage`.** TDLib already applies mute/mention rules and preview privacy;
  `updateNotification` and `updateNotificationGroup.added_notifications` are forwarded
  as a main-only `notification` adapter event, and `notifications.ts` owns the OS side.
  Suppression uses `ui:setActiveChat` (the renderer owns the active conversation) and
  the shell's focus, never a guess from the chat list.
- **A chat op `remove` deletes renderer data, not just the row** (删除聊天 and 退出群聊
  share it): the store drops the transcript, queued ops, paging state, unread marker and
  the active selection. Leaving `messagesByChat` behind makes a later id collision draw
  a deleted chat.
- **A link preview is part of `messageText`, not a content type** (TDLib 1.8.70 has no
  `messageWebPage`): the preview rides in `content.link_preview` (`linkPreview`), the message
  stays kind `text`, and `map/content.ts`'s `mapLinkPreview` flattens every
  `linkPreviewType*` into the protocol's `LinkPreview` — an album link keeps its media list,
  the single-cover types contribute one item, and a type this client draws nothing for
  still yields the card's words.
- **A text entity's parameters live inside its `type` object, never beside `offset`/`length`.**
  TDLib sends `textEntityTypeTextUrl { url }`, `textEntityTypePreCode { language }`,
  `textEntityTypeMentionName { user_id }` and `textEntityTypeCustomEmoji { custom_emoji_id }`.
  `map/entities.ts` read the entity's own `url`/`language`, so every Telegram hidden link
  ("text shown instead of a raw URL") arrived without its target and rendered as dead
  text — the reported "链接点不了" (2026-11-24). `map/rich-text.ts` synthesises the same
  shape for `richTextUrl`; a fix in one place must move the field into the type in both.
- **A handler's data must be exactly `InvokeResponse<C>` — the handler map is typed
  that way.** Responses are not zod-validated in the router, so a shape mismatch reaches
  the renderer silently. One did: `chats:inviteLink` was declared `{ link: string }` but
  the adapter returned the string itself, so `answer?.link` was **String.prototype.link**;
  the dialog passed that function to `useState`, React ran it as an updater with a null
  state and the renderer died ("String.prototype.link called on null or undefined").
  Fix the schema or the adapter — never wrap/flatten a response only at the handler.
- Password / MTProxy secret are sealed with `safeStorage` (`security/secrets.ts`).
- **TDLib cannot cancel a pending QR confirmation.** `auth:reset` destroys the auth
  client and starts a new one (nothing is stored yet); the QR link arrives as repeated
  `authorizationStateWaitOtherDeviceConfirmation` updates (`waitQr`) and must be passed
  through as-is. A completed user-driven login opens the shell directly; only a session
  restored at startup stops on the profile step (`syncWindowsToAuth`).
- **A client that never comes up is a state, not a log line.** `tdlib/lifecycle.ts` owns
  create/crash/restart and reports `BootState`: `adapter.start()` throwing is `failed`,
  and the client closing while `stop()` did not ask for it is `crashed`. The login window
  stops its spinner on both; a new failure mode must set one of them instead of only
  logging.
- Packaging constraint: `tdjson.dll` cannot load from inside `app.asar`
  (`electron-builder.yml` unpacks it), and TDLib data dirs live under
  `app.getPath('userData')`, which `index.ts` pins to `%APPDATA%\WeGram`.
- **The viewer is a plain top-level window on purpose** (no `parent`): the task bar then
  looks like WeChat's — same process, same group, one WeGram button whose hover preview
  lists both windows. An *owned* window is in that same group too (measured: 3 windows of
  one process show as "3 个运行窗口" under one button), so ownership never affected the
  task bar; it only forces "always above the owner", which is why 定位到聊天位置 could not
  raise the chat and the ownership was dropped. What ownership gave for free is now
  explicit and must stay: the shell `moveTop()`s itself when it has to come forward,
  `hide()/show()`s the viewer with its own minimize/restore, and `closeViewer()`s on
  teardown (`window-all-closed` would otherwise leave an orphan viewer and the app would
  never quit).
- **The test data centers are a separate account space, and they get their own
  session directory.** `WEGRAM_TDLIB_TEST_DC=1` (`telegram/index.ts`) sets TDLib's
  `use_test_dc` and defaults the session to `userData/tdlib/test`; a test-DC client
  cannot open the production database, and pointing it at the real session is the one
  mistake that matters. The authorization steps live in `tdlib/auth.ts`
  (phone/code/password/sign-up/QR/restart) so `index.ts` stays under its size budget;
  `waitRegistration` → `auth:signup` is how a brand-new number finishes. Signing in
  needs an account created by an official app first (see the root `CLAUDE.md`).
- **Credentials are build-time, and mock is development-only.** `bootstrap()` resolves
  `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` from the environment first, then from
  `__WEGRAM_API_CREDENTIALS__` (inlined by `electron.vite.config.ts`); a packaged build
  with neither shows an error dialog and quits, and `createAdapter` refuses the mock
  adapter when `allowMock` (= `isDev`) is false. Never add a second place that reads
  credentials.

## Verify

```powershell
pnpm typecheck
pnpm test
cd apps\desktop; pnpm ui:db-check     # headless ui.db check (node:sqlite)
cd apps\desktop; pnpm tdlib:smoke     # READ-ONLY real TDLib: getMe/getChats/history
cd apps\desktop; pnpm tdlib:test-dc   # test data centers: send/edit/upload/delete
cd apps\desktop; pnpm tdlib:test-dc:writes  # the §9.1 write matrix (album/pin/note/contacts/…)
cd apps\desktop; pnpm tdlib:test-dc:media   # video / mixed album / 取消上传 (needs a real MP4)
cd apps\desktop; pnpm tdlib:test-dc:topics  # 话题: creates a disposable forum and walks the feature
pwsh apps\desktop\scripts\launch-detached.ps1 -Mock   # Electron + mock adapter
```

`spikes/tdlib/data` is a **real account and read-only** (`getMe` / `getChats` /
`getChatHistory`). Writes with real TDLib go to Telegram's test DCs (`pnpm
tdlib:test-dc`, or `WEGRAM_TDLIB_TEST_DC=1` for the app, whose session is its own);
the mock adapter (`-Mock`, `WEGRAM_ADAPTER=mock`) is the UI-fixture path for work that
should not talk to a Telegram account at all.

Never start Electron from an agent shell: Chromium cannot initialise inside the
job object. Use `launch-detached.ps1` (creates the process via WMI); logs land in
`.cache/app.log`.

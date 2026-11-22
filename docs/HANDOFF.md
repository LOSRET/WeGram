# Handoff — WeGram

Written 2026-11-17 at the end of the W1/W2 session, extended the same day with the
W3 main body. Read this first, then `docs/技术方案.md` (authoritative design, Chinese)
and `spikes/tdlib/RESULTS.md` (measured TDLib behaviour). `CLAUDE.md` holds the rules
that must not drift.

The renderer was later rebuilt against the real WeChat 4.x client; that work has its
own handoff — **`docs/UI-HANDOFF.md`** (measured tokens and metrics, icon provenance,
known deltas, pitfalls). Read it before touching anything under `src/renderer`.

The code was then split for agent maintenance and given a real verification layer
(`pnpm verify`, 132 unit tests, lint-enforced architecture rules). **`docs/REFACTOR-HANDOFF.md`**
records what moved where, the conventions the code now enforces, and the batches that are
still pending (`mock.ts`, `preview-bridge.ts`, `styles/index.css`,
`packages/protocol`). Read it before restructuring anything.

**Private-chat gap audit (2026-11-22):** `docs/PRIVATE-CHAT-HANDOFF.md` inventories
what 1:1 chats still lack — send failure/retry, outgoing typing, online status, delete
chat / mark unread, notifications, voice notes, reactions, the peer profile card, album
send and more — with the exact TDLib 1.8.70 API for each, the insertion points, and an
implementation order. Read it before starting private-chat work.

**Private-chat P0 batch (same day):** the audit's five P0 gaps are implemented —
outgoing typing, 标为未读 + 删除聊天 with a chat-list context menu, send failure
(未发送) with 重试, online / last-seen in a private chat's header, and desktop
notifications with a tray icon. Measured notes and the still-unverified parts are in
"Private-chat P0 batch — measured notes" below; the audit document keeps the P1/P2
backlog.

**Private-chat P1 batch (same day):** the audit's P1 list is closed except for two
items that need the owner. Landed: 相册发送 (one `sendMessageAlbum` call), 置顶消息栏,
语音转文字, 表情回应 (display only), 拉黑 + 举报 (a person **and** one message, one
phased `reportChat` sheet), the 资料卡 with 备注 / 共同群聊 (count + a page of chat rows
fetched on demand) / 添加删除联系人, 编辑说明 for a media caption, the 聊天信息
panel's face opening that card, and **语音消息** (recorded in the renderer with
WebCodecs Opus and muxed into OGG in-repo — no new dependency; see
`docs/PRIVATE-CHAT-HANDOFF.md` §6.1). Still open: the **reactions picker** (WeChat has
no reactions; display-only until the owner signs one off) and the 置顶消息 bar's
product call. **No test DC was available in this session either**, so the P1/P2 TDLib
writes (`sendMessageAlbum`, `pinChatMessage`, `setUserNote`, `setMessageSenderBlockList`,
`reportChat`, `editMessageCaption`, `recognizeSpeech`, `addContact`, `removeContacts`,
`getGroupsInCommon`, `inputMessageVoiceNote`) are compile- and mock-verified only —
run `pnpm tdlib:test-dc` before calling them proven. The voice **gesture** was then
clicked through in a mock Electron window (isolated profile, fake media device): a
2 s hold produced a decodable voice bubble (`<audio>` duration 1.9, `readyState 4`)
and a valid OGG/Opus file; the slide-up cancel sent nothing. `inputMessageVoiceNote`
was then confirmed on the **test DC** by the owner's own send: the transcript drew
it as an outgoing voice bubble (0:02), so the server accepts our OGG and an empty
waveform. The CLI probe step is in `scripts/tdlib-test-dc.ts` for the next clean
run — see `docs/PRIVATE-CHAT-HANDOFF.md` §11.

## Where things stand

Greenfield → working skeleton in three milestones:

- **W1** Electron shell, `packages/protocol` IPC contract, mock adapter, real TDLib
  adapter with manual auth state machine, SOCKS5/HTTP/MTProxy proxy support, WeChat-style
  standalone login window + three-column shell.
- **W2** virtualised message list, anchored history paging, send / reply / edit /
  delete / forward, per-chat drafts, `ui.db` (drafts, theme, scroll-anchor columns).
- **W3 main body** media send/receive (photo + document with upload/download progress),
  `wx-media://` serving for downloaded files, the three sticker formats
  (WebP/TGS/WebM), a sticker picker, TL entity rendering, day separators, the unread
  divider, read receipts, and a typing indicator that expires. Mock fixtures now carry
  real generated PNG/WebP/TGS media, so every renderer path is exercised offline.
- **Login window (W3 addendum, 2026-11-18; QR login the same day)**: sign-in is no
  longer a page inside the shell. The app starts in its own frameless **280×373**
  window (`main/login-window.ts` + `screens/LoginWindow.tsx`, `#login` hash) with the
  client's self-drawn strip (WeGram / 齿轮 / ×). The first screen is the **QR code**
  fed by TDLib (`requestQrCodeAuthentication` → `waitQr` / `tg://login?token=…`,
  encoded locally with the approved `qrcode` dependency); **用手机号登录** falls back
  to the phone → code → 2FA form through a client restart (`auth:reset`). A
  user-driven sign-in ends **directly in the shell**; only a session restored at
  startup shows the client's profile step (80 px avatar, 168×36 进入 WeGram) first.
  A sign-out recreates the login window first so `window-all-closed` never fires
  mid-swap. Design: `技术方案.md` §9.6; measured metrics and deltas (footer copy,
  hand-drawn glyphs, fixed size): `UI-HANDOFF.md` §2.2 / §5 items 21–26.
- Spike 2 (real login + session reuse) is **done and verified**; the session lives in
  `spikes/tdlib/data`.
- **Image viewer (W3 addendum)**: a photo no longer opens an overlay inside the
  transcript — it opens WeChat's standalone viewer window (75 % × 90 % of the screen,
  40 px toolbar carrying 置顶 / 上一张 / 下一张 / 预览 / 缩放 / 原始大小 / 旋转 / 保存 / 更多,
  wheel + drag zoom, Esc to close). Design: `技术方案.md` §9.5; measured metrics and the
  deltas vs the client: `UI-HANDOFF.md` §2.1 and §5 items 12–16.
- **Video in the same window (W3 addendum, later)**: the client's 图片和视频 window also
  plays videos. A video bubble no longer plays inline with Chromium's native controls —
  clicking it opens the viewer window, which takes `ViewerItem.kind` and renders
  `VideoCanvas` (fitted `<video>` + the client's translucent player bar: play/pause,
  2 px timeline with a 10 px thumb, `00:00` clocks, 倍速 0.5–2×, mute, idle hiding,
  Space/←/→/M). Toolbar loses the zoom/rotate group for videos; 保存 lands in 视频 and
  复制/打印 are hidden. Measured metrics: `UI-HANDOFF.md` §2.1 (second table), deltas 17–20.
  The mock now ships a 6 s WebM fixture (`mock-assets.ts` `SAMPLE_VIDEO_WEBM`) so the
  window is reachable without the real account.
- **通讯录 (contacts, 2026-11-19, reworked the same day)**: the rail's 通讯录 tab
  switches the shell to the address book. The middle column carries the client's
  header stack (search, 通讯录管理 card, 新的朋友 / 公众号、服务号 / 企业微信联系人 /
  我的企业 / 联系人) and the account's Telegram contacts grouped by initial; the right
  pane is the contact card (60 px avatar, Telegram号, 朋友资料, 更多信息 —
  手机号 / 数据中心 — and 发消息 / 语音聊天 / 视频聊天). **Data = TDLib `getContacts` + `getUser`** (`contacts:list`), not the
  chat list: a person you never wrote to has a card but no conversation, and 发消息
  creates the private chat on demand (`chats:openPrivate` → `createPrivateChat`).
  Measured on the real account: 4 contacts, 2 with a username, 3 with a phone.
  The 数据中心 row is decoded from the profile photo's persistent file id
  (`tdlib/file-dc.ts`): TDLib exposes no DC field, and the photo is the only DC
  signal a client gets (Pyrogram's `user.dc_id` is the same MTProto field), so
  the value is approximate and 未知 for someone without a photo. Phone numbers
  arrive without the leading `+`; the card adds it (`lib/format.ts`).
  Metrics, icon provenance and the deliberate deltas: `docs/UI-HANDOFF.md` §2.4, §3,
  §5 items 27–30.
- **Message comments (2026-11-20)**: a message that owns a Telegram comment thread draws
  WeChat's 评论 N 条 bar under its bubble; opening it fetches one page of
  `getMessageThreadHistory` into Telegram's discussion view — a full-pane panel that
  slides in from the right over the chat, with the commented post pinned on top. The
  comments are the transcript's own rows (`MessageRow`: avatar, sender, bubble, hover
  time, media), the input at the bottom is the chat composer's card, and
  `messages:sendComment` posts into the thread's discussion group (`getMessageThread`
  resolves it from the clicked message). Whether the input is offered at all follows
  the official desktop client: `messages:commentInfo` composes membership, join-to-send
  and permissions into canComment/canJoin (pure rule in `telegram/comment-access.ts`),
  and a non-member gets 加入讨论组 / 申请加入讨论组 instead of the composer. The list opens
  at the top of the thread — WeChat reads a channel's comments from there — and each
  thread remembers the row the reader left (`ui:saveCommentAnchor` → `comment_ui_state`,
  keyed by the commented message so a channel's own anchor stays untouched). Reaching
  the top loads an older page (with scroll compensation); Esc / ‹ closes with the
  reverse slide. The bar's numbers come from
  `message.interaction_info` (comments, plus 阅读/转发 for channels) and live updates patch
  the counter through the new `interaction` message op instead of remapping the message.
  New channel `messages:comments`; new DTO `MessageInteraction`; mock fixtures carry two
  group threads and the channel's 78-comment thread. Design:
  `技术方案.md` §9.8. Posting landed later, and the box is now the full composer:
- **完整的评论框 (2026-11-21)**: the discussion view's input used to be a stripped
  textarea; it is now the chat composer's **own card** — `components/composer/ComposerCard.tsx`
  (text, the 表情/收藏/文件/截图/语音 tool row, 发送, attach menu, expression panel) rendered by
  both `Composer` (chat) and `CommentComposer` (thread). The two callers only own where a
  send goes: drafts / reply-edit banners / anchored-window reloads for a chat, slow mode and
  `messages:sendComment` for a comment. So `messages:sendComment` now carries a
  discriminated `content` — text, a sticker, or a local photo/document — and the adapter
  builds sticker/media content with the same `stickerContent` / `mediaContent` helpers a
  chat send uses, replying to the thread root inside the discussion group. The 表情 panel no
  longer sends by itself (`onSendSticker`), and the mock builds comment rows through the new
  `packages/mock-adapter/src/media.ts`, so the two fakes and TDLib all answer the same shape.
- **聊天信息 side panel (2026-11-21; group layout the same day)**: the header's "…"
  opens the client's 聊天信息 panel — a 314 px sheet that **overlays** the transcript and
  the composer (the owner corrected the first push version: the panel presses on the
  messages, it does not reflow them). A private chat gets the peer + 查找聊天内容 /
  免打扰 / 置顶 / 清空; a group gets 搜索群成员, the member grid + 添加, 群聊名称 (rename,
  `setChatTitle`), 群公告 (the newest **pinned message**, tap → locate), 群二维码 (invite
  link QR), the same rows, and 退出群聊 (`leaveChat`). 查找聊天内容 stays an in-panel
  search over `search:inChat`; 清空聊天记录 is `deleteChatHistory` with `revoke: false`
  (this account's copy only). 群二维码 opens its **own frameless 360 × 560 window**
  (`main/qr-window.ts` + `screens/QrWindow.tsx`, `#qr`): member collage, 群聊：…, a
  280 px code, the 7-day validity line and 转发给朋友 / 复制图片 / 保存图片. The code is a
  temporary invite link (`createChatInviteLink` + 7 days); the window rasterises the
  PNG itself and the actions copy it (main clipboard), save it (native dialog) or send
  it as a photo message. New channels `qr:open/info/copy/save/share/close` and
  `chats:setPinned` / `clearHistory` /
  `members` / `setTitle` / `leave` / `pinned` / `inviteLink`; the chat channels live in
  `packages/protocol/src/chats.ts` and the chat DTOs in `chat.ts` (both split at the
  550-line budget). Design: `技术方案.md` §9.9; measured metrics and the deliberate
  deltas: `UI-HANDOFF.md` §2.8 / §5 item 33.
- **未加入频道的底栏 (2026-11-21)**: a channel opened from 搜索 or an `@username` is
  readable without being subscribed, and the 服务号 card used to offer 静音 anyway. The
  bottom edge now asks `chats:joinState` (`supergroup.status` is the account's own
  membership; `join_by_request` decides the wording) and draws a single 加入 item instead
  — 申请加入 for a request-based channel, 已申请加入 after the request went out, and no
  keyboard switch. 加入 calls `chats:join` → `joinChat`: `chatJoinResultSuccess` flips
  the card back to 静音 (with the keyboard when the account administers the channel) and
  toasts 已加入频道, while `chatJoinResultRequestSent` only toasts. The fake account's
  Telegram News channel starts unjoined, so both states are clickable offline. Design:
  `技术方案.md` §9.9.
- **Sender photos in the transcript (W3 addendum)**: group members are no longer
  initials. `Message.senderAvatarUrl` carries the picture a row can already draw, and
  the adapter's photo pool (the one that fetched chat photos) now resolves **people**
  too, keyed by user id; a photo that finishes after the page was mapped arrives on the
  new `evt:avatars` event instead of forcing a refetch. Our own rows draw
  `Self.avatarUrl`, a channel post draws the chat photo. Design: `技术方案.md` §7.2.

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
  are hand-drawn, and the brand mark — rail 聊天 tab, login window, empty-pane watermark —
  is the Telegram roundel from Simple Icons. The name manifest in the DLL has no
  recoverable name→payload mapping — see `UI-HANDOFF.md` §3 before trying again.
- **@提及可点 (2026-11-21)**: a mention is a conversation entry point, not decoration.
  Both TL kinds render as the same blue, clickable name — `mention` (`@username`) and
  `mentionName` (TDLib's id-carrying mention, which the mapper used to drop). A tap
  opens that person's chat: the id goes through `chats:openPrivate`, the username through
  the new `chats:openUsername` (`searchPublicChat`), and a name nobody owns becomes a
  Chinese toast instead of a dead click. `@all` stays plain (it names a group), tapping
  your own name says so instead of opening 文件传输助手, and fake-account group chat 4
  carries both entity kinds for the preview and the mock Electron window.
- **Telegram 链接在应用内跳转 (2026-11-21)**: `t.me/<username>[/<post>]`, `t.me/s/…`,
  `t.me/c/<id>/<post>`, `tg://resolve`, `tg://user` and `tg://openmessage` now open the
  chat inside the shell instead of leaving it; a link that names a post also lands on that
  row (`requestLocate` before activation, so the first page is fetched around it). The
  parser is `lib/telegramLink.ts` (pure, every form unit-tested), the opener is
  `lib/openTelegramLink.ts`, and the one anchor used by message text and inline-keyboard
  buttons is `components/TelegramLink.tsx`. Invite/action links (`t.me/+…`, `joinchat`,
  `/addstickers`, `/share`, `/proxy`) still go to the OS, and modifier/middle clicks keep
  the "open outside" meaning. Group chat 4 in the fake account carries a `t.me` link.
- **Polls (2026-11-21)**: `messagePoll` is now a real card, not just its question as
  text. `Message.poll` (protocol `poll.ts`) carries the options, counters, flags and
  quiz answer; `messages:vote` / `messages:addPollOption` drive `setPollAnswer` /
  `addPollOption`, and TDLib's `updateMessageContent` remaps the row as a `replace`.
  The card lives in `components/message-list/PollBubble.tsx` + `lib/poll.ts`, with
  `--wx-poll-*` tokens in both themes; the fake account carries an open multi-answer
  poll, an unanswered quiz and a closed poll with results. Switching an answer, a
  retract (tap the chosen single answer), staging + 投票 for multi-answer, a quiz's
  correct/wrong colours and 添加选项 were all checked in the browser preview.
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

1. **Writes never touch the real account.** The Telegram account in
   `spikes/tdlib/data` is real and **read-only** (`getMe`/`getChats`/`getChatHistory`).
   Anything that sends, edits, deletes, forwards or marks read with real TDLib runs on
   Telegram's test DCs — `pnpm tdlib:test-dc`, or `WEGRAM_TDLIB_TEST_DC=1` for the app
   (its own session under `userData/tdlib/test`). The mock adapter
   (`WEGRAM_ADAPTER=mock` / the launch script's `-Mock`, also the browser preview) is now
   only the UI-fixture path, for work that should not talk to a Telegram account at all.
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

### Release packaging

`.github/workflows/release.yml` builds the NSIS installer on `windows-latest` and publishes
it as a GitHub Release; the version tag is the only input:

```powershell
git tag v0.2.0
git push origin v0.2.0        # verify → package → Release
gh workflow run release.yml -f tag=v0.2.0    # re-run an existing tag
```

The workflow stamps `apps/desktop/package.json` from the tag (the committed version is a
placeholder), runs `pnpm verify`, then `pnpm --filter @wegram/desktop package:win`
(`electron-vite build && electron-builder --win`). A re-run uploads the assets with
`--clobber` instead of failing on the existing release.

**Two repository secrets are required**: `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`
(the deployment's own my.telegram.org app). `electron.vite.config.ts` inlines them into the
**main bundle only** — preload and renderer never see them — and the workflow fails in ~2s
when either is missing. A packaged build therefore always has credentials:

- credentials precedence: `process.env`/dev `.env` → the inlined value;
- a packaged build without credentials shows an error dialog and quits, and it **ignores**
  `WEGRAM_ADAPTER=mock` — the fixture data set is development-only (`createAdapter` refuses
  it when `!allowMock`);
- the mock-only UI hints (登录窗's `Mock 适配器：10 秒后自动模拟扫码`, the 设置菜单's
  `Mock 适配器 · v0.1.0`) can only appear in `pnpm dev`.

The first real build is in: run 44301387485 on tag `v0.1.0` finished green in 4m31s and
published `WeGram-0.1.0-x64.exe` (108 MB) + its `.blockmap`.

Packaging **cannot** be verified locally, so always read the run instead: the same script does
produce `release/win-unpacked` here with
`app.asar.unpacked/node_modules/@prebuilt-tdlib/win32-x64/tdjson.dll` in place, but the NSIS
phase runs the freshly built installer stub once (its `BUILD_UNINSTALLER` pass writes
`__uninstaller.exe`, which electron-builder then signs), and that child process does not survive
this shell — the same job-object class of failure as Electron itself. It works on the runner.

**Shipping the dll unpacked is not enough — the loader must be handed the unpacked path.**
`prebuilt-tdlib.getTdjson()` resolves through `require.resolve`, so inside a packaged build it
returns `…\app.asar\node_modules\@prebuilt-tdlib\win32-x64\tdjson.dll`. Electron redirects `fs`
reads there (an `existsSync` check passes) but not `LoadLibrary`, so `createClient` throws
`Dynamic Loading Error: Win32 error 126` and `bootstrap` only logs `adapter failed to start`:
the login window spins on 正在连接 Telegram… forever and TDLib never even opens
`userData/tdlib` (measured on the installed 0.1.1 build). `tdlib/client.ts` →
`resolveTdjsonPath()` maps the path onto `app.asar.unpacked`; with it the same packaged exe logs
`TDLib client created` and `TDLib 1.8.70 ready for phone login`. That silent failure now reaches
the window: `tdlib/lifecycle.ts` reports `BootState.failed` with the throw reason, and the login
window shows 未能启动 instead of spinning (see the 技术方案 §6.1 / §9.6 notes).

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
  (`%APPDATA%\WeGram\mock-media`): `design-v3.png`, `sunset.png`, `需求说明.md`,
  `sticker-face.webp`, `sticker-heart.webp`, `sticker-wave.tgs`,
  `premium-sticker-effect.tgs`. Delete that folder to force regeneration.
- `-RemoteDebugPort` exposes the renderer over CDP (`http://127.0.0.1:9224/json`); that
  is how the prepend/FPS numbers above were measured without opening DevTools. rAF and
  `PerfPanel` only run while the window is actually visible, so focus it first.

- `tdlib:smoke` env: `TDLIB_PROXY=socks5://host:port` (or `http://host:port`), `WEGRAM_TDLIB_DIR`,
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
packages/adapter-contract/src/  the seam: TelegramAdapter + AdapterEvent/Emitter
packages/mock-adapter/src/      the fake adapter + generated fixture media (mock-assets.ts)
packages/mock-session/src/      the fake session's pure rules (shared with the preview)
packages/mock-fixtures/src/     the demo account both fakes serve
apps/desktop/src/main/
  index.ts                   app lifecycle, main-window creation, theme overlay, adapter
                             wiring, the login↔shell hand-over (login:enter / sign-out)
  login-window.ts            the frameless 280×373 login BrowserWindow (#login hash)
  viewer.ts, viewer-size.ts  the 图片和视频 BrowserWindow and its measured size maths
  ipc/router.ts              per-channel zod validation, Result envelope
  ipc/handlers.ts            one handler per invoke channel (incl. native file picker)
  media/registry.ts          token → path | fileId registry (renderer never sees paths)
  media/protocol.ts          protocol.handle('wx-media'): disk Range streams + the branch
                             that tails a file TDLib is still downloading
  media/stream.ts            (pure, unit-tested) the byte pump behind that branch
  media/leases.ts            (pure, unit-tested) who still waits for a file's transfer
  media/image-size.ts        PNG/JPEG/WebP/GIF header probe (inputPhoto needs real sizes)
  telegram/adapter.ts        re-export of the seam from @wegram/adapter-contract
  telegram/tdlib/           ONLY folder allowed to import `tdl` (index/lifecycle/boot/client/actions/updates/avatar-cache/stickers/proxy/map)
  telegram/updates.ts        EventBus: 60 ms batching, monotonic seq
  telegram/events.ts         AdapterEvent → evt:* channels
  telegram/index.ts          adapter selection (mock / tdlib, WEGRAM_ADAPTER)
  store/ui-db.ts             ALL node:sqlite access (drafts, theme, anchors, media cache)
  store/settings.ts          JSON store for the proxy only (DPAPI-sealed secret)
  proxy.ts, proxy-url.ts     stored ↔ view/masked config, URL parsing
  security/secrets.ts        safeStorage seal/unseal
  preload/index.ts           window.tg.invoke / window.tg.on, channel whitelist
apps/desktop/src/renderer/src/
  main.tsx                   route by hash: plain = shell, #viewer = 图片和视频, #login = login
  App.tsx                    shell only (auth must be ready) + event subscription, typing expiry
  screens/LoginWindow.tsx    the login window: QR screen, phone/code/2FA fallback, profile step
  components/QrCode.tsx      login QR: one SVG path from the qrcode matrix
  lib/qr.ts                  QR matrix/path helpers (pure, unit-tested)
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
                             ChatHeader.tsx, ChatInfoPanel.tsx, ChatInfoSearch.tsx,
                             Placeholders.tsx, labels.ts
  components/MediaBubble.tsx photo lightbox / video / file card / voice bar + progress
  components/StickerRenderer.tsx WebP <img>, TGS lottie, WebM <video>, offscreen pause
  components/StickerPanel.tsx installed sets → grid → send sticker
  components/RichText.tsx    TL entity renderer (bold/italic/code/pre/link/spoiler)
  components/Composer.tsx    IME guard, reply bar, edit mode, draft debounce, attachments
  lib/useAnchoredScroll.ts   ready gate, 40px stick-to-bottom, resize compensation
  lib/media.ts               per-owner request dedupe + media URL/progress hooks + cancel
  lib/mediaVariant.ts        (pure, unit-tested) which photo size covers a box
  lib/mediaPriority.ts       (pure, unit-tested) the TDLib download priority ladder
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

Rules that keep it maintainable: only `telegram/tdlib/**` knows TDLib JSON; new fields
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
- **Older history has to be *prefetched*, not fetched at the top** (2026-11-19). The
  fetch itself is the jank: an older page comes from TDLib's local cache or from the
  server (first server answer measured at ~3.4 s, which is why `LOAD_OLDER_TIMEOUT_MS`
  exists), while a wheel gesture covers the last screen in about a second — the reader
  hits `scrollTop < 160` and the wheel goes dead until the page lands. `useChatHistory`
  `.prefetchOlder` now keeps one page in `olderPagesByChat` (fetched on mount and after
  every landing); `loadOlder` only has to prepend it, so the "正在加载更早的消息…" chip
  does not show in normal reading. The buffer is a *snapshot*: it is dropped when a
  buffered row is deleted/edited, when the window is replaced by `setHistory`, and an
  empty answer is never buffered (a cold TDLib cache answers `[]`).
- **Never put a percentage `max-width` on the bubble itself** — on a flex child it
  resolves against the content size and collapses to min-content. It lives on
  `.wx-message-stack`.
- **`titleBarOverlay` buttons are painted above web content**, so the title bar must
  reserve space with `padding-right: calc(16px + (100% - env(titlebar-area-x, 0px) -
  env(titlebar-area-width, 100%)))`. A fixed spacer only pushes content into the buttons.
  The overlay colour also has to be repainted from the main process on theme change.
  **Whatever sits under the controls must match the overlay colour** (what
  `applyTitleBarTheme` sends — currently the rail colour `#e0e0e0` / `#2d2d2e`, height
  32 px) or the bitmap shows a seam. The overlay covers only the right-hand control
  area, not the whole strip, so the strip keeps the rest of the window looking
  consistent. The login window is a separate case: it is `frame: false`, draws its own
  × and gear, and needs no overlay at all (design doc §9.6).
- **A pending QR login cannot be cancelled in TDLib.** `requestQrCodeAuthentication`
  works from `waitPhoneNumber`, and TDLib then keeps re-sending
  `authorizationStateWaitOtherDeviceConfirmation` with a fresh
  `tg://login?token=…` link. `setAuthenticationPhoneNumber` is refused in that state
  and there is no cancel call, so the login window's phone fallback restarts the
  client (`auth:reset` → `destroy` + new client). Do not replace that with a direct
  phone submit — it fails at the TDLib boundary.
- **Test-DC accounts can only be created from an official app, not from TDLib
  (measured 2026-11-20, confirmed upstream).** `WEGRAM_TDLIB_TEST_DC=1` → `use_test_dc`
  does connect to the test environment (test DC 1 `149.154.175.10:443`, binlog
  `td_test.binlog`; `99966XYYYY` numbers are even validated, `X` 4–5 →
  `PHONE_NUMBER_INVALID`). But the reserved-number derived code (DC id ×5/×6, still
  documented on core.telegram.org/api/auth#test-accounts and in Telethon/Pyrogram) is
  answered with `PHONE_CODE_INVALID` — with this project's `api_id` and with the public
  test `api_id` 17349, and after `resendAuthenticationCode`. TDLib's maintainer says why
  in tdlib/td#3083: *"Test accounts were disabled due to extensive abuse of them. Now a
  real phone number is required to create an account in Test DC"* and *"an official
  mobile application is required to create an account"* (iOS Debug menu / Android beta;
  Telegram Desktop beta can also switch to the test server). A real number gets
  `authenticationCodeTypeTelegramMessage` (6 digits) instead of SMS: the code is
  delivered into an **already authorized test-DC session**, and `resend` is refused for
  that type — so with no session on the test server there is nowhere for the code to go.
  Path forward (proven end-to-end 2026-11-20): log the number into the test server with
  an official app first — Telegram Desktop beta, Alt+Shift + right click "Add account" →
  **Test server** — then the TDLib login's 6-digit code arrives as a Telegram service
  message inside that session and `WEGRAM_TEST_CODE` completes the sign-in. Measured on a
  fresh test account: `ready`, 3 chats, send → edit → photo upload → delete all pass.
  Also measured: `sendMessage` answers with TDLib's **local** message id, and
  `editMessageText`/`deleteMessages` on that id fail with "Message not found" until
  `updateMessageSendSucceeded` swaps in the server id (`td-5242881` → `6291456`) — any
  headless write check must wait for the row's id to stop changing.
- **The dark palette is a *lifted* grey scheme, not near-black — measured 2026-11-18.**
  Captured the running client with `PrintWindow(hwnd, dc, 2)` and took a pixel histogram
  per surface: title strip / rail **#2D2D2E**, conversation list **#3B3B3D**, chat pane
  **#1E1E1F**, incoming bubble **#2F2F30**, own bubble **#35D28D**, selected row
  **#0DA869**, search pill **#454547**, text **#E1E1E5**, secondary **#7B7B80**, rail glyphs
  **#969697**, toolbar glyphs **#A5A5A5**, disabled send fill **#29292A** with **#6A6A6A**
  ink. The dark accents are the vivid light-theme greens, not darkened ones, and there is
  **no divider under the pane header** — one flat surface. The previous dark block
  (`#191919` / `#1f1f1f` / `#111111`, muted greens) was wrong. Why PrintWindow: the DSH
  overlay card sits on top of the screen, so `ImageGrab` captures *it*; the computer-tool
  screenshot excludes the card but is a re-encoded JPEG; `PrintWindow` returns the
  window's own pixels (pass `PW_RENDERFULLCONTENT = 2`, and call
  `SetProcessDpiAwareness(2)` first or `GetWindowRect` answers in virtualised pixels and
  the bottom of the window is cut off).
- **`node:sqlite` exists in Electron (45 ships Node 24.22)** — no better-sqlite3, no
  Electron-ABI rebuild.
- **Electron 45 changed two things this code depended on.** `clipboard.writeImage()` is
  gone: the clipboard is now the web-standard async API, so 复制图片 (`viewer:copy` in
  `main/ipc/handlers.ts`) writes `new ClipboardItem({ 'image/png': blob })` through
  `clipboard.write()`. And the binary no longer comes from a `postinstall` — 45 ships
  `install.js` as the `install-electron` bin, so a fresh checkout needs
  `pnpm electron:install` before `pnpm dev` / `launch-detached.ps1` (`pnpm build` and
  electron-builder fetch their own copy). It is flagged experimental upstream, hence the single-file
  confinement. Expect an `ExperimentalWarning` in the log.
- **`sender_id` has two shapes.** It is `messageSenderUser { user_id }` **or**
  `messageSenderChat { chat_id }`; channel posts and anonymous admins only fill
  `chat_id`. Reading `user_id` alone left those at `未知`. `Message` now carries an
  optional `senderChatId`, `senderName` falls back to the chat title, and the adapter
  caches titles (`chatTitles`, filled from `mapChat` and `updateChatTitle`) next to
  `userNames`. Measured on the real account: 20/20 messages in a channel use
  `messageSenderChat` (`senderChat` line in `tdlib:smoke`).
- **A comment thread is a TDLib message thread, and the count is free.**
  `message.interaction_info.reply_info.reply_count` is filled only for channel posts
  with a linked discussion group and for the posts inside that group — exactly the rows
  that get WeChat's comment bar. `getMessageThreadHistory` is called with the
  *commented* message's `chat_id`; for a channel post TDLib routes to the linked
  supergroup itself, so the renderer never needs the discussion chat id. It answers
  newest-first and treats `from_message_id` as exclusive, like `getChatHistory`;
  `actions/comments.ts` sorts a page ascending.
  Measured on 2026-11-20 (live, over CDP and the shipped type defs), three facts that
  shape the bar:
  (a) **`message.properties` does not exist in TDLib 1.8.70** — `getMessageProperties`
  is a call, not a field — so the old `raw.properties?.can_get_message_thread` read was
  `undefined` on every real message and `canOpen` never arrived (every row had
  `canOpen: null`); "this post owns a thread" is now read from `reply_info` being
  present, which is true from the first post with `reply_count: 0` until somebody
  comments. A 0-comment thread therefore still draws the bar, as 写评论 — hiding it made
  "有评论区" posts indistinguishable from posts with none, and nobody could be the first.
  (b) `getMessageThreadHistory` answers a 0-comment thread with **"Receive messages in
  an unexpected chat"**, so `CommentPanel` seeds an empty page for it instead of asking.
  (c) `updateMessageInteractionInfo` fires on every view and **may carry no
  `reply_info`**, so the `interaction` op is a partial patch: the old
  `?? { comments: 0 }` fallback zeroed a real count and the bar vanished on the first
  view after opening the post (several posts in 心惊报 reproduced it; the fix keeps
  only the fields the update actually mentions).
  (d) **The handle is a channel-post feature, not a `reply_info` one.** TDLib also
  reports `reply_info` for rows inside a linked discussion group, and a count-only test
  drew 写评论 under ordinary group messages. The official clients gate on the post
  (tdesktop `checkDiscussionLink`, Android `hasDiscussion && isLinkedToChat`); checked
  against Telegram Desktop 7.4.5 on 2026-11-21, those group rows carried no handle.
  `isCommentablePost` now gates ours the same way: channel chats only — a discussion
  group's history holds comments, never the post, so the thread a group row names is
  one this client cannot open.
- **Restoring a reading position needs all three pieces.** (a) the list must not mount
  before the stored anchor is known — a cached chat otherwise captures the bottom as its
  position; (b) `scrollToIndex` is only an estimate with dynamic row heights, so the
  position is corrected against the anchor row's DOM node, the same way prepends are;
  (c) `unpin()` must be called before restoring or the stick-to-bottom `ResizeObserver`
  undoes it. The anchor is "first visible slot + its offset", and *no row at all* (a
  null anchor) means "was at the bottom".
- **"Anchor known" has to be reset during render, not in an effect.** `useChatHistory`
  used to set `anchorKnown = false` inside its effect, so the render for a *new* chat still
  carried the old chat's `true`. `ChatPane` then mounted the list one frame early — with
  `pendingAnchor` already per-chat (null) — and that mount landed at the bottom and wrote
  `bottom` into `ui.db` before the new chat's `ui:getAnchor` could answer. Measured on the
  mock: the stored anchor `{14958, -46}` was read as `null` on the very next open, so every
  *cached* chat reopened at the bottom. The reset is now an in-render state adjustment
  (`stateChatId !== activeChatId`), which React resolves before committing children. The
  cold path was never affected: with no cached messages the pane shows a placeholder, not
  the list.
- **The stick-to-bottom pin is a function of geometry, not of scroll events.**
  `lib/scrollGeometry.ts` (`readScrollPin`) is the single rule; `useAnchoredScroll`
  re-derives it from both `ResizeObserver`s (content *and* container) and after a restore,
  and `useAnchorSave` uses the same predicate. Why: a transcript shorter than the viewport
  never scrolls, so waiting for a scroll event leaves `atBottom === false` forever — the
  next incoming message then raises "↓ N 条新消息" over a message the reader can see, and the
  list stops following new messages. Three measured ways into that state: a restored anchor
  whose rows measure shorter than the virtualizer's `estimateSize: 68`, a window grown until
  the transcript fits, and a transcript that shrank (delete/edit). A layout change is also
  when a stored anchor becomes unusable, so `MessageList` then records "bottom" once —
  nothing else would ever clear it.
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
- **Sender photos ride the same pool and a second event.** `mapMessage` never waits for
  a photo: it copies the cached URL (`userAvatarUrls`), then queues the sender through
  the 4-wide pool. Finished ones are batched into `evt:avatars` (keyed by user id, so one
  person's photo serves every chat) rather than re-emitting messages — a transcript page
  has no way to patch 40 rows without a refetch. Consequences worth knowing: the pool is
  shared with chat photos, so opening a big group right after start-up queues dozens of
  senders (if chat photos feel slow, that queue is the first suspect); "this person has
  no photo" is remembered for the session, and `updateUser` for somebody else refetches
  only when the file id actually changed (it also fires for name-only changes).
- **This TDLib's `inputMessagePhoto` has no width/height.** Dimensions live on
  `inputPhoto`, so a photo cannot be sent without knowing its pixel size. The main
  process parses PNG/JPEG/WebP/GIF headers first; when it cannot, the file is sent as a
  document instead of producing a broken photo bubble. `inputMessageSticker` also needs
  `inputSticker.width/height` and an emoji.
- **Sticker set ids are int64 strings in TDLib.** They cross IPC as strings; the sticker
  itself is identified by the numeric file id. `getInstalledStickerSets` only returns
  set summaries — the grid needs a second `getStickerSet` call.
- **The installed list ships a tab icon in `covers`, not in `thumbnail`.** Measured on
  the real account: `thumbnail` was null for 6 of the 8 visible sets and `covers` held
  the set's first sticker every time, so the strip fell back to two characters of the
  title. `listStickerSets`/getStickerSet now resolve the icon the way tdesktop does
  (`StickersSet::lookupThumbnailDocument`): set thumbnail → first sticker → `covers[0]`.
  All 192 sets had an icon afterwards.
- **A sticker's thumbnail is not the sticker's format.** TDLib serves a static WebP as
  `sticker.thumbnail` even for a TGS/WebM sticker (measured 2026-11-19: the TGS pack's
  thumbnail file came back `content-type: image/webp`, the WebM pack's too), so a grid
  that paints the thumbnail must switch on `thumbFormat` (`MessageMedia.stickerThumbFormat`);
  reusing `stickerFormat` there sent WebP bytes through lottie-web (gzip throw → emoji
  fallback, 38/38 cells of a TGS pack) and through `<video>` (`MEDIA_ERR_SRC_NOT_SUPPORTED`,
  `videoWidth === 0` → blank, 120/120 cells of a WebM pack). Chat bubbles were fine because
  they draw the full file. Static WebP packs were the only ones that ever worked in the
  picker — that is the whole "some packs load, some don't" symptom.
- **One emoji is not a text message.** TDLib's `can_be_animated_emoji` (client side, in
  `MessageContent.cpp`) turns a message whose whole text is one emoji — or one custom-emoji
  entity covering it all — into `messageAnimatedEmoji`, carrying the AnimatedEmoji sticker
  (`animated_emoji.sticker`, TGS/WebM/WebP) plus a click sound (`animated_emoji.sound`, an
  OGG/Opus file that is downloaded only on the first click). The renderer draws it
  bubble-less at 112 px, plays one pass and replays on click (`playback="once"`), which is
  what Telegram's animated-emojis doc asks for; looping forever, as a sticker does, reads as
  noise in a transcript. A custom emoji whose sticker TDLib has not resolved yet comes back
  with no sticker file and falls back to the glyph (kind 'text'); `updateMessageContent`
  remaps the row once the sticker lands. The glyph stays in `text`, so previews, quotes and
  复制 keep working — and the chat list shows the emoji, not a label.
- **Custom emoji are stickers keyed by an id, not characters.** `textEntityTypeCustomEmoji`
  carries only `custom_emoji_id`; the art comes from `getCustomEmojiStickers`, which
  answers **in arbitrary order and only for the ids it knows** — so the response must
  carry each id back (TDLib puts it in `full_type.custom_emoji_id`), never rely on
  position. One call takes up to 200 ids. The entity's covered text is the base glyph,
  which is why it stays the fallback for 复制, chat-list previews, unknown ids and
  offline. On the real account (2026-11-20) a channel post carried six custom emoji in
  its caption while the app drew six plain emoji — that is the symptom this fixes.
- **A premium sticker's effect is a second file, and `is_premium` is the switch.**
  TDLib ships the effect as `sticker.full_type.premium_animation` (a TGS) and marks the
  message with `messageSticker.is_premium`; the mapper only carries
  `MessageMedia.premiumEffectFileId` when both say yes, because the flag can stand while
  the file is still unknown. The renderer draws it once at 1.49× the sticker
  (tdesktop's `kPremiumMultiplier = 1 + 0.245 * 2`), fades it out and replays it on a tap.
  The mock's generated effect is built from the same Lottie constructs as
  `sticker-wave.tgs` on purpose: a first version using polystar/ellipse shapes with
  animated position and scale parsed fine and drew **nothing** (every layer's bbox was
  0 × 0), while rounded rects with animated opacity/rotation render as expected — keep
  fixture TGS art to the constructs that fixture already proves.
- **The media scheme must be CORS-enabled, or every TGS sticker fails.** `wx-media://` was
  registered with `supportFetchAPI` but without `corsEnabled`, and a renderer loaded from
  `file://` counts as another origin: Chromium refused the `fetch()` outright ("Cross origin
  requests are only supported for protocol schemes…", measured 2026-11-20). `lib/tgs.ts` then
  marked the TGS failed and every animated sticker — the new animated emoji included — fell
  back to its emoji glyph, which reads as "the sticker never loaded". Registration now sets
  `corsEnabled: true` and the handler answers `access-control-allow-origin: *`; a real
  account's ❤️ sticker then decoded through lottie-web.
- **Not every emoji has an animated version.** TDLib replaces a one-emoji message with
  `messageAnimatedEmoji` only when the emoji resolves in the AnimatedEmoji set; otherwise
  the message stays `messageText` (measured on the test DC: ❤️, 🎉, 🔥, 💩, 👍, 👏 and 😭
  resolve, while ✨, 😀 and 🥺 answer 404 from `getAnimatedEmoji`). Those messages are
  correctly drawn as the 48 px big emoji — not a mapping failure. None of the resolved ones
  carried a click `sound` on the test DC, so the sound path is exercised by the mock's
  generated WAV instead.
- **`updateChatAction` is a one-shot event.** It has no "stopped typing" notification you
  can rely on, so the renderer schedules an expiry timer from `until`; without it the
  header claims "对方正在输入…" forever.
- **Editing content is a full remap, not a text patch.** `updateMessageContent` can change
  media/captions, so the adapter fetches the message and emits a `replace` op instead of
  an `edit` op with just the text.
- **Mock media is generated, not referenced.** `packages/mock-adapter/src/mock-assets.ts` embeds two real
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
  transcript stayed blank for the rest of the session. Now (2026-11-17, second pass) the page
  is retried three times *and* an empty answer is not cached at all while the chat list says
  the chat has messages (`ChatSummary.lastMessageAt`, the same `last_message` the adapter
  anchors its first page on) — the entry simply stays absent, so the next open or 重新加载 asks
  again, and the placeholder says "消息还没从服务器同步下来" instead of claiming the chat is
  empty. A genuinely empty chat (no `lastMessageAt`) still caches its page and still reads
  "这个会话还没有可显示的消息". The adapter logs both halves of the chain (`no last_message` /
  `getChatHistory returned nothing`) so the next occurrence is explainable from
  `.cache/app.log`.
- **`getChatHistory` treats `from_message_id` as exclusive (measured 2026-11-17).**
  The request returns messages *strictly older* than the id, so a first page anchored
  exactly on `chat.last_message.id` never contained the newest message — and `openChat`
  marked the message *below* it as read. Every chat therefore kept a badge of at least
  "1" however often it was opened, while clicking the same chat in the official client
  cleared it (reproduced on 心惊报: TDLib's `last_read_inbox_message_id` stayed one post
  behind, and `unread_count` never dropped to 0; `from=4975493120` answered `4974444544`).
  Fixed in `actions.ts`: the implicit first-page anchor is `last_message.id + 1` (so the
  newest message is loaded), and `openChat` reads up to `getChat.last_message.id`
  directly instead of trusting a history page. The renderer additionally reports the
  newest message as read while the chat is open in a focused, visible window
  (`chat-pane`), so messages arriving during the conversation no longer leave the badge
  lit. `mapChat` now omits `lastReadInboxMessageId` when TDLib reports 0 — 0 means
  "nothing read yet", not message 0 — so the unread divider falls back to the unread
  counter instead of being pinned above the first row of the loaded page.
- **`updateDeleteMessages` is not always a deletion — and the cache-only variant emptied
  the open chat (measured 2026-11-17).** The TDLib update carries `is_permanent` and
  `from_cache`; `from_cache: true` means "deleted only from the cache and can possibly be
  retrieved again in the future". TDLib emits those while the app sits idle in the
  background: reproduced on the real account by leaving the window occluded for ~2 minutes —
  a `{from_cache: true, is_permanent: false}` batch for **all 50** cached messages of the
  open chat (`[dbg]` trace: `setHistory … 50` → the eviction → `applyMessageOps emptied
  chat`), after which the pane showed "这个会话还没有可显示的消息" while 重新加载 fetched the
  same 50 messages back from the server. The adapter ignored both flags, so every cache trim
  looked like a user deletion — this is the "切到后台再切回来消息就没了" bug. Fixed in
  `updates.ts` / `map/deletion.ts`: only `from_cache !== true` removes rows; evictions are
  logged (`dropped N message(s) from the local cache — kept in the transcript`) and the
  renderer additionally refetches once when a transcript that *had* rows goes empty
  (`useChatHistory`), so no silent wipe can park the pane on the empty state again.
- **A bubble must ask for the photo size its box needs, not the original.** `photoMedia` maps
  the whole `photo.sizes` table into `MessageMedia.sizes`, and `lib/mediaVariant.ts` picks the
  smallest variant that covers `box × devicePixelRatio` — a 240 px bubble on a 100 % display
  wants the 320 px file, not the 1280 px one. Until then the DTO carried only the largest file
  id, so every bubble downloaded the original; that was the biggest single cost of opening a
  cold chat. `fileId` still names the largest (保存 / 复制 / the viewer want it), and a DTO
  with `localUrl` already on disk skips the choice.
- **`downloadFile(synchronous: true)` answers only when the file is complete, and the bytes it
  has written so far are a sparse file: `stat().size` is the *full* size, not the readable
  length.** Streaming therefore asks `getFileDownloadedPrefixSize(fileId, offset)` — the
  contiguous run actually on disk from that offset — and reads the file directly (main and
  TDLib share one process, so `readFilePart`, which its own docs call the fallback for apps
  without filesystem access, is unnecessary). `downloadFile(offset, limit: 0, synchronous:
  false)` starts or re-targets the transfer; a *different* offset is how a seek works, and it
  cancels the previous range. On a stall the pump sends the same offset again once a second.
- **The first `downloadFile` answer describes the file *before* the transfer was queued.** A cold
  clip comes back with an empty `local.path` (and `expected_size: 0`), both of which only arrive
  with the next `updateFile`: the first click on any never-played video answered "File 1304 cannot
  be streamed yet" while the download was in fact starting. Measured on the real account, the path
  appeared **500 ms** after the click. `beginStream` now polls `getFile` (100 ms, 4 s cap) until
  the state is usable and logs how long it waited; the renderer is unchanged.
- **A cancel has to be refcounted, or two windows cancel each other.** `media/leases.ts` counts
  holders per file: `media:download` holds, `media:cancel` drops, `cancelDownloadFile` runs
  only when the last holder leaves. Owners are per hook instance, not per effect run — a
  StrictMode remount runs cleanup→setup, so the cleanup's cancel waits
  `RELEASE_GRACE_MS` (250 ms) and a re-hold of the same file clears the timer. Without that,
  the second mount waits on the in-flight promise its own cleanup just killed and the picture
  never appears (dev only, which is exactly where it is hardest to notice).
- **A video bubble must not download the clip.** It used to call `media:download` on mount at
  priority 6, so a chat with a few videos queued every clip at once and starved the requests
  the reader was waiting for. The bubble now fetches only the poster (TDLib's `thumbFileId`);
  the viewer streams the file (design doc §8.7), so playback starts after a few hundred
  kilobytes instead of after the whole clip.
- `userData` is pinned to `%APPDATA%\WeGram` via `app.setName`/`setPath`, because
  the package name is `@wegram/desktop` and would otherwise create a nested folder.

- **Poll schema is newer than its version number suggests.** This build's TDLib
  1.8.70 (commit c8828d50) already has `pollOption.id`, `option_order`,
  `can_see_results`, `can_add_option` and `vote_restriction_reason`; the API is
  message-addressed: `setPollAnswer` takes `chat_id`/`message_id`/`option_ids`, and
  `option_ids` are **positions**, not the option id strings. A poll whose
  `option_order` is non-empty must be drawn in that order while still voting by
  position — the DTO keeps both. `messagePoll` also carries `description` and media
  (both optional here); the poll card ignores option media for now.
- **A vote is not echoed by the command.** `setPollAnswer` answers `Ok`; the changed
  poll arrives later as `updateMessageContent` (already mapped to a `replace`), so the
  renderer must not invent counters locally. Quiz correct answers are empty until the
  account answers (or the poll closes).

## Decisions already locked (design doc §15)

Single account in v1 (multi-account is v2; session dir already shaped
`tdlib/<accountId>/`), animated stickers in v1 (WebP + TGS + WebM), Electron (Tauri only
if bundle size becomes a real pain), built-in SOCKS5 / HTTP / MTProxy with a connectivity test,
5-week schedule instead of 4.

## Private-chat P0 batch — measured notes (2026-11-22)

Shipped from `docs/PRIVATE-CHAT-HANDOFF.md` §3 (P0): outgoing typing, 标为未读,
删除聊天, send failure + 重试, online / last seen, desktop notifications, tray.

- **Typing is renderer-side throttled, never thrown.** `lib/typingPing.ts` sends one
  `messages:typing` immediately and at most one refresh per 3.5 s; emptying the box,
  sending, switching chats or blurring sends the cancel. The adapter's `sendTyping`
  swallows TDLib failures on purpose (ambient presence must not raise the error bar).
  The mock adapter has no peer to show it, so the indicator is only observable against a
  real account.
- **The send id swap is real and handled as a re-key.** `sendMessage` answers with a
  pending row; `updateMessageSendSucceeded.old_message_id` is patched through the new
  `replaceId` op, so the row keeps its position and later edit/delete/read receipts
  name the server id. `updateMessageSendFailed` patches `sendingState: 'failed'` +
  `canRetry`; 重试 calls `messages:resend` (`resendMessages`) and the row goes back
  to 'pending'. The message menu also offers 重试 first for a failed row.
  - Dev path: `WEGRAM_MOCK_FAIL_SEND=1` fails the **next** text send once, so the
    未发送 row and click-to-retry can be exercised without a network. Verified in the
    mock Electron shell (row appeared red, retry delivered it, receipt returned).
- **标为未读 is a flag, not a counter.** `ChatSummary.markedUnread` comes from
  `chat.is_marked_as_unread`; the row draws a bare dot when there is no count, and
  opening the chat clears the flag (the adapter calls `toggleChatIsMarkedAsUnread`).
  Unread messages still move the server marker one viewport at a time.
- **删除聊天 is local.** The adapter uses `deleteChatHistory` with
  `remove_from_chat_list: true, revoke: false` — never `deleteChat`, which deletes
  the history for every member. The `remove` op now drops the transcript, queued ops,
  paging state and the active selection with the row.
- **The chat list has a right-click menu** (置顶 / 免打扰 / 标为未读 / 删除聊天) built in
  `components/chat-list/chatMenu.ts`; `ContextMenu` already handled placement and keys.
- **Presence is a stream, not a chat field.** `users:status` answers once per open
  private chat and `evt:status` keeps it live; the copy is `lib/presence.ts`
  (在线 / 刚刚在线 / 今天 HH:mm / 昨天 HH:mm / M月D日 HH:mm / coarse sentences). Placement
  was the audit's open decision #1: it sits **after the name inside the 48 px header**,
  styled like the typing label, so the transcript never re-flows. Typing wins over
  status when both exist.
- **Notifications come from TDLib's notification objects**, not from
  `updateNewMessage`: both `updateNotification` and
  `updateNotificationGroup.added_notifications` are forwarded as a main-only
  `notification` adapter event (`notificationTypeNewMessage` only). Main builds the
  Electron `Notification`, flashes the task bar when the shell is not focused, and
  suppresses the toast for the chat the focused shell is showing — the renderer reports
  that through `ui:setActiveChat` (null when the pane is closed or 通讯录 is showing).
  A notification click raises the shell and publishes `evt:locate`; a chat not yet in
  the list is fetched with `chats:get` before the pane opens.
  - Dev path: `WEGRAM_MOCK_NOTIFY=1` turns the mock's ambient arrivals into
    notification events.
  - **Unverified on this machine:** Windows toasts for an unpackaged build (no Start
    Menu shortcut), and the tray icon — `Shell_NotifyIcon` refused it in the agent's
    launch session (`Unable to create status tray icon`). `createTray` now logs and
    carries on without the icon, so neither failure can stop the app from starting.
- **Protocol split:** `channels.ts` was at its 550-line budget, so the event tables
  moved to `packages/protocol/src/events.ts`, the message ops to
  `message-ops.ts`, and the new channels to `send.ts` (typing, resend) and
  `presence.ts` (status, active chat). `dto.ts` is under budget again.
- **Renderer splits that the batch forced:** `useMarkRead` and `usePeerStatus` left
  `chat-pane/index.tsx`; the browser preview's media, viewer and `ui:*` handlers left
  `preview/index.ts`.

## Known gaps / suggested next steps

1. ~~**Unverified:** the dark-mode window-controls overlay~~ — **verified** (Electron 38,
   `-NoSandbox -Mock`, mock login `+8613800000000` / `12345` / `wegram`). Measured
   pixels: light title bar `#F7F7F7` with `#171717` glyphs, dark title bar `#1A1A1A`
   (JPEG of `#191919`) with `#E4E4E4` glyphs, overlay strip identical to the title bar in
   both themes, and a dark profile restarts dark from `ready-to-show`. Fixing the
   comparison exposed a real gap: the login screen has no title bar, so the controls sat
   on `#111111`/`#EDEDED` — about 8/255 off the overlay colour, a faint but visible
   rectangle in the corner. `.wx-login::before` now paints a 60 px `--wx-bg-list` strip
   with a divider (same as the shell), which also gives the login window its **only drag
   region** (it could not be moved before logging in).
   *Superseded by the WeChat UI pass*: the overlay is now 32 px and rail-coloured
   (`#e0e0e0` / `#2d2d2e`), and the same strip is 32 px — see `docs/UI-HANDOFF.md` §2.
   The dark/light verification itself still holds.
   *Superseded again 2026-11-18*: the login flow moved into its own frameless window
   (`main/login-window.ts`), which draws its own ×/gear and has no native overlay.
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
   **Load-around (2026-11-18, replaces the page budget)**: when the saved row or the
   unread boundary is older than the newest page, `useChatHistory` asks for a window
   *around* it (`messages:around`): the adapter merges an older page (the existing
   top-up pager), `getMessage` for the anchor (getChatHistory is exclusive) and a
   *negative-offset* `getChatHistory` for the newer half (Spike 2 §2.3). The window
   therefore stops short of the newest message; `hasNewer` says so. Live arrivals are
   queued instead of spliced under the window's last row, reaching the window end
   appends `messages:newer`, and the buoy / every send path replace the window with
   the newest page before acting. The 6-page / 10 s budget and its "anchor is dropped,
   chat opens at the bottom" failure are gone. Unit-tested (actions, reducers, store);
   the real-account pass for a 5 000-message-deep anchor is still pending.
3. ~~**W3 scope**: media send/receive, sticker renderer, day separators, unread
   divider, sticker panel.~~ **Main body done**; what is left from W3 and what W3
   deliberately did not include:
   - **WebM stickers** are implemented (`<video>` + offscreen pause) but no fixture
     exercises them: this machine has no VP8 encoder (ffmpeg absent) and the mock only
     generates WebP/TGS. Verify with a real account or a recorded `.webm` sticker.
   - ~~**Custom emoji** *entities inside text* still render as their base glyph~~ —
     **done 2026-11-20**: `stickers:customEmoji` (`getCustomEmojiStickers`), batched
     lookups cached in `renderer/lib/customEmoji.ts`, drawn by `components/CustomEmoji`
     at 20 px inside 14 px text with the glyph as the fallback. A message that is one
     custom emoji is not part of this path: TDLib reports it as `messageAnimatedEmoji`
     and it already renders as its sticker (kind 'emoji').
   - Media is sent immediately after the picker; no caption dialog and no album
     *sending* (received albums are grouped into one bubble now, design doc §8.6),
     no drag & drop / paste. Captions are supported end-to-end in the adapter
     (`media:send` takes `caption`), just not surfaced in the UI yet.
   - ~~Voice notes play, but there is no recording~~ — **done 2026-11-22**: the
     renderer records 按住 说话 with WebCodecs Opus and muxes OGG itself
     (`renderer/lib/voice/`), main materialises the bytes under `userData/voice`
     and TDLib sends `inputMessageVoiceNote`. The waveform is still decorative
     (and sent empty, see `docs/PRIVATE-CHAT-HANDOFF.md` §6.1). The mock/Electron
     pass is done (fake media device) — see "Private-chat P1 batch" above; the
     test-DC write is still pending.
   - Download cache is TDLib's own file cache; the `media_cache` LRU table from §5.2 is
     still unused, so nothing bounds the disk usage yet.
   - Sticker panel only lists regular installed sets; no search/trending, no "recent".
     A set cover whose thumbnail is MPEG4 would render as a broken `<img>` (rare).
   - Premium stickers play their effect in messages, but the picker draws no premium
     mark (the official client does), and sending one without a Premium subscription is
     left to TDLib's error.
   - `updateMessageContent`/`updateNewMessage` are mapped, but `updateMessageSendSucceeded`
     is not handled separately; message ids are server ids already, so it is cosmetic.
   - ~~Search is W4~~ — **done 2026-11-21**: the chat-list pill is a Telegram-style
     panel — 聊天 / 频道 tabs, conversation hits (`searchChats`) and real message hits
     across chats (`searchMessages` with `chat_type_filter`, cursor-paged) — and the
     聊天信息 panel's 查找聊天内容 runs `search:inChat`. Still missing: the other
     filter tabs (贴文/图片/视频/链接), 联系人 hits, and archived chats (the search
     asks `chatListMain` only).
4. ~~**Channel posts show senderName `未知`**~~ — **done**: `senderChatId` in the DTO,
   `mapMessage` resolves `messageSenderChat` through the chat-title cache, verified on
   the real account by the `senderChat` line of `tdlib:smoke`. Mock + preview fixtures
   grew a channel-post example (chat 5, message 502).
5. **The installer exists but has never been installed**: `v0.1.0` published
   `WeGram-0.1.0-x64.exe` from CI (see Release packaging above), and `release/win-unpacked` is
   verified locally. Nobody has run the installer yet, so these stay unverified: install /
   uninstall / per-user vs per-machine, code signing (currently skipped — SmartScreen will
   complain), auto-update (no `publish` config, no `electron-updater` in the app), the
   sandboxed launch on a clean machine, and the inlined-credentials path end to end (the
   v0.1.0 artifact predates it, so it still boots the mock adapter).
6. Minor: the preload bundle is 187 kB because it imports the protocol index (zod). If it
   matters, split a channels-only entry point.
7. Minor: `tdlib:smoke` only checks the *first* channel of the chat list for
   `messageSenderChat`; groups with anonymous admins are not covered by a fixture.
8. Minor: the login window has no account picker. `切换账号` signs the only session out
   and returns to the phone form; a multi-account list would need several TDLib sessions,
   which the adapter does not model.
9. **UI deltas vs the real client** are catalogued in `docs/UI-HANDOFF.md` §5 (composer
   toolbar loses the scissors chevron, no pin button, fixed 238 px list, rail sections
   other than 聊天 only raise a toast, dark rail icon grey untuned). §6 has the ordered
   follow-ups.
10. **The chat list is not virtualised.** This account renders **526 rows** at once
    (measured in the DOM). It is still smooth, but it is the next scaling risk, and the
    avatar pool only prefetches what it is handed: the 100-chat first page plus whatever
    arrives through `emitChatUpsert`. A row scrolled into view without an update event
    keeps its initials until the chat is touched.
11. ~~**Message-row (sender) avatars are still initials.**~~ **Done** — `UserAvatar`
    `{ userId, url }`, `Message.senderAvatarUrl` and `evt:avatars`; the adapter caches by
    user id (`AvatarCache.userUrls`) and resolves through `getUser` → `profile_photo.small`,
    the same `downloadFile(synchronous)` path chat photos use. Remaining edge: a linked
    channel's photo in an anonymous-admin post only shows once that chat's own photo is
    cached (the row then carries it); the open chat's photo is live via `chat.avatarUrl`.
12. **Popovers keep native scrollbars** (modals, forward list, sticker grid). Only the
    two long panes use `<OverlayScrollbar>`; converting the rest is mechanical but was
    not worth the churn while the complaint was the list and the transcript.
13. **The TDLib QR login has not been confirmed with a real phone.** The link mapping,
    the local QR encoding, the QR-first UI and the phone fallback are verified with the
    mock; the `requestQrCodeAuthentication` → scan → ready / 2FA chain and
    `auth:reset`'s destroy + rebuild still need one real scan (design doc §14). The
    stored app session was not authorized, so it could not be exercised here.

## Open questions for the product owner

- ~~W3 order: media first or search first?~~ Media + stickers were done first (W3 main
  body); search followed on 2026-11-21 (global pill + in-panel 查找聊天内容).
- Scroll-position restore: WeChat restores where you left; we already do that when the
  reader was not at the bottom. Confirm it should stay.
- Multi-account stays v2 — confirm nothing in W3/W4 needs it.

## Session leftovers

**2026-11-17, scroll-anchor session:** the recorded "short transcript restored a saved anchor
but counts as not at the bottom" observation is **fixed** — the pin is now derived from
geometry (`lib/scrollGeometry.ts`) instead of scroll events, and the stale anchor is cleared.
Fixing it exposed the cached-chat mount race above (cached chats never restored at all),
which is fixed too. Measured in the mock Electron window, with the CDP helpers in `.cache/`:
stored `{14958, -46}` on the 5000-message chat restores to `scrollTop 586` /
`firstVisible 14958 @ -46`; a cached short chat opens at the bottom, drops its anchor
(`ui:getAnchor → null`) and raises no buoy when a message arrives; growing the viewport until
the transcript fits re-pins the list (it used to show "↓ 1 条新消息" for a fully visible
message) and it keeps following new messages; the buoy still appears when genuinely scrolled
up and its click returns to the bottom. `apps/desktop/src/renderer/src/lib/scrollGeometry.test.ts`
covers the predicate (5 cases). These changes are committed (`feat(viewer)`, 22039a5),
together with the viewer window, the read-receipt and eviction fixes above.
The Electron window used for the walkthrough was closed.

**2026-11-17, refactor session:** `pnpm verify` (lint → typecheck → vitest → build) is the
gate; 137 unit tests, ESLint now enforces the architecture rules, Prettier owns formatting.
Batch 4 (the `tdlib.ts` split) is done — batch 4a added the explicit
`MapperContext`, 4b moved the adapter into `telegram/tdlib/` and added 45 mapper tests.
Remaining work is the split of `mock.ts`, `preview-bridge.ts`, `styles/index.css` and
`packages/protocol`: see `docs/REFACTOR-HANDOFF.md`.

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

The refactor sessions added nine more commits on top of `395ac19` (`f1d0a9e` the pending
real-account fixes, then batches 0–3, the doc updates, and batch 4 as two commits).
`pnpm verify` — not just typecheck + build — was green before each; batch 4 also passed
`pnpm tdlib:smoke` and a mock Electron pass, and the working tree is clean.

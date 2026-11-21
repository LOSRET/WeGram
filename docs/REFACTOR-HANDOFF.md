# Refactor handoff — splitting the code for agent maintenance

Written 2026-11-17, directly after the refactor session that did **batches 0–3** of the
approved plan. **Batch 4** was completed later the same day — see "Batch 4 (done)" for the
layout actually built and the three deliberate deviations. Read this together with
`docs/HANDOFF.md` (project state, measured TDLib behaviour) and the three layer notes
(`packages/protocol/AGENTS.md`, `apps/desktop/src/main/AGENTS.md`,
`apps/desktop/src/renderer/AGENTS.md`).

Audience: the next agent session. Everything below was measured or executed, not planned.

## TL;DR

- Working tree is **clean**, all work is committed on `main`, and `pnpm verify` is green.
- Nine commits: the pre-existing dirty tree, batches 0–3, docs, then batch 4 as **two
  commits** (mapper context first, then the file move) with its doc updates folded into the
  second.
- The repo now has **132 unit tests** (was 0), ESLint that enforces the architecture rules
  from prose, and Prettier as the single formatter.
- `useAppStore.ts` (293), `MessageList.tsx` (705), `ChatPane.tsx` (415) and
  `telegram/tdlib.ts` (1527) are gone; they are now 20 renderer modules (none over 223
  lines) and 14 adapter modules (the largest, `index.ts`, is 400 lines).
- **Batches 5–8 are not started**: `mock.ts`, `preview-bridge.ts`,
  `styles/index.css`, `packages/protocol`. See "Remaining batches" for the exact target
  layout and the risks.

## Session 2026-11-19 — P0 + P1 of the agent-maintainability split (done)

Second refactor session. Branch `refactor/agent-friendly-split`, one commit per batch,
each one verified before it was committed. `pnpm verify` is green: **38 test files /
322 tests**, lint 0 warnings, typecheck and build clean. Tree clean.

What moved (the tree had grown past batches 0–4; these were the files an agent could no
longer load in one go):

| Was | Now |
| --- | --- |
| `viewer/MediaViewer.tsx` (586) | `MediaViewer.tsx` (~190) + `useViewerItem` (download/progress), `useViewerZoom` (fit/zoom/rotate/pan), `useViewerNotice`, `ViewerToolbar`, `ViewerGrid`, `viewerActions` (IPC), `viewerMenu` (menu as data, tested) |
| `components/ExpressionPicker.tsx` (449) | `ExpressionPicker.tsx` (state + composition) + `picker/`: `useStickerSets`, `useActiveStickerSet`, `useRecentEmoji`, `usePickerDismiss`, `EmojiBody`, `SearchBody`, `StickerBody`, `PickerTabs`, `EmojiGrid`, `types` |
| `screens/LoginWindow.tsx` (491) | `LoginWindow.tsx` (chrome + 4 bodies) + `login/`: `useLoginFlow`, `QrStep`, `ProfileStep`, `PhoneForm`, `LoginFooter`, `LoginHelp`, `loginCopy` (pure, tested) |
| duplicated `Sticker → MessageMedia` | `lib/stickerMedia.ts` (tested), used by the picker and the browser preview |
| `message-list/index.tsx` (476) | `index.tsx` (composition + render) + `useJumpToLatest`, `useLocateScroll`, `useLandingSave`, `useViewportSeen` |
| `chat-pane/useChatHistory.ts` (557) | `useChatHistory.ts` + `history/`: `readFirstPage`, `types`, `useLocateRequest`, `usePrefetchOlder`, `usePaging` |
| `telegram/mock.ts` (1122) | `mock/`: `index` (adapter), `fixtures`, `assets` (MockAssets), `avatars` (MockAvatars), `traffic`, `constants` |
| `tdlib/actions.ts` (606) | `tdlib/actions/`: `chats`, `history`, `files`, `send`, `search`, `deps`; `index.ts` re-exports (import path `./actions` unchanged) |
| `protocol/dto.ts` at its cap (custom-emoji channel, 2026-11-20) | `protocol/stickers.ts`: format enum, `Sticker`, sticker sets, `CustomEmojiSticker`; `messageMediaSchema` stays in `dto.ts` and imports the format |
| `mock-fixtures/data.ts` at its cap (custom-emoji fixture, 2026-11-20) | `stress.ts`: the 5000-message chat 99 as `buildStressSeed`; `data.ts` calls it |
| `tdlib/index.ts` at its cap (custom-emoji channel, 2026-11-20) | `tdlib/map/resolvers.ts`: `createResolvers` (cached `getUser`/`getChat` lookups) over the adapter's maps |

Behaviour was not changed: every doc comment moved with its code, no channel/DTO/`wx-*`
name was touched, and no scroll timing was rewritten. New pure tests: `viewerMenu`,
`loginCopy`, `stickerMedia`.

Acceptance run for this session:

- `pnpm verify` after the last batch (lint → typecheck → 322 tests → build).
- Mock Electron pass (`launch-detached.ps1 -NoSandbox -Mock`): login window (QR, help
  sheet, phone fallback through `auth:reset`, code step, two-step step, shell hand-over),
  expression panel (emoji tab, search tab with results, sticker grid, sending a sticker),
  viewer (open, zoom in, rotate, 预览 board, "…" menu entries, 定位到聊天位置), the
  5000-message chat (jump to latest, scroll up with continuous rows, paging, buoy,
  unread divider), send text. `.cache/app.log` clean apart from the known
  `node:sqlite` experimental warning.
- `pnpm tdlib:smoke` (read-only, real session): adapter started, `getMe`, 20 chats,
  history 10 messages with `hasMore=true`, channel `senderChatId` names.

Second batch, same day (after the P0/P1 report): **preview-bridge** (775) became
`lib/preview/` — `index.ts` (session + invoke switch + installer) and `fixtures.ts`
(data, helpers) behind a two-line `preview-bridge.ts` entry point so the dev-only
import stays visible; **styles/index.css** (3206) became 14 files under `styles/`
imported in source order from `index.css` (the compiled CSS came out byte-identical,
same hash, 60.32 kB — that is the check to repeat if the order is ever edited);
**main/index.ts**'s window factory moved to `main/windows.ts` (createMainWindow,
openExternal, storedTheme, applyTitleBarTheme, raiseShellAboveViewer), leaving the
lifecycle/hand-over in `index.ts`; the mock's read marker and transfer simulation
moved to `mock/effects.ts`; and ESLint now enforces `max-lines: 550` on app and
protocol sources (generated `WechatIcons.tsx` exempt) so the tree cannot silently grow
back to 1000-line files.

Next batch, 2026-11-21 (with the 未加入频道底栏 feature): three files hit the cap at
once, so each split followed the same "extract one concern, bind it" rule:

| Was | Now |
| --- | --- |
| `tdlib/index.ts` at its cap (频道底栏) | `tdlib/chat-api.ts`: `createChatApi` returns the chat seam methods as one object (the class binds it as fields, lazily reading `actionDeps`); `openPrivateChat` moved into `actions/chats.ts` next to `openUsernameChat` |
| `mock-fixtures/data.ts` at its cap | `mock-fixtures/seed.ts`: `FixtureSeed` / `FixtureOptions` / `SeedMedia`; `index.ts` re-exports them, so the mock and the preview import the same path |
| `tdlib/actions.test.ts` at its cap | `tdlib/actions-chat-join.test.ts`: the 频道底栏 membership and `joinChat` cases, with the same fake adapter kept local (the `actions-chat-info.test.ts` precedent) |

Behaviour was not changed: every doc comment moved with its code and the seam, the
protocol tables and the fixture data are identical. The Electron/mock pass for the
feature itself is in the 2026-11-21 handoff bullet.

Still open from the original plan: optional **batch 8** (`packages/protocol` split by
domain; the export surface must stay identical because preload bundles it). The two
files that remain above the 550 cap are gone; `mock/index.ts` (540) is the adapter
surface and `WechatIcons.tsx` (513) is generated artwork.

## Commits from this session (oldest first)

| Commit | Content |
| --- | --- |
| `f1d0a9e` | The working tree that was already modified: pendingOps replay, virtualizer resync, empty-page retries, anchor-save rework, big-emoji CSS, launcher fix, `scripts/start-real.cmd`. Verified by `pnpm typecheck` + `pnpm build` before committing. |
| `5780819` | **Batch 0** — vitest + 51 tests, ESLint flat config with the architecture rules, Prettier, `pnpm verify`, layered `AGENTS.md`. Contains the one-off reformat of 27 files (review with `git show -w`). |
| `69e3a98` | **Batch 1** — store split + 23 tests (reducers, store invariants). |
| `8b9c3ec` | **Batch 2** — message-list split + 13 tests (unread divider, context menu, emoji detection). |
| `8209857` | **Batch 3** — chat-pane split (no new tests: the extracted parts are IPC orchestration). |
| `680720f` | Docs: architecture map + renderer AGENTS.md point at the new modules. |
| `5c0c863` | **Batch 4a** — the DTO mappers take an explicit `MapperContext` (behaviour identical: same caches, same lazy `getUser`/`getChat` fallbacks). |
| (next commit) | **Batch 4b** — `tdlib.ts` (1527) becomes `tdlib/` (14 modules + 5 test files), the mappers get 45 tests, and the architecture docs/rules move from the file to the folder. |

Commits are GPG-signed (`commit.gpgsign=true` works in this session — unlike the note
about the root commit in `docs/HANDOFF.md`). Branch: `main`.

## The verification layer (use it; it is the point of batch 0)

```powershell
pnpm verify          # THE gate: lint -> typecheck -> test -> build. ~8 s.
pnpm lint            # eslint . --max-warnings 0   (errors AND warnings fail)
pnpm test            # vitest run                  (132 tests, node environment)
pnpm test:watch
pnpm format          # prettier --write .          (format:check to verify only)
```

Root devDependencies added: `eslint 10.15.0`, `typescript-eslint 8.72.2`,
`eslint-plugin-react-hooks 7.1.1`, `prettier 3.10.1`, `vitest 5.1.0`.

**What the suite covers** (pure modules only, no DOM):

| File | Pins |
| --- | --- |
| `renderer/src/lib/format.test.ts` | chat/message time, day separators, previews, initials (clock pinned with fake timers) |
| `renderer/src/lib/entities.test.ts` | TL entity segmentation: UTF-16 offsets, overlapping/nested entities, clamping, emoji surrogates |
| `renderer/src/store/reducers.test.ts` | `sortChats`, `upsertMessage`, `reduceOps` batch semantics |
| `renderer/src/store/useAppStore.test.ts` | **the historical bug**: `applyMessageOps` must not create a `messagesByChat` entry, queues ops for `setHistory`, drops reply/edit targets on delete, `reset()` clears everything |
| `renderer/src/components/message-list/messageList.test.ts` | unread-divider anchor choice, context-menu rules, `isEmojiOnly` |
| `main/proxy-url.test.ts` | `socks5://` / `mtproto://` parsing, credential decoding, the error cases |
| `main/media/image-size.test.ts` | PNG / GIF / WebP (VP8X, VP8L, VP8) / JPEG SOF header probing |
| `main/telegram/tdlib/map/content.test.ts` | `mapContent` for every supported TDLib content type, `serviceText` composition (WeChat wording, 你 vs the sender, member names), `previewContent`, the size pickers, `mediaUrls` |
| `main/telegram/tdlib/map/message.test.ts` | sender resolution (user / channel chat / `未知`), service-message text, unsupported content, caption entities, reply/edit flags, the rich body reaching the DTO, the full-version round trip, inline keyboard and contact card carry-over |
| `main/telegram/tdlib/map/buttons.test.ts` | inline button addressing (url / login / web app / callback / copy), button styles (primary / danger / success / link, default stays absent), rows of a `replyMarkupInlineKeyboard`, non-inline markup ignored |
| `main/telegram/tdlib/map/rich.test.ts` | rich text → entity offsets (bold/link/custom emoji), page-block mapping (headings, list, table, photo, quote, details), unknown blocks dropped, one-line chat-list preview |
| `main/telegram/tdlib/map/chat.test.ts` | `mapChat` fields, the title-cache side effect, optional-field omission, `mapChatKind`, `mapConnectionState` |
| `main/telegram/tdlib/map/entities.test.ts` | the TL entity type table, unknown types dropped, offset/length defaults |
| `main/telegram/tdlib/map/sticker.test.ts` | sticker + set-cover thumbnail format mapping |

**What it does NOT cover, and where you must verify instead:**

- React rendering, hook order, scroll/virtualisation timing → Electron window with the
  mock adapter (recipe below).
- The TDLib adapter → `pnpm tdlib:smoke` (read-only against the real session).
- `wx-media://` serving, Range requests → Electron window (the browser preview has no
  protocol handler).
- Anything that needs `ui.db` → `pnpm ui:db-check`.

## Rules the code now enforces mechanically

`eslint.config.mjs` (root, flat config) turns the prose rules into errors:

- `tdl` / `prebuilt-tdlib` may only be imported from
  `apps/desktop/src/main/telegram/tdlib.ts`. **The rule already also ignores
  `apps/desktop/src/main/telegram/tdlib/**`**, so batch 4 can turn that file into a
  directory without touching the config.
- `node:sqlite` may only be imported from `main/store/ui-db.ts`.
- The renderer may not import `electron`, `node:*`, `tdl`, `prebuilt-tdlib`, or anything
  under `src/main/`.
- `react-hooks/rules-of-hooks` is an error; `exhaustive-deps` is a warning. Because lint
  runs with `--max-warnings 0`, a new dependency-array violation fails `pnpm verify` — fix
  the code or add the same `// eslint-disable-next-line react-hooks/exhaustive-deps` +
  justification comment the scroll hooks use.
- `@typescript-eslint/no-explicit-any` stays **off** on purpose (`tdlib.ts` deals in raw
  TDLib JSON at the boundary). `no-unused-vars` is on with `^_` allowed.

`prettier` settings live in `.prettierrc.json` (no semicolons, single quotes, width 100 —
the style the tree already used; the CSS was already 100 % clean). `.prettierignore`
deliberately excludes `*.md` and `spikes/`; do not remove those entries, `pnpm format`
would rewrap the Chinese design doc and the frozen spike harness.

## Where the code moved (batch 1–3)

```
renderer/src/store/
  types.ts            AppData (all state) + one action interface per slice + SliceCreator
  initialState.ts     DATA_DEFAULTS — the ONLY place initial state is written down
  reducers.ts         sortChats / upsertMessage / reduceOps / hasReplayableOps / EMPTY_MESSAGES
  slices/auth.ts      setAuth, setConnection, setInfo, setTheme, reset
  slices/chats.ts     setChats, applyChatOps, setActiveChat
  slices/messages.ts  setHistory, prependHistory, applyMessageOps, pendingOps queue
  slices/media.ts     setMediaUrl, setMediaProgress
  slices/ui.ts        setTyping, setToast, setError
  useAppStore.ts      32-line assembler; re-exports the public types (import path unchanged)

renderer/src/components/message-list/
  index.tsx              DOM + render tree only (virtualiser, buoy, context menu)
  MessageRow.tsx         one row (avatar, sender, quote, body, meta, "⋯")
  Divider.tsx            DaySeparator + UnreadDivider
  useInitialPosition.ts  first paint: restore anchor or land at bottom + reveal nets
  usePrependRestore.ts   two-stage prepend compensation, loadOlder, 15 s stuck cap
  useAnchorSave.ts       ui:saveAnchor write path (immediate first write, trailing collapse)
  scrollFlags.ts         the four timing refs (initialised/restoring/prepending/programmatic)
  scroller.ts            resyncScroller() — MANDATORY after any programmatic scrollTop
  emoji.ts               isEmojiOnly (pure, no React import)
  menu.ts                buildMessageMenuItems (pure)
  unread.ts              findUnreadMessage (pure)

renderer/src/components/chat-pane/
  index.tsx              render tree + modal/popover state only
  useChatHistory.ts      first page, empty-page retries, paging to the saved anchor, loadOlder
  messageActions.ts      createMessageActions() — a plain factory, NOT a hook
  ChatHeader.tsx         title, typing, call buttons, "…" (toggles 聊天信息)
  ChatInfoPanel.tsx      the 聊天信息 overlay (state: members/query, pinned, search, dialogs)
  ChatInfoRows.tsx       its rows: InfoRow / LinkRow / ToggleRow / DangerRow (presentational)
  ChatInfoDialogs.tsx    RenameDialog (chats:setTitle) + InviteDialog (添加's invite link)
  ChatInfoSearch.tsx     its 查找聊天内容 view (search:inChat + pick → locate)
  Placeholders.tsx       no-chat / loading / anchor-pending / empty-transcript states
  labels.ts              kindLabel
```

Deliberate invariants you must not undo while working here:

1. **Slices return actions only.** State is seeded from `DATA_DEFAULTS` so `reset()` cannot
   forget a field. Adding a state field = add it to `AppData` **and** `DATA_DEFAULTS`.
2. **`messagesByChat[chatId]` is created only by `setHistory`/`prependHistory`.** Ops for a
   chat without an entry are queued in `pendingOps` (read-only batches are skipped by
   `hasReplayableOps`). This is the bug that made groups open empty.
3. **`resyncScroller()` after every programmatic `scrollTop` write**, or the virtualiser
   paints a different slice than the one on screen (blank transcript).
4. **Pure helpers stay React-free** so vitest can import them in the node environment.
   That is why `isEmojiOnly` lives in `emoji.ts` and not in `MessageRow.tsx`: importing the
   row pulls in `StickerRenderer` → `lottie-web`. `menu.ts` imports `MenuItem` with
   `import type` on purpose (type imports are erased).
5. **`useChatHistory` must be called before ChatPane's early return** (hooks order), and
   `MessageList` must not mount before `anchorKnown` (it captures its position once).
6. `messageActions` is a factory rather than a hook so it is built only when a chat is
   active, and call sites need no null guards.

## How the refactor was verified

- `pnpm verify` after every batch (lint 0 warnings, typecheck, 87 tests, build).
- Electron + mock adapter, end to end: login (`+86138…`, `12345`, `wegram`) → chat list
  → open a group (day separator, unread divider, bubbles, sticker, photo) → send a message
  (list preview, bubble, 未读 receipt) → buoy jump to bottom → open the 5000-message chat
  (lands on #5000) → scroll up 40 rows (continuous rows #4998→#4952, no blank tail, overlay
  scrollbar visible) → chat-info popover (名称/类型/未读/已加载 100 条/已读回执).
  `.cache/app.log` held no errors (only Node's `node:sqlite` experimental warning).
- The Electron window was **closed** afterwards; nothing is left running.

## Remaining batches (batches 5–7 are done — see the 2026-11-19 section above)

Order matters less now: batch 4 was the only high-risk one and the only code verified
exclusively against the real account. Batches 5–7 are renderer/mock work; 8 is optional.

### Batch 4 (done) — `main/telegram/tdlib.ts` (1527) → `main/telegram/tdlib/`

Built exactly as planned, in the two required commits:

```
index.ts          TdlibAdapter: lifecycle, auth state machine, connection, invoke wrapper
client.ts         TdObject / TdClientLike, configureTdlib, safeVersion
avatar-cache.ts   AvatarCache class: own + chat photos, 4-wide pool, 120 ms batched upserts
updates.ts        createUpdateHandler(deps): update dispatch + authorization state machine
actions.ts        history / listChats / getChat / openChat / send* / edit / delete / forward /
                  markRead / search* / downloadFile / fetchFilePath, as functions over ActionDeps
stickers.ts       listStickerSets / getStickerSet / toSticker
proxy.ts          setProxy / testProxy / applyProxy / waitForOnline, as functions over ProxyDeps
map/context.ts    MapperContext (chatTitles, chatAvatarUrls, stickerSizes, resolvers)
map/chat.ts       mapChat, mapChatKind, mapConnectionState
map/message.ts    mapMessage
map/entities.ts   mapEntities + the TL entity type table   (added — see below)
map/content.ts    mapContent, serviceText, previewContent, size/label helpers
                  (the media readers moved to map/media.ts and are re-exported here)
map/media.ts      mediaUrls / pickLargest / pickSmallestAtLeast: the media fields both
                  mapContent and the rich mapper read (added with rich messages)
map/buttons.ts    buttonTarget / inlineButtonOf / mapReplyMarkup: the one address rule
                  for reply-markup buttons and rich page button rows
map/rich.ts       mapRichMessage / richText / flattenBlocks: TDLib page blocks ->
                  RichBlock, plus the flattened words used by previews and 复制
map/sticker.ts    mapStickerThumbnail, mapStickerFormat
map/user.ts       mapUser                                 (added — see below)
```

Three deliberate deviations from the sketch above, all for acyclic imports:

1. **`map/entities.ts`** exists because `mapContent` needs `mapEntities` for photo/video
   captions while `mapMessage` needs `mapContent`. Keeping `mapEntities` in `map/message.ts`
   (as the first sketch said) would have made `content ↔ message` a runtime cycle.
2. **`map/user.ts`** holds `mapUser`, used by both `me()` and `resolveUserName` — it is not a
   chat mapper, so it did not belong in `map/chat.ts`.
3. **`previewContent` lives in `map/content.ts`** (it is built from `extractText` /
   `mapContentLabel` / `servicePreview`), not duplicated in `map/chat.ts`.

Mechanics worth keeping: every helper module takes a small **deps interface** defined in that
module (`ActionDeps`, `ProxyDeps`, `UpdateDeps`, `StickerDeps`, `AvatarCacheOptions`) and
`index.ts` is the composition root that builds them in its constructor. `AvatarCache` owns all
photo state (including our own avatar) instead of the adapter; its `urls` map is handed to the
`MapperContext` as `chatAvatarUrls`. The private photo helpers kept their bodies but became
methods with the class prefix dropped — `loadSelfAvatar` → `loadSelf`,
`prefetchChatAvatars` → `prefetch`, `resolveChatAvatar` → `resolve`,
`queueAvatarUpsert` → `queueUpsert`, `flushAvatarUpserts` → `flushUpserts` — so a line-by-line
review of the move should start there. The `eslint.config.mjs` rule now ignores
`apps/desktop/src/main/telegram/tdlib/**` instead of the old file path.

Acceptance that was run: `pnpm verify` (132 tests) + `pnpm tdlib:smoke` read-only against the
real session (getMe, 20 chats, history with `hasMore=true`, channel `senderChatId` names) + a
mock Electron pass (login → chat list with avatars → 5000-message chat paging #4952→#5000 →
send text → sticker picker, send sticker → chat-info popover `已加载 101 条`), `.cache/app.log`
clean apart from the known `node:sqlite` experimental warning.

### Batch 5 — done as P1-3 in the 2026-11-19 session (see above; layout differs slightly)

`index.ts` (adapter), `fixtures.ts` (now a thin adapter over `@wegram/mock-fixtures`),
`assets.ts` (`addFile`, `mediaOf`), `traffic.ts` (`simulateTraffic`). `mock-assets.ts` stays.
Low risk; the mock is what keeps UI work possible without the real account.

### Batch 6 — done as the preview split above (`lib/preview/` + entry-point shim)

`index.ts` (install), `invoke.ts` (channel → fake response switch), `fixtures/*.ts`
(chats, messages, media, stickers, svg). Dev-only: add a one-line README stating that app
logic must never import it (`eslint.config.mjs` currently has it in the global `ignores`).

### Batch 7 — done above (`styles/*.css`, 14 files, import order preserved)

`tokens.css` (the `:root` block, must be imported first), `base.css`, `shell.css`,
`chat.css`, `composer.css`, `controls.css`, `media.css`, `stickers.css`,
`rich-text.css`, `login.css`, `perf.css`. **`wx-*` class names and `--wx-*` token names are
a measured contract** (`docs/UI-HANDOFF.md`) — do not rename anything. Tailwind v4 is
import-order sensitive: `pnpm build`, then compare a screenshot of the mock app.

### Batch 8 — `packages/protocol` (`channels.ts` 283, `dto.ts` 267)

Per-domain modules re-exported from `index.ts` — the export surface must stay identical
(preload bundles the protocol index, 190 kB). Optional / lowest value.

**Partially done 2026-11-20**: the comment/interaction DTO pushed `dto.ts` over the
550-line cap, so `settings.ts` (MASK / proxy / app settings / `app:info`) and
`viewer.ts` (the 图片和视频 payloads, importing `appSettingsSchema`) were split out and
`channels.ts` now imports from those two. `dto.ts` is at ~470 lines; the message schemas
still live in it, so the rest of this batch is unchanged.

**Also done 2026-11-21**: the 聊天信息 channels pushed `channels.ts` over its cap, so
the **chat domain's keys and schemas** moved to `chats.ts` (list/get/open/openPrivate/
canPost/setMuted/setPinned/clearHistory/members/setTitle/leave/pinned/inviteLink).
`invokeChannels` and `invokeSchemas` spread them, so the tables are still the one
contract; a new chat channel now goes into `chats.ts`. The panel's DTOs
(`chatKind`/`chatSummary`/`chatMember`/`chatPinnedMessage`/`chatOp`) then pushed
`dto.ts` over its own cap and moved to `chat.ts`; the package index still exports every
type, so no consumer import changed.

Files over 200 lines that are **not** in the plan: `WechatIcons.tsx` (458, generated
artwork — leave it), `Composer.tsx` (283), `MediaBubble.tsx` (261), `main/index.ts` (250),
`ProxyPanel.tsx` (222), `OverlayScrollbar.tsx` (205), `PerfPanel.tsx` (198),
`StickerRenderer.tsx` (204). Candidates for a later pass, not approved now.

## Traps this session hit (saves you the same hour)

1. **zustand v5 `StateCreator` takes three arguments.** `slice(set, get)` does not compile
   when the slice is typed as `StateCreator<AppState, [], [], TActions>`; call
   `slice(set, get, api)`. See `store/useAppStore.ts`.
2. **A node-env test file that imports any `.tsx` reaching media/lottie drags the whole
   stack in.** Keep pure helpers in their own module (that is why `emoji.ts` exists).
3. **`import type` is erased**, so a pure module may reference a component's exported type
   (`menu.ts` → `MenuItem`) without pulling React at runtime. Keep it `import type`.
4. **Prettier's one-off reformat touched 27 files**; `WechatIcons.tsx` grew by ~120 lines
   (long SVG attribute blocks get one attribute per line). It is mechanical — use
   `git show -w <commit>` when reviewing `5780819`.
5. **`pnpm format` must not reach `spikes/` or `*.md`** — both are in `.prettierignore`.
6. ~~**Known unfixed observation (pre-existing, not from this refactor):** when a *short*
   transcript (< one viewport) restored a saved anchor, `useAnchoredScroll.unpin()` leaves
   `atBottom === false` and no scroll event ever fires to correct it, so the next incoming
   message shows the “↓ N 条新消息” buoy instead of sticking to the bottom.~~ **Fixed.** The
   root cause is wider than the restore: the pin was only refreshed by scroll events, so any
   layout change that left a transcript shorter than the viewport (restore, window resize,
   rows measuring shorter than the virtualizer's estimates, a shrink) kept `atBottom` stale.
   The rule now lives in `lib/scrollGeometry.ts` and is re-derived from geometry by both
   ResizeObservers and after a restore; a stored anchor that can no longer be used is cleared.
   Fixing it surfaced a second, pre-existing defect: `useChatHistory` announced
   `anchorKnown === false` in an *effect*, so a cached chat mounted the list one frame early
   at the bottom, which wrote `bottom` over the stored anchor before `ui:getAnchor` read it —
   cached chats never restored. That reset now happens during render. See `docs/HANDOFF.md`
   → "Non-obvious facts".
7. **Electron launch:** always `pwsh apps\desktop\scripts\launch-detached.ps1 -NoSandbox -Mock`
   from a normal (non-job) shell path — the agent shell cannot start Chromium. If an older
   `electron.exe` is still alive, the single-instance lock silently keeps the OLD bundle on
   screen; close it first (`windows close electron.exe`).
8. **The real account in `spikes/tdlib/data` is read-only.** Never send/edit/delete/forward
   against it; `-Mock` / `WEGRAM_ADAPTER=mock` for anything that writes.

## Dedupe pass (2026-11-20)

A read-only duplication audit (a 7-line block scan plus three deep passes over main,
renderer and protocol/preview) became one branch, one commit per item. What moved:

| Was duplicated | Now lives in |
|---|---|
| the three `BrowserWindow` factories | `main/app-window.ts` (`createAppWindow`, `attachNavigationPolicy`); the viewer's missing `will-navigate` guard was a separate commit |
| "append a message and announce it" in the mock (4 copies) | `main/telegram/mock/transcript.ts` (`outgoingMessage`, `appendMessage`) |
| the send envelope + the thread resolver | `main/telegram/tdlib/actions/message-input.ts`; one `resolveThread` with `requireRoot` |
| the media field table (photo/video/animation/document/voice) | `main/telegram/tdlib/map/media.ts` |
| "a missing array means empty" (24 sites) | `main/telegram/tdlib/json.ts` (`asArray`) |
| the newer-messages page | `history.ts` → `fetchNewerThan` |
| avatar boxes (7 copies, one already lost `draggable`) | `components/Avatar.tsx` |
| the search pill + the query rule (4 panels) | `components/SearchField.tsx`, `lib/search.ts` |
| Enter / Shift+Enter / IME | `lib/composerInput.ts` + `lib/useComposerInput.ts` |
| floating-card placement (`rect.right - 232`, `rect.top - 92`) | `lib/popupPlacement.ts` + `AnchoredPopup` |
| the reserved media box + percent text | `lib/mediaBox.ts` |
| the signed-in identity (two placeholder ids) | `lib/self.ts` (1000; the comment panel used 0) |
| calendar-day maths | `lib/format.ts` → `calendarDaysAgo` |
| the fake session's paging / read / comment rules | new package `@wegram/mock-session`, wired into both tsconfigs, both vite configs, eslint's `max-lines` list and the version scripts |
| the demo account's data (two ~450-line copies that had drifted) | new package `@wegram/mock-fixtures`: chats, messages, threads and contact fields, with each fake injecting `mediaOf` and its clock |

**Deliberately NOT merged** — the audit concluded these only *look* duplicated:

- mock adapter vs TDLib adapter: two implementations of `TelegramAdapter` is the design.
- `TelegramAdapter` → `TdlibAdapter` forwarding → `actions/*`: that is the seam.
- `store/settings.ts` vs `store/ui-db.ts`, and the three `proxy` modules: different
  formats by rule (JSON+DPAPI vs SQL; URL parse vs sealed config vs TDLib call).
- the two `map/*` dispatch switches: two different TDLib type trees.
- `setError(errorMessage(e))` at ~28 sites: where an error goes depends on the call site
  (`ProxyPanel` hands the login window its own error line — there is no store there).
- per-panel empty/loading skeletons and CSS declaration blocks: `wx-*` is a measured contract.
- `preview/index.ts`'s invoke switch vs `main/ipc/handlers.ts`: handlers need Electron and
  the preview may not import main; only the pure rules are shared (that is the package).

**Fixtures** — the demo account itself was still two copies when this batch landed.
The contract pass below merged it into `@wegram/mock-fixtures`.

## Contract pass (2026-11-20, the audit's "B class")

Second batch from the same audit: the places where one contract was written more than
once. Same branch, one commit per item.

| Was mirrored | Now |
|---|---|
| invoke request shapes: zod schema + a handler cast + the adapter signature | one: the `channels.ts` schema. `IpcHandlerMap` is keyed by channel and typed `InvokeRequest<C>`, the adapter's inputs are `InvokeRequest<...>` as well, and the only cast left is the channel loop in `router.ts`. |
| the comment contract (four inline zod objects, six hand-written interfaces) | `packages/protocol/src/comment.ts`; the adapter re-exports the types |
| `AppErrorCode` (a hand-written union beside `code: z.string()`) | `appErrorCodeSchema` + `z.infer`; `IpcResult.error` and the renderer guard use `AppErrorShape` |
| `EventBus.publish(channel, payload: unknown)` | `publish<C extends EventChannel>(channel: C, payload: EventPayload<C>)`, so `events.ts` is checked against the event schemas |
| row height 65 (TS) vs `--wx-list-item-h` (CSS); panel slide 250 ms vs `0.25s` | constants moved to `lib/listMetrics.ts` / `lib/comments.ts`; `apps/desktop/scripts/style-contract.test.ts` reads the stylesheets and fails on drift |
| `RECENT_EMOJI_LIMIT` (10 in three places, 24 in the schema), the sticker-format enum (three literals), the viewer strip bound (two copies), `UnreadBoundary`/`UnreadMarker` (two declarations) | one constant / schema / type each |

**Found by removing the casts**: `ui:saveDraft` declared an `entities` field that no
caller sent and no store kept — invisible while the handler carried `payload as {...}`.
The field is gone until something needs it.

**The fixture data is merged too.** `packages/mock-fixtures` holds the account —
chats, messages, comment threads, contact fields — and each fake injects only its
environment: `mediaOf` (`wx-media://` tokens under `userData` vs `data:` URLs) and
`now`. The preview gained what it was missing (chat 11, chat 1's read markers, the
stress chat's exact ids), the mock gained digit-only phone numbers, and the
chat-list order became one rule (`@wegram/mock-session` → `sortChatList`). The
parity test and the `__WEGRAM_VERSION__` shim it needed are deleted: with one
source there is nothing left to reconcile.

**Not done, on purpose**: the mock adapter and the TDLib adapter still each implement
`TelegramAdapter`; the three `proxy` modules and the two stores keep their own formats;
`setError(errorMessage(e))` stays at its call sites. The audit's C class lists why —
see the dedupe section above.
## Mock adapter extracted (2026-11-21)

The fake adapter left `apps/desktop/src/main`. `telegram/mock/` (16 files) and
`telegram/mock-assets.ts` now live in `packages/mock-adapter`, and the
`TelegramAdapter` seam moved to `packages/adapter-contract`
(`main/telegram/adapter.ts` is a two-line re-export, so every existing `./adapter`
import stayed where it was).

Why a package and not just a folder: the mock implements the seam, so it cannot import
app code. Its only two app-side dependencies — `media/registry.ts` and
`media/image-size.ts` — are now injected through `MockAdapterOptions`
(`registerMedia`, `probeImageSize`), wired in `main/telegram/index.ts`. Both packages
are connected exactly like the existing fakes: tsconfig paths + `include`,
`electron.vite.config.ts` alias + `externalizeDepsPlugin` exclude (main only, so the
renderer cannot pull `node:fs` through the alias), ESLint's `max-lines` list, and
`scripts/sync-version.mjs`. Each package has its own `AGENTS.md`.

Behaviour is unchanged and `pnpm verify` is green (lint → typecheck → 535 tests →
build). Note what did **not** change: main still imports `@wegram/mock-adapter`
statically and the renderer still imports `lib/preview-bridge.ts` statically, so the
fixture code remains in the artifact. Excluding it from a release would be a separate
build-time change (dev-only dynamic import + a define that rollup can eliminate), and it
must cover both sides at once.

## Start-here checklist for the next session

```powershell
pnpm install                 # lockfile already has the tooling deps
pnpm verify                  # must be green before you change anything
git log --oneline -6         # the six commits above

# UI / renderer work
cd apps\desktop; pnpm web                       # browser preview (fakes IPC)
pwsh apps\desktop\scripts\launch-detached.ps1 -NoSandbox -Mock   # real shell, mock adapter
#   logs: .cache\app.log

# adapter work (read-only)
cd apps\desktop; pnpm tdlib:smoke
cd apps\desktop; pnpm ui:db-check
```

Before you touch a directory, read its layer note:
`packages/protocol/AGENTS.md`, `apps/desktop/src/main/AGENTS.md`,
`apps/desktop/src/renderer/AGENTS.md`.

## Do not

- Do not change IPC channel names, DTO field names, `wx-*` class names, or the
  `wx-media://f/<token>` scheme as part of a refactor.
- Do not rewrite a scroll algorithm while moving it. Batch 2 moved code only; the timings
  (250 ms save window, 150/400 ms re-stick, 700/1000 ms reveal nets, 15 s load cap) are
  load-bearing and documented in `docs/HANDOFF.md`.
- Do not add a DOM test environment (`jsdom`, testing-library) without deciding it
  explicitly — the node-only suite is intentional, and the real bugs here are timing and
  measurement bugs that jsdom cannot reproduce.
- Do not bypass `pnpm verify` when reporting a change as done.

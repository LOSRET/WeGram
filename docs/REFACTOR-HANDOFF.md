# Refactor handoff — splitting the code for agent maintenance

Written 2026-11-17, directly after the refactor session that did **batches 0–3** of the
approved plan. Read this together with `docs/HANDOFF.md` (project state, measured TDLib
behaviour) and the three layer notes (`packages/protocol/AGENTS.md`,
`apps/desktop/src/main/AGENTS.md`, `apps/desktop/src/renderer/AGENTS.md`).

Audience: the next agent session. Everything below was measured or executed, not planned.

## TL;DR

- Working tree is **clean**, all work is committed on `main`, and `pnpm verify` is green.
- Six commits: one that commits the pre-existing dirty tree, then batches 0–3, then docs.
- The repo now has **87 unit tests** (was 0), ESLint that enforces the architecture rules
  from prose, and Prettier as the single formatter.
- `useAppStore.ts` (293), `MessageList.tsx` (705) and `ChatPane.tsx` (415) are gone;
  they are now 20 small modules, none over 223 lines.
- **Batches 4–8 are not started**: `tdlib.ts`, `mock.ts`, `preview-bridge.ts`,
  `styles/index.css`, `packages/protocol`. See "Remaining batches" for the exact target
  layout and the risks.

## Commits from this session (oldest first)

| Commit | Content |
| --- | --- |
| `f1d0a9e` | The working tree that was already modified: pendingOps replay, virtualizer resync, empty-page retries, anchor-save rework, big-emoji CSS, launcher fix, `scripts/start-real.cmd`. Verified by `pnpm typecheck` + `pnpm build` before committing. |
| `5780819` | **Batch 0** — vitest + 51 tests, ESLint flat config with the architecture rules, Prettier, `pnpm verify`, layered `AGENTS.md`. Contains the one-off reformat of 27 files (review with `git show -w`). |
| `69e3a98` | **Batch 1** — store split + 23 tests (reducers, store invariants). |
| `8b9c3ec` | **Batch 2** — message-list split + 13 tests (unread divider, context menu, emoji detection). |
| `8209857` | **Batch 3** — chat-pane split (no new tests: the extracted parts are IPC orchestration). |
| `680720f` | Docs: architecture map + renderer AGENTS.md point at the new modules. |

Commits are GPG-signed (`commit.gpgsign=true` works in this session — unlike the note
about the root commit in `docs/HANDOFF.md`). Branch: `main`.

## The verification layer (use it; it is the point of batch 0)

```powershell
pnpm verify          # THE gate: lint -> typecheck -> test -> build. ~8 s.
pnpm lint            # eslint . --max-warnings 0   (errors AND warnings fail)
pnpm test            # vitest run                  (87 tests, node environment)
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
  ChatHeader.tsx         title, typing, call buttons, "…"
  ChatInfoPopover.tsx    the "…" popover
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
- Electron + mock adapter, end to end: login (`+86138…`, `12345`, `wechatgram`) → chat list
  → open a group (day separator, unread divider, bubbles, sticker, photo) → send a message
  (list preview, bubble, 未读 receipt) → buoy jump to bottom → open the 5000-message chat
  (lands on #5000) → scroll up 40 rows (continuous rows #4998→#4952, no blank tail, overlay
  scrollbar visible) → chat-info popover (名称/类型/未读/已加载 100 条/已读回执).
  `.cache/app.log` held no errors (only Node's `node:sqlite` experimental warning).
- The Electron window was **closed** afterwards; nothing is left running.

## Remaining batches (approved scope: 4–8, not started)

Order matters: 4 is the only high-risk one and is the only code verified exclusively
against the real account. Do it in a dedicated session with `tdlib:smoke` available.

### Batch 4 — `main/telegram/tdlib.ts` (1527 lines) → `main/telegram/tdlib/`

```
index.ts          TdlibAdapter: lifecycle, auth state machine, connection, invoke wrapper
client.ts         configureTdlib, TdClientLike, safeVersion
avatar-cache.ts   loadSelfAvatar / prefetchChatAvatars / queue+flush upserts (4-wide pool)
updates.ts        handleUpdate dispatch table + handleAuthorizationState
actions.ts        history / sendText / sendMedia / sendSticker / edit / delete / forward /
                  markRead / openChat / getChat / search*
stickers.ts       listStickerSets / getStickerSet / toSticker
proxy.ts          setProxy / testProxy / applyProxy / waitForOnline
map/chat.ts       mapChat, mapChatKind, mapConnectionState, previewContent
map/message.ts    mapMessage, mapEntities
map/content.ts    mapContent, serviceText, previewContent, mediaUrls, pickLargest,
                  pickSmallestAtLeast (the ~330-line block at the bottom)
map/sticker.ts    mapStickerThumbnail, mapStickerFormat
```

Key step, do it as **two commits**: the mappers are currently private methods that read
`this.chatTitles`, `this.chatAvatarUrls`, `this.stickerSizes`. First turn them into pure
functions taking an explicit `MapperContext` (behaviour identical), then move files.
That makes `mapContent`/`mapEntities`/`serviceText` unit-testable — they are the part most
likely to be broken by a future field change, and they have no tests today.

Acceptance: `pnpm verify` + `pnpm tdlib:smoke` (read-only: getMe / getChats / history
paging) + one mock Electron run. Update the wording in `CLAUDE.md` ("Architecture rules")
and `apps/desktop/src/main/AGENTS.md` from `telegram/tdlib.ts` to `telegram/tdlib/**`.

### Batch 5 — `main/telegram/mock.ts` (884) → `mock/`

`index.ts` (adapter), `fixtures.ts` (chats + messages), `assets.ts` (`addFile`, `mediaOf`,
media half of `buildFixtures`), `traffic.ts` (`simulateTraffic`). `mock-assets.ts` stays.
Low risk; the mock is what keeps UI work possible without the real account.

### Batch 6 — `renderer/src/lib/preview-bridge.ts` (519) → `lib/preview/`

`index.ts` (install), `invoke.ts` (channel → fake response switch), `fixtures/*.ts`
(chats, messages, media, stickers, svg). Dev-only: add a one-line README stating that app
logic must never import it (`eslint.config.mjs` currently has it in the global `ignores`).

### Batch 7 — `renderer/src/styles/index.css` (2122) → `styles/*.css`

`tokens.css` (the `:root` block, must be imported first), `base.css`, `shell.css`,
`chat.css`, `composer.css`, `controls.css`, `media.css`, `stickers.css`,
`rich-text.css`, `login.css`, `perf.css`. **`wx-*` class names and `--wx-*` token names are
a measured contract** (`docs/UI-HANDOFF.md`) — do not rename anything. Tailwind v4 is
import-order sensitive: `pnpm build`, then compare a screenshot of the mock app.

### Batch 8 — `packages/protocol` (`channels.ts` 283, `dto.ts` 267)

Per-domain modules re-exported from `index.ts` — the export surface must stay identical
(preload bundles the protocol index, 190 kB). Optional / lowest value.

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
6. **Known unfixed observation (pre-existing, not from this refactor):** when a *short*
   transcript (< one viewport) restored a saved anchor, `useAnchoredScroll.unpin()` leaves
   `atBottom === false` and no scroll event ever fires to correct it, so the next incoming
   message shows the “↓ N 条新消息” buoy instead of sticking to the bottom. Plausible fix:
   treat "content shorter than viewport" as pinned in `useAnchoredScroll`. Needs its own
   decision, no test exists for it.
7. **Electron launch:** always `pwsh apps\desktop\scripts\launch-detached.ps1 -NoSandbox -Mock`
   from a normal (non-job) shell path — the agent shell cannot start Chromium. If an older
   `electron.exe` is still alive, the single-instance lock silently keeps the OLD bundle on
   screen; close it first (`windows close electron.exe`).
8. **The real account in `spikes/tdlib/data` is read-only.** Never send/edit/delete/forward
   against it; `-Mock` / `WECHATGRAM_ADAPTER=mock` for anything that writes.

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

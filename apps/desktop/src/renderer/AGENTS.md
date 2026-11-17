# AGENTS.md — apps/desktop/src/renderer

Scope: the React 19 + Tailwind v4 UI. Read the root `../../../../CLAUDE.md`, then
`docs/UI-HANDOFF.md` for the WeChat metrics this UI was built against. This file
only adds what is specific to this layer.

## Layering

```
App.tsx               bootstrap + the ONE place that subscribes to evt:*
store/                zustand: data defaults (initialState.ts), pure reducers, slices
components/message-list/  virtualiser + MessageRow + Divider + the three scroll hooks
components/chat-pane/     render tree + useChatHistory + messageActions + placeholders
components/           the remaining visual concerns (Composer, MediaBubble, …)
lib/ipc.ts            thin `window.tg` wrapper
lib/format.ts         time / preview / avatar helpers (pure, unit-tested)
lib/entities.ts       TL entity → text segments (pure, unit-tested)
lib/useAnchoredScroll.ts  ready gate, stick-to-bottom, resize compensation
lib/scrollGeometry.ts (pure, unit-tested) the ONE "is the reader at the bottom" rule
lib/history.ts       (pure, unit-tested) the ONE "may this empty page be cached" rule
lib/media.ts          one-download-per-file dedupe
lib/viewer.ts         which messages become one viewer strip (pure, unit-tested)
lib/player.ts         video player-bar maths: clocks, seek clamp, progress (pure, unit-tested)
lib/tgs.ts            gzip guards + Lottie decode cache
lib/preview-bridge.ts DEV-ONLY fake IPC for the browser preview
```

The renderer is a sandboxed web page: **no `electron`, no `node:*`, no `tdl`**
(lint-enforced). It only speaks the `window.tg` contract from
`@wechatgram/protocol`.

## Rules that have already cost a debugging session

- **Never gate content visibility on `requestAnimationFrame` alone.** Electron
  throttles rAF while the window is occluded, so the pane stays invisible with
  its data loaded. Always pair a frame-based reveal with a `setTimeout` fallback.
- **A programmatic `scrollTop` write desyncs `@tanstack/react-virtual`** (it
  re-reads its offset only on real scroll events). After every programmatic
  scroll, dispatch one `scroll` event so the virtualizer re-measures — otherwise
  the transcript looks blank while `scrollTop` says "at the bottom".
- **`messagesByChat[chatId]` is created only by `setHistory`/`prependHistory`.**
  `ChatPane` reads "an entry exists" as "already cached"; creating one from an
  event (read receipts fire for every chat) makes the first-page fetch get skipped
  forever. Ops that arrive before the first page are queued in `pendingOps`.
- **Never cache an empty first page for a chat that has messages.** A cold TDLib
  database answers `messages:history` with `[]` while the chat list still reports a
  `lastMessageAt`; caching that turns one slow sync into a blank transcript for the
  rest of the session (recovered only by 重新加载). `useChatHistory` retries three
  times and then leaves the entry **absent** so the next open asks again — the one
  legitimate empty page is a chat with no `lastMessageAt` at all.
- **"Anchor known" must be reset during render, not in an effect.** An effect runs after
  a render that still carries the previous chat's `anchorKnown === true`, so `ChatPane`
  mounts the list one frame early with no anchor, lands at the bottom and writes `bottom`
  over the stored anchor before `ui:getAnchor` answers — every *cached* chat then
  reopens at the bottom. `useChatHistory` compares `stateChatId !== activeChatId` in the
  render body and resets there.
- **The stick-to-bottom pin comes from geometry, never from scroll events.** Use
  `lib/scrollGeometry.ts` (`readScrollPin`) for "is the reader at the bottom"; a
  transcript shorter than the viewport never scrolls, so `atBottom` can only be
  corrected by the `ResizeObserver`s and after a restore. Otherwise the next incoming
  message raises "↓ N 条新消息" over a message the reader can see.
- **The buoy's N is derived, never accumulated.** `components/message-list/unreadBelow.ts`
  counts "incoming messages newer than `chat.lastReadInboxMessageId` and still below the
  viewport" (`MessageList.measureViewport` supplies the newest on-screen index). The pill,
  the chat row badge and the rail total therefore come from the same server marker and
  cannot disagree; counting arrivals (or `messages.length` deltas, which a prepended page
  inflates) made the pill shout "6 条新消息" over messages the reader had read.
- **The read marker follows the viewport, not the bottom.** `MessageList` reports
  `onSeenUpToChange` (the newest row whose top edge is inside the viewport) and
  `ChatPane` sends `messages:read` up to it, still gated by `lib/readGate.ts`
  (seen + window visible + focused). Telegram's marker is monotonic and
  `unread_count` comes back from the server, so the chat row and the rail badge
  fall message by message as the reader scrolls. Reporting only "at the bottom"
  kept every badge and the rail total lit until the last pixel.
- **Where a chat opens is decided before the list mounts** (`useChatHistory` →
  `resolveLanding`): the saved row if it sits at/after the read boundary, else the
  unread divider (line at the viewport top), else the newest message. The first page
  must contain that row, so a chat with unread mail pages back to
  `lastReadInboxMessageId` first; the list captures its position once, on first paint.
  An unread block shorter than the viewport is clamped to the bottom on purpose — the
  divider stays visible above it, and "fixing" that with more scrolling only spins
  with the pane hidden.
- **Long panes use `components/OverlayScrollbar.tsx`**, never a native scrollbar:
  Chromium gives native bars a layout gutter, so rows re-flow when the bar
  appears. Popovers keep native thin bars on purpose.
- **`wx-*` class names and the `--wx-*` tokens are a measured contract** (see
  `styles/index.css` header and `docs/UI-HANDOFF.md`). Do not rename a class, and
  do not hard-code a colour — every colour comes from the `:root` block.
- User-facing copy is Chinese (`回复`/`复制`/`转发`…), code, identifiers and
  comments are English.

## Verify

```powershell
pnpm test                              # pure lib/ helpers
cd apps\desktop; pnpm web              # browser preview, http://localhost:5174
#   ?perf=1 → dev acceptance panel: FPS + anchored-row drift
pwsh apps\desktop\scripts\launch-detached.ps1 -NoSandbox -Mock   # real Electron shell
```

Anything about media, virtualisation or scroll behaviour must be checked in the
Electron window, not in the browser preview: the preview fakes IPC and has no
`wx-media://` protocol.

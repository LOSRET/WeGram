# AGENTS.md — apps/desktop/src/renderer

Scope: the React 19 + Tailwind v4 UI. Read the root `../../../../CLAUDE.md`, then
`docs/UI-HANDOFF.md` for the WeChat metrics this UI was built against. This file
only adds what is specific to this layer.

## Layering

```
main.tsx              route by hash: plain = shell, #viewer = viewer, #login = login window
App.tsx               shell only (auth ready) + the ONE place that subscribes to evt:*
screens/LoginWindow.tsx  the standalone login window: chrome + its four bodies
screens/QrWindow.tsx     the 群二维码 window (`#qr`, design doc §9.9): a frameless 360×560
                         sheet with the member collage, 群聊：…, the code, its validity
                         line and 转发给朋友 / 复制图片 / 保存图片. It owns no shell state
                         and rasterises its own PNG (lib/qrImage.ts).
screens/login/           useLoginFlow (the whole sign-in flow) + BootStatus / bootCopy (the
                         startup-phase and failed/crashed panel) + QrStep / ProfileStep /
                         PhoneForm / LoginFooter / LoginHelp + loginCopy (pure copy table)
components/QrCode.tsx    login QR: one SVG path from the qrcode matrix
lib/qr.ts                QR matrix + path helpers (pure, unit-tested)
store/                zustand: data defaults (initialState.ts), pure reducers, slices
components/message-list/  virtualiser + MessageRow + Divider + the scroll hooks:
                         useInitialPosition / usePrependRestore / useAnchorSave /
                         useLandingSave / useJumpToLatest / useLocateScroll / useViewportSeen;
                         RichMessage (page blocks), ContactCard (vCards), InlineButtons,
                         CommentBar (评论 N 条 handle, §9.8), ChannelMeta (a channel post's
                         views/time footer; the one-bubble channel composition is
                         styles/channel.css), PremiumStickerEffect (a Premium sticker's
                         second TGS, painted once at 1.49× the sticker and replayed on tap)
components/chat-pane/     render tree + useChatHistory (history/ modules) + messageActions +
                         CommentPanel (full-pane discussion view, slides in from the right;
                         chat-style rows + the composer card, posts via messages:sendComment;
                         non-members get the official client's 加入/申请加入 gate instead;
                         opens at the top of the thread) + useCommentAnchor (that thread's
                         reading position in ui.db; the default landing is the top) +
                         ChatInfoPanel (聊天信息, §9.9: a 314 px OVERLAY sheet — transform
                         only, the transcript keeps its width — with 搜索群成员, the member
                         grid, 群聊名称 / 群公告 / 群二维码 / 退出群聊 for groups and the
                         shared mute/pin/clear rows; 群二维码 opens screens/QrWindow.tsx, the
                         rows live in ChatInfoRows.tsx, and the rename/invite sheets in
                         ChatInfoDialogs.tsx) + ChatInfoSearch
                         (in-panel 查找聊天内容 over search:inChat, picks a row → locate)
components/contacts/      通讯录: ContactsList (service rows + address book by initial) +
                         ContactDetail (the card)
components/picker/        the expression panel's data hooks and body components
components/ExpressionPicker.tsx  the picker's state + composition
components/viewer/        the 图片和视频 window: MediaViewer shell + useViewerItem /
                         useViewerZoom + ViewerToolbar / ViewerGrid + viewerMenu / viewerActions
components/Avatar.tsx    the ONE avatar box (photo or initials); the box class it is given
                        is the positioned element, which is the rule that once cost a session
components/CustomEmoji.tsx  a Premium custom emoji in text: its sticker art at 20 px,
                        with the base glyph as the fallback
components/SearchField.tsx  the ONE search pill (label + input + optional trailing control)
components/           the remaining visual concerns (Composer, MediaBubble, …)
lib/ipc.ts            thin `window.tg` wrapper
lib/clipboard.ts      text copy for the contact card (navigator.clipboard + execCommand fallback)
lib/format.ts         time / preview / avatar helpers (pure, unit-tested)
lib/search.ts         normalizeQuery / containsText — the ONE reading of a search box
lib/self.ts           SelfIdentity + selfIdentity(auth); one placeholder id (1000)
lib/popupPlacement.ts (pure, unit-tested) "which edge does this card hang from"
lib/mediaBox.ts       (pure, unit-tested) the reserved media box + percent text
lib/unreadBoundary.ts (type only) the snapshot a chat opens with; `UnreadMarker` is an alias
lib/listMetrics.ts    (pure, unit-tested via scripts/style-contract) the virtualised row height
lib/composerInput.ts  (pure, unit-tested) Enter / Shift+Enter / IME rule
lib/useComposerInput.ts  composition ref + textarea props, shared by both composers
lib/contacts.ts       通讯录 initial/grouping, pinyin via ICU (pure, unit-tested)
lib/entities.ts       TL entity → text segments (pure, unit-tested)
lib/useAnchoredScroll.ts  ready gate, stick-to-bottom, resize compensation
lib/scrollGeometry.ts (pure, unit-tested) the ONE "is the reader at the bottom" rule
lib/jumpSettle.ts    (pure, unit-tested) "has the jump to the newest message landed?"
lib/chatInfo.ts      (pure, unit-tested) the panel's slide length + which faces its
                     participant grid draws (members, or the conversation as the fallback)
lib/qrImage.ts       the 群二维码 window's PNG: same qrMatrix/qrDrawing the SVG uses,
                     rasterised with the quiet zone for clipboard/save/forward
lib/history.ts       (pure, unit-tested) the ONE "may this empty page be cached" rule
lib/media.ts          per-owner request dedupe + cancel + the media URL/progress hooks
lib/mediaVariant.ts   (pure, unit-tested) which photo size covers a box
lib/mediaPriority.ts  (pure, unit-tested) the TDLib download priority ladder
lib/emojiSound.ts     an animated emoji's click sound, fetched on the first click
lib/viewer.ts         which messages become one viewer strip (pure, unit-tested)
lib/player.ts         video player-bar maths: clocks, seek clamp, progress (pure, unit-tested)
lib/tgs.ts            gzip guards + Lottie decode cache
lib/stickerMedia.ts   Sticker → MessageMedia (shared by the picker and the preview)
lib/customEmoji.ts    custom emoji ids → sticker art: one batched lookup per frame,
                      cached for the session (chunkIds is pure, tested)
lib/stickerBox.ts     (pure, unit-tested) the on-screen sticker box + the 1.49× effect box
lib/useInView.ts      the visibility gate a sticker and its effect share (geometry first)
lib/preview-bridge.ts DEV-ONLY entry point (re-exports lib/preview)
lib/preview/          browser-preview session + invoke switch (index.ts); fixtures.ts is a
                      thin adapter over @wegram/mock-fixtures (data: URLs + gradient faces);
                      chats.ts / messages.ts / comments.ts / qr.ts hold the handler rules the
                      invoke switch delegates to
```

`styles/index.css` is the entry point only: it imports `styles/*.css` in source order
(tokens first). Keep that order — it is load-bearing — and see the tokens header before
changing a colour or a `wx-*` class.

The renderer is a sandboxed web page: **no `electron`, no `node:*`, no `tdl`**
(lint-enforced). It only speaks the `window.tg` contract from
`@wegram/protocol`.

## Rules that have already cost a debugging session

- **An avatar box needs `position: relative`.** `.wx-avatar__img` is absolutely
  positioned with `inset: 0` so a photo fills its rounded square; a new wrapper that
  draws one (the comment rows did) without `position: relative` throws the photo out
  to the nearest positioned ancestor — the message row — where it paints over the whole
  bubble at full row size. The comment avatar has its own containing block for this.
- **A prop read inside an async decode must go through a ref.** `TgsSticker` played
  from the lottie load callback using the render-time `active`: a sticker whose file
  was already cached mounted in the same commit as the visibility measurement, the
  `[active]` effect ran while `animationRef.current` was still `null` (and returned),
  and the callback then read the stale `false`. Every animated sticker of a chat the
  reader switched back to stayed on its first frame — only the last row, mounted a
  frame later, ever played. The callback reads `activeRef.current` now; any future
  "load then start" path must do the same.
- **Never gate content visibility on `requestAnimationFrame` alone.** Electron
  throttles rAF while the window is occluded, so the pane stays invisible with
  its data loaded. Always pair a frame-based reveal with a `setTimeout` fallback.
- **A CSS slide needs the element mounted closed first, and the parent must delay the
  unmount.** `CommentPanel` renders at `translateX(100%)` and flips `is-open` on the
  next tick (a 20 ms timeout, since rAF is throttled while occluded); on close the
  pane keeps it mounted for `COMMENT_PANEL_ANIM_MS` (250 ms) or the panel vanishes
  mid-slide. `ChatInfoPanel` follows the same two rules, and it is an **overlay**:
  `translateX(100% → 0)` only. Never give it a width animation to "push" the chat — the
  owner's reference presses the sheet on top of the messages, and a width animation
  re-lays-out every virtualised row on every frame (an earlier version did, and was
  wrong). `INFO_PANEL_ANIM_MS` is pinned to the stylesheet by
  `style-contract.test.ts`, and a channel whose member list needs administrator rights
  answers with no members on purpose (the grid falls back to the conversation's face).
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
- **"跳转到最新消息" owns its move until it lands.** Chromium cancels a programmatic
  smooth scroll the moment the scroll *range* changes, and the virtualiser changes it on
  every row it measures during the move: the pill used to glide a few thousand pixels
  and stop there, with the pin already dropped by the mid-flight scroll events and the
  buoy gone (measured: 32 320px of content, landed at 11 486). `useAnchoredScroll`
  therefore holds `movingRef` for the whole move (no pin re-derivation from the way
  down, no `ResizeObserver` glue halfway) and finishes it with a timer net —
  `lib/jumpSettle.ts` decides "still moving / stalled / out of time" — while a wheel,
  drag or key ends the move instead of fighting the reader.
- **Older pages are fetched ahead of the reader, and the buffer is a snapshot.**
  `useChatHistory.prefetchOlder` keeps one page in `olderPagesByChat` (on mount and after
  every landing) because TDLib's first server answer takes seconds while a wheel reaches
  the top in one. Never insert it without the `afterId` check, an empty page must not be
  buffered (a cold cache answers `[]`), and a delete/edit/replace of a buffered row, or a
  `setHistory`, has to drop it — otherwise a deleted message is prepended back.
- **The read marker follows the viewport, not the bottom.** `MessageList` reports
  `onSeenUpToChange` (the newest row whose top edge is inside the viewport) and
  `ChatPane` sends `messages:read` up to it, still gated by `lib/readGate.ts`
  (seen + window visible + focused). Telegram's marker is monotonic and
  `unread_count` comes back from the server, so the chat row and the rail badge
  fall message by message as the reader scrolls. Reporting only "at the bottom"
  kept every badge and the rail total lit until the last pixel.
- **Where a chat opens is decided before the list mounts** (`useChatHistory` →
  `resolveLanding`): the saved row if it sits at/after the read boundary, else the
  unread divider (line at the viewport top), else the newest message. When that row is
  older than the newest page, the window is loaded *around* it (`messages:around`)
  instead of paging back from the newest message, so a deep position is one request
  away and the old 6-page budget is gone. Such a window can stop short of the newest
  message (`hasNewer`): live arrivals are queued, scrolling to the window end appends
  `messages:newer`, and sending / the buoy reload the newest page. The list captures
  its position once, on first paint. An unread block shorter than the viewport is
  clamped to the bottom on purpose — the divider stays visible above it, and "fixing"
  that with more scrolling only spins with the pane hidden.
- **The login window (`#login`) must not boot the shell.** It has its own tiny
  state (auth + theme) and only follows `evt:auth`; hydrating the zustand chat store
  there would give one account two writers. Its 280 px modal is the shell's
  `ProxyPanel` with the `.wx-login .wx-modal` overrides — keep those together.
- **The QR is TDLib's link, and it cannot be cancelled.** `waitQr.link` is a
  `tg://login?token=…` string that TDLib re-issues by itself — just re-render it;
  never cache it as "the" QR. The phone fallback must go through `auth:reset`
  (main restarts TDLib), not a direct `auth:start`. Keep the QR unstyled by theme:
  a dark-on-dark code does not scan, and keep its **four-module white quiet zone
  inside** the 136 px square (`qrDrawing`) — the sheet behind it is `#fafafa` /
  `#1e1e1f`, so "the page is the margin" leaves the code unscannable.
- **A photo bubble asks for the size it draws, not the original.** `MessageMedia.sizes` is
  smallest-first; `lib/mediaVariant.ts` picks the variant that covers
  `box × devicePixelRatio`, TDLib's `thumbFileId` paints first, and `useInView` (half a
  screen of margin) gates the download. Every `media:download` names an **owner**, so
  `media:cancel` stops only that bubble — a video bubble never downloads the clip at all;
  the viewer streams it through `media:stream`.
- **A viewer photo must be allowed to outgrow the canvas.** Tailwind's preflight
  caps every `img` at `max-width: 100 %`, and an `img` is also a flex item (it
  shrinks by default), so the zoomed picture stopped dead at the window width —
  its width pinned while its height kept growing — and zoom looked broken past
  "as big as the window". `.wx-viewer__image` therefore carries `flex: none;
  max-width: none; max-height: none;`; any future element sized from
  `lib/zoom.ts` needs the same reset.
- **The viewer strip belongs to the pane, not to `messagesByChat`.** `lib/viewer.ts`
  builds the strip from the rows the reader can see, and reading only the chat store
  meant a photo or a video in a channel post's comments did nothing: those rows are the
  *discussion group's* messages, held in `CommentPanel`'s own state, so their `chatId`
  has no store entry and `buildViewerStrip` answered "not in the strip" (silently — the
  click just returned). Any pane with its own list must hand that list to viewers through
  `lib/viewerSource.ts` (`<ViewerSource value={rows}>`); `MediaBubble` reads it and
  `openViewer` prefers it over the store.
- **通讯录 is the Telegram address book, not the chat list.** `contacts:list`
  (`getContacts` + `getUser` in main) returns `Contact[]` — people, not
  conversations — so a contact you never wrote to has a card but no chat; 发消息
  calls `chats:openPrivate` and TDLib creates the private chat then. The list is
  re-read whenever the rail switches to 通讯录 (TDLib answers from its local cache).
  Grouping stays in `lib/contacts.ts` (ICU pinyin boundaries); do not swap it for a
  pinyin dependency without asking. Photos arrive through `evt:avatars`
  (`userAvatars[userId]`), the same pool the transcript uses.
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

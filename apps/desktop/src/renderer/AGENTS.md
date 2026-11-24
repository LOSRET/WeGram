# AGENTS.md — apps/desktop/src/renderer

Scope: the React 19 + Tailwind v4 UI. Read the root `../../../../CLAUDE.md`, then
`docs/HANDOFF.md` §5 for the WeChat metrics this UI was built against and §6 for the
renderer pitfalls. This file
only adds what is specific to this layer.

## Layering

```
main.tsx              route by hash: plain = shell, #viewer = viewer, #login = login window
App.tsx               shell only (auth ready) + the ONE place that subscribes to evt:*
screens/LoginWindow.tsx  the standalone login window: chrome + its four bodies
screens/SettingsWindow.tsx  the 设置 window (`#settings`, design doc §9.11): a frameless
                         640×558 sheet with its own nav (账号与安全 / 通用 / 消息通知 / 网络与
                         代理 / 关于 — §9.11.3's order) and `components/settings/` panels; it owns
                         no shell state and repaints from `evt:theme`
screens/InstantViewWindow.tsx  即时预览's own window (`#instantview`, design doc §8.9):
                         toolbar (title, page zoom, 在浏览器打开) + `components/instant-view/
                         InstantViewPage.tsx` (the `web:instantView` fetch + RichMessage)
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
                         RichMessage (page blocks), ContactCard (vCards), PollBubble (the
                         vote/quiz card, §9.10), InlineButtons, LinkPreviewCard (a text
                         message's link preview / 即时预览 card, §8.9),
                         CommentBar (评论 N 条 handle, §9.8), ChannelMeta (a channel post's
                         views/time footer; the one-bubble channel composition is
                         styles/channel.css), PremiumStickerEffect (a Premium sticker's
                         second TGS, painted once at 1.49× the sticker and replayed on tap)
components/AlertDialog.tsx  a bot's alert answer (TDLib `callbackQueryAnswer.show_alert`) as a
                         one-button sheet; its free text keeps line breaks
lib/botCommands.ts     (pure, unit-tested) the composer's "/" trigger and the command filter
lib/useBotCommands.ts  the bot command list, asked lazily once per chat (`bots:commands`)
lib/replyKeyboard.ts   (pure, unit-tested) which message's custom keyboard a chat shows, and
                      which removal takes it away
lib/forceReply.ts      (pure, unit-tested) 强制回复: the row a bot waits for an answer to
lib/inlineQuery.ts     (pure, unit-tested) `@bot query`: the handle and the query it carries
lib/useInlineQuery.ts  inline results: 250 ms debounce, `next_offset` paging, and a stale
                      answer can never paint over a newer one
components/ReplyKeyboard.tsx  a bot's custom reply keyboard under the composer: text keys
                        send their label, request/WebApp keys are drawn but refuse (§8.3)
components/InlineResults.tsx  a bot's inline results above the composer (`@bot query`):
                        thumbnail / title / description per row, arrows + Enter, and
                        加载更多 while `next_offset` says there is more
components/composer/       ComposerCard: the ONE bordered input card (§8.4 + §9.8) — text,
                         the 表情/收藏/文件/截图/语音 tool row, 发送, the attach menu and the
                         ExpressionPicker. Both composers render it; a caller only says where
                         a send goes, so the comment box is not a cut-down copy of a chat's.
                         useVoiceRecording / VoiceControls: 语音消息's click-to-record state
                         machine and the in-card bar: cancel ×, a dotted pill and the
                         send circle whose hover reveal expands it into green 发送; 发语音
                         is the circled mic beside 发送, the tool-row mic is 语音转文字.
lib/voice/            语音消息's audio path: oggOpus.ts (pure, unit-tested — OGG pages,
                      lacing, OpusHead/OpusTags, the OGG CRC-32) and recorder.ts
                      (getUserMedia → AudioContext 48 kHz → ScriptProcessor → WebCodecs
                      AudioEncoder → muxed OGG bytes).
components/chat-pane/     render tree + useChatHistory (history/ modules) + messageActions +
                         useMarkRead (已读上报 effect) + usePeerStatus (在线/最后上线 for a
                         private chat's header) + topics/useChatTopics (话题 cursor paging,
                         搜索话题, evt:topics debounced re-read) + chat-list/TopicDialog (the
                         shared 新建/编辑话题 sheet) + topics/TopicsTabs (the chips layout a
                         has_forum_tabs forum draws above the transcript) +
                         CommentPanel (full-pane discussion view, slides in from the right;
                         chat-style rows + CommentComposer, the shared composer card posting
                         text / sticker / photo-file through messages:sendComment; non-members
                         get the official client's 加入/申请加入 gate instead; opens at the
                         top of the thread) + useCommentAnchor (that thread's
                         reading position in ui.db; the default landing is the top) +
                         ChatInfoPanel (聊天信息, §9.9: a 314 px OVERLAY sheet — transform
                         only, the transcript keeps its width — with 搜索群成员 and the
                         member grid for groups, a private chat's face opening 资料卡,
                         群聊名称 / 群公告 / 群二维码 / 添加成员 / 退出群聊 (频道
                         名称 / 频道公告 / 频道二维码 / 退出频道 on a channel, whose member
                         grid only an administrator gets — chats:canGetMembers) and the
                         shared mute/pin/clear rows; 群二维码 opens screens/QrWindow.tsx, the
                         rows live in ChatInfoRows.tsx, and the rename/invite sheets in
                         ChatInfoDialogs.tsx) + ChatInfoSearch
                         (in-panel 查找聊天内容 over search:inChat, picks a row → locate)
components/contacts/      通讯录: ContactsList (service rows + address book by initial) +
                         ContactDetail (the card)
components/picker/        the expression panel's data hooks and body components
components/ExpressionPicker.tsx  the picker's state + composition
components/settings/      the 设置 panels: SettingsNav / SettingsGroup / SettingsRow /
                         SettingsSelect + AccountPanel / GeneralPanel (通用: 外观, 消息字号,
                         关闭主窗口, 发送消息, 开机自启 — the OS login item, disabled unless
                         the build may write it) / NotificationPanel
                         (消息通知: 桌面通知 is local, the 私聊/群聊/频道 triples are TDLib's
                         scope defaults — optimistic switches that revert on a rejected
                         write) / NetworkPanel / AboutPanel (styles/settings.css holds the
                         measured tokens)
components/proxy/         ProxyForm: the one proxy form, shown by the login window's
                         modal (`ProxyPanel`) and inline by 网络与代理 — 跟随系统代理
                         (default) / 手动配置 / 不使用代理 at the top, the manual fields
                         only in 手动配置, and the panel paints `ProxyState` instead of
                         deciding which proxy is in force (that is main's job)
components/viewer/        the 图片和视频 window: MediaViewer shell + useViewerItem /
                         useViewerZoom + ViewerToolbar / ViewerGrid + viewerMenu / viewerActions
                         + VolumeControl / useViewerVolume (the player's 音量 capsule and the
                         level it stores in ui.db)
components/StickerSetBox.tsx  贴纸包盒子 (§8.5): clicking a sticker message opens its
                        set (title + ⋮ menu + grid + 移除/添加贴纸包); it fetches
                        `stickers:set` by `MessageMedia.stickerSetId` and writes
                        `stickers:changeSet` (remove / add / archive)
components/StickerCanvasLayer.tsx  the shared ThorVG canvas over a TGS sticker grid
                        (one WebGL scene, one render per frame, 30 fps); the grid
                        keeps the cells for hover/click and hides their thumbnails
                        once their animation is drawn
components/ProfileCard.tsx  资料卡: the person sheet a private chat's title and the
                        通讯录 card's 更多资料 open (简介 / 备注 only once the person is a
                        contact — TDLib answers "User isn't a contact" / 共同群聊 fetched on
                        demand / 添加或删除联系人 / 加入黑名单 / 举报 for a bot only —
                        `canBeReported` is TDLib's `chat.can_be_reported`, all through
                        `users:*`; a bot additionally draws 简介 / 命令 / 菜单 from
                        `UserProfile.bot`, and hides 备注 + 添加为联系人)
components/ReportDialog.tsx  举报: the phased reportChat state machine (reasons →
                        possibly more reasons [a bot's report does this] → maybe a
                        comment → filed), shared by the 资料卡's 举报 and the
                        message menu's (`ReportTarget` picks the channel); the reason
                        list is whatever TDLib sent, never a local shortlist, and
                        `textOptional` (`is_optional`) lets the comment be skipped
components/chat-pane/PinnedBar.tsx  置顶消息: one line above the scroller (text +
                        定位 + ×); `usePinnedMessage` owns the fetch and the calls
components/Avatar.tsx    the ONE avatar box (photo or initials); the box class it is given
                        is the positioned element, which is the rule that once cost a session
components/CustomEmoji.tsx  a Premium custom emoji in text: its sticker art at 20 px,
                        with the base glyph as the fallback
components/ChatList.tsx  the conversation column: pill (server search panel, §5.9 of
                        HANDOFF), "+" and the virtualised rows (which also page the list on
                        approach and ask for the visible rows' photos); search results are a
                        plain face in the same scroller (tabs + message rows). 已归档会话
                        is a PAGE, not a third face: ArchiveEntry (the list's own first
                        row — inside the scroller so it scrolls away with the rows, and
                        with the archive's unread total) mounts
                        `chat-list/ArchivePage.tsx`, an overlay inside this column that
                        slides in from the right over the rows (transform only — the list
                        keeps its rows and scroll position underneath) with its own
                        scroller + virtualiser, header ArchiveBar and the shared
                        `chat-list/ChatRow.tsx`; its menu item is 取消归档, and the slide
                        length is `ARCHIVE_PAGE_ANIM_MS` (`lib/archivePage.ts`, pinned by
                        `style-contract.test.ts`). 话题 (§9.12) uses the same gesture one
                        page further: while a forum is open `chat-list/TopicsSidebar.tsx`
                        covers this column with the topic list (back / search / 新建话题 /
                        row menu / flat-view toggle, `TOPICS_PAGE_ANIM_MS`), and the
                        message pane keeps showing the chosen topic
components/chat-search/ SearchTabs (聊天 / 频道) and SearchHitRow (one message hit:
                        chat face, chat title, message preview, time)
components/SearchField.tsx  the ONE search pill (label + input + optional trailing control)
components/VoiceBubble.tsx  语音消息's bubble: the client's strip — seconds as 13", the
                        waves on the other side (mirrored by side), width from the clip
                        (`lib/voiceBubble.ts`), waves pulsing while it plays; split out of
                        MediaBubble.tsx when that file reached its line cap
components/           the remaining visual concerns (Composer, MediaBubble, …)
components/Composer.tsx  a chat's send path over ComposerCard: per-chat drafts, reply /
                        edit banners, anchored-window reload, the channel's 收起 button
lib/ipc.ts            thin `window.tg` wrapper
lib/clipboard.ts      text copy for the contact card (navigator.clipboard + execCommand fallback)
lib/format.ts         time / preview / avatar helpers (pure, unit-tested)
lib/poll.ts           (pure, unit-tested) results visibility, votability, selection
                      staging, footer/mode copy, vote-restriction copy, quiz correctness,
                      whether an answer may still be changed (allows_revoting)
lib/search.ts         normalizeQuery / containsText / matchSegments — the ONE reading of a
                      search box, and the hit emphasis a result row draws
lib/useGlobalSearch.ts  the search panel's conversation hits: 260 ms debounce over
                      search:global, only the newest request may land
lib/messageSearch.ts  the search panel's hit/cursor rules (join a page to its chat
                      summaries, dedupe an appended page; pure, unit-tested)
lib/useMessageSearch.ts  cross-chat message search: one page per scope, cursor paging
                      and load-more for the active tab
lib/chatPaging.ts     (pure, unit-tested) 会话列表分页's trigger: CHAT_PAGE_SIZE (100) /
                      CHAT_LOAD_AHEAD (30) and nearListEnd — has the virtual window reached
                      the loaded end?
lib/chatAvatars.ts    (pure, unit-tested) 头像按需: the visible rows whose photo nobody asked
                      for yet
lib/useChatPaging.ts  会话列表分页: owns loading / done / the server offset and merges each
                      page through the store (the archive page uses the same hook)
lib/useChatAvatarPrefetch.ts  头像按需: coalesces the visible window into
                      chats:prefetchAvatars; the photo comes back as a chats upsert
lib/self.ts           SelfIdentity + selfIdentity(auth); one placeholder id (1000)
lib/popupPlacement.ts (pure, unit-tested) "which edge does this card hang from"
lib/mediaBox.ts       (pure, unit-tested) the reserved media box + percent text
lib/unreadBoundary.ts (type only) the snapshot a chat opens with; `UnreadMarker` is an alias
lib/listMetrics.ts    (pure, unit-tested via scripts/style-contract) the virtualised row height
lib/composerInput.ts  (pure, unit-tested) Enter / Shift+Enter / IME rule
lib/typingPing.ts     (pure, unit-tested) 对方正在输入 throttle: one ping, 3.5 s refresh,
                      cancel on empty/send/blur
lib/presence.ts       (pure, unit-tested) 在线 / 最后上线 copy for the peer-status DTO
lib/editTarget.ts     (pure, unit-tested) which edit path a row has: 编辑 (text) or
                      编辑说明 (a media caption), and the menu's word for each
lib/albumSend.ts      (pure, unit-tested) when a multi-select becomes ONE Telegram album
lib/albumLayout.ts    (pure, unit-tested) the album's geometry — tdesktop's
                      `LayoutMediaGroup` ported: aspect-ratio templates for 1–4
                      items, a row-split search for 5–10, Telegram Desktop's
                      430/100/4 px box and its proportional shrink (`resizeAlbum`)
lib/useComposerInput.ts  composition ref + textarea props, shared by both composers
lib/contacts.ts       通讯录 initial/grouping, pinyin via ICU (pure, unit-tested)
lib/entities.ts       TL entity → text segments (pure, unit-tested)
lib/mentionText.ts    (pure, unit-tested) the @usernames a plain string carries — a
                      sticker pack's title is parsed like message text, the one
                      non-message surface the official client also links
lib/useAnchoredScroll.ts  ready gate, stick-to-bottom, resize compensation
lib/scrollGeometry.ts (pure, unit-tested) the ONE "is the reader at the bottom" rule
lib/jumpSettle.ts    (pure, unit-tested) "has the jump to the newest message landed?"
lib/chatInfo.ts      (pure, unit-tested) the panel's slide length + which faces its
                     participant grid draws (members, or the conversation as the fallback)
lib/qrImage.ts       the 群二维码 window's PNG: same qrMatrix/qrDrawing the SVG uses,
                     rasterised with the quiet zone for clipboard/save/forward
lib/history.ts       (pure, unit-tested) the ONE "may this empty page be cached" rule
lib/linkPreview.ts    (pure, unit-tested) the 链接预览 card's one content-derived value: its hue
lib/media.ts          per-owner request dedupe + cancel + the media URL/progress hooks
lib/mediaVariant.ts   (pure, unit-tested) which photo size covers a box
lib/mediaPriority.ts  (pure, unit-tested) the TDLib download priority ladder
lib/emojiSound.ts     an animated emoji's click sound, fetched on the first click
styles/font.css       the @font-face for the emoji colour font (assets/fonts/
                      WeGramEmoji.ttf, built by scripts/emoji-font.py)
lib/viewer.ts         which messages become one viewer strip (pure, unit-tested)
lib/player.ts         video player-bar maths: clocks, seek clamp, progress (pure, unit-tested)
lib/tgs.ts            gzip guards + Lottie decode cache
lib/stickerCanvasWindow.ts (pure, unit-tested) a shared sticker canvas's parse and
                      release bands (two screens parse, three release)
lib/stickerMedia.ts   Sticker → MessageMedia (shared by the picker and the preview)
lib/customEmoji.ts    custom emoji ids → sticker art: one batched lookup per frame,
                      cached for the session (chunkIds is pure, tested)
lib/stickerBox.ts     (pure, unit-tested) the on-screen sticker box + the 1.49× effect box
lib/thorvg.ts         the one ThorVG WASM engine; the wasm arrives as a data: URL from
                      the virtual:thorvg-wasm module (vite-thorvg-wasm.ts) so the
                      packaged file:// renderer can load it
lib/useInView.ts      the visibility gate a sticker and its effect share (geometry first)
lib/preview-bridge.ts DEV-ONLY entry point (re-exports lib/preview)
lib/preview/          browser-preview session + invoke switch (index.ts); fixtures.ts is a
                      thin adapter over @wegram/mock-fixtures (data: URLs + gradient faces);
                      chats.ts / messages.ts / comments.ts / qr.ts / media.ts / ui.ts /
                      viewer.ts hold the handler rules the invoke switch delegates to
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
  mid-slide. `ArchivePage` is the same pattern inside the conversation column
  (`ARCHIVE_PAGE_ANIM_MS`), including the auto-close when the archive empties.
  `ChatInfoPanel` follows the same two rules, and it is an **overlay**:
  `translateX(100% → 0)` only. Never give it a width animation to "push" the chat — the
  owner's reference presses the sheet on top of the messages, and a width animation
  re-lays-out every virtualised row on every frame (an earlier version did, and was
  wrong). `INFO_PANEL_ANIM_MS` is pinned to the stylesheet by
  `style-contract.test.ts`. A channel reuses the group panel; its member block is
  administrator-only, so the panel asks `chats:canGetMembers` (`supergroupFullInfo.
  can_get_members`) and draws 搜索群成员 + the grid only when that answers true — a
  subscriber would otherwise see the channel's own face pretending to be a member.
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
- **A list that opens at `scrollTop 0` gets no scroll event, so "load more at the top"
  never fires.** The comment panel lands on the oldest comment of the *newest* page
  (`getMessageThreadHistory` answers newest-first, so that row is not the thread's first
  one); a wheel up cannot move the list, `onScroll` never runs, and the older page was
  only fetched after the reader scrolled *down* — measured as "向上滑没反应,往下滑一下上面
  才加载出来". `CommentPanel.topUpAbove` therefore runs after the landing and after every
  prepend, while the list is still within `LOAD_OLDER_AT` of the top (one page, like the
  transcript's `prefetchOlder`), and the prepend compensation leaves the reader on the
  same row. A failed older page must keep the rows already on screen and put its 重试
  line above them — an error that replaces the list throws away the comments the reader
  was reading.
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
  `openViewer` prefers it over the store. **即时预览 is the same rule one step further**: its
  page's pictures are blocks, not messages, so there is no row to look up — the page
  folds its `media`/`gallery` blocks into a `ViewerItem` strip (`lib/instantViewMedia.ts`)
  and provides it through `PageViewerSource`; `MediaBubble` resolves the click by file id
  and `viewer:open` carries **no** `chatId`, which is what makes 定位到聊天位置 say
  「这条媒体不来自聊天」 instead of opening conversation 0.
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
  `styles/index.css` header and `docs/HANDOFF.md` §5.2). Do not rename a class, and
  do not hard-code a colour — every colour comes from the `:root` block.
- **Emoji are a font, not images, and its cmap is deliberately incomplete.**
  `--wx-font` starts with `WeGram Emoji` (CBDT, `styles/font.css`), so bubbles, the
  picker and the textarea all paint Apple artwork; there is no `<img>` path to keep
  in sync. ASCII digits, `#` and `*` are kept out of the font's cmap on purpose: with
  the family first they would resolve to the font's blank keycap component and a
  number in a message would disappear. Never "fix" that by adding digits back — it
  breaks every number in the transcript. Rebuild with `scripts/emoji-art.py` then
  `scripts/emoji-font.py`, and treat the two as one change.
- **A failed send must stay visible without hovering.** 未发送 is drawn as its own
  row button (`.wx-message__retry`), not inside the opacity-0 meta line: a failed row
  that looks delivered is the bug the marker exists to prevent. The 重试 action is also
  the first item of the message menu, gated on `canRetry`.
- **对方正在输入 is throttled in `lib/typingPing.ts`, and its IPC call never raises an
  error.** One ping, one refresh per 3.5 s, cancel on empty / send / blur / chat switch.
  Do not move the throttle into the composer's onChange or add a per-keystroke call.
- **置顶消息 sits OUTSIDE the scroller.** The bar is a sibling above the virtualised
  list, never a row inside it: anything inside re-measures rows and moves the reader.
  Both the bar's × and the menu's 取消置顶 send `messageId: null`, so the adapter
  resolves the current pin (`unpinChatMessage` wants an id).
- **语音转文字 is a content update, not a request answer.** `messages:transcribe` only
  asks (`recognizeSpeech` answers `Ok` at once); the pending and final text arrive as
  the voice note's content changing, so the row repaints through a `replace` op and
  the transcript block draws what `Message.transcription` says. Never poll.
- **机器人按钮要回答问题,命令走发送路径.** `InlineButtons` posts a callback button's payload through
  `bots:callback`; the bot's answer becomes a toast, an `AlertDialog` (`show_alert`) or an opened
  URL, and a `password` button refuses with a toast because there is no 2FA prompt to ask with.
  A `botCommand` entity and the composer's "/" list both send through the existing send path
  (`messageActions.send` / the composer's own submit) — never a second `messages:send` call site.
  **The custom reply keyboard belongs to a message, not to the chat.** `lib/replyKeyboard.ts`
  takes the newest row that carries one (an ordinary reply does not clear it), a one-time
  keyboard is hidden by remembering that row's id in `ChatPane` — never by a per-chat flag —
  and its text keys take the same send path. A request/WebApp key is drawn dimmed and must
  never post its label as a message. The keyboard ends in three ways only: a newer keyboard,
  the one-time hide above, and `replyKeyboardHidden` (TDLib `replyMarkupRemoveKeyboard`) — the
  removal row carries no keyboard at all, so it must be its own marker or the older grid stays
  forever. **强制回复** (`Message.forceReply`) is `lib/forceReply.ts`'s decision: walking backwards,
  the marker means "an answer is still owed" and an outgoing row means "already answered"; the
  pane then sets that row as the reply target (the ordinary 回复 banner) and remembers a cancel
  by chat + message id so it does not reappear. Its placeholder outranks the keyboard's.
  **inline 机器人 is the same "derived from the box" rule**: `lib/inlineQuery.ts` decides when
  the text is `@bot query` (the message must *start* with the handle), the panel's rows come
  from `bots:inlineQuery` and never from the transcript, and picking one posts
  `bots:inlineSend` → the bot's own message, then clears the box. Both popovers take keys
  through the composer's ONE interceptor (`commandKeys || inlineKeys`); they can never be open
  together, because `/` and `@` are different first characters.
- **表情回应 are displayed, never offered.** `MessageRow` draws the chips from
  `Message.reactions` (`updateMessageReactions` replaces the whole list, so the
  `reactions` op replaces rather than merges); a custom-emoji reaction is its
  sticker art by int64-id string. WeChat has no reactions, so there is no picker
  until the owner signs one off — do not add a tap-to-react gesture before that.
- **发语音 is the circled mic beside 发送; the tool-row mic is 语音转文字.**
  Measured on the client: clicking the toolbar mic starts dictation and drops
  recognised text into the box (we have no ASR, so it stays a placeholder),
  while clicking the circled mic starts a clip at once — no push-to-talk, no
  separate voice mode. `useVoiceRecording` then turns the right cluster into the
  recording bar (cancel ×, dotted pill, green send circle), and keeps the session
  in a ref because
  `getUserMedia` and the encoder start asynchronously: a send or cancel pressed
  in that first moment is stored as `want` and applied when the recorder lands.
  Keep the clip on the base64 OGG IPC path (the renderer has no filesystem) and
  keep `lib/voice/oggOpus.ts` pure and tested — Chromium cannot record OGG, so
  the container is written here, not by a library. The recording bar is one
  button with two layers: a grey pill with the dots and a green send circle at
  its right end, and a 120 ms `clip-path: circle()` reveal that **only the circle**
  starts (hovering the empty part of the pill does nothing) and that turns it into
  the green 发送 bar — both layers inside the same button, or the expansion would
  swallow the click. The bubble is `components/VoiceBubble.tsx`: 13", width from
  `lib/voiceBubble.ts`, waves on the side the client puts them — never a play
  triangle plus a drawn waveform.
- **标为未读 is a dot, not a count.** `ChatSummary.markedUnread` draws a bare
  `.wx-badge--dot` when `unread` is 0; opening the chat clears the flag (the adapter
  does it). Do not render it through the count badge.
- **The peer-status line is part of the title, in the same 48 px header**, and typing
  wins over it when both exist; a second header row would move the transcript.
- **编辑 vs 编辑说明 is `lib/editTarget.ts`'s decision, not the menu's.** TDLib's
  `can_be_edited` covers `editMessageText`, `editMessageCaption` and the reply markup,
  so the flag alone would offer 编辑 on a poll (where it means "stop it") or on a
  sticker (an emoji, not a caption). A caption row also saves through its own channel
  and may legitimately save an empty box — it removes the 说明.
- **A sticker grid is one ThorVG canvas, never N lottie players.** A pack is ~120
  TGS; lottie-web gives each playing sticker its own SVG tree, which is what used to
  jank. The 表情 panel's set body and the 贴纸包盒子 render TGS cells through
  `StickerCanvasLayer` + `@thorvg/webcanvas` (one WebGL scene, one `render()` per
  frame, 30 fps); the cells stay in the DOM for hover/click and their thumbnails are
  hidden only once their animation exists. A TGS cell under the canvas passes
  `preview` so it never mounts a second lottie. Parsing is viewport-driven
  (`lib/stickerCanvasWindow`: two screens each way), two at a time and with a
  main-thread yield between parses, and parsing waits for the scroll to settle —
  painting keeps running at 30 fps while scrolling (plus one immediate frame per
  newly visible cell), because a cell that scrolls into view has no pixels until
  the shared canvas draws it. Off screen a sticker is only paused; three screens
  away its scene is released **after
  its last painted frame is saved into the cell** (desktop's `savedFrame`), so a
  revisit shows that still image while the animation is parsed again — never a
  thumbnail flash and never a per-frame rebuild. Closing the panel (or opening
  another set) unmounts the layer and disposes everything. Parsing the whole pack in
  one burst and advancing all of it every frame is what made scrolling a pack
  stutter. The layer downloads through
  `lib/media`'s leases with **one owner per sticker** (`ensureMedia` holds one
  file per owner, so a shared owner would cancel the previous transfer): a reopened
  grid reuses the cached `wx-media://` URLs, and closing the box releases its
  owners, which cancels a pack nobody is waiting for any more. WebM cells are the
  exception — ThorVG does not decode video — so their `<video>` auto-plays while
  the cell is inside the panel's scroller (a 0 px `useInView`, whose root is the
  nearest scroll container, not the window). No looping `StickerRenderer` for TGS in
  a grid; the transcript is the one place where per-sticker lottie-web is correct
  (a screenful is a handful of stickers), with `setSubframe(false)` and a `once`
  animation staying mounted so scrolling back does not replay it.
- **The ThorVG wasm is a data: URL on purpose.** `vite-thorvg-wasm.ts` reads the
  installed package's `thorvg.wasm` and emits it behind `virtual:thorvg-wasm`;
  Electron's packaged renderer loads from `file://`, where Emscripten's fetch of a
  sibling .wasm fails. That is also why the CSP carries `'wasm-unsafe-eval'`. A grid
  that cannot initialise falls back to thumbnails + the per-cell hover animation
  (`loadThorvg()` tries WebGL, then ThorVG's software renderer), so never let a failed
  `loadThorvg()` break the panel.
- **话题的 transcript 属于一个 chat + topic 对,不是属于 chat.** `historyTopicByChat`
  says which topic `messagesByChat[chatId]` holds; the pane draws a loading state
  while it does not match the selected topic. Do not "fix" a stale transcript by
  deleting the rows in `setActiveTopic` — that left the store empty while the query
  cache still had a page, and a reopened forum sat on "not synced". And remember
  `lib/query.ts` is `staleTime: Infinity`: a query that reuses its key for another
  topic needs `staleTime: 0` (focus/reconnect refetch off) or it will never fetch
  again after `enabled` flips back on.
- **A switch only animates a click.** `Switch` carries `is-static` until the reader
  clicks it (the stylesheet keeps that class transition-free): a panel that paints a
  switch before its read answers — `desktop === true`, `mode ?? 'system'` — used to mount
  it off, flip it a frame later and *animate* the correction, which read as the client
  changing a setting by itself. Panels that must read first should not draw the control
  at all until the answer lands.
- **消息字号 moves the bubble, never the root font.** The step is written by the
  shell to `<html data-msg-size>` and reaches the transcript through
  `--wx-msg-scale` (`tokens.css`); `:root { font-size }` would also grow the chat
  list, the timestamps and the composer, which the client does not do. Rich
  blocks (and `RichMessage`'s `SECTION_SIZE`) are `em` on purpose so one step
  reaches a Telegram "page" too, and the virtualiser's `measureElement` is what
  re-measures the rows — do not add a manual `measure()`.
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

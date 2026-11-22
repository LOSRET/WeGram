# Private chat (1:1) — gap audit and handoff

Written 2026-11-22 against `bf8b183` (branch `main`, clean tree). This is a
**code-level audit + TDLib API check**, not a runtime pass: the app was not
launched, no account was touched, and no write path was exercised. Every
"missing" below was confirmed by reading the code; every API name and field by
reading the TDLib 1.8.70 API scheme pinned by the installed `prebuilt-tdlib`.

Use this document as the entry point for a session that will implement
private-chat gaps. If it is not already in context, read `CLAUDE.md` first, then
`docs/HANDOFF.md`, then the layer note for the directory you touch
(`packages/protocol/AGENTS.md`, `apps/desktop/src/main/AGENTS.md`,
`apps/desktop/src/renderer/AGENTS.md`). `docs/UI-HANDOFF.md` is required for
anything visual.

## TL;DR

- The 1:1 path already works for text, stickers, photo/file, replies, edits,
  delete/revoke, forward, read receipts, **incoming** typing, local drafts,
  mute/pin/clear, in-chat text search and the media viewer.
- The five gaps that make a messenger feel unfinished are all small:
  **send-failure state + retry**, **outgoing typing**, **online/last-seen**,
  **delete chat / mark unread**, **desktop notifications**.
- Next tier: **voice notes**, **reactions**, **peer profile card**
  (bio / note / common groups / block / report), **album send**, **caption edit**,
  **translate**, **shared-media tabs**, **pinned-message bar**.
- Calls and secret chats stay out of v1. However, the design doc's reason for
  calls ("TDLib does not expose them") is **wrong for 1.8.70** — the signaling
  API exists. The real blocker is the media stack. See §10.
- Every P0/P1 API below already exists in the pinned TDLib. No upgrade is needed.

## Status — P0 implemented (2026-11-22)

All five P0 rows in §3 are implemented; §5's recipes are what was followed.

| Gap | Landed in | Notes |
|---|---|---|
| Send failure + 重试 | `Message.sendingState/sendError/canRetry`; ops `sendState` / `replaceId`; `updateMessageSendSucceeded` / `Failed`; `messages:resend`; 未发送 row action | The id swap is real: a pending id is re-keyed in place through `replaceId`. Mock: `WEGRAM_MOCK_FAIL_SEND=1` fails the next send once. |
| Outgoing typing | `messages:typing`, `actions/send.ts sendTyping`, `lib/typingPing.ts` (3.5 s refresh, cancel on empty/send/blur/unmount) | Failures swallowed by design. |
| Online / last seen | `users:status` + `evt:status`; `map/status.ts`; `lib/presence.ts`; header line | Open decision #1 resolved: after the name inside the 48 px header (typing wins). `ChatSummary.peerStatus` was not needed; contacts' status is still P1. |
| 删除聊天 / 标为未读 | `chats:delete`, `chats:setUnread`; `ChatSummary.markedUnread`; chat-list right-click menu; dot | 删除聊天 = `deleteChatHistory(remove_from_chat_list: true, revoke: false)`; opening clears the flag. |
| Notifications / tray | Adapter `notification` event from `updateNotification` + `updateNotificationGroup`; `main/notifications.ts`; `main/tray.ts`; `ui:setActiveChat` suppression; click → `evt:locate` | Open decision #4 resolved: TDLib's own notification stream (it applies mute/mention/preview rules), title + preview. Tray is best-effort. |

Decisions from §9 that this batch settles: (1) status placement = header second line;
(3) 删除聊天 stays local; (4) notifications = TDLib's stream with title + preview.
(2) reactions, (5) voice notes and (6) calls are untouched — still P1 / scope-out.

Verification: `pnpm verify` green; mock Electron click-through covered the menu, the
unread dot, the status line and the failed-send retry. **No test DC was available in
this session**, so every TDLib write these features call (`sendChatAction`,
`resendMessages`, `deleteChatHistory`, `toggleChatIsMarkedAsUnread`) is
compile- and mock-verified only — run `pnpm tdlib:test-dc` before calling them
proven. Windows toasts and the tray icon could not be confirmed on this machine (see
`docs/HANDOFF.md` → "Private-chat P0 batch — measured notes").

## Status — P1 implemented (in progress, 2026-11-22)

Working through §6 in the order that needs no product decision first. Each row
below is one commit, `pnpm verify`-green, on `feat/private-chat-p1`.

| Gap | Landed in | Notes |
|---|---|---|
| 相册发送 | `media:sendAlbum`; `sendMessageAlbum` in `actions/send.ts`; `lib/albumSend.ts`; `components/Composer.tsx` attach path | 2–10 photos in ONE call, answered as `Messages`; every row carries the album id, so the transcript folds them into the bubble it already draws for a received album. The rule for when that applies (photos only, 2–10) is pure and tested; a document selection still sends one message per file, because `rows.ts` only folds photo/video. Mock adapter gets an album builder that shares one `media_album_id`; the browser preview cannot send files at all (no local path), so it refuses like `media:send`. |
| 图片说明编辑 | `messages:editCaption`; `editMessageCaption` in `actions/send.ts`; `lib/editTarget.ts`; menu 编辑 / 编辑说明 | The row's kind picks the call (`can_be_edited` covers both): text edits go through `editMessageText`, media captions through `editMessageCaption`. `show_caption_above_media` is read back with `getMessage` first, so an edit never moves a caption from above the picture to below it. An empty caption clears it (the composer allows an empty save only on that path). Mock + browser preview both implement it. |

## 1. What already works (do not rebuild it)

| Capability | Implementation |
|---|---|
| Chat list, private chat creation from 通讯录 | `actions/chats.ts` (`openPrivateChat` → `createPrivateChat`), `contacts:list` |
| History first page / older / around / newer | `actions/history.ts`, `messages:history` / `messages:around` / `messages:newer` |
| Read marker follows the viewport; read receipts | `messages:read` → `viewMessages`, `lib/readGate.ts`, `MessageRow` 已读/未读 |
| Send text / reply | `actions/send.ts` `sendText`, `actions/message-input.ts` `replyTo` |
| Send photo / file (with progress) | `actions/send.ts` `sendMedia` + `mediaContent`, `wx-media://` |
| Send sticker / emoji picker | `sendSticker`, `components/ExpressionPicker.tsx` |
| Edit text, delete, 撤回, forward, copy text | `actions/send.ts`, `messageActions.ts`, `message-list/menu.ts` |
| Incoming typing (expires) | `updates.ts` `updateChatAction`, `App.tsx` timers, `ChatHeader` |
| Drafts (local only) | `Composer.tsx` + `ui:saveDraft` / `ui:getDraft` |
| 免打扰 / 置顶 / 清空 | `setChatMuted` / `setChatPinned` / `clearHistory` |
| 聊天信息 panel (private layout) | `ChatInfoPanel.tsx`: peer face + name, 查找聊天内容, 免打扰, 置顶, 清空 |
| In-chat text search | `search:inChat` → `ChatInfoSearch.tsx` |
| Media viewer window, save/copy | `main/viewer.ts`, `renderer/components/viewer/` |
| Service messages incl. call logs | `map/service.ts` (missed/declined/duration copy) |

Private-specific invariants that must not regress: opening a chat does **not**
mark it read (`actions/chats.ts` `openChat` comment), `messagesByChat` entries
are created only by `setHistory`/`prependHistory`, and ops for an unloaded chat
are queued in `pendingOps` and replayed by `setHistory`.

## 2. API source of truth

- `apps/desktop/package.json` → `prebuilt-tdlib: 0.1008070.0`. That package's
  metadata says `tdlib.version: 1.8.70`, `tdlib.commit:
  c8828d50f5eac2fc7089ce1089d7ce9095c61b5e`.
- The matching scheme is the authority for names, fields and comments:
  [td_api.tl @ c8828d5](https://github.com/tdlib/td/blob/c8828d50f5eac2fc7089ce1089d7ce9095c61b5e/td/generate/scheme/td_api.tl).
  Fetch it to the gitignored `.cache/` and grep it instead of trusting memory:

```powershell
Invoke-WebRequest -UseBasicParsing `
  -Uri 'https://raw.githubusercontent.com/tdlib/td/c8828d50f5eac2fc7089ce1089d7ce9095c61b5e/td/generate/scheme/td_api.tl' `
  -OutFile '.cache/td_api.tl'
```

- Read the `//@description` block above a constructor, not just the signature.
  Three examples that change an estimate: `inputVoiceNote` requires Opus in an
  OGG container; `inputVideoNote` requires MPEG4/H.264 and `length <= 640`;
  `messageSchedulingStateSendWhenOnline` and `messageSendOptions.effect_id`
  are valid in private chats only.
- If TDLib is upgraded later, re-run the audit against the new commit. The seam
  will typecheck even when a field was renamed, because `actions/` talks in
  `TdObject`.

## 3. Gap inventory

Legend: **P0** daily use, **P1** next, **P2** later, **scope-out** decided
against (see §9/§10). "Size" is implementation + mock + tests + verification in
person-days, for this repo's conventions.

| P | Gap | Current state | TDLib 1.8.70 API (verified) | Size |
|---|---|---|---|---|
| P0 | Send failure state + 重试 | `sendMessage` answer is applied as final; `updates.ts` has no `updateMessageSendFailed`; `Message` has no `sending_state`; `localId` is minted by `sendAndMap` but **no renderer reads it** | `updateMessageSendFailed`, `updateMessageSendSucceeded`, `messageSendingStateFailed`, `resendMessages` | 1–2 |
| P0 | Outgoing typing | Incoming handled; **0 calls** to `sendChatAction` anywhere | `sendChatAction` + `chatActionTyping` / `chatActionCancel` | 0.5 |
| P0 | Online / last seen | No field, no update handler, no UI slot | `user.status`, `updateUserStatus`, `userStatusOnline/Offline/Recently/LastWeek/LastMonth` | 0.5–1 |
| P0 | 删除聊天 / 标为未读 | Only 清空, and it passes `remove_from_chat_list: false`; no mark-unread | `deleteChatHistory(remove_from_chat_list, revoke)`; `toggleChatIsMarkedAsUnread` + `updateChatIsMarkedAsUnread` | 1 |
| P0 | Desktop notifications / tray | No `updateNotification*`, no `Notification`, no tray | `updateNotificationGroup`, `updateNotification` | 2–3 |
| P1 | Voice message recording/send | Toolbar entry only toasts 还没有接入 | `inputMessageVoiceNote` + `inputVoiceNote` + `chatActionRecordingVoiceNote` | 3–5 |
| P1 | Reactions | Not in DTO, no renderer, no updates | `addMessageReaction` / `removeMessageReaction` / `setMessageReactions`, `getMessageAvailableReactions`, `updateMessageReactions`, `interaction_info.reactions` | 2–3 |
| P1 | Peer profile card | Chat title/avatar not clickable; `ContactDetail` 更多资料/备注 are placeholders; panel face is a plain `div` | `getUserFullInfo` (bio, note, `group_in_common_count`, `block_list`, `can_be_called`), `getGroupsInCommon` | 2–3 |
| P1 | Block / unblock | No entry point | `setMessageSenderBlockList` (pass `null` to unblock), `getBlockedMessageSenders` | 1 |
| P1 | Report chat / message | No entry point | `reportChat` (two-phase: empty `option_id` first), `chat.can_be_reported`, `messageProperties.can_report_chat` | 1 |
| P1 | Add / remove contact, 备注 | 通讯录 is read-only (`getContacts` only); 添加备注名 placeholder | `addContact` + `importedContact`, `removeContacts`, `setUserNote`, `userFullInfo.note` | 2 |
| P1 | Album send | ~~Multi-select sends N separate messages~~ — **done**, see the P1 status table | `sendMessageAlbum` (returns `Messages`) | 1–2 |
| P1 | Caption edit | ~~Edit menu is gated to `kind === 'text'`~~ — **done**, see the P1 status table | `editMessageCaption` | 0.5–1 |
| P1 | Speech-to-text | None | `recognizeSpeech` + `can_recognize_speech` + `speech_recognition_result` | 1 |
| P1 | Pinned message bar | `getChatPinnedMessage` is used for 群公告 only; private chats skip it | `pinChatMessage` / `unpinChatMessage` + `can_be_pinned` | 1 |
| P2 | Location / venue / live location / contact card / poll / dice **sending** | Received as plain text / contact card; no send path | `inputMessageLocation`, `inputMessageLiveLocation`, `inputMessageVenue`, `inputMessageContact`, `inputMessagePoll`, `inputMessageDice` | 2–4 |
| P2 | Message effects | None | `getMessageEffect` + `messageSendOptions.effect_id` (private chats only) | 1–2 |
| P2 | Scheduled / silent send | None | `messageSchedulingStateSendAtDate`, `messageSchedulingStateSendWhenOnline`, `disable_notification` | 1–2 |
| P2 | Shared media / search filters | Text search only | `searchChatMessages(filter: searchMessagesFilterPhoto/Video/Document/Url)` | 1–2 |
| P2 | Archived chats | `listChats` asks `chatListMain` only; search too | `chatListArchive`, `getArchiveChatListSettings` | 2–3 |
| P2 | Draft cloud sync | Local `ui.db` only | `setChatDraftMessage` + `updateChatDraftMessage` | 1–2 |
| P2 | Multi-select / batch forward / forward-as-copy | One message at a time | `forwardMessages` array + `messageCopyOptions` | 2–3 |
| P2 | Translate | None | `translateText` | 1 |
| P2 | Chat background / theme | None | `setChatBackground`, `setChatTheme` | 2 |
| P2 | Screenshot / 收藏 (WeChat shell) | Placeholders | Electron `desktopCapturer`; 收藏 can map to Saved Messages | 1.5 |
| scope-out | 1:1 voice/video calls | Header buttons permanently disabled | `createCall` / `acceptCall` / `discardCall` / `callStateReady` / `updateNewCallSignalingData` | weeks |
| scope-out | Secret chats | v1 out of scope | `createNewSecretChat` exists; E2E behavior not verified here | weeks |

Notes that move an estimate:

- **Voice notes are not "a button".** TDLib wants Opus in OGG (single channel);
  Chromium's `MediaRecorder` reliably emits WebM/Opus. Either find a
  Chromium build that emits `audio/ogg;codecs=opus` (spike it in Electron 45),
  or mux WebM/Opus → OGG (a new dependency needs the owner's approval), or send
  MP3/M4A and accept that it arrives as a regular audio message, not a voice
  note. Also add a mic permission handler in main (`session.setPermissionRequestHandler`).
- **Round video notes** need MPEG4/H.264 ≤ 640 px. Chromium recording support for
  MP4/H.264 must be spiked before this is scheduled.
- **Reactions** and **online status** have no WeChat counterpart, so they are
  product decisions as much as engineering ones.
- **Notifications** must come from TDLib's notification API, not from
  `updateNewMessage`, or mute/mention rules will be wrong.

## 4. Recipe: adding one new send type (the pattern for most P1 items)

Follow the layers in order; each step is a compile error until the next is done,
which is the point.

1. **Protocol first** — `packages/protocol/src/channels.ts` (channel + zod
   request/response), or the domain module it spreads (`chat.ts`, `poll.ts`,
   `comment.ts`, `search.ts`). New `Message` fields go in `dto.ts`; if
   `dto.ts` or `channels.ts` approaches the 550-line budget, split a module
   (`user.ts`, `reaction.ts`) instead of growing them.
2. **Adapter seam** — `packages/adapter-contract/src/adapter.ts`: the method and
   any event. Both adapters must implement it in the same batch.
3. **TDLib action** — `apps/desktop/src/main/telegram/tdlib/actions/<domain>.ts`,
   re-export from `actions/index.ts`, bind in `tdlib/index.ts` (or
   `chat-api.ts` for chat-domain methods). Outgoing messages should start from
   `message-input.ts` `sendAndMap` and a content builder next to `mediaContent`
   / `stickerContent`.
4. **Mock adapter** — `packages/mock-adapter/src/` (the seam typecheck forces
   this). Keep pure rules in `packages/mock-session` when the browser preview
   needs the same behavior.
5. **Browser preview** — `apps/desktop/src/renderer/src/lib/preview/index.ts`
   invoke switch plus `preview/messages.ts` / `chats.ts`; typed against the
   same protocol.
6. **Renderer** — composer/menu/panel entry, store op handling
   (`store/reducers.ts` `reduceOps` **and** the `pendingOps` replay path in
   `setHistory`), then the component.
7. **Tests** — a pure rule (formatting/geometry/gating) gets a `lib/*.test.ts`;
   an action gets the fake-invoke pattern in `tdlib/actions*.test.ts`.
8. **Docs** — the layer `AGENTS.md`, `docs/HANDOFF.md` and this file's status.
9. **Verify** — `pnpm verify` (lint → typecheck → test → build). Then mock
   Electron for UI, and **test DC for any write path**.

Adding an event/update instead: `AdapterEvent` in `adapter.ts`, `telegram/events.ts`
mapping, `eventChannels`/`eventSchemas` in `channels.ts`, subscriber in
`App.tsx`, store slice. Every event is wrapped in `envelope(seq)`.

## 5. P0 deep dives

### 5.1 Send failure + retry (do this first)

Why it matters: `sendMessage` returns before the server has acknowledged the
message. TDLib reports the final state later as
`updateMessageSendSucceeded` (with a possibly different id) or
`updateMessageSendFailed` (error + `can_retry`). The app currently maps the
first answer and ignores both updates, so an offline send looks identical to a
delivered one, and a failed message can never be retried.

Steps:

1. **Verify the id swap on the test DC before designing the op.** `HANDOFF.md`
   says the swap is cosmetic, but the same document's test-DC measurement
   (`td-5242881` → `6291456`) says otherwise. Log the id returned by
   `sendMessage` and the `old_message_id` of `updateMessageSendSucceeded`.
   This decides whether a row must be re-keyed.
2. DTO: `Message.sendingState?: 'pending' | 'failed'`, `sendError?: string`,
   `canRetry?: boolean`; map from `message.sending_state`
   (`messageSendingStatePending` / `messageSendingStateFailed`).
3. Ops: `op: 'state'` for failures, and either `op: 'replace'` plus a re-key
   op (`op: 'replaceId', oldId, message`) or a full `setHistory` resync if the
   swap turns out to be rare. Handle both in `reduceOps` and in the
   `pendingOps` replay.
4. Update handler: `updateMessageSendSucceeded` /
   `updateMessageSendFailed` / `updateMessageSendAcknowledged` in
   `updates.ts`, emitting the new ops.
5. New channel `messages:resend` → `resendMessages`; gate on `can_retry`
   and `retry_after`.
6. UI: a small 未发送 mark on the row (red dot like WeChat) and a 重试 action in
   the message context menu; tapping retries.
7. Mock: a dev-only way to force one failed message (fixture flag), so the
   renderer path is testable without the network.

Acceptance: with the test DC, disconnect the proxy (or use an invalid chat) →
the row shows 未发送; reconnect → 重试 delivers it; the id in the store matches
the id later used by edit/delete.

### 5.2 Outgoing typing

Incoming typing already works; the other side never sees ours.

- Renderer calls a new `messages:typing` channel while composing (typing, not
  per keystroke); main throttles to one `sendChatAction` per ~3.5 s per chat
  and sends `chatActionCancel` on send, blur, Esc or emptying the box.
- Put the throttle in a pure module (e.g. `main/telegram/tdlib/typing.ts` with a
  test), or a renderer `lib/typingPing.ts`; do not scatter timers.
- Private chats only for the first cut. Group typing exists but WeChat shows the
  sender's name; `updateChatAction` already delivers `sender_id`, the header
  just ignores it.
- Never throw from this path: a failed typing action must not surface an error
  bar.

### 5.3 Online / last seen

- `user.status` is on the basic `user` object; `updateUserStatus` carries
  changes. Add a `PeerStatus` DTO (online / offline+was_online / recently /
  lastWeek / lastMonth) and a pure `formatPeerStatus(status, now)` with Chinese
  copy (在线 / 刚刚在线 / 最后上线 昨天 21:04 / 一周内上线 …).
- Where: `ChatSummary.peerStatus` for the open private chat, and
  `Contact.status` for the address book. Do not persist it in `ui.db`.
- `by_my_privacy_settings` means **your own** `userPrivacySettingShowStatus` hides
  the exact time (non-Premium); keep the coarse copy instead of inventing a
  timestamp.
- **Placement is a product call**: WeChat has no such line in a 1:1 header. Put
  it in the profile card, or under the title with a reserved line so the header
  never jumps.

### 5.4 删除聊天 vs 清空, and 标为未读

- WeChat's 删除聊天 is local. **Do not call `deleteChat`**: TDLib's
  `deleteChat` deletes the history for *all* members. Use
  `deleteChatHistory` with `remove_from_chat_list: true, revoke: false`, then
  drop the row with `{ op: 'remove' }`. Keep 清空 as the current
  `remove_from_chat_list: false` call.
- `toggleChatIsMarkedAsUnread` is a boolean flag, not `unread_count`;
  `updateChatIsMarkedAsUnread` keeps it live. The chat row then needs a dot
  (not a count); the open action must clear the flag, so verify whether TDLib does
  that on view or whether the client has to call `toggleChatIsMarkedAsUnread`.
- The chat list has **no context menu at all** today. Add right-click
  (置顶 / 免打扰 / 标为未读 / 删除聊天) using the existing `ContextMenu`
  component — this is also where the two actions above become discoverable.

### 5.5 Desktop notifications, tray, badge

- Subscribe to `updateNotificationGroup` / `updateNotification` rather than
  deriving notifications from `updateNewMessage`: TDLib already applies the
  chat's mute state, mention rules and preview privacy. `notification` carries
  `id/date/is_silent/type`; `notificationTypeNewMessage.message` carries the
  chat and message; the group carries `chat_id`.
- Main builds an Electron `Notification` (title = chat title, body = preview),
  and on click focuses the shell and opens the chat at that message. That needs
  a main → renderer event (`evt:openChat` with `chatId` + optional
  `messageId`), since the renderer owns the active chat.
- Unread/attention: check Electron 45's Windows support before choosing between
  `win.setOverlayIcon`, `win.flashFrame` and `app.setBadgeCount` (the last is
  documented for macOS/Linux). A tray icon is optional but expected on Windows.
- Do not notify for the chat that is currently focused and visible.

## 6. P1 deep dives

### 6.1 Voice notes

- Content: `inputMessageVoiceNote { voice_note: inputVoiceNote, caption,
  self_destruct_type }`; `inputVoiceNote { voice_note: InputFile, duration,
  waveform }`.
- Format: Opus in OGG, one channel (MP3/M4A is accepted but arrives as audio,
  not a voice note). Solve the Chromium encoding question first (§3 notes).
- Waveform is 5-bit packed samples; TDLib may accept an empty `waveform` — check
  before building a waveform renderer (the current bubble's waveform is
  decorative).
- While recording, send `chatActionRecordingVoiceNote`; stop on send/cancel.
- Playback already exists (`kind: 'voice'`, `MediaBubble`); do not add a second
  player.
- Mic permission: Electron main must allow `media` for the renderer
  (`session.setPermissionRequestHandler`), and the permission must not leak to
  other windows.

### 6.2 Reactions

- Read: `message.interaction_info.reactions` (`messageReactions` with
  `reactions[]`, `are_tags`, `can_get_added_reactions`) and
  `message.unread_reactions`. The mapper currently reads only
  `view_count/forward_count/reply_info` and drops reactions.
- Write: `addMessageReaction` / `removeMessageReaction` (or
  `setMessageReactions` with the complete list). Query what the chat allows with
  `getMessageAvailableReactions`. `ReactionType` is `reactionTypeEmoji` or
  `reactionTypeCustomEmoji` (int64 id → string in the DTO, same rule as custom
  emoji entities).
- Updates: `updateMessageReactions` (full list) and `updateMessageReaction`
  (delta). Emit a `reactions` op; do not remap the whole message.
- DTO: `Message.reactions?: MessageReaction[]` + `canSetReactions`; new
  `packages/protocol/src/reaction.ts` if `dto.ts` is at budget.
- UI: a chip row under the bubble (count + chosen state), a picker on hover /
  long-press. **WeChat has no reactions** — get the owner's sign-off; a sensible
  first cut renders received reactions but does not offer a picker.
- Mock fixtures need reactions on at least one private message; tests cover
  count formatting and the chosen state.

### 6.3 Peer profile card, note, block, report, add contact

- Data: `getUserFullInfo` gives `bio`, `note`, `group_in_common_count`,
  `block_list`, `can_be_called`, `supports_video_calls`,
  `need_phone_number_privacy_exception`; `getGroupsInCommon` lists the shared
  groups; `setUserNote` writes 备注 (the Telegram note is cloud-synced, unlike
  WeChat's local remark).
- Block: `setMessageSenderBlockList { sender_id: messageSenderUser, block_list:
  blockListMain }`; pass `null` to unblock. Read the current state from
  `userFullInfo.block_list` or `getBlockedMessageSenders`.
- Report: `reportChat` is two-phase. Call it with an empty `option_id`; TDLib
  answers `reportChatResultOptionRequired { title, options }`; call again with
  the chosen `option_id` (and optionally `message_ids` / `text`). Gate the
  entry on `chat.can_be_reported` / `messageProperties.can_report_chat`.
- Add/remove contact: `addContact` with `importedContact { phone_number,
  first_name, last_name, note }` (phone may be empty when known) and
  `share_phone_number`; ask first when
  `need_phone_number_privacy_exception` is true. `removeContacts` takes user
  ids.
- Entry points: the chat header's title/avatar (private chats), the 聊天信息
  panel's face tile (make it a button), and `ContactDetail`'s 更多资料. A new
  `users:*` channel group and `protocol/user.ts` keeps `channels.ts` within
  budget.

### 6.4 Album, caption, translate, pinned bar

- Album: `sendMessageAlbum` accepts several `inputMessageContent` and returns
  `Messages`; the picker already allows multi-select. The renderer must apply
  every returned message and later rely on `albumId` grouping. Keep
  `media:send` for single sends.
- Caption: `editMessageCaption`; the composer's edit mode is text-only today,
  so either edit in place with the existing banner (caption text only) or open a
  small dialog. Gate on `messageProperties.can_be_edited` + media kind.
- Translate: `translateText { text: formattedText, to_language_code, tone }`
  returns `FormattedText`; show the translation under the bubble with 原文 /
  译文 toggle. WeChat has 翻译; this is a real parity gap.
- Pinned bar: `pinChatMessage` / `unpinChatMessage` with
  `messageProperties.can_be_pinned`; private chats can have one pinned message.
  WeChat has no such bar, so P2 and product-gated.

## 7. P2 notes

- **Location/contact/poll/dice sending**: add `inputMessage*` builders next to
  `mediaContent`; received locations are currently flattened to
  `📍 lat, lon` text with no map action — a cheap win is opening the OS maps
  link.
- **Effects / scheduling / silent**: `messageSendOptions.effect_id`,
  `scheduling_state`, `disable_notification`. `SendWhenOnline` is private
  chat only; scheduled messages also need a "scheduled" bubble state and cancel
  edit (`can_edit_scheduling_state`).
- **Shared media**: `searchChatMessages` with
  `searchMessagesFilterPhoto/Video/Document/Url`, presented as tabs in
  `ChatInfoSearch`; the channel may be reused as `messages:media` or extend
  `search:inChat` with a filter.
- **Archive**: `getChats(chatListArchive)` and `chatListArchive` for search;
  the chat list and the search panel both assume `chatListMain` today.
- **Draft cloud sync**: `setChatDraftMessage` + `updateChatDraftMessage`.
  Decide whether TDLib replaces `ui.db` drafts or mirrors them; two sources of
  truth will fight.
- **Mute duration**: `setChatNotificationSettings.mute_for` (8h/1d/1w) instead
  of forever-only.
- **Chat background / theme**: `setChatBackground` / `setChatTheme`; TDLib
  backgrounds are a whole picker, so P3.
- **Screenshot**: `desktopCapturer` + `nativeImage` → send as photo; WeChat's
  scissors menu can be approximated with one 截取当前窗口 entry first.
- **收藏**: map to Saved Messages (forward to self) rather than a new store.

## 8. Suggested batches

One logical batch = one commit, `pnpm verify` green, docs updated.

1. **B1 (2–3 d)** — outgoing typing, 标为未读, 删除聊天, chat-row context menu.
2. **B2 (2–3 d)** — send failure state + retry (test DC; resolve the id-swap
   question first).
3. **B3 (1 d)** — online/last seen (after the placement decision).
4. **B4 (2–3 d)** — notifications + tray/flash + click-to-open.
5. **B5 (3–5 d)** — voice notes (after the codec spike and mic permission).
6. **B6 (2–3 d)** — reactions (display first; picker only after sign-off).
7. **B7 (2–3 d)** — profile card, note, block, report, add/remove contact.
8. **B8** — album send, caption edit, translate, pinned bar, shared media.

Acceptance for every batch: mock Electron pass for the UI; test-DC pass for the
write path (`WEGRAM_TDLIB_TEST_DC=1`, or `pnpm tdlib:test-dc`); if the test DC
session is unavailable, say so and mark the write path **unverified** — never
probe writes against the real session in `spikes/tdlib/data`.

## 9. Open decisions (owner)

1. **Online status placement** — WeChat has no slot. Profile card only, or a
   reserved line under the title?
2. **Reactions** — display received only, or also let the user add them? (DTO
   work is needed either way.)
3. **删除聊天** — confirm "local removal only" (the `deleteChatHistory` route),
   never "delete for everyone".
4. **Notifications** — all messages or unmuted only? Show sender + preview text
   (privacy) or just "新消息"?
5. **Voice notes** — if a WebM→OGG muxer needs a new dependency, is that
   approved? Otherwise the fallback is audio-message semantics.
6. **Calls / secret chats** — keep out of v1; only the wording of the reason
   changes (§10).

## 10. Corrections to the existing docs

- `docs/技术方案.md` §1 says calls are "not on TDLib's public API". In 1.8.70
  the signaling API exists (`createCall`, `acceptCall`, `discardCall`,
  `callStateReady` with servers/config/encryption_key,
  `updateNewCallSignalingData`). The non-goal can stand, but the reason is the
  media stack (WebRTC/SRTP/Opus) and the test/QA burden.
- The same section's MVP list includes **在线状态**; it is not implemented.
- The note under `docs/HANDOFF.md` Known gaps item 3 says
  `updateMessageSendSucceeded` is cosmetic because ids are already server ids. Its own test-DC note says the id changes
  (`td-5242881` → `6291456`). Treat this as unresolved; B2 depends on the
  answer.
- `docs/UI-HANDOFF.md` §6 item 3 already lists "a member card on avatar click,
  and a local 备注" as remaining. The note in §6 about a chat-wide in-chat
  search view is still open too.
- MVP says media "含相册"; only received-album grouping is done. Sending is
  missing.

## 11. What this audit did not verify

- No runtime behavior, no real account, no test-DC writes.
- TDLib field semantics beyond the scheme comments (e.g. whether an empty
  waveform is accepted, whether the message id actually changes).
- Electron 45 codec support for OGG/Opus and MP4/H.264 recording.
- Windows notification/badge specifics on this machine.
- Secret-chat E2E support in TDLib 1.8.70.

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

(Keep this aligned with the scheme; if a line here disagrees with
`.cache/td_api.tl`, the scheme wins.)

## Appendix B — where private-chat code lives

```text
packages/protocol/src/channels.ts        channel tables (spreads chat.ts, qr.ts, poll.ts)
packages/protocol/src/chats.ts           chat-domain channels + schemas
packages/protocol/src/dto.ts             Message, ops, entities (budget-sensitive)
packages/protocol/src/chat.ts            ChatSummary / member / pinned / invite
packages/protocol/src/contact.ts         Contact (address book)
packages/adapter-contract/src/adapter.ts TelegramAdapter seam + AdapterEvent
apps/desktop/src/main/ipc/handlers.ts    invoke handlers (one per channel)
apps/desktop/src/main/telegram/tdlib/
  actions/chats.ts                       list/open/mute/pin/clear/members/title/leave/pinned/invite
  actions/history.ts                     paging + around/newer
  actions/send.ts                        text/edit/delete/forward/media/sticker
  actions/message-input.ts               sendAndMap, reply/text content builders
  actions/contacts.ts                    getContacts
  map/message.ts, map/content.ts         TDLib message → DTO
  map/service.ts                         service-message copy (incl. call logs)
  updates.ts                             TDLib update dispatch
  index.ts                               adapter class (shared actions bound here)
  chat-api.ts                            chat seam methods
packages/mock-adapter/src/index.ts       fake adapter (seam forces parity)
packages/mock-session/src/               pure fake rules (shared with preview)
apps/desktop/src/renderer/src/
  components/Composer.tsx                chat send path, drafts, attachments
  components/composer/ComposerCard.tsx   tool row (表情/收藏/文件/截图/语音)
  components/message-list/{menu,MessageRow}.tsx  context menu + row rendering
  components/chat-pane/{ChatHeader,ChatInfoPanel,ChatInfoSearch}.tsx
  components/contacts/ContactDetail.tsx  address-book card (更多资料/备注/通话 placeholders)
  store/reducers.ts                      reduceOps + pendingOps replay
  lib/preview/                           browser-preview fake IPC
docs/技术方案.md                          authoritative design (Chinese)
docs/HANDOFF.md                          state + measured pitfalls
docs/UI-HANDOFF.md                       renderer tokens/metrics/deltas
```

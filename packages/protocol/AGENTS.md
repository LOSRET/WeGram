# AGENTS.md — packages/protocol

Scope: the IPC contract shared by main, preload and renderer. Read the root
`../../CLAUDE.md` first; this file only adds what is specific to this package.

## What belongs here

Every value that crosses IPC is declared here **first**: `dto.ts` (the core zod
schemas + inferred types, the caption-edit kinds and the media-preview labels), `channels.ts` (channel tables and their request/response
schemas), `errors.ts` (`AppError`) and the modules split out as those two files grew — `stickers.ts` (formats, `Sticker`, sticker sets, custom emoji),
`contact.ts` (the 通讯录 `Contact` row), `settings.ts` (proxy,
app settings, `app:info`), `network.ts` (the TDLib network-option channels —
`prefer_ipv6`), `notification.ts` (消息通知: the three scope DTOs + the local 桌面通知
switch, and their `notifications:*` channel table), `storage.ts` (数据与存储:
the cache usage, 缓存上限, 清理缓存 and their `storage:*` channel table), `viewer.ts` (the 图片和视频 window's payloads),
`chat.ts` (the chat DTOs: kind/summary/member/pinned message/invite link/chat ops),
`chats.ts` (the chat domain's channel keys and schemas), `qr.ts` (the 群二维码
window's channels), `poll.ts` (the poll DTO + the vote/add-option/refresh channels),
`comment.ts` (the comment-thread contract, including what a
comment carries: text, a sticker or a local file), `search.ts` (the cross-chat
message search schemas), `events.ts` (the `evt:*` tables + `EventChannel`/`EventEnvelope`,
moved out of `channels.ts` at its budget), `message-ops.ts` (the `MessageOp` patch table),
`send.ts` (outgoing typing + resend), `voice.ts` (the 语音消息 payload: base64 OGG +
duration + reply, and its send channel), `presence.ts` (peer status, the active-chat
report) and `user.ts` (the 资料卡 DTO — including `BotProfile`, the bot-only half of the card — + its
备注 / 共同群聊 / 添加联系人 channels),
`report.ts` (the phased 举报 contract for a person and for one message),
`bot.ts` (机器人: the command list plus the empty-chat introduction, a callback button's
answer, and the inline query (`@bot query`) result rows — four channels),
`reaction.ts` (the 表情回应 chip DTO, display-only for now), `properties.ts` (the
per-message capability answer the context menu reads) and `web.ts` (即时预览: the
`web:instantView` channel and the rich-block page the reader draws). The channel tables of `chats.ts`, `qr.ts`, `send.ts`, `presence.ts`,
`network.ts`, `notification.ts` and `storage.ts` are spread into the two command
tables; `events.ts` owns its own.
The package is exported straight from source (`src/index.ts`, no build step), so
`pnpm typecheck` in the consumer is the only build. A new field that pushes `dto.ts`
over the budget is a signal to split the domain out, not to raise the cap.

## Rules

- A new DTO field is added **here before** it is used anywhere else. If the
  renderer needs it, it is a protocol field — never read raw TDLib JSON in the
  renderer.
- A new channel goes into `invokeChannels` / `invokeSchemas` (commands) or
  `eventChannels` / `eventSchemas` (events, in `events.ts`) — a **chat** channel goes
  into `chats.ts`, which both command tables spread. The `satisfies Record<Channel,
  Schema>` clauses make a missing schema a compile error, and preload + the main
  router pick the channel up automatically. **Never build channel names by
  concatenation** — preload whitelists literal names only.
- Every event payload is wrapped in `envelope()`, which adds `seq`. The renderer
  treats a gap in `seq` as "re-sync".
- Secrets never travel in clear text: password / MTProxy secret cross IPC only as
  `MASK` (`'***'`), and the main process seals them through
  `main/security/secrets.ts`.
- Types are inferred from schemas (`z.infer`); do not hand-write a parallel
  interface, and do not use `z.any()` — a field with no shape hides adapter bugs.
- **A media kind is a different send, not a label.** `media:pick` asks for `'media'`
  (the 图片与视频 dialog filter) or `'file'`; `media:send` then takes `photo` / `video` /
  `file`, and the renderer's `lib/attachKind.ts` is what maps a picked path to one.
  A comment's `mediaKind` carries the same three. `Message.forward` is the mapped
  `message.forward_info.origin` — name plus the ids a later "open the original" needs.
- **`search:inChat` may carry an empty `q` together with a `filter`.** The 聊天文件 tabs
  (photo / video / file / url) ask "everything of this kind"; an empty query with no
  filter must mean "nothing", never the whole transcript.
- **An album holds photos and videos only** (`media:sendAlbum`), because that is the set
  the transcript folds; a document is sent one message at a time. `messages:cancelSend`
  is the 取消上传 row: a *pending* message, removed locally — there is no
  `cancelUploadFile` in TDLib 1.8.70.

## Verify

```powershell
pnpm typecheck        # from the repo root, covers this package
pnpm test             # vitest, pure modules only
```

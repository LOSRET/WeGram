# AGENTS.md — packages/protocol

Scope: the IPC contract shared by main, preload and renderer. Read the root
`../../CLAUDE.md` first; this file only adds what is specific to this package.

## What belongs here

Every value that crosses IPC is declared here **first**: `dto.ts` (the core zod
schemas + inferred types), `channels.ts` (channel tables and their request/response
schemas), `errors.ts` (`AppError`) and the modules split out when a file hit its
550-line budget — `stickers.ts` (formats, `Sticker`, sticker sets, custom emoji),
`contact.ts` (the 通讯录 `Contact` row), `settings.ts` (proxy,
app settings, `app:info`), `viewer.ts` (the 图片和视频 window's payloads),
`chat.ts` (the chat DTOs: kind/summary/member/pinned message/invite link/chat ops),
`chats.ts` (the chat domain's channel keys and schemas), `qr.ts` (the 群二维码
window's channels), `poll.ts` (the poll DTO + the vote/add-option channels),
`comment.ts` (the comment-thread contract, including what a
comment carries: text, a sticker or a local file), `search.ts` (the cross-chat
message search schemas), `events.ts` (the `evt:*` tables + `EventChannel`/`EventEnvelope`,
moved out of `channels.ts` at its budget), `message-ops.ts` (the `MessageOp` patch table),
`send.ts` (outgoing typing + resend), `presence.ts` (peer status, the active-chat
report) and `user.ts` (the 资料卡 DTO + its 备注 / 共同群聊 / 添加联系人 channels), `reaction.ts` (the
表情回应 chip DTO, display-only for now) and `properties.ts` (the per-message
capability answer the context menu reads). The channel tables of `chats.ts`, `qr.ts`, `send.ts` and `presence.ts` are
spread into the two command tables; `events.ts` owns its own.
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

## Verify

```powershell
pnpm typecheck        # from the repo root, covers this package
pnpm test             # vitest, pure modules only
```

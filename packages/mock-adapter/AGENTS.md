# AGENTS.md — packages/mock-adapter

Scope: the fake `TelegramAdapter` — the fixture account served when the app has no
credentials (development only), plus the real PNG/WebP/TGS/WebM media it generates under
`userData/mock-media`. Read the root `../../CLAUDE.md` first.

## What belongs here

- `index.ts` — the `MockAdapter`: auth flow (phone/code/password, simulated QR),
  chat/history/search/sticker/media endpoints, and the ambient traffic timer.
- `fixtures.ts` — a thin adapter over `@wegram/mock-fixtures` (the account data, shared
  with the browser preview), injecting this side's `mediaOf` and clock.
- `assets.ts` (`MockAssets`) / `avatars.ts` (`MockAvatars`) — generated media and the
  deferred avatar event; `mock-assets.ts` embeds the WebP/TGS/WebM bytes and the runtime
  PNG/WAV encoders.
- `chats.ts` — conversation endpoints as one `createMockChats` factory (list/open/mute/
  pin/clear/members/rename/leave/pinned/invite link); `history.ts` — transcript paging.
- `comments.ts`, `contacts.ts`, `search.ts`, `stickers.ts`, `polls.ts` — the remaining
  endpoints; `search.ts` and `polls.ts` only adapt the fixture map to the shared
  matching / vote rules and emit their own events.
- `edits.ts` — 编辑 / 编辑说明 / delete / 重试 as one `createMockEdits` factory: each
  rewrites one fixture row and announces the op that describes it (a text edit is an
  `edit`, a caption is a `replace`).
- `bots.ts` — the fixture bot's two endpoints: the commands it publishes (the composer's
  "/" list) and its canned callback answer (a toast, and an alert for the `alert` payload).
- `users.ts` — 资料卡 for the fixture people: reads the seed into the shared card
  composition, keeps this session's 备注 / 添加删除联系人 / 拉黑 overrides in a map
  (nothing persists) and answers 共同群聊 and the phased 举报 from the shared rules.
- `sends.ts` — the outgoing path (text / one media file / 相册 / sticker / 语音消息 ->
  the voice row `buildVoiceMessage` in `media.ts`) as one
  `createMockSends` factory: build the row, append it, start the fake upload. It is
  constructed in `MockAdapter`'s constructor rather than as a field initializer,
  because it reads `assets`.
- `media.ts` — the outgoing media/sticker row builders. A chat's send and a comment
  thread's post build the same rows (§9.8: a comment can carry what the composer
  produced), so both go through `buildMediaMessage` / `buildStickerMessage`; the
  caller appends the row (transcript or thread) and starts the upload simulation.
- `transcript.ts` — the one "append and announce" writer; `effects.ts` — read marker and
  transfer simulation; `traffic.ts` — ambient incoming messages.
- Paging, read, comment, chat-list-order, 话题, search, poll and 资料卡 rules come
  from `@wegram/mock-session`; both fakes must answer them identically, so a rule
  change lands here and in the preview's handler modules in the same batch.

## Rules

- Injected, never imported: the `wx-media://` registry and the image-size probe are
  main-process concerns, so `MockAdapterOptions` takes `registerMedia` and
  `probeImageSize`; main wires `media/registry.ts` + `media/image-size.ts` into them.
  Adding another app-side dependency means another injected callback.
- Implement `TelegramAdapter` from `@wegram/adapter-contract` — never import
  `apps/desktop` code. The class is what the type check holds to the seam.
- Media is real: files are written once and served through the same `wx-media://`
  protocol the TDLib adapter uses, so downloads and sticker rendering are exercised.
- This package is development-only (`createAdapter` refuses it when `allowMock` is
  false); it must never leak into a packaged build's behaviour, even though the code is
  bundled.

## Verify

```powershell
pnpm typecheck     # from the repo root; covers this package
pnpm test          # moved with the code: fixtures/contacts/comments rules
pwsh apps/desktop/scripts/launch-detached.ps1 -Mock   # Electron + fake adapter
```

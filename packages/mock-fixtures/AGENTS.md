# AGENTS.md — packages/mock-fixtures

Scope: the demo account both fakes serve — the Electron mock adapter
(`packages/mock-adapter`) and the browser preview
(`apps/desktop/src/renderer/src/lib/preview`). Read the root `../../CLAUDE.md` first.

## What belongs here

- `data.ts` — `buildFixtureSeeds`: chats 1–13 (12 is the 论坛群 fixture: General, a pinned
  topic and a closed one, every message carrying its `topicId`), their messages (albums, stickers,
  the bot's inline and reply keyboards both carrying a `webAppUrl` key + its profile 菜单,
  one premium sticker, one custom emoji, a channel post, the 通讯录 people), comment
  threads on the posts that own one, and the contact fields the address book reads.
  Chat 3 carries one forwarded row (`forward`) so the 转发自 line is visible without TDLib.
- `seed.ts` — the dataset's shape (`FixtureSeed`, `FixtureOptions`, `SeedMedia`).
  Split out of `data.ts` when the channel fixtures pushed it to its size budget;
  `FixtureSeed` carries `canPost` and `joined` for channels, `contact.bio` /
  `contact.note` for the 资料卡, and `commonChatIds` for 共同群聊 (both fakes read them).
- `contacts.ts` — the 通讯录 people as private chats (`addContactFixtures`), moved out of
  `data.ts` when the 表情回应 + 语音转文字 fixtures pushed it over budget.
- `stress.ts` — the 5000-message stress chat 99 for the virtualised list. Split out
  of `data.ts` when the custom-emoji fixture pushed it to its size budget.
- `threads.ts` — the comment authors, bodies and the id formula
  (`900 000 + messageId × 100 + index`), so a thread can never collide with a
  transcript id.
- `polls.ts` — `pollMessage` and the group's open multi-answer poll + unanswered
  quiz; the closed poll with results stays inline in `data.ts`.
- `storage.ts` — 数据与存储's demo cache: four media kinds (~537 MB) plus a 96 MB
  database, and the trim/clear arithmetic over them. Both fakes show the same numbers;
  nothing on disk is involved.
- `services.ts` — the demo's service rows (a missed call, a self-destructed photo):
  the finished text a fixture carries, so the centered notices can be seen without
  TDLib. Split out of `data.ts` for the same size budget.
- `lookup.ts` — the lookups both fakes make over the dataset: `seedByChatId` /
  `seedByUserId` / `seedByUsername` (a person's handle or a bot's), `memberByUsername`
  (添加成员), `botSeedByUsername` / `firstBotSeed` / `botCommandsAnswer` and
  `commonGroupIds` (共同群聊). They return ids or seed rows, so each fake maps them to
  its own chat objects.

The data says *what* a message is, never *where its bytes live*: a media reference is
a `fileId` plus the protocol fields (size, duration, format), and the caller's
`mediaOf` turns it into a `wx-media://` URL (mock, real files under `userData`) or a
`data:` URL (preview). `now` comes in the same way, so both sides keep their own
clock.

## Rules

- The dataset is the contract both fakes render; changing an id or a marker changes
  what the UI shows in two places. `data.test.ts` pins the shape (conversation set,
  album, thread counts, stress size, digit-only phones).
- Do not add process/environment knowledge here — no `Date.now()`, no `node:*`, no
  Electron, no file system. Inject it.
- `packages/mock-adapter/src/fixtures.ts` is a thin adapter over this
  package, and so is `renderer/src/lib/preview/fixtures.ts`; the preview adds only
  its `data:` media and gradient avatars on top.

## Verify

```powershell
pnpm typecheck     # from the repo root; covers this package
pnpm test          # data.test.ts + the fakes' own tests
```

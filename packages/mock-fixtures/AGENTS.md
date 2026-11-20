# AGENTS.md — packages/mock-fixtures

Scope: the demo account both fakes serve — the Electron mock adapter
(`apps/desktop/src/main/telegram/mock`) and the browser preview
(`apps/desktop/src/renderer/src/lib/preview`). Read the root `../../CLAUDE.md` first.

## What belongs here

- `data.ts` — `buildFixtureSeeds`: chats 1–11, their messages (albums, stickers,
  one premium sticker, one custom emoji, a channel post, the 通讯录 people), comment
  threads on the posts that own one, and the contact fields the address book reads.
- `stress.ts` — the 5000-message stress chat 99 for the virtualised list. Split out
  of `data.ts` when the custom-emoji fixture pushed it to its 550-line budget.
- `threads.ts` — the comment authors, bodies and the id formula
  (`900 000 + messageId × 100 + index`), so a thread can never collide with a
  transcript id.

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
- `apps/desktop/src/main/telegram/mock/fixtures.ts` is a thin adapter over this
  package, and so is `renderer/src/lib/preview/fixtures.ts`; the preview adds only
  its `data:` media and gradient avatars on top.

## Verify

```powershell
pnpm typecheck     # from the repo root; covers this package
pnpm test          # data.test.ts + the fakes' own tests
```

# AGENTS.md — packages/mock-session

Scope: the rules a *fake* Telegram session plays by, shared by the two fakes —
`packages/mock-adapter/**` (the Electron mock adapter) and
`apps/desktop/src/renderer/src/lib/preview/**` (the browser preview bridge).
Read the root `../../CLAUDE.md` first.

## What belongs here

Pure rules that both fakes must answer identically:

- `paging.ts` — `pageOlder` / `pageAround` / `pageNewer`; the slicing every fake
  transcript does, and the `hasMore`/`hasNewer` meaning that goes with it.
- `read.ts` — `nextReadState`: the marker only moves forward, `unread` is what is
  still newer and incoming.
- `comments.ts` — `composeCommentAccess` (the fake stand-in for the real
  `comment-access.ts` rule) and `threadInteraction`.
- `chatList.ts` — `sortChatList`: the chat list's order (pinned first, then newest
  activity), which both fakes serve.
- `poll.ts` — `applyPollVote`: the fake vote arithmetic (first vote, change, retract,
  multi-answer, quiz lock, percentages), shared by both fakes.

The package imports nothing — no zod, no Node, no Electron, no React — because the
renderer is a sandboxed page and `@wegram/mock-session` is bundled into it. Keep it
that way: a Node import here would break the browser preview build, and a protocol
import would drag the whole DTO layer into the preview.

## What does NOT belong here

Fixtures, media generation and event wiring stay in each fake: the mock writes real
PNG/WebP/TGS files under `userData` and mints `wx-media://` tokens, while the
preview uses `data:` URLs. The *account data* is shared, but it lives in
`@wegram/mock-fixtures` — this package stays dependency-free and rule-only.

## Verify

```powershell
pnpm typecheck     # from the repo root; covers this package
pnpm test          # pure modules only
```

New rule → new `*.test.ts` beside it, and wire both fakes in the same batch.

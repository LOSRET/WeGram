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
- `chats.ts` — the conversation rules: `listedChatMembers` (the people who posted),
  `canFakePost` / `canFakeGetMembers` (channel rights), `fakeJoinState`, `applyChatCleared`,
  `chatPinKey` and `pinnedMessageFrom`.
- `poll.ts` — `applyPollVote` (first vote, change, retract, multi-answer, quiz
  lock, percentages), `copyPoll` / `pollOptionTarget` / `newPollOption` for the
  add-option path, and `pollVoteRejection` — the code + words a refused vote
  crosses as (a quiz is `poll_answered`, the rest forbidden / invalid payload).
- `topics.ts` — the 话题 rules: `orderTopics` / `filterTopics` / `pageTopics` plus
  `createTopic`, `topicEditPatch`, `setTopicFlag`, `removeTopic`, `topicListPage`,
  `topicRead`, `sumTopicUnread` and `DEFAULT_TOPIC_ICONS`.
- `search.ts` — `searchChatRows` (the 聊天 / 频道 title match; an empty box finds
  nothing), `searchMessageRows` (in-chat substring, plus the 聊天文件 `filter` where an
  empty box means "everything of that kind") and `searchMessagesInScope`
  (the merged per-scope stream, its numeric cursor and `total`).
- `forward.ts` — `forwardedOrigin`: the 转发来源 a fake's forward copy carries (the
  original's own origin when it has one, else the sender), so the demo's forwards do
  not look like the sender wrote them.
- `profile.ts` — `REPORT_OPTIONS` / `reportAnswer` (the phased 举报 sheet) and
  `composeProfile` / `pageCommonChats` for the 资料卡 (备注 overrides, a bot is
  never a contact and is the only reportable person).

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

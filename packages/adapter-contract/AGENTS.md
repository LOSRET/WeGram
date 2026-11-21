# AGENTS.md — packages/adapter-contract

Scope: the one interface main codes against — `TelegramAdapter`, the adapter events and
the shared `AdapterEmitter`. Implemented by `main/telegram/tdlib/` (the real adapter) and
`@wegram/mock-adapter` (the fake). Read the root `../../CLAUDE.md` first.

## What belongs here

- `adapter.ts` — `TelegramAdapter`, `AdapterEvent` / `AdapterListener`, `AdapterEmitter`,
  `AdapterKind`, `MediaKind`. Types only plus the ~20-line emitter; it imports
  `@wegram/protocol` types and nothing else. No Node, no Electron, no `tdl`.

## Rules

- This is the seam from design doc §2: adding a method here means both adapters implement
  it in the same batch (TDLib first, then the mock, or the type check stays red).
- It lives outside `apps/desktop` so the mock can implement it without importing app
  code. `main/telegram/adapter.ts` re-exports it, which is why the rest of main still
  imports the seam from that path.
- Never let an implementation detail (TDLib types, media registry, `wx-media`) leak in:
  both adapters answer the same DTOs.

## Verify

```powershell
pnpm typecheck     # from the repo root; covers this package
pnpm test
```

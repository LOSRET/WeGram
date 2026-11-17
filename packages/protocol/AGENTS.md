# AGENTS.md — packages/protocol

Scope: the IPC contract shared by main, preload and renderer. Read the root
`../../CLAUDE.md` first; this file only adds what is specific to this package.

## What belongs here

Every value that crosses IPC is declared here **first**: `dto.ts` (zod schemas +
inferred types), `channels.ts` (channel tables and their request/response
schemas), `errors.ts` (`AppError`). The package is exported straight from source
(`src/index.ts`, no build step), so `pnpm typecheck` in the consumer is the only
build.

## Rules

- A new DTO field is added **here before** it is used anywhere else. If the
  renderer needs it, it is a protocol field — never read raw TDLib JSON in the
  renderer.
- A new channel goes into `invokeChannels` / `invokeSchemas` (commands) or
  `eventChannels` / `eventSchemas` (events). The `satisfies Record<Channel,
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

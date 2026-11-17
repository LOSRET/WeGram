# AGENTS.md — apps/desktop/src/renderer

Scope: the React 19 + Tailwind v4 UI. Read the root `../../../../CLAUDE.md`, then
`docs/UI-HANDOFF.md` for the WeChat metrics this UI was built against. This file
only adds what is specific to this layer.

## Layering

```
App.tsx               bootstrap + the ONE place that subscribes to evt:*
store/                zustand: chats, messages, drafts, media URLs/progress
components/           one file per visual concern (MessageList, ChatPane, Composer, …)
lib/ipc.ts            thin `window.tg` wrapper
lib/format.ts         time / preview / avatar helpers (pure, unit-tested)
lib/entities.ts       TL entity → text segments (pure, unit-tested)
lib/useAnchoredScroll.ts  ready gate, stick-to-bottom, resize compensation
lib/media.ts          one-download-per-file dedupe
lib/tgs.ts            gzip guards + Lottie decode cache
lib/preview-bridge.ts DEV-ONLY fake IPC for the browser preview
```

The renderer is a sandboxed web page: **no `electron`, no `node:*`, no `tdl`**
(lint-enforced). It only speaks the `window.tg` contract from
`@wechatgram/protocol`.

## Rules that have already cost a debugging session

- **Never gate content visibility on `requestAnimationFrame` alone.** Electron
  throttles rAF while the window is occluded, so the pane stays invisible with
  its data loaded. Always pair a frame-based reveal with a `setTimeout` fallback.
- **A programmatic `scrollTop` write desyncs `@tanstack/react-virtual`** (it
  re-reads its offset only on real scroll events). After every programmatic
  scroll, dispatch one `scroll` event so the virtualizer re-measures — otherwise
  the transcript looks blank while `scrollTop` says "at the bottom".
- **`messagesByChat[chatId]` is created only by `setHistory`/`prependHistory`.**
  `ChatPane` reads "an entry exists" as "already cached"; creating one from an
  event (read receipts fire for every chat) makes the first-page fetch get skipped
  forever. Ops that arrive before the first page are queued in `pendingOps`.
- **Long panes use `components/OverlayScrollbar.tsx`**, never a native scrollbar:
  Chromium gives native bars a layout gutter, so rows re-flow when the bar
  appears. Popovers keep native thin bars on purpose.
- **`wx-*` class names and the `--wx-*` tokens are a measured contract** (see
  `styles/index.css` header and `docs/UI-HANDOFF.md`). Do not rename a class, and
  do not hard-code a colour — every colour comes from the `:root` block.
- User-facing copy is Chinese (`回复`/`复制`/`转发`…), code, identifiers and
  comments are English.

## Verify

```powershell
pnpm test                              # pure lib/ helpers
cd apps\desktop; pnpm web              # browser preview, http://localhost:5174
#   ?perf=1 → dev acceptance panel: FPS + anchored-row drift
pwsh apps\desktop\scripts\launch-detached.ps1 -NoSandbox -Mock   # real Electron shell
```

Anything about media, virtualisation or scroll behaviour must be checked in the
Electron window, not in the browser preview: the preview fakes IPC and has no
`wx-media://` protocol.

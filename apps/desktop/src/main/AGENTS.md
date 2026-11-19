# AGENTS.md — apps/desktop/src/main

Scope: the Electron main process (protocol adapter, IPC, stores, media protocol).
Read the root `../../../../CLAUDE.md` and `docs/HANDOFF.md` first; this file only
adds what is specific to this layer.

## Layering

```
index.ts            app lifecycle, adapter wiring, media scheme, login↔shell hand-over
                    (syncWindowsToAuth / showMainWindow)
app-window.ts       the ONE BrowserWindow factory (security webPreferences, route load,
                    navigation policy) + the shell's title-bar overlay
windows.ts          the shell window: geometry, theme repaint, minimize↔viewer wiring
login-window.ts     the frameless 280×373 login BrowserWindow (#login), close/refocus
viewer.ts           the 图片和视频 window; unowned on purpose (see below), pins/hides it
ipc/router.ts       per-channel zod validation, typed handler map, Result envelope
ipc/handlers.ts     one handler per invoke channel
telegram/           adapter.ts (the seam) / tdlib/ (real adapter) / mock/ (fixtures) /
                    updates.ts / events.ts / comment-access.ts (the comment permission rule)
telegram/mock/      fixtures.ts is a thin adapter over @wegram/mock-fixtures (the account
                    data, shared with the browser preview); transcript.ts is the one
                    "append and announce" writer, effects.ts drives read/transfer; paging,
                    read, comment and list-order rules come from @wegram/mock-session
telegram/tdlib/     client / updates / json.ts (the one "missing array" read) / map/* (content,
                    rich, media.ts holds the one media field table)
telegram/tdlib/actions/  TDLib requests as functions over ActionDeps, grouped into
                    chats / history / files / send / comments (index.ts re-exports);
                    message-input.ts holds the one send envelope
media/              registry.ts (token → path) / protocol.ts (wx-media://) / image-size.ts
store/              ui-db.ts (all SQL) / settings.ts (proxy only)
proxy*.ts           proxy DTO ↔ stored config
security/secrets.ts safeStorage (DPAPI) seal/unseal
```

Everything except `telegram/tdlib/**` (the real adapter folder) talks to the `TelegramAdapter` interface.
**ESLint enforces this**: importing `tdl` or `prebuilt-tdlib` anywhere else is an
error (`eslint.config.mjs` → "architecture"). If a change seems to need it, the
change belongs in the adapter.

## Rules that have already cost a debugging session

- **All `node:sqlite` calls live in `store/ui-db.ts`** (also lint-enforced).
  `settings.json` keeps only the proxy config, because it carries a sealed
  secret.
- **The renderer never sees a filesystem path.** Only the adapters may call
  `media/registry.ts` to mint a `wx-media://f/<token>` URL; `media/protocol.ts`
  resolves tokens and never request paths, and it must keep Range support.
- **`messagesByChat` entries are created only by `setHistory`/`prependHistory`**
  (that is renderer state, but the adapter decides what triggers it): a read
  marker for a chat whose history was never loaded must not look like a loaded
  chat, or groups open empty and never page back.
- Events are emitted as domain `AdapterEvent`s and batched by `telegram/updates.ts`
  (60 ms, monotonic `seq`). Do not push IPC events directly from the adapter.
- Password / MTProxy secret are sealed with `safeStorage` (`security/secrets.ts`).
- **TDLib cannot cancel a pending QR confirmation.** `auth:reset` destroys the auth
  client and starts a new one (nothing is stored yet); the QR link arrives as repeated
  `authorizationStateWaitOtherDeviceConfirmation` updates (`waitQr`) and must be passed
  through as-is. A completed user-driven login opens the shell directly; only a session
  restored at startup stops on the profile step (`syncWindowsToAuth`).
- Packaging constraint: `tdjson.dll` cannot load from inside `app.asar`
  (`electron-builder.yml` unpacks it), and TDLib data dirs live under
  `app.getPath('userData')`, which `index.ts` pins to `%APPDATA%\WeGram`.
- **The viewer is a plain top-level window on purpose** (no `parent`): the task bar then
  looks like WeChat's — same process, same group, one WeGram button whose hover preview
  lists both windows. An *owned* window is in that same group too (measured: 3 windows of
  one process show as "3 个运行窗口" under one button), so ownership never affected the
  task bar; it only forces "always above the owner", which is why 定位到聊天位置 could not
  raise the chat and the ownership was dropped. What ownership gave for free is now
  explicit and must stay: the shell `moveTop()`s itself when it has to come forward,
  `hide()/show()`s the viewer with its own minimize/restore, and `closeViewer()`s on
  teardown (`window-all-closed` would otherwise leave an orphan viewer and the app would
  never quit).
- **Credentials are build-time, and mock is development-only.** `bootstrap()` resolves
  `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` from the environment first, then from
  `__WEGRAM_API_CREDENTIALS__` (inlined by `electron.vite.config.ts`); a packaged build
  with neither shows an error dialog and quits, and `createAdapter` refuses the mock
  adapter when `allowMock` (= `isDev`) is false. Never add a second place that reads
  credentials.

## Verify

```powershell
pnpm typecheck
pnpm test
cd apps\desktop; pnpm ui:db-check     # headless ui.db check (node:sqlite)
cd apps\desktop; pnpm tdlib:smoke     # READ-ONLY real TDLib: getMe/getChats/history
pwsh apps\desktop\scripts\launch-detached.ps1 -Mock   # Electron + mock adapter
```

`spikes/tdlib/data` is a **real account**. Never send, delete, forward or
mark-read against it from a script — use the mock adapter (`-Mock`, or
`WEGRAM_ADAPTER=mock`) for anything that writes.

Never start Electron from an agent shell: Chromium cannot initialise inside the
job object. Use `launch-detached.ps1` (creates the process via WMI); logs land in
`.cache/app.log`.

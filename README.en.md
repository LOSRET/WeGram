# WeGram

*Telegram inside, WeChat outside — a Windows desktop client built on Electron + TDLib.*

[中文](README.md) · [English](README.en.md)

---

> ⚠️ **This project is at a very early stage.** It is a personal client still under active development: features, the IPC contract, data structures and the UI can change at any time with no compatibility guarantee, and the installer has not been code-signed or test-installed yet. Please don't treat it as something fit for daily use, and don't try it with an account you care about.

## What this is

WeGram is a personal Telegram desktop client: Telegram's official TDLib (`tdl` + `prebuilt-tdlib`) behind an Electron shell, dressed in the WeChat 4.x look. Every token and metric in the UI — rail and list widths, row height, bubble colours, radii, icons — was measured off the real WeChat client on this machine (see `docs/UI-HANDOFF.md`); none of it is guessed.

You sign in with your own account and see your real chats, groups and channels. It is not a demo shell.

- **Single account**: phone number + code + 2FA, session persisted by TDLib and reused on restart.
- **Built-in proxy**: SOCKS5 and MTProxy. On mainland networks a proxy is mandatory — without one `getChats` hangs.
- **Message storage belongs to TDLib**. This project does not re-implement a message table; only protocol-independent UI state (drafts, theme, scroll position) lives in `ui.db` (`node:sqlite`).

## Status

| Milestone | Scope | State |
| --- | --- | --- |
| W1 | Electron shell, `packages/protocol` IPC contract, mock adapter, real TDLib adapter with a manual auth state machine, SOCKS5/MTProxy, WeChat-style login screen and three-column shell | ✅ |
| W2 | Virtualised message list, anchored history paging, send / reply / edit / delete / forward, per-chat drafts, `ui.db` | ✅ |
| W3 | Photo and document send/receive with progress, the `wx-media://` media protocol, all three sticker formats (WebP / TGS / WebM), sticker picker, TL entity rendering, day and unread dividers, read receipts, typing indicator | ✅ |
| W3+ | Standalone media viewer window: zoom / rotate / save for photos, playback (speed, mute, timeline) for videos | ✅ |
| W3+ | Standalone login window: frameless 280×373, QR login via TDLib with a phone fallback, straight into the shell on first sign-in, profile step only for a restored session | ✅ |
| — | Search (global + in-chat), pinning chats, full settings page, a verified signed installer | ⏳ pending |

`pnpm verify` is green: 38 test files, 322 cases. `pnpm test` covers pure modules only — no DOM, no Electron.

## Features

**Login** Opens in its own small window, like WeChat: a QR code requested from TDLib (encoded locally, confirmed on the phone), with a 用手机号登录 fallback for phone / code / 2FA. A first sign-in goes straight to the shell; on later launches a still-authorized session stops on the profile step (avatar, name, 进入 WeGram). Without credentials the app silently falls back to the mock adapter (its QR confirms itself after 10 s), so the UI opens anyway.

**Chats** Direct chats, groups and channels with unread counts, last-message preview, avatars and timestamps. The unread count is derived from the server marker, so the chat row, the floating pill and the rail badge can never disagree.

**Messages** Anchored history paging (prepending a page moves the viewport by 0 px), send, reply, edit, delete, forward, per-chat drafts, read receipts, typing indicator, day separators, the unread divider, and TL entities (bold / italic / monospace / pre blocks / links / spoilers).

**Media** Upload and download progress for photos and files, plus thumbnails. Local files reach the renderer only as `wx-media://f/<token>` — it never sees a raw path. Photos and videos open in a standalone viewer window (toolbar, wheel zoom, Esc to close).

**Stickers** Static WebP, TGS (Lottie, gunzipped via `DecompressionStream('gzip')`) and WebM video stickers all render. The picker is backed by `getInstalledStickerSets`.

**Look** WeChat 4.x skin, light and dark; native title-bar overlay (32 px); floating overlay scrollbars on long panes (Chromium's native bars take a layout gutter, so rows re-flow whenever the bar appears); the chrome icons are vectors extracted from the client's own `Weixin.dll`.

## Architecture

```
WeGram/
├─ apps/desktop/                 Electron app
│  ├─ src/main/                  main process
│  │  ├─ telegram/adapter.ts     TelegramAdapter interface (domain model, decoupled from TDLib JSON)
│  │  ├─ telegram/mock/          fake adapter (fixtures / assets / traffic) — lets the UI proceed without the protocol layer
│  │  ├─ telegram/tdlib/         the only folder allowed to import tdl / prebuilt-tdlib
│  │  ├─ windows.ts              shell window factory, title-bar theme, external-link allowlist
│  │  ├─ ipc/                    channel router, zod input validation, AppError normalisation
│  │  ├─ media/                  wx-media:// protocol, token registry, image-size probe
│  │  ├─ store/                  ui.db (drafts/theme/scroll anchor) and settings.json (proxy only)
│  │  └─ security/               credentials sealed through safeStorage (Windows DPAPI)
│  ├─ src/preload/               window.tg whitelist bridge (literal channel names only)
│  └─ src/renderer/              React 19 + Tailwind v4 UI
├─ packages/protocol/            IPC contract: dto (zod) / channels / errors
├─ docs/                         design, handoffs and measurements
├─ spikes/tdlib/                 TDLib probes and the real session (not committed)
└─ scripts/                      launcher scripts
```

Four boundaries, enforced by ESLint rather than by good intentions:

1. Only `src/main/telegram/tdlib/**` may import `tdl` / `prebuilt-tdlib`; `node:sqlite` appears only in `main/store/ui-db.ts`.
2. The renderer never sees raw TDLib JSON. Any value crossing IPC is declared in `packages/protocol/src/dto.ts` first.
3. Channel names are literals in `channels.ts` — never concatenated. Every event carries `seq`; a gap in `seq` means the renderer re-syncs.
4. Passwords and MTProxy secrets cross IPC only as `'***'`; the real secret is sealed by the main process via DPAPI.

## Tech stack

| Layer | Choice |
| --- | --- |
| Electron | 38 |
| UI | React 19, Tailwind v4, Zustand 5, TanStack Query 5, `@tanstack/react-virtual` |
| Animated stickers | `lottie-web` (renderer only) |
| Protocol | TDLib via `tdl` 8 + `prebuilt-tdlib` |
| Local UI state | `node:sqlite` (`ui.db`) |
| Build | electron-vite 4 / Vite 7 / TypeScript 5.9 |
| Checks | ESLint 10, Prettier 3, Vitest 5 |

## Requirements

- Windows 10/11 x64. Only Windows has been exercised; other platforms are untested.
- Node ≥ 22, pnpm 12 (pinned via `packageManager`).
- Your own `api_id` / `api_hash` from [my.telegram.org/apps](https://my.telegram.org/apps) (see below).
- Optional: a working SOCKS5 or MTProxy endpoint.

## Quick start

```powershell
pnpm install

# Works without a .env: no credentials means the mock adapter
cd apps\desktop
pnpm web                 # browser preview at http://localhost:5174 (?perf=1 → acceptance panel)
```

Against a real account:

```dotenv
# apps\desktop\.env (gitignored, never committed)
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
WEGRAM_PROXY=socks5://127.0.0.1:7890
```

> When you build it yourself, `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` must be the credentials you registered at [my.telegram.org/apps](https://my.telegram.org/apps) — a release build inlines them into the main bundle. Reusing an official client's or another project's `api_id` / `api_hash` violates the Telegram API Terms and gets the account banned.

```powershell
cd apps\desktop
pnpm dev                 # Electron dev window
```

Or use the one-click launcher (reuses the real session in `spikes\tdlib\data`, default proxy `socks5://127.0.0.1:7890`):

```powershell
scripts\start-real.cmd          # builds first when out\ is missing
scripts\start-real.cmd build    # force a rebuild
scripts\start-test.cmd          # test DCs (WEGRAM_TDLIB_TEST_DC=1, reuses spikes\tdlib\test-data)
```

Logs land in `.cache\app.log`.

> **Local workaround**: Chromium's sandbox cannot start on this machine (Windows Insider build + Kaspersky), and Electron must be launched outside the agent shell's job object, so `scripts\start-real.cmd` goes through `launch-detached.ps1 -NoSandbox`. That is a local compromise — never ship it.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | Real TDLib credentials; absent means the mock adapter |
| `WEGRAM_ADAPTER=mock` | Forces the mock even with credentials — use it for UI work that must not touch the real account |
| `WEGRAM_TDLIB_DIR` | Session directory override; shared by the app and `tdlib:smoke` |
| `WEGRAM_PROXY` | Initial proxy: `socks5://host:port`, `socks5://user:pass@host:port`, `mtproto://host:port?secret=…` |

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install dependencies (`allowBuilds` lives in `pnpm-workspace.yaml`) |
| `pnpm verify` | **The one gate**: lint → typecheck → test → build |
| `pnpm lint` | ESLint including the architecture rules, zero warnings allowed |
| `pnpm typecheck` | protocol + main/preload + renderer |
| `pnpm test` / `pnpm test:watch` | Vitest over pure modules |
| `pnpm build` | electron-vite build → `apps/desktop/out` |
| `pnpm format` | Prettier write (`format:check` to verify only) |
| `pnpm dev` | Root alias for `cd apps\desktop; pnpm dev` |
| `cd apps\desktop; pnpm web` | Renderer-only browser preview |
| `cd apps\desktop; pnpm tdlib:smoke` | Headless real-TDLib check (getMe / getChats / history paging, read-only) |
| `cd apps\desktop; pnpm ui:db-check` | Headless `ui.db` check |
| `pwsh apps\desktop\scripts\launch-detached.ps1 -NoSandbox -Mock` | The only way Electron starts on this machine (outside the job object) |

## Measured results

- 5000 messages at 60 fps; prepending a page moves the anchored row by **0.0 px** (measured in Electron over CDP; reproducible with the `?perf=1` panel).
- `tdlib:smoke` passes against the real session: `getMe`, chat list, history paging.
- Three defects that only reproduce on a real account — groups opening empty, a lying `hasMore`, and the visibility gate freezing while the window was occluded — are fixed; see `docs/HANDOFF.md`.

## Documentation

| File | Contents |
| --- | --- |
| `docs/技术方案.md` | Authoritative design (Chinese): choices, architecture, per-module decisions |
| `docs/HANDOFF.md` | Current state, hard rules, measured surprises, next steps |
| `docs/UI-HANDOFF.md` | WeChat 4.x tokens and metrics (measured), icon provenance, known deltas |
| `docs/REFACTOR-HANDOFF.md` | File split, mechanically enforced conventions, pending batches |
| `spikes/tdlib/RESULTS.md` | Measured TDLib behaviour on Windows (packaging constraints) |
| `CLAUDE.md` / `AGENTS.md` | Coding standards and architecture red lines |

## Deliberately out of scope

- **Voice/video calls**: Telegram does not expose them through TDLib's public API; it would mean rewriting the stack.
- **Secret chats (E2E)**: TDLib has the types but the pitfalls are expensive. Not in v1; revisit for v2.
- **Multiple accounts**: v1 is single-account.
- **Mobile, Moments, mini-programs**: no matching entities on the Telegram side.

## Disclaimer

- A personal, study-oriented project. Not affiliated with or endorsed by Telegram or Tencent.

## License

The code is released under the **MIT** license — see [LICENSE](LICENSE).

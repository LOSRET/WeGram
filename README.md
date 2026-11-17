# WeGram

**Telegram 的内核，微信 4.x 的外观 —— Windows 桌面客户端**
*Telegram inside, WeChat outside — a Windows desktop client built on Electron + TDLib.*

[中文](#中文) · [English](#english)

> 仓库目录名仍沿用历史的 `WechatGram`，产品名与包名已经是 **WeGram**。
> The checkout folder is still named `WechatGram` for history; the product and package name is **WeGram**.

---

## 中文

### 这是什么

WeGram 是一个自用的 Telegram 桌面客户端：协议层用 Telegram 官方的 TDLib（`tdl` + `prebuilt-tdlib`），外壳是 Electron，界面则按本机微信 4.x 客户端的实测 token 与尺寸重建——栏宽、行高、气泡颜色、圆角、图标都来自对真实客户端的测量（见 `docs/UI-HANDOFF.md`），不是凭印象画的。

登录的是你自己的账号，会话、群、频道都按 Telegram 的真实数据展示；它不是演示界面。

- **单账号**：手机号 + 验证码 + 两步验证，登录态由 TDLib 持久化，重启直接复用 session。
- **内置代理**：SOCKS5 / MTProxy。国内网络下代理是刚需——没有代理 `getChats` 会直接挂住。
- **消息存储交给 TDLib** 自带的本地库，本项目不再造一套消息表；只有纯 UI 状态（草稿、主题、滚动位置）写进 `ui.db`（`node:sqlite`）。

### 进度

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| W1 | Electron 外壳、`packages/protocol` IPC 契约、mock 适配器、真实 TDLib 适配器（手动登录状态机）、SOCKS5/MTProxy、微信风登录页与三栏布局 | ✅ |
| W2 | 虚拟化消息列表、锚定历史分页、发送/回复/编辑/删除/转发、按会话草稿、`ui.db` | ✅ |
| W3 | 图片与文件收发（含进度）、`wx-media://` 媒体协议、三种贴纸格式（WebP / TGS / WebM）、贴纸面板、TL 实体渲染、日期与未读分隔、已读回执、typing | ✅ |
| W3+ | 独立媒体查看器窗口：图片缩放/旋转/保存，视频播放（倍速、静音、时间轴） | ✅ |
| — | 搜索（全局 + 会话内）、置顶/免打扰、完整设置页、NSIS 安装包 | ⏳ 待做 |

`pnpm verify` 当前全绿：21 个测试文件 / 195 个用例。`pnpm test` 只跑纯逻辑模块，不需要 DOM，也不需要 Electron。

### 功能

**登录** 手机号 + 验证码 + 2FA，失败有明确提示；没有凭据时自动落到 mock 适配器，界面可直接打开。

**会话** 私聊 / 群 / 频道，未读数、最后一条消息预览、头像、时间。未读数是按服务端标记推导的，所以会话行、悬浮气泡和侧栏角标永远不会互相矛盾。

**消息** 历史分页（锚定插入，prepend 一页 0 px 漂移）、发送、回复、编辑、删除、转发、按会话持久化草稿、已读回执、typing 指示、日期分隔、未读分隔线、TL 实体（粗体 / 斜体 / 等宽 / 代码块 / 链接 / 剧透）。

**媒体** 图片与文件的上传/下载进度、缩略图；本地文件只以 `wx-media://f/<token>` 的形式交给渲染进程，渲染进程永远拿不到裸路径。图片和视频都在独立查看器窗口里打开（工具栏、滚轮缩放、Esc 关闭）。

**贴纸** 静态 WebP、TGS（Lottie，`DecompressionStream('gzip')` 解压）、WebM 视频三种格式都渲染；贴纸面板来自 `getInstalledStickerSets`。

**界面** 微信 4.x 皮肤，浅色 + 暗色；原生标题栏 overlay（32 px）；长列表用浮动滚动条（Chromium 原生滚动条会占布局，行会抖）；图标是从客户端 `Weixin.dll` 里抽出来的矢量。

### 架构

```
WeGram/
├─ apps/desktop/                 Electron 应用
│  ├─ src/main/                  主进程
│  │  ├─ telegram/adapter.ts     TelegramAdapter 接口（领域模型，与 TDLib JSON 解耦）
│  │  ├─ telegram/mock.ts        假数据适配器 —— UI 可以脱离协议层并行开发
│  │  ├─ telegram/tdlib/         唯一允许 import tdl / prebuilt-tdlib 的目录
│  │  ├─ ipc/                    通道路由 + zod 入参校验 + AppError 归一
│  │  ├─ media/                  wx-media:// 协议、token 注册表、图片尺寸探测
│  │  ├─ store/                  ui.db（草稿/主题/滚动位置）与 settings.json（只放代理）
│  │  └─ security/               safeStorage（Windows DPAPI）封装的凭据
│  ├─ src/preload/               window.tg 白名单桥（只认字面量通道名）
│  └─ src/renderer/              React 19 + Tailwind v4 界面
├─ packages/protocol/            IPC 契约：dto（zod）/ channels / errors
├─ docs/                         设计、交接与实测记录
├─ spikes/tdlib/                 TDLib 探针、真实 session（不提交）
└─ scripts/                      启动脚本
```

四条边界由 ESLint 强制，不是口头约定：

1. 只有 `src/main/telegram/tdlib/**` 可以 import `tdl` / `prebuilt-tdlib`；`node:sqlite` 只出现在 `main/store/ui-db.ts`。
2. 渲染进程拿不到原始 TDLib JSON。跨 IPC 的值先写进 `packages/protocol/src/dto.ts`，再实现。
3. 通道名只能是 `channels.ts` 里的字面量，禁止拼接；每个事件带 `seq`，渲染进程发现断号即重新同步。
4. 密码 / MTProxy secret 跨 IPC 只有 `'***'`，真正的密钥由主进程用 DPAPI 封装。

### 技术栈

| 层 | 选型 |
| --- | --- |
| Electron | 38 |
| UI | React 19、Tailwind v4、Zustand 5、TanStack Query 5、`@tanstack/react-virtual` |
| 动画贴纸 | `lottie-web`（仅渲染进程） |
| 协议 | TDLib，经 `tdl` 8 + `prebuilt-tdlib` |
| 本地 UI 状态 | `node:sqlite`（`ui.db`） |
| 构建 | electron-vite 4 / Vite 7 / TypeScript 5.9 |
| 校验 | ESLint 10、Prettier 3、Vitest 5 |

### 环境要求

- Windows 10/11 x64。目前只在 Windows 上验证过，其它平台没有测过。
- Node ≥ 22、pnpm 12（`packageManager` 已固定版本）。
- 自己的 `api_id` / `api_hash`：到 [my.telegram.org/apps](https://my.telegram.org/apps) 建一个应用。**不要**借用官方客户端或别人项目的凭据。
- 可选：可用的 SOCKS5 或 MTProxy。

### 快速开始

```powershell
pnpm install

# 不建 .env 也能跑：没有凭据时自动使用 mock 适配器
cd apps\desktop
pnpm web                 # 浏览器预览 http://localhost:5174（?perf=1 → 性能验收面板）
```

接真实账号：

```dotenv
# apps\desktop\.env（已 gitignore，不会提交）
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
WEGRAM_PROXY=socks5://127.0.0.1:7890
```

```powershell
cd apps\desktop
pnpm dev                 # Electron 开发窗口
```

或者用一键脚本（复用 `spikes\tdlib\data` 里已有的真实 session，代理默认 `socks5://127.0.0.1:7890`）：

```powershell
scripts\start-real.cmd          # out\ 不存在时先构建
scripts\start-real.cmd build    # 强制重建
```

日志落在 `.cache\app.log`。

> **本机 workaround**：这台机器的 Chromium 沙箱起不来（Windows Insider + Kaspersky），而且 Electron 必须脱离 agent shell 的 job object 启动，所以 `scripts\start-real.cmd` 走的是 `launch-detached.ps1 -NoSandbox`。这是本地环境妥协，**不要带进发布版**。

### 环境变量

| 变量 | 作用 |
| --- | --- |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | 真实 TDLib 凭据；缺省时自动落到 mock 适配器 |
| `WEGRAM_ADAPTER=mock` | 即使有凭据也强制 mock。做 UI 时用它，避免碰真实账号 |
| `WEGRAM_TDLIB_DIR` | session 目录覆盖；应用与 `tdlib:smoke` 共用 |
| `WEGRAM_PROXY` | 启动时的初始代理：`socks5://host:port`、`socks5://user:pass@host:port`、`mtproto://host:port?secret=…` |

### 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装依赖（`allowBuilds` 在 `pnpm-workspace.yaml` 里配置） |
| `pnpm verify` | **唯一验收口径**：lint → typecheck → test → build |
| `pnpm lint` | ESLint，含架构规则，0 warning |
| `pnpm typecheck` | protocol + 主进程/预加载 + 渲染进程 |
| `pnpm test` / `pnpm test:watch` | Vitest，纯逻辑模块 |
| `pnpm build` | electron-vite build → `apps/desktop/out` |
| `pnpm format` | Prettier 写入（`format:check` 只检查） |
| `pnpm dev` | 根目录等价于 `cd apps\desktop; pnpm dev` |
| `cd apps\desktop; pnpm web` | 仅渲染进程的浏览器预览 |
| `cd apps\desktop; pnpm tdlib:smoke` | 真实 TDLib 无头自检（getMe / getChats / 历史分页，只读） |
| `cd apps\desktop; pnpm ui:db-check` | `ui.db` 无头自检 |
| `pwsh apps\desktop\scripts\launch-detached.ps1 -NoSandbox -Mock` | 本机唯一能起 Electron 的方式（脱离 job object） |

### 验证过的数据

- 5000 条消息：60 fps；prepend 一页时锚定行漂移 **0.0 px**（Electron 内用 CDP 实测，`?perf=1` 面板可复现）。
- `tdlib:smoke` 在真实 session 上通过：`getMe`、会话列表、历史分页。
- 真实账号下才复现的三个缺陷（群组打开为空、`hasMore` 误判、窗口被遮挡时 rAF 被节流）已修复，记录见 `docs/HANDOFF.md`。

### 文档

| 文件 | 内容 |
| --- | --- |
| `docs/技术方案.md` | 权威设计（中文）：选型、架构、每个模块的决策 |
| `docs/HANDOFF.md` | 当前状态、硬规则、实测到的坑、下一步 |
| `docs/UI-HANDOFF.md` | 微信 4.x 的 token 与尺寸（实测）、图标来源、已知偏差 |
| `docs/REFACTOR-HANDOFF.md` | 文件拆分与机械约束、待办批次 |
| `spikes/tdlib/RESULTS.md` | TDLib 在 Windows 上的实测结论（打包硬约束） |
| `CLAUDE.md` / `AGENTS.md` | 编码规范与架构红线 |

### 明确不做

- **语音 / 视频通话**：Telegram 不走 TDLib 的公开 API，等于重写一套。
- **秘密聊天（E2E）**：TDLib 有类型但坑多，v1 不做，v2 再评估。
- **多账号**：v1 单账号。
- **移动端、朋友圈、小程序**：没有对应实体，硬塞只会两边都不像。

### 免责声明

- 个人自用 / 学习性质的项目，与 Telegram、腾讯均无关联，也未获其背书。
- "WeChat"、"微信" 是腾讯的商标；界面中取自客户端的图形资源仅用于本机个人使用，**不要分发**。
- 请使用自己在 my.telegram.org 申请的凭据。借用官方客户端或他人项目的 `api_id` / `api_hash` 违反 Telegram API 条款，会封号。
- `spikes/tdlib/data` 是真实账号的登录态，已被 gitignore：不要提交、不要外传；自动化测试里不要做写操作（发消息 / 删除 / 转发 / 标已读）。

### 许可证

仓库暂未附带开源许可证，默认保留所有权利。第三方组件（TDLib、Electron、React 等）各自遵循其原许可证。

---

## English

### What this is

WeGram is a personal Telegram desktop client: Telegram's official TDLib (`tdl` + `prebuilt-tdlib`) behind an Electron shell, dressed in the WeChat 4.x look. Every token and metric in the UI — rail and list widths, row height, bubble colours, radii, icons — was measured off the real WeChat client on this machine (see `docs/UI-HANDOFF.md`); none of it is guessed.

You sign in with your own account and see your real chats, groups and channels. It is not a demo shell.

- **Single account**: phone number + code + 2FA, session persisted by TDLib and reused on restart.
- **Built-in proxy**: SOCKS5 and MTProxy. On mainland networks a proxy is mandatory — without one `getChats` hangs.
- **Message storage belongs to TDLib**. This project does not re-implement a message table; only protocol-independent UI state (drafts, theme, scroll position) lives in `ui.db` (`node:sqlite`).

### Status

| Milestone | Scope | State |
| --- | --- | --- |
| W1 | Electron shell, `packages/protocol` IPC contract, mock adapter, real TDLib adapter with a manual auth state machine, SOCKS5/MTProxy, WeChat-style login screen and three-column shell | ✅ |
| W2 | Virtualised message list, anchored history paging, send / reply / edit / delete / forward, per-chat drafts, `ui.db` | ✅ |
| W3 | Photo and document send/receive with progress, the `wx-media://` media protocol, all three sticker formats (WebP / TGS / WebM), sticker picker, TL entity rendering, day and unread dividers, read receipts, typing indicator | ✅ |
| W3+ | Standalone media viewer window: zoom / rotate / save for photos, playback (speed, mute, timeline) for videos | ✅ |
| — | Search (global + in-chat), pin/mute, full settings page, NSIS installer | ⏳ pending |

`pnpm verify` is green: 21 test files, 195 cases. `pnpm test` covers pure modules only — no DOM, no Electron.

### Features

**Login** Phone number, code, 2FA, with explicit error messages. Without credentials the app silently falls back to the mock adapter, so the UI opens anyway.

**Chats** Direct chats, groups and channels with unread counts, last-message preview, avatars and timestamps. The unread count is derived from the server marker, so the chat row, the floating pill and the rail badge can never disagree.

**Messages** Anchored history paging (prepending a page moves the viewport by 0 px), send, reply, edit, delete, forward, per-chat drafts, read receipts, typing indicator, day separators, the unread divider, and TL entities (bold / italic / monospace / pre blocks / links / spoilers).

**Media** Upload and download progress for photos and files, plus thumbnails. Local files reach the renderer only as `wx-media://f/<token>` — it never sees a raw path. Photos and videos open in a standalone viewer window (toolbar, wheel zoom, Esc to close).

**Stickers** Static WebP, TGS (Lottie, gunzipped via `DecompressionStream('gzip')`) and WebM video stickers all render. The picker is backed by `getInstalledStickerSets`.

**Look** WeChat 4.x skin, light and dark; native title-bar overlay (32 px); floating overlay scrollbars on long panes (Chromium's native bars take a layout gutter, so rows re-flow whenever the bar appears); the chrome icons are vectors extracted from the client's own `Weixin.dll`.

### Architecture

```
WeGram/
├─ apps/desktop/                 Electron app
│  ├─ src/main/                  main process
│  │  ├─ telegram/adapter.ts     TelegramAdapter interface (domain model, decoupled from TDLib JSON)
│  │  ├─ telegram/mock.ts        fake adapter — lets the UI proceed without the protocol layer
│  │  ├─ telegram/tdlib/         the only folder allowed to import tdl / prebuilt-tdlib
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

### Tech stack

| Layer | Choice |
| --- | --- |
| Electron | 38 |
| UI | React 19, Tailwind v4, Zustand 5, TanStack Query 5, `@tanstack/react-virtual` |
| Animated stickers | `lottie-web` (renderer only) |
| Protocol | TDLib via `tdl` 8 + `prebuilt-tdlib` |
| Local UI state | `node:sqlite` (`ui.db`) |
| Build | electron-vite 4 / Vite 7 / TypeScript 5.9 |
| Checks | ESLint 10, Prettier 3, Vitest 5 |

### Requirements

- Windows 10/11 x64. Only Windows has been exercised; other platforms are untested.
- Node ≥ 22, pnpm 12 (pinned via `packageManager`).
- Your own `api_id` / `api_hash` from [my.telegram.org/apps](https://my.telegram.org/apps). Do **not** reuse an official client's or another project's credentials.
- Optional: a working SOCKS5 or MTProxy endpoint.

### Quick start

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

```powershell
cd apps\desktop
pnpm dev                 # Electron dev window
```

Or use the one-click launcher (reuses the real session in `spikes\tdlib\data`, default proxy `socks5://127.0.0.1:7890`):

```powershell
scripts\start-real.cmd          # builds first when out\ is missing
scripts\start-real.cmd build    # force a rebuild
```

Logs land in `.cache\app.log`.

> **Local workaround**: Chromium's sandbox cannot start on this machine (Windows Insider build + Kaspersky), and Electron must be launched outside the agent shell's job object, so `scripts\start-real.cmd` goes through `launch-detached.ps1 -NoSandbox`. That is a local compromise — never ship it.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | Real TDLib credentials; absent means the mock adapter |
| `WEGRAM_ADAPTER=mock` | Forces the mock even with credentials — use it for UI work that must not touch the real account |
| `WEGRAM_TDLIB_DIR` | Session directory override; shared by the app and `tdlib:smoke` |
| `WEGRAM_PROXY` | Initial proxy: `socks5://host:port`, `socks5://user:pass@host:port`, `mtproto://host:port?secret=…` |

### Commands

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

### Measured results

- 5000 messages at 60 fps; prepending a page moves the anchored row by **0.0 px** (measured in Electron over CDP; reproducible with the `?perf=1` panel).
- `tdlib:smoke` passes against the real session: `getMe`, chat list, history paging.
- Three defects that only reproduce on a real account — groups opening empty, a lying `hasMore`, and the visibility gate freezing while the window was occluded — are fixed; see `docs/HANDOFF.md`.

### Documentation

| File | Contents |
| --- | --- |
| `docs/技术方案.md` | Authoritative design (Chinese): choices, architecture, per-module decisions |
| `docs/HANDOFF.md` | Current state, hard rules, measured surprises, next steps |
| `docs/UI-HANDOFF.md` | WeChat 4.x tokens and metrics (measured), icon provenance, known deltas |
| `docs/REFACTOR-HANDOFF.md` | File split, mechanically enforced conventions, pending batches |
| `spikes/tdlib/RESULTS.md` | Measured TDLib behaviour on Windows (packaging constraints) |
| `CLAUDE.md` / `AGENTS.md` | Coding standards and architecture red lines |

### Deliberately out of scope

- **Voice/video calls**: Telegram does not expose them through TDLib's public API; it would mean rewriting the stack.
- **Secret chats (E2E)**: TDLib has the types but the pitfalls are expensive. Not in v1; revisit for v2.
- **Multiple accounts**: v1 is single-account.
- **Mobile, Moments, mini-programs**: no matching entities on the Telegram side.

### Disclaimer

- A personal, study-oriented project. Not affiliated with or endorsed by Telegram or Tencent.
- "WeChat" and "微信" are trademarks of Tencent. The chrome assets extracted from the client are for personal local use only — **do not redistribute them**.
- Use credentials you registered yourself at my.telegram.org. Reusing an official client's or another project's `api_id` / `api_hash` violates the Telegram API Terms and gets the app banned.
- `spikes/tdlib/data` holds a real account's session and is gitignored: never commit it, never share it, and never run write operations (send / delete / forward / mark-as-read) against it in automated tests.

### License

No open-source license is attached yet; all rights reserved by default. Third-party components (TDLib, Electron, React and the rest) keep their own licenses.

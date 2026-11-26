# WeGram

**Telegram 的内核，微信 4.x 的外观 —— Windows 桌面客户端**

[中文](README.md) · [English](README.en.md)

---

> ⚠️ **项目处于极早期阶段。** 这是一个还在开发中的自用客户端：功能、IPC 契约、数据结构和界面都可能随时变动，不保证向后兼容；安装包也还没有经过代码签名与安装验证。请不要把它当作日常可用的成品，也不要用重要账号来试。

## 这是什么

WeGram 是一个自用的 Telegram 桌面客户端：协议层用 Telegram 官方的 TDLib（`tdl` + `prebuilt-tdlib`），外壳是 Electron，界面则按本机微信 4.x 客户端的实测 token 与尺寸重建——栏宽、行高、气泡颜色、圆角、图标都来自对真实客户端的测量（见 `docs/HANDOFF.md` §5），不是凭印象画的。

登录的是你自己的账号，会话、群、频道都按 Telegram 的真实数据展示；它不是演示界面。

- **单账号**：手机号 + 验证码 + 两步验证，登录态由 TDLib 持久化，重启直接复用 session。
- **内置代理**：SOCKS5 / HTTP / MTProxy。国内网络下代理是刚需——没有代理 `getChats` 会直接挂住。
- **消息存储交给 TDLib** 自带的本地库，本项目不再造一套消息表；只有纯 UI 状态（草稿、主题、滚动位置）写进 `ui.db`（`node:sqlite`）。

## 进度

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| W1 | Electron 外壳、`packages/protocol` IPC 契约、mock 适配器、真实 TDLib 适配器（手动登录状态机）、SOCKS5/HTTP/MTProxy、微信风登录页与三栏布局 | ✅ |
| W2 | 虚拟化消息列表、锚定历史分页、发送/回复/编辑/删除/转发、按会话草稿、`ui.db` | ✅ |
| W3 | 图片与文件收发（含进度）、`wx-media://` 媒体协议、三种贴纸格式（WebP / TGS / WebM）、贴纸面板、TL 实体渲染、日期与未读分隔、已读回执、typing | ✅ |
| W3+ | 独立媒体查看器窗口：图片缩放/旋转/保存，视频播放（倍速、静音、时间轴） | ✅ |
| W3+ | 独立登录窗口：280×373 无边框窗口、扫码登录（TDLib QR）+ 手机号回退、首次登录直接进主界面、有登录记录时先过资料页 | ✅ |
| — | 搜索（全局 + 会话内）、置顶会话、完整设置页、签名安装包的安装验证 | ⏳ 待做 |

`pnpm verify` 当前全绿：38 个测试文件 / 322 个用例。`pnpm test` 只跑纯逻辑模块，不需要 DOM，也不需要 Electron。

## 功能

**登录** 像微信一样先开一个独立的小窗口：默认是 TDLib 的扫码登录（二维码在本地生成，扫完在手机上确认），扫不了时点「用手机号登录」回到验证码 + 2FA 表单。首次登录成功直接进主界面；以后启动时如果还处于登录状态，先显示头像与「进入 WeGram」资料页，点它才开主窗口。没有凭据时自动落到 mock 适配器，界面可直接打开（二维码 10 秒后自动确认）。

**会话** 私聊 / 群 / 频道，未读数、最后一条消息预览、头像、时间。未读数是按服务端标记推导的，所以会话行、悬浮气泡和侧栏角标永远不会互相矛盾。

**消息** 历史分页（锚定插入，prepend 一页 0 px 漂移）、发送、回复、编辑、删除、转发、按会话持久化草稿、已读回执、typing 指示、日期分隔、未读分隔线、TL 实体（粗体 / 斜体 / 等宽 / 代码块 / 链接 / 剧透）。

**媒体** 图片与文件的上传/下载进度、缩略图；本地文件只以 `wx-media://f/<token>` 的形式交给渲染进程，渲染进程永远拿不到裸路径。图片和视频都在独立查看器窗口里打开（工具栏、滚轮缩放、Esc 关闭）。

**贴纸** 静态 WebP、TGS（Lottie，`DecompressionStream('gzip')` 解压）、WebM 视频三种格式都渲染；贴纸面板来自 `getInstalledStickerSets`。

**小程序** 机器人发布的 Telegram Mini App 在自己的 560×780 窗口里打开：顶部是机器人名 + ⋯ + ×，下面是沙箱化的页面；回复键盘、内联键盘、机器人资料卡的「菜单」和 `t.me/<bot>/<app>` 链接都能进入。签名 URL 只在主进程，页面通过 `TelegramWebviewProxy` 调 `sendData` / `close` / `openLink`。

**界面** 微信 4.x 皮肤，浅色 + 暗色；原生标题栏 overlay（32 px）；长列表用浮动滚动条（Chromium 原生滚动条会占布局，行会抖）；图标是从客户端 `Weixin.dll` 里抽出来的矢量。

## 架构

```
WeGram/
├─ apps/desktop/                 Electron 应用
│  ├─ src/main/                  主进程
│  │  ├─ telegram/adapter.ts     重新导出 packages/adapter-contract 的接口（领域模型，与 TDLib JSON 解耦）
│  │  ├─ telegram/tdlib/         唯一允许 import tdl / prebuilt-tdlib 的目录
│  │  ├─ windows.ts              主窗口工厂、标题栏主题、外链白名单
│  │  ├─ ipc/                    通道路由 + zod 入参校验 + AppError 归一
│  │  ├─ media/                  wx-media:// 协议、token 注册表、图片尺寸探测
│  │  ├─ store/                  ui.db（草稿/主题/滚动位置）与 settings.json（只放代理）
│  │  └─ security/               safeStorage（Windows DPAPI）封装的凭据
│  ├─ src/preload/               window.tg 白名单桥（只认字面量通道名）
│  └─ src/renderer/              React 19 + Tailwind v4 界面
├─ packages/protocol/            IPC 契约：dto（zod）/ channels / errors
├─ packages/adapter-contract/    TelegramAdapter 接口 + 事件（两个适配器共用）
├─ packages/mock-adapter/        假数据适配器（fixtures / assets / traffic）—— UI 可以脱离协议层并行开发
├─ packages/mock-session/        假会话的纯规则（分页 / 已读 / 评论 / 列表顺序）
├─ packages/mock-fixtures/       演示账号数据（主进程 fake 与浏览器预览共用）
├─ docs/                         设计、交接与实测记录
├─ spikes/tdlib/                 TDLib 探针、真实 session（不提交）
└─ scripts/                      启动脚本
```

四条边界由 ESLint 强制，不是口头约定：

1. 只有 `src/main/telegram/tdlib/**` 可以 import `tdl` / `prebuilt-tdlib`；`node:sqlite` 只出现在 `main/store/ui-db.ts`。
2. 渲染进程拿不到原始 TDLib JSON。跨 IPC 的值先写进 `packages/protocol/src/dto.ts`，再实现。
3. 通道名只能是 `channels.ts` 里的字面量，禁止拼接；每个事件带 `seq`，渲染进程发现断号即重新同步。
4. 密码 / MTProxy secret 跨 IPC 只有 `'***'`，真正的密钥由主进程用 DPAPI 封装。

## 技术栈

| 层 | 选型 |
| --- | --- |
| Electron | 38 |
| UI | React 19、Tailwind v4、Zustand 5、TanStack Query 5、`@tanstack/react-virtual` |
| 动画贴纸 | `lottie-web`（仅渲染进程） |
| 协议 | TDLib，经 `tdl` 8 + `prebuilt-tdlib` |
| 本地 UI 状态 | `node:sqlite`（`ui.db`） |
| 构建 | electron-vite 4 / Vite 7 / TypeScript 5.9 |
| 校验 | ESLint 10、Prettier 3、Vitest 5 |

## 环境要求

- Windows 10/11 x64。目前只在 Windows 上验证过，其它平台没有测过。
- Node ≥ 22、pnpm 12（`packageManager` 已固定版本）。
- 自己的 `api_id` / `api_hash`：到 [my.telegram.org/apps](https://my.telegram.org/apps) 建一个应用（见下节）。
- 可选：可用的 SOCKS5 或 MTProxy。

## 快速开始

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

> 自己编译时用的 `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` 必须是你自己在 [my.telegram.org/apps](https://my.telegram.org/apps) 申请的凭据——发布版会在构建时把它们内联进主进程包。借用官方客户端或他人项目的 `api_id` / `api_hash` 违反 Telegram API 条款，会封号。

```powershell
cd apps\desktop
pnpm dev                 # Electron 开发窗口
```

或者用一键脚本（复用 `spikes\tdlib\data` 里已有的真实 session，代理默认 `socks5://127.0.0.1:7890`）：

```powershell
scripts\start-real.cmd          # out\ 不存在时先构建
scripts\start-real.cmd build    # 强制重建
scripts\start-test.cmd          # 连测试 DC（WEGRAM_TDLIB_TEST_DC=1，复用 spikes\tdlib\test-data）
```

日志落在 `.cache\app.log`。

> **本机 workaround**：这台机器的 Chromium 沙箱起不来（Windows Insider + Kaspersky），而且 Electron 必须脱离 agent shell 的 job object 启动，所以 `scripts\start-real.cmd` 走的是 `launch-detached.ps1 -NoSandbox`。这是本地环境妥协，**不要带进发布版**。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | 真实 TDLib 凭据；缺省时自动落到 mock 适配器 |
| `WEGRAM_ADAPTER=mock` | 即使有凭据也强制 mock。做 UI 时用它，避免碰真实账号 |
| `WEGRAM_TDLIB_DIR` | session 目录覆盖；应用与 `tdlib:smoke` 共用 |
| `WEGRAM_PROXY` | 开发用覆盖：显式指定时压过「跟随系统代理」，格式 `socks5://host:port`、`socks5://user:pass@host:port`、`http://host:port`、`mtproto://host:port?secret=…`。默认不设，客户端读 Windows 代理设置（含 PAC），没有就直连 |

## 命令

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

## 验证过的数据

- 5000 条消息：60 fps；prepend 一页时锚定行漂移 **0.0 px**（Electron 内用 CDP 实测，`?perf=1` 面板可复现）。
- `tdlib:smoke` 在真实 session 上通过：`getMe`、会话列表、历史分页。
- 真实账号下才复现的三个缺陷（群组打开为空、`hasMore` 误判、窗口被遮挡时 rAF 被节流）已修复，记录见 `docs/HANDOFF.md`。

## 文档

| 文件 | 内容 |
| --- | --- |
| `docs/技术方案.md` | 权威设计（中文）：选型、架构、每个模块的决策 |
| `docs/HANDOFF.md` | 唯一的一份交接文档：当前状态、硬规则、环境与命令、架构图、微信 4.x 的实测 token/尺寸与图标来源、实测到的坑、私聊缺口与 API 表、代码拆分与机械约束、下一步 |
| `spikes/tdlib/RESULTS.md` | TDLib 在 Windows 上的实测结论（打包硬约束） |
| `CLAUDE.md` / `AGENTS.md` | 编码规范与架构红线 |

## 明确不做

- **语音 / 视频通话**：Telegram 不走 TDLib 的公开 API，等于重写一套。
- **秘密聊天（E2E）**：TDLib 有类型但坑多，v1 不做，v2 再评估。
- **多账号**：v1 单账号。
- **移动端、朋友圈**：没有对应实体，硬塞只会两边都不像。（小程序已按 Telegram Mini App 支持。）

## 免责声明

- 个人自用 / 学习性质的项目，与 Telegram、腾讯均无关联，也未获其背书。

## 许可证

代码以 **MIT** 许可证发布，见 [LICENSE](LICENSE)。

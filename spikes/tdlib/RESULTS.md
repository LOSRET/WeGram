# Spike 1 结果:tdl + prebuilt-tdlib 可行性验证

**结论:通过。方案 A(TDLib)无阻塞项,无需切 Plan B。**

## 环境

| 项 | 值 |
|---|---|
| OS | Windows 10.0.26300 (AMD64) |
| Node | v24.22.1 |
| npm | 12.2.0 |
| 依赖版本 | `tdl@8.1.0`、`prebuilt-tdlib@0.1008070.0`、`@prebuilt-tdlib/win32-x64@0.1008070.0` |
| TDLib | **1.8.70**(commit `c8828d50`) |

## 验证项与结果

| 验证 | 脚本 | 结果 |
|---|---|---|
| `tdjson.dll` 随包下发、无需编译 | `probe.mjs` | ✅ 32.3 MB,路径 `node_modules/@prebuilt-tdlib/win32-x64/tdjson.dll` |
| 共享库加载耗时 | `probe.mjs` | ✅ 8.79 ms |
| 同步 `execute`(无需 api_id) | `probe.mjs` | ✅ `getOption(version)` → `1.8.70` |
| 原生 addon(`tdl.node`)可运行 | `probe.mjs` | ✅ 预编译版在包内,被 npm 拦截的 `install` 脚本无关紧要 |
| `update` 事件流 | `probe.mjs` | ✅ 收到 `authorizationStateWaitTdlibParameters` |
| `setTdlibParameters` → 本地建库 | `probe2-init.mjs` | ✅ 生成 `db.sqlite` + `-wal` + `-shm` + `td.binlog` |
| 状态机推进到手机号输入 | `probe2-init.mjs` | ✅ `→ authorizationStateWaitPhoneNumber` |

> `tdl@8.1.0` 的 `install` 脚本(`node-gyp-build`)被 npm 的 allowScripts 策略拦了,但包内自带
> `prebuilds/win32-x64/tdl.node`,该脚本只在没有预编译产物时才需要,因此**不影响使用**。
> 它基于 `node-addon-api`(N-API),ABI 稳定 —— 这一点对 Electron 很关键(见下)。

## 未验证(需要你自己的 api_id/api_hash)

`login.mjs` 已就绪,但必须由你在终端交互执行(验证码会发到你手机,不应经过我):

1. `https://my.telegram.org/apps` 创建应用,拿到 `api_id` / `api_hash`
2. `spikes/tdlib/.env` 写入 `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`
3. `node login.mjs`,输入手机号 + 验证码(+ 2FA 密码)
4. 再跑一次,若不再要验证码 → session 复用成功

## Spike 2 结果:真实登录 + session 复用

**结论:通过(2026-11-17,账号本人执行登录,验证方只复跑 session)。**

| 验证 | 方式 | 结果 |
|---|---|---|
| 手机号 → 验证码 → 2FA → session 落盘 | 用户本人交互执行 `login.mjs` | ✅ `data/db/db.sqlite` + WAL + `td.binlog` 生成,文件约 290KB |
| session 复用(重启不再要验证码) | 非交互复跑 `login.mjs`(stdin 关闭) | ✅ 直接 `authorizationStateWaitTdlibParameters → authorizationStateReady`,`[PASS] 已登录` |
| 应用侧走同一代码路径 | `apps/desktop/scripts/tdlib-smoke.ts`(`pnpm tdlib:smoke`) | ✅ `auth:ready`、`getMe()`、20 个会话(channel 6 / group 13 / private 1)、历史分页正常 |

### 实测发现(影响实现,已回写设计文档)

1. **没有代理时 `getChats` 会挂住**(连接从 `online` 掉到 `connecting`),`getMe()` 因为读本地库仍能成功 —— 看起来「已登录」但列表永远空。
   所以 `docs/技术方案.md` §6.4 的代理是**硬前置**,不是可选优化。实测可用:`socks5://127.0.0.1:7890`(本机 Clash 类客户端混合端口)。
2. **`getChatHistory` 的 `from_message_id = 0` 只返回本地缓存的最后一条**,不会触发服务器拉取(第一次 1 条,1ms 返回)。
   要拿真正的一页,必须锚定一个已存在的 message id:首屏用 `chat.last_message.id`,实测 50 条耗时 3.4s(首次联网)。
3. `offset` 为负数是「取比锚点**更新**的消息」(`offset=-49` 只返回 2 条),分页不能用它做向后翻页;应用层用 `offset: 0` + 「严格小于锚点 id」过滤,语义才稳定。
4. **`from_message_id` is exclusive (measured 2026-11-17 on the real account).**
   `getChatHistory(from = X, offset = 0)` answers with messages *strictly older* than
   `X` — it never includes the anchor itself (`from = 4975493120` answered
   `4974444544…`). Anchoring the first page on `chat.last_message.id` therefore drops
   the newest message, and `viewMessages` marks the wrong id as read: every chat kept
   an unread badge of at least "1" however often it was opened, while the official
   client cleared it on the first click. The first page must anchor on
   `last_message.id + 1`, and read marking must use `getChat`'s `last_message.id`
   directly. See `docs/HANDOFF.md` §6.1.

## 对项目的四个前置结论(打包阶段务必照做)

1. **DLL 必须从 asar 里解出来。** `tdjson.dll` 不能从 `app.asar` 内被 `LoadLibrary` 加载。
   electron-builder 需要 `asarUnpack: ["**/node_modules/@prebuilt-tdlib/**"]`。
2. **数据库目录必须用 `app.getPath('userData')`,不能用 `__dirname`。** asar 是只读的,
   TDLib 要在里面建 SQLite 并写 WAL。开发期也不要用相对路径,否则从不同 cwd 启动会分裂出多个 session。
3. **不需要 electron-rebuild。** `tdl.node` 是 N-API 产物,跨 Node/Electron 版本 ABI 稳定;
   但必须保证 Electron 是 x64(预编译只有 win32-x64)。
4. **TDLib 已经在用 WAL 模式**(`-wal`/`-shm` 已出现),不要再对 `ui.db` 之外的库做额外 PRAGMA;
   `ui.db` 自己开 WAL 即可,两者互不干扰。

## 复现方式

```powershell
cd spikes\tdlib
npm install tdl prebuilt-tdlib
node probe.mjs
node probe2-init.mjs
```

# UI handoff — WeChat 4.x alignment

Written 2026-11-17, at the end of the session that rebuilt the renderer against the
real WeChat 4.x desktop client. Read this together with `docs/HANDOFF.md` (project
state, hard rules) and `docs/技术方案.md` §9 (authoritative design, Chinese).

Status: **layout, colours, typography, chrome and dialogs match the client on this
machine**; ten of the chrome icons are WeChat's own vector artwork. Everything
listed in "Known deltas" is a deliberate, documented difference.

---

## 1. File map

| File | Role |
|---|---|
| `renderer/src/styles/index.css` | Rewritten. All design tokens + every component style. Single source of truth for colour/size. |
| `renderer/src/components/MainShell.tsx` | Three-column shell, owns the toast + app menu + settings dialog state. |
| `renderer/src/components/SideRail.tsx` | 61 px icon rail: avatar (connection dot), 聊天/通讯录/收藏/朋友圈, 手机/设置. The avatar is the account's real profile photo (`Self.avatarUrl`), initials until it arrives. All four sections are selectable; the selected tab swaps its outlined glyph for the filled one and is painted brand green, like the client. |
| `renderer/src/components/SectionPlaceholder.tsx` | The 收藏 / 朋友圈 pane: those two tabs switch the shell (and turn green) but the protocol has no data for them, so the pane says 收藏/朋友圈还没有接入 instead of a toast. |
| `renderer/src/components/ChatList.tsx` | Search pill + circular "+" (both inside the list column) + 65 px rows. Selecting the row that is already open toggles the conversation shut. Rows show the real chat photo when `ChatSummary.avatarUrl` is present, initials otherwise. |
| `renderer/src/components/contacts/ContactsList.tsx` | The 通讯录 column (§2.4): 26 px search, 35 px 通讯录管理 card, 36 px service rows, 54 px contact rows grouped by initial. |
| `renderer/src/components/contacts/ContactDetail.tsx` | The contact card: 60 px avatar, 微信号, 朋友资料 / 更多信息, and the three blue actions (发消息 / 语音聊天 / 视频聊天). |
| `renderer/src/lib/contacts.ts` | Private-chat filter + initial/grouping rules (pinyin via ICU collation; pure, unit-tested). |
| `renderer/src/components/OverlayScrollbar.tsx` | WeChat's floating scrollbar: a 6 px translucent pill drawn over the rows (hover/scroll/drag), so long lists get no layout gutter and nothing re-flows when it appears. Used by the chat list and the transcript. |
| `renderer/src/components/ChatPane.tsx` | 46 px header (title, typing, call/… buttons), watermark empty state, chat-info popover. |
| `renderer/src/components/MessageList.tsx` | Bubbles, real sender photos on both sides (own avatar on the right; `senderAvatarUrl`, `evt:avatars`, `Self.avatarUrl`), hover-only timestamp/read receipt, day + unread separators. |
| `renderer/src/components/message-list/CommentBar.tsx` | WeChat's 评论 N 条 bar under a bubble (design doc §9.8) — the handle, not the thread. In a channel post it is the bubble's last row instead. |
| `renderer/src/components/message-list/ChannelMeta.tsx` | A channel post's footer: eye + view count + time (+ 已编辑), inside the bubble or under a sticker. The channel composition itself is `styles/channel.css`. |
| `renderer/src/components/chat-pane/CommentPanel.tsx` | Telegram's discussion view: the full chat pane, sliding in from the right (250 ms, `COMMENT_PANEL_ANIM_MS` unmount delay), pinned post, comments drawn with `MessageRow` (scroll-up paging, session cache) and the chat composer's card at the bottom (`messages:sendComment`). Styles: `styles/comments.css`. |
| `renderer/src/components/Composer.tsx` | Bordered input card, toolbar under the text, attach menu, send button inside the card. A channel manages it through `onCollapse`: the channel composer shows a labelled 收起 button next to 发送 that puts the 服务号 bar back. |
| `renderer/src/components/chat-pane/ChannelBar.tsx` | A channel's bottom edge instead of the composer: WeChat's 服务号 card — 静音 always, plus the keyboard switch on the right when `chats:canPost` says this account may post (the switch swaps the card for the composer). A read-only channel keeps only 静音, and its message menu has no 回复. |
| `renderer/src/components/ExpressionPicker.tsx` | The composer's 表情/贴纸 panel: the client's 464 px card with 最近使用, the 10-column 所有表情 grid, a 搜索 tab and one tab per installed sticker set (with 下一页 paging). Picking an emoji inserts it at the caret; clicking a sticker sends it. |
| `renderer/src/lib/emoji.ts` | The Unicode emoji catalogue with Chinese names/keywords, search and the recent-row merge (pure, unit-tested). |
| `renderer/src/lib/pickerTabs.ts` | Tab-strip capacity/paging maths for the picker (pure, unit-tested). |
| `renderer/src/components/ContextMenu.tsx` | Exports `Popup` (positioned, closes on Escape/outside click) plus the message menu. |
| `renderer/src/components/AppMenu.tsx` | The rail "≡" menu: settings, theme, sign out, adapter caption. |
| `renderer/src/components/PlusMenu.tsx` | The list header's "+" card: 发起群聊 / 添加朋友 / 写笔记 with their payload glyphs (all three toast — none is in the protocol). |
| `renderer/src/components/Icon.tsx` | Payload re-exports, the design-system compass, and `TelegramLogo` — the Simple Icons roundel that serves as the rail's 聊天 tab, the login mark and the empty-pane watermark (tinted through `currentColor`). Also the three `*TabFilledIcon` selected-state glyphs, rebuilt from the outlined tab geometry because this build's payload set has no filled tab art (the cube's face seams are a mask, the compass's needle is an even-odd hole). |
| `renderer/src/components/WechatIcons.tsx` | **Generated** from `Weixin.dll` payloads — see §3. Never hand-edit; regenerate. |
| `renderer/src/screens/LoginWindow.tsx` | **The standalone login window** (`#login` route): self-drawn title strip (WeGram / 齿轮 / ×), the QR screen, the phone → code → 2FA fallback, the profile step with 进入 WeGram, footer links, proxy and help sheets. |
| `renderer/src/components/QrCode.tsx` | The login QR: `qrcode`'s matrix as one SVG path (350-ish dark modules in a single element), never themed. |
| `renderer/src/lib/qr.ts` | QR matrix + path helpers (pure, unit-tested). |
| `main/login-window.ts` | The login `BrowserWindow`: frameless 280×373, fixed size, centred on the primary work area, loads the renderer with `#login`, closes/re-focuses itself. |
| `renderer/src/components/viewer/MediaViewer.tsx` | **The standalone 图片和视频 window** (`#viewer` route): toolbar strip, photo canvas, 预览 board, 更多 menu, notice pill; picks the video canvas for a `video` item. |
| `renderer/src/components/viewer/VideoCanvas.tsx` | The video half: fitted `<video>`, the client's translucent player bar (play/pause, timeline, times, 倍速, mute), idle hiding, Space/←/→/M keys. |
| `renderer/src/components/viewer/ViewerIcons.tsx` | Toolbar glyphs (payload art) plus the traced 预览 and player glyphs (see §3). |
| `renderer/src/lib/zoom.ts` | Fit / zoom / rotate / pan-clamp maths (pure, unit-tested). |
| `renderer/src/lib/player.ts` | Player-bar maths: `playerClock`, `progressRatio`, `seekTarget`, `timeAtRatio`, `PLAYBACK_RATES` (pure, unit-tested). |
| `renderer/src/lib/viewer.ts` | Hand-off: `buildViewerStrip` collects one kind of media from the transcript and calls `viewer:open` (pure, unit-tested). |
| `main/viewer.ts` | Viewer `BrowserWindow`: creation, re-targeting, 置顶, title-strip repaint, 保存 target by kind. |
| `main/viewer-size.ts` | The measured 75 % × 90 % window size (pure, unit-tested). |
| `renderer/src/lib/format.ts` | List timestamps: `HH:MM` today, `昨天 HH:MM`, `星期X` within a week, then `MM/DD`. |
| `main/index.ts` | Window 1000×680 (min 880×600), `titleBarOverlay` height 32, colour `#e0e0e0` / `#2d2d2e`. |
| `components/TitleBar.tsx` | **Deleted** — the strip is now only the native overlay; settings moved to `AppMenu`. |

---

## 2. The measured design contract — do not re-derive it

Everything below was read off the running client: colours sampled with PIL, control
boxes measured from a screenshot, then converted to CSS px.

**How the numbers were obtained** (repeat this if a new reference is needed): the
display is 1920×1080 at **125% scaling**; DSH returns screenshots at 1366×768
(×0.7115), so **CSS px = screenshot px × 1.1245**. The WeChat window that was measured
sat at (276,105)–(1145,656) in that screenshot space.

| Token | Light | Dark |
|---|---|---|
| rail / title strip | `#e0e0e0` | `#2d2d2e` |
| conversation list | `#e7e7e9` | `#3b3b3d` |
| chat pane | `#fbfbfb` | `#1e1e1f` |
| composer card | `#fcfcfc` | `#1e1e1f` + 1 px `#2f2f30` border |
| 表情 panel / selected tab pill | `#fbfbfb` / `#ececec` | `#2f2f30` / `#3a3a3c` (inferred) |
| selected row | `#15ad70` | `#0da869` |
| incoming bubble | `#eeeef0` | `#2f2f30` |
| outgoing bubble | `#95ec69` | `#35d28d` |
| brand | `#07c160` | `#07c160` |
| search pill | `#fbfbfb` | `#454547` |
| text / secondary / tertiary | `#191919` / `#9a9a9a` / `#b7b7b7` | `#e1e1e5` / `#7b7b80` / `#7b7b80` |
| hairline / strong / pane line | `#ececec` / `#dedede` / `#f2f2f2` | `#2f2f30` / `#3a3a3c` / `#1e1e1f` (no header divider) |
| rail glyphs | `#5c5c5c` | `#969697` |
| pane-header + composer glyphs / list "+" | `#6f6f6f` / `#8a8a8a` | `#a5a5a5` / `#b1b1b1` |
| disabled fill / ink | `#ececec` / `#b7b7b7` | `#29292a` / `#6a6a6a` |

The **dark column was re-measured on 2026-11-18** (Windows dark mode) by capturing the
window with `PrintWindow(hwnd, dc, PW_RENDERFULLCONTENT)` and taking a pixel histogram of
each surface — see `docs/HANDOFF.md` "Non-obvious facts". It replaced an earlier dark
block that was a near-black scheme (`#191919` / `#1f1f1f` / `#111111`) with muted greens;
the real client lifts the surfaces instead and keeps the vivid light-theme accents. Note
the one oddity: dark mode has only two greys (#E1E1E5 and #7B7B80), so
`--wx-text-tertiary` equals `--wx-text-secondary` there — day labels, timestamps and the
search placeholder all sample #7B7B80.

| Metric | Value |
|---|---|
| title strip | 32 px (native overlay, same colour as the rail) |
| rail width | **61 px** (re-measured 2026-11-18: 54 screenshot px ÷ 0.889; the earlier 42 px was wrong), avatar 32 px (radius 8), 21–24 px glyphs, 48 px pitch |
| rail glyphs | ink at the 50 %-coverage contour: 通讯录 20 × 16, cube 16 × 18, 朋友圈 18 × 18, 手机 12 × 18, ≡ bars 14–16 wide. Core grey **#5a–#5d**: the client paints the rail at `#5c5c5c`, not the `#8a8a8a` it used to carry (the lighter grey reads thinner *and* smaller at the same line width). Token: `--wx-rail-icon`. Known residue: our ≡ payload (`#0158`) draws three equal 13 px bars in a 12 px block where the client draws 14 / 16 / 14 in 11 px, and 手机 measures 12 × 17 — payload proportions, not scale, so scaling only trades one error for the other. |
| list column | 238 px; header row 43 px; search pill 29 px tall, radius 5; rows 65 px |
| list avatar | 40 px, radius 6; title 14 px, preview 12 px, time 11 px |
| pane header | 46 px, title 15 px/500, left padding 18 |
| message avatar | 38 px, radius 6; gap to bubble 8 px; row padding-bottom 14 px |
| transcript inset | 22 px on **both** sides — the client measures 21–25 px, symmetric; the outgoing column used to sit 8 px from the edge. The 跳转到最新消息 pill shares this inset, so it lines up with the outgoing avatars |
| bubble | `padding: 8px 12px`, radius 6, font 14 px/1.45, max-width `min(560px, 66%)` |
| composer card | radius 8, 1 px `#ececec` border, margins 6/9 px; input min-height 84; toolbar 42 |
| channel bar (服务号 card) | card 54 px tall, radius 8, 1 px border, same 6/9 px margins; each menu item is a full-height equal-width segment (the whole segment is the hit target and its highlight fills the card edge to edge), keyboard glyph 20 px in a 46 px right strip. Reference (a 服务号 chat at this screenshot's scale): card ≈ 66 px tall, item text ≈ 17 px, glyph 20 px, the three items split the space left of the switch evenly; no divider before the switch |
| send button | 72×30, radius 4; disabled `#ececec` on tertiary text, enabled brand green |
| day separator | 12 px centred, no pill; message meta 11 px, hover-only |
| popup card | fill `#fafafa`, 6 px radius, 5 px padding; the ＋ card is 143×144 with 45 px rows |
| popup hover | **brand green `#07c160` fill with white label *and* white glyph** — measured on the ＋ card and confirmed on the rail menu; never a grey wash |
| overlay scrollbar | 6 px wide, `right: 2px`, radius 3, thumb `rgba(0,0,0,.22)` → `.38` when hovered/dragged (dark theme: white at the same alphas). Fades in on hover / for 900 ms after a wheel scroll. **No gutter**: rows keep their full width and the pill floats over them. |

`wx-list__plus` no longer draws its own circle — the button *is* WeChat's circle-plus
SVG, colour `--wx-icon-strong` (`#8a8a8a` / `#b1b1b1`).

### 2.1 The 图片和视频 window (added 2026-11-17)

Measured the same way, off a live viewer window (screenshot space 1366×768, CSS px =
×1.1245). The window sat at (93,17)–(1113,705): **1147 × 774 CSS px on a 1536×864
display**, i.e. 75 % of the screen width and 90 % of its height — *not* sized to the
photo, which was only 591 px wide with ~309 px gutters each side.

| Token / metric | Value |
|---|---|
| toolbar strip | 40 px, `#e6e6e6` (lighter than the shell's `#e0e0e0`), 1 px `#ececec` bottom line |
| canvas | `#f7f7f7`, **no padding**: a height-limited photo touches the toolbar and the bottom edge |
| buttons | 32 × 32, 8 px gap (40 px pitch), 18 px glyphs, 4 px radius, hover `rgba(0,0,0,.045)` |
| group dividers | 1 px × 18 px `#dedede`, 3 px either side (→ 54 px between groups) |
| first button | 45 px from the window edge |
| toolbar order | 📌 ｜ ← → ▦ ｜ ⊕ ⊖ 1:1 ｜ ↻ ｜ ⇩ ｜ … 更多 ｜ (native window controls) |
| 预览 board | the client docks it in its **own window** to the right; here it is a 268 px column of 4 × 62 px cells inside the viewer |
| 更多 menu | 复制 / 打印 / 转发… / 收藏 / 定位到聊天位置 / 使用系统默认方式打开; 132 px min width |
| active state | 置顶 and 预览 turn **brand green** — the only coloured glyphs in the strip |

Dark theme (**measured on a live dark viewer window, 2026-11-18**): bar `#3b3b3d` — the
conversation list's grey, and *lighter* than the canvas, the opposite of the light theme —
canvas `#242424`, toolbar glyphs `#b1b1b1`, group hairlines `#4f4f51`, and a 1 px `#2d2d2d`
line under the bar. That is why the viewer draws with `--wx-viewer-icon` /
`--wx-viewer-sep` instead of the general `--wx-text` / `--wx-line-strong`. The native
overlay is repainted from `main/viewer.ts` and must stay equal to `--wx-viewer-bar` or the
strip shows a seam.

**The video window is the same window** (the client titles both 图片和视频). Measured off
a second live window showing a 9:16 clip; the screenshot was 1538×978 and the CSS scale
is derived from the toolbar: the button pitch measures 50 screenshot px against our 40
CSS px, so **CSS px = screenshot px ÷ 1.25**.

| Token / metric | Value |
|---|---|
| window | **1230 × 782 CSS px** — 80 % of the 1536 px CSS screen width, the same 90 % height as the photo window; still created at 75 % here (delta 17) |
| toolbar | identical to the photo window (40 px, `#e6e6e6`), so the pin sits 45 px from the edge as measured |
| toolbar order | 📌 ｜ ← → ▦ ｜ ⇩ ｜ … ｜ window controls — **no zoom group, no rotate**; the 查看原视频 pill is left out (delta 18) |
| canvas | `#f7f7f7`, and the clip is fitted **by height with no padding** (410 × 728 CSS for a 9:16 clip in that window) |
| player bar | 40 px tall, **84 px from the left, 82 px from the right, 20 px above the bottom**, 8 px radius, `rgba(0,0,0,.45)` — over the `#f7f7f7` canvas it samples `#888888`, over the footage it darkens the frame |
| bar contents | ▶/❚❚ 32 px icon, elapsed `00:01` 13 px tabular, timeline (2 px track, played part white, 10 px white thumb), total `00:51`, 倍速 text button, speaker |
| bar behaviour | floats over the clip and hides after 2.4 s of playback without pointer movement; visible whenever it is paused, while the timeline is dragged and while the 倍速 menu is open |
| keyboard | Space / K play-pause, ←/→ seek ±5 s, M mute, Escape closes the menu / 预览 / window |

### 2.2 The login window (added 2026-11-18)

The client's login is a **separate window**, not a page inside the shell. Measured off
the two reference screenshots (366×487 and 365×487 at 125 % scaling, so **CSS px =
screenshot px ÷ 1.25**; both windows are 350×466 device px):

- **Window**: **280 × 373 CSS px**, frameless — the client draws its own × and has no
  minimise/maximise — centred in the work area, flat `#fafafa`, OS-rounded corners.
- **Title strip**: 32 px. `微信` at 12 px from the left, 14 px `#6e6e73`; gear and ×
  are 1.2 px `#4d4d4d` hairlines in 28 px hit boxes on a 44 px pitch (centres at 214 and
  258), 8 px from the right edge. The whole strip drags the window.
- **QR step**: QR 136 × 136 at (72, 80); green `扫码登录` 14 px `#00c375`, centred at
  y 255; footer link 14 px `#304b82`, centred at y 341.
- **Profile step**: avatar 80 × 80, radius 12, at (100, 70); name 16 px `#191919` at
  y 180; **168 × 36, radius 6, `#00c375`** button with 16 px white text at (56, 272);
  footer `切换账号 | 仅传输文件` at y 341, 1 px `#dedede` divider, 17 px gaps.
- Dark was **not** measured on the client; `--wx-login-*` follows the shell's scheme.

What we built: **the same QR step, driven by TDLib**. `requestQrCodeAuthentication`
yields a `tg://login?token=…` link (`AuthState.waitQr`), and the renderer encodes it
with the approved `qrcode` dependency into a 136 px SVG — near-black on white, never
inverted in dark mode. The footer's right link is `登录帮助` instead of `仅传输文件`;
the left one is `用手机号登录`, which rebuilds the TDLib auth client (`auth:reset`)
because TDLib cannot leave a pending QR confirmation. The gear opens the proxy
settings. **A user-driven sign-in ends in the shell; only a session restored at
startup shows the profile step** (WeChat's rule). Tokens are the `--wx-login-*`
block; code is `main/login-window.ts`, `screens/LoginWindow.tsx`,
`components/QrCode.tsx` and `lib/qr.ts` (`#login` hash of the same bundle).

### 2.3 The 表情 panel (added 2026-11-19)

Measured on the same client (screenshot space, same ×1.1245 conversion):

- **Card ≈464 × 464**, radius 8, `#fbfbfb`, no border, soft shadow. It floats above
  the input, **centred on the 表情 toolbar button**, with its bottom edge 18 px above
  the toolbar glyph centres (so it overlaps the input area but leaves the toolbar row
  visible). Because it follows the button, it **overhangs the conversation list** by
  ~200 px on the 1000 px window — the client does the same.
- Section labels **12 px `#9a9a9a`**, 22 px from the card's edge; 20 px above the
  first row, 8 px between a label and its grid. 最近使用 is one row of the same grid;
  所有表情 follows it.
- Emoji grid **10 columns × 44 px**, 12 px side inset; the art measures **24 px**.
- Tab strip **45 px** tall, 14 px inset, 5 px gaps, **44 px slots**; the selected pill is
  **32 × 32**, radius 7, `#ececec`. Order: **搜索 / 表情 / installed sets**, paged by
  **上一页 / 下一页** at the row's ends. The client pages the whole row rather than
  pinning 搜索/表情: on the last page its left arrow sits where the first tabs used to
  be (confirmed by the user's last-page screenshot). A window shows **eight tabs with
  one arrow** and **seven between two arrows**; the last page is clamped to the end and
  has only the left arrow, so 下一页 disappears there. Nine slots; the maths lives in
  `lib/pickerTabs.ts` and is unit-tested.
- The client shows **no scrollbar** in the card. The body hides the native one, and the
  grid columns are `1fr` so a bar appearing could never clip the tenth column.
- Every tab shows a **picture**, never a two-character label: TDLib's `getInstalledStickerSets`
  leaves `thumbnail` null for most sets but always ships `covers` (the set's first
  stickers), so the adapter resolves thumbnail → first sticker → `covers[0]` exactly like
  tdesktop's `lookupThumbnailDocument`. The tab paints that sticker's **static** thumbnail
  (a TGS/WebM pack still shows one frame at 28 px) and downloads it only when the tab is
  on screen — the two-character fallback remains for a set whose cover TDLib has not sent yet.

Dark has no measured counterpart for the card; it follows the shell's lifted
surfaces (`#2f2f30` card, `#3a3a3c` pill), which is what `--wx-picker` /
`--wx-tab-active` carry.

What we built: `ExpressionPicker.tsx` + `lib/emoji.ts`. Emoji are real Unicode
characters (a Telegram message carries text, not WeChat's closed emoticon set), so the
grid paints the same glyph the transcript will. 最近使用 persists in
`ui.db` → `app_settings['emoji.recent']` through `ui:getRecentEmoji` /
`ui:saveRecentEmoji`. Sticker sets come from `stickers:sets`; a set's stickers are
fetched by `stickers:set` only when its tab is opened and then cached for the life of
the panel.

**The installed list arrives in two steps.** TDLib answers
`getInstalledStickerSets` from its local cache first and reloads from the server
later (measured on the real account: 14 cached sets on a cold start, 192 about a
minute later, with `updateInstalledStickerSets` at the switch). The adapter now
emits `stickerSets`, which crosses IPC as `evt:stickerSets` and bumps
`stickerSetsVersion`; the picker refetches on that bump. Without it the panel kept
the 14-set cache for the whole session, which looked like "one page and the end".

A set's body leads with the pack's own name in the 最近使用 label style (the strip only
shows two characters of it) and its cells **play**: TGS through lottie-web, WebM through
`<video>`. The static thumbnail is the first paint — a still frame while the animation
downloads — never the artwork, because TDLib serves a WebP for an animated sticker's
thumbnail. Only cells that are on (or within 200 px of) the screen start downloading:
measured 24 of 120 cells on open, 40 after scrolling one screen. That gate measures
geometry directly as well as with `IntersectionObserver`, since Electron throttles
frame delivery while the window is occluded — the panel would otherwise sit on
spinners forever.

Missing against the client, on purpose: the **自定义表情** (heart) tab. Favourites are
TDLib custom-emoji sets, whose messages are custom-emoji *entities* rather than
stickers; the protocol has no send path for them yet, so the tab would be dead.

### 2.4 The 通讯录 (added 2026-11-19)

Measured off the user's own address book screenshot (1377×892 **physical** pixels at
125% scaling, so CSS px = screenshot px ÷ 1.25; the list column measured 238.4 CSS px —
the same 238 px this app uses, so no width change was needed).

| Metric | Value |
|---|---|
| list column | 238 px (same as the conversation list); background stays `--wx-list` |
| contacts header | 85 px: 12 top + **26 px search pill** + 12 + **35 px 通讯录管理 card** |
| 通讯录管理 card | full width minus 12 px side insets, radius 8, 16 px label, 21 px payload glyph (ink 18×15) |
| service rows | **36 px**, 16 px label, 12 px chevron at the left (16 px inset), count 13 px at the right (10 px inset) |
| group header | **30 px**, 13 px, 36 px left inset |
| contact row | **54 px**, 30 px avatar (radius 4), 36 px left inset, 8 px gap, 16 px name |
| detail card | fixed **310 px** wide, centred; 59 px top padding |
| detail avatar | **60 px**, radius 6; name 17 px/500; 微信号 14 px, 4 px below the 24 px name line |
| detail rules | 19 px below the header block; 1 px `#f0f0f0` |
| detail sections | 20 px top / 10 px bottom (更多信息 16); label 14 px; rows 24 px line-height, 72 px label column |
| detail actions | three 96 px columns, 11 px side insets (centres 59/155/251), 30 px above, 24 px glyph + 8 px gap + 14 px label |

Colour additions (light; the dark column is inferred from the shell, no dark contacts
window was measured): action blue **`#304b82`** (`--wx-link`, same ink as the
login links), section labels / chevrons / 微信号 **`#6e6e73`**
(`--wx-contact-muted`), trailing counts **`#9f9fa6`** (`--wx-contact-count`),
hairline **`#f0f0f0`** (`--wx-contact-rule`). A selected contact row is a neutral
**`rgba(0,0,0,.08)`** (`--wx-row-selected`), never the chat list's green.

The card's layout is exact: avatar top 91, header rule 170, 朋友资料 label 191, 备注 219,
更多信息 label 273, 来源 303, 添加时间 329, action icons 397 and labels 429 — all CSS px
from the window top. Our DOM measures 91 / 170 / 191 / 219 / 273 / 301 / 367 (actions
padding start) with the same section paddings. The one deliberate change is the second
更多信息 rows: Telegram has no 添加时间 / 来源, so 数据中心 (DC N, read from
the profile photo — 未知 without one) and 手机号 (with the leading + Telegram
omits) take their place.

---

## 3. Icon provenance (this is the part people get wrong)

**Where the real artwork came from.** `C:\Program Files\Tencent\Weixin\4.2.0.13\Weixin.dll`
embeds **2346 complete SVG documents as plain text** (`<svg viewBox="0 0 24 24">…`),
outlines already expanded to filled paths. They are not compressed and not obfuscated —
a byte scan for `<svg` finds all of them.

**Dead ends — do not repeat:**

- The DLL also contains a 618-entry **zip** (`PK\x03\x04` + central directory). It is
  the web bundle (`dist/*.bundle.js`, `*.css`), not icons.
- There **is** a 2615-entry manifest of asset names (UTF-16LE, sorted, e.g.
  `magnifying_glass_regular.svg`, `folder_medium.svg`, `gmike_on_regular.svg`) with a
  `u16` and a `u32` per record. Neither indexes the SVG payload block: solving
  `payload_offset − field` for five confidently identified icons gives five different
  bases, and the two copies of the manifest disagree. **No name→payload mapping is
  recoverable from this build.**
- The `:/gui/svg/...` strings (238 of them) are a runtime path table surrounded by
  pointer fields, not a static map.

**How the icons were actually picked.** Crop each icon out of the live client,
binarise to a 24×24 ink mask, render each candidate SVG at 24 px in a headless page,
compare with IoU, then confirm the top hit by eye. Scripts: `.cache/wxsvg/*.py`
(gitignored, regenerate as needed).

| Component | `Weixin.dll` payload | Component | payload |
|---|---|---|---|
| `ContactsTabIcon` | `#1213` | `PlusIcon` | `#1435` |
| `CubeTabIcon` | `#1268` | `EmojiIcon` | `#0717` |
| `DeviceIcon` | `#0498` | `FolderIcon` | `#0436` |
| `MenuIcon` | `#0158` | `MicIcon` | `#0768` |
| `SearchIcon` | `#0760` | `CallBubbleIcon` | `#1755` |
| `NewGroupIcon` (＋ menu) | `#0698` | `AddFriendIcon` (＋ menu) | `#1463` |
| `NoteIcon` (＋ menu) | `#0391` | `KeyboardIcon` (频道底栏) | `#1065` |

The 服务号 reference crop draws a small bump on top of the keyboard ring; the payload
set has no such variant (only the #1065 / #1097 weights), so the bump is treated as
the client's unread decoration and left out of the glyph. #1065 is the lighter of
the two, which is the weight the rest of the row uses.

`WechatIcons.tsx` is produced by `.cache/wxsvg/gen_icons.py`: drop `width`/`height`,
strip `style="…"`, `fill="black"` → `currentColor`, hyphenated attrs → JSX camelCase,
one element per line. Re-run it if the client updates and the artwork changes; the
script's `ICONS` list is the complete set (`KeyboardIcon` included — it was added by
hand once and was lost by a regeneration), and the committed file is what
`pnpm exec prettier --write` makes of the script's output.

**Not in that payload set, therefore replaced:** the rail "chats" tab and the
empty-pane watermark are now the Telegram roundel (`TelegramLogo`, Simple Icons,
CC0) instead of WeChat artwork — the tab carries it in brand green, the watermark
keeps the light grey.

**Icons matched off reference crops** (client crop → binarised ink mask → blurred
soft-IoU over all 2500 masks, best hit confirmed by eye; scripts
`.cache/wxsvg/refine.py`, `refine2.py`, `siblings.py`):

| Component | payload | Component | payload |
|---|---|---|---|
| `MoreIcon` (…) | `#0846` | `ScissorsIcon` | `#0859` |
| `CallIcon` (话机) | `#0300` | `ChevronDownIcon` | `#0555` (12×12) |
| `CubeTabIcon` (收藏: rail tab and composer) | `#1268` | `CallBubbleIcon` (was `#1755`, empty bubble) | `#1206` |

****The 通讯录 glyphs (2026-11-19).** Four more payloads, matched from the user's
address-book screenshot with the same Chamfer pass (`.cache/contacts_ref/match_icons.py`;
top hit confirmed by eye):

| Component | payload | viewBox | Notes |
|---|---|---|---|
| `ContactsManageIcon` (通讯录管理: person + second head) | `#0345` | 24 | outline sibling of `ContactsTabIcon` |
| `MessageOutlineIcon` (发消息: speech bubble) | `#0579` | 24 | the tail points down-left |
| `CallOutlineIcon` (语音聊天: handset) | `#0079` | 24 | not the filled `CallIcon` `#0300` |
| `VideoCallOutlineIcon` (视频聊天: camera) | `#0310` | 24 | rectangle + right-hand lens |

The service-row `›` and the 联系人 `⌄` are the existing `ChevronDownIcon` (`#0555`)
rotated −90°, not new artwork. The four are outline family; the composer's filled
`CallIcon` / `CallBubbleIcon` are different weights — do not swap them.

**The image-viewer toolbar is payload art too**** (2026-11-17, second pass). The earlier
"the viewer draws its own glyphs" note was wrong: eight of the nine buttons are in the
same 2345-document payload block. They were located by cropping each glyph out of a
native viewer screenshot, then walking the payload masks by eye — the preview glyphs
sit in one run around `#2335`–`#2345` (`image_*` / `picture_*`), the pin and the
download tray come from the `pushpin`/`download` families:

| Button | Payload | ViewBox | Notes |
|---|---|---|---|
| 置顶 pin | `#0531` (`pushpin_regular`) | 24 | same bell silhouette as the client |
| 上一张 / 下一张 | `#2344` / `#2336` (`image_arrow{left,right}_normal`) | 16 | long-tailed arrows |
| 放大 / 缩小 | `#2341` / `#2342` (`image_zoom{in,out}_normal`) | 16 | magnifier with ± |
| 原始大小 | `#2337` (`picture_original_normal`) | 16 | literally a "1:1" pill, *not* a frame with ticks |
| 旋转 | `#2340` (`image_rotate_normal`, mirrored twin of `#2338`) | 24 | `transform="scale(-1 1) translate(-24 0)"` is load-bearing |
| 保存 | `#0776` (`download_regular`) | 24 | tray + down arrow |
| 预览 (3×3 board) | **no payload** | — | one of the ~260 named assets the DLL does not carry; still traced |

All of these are filled `evenodd` outlines painted at `fill-opacity="0.9"` in the
client; `ViewerIcons.tsx` drops the opacity and fills with `currentColor` so the bar's
idle / hover / brand-green states still work.

**How the payload was chosen (repeatable).** The manifest order *does* track the payload
order — `magnifying_glass_regular.svg` sits at manifest index 759 and its payload is
`#0760`, i.e. offset +1 for the first ~770 entries — but the two sequences drift (the
manifest lists 2609 SVGs, the binary carries 2345), so by the preview block the offset
is ~+60 and per-index lookup is wrong. Identify by shape instead:
`.cache/wxsvg/match_native.py` crops the toolbar glyphs out of a native screenshot and
ranks all masks with a symmetric Chamfer distance on outer contours (style-agnostic:
filled and outlined twins score alike), then confirm the top hit with
`.cache/wxsvg/proof_sheet.py`, which prints native crop vs payload side by side. The
`viewer_chamfer.py` scores are only a shortlist — at 18 px the crops are too soft to
rank a magnifier above a filled dot on their own.

**Weight is per family, not per library.** Many glyphs ship as regular / medium /
heavy siblings that differ only in stroke (measured at 24-unit scale by
`.cache/wxsvg/erode_weight.py`: 1.12 / 1.38 / 1.88, with 0.88 and 1.62 in the
tails). Match the lightest sibling, otherwise one icon in a row reads visibly
bolder than its neighbours — the cube, scissors and call bubble had to be moved
down a weight for exactly that reason. Most other glyphs have a single weight
(smiley and folder sit at 1.38), so a row can only be as even as the library
allows. A plain `2A/P` estimate is not usable here: vertices and junctions inflate
it (it called the thin cube "heavier" than the smiley).

`MomentsTabIcon` uses the compass from WeChat's design-system SVG set
(`.cache/wxres/tabBar_icons_outlined_discover.svg`, ring + rhombus needle) because the
DLL's payload set has no compass with that needle.

**Dead end confirmed again, do not retry:** the manifest's per-name u32 is *not* a hash
with a lookup table — `scissor_regular`'s tag (8883670) occurs exactly once in the whole
DLL, at its own record. 2615 records, 2615 unique names, 2280 unique tags. No
name→payload map is recoverable from this build; match visually.

**`masks.npz` can be clobbered:** `render.py <file…>` rewrites the archive with only the
files named on the command line. When a mask disagrees with its `.svg` source, re-render
(`python render.py`) before trusting it.


**Licence:** the extracted artwork is Tencent's. Fine for this local clone, not for
redistribution — do not ship it in a package.

---

## 4. How to verify UI work

```powershell
pnpm typecheck && pnpm build
cd apps\desktop; pwsh scripts\launch-detached.ps1 -NoSandbox -Mock
# the login window opens first (280×373) on the QR screen; the mock confirms the
# QR after 10 s and the shell opens directly. 用手机号登录 goes to the form:
# +8613800000000 / 12345 / wegram, keyboard only, Enter after each step.
cd apps\desktop; pnpm web
# http://localhost:5174/#login → the login window; the plain URL is the shell
```

Then screenshot and compare with the reference crops. The comparison workflow that
worked: crop the same region from both screenshots, scale both to the same width,
paste side by side, read once. Reference crops live in `.cache/wxref` (gitignored).

Checklist used at the end of this session: rail icons, list header, row spacing and
colours, selected row, bubbles both sides, day/unread separators, composer card,
hover timestamp, context menu, delete confirm, forward sheet, sticker panel, app menu,
chat-info popover, settings dialog, dark mode, empty-pane watermark, login window (all three steps, profile step, proxy + help sheets, light and dark).

`pnpm web` (vite on :5174) is fine for CSS iteration, but **do not use it to judge the
pane**: Chrome's "save password" bubble appears after the preview login, sits over the
transcript, and DSH refuses clicks on it. Use the Electron window instead.

---

## 5. Known deltas vs the real client

1. **Composer toolbar**: ours has the client's five buttons in order — 表情, 收藏
   (cube), 文件夹, 剪刀 + chevron, 麦克风 — all from payloads. The smiley opens the
   expression panel (§2.3) on 表情; installed sticker sets are that panel's strip tabs,
   so there is no second expression entry in the toolbar. 收藏, 剪刀 and 麦克风 (and the
   scissors chevron) show a "not wired" toast: the cube is the same `#1268` payload the
   rail's 收藏 tab draws, and favourites have no protocol source yet (delta 3). An earlier
   pass had the cube open the panel on the first sticker set — that mislabelled a 收藏
   affordance as 贴纸 and looked like 收藏 opening 表情. The client's separate right-hand
   "语音输入" circle is **deliberately left out** — the send button sits right after the
   toolbar.
2. **Avatars are real where the protocol carries them, initials elsewhere.** The rail
   avatar, every chat row and now **every message row** load the account's/profile photo
   through `wx-media://` (`Self.avatarUrl`, `ChatSummary.avatarUrl`,
   `Message.senderAvatarUrl` / `evt:avatars`); subjects without a photo keep the coloured
   initial square. A sender's photo is downloaded in the background, so a row opened on a
   cold cache shows its initial for a moment and swaps in the picture when
   `evt:avatars` lands — that is the intended behaviour, not a missing image.
3. **通讯录 is built from private chats, not Telegram's address book.** The rail's
   通讯录 tab lists `chat.kind === 'private'` minus the Saved Messages conversation
   (`ChatSummary.userId === Self.id`), groups them by initial and shows the selected
   contact's card in the right pane (§2.4). 收藏 and 朋友圈 still have no data and toast.
   The client's service rows are kept for the silhouette: 公众号、服务号 counts channels;
   新的朋友 / 企业微信联系人 / 我的企业 / 通讯录管理 / 备注 / 语音聊天 / 视频聊天 /
   更多资料 toast.
4. **No pin (always-on-top) button** in the title strip; WeChat has one left of the
   window controls.
5. **Window controls** are the native `titleBarOverlay` buttons (~46 px each) versus
   WeChat's own ~30 px ones — height and colour match, widths do not.
6. **List column is a fixed 238 px**; WeChat lets you drag it.
7. **Search field filters the loaded chat list locally** — global search is still W4.
8. **Dark mode** is measured end to end (§2, re-done 2026-11-18): surfaces, accents, text
   greys, the rail/toolbar glyph greys and the disabled send button all sample the client's
   own ink — the shell *and* the standalone viewer window (§2.1) — and the app was verified
   next to the client in the Electron window. The only dark value still inferred is the link
   blue (`#576b95`, kept from the light theme).
9. **The brand mark is Telegram's, not WeChat's.** `TelegramLogo` in `Icon.tsx` is
   the Simple Icons roundel (`https://simpleicons.org/?q=telegram`, CC0 1.0) copied
   verbatim; the plane is a hole in the disc, so no white fill is painted. It is used
   three times: the rail's 聊天 tab (brand green while that tab is selected, like
   every other active tab), the login window's brand mark in `--wx-login-green` (the
   client's login green `#00c375`), and the empty-pane watermark in the light
   `#efefef` / `#222` it had before — the watermark stays low-contrast rather than
   becoming a green logo.
10. **Re-selecting the open conversation closes it; the rail now switches sections.**
    In the client, clicking the highlighted row does nothing; here it is a toggle: the
    right pane returns to the watermark state and the list keeps its search filter
    (requested 2026-11-17). The rail's four tabs are real section switches now
    (returning from 通讯录 keeps the previously open chat selected), not inert: the
    selected tab is filled brand green (`--wx-rail-icon-active`) as on the client, and
    收藏 / 朋友圈 switch to a placeholder pane because the protocol has no data for
    them (they used to raise the "还没有接入" toast). The client's filled tab payloads
    were not in the extracted set, so `Icon.tsx` rebuilds the three filled glyphs from
    the outlined geometry (see the file-map row). Closing the pane still flushes the
    reading anchor, so reopening the chat restores the same position.
11. **The header "+" opens WeChat's three-entry card, but none of the entries is
    wired.** 发起群聊 / 添加朋友 / 写笔记 match the client's menu down to the payload
    glyphs, and the card hangs centred under the round button 12 px below it
    (`Popup centerX`); the client's card measures 143×144 with 45 px rows. The
    protocol has no create-chat, contact-search or notes channel, so each entry only
    raises the same "还没有接入" toast as the rail's other sections. Settings, theme and
    sign-out stay behind the rail's "≡" button.
12. **Image viewer — two toolbar entries are missing on purpose.** The client's strip
    also carries 编辑 (a full picture editor) and the "用 AI 处理 / 提取文字、翻译等" block;
    neither has anything behind it here, so both are left out rather than shipped as
    dead buttons. Everything else in the strip works.
13. **Viewer glyphs are payload art, except 预览.** Eight of the nine buttons are the
    client's own SVG documents (§3.1): pin, both arrows, both magnifiers, the "1:1"
    pill, the rotate frame and the download tray. `ViewerIcons.tsx` carries them as
    filled `currentColor` paths. Only the 3×3 预览 board is traced — no payload for it
    exists in this build.
14. **预览 is a column, not a second window.** The client opens the thumbnail board in a
    separate window docked to the right of the viewer; ours is a 268 px column inside
    it, so the photo refits instead of hiding under the board. Cells paint
    `MessageMedia.minithumbnail` instantly; a photo without one is downloaded at
    priority 2 while the board is open.
15. **定位到聊天位置 keeps the viewer open.** The client closes the window and jumps in
    the chat; its viewer is an overlay *of* the chat window, so there is nothing to raise.
    Ours is a separate window, so the shell comes forward above it instead: the viewer
    sends `viewer:locate`, main `moveTop()`s and focuses the shell, then publishes
    `evt:locate`; the shell opens that conversation on that row (`messages:around` when
    the row is outside the loaded window) and flashes it for 1.6 s.

    **The viewer is a plain top-level window, not a child of the shell.** That is what
    makes our task bar match the client's screenshot: one WeGram button whose hover
    preview lists 微信 and 图片和视频. Windows groups by application, and an *owned*
    window lands in that same group anyway (measured: 3 windows of one process —
    1 unowned, 1 owned, 1 plain — read as "3 个运行窗口" under a single button), so
    ownership never bought anything there. What ownership did give for free is now
    explicit: the shell `hide()/show()`s the viewer with its own minimize/restore, and
    closes it when the shell closes (`window-all-closed` would otherwise never fire).
16. **The viewer's window controls are the native ones** (3 × 46 px), like the shell's
    (see delta 5), so 更多 sits ~25 px further from the right edge than in the client.
17. **One window size for both kinds.** The client's video window measures 80 % of the
    screen width against the photo window's 75 %; ours keeps a single size, because a
    strip can mix photos and videos and resizing the window mid-browse is worse than
    being 5 % narrower. `main/viewer-size.ts` is the one place to change it.
18. **The video strip has no 查看原视频 pill.** In the client that pill opens the
    uncompressed original, which exists because WeChat re-encodes whatever you send.
    TDLib hands this app a single file per video, so the pill would be a dead button —
    the 6.7 M of the reference clip has no counterpart here.
19. **The video opens in the viewer window, not in the bubble.** Clicking the bubble used
    to play inline with Chromium's native controls; it now opens 图片和视频 like a photo,
    which is why `VideoCanvas` owns the transport. 保存 writes the video to 视频 (the
    photo path still opens 图片), and 更多 hides 复制 / 打印 for videos: the clipboard
    holds bitmaps only, and Electron exposes no file-drop clipboard format.
20. **The video canvas never zooms or pans.** The zoom group, 1:1, rotate and the wheel
    listener are photo-only; a video is always fitted to the canvas.
21. **The login QR is generated locally from TDLib's link.** `requestQrCodeAuthentication`
    answers with `tg://login?token=…` (`AuthState.waitQr`, refreshed every few
    seconds); the approved `qrcode` dependency turns it into one SVG path. The token
    never leaves the app — no third-party QR service. Unit tests pin the matrix shape
    and the dark-module count; a real phone scan is still on the verification list
    (design doc §14). The code is deliberately **not** inverted in dark mode.
22. **The phone form is a fallback, and switching to it rebuilds the client.** TDLib
    refuses `setAuthenticationPhoneNumber` in `waitOtherDeviceConfirmation` and has no
    cancel call, so `auth:reset` destroys and recreates the auth client (nothing is
    stored yet). The phone entry can go back to the QR (`auth:qr`); once a
    code/password query is pending it cannot.
23. **First sign-in goes straight to the shell; a restored session shows the profile.**
    Main tracks `authInteracted`: a `ready` state after any QR/phone request opens the
    shell immediately and closes the login window (the profile step never lingers),
    while a session restored at startup stops on the avatar / 进入 WeGram screen. The
    mock cannot persist a session, so that path was exercised by temporarily making
    the mock start authorized.
24. **The login footer is `用手机号登录 | 登录帮助`.** WeChat's `仅传输文件` has no
    Telegram counterpart; the QR screen offers the phone fallback (a real need when
    no other device can scan) and the help sheet (proxy, code source, mock
    credentials). `切换账号` on the profile step really signs out.
25. **The login window's gear and × are hand-drawn.** The client's two glyphs are not in
    the recoverable payload set (§3), so `SettingsGearIcon` / `CloseIcon` are hand-drawn
    at the measured 1.2 px weight. Everything else in the window comes from
    `--wx-login-*` tokens, not literal colours.
26. **The 280×373 login window is fixed.** The client's window is the same size and also
    not resizable; ours is centred on the primary display every time (the client
    remembers where you left it) — one less piece of window state to persist.
27. **The contacts list is the Telegram address book, not the chat list.** It comes
    from `getContacts` + `getUser` (`contacts:list`), so a person with no conversation
    still appears and the list is no longer capped by the loaded chat page (the old
    design only saw the first 100 chats). `getContacts` has no paging: it returns every
    id at once, so the column still has no virtualiser (a few hundred rows are fine —
    the chat list already paints 526). Bots appear only if they were added to the
    address book; Telegram's real address book is the honest source.
28. **Chinese names get pinyin initials from ICU, not a pinyin table.** `contactInitial`
    compares the first Han character against 23 boundary characters ("阿" for A, "八"
    for B … "匝" for Z) with `Intl.Collator('zh-Hans-CN')`; the last boundary it sorts
    at/after is the section. That matches the client for ordinary names, but polyphones
    (重/长) and names whose pinyin differs from ICU's dictionary can land in a
    neighbouring letter; a real pinyin table would be the upgrade.
29. **The five service rows are WeChat's, not Telegram's.** 公众号、服务号 is the channel
    count; 企业微信联系人 and 我的企业 have no counterpart at all but are kept to preserve
    the client's silhouette (both toast). This follows the existing "＋ menu" convention:
    the shape is faithful, the action says 还没有接入.
30. **The contact card's Telegram号 is the Telegram username.** WeChat's 微信号 /
    来源 / 添加时间 do not exist in Telegram: the card shows `username` (or 未设置),
    数据中心 and 手机号. The DC is decoded from the profile photo's
    persistent file id (`tdlib/file-dc.ts`) because TDLib exposes no DC field; it is
    the DC the photo is stored on (Pyrogram documents the same trick as approximate),
    so a person without a photo shows 未知. TDLib hands the phone number over without
    the leading `+`; `formatPhone` adds it for display. 发消息 opens the private chat
    (`chats:openPrivate` creates it on first use) and switches back to 聊天;
    语音聊天 / 视频聊天 toast (no call path).
31. **The comment area is Telegram's discussion view, and it is adapted, not measured.**
    WeChat (reference shot, 2026-11-20) expands comments inline under the card; the
    owner asked for Telegram's logic instead, so 评论 N 条 only opens a full-pane panel
    that slides in from the right (250 ms). The comments themselves are the transcript's
    own rows (`MessageRow`) — avatar, sender, bubble, hover timestamp, media — and the
    bottom input is the chat composer's card, posting through `messages:sendComment`.
    Telegram's own view was not screenshot-measured here: the 46 px header follows the
    chat header, the 36 px post avatar follows the contact card, and the panel shows
    only the counters TDLib has (阅读 / 转发). Reactions (赞 / 在看 / 收藏) are a
    different model and are not drawn; there is no search icon in the header yet. The
    footer follows the official client's gate (`BottomControls::isJoinGroup`): when the
    account may not post, the composer is replaced by 加入讨论组 / 申请加入讨论组, and the
    input returns only after the join — sending never auto-joins.
32. **A channel post is one WeChat bubble, composed the way Telegram composes a post.**
    The owner's instruction (2026-11-20): "依旧是微信的气泡,但是像 Telegram 一样把图片、消息和
    评论嵌入到一块". A channel has one author, so a post reads as a single block instead of
    WeChat's photo-on-the-wallpaper + second caption bubble + separate 评论 card. WeChat's
    bubble itself stays — same fill, 6 px radius, avatar column, hover row for every other
    message — and only the block's inside changes: the media gets a 3 px inset of the
    bubble's own colour, the caption follows on the same surface, 评论 N 条 is the last row
    (hairline above, the bubble's own bottom corners, no card of its own), and the view
    counter with the time closes it (`ChannelMeta`). The hover timestamp is suppressed for
    channels: a channel post has no read receipt, and its counters are part of the post,
    the way Telegram shows them. Channel photos may grow to 420×480 (`MediaBubble`'s
    `maxWidth`/`maxHeight`); every other chat keeps WeChat's 240×300. Two measurements
    that were wrong on the first pass: the bubble's width is taken **from the media**
    (`channelMediaWidth` + the 3 px inset), otherwise a long caption wins the
    `fit-content` race and leaves a strip of empty bubble right of the picture; and the
    评论 row is `calc(100% + 2 × inset)` wide with negative margins — a `width: auto`
    button shrank to its label and read as a small control in the bubble's corner.
    Groups, private chats and the comment rows inside `CommentPanel` are untouched.

---

## 6. Suggested next steps, in order

1. ~~Finish the icon set while the DLL is still at 4.2.0.13~~ — done for the chrome:
   dots, handset, scissors + chevron, sticker cube and the dotted call bubble all come
   from payloads now. Left over: identify the client's sixth composer glyph (◎) and the
   voice-input circle, which has no payload. (The chats tab no longer needs one — it is
   the Telegram mark now.)
2. ~~通讯录 panel~~ — done 2026-11-19 (§2.4): the Telegram address book
   (`getContacts`) grouped by pinyin initial, the client's service rows and the
   contact card. Remaining follow-up: virtualise past ~300 contacts.
3. Chat-info popover → real side panel (members, mute/pin controls) — the protocol
   already has `muted`/`pinned`.
4. Global search overlay (W4) and in-chat search.
5. Pin button + draggable list width, if the client fidelity matters more than scope.
6. ~~Avatar photos once the DTO carries them~~ — done for the rail, the chat list and
   **the transcript's sender rows** (`Message.senderAvatarUrl` + `evt:avatars`;
   `components/message-list/senderAvatar.ts` owns the priority rule and is unit-tested).
   Next: a virtualised chat list (526 rows render at once on this account), and profile
   photos in the chat-info popover once that view exists.

---

## 7. Pitfalls that cost time

- **Electron single-instance.** Relaunching while an instance runs silently does
  nothing — the visible window keeps the *old* bundle. Always
  `windows close electron.exe` first, then launch.
- **Never start Electron from the agent shell** (job object → Chromium abort). Use
  `scripts/launch-detached.ps1`; it logs to `.cache/app.log` and spawns a
  WindowsTerminal wrapper. **Minimise** that window, do not close it — closing the
  console takes the app down with it.
- The agent shell's `pnpm web` background job is fine, but killing it stops HMR.
- The **mock adapter floods new messages** every few seconds (`(mock) 新消息 #n`) and
  the unread counters grow. That is the fixture, not a regression.
- **A hidden transcript is usually the visibility gate, not missing data.** Check
  `document.querySelector('[data-testid="message-scroller"]').className` — if it still
  has `wx-messages--pending` while `.wx-message-slot` rows exist, the messages are there
  and only the gate is stuck (Chromium throttles rAF while the window is occluded). The
  list now force-readies itself after 1 s; if it ever regresses, look at
  `restoreToAnchor` first.
- **A slow avatar is a slow tunnel, not slow code.** One 160 px photo measured 16 s on a
  flapping SOCKS connection and 65–230 ms on a healthy one. Check the proxy before
  touching the avatar pool.
- **A sender photo that never appears is usually "not queued", not "not drawn".** Rows
  read `message.senderAvatarUrl`, then `evt:avatars` keyed by user id (`userAvatars` in
  the store); a channel/anonymous-admin post reads the chat's `avatarUrl`. If a row keeps
  its initial, check that the id matches what the adapter keyed (`senderId` is 0 for
  `senderChatId` senders) before touching `senderAvatar.ts`.
- **The login window is a real second window.** Before a sign-in completes the shell
  does not exist, so closing the login window (its × / Alt+F4) quits the app through
  `window-all-closed`; after the hand-over the shell is the only window and signing out
  recreates the login window first, then closes the shell. If a run ever leaves two
  windows or none, check `syncWindowsToAuth` / `showMainWindow` in `main/index.ts`.
- **A pending QR confirmation cannot be cancelled in TDLib.** `setAuthenticationPhoneNumber`
  is refused in `waitOtherDeviceConfirmation` and there is no cancel call; the phone
  link therefore restarts the client (`auth:reset`). Do not "optimise" that into a
  direct phone submit — it fails at the TDLib boundary.
- Login needs three submits; the field is re-focused after each step only because of
  the focus effect in `LoginWindow.tsx` — if it regresses, typing stops going anywhere.
- The reference screenshots and comparison PNGs are in `.cache` and therefore
  gitignored; the numbers above are the durable part.

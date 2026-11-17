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
| `renderer/src/components/SideRail.tsx` | 61 px icon rail: avatar (connection dot), 聊天/通讯录/收藏/朋友圈, 手机/设置. The avatar is the account's real profile photo (`Self.avatarUrl`), initials until it arrives. The 聊天 tab is the Telegram mark in brand green. |
| `renderer/src/components/ChatList.tsx` | Search pill + circular "+" (both inside the list column) + 65 px rows. Selecting the row that is already open toggles the conversation shut. Rows show the real chat photo when `ChatSummary.avatarUrl` is present, initials otherwise. |
| `renderer/src/components/OverlayScrollbar.tsx` | WeChat's floating scrollbar: a 6 px translucent pill drawn over the rows (hover/scroll/drag), so long lists get no layout gutter and nothing re-flows when it appears. Used by the chat list and the transcript. |
| `renderer/src/components/ChatPane.tsx` | 46 px header (title, typing, call/… buttons), watermark empty state, chat-info popover. |
| `renderer/src/components/MessageList.tsx` | Bubbles, own avatar on the right, hover-only timestamp/read receipt, day + unread separators. |
| `renderer/src/components/Composer.tsx` | Bordered input card, toolbar under the text, attach menu, send button inside the card. |
| `renderer/src/components/ContextMenu.tsx` | Exports `Popup` (positioned, closes on Escape/outside click) plus the message menu. |
| `renderer/src/components/AppMenu.tsx` | The rail "≡" menu: settings, theme, sign out, adapter caption. |
| `renderer/src/components/PlusMenu.tsx` | The list header's "+" card: 发起群聊 / 添加朋友 / 写笔记 with their payload glyphs (all three toast — none is in the protocol). |
| `renderer/src/components/Icon.tsx` | Payload re-exports, the design-system compass, and `TelegramLogo` — the Simple Icons roundel that serves as the rail's 聊天 tab, the login mark and the empty-pane watermark (tinted through `currentColor`). |
| `renderer/src/components/WechatIcons.tsx` | **Generated** from `Weixin.dll` payloads — see §3. Never hand-edit; regenerate. |
| `renderer/src/screens/LoginScreen.tsx` | WeChat-style centred card, brand watermark, `autocomplete=off`, caret restored after each step. |
| `renderer/src/components/viewer/MediaViewer.tsx` | **The standalone 图片和视频 window** (`#viewer` route): toolbar strip, photo canvas, 预览 board, 更多 menu, notice pill; picks the video canvas for a `video` item. |
| `renderer/src/components/viewer/VideoCanvas.tsx` | The video half: fitted `<video>`, the client's translucent player bar (play/pause, timeline, times, 倍速, mute), idle hiding, Space/←/→/M keys. |
| `renderer/src/components/viewer/ViewerIcons.tsx` | Toolbar glyphs (payload art) plus the traced 预览 and player glyphs (see §3). |
| `renderer/src/lib/zoom.ts` | Fit / zoom / rotate / pan-clamp maths (pure, unit-tested). |
| `renderer/src/lib/player.ts` | Player-bar maths: `playerClock`, `progressRatio`, `seekTarget`, `timeAtRatio`, `PLAYBACK_RATES` (pure, unit-tested). |
| `renderer/src/lib/viewer.ts` | Hand-off: `buildViewerStrip` collects one kind of media from the transcript and calls `viewer:open` (pure, unit-tested). |
| `main/viewer.ts` | Viewer `BrowserWindow`: creation, re-targeting, 置顶, title-strip repaint, 保存 target by kind. |
| `main/viewer-size.ts` | The measured 75 % × 90 % window size (pure, unit-tested). |
| `renderer/src/lib/format.ts` | List timestamps: `HH:MM` today, `昨天 HH:MM`, `星期X` within a week, then `MM/DD`. |
| `main/index.ts` | Window 1000×680 (min 880×600), `titleBarOverlay` height 32, colour `#e0e0e0` / `#191919`. |
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
| rail / title strip | `#e0e0e0` | `#191919` |
| conversation list | `#e7e7e9` | `#1f1f1f` |
| chat pane | `#fbfbfb` | `#111111` |
| composer card | `#fcfcfc` | `#1a1a1a` |
| selected row | `#15ad70` | `#1f5c44` |
| incoming bubble | `#eeeef0` | `#2c2c2c` |
| outgoing bubble | `#95ec69` | `#3eb575` |
| brand | `#07c160` | — |
| text / secondary / tertiary | `#191919` / `#9a9a9a` / `#b7b7b7` | `#d6d6d6` / `#8a8a8a` / `#6f6f6f` |
| hairline / strong / pane line | `#ececec` / `#dedede` / `#f2f2f2` | `#262626` / `#333333` / `#1f1f1f` |

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
| send button | 72×30, radius 4; disabled `#ececec` on tertiary text, enabled brand green |
| day separator | 12 px centred, no pill; message meta 11 px, hover-only |
| popup card | fill `#fafafa`, 6 px radius, 5 px padding; the ＋ card is 143×144 with 45 px rows |
| popup hover | **brand green `#07c160` fill with white label *and* white glyph** — measured on the ＋ card and confirmed on the rail menu; never a grey wash |
| overlay scrollbar | 6 px wide, `right: 2px`, radius 3, thumb `rgba(0,0,0,.22)` → `.38` when hovered/dragged (dark theme: white at the same alphas). Fades in on hover / for 900 ms after a wheel scroll. **No gutter**: rows keep their full width and the pill floats over them. |

`wx-list__plus` no longer draws its own circle — the button *is* WeChat's circle-plus
SVG, colour `#8a8a8a`.

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

Dark theme: bar `#1f1f1f`, canvas `#141414`, symbols `#d6d6d6` (the native overlay is
repainted from `main/viewer.ts`).

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
| `NoteIcon` (＋ menu) | `#0391` | | |

`WechatIcons.tsx` is produced by `.cache/wxsvg/gen_icons.py`: drop `width`/`height`,
strip `style="…"`, `fill="black"` → `currentColor`, hyphenated attrs → JSX camelCase,
one element per line. Re-run it if the client updates and the artwork changes.

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
| `StickerCubeIcon` (贴纸 cube) | `#1268` | `CallBubbleIcon` (was `#1755`, empty bubble) | `#1206` |

**The image-viewer toolbar is payload art too** (2026-11-17, second pass). The earlier
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
# login: +8613800000000 / 12345 / wechatgram  (keyboard only, Enter after each step)
```

Then screenshot and compare with the reference crops. The comparison workflow that
worked: crop the same region from both screenshots, scale both to the same width,
paste side by side, read once. Reference crops live in `.cache/wxref` (gitignored).

Checklist used at the end of this session: rail icons, list header, row spacing and
colours, selected row, bubbles both sides, day/unread separators, composer card,
hover timestamp, context menu, delete confirm, forward sheet, sticker panel, app menu,
chat-info popover, settings dialog, dark mode, empty-pane watermark, login card.

`pnpm web` (vite on :5174) is fine for CSS iteration, but **do not use it to judge the
pane**: Chrome's "save password" bubble appears after the preview login, sits over the
transcript, and DSH refuses clicks on it. Use the Electron window instead.

---

## 5. Known deltas vs the real client

1. **Composer toolbar**: ours now has the client's five buttons in order — 表情, 贴纸
   (cube), 文件夹, 剪刀 + chevron, 麦克风 — all from payloads. The smiley and the cube
   both open the sticker panel because there is no emoji picker yet; folder opens a
   photo/file menu, scissors and mic show a "not wired" toast. The client's separate
   right-hand "语音输入" circle is **deliberately left out** — the send button sits
   right after the toolbar.
2. **Avatars are real where the protocol carries them, initials elsewhere.** The rail
   avatar and every chat row now load the account's/profile photo through
   `wx-media://` (`Self.avatarUrl`, `ChatSummary.avatarUrl`); the rows without a photo
   keep the coloured initial square. **Message rows still draw initials** — `Message` has
   no sender-photo field (see `docs/HANDOFF.md` "Known gaps" 11).
3. **Rail sections other than 聊天** only raise a toast. 通讯录 is cheap to build from
   `chat.kind === 'private'`; 收藏 and 朋友圈 have no data at all.
4. **No pin (always-on-top) button** in the title strip; WeChat has one left of the
   window controls.
5. **Window controls** are the native `titleBarOverlay` buttons (~46 px each) versus
   WeChat's own ~30 px ones — height and colour match, widths do not.
6. **List column is a fixed 238 px**; WeChat lets you drag it.
7. **Search field filters the loaded chat list locally** — global search is still W4.
8. **Dark mode** tokens exist and were exercised, but the rail icon grey (`#8a8a8a`) was
   only tuned for light mode.
9. **The brand mark is Telegram's, not WeChat's.** `TelegramLogo` in `Icon.tsx` is
   the Simple Icons roundel (`https://simpleicons.org/?q=telegram`, CC0 1.0) copied
   verbatim; the plane is a hole in the disc, so no white fill is painted. It is used
   three times: the rail's 聊天 tab in `--wx-brand` (`#07c160`), the login card in the
   same green, and the empty-pane watermark in the light `#efefef` / `#222` it had
   before — the watermark stays low-contrast rather than becoming a green logo.
10. **Re-selecting the open conversation closes it.** In the client, clicking the
    highlighted row does nothing; here it is a toggle: the right pane returns to the
    watermark state and the list keeps its search filter (requested 2026-11-17). The
    rail's 聊天 tab stays inert, as in the client. Closing the pane still flushes the
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
15. **定位到聊天位置 only closes the viewer.** Scrolling the transcript to a given
    message needs a "locate message" channel the protocol does not have yet; closing the
    window hands focus back to the chat, which is where the photo came from.
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

---

## 6. Suggested next steps, in order

1. ~~Finish the icon set while the DLL is still at 4.2.0.13~~ — done for the chrome:
   dots, handset, scissors + chevron, sticker cube and the dotted call bubble all come
   from payloads now. Left over: identify the client's sixth composer glyph (◎) and the
   voice-input circle, which has no payload. (The chats tab no longer needs one — it is
   the Telegram mark now.)
2. 通讯录 panel: reuse `ChatList` with private chats only, grouped by initial.
3. Chat-info popover → real side panel (members, mute/pin controls) — the protocol
   already has `muted`/`pinned`.
4. Global search overlay (W4) and in-chat search.
5. Pin button + draggable list width, if the client fidelity matters more than scope.
6. ~~Avatar photos once the DTO carries them~~ — done for the rail and the chat list.
   Next: sender avatars in the transcript (needs a photo id on `Message`), and a
   virtualised chat list (526 rows render at once on this account).

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
  touching `prefetchChatAvatars`.
- Login needs three submits; the field is re-focused after each step only because of
  the fix in `LoginScreen.tsx` — if it regresses, typing stops going anywhere.
- The reference screenshots and comparison PNGs are in `.cache` and therefore
  gitignored; the numbers above are the durable part.

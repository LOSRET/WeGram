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
| `renderer/src/components/SideRail.tsx` | 42 px icon rail: avatar (connection dot), 聊天/通讯录/收藏/朋友圈, 手机/设置. |
| `renderer/src/components/ChatList.tsx` | Search pill + circular "+" (both inside the list column) + 65 px rows. |
| `renderer/src/components/ChatPane.tsx` | 46 px header (title, typing, call/… buttons), watermark empty state, chat-info popover. |
| `renderer/src/components/MessageList.tsx` | Bubbles, own avatar on the right, hover-only timestamp/read receipt, day + unread separators. |
| `renderer/src/components/Composer.tsx` | Bordered input card, toolbar under the text, attach menu, send button inside the card. |
| `renderer/src/components/ContextMenu.tsx` | Exports `Popup` (positioned, closes on Escape/outside click) plus the message menu. |
| `renderer/src/components/AppMenu.tsx` | The rail "≡" menu: settings, theme, sign out, adapter caption. |
| `renderer/src/components/Icon.tsx` | Hand-drawn remainder (two-tone chat tab, voice-input circle, watermark) **and** re-exports of the generated set. |
| `renderer/src/components/WechatIcons.tsx` | **Generated** from `Weixin.dll` payloads — see §3. Never hand-edit; regenerate. |
| `renderer/src/screens/LoginScreen.tsx` | WeChat-style centred card, brand watermark, `autocomplete=off`, caret restored after each step. |
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
| rail width | 42 px, avatar 32 px (radius 8), 26 px icons, 48 px pitch |
| list column | 238 px; header row 43 px; search pill 29 px tall, radius 5; rows 65 px |
| list avatar | 40 px, radius 6; title 14 px, preview 12 px, time 11 px |
| pane header | 46 px, title 15 px/500, left padding 18 |
| message avatar | 38 px, radius 6; gap to bubble 8 px; row padding-bottom 14 px |
| bubble | `padding: 8px 12px`, radius 6, font 14 px/1.45, max-width `min(560px, 66%)` |
| composer card | radius 8, 1 px `#ececec` border, margins 6/9 px; input min-height 84; toolbar 42 |
| send button | 72×30, radius 4; disabled `#ececec` on tertiary text, enabled brand green |
| day separator | 12 px centred, no pill; message meta 11 px, hover-only |

`wx-list__plus` no longer draws its own circle — the button *is* WeChat's circle-plus
SVG, colour `#8a8a8a`.

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

**How the ten icons were actually picked.** Crop each icon out of the live client,
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

`WechatIcons.tsx` is produced by `.cache/wxsvg/gen_icons.py`: drop `width`/`height`,
strip `style="…"`, `fill="black"` → `currentColor`, hyphenated attrs → JSX camelCase,
one element per line. Re-run it if the client updates and the artwork changes.

**Not in that payload set, therefore hand-drawn in `Icon.tsx`:** the two-tone rail
"chats" tab (red bubble with dots over a green bubble — the payloads are monochrome,
and only an empty bubble exists) and the empty-pane watermark logo.

**Icons matched off reference crops** (client crop → binarised ink mask → blurred
soft-IoU over all 2500 masks, best hit confirmed by eye; scripts
`.cache/wxsvg/refine.py`, `refine2.py`, `siblings.py`):

| Component | payload | Component | payload |
|---|---|---|---|
| `MoreIcon` (…) | `#0846` | `ScissorsIcon` | `#0859` |
| `CallIcon` (话机) | `#0300` | `ChevronDownIcon` | `#0555` (12×12) |
| `StickerCubeIcon` (贴纸 cube) | `#1268` | `CallBubbleIcon` (was `#1755`, empty bubble) | `#1206` |

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
2. **Avatars are colour placeholders with initials.** The protocol has no avatar URL
   (`ChatSummary`/`Self` carry no photo field); adding one means extending
   `packages/protocol/src/dto.ts` and both adapters.
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
9. The empty-pane watermark is drawn, not extracted (WeChat's is a logo, not in the
   icon payload set).

---

## 6. Suggested next steps, in order

1. ~~Finish the icon set while the DLL is still at 4.2.0.13~~ — done for the chrome:
   dots, handset, scissors + chevron, sticker cube and the dotted call bubble all come
   from payloads now. Left over: identify the client's sixth composer glyph (◎), and
   the two-tone chats tab / voice-input circle, which have no payload.
2. 通讯录 panel: reuse `ChatList` with private chats only, grouped by initial.
3. Chat-info popover → real side panel (members, mute/pin controls) — the protocol
   already has `muted`/`pinned`.
4. Global search overlay (W4) and in-chat search.
5. Pin button + draggable list width, if the client fidelity matters more than scope.
6. Avatar photos once the DTO carries them.

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
- Login needs three submits; the field is re-focused after each step only because of
  the fix in `LoginScreen.tsx` — if it regresses, typing stops going anywhere.
- The reference screenshots and comparison PNGs are in `.cache` and therefore
  gitignored; the numbers above are the durable part.

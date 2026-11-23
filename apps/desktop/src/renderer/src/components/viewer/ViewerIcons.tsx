import type { ReactNode, SVGProps } from 'react'

/**
 * Glyphs for the 图片和视频 toolbar and its player bar.
 *
 * Eight of the nine toolbar glyphs are the client's own artwork: the payloads were
 * cut out of `Weixin.dll` with the §3 pipeline (byte-scan `<svg`, then match the
 * live window's glyphs against every payload). The component → payload table lives
 * in `docs/HANDOFF.md` §5.12, so a client update only needs a re-run of that
 * table, not new tracing.
 *
 * Two groups are traces, because this build has no payload for them: 预览
 * (`GridIcon`, one of the ~260 named assets the DLL does not carry — measured off
 * a 4× crop at 1.5/24) and the four player glyphs 播放/暂停/音量 (`PlayIcon`,
 * `PauseIcon`, `VolumeIcon`, `MutedIcon`) — the video window's bar sits on top of
 * arbitrary footage at 45 % black, so those are plain geometry: a triangle, two
 * bars, a speaker with one wave, the same speaker struck through.
 *
 * The payloads are filled outlines (`fill-rule="evenodd"`), not strokes; the
 * client paints them at `fill-opacity="0.9"`, which is dropped here so the bar
 * can drive them with `currentColor` (idle / hover / brand-green when active).
 * The player glyphs use white `currentColor` for the same reason.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Glyph({
  size = 19,
  viewBox = '0 0 24 24',
  children,
  ...rest
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** 置顶 — WeChat payload `pushpin_regular` (#0531). */
export function PinIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M12.7499 19.5078C12.7499 19.8347 12.71 20.1604 12.6308 20.4775L12.3876 21.4482C12.2863 21.8515 11.7135 21.8515 11.6122 21.4482L11.369 20.4775C11.2898 20.1604 11.2499 19.8347 11.2499 19.5078V16H7.60829C6.08666 15.9999 5.14074 14.3788 5.83974 13.0664L5.912 12.9404L8.86513 8.21484C8.92851 8.11336 8.95332 7.99387 8.93641 7.87793L8.90614 7.76465L8.09657 5.74316C7.58744 4.47033 8.48022 3.08866 9.82313 3.00391L9.95399 3H14.0458C15.4606 3.00007 16.4287 4.42948 15.9032 5.74316L15.0936 7.76465C15.0346 7.91259 15.0503 8.07974 15.1347 8.21484L18.0878 12.9404C18.8937 14.2307 18.0202 15.8923 16.537 15.9951L16.3915 16H12.7499V19.5078ZM9.95399 4.2002C9.38814 4.2002 9.00092 4.77147 9.21083 5.29688L10.0194 7.31836C10.2208 7.82171 10.17 8.39183 9.8827 8.85156L6.92958 13.5762C6.59691 14.1089 6.98012 14.7997 7.60829 14.7998H16.3915C17.0196 14.7997 17.4028 14.1089 17.0702 13.5762L14.1171 8.85156C13.8297 8.39181 13.779 7.82174 13.9804 7.31836L14.789 5.29688C14.9988 4.77152 14.6116 4.20027 14.0458 4.2002H9.95399Z"
      />
    </Glyph>
  )
}

/** 上一张 — payload `image_arrowleft_normal` (#2344). */
export function ArrowLeftIcon(props: IconProps) {
  return (
    <Glyph viewBox="0 0 16 16" {...props}>
      <path
        fill="currentColor"
        d="M13 8.50195C13 8.57031 12.987 8.63542 12.9609 8.69727C12.9349 8.75586 12.8991 8.80794 12.8535 8.85352C12.8079 8.89909 12.7542 8.9349 12.6924 8.96094C12.6338 8.98698 12.5703 9 12.502 9H4.7041L7.85352 12.1445C7.95117 12.2422 8 12.3594 8 12.4961C8 12.5645 7.98698 12.6296 7.96094 12.6914C7.9349 12.7533 7.89909 12.807 7.85352 12.8525C7.8112 12.8981 7.75911 12.9339 7.69727 12.96C7.63542 12.986 7.57031 12.999 7.50195 12.999C7.36198 12.999 7.24316 12.9502 7.14551 12.8525L3.14648 8.85352L3.13184 8.83887V8.83398C3.04395 8.74609 3 8.63542 3 8.50195C3 8.36198 3.04883 8.24316 3.14648 8.14551L7.14551 4.14648C7.24316 4.04883 7.36198 4 7.50195 4C7.57031 4 7.63379 4.01302 7.69238 4.03906C7.75423 4.0651 7.80794 4.10091 7.85352 4.14648C7.89909 4.19206 7.9349 4.24577 7.96094 4.30762C7.98698 4.36621 8 4.42969 8 4.49805C8 4.63802 7.95117 4.75684 7.85352 4.85449L4.70898 7.99902H12.502C12.5703 7.99902 12.6338 8.01204 12.6924 8.03809C12.7542 8.06413 12.8079 8.10156 12.8535 8.15039C12.8991 8.19596 12.9349 8.24967 12.9609 8.31152C12.987 8.37012 13 8.43359 13 8.50195Z"
      />
    </Glyph>
  )
}

/** 下一张 — payload `image_arrowright_normal` (#2336). */
export function ArrowRightIcon(props: IconProps) {
  return (
    <Glyph viewBox="0 0 16 16" {...props}>
      <path
        fill="currentColor"
        d="M3 8.50195C3 8.57031 3.01302 8.63542 3.03906 8.69727C3.0651 8.75586 3.10091 8.80794 3.14648 8.85352C3.19206 8.89909 3.24577 8.9349 3.30762 8.96094C3.36621 8.98698 3.42969 9 3.49805 9H11.2959L8.14648 12.1445C8.04883 12.2422 8 12.3594 8 12.4961C8 12.5645 8.01302 12.6296 8.03906 12.6914C8.0651 12.7533 8.10091 12.807 8.14648 12.8525C8.1888 12.8981 8.24089 12.9339 8.30273 12.96C8.36458 12.986 8.42969 12.999 8.49805 12.999C8.63802 12.999 8.75684 12.9502 8.85449 12.8525L12.8535 8.85352L12.8682 8.83887V8.83398C12.9561 8.74609 13 8.63542 13 8.50195C13 8.36198 12.9512 8.24316 12.8535 8.14551L8.85449 4.14648C8.75684 4.04883 8.63802 4 8.49805 4C8.42969 4 8.36621 4.01302 8.30762 4.03906C8.24577 4.0651 8.19206 4.10091 8.14648 4.14648C8.10091 4.19206 8.0651 4.24577 8.03906 4.30762C8.01302 4.36621 8 4.42969 8 4.49805C8 4.63802 8.04883 4.75684 8.14648 4.85449L11.291 7.99902H3.49805C3.42969 7.99902 3.36621 8.01204 3.30762 8.03809C3.24577 8.06413 3.19206 8.10156 3.14648 8.15039C3.10091 8.19596 3.0651 8.24967 3.03906 8.31152C3.01302 8.37012 3 8.43359 3 8.50195Z"
      />
    </Glyph>
  )
}

/** 预览 — WeChat's 3×3 thumbnail board; traced, this build has no payload. */
export function GridIcon({ size = 19, ...rest }: IconProps) {
  const cells = [0, 1, 2].flatMap((row) =>
    [0, 1, 2].map((column) => (
      <rect
        key={`${row}-${column}`}
        x={4.5 + column * 5.85}
        y={4.5 + row * 5.85}
        width={4.3}
        height={4.3}
        rx={1.1}
        fill="currentColor"
      />
    )),
  )
  return (
    <Glyph size={size} {...rest}>
      {cells}
    </Glyph>
  )
}

/** 放大 — payload `image_zoomin_normal` (#2341). */
export function ZoomInIcon(props: IconProps) {
  return (
    <Glyph viewBox="0 0 16 16" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M7.33341 12.0001C8.46193 12.0001 9.49689 11.5995 10.3039 10.9328C10.313 10.9442 10.3228 10.9552 10.3334 10.9658L13.0506 13.6829L13.6163 13.1172L10.8991 10.4001C10.8905 10.3914 10.8815 10.3833 10.8723 10.3756C11.5752 9.55866 12.0001 8.49566 12.0001 7.33341C12.0001 4.75608 9.91075 2.66675 7.33341 2.66675C4.75608 2.66675 2.66675 4.75608 2.66675 7.33341C2.66675 9.91075 4.75608 12.0001 7.33341 12.0001ZM7.33341 11.2001C9.46892 11.2001 11.2001 9.46893 11.2001 7.33342C11.2001 5.19792 9.46892 3.46676 7.33341 3.46676C5.19791 3.46676 3.46675 5.19792 3.46675 7.33342C3.46675 9.46893 5.19791 11.2001 7.33341 11.2001ZM6.93348 9.33341L6.93348 7.73343H5.33341V6.93343L6.93348 6.93343V5.33341H7.73348V6.93343H9.33341V7.73343L7.73348 7.73343V9.33341H6.93348Z"
      />
    </Glyph>
  )
}

/** 缩小 — payload `image_zoomout_normal` (#2342). */
export function ZoomOutIcon(props: IconProps) {
  return (
    <Glyph viewBox="0 0 16 16" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M7.33341 12.0001C8.46193 12.0001 9.49689 11.5995 10.3039 10.9328C10.313 10.9442 10.3228 10.9552 10.3334 10.9658L13.0506 13.6829L13.6163 13.1172L10.8991 10.4001C10.8905 10.3914 10.8815 10.3833 10.8723 10.3756C11.5752 9.55866 12.0001 8.49566 12.0001 7.33341C12.0001 4.75608 9.91075 2.66675 7.33341 2.66675C4.75608 2.66675 2.66675 4.75608 2.66675 7.33341C2.66675 9.91075 4.75608 12.0001 7.33341 12.0001ZM7.33341 11.2001C9.46892 11.2001 11.2001 9.46893 11.2001 7.33342C11.2001 5.19792 9.46892 3.46676 7.33341 3.46676C5.19791 3.46676 3.46675 5.19792 3.46675 7.33342C3.46675 9.46893 5.19791 11.2001 7.33341 11.2001ZM5.33341 7.73343H9.33342V6.93343L5.33341 6.93343V7.73343Z"
      />
    </Glyph>
  )
}

/** 图片原始大小 — payload `picture_original_normal` (#2337), the "1:1" pill. */
export function ActualSizeIcon(props: IconProps) {
  return (
    <Glyph viewBox="0 0 16 16" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M14.5334 2.8H1.46675L1.46675 13.2H14.5334V2.8ZM1.46675 2C1.02492 2 0.666748 2.35817 0.666748 2.8V13.2C0.666748 13.6418 1.02492 14 1.46675 14H14.5334C14.9752 14 15.3334 13.6418 15.3334 13.2V2.8C15.3334 2.35817 14.9752 2 14.5334 2H1.46675Z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M7.6001 7.3332L7.6001 6.5332L8.4001 6.5332L8.4001 7.3332L7.6001 7.3332Z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M7.6001 9.4665L7.6001 8.6665L8.4001 8.6665L8.4001 9.4665L7.6001 9.4665Z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M10.9333 10L10.9333 6L11.7333 6L11.7333 10L10.9333 10Z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M4.2666 10L4.2666 6L5.0666 6L5.0666 10L4.2666 10Z"
      />
    </Glyph>
  )
}

/** 旋转 — payload `image_rotate_normal` (#2340, the mirrored variant). */
export function RotateIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        transform="scale(-1 1) translate(-24 0)"
        d="M14.5756 3.42421L16.5756 5.42421L17.4242 4.57568L16.4484 3.5999L16.9999 3.5999C19.9823 3.5999 22.3999 6.01756 22.3999 8.9999H23.5999C23.5999 5.35482 20.645 2.3999 16.9999 2.3999L16.4485 2.3999L17.4242 1.42421L16.5756 0.575684L14.5756 2.57568C14.3413 2.81 14.3413 3.1899 14.5756 3.42421ZM3.2 17.7999V9.19988H17.8V17.7999H3.2ZM2 8.99988C2 8.44759 2.44772 7.99988 3 7.99988H18C18.5523 7.99988 19 8.44759 19 8.99988V17.9999C19 18.5522 18.5523 18.9999 18 18.9999H3C2.44772 18.9999 2 18.5522 2 17.9999V8.99988Z"
      />
    </Glyph>
  )
}

/** 保存 — payload `download_regular` (#0776). */
export function SaveIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path
        fill="currentColor"
        d="M9.40039 5.6001C9.40039 5.93152 9.13172 6.2002 8.80029 6.2002H6C5.55817 6.2002 5.2002 6.55817 5.2002 7V19C5.2002 19.4418 5.55817 19.7998 6 19.7998H18C18.4418 19.7998 18.7998 19.4418 18.7998 19V7C18.7998 6.55817 18.4418 6.2002 18 6.2002H15.1997C14.8683 6.2002 14.5996 5.93152 14.5996 5.6001C14.5996 5.26867 14.8683 5 15.1997 5H18C19.1046 5 20 5.89543 20 7V19C20 20.1046 19.1046 21 18 21H6C4.89543 21 4 20.1046 4 19V7C4 5.89543 4.89543 5 6 5H8.80029C9.13172 5 9.40039 5.26867 9.40039 5.6001Z"
      />
      <path
        fill="currentColor"
        d="M12.001 1C12.332 1.00022 12.6005 1.26857 12.6006 1.59961V13.5469L14.5732 11.5762C14.8075 11.3419 15.1875 11.342 15.4219 11.5762C15.6559 11.8104 15.6559 12.1896 15.4219 12.4238L12.4229 15.4229C12.3104 15.5352 12.158 15.5986 11.999 15.5986C11.84 15.5985 11.6866 15.5353 11.5742 15.4229L8.57617 12.4238C8.34215 12.1896 8.34218 11.8104 8.57617 11.5762C8.81042 11.3419 9.1895 11.3421 9.42383 11.5762L11.4004 13.5518V1.59961C11.4005 1.26843 11.6698 1 12.001 1Z"
      />
    </Glyph>
  )
}

/* ---------- player bar (video window) ---------- */

/** 播放 — trace: an equilateral play triangle with softened corners. */
export function PlayIcon(props: IconProps) {
  return (
    <Glyph viewBox="0 0 16 16" {...props}>
      <path
        fill="currentColor"
        d="M5.6 3.1c0-.62.68-1 1.2-.68l7.1 4.32a.8.8 0 0 1 0 1.36l-7.1 4.32c-.52.32-1.2-.06-1.2-.68V3.1Z"
      />
    </Glyph>
  )
}

/** 暂停 — trace: two 2.6 px bars, rounded. */
export function PauseIcon(props: IconProps) {
  return (
    <Glyph viewBox="0 0 16 16" {...props}>
      <rect x="4.3" y="3.2" width="2.7" height="9.6" rx="1" fill="currentColor" />
      <rect x="9" y="3.2" width="2.7" height="9.6" rx="1" fill="currentColor" />
    </Glyph>
  )
}

/** 音量 — trace: speaker cone plus one wave arc. */
export function VolumeIcon(props: IconProps) {
  return (
    <Glyph viewBox="0 0 16 16" {...props}>
      <path
        fill="currentColor"
        d="M7.4 3.05a.6.6 0 0 1 .98.47v8.96a.6.6 0 0 1-.98.47L4.3 10.5H2.9a.7.7 0 0 1-.7-.7v-3.6a.7.7 0 0 1 .7-.7h1.4l3.1-2.45Z"
      />
      <path
        d="M10.4 5.5a3.2 3.2 0 0 1 0 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </Glyph>
  )
}

/** 静音 — the same cone, with the wave replaced by a slash. */
export function MutedIcon(props: IconProps) {
  return (
    <Glyph viewBox="0 0 16 16" {...props}>
      <path
        fill="currentColor"
        d="M7.4 3.05a.6.6 0 0 1 .98.47v8.96a.6.6 0 0 1-.98.47L4.3 10.5H2.9a.7.7 0 0 1-.7-.7v-3.6a.7.7 0 0 1 .7-.7h1.4l3.1-2.45Z"
      />
      <path
        d="M10.6 5.9 13.6 9m0-3.1L10.6 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </Glyph>
  )
}

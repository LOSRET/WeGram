import type { MessageMedia } from '@wegram/protocol'
import lottie, { type AnimationItem } from 'lottie-web'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import { progressRatio, useFileProgress, useMediaUrl } from '../lib/media'
import { resolveStickerFormat } from '../lib/stickerFormat'
import { loadTgsAnimation, markTgsFailure } from '../lib/tgs'

interface StickerRendererProps {
  media: MessageMedia
  /** Longest edge in px. Stickers render square-ish inside this box. */
  size?: number
  /**
   * Draw the static thumbnail only — the picker's tab covers and search hits, which
   * are 28-36 px and exist a hundred times over.
   *
   * Sticker cells pass nothing: they play the sticker itself and use the thumbnail
   * as the first paint while the real file downloads.
   */
  preview?: boolean
}

/**
 * One stitched renderer for the three sticker formats (design doc §9.4).
 *
 * - WebP: a plain `<img>`; static, cheapest possible.
 * - TGS: gzip+JSON, decoded once per URL (lib/tgs.ts) and handed to lottie-web.
 * - WebM: Chromium's own VP9 decoder via `<video>`; no extra dependency.
 *
 * Nothing is downloaded until the box is on (or just before) the screen — a
 * sticker set is a hundred cells but only a screenful is ever looked at — and an
 * animation pauses whenever it scrolls out of view, which is what keeps a long
 * chat or a full 表情 grid at 60 fps.
 */
export function StickerRenderer({ media, size = 120, preview = false }: StickerRendererProps) {
  const [ref, view] = useInView<HTMLDivElement>()

  const width = media.width ?? 128
  const height = media.height ?? 128
  const scale = Math.min(size / width, size / height)
  const box = {
    width: Math.max(24, Math.round(width * scale)),
    height: Math.max(24, Math.round(height * scale)),
  }

  // A sticker's thumbnail is a still frame (TDLib serves it as a WebP even for an
  // animated sticker); it is a separate file from the sticker itself.
  const thumbFileId =
    media.thumbFileId && media.thumbFileId > 0 && media.thumbFileId !== media.fileId
      ? media.thumbFileId
      : 0
  const thumbMedia: MessageMedia = thumbFileId ? { ...media, fileId: thumbFileId } : media

  const thumbUrl = useMediaUrl(thumbMedia, 4, view.armed)
  // Only a picture can stand in for the artwork; a TGS thumbnail would have to be
  // decoded first, and that is what the spinner path is for.
  const thumbIsPicture = (media.stickerThumbFormat ?? 'webp') === 'webp'
  const artworkMedia = preview ? thumbMedia : media
  const artworkUrl = useMediaUrl(artworkMedia, preview ? 4 : 8, view.armed)
  const progress = useFileProgress(media.fileId)

  // In the picker the artwork may be the thumbnail, so its own format decides.
  const format = preview ? resolveStickerFormat(media, true) : (media.stickerFormat ?? 'webp')
  const label = media.stickerEmoji ?? '贴纸'

  let content: ReactNode
  if (!artworkUrl) {
    const ratio = Math.round((progressRatio(progress) ?? 0) * 100)
    content =
      thumbUrl && thumbIsPicture ? (
        // The still frame stands in while the animation downloads.
        <img
          className="wx-sticker"
          style={box}
          src={thumbUrl}
          alt={label}
          title={media.stickerEmoji}
          draggable={false}
        />
      ) : (
        <div className="wx-sticker wx-sticker--loading" style={box} title={media.stickerEmoji}>
          {ratio > 0 ? (
            <span className="wx-sticker__pct">{ratio}%</span>
          ) : (
            <span className="wx-spinner" />
          )}
        </div>
      )
  } else if (format === 'tgs') {
    content = (
      <TgsSticker
        url={artworkUrl}
        box={box}
        emoji={media.stickerEmoji}
        label={label}
        active={view.visible}
      />
    )
  } else if (format === 'webm') {
    content = <WebmSticker url={artworkUrl} box={box} label={label} active={view.visible} />
  } else {
    content = (
      <img
        className="wx-sticker"
        style={box}
        src={artworkUrl}
        alt={label}
        title={media.stickerEmoji}
        draggable={false}
      />
    )
  }

  return (
    <div ref={ref} style={box}>
      {content}
    </div>
  )
}

interface AnimatedProps {
  url: string
  box: { width: number; height: number }
  label: string
  emoji?: string | undefined
  /** Playback follows the cell's visibility, measured by the parent. */
  active: boolean
}

function TgsSticker({ url, box, label, emoji, active }: AnimatedProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const animationRef = useRef<AnimationItem | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadTgsAnimation(url)
      .then((data) => {
        if (cancelled || !containerRef.current) return
        const animation = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: false,
          animationData: data,
        })
        animationRef.current = animation
        if (active) animation.play()
      })
      .catch(() => {
        markTgsFailure(url)
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      animationRef.current?.destroy()
      animationRef.current = null
    }
    // `active` is intentionally not a dependency: playback is toggled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  useEffect(() => {
    const animation = animationRef.current
    if (!animation) return
    if (active) animation.play()
    else animation.pause()
  }, [active])

  if (failed) {
    return (
      <div className="wx-sticker wx-sticker--failed" style={box} title={label}>
        <span>{emoji ?? '🩹'}</span>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="wx-sticker"
      style={box}
      role="img"
      aria-label={label}
      title={emoji}
    />
  )
}

function WebmSticker({
  url,
  box,
  label,
  active,
}: {
  url: string
  box: { width: number; height: number }
  label: string
  active: boolean
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (active) void video.play().catch(() => undefined)
    else video.pause()
  }, [active])

  return (
    <video
      ref={videoRef}
      className="wx-sticker"
      style={box}
      src={url}
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={label}
    />
  )
}

/** How far outside the viewport a cell still counts as "about to be read". */
const PRELOAD_PX = 200

interface InView {
  /** On screen right now — it decides whether an animation plays. */
  visible: boolean
  /** Latched: once seen, the download may stay; it stays even after scrolling away. */
  armed: boolean
}

/**
 * Visibility gate for one cell. `rootMargin` preloads a screen ahead so a sticker
 * does not visibly start from nothing when it scrolls into view.
 */
function useInView<T extends Element>(): [RefObject<T | null>, InView] {
  const ref = useRef<T | null>(null)
  const [state, setState] = useState<InView>({ visible: false, armed: false })

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const apply = (onScreen: boolean): void => {
      setState((current) =>
        current.visible === onScreen && (current.armed || !onScreen)
          ? current
          : { visible: onScreen, armed: current.armed || onScreen },
      )
    }
    const check = (): void => {
      const rect = node.getBoundingClientRect()
      apply(rect.bottom > -PRELOAD_PX && rect.top < window.innerHeight + PRELOAD_PX)
    }

    // Geometry first: IntersectionObserver delivery rides the rendering pipeline and
    // Electron throttles that while the window is occluded — the trap that once left
    // the transcript invisible. A cell already on screen must not wait for a frame
    // that may never come, so it is measured directly and once more after mount (the
    // picker scrolls its body to the top in an effect that runs after this one).
    check()
    const retry = window.setTimeout(check, 250)

    const observer = new IntersectionObserver(
      (entries) => apply(Boolean(entries[0]?.isIntersecting)),
      { rootMargin: `${PRELOAD_PX}px 0px` },
    )
    observer.observe(node)
    return () => {
      window.clearTimeout(retry)
      observer.disconnect()
    }
  }, [])

  return [ref, state]
}

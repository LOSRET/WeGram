import type { MessageMedia } from '@wegram/protocol'
import lottie, { type AnimationItem } from 'lottie-web'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { playEmojiSound } from '../lib/emojiSound'
import { progressRatio, useFileProgress, useMediaUrl } from '../lib/media'
import { stickerBox } from '../lib/stickerBox'
import { resolveStickerFormat } from '../lib/stickerFormat'
import { loadTgsAnimation, markTgsFailure } from '../lib/tgs'
import { useInView } from '../lib/useInView'

interface StickerRendererProps {
  media: MessageMedia
  /** Longest edge in px. Stickers render square-ish inside this box. */
  size?: number
  /**
   * Draw the static thumbnail only — the picker's tab covers and search hits, which
   * are 28-36 px and exist a hundred times over, and a TGS grid cell whose artwork
   * the shared ThorVG canvas is already drawing (its thumbnail is hidden once the
   * canvas paints it).
   */
  preview?: boolean
  /**
   * 'loop' (default) keeps a sticker running for as long as it is on screen, which
   * is what a sticker message does. 'once' plays a single pass and replays it (with
   * the emoji's click sound) when tapped — Telegram's animated-emoji message, where
   * a transcript of forever-looping emoji would read as noise.
   */
  playback?: 'loop' | 'once'
  /**
   * Smallest side in px. Only inline custom emoji go below the picker's 24 px
   * floor, because they are drawn inside a line of text.
   */
  minSize?: number
  /**
   * Play a TGS/WebM only while the pointer is over the cell, and rest on the
   * static thumbnail otherwise. Sticker **grids** use this: a pack is a hundred
   * animations, and Telegram Desktop keeps that affordable with one shared
   * renderer plus a 30 fps repaint budget (lib_lottie's MultiPlayer). A DOM
   * sticker player has no such renderer, so the grid mounts at most the one
   * animation under the pointer; the transcript keeps auto-playing, where only a
   * screenful of stickers is ever visible.
   */
  playOnHover?: boolean
}

/**
 * One stitched renderer for the three sticker formats (design doc §9.4).
 *
 * - WebP: a plain `<img>`; static, cheapest possible.
 * - TGS: gzip+JSON, decoded once per URL (lib/tgs.ts) and handed to lottie-web.
 * - WebM: Chromium's own VP9 decoder via `<video>`; no extra dependency.
 *
 * Nothing is downloaded until the box is on (or just before) the screen — a
 * sticker set is a hundred cells but only a screenful is ever looked at. A looping
 * animation is mounted only while a visible row (or a hovered grid cell) can show
 * it, so a 120-sticker pack costs no Lottie work at rest; the transcript keeps
 * auto-playing the handful of stickers a screen actually holds.
 */
export function StickerRenderer({
  media,
  size = 120,
  preview = false,
  playback = 'loop',
  minSize,
  playOnHover = false,
}: StickerRendererProps) {
  // A video sticker plays whenever it is on screen (no preload margin): the grid
  // mounts one <video> per visible WebM cell, so the margin must not pull a row
  // that is scrolled out of the panel into the playing set.
  const [ref, view] = useInView<HTMLDivElement>(media.stickerFormat === 'webm' ? 0 : undefined)
  const once = playback === 'once'
  /** Bumped by a tap; the artwork component replays the animation from frame 0. */
  const [replay, setReplay] = useState(0)
  /** A grid cell is hovered; see `playOnHover`. */
  const [hovered, setHovered] = useState(false)

  const hoverPlay = playOnHover && !preview
  /** Whether an already-mounted animation may run right now. */
  const playing = view.visible && (!hoverPlay || hovered)

  const box = stickerBox(media, size, minSize)

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

  const replayEmoji = (): void => {
    setReplay((count) => count + 1)
    if (media.soundFileId) void playEmojiSound(media.soundFileId)
  }

  const ratio = Math.round((progressRatio(progress) ?? 0) * 100)
  /** The still frame: TDLib's static thumbnail, or a spinner until there is one. */
  const still: ReactNode =
    thumbUrl && thumbIsPicture ? (
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

  const animated = format === 'tgs' || format === 'webm'
  /**
   * The animation element is only mounted while it can run. A grid cell that is
   * not hovered keeps its still frame, so opening a 120-sticker pack neither
   * parses nor ticks 120 Lottie instances. 'once' is the exception: it stays
   * mounted from the moment its file lands, so scrolling a row back does not
   * restart the single pass.
   */
  const showAnimation =
    Boolean(artworkUrl) && animated && (once || view.visible) && (!hoverPlay || hovered)

  let content: ReactNode
  if (!animated) {
    content = artworkUrl ? (
      <img
        className="wx-sticker"
        style={box}
        src={artworkUrl}
        alt={label}
        title={media.stickerEmoji}
        draggable={false}
      />
    ) : (
      still
    )
  } else if (showAnimation && artworkUrl) {
    content =
      format === 'tgs' ? (
        <TgsSticker
          url={artworkUrl}
          box={box}
          emoji={media.stickerEmoji}
          label={label}
          active={playing}
          once={once}
          replay={replay}
        />
      ) : (
        <WebmSticker
          url={artworkUrl}
          box={box}
          label={label}
          active={playing}
          once={once}
          replay={replay}
        />
      )
  } else {
    // Resting grid cell, or the animation is still downloading.
    content = still
  }

  return (
    <div
      ref={ref}
      style={box}
      onClick={once ? replayEmoji : undefined}
      onPointerEnter={hoverPlay ? () => setHovered(true) : undefined}
      onPointerLeave={hoverPlay ? () => setHovered(false) : undefined}
    >
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
  /** One pass only — see `StickerRendererProps.playback`. */
  once: boolean
  /** A tap's counter; any change replays the animation from frame 0. */
  replay: number
}

function TgsSticker({ url, box, label, emoji, active, once, replay }: AnimatedProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const animationRef = useRef<AnimationItem | null>(null)
  /**
   * The newest visibility for the decode callback.
   *
   * A sticker whose file is already cached mounts in the same commit as the
   * visibility measurement, and the decode resolves after the flip: reading the
   * render-time `active` there always saw `false`, so every sticker of a chat
   * the reader came back to stayed on its first frame.
   */
  const activeRef = useRef(active)
  /** Set once the single pass is over; scrolling back must not restart it. */
  const doneRef = useRef(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    doneRef.current = false
    void loadTgsAnimation(url)
      .then((data) => {
        if (cancelled || !containerRef.current) return
        const animation = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: !once,
          autoplay: false,
          animationData: data,
        })
        // Evaluate whole frames only, like Telegram's C++ renderer: interpolating
        // between them doubles the per-frame work for no visible gain at these
        // sizes, and the browser's compositor is what actually paces the clock.
        animation.setSubframe(false)
        animationRef.current = animation
        animation.addEventListener('complete', () => {
          doneRef.current = true
        })
        if (activeRef.current) animation.play()
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
    // Loaded once per URL; visibility is applied through `activeRef` and the
    // effect below, so `active` is not a dependency here. `once` is fixed for
    // the life of a row — `playback` is a prop, never state.
  }, [url, once])

  useEffect(() => {
    activeRef.current = active
    // No animation yet: the decode callback applies this ref when it lands.
    const animation = animationRef.current
    if (!animation) return
    if (!active) animation.pause()
    else if (!once || !doneRef.current) animation.play()
  }, [active, once])

  useEffect(() => {
    if (replay === 0) return
    const animation = animationRef.current
    if (!animation) return
    doneRef.current = false
    animation.goToAndPlay(0, true)
  }, [replay])

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

function WebmSticker({ url, box, label, active, once, replay }: AnimatedProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  /** Set once the single pass is over; scrolling back must not restart it. */
  const doneRef = useRef(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!active) {
      video.pause()
      return
    }
    if (once && doneRef.current) return
    void video.play().catch(() => undefined)
  }, [active, once])

  useEffect(() => {
    const video = videoRef.current
    if (!video || replay === 0) return
    doneRef.current = false
    video.currentTime = 0
    void video.play().catch(() => undefined)
  }, [replay])

  return (
    <video
      ref={videoRef}
      className="wx-sticker"
      style={box}
      src={url}
      muted
      loop={!once}
      playsInline
      preload="metadata"
      aria-label={label}
      onEnded={() => {
        doneRef.current = true
      }}
    />
  )
}

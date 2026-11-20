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
   * are 28-36 px and exist a hundred times over.
   *
   * Sticker cells pass nothing: they play the sticker itself and use the thumbnail
   * as the first paint while the real file downloads.
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
export function StickerRenderer({
  media,
  size = 120,
  preview = false,
  playback = 'loop',
  minSize,
}: StickerRendererProps) {
  const [ref, view] = useInView<HTMLDivElement>()
  const once = playback === 'once'
  /** Bumped by a tap; the artwork component replays the animation from frame 0. */
  const [replay, setReplay] = useState(0)

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
        once={once}
        replay={replay}
      />
    )
  } else if (format === 'webm') {
    content = (
      <WebmSticker
        url={artworkUrl}
        box={box}
        label={label}
        active={view.visible}
        once={once}
        replay={replay}
      />
    )
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
    <div ref={ref} style={box} onClick={once ? replayEmoji : undefined}>
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

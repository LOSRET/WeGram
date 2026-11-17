import type { MessageMedia } from '@wegram/protocol'
import lottie, { type AnimationItem } from 'lottie-web'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { progressRatio, useFileProgress, useMediaUrl } from '../lib/media'
import { loadTgsAnimation, markTgsFailure } from '../lib/tgs'

interface StickerRendererProps {
  media: MessageMedia
  /** Longest edge in px. Stickers render square-ish inside this box. */
  size?: number
  /** Picker grid: prefers the static thumbnail and never animates. */
  preview?: boolean
}

/**
 * One stitched renderer for the three sticker formats (design doc §9.4).
 *
 * - WebP: a plain `<img>`; static, cheapest possible.
 * - TGS: gzip+JSON, decoded once per URL (lib/tgs.ts) and handed to lottie-web.
 * - WebM: Chromium's own VP9 decoder via `<video>`; no extra dependency.
 *
 * Both animated formats pause when scrolled out of view — that is what keeps a
 * long chat with dozens of animated stickers at 60 fps.
 */
export function StickerRenderer({ media, size = 120, preview = false }: StickerRendererProps) {
  const thumbFileId = preview ? (media.thumbFileId ?? media.fileId) : media.fileId
  const target: MessageMedia = preview ? { ...media, fileId: thumbFileId } : media
  const url = useMediaUrl(target, preview ? 4 : 8)
  const progress = useFileProgress(media.fileId)

  const width = media.width ?? 128
  const height = media.height ?? 128
  const scale = Math.min(size / width, size / height)
  const box = {
    width: Math.max(24, Math.round(width * scale)),
    height: Math.max(24, Math.round(height * scale)),
  }
  const format = media.stickerFormat ?? 'webp'

  if (!url) {
    const ratio = Math.round((progressRatio(progress) ?? 0) * 100)
    return (
      <div className="wx-sticker wx-sticker--loading" style={box} title={media.stickerEmoji}>
        {ratio > 0 ? (
          <span className="wx-sticker__pct">{ratio}%</span>
        ) : (
          <span className="wx-spinner" />
        )}
      </div>
    )
  }

  if (format === 'tgs') {
    return (
      <TgsSticker
        url={url}
        box={box}
        emoji={media.stickerEmoji}
        label={media.stickerEmoji ?? '贴纸'}
      />
    )
  }
  if (format === 'webm') {
    return <WebmSticker url={url} box={box} label={media.stickerEmoji ?? '贴纸'} />
  }
  return (
    <img
      className="wx-sticker"
      style={box}
      src={url}
      alt={media.stickerEmoji ?? '贴纸'}
      title={media.stickerEmoji}
      draggable={false}
    />
  )
}

interface AnimatedProps {
  url: string
  box: { width: number; height: number }
  label: string
  emoji?: string | undefined
}

function TgsSticker({ url, box, label, emoji }: AnimatedProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const animationRef = useRef<AnimationItem | null>(null)
  const [failed, setFailed] = useState(false)
  const [ref, visible] = useInView<HTMLDivElement>()

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
        if (visible) animation.play()
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
    // `visible` is intentionally not a dependency: playback is toggled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  useEffect(() => {
    const animation = animationRef.current
    if (!animation) return
    if (visible) animation.play()
    else animation.pause()
  }, [visible])

  if (failed) {
    return (
      <div className="wx-sticker wx-sticker--failed" style={box} title={label}>
        <span>{emoji ?? '🩹'}</span>
      </div>
    )
  }

  return (
    <div
      ref={(node) => {
        containerRef.current = node
        ref.current = node
      }}
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
}: {
  url: string
  box: { width: number; height: number }
  label: string
}) {
  const [ref, visible] = useInView<HTMLVideoElement>()

  useEffect(() => {
    const video = ref.current
    if (!video) return
    if (visible) void video.play().catch(() => undefined)
    else video.pause()
  }, [visible, ref])

  return (
    <video
      ref={ref}
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

/**
 * Visibility gate for animations. `rootMargin` preloads a screen ahead so a
 * sticker does not visibly start from frame 0 when it scrolls into view.
 */
function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => setVisible(Boolean(entries[0]?.isIntersecting)),
      { rootMargin: '200px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, visible]
}

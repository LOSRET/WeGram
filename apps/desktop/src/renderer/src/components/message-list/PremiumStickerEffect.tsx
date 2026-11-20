import type { MessageMedia } from '@wegram/protocol'
import lottie, { type AnimationItem } from 'lottie-web'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useMediaUrl } from '../../lib/media'
import { premiumEffectBox, type StickerBox } from '../../lib/stickerBox'
import { loadTgsAnimation, markTgsFailure } from '../../lib/tgs'
import { useInView } from '../../lib/useInView'

export interface PremiumStickerEffectProps {
  /** The sticker message's media; `premiumEffectFileId` is the effect file. */
  media: MessageMedia
  /** The sticker's on-screen box, which the effect is centred on. */
  sticker: StickerBox
  /**
   * Bumped by a tap on the sticker: the official client replays the effect when a
   * premium sticker is clicked, instead of leaving it played-out.
   */
  replay: number
}

/**
 * A Telegram Premium sticker's effect (TDLib `stickerFullTypeRegular.
 * premium_animation`): a TGS that Telegram paints over the sticker, once, when
 * the message first appears — tdesktop's `EffectType::PremiumSticker` overlay,
 * at 1.49× the sticker's size. TDLib's `messageSticker.is_premium` is the "play
 * it" flag and the adapter has already honoured it, so landing here means play.
 *
 * The effect is decoration, never a click target, and it is a *second* file: it
 * starts downloading only once the sticker is about to be read, and its gzip is
 * decoded through the same guards as any sticker (`lib/tgs.ts`). When it ends it
 * stays hidden rather than unmounting, so a tap can replay it without re-decoding.
 */
export function PremiumStickerEffect({ media, sticker, replay }: PremiumStickerEffectProps) {
  const fileId = media.premiumEffectFileId ?? 0
  const [ref, view] = useInView<HTMLDivElement>()
  const box = premiumEffectBox(sticker)
  // Only the effect's bytes: it must not inherit the sticker's own URL.
  const effectMedia = useMemo<MessageMedia>(
    () => ({ fileId, ...(media.premiumEffectUrl ? { localUrl: media.premiumEffectUrl } : {}) }),
    [fileId, media.premiumEffectUrl],
  )
  const url = useMediaUrl(effectMedia, 6, view.armed)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const animationRef = useRef<AnimationItem | null>(null)
  /**
   * The newest visibility for the decode callback: a cached file decodes after the
   * visibility measurement, so reading the render-time `visible` there would start
   * the effect on a sticker the reader has already scrolled past.
   */
  const visibleRef = useRef(view.visible)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    visibleRef.current = view.visible
    const animation = animationRef.current
    if (!animation) return
    if (view.visible) animation.play()
    else animation.pause()
  }, [view.visible])

  useEffect(() => {
    if (!url) return
    let cancelled = false
    void loadTgsAnimation(url)
      .then((data) => {
        if (cancelled || !containerRef.current) return
        const animation = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: false,
          autoplay: false,
          animationData: data,
        })
        animationRef.current = animation
        animation.addEventListener('complete', () => {
          if (!cancelled) setFinished(true)
        })
        if (visibleRef.current) animation.play()
      })
      .catch(() => {
        // A premium effect is decoration: a bad file hides itself, it never draws
        // an error over the sticker.
        markTgsFailure(url)
        if (!cancelled) setFinished(true)
      })
    return () => {
      cancelled = true
      animationRef.current?.destroy()
      animationRef.current = null
    }
  }, [url])

  useEffect(() => {
    if (replay === 0) return
    const animation = animationRef.current
    if (!animation) return
    setFinished(false)
    animation.goToAndPlay(0, true)
  }, [replay])

  if (!fileId) return null

  return (
    <div
      ref={ref}
      className={`wx-sticker-effect${finished ? ' wx-sticker-effect--done' : ''}`}
      style={{ width: box.width, height: box.height }}
      aria-hidden="true"
    >
      <div ref={containerRef} className="wx-sticker-effect__art" />
    </div>
  )
}

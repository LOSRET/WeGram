import type { Sticker } from '@wegram/protocol'
import { useCallback, useEffect, useState } from 'react'

import { stickerMedia } from '../lib/stickerMedia'
import { StickerCanvasLayer } from './StickerCanvasLayer'
import { StickerRenderer } from './StickerRenderer'

interface StickerGridProps {
  stickers: Sticker[]
  /** The grid container's own class (`wx-picker__stickers` / `wx-pack__grid`). */
  className: string
  /** One cell's class (`wx-picker__sticker` / `wx-pack__sticker`). */
  cellClassName: string
  /** `lib/media` lease owner: one grid is one owner, or a shared one cancels. */
  owner: string
  /** A sticker click; absent for a read-only grid (the pack box only draws). */
  onSend?: (sticker: Sticker) => void
  /** Resets the ThorVG fallback when one grid switches packs in place. */
  resetKey?: string
}

/**
 * One pack's stickers as a grid (design doc §8.5).
 *
 * Both the 表情 panel's set body and the 贴纸包盒子 draw the same thing: cells that
 * hold the sticker's own renderer, and — when the pack has TGS — one shared ThorVG
 * canvas over them (`StickerCanvasLayer`), with the per-cell hover animation as the
 * fallback when WebGL could not start. The canvas is an OVERLAY: the cells stay in
 * the DOM for hover/click and the layer hides their thumbnails as it paints.
 */
export function StickerGrid({
  stickers,
  className,
  cellClassName,
  owner,
  onSend,
  resetKey,
}: StickerGridProps) {
  /** ThorVG could not start: TGS cells fall back to their hover animation. */
  const [canvasFailed, setCanvasFailed] = useState(false)
  const onCanvasFailed = useCallback(() => setCanvasFailed(true), [])
  useEffect(() => {
    setCanvasFailed(false)
  }, [resetKey])

  const hasTgs = stickers.some((sticker) => sticker.format === 'tgs')

  return (
    <div className={className}>
      {stickers.map((sticker, index) => {
        const body = (
          <StickerRenderer
            media={stickerMedia(sticker)}
            size={92}
            preview={sticker.format === 'tgs' && !canvasFailed}
            playOnHover={sticker.format === 'tgs' && canvasFailed}
          />
        )
        return onSend ? (
          <button
            key={sticker.fileId}
            className={cellClassName}
            data-sticker-index={index}
            onClick={() => onSend(sticker)}
            title={sticker.emoji ?? '贴纸'}
          >
            {body}
          </button>
        ) : (
          <div
            key={sticker.fileId}
            className={cellClassName}
            data-sticker-index={index}
            title={sticker.emoji ?? '贴纸'}
          >
            {body}
          </div>
        )
      })}
      {hasTgs ? (
        <StickerCanvasLayer stickers={stickers} owner={owner} onFailed={onCanvasFailed} />
      ) : null}
    </div>
  )
}

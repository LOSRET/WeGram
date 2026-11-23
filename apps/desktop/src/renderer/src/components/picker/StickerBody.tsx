import type { Sticker, StickerSet } from '@wegram/protocol'
import { useCallback, useEffect, useState } from 'react'

import type { MentionTarget } from '../../lib/mention'
import { mentionEntitiesOf } from '../../lib/mentionText'
import { stickerMedia } from '../../lib/stickerMedia'
import { RichText } from '../RichText'
import { StickerCanvasLayer } from '../StickerCanvasLayer'
import { StickerRenderer } from '../StickerRenderer'

/**
 * One sticker set's grid. A sticker is sent on click, so the cell is a button
 * and the renderer only paints it.
 */
export function StickerBody({
  title,
  loading,
  error,
  set,
  onSend,
  onMention,
}: {
  title: string
  loading: boolean
  error: string | null
  set: StickerSet | null
  onSend: (sticker: Sticker) => void
  /** A pack name advertises its author: the @username opens that account (§8.3). */
  onMention: (target: MentionTarget) => void
}) {
  /** ThorVG could not start: TGS cells fall back to their hover animation. */
  const [canvasFailed, setCanvasFailed] = useState(false)
  const onCanvasFailed = useCallback(() => setCanvasFailed(true), [])
  useEffect(() => {
    setCanvasFailed(false)
  }, [set?.id])
  const hasTgs = set?.stickers.some((sticker) => sticker.format === 'tgs') ?? false
  const canvasOwner = `picker-${set?.id ?? ''}`.slice(0, 64)

  return (
    <>
      {title ? (
        <div className="wx-picker__label wx-picker__label--set">
          <RichText text={title} entities={mentionEntitiesOf(title)} onMention={onMention} />
        </div>
      ) : null}
      {loading ? (
        <div className="wx-picker__state">
          <span className="wx-spinner" />
        </div>
      ) : (
        <>
          {error ? <div className="wx-picker__error">{error}</div> : null}
          {set && set.stickers.length > 0 ? (
            <div className="wx-picker__stickers">
              {set.stickers.map((sticker, index) => (
                <button
                  key={sticker.fileId}
                  className="wx-picker__sticker"
                  data-sticker-index={index}
                  onClick={() => onSend(sticker)}
                  title={sticker.emoji ?? '贴纸'}
                >
                  <StickerRenderer
                    media={stickerMedia(sticker)}
                    size={92}
                    preview={sticker.format === 'tgs' && !canvasFailed}
                    playOnHover={sticker.format === 'tgs' && canvasFailed}
                  />
                </button>
              ))}
              {hasTgs ? (
                <StickerCanvasLayer
                  stickers={set.stickers}
                  owner={canvasOwner}
                  onFailed={onCanvasFailed}
                />
              ) : null}
            </div>
          ) : (
            <div className="wx-picker__state">{error ? '' : '这个贴纸包还是空的'}</div>
          )}
        </>
      )}
    </>
  )
}

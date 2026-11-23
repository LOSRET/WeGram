import type { Sticker, StickerSet } from '@wegram/protocol'

import type { MentionTarget } from '../../lib/mention'
import { mentionEntitiesOf } from '../../lib/mentionText'
import { stickerMedia } from '../../lib/stickerMedia'
import { RichText } from '../RichText'
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
              {set.stickers.map((sticker) => (
                <button
                  key={sticker.fileId}
                  className="wx-picker__sticker"
                  onClick={() => onSend(sticker)}
                  title={sticker.emoji ?? '贴纸'}
                >
                  <StickerRenderer media={stickerMedia(sticker)} size={92} />
                </button>
              ))}
            </div>
          ) : (
            <div className="wx-picker__state">{error ? '' : '这个贴纸包还是空的'}</div>
          )}
        </>
      )}
    </>
  )
}

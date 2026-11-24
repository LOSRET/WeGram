import type { Sticker, StickerSet } from '@wegram/protocol'

import type { MentionTarget } from '../../lib/mention'
import { mentionEntitiesOf } from '../../lib/mentionText'
import { RichText } from '../RichText'
import { StickerGrid } from '../StickerGrid'

/**
 * One sticker set's grid. A sticker is sent on click, so the cells are buttons and
 * the shared `StickerGrid` only paints them.
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
            <StickerGrid
              stickers={set.stickers}
              className="wx-picker__stickers"
              cellClassName="wx-picker__sticker"
              owner={`picker-${set.id}`.slice(0, 64)}
              onSend={onSend}
              resetKey={set.id}
            />
          ) : (
            <div className="wx-picker__state">{error ? '' : '这个贴纸包还是空的'}</div>
          )}
        </>
      )}
    </>
  )
}

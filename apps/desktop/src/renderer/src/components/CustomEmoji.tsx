import type { Sticker } from '@wegram/protocol'
import { useEffect, useMemo, useState } from 'react'

import { cachedCustomEmoji, ensureCustomEmoji } from '../lib/customEmoji'
import { useMediaUrl } from '../lib/media'
import { stickerMedia } from '../lib/stickerMedia'
import { StickerRenderer } from './StickerRenderer'

/**
 * Longest edge of an inline custom emoji, in px. The transcript's body text is
 * 14 px, and Telegram draws premium emoji slightly larger than the glyph they
 * replace — the same relationship as its 112 px animated-emoji message.
 */
const CUSTOM_EMOJI_SIZE = 20

/**
 * Telegram Premium's inline "premium emoji": a `customEmoji` text entity whose
 * base glyph (kept in the message text for previews, quotes and 复制) is replaced
 * by its sticker art.
 *
 * The glyph stays until the art is actually on disk — a 20 px inline image has no
 * room for a progress box — so a slow or unknown emoji degrades to the character
 * it always was, never to a hole.
 */
export function CustomEmoji({ id, glyph }: { id: string; glyph: string }) {
  const [sticker, setSticker] = useState<Sticker | undefined>(() => cachedCustomEmoji(id))

  useEffect(() => {
    if (cachedCustomEmoji(id)) {
      setSticker(cachedCustomEmoji(id))
      return
    }
    let alive = true
    void ensureCustomEmoji(id).then((found) => {
      if (alive && found) setSticker(found)
    })
    return () => {
      alive = false
    }
  }, [id])

  const media = useMemo(() => (sticker ? stickerMedia(sticker) : undefined), [sticker])
  const url = useMediaUrl(media, 6, Boolean(media))

  if (!sticker || !media || !url) return <span className="wx-inline-emoji">{glyph}</span>

  return (
    <span className="wx-custom-emoji" title={sticker.emoji ?? glyph}>
      <StickerRenderer media={media} size={CUSTOM_EMOJI_SIZE} minSize={8} />
    </span>
  )
}

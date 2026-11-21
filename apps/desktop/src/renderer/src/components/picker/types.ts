import type { Sticker, StickerSetSummary } from '@wegram/protocol'

export interface ExpressionPickerProps {
  /** Inserts a picked emoji into the composer at the caret. */
  onPickEmoji: (emoji: string) => void
  /**
   * Posts the clicked sticker through the composer's own send path: a chat's
   * composer sends it to the chat, a comment box to the discussion thread.
   */
  onSendSticker: (sticker: Sticker) => void
  onClose: () => void
}

export type PickerTab = { kind: 'emoji' } | { kind: 'search' } | { kind: 'set'; id: string }

/** One tab of the strip: the two fixed tabs plus one per installed set. */
export type PickerStripItem =
  | { key: 'search'; kind: 'search' }
  | { key: 'emoji'; kind: 'emoji' }
  | { key: string; kind: 'set'; set: StickerSetSummary }

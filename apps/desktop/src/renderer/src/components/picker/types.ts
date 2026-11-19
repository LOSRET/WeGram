import type { Message, StickerSetSummary } from '@wegram/protocol'

export interface ExpressionPickerProps {
  chatId: number
  /** Which tab the toggle opened the panel on (表情 or 贴纸). */
  mode: 'emoji' | 'stickers'
  /** Inserts a picked emoji into the composer at the caret. */
  onPickEmoji: (emoji: string) => void
  onSent: (message: Message) => void
  onClose: () => void
}

export type PickerTab =
  { kind: 'emoji' } | { kind: 'search' } | { kind: 'set'; id: string } | { kind: 'empty' }

/** One tab of the strip: the two fixed tabs plus one per installed set. */
export type PickerStripItem =
  | { key: 'search'; kind: 'search' }
  | { key: 'emoji'; kind: 'emoji' }
  | { key: string; kind: 'set'; set: StickerSetSummary }

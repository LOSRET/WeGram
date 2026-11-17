import type { ChatSummary, Message } from '@wegram/protocol'
import { memo, type MouseEvent } from 'react'

import { avatarColor, formatMessageTime, initials, messagePreview } from '../../lib/format'
import { MediaBubble } from '../MediaBubble'
import { RichText } from '../RichText'
import { StickerRenderer } from '../StickerRenderer'
import { isEmojiOnly } from './emoji'

export interface MessageRowProps {
  chat: ChatSummary
  message: Message
  repliedTo: Message | null
  /** Identity of the signed-in account, for the avatar on our own messages. */
  self: { id: number; name: string }
  /** Highest outgoing id the peer has read; drives the 已读/未读 receipt. */
  readOutboxMaxId: number
  /**
   * Takes the row it was raised from, so the list can hand every row the same
   * stable callback: a per-row arrow function made `memo` useless.
   */
  onOpenMenu: (message: Message, x: number, y: number) => void
}

/**
 * One transcript row: avatar, sender line, reply quote, media/text/sticker body,
 * the time/edit/read meta line and the hover "⋯" button.
 *
 * Purely presentational — all timing and windowing lives in `index.tsx`.
 *
 * Memoised: the list re-renders on every scroll measurement (the "seen" index moves
 * as rows pass the fold), and without this every row in the window re-rendered with
 * it. Its props are kept referentially stable by the caller for exactly this.
 */
export const MessageRow = memo(function MessageRow({
  chat,
  message,
  repliedTo,
  self,
  readOutboxMaxId,
  onOpenMenu,
}: MessageRowProps) {
  if (message.kind === 'service') {
    return <div className="wx-service">{message.text || '系统消息'}</div>
  }

  const showSender = !message.outgoing && chat.kind !== 'private'
  const media = message.media
  const mediaKind =
    message.kind === 'photo' ||
    message.kind === 'video' ||
    message.kind === 'file' ||
    message.kind === 'voice'
      ? message.kind
      : null
  const isSticker = message.kind === 'sticker' && media
  const bigEmoji = message.kind === 'text' && !mediaKind && isEmojiOnly(message.text)

  const openMenu = (event: MouseEvent): void => {
    event.preventDefault()
    onOpenMenu(message, event.clientX, event.clientY)
  }

  const readReceipt = message.outgoing
    ? readOutboxMaxId >= message.id
      ? ' · 已读'
      : ' · 未读'
    : ''

  return (
    <div className={`wx-message-row${message.outgoing ? ' wx-message-row--self' : ''}`}>
      <div
        className="wx-avatar wx-avatar--small"
        style={{
          background: avatarColor(
            message.outgoing
              ? (self.id ?? 1000)
              : message.senderChatId || message.senderId || chat.id,
          ),
        }}
      >
        {initials(message.outgoing ? self.name : message.senderName)}
      </div>

      <div className={`wx-message-stack${message.outgoing ? ' wx-message-stack--self' : ''}`}>
        {showSender && message.senderName && message.senderName !== self.name ? (
          <span className="wx-sender">{message.senderName}</span>
        ) : null}
        {isSticker ? (
          <div className="wx-sticker-wrap" onContextMenu={openMenu}>
            <StickerRenderer media={media!} size={140} />
          </div>
        ) : bigEmoji ? (
          // Emoji-only message: no bubble, large glyph, like WeChat big emoji.
          <div className="wx-big-emoji" onContextMenu={openMenu}>
            <RichText text={message.text} entities={message.entities} />
          </div>
        ) : (
          <div
            className={`wx-bubble${message.outgoing ? ' wx-bubble--self' : ''}${
              mediaKind ? ` wx-bubble--media wx-bubble--${mediaKind}` : ''
            }`}
            onContextMenu={openMenu}
          >
            {repliedTo ? (
              <div className="wx-quote">
                {repliedTo.senderName}：{messagePreview(repliedTo)}
              </div>
            ) : null}
            {mediaKind && media ? (
              <MediaBubble media={media} kind={mediaKind} chatId={chat.id} messageId={message.id} />
            ) : null}
            {message.text ? (
              <div className={mediaKind ? 'wx-caption' : undefined}>
                <RichText text={message.text} entities={message.entities} />
              </div>
            ) : null}
            {!mediaKind && !message.text ? (
              <span className="wx-bubble__empty">[不支持的消息]</span>
            ) : null}
          </div>
        )}
        <span className="wx-message__meta">
          {formatMessageTime(message.date)}
          {message.edited ? ' · 已编辑' : ''}
          {readReceipt}
        </span>
      </div>

      <button
        className="wx-message-more"
        title="更多"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          onOpenMenu(message, rect.left, rect.bottom + 4)
        }}
      >
        ⋯
      </button>
    </div>
  )
})

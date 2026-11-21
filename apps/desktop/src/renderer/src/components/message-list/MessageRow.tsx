import type { ChatSummary, Message } from '@wegram/protocol'
import { memo, useState, type MouseEvent } from 'react'

import { hasCommentBar, isCommentablePost } from '../../lib/comments'
import { formatMessageTime, messagePreview } from '../../lib/format'
import { stickerBox } from '../../lib/stickerBox'
import { Avatar } from '../Avatar'
import { MediaBubble } from '../MediaBubble'
import { ContactCard } from './ContactCard'
import { InlineButtons } from './InlineButtons'
import { RichMessage } from './RichMessage'
import { RichText } from '../RichText'
import { StickerRenderer } from '../StickerRenderer'
import { AlbumBubble } from './AlbumBubble'
import { CommentBar } from './CommentBar'
import { PremiumStickerEffect } from './PremiumStickerEffect'
import { isEmojiOnly } from './emoji'

/**
 * Longest edge of an animated emoji. Telegram draws the one emoji of a message at
 * this size — larger than our 48 px text emoji, prized as the message's whole body.
 */
const ANIMATED_EMOJI_SIZE = 112

/** Longest edge of a sticker message's artwork. */
const STICKER_SIZE = 140

export interface MessageRowProps {
  chat: ChatSummary
  /**
   * One message, or the consecutive items of one Telegram album (design doc §8.6).
   * The row draws one avatar, one sender line and one meta line for the group.
   */
  messages: Message[]
  repliedTo: Message | null
  /** Identity of the signed-in account, for the avatar on our own messages. */
  self: { id: number; name: string; avatarUrl: string | undefined }
  /**
   * The sender's profile photo, when it is known. `undefined` draws the initials
   * placeholder: a photo can still be on its way (`evt:avatars`).
   */
  avatarUrl: string | undefined
  /** Highest outgoing id the peer has read; drives the 已读/未读 receipt. */
  readOutboxMaxId: number
  /**
   * Takes the row it was raised from, so the list can hand every row the same
   * stable callback: a per-row arrow function made `memo` useless.
   */
  onOpenMenu: (message: Message, x: number, y: number) => void
  /** Opens Telegram's full-pane discussion view for that message's thread. */
  onOpenComments: (message: Message) => void
}

/**
 * `groupMessages` rebuilds every row's array whenever the transcript grows, so the
 * default shallow comparison would re-render every visible row on each arrival
 * (the list re-renders on every scroll measurement). Compare the messages by
 * identity instead: the store keeps untouched message objects.
 */
function sameRow(previous: readonly Message[], next: readonly Message[]): boolean {
  if (previous.length !== next.length) return false
  return previous.every((message, index) => message === next[index])
}

/**
 * One transcript row: avatar, sender line, reply quote, media/text/sticker body,
 * the time/edit/read meta line and the hover "⋯" button.
 *
 * Every chat kind draws this same row: a channel post is a group message with a
 * 评论 handle under its bubble, not a composition of its own.
 *
 * Purely presentational — all timing and windowing lives in `index.tsx`.
 *
 * Memoised: the list re-renders on every scroll measurement (the "seen" index moves
 * as rows pass the fold), and without this every row in the window re-rendered with
 * it. Its props are kept referentially stable by the caller for exactly this.
 */
export const MessageRow = memo(
  function MessageRow({
    chat,
    messages,
    repliedTo,
    self,
    avatarUrl,
    readOutboxMaxId,
    onOpenMenu,
    onOpenComments,
  }: MessageRowProps) {
    /**
     * A premium sticker's effect plays once; a tap on the sticker replays it, so
     * the row owns the counter and hands it to the effect.
     */
    const [premiumReplay, setPremiumReplay] = useState(0)
    const first = messages[0]
    const last = messages[messages.length - 1]
    if (!first || !last) return null
    const interaction = first.interaction

    if (first.kind === 'service') {
      return <div className="wx-service">{first.text || '系统消息'}</div>
    }

    // An album is a row of its own kind: the bubble is transparent, the grid draws
    // the media, and the group shares one meta line. A lone album item (the sibling
    // has not been paged in, or was deleted) still renders as a normal bubble.
    const album = messages.length > 1
    const media = first.media
    const mediaKind =
      first.kind === 'photo' ||
      first.kind === 'video' ||
      first.kind === 'file' ||
      first.kind === 'voice'
        ? first.kind
        : null
    const isSticker = !album && first.kind === 'sticker' && Boolean(media)
    // Telegram's animated emoji: one emoji drawn as its sticker, no bubble.
    const animatedEmoji = !album && first.kind === 'emoji' ? media : undefined
    const bigEmoji = !album && first.kind === 'text' && !mediaKind && isEmojiOnly(first.text)
    // A rich message is a page of blocks; its `text` is only the flattened
    // words kept for previews and 复制, so it must not be rendered as a body.
    const rich = first.kind === 'rich' && first.rich?.length ? first.rich : undefined
    const contact = first.kind === 'contact' ? first.contact : undefined
    // An inline keyboard lives on the message, not in its content: text, photo
    // and rich bubbles all can carry one.
    const buttons = first.buttons?.length ? first.buttons : undefined
    // Telegram puts an album's caption on one of its items (normally the first).
    const caption = messages.find((message) => message.text) ?? null
    const showSender = !first.outgoing && chat.kind !== 'private'

    const openMenu = (event: MouseEvent): void => {
      event.preventDefault()
      onOpenMenu(first, event.clientX, event.clientY)
    }

    const readReceipt = last.outgoing ? (readOutboxMaxId >= last.id ? ' · 已读' : ' · 未读') : ''

    const commentBar =
      hasCommentBar(interaction) && isCommentablePost(chat) ? (
        <CommentBar interaction={interaction} onOpen={() => onOpenComments(first)} />
      ) : null

    return (
      <div className={`wx-message-row${first.outgoing ? ' wx-message-row--self' : ''}`}>
        <Avatar
          className="wx-avatar wx-avatar--small"
          url={avatarUrl}
          name={first.outgoing ? self.name : first.senderName}
          colorId={
            first.outgoing ? (self.id ?? 1000) : first.senderChatId || first.senderId || chat.id
          }
        />

        <div className={`wx-message-stack${first.outgoing ? ' wx-message-stack--self' : ''}`}>
          {showSender && first.senderName && first.senderName !== self.name ? (
            <span className="wx-sender">{first.senderName}</span>
          ) : null}
          {isSticker && media ? (
            <div
              className="wx-sticker-wrap"
              onContextMenu={openMenu}
              onClick={
                media.premiumEffectFileId ? () => setPremiumReplay((count) => count + 1) : undefined
              }
            >
              <StickerRenderer media={media} size={STICKER_SIZE} />
              {media.premiumEffectFileId ? (
                <PremiumStickerEffect
                  media={media}
                  sticker={stickerBox(media, STICKER_SIZE)}
                  replay={premiumReplay}
                />
              ) : null}
            </div>
          ) : rich ? (
            <div
              className={`wx-bubble wx-bubble--rich${first.outgoing ? ' wx-bubble--self' : ''}`}
              onContextMenu={openMenu}
            >
              {repliedTo ? (
                <div className="wx-quote">
                  {repliedTo.senderName}：{messagePreview(repliedTo)}
                </div>
              ) : null}
              <RichMessage blocks={rich} chatId={chat.id} messageId={first.id} />
            </div>
          ) : contact ? (
            <div
              className={`wx-bubble wx-bubble--contact${first.outgoing ? ' wx-bubble--self' : ''}`}
              onContextMenu={openMenu}
            >
              {repliedTo ? (
                <div className="wx-quote">
                  {repliedTo.senderName}：{messagePreview(repliedTo)}
                </div>
              ) : null}
              <ContactCard contact={contact} />
            </div>
          ) : animatedEmoji ? (
            // One emoji: Telegram's animated sticker, no bubble. It plays once when
            // it arrives and replays with its sound on click (playback="once").
            <div className="wx-animated-emoji" onContextMenu={openMenu}>
              <StickerRenderer media={animatedEmoji} size={ANIMATED_EMOJI_SIZE} playback="once" />
            </div>
          ) : bigEmoji ? (
            // Emoji-only message: no bubble, large glyph, like WeChat big emoji.
            <div className="wx-big-emoji" onContextMenu={openMenu}>
              <RichText text={first.text} entities={first.entities} />
            </div>
          ) : (
            <div
              className={`wx-bubble${first.outgoing ? ' wx-bubble--self' : ''}${
                album
                  ? ' wx-bubble--media wx-bubble--album'
                  : mediaKind
                    ? ` wx-bubble--media wx-bubble--${mediaKind}`
                    : ''
              }`}
              onContextMenu={openMenu}
            >
              {repliedTo ? (
                <div className="wx-quote">
                  {repliedTo.senderName}：{messagePreview(repliedTo)}
                </div>
              ) : null}
              {album ? (
                <AlbumBubble chatId={chat.id} messages={messages} />
              ) : mediaKind && media ? (
                <MediaBubble media={media} kind={mediaKind} chatId={chat.id} messageId={first.id} />
              ) : null}
              {caption ? (
                <div className={mediaKind || album ? 'wx-caption' : undefined}>
                  <RichText text={caption.text} entities={caption.entities} />
                </div>
              ) : null}
              {!album && !mediaKind && !first.text ? (
                <span className="wx-bubble__empty">[不支持的消息]</span>
              ) : null}
            </div>
          )}
          {/* Telegram's inline keyboard is attached to the message, not to its
              bubble: under it, on the transcript's own background, so the buttons
              read as their own control strip instead of part of the body. */}
          {buttons ? <InlineButtons rows={buttons} /> : null}
          {/* 评论 N 条 (design doc §9.8): just the handle — the thread opens in the
              full-pane CommentPanel, like Telegram's discussion view. A thread that
              nobody has commented in yet keeps the handle too (写评论), or the reader
              could never be the first one. It is a row under the bubble, like any
              other control; only a channel post draws one (`isCommentablePost`). */}
          {commentBar}
          <span className="wx-message__meta">
            {formatMessageTime(last.date)}
            {last.edited ? ' · 已编辑' : ''}
            {readReceipt}
          </span>
        </div>

        <button
          className="wx-message-more"
          title="更多"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            onOpenMenu(first, rect.left, rect.bottom + 4)
          }}
        >
          ⋯
        </button>
      </div>
    )
  },
  (previous, next) =>
    previous.chat === next.chat &&
    previous.self === next.self &&
    previous.avatarUrl === next.avatarUrl &&
    previous.readOutboxMaxId === next.readOutboxMaxId &&
    previous.repliedTo === next.repliedTo &&
    previous.onOpenMenu === next.onOpenMenu &&
    previous.onOpenComments === next.onOpenComments &&
    sameRow(previous.messages, next.messages),
)

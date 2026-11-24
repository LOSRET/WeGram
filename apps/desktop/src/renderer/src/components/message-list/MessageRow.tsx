import type { ChatSummary, LinkPreview, Message } from '@wegram/protocol'
import { memo, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'

import { albumLayoutOf, resizeAlbum } from '../../lib/albumLayout'
import { hasCommentBar, isCommentablePost } from '../../lib/comments'
import { formatMessageTime, messagePreview } from '../../lib/format'
import { MSG_AVATAR, MSG_ROW_GAP } from '../../lib/listMetrics'
import { stickerBox } from '../../lib/stickerBox'
import { Avatar } from '../Avatar'
import { CustomEmoji } from '../CustomEmoji'
import {
  CHANNEL_MEDIA_INSET,
  CHANNEL_MEDIA_LIMITS,
  MediaBubble,
  channelMediaWidth,
} from '../MediaBubble'
import { ContactCard } from './ContactCard'
import { PollBubble } from './PollBubble'
import { ChannelMeta } from './ChannelMeta'
import { InlineButtons } from './InlineButtons'
import { RichMessage } from './RichMessage'
import { RichText } from '../RichText'
import { StickerRenderer } from '../StickerRenderer'
import { AlbumBubble } from './AlbumBubble'
import { CommentBar } from './CommentBar'
import { LinkPreviewCard } from './LinkPreviewCard'
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
  /**
   * 重试 a 未发送 row (`messages:resend`). Optional: the comment panel draws rows
   * from its own thread (no store, no resend path), and a retry button that
   * cannot work must not be drawn.
   */
  onResend?: (message: Message) => void
  /**
   * A sticker opens the box of the set it belongs to (design doc §8.5). Optional
   * like `onResend`: a row drawn outside the chat pane has no box to open.
   */
  onOpenStickerSet?: (setId: string) => void
  /**
   * A `/command` in the text: clicking sends it to the chat, the way the official
   * client runs a bot command. Optional like `onResend`: the comment panel draws
   * rows from its own thread and has no send path of its own.
   */
  onBotCommand?: (command: string) => void
  /** 即时预览 (§8.9): a link card's ⚡ bar opens the page in the reader. */
  onOpenInstantView?: (preview: LinkPreview) => void
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
 * A channel post keeps WeChat's bubble but takes Telegram's composition (see
 * `styles/channel.css`): the media, its caption and the 评论 handle are ONE block
 * — the photo sits inside the bubble, the caption under it, the handle as the
 * bubble's last row — closed by the view counter and the time. A post with no
 * bubble (a sticker, a big emoji) keeps that line under the body.
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
    onResend,
    onOpenStickerSet,
    onBotCommand,
    onOpenInstantView,
  }: MessageRowProps) {
    /**
     * A premium sticker's effect plays once; a tap on the sticker replays it, so
     * the row owns the counter and hands it to the effect.
     */
    const [premiumReplay, setPremiumReplay] = useState(0)
    /**
     * An album is composed at Telegram Desktop's 430 px and scaled down to the
     * bubble's cap when the pane is narrower, so the row's own width is measured
     * here — before the first paint, hence `useLayoutEffect`.
     */
    const rowRef = useRef<HTMLDivElement | null>(null)
    const [rowWidth, setRowWidth] = useState(0)
    const isAlbumRow = messages.length > 1
    useLayoutEffect(() => {
      const row = rowRef.current
      if (!row || !isAlbumRow) return
      const measure = (): void => setRowWidth(row.getBoundingClientRect().width)
      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(row)
      return () => observer.disconnect()
    }, [isAlbumRow])
    const first = messages[0]
    const last = messages[messages.length - 1]
    if (!first || !last) return null
    const interaction = first.interaction
    const channel = chat.kind === 'channel'

    if (first.kind === 'service') {
      return <div className="wx-service">{first.text || '系统消息'}</div>
    }

    // An album is a row of its own kind: the bubble is transparent, the grid draws
    // the media, and the group shares one meta line. A lone album item (the sibling
    // has not been paged in, or was deleted) still renders as a normal bubble.
    const album = messages.length > 1
    /** The album's composition, from the same pure geometry the cells are drawn with. */
    const albumLayout = album ? albumLayoutOf(messages) : null
    const media = first.media
    const mediaKind =
      first.kind === 'photo' ||
      first.kind === 'video' ||
      first.kind === 'file' ||
      first.kind === 'voice'
        ? first.kind
        : null
    const isSticker = !album && first.kind === 'sticker' && Boolean(media)
    /** The pack a sticker message came from; a click opens that pack's box. */
    const stickerSetId = isSticker ? media?.stickerSetId : undefined
    // Telegram's animated emoji: one emoji drawn as its sticker, no bubble.
    const animatedEmoji = !album && first.kind === 'emoji' ? media : undefined
    const bigEmoji = !album && first.kind === 'text' && !mediaKind && isEmojiOnly(first.text)
    // A rich message is a page of blocks; its `text` is only the flattened
    // words kept for previews and 复制, so it must not be rendered as a body.
    const rich = first.kind === 'rich' && first.rich?.length ? first.rich : undefined
    const contact = first.kind === 'contact' ? first.contact : undefined
    const poll = first.kind === 'poll' ? first.poll : undefined
    // An inline keyboard lives on the message, not in its content: text, photo
    // and rich bubbles all can carry one.
    const buttons = first.buttons?.length ? first.buttons : undefined
    // Telegram puts an album's caption on one of its items (normally the first).
    const caption = messages.find((message) => message.text) ?? null
    /**
     * 表情回应: an album shares one row, so the chips of its last item stand for the
     * group — Telegram draws them on the album's tail the same way. Display only:
     * WeChat has no reactions, so there is no picker yet (see protocol/reaction.ts).
     */
    const reactions = last.reactions?.length ? last.reactions : undefined
    /**
     * 语音转文字: the transcript of a voice note, once somebody asked for one. WeChat
     * shows it under the bubble and the 转文字 action is in the context menu; a
     * pending answer keeps its partial text so the words appear while they land.
     */
    const transcription = mediaKind === 'voice' && !album ? first.transcription : undefined
    const showSender = !first.outgoing && chat.kind !== 'private'
    const channelBubble = channel ? ' wx-bubble--channel' : ''
    /**
     * An album is Telegram's: composed at 430 px, and when the pane cannot hold
     * that it takes the row's own space — the avatar and the row's gap removed, the
     * 66 % text-bubble cap deliberately ignored — and `resizeAlbum` scales the
     * composition, seams included, like tdesktop's `countCurrentSize`.
     */
    const albumMaxWidth =
      rowWidth > 0
        ? Math.max(1, rowWidth - MSG_AVATAR - MSG_ROW_GAP - (channel ? 2 * CHANNEL_MEDIA_INSET : 0))
        : undefined
    const albumDrawn =
      albumLayout === null
        ? null
        : albumMaxWidth === undefined
          ? albumLayout
          : resizeAlbum(albumLayout, albumMaxWidth)

    /**
     * The bubble's width: a media post is as wide as its media, so the caption (and
     * the comment handle, in a channel) wraps inside it instead of widening the
     * bubble past the picture and leaving a strip of empty bubble on its right. An
     * album sets it for a plain chat too — a Telegram album is wider than a text
     * bubble, which is what `.wx-bubble--album`'s `max-width: none` allows.
     */
    const mediaFrameWidth =
      albumDrawn !== null
        ? albumDrawn.width + (channel ? 2 * CHANNEL_MEDIA_INSET : 0)
        : channel && media && (mediaKind === 'photo' || mediaKind === 'video')
          ? channelMediaWidth(mediaKind, media) + 2 * CHANNEL_MEDIA_INSET
          : undefined

    const openMenu = (event: MouseEvent): void => {
      event.preventDefault()
      onOpenMenu(first, event.clientX, event.clientY)
    }

    const readReceipt = last.outgoing ? (readOutboxMaxId >= last.id ? ' · 已读' : ' · 未读') : ''

    /**
     * The channel footer: views and time in the bubble's bottom-right corner, or
     * under a body that has no bubble (a sticker, a big emoji). A channel post has
     * no read receipt — it is none of the reader's business.
     */
    const channelMeta = (outside = false): ReactNode =>
      channel ? (
        <ChannelMeta
          time={last.date}
          edited={last.edited}
          views={interaction?.views}
          outside={outside}
        />
      ) : null

    const commentBar =
      hasCommentBar(interaction) && isCommentablePost(chat) ? (
        <CommentBar interaction={interaction} onOpen={() => onOpenComments(first)} />
      ) : null

    return (
      <div
        className={`wx-message-row${first.outgoing ? ' wx-message-row--self' : ''}`}
        ref={rowRef}
      >
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
            <>
              <div
                className="wx-sticker-wrap"
                onContextMenu={openMenu}
                onClick={
                  stickerSetId && onOpenStickerSet
                    ? () => onOpenStickerSet(stickerSetId)
                    : media.premiumEffectFileId
                      ? () => setPremiumReplay((count) => count + 1)
                      : undefined
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
              {channelMeta(true)}
            </>
          ) : rich ? (
            <div
              className={`wx-bubble wx-bubble--rich${
                first.outgoing ? ' wx-bubble--self' : ''
              }${channelBubble}`}
              onContextMenu={openMenu}
            >
              {repliedTo ? (
                <div className="wx-quote">
                  {repliedTo.senderName}：{messagePreview(repliedTo)}
                </div>
              ) : null}
              <RichMessage blocks={rich} chatId={chat.id} messageId={first.id} />
              {channelMeta()}
              {channel ? commentBar : null}
            </div>
          ) : contact ? (
            <div
              className={`wx-bubble wx-bubble--contact${
                first.outgoing ? ' wx-bubble--self' : ''
              }${channelBubble}`}
              onContextMenu={openMenu}
            >
              {repliedTo ? (
                <div className="wx-quote">
                  {repliedTo.senderName}：{messagePreview(repliedTo)}
                </div>
              ) : null}
              <ContactCard contact={contact} />
              {channelMeta()}
              {channel ? commentBar : null}
            </div>
          ) : poll ? (
            <div
              className={`wx-bubble wx-bubble--poll${
                first.outgoing ? ' wx-bubble--self' : ''
              }${channelBubble}`}
              onContextMenu={openMenu}
            >
              {repliedTo ? (
                <div className="wx-quote">
                  {repliedTo.senderName}：{messagePreview(repliedTo)}
                </div>
              ) : null}
              <PollBubble chatId={chat.id} messageId={first.id} poll={poll} />
              {channelMeta()}
              {channel ? commentBar : null}
            </div>
          ) : animatedEmoji ? (
            // One emoji: Telegram's animated sticker, no bubble. It plays once when
            // it arrives and replays with its sound on click (playback="once").
            <>
              <div className="wx-animated-emoji" onContextMenu={openMenu}>
                <StickerRenderer media={animatedEmoji} size={ANIMATED_EMOJI_SIZE} playback="once" />
              </div>
              {channelMeta(true)}
            </>
          ) : bigEmoji ? (
            // Emoji-only message: no bubble, large glyph, like WeChat big emoji.
            <>
              <div className="wx-big-emoji" onContextMenu={openMenu}>
                <RichText text={first.text} entities={first.entities} onBotCommand={onBotCommand} />
              </div>
              {channelMeta(true)}
            </>
          ) : (
            <div
              className={`wx-bubble${first.outgoing ? ' wx-bubble--self' : ''}${channelBubble}${
                album
                  ? ' wx-bubble--media wx-bubble--album'
                  : mediaKind
                    ? ` wx-bubble--media wx-bubble--${mediaKind}`
                    : ''
              }`}
              {...(mediaFrameWidth === undefined ? {} : { style: { width: mediaFrameWidth } })}
              onContextMenu={openMenu}
            >
              {repliedTo ? (
                <div className="wx-quote">
                  {repliedTo.senderName}：{messagePreview(repliedTo)}
                </div>
              ) : null}
              {album && albumDrawn ? (
                <AlbumBubble chatId={chat.id} messages={messages} layout={albumDrawn} />
              ) : mediaKind && media ? (
                <MediaBubble
                  media={media}
                  kind={mediaKind}
                  chatId={chat.id}
                  messageId={first.id}
                  // 语音消息 mirrors its seconds/waves by side, like the client's.
                  outgoing={first.outgoing}
                  // Telegram's GIF badge steps aside when the animation has a caption.
                  showAnimationBadge={!caption}
                  // A channel post is Telegram's card, so its photo may grow past
                  // WeChat's 240 px bubble photograph.
                  {...(channel ? CHANNEL_MEDIA_LIMITS : {})}
                />
              ) : null}
              {caption ? (
                <div className={mediaKind || album ? 'wx-caption' : undefined}>
                  <RichText
                    text={caption.text}
                    entities={caption.entities}
                    onBotCommand={onBotCommand}
                  />
                </div>
              ) : null}
              {/* Telegram's link preview is a block of the same bubble, under the
                  text (or above it when the page asked for its picture first). */}
              {first.linkPreview ? (
                <LinkPreviewCard
                  preview={first.linkPreview}
                  {...(onOpenInstantView ? { onOpenInstantView } : {})}
                />
              ) : null}
              {channelMeta()}
              {!album && !mediaKind && !first.text && !first.linkPreview ? (
                <span className="wx-bubble__empty">[不支持的消息]</span>
              ) : null}
              {channel ? commentBar : null}
            </div>
          )}
          {transcription ? (
            <div
              className={`wx-transcript${transcription.status === 'error' ? ' wx-transcript--error' : ''}`}
            >
              {transcription.status === 'error'
                ? (transcription.error ?? '转写失败')
                : (transcription.text ?? '正在转写…')}
            </div>
          ) : null}
          {reactions ? (
            <div className="wx-reactions">
              {reactions.map((reaction, index) => (
                <span
                  key={reaction.emoji ?? reaction.customEmojiId ?? `reaction-${index}`}
                  className={`wx-reaction${reaction.chosen ? ' wx-reaction--chosen' : ''}`}
                  title={`${reaction.count} 人回应`}
                >
                  {reaction.customEmojiId ? (
                    <CustomEmoji id={reaction.customEmojiId} glyph="🙂" />
                  ) : (
                    <span className="wx-reaction__emoji">{reaction.emoji}</span>
                  )}
                  <span className="wx-reaction__count">{reaction.count}</span>
                </span>
              ))}
            </div>
          ) : null}
          {/* Telegram's inline keyboard is attached to the message, not to its
              bubble: under it, on the transcript's own background, so the buttons
              read as their own control strip instead of part of the body. */}
          {buttons ? <InlineButtons rows={buttons} chatId={chat.id} messageId={first.id} /> : null}
          {/* 未发送: always visible, unlike the hover meta — a failed message that
              looks delivered is the one bug this row exists to prevent. */}
          {last.sendingState === 'failed' && onResend ? (
            <button
              className="wx-message__retry"
              title={last.sendError ?? '发送失败'}
              onClick={() => onResend(last)}
              disabled={last.canRetry === false}
            >
              未发送{last.canRetry === false ? '' : '，点击重试'}
            </button>
          ) : null}
          {/* 评论 N 条 (design doc §9.8): just the handle — the thread opens in the
              full-pane CommentPanel, like Telegram's discussion view. A thread that
              nobody has commented in yet keeps the handle too (写评论), or the reader
              could never be the first one. In a channel the handle lives inside the
              post's bubble; a bubble-less post (sticker, big emoji) keeps it outside. */}
          {channel ? (isSticker || bigEmoji || animatedEmoji ? commentBar : null) : commentBar}
          {channel ? null : (
            <span className="wx-message__meta">
              {formatMessageTime(last.date)}
              {last.edited ? ' · 已编辑' : ''}
              {readReceipt}
            </span>
          )}
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
    previous.onResend === next.onResend &&
    previous.onOpenStickerSet === next.onOpenStickerSet &&
    previous.onBotCommand === next.onBotCommand &&
    previous.onOpenInstantView === next.onOpenInstantView &&
    sameRow(previous.messages, next.messages),
)

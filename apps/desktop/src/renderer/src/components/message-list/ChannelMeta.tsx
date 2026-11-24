import { formatCount } from '../../lib/comments'
import { formatMessageTime } from '../../lib/format'

/**
 * The line Telegram puts in the bottom-right corner of a channel post: the view
 * counter with its eye glyph, the optional author signature, then the time (and
 * 已编辑 when the post was edited).
 *
 * `outside` is for a post that has no bubble to sit in — a sticker or a big emoji —
 * where the line moves under the body instead of into it.
 */
export function ChannelMeta({
  time,
  edited,
  views,
  authorSignature,
  outside,
}: {
  time: number
  edited: boolean | undefined
  /** TDLib `view_count`; absent on a chat that has no view counter. */
  views: number | undefined
  /** TDLib `message.author_signature`; plain text, never a profile link. */
  authorSignature?: string
  outside?: boolean
}) {
  return (
    <div className={`wx-channel-meta${outside ? ' wx-channel-meta--outside' : ''}`}>
      {views ? (
        <span className="wx-channel-meta__views" title={`${views} 次阅读`}>
          <ViewsIcon />
          {formatCount(views)}
        </span>
      ) : null}
      {authorSignature ? (
        <span className="wx-channel-meta__author" title={`作者签名：${authorSignature}`}>
          <SignatureIcon />
          <span className="wx-channel-meta__author-text" dir="auto">
            {authorSignature}
          </span>
        </span>
      ) : null}
      <span className="wx-channel-meta__time">
        {formatMessageTime(time)}
        {edited ? ' · 已编辑' : ''}
      </span>
    </div>
  )
}

/**
 * The views eye. Drawn here rather than in `WechatIcons` (that file is extracted
 * verbatim from Weixin.dll and must not be hand-edited).
 */
function ViewsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 5.2c4.9 0 8.9 3.6 10 6.8-1.1 3.2-5.1 6.8-10 6.8S3.1 15.2 2 12c1.1-3.2 5.1-6.8 10-6.8Zm0 2.2a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2Zm0 2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Z"
      />
    </svg>
  )
}

/** A handwritten flourish marks the signature without making it a profile link. */
function SignatureIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 17c3.4 0 4.4-1.4 5.8-4.2C10.4 9.5 12.2 6 15.3 6c1.8 0 2.8 1 2.8 2.5 0 3.1-4.1 3.8-6.1 6-1.2 1.4-1.5 3.2-.6 4.6" />
      <path d="M5 20h5" />
    </svg>
  )
}

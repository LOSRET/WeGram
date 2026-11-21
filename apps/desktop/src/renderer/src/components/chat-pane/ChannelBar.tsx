import { KeyboardIcon } from '../WechatIcons'

interface ChannelBarProps {
  /** The server's mute flag for this chat. */
  muted: boolean
  /** This account may post here: the card gets the keyboard switch on the right. */
  canPost: boolean
  /**
   * This account subscribes to the channel. A channel opened from 搜索 or an
   * `@username` is only being previewed, so the card offers 加入 instead of 静音.
   */
  joined: boolean
  /** Joining files an administrator's request rather than subscribing at once. */
  joinByRequest: boolean
  /** The request was sent: the item reports it instead of asking again. */
  joinRequested: boolean
  /** A 加入 call is in flight. */
  joinBusy: boolean
  /** A mute request is in flight, so the item cannot be double-toggled. */
  busy: boolean
  onJoin: () => void
  onToggleMute: () => void
  /** Swaps this card for the composer. */
  onOpenInput: () => void
}

/**
 * The bottom edge of a channel, modelled on WeChat's 服务号 card: a bordered row
 * with its menu item(s) and the keyboard switch on the right.
 *
 * A channel this account has not joined yet gets a single 加入 item (申请加入 when
 * the channel asks for approval) and never the keyboard — 静音 on a channel one
 * has not subscribed to is a lie, and posting is not on offer either way. A
 * channel the account belongs to keeps the 静音 item; one it manages also gets
 * the keyboard, which is the only way into the composer.
 */
export function ChannelBar({
  muted,
  canPost,
  joined,
  joinByRequest,
  joinRequested,
  joinBusy,
  busy,
  onJoin,
  onToggleMute,
  onOpenInput,
}: ChannelBarProps) {
  const joinLabel = joinRequested ? '已申请加入' : joinByRequest ? '申请加入' : '加入'
  return (
    <div className="wx-channel-bar">
      <div className="wx-channel-bar__card">
        <div className="wx-channel-bar__menu">
          {joined ? (
            <button
              className="wx-channel-bar__item"
              onClick={onToggleMute}
              disabled={busy}
              title={muted ? '恢复这个频道的消息提醒' : '静音这个频道'}
            >
              {muted ? '取消静音' : '静音'}
            </button>
          ) : (
            <button
              className="wx-channel-bar__item"
              onClick={onJoin}
              disabled={joinBusy || joinRequested}
              title={
                joinRequested
                  ? '已提交加入申请，等待管理员通过'
                  : joinByRequest
                    ? '申请加入这个频道'
                    : '加入这个频道'
              }
            >
              {joinBusy ? '正在加入…' : joinLabel}
            </button>
          )}
        </div>
        {joined && canPost ? (
          <button
            className="wx-channel-bar__keyboard"
            onClick={onOpenInput}
            title="键盘输入"
            aria-label="键盘输入"
          >
            <KeyboardIcon size={20} />
          </button>
        ) : null}
      </div>
    </div>
  )
}

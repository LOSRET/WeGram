import { KeyboardIcon } from '../WechatIcons'

interface ChannelBarProps {
  /** The server's mute flag for this chat. */
  muted: boolean
  /** This account may post here: the card gets the keyboard switch on the right. */
  canPost: boolean
  /** A mute request is in flight, so the item cannot be double-toggled. */
  busy: boolean
  onToggleMute: () => void
  /** Swaps this card for the composer. */
  onOpenInput: () => void
}

/**
 * The bottom edge of a channel, modelled on WeChat's 服务号 card: a bordered row
 * with its menu item(s) and the keyboard switch on the right.
 *
 * A channel this account can only read keeps the 静音 item; one the account
 * manages also gets the keyboard, which is the only way into the composer.
 */
export function ChannelBar({ muted, canPost, busy, onToggleMute, onOpenInput }: ChannelBarProps) {
  return (
    <div className="wx-channel-bar">
      <div className="wx-channel-bar__card">
        <div className="wx-channel-bar__menu">
          <button
            className="wx-channel-bar__item"
            onClick={onToggleMute}
            disabled={busy}
            title={muted ? '恢复这个频道的消息提醒' : '静音这个频道'}
          >
            {muted ? '取消静音' : '静音'}
          </button>
        </div>
        {canPost ? (
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

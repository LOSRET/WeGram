import { Avatar } from '../Avatar'

interface BotStartPlaceholderProps {
  chatId: number
  title: string
  avatarUrl?: string
  description: string
  checking: boolean
  busy: boolean
  onStart: () => void
}

/**
 * Telegram's first-open bot screen: the bot's empty-chat introduction and the
 * 开始 action that sends `/start` through the normal transcript send path.
 */
export function BotStartPlaceholder({
  chatId,
  title,
  avatarUrl,
  description,
  checking,
  busy,
  onStart,
}: BotStartPlaceholderProps) {
  if (checking) {
    return (
      <div className="wx-bot-start wx-bot-start--checking" aria-live="polite">
        <div className="wx-spinner" />
        <div>正在读取机器人信息…</div>
      </div>
    )
  }

  return (
    <div className="wx-bot-start">
      <div className="wx-bot-start__body">
        <Avatar
          className="wx-avatar wx-bot-start__avatar"
          url={avatarUrl}
          name={title}
          colorId={chatId}
        />
        {description ? <p className="wx-bot-start__description">{description}</p> : null}
      </div>
      <div className="wx-bot-start__footer">
        <button
          type="button"
          className="wx-bot-start__button"
          disabled={busy}
          aria-busy={busy}
          onClick={onStart}
        >
          {busy ? '正在开始…' : '开始'}
        </button>
      </div>
    </div>
  )
}

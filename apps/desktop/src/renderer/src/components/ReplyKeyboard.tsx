import type { ReplyKeyboard as ReplyKeyboardLayout, ReplyKeyboardButton } from '@wegram/protocol'

interface ReplyKeyboardProps {
  keyboard: ReplyKeyboardLayout
  /** A send is in flight: one press at a time, like 发送. */
  busy: boolean
  onPress: (button: ReplyKeyboardButton) => void
}

/**
 * A bot's custom reply keyboard (§8.3), attached under the input the way
 * Telegram's is.
 *
 * WeChat has no keyboard of this kind, so the grid borrows this app's language:
 * one row per TDLib row, keys sharing the row evenly (the widths a bot sends are
 * hints), inside the same bordered card the composer draws. A key whose
 * `sendsText` is false asks for a phone number, a location or a chat — this
 * client cannot produce those, so it is drawn dimmed and refuses on press
 * instead of posting its label as a message. A Web App key is the exception:
 * it carries `webAppUrl`, opens a Mini App (§9.4), and stays undimmed.
 */
export function ReplyKeyboard({ keyboard, busy, onPress }: ReplyKeyboardProps) {
  return (
    <div className="wx-bot-keyboard" role="group" aria-label="机器人键盘">
      {keyboard.rows.map((row, rowIndex) => (
        <div className="wx-bot-keyboard__row" key={rowIndex}>
          {row.map((button, index) => (
            <button
              type="button"
              key={`${rowIndex}:${index}`}
              className={
                'wx-bot-keyboard__key' +
                (button.sendsText || button.webAppUrl ? '' : ' wx-bot-keyboard__key--inert')
              }
              disabled={busy}
              onClick={() => onPress(button)}
            >
              {button.text}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

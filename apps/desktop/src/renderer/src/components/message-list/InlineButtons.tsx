import type { CallbackAnswer, InlineButton } from '@wegram/protocol'
import { useState } from 'react'

import { errorMessage, invoke } from '../../lib/ipc'
import { openTelegramLink } from '../../lib/openTelegramLink'
import { telegramLinkTarget } from '../../lib/telegramLink'
import { useAppStore } from '../../store/useAppStore'
import { safeHref } from '../RichText'
import { TelegramLink } from '../TelegramLink'

interface InlineButtonsProps {
  rows: InlineButton[][]
  /** The chat and message the keyboard hangs off: where a press posts to. */
  chatId: number
  messageId: number
  /**
   * The bot the keyboard belongs to (the message's sender), needed by a Mini App
   * button: TDLib's `openWebApp` scopes the signed URL to it (§9.4). Absent in
   * an 即时预览 page, which has no message behind its rows.
   */
  botUserId?: number
}

/**
 * Telegram's inline keyboard under a message bubble.
 *
 * URL buttons are plain links, so the shell's existing `setWindowOpenHandler`
 * (windows.ts) sends them to the OS and the renderer never navigates. A callback
 * button posts its payload back to the bot (`bots:callback`) and the bot's answer
 * is drawn — a toast, an alert dialog, or a URL to open. A Web App button opens
 * the Mini App window through `miniapp:open` (design doc §9.4.1); anything else
 * stays inert and says so instead of pretending to work.
 */
export function InlineButtons({ rows, chatId, messageId, botUserId }: InlineButtonsProps) {
  /** `row:index` of the button whose callback is in flight: one press at a time. */
  const [pressing, setPressing] = useState<string | null>(null)

  const openWebApp = (button: InlineButton, key: string): void => {
    if (!botUserId) {
      useAppStore.getState().setToast('这个按钮需要机器人消息才能打开')
      return
    }
    if (pressing) return
    setPressing(key)
    void (async () => {
      try {
        await invoke('miniapp:open', {
          source: 'inline',
          chatId,
          botUserId,
          url: button.webAppUrl ?? '',
          buttonText: button.text,
        })
      } catch (error) {
        useAppStore.getState().setError(errorMessage(error))
      } finally {
        setPressing(null)
      }
    })()
  }

  const press = (button: InlineButton, key: string): void => {
    if (button.webAppUrl) {
      openWebApp(button, key)
      return
    }
    const callback = button.callback
    if (!callback) {
      useAppStore.getState().setToast('这类按钮暂未支持')
      return
    }
    if (callback.type === 'password') {
      // TDLib's `callbackQueryPayloadDataWithPassword` wants the account's
      // 2-step password, and this client has no prompt for it yet.
      useAppStore.getState().setToast('需要两步验证密码的按钮暂未支持')
      return
    }
    if (pressing) return
    setPressing(key)
    void (async () => {
      try {
        const answer = await invoke('bots:callback', { chatId, messageId, callback })
        showAnswer(answer)
      } catch (error) {
        useAppStore.getState().setError(errorMessage(error))
      } finally {
        setPressing(null)
      }
    })()
  }

  return (
    <div className="wx-inline-buttons">
      {rows.map((row, rowIndex) => (
        <div className="wx-inline-buttons__row" key={rowIndex}>
          {row.map((button, index) => {
            const key = `${rowIndex}:${index}`
            const href = safeHref(button.url)
            // The bot's own style (primary / danger / success / link); the
            // ordinary grey button — no style, or an explicit `default` — gets
            // the plain fill. Every button therefore carries exactly one style
            // class, so the plain fill (and its theme variant) can never
            // out-cascade a coloured one.
            const tone = button.style && button.style !== 'default' ? button.style : 'plain'
            const tint = ' wx-inline-button--' + tone
            return href ? (
              <TelegramLink className={'wx-inline-button' + tint} href={href} key={index}>
                {button.text}
              </TelegramLink>
            ) : (
              <button
                type="button"
                className={
                  'wx-inline-button' +
                  tint +
                  (button.callback || button.webAppUrl ? '' : ' wx-inline-button--inert')
                }
                key={index}
                disabled={pressing === key}
                aria-busy={pressing === key}
                onClick={() => press(button, key)}
              >
                {button.text}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/**
 * Draws what the bot answered. TDLib's answer carries three independent things:
 * a URL to open, a text, and whether that text is an alert instead of a toast.
 */
function showAnswer(answer: CallbackAnswer): void {
  if (answer.url) {
    // A t.me link still opens inside the app; anything else follows the shell's
    // usual external-link policy (the anchor's `target="_blank"` route).
    const target = telegramLinkTarget(answer.url)
    if (target) openTelegramLink(target)
    else window.open(answer.url, '_blank', 'noopener')
  }
  if (!answer.text) return
  const store = useAppStore.getState()
  if (answer.showAlert) store.setAlert(answer.text)
  else store.setToast(answer.text)
}

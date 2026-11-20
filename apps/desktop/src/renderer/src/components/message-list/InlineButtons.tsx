import type { InlineButton } from '@wegram/protocol'

import { useAppStore } from '../../store/useAppStore'
import { safeHref } from '../RichText'

interface InlineButtonsProps {
  rows: InlineButton[][]
}

/**
 * Telegram's inline keyboard under a message bubble.
 *
 * URL buttons are plain links, so the shell's existing `setWindowOpenHandler`
 * (windows.ts) sends them to the OS and the renderer never navigates. The other
 * kinds are drawn but say what they cannot do instead of pretending to work:
 * pressing a callback button posts data to a bot, which this client does not do.
 */
export function InlineButtons({ rows }: InlineButtonsProps) {
  return (
    <div className="wx-inline-buttons">
      {rows.map((row, rowIndex) => (
        <div className="wx-inline-buttons__row" key={rowIndex}>
          {row.map((button, index) => {
            const href = safeHref(button.url)
            // The bot's own style (primary / danger / success / link); the
            // ordinary grey button — no style, or an explicit `default` — gets
            // the plain fill. Every button therefore carries exactly one style
            // class, so the plain fill (and its theme variant) can never
            // out-cascade a coloured one.
            const tone = button.style && button.style !== 'default' ? button.style : 'plain'
            const tint = ' wx-inline-button--' + tone
            return href ? (
              <a
                className={'wx-inline-button' + tint}
                href={href}
                key={index}
                target="_blank"
                rel="noreferrer"
              >
                {button.text}
              </a>
            ) : (
              <button
                type="button"
                className={'wx-inline-button' + tint + ' wx-inline-button--inert'}
                key={index}
                onClick={() => explain(button)}
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

function explain(button: InlineButton): void {
  useAppStore.getState().setToast(button.callback ? '机器人按钮的回调暂未支持' : '这类按钮暂未支持')
}

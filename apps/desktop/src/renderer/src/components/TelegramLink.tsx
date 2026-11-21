import type { ReactNode } from 'react'

import { openTelegramLink } from '../lib/openTelegramLink'
import { telegramLinkTarget } from '../lib/telegramLink'

interface TelegramLinkProps {
  href: string
  className?: string | undefined
  children: ReactNode
}

/**
 * The one anchor for message text and inline-keyboard buttons (design doc §8.3).
 *
 * A Telegram link loads its content in the app — the chat, and the post when the
 * link names one — while every other protocol keeps the shell's external-link
 * policy (`setWindowOpenHandler` → `shell.openExternal`). The `href` stays, so
 * copy-link and the browser's own affordances still describe the same target, and
 * modifier/middle clicks keep their usual meaning: open it outside on purpose.
 */
export function TelegramLink({ href, className, children }: TelegramLinkProps) {
  const target = telegramLinkTarget(href)
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        if (!target) return
        if (
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }
        event.preventDefault()
        openTelegramLink(target)
      }}
    >
      {children}
    </a>
  )
}

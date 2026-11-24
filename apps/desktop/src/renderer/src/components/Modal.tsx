import type { FormEvent, MouseEvent, ReactNode } from 'react'

import { useEscapeKey } from '../lib/useEscapeKey'

interface ModalProps {
  onClose: () => void
  /** Extra classes for the sheet (`wx-modal--small`, `wx-report`, …). */
  className?: string
  /** A sheet that is a form (新建话题-style inputs) submits through `onSubmit`. */
  as?: 'div' | 'form'
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  /** The dialog's accessible name; every sheet names itself. */
  label: string
  /** Esc does something else than close (e.g. cancel an inline editor). */
  onEscape?: () => void
  children: ReactNode
}

/**
 * The one modal shell: the dimmed backdrop and the centred sheet.
 *
 * Every sheet in the app used to spell this out — backdrop click closes, the sheet
 * stops the click, and a copy of the `wx-modal` classes — with Escape, role and
 * aria only on some of them. This is that shell once. `wx-modal` and `wx-modal--*`
 * stay the measured class names (styles/*.css); callers only add their variant.
 */
export function Modal({
  onClose,
  className,
  as = 'div',
  onSubmit,
  label,
  onEscape,
  children,
}: ModalProps) {
  useEscapeKey(onEscape ?? onClose, { stopPropagation: true })

  const sheet = className ? `wx-modal ${className}` : 'wx-modal'
  const stop = (event: MouseEvent): void => event.stopPropagation()

  return (
    <div className="wx-modal-backdrop" onClick={onClose}>
      {as === 'form' ? (
        <form
          className={sheet}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          onClick={stop}
          onSubmit={onSubmit}
        >
          {children}
        </form>
      ) : (
        <div className={sheet} role="dialog" aria-modal="true" aria-label={label} onClick={stop}>
          {children}
        </div>
      )}
    </div>
  )
}

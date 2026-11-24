interface AlertDialogProps {
  title?: string
  /** The bot's text, free-form: line breaks are kept (see the CSS class). */
  message: string
  onClose: () => void
}

/**
 * A bot's alert answer (TDLib `callbackQueryAnswer.show_alert`).
 *
 * The answer is one string the bot wants the reader to acknowledge, so it is a
 * modal with a single 确定 — not a toast that would vanish before it was read
 * (design doc §8.3). WeChat's confirm sheet supplies the shape; only the second
 * button is gone.
 */
export function AlertDialog({ title, message, onClose }: AlertDialogProps) {
  return (
    <div className="wx-modal-backdrop" onClick={onClose}>
      <div className="wx-modal wx-modal--small" onClick={(event) => event.stopPropagation()}>
        <div className="wx-dialog__title">{title ?? '提示'}</div>
        <div className="wx-dialog__body wx-dialog__body--alert">{message}</div>
        <div className="wx-dialog__actions">
          <button className="wx-dialog__confirm" onClick={onClose}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}

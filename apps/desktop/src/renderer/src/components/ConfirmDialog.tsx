import { Modal } from './Modal'

interface ConfirmDialogProps {
  title: string
  description?: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** WeChat's confirm sheet: centred title, grey body, hairline-separated buttons. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal className="wx-modal--small" label={title} onClose={onCancel}>
      <div className="wx-dialog__title">{title}</div>
      {description ? <div className="wx-dialog__body">{description}</div> : null}
      <div className="wx-dialog__actions">
        <button onClick={onCancel}>取消</button>
        <button
          className={`wx-dialog__confirm${danger ? ' wx-dialog__confirm--danger' : ''}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

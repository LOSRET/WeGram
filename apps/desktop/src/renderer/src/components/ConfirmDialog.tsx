interface ConfirmDialogProps {
  title: string
  description?: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="wx-modal-backdrop" onClick={onCancel}>
      <div className="wx-modal wx-modal--small" onClick={(event) => event.stopPropagation()}>
        <div className="wx-modal__header">
          <span>{title}</span>
        </div>
        {description ? <div className="wx-hint">{description}</div> : null}
        <div className="wx-row">
          <button className="wx-button wx-button--ghost" onClick={onCancel}>
            取消
          </button>
          <button
            className="wx-button"
            style={danger ? { background: 'var(--wx-danger)' } : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

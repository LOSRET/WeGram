import { Modal } from './Modal'
import { ProxyForm } from './proxy/ProxyForm'

interface ProxyPanelProps {
  onClose: () => void
  /**
   * Where a load failure is reported. The shell keeps it in the store; the login
   * window (which owns no store slice) hands in its own error line instead.
   */
  onError?: (message: string) => void
}

/**
 * 设置 · 代理 as a modal, which is what the login window shows (design doc §9.6).
 *
 * The form itself lives in `proxy/ProxyForm.tsx`: 设置 → 网络与代理 renders the
 * same controls inline, and a second copy of a form that writes TDLib's proxy is
 * exactly the kind of drift that makes one of them silently stop applying.
 */
export function ProxyPanel({ onClose, onError }: ProxyPanelProps) {
  return (
    <Modal label="设置 · 代理" onClose={onClose}>
      <div className="wx-modal__header">
        <span>设置 · 代理</span>
        <button className="wx-icon-button" onClick={onClose} title="关闭">
          ×
        </button>
      </div>
      <ProxyForm onError={onError} />
    </Modal>
  )
}

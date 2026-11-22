import type { ChatReport } from '@wegram/protocol'
import { useEffect, useState } from 'react'

import { errorMessage, invoke } from '../lib/ipc'
import { useAppStore } from '../store/useAppStore'

interface ReportDialogProps {
  userId: number
  onClose: () => void
}

/**
 * 举报: Telegram files a report in phases, so this sheet is a small state machine
 * rather than one dialog — the first answer names the reasons, the chosen reason
 * may ask for a comment (with a *new* id to send back), and only then is the
 * report filed. The ids are TDLib `bytes` values: they are handed back exactly as
 * they arrived and never interpreted here.
 *
 * `messagesRequired` is Telegram asking for specific messages instead of a chat;
 * this client has no per-message report path, so the sheet says so instead of
 * pretending the report was filed.
 */
export function ReportDialog({ userId, onClose }: ReportDialogProps) {
  const [report, setReport] = useState<ChatReport | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void invoke('users:report', { userId })
      .then((answer) => {
        if (!cancelled) setReport(answer)
      })
      .catch((error) => {
        if (cancelled) return
        useAppStore.getState().setError(errorMessage(error))
        onClose()
      })
    return () => {
      cancelled = true
    }
  }, [userId, onClose])

  const submit = async (optionId: string, text?: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const answer = await invoke('users:report', {
        userId,
        optionId,
        ...(text === undefined || text.length === 0 ? {} : { text }),
      })
      if (answer.reported) {
        useAppStore.getState().setToast('已提交举报')
        onClose()
        return
      }
      if (answer.messagesRequired) {
        useAppStore.getState().setError('Telegram 要求选择具体消息，本客户端暂不支持')
        setBusy(false)
        return
      }
      // Either the comment step or the reason list again.
      setReport(answer)
      setBusy(false)
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
      setBusy(false)
    }
  }

  const needsComment = report?.textRequired === true

  return (
    <div className="wx-modal-backdrop" onClick={onClose}>
      <div
        className="wx-modal wx-modal--small wx-report"
        role="dialog"
        aria-label="举报"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wx-dialog__title">{report?.title ?? '举报'}</div>

        {needsComment ? (
          <>
            <div className="wx-dialog__body">这个举报需要补充说明。</div>
            <textarea
              className="wx-report__comment"
              value={comment}
              autoFocus
              maxLength={4000}
              placeholder="补充说明"
              onChange={(event) => setComment(event.target.value)}
            />
            <button
              type="button"
              className="wx-profile__action"
              disabled={busy || comment.trim().length === 0}
              onClick={() => void submit(report?.optionId ?? '', comment)}
            >
              提交举报
            </button>
          </>
        ) : report?.options?.length ? (
          <div className="wx-report__options">
            {report.options.map((option) => (
              <button
                key={option.id}
                type="button"
                className="wx-report__option"
                disabled={busy}
                onClick={() => void submit(option.id)}
              >
                {option.text}
              </button>
            ))}
          </div>
        ) : (
          <div className="wx-dialog__body">正在读取举报原因…</div>
        )}

        <div className="wx-dialog__actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

import type { ChatReport } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { errorMessage, invoke } from '../lib/ipc'
import { useAppStore } from '../store/useAppStore'
import { ChevronRightIcon } from './Icon'
import { Modal } from './Modal'

/**
 * What the sheet reports. One sheet serves both entry points — the 资料卡's
 * 举报 and the message menu's — because Telegram's phased answer is the same
 * either way; only the channel and its payload differ.
 */
export type ReportTarget =
  { kind: 'user'; userId: number } | { kind: 'message'; chatId: number; messageId: number }

interface ReportDialogProps {
  target: ReportTarget
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
 * the message menu's path sends them, so the chat-level answer points there
 * rather than pretending the report was filed.
 */
export function ReportDialog({ target, onClose }: ReportDialogProps) {
  const [report, setReport] = useState<ChatReport | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  /**
   * The ids, not the `target` object: a caller builds a fresh literal every
   * render, and an object dependency would re-run the first request forever.
   */
  const userId = target.kind === 'user' ? target.userId : null
  const chatId = target.kind === 'message' ? target.chatId : null
  const messageId = target.kind === 'message' ? target.messageId : null

  /**
   * `onClose` is usually an inline arrow. Reading it through a ref keeps the one
   * initial request from re-running every time the parent re-renders — a
   * re-render would reset the sheet to "正在读取举报原因…" mid-flow.
   */
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  const ask = useCallback(
    (input: { optionId?: string; text?: string } = {}): Promise<ChatReport> => {
      if (userId !== null) return invoke('users:report', { userId, ...input })
      if (chatId !== null && messageId !== null) {
        return invoke('messages:report', { chatId, messageId, ...input })
      }
      return Promise.reject(new Error('举报目标缺失'))
    },
    [userId, chatId, messageId],
  )

  useEffect(() => {
    let cancelled = false
    void ask()
      .then((answer) => {
        if (!cancelled) setReport(answer)
      })
      .catch((error) => {
        if (cancelled) return
        useAppStore.getState().setError(errorMessage(error))
        closeRef.current()
      })
    return () => {
      cancelled = true
    }
  }, [ask])

  const submit = async (optionId: string, text?: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const answer = await ask({
        optionId,
        ...(text === undefined || text.length === 0 ? {} : { text }),
      })
      if (answer.reported) {
        useAppStore.getState().setToast('已提交举报')
        onClose()
        return
      }
      if (answer.messagesRequired) {
        useAppStore.getState().setError('Telegram 要求指定具体消息，请在该消息的菜单里举报')
        setBusy(false)
        return
      }
      // Either the comment step or the reason list again. The comment step carries
      // no title (`reportChatResultTextRequired` has none), so keep the one the
      // reasons came with.
      setReport((current) =>
        answer.title === undefined && current?.title !== undefined
          ? { ...answer, title: current.title }
          : answer,
      )
      setBusy(false)
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
      setBusy(false)
    }
  }

  const needsComment = report?.textRequired === true

  return (
    <Modal className="wx-report" label="举报" onClose={onClose}>
      {/* Telegram's title comes from the answer (`reportChatResultOptionRequired`
            carries it); the comment phase keeps the one the reasons came with. */}
      <h2 className="wx-report__title">{report?.title ?? '举报'}</h2>

      {needsComment ? (
        <div className="wx-report__step">
          <p className="wx-report__hint">
            {report?.textOptional ? '这个举报可以补充说明。' : '这个举报需要补充说明。'}
          </p>
          <textarea
            className="wx-report__comment"
            value={comment}
            autoFocus
            maxLength={4000}
            placeholder={report?.textOptional ? '补充说明（可选）' : '补充说明'}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
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
              <span className="wx-report__option-text">{option.text}</span>
              <ChevronRightIcon size={14} className="wx-report__chevron" />
            </button>
          ))}
        </div>
      ) : (
        <p className="wx-report__hint wx-report__step">正在读取举报原因…</p>
      )}

      <div className="wx-report__footer">
        {needsComment ? (
          <button
            type="button"
            className="wx-report__submit"
            disabled={
              // TDLib's `is_optional`: this step may be submitted without a comment.
              busy || (report?.textOptional !== true && comment.trim().length === 0)
            }
            onClick={() => void submit(report?.optionId ?? '', comment)}
          >
            举报
          </button>
        ) : null}
        <button type="button" className="wx-report__close" onClick={onClose}>
          关闭
        </button>
      </div>
    </Modal>
  )
}

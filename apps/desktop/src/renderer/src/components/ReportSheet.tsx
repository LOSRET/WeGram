import type { ChatReport, ReportTarget } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { errorMessage, invoke } from '@renderer/lib/ipc'
import { useEscapeKey } from '@renderer/lib/useEscapeKey'

import { ChevronRightIcon } from './Icon'

/** How long 已提交举报 stays up before the window closes itself. */
const FILED_MS = 1200

interface ReportSheetProps {
  target: ReportTarget
  onClose: () => void
}

/**
 * 举报's content: the phased sheet Telegram asks for, as the body of its own window
 * (design doc §9.4.1).
 *
 * Telegram files a report in phases, so this is a small state machine rather than
 * one dialog — the first answer names the reasons, the chosen reason may ask for a
 * comment (with a NEW id to send back), and only then is the report filed. The ids
 * are TDLib bytes values: they are handed back exactly as they arrived and never
 * interpreted here.
 *
 * The window owns its own error line: a standalone window has no shell banner to
 * write to, and a failed call must not look like a report that went through.
 */
export function ReportSheet({ target, onClose }: ReportSheetProps) {
  const [report, setReport] = useState<ChatReport | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [filed, setFiled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * The ids, not the target object: a caller builds a fresh literal every render,
   * and an object dependency would re-run the first request forever.
   */
  const userId = target.kind === 'user' ? target.userId : null
  const chatId = target.kind === 'message' ? target.chatId : null
  const messageId = target.kind === 'message' ? target.messageId : null

  /**
   * onClose is usually an inline arrow. Reading it through a ref keeps the one
   * initial request from re-running every time the parent re-renders — a
   * re-render would reset the sheet to 正在读取举报原因… mid-flow.
   */
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEscapeKey(() => closeRef.current(), { stopPropagation: true })

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
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(errorMessage(cause))
        closeRef.current()
      })
    return () => {
      cancelled = true
    }
  }, [ask])

  // 已提交举报 is the confirmation the shell used to show as a toast; the window
  // says it itself, then goes away.
  useEffect(() => {
    if (!filed) return
    const timer = window.setTimeout(() => closeRef.current(), FILED_MS)
    return () => window.clearTimeout(timer)
  }, [filed])

  const submit = async (optionId: string, text?: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const answer = await ask({
        optionId,
        ...(text === undefined || text.length === 0 ? {} : { text }),
      })
      if (answer.reported) {
        setFiled(true)
        return
      }
      if (answer.messagesRequired) {
        setError('Telegram 要求指定具体消息，请在该消息的菜单里举报')
        setBusy(false)
        return
      }
      // Either the comment step or the reason list again. The comment step carries
      // no title (reportChatResultTextRequired has none), so keep the one the
      // reasons came with.
      setReport((current) =>
        answer.title === undefined && current?.title !== undefined
          ? { ...answer, title: current.title }
          : answer,
      )
      setBusy(false)
    } catch (cause: unknown) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  const needsComment = report?.textRequired === true

  return (
    <div className="wx-report-window" role="dialog" aria-label="举报">
      <header className="wx-report-window__bar">
        {/* Telegram's title comes from the answer (reportChatResultOptionRequired
            carries it); the comment phase keeps the one the reasons came with. */}
        <h2 className="wx-report-window__title">{report?.title ?? '举报'}</h2>
        <button
          type="button"
          className="wx-report-window__close"
          title="关闭"
          aria-label="关闭"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="wx-report-window__body">
        {filed ? (
          <p className="wx-report__hint wx-report__step">已提交举报。</p>
        ) : needsComment ? (
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

        {error ? <p className="wx-report__error">{error}</p> : null}
      </div>

      <footer className="wx-report__footer">
        {needsComment && !filed ? (
          <button
            type="button"
            className="wx-report__submit"
            disabled={
              // TDLib's is_optional: this step may be submitted without a comment.
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
      </footer>
    </div>
  )
}
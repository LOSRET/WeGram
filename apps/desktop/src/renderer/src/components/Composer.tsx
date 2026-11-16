import type { Message } from '@wechatgram/protocol'
import { useEffect, useRef, useState } from 'react'

import { errorMessage, invoke } from '../lib/ipc'
import { useAppStore } from '../store/useAppStore'

export interface ComposerEditing {
  messageId: number
  text: string
}

interface ComposerProps {
  chatId: number
  replyTo: Message | null
  editing: ComposerEditing | null
  onSend: (text: string, replyTo: number | undefined) => Promise<void>
  onSaveEdit: (messageId: number, text: string) => Promise<void>
  onCancelReply: () => void
  onCancelEdit: () => void
}

export function Composer({
  chatId,
  replyTo,
  editing,
  onSend,
  onSaveEdit,
  onCancelReply,
  onCancelEdit,
}: ComposerProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const composingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const draftTimer = useRef<number | null>(null)

  // Drafts are stored by the main process (§5.1) and restored per chat.
  useEffect(() => {
    let cancelled = false
    setText('')
    void (async () => {
      try {
        const draft = await invoke('ui:getDraft', { chatId })
        if (!cancelled && draft) setText(draft.text)
      } catch {
        // A missing draft is not worth surfacing.
      }
    })()
    textareaRef.current?.focus()
    return () => {
      cancelled = true
    }
  }, [chatId])

  useEffect(() => {
    if (!editing) return
    setText(editing.text)
    const node = textareaRef.current
    if (node) {
      node.focus()
      node.setSelectionRange(node.value.length, node.value.length)
    }
  }, [editing])

  // Debounced draft persistence; skipped while editing an existing message.
  useEffect(() => {
    if (editing) return
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => {
      void invoke('ui:saveDraft', { chatId, text }).catch(() => undefined)
    }, 400)
    return () => {
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
    }
  }, [text, chatId, editing])

  const submit = async (): Promise<void> => {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      if (editing) {
        await onSaveEdit(editing.messageId, value)
        setText('')
      } else {
        await onSend(value, replyTo?.id)
        setText('')
      }
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wx-composer">
      {editing ? (
        <div className="wx-composer-bar">
          <span>正在编辑消息</span>
          <button className="wx-composer-bar__close" onClick={onCancelEdit} title="取消编辑">
            ×
          </button>
        </div>
      ) : null}

      {replyTo ? (
        <div className="wx-composer-bar">
          <span className="wx-composer-bar__quote">
            回复 {replyTo.senderName}：{replyTo.text.slice(0, 60) || `[${replyTo.kind}]`}
          </span>
          <button className="wx-composer-bar__close" onClick={onCancelReply} title="取消回复">
            ×
          </button>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        className="wx-composer__input"
        placeholder={editing ? '编辑后回车保存，Esc 取消' : '输入消息，Enter 发送，Shift+Enter 换行'}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={() => {
          composingRef.current = false
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && editing) {
            event.preventDefault()
            onCancelEdit()
            return
          }
          // Never send while an IME composition is active (design doc §8.4).
          if (event.key !== 'Enter' || event.shiftKey) return
          if (composingRef.current || event.nativeEvent.isComposing) return
          event.preventDefault()
          void submit()
        }}
      />

      <div className="wx-composer__actions">
        <span className="wx-composer__hint">
          {editing ? 'Enter 保存 · Esc 取消' : 'Enter 发送 · Shift+Enter 换行'}
        </span>
        <button
          className="wx-button"
          onClick={() => void submit()}
          disabled={busy || text.trim().length === 0}
        >
          {editing ? '保存' : '发送'}
        </button>
      </div>
    </div>
  )
}

import type { Message } from '@wechatgram/protocol'
import { useEffect, useRef, useState } from 'react'

import { errorMessage, invoke } from '../lib/ipc'
import { messagePreview } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { Popup } from './ContextMenu'
import {
  ChevronDownIcon,
  EmojiIcon,
  FolderIcon,
  MicIcon,
  MicWaveIcon,
  ScissorsIcon,
  StickerCubeIcon,
} from './Icon'
import { StickerPanel } from './StickerPanel'

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
  const [stickerOpen, setStickerOpen] = useState(false)
  const [attachAt, setAttachAt] = useState<{ x: number; y: number } | null>(null)
  const composingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const draftTimer = useRef<number | null>(null)

  // Drafts are stored by the main process (§5.1) and restored per chat.
  useEffect(() => {
    let cancelled = false
    setText('')
    setStickerOpen(false)
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

  /**
   * Picks local files and sends them straight away, like WeChat's + panel. The
   * picker lives in the main process (native dialog), so the renderer never
   * touches the filesystem.
   */
  const attach = async (kind: 'photo' | 'file'): Promise<void> => {
    setAttachAt(null)
    if (busy) return
    try {
      const picked = await invoke('media:pick', { kind })
      if (picked.paths.length === 0) return
      setBusy(true)
      setStickerOpen(false)
      const replyToId = replyTo?.id
      for (const filePath of picked.paths) {
        const result = await invoke('media:send', {
          chatId,
          filePath,
          kind,
          ...(replyToId === undefined ? {} : { replyTo: replyToId }),
        })
        useAppStore.getState().applyMessageOps(chatId, [{ op: 'new', message: result.message }])
      }
      if (replyToId !== undefined) onCancelReply()
      useAppStore.getState().setToast(kind === 'photo' ? '已发送图片' : '已发送文件')
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const stickerSent = (): void => {
    setStickerOpen(false)
    if (replyTo) onCancelReply()
  }

  const notWired = (label: string): void => {
    useAppStore.getState().setToast(`${label}还没有接入`)
  }

  const ready = !busy && text.trim().length > 0

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
            回复 {replyTo.senderName}：{messagePreview(replyTo)}
          </span>
          <button className="wx-composer-bar__close" onClick={onCancelReply} title="取消回复">
            ×
          </button>
        </div>
      ) : null}

      <div className="wx-composer__card">
        <textarea
          ref={textareaRef}
          className="wx-composer__input"
          placeholder={editing ? '编辑后回车保存，Esc 取消' : '输入消息'}
          title="Enter 发送 · Shift+Enter 换行"
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
          <div className="wx-composer__tools">
            <button
              className={`wx-tool-button${stickerOpen ? ' wx-tool-button--active' : ''}`}
              onClick={() => setStickerOpen((open) => !open)}
              disabled={busy || Boolean(editing)}
              title="表情"
              aria-label="表情与贴纸"
            >
              <EmojiIcon size={21} />
            </button>
            <button
              className={`wx-tool-button${stickerOpen ? ' wx-tool-button--active' : ''}`}
              onClick={() => setStickerOpen((open) => !open)}
              disabled={busy || Boolean(editing)}
              title="贴纸"
              aria-label="贴纸集合"
            >
              <StickerCubeIcon size={21} />
            </button>
            <button
              className="wx-tool-button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setAttachAt({ x: rect.left, y: rect.top - 92 })
              }}
              disabled={busy || Boolean(editing)}
              title="发送文件"
              aria-label="发送图片或文件"
            >
              <FolderIcon size={21} />
            </button>
            <button
              className="wx-tool-button wx-tool-button--split"
              onClick={() => notWired('截图')}
              disabled={busy || Boolean(editing)}
              title="截图"
              aria-label="截图"
            >
              <ScissorsIcon size={20} />
              <ChevronDownIcon size={9} className="wx-tool-button__chevron" />
            </button>
            <button
              className="wx-tool-button"
              onClick={() => notWired('语音消息')}
              disabled={busy || Boolean(editing)}
              title="语音消息"
              aria-label="语音消息"
            >
              <MicIcon size={20} />
            </button>
          </div>

          <button
            className="wx-tool-button"
            onClick={() => notWired('语音输入')}
            title="语音输入"
            aria-label="语音输入"
          >
            <MicWaveIcon size={21} />
          </button>

          <button
            className={`wx-send-button${ready ? ' wx-send-button--ready' : ''}`}
            onClick={() => void submit()}
            disabled={busy || text.trim().length === 0}
          >
            {editing ? '保存' : '发送'}
          </button>
        </div>
      </div>

      {attachAt ? (
        <Popup x={attachAt.x} y={attachAt.y} onClose={() => setAttachAt(null)}>
          <button className="wx-context-menu__item" onClick={() => void attach('photo')}>
            发送图片
          </button>
          <button className="wx-context-menu__item" onClick={() => void attach('file')}>
            发送文件
          </button>
        </Popup>
      ) : null}

      {stickerOpen ? (
        <StickerPanel chatId={chatId} onSent={stickerSent} onClose={() => setStickerOpen(false)} />
      ) : null}
    </div>
  )
}

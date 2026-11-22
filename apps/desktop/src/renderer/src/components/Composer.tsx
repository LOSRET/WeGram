import type { Message, Sticker } from '@wegram/protocol'
import { useEffect, useRef, useState } from 'react'

import { loadLatestWindow } from '../lib/anchoredWindow'
import { TypingPing } from '../lib/typingPing'
import { useComposerInput } from '../lib/useComposerInput'
import { errorMessage, invoke } from '../lib/ipc'
import { messagePreview } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { ComposerCard } from './composer/ComposerCard'

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
  /**
   * Channels only: hides the composer again and puts the channel bar back, the
   * way the 服务号 card swaps places with the input.
   */
  onCollapse?: () => void
}

/**
 * A chat's composer (§8.4).
 *
 * The box itself is the shared `ComposerCard` — the comment panel renders the
 * same one (§9.8) — so this file owns only what a *chat* send means: per-chat
 * drafts in `ui.db`, the reply / edit banners, the anchored-window reload every
 * send needs, and the 收起 button a channel adds.
 */
export function Composer({
  chatId,
  replyTo,
  editing,
  onSend,
  onSaveEdit,
  onCancelReply,
  onCancelEdit,
  onCollapse,
}: ComposerProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const draftTimer = useRef<number | null>(null)
  /**
   * 对方正在输入. One throttle per open chat: the cleanup cancels the indicator
   * when the reader switches conversations, and the ping itself is fire-and-forget
   * (a failed typing action must never raise the error bar).
   */
  const pingerRef = useRef<TypingPing | null>(null)

  // Drafts are stored by the main process (§5.1) and restored per chat.
  useEffect(() => {
    const pinger = new TypingPing((typing) => {
      void invoke('messages:typing', { chatId, typing }).catch(() => undefined)
    })
    pingerRef.current = pinger
    return () => {
      pingerRef.current = null
      pinger.stop()
    }
  }, [chatId])

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

  /** Every keystroke also pings (throttled); emptying the box cancels at once. */
  const changeText = (next: string): void => {
    setText(next)
    if (editing) return
    if (next.trim().length === 0) pingerRef.current?.stop()
    else pingerRef.current?.typing()
  }

  const submit = async (): Promise<void> => {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      if (editing) {
        await onSaveEdit(editing.messageId, value)
        setText('')
      } else {
        // Sending ends the peer's "typing" state immediately; waiting for the
        // throttle to expire would leave the indicator over a delivered message.
        pingerRef.current?.stop()
        await onSend(value, replyTo?.id)
        setText('')
      }
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  /** Enter sends, Shift+Enter breaks the line, IME never sends (§8.4). */
  const { inputHandlers } = useComposerInput({
    onSend: () => void submit(),
    onEscape: editing ? onCancelEdit : undefined,
  })

  /**
   * Picks local files and sends them straight away, like WeChat's + panel. The
   * picker lives in the main process (native dialog), so the renderer never
   * touches the filesystem.
   */
  const attach = async (kind: 'photo' | 'file'): Promise<void> => {
    if (busy) return
    try {
      const picked = await invoke('media:pick', { kind })
      if (picked.paths.length === 0) return
      setBusy(true)
      const wasAnchored = await loadLatestWindow(chatId)
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
      if (wasAnchored) useAppStore.getState().requestJumpToLatest(chatId)
      useAppStore.getState().setToast(kind === 'photo' ? '已发送图片' : '已发送文件')
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * A sticker posted from the 表情 panel, through the chat's own send path.
   * An anchored window cannot take the new row in place, so it returns to the
   * newest page first and the list jumps once the row is in.
   */
  const sendSticker = async (sticker: Sticker): Promise<void> => {
    try {
      const wasAnchored = await loadLatestWindow(chatId)
      const result = await invoke('messages:sendSticker', { chatId, fileId: sticker.fileId })
      useAppStore.getState().applyMessageOps(chatId, [{ op: 'new', message: result.message }])
      if (wasAnchored) useAppStore.getState().requestJumpToLatest(chatId)
      if (replyTo) onCancelReply()
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    }
  }

  const notWired = (label: string): void => {
    useAppStore.getState().setToast(`${label}还没有接入`)
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
            回复 {replyTo.senderName}：{messagePreview(replyTo)}
          </span>
          <button className="wx-composer-bar__close" onClick={onCancelReply} title="取消回复">
            ×
          </button>
        </div>
      ) : null}

      <ComposerCard
        value={text}
        onChange={changeText}
        onBlur={() => pingerRef.current?.stop()}
        textareaRef={textareaRef}
        placeholder={editing ? '编辑后回车保存，Esc 取消' : '输入消息'}
        inputHandlers={inputHandlers}
        busy={busy}
        editing={Boolean(editing)}
        sendLabel={editing ? '保存' : '发送'}
        onSend={() => void submit()}
        onSendSticker={(sticker) => void sendSticker(sticker)}
        onAttach={(kind) => void attach(kind)}
        onNotice={notWired}
        {...(onCollapse ? { onCollapse } : {})}
      />
    </div>
  )
}

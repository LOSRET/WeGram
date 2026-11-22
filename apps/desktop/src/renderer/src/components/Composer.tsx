import type { Message, Sticker } from '@wegram/protocol'
import { useEffect, useRef, useState } from 'react'

import { albumSendOf } from '../lib/albumSend'
import { loadLatestWindow } from '../lib/anchoredWindow'
import { TypingPing } from '../lib/typingPing'
import { useComposerInput } from '../lib/useComposerInput'
import type { RecordedVoice } from '../lib/voice/recorder'
import { errorMessage, invoke } from '../lib/ipc'
import { messagePreview } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { ComposerCard } from './composer/ComposerCard'

export interface ComposerEditing {
  messageId: number
  text: string
  /** A media row's 说明 (saved through `messages:editCaption`); an empty box clears it. */
  caption?: boolean
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
    // An empty caption is a real edit — it removes the 说明 — while an empty
    // message body is not a send and an empty text edit is not an edit.
    if (busy || (!value && !editing?.caption)) return
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
   *
   * Several photos become ONE Telegram album (`sendMessageAlbum`), which arrives
   * as the folded bubble the transcript already draws for a received album; the
   * rule for when that applies is `lib/albumSend.ts`. Everything else is one
   * message per file.
   */
  const attach = async (kind: 'photo' | 'file'): Promise<void> => {
    if (busy) return
    try {
      const picked = await invoke('media:pick', { kind })
      if (picked.paths.length === 0) return
      setBusy(true)
      const wasAnchored = await loadLatestWindow(chatId)
      const replyToId = replyTo?.id
      const album = albumSendOf(picked.paths, kind)
      if (album) {
        const result = await invoke('media:sendAlbum', {
          chatId,
          items: album,
          ...(replyToId === undefined ? {} : { replyTo: replyToId }),
        })
        useAppStore.getState().applyMessageOps(
          chatId,
          result.messages.map((message) => ({ op: 'new' as const, message })),
        )
      } else {
        for (const filePath of picked.paths) {
          const result = await invoke('media:send', {
            chatId,
            filePath,
            kind,
            ...(replyToId === undefined ? {} : { replyTo: replyToId }),
          })
          useAppStore.getState().applyMessageOps(chatId, [{ op: 'new', message: result.message }])
        }
      }
      if (replyToId !== undefined) onCancelReply()
      if (wasAnchored) useAppStore.getState().requestJumpToLatest(chatId)
      useAppStore
        .getState()
        .setToast(
          album ? `已发送 ${album.length} 张图片` : kind === 'photo' ? '已发送图片' : '已发送文件',
        )
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 语音消息. The clip arrives from the composer's recorder already encoded as
   * OGG/Opus; main writes it to a temporary file and TDLib uploads it. The
   * anchored-window dance is the same as any other send.
   */
  const sendVoice = async (voice: RecordedVoice): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const wasAnchored = await loadLatestWindow(chatId)
      const replyToId = replyTo?.id
      const result = await invoke('messages:sendVoice', {
        chatId,
        audio: voice.audio,
        duration: voice.duration,
        ...(replyToId === undefined ? {} : { replyTo: replyToId }),
      })
      useAppStore.getState().applyMessageOps(chatId, [{ op: 'new', message: result.message }])
      if (replyToId !== undefined) onCancelReply()
      if (wasAnchored) useAppStore.getState().requestJumpToLatest(chatId)
      useAppStore.getState().setToast('已发送语音')
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 对方正在说. The chat action is fire-and-forget like the typing ping: a failed
   * presence update must never raise the error bar over the composer, and the
   * release sends `typing: false` to end either indicator.
   */
  const recordingAction = (recording: boolean): void => {
    void invoke('messages:typing', { chatId, typing: recording, action: 'recording' }).catch(
      () => undefined,
    )
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
          <span>{editing.caption ? '正在编辑说明' : '正在编辑消息'}</span>
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
        placeholder={
          editing
            ? editing.caption
              ? '编辑说明，清空后回车可删除'
              : '编辑后回车保存，Esc 取消'
            : '输入消息'
        }
        inputHandlers={inputHandlers}
        busy={busy}
        editing={Boolean(editing)}
        sendLabel={editing ? '保存' : '发送'}
        onSend={() => void submit()}
        onSendSticker={(sticker) => void sendSticker(sticker)}
        onAttach={(kind) => void attach(kind)}
        onSendVoice={(voice) => void sendVoice(voice)}
        onRecordingChange={recordingAction}
        onNotice={notWired}
        {...(onCollapse ? { onCollapse } : {})}
      />
    </div>
  )
}

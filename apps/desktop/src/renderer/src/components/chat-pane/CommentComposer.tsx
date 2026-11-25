import type { InvokeRequest, Message, Sticker } from '@wegram/protocol'
import { useRef, useState } from 'react'

import { sendKindForPath } from '../../lib/attachKind'
import { errorMessage, invoke } from '../../lib/ipc'
import { useComposerInput } from '../../lib/useComposerInput'
import { useAppStore } from '../../store/useAppStore'
import { ComposerCard } from '../composer/ComposerCard'

type CommentContent = InvokeRequest<'messages:sendComment'>['content']

/**
 * The comment box of the discussion view (§9.8).
 *
 * This is the chat composer's card — `ComposerCard` draws the same text, tool row
 * and 发送 button for both — with the comment thread as its destination: text,
 * a sticker from the 表情 panel and a local photo/document all post through
 * `messages:sendComment`, and the adapter resolves the thread's discussion group.
 * The panel appends what comes back (`onSent`), so the new row lands without a
 * reload and the post's 评论 counter is patched by the live `interaction` op.
 */
export function CommentComposer({
  chatId,
  messageId,
  slowLeft,
  onSent,
}: {
  chatId: number
  messageId: number
  /** Seconds of the discussion group's slow mode left; the send waits it out. */
  slowLeft: number
  onSent: (message: Message) => void
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const post = async (content: CommentContent): Promise<boolean> => {
    if (sending) return false
    setSending(true)
    try {
      const answer = await invoke('messages:sendComment', { chatId, messageId, content })
      onSent(answer.message)
      return true
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
      return false
    } finally {
      setSending(false)
    }
  }

  const send = async (): Promise<void> => {
    const value = draft.trim()
    if (!value || sending || slowLeft > 0) return
    if (await post({ kind: 'text', text: value })) setDraft('')
  }

  const sendSticker = (sticker: Sticker): void => {
    void post({ kind: 'sticker', fileId: sticker.fileId })
  }

  /** Same picker + upload as the chat composer; the file lands in the thread. */
  const attach = async (kind: 'media' | 'file'): Promise<void> => {
    try {
      const picked = await invoke('media:pick', { kind })
      for (const filePath of picked.paths) {
        await post({ kind: 'media', filePath, mediaKind: sendKindForPath(filePath, kind) })
      }
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    }
  }

  const notWired = (label: string): void => {
    useAppStore.getState().setToast(`${label}还没有接入`)
  }

  /** Same Enter rule as the chat composer (§8.4). */
  const { inputHandlers } = useComposerInput({ onSend: () => void send() })

  return (
    <div className="wx-composer wx-comments-panel__composer">
      {slowLeft > 0 ? (
        <div className="wx-comments-panel__slow">慢速模式：{slowLeft} 秒后可发送</div>
      ) : null}
      <ComposerCard
        value={draft}
        onChange={setDraft}
        textareaRef={textareaRef}
        placeholder="写评论…"
        inputHandlers={inputHandlers}
        busy={sending}
        editing={false}
        sendBlocked={slowLeft > 0}
        sendLabel={sending ? '发送中' : '发送'}
        onSend={() => void send()}
        onSendSticker={sendSticker}
        onAttach={(kind) => void attach(kind)}
        onNotice={notWired}
      />
    </div>
  )
}

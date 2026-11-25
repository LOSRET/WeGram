import type {
  BotCommand,
  InlineResult,
  Message,
  ReplyKeyboard as ReplyKeyboardLayout,
  ReplyKeyboardButton,
  Sticker,
} from '@wegram/protocol'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { albumSendOf } from '../lib/albumSend'
import { loadLatestWindow } from '../lib/anchoredWindow'
import { sendKindForPath } from '../lib/attachKind'
import { commandQuery, commandText, filterCommands } from '../lib/botCommands'
import type { PendingForceReply } from '../lib/forceReply'
import { parseInlineQuery } from '../lib/inlineQuery'
import { useInlineQuery } from '../lib/useInlineQuery'
import { TypingPing } from '../lib/typingPing'
import { useBotCommands } from '../lib/useBotCommands'
import { useComposerInput } from '../lib/useComposerInput'
import type { RecordedVoice } from '../lib/voice/recorder'
import { errorMessage, invoke } from '../lib/ipc'
import { messagePreview } from '../lib/format'
import { useAppStore } from '../store/useAppStore'
import { ComposerCard } from './composer/ComposerCard'
import { InlineResults } from './InlineResults'
import { ReplyKeyboard } from './ReplyKeyboard'

export interface ComposerEditing {
  messageId: number
  text: string
  /** A media row's 说明 (saved through `messages:editCaption`); an empty box clears it. */
  caption?: boolean
}

interface ComposerProps {
  chatId: number
  /** 话题 (design doc §9.12); `null` posts into the chat itself. */
  topicId: number | null
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
  /**
   * The bot's custom reply keyboard to draw under the card (§8.3), when the chat's
   * newest message carries one. Absent for every ordinary conversation.
   */
  replyKeyboard?: ReplyKeyboardLayout
  /** A one-time keyboard was used: the pane drops it until a newer one arrives. */
  onKeyboardUsed?: () => void
  /**
   * 机器人强制回复 (§8.3): the row the bot waits for an answer to. The reply
   * banner is the ordinary one — this only names what it is for and lends the
   * box the bot's placeholder.
   */
  forceReply?: PendingForceReply
  /**
   * inline 机器人 (§8.3): sends one result of a `@bot query`. The bot builds the
   * message, so the pane only appends what the adapter answered.
   */
  onSendInline?: (queryId: string, resultId: string) => Promise<void>
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
  topicId,
  replyTo,
  editing,
  onSend,
  onSaveEdit,
  onCancelReply,
  onCancelEdit,
  onCollapse,
  replyKeyboard,
  onKeyboardUsed,
  forceReply,
  onSendInline,
}: ComposerProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  /**
   * 机器人命令: "/" at the start of the box opens the bot's command list
   * (design doc §8.3). The list is derived from the box, never stored, so it
   * closes by itself as soon as the reader types a space or deletes the slash.
   */
  const { commands: botCommands, load: loadBotCommands } = useBotCommands(chatId)
  const query = commandQuery(text)
  const matches = useMemo(
    () => (query === null ? [] : filterCommands(botCommands, query)),
    [query, botCommands],
  )
  /**
   * Esc dismisses the list for the fragment it was open on; one more character
   * reopens it. Stored as the fragment, so it cannot leak into the next "/".
   */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [commandIndex, setCommandIndex] = useState(0)
  const commandListOpen = query !== null && query !== dismissed && matches.length > 0
  /** The caret to restore once a picked command has landed in the box. */
  const pendingCaret = useRef<number | null>(null)
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
      void invoke('messages:typing', {
        chatId,
        ...(topicId === null ? {} : { topicId }),
        typing,
      }).catch(() => undefined)
    })
    pingerRef.current = pinger
    return () => {
      pingerRef.current = null
      pinger.stop()
    }
  }, [chatId, topicId])

  useEffect(() => {
    let cancelled = false
    setText('')
    void (async () => {
      try {
        const draft = await invoke('ui:getDraft', {
          chatId,
          ...(topicId === null ? {} : { topicId }),
        })
        if (!cancelled && draft) setText(draft.text)
      } catch {
        // A missing draft is not worth surfacing.
      }
    })()
    textareaRef.current?.focus()
    return () => {
      cancelled = true
    }
  }, [chatId, topicId])

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
      void invoke('ui:saveDraft', {
        chatId,
        ...(topicId === null ? {} : { topicId }),
        text,
      }).catch(() => undefined)
    }, 400)
    return () => {
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
    }
  }, [text, chatId, topicId, editing])

  /** The list starts at its first command for every fragment. */
  useEffect(() => {
    setCommandIndex(0)
  }, [query])

  /** The commands are asked for only once the reader starts a command. */
  useEffect(() => {
    if (query !== null) loadBotCommands()
  }, [query, loadBotCommands])

  /** A picked command replaces the box and leaves the caret after its space. */
  useEffect(() => {
    const caret = pendingCaret.current
    if (caret === null) return
    pendingCaret.current = null
    const node = textareaRef.current
    if (!node) return
    node.focus()
    node.setSelectionRange(caret, caret)
  }, [text, textareaRef])

  const pickCommand = (command: BotCommand): void => {
    const next = commandText(command)
    setText(next)
    pendingCaret.current = next.length
  }

  /**
   * The "/" list takes the arrows and Enter/Tab before the send rule does, so
   * picking a command never sends the half-typed one. Esc closes the list only.
   */
  const commandKeys = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!commandListOpen) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setCommandIndex((current) =>
        event.key === 'ArrowDown'
          ? (current + 1) % matches.length
          : (current - 1 + matches.length) % matches.length,
      )
      return true
    }
    if (event.key === 'Escape') {
      setDismissed(query ?? '')
      return true
    }
    // Ctrl+Enter / Cmd+Enter stay the send gesture even over the list.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) return false
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (event.nativeEvent.isComposing) return false
      const command = matches[commandIndex] ?? matches[0]
      if (!command) return false
      event.preventDefault()
      pickCommand(command)
      return true
    }
    return false
  }

  /**
   * inline 机器人 (§8.3): a message that starts with `@bot ` asks that bot for
   * results. The draft is derived from the box, never stored, so clearing the
   * text closes the panel; Esc remembers the query it was dismissed for.
   */
  const inlineDraft = editing ? null : parseInlineQuery(text)
  const { state: inlineState, loadMore: loadMoreInline } = useInlineQuery(chatId, inlineDraft)
  const [dismissedInline, setDismissedInline] = useState<string | null>(null)
  const [inlineIndex, setInlineIndex] = useState(0)
  const inlineKey = inlineDraft ? inlineDraft.username + ' ' + inlineDraft.query : null
  const inlineOpen =
    inlineDraft !== null &&
    inlineKey !== dismissedInline &&
    (inlineState.loading || inlineState.failed || inlineState.results.length > 0)
  /** The arrows stay inside the newest list; the count may shrink between pages. */
  const inlineCount = inlineState.results.length
  const inlineChoice =
    inlineCount > 0 ? inlineState.results[Math.min(inlineIndex, inlineCount - 1)] : undefined

  /** A new query starts at its first row. */
  useEffect(() => {
    setInlineIndex(0)
  }, [inlineKey])

  /**
   * Sends one inline result. The box is cleared afterwards: what the reader typed
   * was the query `@bot …`, not the message (Telegram does the same).
   */
  const pickInline = async (result: InlineResult): Promise<void> => {
    if (!onSendInline || !inlineState.queryId || busy) return
    setBusy(true)
    try {
      pingerRef.current?.stop()
      await onSendInline(inlineState.queryId, result.id)
      setText('')
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * The panel takes the arrows and Enter/Tab before the send rule does, the way
   * the "/" list does, so picking a result never sends `@bot query` as text. Esc
   * closes it for that query only.
   */
  const inlineKeys = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!inlineOpen) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (inlineCount === 0) return false
      event.preventDefault()
      setInlineIndex((current) =>
        event.key === 'ArrowDown'
          ? (current + 1) % inlineCount
          : (current - 1 + inlineCount) % inlineCount,
      )
      return true
    }
    if (event.key === 'Escape') {
      setDismissedInline(inlineKey)
      return true
    }
    // Ctrl+Enter / Cmd+Enter stay the send gesture even over the panel.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) return false
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (event.nativeEvent.isComposing) return false
      if (!inlineChoice) return false
      event.preventDefault()
      void pickInline(inlineChoice)
      return true
    }
    return false
  }
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

  /**
   * A key of the bot's custom keyboard (§8.3): a text key is an ordinary message,
   * so it takes the chat's own send path — the box keeps whatever the reader had
   * typed and the reply stays attached. A key that asks for a phone number, a
   * location or a chat is refused instead of posting its label as text.
   */
  const pressKeyboard = async (button: ReplyKeyboardButton): Promise<void> => {
    if (!button.sendsText) {
      useAppStore.getState().setToast('这类按钮暂未支持')
      return
    }
    if (busy) return
    setBusy(true)
    try {
      pingerRef.current?.stop()
      await onSend(button.text, replyTo?.id)
      onKeyboardUsed?.()
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
    // The two panels cannot be open at once (`/` vs `@`), so one chain is enough.
    onKeyDown: (event) => commandKeys(event) || inlineKeys(event),
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
  const attach = async (kind: 'media' | 'file'): Promise<void> => {
    if (busy) return
    try {
      const picked = await invoke('media:pick', { kind })
      if (picked.paths.length === 0) return
      setBusy(true)
      const wasAnchored = await loadLatestWindow(chatId, topicId)
      const replyToId = replyTo?.id
      // One send per file: a clip picked through 图片与视频 is a video message, a
      // picture a photo, and 发送文件 always a document (lib/attachKind.ts).
      const sends = picked.paths.map((filePath) => ({
        filePath,
        kind: sendKindForPath(filePath, kind),
      }))
      // An album is still photos only: its grid is the one Telegram folds, and a
      // document or a clip inside it would be a separate bubble anyway.
      const photos = sends.every((item) => item.kind === 'photo')
        ? sends.map((item) => item.filePath)
        : null
      const album = photos ? albumSendOf(photos, 'photo') : null
      if (album) {
        const result = await invoke('media:sendAlbum', {
          chatId,
          ...(topicId === null ? {} : { topicId }),
          items: album,
          ...(replyToId === undefined ? {} : { replyTo: replyToId }),
        })
        useAppStore.getState().applyMessageOps(
          chatId,
          result.messages.map((message) => ({ op: 'new' as const, message })),
        )
      } else {
        for (const item of sends) {
          const result = await invoke('media:send', {
            chatId,
            ...(topicId === null ? {} : { topicId }),
            filePath: item.filePath,
            kind: item.kind,
            ...(replyToId === undefined ? {} : { replyTo: replyToId }),
          })
          useAppStore.getState().applyMessageOps(chatId, [{ op: 'new', message: result.message }])
        }
      }
      if (replyToId !== undefined) onCancelReply()
      if (wasAnchored) useAppStore.getState().requestJumpToLatest(chatId)
      const single = sends[0]?.kind
      useAppStore
        .getState()
        .setToast(
          album
            ? `已发送 ${album.length} 张图片`
            : sends.length > 1
              ? '已发送'
              : single === 'video'
                ? '已发送视频'
                : kind === 'file'
                  ? '已发送文件'
                  : '已发送图片',
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
      const wasAnchored = await loadLatestWindow(chatId, topicId)
      const replyToId = replyTo?.id
      const result = await invoke('messages:sendVoice', {
        chatId,
        ...(topicId === null ? {} : { topicId }),
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
    void invoke('messages:typing', {
      chatId,
      ...(topicId === null ? {} : { topicId }),
      typing: recording,
      action: 'recording',
    }).catch(() => undefined)
  }

  /**
   * A sticker posted from the 表情 panel, through the chat's own send path.
   * An anchored window cannot take the new row in place, so it returns to the
   * newest page first and the list jumps once the row is in.
   */
  const sendSticker = async (sticker: Sticker): Promise<void> => {
    try {
      const wasAnchored = await loadLatestWindow(chatId, topicId)
      const result = await invoke('messages:sendSticker', {
        chatId,
        ...(topicId === null ? {} : { topicId }),
        fileId: sticker.fileId,
      })
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

  // A bot may name the box (§8.3): a keyboard's placeholder, or the one a
  // 强制回复 asks for. A promised answer outranks a keyboard hint.
  const placeholder = editing
    ? editing.caption
      ? '编辑说明，清空后回车可删除'
      : '编辑后回车保存，Esc 取消'
    : forceReply?.placeholder || replyKeyboard?.placeholder || '输入消息'

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

      {/*
        机器人命令: the bot's own list, anchored above the input the way the
        client's is. Rows are divs because the textarea keeps the keyboard: the
        arrows and Enter are handled by the box, not by a focused menu.
      */}
      {commandListOpen ? (
        <div className="wx-bot-commands" role="listbox" aria-label="机器人命令">
          {matches.map((command, index) => (
            <div
              key={command.command}
              role="option"
              aria-selected={index === commandIndex}
              className={`wx-bot-command${index === commandIndex ? ' wx-bot-command--active' : ''}`}
              onMouseEnter={() => setCommandIndex(index)}
              // mousedown, not click: the caret must stay in the box.
              onMouseDown={(event) => {
                event.preventDefault()
                pickCommand(command)
              }}
            >
              <span className="wx-bot-command__name">/{command.command}</span>
              {command.description ? (
                <span className="wx-bot-command__desc">{command.description}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/*
        inline 机器人: the bot's results above the input, drawn like the command
        list for the same reason — the textarea keeps the keyboard.
      */}
      {inlineOpen && inlineDraft ? (
        <InlineResults
          username={inlineDraft.username}
          results={inlineState.results}
          loading={inlineState.loading}
          failed={inlineState.failed}
          activeIndex={inlineIndex}
          hasMore={inlineState.nextOffset !== ''}
          onHover={setInlineIndex}
          onPick={(result) => void pickInline(result)}
          onLoadMore={loadMoreInline}
        />
      ) : null}

      <ComposerCard
        value={text}
        onChange={changeText}
        onBlur={() => pingerRef.current?.stop()}
        textareaRef={textareaRef}
        placeholder={placeholder}
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

      {/* The bot's keyboard hangs under the input, the way Telegram draws it. */}
      {replyKeyboard ? (
        <ReplyKeyboard
          keyboard={replyKeyboard}
          busy={busy}
          onPress={(button) => void pressKeyboard(button)}
        />
      ) : null}
    </div>
  )
}

import type { ChatSummary, ChatTopic, TopicIcon } from '@wegram/protocol'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { errorMessage, invoke } from '../../lib/ipc'
import { topicSwatch } from '../../lib/topics'
import { useAppStore } from '../../store/useAppStore'
import { SearchIcon } from '../Icon'
import { CustomEmoji } from '../CustomEmoji'

const TOPIC_ICON_COLORS = [0x6fb9f0, 0xffd67e, 0xcb86db, 0x8eee98, 0xff93b2, 0xfb6f5f]

interface TopicDialogProps {
  chat: ChatSummary
  mode: 'create' | 'edit'
  /** 编辑: the row being changed. */
  topic?: ChatTopic
  onClose: () => void
}

/**
 * 新建 / 编辑话题 (design doc §9.12), the sheet both topic lists open.
 *
 * TDLib's `editForumTopic` changes the name and the icon emoji but not the colour —
 * that is fixed when the topic is created, exactly like the official editor — so the
 * colour picker only appears on create.
 */
export function TopicDialog({ chat, mode, topic, onClose }: TopicDialogProps) {
  const [title, setTitle] = useState(topic?.title ?? '')
  const [color, setColor] = useState(topic?.iconColor ?? TOPIC_ICON_COLORS[0] ?? 0x6fb9f0)
  const [emojiId, setEmojiId] = useState<string | null>(topic?.iconEmojiId ?? null)
  const [icons, setIcons] = useState<TopicIcon[]>([])
  const [busy, setBusy] = useState(false)

  /** 话题图标: fetched once; a failure simply leaves the picker out. */
  useEffect(() => {
    let cancelled = false
    void invoke('chats:topicIcons')
      .then((answer) => {
        if (!cancelled) setIcons(answer.icons)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const save = async (): Promise<void> => {
    if (busy || title.trim().length === 0) return
    setBusy(true)
    try {
      if (mode === 'edit' && topic) {
        await invoke('chats:topicEdit', {
          chatId: chat.id,
          topicId: topic.id,
          title: title.trim(),
          // `'0'` removes the icon's emoji; the list refreshes on evt:topics.
          iconEmojiId: emojiId ?? '0',
        })
        useAppStore.getState().setToast('话题已更新')
      } else {
        const created = await invoke('chats:topicCreate', {
          chatId: chat.id,
          title: title.trim(),
          iconColor: color,
          ...(emojiId ? { iconEmojiId: emojiId } : {}),
        })
        useAppStore.getState().setToast('话题已创建')
        // The row is known before the list re-reads itself, and the transcript
        // should open on it rather than on the topic that was there before.
        useAppStore.getState().mergeTopics(chat.id, [created])
        useAppStore.getState().setActiveTopic(created.id)
      }
      onClose()
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="wx-topics-dialog-backdrop" onClick={onClose}>
      <div className="wx-topics-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>{mode === 'create' ? '新建话题' : '编辑话题'}</h2>
        <label className="wx-topics-dialog__field">
          <SearchIcon size={14} />
          <input
            autoFocus
            value={title}
            maxLength={128}
            placeholder="话题名称"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save()
              if (event.key === 'Escape') onClose()
            }}
          />
        </label>
        {mode === 'create' ? (
          <div className="wx-topics-swatches">
            {TOPIC_ICON_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`wx-topics-swatch${color === swatch ? ' is-active' : ''}`}
                style={{ background: topicSwatch(swatch) }}
                aria-label="图标颜色"
                onClick={() => setColor(swatch)}
              />
            ))}
          </div>
        ) : null}
        {icons.length > 0 ? (
          <div className="wx-topics-emoji-row">
            <span className="wx-topics-emoji-label">图标</span>
            <button
              type="button"
              className={`wx-topics-emoji${emojiId === null ? ' is-active' : ''}`}
              title="无图标"
              onClick={() => setEmojiId(null)}
            >
              #
            </button>
            {icons.map((icon) => (
              <button
                key={icon.id}
                type="button"
                className={`wx-topics-emoji${emojiId === icon.id ? ' is-active' : ''}`}
                title={icon.emoji}
                onClick={() => setEmojiId(icon.id)}
              >
                <CustomEmoji id={icon.id} glyph={icon.emoji} />
              </button>
            ))}
          </div>
        ) : null}
        <div className="wx-topics-dialog__actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" disabled={busy || title.trim().length === 0} onClick={() => void save()}>
            {mode === 'create' ? '创建' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
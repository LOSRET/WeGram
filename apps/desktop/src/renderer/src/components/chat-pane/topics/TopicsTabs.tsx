import type { ChatSummary } from '@wegram/protocol'
import { useState } from 'react'

import { errorMessage, invoke } from '../../../lib/ipc'
import { topicSwatch } from '../../../lib/topics'
import { useAppStore } from '../../../store/useAppStore'
import { MoreIcon, PlusIcon } from '../../Icon'
import { Popup } from '../../ContextMenu'
import { TopicDialog } from '../../chat-list/TopicDialog'
import { useChatTopics } from './useChatTopics'

/**
 * 话题 tabs (design doc §9.12): the layout an administrator can choose instead of
 * the sidebar (`supergroupFullInfo.has_forum_tabs`). The chips live above the
 * transcript; picking one swaps the transcript in place, exactly like the sidebar's
 * rows do — same store, same topic page, only the shape differs.
 */
export function TopicsTabs({ chat }: { chat: ChatSummary }) {
  const activeTopicId = useAppStore((state) => state.activeTopicId)
  const { topics } = useChatTopics(chat.id, '')
  const [creating, setCreating] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  return (
    <div className="wx-topic-tabs">
      <div className="wx-topic-tabs__scroll">
        {topics.map((topic) => {
          const active = topic.id === activeTopicId
          return (
            <button
              key={topic.id}
              type="button"
              className={`wx-topic-tab${active ? ' is-active' : ''}`}
              title={topic.title}
              onClick={() => useAppStore.getState().setActiveTopic(topic.id)}
            >
              <span
                className="wx-topic-tab__dot"
                style={{ background: topicSwatch(topic.iconColor) }}
              />
              <span className="wx-topic-tab__name">{topic.title}</span>
              {topic.unread > 0 ? (
                <span className="wx-topic-tab__badge">
                  {topic.unread > 99 ? '99+' : topic.unread}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {chat.canCreateTopic === true ? (
        <button
          type="button"
          className="wx-ghost-btn"
          title="新建话题"
          aria-label="新建话题"
          onClick={() => setCreating(true)}
        >
          <PlusIcon size={16} />
        </button>
      ) : null}
      <button
        type="button"
        className="wx-ghost-btn"
        title="更多"
        aria-label="更多"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setMenu({ x: rect.right - 8, y: rect.bottom + 6 })
        }}
      >
        <MoreIcon size={16} />
      </button>

      {menu ? (
        <Popup x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            type="button"
            className="wx-context-menu__item"
            role="menuitem"
            onClick={() => {
              setMenu(null)
              // 以聊天方式查看, the same menu item the sidebar offers.
              void (async () => {
                try {
                  const updated = await invoke('chats:setViewAsTopics', {
                    chatId: chat.id,
                    viewAsTopics: false,
                  })
                  useAppStore.getState().applyChatOps([{ op: 'upsert', chat: updated }])
                  useAppStore.getState().setToast('以聊天方式查看')
                } catch (error) {
                  useAppStore.getState().setError(errorMessage(error))
                }
              })()
            }}
          >
            以聊天方式查看
          </button>
        </Popup>
      ) : null}

      {creating ? (
        <TopicDialog chat={chat} mode="create" onClose={() => setCreating(false)} />
      ) : null}
    </div>
  )
}
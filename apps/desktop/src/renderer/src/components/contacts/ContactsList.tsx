import type { ChatSummary } from '@wegram/protocol'
import { useRef, useState } from 'react'

import { contactChats, groupContacts } from '../../lib/contacts'
import { avatarColor, initials } from '../../lib/format'
import { useAppStore } from '../../store/useAppStore'
import { ChevronDownIcon, ContactsManageIcon, SearchIcon } from '../Icon'
import { OverlayScrollbar } from '../OverlayScrollbar'

interface ContactsListProps {
  chats: ChatSummary[]
  activeChatId: number | null
  query: string
  onQueryChange: (value: string) => void
  onSelect: (chat: ChatSummary) => void
  /** Service rows Telegram has no data for (新的朋友 / 企业微信 / 管理). */
  onUnavailable: (label: string) => void
}

/**
 * The 通讯录 column: search field, the 通讯录管理 card, WeChat's service rows and
 * the address book built from private chats.
 *
 * Row heights follow the client's contacts column (85 px header stack, 36 px
 * service rows, 54 px contact rows), not the 65 px conversation rows: the two
 * columns are different lists in WeChat too.
 */
export function ContactsList({
  chats,
  activeChatId,
  query,
  onQueryChange,
  onSelect,
  onUnavailable,
}: ContactsListProps) {
  const selfUserId = useAppStore((state) => (state.auth.kind === 'ready' ? state.auth.me.id : null))
  const [contactsOpen, setContactsOpen] = useState(true)

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const contacts = contactChats(chats, selfUserId)
  const channels = chats.filter((chat) => chat.kind === 'channel')
  const needle = query.trim().toLowerCase()
  const searching = needle.length > 0
  const filtered = searching
    ? contacts.filter((chat) => chat.title.toLowerCase().includes(needle))
    : contacts
  const groups = groupContacts(filtered)

  return (
    <section className="wx-list wx-contacts" aria-label="通讯录">
      <div className="wx-contacts__head">
        <label className="wx-search wx-contacts__search">
          <SearchIcon size={15} />
          <input
            value={query}
            placeholder="搜索"
            spellCheck={false}
            onChange={(event) => onQueryChange(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </label>
        <button
          type="button"
          className="wx-contacts__manage"
          onClick={() => onUnavailable('通讯录管理')}
        >
          <ContactsManageIcon size={21} />
          <span>通讯录管理</span>
        </button>
      </div>

      <div className="wx-list__body" ref={bodyRef}>
        <div className="wx-list__view" ref={scrollRef} data-testid="contacts-scroller">
          {searching ? (
            <div className="wx-contacts__groups">
              {filtered.length === 0 ? (
                <div className="wx-contacts__empty">没有找到相关联系人</div>
              ) : (
                filtered.map((chat) => (
                  <ContactRow
                    key={chat.id}
                    chat={chat}
                    active={chat.id === activeChatId}
                    onSelect={onSelect}
                  />
                ))
              )}
            </div>
          ) : (
            <>
              <div className="wx-contacts__menu">
                <Entry label="新的朋友" onClick={() => onUnavailable('新的朋友')} />
                <Entry
                  label="公众号、服务号"
                  count={channels.length}
                  onClick={() => onUnavailable('公众号、服务号')}
                />
                <Entry label="企业微信联系人" onClick={() => onUnavailable('企业微信联系人')} />
                <Entry label="我的企业" onClick={() => onUnavailable('我的企业')} />
                <Entry
                  label="联系人"
                  count={contacts.length}
                  expanded={contactsOpen}
                  onClick={() => setContactsOpen((open) => !open)}
                />
              </div>

              {contactsOpen ? (
                contacts.length === 0 ? (
                  <div className="wx-contacts__empty">还没有联系人</div>
                ) : (
                  <div className="wx-contacts__groups">
                    {groups.map((group) => (
                      <div key={group.initial}>
                        <div className="wx-contacts__group-head">{group.initial}</div>
                        {group.contacts.map((chat) => (
                          <ContactRow
                            key={chat.id}
                            chat={chat}
                            active={chat.id === activeChatId}
                            onSelect={onSelect}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )
              ) : null}
            </>
          )}
        </div>
        <OverlayScrollbar scrollerRef={scrollRef} hostRef={bodyRef} />
      </div>
    </section>
  )
}

function Entry({
  label,
  count,
  expanded,
  onClick,
}: {
  label: string
  count?: number
  /** Only the 联系人 row expands; the other rows lead somewhere else. */
  expanded?: boolean
  onClick: () => void
}) {
  const expandable = expanded !== undefined
  return (
    <button
      type="button"
      className="wx-contacts__entry"
      onClick={onClick}
      aria-expanded={expandable ? expanded : undefined}
    >
      <span
        className={`wx-contacts__chevron${!expandable || !expanded ? ' wx-contacts__chevron--right' : ''}`}
        aria-hidden="true"
      >
        <ChevronDownIcon size={12} />
      </span>
      <span className="wx-contacts__entry-label">{label}</span>
      {count !== undefined ? <span className="wx-contacts__count">{count}</span> : null}
    </button>
  )
}

function ContactRow({
  chat,
  active,
  onSelect,
}: {
  chat: ChatSummary
  active: boolean
  onSelect: (chat: ChatSummary) => void
}) {
  return (
    <button
      type="button"
      className={`wx-contacts__row${active ? ' wx-contacts__row--active' : ''}`}
      onClick={() => onSelect(chat)}
      aria-pressed={active}
    >
      <span
        className="wx-avatar wx-contacts__avatar"
        style={chat.avatarUrl ? undefined : { background: avatarColor(chat.id) }}
      >
        {chat.avatarUrl ? (
          <img className="wx-avatar__img" src={chat.avatarUrl} alt="" draggable={false} />
        ) : (
          initials(chat.title)
        )}
      </span>
      <span className="wx-contacts__name">{chat.title}</span>
    </button>
  )
}

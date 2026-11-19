import type { Contact } from '@wegram/protocol'
import { useRef, useState } from 'react'

import { groupContacts } from '../../lib/contacts'
import { avatarColor, initials } from '../../lib/format'
import { useAppStore } from '../../store/useAppStore'
import { ChevronDownIcon, ContactsManageIcon, SearchIcon } from '../Icon'
import { OverlayScrollbar } from '../OverlayScrollbar'

interface ContactsListProps {
  /** The account's Telegram address book, as `contacts:list` answered it. */
  contacts: Contact[]
  activeUserId: number | null
  query: string
  onQueryChange: (value: string) => void
  onSelect: (contact: Contact) => void
  /** Service rows Telegram has no data for (新的朋友 / 企业微信 / 管理). */
  onUnavailable: (label: string) => void
  /** Channels this account can see; the 公众号、服务号 row only counts them. */
  channelCount: number
  /** The first `contacts:list` answer is still on its way. */
  loading: boolean
}

/**
 * The 通讯录 column: search field, the 通讯录管理 card, WeChat's service rows and
 * the address book from `contacts:list`.
 *
 * Row heights follow the client's contacts column (85 px header stack, 36 px
 * service rows, 54 px contact rows), not the 65 px conversation rows: the two
 * columns are different lists in WeChat too.
 */
export function ContactsList({
  contacts,
  activeUserId,
  query,
  onQueryChange,
  onSelect,
  onUnavailable,
  channelCount,
  loading,
}: ContactsListProps) {
  const userAvatars = useAppStore((state) => state.userAvatars)
  const [contactsOpen, setContactsOpen] = useState(true)

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const needle = query.trim().toLowerCase()
  const searching = needle.length > 0
  const filtered = searching
    ? contacts.filter((contact) => contact.title.toLowerCase().includes(needle))
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
                filtered.map((contact) => (
                  <ContactRow
                    key={contact.userId}
                    contact={contact}
                    avatarUrl={contact.avatarUrl ?? userAvatars[contact.userId]}
                    active={contact.userId === activeUserId}
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
                  count={channelCount}
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
                  <div className="wx-contacts__empty">{loading ? '正在加载…' : '还没有联系人'}</div>
                ) : (
                  <div className="wx-contacts__groups">
                    {groups.map((group) => (
                      <div key={group.initial}>
                        <div className="wx-contacts__group-head">{group.initial}</div>
                        {group.contacts.map((contact) => (
                          <ContactRow
                            key={contact.userId}
                            contact={contact}
                            avatarUrl={contact.avatarUrl ?? userAvatars[contact.userId]}
                            active={contact.userId === activeUserId}
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
  contact,
  avatarUrl,
  active,
  onSelect,
}: {
  contact: Contact
  avatarUrl: string | undefined
  active: boolean
  onSelect: (contact: Contact) => void
}) {
  return (
    <button
      type="button"
      className={`wx-contacts__row${active ? ' wx-contacts__row--active' : ''}`}
      onClick={() => onSelect(contact)}
      aria-pressed={active}
    >
      <span
        className="wx-avatar wx-contacts__avatar"
        style={avatarUrl ? undefined : { background: avatarColor(contact.userId) }}
      >
        {avatarUrl ? (
          <img className="wx-avatar__img" src={avatarUrl} alt="" draggable={false} />
        ) : (
          initials(contact.title)
        )}
      </span>
      <span className="wx-contacts__name">{contact.title}</span>
    </button>
  )
}

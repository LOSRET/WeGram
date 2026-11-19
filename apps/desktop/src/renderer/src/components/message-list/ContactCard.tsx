import type { ContactCard as ContactCardData } from '@wegram/protocol'
import { useState } from 'react'

import { copyText } from '../../lib/clipboard'
import { errorMessage, invoke } from '../../lib/ipc'
import { activateChat } from '../../lib/openChat'
import { useAppStore } from '../../store/useAppStore'
import { Avatar } from '../Avatar'

/**
 * A `messageContact` bubble: the card Telegram sends for a shared vCard.
 *
 * 发消息 opens (creating) the private chat when TDLib knows the user; 复制号码
 * covers the rest, because the phone number is the point of these cards.
 */
export function ContactCard({ contact }: { contact: ContactCardData }) {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ')
  const [busy, setBusy] = useState(false)

  const openChat = (): void => {
    if (!contact.userId || busy) return
    setBusy(true)
    void invoke('chats:openPrivate', { userId: contact.userId })
      .then((chat) => activateChat(chat))
      .catch((cause) => useAppStore.getState().setError(errorMessage(cause)))
      .finally(() => setBusy(false))
  }

  const copy = (): void => {
    if (!contact.phone) return
    void copyText(contact.phone).then(
      () => useAppStore.getState().setToast('号码已复制'),
      () => useAppStore.getState().setError('复制失败'),
    )
  }

  return (
    <div className="wx-contact">
      <div className="wx-contact__head">
        <Avatar
          className="wx-avatar wx-avatar--small"
          name={name}
          colorId={contact.userId || 1}
        />
        <div className="wx-contact__meta">
          <span className="wx-contact__name">{name}</span>
          <span className="wx-contact__phone">{contact.phone || '无号码'}</span>
        </div>
      </div>
      <div className="wx-contact__actions">
        {contact.userId ? (
          <button type="button" className="wx-contact__button" onClick={openChat} disabled={busy}>
            发消息
          </button>
        ) : null}
        <button
          type="button"
          className="wx-contact__button"
          onClick={copy}
          disabled={!contact.phone}
        >
          复制号码
        </button>
      </div>
    </div>
  )
}

import type { Contact } from '@wegram/protocol'

import { avatarColor, formatPhone, initials } from '../../lib/format'
import { useAppStore } from '../../store/useAppStore'
import { CallOutlineIcon, MessageOutlineIcon, MoreIcon, VideoCallOutlineIcon } from '../Icon'

interface ContactDetailProps {
  contact: Contact
  /** 发消息: open (creating if needed) the private chat and switch to 聊天. */
  onOpenChat: (contact: Contact) => void
  /** 备注 / 语音聊天 / 视频聊天 / 更多资料 — no protocol behind them yet. */
  onUnavailable: (label: string) => void
}

/**
 * WeChat's contact card: the person's photo, name and Telegram号, then 朋友资料,
 * 更多信息 (手机号 / 数据中心) and the three blue actions.
 *
 * The identity (username / phone / user id) arrives with the contact itself:
 * `contacts:list` is TDLib's address book, so the card has everything without a
 * second round trip. A photo that finishes downloading later comes from
 * `userAvatars` (`evt:avatars`).
 */
export function ContactDetail({ contact, onOpenChat, onUnavailable }: ContactDetailProps) {
  const userAvatars = useAppStore((state) => state.userAvatars)
  const avatarUrl = contact.avatarUrl ?? userAvatars[contact.userId]
  const handle = contact.username ? contact.username : '未设置'
  /** The photo's DC is the only DC signal a client gets; without it, say so. */
  const dc = contact.dcId ? `DC ${contact.dcId}` : '未知'

  return (
    <main className="wx-contact-pane" aria-label="联系人资料">
      <div className="wx-contact-detail">
        <header className="wx-contact-detail__head">
          <div
            className="wx-avatar wx-contact-detail__avatar"
            style={avatarUrl ? undefined : { background: avatarColor(contact.userId) }}
          >
            {avatarUrl ? (
              <img className="wx-avatar__img" src={avatarUrl} alt="" draggable={false} />
            ) : (
              initials(contact.title)
            )}
          </div>
          <div className="wx-contact-detail__meta">
            <h1 className="wx-contact-detail__name">{contact.title}</h1>
            <p className="wx-contact-detail__id">Telegram号： {handle}</p>
          </div>
          <button
            type="button"
            className="wx-contact-detail__more"
            title="更多资料"
            onClick={() => onUnavailable('更多资料')}
          >
            <MoreIcon size={20} />
          </button>
        </header>

        <div className="wx-contact-detail__rule wx-contact-detail__rule--head" />

        <section className="wx-contact-detail__section">
          <h2 className="wx-contact-detail__label">朋友资料</h2>
          <div className="wx-contact-detail__row">
            <span className="wx-contact-detail__row-label">备注</span>
            <button
              type="button"
              className="wx-contact-detail__remark"
              onClick={() => onUnavailable('备注')}
            >
              添加备注名
            </button>
          </div>
        </section>

        <div className="wx-contact-detail__rule" />

        <section className="wx-contact-detail__section wx-contact-detail__section--more">
          <h2 className="wx-contact-detail__label">更多信息</h2>
          {contact.phone ? (
            <div className="wx-contact-detail__row">
              <span className="wx-contact-detail__row-label">手机号</span>
              <span className="wx-contact-detail__row-value">{formatPhone(contact.phone)}</span>
            </div>
          ) : null}
          <div className="wx-contact-detail__row">
            <span className="wx-contact-detail__row-label">数据中心</span>
            <span className="wx-contact-detail__row-value">{dc}</span>
          </div>
        </section>

        <div className="wx-contact-detail__rule" />

        <div className="wx-contact-detail__actions">
          <button
            type="button"
            className="wx-contact-detail__action"
            onClick={() => onOpenChat(contact)}
          >
            <MessageOutlineIcon size={24} />
            <span>发消息</span>
          </button>
          <button
            type="button"
            className="wx-contact-detail__action"
            onClick={() => onUnavailable('语音聊天')}
          >
            <CallOutlineIcon size={24} />
            <span>语音聊天</span>
          </button>
          <button
            type="button"
            className="wx-contact-detail__action"
            onClick={() => onUnavailable('视频聊天')}
          >
            <VideoCallOutlineIcon size={24} />
            <span>视频聊天</span>
          </button>
        </div>
      </div>
    </main>
  )
}

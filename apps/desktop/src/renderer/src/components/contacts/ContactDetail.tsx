import type { ChatSummary, ContactProfile } from '@wegram/protocol'
import { useEffect, useState } from 'react'

import { avatarColor, initials } from '../../lib/format'
import { invoke } from '../../lib/ipc'
import { CallOutlineIcon, MessageOutlineIcon, MoreIcon, VideoCallOutlineIcon } from '../Icon'

interface ContactDetailProps {
  chat: ChatSummary
  /** 发消息: open the conversation (the shell switches back to 聊天). */
  onOpenChat: (chat: ChatSummary) => void
  /** 备注 / 语音聊天 / 视频聊天 / 更多资料 — no protocol behind them yet. */
  onUnavailable: (label: string) => void
}

/**
 * WeChat's contact card: the peer's photo, name and 微信号, then 朋友资料, 更多信息
 * and the three blue actions.
 *
 * The identity (username / phone) is asked from the adapter once per selected
 * chat; the card renders immediately with the summary and fills the 微信号 line
 * when `contacts:profile` answers.
 */
export function ContactDetail({ chat, onOpenChat, onUnavailable }: ContactDetailProps) {
  /**
   * The answer is kept with the chat it belongs to: a slow profile for the
   * previous card must not paint its 微信号 over the next one for a frame.
   */
  const [loaded, setLoaded] = useState<{ chatId: number; profile: ContactProfile } | null>(null)

  useEffect(() => {
    let live = true
    void invoke('contacts:profile', { chatId: chat.id })
      .then((result) => {
        if (live) setLoaded({ chatId: chat.id, profile: result })
      })
      .catch(() => {
        // A peer whose identity cannot be read is still a contact: keep the card
        // with the fields the summary has instead of blanking the pane.
        if (live) setLoaded({ chatId: chat.id, profile: { chatId: chat.id } })
      })
    return () => {
      live = false
    }
  }, [chat.id])

  const profile = loaded?.chatId === chat.id ? loaded.profile : null
  const wxid = profile === null ? '…' : profile.username ? profile.username : '未设置'
  const userId = profile?.userId ?? chat.userId

  return (
    <main className="wx-contact-pane" aria-label="联系人资料">
      <div className="wx-contact-detail">
        <header className="wx-contact-detail__head">
          <div
            className="wx-avatar wx-contact-detail__avatar"
            style={chat.avatarUrl ? undefined : { background: avatarColor(chat.id) }}
          >
            {chat.avatarUrl ? (
              <img className="wx-avatar__img" src={chat.avatarUrl} alt="" draggable={false} />
            ) : (
              initials(chat.title)
            )}
          </div>
          <div className="wx-contact-detail__meta">
            <h1 className="wx-contact-detail__name">{chat.title}</h1>
            <p className="wx-contact-detail__id">微信号： {wxid}</p>
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
          <div className="wx-contact-detail__row">
            <span className="wx-contact-detail__row-label">来源</span>
            <span className="wx-contact-detail__row-value">Telegram</span>
          </div>
          {profile?.phone ? (
            <div className="wx-contact-detail__row">
              <span className="wx-contact-detail__row-label">手机号</span>
              <span className="wx-contact-detail__row-value">{profile.phone}</span>
            </div>
          ) : null}
          {userId ? (
            <div className="wx-contact-detail__row">
              <span className="wx-contact-detail__row-label">用户 ID</span>
              <span className="wx-contact-detail__row-value">{userId}</span>
            </div>
          ) : null}
        </section>

        <div className="wx-contact-detail__rule" />

        <div className="wx-contact-detail__actions">
          <button
            type="button"
            className="wx-contact-detail__action"
            onClick={() => onOpenChat(chat)}
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

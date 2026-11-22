import type { ChatSummary, UserProfile } from '@wegram/protocol'
import { useCallback, useEffect, useState } from 'react'

import { formatPhone } from '../lib/format'
import { errorMessage, invoke } from '../lib/ipc'
import { activateChat } from '../lib/openChat'
import { useAppStore } from '../store/useAppStore'
import { Avatar } from './Avatar'
import { ReportDialog } from './ReportDialog'

interface ProfileCardProps {
  userId: number
  /**
   * 发消息: offered only when the card was opened outside a chat (通讯录), because
   * inside one the reader is already talking to this person.
   */
  onOpenChat?: (userId: number) => void
  onClose: () => void
}

/**
 * 资料卡: the person card behind a private chat's title and the 通讯录 card's
 * 更多资料 (design doc §9.9, P1 batch).
 *
 * One `users:profile` call carries everything — identity, 简介, 备注, 共同群聊 and
 * the 联系人 flag — because the adapter maps TDLib's `user` + `userFullInfo`
 * together. 备注 is Telegram's cloud-synced note (not a local remark), and every
 * write answers the refreshed card, so the sheet never guesses.
 *
 * 共同群聊 is fetched separately, when the reader opens the row: TDLib answers a
 * page of chat summaries per call, and a card that is merely glanced at should
 * not pay for a list nobody asked to see.
 */
export function ProfileCard({ userId, onOpenChat, onClose }: ProfileCardProps) {
  const userAvatars = useAppStore((state) => state.userAvatars)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  /** 举报 is its own phased sheet (see ReportDialog). */
  const [reportOpen, setReportOpen] = useState(false)
  /** 共同群聊: opened rows are fetched once and kept for this card's lifetime. */
  const [commonOpen, setCommonOpen] = useState(false)
  const [commonChats, setCommonChats] = useState<ChatSummary[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('users:profile', { userId })
      .then((next) => {
        if (!cancelled) setProfile(next)
      })
      .catch((error) => {
        if (cancelled) return
        useAppStore.getState().setError(errorMessage(error))
        onClose()
      })
    return () => {
      cancelled = true
    }
  }, [userId, onClose])

  /** Every write answers the refreshed card: no field is patched locally. */
  const apply = useCallback((next: UserProfile) => {
    setProfile(next)
    setBusy(false)
  }, [])

  const fail = useCallback((error: unknown) => {
    useAppStore.getState().setError(errorMessage(error))
    setBusy(false)
  }, [])

  const saveNote = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      apply(await invoke('users:setNote', { userId, note: noteDraft }))
      setEditingNote(false)
    } catch (error) {
      fail(error)
    }
  }

  const toggleContact = async (): Promise<void> => {
    if (!profile || busy) return
    setBusy(true)
    try {
      apply(await invoke('users:setContact', { userId, contact: !profile.isContact }))
      useAppStore.getState().setToast(profile.isContact ? '已删除联系人' : '已添加为联系人')
    } catch (error) {
      fail(error)
    }
  }

  const toggleBlocked = async (): Promise<void> => {
    if (!profile || busy) return
    setBusy(true)
    try {
      apply(await invoke('users:setBlocked', { userId, blocked: !profile.blocked }))
      useAppStore.getState().setToast(profile.blocked ? '已取消拉黑' : '已拉黑')
    } catch (error) {
      fail(error)
    }
  }

  const startNoteEdit = (): void => {
    setNoteDraft(profile?.note ?? '')
    setEditingNote(true)
  }

  /** 共同群聊: one page (the card shows the count it already has as the header). */
  const toggleCommonChats = async (): Promise<void> => {
    if (commonChats !== null) {
      setCommonOpen((open) => !open)
      return
    }
    setCommonOpen(true)
    try {
      setCommonChats(await invoke('users:commonChats', { userId, limit: 50 }))
    } catch (error) {
      // Collapse rather than leave the row spinning: the next tap retries.
      setCommonOpen(false)
      fail(error)
    }
  }

  const avatarUrl = profile?.avatarUrl ?? userAvatars[userId]

  return (
    <div className="wx-modal-backdrop" onClick={onClose}>
      <div
        className="wx-modal wx-profile"
        role="dialog"
        aria-label="详细资料"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="wx-profile__head">
          <h2 className="wx-profile__heading">详细资料</h2>
          <button type="button" className="wx-profile__close" title="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        {profile ? (
          <>
            <div className="wx-profile__identity">
              <Avatar
                className="wx-avatar wx-profile__avatar"
                url={avatarUrl}
                name={profile.title}
                colorId={profile.userId}
              />
              <div className="wx-profile__names">
                <h3 className="wx-profile__name">{profile.title}</h3>
                <p className="wx-profile__handle">
                  {profile.username ? `Telegram号： ${profile.username}` : '未设置 Telegram号'}
                </p>
              </div>
            </div>

            <div className="wx-profile__rule" />

            <section className="wx-profile__section">
              <div className="wx-profile__row">
                <span className="wx-profile__label">备注</span>
                {editingNote ? (
                  <div className="wx-profile__note-editor">
                    <input
                      className="wx-profile__note-input"
                      value={noteDraft}
                      autoFocus
                      maxLength={1000}
                      placeholder="添加备注名"
                      onChange={(event) => setNoteDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void saveNote()
                        }
                        if (event.key === 'Escape') setEditingNote(false)
                      }}
                    />
                    <button
                      type="button"
                      className="wx-profile__link"
                      disabled={busy}
                      onClick={() => void saveNote()}
                    >
                      保存
                    </button>
                  </div>
                ) : (
                  <button type="button" className="wx-profile__link" onClick={startNoteEdit}>
                    {profile.note ?? '添加备注'}
                  </button>
                )}
              </div>

              {profile.bio ? (
                <div className="wx-profile__row">
                  <span className="wx-profile__label">简介</span>
                  <span className="wx-profile__value">{profile.bio}</span>
                </div>
              ) : null}

              {profile.commonChats > 0 ? (
                <div className="wx-profile__row">
                  <span className="wx-profile__label">共同群聊</span>
                  <button
                    type="button"
                    className="wx-profile__link"
                    onClick={() => void toggleCommonChats()}
                  >
                    {profile.commonChats} 个
                  </button>
                </div>
              ) : null}

              {profile.phone ? (
                <div className="wx-profile__row">
                  <span className="wx-profile__label">手机号</span>
                  <span className="wx-profile__value">{formatPhone(profile.phone)}</span>
                </div>
              ) : null}
            </section>

            {commonOpen ? (
              <section className="wx-profile__common" aria-label="共同群聊">
                {commonChats === null ? (
                  <p className="wx-profile__loading">正在读取共同群聊…</p>
                ) : commonChats.length === 0 ? (
                  <p className="wx-profile__loading">没有共同群聊</p>
                ) : (
                  commonChats.map((chat) => (
                    <button
                      key={chat.id}
                      type="button"
                      className="wx-profile__chat"
                      onClick={() => {
                        activateChat(chat)
                        onClose()
                      }}
                    >
                      <Avatar
                        className="wx-avatar wx-profile__chat-avatar"
                        url={chat.avatarUrl}
                        name={chat.title}
                        colorId={chat.id}
                      />
                      <span className="wx-profile__chat-title">{chat.title}</span>
                    </button>
                  ))
                )}
              </section>
            ) : null}

            <div className="wx-profile__rule" />

            <div className="wx-profile__actions">
              {onOpenChat ? (
                <button
                  type="button"
                  className="wx-profile__primary"
                  onClick={() => {
                    onOpenChat(profile.userId)
                    onClose()
                  }}
                >
                  发消息
                </button>
              ) : null}
              <button
                type="button"
                className={`wx-profile__action${profile.isContact ? ' wx-profile__action--danger' : ''}`}
                disabled={busy}
                onClick={() => void toggleContact()}
              >
                {profile.isContact ? '删除联系人' : '添加为联系人'}
              </button>
              <button
                type="button"
                className={`wx-profile__action${profile.blocked ? '' : ' wx-profile__action--danger'}`}
                disabled={busy}
                onClick={() => void toggleBlocked()}
              >
                {profile.blocked ? '取消拉黑' : '加入黑名单'}
              </button>
              <button
                type="button"
                className="wx-profile__action wx-profile__action--danger"
                onClick={() => setReportOpen(true)}
              >
                举报
              </button>
            </div>
          </>
        ) : (
          <div className="wx-profile__loading">正在读取资料…</div>
        )}
      </div>

      {reportOpen ? (
        <ReportDialog target={{ kind: 'user', userId }} onClose={() => setReportOpen(false)} />
      ) : null}
    </div>
  )
}

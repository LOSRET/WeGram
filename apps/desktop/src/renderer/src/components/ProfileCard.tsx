import type { ChatSummary, UserProfile } from '@wegram/protocol'
import { useCallback, useEffect, useState } from 'react'

import { formatPhone } from '../lib/format'
import { errorMessage, invoke } from '../lib/ipc'
import { activateChat } from '../lib/openChat'
import { openMention } from '../lib/openMention'
import { useAppStore } from '../store/useAppStore'
import { Avatar } from './Avatar'
import { Modal } from './Modal'
import { RichText } from './RichText'

interface ProfileCardProps {
  userId: number
  /**
   * The conversation the card was opened from, when there was one. A bot's
   * Web App menu uses it as `openWebApp.chat_id`, so the page's init data names
   * the chat the reader was in (design doc §9.4.1).
   */
  chatId?: number
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
export function ProfileCard({ userId, chatId, onOpenChat, onClose }: ProfileCardProps) {
  const userAvatars = useAppStore((state) => state.userAvatars)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
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
  /**
   * A bot's 简介 is plain text (`botInfo.short_description`), falling back to
   * the welcome text an empty chat would show; TDLib sends no entities with it.
   */
  const botAbout = profile?.bot
    ? (profile.bot.shortDescription ?? profile.bot.description ?? '')
    : ''

  /**
   * 菜单: a bot's `botMenuButton` is a Mini App, not a browser link (design doc
   * §9.4). `miniapp:open` resolves the signed URL in main; the sheet closes so
   * the Mini App window is not opened behind it.
   */
  const openBotMenu = async (): Promise<void> => {
    const menu = profile?.bot?.menu
    if (!menu || busy) return
    setBusy(true)
    try {
      await invoke('miniapp:open', {
        source: 'menu',
        botUserId: userId,
        url: menu.url,
        buttonText: menu.text,
        ...(chatId === undefined ? {} : { chatId }),
      })
      onClose()
    } catch (error) {
      fail(error)
    }
  }

  return (
    <>
      <Modal
        className="wx-profile"
        label="详细资料"
        onClose={onClose}
        /* Esc cancels the 备注 editor first; with no editor it closes the card. */
        onEscape={editingNote ? () => setEditingNote(false) : undefined}
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
              {/*
                A bot has no 备注: the note belongs to the address book, and
                `setUserNote` refuses a non-contact. 添加为联系人 is hidden below
                for the same reason, so the row would only explain a dead end.
              */}
              {!profile.bot ? (
                <div className="wx-profile__row">
                  <span className="wx-profile__label">备注</span>
                  {/*
                  Telegram refuses `setUserNote` for somebody who is not in the
                  address book ("User isn't a contact", measured on the test DC),
                  so the row explains the order instead of offering a write that
                  can only error. 添加为联系人 sits right below it.
                */}
                  {!profile.isContact && !profile.note ? (
                    <span className="wx-profile__value">添加为联系人后可写备注</span>
                  ) : editingNote ? (
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
              ) : null}

              {/*
                机器人 (§8.3): the bot's own 简介 replaces the person bio of the
                same name, and the commands and menu it publishes follow — the
                same data the composer's "/" list reads, on the card the header
                opens.
              */}
              {profile.bot && botAbout ? (
                <div className="wx-profile__row">
                  <span className="wx-profile__label">简介</span>
                  <span className="wx-profile__value">{botAbout}</span>
                </div>
              ) : null}

              {profile.bot && profile.bot.commands.length > 0 ? (
                <div className="wx-profile__row wx-profile__row--stack">
                  <span className="wx-profile__label">命令</span>
                  <ul className="wx-profile__commands">
                    {profile.bot.commands.map((command) => (
                      <li className="wx-profile__command" key={command.command}>
                        <code className="wx-profile__command-name">/{command.command}</code>
                        {command.description ? (
                          <span className="wx-profile__command-text">{command.description}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {profile.bot?.menu ? (
                <div className="wx-profile__row">
                  <span className="wx-profile__label">菜单</span>
                  <button
                    type="button"
                    className="wx-profile__link"
                    disabled={busy}
                    onClick={() => void openBotMenu()}
                  >
                    {profile.bot.menu.text}
                  </button>
                </div>
              ) : null}

              {!profile.bot && profile.bio ? (
                <div className="wx-profile__row">
                  <span className="wx-profile__label">简介</span>
                  {/*
                    简介 keeps its TL entities: a bio carries links and @mentions,
                    and the official client opens them (§8.3). The card closes
                    first so it does not float over the conversation a mention
                    just opened.
                  */}
                  <span className="wx-profile__value">
                    <RichText
                      text={profile.bio}
                      entities={profile.bioEntities}
                      onMention={(target) => {
                        onClose()
                        openMention(target)
                      }}
                    />
                  </span>
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
              {/* A bot cannot be an address-book contact (`getContacts` skips
                  bots), so the card offers 加入黑名单 only. */}
              {profile.bot ? null : (
                <button
                  type="button"
                  className={`wx-profile__action${profile.isContact ? ' wx-profile__action--danger' : ''}`}
                  disabled={busy}
                  onClick={() => void toggleContact()}
                >
                  {profile.isContact ? '删除联系人' : '添加为联系人'}
                </button>
              )}
              <button
                type="button"
                className={`wx-profile__action${profile.blocked ? '' : ' wx-profile__action--danger'}`}
                disabled={busy}
                onClick={() => void toggleBlocked()}
              >
                {profile.blocked ? '取消拉黑' : '加入黑名单'}
              </button>
              {/*
                举报 only where TDLib allows it: `chat.can_be_reported` is true for
                a bot and false for a human (`UserManager::can_report_user` wants
                `is_bot`). A human is reported through the chat action bar's spam
                banner, which this client does not consume yet — a button here
                would only produce a server refusal.
              */}
              {profile.canBeReported ? (
                <button
                  type="button"
                  className="wx-profile__action wx-profile__action--danger"
                  onClick={() => {
                    void invoke('report:open', { kind: 'user', userId }).catch(
                      (failure: unknown) => useAppStore.getState().setError(errorMessage(failure)),
                    )
                  }}
                >
                  举报
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="wx-profile__loading">正在读取资料…</div>
        )}
      </Modal>

    </>
  )
}

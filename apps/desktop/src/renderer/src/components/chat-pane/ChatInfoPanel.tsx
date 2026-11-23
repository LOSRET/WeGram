import type { ChatMember, ChatPinnedMessage, ChatSummary } from '@wegram/protocol'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { INFO_MEMBER_LIMIT, personTiles } from '../../lib/chatInfo'
import { errorMessage, invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'
import { Avatar } from '../Avatar'
import { ConfirmDialog } from '../ConfirmDialog'
import { ProfileCard } from '../ProfileCard'
import { PlusIcon, QrGlyphIcon } from '../Icon'
import { OverlayScrollbar } from '../OverlayScrollbar'
import { SearchField } from '../SearchField'
import { ChatInfoSearch } from './ChatInfoSearch'
import { InviteDialog, RenameDialog } from './ChatInfoDialogs'
import { DangerRow, InfoRow, LinkRow, ToggleRow } from './ChatInfoRows'

/** Pause after typing before 搜索群成员 asks the server. */
const MEMBER_SEARCH_DELAY_MS = 260

interface ChatInfoPanelProps {
  chat: ChatSummary
  /** Drives the slide: the pane keeps the panel mounted until it has closed. */
  open: boolean
  /** A mute / pin call is in flight; the switches stay put until it lands. */
  muting: boolean
  pinning: boolean
  onToggleMuted: () => void
  onTogglePinned: () => void
  onRequestClear: () => void
  onClose: () => void
  /** A hit (a search result or 群公告): locate that row in the transcript. */
  onLocate: (messageId: number) => void
}

/**
 * 聊天信息, the pane WeChat's header "…" opens (design doc §9.9).
 *
 * It is an **overlay**: the sheet slides in from the right and covers the
 * transcript and the composer, which keep their width underneath — switching the
 * panel on must not re-flow a single message row.
 *
 * A group gets the client's group layout: 搜索群成员 over the member grid, then
 * 群聊名称 / 群公告 (Telegram's pinned message), 群二维码 (the invite link),
 * 查找聊天内容, the mute/pin pair, 清空聊天记录 and 退出群聊. Rows WeChat has and
 * Telegram does not — 备注, 我在本群的昵称, 保存到通讯录, 显示群成员昵称 — are
 * deliberately absent (see docs/HANDOFF.md §5.13).
 *
 * A channel reuses that layout. Its member grid is drawn only for an
 * administrator: TDLib hands a channel's subscriber list to nobody else, so the
 * panel asks `chats:canGetMembers` and keeps the grid (with its 搜索群成员) closed
 * otherwise — a subscriber would only see the channel's own face pretending to
 * be a member. Every other row works on a channel: 频道名称, 频道公告,
 * 频道二维码, 查找聊天内容, the mute/pin pair, 清空聊天记录 and 退出频道.
 */
export function ChatInfoPanel({
  chat,
  open,
  muting,
  pinning,
  onToggleMuted,
  onTogglePinned,
  onRequestClear,
  onClose,
  onLocate,
}: ChatInfoPanelProps) {
  const [entered, setEntered] = useState(false)
  const [members, setMembers] = useState<ChatMember[]>([])
  /**
   * 管理员显示群成员: whether this account may read a channel's subscriber list.
   * `null` while the question is in flight; groups never ask, private chats have
   * no member table.
   */
  const [canReadMembers, setCanReadMembers] = useState<boolean | null>(null)
  const [memberQuery, setMemberQuery] = useState('')
  const [pinned, setPinned] = useState<ChatPinnedMessage | null>(null)
  const [searching, setSearching] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameBusy, setRenameBusy] = useState(false)
  const [invite, setInvite] = useState<{ title: string } | null>(null)
  const [leaving, setLeaving] = useState(false)
  /** 资料卡: a private chat's own face opens the peer's card (the header does too). */
  const [profileOpen, setProfileOpen] = useState(false)
  const userAvatars = useAppStore((state) => state.userAvatars)
  /**
   * 以话题方式查看: a forum the reader switched to a flat transcript with
   * "view as chats" has to be switchable back, or the choice is one-way. The
   * topic rows cached this session are what tells us this group is a forum.
   */
  const knownTopics = useAppStore((state) => state.topicsByChat[chat.id]?.length ?? 0)
  const panelRef = useRef<HTMLElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const isGroup = chat.kind === 'group'
  /** A channel draws the group rows; its member block depends on administrator rights. */
  const isChannel = chat.kind === 'channel'
  /** 群聊名称 / 群公告 / 群二维码 / 退出群聊: groups and channels, not private chats. */
  const hasChatRows = chat.kind !== 'private'
  /**
   * A group always shows its participant block; a channel's appears only once this
   * account is known to administer it. `memberTable` means the chat has a member
   * list this account may search (a private chat draws its own face without one);
   * `showMemberBlock` also keeps that face for a private chat.
   */
  const memberTable = isGroup || (isChannel && canReadMembers === true)
  const showMemberBlock = !isChannel || memberTable

  // Mount closed, open on the next paint. The timeout is the fallback for an
  // occluded window, where rAF is throttled (see AGENTS.md).
  useEffect(() => {
    if (!open) {
      setEntered(false)
      return
    }
    const timer = window.setTimeout(() => setEntered(true), 20)
    return () => window.clearTimeout(timer)
  }, [open])

  // 管理员显示群成员. A group's members are readable by its members; a channel
  // answers subscribers with a refusal, so the panel asks before it draws the
  // grid instead of showing the channel's own face as a fake member.
  useEffect(() => {
    if (!isChannel) {
      setCanReadMembers(isGroup)
      return
    }
    let cancelled = false
    setCanReadMembers(null)
    void invoke('chats:canGetMembers', { chatId: chat.id })
      .then((allowed) => {
        if (!cancelled) setCanReadMembers(allowed)
      })
      .catch(() => {
        if (!cancelled) setCanReadMembers(false)
      })
    return () => {
      cancelled = true
    }
  }, [chat.id, chat.kind, isChannel, isGroup])

  // The participant grid. 搜索群成员 is a server-side search (searchChatMembers),
  // not a filter over the twelve rows already on screen, so a query is debounced
  // the same way the in-chat search view is.
  useEffect(() => {
    // Nothing to ask: a private chat has no member table, and a channel keeps its
    // grid closed until `chats:canGetMembers` says this account administers it.
    if (!memberTable) {
      setMembers([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(
      () => {
        void invoke('chats:members', {
          chatId: chat.id,
          limit: INFO_MEMBER_LIMIT,
          ...(memberQuery.trim() !== '' ? { query: memberQuery.trim() } : {}),
        })
          .then((list) => {
            if (!cancelled) setMembers(list)
          })
          // A refused member list keeps the conversation's own face instead of
          // an error bar (the grid is never blank).
          .catch(() => {
            if (!cancelled) setMembers([])
          })
      },
      memberQuery.trim() === '' ? 0 : MEMBER_SEARCH_DELAY_MS,
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [chat.id, chat.kind, memberTable, memberQuery])

  // 群公告: Telegram's newest pinned message. A chat without one answers null;
  // a private conversation has no pinned message at all.
  useEffect(() => {
    if (!hasChatRows) {
      setPinned(null)
      return
    }
    let cancelled = false
    void invoke('chats:pinned', { chatId: chat.id })
      .then((message) => {
        if (!cancelled) setPinned(message)
      })
      .catch(() => {
        if (!cancelled) setPinned(null)
      })
    return () => {
      cancelled = true
    }
  }, [chat.id, chat.kind, hasChatRows])

  // Esc closes whatever is on top: a dialog, the search view, then the panel.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (leaving) setLeaving(false)
      else if (profileOpen) setProfileOpen(false)
      else if (invite !== null) setInvite(null)
      else if (renaming) setRenaming(false)
      else if (searching) setSearching(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, searching, renaming, invite, leaving, profileOpen, onClose])

  const saveTitle = async (title: string): Promise<void> => {
    setRenameBusy(true)
    try {
      const updated = await invoke('chats:setTitle', { chatId: chat.id, title })
      useAppStore.getState().applyChatOps([{ op: 'upsert', chat: updated }])
      useAppStore.getState().setToast(isChannel ? '频道名称已修改' : '群聊名称已修改')
      setRenaming(false)
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setRenameBusy(false)
    }
  }

  /** 以话题方式查看 (`toggleChatViewAsTopics`), the official client's menu item. */
  const switchToTopics = async (): Promise<void> => {
    try {
      const updated = await invoke('chats:setViewAsTopics', { chatId: chat.id, viewAsTopics: true })
      useAppStore.getState().applyChatOps([{ op: 'upsert', chat: updated }])
      useAppStore.getState().setToast('以话题方式查看')
      onClose()
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    }
  }

  const leaveGroup = async (): Promise<void> => {
    setLeaving(false)
    try {
      await invoke('chats:leave', { chatId: chat.id })
      useAppStore.getState().applyChatOps([{ op: 'remove', chatId: chat.id }])
      useAppStore.getState().setActiveChat(null)
      onClose()
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    }
  }

  /** A query with no hits must not fall back to the group's face: the grid is the answer. */
  const queryEmpty = memberQuery.trim() === ''
  const tiles =
    isChannel && !memberTable
      ? []
      : (isGroup && !queryEmpty && members.length === 0 ? [] : personTiles(members, chat)).map(
          (tile) => ({ ...tile, avatarUrl: tile.avatarUrl ?? userAvatars[tile.id] }),
        )

  /** A channel's rows are the group's rows under the channel's own nouns. */
  const renameTitle = isChannel ? '频道名称' : '群聊名称'
  const renameHint = isChannel ? '修改后，将在频道内通知订阅者' : '修改后，将在群内通知其他成员'
  const pinnedLabel = isChannel ? '频道公告' : '群公告'
  const pinnedEmpty = isChannel ? '未设置' : '群主未设置'
  const qrLabel = isChannel ? '频道二维码' : '群二维码'
  const leaveLabel = isChannel ? '退出频道' : '退出群聊'

  return (
    <section className={`wx-info${entered ? ' is-open' : ''}`} aria-label="聊天信息" ref={panelRef}>
      {searching ? (
        <ChatInfoSearch chatId={chat.id} onBack={() => setSearching(false)} onPick={onLocate} />
      ) : (
        <div className="wx-info__scroll" ref={scrollRef}>
          {showMemberBlock ? (
            <>
              {memberTable ? (
                <div className="wx-info__member-search">
                  <SearchField
                    value={memberQuery}
                    onValueChange={setMemberQuery}
                    placeholder="搜索群成员"
                  />
                </div>
              ) : null}

              <div className="wx-info__people">
                {tiles.map((tile) => {
                  const face = (
                    <>
                      <Avatar
                        url={tile.avatarUrl}
                        name={tile.title}
                        colorId={tile.id}
                        className="wx-info__avatar"
                      />
                      <span className="wx-info__name" title={tile.title}>
                        {tile.title}
                      </span>
                    </>
                  )
                  // A private chat has exactly one face — the peer's — and WeChat
                  // opens their 资料卡 from it, the same card the header's title does.
                  return chat.kind === 'private' ? (
                    <button
                      key={tile.id}
                      type="button"
                      className="wx-info__person wx-info__person--face"
                      onClick={() => setProfileOpen(true)}
                    >
                      {face}
                    </button>
                  ) : (
                    <div className="wx-info__person" key={tile.id}>
                      {face}
                    </div>
                  )
                })}
                {isGroup ? (
                  <button
                    type="button"
                    className="wx-info__person wx-info__person--add"
                    onClick={() => setInvite({ title: '邀请成员' })}
                  >
                    <span className="wx-info__add-tile">
                      <PlusIcon size={20} />
                    </span>
                    <span className="wx-info__name">添加</span>
                  </button>
                ) : null}
              </div>

              {memberTable && !queryEmpty && tiles.length === 0 ? (
                <p className="wx-info__note">没有找到群成员</p>
              ) : null}

              <div className="wx-info__rule" />
            </>
          ) : null}

          {hasChatRows ? (
            <>
              <div className="wx-info__stack">
                <InfoRow label={renameTitle} hint={renameHint} onClick={() => setRenaming(true)} />
                <InfoRow
                  label={pinnedLabel}
                  hint={pinned ? pinned.text : pinnedEmpty}
                  {...(pinned ? { onClick: () => onLocate(pinned.messageId) } : {})}
                />
              </div>
              <div className="wx-info__rule" />
              <LinkRow
                label={qrLabel}
                icon={<QrGlyphIcon className="wx-info__qr" />}
                // The client opens the QR as its own window, not a sheet in the chat.
                onClick={() => {
                  void invoke('qr:open', { chatId: chat.id })
                }}
              />
              <div className="wx-info__rule" />
            </>
          ) : null}

          <LinkRow label="查找聊天内容" onClick={() => setSearching(true)} />
          <div className="wx-info__rule" />

          {isGroup && chat.forum !== true && knownTopics > 0 ? (
            <>
              <LinkRow label="以话题方式查看" onClick={() => void switchToTopics()} />
              <div className="wx-info__rule" />
            </>
          ) : null}

          <div className="wx-info__toggles">
            <ToggleRow
              label="消息免打扰"
              checked={chat.muted}
              disabled={muting}
              onChange={onToggleMuted}
            />
            <ToggleRow
              label="置顶聊天"
              checked={chat.pinned}
              disabled={pinning}
              onChange={onTogglePinned}
            />
          </div>
          <div className="wx-info__rule" />

          <DangerRow label="清空聊天记录" onClick={onRequestClear} />
          {hasChatRows ? (
            <>
              <div className="wx-info__rule" />
              <DangerRow label={leaveLabel} onClick={() => setLeaving(true)} />
            </>
          ) : null}
        </div>
      )}

      <OverlayScrollbar scrollerRef={scrollRef} hostRef={panelRef} hidden={!entered || searching} />

      {/*
        The sheets live in a portal: .wx-info carries a transform (the slide), and a
        transformed ancestor would both size a fixed overlay to the panel and clip it
        with the panel's own overflow.
      */}
      {renaming
        ? createPortal(
            <RenameDialog
              title={renameTitle}
              hint={renameHint}
              initial={chat.title}
              busy={renameBusy}
              onSave={(title) => void saveTitle(title)}
              onCancel={() => setRenaming(false)}
            />,
            document.body,
          )
        : null}

      {invite
        ? createPortal(
            <InviteDialog chatId={chat.id} title={invite.title} onClose={() => setInvite(null)} />,
            document.body,
          )
        : null}

      {/*
        资料卡 opens in a portal for the same reason the sheets below do: .wx-info
        carries the slide transform, and a fixed overlay inside it would be sized
        to the panel and clipped by its overflow.
      */}
      {profileOpen && chat.userId !== undefined
        ? createPortal(
            <ProfileCard userId={chat.userId} onClose={() => setProfileOpen(false)} />,
            document.body,
          )
        : null}

      {leaving
        ? createPortal(
            <ConfirmDialog
              title={isChannel ? '退出频道？' : '退出群聊？'}
              description={
                isChannel
                  ? '退出后将不再接收这个频道的消息；本机的聊天记录会保留。'
                  : '退出后将不再接收这个群的消息；本机的聊天记录会保留。'
              }
              confirmLabel="退出"
              danger
              onConfirm={() => void leaveGroup()}
              onCancel={() => setLeaving(false)}
            />,
            document.body,
          )
        : null}
    </section>
  )
}

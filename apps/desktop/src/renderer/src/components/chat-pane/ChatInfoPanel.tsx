import type { ChatMember, ChatPinnedMessage, ChatSummary } from '@wegram/protocol'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { INFO_MEMBER_LIMIT, personTiles } from '../../lib/chatInfo'
import { errorMessage, invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'
import { Avatar } from '../Avatar'
import { ConfirmDialog } from '../ConfirmDialog'
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
 * deliberately absent (see docs/UI-HANDOFF.md §5).
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
  const [memberQuery, setMemberQuery] = useState('')
  const [pinned, setPinned] = useState<ChatPinnedMessage | null>(null)
  const [searching, setSearching] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameBusy, setRenameBusy] = useState(false)
  const [invite, setInvite] = useState<{ title: string } | null>(null)
  const [leaving, setLeaving] = useState(false)
  const userAvatars = useAppStore((state) => state.userAvatars)
  const panelRef = useRef<HTMLElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const isGroup = chat.kind === 'group'

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

  // The participant grid. 搜索群成员 is a server-side search (searchChatMembers),
  // not a filter over the twelve rows already on screen, so a query is debounced
  // the same way the in-chat search view is.
  useEffect(() => {
    if (chat.kind === 'private') {
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
          // A channel refuses its member list without administrator rights; the
          // grid then keeps the conversation's own face instead of an error bar.
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
  }, [chat.id, chat.kind, memberQuery])

  // 群公告: Telegram's newest pinned message. A group without one answers null.
  useEffect(() => {
    if (chat.kind !== 'group') {
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
  }, [chat.id, chat.kind])

  // Esc closes whatever is on top: a dialog, the search view, then the panel.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (leaving) setLeaving(false)
      else if (invite !== null) setInvite(null)
      else if (renaming) setRenaming(false)
      else if (searching) setSearching(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, searching, renaming, invite, leaving, onClose])

  const saveTitle = async (title: string): Promise<void> => {
    setRenameBusy(true)
    try {
      const updated = await invoke('chats:setTitle', { chatId: chat.id, title })
      useAppStore.getState().applyChatOps([{ op: 'upsert', chat: updated }])
      useAppStore.getState().setToast('群聊名称已修改')
      setRenaming(false)
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    } finally {
      setRenameBusy(false)
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
  const tiles = (
    isGroup && !queryEmpty && members.length === 0 ? [] : personTiles(members, chat)
  ).map((tile) => ({ ...tile, avatarUrl: tile.avatarUrl ?? userAvatars[tile.id] }))

  return (
    <section className={`wx-info${entered ? ' is-open' : ''}`} aria-label="聊天信息" ref={panelRef}>
      {searching ? (
        <ChatInfoSearch chatId={chat.id} onBack={() => setSearching(false)} onPick={onLocate} />
      ) : (
        <div className="wx-info__scroll" ref={scrollRef}>
          {isGroup ? (
            <div className="wx-info__member-search">
              <SearchField
                value={memberQuery}
                onValueChange={setMemberQuery}
                placeholder="搜索群成员"
              />
            </div>
          ) : null}

          <div className="wx-info__people">
            {tiles.map((tile) => (
              <div className="wx-info__person" key={tile.id}>
                <Avatar
                  url={tile.avatarUrl}
                  name={tile.title}
                  colorId={tile.id}
                  className="wx-info__avatar"
                />
                <span className="wx-info__name" title={tile.title}>
                  {tile.title}
                </span>
              </div>
            ))}
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

          {isGroup && !queryEmpty && tiles.length === 0 ? (
            <p className="wx-info__note">没有找到群成员</p>
          ) : null}

          <div className="wx-info__rule" />

          {isGroup ? (
            <>
              <div className="wx-info__stack">
                <InfoRow
                  label="群聊名称"
                  hint="修改后，将在群内通知其他成员"
                  onClick={() => setRenaming(true)}
                />
                <InfoRow
                  label="群公告"
                  hint={pinned ? pinned.text : '群主未设置'}
                  {...(pinned ? { onClick: () => onLocate(pinned.messageId) } : {})}
                />
              </div>
              <div className="wx-info__rule" />
              <LinkRow
                label="群二维码"
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
          {isGroup ? (
            <>
              <div className="wx-info__rule" />
              <DangerRow label="退出群聊" onClick={() => setLeaving(true)} />
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

      {leaving
        ? createPortal(
            <ConfirmDialog
              title="退出群聊？"
              description="退出后将不再接收这个群的消息；本机的聊天记录会保留。"
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

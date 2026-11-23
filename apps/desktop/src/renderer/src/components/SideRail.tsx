import { useAppStore } from '@renderer/store/useAppStore'
import type { MouseEvent, ReactNode } from 'react'

import {
  ContactsTabFilledIcon,
  ContactsTabIcon,
  CubeTabFilledIcon,
  CubeTabIcon,
  DeviceIcon,
  MenuIcon,
  MomentsTabFilledIcon,
  MomentsTabIcon,
  TelegramLogo,
} from './Icon'
import { avatarColor, initials } from '../lib/format'

/** The four sections the rail can switch between. */
export type ShellSection = 'chats' | 'contacts' | 'favorites' | 'moments'

interface SideRailProps {
  section: ShellSection
  onSectionChange: (section: ShellSection) => void
  /** Opens the app menu (settings / theme / sign out) under the pressed button. */
  onOpenMenu: (anchor: { x: number; y: number }) => void
  /** Entries the protocol does not cover yet. */
  onUnavailable: (label: string) => void
}

/**
 * The 61 px icon rail on the far left of WeChat: avatar on top, the four
 * sections under it, device + settings pinned to the bottom.
 *
 * Every tab is selectable and the selected one carries the brand green, like the
 * client's filled tab. 聊天 and 通讯录 switch the shell; 收藏 and 朋友圈 own a
 * placeholder pane because the protocol carries no data for them yet.
 */
export function SideRail({ section, onSectionChange, onOpenMenu, onUnavailable }: SideRailProps) {
  const auth = useAppStore((state) => state.auth)
  const connection = useAppStore((state) => state.connection)
  const chats = useAppStore((state) => state.chats)
  const archivedChats = useAppStore((state) => state.archivedChats)

  const me = auth.kind === 'ready' ? auth.me : null
  const name = me ? [me.firstName, me.lastName].filter(Boolean).join('') : '我'
  // The profile photo arrives from `getMe` → `downloadFile` once TDLib has it;
  // until then the rail keeps the initial like a freshly added contact.
  const avatarUrl = me?.avatarUrl ?? null
  // Both lists count: 已归档会话 is still unread messages, and Telegram's app icon
  // adds the archive in too — the archive row's own badge is just the part of it
  // that lives behind that row.
  const unread = [...chats, ...archivedChats].reduce((total, chat) => total + chat.unread, 0)

  const openMenu = (event: MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    onOpenMenu({ x: rect.left + rect.width + 6, y: rect.top - 6 })
  }

  return (
    <nav className="wx-rail" aria-label="主导航">
      <button
        className="wx-rail__me"
        style={avatarUrl ? undefined : { background: avatarColor(me?.id ?? 1000) }}
        title={me ? `${name}（${connectionLabel(connection)}）` : '我'}
      >
        {avatarUrl ? (
          <img className="wx-rail__me-img" src={avatarUrl} alt="" draggable={false} />
        ) : (
          initials(name)
        )}
        <span className={`wx-rail__me-dot wx-rail__me-dot--${connection}`} />
      </button>

      <div className="wx-rail__nav">
        <RailTab
          active={section === 'chats'}
          title="聊天"
          onSelect={() => onSectionChange('chats')}
        >
          <TelegramLogo size={21} />
          {unread > 0 ? (
            <span className="wx-rail__badge">{unread > 99 ? '99+' : unread}</span>
          ) : null}
        </RailTab>
        <RailTab
          active={section === 'contacts'}
          title="通讯录"
          onSelect={() => onSectionChange('contacts')}
        >
          {section === 'contacts' ? (
            <ContactsTabFilledIcon size={24} />
          ) : (
            <ContactsTabIcon size={24} />
          )}
        </RailTab>
        <RailTab
          active={section === 'favorites'}
          title="收藏"
          onSelect={() => onSectionChange('favorites')}
        >
          {section === 'favorites' ? <CubeTabFilledIcon size={24} /> : <CubeTabIcon size={24} />}
        </RailTab>
        <RailTab
          active={section === 'moments'}
          title="朋友圈"
          onSelect={() => onSectionChange('moments')}
        >
          {section === 'moments' ? (
            <MomentsTabFilledIcon size={24} />
          ) : (
            <MomentsTabIcon size={24} />
          )}
        </RailTab>
      </div>

      <div className="wx-rail__bottom">
        <button className="wx-rail__btn" title="手机" onClick={() => onUnavailable('手机')}>
          <DeviceIcon size={23} />
        </button>
        <button className="wx-rail__btn" title="设置" onClick={openMenu}>
          <MenuIcon size={23} />
        </button>
      </div>
    </nav>
  )
}

/** One rail tab: the selected one is painted brand green through `--active`. */
function RailTab({
  active,
  title,
  onSelect,
  children,
}: {
  active: boolean
  title: string
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button
      className={`wx-rail__btn${active ? ' wx-rail__btn--active' : ''}`}
      title={title}
      aria-current={active ? 'page' : undefined}
      onClick={onSelect}
    >
      {children}
    </button>
  )
}

function connectionLabel(connection: string): string {
  switch (connection) {
    case 'online':
      return '已连接'
    case 'connecting':
      return '连接中'
    case 'updating':
      return '同步中'
    default:
      return '离线'
  }
}

import { useAppStore } from '@renderer/store/useAppStore'
import type { MouseEvent } from 'react'

import {
  ContactsTabIcon,
  CubeTabIcon,
  DeviceIcon,
  MenuIcon,
  MomentsTabIcon,
  TelegramLogo,
} from './Icon'
import { avatarColor, initials } from '../lib/format'

interface SideRailProps {
  /** Opens the app menu (settings / theme / sign out) under the pressed button. */
  onOpenMenu: (anchor: { x: number; y: number }) => void
  /** Sections the protocol does not cover yet. */
  onUnavailable: (label: string) => void
}

/**
 * The 42 px icon rail on the far left of WeChat: avatar on top, the four
 * sections under it, device + settings pinned to the bottom.
 *
 * Only 聊天 has a working view; the other sections report that they are not
 * wired up yet instead of pretending to navigate.
 */
export function SideRail({ onOpenMenu, onUnavailable }: SideRailProps) {
  const auth = useAppStore((state) => state.auth)
  const connection = useAppStore((state) => state.connection)
  const chats = useAppStore((state) => state.chats)

  const me = auth.kind === 'ready' ? auth.me : null
  const name = me ? [me.firstName, me.lastName].filter(Boolean).join('') : '我'
  // The profile photo arrives from `getMe` → `downloadFile` once TDLib has it;
  // until then the rail keeps the initial like a freshly added contact.
  const avatarUrl = me?.avatarUrl ?? null
  const unread = chats.reduce((total, chat) => total + chat.unread, 0)

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
        <button className="wx-rail__btn wx-rail__btn--active" title="聊天" aria-current="page">
          <TelegramLogo size={26} className="wx-rail__brand" />
          {unread > 0 ? (
            <span className="wx-rail__badge">{unread > 99 ? '99+' : unread}</span>
          ) : null}
        </button>
        <button
          className="wx-rail__btn"
          title="通讯录"
          onClick={() => onUnavailable('通讯录')}
        >
          <ContactsTabIcon size={24} />
        </button>
        <button className="wx-rail__btn" title="收藏" onClick={() => onUnavailable('收藏')}>
          <CubeTabIcon size={23} />
        </button>
        <button className="wx-rail__btn" title="朋友圈" onClick={() => onUnavailable('朋友圈')}>
          <MomentsTabIcon size={24} />
        </button>
      </div>

      <div className="wx-rail__bottom">
        <button className="wx-rail__btn" title="手机" onClick={() => onUnavailable('手机')}>
          <DeviceIcon size={22} />
        </button>
        <button className="wx-rail__btn" title="设置" onClick={openMenu}>
          <MenuIcon size={22} />
        </button>
      </div>
    </nav>
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

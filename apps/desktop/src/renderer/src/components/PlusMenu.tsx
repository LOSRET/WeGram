import { Popup } from './ContextMenu'
import { AddFriendIcon, NewGroupIcon, NoteIcon } from './Icon'

interface PlusMenuProps {
  x: number
  y: number
  onClose: () => void
  /** None of the three entries is in the protocol yet. */
  onUnavailable: (label: string) => void
}

const ITEMS = [
  { label: '发起群聊', Icon: NewGroupIcon },
  { label: '添加朋友', Icon: AddFriendIcon },
  { label: '写笔记', Icon: NoteIcon },
] as const

/**
 * The circular "+" in the list header. WeChat 4.x opens a small card with exactly
 * these three entries; settings/theme/sign-out live behind the rail's "≡" button,
 * so this menu only carries the "new" actions.
 *
 * The glyphs are WeChat's own payloads (`#0698`, `#1463`, `#0391`), matched off a
 * client screenshot.
 */
export function PlusMenu({ x, y, onClose, onUnavailable }: PlusMenuProps) {
  return (
    <Popup x={x} y={y} centerX onClose={onClose}>
      {ITEMS.map(({ label, Icon }) => (
        <button
          key={label}
          className="wx-plus-menu__item"
          role="menuitem"
          onClick={() => {
            onClose()
            onUnavailable(label)
          }}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </Popup>
  )
}

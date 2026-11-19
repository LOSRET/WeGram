import type { Self } from '@wegram/protocol'
import { avatarColor, initials } from '@renderer/lib/format'

import { displayName } from '../loginModel'

/**
 * The profile step of a session restored at startup: the account's photo and
 * name, then 进入 WeGram. A user-driven sign-in skips it entirely.
 */
export function ProfileStep({
  me,
  busy,
  onEnter,
}: {
  me: Self
  busy: boolean
  onEnter: () => void
}) {
  return (
    <div className="wx-login__body wx-login__body--profile">
      {me.avatarUrl ? (
        <img className="wx-login__avatar" src={me.avatarUrl} alt="" draggable={false} />
      ) : (
        <div
          className="wx-login__avatar wx-login__avatar--empty"
          style={{ background: avatarColor(me.id) }}
        >
          {initials(displayName(me))}
        </div>
      )}
      <div className="wx-login__profile-name">{displayName(me)}</div>
      <button className="wx-login__button" type="button" disabled={busy} onClick={onEnter}>
        {busy ? '正在进入…' : '进入 WeGram'}
      </button>
    </div>
  )
}

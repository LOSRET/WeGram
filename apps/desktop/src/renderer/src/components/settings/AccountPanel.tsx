import type { Self } from '@wegram/protocol'
import { useEffect, useState } from 'react'

import { Avatar } from '@renderer/components/Avatar'
import { errorMessage, invoke } from '@renderer/lib/ipc'

import { SettingsGroup } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'

function displayName(me: Self): string {
  return [me.firstName, me.lastName].filter(Boolean).join(' ') || '未命名'
}

/**
 * 账号与安全, first batch: the reader's own identity and 退出登录 (§9.11.3).
 * Profile editing, 登录设备 and 两步验证 need their own writes and land in B/C.
 */
export function AccountPanel() {
  const [me, setMe] = useState<Self | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('auth:me')
      .then((next) => {
        if (!cancelled) setMe(next)
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const logout = async (): Promise<void> => {
    try {
      await invoke('auth:logout')
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  return (
    <>
      <SettingsGroup title="账号">
        <div className="wx-set-profile">
          {me ? (
            <Avatar
              url={me.avatarUrl}
              name={displayName(me)}
              colorId={me.id}
              className="wx-set-profile__avatar"
            />
          ) : (
            <span className="wx-set-profile__avatar" />
          )}
          <span className="wx-set-profile__text">
            <span className="wx-set-profile__name">{me ? displayName(me) : '…'}</span>
            <span className="wx-set-profile__handle">
              {me?.username ? `@${me.username}` : '未设置 Telegram 号'}
            </span>
          </span>
        </div>
        <SettingsRow label="退出登录" description="退出后需要重新扫码或输入手机号">
          <button className="wx-set-button wx-set-button--danger" onClick={() => void logout()}>
            退出登录
          </button>
        </SettingsRow>
      </SettingsGroup>

      {error ? <div className="wx-set-error">{error}</div> : null}
    </>
  )
}

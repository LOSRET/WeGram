import { useEffect, useState } from 'react'

import { copyText } from '../../lib/clipboard'
import { errorMessage, invoke } from '../../lib/ipc'
import { useAppStore } from '../../store/useAppStore'
import { QrCode } from '../QrCode'

/**
 * 群聊名称: the client's rename sheet (design doc §9.9).
 *
 * The dialog owns the draft only; the caller performs the write, so a refusal
 * (no `can_change_info` right) keeps the sheet open with the typed name.
 */
export function RenameDialog({
  title,
  hint,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  /** 群聊名称 for a group, 频道名称 for a channel. */
  title: string
  /** The line under the input: the same nouns as the title. */
  hint: string
  initial: string
  busy: boolean
  onSave: (title: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const trimmed = value.trim()
  return (
    <div className="wx-modal-backdrop" onClick={onCancel}>
      <form
        className="wx-modal wx-modal--small wx-info-dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          if (trimmed !== '' && !busy) onSave(trimmed)
        }}
      >
        <div className="wx-dialog__title">{title}</div>
        <input
          className="wx-input"
          value={value}
          autoFocus
          maxLength={128}
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
        <p className="wx-info-dialog__hint">{hint}。</p>
        <div className="wx-dialog__actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="submit" className="wx-dialog__confirm" disabled={trimmed === '' || busy}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * 添加成员 (§8.3/§9.9): one @username, put into the group with `addChatMembers`.
 *
 * This is how a bot joins a group — it has no invite-link flow, and the handle is
 * the only identifier it has. Telegram's own sheet is a search over contacts and
 * usernames; asking for the handle is the smaller honest version, and a refusal
 * (a privacy setting, or Premium) keeps the sheet open with the reason and points
 * at the invite link instead.
 */
export function AddMemberDialog({
  chatId,
  onOpenInvite,
  onClose,
}: {
  chatId: number
  /** 改用邀请链接: the same group's link, for somebody who refuses direct adds. */
  onOpenInvite: () => void
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handle = value.trim().replace(/^@+/, '')
  const submit = async (): Promise<void> => {
    if (handle.length < 3 || busy) return
    setBusy(true)
    setError(null)
    try {
      const member = await invoke('chats:addMember', { chatId, username: handle })
      useAppStore.getState().setToast(`已添加 ${member.title}`)
      onClose()
    } catch (failure) {
      // The sheet stays open: the reason often suggests the invite link below.
      setError(errorMessage(failure))
      setBusy(false)
    }
  }
  return (
    <div className="wx-modal-backdrop" onClick={onClose}>
      <form
        className="wx-modal wx-modal--small wx-info-dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="wx-dialog__title">添加成员</div>
        <input
          className="wx-input"
          value={value}
          autoFocus
          maxLength={64}
          spellCheck={false}
          placeholder="@用户名"
          onChange={(event) => setValue(event.target.value)}
        />
        <p className="wx-info-dialog__hint">输入对方的 @用户名，机器人也用这个。</p>
        {error ? <p className="wx-info-dialog__error">{error}</p> : null}
        <button type="button" className="wx-info-dialog__link" onClick={onOpenInvite}>
          对方不接受直接添加？改用邀请链接
        </button>
        <div className="wx-dialog__actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="wx-dialog__confirm" disabled={handle.length < 3 || busy}>
            {busy ? '添加中…' : '添加'}
          </button>
        </div>
      </form>
    </div>
  )
}
/**
 * 群二维码 / 邀请成员: the one link a phone can scan (design doc §9.9).
 *
 * Telegram has no member picker here, so inviting is sharing the group's link —
 * a public t.me link, or one this account may create. `null` is a real answer
 * (not an error): a private group only exposes links to administrators.
 */
export function InviteDialog({
  chatId,
  title,
  onClose,
}: {
  chatId: number
  title: string
  onClose: () => void
}) {
  const [link, setLink] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    void invoke('chats:inviteLink', { chatId })
      .then((answer) => {
        if (cancelled) return
        setLink(answer?.link ?? null)
        setLoading(false)
      })
      .catch((failure: unknown) => {
        if (cancelled) return
        setError(errorMessage(failure))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chatId])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async (): Promise<void> => {
    if (!link) return
    try {
      await copyText(link)
      setCopied(true)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  return (
    <div className="wx-modal-backdrop" onClick={onClose}>
      <div
        className="wx-modal wx-modal--small wx-info-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wx-dialog__title">{title}</div>
        {loading ? (
          <div className="wx-info-invite__state">正在获取邀请链接…</div>
        ) : error !== null ? (
          <div className="wx-info-invite__state">{error}</div>
        ) : link === null ? (
          <div className="wx-info-invite__state">
            这个群没有可用的邀请链接。公开群，或拥有邀请权限的账号，才拿得到。
          </div>
        ) : (
          <div className="wx-info-invite">
            <QrCode value={link} size={168} label="群二维码" />
            <div className="wx-info-invite__link">{link}</div>
            <button type="button" className="wx-button" onClick={() => void copy()}>
              {copied ? '已复制' : '复制链接'}
            </button>
          </div>
        )}
        <div className="wx-dialog__actions">
          <button type="button" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}

import type { ChatSummary, QrInfo } from '@wegram/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Avatar } from '@renderer/components/Avatar'
import { CloseIcon } from '@renderer/components/Icon'
import { QrCode } from '@renderer/components/QrCode'
import { errorMessage, invoke } from '@renderer/lib/ipc'
import { qrPngBase64 } from '@renderer/lib/qrImage'

/** How long a 已复制/已发送 pill stays up. */
const TOAST_MS = 1600

function formatExpiry(seconds: number): string {
  const date = new Date(seconds * 1000)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/**
 * 群二维码, the window WeChat opens for a group's QR code (design doc §9.9).
 *
 * A frameless 360 × 560 sheet: the group's faces, 群聊：…, the code itself, its
 * validity line and the client's three actions. Everything it draws comes from
 * `qr:info`; the picture the actions work on is rasterised here from the same
 * matrix the on-screen SVG uses, so 复制/保存/转发 move the code that is shown.
 *
 * The window owns no shell state (like the login and viewer windows): it must not
 * hydrate the chat store.
 */
export function QrWindow() {
  const [info, setInfo] = useState<QrInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  /** 转发给朋友's sheet: `null` while closed, the chat list once it is open. */
  const [picking, setPicking] = useState<ChatSummary[] | null>(null)
  const [busy, setBusy] = useState(false)
  /** Faces that finished downloading after `qr:info` (evt:avatars pool). */
  const [userAvatars, setUserAvatars] = useState<Record<number, string>>({})
  const pickTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('qr:info')
      .then((next) => {
        if (cancelled) return
        setInfo(next)
        document.documentElement.dataset['theme'] = next.theme
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () =>
      window.tg.on('evt:avatars', (event) => {
        setUserAvatars((current) => {
          const next = { ...current }
          for (const avatar of event.payload.avatars) next[avatar.userId] = avatar.url
          return next
        })
      }),
    [],
  )

  const flash = useCallback((message: string): void => {
    setToast(message)
    if (pickTimer.current !== null) window.clearTimeout(pickTimer.current)
    pickTimer.current = window.setTimeout(() => {
      pickTimer.current = null
      setToast(null)
    }, TOAST_MS)
  }, [])

  useEffect(
    () => () => {
      if (pickTimer.current !== null) window.clearTimeout(pickTimer.current)
    },
    [],
  )

  /** Rasterise the code the window is showing; the three actions all start here. */
  const rasterise = useCallback(async (): Promise<string> => {
    const link = info?.invite?.link
    if (!link) throw new Error('没有可用的邀请链接')
    return qrPngBase64(link)
  }, [info])

  const run = useCallback(
    async (action: () => Promise<void>, done: string): Promise<void> => {
      if (busy) return
      setBusy(true)
      try {
        await action()
        flash(done)
      } catch (failure) {
        flash(errorMessage(failure))
      } finally {
        setBusy(false)
      }
    },
    [busy, flash],
  )

  const copyImage = (): void => {
    void run(async () => {
      await invoke('qr:copy', { png: await rasterise() })
    }, '已复制图片')
  }

  const saveImage = (): void => {
    if (busy) return
    setBusy(true)
    void (async () => {
      try {
        const saved = await invoke('qr:save', { png: await rasterise() })
        // Cancelling the dialog is not a save; only a real path gets the pill.
        if (saved !== null) flash('已保存')
      } catch (failure) {
        flash(errorMessage(failure))
      } finally {
        setBusy(false)
      }
    })()
  }

  const openPicker = async (): Promise<void> => {
    if (picking !== null) return
    try {
      setPicking(await invoke('chats:list', { limit: 50, offset: 0 }))
    } catch (failure) {
      flash(errorMessage(failure))
    }
  }

  const share = (chatId: number): void => {
    void run(async () => {
      await invoke('qr:share', { chatId, png: await rasterise() })
      setPicking(null)
    }, '已发送')
  }

  /** Esc closes the picker first, then the window — the same ordering as 聊天信息. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (picking !== null) setPicking(null)
      else void invoke('qr:close')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picking])

  const channel = info?.chat.kind === 'channel'
  const faces = (info?.members ?? []).slice(0, 6)
  const names = (info?.members ?? [])
    .slice(0, 3)
    .map((member) => member.title)
    .join('、')

  return (
    <div className="wx-qr-window">
      <button
        type="button"
        className="wx-qr-window__close"
        aria-label="关闭"
        title="关闭"
        onClick={() => void invoke('qr:close')}
      >
        <CloseIcon size={12} />
      </button>

      {error !== null ? (
        <p className="wx-qr-window__note">{error}</p>
      ) : info === null ? (
        <p className="wx-qr-window__note">正在生成二维码…</p>
      ) : (
        <>
          <div className="wx-qr-window__head">
            <GroupFaces info={info} faces={faces} userAvatars={userAvatars} />
            <p className="wx-qr-window__title">
              {channel ? '频道' : '群聊'}：{names || info.chat.title}
            </p>
          </div>

          {info.invite === null ? (
            <p className="wx-qr-window__note">
              {channel
                ? '这个频道没有可分享的邀请链接。公开频道，或拥有邀请权限的账号，才拿得到。'
                : '这个群没有可分享的邀请链接。公开群，或拥有邀请权限的账号，才拿得到。'}
            </p>
          ) : (
            <>
              <QrCode
                value={info.invite.link}
                size={280}
                label={channel ? '频道二维码' : '群二维码'}
              />
              <p className="wx-qr-window__validity">
                {info.invite.expiresAt
                  ? `该二维码 7 天内（${formatExpiry(info.invite.expiresAt)}前）有效，重新进入将更新`
                  : '该链接长期有效，重新进入不会变化'}
              </p>
            </>
          )}

          <div className="wx-qr-window__actions">
            <button type="button" disabled={busy} onClick={() => void openPicker()}>
              转发给朋友
            </button>
            <button type="button" disabled={busy} onClick={copyImage}>
              复制图片
            </button>
            <button type="button" disabled={busy} onClick={saveImage}>
              保存图片
            </button>
          </div>
        </>
      )}

      {picking !== null ? (
        <div className="wx-qr-window__picker">
          <div className="wx-qr-window__picker-head">
            <span>转发给朋友</span>
            <button type="button" onClick={() => setPicking(null)}>
              取消
            </button>
          </div>
          <div className="wx-qr-window__picker-list">
            {picking.length === 0 ? <p className="wx-qr-window__note">还没有会话</p> : null}
            {picking.map((chat) => (
              <button
                type="button"
                key={chat.id}
                className="wx-qr-window__pick"
                onClick={() => share(chat.id)}
              >
                <Avatar
                  url={chat.avatarUrl}
                  name={chat.title}
                  colorId={chat.id}
                  className="wx-qr-window__pick-avatar"
                />
                <span>{chat.title}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {toast !== null ? <div className="wx-qr-window__toast">{toast}</div> : null}
    </div>
  )
}

/**
 * The group's face: a collage of its members, the way WeChat draws a group avatar.
 * One avatar when the chat has no member list (private, or a channel without
 * rights), up to six faces in a 2 × 2 / 3 × 2 grid otherwise.
 */
function GroupFaces({
  info,
  faces,
  userAvatars,
}: {
  info: QrInfo
  faces: QrInfo['members']
  userAvatars: Record<number, string>
}) {
  if (faces.length <= 1) {
    return (
      <Avatar
        url={faces[0]?.avatarUrl ?? userAvatars[faces[0]?.userId ?? 0] ?? info.chat.avatarUrl}
        name={info.chat.title}
        colorId={info.chat.id}
        className="wx-qr-window__avatar"
      />
    )
  }
  return (
    <span
      className={`wx-qr-window__avatar wx-qr-window__avatar--grid wx-qr-window__avatar--${faces.length}`}
    >
      {faces.map((face) => (
        <Avatar
          key={face.userId}
          url={face.avatarUrl ?? userAvatars[face.userId]}
          name={face.title}
          colorId={face.userId}
          className="wx-qr-window__face"
        />
      ))}
    </span>
  )
}

import type { Message, Sticker, StickerSet, StickerSetSummary } from '@wegram/protocol'
import { useEffect, useState } from 'react'

import { loadLatestWindow } from '../lib/anchoredWindow'
import { errorMessage, invoke } from '../lib/ipc'
import { useAppStore } from '../store/useAppStore'
import { StickerRenderer } from './StickerRenderer'

interface StickerPanelProps {
  chatId: number
  onSent: (message: Message) => void
  onClose: () => void
}

function stickerMedia(sticker: Sticker) {
  return {
    fileId: sticker.fileId,
    ...(sticker.thumbFileId ? { thumbFileId: sticker.thumbFileId } : {}),
    stickerFormat: sticker.format,
    ...(sticker.emoji ? { stickerEmoji: sticker.emoji } : {}),
    ...(sticker.width ? { width: sticker.width } : {}),
    ...(sticker.height ? { height: sticker.height } : {}),
  }
}

/**
 * Installed sticker sets (design doc §9.3). The grid renders thumbnails; the
 * full animated file is only fetched when a set row is missing a thumbnail, so
 * opening the panel never downloads every sticker in the account.
 */
export function StickerPanel({ chatId, onSent, onClose }: StickerPanelProps) {
  const [sets, setSets] = useState<StickerSetSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [active, setActive] = useState<StickerSet | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await invoke('stickers:sets')
        if (cancelled) return
        setSets(result)
        if (result[0]) setActiveId(result[0].id)
        else setLoading(false)
      } catch (cause) {
        if (!cancelled) {
          setError(errorMessage(cause))
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const set = await invoke('stickers:set', { setId: activeId })
        if (!cancelled) setActive(set)
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeId])

  const send = async (sticker: Sticker): Promise<void> => {
    try {
      // An anchored window cannot take the new row in place; return to the
      // newest page first so the message lands where it will be visible.
      const wasAnchored = await loadLatestWindow(chatId)
      const result = await invoke('messages:sendSticker', { chatId, fileId: sticker.fileId })
      useAppStore.getState().applyMessageOps(chatId, [{ op: 'new', message: result.message }])
      if (wasAnchored) useAppStore.getState().requestJumpToLatest(chatId)
      onSent(result.message)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <div className="wx-sticker-panel" role="dialog" aria-label="贴纸">
      <div className="wx-sticker-panel__header">
        <span>{active?.title ?? '贴纸'}</span>
        <button className="wx-icon-button" onClick={onClose} title="关闭贴纸面板">
          ×
        </button>
      </div>

      {sets.length > 1 ? (
        <div className="wx-sticker-panel__sets">
          {sets.map((set) => (
            <button
              key={set.id}
              className={`wx-sticker-panel__set${set.id === activeId ? ' wx-sticker-panel__set--active' : ''}`}
              onClick={() => setActiveId(set.id)}
              title={set.title}
            >
              {set.thumbnail ? (
                <StickerRenderer media={stickerMedia(set.thumbnail)} size={28} preview />
              ) : (
                <span>{set.title.slice(0, 2)}</span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <div className="wx-sticker-panel__error">{error}</div> : null}

      {loading ? (
        <div className="wx-sticker-panel__loading">
          <span className="wx-spinner" />
        </div>
      ) : active && active.stickers.length > 0 ? (
        <div className="wx-sticker-panel__grid">
          {active.stickers.map((sticker) => (
            <button
              key={sticker.fileId}
              className="wx-sticker-panel__item"
              onClick={() => void send(sticker)}
              title={sticker.emoji ?? '贴纸'}
            >
              <StickerRenderer media={stickerMedia(sticker)} size={64} preview />
            </button>
          ))}
        </div>
      ) : (
        <div className="wx-sticker-panel__empty">{error ? '' : '这个账号还没有安装贴纸包'}</div>
      )}
    </div>
  )
}

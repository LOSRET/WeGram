import type { StickerSet } from '@wegram/protocol'
import { useCallback, useEffect, useState, type MouseEvent } from 'react'

import { copyText } from '../lib/clipboard'
import { errorMessage, invoke } from '../lib/ipc'
import type { MentionTarget } from '../lib/mention'
import { mentionEntitiesOf } from '../lib/mentionText'
import { openMention } from '../lib/openMention'
import { anchorOf, type PopupAnchor } from '../lib/popupPlacement'
import { stickerMedia } from '../lib/stickerMedia'
import { stickerSetLink } from '../lib/stickerSetLink'
import { useAppStore } from '../store/useAppStore'
import { AnchoredPopup } from './ContextMenu'
import { ForwardDialog } from './ForwardDialog'
import { RichText } from './RichText'
import { StickerCanvasLayer } from './StickerCanvasLayer'
import { StickerRenderer } from './StickerRenderer'
import { MoreIcon } from './WechatIcons'

/**
 * A sticker set as its own box, the way Telegram Desktop shows one (design doc
 * §8.5): clicking a sticker in a message opens the box for the pack that sticker
 * belongs to. It carries the pack's title (its `@username` opens the author), a
 * ⋮ menu (分享表情包 / 复制链接 / 归档贴纸), every sticker in a five-column grid,
 * and 移除贴纸包 — or 添加贴纸包, when the reader clicked a sticker from a pack
 * this account has not installed.
 *
 * The set is fetched here rather than by the picker: a message only carries the
 * sticker's `set_id` (`MessageMedia.stickerSetId`), so opening the box is one
 * `stickers:set` round trip. Removing or archiving closes the box and emits
 * `evt:stickerSets`, which is what the 表情 panel's strip follows.
 */
export function StickerSetBox({ setId, onClose }: { setId: string; onClose: () => void }) {
  const chats = useAppStore((state) => state.chats)
  const [stickerSet, setStickerSet] = useState<StickerSet | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [menu, setMenu] = useState<PopupAnchor | null>(null)
  const [sharing, setSharing] = useState(false)
  const [busy, setBusy] = useState(false)
  /** ThorVG could not start: TGS cells fall back to their hover animation. */
  const [canvasFailed, setCanvasFailed] = useState(false)
  const onCanvasFailed = useCallback(() => setCanvasFailed(true), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setStickerSet(null)
    void (async () => {
      try {
        const result = await invoke('stickers:set', { setId })
        if (!cancelled) setStickerSet(result)
      } catch (cause) {
        if (!cancelled) setLoadError(errorMessage(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setId])

  // A box opened from the transcript is modal enough that Esc must close it, and
  // it must not fall through to the pane behind it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const toast = (text: string): void => {
    useAppStore.getState().setToast(text)
  }

  const installed = stickerSet !== null && stickerSet.isInstalled && !stickerSet.isArchived
  const link = stickerSetLink(stickerSet?.name)
  const hasTgs = stickerSet?.stickers.some((sticker) => sticker.format === 'tgs') ?? false
  const canvasOwner = `pack-${stickerSet?.id ?? ''}`.slice(0, 64)

  const openMenu = (event: MouseEvent<HTMLButtonElement>): void => {
    setMenu(anchorOf(event.currentTarget.getBoundingClientRect()))
  }

  /**
   * 移除 / 添加 / 归档 are one TDLib call with two flags (see `stickers:changeSet`).
   * Removing and archiving close the box — the pack is no longer the reader's —
   * while 添加 keeps it open so the reader sees the footer turn into 移除.
   */
  const change = async (
    delta: { installed: boolean; archived?: boolean },
    done: string,
    keepOpen: boolean,
  ): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await invoke('stickers:changeSet', { setId, ...delta })
      toast(done)
      setBusy(false)
      if (keepOpen) {
        setStickerSet((current) =>
          current
            ? { ...current, isInstalled: delta.installed, isArchived: delta.archived === true }
            : current,
        )
        return
      }
      onClose()
      return
    } catch (cause) {
      useAppStore.getState().setError(errorMessage(cause))
    }
    setBusy(false)
  }

  const copyLink = async (): Promise<void> => {
    if (!link) {
      toast('这个贴纸包没有分享链接')
      return
    }
    try {
      await copyText(link)
      toast('链接已复制')
    } catch (cause) {
      useAppStore.getState().setError(errorMessage(cause))
    }
  }

  const share = async (chatId: number): Promise<void> => {
    setSharing(false)
    if (!link) {
      toast('这个贴纸包没有分享链接')
      return
    }
    try {
      await invoke('messages:send', { chatId, text: link })
      toast('已分享表情包')
    } catch (cause) {
      useAppStore.getState().setError(errorMessage(cause))
    }
  }

  /** A pack title advertises its author; the box closes before the chat opens. */
  const openSetMention = (target: MentionTarget): void => {
    onClose()
    openMention(target)
  }

  return (
    <div
      className="wx-pack-layer"
      onPointerDown={(event) => {
        // Only a press on the empty layer closes the box: the share sheet renders
        // inside it, and its own backdrop must not take the pack away with it.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="wx-pack"
        role="dialog"
        aria-modal="true"
        aria-label={stickerSet ? `贴纸包 ${stickerSet.title}` : '贴纸包'}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="wx-pack__head">
          <div className="wx-pack__title">
            {stickerSet ? (
              <RichText
                text={stickerSet.title}
                entities={mentionEntitiesOf(stickerSet.title)}
                onMention={openSetMention}
              />
            ) : (
              '贴纸包'
            )}
          </div>
          {stickerSet ? (
            <button
              className="wx-pack__icon"
              onClick={openMenu}
              title="更多"
              aria-label="更多"
              disabled={busy}
            >
              <MoreIcon size={18} />
            </button>
          ) : null}
          <button
            className="wx-pack__icon wx-pack__icon--close"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="wx-pack__body">
          {loading ? (
            <div className="wx-pack__state">
              <span className="wx-spinner" />
            </div>
          ) : loadError ? (
            <div className="wx-pack__state wx-pack__state--error">{loadError}</div>
          ) : stickerSet ? (
            <div className="wx-pack__grid">
              {stickerSet.stickers.map((sticker, index) => (
                <div
                  key={sticker.fileId}
                  className="wx-pack__sticker"
                  data-sticker-index={index}
                  title={sticker.emoji ?? '贴纸'}
                >
                  <StickerRenderer
                    media={stickerMedia(sticker)}
                    size={72}
                    preview={sticker.format === 'tgs' && !canvasFailed}
                    playOnHover={sticker.format === 'tgs' && canvasFailed}
                  />
                </div>
              ))}
              {hasTgs ? (
                <StickerCanvasLayer
                  stickers={stickerSet.stickers}
                  owner={canvasOwner}
                  onFailed={onCanvasFailed}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {stickerSet ? (
          <div className="wx-pack__foot">
            <button
              className={installed ? 'wx-pack__remove' : 'wx-pack__add'}
              onClick={() => {
                void (installed
                  ? change({ installed: false }, '已移除贴纸包', false)
                  : change({ installed: true, archived: false }, '已添加贴纸包', true))
              }}
              disabled={busy}
            >
              {installed ? '移除贴纸包' : '添加贴纸包'}
              <span className="wx-pack__count">{stickerSet.stickers.length}</span>
            </button>
          </div>
        ) : null}
      </div>

      {menu ? (
        <AnchoredPopup
          anchor={menu}
          placement={{ side: 'below', align: 'right' }}
          onClose={() => setMenu(null)}
        >
          <button
            className="wx-context-menu__item"
            onClick={() => {
              setMenu(null)
              setSharing(true)
            }}
          >
            分享表情包
          </button>
          <button
            className="wx-context-menu__item"
            onClick={() => {
              setMenu(null)
              void copyLink()
            }}
          >
            复制链接
          </button>
          {installed ? (
            <button
              className="wx-context-menu__item"
              onClick={() => {
                setMenu(null)
                void change({ installed: true, archived: true }, '已归档贴纸包', false)
              }}
            >
              归档贴纸
            </button>
          ) : null}
        </AnchoredPopup>
      ) : null}

      {sharing ? (
        <ForwardDialog
          title="分享表情包"
          chats={chats}
          onForward={(chatId) => {
            void share(chatId)
          }}
          onClose={() => setSharing(false)}
        />
      ) : null}
    </div>
  )
}

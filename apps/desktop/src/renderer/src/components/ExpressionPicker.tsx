import type { Message, Sticker, StickerSet, StickerSetSummary } from '@wegram/protocol'
import { useEffect, useMemo, useRef, useState } from 'react'

import { loadLatestWindow } from '../lib/anchoredWindow'
import { EMOJI, RECENT_EMOJI_LIMIT, mergeRecentEmoji, searchEmoji } from '../lib/emoji'
import type { EmojiItem } from '../lib/emoji'
import { errorMessage, invoke } from '../lib/ipc'
import { tabPaging } from '../lib/pickerTabs'
import { useAppStore } from '../store/useAppStore'
import { StickerRenderer } from './StickerRenderer'
import { ChevronDownIcon, EmojiIcon, SearchIcon } from './WechatIcons'

interface ExpressionPickerProps {
  chatId: number
  /** Which tab the toggle opened the panel on (表情 or 贴纸). */
  mode: 'emoji' | 'stickers'
  /** Inserts a picked emoji into the composer at the caret. */
  onPickEmoji: (emoji: string) => void
  onSent: (message: Message) => void
  onClose: () => void
}

type PickerTab =
  { kind: 'emoji' } | { kind: 'search' } | { kind: 'set'; id: string } | { kind: 'empty' }

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
 * The composer's expression picker (design doc §9.3), rebuilt against the client's
 * own 表情 panel: a 464×464 card floating above the input, 最近使用 over a 10-column
 * 所有表情 grid, and the tab strip (搜索 / 表情 / installed sets / 下一页) pinned to
 * the bottom. Emoji are inserted into the draft; a sticker is sent on click.
 *
 * Sticker sets are fetched for the tab strip only; a set's stickers are fetched
 * when its tab is opened (and cached for the life of the panel), so opening the
 * picker never downloads every sticker in the account.
 */
export function ExpressionPicker({
  chatId,
  mode,
  onPickEmoji,
  onSent,
  onClose,
}: ExpressionPickerProps) {
  const [sets, setSets] = useState<StickerSetSummary[]>([])
  const [setsLoaded, setSetsLoaded] = useState(false)
  const [setsError, setSetsError] = useState<string | null>(null)
  const [tab, setTab] = useState<PickerTab>(() =>
    mode === 'emoji' ? { kind: 'emoji' } : { kind: 'empty' },
  )
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const [activeSet, setActiveSet] = useState<StickerSet | null>(null)
  const [setLoading, setSetLoading] = useState(false)
  const [setError, setSetError] = useState<string | null>(null)

  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const recentRef = useRef<string[]>([])
  const setCache = useRef(new Map<string, StickerSet>())
  const autoOpened = useRef(false)

  // Installed sets feed the tab strip; the emoji tab works without them.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await invoke('stickers:sets')
        if (!cancelled) setSets(result)
      } catch (cause) {
        if (!cancelled) setSetsError(errorMessage(cause))
      } finally {
        if (!cancelled) setSetsLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // The 贴纸 toolbar button opens the first installed set once the list arrives;
  // switching to 表情 afterwards must not be undone by this effect.
  useEffect(() => {
    if (mode !== 'stickers' || autoOpened.current || !setsLoaded) return
    autoOpened.current = true
    // Only the placeholder gives way: a reader who already clicked 表情 keeps it.
    if (tab.kind !== 'empty') return
    const first = sets[0]
    setTab(first ? { kind: 'set', id: first.id } : { kind: 'empty' })
  }, [mode, sets, setsLoaded, tab.kind])

  const activeSetId = tab.kind === 'set' ? tab.id : null
  useEffect(() => {
    if (!activeSetId) return
    const cached = setCache.current.get(activeSetId)
    if (cached) {
      setActiveSet(cached)
      setSetLoading(false)
      setSetError(null)
      return
    }
    let cancelled = false
    setSetLoading(true)
    setSetError(null)
    setActiveSet(null)
    void (async () => {
      try {
        const set = await invoke('stickers:set', { setId: activeSetId })
        if (cancelled) return
        setCache.current.set(set.id, set)
        setActiveSet(set)
      } catch (cause) {
        if (!cancelled) setSetError(errorMessage(cause))
      } finally {
        if (!cancelled) setSetLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeSetId])

  // The 最近使用 row lives in ui.db, so it survives a restart like the client's.
  useEffect(() => {
    let cancelled = false
    void invoke('ui:getRecentEmoji')
      .then((list) => {
        if (cancelled) return
        const valid = list.filter((item) => item.length > 0).slice(0, RECENT_EMOJI_LIMIT)
        recentRef.current = valid
        setRecent(valid)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // Each tab starts at the top, as in the client.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [tab])

  /**
   * The picker closes like a popover: Esc, or a click outside both the card and
   * the composer. Clicks inside the composer belong to the text field and the
   * two toggles, which own their open/closed state.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('.wx-composer')) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onClose])

  const remember = (char: string): void => {
    const next = mergeRecentEmoji(recentRef.current, char)
    recentRef.current = next
    setRecent(next)
    void invoke('ui:saveRecentEmoji', { emoji: next }).catch(() => undefined)
  }

  const pickEmoji = (char: string): void => {
    onPickEmoji(char)
    remember(char)
  }

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
      setSetError(errorMessage(cause))
    }
  }

  const { paged, pageSize, pageCount } = tabPaging(sets.length)
  const visibleSets = paged ? sets.slice(page * pageSize, page * pageSize + pageSize) : sets

  const openSet = (setId: string): void => {
    const index = sets.findIndex((set) => set.id === setId)
    if (index >= 0) setPage(Math.floor(index / pageSize))
    setTab({ kind: 'set', id: setId })
    setQuery('')
  }

  const needle = query.trim()
  const hits = useMemo<{ emoji: EmojiItem[]; sets: StickerSetSummary[] }>(() => {
    if (!needle) return { emoji: [], sets: [] }
    const lower = needle.toLowerCase()
    return {
      emoji: searchEmoji(needle),
      sets: sets.filter((set) => set.title.toLowerCase().includes(lower)),
    }
  }, [needle, sets])

  const emojiButton = (char: string, label: string) => (
    <button
      key={char}
      className="wx-picker__emoji"
      onClick={() => pickEmoji(char)}
      title={label}
      aria-label={label}
    >
      {char}
    </button>
  )

  return (
    <div className="wx-picker" role="dialog" aria-label="表情与贴纸" ref={panelRef}>
      <div className="wx-picker__body" ref={bodyRef}>
        {tab.kind === 'emoji' ? (
          <>
            {recent.length > 0 ? (
              <>
                <div className="wx-picker__label">最近使用</div>
                <div className="wx-picker__grid">
                  {recent.map((char) => emojiButton(char, char))}
                </div>
              </>
            ) : null}
            <div className="wx-picker__label">所有表情</div>
            <div className="wx-picker__grid">
              {EMOJI.map((item) => emojiButton(item.char, item.name))}
            </div>
          </>
        ) : tab.kind === 'search' ? (
          <div className="wx-picker__search">
            <div className="wx-search">
              <SearchIcon size={14} />
              <input
                autoFocus
                value={query}
                placeholder="搜索表情"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {needle ? (
              hits.emoji.length > 0 || hits.sets.length > 0 ? (
                <>
                  {hits.sets.length > 0 ? (
                    <>
                      <div className="wx-picker__label">表情包</div>
                      <div className="wx-picker__set-hits">
                        {hits.sets.map((set) => (
                          <button
                            key={set.id}
                            className="wx-picker__set-hit"
                            onClick={() => openSet(set.id)}
                          >
                            <span className="wx-picker__set-hit-art">
                              {set.thumbnail ? (
                                <StickerRenderer
                                  media={stickerMedia(set.thumbnail)}
                                  size={36}
                                  preview
                                />
                              ) : (
                                set.title.slice(0, 2)
                              )}
                            </span>
                            <span className="wx-picker__set-hit-title">{set.title}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                  {hits.emoji.length > 0 ? (
                    <>
                      <div className="wx-picker__label">表情</div>
                      <div className="wx-picker__grid">
                        {hits.emoji.map((item) => emojiButton(item.char, item.name))}
                      </div>
                    </>
                  ) : null}
                </>
              ) : (
                <p className="wx-picker__hint">没有找到相关表情</p>
              )
            ) : (
              <p className="wx-picker__hint">
                输入表情名称搜索，例如“开心”“爱心”“红包”。表情包按名称搜索。
              </p>
            )}
          </div>
        ) : tab.kind === 'set' ? (
          setLoading ? (
            <div className="wx-picker__state">
              <span className="wx-spinner" />
            </div>
          ) : (
            <>
              {setError ? <div className="wx-picker__error">{setError}</div> : null}
              {activeSet && activeSet.stickers.length > 0 ? (
                <div className="wx-picker__stickers">
                  {activeSet.stickers.map((sticker) => (
                    <button
                      key={sticker.fileId}
                      className="wx-picker__sticker"
                      onClick={() => void send(sticker)}
                      title={sticker.emoji ?? '贴纸'}
                    >
                      <StickerRenderer media={stickerMedia(sticker)} size={92} preview />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="wx-picker__state">{setError ? '' : '这个贴纸包还是空的'}</div>
              )}
            </>
          )
        ) : !setsLoaded ? (
          <div className="wx-picker__state">
            <span className="wx-spinner" />
          </div>
        ) : (
          <div className="wx-picker__state">{setsError ?? '这个账号还没有安装贴纸包'}</div>
        )}
      </div>

      <div className="wx-picker__tabs">
        <button
          className={`wx-picker__tab${tab.kind === 'search' ? ' wx-picker__tab--active' : ''}`}
          onClick={() => setTab({ kind: 'search' })}
          title="搜索表情"
          aria-label="搜索表情"
        >
          <SearchIcon size={20} />
        </button>
        <button
          className={`wx-picker__tab${tab.kind === 'emoji' ? ' wx-picker__tab--active' : ''}`}
          onClick={() => setTab({ kind: 'emoji' })}
          title="表情"
          aria-label="表情"
        >
          <EmojiIcon size={22} />
        </button>
        {visibleSets.map((set) => (
          <button
            key={set.id}
            className={`wx-picker__tab wx-picker__tab--set${
              tab.kind === 'set' && tab.id === set.id ? ' wx-picker__tab--active' : ''
            }`}
            onClick={() => setTab({ kind: 'set', id: set.id })}
            title={set.title}
            aria-label={set.title}
          >
            {set.thumbnail ? (
              <StickerRenderer media={stickerMedia(set.thumbnail)} size={28} preview />
            ) : (
              <span className="wx-picker__tab-text">{set.title.slice(0, 2)}</span>
            )}
          </button>
        ))}
        {paged ? (
          <button
            className="wx-picker__tab"
            onClick={() => setPage((current) => (current + 1) % pageCount)}
            title="下一页"
            aria-label="下一页"
          >
            <ChevronDownIcon size={10} className="wx-picker__next" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

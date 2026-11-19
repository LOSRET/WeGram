import type { Message, Sticker, StickerSet, StickerSetSummary } from '@wegram/protocol'
import { useEffect, useMemo, useRef, useState } from 'react'

import { loadLatestWindow } from '../lib/anchoredWindow'
import { EMOJI, RECENT_EMOJI_LIMIT, mergeRecentEmoji, searchEmoji } from '../lib/emoji'
import type { EmojiItem } from '../lib/emoji'
import { errorMessage, invoke } from '../lib/ipc'
import { pageForIndex, stripWindow } from '../lib/pickerTabs'
import { stickerMedia } from '../lib/stickerMedia'
import { useAppStore } from '../store/useAppStore'
import { StickerRenderer } from './StickerRenderer'
import { ChevronDownIcon, EmojiIcon, MicIcon, SearchIcon } from './WechatIcons'

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

  const stickerSetsVersion = useAppStore((state) => state.stickerSetsVersion)
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const recentRef = useRef<string[]>([])
  const setCache = useRef(new Map<string, StickerSet>())
  const autoOpened = useRef(false)

  /**
   * Installed sets feed the tab strip; the emoji tab works without them.
   *
   * The first answer can be TDLib's pre-sync local cache (a dozen sets instead
   * of the account's full list), so this also refetches when
   * `updateInstalledStickerSets` lands — see `evt:stickerSets`.
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await invoke('stickers:sets')
        if (!cancelled) {
          setSets(result)
          setSetsError(null)
        }
      } catch (cause) {
        if (!cancelled) setSetsError(errorMessage(cause))
      } finally {
        if (!cancelled) setSetsLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [stickerSetsVersion])

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
  // The tab strip is wider than the pack name, so the body repeats it as a label —
  // available from the summary before the set itself has landed.
  const activeSetTitle =
    activeSet?.title ?? sets.find((item) => item.id === activeSetId)?.title ?? ''
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

  // The strip pages the whole row, 搜索 and 表情 included: at the far right the
  // client's 上一页 arrow sits where the first tabs used to be, as the user's
  // reference screenshot shows.
  const stripItems = [
    { key: 'search', kind: 'search' as const },
    { key: 'emoji', kind: 'emoji' as const },
    ...sets.map((set) => ({ key: `set:${set.id}`, kind: 'set' as const, set })),
  ]
  const strip = stripWindow(stripItems.length, page)
  const visibleTabs = stripItems.slice(strip.start, strip.start + strip.count)

  const openSet = (setId: string): void => {
    const index = stripItems.findIndex((item) => item.kind === 'set' && item.set.id === setId)
    if (index >= 0) setPage(pageForIndex(stripItems.length, index))
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
              <SearchIcon size={15} />
              <input
                autoFocus
                value={query}
                placeholder="搜索表情"
                onChange={(event) => setQuery(event.target.value)}
              />
              {/* The client's box grows a voice button while it has focus. There is
                  no speech recognition behind it, so it stays disabled instead of
                  being a dead control. */}
              <button
                type="button"
                className="wx-search__mic"
                disabled
                title="语音搜索暂不支持"
                aria-label="语音搜索暂不支持"
              >
                <MicIcon size={17} />
              </button>
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
            ) : null}
          </div>
        ) : tab.kind === 'set' ? (
          <>
            {activeSetTitle ? (
              <div className="wx-picker__label wx-picker__label--set">{activeSetTitle}</div>
            ) : null}
            {setLoading ? (
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
                        <StickerRenderer media={stickerMedia(sticker)} size={92} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="wx-picker__state">{setError ? '' : '这个贴纸包还是空的'}</div>
                )}
              </>
            )}
          </>
        ) : !setsLoaded ? (
          <div className="wx-picker__state">
            <span className="wx-spinner" />
          </div>
        ) : (
          <div className="wx-picker__state">{setsError ?? '这个账号还没有安装贴纸包'}</div>
        )}
      </div>

      <div className="wx-picker__tabs">
        {strip.hasLeft ? (
          <button
            className="wx-picker__tab"
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            title="上一页"
            aria-label="上一页"
          >
            <ChevronDownIcon size={10} className="wx-picker__prev" />
          </button>
        ) : null}
        {visibleTabs.map((item) =>
          item.kind === 'search' ? (
            <button
              key={item.key}
              className={`wx-picker__tab${tab.kind === 'search' ? ' wx-picker__tab--active' : ''}`}
              onClick={() => setTab({ kind: 'search' })}
              title="搜索表情"
              aria-label="搜索表情"
            >
              <SearchIcon size={20} />
            </button>
          ) : item.kind === 'emoji' ? (
            <button
              key={item.key}
              className={`wx-picker__tab${tab.kind === 'emoji' ? ' wx-picker__tab--active' : ''}`}
              onClick={() => setTab({ kind: 'emoji' })}
              title="表情"
              aria-label="表情"
            >
              <EmojiIcon size={22} />
            </button>
          ) : (
            <button
              key={item.key}
              className={`wx-picker__tab wx-picker__tab--set${
                tab.kind === 'set' && tab.id === item.set.id ? ' wx-picker__tab--active' : ''
              }`}
              onClick={() => setTab({ kind: 'set', id: item.set.id })}
              title={item.set.title}
              aria-label={item.set.title}
            >
              {item.set.thumbnail ? (
                <StickerRenderer media={stickerMedia(item.set.thumbnail)} size={28} preview />
              ) : (
                <span className="wx-picker__tab-text">{item.set.title.slice(0, 2)}</span>
              )}
            </button>
          ),
        )}
        {strip.hasRight ? (
          <button
            className="wx-picker__tab"
            onClick={() => setPage((current) => Math.min(current + 1, strip.pageCount - 1))}
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

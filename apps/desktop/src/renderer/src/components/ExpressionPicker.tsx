import type { Sticker } from '@wegram/protocol'
import { useEffect, useMemo, useRef, useState } from 'react'

import { loadLatestWindow } from '../lib/anchoredWindow'
import { searchEmoji } from '../lib/emoji'
import { errorMessage, invoke } from '../lib/ipc'
import { pageForIndex } from '../lib/pickerTabs'
import { containsText, normalizeQuery } from '../lib/search'
import { useAppStore } from '../store/useAppStore'
import { EmojiBody } from './picker/EmojiBody'
import { PickerTabs } from './picker/PickerTabs'
import { SearchBody } from './picker/SearchBody'
import { StickerBody } from './picker/StickerBody'
import type { ExpressionPickerProps, PickerStripItem, PickerTab } from './picker/types'
import { useActiveStickerSet } from './picker/useActiveStickerSet'
import { usePickerDismiss } from './picker/usePickerDismiss'
import { useRecentEmoji } from './picker/useRecentEmoji'
import { useStickerSets } from './picker/useStickerSets'

/**
 * The composer's expression picker (design doc §9.3), rebuilt against the client's
 * own 表情 panel: a 464×464 card floating above the input, 最近使用 over a 10-column
 * 所有表情 grid, and the tab strip (搜索 / 表情 / installed sets / 下一页) pinned to
 * the bottom. Emoji are inserted into the draft; a sticker from a set tab is sent
 * on click.
 *
 * The panel always opens on 表情. The set tabs in the strip are the only way to
 * stickers: the composer's cube is 收藏, not a second expression entry.
 *
 * Sticker sets are fetched for the tab strip only; a set's stickers are fetched
 * when its tab is opened (and cached for the life of the panel), so opening the
 * picker never downloads every sticker in the account.
 *
 * This file owns the tab state and the composition; each concern has its own
 * module under `picker/`.
 */
export function ExpressionPicker({ chatId, onPickEmoji, onSent, onClose }: ExpressionPickerProps) {
  const { sets } = useStickerSets()
  const [tab, setTab] = useState<PickerTab>({ kind: 'emoji' })
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const { recent, remember } = useRecentEmoji()

  const panelRef = usePickerDismiss(onClose)
  const bodyRef = useRef<HTMLDivElement>(null)

  const activeSetId = tab.kind === 'set' ? tab.id : null
  const { activeSet, setLoading, setError, reportError } = useActiveStickerSet(activeSetId)
  // The tab strip is wider than the pack name, so the body repeats it as a label —
  // available from the summary before the set itself has landed.
  const activeSetTitle =
    activeSet?.title ?? sets.find((item) => item.id === activeSetId)?.title ?? ''

  // Each tab starts at the top, as in the client.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [tab])

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
      reportError(errorMessage(cause))
    }
  }

  const stripItems: PickerStripItem[] = [
    { key: 'search', kind: 'search' },
    { key: 'emoji', kind: 'emoji' },
    ...sets.map((set) => ({ key: `set:${set.id}`, kind: 'set' as const, set })),
  ]

  const openSet = (setId: string): void => {
    const index = stripItems.findIndex((item) => item.kind === 'set' && item.set.id === setId)
    if (index >= 0) setPage(pageForIndex(stripItems.length, index))
    setTab({ kind: 'set', id: setId })
    setQuery('')
  }

  const needle = normalizeQuery(query)
  const hits = useMemo(() => {
    if (!needle) return { emoji: [], sets: [] }
    return {
      emoji: searchEmoji(needle),
      sets: sets.filter((set) => containsText(set.title, needle)),
    }
  }, [needle, sets])

  return (
    <div className="wx-picker" role="dialog" aria-label="表情与贴纸" ref={panelRef}>
      <div className="wx-picker__body" ref={bodyRef}>
        {tab.kind === 'emoji' ? (
          <EmojiBody recent={recent} onPick={pickEmoji} />
        ) : tab.kind === 'search' ? (
          <SearchBody
            query={query}
            onQueryChange={setQuery}
            hits={hits}
            onPick={pickEmoji}
            onOpenSet={openSet}
          />
        ) : (
          <StickerBody
            title={activeSetTitle}
            loading={setLoading}
            error={setError}
            set={activeSet}
            onSend={(sticker) => void send(sticker)}
          />
        )}
      </div>

      <PickerTabs tab={tab} items={stripItems} page={page} onPage={setPage} onSelect={setTab} />
    </div>
  )
}

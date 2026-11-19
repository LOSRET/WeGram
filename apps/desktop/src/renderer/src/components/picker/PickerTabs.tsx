import { stripWindow } from '../../lib/pickerTabs'
import { stickerMedia } from '../../lib/stickerMedia'
import { StickerRenderer } from '../StickerRenderer'
import { ChevronDownIcon, EmojiIcon, SearchIcon } from '../WechatIcons'
import type { PickerStripItem, PickerTab } from './types'

/**
 * The bottom tab strip: 搜索, 表情, every installed set, and the two arrows.
 *
 * The strip pages the whole row, 搜索 and 表情 included: at the far right the
 * client's 上一页 arrow sits where the first tabs used to be, as the user's
 * reference screenshot shows.
 */
export function PickerTabs({
  tab,
  items,
  page,
  onPage,
  onSelect,
}: {
  tab: PickerTab
  items: readonly PickerStripItem[]
  page: number
  onPage: (next: number) => void
  onSelect: (tab: PickerTab) => void
}) {
  const strip = stripWindow(items.length, page)
  const visible = items.slice(strip.start, strip.start + strip.count)

  return (
    <div className="wx-picker__tabs">
      {strip.hasLeft ? (
        <button
          className="wx-picker__tab"
          onClick={() => onPage(Math.max(0, page - 1))}
          title="上一页"
          aria-label="上一页"
        >
          <ChevronDownIcon size={10} className="wx-picker__prev" />
        </button>
      ) : null}
      {visible.map((item) =>
        item.kind === 'search' ? (
          <button
            key={item.key}
            className={`wx-picker__tab${tab.kind === 'search' ? ' wx-picker__tab--active' : ''}`}
            onClick={() => onSelect({ kind: 'search' })}
            title="搜索表情"
            aria-label="搜索表情"
          >
            <SearchIcon size={20} />
          </button>
        ) : item.kind === 'emoji' ? (
          <button
            key={item.key}
            className={`wx-picker__tab${tab.kind === 'emoji' ? ' wx-picker__tab--active' : ''}`}
            onClick={() => onSelect({ kind: 'emoji' })}
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
            onClick={() => onSelect({ kind: 'set', id: item.set.id })}
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
          onClick={() => onPage(Math.min(page + 1, strip.pageCount - 1))}
          title="下一页"
          aria-label="下一页"
        >
          <ChevronDownIcon size={10} className="wx-picker__next" />
        </button>
      ) : null}
    </div>
  )
}

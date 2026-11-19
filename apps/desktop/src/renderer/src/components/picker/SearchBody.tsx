import type { StickerSetSummary } from '@wegram/protocol'

import type { EmojiItem } from '../../lib/emoji'
import { stickerMedia } from '../../lib/stickerMedia'
import { StickerRenderer } from '../StickerRenderer'
import { SearchField } from '../SearchField'
import { MicIcon } from '../WechatIcons'
import { EmojiGrid } from './EmojiGrid'

/**
 * The 搜索 tab: one box over both the emoji table and the installed set names.
 */
export function SearchBody({
  query,
  onQueryChange,
  hits,
  onPick,
  onOpenSet,
}: {
  query: string
  onQueryChange: (next: string) => void
  hits: { emoji: EmojiItem[]; sets: StickerSetSummary[] }
  onPick: (char: string) => void
  onOpenSet: (setId: string) => void
}) {
  const needle = query.trim()
  return (
    <div className="wx-picker__search">
      <SearchField
        value={query}
        onValueChange={onQueryChange}
        placeholder="搜索表情"
        autoFocus
        trailing={
          // The client's box grows a voice button while it has focus. There is
          // no speech recognition behind it, so it stays disabled instead of
          // being a dead control.
          <button
            type="button"
            className="wx-search__mic"
            disabled
            title="语音搜索暂不支持"
            aria-label="语音搜索暂不支持"
          >
            <MicIcon size={17} />
          </button>
        }
      />
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
                      onClick={() => onOpenSet(set.id)}
                    >
                      <span className="wx-picker__set-hit-art">
                        {set.thumbnail ? (
                          <StickerRenderer media={stickerMedia(set.thumbnail)} size={36} preview />
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
                <EmojiGrid
                  entries={hits.emoji.map((item) => ({ char: item.char, label: item.name }))}
                  onPick={onPick}
                />
              </>
            ) : null}
          </>
        ) : (
          <p className="wx-picker__hint">没有找到相关表情</p>
        )
      ) : null}
    </div>
  )
}

import type { InlineResult, MessageMedia } from '@wegram/protocol'
import { useMemo } from 'react'

import { useMediaUrl } from '../lib/media'

interface InlineResultsProps {
  /** The handle the reader typed, drawn in the panel's head. */
  username: string
  results: InlineResult[]
  loading: boolean
  failed: boolean
  /** The row the arrows are on. */
  activeIndex: number
  hasMore: boolean
  onHover: (index: number) => void
  onPick: (result: InlineResult) => void
  onLoadMore: () => void
}

/**
 * inline 机器人's results (§8.3), floating above the input the way the "/" list
 * does: one row per result — thumbnail, title, the bot's description, the kind.
 *
 * Rows are divs with a mousedown handler, not buttons: the textarea keeps the
 * keyboard, exactly like the command list. A result without a thumbnail is still
 * a row, and a failed ask is said in place instead of raising the error bar.
 */
export function InlineResults({
  username,
  results,
  loading,
  failed,
  activeIndex,
  hasMore,
  onHover,
  onPick,
  onLoadMore,
}: InlineResultsProps) {
  return (
    <div className="wx-inline-results" role="listbox" aria-label={'@' + username + ' 的结果'}>
      <div className="wx-inline-results__head">@{username}</div>
      {results.map((result, index) => (
        <InlineResultRow
          key={result.id + '-' + index}
          result={result}
          active={index === activeIndex}
          onEnter={() => onHover(index)}
          onPick={() => onPick(result)}
        />
      ))}
      {loading ? <div className="wx-inline-results__hint">正在询问机器人…</div> : null}
      {!loading && failed ? <div className="wx-inline-results__hint">机器人没有回答</div> : null}
      {!loading && !failed && results.length === 0 ? (
        <div className="wx-inline-results__hint">没有结果</div>
      ) : null}
      {hasMore && !loading ? (
        <button
          type="button"
          className="wx-inline-results__more"
          // mousedown, not click: the caret must stay in the box.
          onMouseDown={(event) => {
            event.preventDefault()
            onLoadMore()
          }}
        >
          加载更多
        </button>
      ) : null}
    </div>
  )
}

function InlineResultRow({
  result,
  active,
  onEnter,
  onPick,
}: {
  result: InlineResult
  active: boolean
  onEnter: () => void
  onPick: () => void
}) {
  // A fresh { fileId } per render would re-run the hook's effect; one thumbnail
  // therefore keeps one stable media object.
  const media = useMemo<MessageMedia | undefined>(
    () => (result.thumbFileId ? { fileId: result.thumbFileId } : undefined),
    [result.thumbFileId],
  )
  const thumbUrl = useMediaUrl(media, 6, media !== undefined)
  return (
    <div
      role="option"
      aria-selected={active}
      className={'wx-inline-result' + (active ? ' wx-inline-result--active' : '')}
      onMouseEnter={onEnter}
      onMouseDown={(event) => {
        event.preventDefault()
        onPick()
      }}
    >
      <span className="wx-inline-result__thumb">
        {thumbUrl ? (
          <img className="wx-inline-result__image" src={thumbUrl} alt="" draggable={false} />
        ) : (
          <span className="wx-inline-result__kind">{result.kind}</span>
        )}
      </span>
      <span className="wx-inline-result__body">
        <span className="wx-inline-result__title">{result.title}</span>
        {result.description ? (
          <span className="wx-inline-result__desc">{result.description}</span>
        ) : null}
      </span>
    </div>
  )
}

import { EMOJI } from '../../lib/emoji'
import { EmojiGrid } from './EmojiGrid'

/**
 * The 表情 tab: the persisted 最近使用 row over the client's 所有表情 grid.
 */
export function EmojiBody({
  recent,
  onPick,
}: {
  recent: string[]
  onPick: (char: string) => void
}) {
  return (
    <>
      {recent.length > 0 ? (
        <>
          <div className="wx-picker__label">最近使用</div>
          <EmojiGrid entries={recent.map((char) => ({ char, label: char }))} onPick={onPick} />
        </>
      ) : null}
      <div className="wx-picker__label">所有表情</div>
      <EmojiGrid entries={EMOJI.map((item) => ({ char: item.char, label: item.name }))} onPick={onPick} />
    </>
  )
}

/** One grid of emoji buttons: the 最近使用 row and 所有表情 share it. */
export function EmojiGrid({
  entries,
  onPick,
}: {
  entries: readonly { char: string; label: string }[]
  onPick: (char: string) => void
}) {
  return (
    <div className="wx-picker__grid">
      {entries.map(({ char, label }) => (
        <button
          key={char}
          className="wx-picker__emoji"
          onClick={() => onPick(char)}
          title={label}
          aria-label={label}
        >
          {char}
        </button>
      ))}
    </div>
  )
}

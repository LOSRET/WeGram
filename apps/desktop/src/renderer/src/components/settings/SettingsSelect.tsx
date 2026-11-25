interface Option<T extends string> {
  value: T
  label: string
}

interface SettingsSelectProps<T extends string> {
  /** Accessible name; the row's label is the visible one. */
  label: string
  value: T
  options: readonly Option<T>[]
  onChange: (next: T) => void
  /** Holds the control while a write it belongs to is in flight. */
  disabled?: boolean
}

/**
 * The client's pill select: 28 px high, 12 px label, and a green badge on the
 * right. A native <select> underneath keeps the keyboard and OS dropdown, which is
 * what a settings window needs; only the closed state is custom (design doc §9.11.2).
 */
export function SettingsSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: SettingsSelectProps<T>) {
  return (
    <span className="wx-set-select">
      <select
        aria-label={label}
        className="wx-set-select__input"
        disabled={disabled}
        value={value}
        onChange={(event) => {
          // Only a value that came from this control may be written back: the
          // element's value is a string, the row's type is the option union.
          const next = options.find((option) => option.value === event.target.value)
          if (next) onChange(next.value)
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="wx-set-select__badge" aria-hidden="true">
        ✓
      </span>
    </span>
  )
}

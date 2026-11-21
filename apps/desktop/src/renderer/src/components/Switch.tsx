interface SwitchProps {
  checked: boolean
  /** The row's label, used as the control's accessible name. */
  label: string
  disabled?: boolean
  /** Called with the state the reader asked for, not the current one. */
  onChange: (next: boolean) => void
}

/**
 * WeChat's toggle: a 36 × 20 pill with a 16 px knob. Measured off the client —
 * the off track is `--wx-switch-off`, the on track `--wx-switch-on` (#00C375, the
 * same green as the login window, not the brand green), and the knob is white in
 * both states.
 */
export function Switch({ checked, label, disabled = false, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`wx-switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="wx-switch__knob" />
    </button>
  )
}

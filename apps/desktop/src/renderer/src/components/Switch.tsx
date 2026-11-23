import { useState } from 'react'

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
 *
 * The 150 ms slide is for the reader's click only. A panel that paints a switch
 * before its read has landed (消息通知's 桌面通知, 网络与代理's 使用系统代理) used to
 * mount it off and flip it on a frame later, and the transition turned that into
 * an animation nobody asked for — measured as "the switch flips by itself when
 * the page opens". The first paint, and every value that arrives without a
 * click, therefore carry `is-static`, which the stylesheet keeps transition-free.
 */
export function Switch({ checked, label, disabled = false, onChange }: SwitchProps) {
  // Only a click may animate: a read landing, or an optimistic write being
  // reverted, changes the switch in place.
  const [clicked, setClicked] = useState(false)

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`wx-switch${checked ? ' is-on' : ''}${clicked ? '' : ' is-static'}`}
      onClick={() => {
        setClicked(true)
        onChange(!checked)
      }}
    >
      <span className="wx-switch__knob" />
    </button>
  )
}

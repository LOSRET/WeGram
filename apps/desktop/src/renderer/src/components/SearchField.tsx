import type { ReactNode } from 'react'

import { SearchIcon } from './Icon'

export interface SearchFieldProps {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  /** Extra class on the box, e.g. the contacts column's own width. */
  className?: string
  autoFocus?: boolean
  /** Rendered after the input (the picker's voice button). */
  trailing?: ReactNode
  /**
   * Swallow pointer-down so a click inside the box does not dismiss an enclosing
   * popover. The chat list sits under the "+" menu and needs it; the picker owns
   * its own dismiss handler and does not.
   */
  guardPointer?: boolean
}

/**
 * WeChat's search pill: magnifier, input, optional trailing control.
 *
 * A `label` on purpose — clicking the 8 px padding focuses the field, like the
 * client. `.wx-search` is the measured contract (see styles/chat-list.css), so
 * the component adds the class and callers only append their own.
 */
export function SearchField({
  value,
  onValueChange,
  placeholder = '搜索',
  className,
  autoFocus = false,
  trailing,
  guardPointer = false,
}: SearchFieldProps) {
  return (
    <label className={`wx-search${className ? ` ${className}` : ''}`}>
      <SearchIcon size={15} />
      <input
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoFocus={autoFocus}
        onChange={(event) => onValueChange(event.target.value)}
        onPointerDown={guardPointer ? (event) => event.stopPropagation() : undefined}
      />
      {trailing}
    </label>
  )
}

/**
 * Tells `@tanstack/react-virtual` that the element moved.
 *
 * The virtualizer positions rows from its own `scrollOffset`, which it refreshes
 * on real scroll events only. A programmatic `scrollTop` write (landing at the
 * bottom, restoring an anchor, prepend compensation) can therefore leave it
 * painting a different slice than the one on screen: the transcript looks blank,
 * or stuck on much older messages, with an empty tail under the scrollbar — while
 * `scrollTop` still reports "at the bottom". One dispatched scroll event is all it
 * needs to re-read the element.
 *
 * Call this after ANY write to `scrollTop` that the reader did not perform.
 * (Measured: 13 rows at y −4842…−2708 before, the real 2025↔today window at
 * y −1098…+394 after. See docs/HANDOFF.md §6.2.)
 */
export function resyncScroller(element: HTMLElement | null): void {
  element?.dispatchEvent(new Event('scroll'))
}

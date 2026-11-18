/**
 * The rendered slot for a row key. The virtualiser only paints a window, so the
 * node may legitimately be absent; callers treat null as "not rendered yet".
 */
export function findRowElement(scroller: HTMLElement, key: string): HTMLElement | null {
  for (const node of scroller.querySelectorAll<HTMLElement>('.wx-message-slot')) {
    if (node.dataset['rowKey'] === key) return node
  }
  return null
}

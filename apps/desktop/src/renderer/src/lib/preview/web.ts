import type { InstantViewWindowState } from '@wegram/protocol'

/**
 * `web:state` in the browser preview.
 *
 * The preview cannot open a second native window, so `web:open` opens the reader
 * route in a popup whose hash carries the target; this reads it back. Electron's
 * main hands the same three values over from its own in-memory target.
 */
export function previewInstantViewState(): InstantViewWindowState {
  const query = window.location.hash.split('?')[1] ?? ''
  const params = new URLSearchParams(query)
  const title = params.get('title') ?? undefined
  const siteName = params.get('siteName') ?? undefined
  const theme = document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light'
  return {
    url: params.get('url') ?? '',
    ...(title ? { title } : {}),
    ...(siteName ? { siteName } : {}),
    theme,
  }
}

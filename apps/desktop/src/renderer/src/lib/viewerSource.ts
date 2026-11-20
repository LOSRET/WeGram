import type { Message } from '@wegram/protocol'
import { createContext, useContext } from 'react'

/**
 * The messages of the pane a media bubble sits in (design doc §9.5).
 *
 * The viewer pages through the media of *the pane the reader clicked in* — its
 * transcript — so `lib/viewer` normally reads `messagesByChat`. That is right for
 * the open chat and wrong for a row drawn by a pane that keeps its own list: a
 * channel post's comments are messages of the *discussion group*, and the panel
 * holds them in its own state (an entry in `messagesByChat` would tell the shell
 * that group is already loaded). The click there asked the store for a chat it has
 * never seen, `buildViewerStrip` answered "the clicked message is not in the strip",
 * and a photo or a video in the comments did nothing at all.
 *
 * Such a pane provides its rows here; `null` (no provider) keeps the store lookup.
 */
export const ViewerSource = createContext<readonly Message[] | null>(null)

/** The rows of the pane around this bubble, or `null` to read `messagesByChat`. */
export function useViewerSource(): readonly Message[] | null {
  return useContext(ViewerSource)
}

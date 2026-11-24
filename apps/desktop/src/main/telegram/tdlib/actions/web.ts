import type { InstantView } from '@wegram/protocol'

import type { TdObject } from '../client'
import { mapPageBlocks } from '../map/rich'
import type { ActionDeps } from './deps'

/**
 * 即时预览: TDLib `getWebPageInstantView` (design doc §8.9).
 *
 * TDLib 1.8.70 answers the cached version, or fetches it; a page without an
 * Instant View is a 404 and reaches the renderer as an `AppError`, which is what
 * makes the card fall back to opening the link in a browser. The page's title is
 * not part of this answer — the preview card already carries one, and the
 * reader's header uses that.
 *
 * `webPageInstantView.is_full` can be false when only the excerpt was available;
 * the reader says so instead of pretending the page ended there.
 */
export async function instantView(
  deps: Pick<ActionDeps, 'invoke'>,
  url: string,
): Promise<InstantView> {
  const page = (await deps.invoke({ _: 'getWebPageInstantView', url })) as TdObject | undefined
  const viewCount = Number(page?.view_count ?? 0)
  return {
    url,
    blocks: mapPageBlocks(page?.blocks),
    ...(typeof page?.is_full === 'boolean' ? { isFull: page.is_full } : {}),
    ...(viewCount > 0 ? { viewCount } : {}),
  }
}

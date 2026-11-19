import { buildFixtureSeeds } from '@wegram/mock-fixtures'
import type { MessageMedia } from '@wegram/protocol'

import { ME, type Fixture } from './constants'

type MediaOf = (
  fileId: number,
  extra?: Partial<MessageMedia>,
  options?: { downloadable?: boolean },
) => MessageMedia

/**
 * The fake account's conversations.
 *
 * The data lives in `@wegram/mock-fixtures`, shared with the browser preview;
 * this function only supplies the environment — the current clock, and how a
 * file id becomes a `wx-media://` URL (MockAssets materialised the files first).
 */
export function buildFixtures(mediaOf: MediaOf): Map<number, Fixture> {
  return buildFixtureSeeds({
    selfId: ME.id,
    mediaOf,
    now: () => Math.floor(Date.now() / 1000),
  })
}

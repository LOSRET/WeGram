import type { Logger } from '../../../util'
import type { AdapterEvent } from '../../adapter'
import type { TdObject } from '../client'
import type { MapperContext } from '../map/context'

/** Everything the transcript actions need from the adapter. */
export interface ActionDeps {
  invoke(method: TdObject): Promise<any>
  mapper: MapperContext
  logger: Logger
  /** Pushes one adapter event; `downloadFile` announces progress and completion. */
  emit(event: AdapterEvent): void
  /** Downloads the chat photos of a page in the background. */
  prefetchChatAvatars(chatIds: number[]): void
}

export interface PostPermissionDeps {
  invoke(method: TdObject): Promise<any>
  /** Our own user id, learnt from `getMe`; nothing can be checked before that. */
  getSelfUserId(): number | null
}

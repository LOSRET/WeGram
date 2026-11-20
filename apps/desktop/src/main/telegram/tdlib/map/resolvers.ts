import type { TdObject } from '../client'
import { mapUser } from './user'

/**
 * The two cached lookups the mapper needs but a message does not carry: a sender's
 * name and a chat's title.
 *
 * They live here rather than on the adapter because they are cache-plus-one-request
 * logic, and `tdlib/index.ts` is at its 550-line budget. Both caches are the
 * adapter's own maps — passing them in keeps this module testable without TDLib.
 */
export interface ResolverDeps {
  invoke(method: TdObject): Promise<any>
  userNames: Map<number, string>
  chatTitles: Map<number, string>
}

export interface Resolvers {
  resolveUserName(userId: number): Promise<string>
  resolveChatTitle(chatId: number): Promise<string>
}

export function createResolvers(deps: ResolverDeps): Resolvers {
  return {
    async resolveUserName(userId: number): Promise<string> {
      const cached = deps.userNames.get(userId)
      if (cached) return cached
      try {
        const user = await deps.invoke({ _: 'getUser', user_id: userId })
        const name = mapUser(user)
        const label =
          [name.firstName, name.lastName].filter(Boolean).join(' ') || name.username || '未知'
        deps.userNames.set(userId, label)
        return label
      } catch {
        return '未知'
      }
    },

    async resolveChatTitle(chatId: number): Promise<string> {
      const cached = deps.chatTitles.get(chatId)
      if (cached) return cached
      try {
        const chat = await deps.invoke({ _: 'getChat', chat_id: chatId })
        const title: string = chat?.title ?? ''
        if (title) deps.chatTitles.set(chatId, title)
        return title || '未知'
      } catch {
        return '未知'
      }
    },
  }
}

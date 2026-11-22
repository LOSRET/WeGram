import type { ChatReport, PeerStatus, UserProfile } from '@wegram/protocol'

import * as actions from './actions'
import type { ActionDeps } from './actions'

/**
 * The person-domain seam methods — 在线/最后上线 and 资料卡 — as one object
 * `TdlibAdapter` binds. Split out of `index.ts` the way `chat-api.ts` was: the
 * adapter class is at its line budget, and a seam method that is only a call plus
 * its arguments does not need to live there.
 *
 * The deps come in lazily: this object is built before the constructor has
 * finished creating `actionDeps`, and every method reads them on the call.
 */
export function createUserApi(getDeps: () => ActionDeps) {
  return {
    /** Online / last seen for one user, or null when TDLib has nothing to show. */
    userStatus: async (userId: number): Promise<PeerStatus | null> =>
      actions.userStatus(getDeps(), userId),

    /** 资料卡: identity, 简介, 备注, 共同群聊 and the 拉黑 flag. */
    userProfile: async (userId: number): Promise<UserProfile> =>
      actions.userProfile(getDeps(), userId),

    /** 备注: Telegram's cloud-synced note; answers the refreshed card. */
    setUserNote: async (userId: number, note: string): Promise<UserProfile> =>
      actions.setUserNote(getDeps(), { userId, note }),

    /** 拉黑 / 取消拉黑; answers the refreshed card. */
    setUserBlocked: async (userId: number, blocked: boolean): Promise<UserProfile> =>
      actions.setUserBlocked(getDeps(), { userId, blocked }),

    /** 举报: one phase of TDLib's phased reportChat; see actions/users.ts. */
    reportUser: async (
      userId: number,
      input: { optionId?: string; text?: string },
    ): Promise<ChatReport> => actions.reportUser(getDeps(), { userId, ...input }),

    /** 添加为联系人 / 删除联系人; answers the refreshed card. */
    setUserContact: async (
      userId: number,
      contact: boolean,
      sharePhone?: boolean,
    ): Promise<UserProfile> =>
      actions.setUserContact(getDeps(), {
        userId,
        contact,
        ...(sharePhone === undefined ? {} : { sharePhone }),
      }),
  }
}

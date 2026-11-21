// The one TDLib MessageContent -> Chinese service-copy table. Exempt from
// `max-lines` in eslint.config.mjs (the keys are a single protocol union that
// grows with every Telegram service type); every other lint rule still applies.
// See docs/技术方案.md §8.3 and the `map/service.ts` row in
// apps/desktop/src/main/AGENTS.md.

import type { TdObject } from '../client'
import { asArray } from '../json'

/** `mm:ss` (`h:mm:ss` past an hour) for the call rows, like the transcript's clock. */
function callClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const tail = `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${tail}` : tail
}

/**
 * Human-readable text for a TDLib service message. TDLib itself ships no text
 * for these — the client must compose it (WeChat-style, Chinese).
 */
export async function serviceText(content: TdObject, ctx: ServiceTextContext): Promise<string> {
  const who = ctx.outgoing ? '你' : ctx.senderName
  const title = (value: unknown): string => (typeof value === 'string' && value ? value : '')
  switch (content._) {
    case 'messageBasicGroupChatCreate':
    case 'messageSupergroupChatCreate': {
      const name = title(content.title)
      return name ? `${who}创建了群聊「${name}」` : `${who}创建了群聊`
    }
    case 'messageChatUpgradeFrom':
    case 'messageChatUpgradeTo':
      return '群聊已升级为超级群组'
    case 'messageChatAddedToCommunity':
      return `${who}将群聊添加到了社区`
    case 'messageChatRemovedFromCommunity':
      return `${who}将群聊移出了社区`
    case 'messageChatChangeTitle': {
      const name = title(content.title)
      return name ? `${who}修改群聊名称为「${name}」` : `${who}修改了群聊名称`
    }
    case 'messageChatChangePhoto':
      return `${who}修改了群聊头像`
    case 'messageChatDeletePhoto':
      return `${who}移除了群聊头像`
    case 'messageChatAddMembers': {
      const ids: number[] = asArray<number>(content.member_user_ids)
      const names = await Promise.all(ids.map((id) => ctx.resolveUserName(Number(id))))
      if (names.length === 0) return `${who}邀请了新成员加入群聊`
      return `${who}邀请${names.join('、')}加入了群聊`
    }
    case 'messageChatJoinByLink':
      return `${who}通过邀请链接加入了群聊`
    case 'messageChatJoinByRequest':
      return `${who}加入了群聊`
    case 'messageChatJoinFromCommunity':
      return `${who}通过社区加入了群聊`
    case 'messageChatDeleteMember': {
      // The deleted member is the subject, not necessarily the sender.
      const name = await ctx.resolveUserName(Number(content.user_id))
      return `${name}退出了群聊`
    }
    case 'messageChatOwnerLeft': {
      const next = Number(content.new_owner_user_id) || 0
      if (!next) return `${who}退出了群聊，群聊暂无群主`
      return `${who}退出了群聊，${await ctx.resolveUserName(next)}接任群主`
    }
    case 'messageChatOwnerChanged': {
      const next = Number(content.new_owner_user_id) || 0
      return next ? `${await ctx.resolveUserName(next)}成为新群主` : '群主已变更'
    }
    // TDLib sends this one both for a real change and for a rejected request:
    // the flags are the only way to tell the two sentences apart.
    case 'messageChatHasProtectedContentToggled': {
      const before = content.old_has_protected_content === true
      const after = content.new_has_protected_content === true
      if (before === after) return '修改禁止保存和转发的申请被拒绝'
      return after ? `${who}开启了禁止保存和转发` : `${who}关闭了禁止保存和转发`
    }
    case 'messageChatHasProtectedContentDisableRequested':
      return content.is_expired === true
        ? '关闭禁止保存和转发的申请已过期'
        : `${who}申请关闭禁止保存和转发`
    case 'messagePinMessage':
      return `${who}置顶了一条消息`
    case 'messageScreenshotTaken':
      return `${who}对聊天进行了截图`
    case 'messageChatSetBackground':
      return `${who}修改了聊天背景`
    case 'messageChatSetTheme':
      return `${who}修改了聊天主题`
    case 'messageChatSetTtl':
      return `${who}修改了消息自动删除定时`
    case 'messageChatSetMessageAutoDeleteTime':
      return Number(content.message_auto_delete_time) > 0
        ? `${who}开启了消息自动删除`
        : `${who}关闭了消息自动删除`
    // A boost is one service row per boost event; the count travels with it.
    case 'messageChatBoost': {
      const count = Number(content.boost_count) || 0
      return count > 0 ? `${who}为群聊助力，当前已有 ${count} 次助力` : `${who}为群聊助力`
    }
    // A 1:1 call kept in the history. The discard reason is the whole story, and
    // missed/declined read differently depending on which side we were.
    case 'messageCall': {
      const label = content.is_video === true ? '视频通话' : '语音通话'
      const duration = Number(content.duration) || 0
      switch (content.discard_reason?._) {
        case 'callDiscardReasonMissed':
          return ctx.outgoing ? `对方未接听${label}` : `未接听${label}`
        case 'callDiscardReasonDeclined':
          return ctx.outgoing ? `对方已拒绝${label}` : `你已拒绝${label}`
        case 'callDiscardReasonDisconnected':
          return `${label}已中断`
        case 'callDiscardReasonUpgradeToGroupCall':
          return '通话已升级为群通话'
        case 'callDiscardReasonHungUp':
          return duration > 0 ? `${label}时长 ${callClock(duration)}` : `${label}已结束`
        default:
          return ctx.outgoing ? `已取消${label}` : `${label}未接通`
      }
    }
    // A call that is not bound to a chat: TDLib asks for the incoming-call screen
    // while it is still ringing, and reports the outcome once it is over.
    case 'messageGroupCall': {
      const label = content.is_video === true ? '视频通话' : '语音通话'
      const duration = Number(content.duration) || 0
      if (content.is_active === true) return `${label}进行中`
      if (content.was_missed === true) return ctx.outgoing ? `对方未接听${label}` : `未接听${label}`
      if (duration > 0) return `${label}时长 ${callClock(duration)}`
      return ctx.outgoing ? `你发起了${label}` : `${who}邀请你加入${label}`
    }
    case 'messageVideoChatScheduled':
      return `${who}预约了群通话`
    case 'messageVideoChatStarted':
      return `${who}开始了群通话`
    case 'messageVideoChatEnded': {
      const duration = Number(content.duration) || 0
      return duration > 0 ? `群通话已结束，时长 ${callClock(duration)}` : '群通话已结束'
    }
    case 'messageInviteVideoChatParticipants': {
      const ids: number[] = asArray<number>(content.user_ids)
      const names = await Promise.all(ids.map((id) => ctx.resolveUserName(Number(id))))
      if (names.length === 0) return `${who}邀请了成员加入群通话`
      return `${who}邀请${names.join('、')}加入了群通话`
    }
    // Telegram's money and gift family: the client cannot move funds, so these
    // stay history notices. A number is shown only where the unit is 1:1 with the
    // message (Stars); fiat totals arrive in minor units and are left to the bot's
    // own receipt.
    case 'messagePaymentSuccessful': {
      const name = title(content.invoice_name)
      return name ? `${who}支付了「${name}」` : `${who}完成了支付`
    }
    case 'messagePaymentSuccessfulBot':
      return `${who}完成了支付`
    case 'messagePaymentRefunded':
      return '支付已退款'
    case 'messageGiftedPremium': {
      const months = Number(content.month_count) || 0
      return months > 0
        ? `${who}赠送了 ${months} 个月的 Telegram Premium`
        : `${who}赠送了 Telegram Premium`
    }
    case 'messagePremiumGiftCode':
      return `${who}发出了 Premium 礼物码`
    case 'messageGiveawayCreated':
      return `${who}创建了赠礼活动`
    case 'messageGiveaway':
      return `${who}发起了赠礼活动`
    case 'messageGiveawayCompleted':
      return '赠礼活动已结束'
    case 'messageGiveawayWinners':
      return '赠礼活动已开奖'
    case 'messageGiftedStars': {
      const stars = Number(content.star_count) || 0
      return stars > 0 ? `${who}赠送了 ${stars} 颗 Star` : `${who}赠送了 Star`
    }
    case 'messageGiftedGrams':
      return `${who}送出了 Gram 赠礼`
    case 'messageGiveawayPrizeStars': {
      const stars = Number(content.star_count) || 0
      return stars > 0 ? `你获得了 ${stars} 颗 Star` : '你获得了 Star 奖励'
    }
    case 'messageTonWalletTransfer':
      return `${who}发起了一笔 TON 转账`
    case 'messageTonConnectRequest': {
      const dapp = title(content.dapp_name)
      return dapp ? `${who}请求连接 ${dapp}` : `${who}发起了 TON 连接请求`
    }
    case 'messageGift':
      return `${who}送出了一份礼物`
    case 'messageUpgradedGift':
      return `${who}送出了一份升级礼物`
    case 'messageRefundedUpgradedGift':
      return '礼物已退款'
    case 'messageUpgradedGiftPurchaseOffer':
      return `${who}对一份礼物出价`
    case 'messageUpgradedGiftPurchaseOfferRejected':
      return '礼物的出价已被拒绝'
    case 'messagePaidMessagesRefunded': {
      const count = Number(content.message_count) || 0
      const stars = Number(content.star_count) || 0
      return stars > 0
        ? `已退回 ${count} 条付费消息的 ${stars} 颗 Star`
        : `已退回 ${count} 条付费消息的费用`
    }
    case 'messagePaidMessagePriceChanged': {
      const stars = Number(content.paid_message_star_count) || 0
      return stars > 0 ? `付费消息价格已调整为 ${stars} 颗 Star` : '付费消息价格已变更'
    }
    case 'messageDirectMessagePriceChanged': {
      if (content.is_enabled !== true) return '已关闭付费私信'
      const stars = Number(content.paid_message_star_count) || 0
      return stars > 0 ? `已开启付费私信（${stars} 颗 Star）` : '已开启付费私信'
    }
    case 'messageUnpaidMessagesAllowedByLink':
      return '已允许通过链接发送免费消息'
    case 'messageForumTopicCreated': {
      const name = title(content.name)
      return name ? `${who}创建了话题「${name}」` : `${who}创建了话题`
    }
    case 'messageForumTopicEdited':
      return `${who}编辑了话题`
    case 'messageForumTopicIsClosedToggled':
      return content.is_closed ? `${who}关闭了话题` : `${who}重新打开了话题`
    case 'messageForumTopicIsHiddenToggled':
      return content.is_hidden ? `${who}隐藏了话题` : `${who}显示了话题`
    // Adding an option to a poll posts a service row in the chat (TDLib
    // messagePollOptionAdded); the option's own words travel in `text`.
    case 'messagePollOptionAdded': {
      const option = title(content.text?.text)
      return option ? `${who}已将“${option}”添加到投票中` : `${who}向投票中添加了一个选项`
    }
    case 'messagePollOptionDeleted': {
      const option = title(content.text?.text)
      return option ? `${who}从投票中删除了选项“${option}”` : `${who}从投票中删除了一个选项`
    }
    case 'messageGameScore': {
      const score = Number(content.score) || 0
      return `${who}在游戏中获得了 ${score} 分`
    }
    case 'messageChecklistTasksDone': {
      const done: number[] = asArray<number>(content.marked_as_done_task_ids)
      const undone: number[] = asArray<number>(content.marked_as_not_done_task_ids)
      if (done.length > 0 && undone.length > 0) return `${who}更新了清单进度`
      if (done.length > 0) return `${who}勾选了 ${done.length} 项清单任务`
      if (undone.length > 0) return `${who}取消了 ${undone.length} 项清单任务`
      return `${who}更新了清单进度`
    }
    case 'messageChecklistTasksAdded': {
      const tasks = asArray<TdObject>(content.tasks)
      return tasks.length > 0 ? `${who}添加了 ${tasks.length} 项清单任务` : `${who}更新了清单`
    }
    case 'messageSuggestedPostApprovalFailed':
      return '建议帖发布失败'
    case 'messageSuggestedPostApproved':
      return '建议帖已通过'
    case 'messageSuggestedPostDeclined':
      return '建议帖被拒绝'
    case 'messageSuggestedPostPaid':
      return '建议帖费用已支付'
    case 'messageSuggestedPostRefunded':
      return '建议帖费用已退回'
    case 'messageBotWriteAccessAllowed':
      return `${who}允许了机器人发送消息`
    case 'messageWebAppDataSent':
      return `${who}向小程序发送了数据`
    case 'messageWebAppDataReceived':
      return '小程序传回了数据'
    case 'messagePassportDataSent':
      return `${who}发送了 Telegram Passport 资料`
    case 'messagePassportDataReceived':
      return `${who}接收了 Telegram Passport 资料`
    case 'messageProximityAlertTriggered': {
      const traveler = await senderName(content.traveler_id, ctx)
      const watcher = await senderName(content.watcher_id, ctx)
      return `${traveler}与${watcher}距离过近`
    }
    // Self-destructed media keeps its row after the bytes are gone: the notice is
    // what the reader sees where the bubble used to be.
    case 'messageExpiredPhoto':
      return `${who}发送的图片已过期`
    case 'messageExpiredVideo':
      return `${who}发送的视频已过期`
    case 'messageExpiredVideoNote':
      return `${who}发送的视频消息已过期`
    case 'messageExpiredVoiceNote':
      return `${who}发送的语音已过期`
    case 'messageContactRegistered':
      return `${who}加入了 Telegram`
    case 'messageSuggestProfilePhoto':
      return `${who}建议你使用新的头像`
    case 'messageSuggestBirthdate':
      return `${who}建议你设置生日`
    case 'messageManagedBotCreated': {
      const botId = Number(content.bot_user_id) || 0
      if (!botId) return `${who}创建了一个新机器人`
      const bot = await ctx.resolveUserName(botId)
      const managerId = Number(content.manager_bot_user_id) || 0
      if (!managerId) return `${who}创建了新机器人 ${bot}`
      return `${who}通过 ${await ctx.resolveUserName(managerId)} 创建了新机器人 ${bot}`
    }
    case 'messageCustomServiceAction':
      return typeof content.text === 'string' ? content.text : ''
    default:
      return ''
  }
}

/** TDLib content types that are service messages (centered transcript notices). */
export const SERVICE_CONTENT_TYPES = new Set([
  'messageBasicGroupChatCreate',
  'messageSupergroupChatCreate',
  'messageChatUpgradeFrom',
  'messageChatUpgradeTo',
  'messageChatChangeTitle',
  'messageChatChangePhoto',
  'messageChatDeletePhoto',
  'messageChatAddMembers',
  'messageChatJoinByLink',
  'messageChatJoinByRequest',
  'messageChatDeleteMember',
  'messagePinMessage',
  'messageScreenshotTaken',
  'messageChatSetBackground',
  'messageChatSetTheme',
  'messageChatSetTtl',
  'messageChatSetMessageAutoDeleteTime',
  'messageForumTopicCreated',
  'messageForumTopicEdited',
  'messageForumTopicIsClosedToggled',
  'messageForumTopicIsHiddenToggled',
  'messageContactRegistered',
  'messageSuggestProfilePhoto',
  'messageCustomServiceAction',
  'messagePollOptionAdded',
  'messagePollOptionDeleted',
  'messageChatOwnerLeft',
  'messageChatOwnerChanged',
  'messageChatHasProtectedContentToggled',
  'messageChatHasProtectedContentDisableRequested',
  'messageCall',
  'messageGroupCall',
  'messageVideoChatScheduled',
  'messageVideoChatStarted',
  'messageVideoChatEnded',
  'messageInviteVideoChatParticipants',
  'messageExpiredPhoto',
  'messageExpiredVideo',
  'messageExpiredVideoNote',
  'messageExpiredVoiceNote',
  'messageChatJoinFromCommunity',
  'messageChatAddedToCommunity',
  'messageChatRemovedFromCommunity',
  'messageChatBoost',
  'messageSuggestBirthdate',
  'messageGameScore',
  'messageManagedBotCreated',
  'messagePaymentSuccessful',
  'messagePaymentSuccessfulBot',
  'messagePaymentRefunded',
  'messageGiftedPremium',
  'messagePremiumGiftCode',
  'messageGiveawayCreated',
  'messageGiveaway',
  'messageGiveawayCompleted',
  'messageGiveawayWinners',
  'messageGiftedStars',
  'messageGiftedGrams',
  'messageGiveawayPrizeStars',
  'messageTonWalletTransfer',
  'messageTonConnectRequest',
  'messageGift',
  'messageUpgradedGift',
  'messageRefundedUpgradedGift',
  'messageUpgradedGiftPurchaseOffer',
  'messageUpgradedGiftPurchaseOfferRejected',
  'messagePaidMessagesRefunded',
  'messagePaidMessagePriceChanged',
  'messageDirectMessagePriceChanged',
  'messageUnpaidMessagesAllowedByLink',
  'messageChecklistTasksDone',
  'messageChecklistTasksAdded',
  'messageSuggestedPostApprovalFailed',
  'messageSuggestedPostApproved',
  'messageSuggestedPostDeclined',
  'messageSuggestedPostPaid',
  'messageSuggestedPostRefunded',
  'messageBotWriteAccessAllowed',
  'messageWebAppDataSent',
  'messageWebAppDataReceived',
  'messagePassportDataSent',
  'messagePassportDataReceived',
  'messageProximityAlertTriggered',
])

/** A `MessageSender` (a user or a chat) as a display name; `undefined` when TDLib named nobody. */
async function senderName(sender: TdObject | undefined, ctx: ServiceTextContext): Promise<string> {
  const userId = Number(sender?.user_id) || 0
  if (userId) return ctx.resolveUserName(userId)
  const chatId = Number(sender?.chat_id) || 0
  if (chatId && ctx.resolveChatTitle) return ctx.resolveChatTitle(chatId)
  return '有人'
}

export interface ServiceTextContext {
  senderName: string
  outgoing: boolean
  resolveUserName: (userId: number) => Promise<string>
  resolveChatTitle?: (chatId: number) => Promise<string>
}

export function servicePreview(content: TdObject): string {
  switch (content._) {
    case 'messageBasicGroupChatCreate':
    case 'messageSupergroupChatCreate':
      return '创建群聊'
    case 'messageChatChangeTitle':
      return '修改群聊名称'
    case 'messageChatChangePhoto':
      return '修改群聊头像'
    case 'messageChatDeletePhoto':
      return '移除群聊头像'
    case 'messageChatAddMembers':
    case 'messageChatJoinByLink':
    case 'messageChatJoinByRequest':
      return '加入群聊'
    case 'messageChatJoinFromCommunity':
      return '通过社区加入群聊'
    case 'messageChatDeleteMember':
      return '退出群聊'
    case 'messageChatAddedToCommunity':
      return '群聊已加入社区'
    case 'messageChatRemovedFromCommunity':
      return '群聊已移出社区'
    case 'messageChatOwnerLeft':
      return '群主退出了群聊'
    case 'messageChatOwnerChanged':
      return '群主已变更'
    case 'messageChatHasProtectedContentToggled':
    case 'messageChatHasProtectedContentDisableRequested':
      return '禁止保存和转发'
    case 'messageChatBoost':
      return '为群聊助力'
    case 'messageSuggestBirthdate':
      return '建议设置生日'
    case 'messageGameScore':
      return '游戏得分'
    case 'messageManagedBotCreated':
      return '创建了新机器人'
    case 'messagePinMessage':
      return '置顶了一条消息'
    case 'messageScreenshotTaken':
      return '对聊天进行了截图'
    case 'messageCall':
      return content.is_video === true ? '视频通话' : '语音通话'
    case 'messageGroupCall':
    case 'messageVideoChatScheduled':
    case 'messageVideoChatStarted':
    case 'messageVideoChatEnded':
    case 'messageInviteVideoChatParticipants':
      return '群通话'
    case 'messageExpiredPhoto':
      return '[图片已过期]'
    case 'messageExpiredVideo':
      return '[视频已过期]'
    case 'messageExpiredVideoNote':
      return '[视频消息已过期]'
    case 'messageExpiredVoiceNote':
      return '[语音已过期]'
    case 'messagePollOptionAdded':
      return '添加了投票选项'
    case 'messagePollOptionDeleted':
      return '删除了投票选项'
    case 'messageContactRegistered':
      return '加入了 Telegram'
    case 'messageCustomServiceAction':
      return typeof content.text === 'string' ? content.text : ''
    case 'messagePaymentSuccessful':
    case 'messagePaymentSuccessfulBot':
      return '完成支付'
    case 'messagePaymentRefunded':
      return '支付已退款'
    case 'messageGiftedPremium':
      return '赠送 Telegram Premium'
    case 'messagePremiumGiftCode':
      return 'Premium 礼物码'
    case 'messageGiveawayCreated':
      return '创建赠礼活动'
    case 'messageGiveaway':
      return '发起赠礼活动'
    case 'messageGiveawayCompleted':
      return '赠礼活动已结束'
    case 'messageGiveawayWinners':
      return '赠礼活动已开奖'
    case 'messageGiftedStars':
      return '赠送 Star'
    case 'messageGiftedGrams':
      return 'Gram 赠礼'
    case 'messageGiveawayPrizeStars':
      return '获得 Star 奖励'
    case 'messageTonWalletTransfer':
      return 'TON 转账'
    case 'messageTonConnectRequest':
      return 'TON 连接请求'
    case 'messageGift':
      return '送出了礼物'
    case 'messageUpgradedGift':
      return '送出了升级礼物'
    case 'messageRefundedUpgradedGift':
      return '礼物已退款'
    case 'messageUpgradedGiftPurchaseOffer':
      return '礼物出价'
    case 'messageUpgradedGiftPurchaseOfferRejected':
      return '出价被拒绝'
    case 'messagePaidMessagesRefunded':
      return '付费消息退款'
    case 'messagePaidMessagePriceChanged':
      return '付费消息价格变更'
    case 'messageDirectMessagePriceChanged':
      return '付费私信设置'
    case 'messageUnpaidMessagesAllowedByLink':
      return '允许免费消息'
    case 'messageChecklistTasksDone':
      return '清单进度'
    case 'messageChecklistTasksAdded':
      return '添加清单任务'
    case 'messageSuggestedPostApprovalFailed':
      return '建议帖发布失败'
    case 'messageSuggestedPostApproved':
      return '建议帖已通过'
    case 'messageSuggestedPostDeclined':
      return '建议帖被拒绝'
    case 'messageSuggestedPostPaid':
      return '建议帖费用'
    case 'messageSuggestedPostRefunded':
      return '建议帖退款'
    case 'messageBotWriteAccessAllowed':
      return '机器人授权'
    case 'messageWebAppDataSent':
    case 'messageWebAppDataReceived':
      return '小程序数据'
    case 'messagePassportDataSent':
    case 'messagePassportDataReceived':
      return 'Passport 资料'
    case 'messageProximityAlertTriggered':
      return '距离提醒'
    default:
      return ''
  }
}

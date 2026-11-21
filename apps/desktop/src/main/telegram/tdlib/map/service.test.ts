import { describe, expect, it } from 'vitest'

import { serviceText } from './service'

/**
 * Service rows are composed by us, not by TDLib: the wording, the direction-
 * dependent pronouns and the call clock all live here. Split out of
 * content.test.ts when the P0 batch (calls, ownership, expired media) pushed
 * that file over the line budget.
 */
describe('serviceText', () => {
  const ctx = {
    senderName: 'Alice',
    outgoing: false,
    resolveUserName: async (userId: number) => `user-${userId}`,
  }

  it('composes group lifecycle notices in WeChat style', async () => {
    expect(await serviceText({ _: 'messageSupergroupChatCreate', title: 'Team' }, ctx)).toBe(
      'Alice创建了群聊「Team」',
    )
    expect(await serviceText({ _: 'messageChatChangeTitle', title: 'New' }, ctx)).toBe(
      'Alice修改群聊名称为「New」',
    )
    expect(await serviceText({ _: 'messageChatChangePhoto' }, ctx)).toBe('Alice修改了群聊头像')
  })

  it('reads the reciprocal pronoun when the message is ours', async () => {
    expect(await serviceText({ _: 'messagePinMessage' }, { ...ctx, outgoing: true })).toBe(
      '你置顶了一条消息',
    )
  })

  it('names the invited members and tolerates an empty list', async () => {
    expect(await serviceText({ _: 'messageChatAddMembers', member_user_ids: [1, 2] }, ctx)).toBe(
      'Alice邀请user-1、user-2加入了群聊',
    )
    expect(await serviceText({ _: 'messageChatAddMembers', member_user_ids: [] }, ctx)).toBe(
      'Alice邀请了新成员加入群聊',
    )
  })

  it('reports the departing member, not the sender, for a removal', async () => {
    expect(await serviceText({ _: 'messageChatDeleteMember', user_id: 9 }, ctx)).toBe(
      'user-9退出了群聊',
    )
  })

  it('turns the auto-delete time into an on/off notice', async () => {
    expect(
      await serviceText(
        { _: 'messageChatSetMessageAutoDeleteTime', message_auto_delete_time: 60 },
        ctx,
      ),
    ).toBe('Alice开启了消息自动删除')
    expect(
      await serviceText(
        { _: 'messageChatSetMessageAutoDeleteTime', message_auto_delete_time: 0 },
        ctx,
      ),
    ).toBe('Alice关闭了消息自动删除')
  })

  it('composes poll option added / deleted notices', async () => {
    expect(await serviceText({ _: 'messagePollOptionAdded', text: { text: '4' } }, ctx)).toBe(
      'Alice已将“4”添加到投票中',
    )
    expect(
      await serviceText(
        { _: 'messagePollOptionAdded', text: { text: '4' } },
        { ...ctx, outgoing: true },
      ),
    ).toBe('你已将“4”添加到投票中')
    expect(await serviceText({ _: 'messagePollOptionDeleted', text: { text: '4' } }, ctx)).toBe(
      'Alice从投票中删除了选项“4”',
    )
    expect(await serviceText({ _: 'messagePollOptionAdded' }, ctx)).toBe(
      'Alice向投票中添加了一个选项',
    )
  })

  it('reads a call from its discard reason and from which side we were', async () => {
    expect(
      await serviceText(
        { _: 'messageCall', discard_reason: { _: 'callDiscardReasonMissed' } },
        ctx,
      ),
    ).toBe('未接听语音通话')
    expect(
      await serviceText(
        { _: 'messageCall', is_video: true, discard_reason: { _: 'callDiscardReasonMissed' } },
        { ...ctx, outgoing: true },
      ),
    ).toBe('对方未接听视频通话')
    expect(
      await serviceText(
        { _: 'messageCall', discard_reason: { _: 'callDiscardReasonDeclined' } },
        ctx,
      ),
    ).toBe('你已拒绝语音通话')
    expect(
      await serviceText(
        { _: 'messageCall', discard_reason: { _: 'callDiscardReasonHungUp' }, duration: 83 },
        ctx,
      ),
    ).toBe('语音通话时长 01:23')
    expect(
      await serviceText(
        { _: 'messageCall', discard_reason: { _: 'callDiscardReasonUpgradeToGroupCall' } },
        ctx,
      ),
    ).toBe('通话已升级为群通话')
    expect(
      await serviceText(
        { _: 'messageCall', discard_reason: { _: 'callDiscardReasonEmpty' } },
        { ...ctx, outgoing: true },
      ),
    ).toBe('已取消语音通话')
  })

  it('describes a ringing, missed and finished chat-bound call', async () => {
    expect(await serviceText({ _: 'messageGroupCall' }, ctx)).toBe('Alice邀请你加入语音通话')
    expect(await serviceText({ _: 'messageGroupCall' }, { ...ctx, outgoing: true })).toBe(
      '你发起了语音通话',
    )
    expect(await serviceText({ _: 'messageGroupCall', is_active: true }, ctx)).toBe(
      '语音通话进行中',
    )
    expect(
      await serviceText({ _: 'messageGroupCall', was_missed: true, is_video: true }, ctx),
    ).toBe('未接听视频通话')
    expect(await serviceText({ _: 'messageGroupCall', duration: 60 }, ctx)).toBe(
      '语音通话时长 01:00',
    )
  })

  it('composes the group video chat lifecycle and its invitations', async () => {
    expect(await serviceText({ _: 'messageVideoChatScheduled' }, ctx)).toBe('Alice预约了群通话')
    expect(await serviceText({ _: 'messageVideoChatStarted' }, { ...ctx, outgoing: true })).toBe(
      '你开始了群通话',
    )
    expect(await serviceText({ _: 'messageVideoChatEnded', duration: 3725 }, ctx)).toBe(
      '群通话已结束，时长 1:02:05',
    )
    expect(await serviceText({ _: 'messageVideoChatEnded' }, ctx)).toBe('群通话已结束')
    expect(
      await serviceText({ _: 'messageInviteVideoChatParticipants', user_ids: [1, 2] }, ctx),
    ).toBe('Alice邀请user-1、user-2加入了群通话')
    expect(await serviceText({ _: 'messageInviteVideoChatParticipants', user_ids: [] }, ctx)).toBe(
      'Alice邀请了成员加入群通话',
    )
  })

  it('names the next owner and the content-protection change', async () => {
    expect(await serviceText({ _: 'messageChatOwnerLeft', new_owner_user_id: 7 }, ctx)).toBe(
      'Alice退出了群聊，user-7接任群主',
    )
    expect(await serviceText({ _: 'messageChatOwnerLeft' }, ctx)).toBe(
      'Alice退出了群聊，群聊暂无群主',
    )
    expect(await serviceText({ _: 'messageChatOwnerChanged', new_owner_user_id: 8 }, ctx)).toBe(
      'user-8成为新群主',
    )
    expect(
      await serviceText(
        {
          _: 'messageChatHasProtectedContentToggled',
          old_has_protected_content: false,
          new_has_protected_content: true,
        },
        ctx,
      ),
    ).toBe('Alice开启了禁止保存和转发')
    expect(
      await serviceText(
        {
          _: 'messageChatHasProtectedContentToggled',
          old_has_protected_content: true,
          new_has_protected_content: false,
        },
        ctx,
      ),
    ).toBe('Alice关闭了禁止保存和转发')
    // old === new is how TDLib reports a rejected request.
    expect(
      await serviceText(
        {
          _: 'messageChatHasProtectedContentToggled',
          old_has_protected_content: true,
          new_has_protected_content: true,
        },
        ctx,
      ),
    ).toBe('修改禁止保存和转发的申请被拒绝')
    expect(await serviceText({ _: 'messageChatHasProtectedContentDisableRequested' }, ctx)).toBe(
      'Alice申请关闭禁止保存和转发',
    )
    expect(
      await serviceText(
        { _: 'messageChatHasProtectedContentDisableRequested', is_expired: true },
        ctx,
      ),
    ).toBe('关闭禁止保存和转发的申请已过期')
  })

  it('composes community and boost notices', async () => {
    expect(await serviceText({ _: 'messageChatJoinFromCommunity' }, ctx)).toBe(
      'Alice通过社区加入了群聊',
    )
    expect(await serviceText({ _: 'messageChatAddedToCommunity' }, ctx)).toBe(
      'Alice将群聊添加到了社区',
    )
    expect(await serviceText({ _: 'messageChatRemovedFromCommunity' }, ctx)).toBe(
      'Alice将群聊移出了社区',
    )
    expect(await serviceText({ _: 'messageChatBoost', boost_count: 7 }, ctx)).toBe(
      'Alice为群聊助力，当前已有 7 次助力',
    )
    expect(await serviceText({ _: 'messageChatBoost' }, ctx)).toBe('Alice为群聊助力')
  })

  it('composes birthdate, game-score and managed-bot notices', async () => {
    expect(
      await serviceText(
        { _: 'messageSuggestBirthdate', birthdate: { day: 1, month: 1, year: 1990 } },
        ctx,
      ),
    ).toBe('Alice建议你设置生日')
    expect(await serviceText({ _: 'messageGameScore', score: 12 }, ctx)).toBe(
      'Alice在游戏中获得了 12 分',
    )
    expect(
      await serviceText(
        { _: 'messageManagedBotCreated', bot_user_id: 21, manager_bot_user_id: 22 },
        ctx,
      ),
    ).toBe('Alice通过 user-22 创建了新机器人 user-21')
    expect(await serviceText({ _: 'messageManagedBotCreated' }, ctx)).toBe(
      'Alice创建了一个新机器人',
    )
  })

  it('composes payment, premium and gift notices', async () => {
    expect(await serviceText({ _: 'messagePaymentSuccessful', invoice_name: 'Pro' }, ctx)).toBe(
      'Alice支付了「Pro」',
    )
    expect(await serviceText({ _: 'messagePaymentSuccessful' }, ctx)).toBe('Alice完成了支付')
    expect(await serviceText({ _: 'messagePaymentRefunded' }, ctx)).toBe('支付已退款')
    expect(await serviceText({ _: 'messageGiftedPremium', month_count: 6 }, ctx)).toBe(
      'Alice赠送了 6 个月的 Telegram Premium',
    )
    expect(await serviceText({ _: 'messagePremiumGiftCode' }, ctx)).toBe(
      'Alice发出了 Premium 礼物码',
    )
    expect(await serviceText({ _: 'messageGiftedStars', star_count: 50 }, ctx)).toBe(
      'Alice赠送了 50 颗 Star',
    )
    expect(await serviceText({ _: 'messageGiveawayPrizeStars', star_count: 5 }, ctx)).toBe(
      '你获得了 5 颗 Star',
    )
    expect(await serviceText({ _: 'messageTonConnectRequest', dapp_name: 'Fragment' }, ctx)).toBe(
      'Alice请求连接 Fragment',
    )
    expect(await serviceText({ _: 'messageTonWalletTransfer' }, ctx)).toBe(
      'Alice发起了一笔 TON 转账',
    )
    expect(await serviceText({ _: 'messageGift' }, ctx)).toBe('Alice送出了一份礼物')
    expect(await serviceText({ _: 'messageRefundedUpgradedGift' }, ctx)).toBe('礼物已退款')
    expect(
      await serviceText({ _: 'messageDirectMessagePriceChanged', is_enabled: false }, ctx),
    ).toBe('已关闭付费私信')
    expect(
      await serviceText(
        { _: 'messageDirectMessagePriceChanged', is_enabled: true, paid_message_star_count: 3 },
        ctx,
      ),
    ).toBe('已开启付费私信（3 颗 Star）')
    expect(
      await serviceText({ _: 'messagePaidMessagesRefunded', message_count: 4, star_count: 8 }, ctx),
    ).toBe('已退回 4 条付费消息的 8 颗 Star')
  })

  it('composes checklist and suggested-post notices', async () => {
    expect(
      await serviceText({ _: 'messageChecklistTasksDone', marked_as_done_task_ids: [1, 2] }, ctx),
    ).toBe('Alice勾选了 2 项清单任务')
    expect(
      await serviceText({ _: 'messageChecklistTasksDone', marked_as_not_done_task_ids: [3] }, ctx),
    ).toBe('Alice取消了 1 项清单任务')
    expect(await serviceText({ _: 'messageChecklistTasksDone' }, ctx)).toBe('Alice更新了清单进度')
    expect(await serviceText({ _: 'messageChecklistTasksAdded', tasks: [{}, {}, {}] }, ctx)).toBe(
      'Alice添加了 3 项清单任务',
    )
    expect(await serviceText({ _: 'messageSuggestedPostApproved' }, ctx)).toBe('建议帖已通过')
    expect(await serviceText({ _: 'messageSuggestedPostPaid' }, ctx)).toBe('建议帖费用已支付')
  })

  it('composes bot, mini-app, passport and proximity notices', async () => {
    expect(await serviceText({ _: 'messageBotWriteAccessAllowed' }, ctx)).toBe(
      'Alice允许了机器人发送消息',
    )
    expect(await serviceText({ _: 'messageWebAppDataReceived' }, ctx)).toBe('小程序传回了数据')
    expect(await serviceText({ _: 'messagePassportDataSent' }, ctx)).toBe(
      'Alice发送了 Telegram Passport 资料',
    )
    expect(
      await serviceText(
        {
          _: 'messageProximityAlertTriggered',
          traveler_id: { _: 'messageSenderUser', user_id: 1 },
          watcher_id: { _: 'messageSenderChat', chat_id: 9 },
        },
        { ...ctx, resolveChatTitle: async (chatId) => `chat-${chatId}` },
      ),
    ).toBe('user-1与chat-9距离过近')
  })

  it('replaces self-destructed media with an expired notice', async () => {
    expect(await serviceText({ _: 'messageExpiredPhoto' }, ctx)).toBe('Alice发送的图片已过期')
    expect(await serviceText({ _: 'messageExpiredVoiceNote' }, ctx)).toBe('Alice发送的语音已过期')
    expect(await serviceText({ _: 'messageExpiredVideoNote' }, { ...ctx, outgoing: true })).toBe(
      '你发送的视频消息已过期',
    )
  })

  it('falls back to empty text for an unhandled service type', async () => {
    expect(await serviceText({ _: 'messageSomethingNew' }, ctx)).toBe('')
  })
})

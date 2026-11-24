import { describe, expect, it } from 'vitest'

import { composeProfile, pageCommonChats, reportAnswer } from './profile'

const person = {
  userId: 37,
  title: '妈',
  username: 'mama_wegram',
  phone: '8613800000000',
  bio: '每天散步一小时。',
  note: '妈妈',
  commonChats: 2,
}

const bot = {
  userId: 26,
  title: 'WeGram 助手',
  bot: {
    shortDescription: '演示机器人',
    description: '你好。',
    commands: [{ command: 'start', description: '重新开始' }],
  },
  commonChats: 0,
}

describe('composeProfile', () => {
  it('reads the person card off the seed', () => {
    expect(composeProfile(person)).toMatchObject({
      userId: 37,
      username: 'mama_wegram',
      bio: '每天散步一小时。',
      note: '妈妈',
      commonChats: 2,
      isContact: true,
      blocked: false,
      canBeReported: false,
    })
  })

  it('lets an override win, including an empty 备注', () => {
    expect(composeProfile(person, { note: ' 妈 ' }).note).toBe(' 妈 ')
    expect(composeProfile(person, { note: '' }).note).toBeUndefined()
    expect(composeProfile(person, { contact: false })).toMatchObject({ isContact: false })
    expect(composeProfile(person, { blocked: true })).toMatchObject({ blocked: true })
  })

  it('draws a bot as a non-contact that may be reported, with no handle leaked', () => {
    const card = composeProfile(bot)
    expect(card).toMatchObject({
      userId: 26,
      isContact: false,
      canBeReported: true,
      bot: {
        shortDescription: '演示机器人',
        description: '你好。',
        commands: [{ command: 'start', description: '重新开始' }],
      },
    })
    expect(card).not.toHaveProperty('username')
  })
})

describe('pageCommonChats', () => {
  const chats = [{ id: 2 }, { id: 4 }, { id: 9 }]

  it('pages from the offset chat id', () => {
    expect(pageCommonChats(chats, { offset: 4 }).map((chat) => chat.id)).toEqual([4, 9])
    expect(pageCommonChats(chats, { offset: 404 }).map((chat) => chat.id)).toEqual([2, 4, 9])
    expect(pageCommonChats(chats).map((chat) => chat.id)).toEqual([2, 4, 9])
  })

  it('honours the limit', () => {
    expect(pageCommonChats(chats, { limit: 2 }).map((chat) => chat.id)).toEqual([2, 4])
  })
})

describe('reportAnswer', () => {
  it('answers the reasons first', () => {
    const first = reportAnswer({ title: '举报这个用户' })
    expect(first).toMatchObject({ reported: false, title: '举报这个用户' })
    expect(first.options?.map((option) => option.text)).toContain('其他')
  })

  it('asks for details on 其他, then files', () => {
    expect(reportAnswer({ title: '举报这个用户', optionId: 'other' })).toEqual({
      reported: false,
      textRequired: true,
      optionId: 'other-details',
    })
    expect(
      reportAnswer({ title: '举报这个用户', optionId: 'other-details', text: '说明' }),
    ).toEqual({ reported: true })
  })
})

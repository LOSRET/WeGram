import { describe, expect, it } from 'vitest'

import {
  IN_CHAT_TABS,
  inChatEmptyText,
  inChatIdleText,
  inChatTabLabel,
  shouldSearchInChat,
} from './inChatSearch'

describe('in-chat search tabs', () => {
  it('offers the text tab first, then the shared-media kinds', () => {
    expect(IN_CHAT_TABS.map((tab) => tab.label)).toEqual(['全部', '图片', '视频', '文件', '链接'])
    expect(IN_CHAT_TABS.map((tab) => tab.key)).toEqual(['all', 'photo', 'video', 'file', 'url'])
  })

  it('searches 全部 only with words, but a media tab answers an empty box', () => {
    expect(shouldSearchInChat('', 'all')).toBe(false)
    expect(shouldSearchInChat('   ', 'all')).toBe(false)
    expect(shouldSearchInChat('合同', 'all')).toBe(true)
    expect(shouldSearchInChat('', 'photo')).toBe(true)
    expect(shouldSearchInChat('', 'url')).toBe(true)
  })

  it('keeps the copy per tab', () => {
    expect(inChatIdleText('all')).toBe('输入关键词，搜索本聊天的聊天记录')
    expect(inChatIdleText('file')).toBe('这里会列出本聊天发过的文件')
    expect(inChatEmptyText('all')).toBe('没有找到相关聊天记录')
    expect(inChatEmptyText('video')).toBe('没有找到视频')
    expect(inChatTabLabel('url')).toBe('链接')
  })
})

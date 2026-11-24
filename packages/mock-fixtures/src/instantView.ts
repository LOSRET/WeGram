import type { InstantView, RichBlock } from '@wegram/protocol'

import type { SeedMedia } from './seed'

/**
 * The demo page the 即时预览 reader shows in both fakes (design doc §8.9).
 *
 * The blocks are the protocol's rich-message union on purpose: TDLib's Instant
 * View `blocks` are the same `PageBlock` tree, so the fixture exercises exactly
 * the renderer a real page reaches. `mediaOf` supplies this side's bytes, the way
 * the rest of the account data does.
 */
export function buildInstantView(url: string, mediaOf: SeedMedia): InstantView {
  const paragraph = (text: string): RichBlock => ({
    type: 'text',
    role: 'paragraph',
    text: { text },
  })
  const item = (text: string) => ({ label: '', value: 0, blocks: [paragraph(text)] })
  const blocks: RichBlock[] = [
    { type: 'text', role: 'title', text: { text: 'WeGram v0.3.1 更新说明' } },
    { type: 'text', role: 'subtitle', text: { text: '链接预览、即时预览，以及三处滚动修复' } },
    { type: 'media', kind: 'photo', media: mediaOf(7101, { width: 1200, height: 800 }) },
    paragraph('消息里的链接现在会画成一张卡片：站点、标题、说明和封面，竖长的封面也铺满整宽。'),
    paragraph('点卡片底部的「⚡ 即时预览」，页面就在应用内打开，不再跳浏览器。'),
    { type: 'text', role: 'header', text: { text: '这一版还修了什么' } },
    {
      type: 'list',
      items: [
        item('预加载页在快速上滑时不再丢行。'),
        item('聊天列表的未读气泡按服务端标记回退。'),
        item('图片查看器的缩放不再被窗口宽度卡住。'),
      ],
    },
    {
      type: 'quote',
      blocks: [paragraph('阅读模式的内容来自网页本身，排版由客户端决定。')],
      credit: { text: '— WeGram 团队' },
    },
  ]
  return { url, blocks, isFull: true, viewCount: 1128 }
}

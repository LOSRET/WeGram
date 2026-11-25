import type { InvokeRequest } from '@wegram/protocol'

/** One 聊天文件 tab's TDLib filter, taken from the channel's own contract. */
export type InChatFilter = NonNullable<InvokeRequest<'search:inChat'>['filter']>
export type InChatTab = 'all' | InChatFilter

export interface InChatTabEntry {
  key: InChatTab
  label: string
}

/**
 * 查找聊天内容's tabs, in WeChat's order: the text search first, then the kinds of
 * shared media (聊天文件). The ids are TDLib's filters, so a tab is never "a
 * client-side guess" at what a message is.
 */
export const IN_CHAT_TABS: readonly InChatTabEntry[] = [
  { key: 'all', label: '全部' },
  { key: 'photo', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'file', label: '文件' },
  { key: 'url', label: '链接' },
]

export function inChatTabLabel(tab: InChatTab): string {
  switch (tab) {
    case 'all':
      return '全部'
    case 'photo':
      return '图片'
    case 'video':
      return '视频'
    case 'file':
      return '文件'
    case 'url':
      return '链接'
  }
}

/**
 * Whether this tab has anything to ask. 全部 needs words — an empty box there is
 * not a search; a media tab answers "everything of this kind" with an empty box,
 * which is the whole point of 聊天文件.
 */
export function shouldSearchInChat(q: string, tab: InChatTab): boolean {
  return tab !== 'all' || q.trim() !== ''
}

/** The placeholder before anything is asked. */
export function inChatIdleText(tab: InChatTab): string {
  return tab === 'all'
    ? '输入关键词，搜索本聊天的聊天记录'
    : `这里会列出本聊天发过的${inChatTabLabel(tab)}`
}

/** The answer when the query or the tab found nothing. */
export function inChatEmptyText(tab: InChatTab): string {
  return tab === 'all' ? '没有找到相关聊天记录' : `没有找到${inChatTabLabel(tab)}`
}

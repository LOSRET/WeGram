import type { SearchScope } from '../../lib/messageSearch'

const TABS: readonly { scope: SearchScope; label: string }[] = [
  { scope: 'chat', label: '聊天' },
  { scope: 'channel', label: '频道' },
]

/**
 * The search panel's scope switch, the client's 聊天 / 频道 pair: 聊天 covers
 * private chats and groups, 频道 covers channels (design doc §9.2).
 */
export function SearchTabs({
  value,
  onChange,
}: {
  value: SearchScope
  onChange: (scope: SearchScope) => void
}) {
  return (
    <div className="wx-search-tabs" role="tablist" aria-label="搜索范围">
      {TABS.map((tab) => (
        <button
          key={tab.scope}
          type="button"
          role="tab"
          aria-selected={value === tab.scope}
          className={'wx-search-tab' + (value === tab.scope ? ' wx-search-tab--active' : '')}
          onClick={() => onChange(tab.scope)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
